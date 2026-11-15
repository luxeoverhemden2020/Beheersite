// Dagelijks bijsturen van Google Ads (Supabase Edge Function "sr-bijsturen")
// - "dagelijks" (cron, na de nachtelijke cijfers van sr-ads):
//   1. zoekopdrachten die alleen geld kosten uitsluiten (exact, op campagneniveau, alleen zoekcampagnes)
//      regel: geen enkele aanvraag/verkoop en ≥ 15 klikken of ≥ max(€10, kosten per aanvraag) in 30 dagen
//      nooit: merknaam van de klant, zoekopdrachten die gelijk zijn aan een eigen zoekwoord, campagnes jonger dan 14 dagen
//   2. maandag: budget verschuiven tussen campagnes met een eigen dagbudget (max. 10% per week, totaal blijft gelijk)
//      nooit bij de campagne met tegoed van sr-ads-geld (die heeft een vast totaalbudget)
//   Alles wordt vastgelegd in ads_acties (status "uitgevoerd", soort "auto_*") met de gegevens om het terug te draaien.
//   3. uitverkocht: advertentiegroepen pauzeren waarvan de landingspagina uitverkocht is (schema.org OutOfStock) of niet meer bestaat (404/410);
//      weer aanzetten zodra het product terug is. De homepage wordt nooit gepauzeerd. (Shopping regelt Google zelf via Merchant Center.)
//   4. concurrent-alarm: daalt het aandeel bovenaan op de eigen merknaam flink of wordt een klik op de naam veel duurder,
//      dan adverteert er mogelijk een ander op de naam van de klant (Google geeft concurrentnamen niet via de API).
// - beheer (admin, sessie): "lijst", "terug" (wijziging terugdraaien)
// Instelling bijsturen_modus: "aan" (standaard) of "uit".
// deno-lint-ignore-file no-explicit-any
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-sessie, x-cron-key, authorization, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);
const euro = (n: number) => "€" + (Math.round(n * 100) / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isoDag = (d: Date) => d.toISOString().slice(0, 10);
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (s: string) => b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
const MAX_PER_DAG = 10;

async function inst() {
  const r = await sql`select sleutel, waarde from beheersite.instellingen`;
  return Object.fromEntries(r.map((x: any) => [x.sleutel, x.waarde])) as Record<string, string>;
}
async function gebruikerVan(req: Request) {
  const t = req.headers.get("x-sessie");
  if (!t) return null;
  const [g] = await sql`select g.id, g.rol from beheersite.sessies s join beheersite.gebruikers g on g.id = s.gebruiker_id
    where s.token_hash = ${await sha256(t)} and s.verloopt > now() and g.actief`;
  return g || null;
}
async function mailJan(i: Record<string, string>, onderwerp: string, html: string) {
  try {
    if (!i.resend_sleutel || !i.jan_email) return;
    await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${i.resend_sleutel}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: i.mail_van || "Sitehulpje <info@sitehulpje.nl>", to: [i.jan_email], subject: onderwerp, html }) });
  } catch (e) { console.error("mail", e); }
}
async function toegang(i: Record<string, string>) {
  if (!i.ads_token_id) throw new Error("Google Ads is nog niet gekoppeld.");
  const [{ t }] = await sql`select beheersite.vb_token_lezen(${i.ads_token_id}::uuid) t`;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: i.google_client_id || "", client_secret: CLIENT_SECRET, grant_type: "refresh_token", refresh_token: t }) });
  const d = await r.json();
  if (!r.ok) throw new Error("Google Ads-toegang verlopen.");
  return d.access_token as string;
}
async function gads(i: Record<string, string>, at: string, pad: string, body: unknown) {
  const h: Record<string, string> = { Authorization: `Bearer ${at}`, "Content-Type": "application/json", "login-customer-id": (i.ads_manager || "3429828197").replace(/\D/g, "") };
  if (i.ads_developer_token) h["developer-token"] = i.ads_developer_token;
  const r = await fetch(`https://googleads.googleapis.com/${i.ads_api_versie || "v22"}/${pad}`, { method: "POST", headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const f = [...new Set((d?.error?.details || []).flatMap((x: any) => x.errors || []).map((e: any) => e.message).filter(Boolean))];
    throw new Error(`Google Ads: ${f.join(" / ") || d?.error?.message || r.status}`.slice(0, 400));
  }
  return d;
}
async function zoek(i: Record<string, string>, at: string, cid: string, query: string) {
  const rijen: any[] = []; let pageToken: string | undefined;
  for (let n = 0; n < 20; n++) {
    const d = await gads(i, at, `customers/${cid}/googleAds:search`, { query, ...(pageToken ? { pageToken } : {}) });
    rijen.push(...(d.results || [])); pageToken = d.nextPageToken; if (!pageToken) break;
  }
  return rijen;
}
const maandag = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDag(d); };
const merkVan = (k: any) => {
  const merk = new Set<string>();
  for (const w of norm(k.naam || "").split(" ")) if (w.length >= 4) merk.add(w);
  try { const host = new URL(k.site || "").hostname.replace(/^www\./, "").split(".")[0]; if (host.length >= 4) merk.add(norm(host).replace(/ /g, "")); } catch { /* geen site */ }
  return merk;
};
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// ---------- 1. zoekopdrachten uitsluiten ----------
async function uitsluiten(i: Record<string, string>, at: string, k: any, log: string[]) {
  const cid = String(k.ads_klant).replace(/\D/g, "");
  // merknaam: woorden uit de klantnaam en de domeinnaam (min. 4 tekens)
  const merk = merkVan(k);
  // campagnes die oud genoeg zijn (≥ 14 dagen met kosten)
  const oud = new Set((await sql`select campagne_id from beheersite.ads_dag where klant_id = ${k.id} and kosten > 0 group by 1 having min(datum) <= current_date - 14`).map((r: any) => r.campagne_id));
  if (!oud.size) return 0;
  const termen = await zoek(i, at, cid, `SELECT campaign.id, campaign.resource_name, campaign.name, search_term_view.search_term, search_term_view.status, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM search_term_view WHERE segments.date DURING LAST_30_DAYS AND campaign.advertising_channel_type = 'SEARCH' AND campaign.status = 'ENABLED'`);
  if (!termen.length) return 0;
  const woorden = new Set((await zoek(i, at, cid, `SELECT ad_group_criterion.keyword.text FROM keyword_view WHERE ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED'`))
    .map((r: any) => norm(r.adGroupCriterion?.keyword?.text || "")));
  // per campagne + term optellen
  const per = new Map<string, any>();
  let kosten = 0, conv = 0;
  for (const r of termen) {
    const t = r.searchTermView?.searchTerm; if (!t) continue;
    const key = r.campaign.id + "|" + t;
    const a = per.get(key) || { campagne: r.campaign.resourceName, campagne_id: String(r.campaign.id), naam: r.campaign.name, term: t, status: r.searchTermView.status, klikken: 0, kosten: 0, conv: 0 };
    a.klikken += Number(r.metrics?.clicks || 0); a.kosten += Number(r.metrics?.costMicros || 0) / 1e6; a.conv += Number(r.metrics?.conversions || 0);
    per.set(key, a); kosten += Number(r.metrics?.costMicros || 0) / 1e6; conv += Number(r.metrics?.conversions || 0);
  }
  const cpa = conv > 0 ? kosten / conv : 0;
  const grens = Math.max(10, cpa);
  // zoekopdrachten die ergens wél iets opleverden, nooit uitsluiten
  const ooit = new Set([...per.values()].filter((a) => a.conv > 0).map((a) => norm(a.term)));
  const [{ n: vandaag }] = await sql`select count(*)::int n from beheersite.ads_acties where klant_id = ${k.id} and soort = 'auto_uitsluiten' and aangemaakt > now() - interval '20 hours'`;
  const kandidaten = [...per.values()]
    .filter((a) => oud.has(a.campagne_id) && a.conv === 0 && a.status !== "EXCLUDED" && a.status !== "ADDED_EXCLUDED" && (a.klikken >= 15 || a.kosten >= grens))
    .filter((a) => { const n = norm(a.term); return !woorden.has(n) && !ooit.has(n) && ![...merk].some((m) => n.replace(/ /g, "").includes(m)); })
    .sort((a, b) => b.kosten - a.kosten).slice(0, Math.max(0, MAX_PER_DAG - vandaag));
  let n = 0;
  for (const a of kandidaten) {
    try {
      const d = await gads(i, at, `customers/${cid}/googleAds:mutate`, { mutateOperations: [{ campaignCriterionOperation: { create: { campaign: a.campagne, negative: true, keyword: { text: a.term.slice(0, 80), matchType: "EXACT" } } } }] });
      const rn = d.mutateOperationResponses?.[0]?.campaignCriterionResult?.resourceName;
      await sql`insert into beheersite.ads_acties (klant_id, week, soort, tekst, waarom, besparing_eur, status, data)
        values (${k.id}, ${maandag()}, 'auto_uitsluiten', ${`Zoekopdracht "${a.term}" uitgesloten`},
          ${`Kostte ${euro(a.kosten)} in 30 dagen (${a.klikken} klikken) zonder één aanvraag of verkoop.`}, ${Math.round(a.kosten / 30 * 7 * 100) / 100}, 'uitgevoerd',
          ${sql.json({ cid, campagne: a.campagne, campagne_naam: a.naam, term: a.term, kosten: a.kosten, klikken: a.klikken, resource_name: rn })})`;
      log.push(`${k.id}: "${a.term}" uitgesloten (${euro(a.kosten)}, ${a.klikken} klikken)`); n++;
    } catch (e) { log.push(`${k.id}: "${a.term}" lukte niet: ${(e as Error).message}`); }
  }
  return n;
}

// ---------- 2. budget verschuiven (maandag) ----------
async function budget(i: Record<string, string>, at: string, k: any, log: string[]) {
  if (new Date().getDay() !== 1) return 0;
  const cid = String(k.ads_klant).replace(/\D/g, "");
  const [al] = await sql`select 1 from beheersite.ads_acties where klant_id = ${k.id} and soort = 'auto_budget' and status = 'uitgevoerd' and aangemaakt > now() - interval '6 days'`;
  if (al) return 0;
  const camp = await zoek(i, at, cid, `SELECT campaign.id, campaign.resource_name, campaign.name, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.period,
      metrics.cost_micros, metrics.conversions, metrics.conversions_value
    FROM campaign WHERE campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS`);
  const per = new Map<string, any>();
  for (const r of camp) {
    if (r.campaignBudget?.explicitlyShared || r.campaignBudget?.period !== "DAILY" || !r.campaignBudget?.amountMicros) continue;
    if (k.ads_campagne && r.campaign.resourceName === k.ads_campagne) continue; // tegoed-campagne van sr-ads-geld nooit
    const a = per.get(r.campaign.resourceName) || { campagne: r.campaign.resourceName, naam: r.campaign.name, budget: r.campaignBudget.resourceName, dag: Number(r.campaignBudget.amountMicros) / 1e6, kosten: 0, conv: 0, waarde: 0 };
    a.kosten += Number(r.metrics?.costMicros || 0) / 1e6; a.conv += Number(r.metrics?.conversions || 0); a.waarde += Number(r.metrics?.conversionsValue || 0);
    per.set(r.campaign.resourceName, a);
  }
  const lijst = [...per.values()].filter((a) => a.kosten >= 20);
  if (lijst.length < 2) return 0;
  const omzet = lijst.some((a) => a.waarde > 0);
  const score = (a: any) => omzet ? a.waarde / a.kosten : a.conv / a.kosten;
  lijst.sort((a, b) => score(b) - score(a));
  const best = lijst[0], slechtst = lijst[lijst.length - 1];
  if (score(slechtst) * 1.5 > score(best) || score(best) === 0) return 0;
  const verschuif = Math.round(slechtst.dag * 0.1 * 100) / 100;
  if (verschuif < 0.5 || slechtst.dag - verschuif < 1) return 0;
  const nieuwSlecht = Math.round((slechtst.dag - verschuif) * 100) / 100, nieuwBest = Math.round((best.dag + verschuif) * 100) / 100;
  await gads(i, at, `customers/${cid}/googleAds:mutate`, { mutateOperations: [
    { campaignBudgetOperation: { update: { resourceName: slechtst.budget, amountMicros: String(Math.round(nieuwSlecht * 1e6)) }, updateMask: "amount_micros" } },
    { campaignBudgetOperation: { update: { resourceName: best.budget, amountMicros: String(Math.round(nieuwBest * 1e6)) }, updateMask: "amount_micros" } },
  ] });
  const fmt = (a: any) => omzet ? `${euro(a.waarde / a.kosten)} omzet per euro` : a.conv ? `${euro(a.kosten / a.conv)} per aanvraag` : "geen aanvragen";
  await sql`insert into beheersite.ads_acties (klant_id, week, soort, tekst, waarom, status, data)
    values (${k.id}, ${maandag()}, 'auto_budget', ${`${euro(verschuif)} per dag verschoven van "${slechtst.naam}" naar "${best.naam}"`},
      ${`"${best.naam}": ${fmt(best)}. "${slechtst.naam}": ${fmt(slechtst)}. Het totale budget blijft gelijk.`}, 'uitgevoerd',
      ${sql.json({ cid, van: { budget: slechtst.budget, oud: slechtst.dag, nieuw: nieuwSlecht }, naar: { budget: best.budget, oud: best.dag, nieuw: nieuwBest } })})`;
  log.push(`${k.id}: ${euro(verschuif)}/dag van "${slechtst.naam}" naar "${best.naam}"`);
  return 1;
}

// ---------- 3. uitverkochte producten ----------
async function voorraad(url: string): Promise<"op" | "weg" | "ok"> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Sitehulpje-voorraadcheck)" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (r.status === 404 || r.status === 410) return "weg";
    if (!r.ok) return "ok"; // bij twijfel (storing, blokkade) niets doen
    const html = (await r.text()).slice(0, 600000);
    const op = /schema\.org\/(OutOfStock|SoldOut|Discontinued)|"availability"\s*:\s*"(OutOfStock|SoldOut|Discontinued)"/i.test(html);
    const wel = /schema\.org\/(InStock|LimitedAvailability|PreOrder|BackOrder)|"availability"\s*:\s*"(InStock|LimitedAvailability|PreOrder|BackOrder)"/i.test(html);
    return op && !wel ? "op" : "ok";
  } catch { return "ok"; }
}
async function uitverkocht(i: Record<string, string>, at: string, k: any, log: string[]) {
  const cid = String(k.ads_klant).replace(/\D/g, "");
  // 1. eerder gepauzeerde groepen: is het product terug?
  const gepauzeerd = await sql`select id, data from beheersite.ads_acties where klant_id = ${k.id} and soort = 'auto_pauze' and status = 'uitgevoerd'`;
  for (const a of gepauzeerd) {
    if (await voorraad(a.data.url) !== "ok") continue;
    try {
      await gads(i, at, `customers/${cid}/googleAds:mutate`, { mutateOperations: [{ adGroupOperation: { update: { resourceName: a.data.adgroep, status: "ENABLED" }, updateMask: "status" } }] });
      await sql`update beheersite.ads_acties set status = 'hervat' where id = ${a.id}`;
      log.push(`${k.id}: "${a.data.naam}" weer aangezet, product is terug`);
    } catch (e) { log.push(`${k.id}: weer aanzetten "${a.data.naam}" lukte niet: ${(e as Error).message}`); }
  }
  // 2. lopende groepen controleren
  const ads = await zoek(i, at, cid, `SELECT ad_group.resource_name, ad_group.name, ad_group_ad.ad.final_urls FROM ad_group_ad
    WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type = 'SEARCH' AND ad_group.status = 'ENABLED' AND ad_group_ad.status = 'ENABLED'`);
  const groepen = new Map<string, { naam: string; urls: Set<string> }>();
  for (const r of ads) {
    const g = groepen.get(r.adGroup.resourceName) || { naam: r.adGroup.name, urls: new Set<string>() };
    for (const u of r.adGroupAd?.ad?.finalUrls || []) g.urls.add(u);
    groepen.set(r.adGroup.resourceName, g);
  }
  // groepen die Jan zelf weer heeft aangezet, laten we met rust
  const zelf = new Set((await sql`select data->>'adgroep' rn from beheersite.ads_acties where klant_id = ${k.id} and soort = 'auto_pauze' and status = 'teruggedraaid'`).map((r: any) => r.rn));
  let n = 0, getest = 0;
  for (const [rn, g] of groepen) {
    if (zelf.has(rn)) continue;
    if (g.urls.size !== 1 || getest >= 40) continue; // alleen groepen met één landingspagina
    const url = [...g.urls][0];
    try { if (new URL(url).pathname.replace(/\/+$/, "") === "") continue; } catch { continue; } // homepage nooit
    getest++;
    const v = await voorraad(url);
    if (v === "ok") continue;
    try {
      await gads(i, at, `customers/${cid}/googleAds:mutate`, { mutateOperations: [{ adGroupOperation: { update: { resourceName: rn, status: "PAUSED" }, updateMask: "status" } }] });
      await sql`insert into beheersite.ads_acties (klant_id, week, soort, tekst, waarom, status, data)
        values (${k.id}, ${maandag()}, 'auto_pauze', ${`Advertentie voor "${g.naam}" gepauzeerd`},
          ${v === "op" ? "Dit product is uitverkocht. Zodra het terug is, zetten we de advertentie vanzelf weer aan." : "Deze pagina bestaat niet meer. Klikken zouden op een foutpagina uitkomen."}, 'uitgevoerd',
          ${sql.json({ cid, adgroep: rn, naam: g.naam, url, reden: v })})`;
      log.push(`${k.id}: "${g.naam}" gepauzeerd (${v === "op" ? "uitverkocht" : "pagina weg"})`); n++;
    } catch (e) { log.push(`${k.id}: pauzeren "${g.naam}" lukte niet: ${(e as Error).message}`); }
  }
  return n;
}

// ---------- 4. concurrent-alarm op de eigen merknaam ----------
async function concurrent(i: Record<string, string>, at: string, k: any, log: string[]) {
  const [al] = await sql`select 1 from beheersite.ads_acties where klant_id = ${k.id} and soort = 'concurrent' and aangemaakt > now() - interval '14 days'`;
  if (al) return 0;
  const merk = merkVan(k);
  if (!merk.size) return 0;
  const cid = String(k.ads_klant).replace(/\D/g, "");
  const dag = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDag(d); };
  const periode = async (van: string, tot: string) => {
    const r = await zoek(i, at, cid, `SELECT ad_group_criterion.keyword.text, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.search_top_impression_share
      FROM keyword_view WHERE segments.date BETWEEN '${van}' AND '${tot}' AND campaign.status = 'ENABLED'`);
    let vert = 0, klik = 0, kosten = 0, top = 0;
    for (const x of r) {
      const t = norm(x.adGroupCriterion?.keyword?.text || "").replace(/ /g, "");
      if (![...merk].some((m) => t.includes(m))) continue;
      const v = Number(x.metrics?.impressions || 0);
      vert += v; klik += Number(x.metrics?.clicks || 0); kosten += Number(x.metrics?.costMicros || 0) / 1e6;
      top += v * Number(x.metrics?.searchTopImpressionShare || 0);
    }
    return { vert, klik, cpc: klik ? kosten / klik : 0, top: vert ? top / vert : 0 };
  };
  const nu = await periode(dag(7), dag(1)), voor = await periode(dag(35), dag(8));
  if (nu.vert < 30 || voor.vert < 30) return 0;
  const topDaling = (voor.top - nu.top) * 100, cpcStijging = voor.cpc ? (nu.cpc / voor.cpc - 1) * 100 : 0;
  if (topDaling < 15 && cpcStijging < 50) return 0;
  const pct = (x: number) => Math.round(x * 100) + "%";
  const waarom = [topDaling >= 15 ? `je advertentie stond minder vaak bovenaan (${pct(voor.top)} → ${pct(nu.top)})` : "",
    cpcStijging >= 50 ? `een klik op je naam werd duurder (${euro(voor.cpc)} → ${euro(nu.cpc)})` : ""].filter(Boolean).join(" en ");
  await sql`insert into beheersite.ads_acties (klant_id, week, soort, tekst, waarom, status, data)
    values (${k.id}, ${maandag()}, 'concurrent', 'Mogelijk adverteert een ander op jouw bedrijfsnaam.',
      ${`Bij zoekopdrachten op je naam ${waarom}. Dat gebeurt meestal als een concurrent op je naam biedt. We houden het in de gaten en zorgen dat je zelf bovenaan blijft staan.`}, 'melding',
      ${sql.json({ nu, voor })})`;
  log.push(`${k.id}: concurrent-alarm: ${waarom}`);
  return 1;
}

async function dagelijks(i: Record<string, string>) {
  if (i.bijsturen_modus === "uit") return { ok: true, uit: "bijsturen staat uit" };
  const klanten = await sql`select id, naam, site, ads_klant, ads_campagne from beheersite.klanten where actief and ads_klant is not null`;
  if (!klanten.length) return { ok: true, log: [] };
  const at = await toegang(i), log: string[] = [];
  for (const k of klanten) {
    try { await uitsluiten(i, at, k, log); } catch (e) { log.push(`${k.id}: uitsluiten: ${(e as Error).message}`); }
    try { await budget(i, at, k, log); } catch (e) { log.push(`${k.id}: budget: ${(e as Error).message}`); }
    try { await uitverkocht(i, at, k, log); } catch (e) { log.push(`${k.id}: uitverkocht: ${(e as Error).message}`); }
    try { await concurrent(i, at, k, log); } catch (e) { log.push(`${k.id}: concurrent: ${(e as Error).message}`); }
  }
  const gedaan = log.filter((l) => !/lukte niet|: (uitsluiten|budget|uitverkocht|concurrent):/.test(l));
  if (log.length) await mailJan(i, `Bijgestuurd: ${gedaan.length} wijziging${gedaan.length === 1 ? "" : "en"} in Google Ads`,
    `<p>Vandaag automatisch bijgestuurd:</p><ul>${log.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p>Terugdraaien kan in je beheer bij Advertenties.</p>`);
  return { ok: true, log };
}

// ---------- terugdraaien ----------
async function terug(i: Record<string, string>, id: number) {
  const [a] = await sql`select id, soort, status, data from beheersite.ads_acties where id = ${id}`;
  if (!a || a.status !== "uitgevoerd" || !String(a.soort).startsWith("auto_")) throw new Error("Deze wijziging kan niet (meer) teruggedraaid worden.");
  const at = await toegang(i), d = a.data;
  if (a.soort === "auto_uitsluiten" && d.resource_name)
    await gads(i, at, `customers/${d.cid}/googleAds:mutate`, { mutateOperations: [{ campaignCriterionOperation: { remove: d.resource_name } }] });
  if (a.soort === "auto_budget")
    await gads(i, at, `customers/${d.cid}/googleAds:mutate`, { mutateOperations: [
      { campaignBudgetOperation: { update: { resourceName: d.van.budget, amountMicros: String(Math.round(d.van.oud * 1e6)) }, updateMask: "amount_micros" } },
      { campaignBudgetOperation: { update: { resourceName: d.naar.budget, amountMicros: String(Math.round(d.naar.oud * 1e6)) }, updateMask: "amount_micros" } },
    ] });
  if (a.soort === "auto_pauze")
    await gads(i, at, `customers/${d.cid}/googleAds:mutate`, { mutateOperations: [{ adGroupOperation: { update: { resourceName: d.adgroep, status: "ENABLED" }, updateMask: "status" } }] });
  await sql`update beheersite.ads_acties set status = 'teruggedraaid' where id = ${id}`;
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fout: "Alleen POST" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const i = await inst();
    if (b.actie === "lijst" || b.actie === "terug") {
      const g = await gebruikerVan(req);
      if (!g) return json({ fout: "Niet ingelogd" }, 401);
      if (g.rol !== "admin") return json({ fout: "Geen toegang" }, 403);
      if (b.actie === "terug") return json(await terug(i, Number(b.id)));
      const lijst = await sql`select a.id, a.klant_id, k.naam klant, a.aangemaakt, a.soort, a.tekst, a.waarom, a.besparing_eur::float besparing, a.status
        from beheersite.ads_acties a join beheersite.klanten k on k.id = a.klant_id where a.soort like 'auto_%' order by a.aangemaakt desc limit 100`;
      return json({ modus: i.bijsturen_modus === "uit" ? "uit" : "aan", lijst });
    }
    if (!i.cron_sleutel || req.headers.get("x-cron-key") !== i.cron_sleutel) return json({ fout: "Geen toegang" }, 401);
    if (b.actie === "dagelijks") return json(await dagelijks(i));
    return json({ fout: "Onbekende actie" }, 400);
  } catch (e) { console.error(e); return json({ fout: String((e as Error).message).slice(0, 300) }, 500); }
});
