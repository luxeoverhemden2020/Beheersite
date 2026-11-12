// Advertentiebudget (Supabase Edge Function "sr-ads-geld")
// - klant: saldo bekijken en budget aanvullen via Mollie (bedrag + 21% btw). Het budget gaat 1-op-1 naar Google (Siteregelaar betaalt Google).
// - mollie webhook: betaling bijwerken, Jan mailen
// - beheer (admin): campagne klaarzetten in Google Ads (GEPAUZEERD, kost niets), aanzetten met dagbudget, pauzeren
// - cron "bewaken" (elk uur): uitgaven live ophalen en de campagne pauzeren zodra het tegoed op is
// deno-lint-ignore-file no-explicit-any
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const MOLLIE = Deno.env.get("MOLLIE_API_KEY") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const FN = "https://dauvsivoxfdfzurmyuug.supabase.co/functions/v1/sr-ads-geld";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-sessie, x-cron-key, authorization, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
class Fout extends Error { constructor(public code: number, msg: string) { super(msg); } }
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (s: string) => b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);
const r2 = (n: number) => Math.round(n * 100) / 100;
const euro = (n: number) => "€" + r2(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vandaag = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });

async function inst() {
  const r = await sql`select sleutel, waarde from beheersite.instellingen`;
  return Object.fromEntries(r.map((x: any) => [x.sleutel, x.waarde])) as Record<string, string>;
}
async function gebruikerVan(req: Request) {
  const t = req.headers.get("x-sessie");
  if (!t) return null;
  const [g] = await sql`select g.id, g.rol, g.klant_id, g.email from beheersite.sessies s join beheersite.gebruikers g on g.id = s.gebruiker_id
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

// ---------- Google Ads ----------
async function toegang(i: Record<string, string>) {
  if (!i.ads_token_id) throw new Fout(409, "Google Ads is nog niet gekoppeld.");
  const [{ t }] = await sql`select beheersite.vb_token_lezen(${i.ads_token_id}::uuid) t`;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: i.google_client_id || "", client_secret: CLIENT_SECRET, grant_type: "refresh_token", refresh_token: t }) });
  const d = await r.json();
  if (!r.ok) throw new Fout(502, "Google Ads-toegang verlopen. Koppel opnieuw in het beheer.");
  return d.access_token as string;
}
function kop(i: Record<string, string>, at: string) {
  const h: Record<string, string> = { Authorization: `Bearer ${at}`, "Content-Type": "application/json", "login-customer-id": (i.ads_manager || "3429828197").replace(/\D/g, "") };
  if (i.ads_developer_token) h["developer-token"] = i.ads_developer_token;
  return h;
}
const V = (i: Record<string, string>) => i.ads_api_versie || "v22";
async function gads(i: Record<string, string>, at: string, pad: string, body: unknown) {
  const r = await fetch(`https://googleads.googleapis.com/${V(i)}/${pad}`, { method: "POST", headers: kop(i, at), body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const fouten = [...new Set((d?.error?.details || []).flatMap((x: any) => x.errors || []).map((e: any) => e.message).filter(Boolean))];
    throw new Fout(502, `Google Ads: ${(fouten.join(" / ") || d?.error?.message || r.status)}`.slice(0, 500));
  }
  return d;
}
const zoek = (i: Record<string, string>, at: string, cid: string, query: string) => gads(i, at, `customers/${cid}/googleAds:search`, { query });

// campagne opbouwen uit het voorstel (alles in één keer, met tijdelijke nummers)
const UITSLUITEN = ["gratis", "vacature", "vacatures", "baan", "tweedehands", "2dehands", "marktplaats", "zelf maken", "diy", "wikipedia", "betekenis"];
const MIN = (m: number) => (["ZERO", "FIFTEEN", "THIRTY", "FORTY_FIVE"][Math.round(m / 15)] || "ZERO");
const tijdStr = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }).slice(0, 19);
function opbouw(cid: string, v: any, budget: { soort: "totaal" | "dag"; bedrag: number; eind?: Date }) {
  const d = v.data, k = v.keuzes || {};
  const uit = new Set(k.uit || []);
  const woorden = (d.zoekwoorden || []).filter((z: any) => !uit.has(z.term));
  const ads = (k.advertenties || d.advertenties || []).filter((a: any) => a.aan !== false);
  const koppen = [...new Set(ads.flatMap((a: any) => a.koppen || []).map((x: string) => x.trim().slice(0, 30)).filter(Boolean))].slice(0, 15) as string[];
  const teksten = [...new Set(ads.map((a: any) => String(a.tekst || "").trim().slice(0, 90)).filter(Boolean))].slice(0, 4) as string[];
  if (koppen.length < 3) throw new Fout(400, "Er zijn minstens 3 verschillende koppen nodig.");
  if (teksten.length < 2) teksten.push(`${d.naam}. ${d.webshop ? "Bekijk de collectie online." : "Neem vandaag contact op."}`.slice(0, 90));
  if (!woorden.length) throw new Fout(400, "Er staan geen zoekwoorden aan.");
  const B = `customers/${cid}/campaignBudgets/-1`, C = `customers/${cid}/campaigns/-2`;
  const naam = `Siteregelaar · Zoeken · ${tijdStr(new Date()).slice(0, 16)}`;
  const cpcMax = Math.max(0.3, Math.min(5, (d.cpc_gem || 1) * 1.5));
  const totaal = budget.soort === "totaal";
  const ops: any[] = [
    { campaignBudgetOperation: { create: { resourceName: B, name: naam, explicitlyShared: false, deliveryMethod: "STANDARD",
      ...(totaal ? { period: "CUSTOM_PERIOD", totalAmountMicros: String(Math.round(budget.bedrag * 1e6)) } : { amountMicros: String(Math.round(budget.bedrag * 1e6)) }) } } },
    { campaignOperation: { create: { resourceName: C, name: naam, status: "PAUSED", advertisingChannelType: "SEARCH", campaignBudget: B,
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      targetSpend: { cpcBidCeilingMicros: String(Math.round(cpcMax * 1e6)) },
      geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" },
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
      ...(totaal && budget.eind ? { startDateTime: tijdStr(new Date()), endDateTime: tijdStr(budget.eind).slice(0, 10) + " 23:59:59" } : {}) } } },
    { campaignCriterionOperation: { create: { campaign: C, language: { languageConstant: "languageConstants/1010" } } } },
    ...UITSLUITEN.map((t) => ({ campaignCriterionOperation: { create: { campaign: C, negative: true, keyword: { text: t, matchType: "BROAD" } } } })),
  ];
  // waar: land of straal rond het adres
  const gebied = k.gebied || d.gebied || { soort: "land", landen: ["NL"] };
  if (gebied.soort === "straal" && d.adres?.plaats) ops.push({ campaignCriterionOperation: { create: { campaign: C, proximity: { radius: Number(gebied.km || d.gebied?.km || 25), radiusUnits: "KILOMETERS",
    address: { streetAddress: d.adres.straat || undefined, postalCode: (d.adres.postcode || "").replace(/\s/g, "") || undefined, cityName: d.adres.plaats, countryCode: "NL" } } } } });
  else for (const l of gebied.landen || ["NL"]) ops.push({ campaignCriterionOperation: { create: { campaign: C, location: { geoTargetConstant: `geoTargetConstants/${l === "BE" ? 2056 : 2528}` } } } });
  // wanneer: bij bellen/langskomen alleen tijdens openingstijden
  const doel = k.doel || d.doel;
  if (doel !== "kopen") for (const t of d.tijden || []) {
    const [vh, vm] = t.van.split(":").map(Number), [th, tm] = t.tot.split(":").map(Number);
    ops.push({ campaignCriterionOperation: { create: { campaign: C, adSchedule: { dayOfWeek: t.dag, startHour: vh, startMinute: MIN(vm), endHour: th, endMinute: MIN(tm) } } } });
  }
  // één advertentiegroep per landingspagina
  const groepen = new Map<string, string[]>();
  for (const z of woorden) { const u = z.pagina || d.voorbeeld?.url || d.site + "/"; groepen.set(u, [...(groepen.get(u) || []), z.term]); }
  let n = -3;
  for (const [url, termen] of [...groepen].slice(0, 10)) {
    const G = `customers/${cid}/adGroups/${n--}`;
    const pad = new URL(url).pathname.replace(/\.html?$/, "").split("/").filter(Boolean).pop() || "home";
    ops.push({ adGroupOperation: { create: { resourceName: G, campaign: C, name: `${pad} (${termen[0]})`.slice(0, 250), status: "ENABLED", type: "SEARCH_STANDARD" } } });
    for (const t of termen) ops.push({ adGroupCriterionOperation: { create: { adGroup: G, status: "ENABLED", keyword: { text: t, matchType: "PHRASE" } } } });
    ops.push({ adGroupAdOperation: { create: { adGroup: G, status: "ENABLED", ad: { finalUrls: [url], responsiveSearchAd: { headlines: koppen.map((text) => ({ text })), descriptions: teksten.map((text) => ({ text })) } } } } });
  }
  return { woorden: woorden.length, groepen: groepen.size, koppen: koppen.length, teksten: teksten.length, gebied, tijden: doel !== "kopen" ? (d.tijden || []).length : 0, ops };
}

async function saldo(kid: string) {
  const [k] = await sql`select ads_campagne, ads_campagne_aan, ads_tellen_vanaf, ads_uitgegeven::float uit, ads_bewaakt, ads_budget_soort, ads_periode_eind, ads_dagbudget from beheersite.klanten where id = ${kid}`;
  const [s] = await sql`select coalesce(sum(bedrag_excl) filter (where status = 'betaald'),0)::float gestort from beheersite.ads_tegoed where klant_id = ${kid}`;
  const betalingen = await sql`select bedrag_excl::float bedrag, btw::float, totaal::float, status, aangemaakt, betaald_op from beheersite.ads_tegoed where klant_id = ${kid} and status <> 'open' order by aangemaakt desc limit 10`;
  return { gestort: r2(s.gestort), uitgegeven: r2(k?.uit || 0), over: r2(s.gestort - (k?.uit || 0)), campagne: !!k?.ads_campagne, aan: !!k?.ads_campagne_aan, bijgewerkt: k?.ads_bewaakt, betalingen,
    soort: k?.ads_budget_soort || null, eind: k?.ads_periode_eind || null, dag: k?.ads_dagbudget ? Number(k.ads_dagbudget) : null };
}
// uitgaven sinds de start live ophalen
async function uitgaven(i: Record<string, string>, at: string, kid: string) {
  const [k] = await sql`select ads_klant, ads_campagne, ads_tellen_vanaf from beheersite.klanten where id = ${kid}`;
  if (!k?.ads_klant || !k.ads_campagne) return 0;
  const cid = k.ads_klant.replace(/\D/g, ""), camp = k.ads_campagne.split("/").pop();
  const van = k.ads_tellen_vanaf ? new Date(k.ads_tellen_vanaf).toISOString().slice(0, 10) : vandaag();
  const d = await zoek(i, at, cid, `SELECT metrics.cost_micros FROM campaign WHERE campaign.id = ${camp} AND segments.date BETWEEN '${van}' AND '${vandaag()}'`);
  const kosten = r2((d.results || []).reduce((s: number, x: any) => s + Number(x.metrics?.costMicros || 0) / 1e6, 0));
  await sql`update beheersite.klanten set ads_uitgegeven = ${kosten}, ads_bewaakt = now() where id = ${kid}`;
  return kosten;
}
async function zetStatus(i: Record<string, string>, at: string, kid: string, aan: boolean, dagbudget?: number) {
  const [k] = await sql`select ads_klant, ads_campagne from beheersite.klanten where id = ${kid}`;
  if (!k?.ads_campagne) throw new Fout(409, "Er staat nog geen campagne klaar.");
  const cid = k.ads_klant.replace(/\D/g, "");
  const ops: any[] = [{ campaignOperation: { update: { resourceName: k.ads_campagne, status: aan ? "ENABLED" : "PAUSED" }, updateMask: "status" } }];
  if (dagbudget) {
    const d = await zoek(i, at, cid, `SELECT campaign.campaign_budget FROM campaign WHERE campaign.resource_name = '${k.ads_campagne}'`);
    const budget = d.results?.[0]?.campaign?.campaignBudget;
    if (budget) ops.unshift({ campaignBudgetOperation: { update: { resourceName: budget, amountMicros: String(Math.round(dagbudget * 1e6)) }, updateMask: "amount_micros" } });
  }
  await gads(i, at, `customers/${cid}/googleAds:mutate`, { mutateOperations: ops });
  await sql`update beheersite.klanten set ads_campagne_aan = ${aan} where id = ${kid}`;
}

// kosten van de huidige campagne sinds de start
async function campagneKosten(i: Record<string, string>, at: string, k: any) {
  const cid = k.ads_klant.replace(/\D/g, ""), camp = k.ads_campagne.split("/").pop();
  const van = k.ads_campagne_start ? new Date(k.ads_campagne_start).toISOString().slice(0, 10) : vandaag();
  const d = await zoek(i, at, cid, `SELECT metrics.cost_micros FROM campaign WHERE campaign.id = ${camp} AND segments.date BETWEEN '${van}' AND '${vandaag()}'`);
  return r2((d.results || []).reduce((s: number, x: any) => s + Number(x.metrics?.costMicros || 0) / 1e6, 0));
}
// totaalbudget gelijkzetten aan (al uitgegeven in deze campagne + tegoed) en zo nodig de einddatum verlengen
async function totaalBijwerken(i: Record<string, string>, at: string, kid: string, verleng: boolean) {
  const [k] = await sql`select ads_klant, ads_campagne, ads_campagne_start, ads_budget_soort, ads_periode_eind from beheersite.klanten where id = ${kid}`;
  if (!k?.ads_campagne || k.ads_budget_soort !== "totaal") return null;
  const cid = k.ads_klant.replace(/\D/g, "");
  const s = await saldo(kid), al = await campagneKosten(i, at, k);
  const d = await zoek(i, at, cid, `SELECT campaign.campaign_budget FROM campaign WHERE campaign.resource_name = '${k.ads_campagne}'`);
  const budget = d.results?.[0]?.campaign?.campaignBudget;
  const ops: any[] = [{ campaignBudgetOperation: { update: { resourceName: budget, totalAmountMicros: String(Math.round((al + Math.max(0, s.over)) * 1e6)) }, updateMask: "total_amount_micros" } }];
  let eind = k.ads_periode_eind ? new Date(k.ads_periode_eind) : null;
  if (verleng && (!eind || eind.getTime() < Date.now() + 864e5)) {
    const [t] = await sql`select dagen from beheersite.ads_tegoed where klant_id = ${kid} and status = 'betaald' order by betaald_op desc limit 1`;
    eind = new Date(Date.now() + (t?.dagen || 14) * 864e5);
    ops.push({ campaignOperation: { update: { resourceName: k.ads_campagne, endDateTime: tijdStr(eind).slice(0, 10) + " 23:59:59" }, updateMask: "end_date_time" } });
  }
  await gads(i, at, `customers/${cid}/googleAds:mutate`, { mutateOperations: ops });
  await sql`update beheersite.klanten set ads_periode_eind = ${eind} where id = ${kid}`;
  return { totaal: r2(al + Math.max(0, s.over)), eind };
}
// afgekeurde advertenties melden (één keer per dag)
async function beleid(i: Record<string, string>, at: string, kid: string, naam: string) {
  const [k] = await sql`select ads_klant, ads_campagne, ads_beleid_gemeld from beheersite.klanten where id = ${kid}`;
  if (!k?.ads_campagne || (k.ads_beleid_gemeld && String(k.ads_beleid_gemeld).slice(0, 10) === vandaag())) return;
  const cid = k.ads_klant.replace(/\D/g, ""), camp = k.ads_campagne.split("/").pop();
  const d = await zoek(i, at, cid, `SELECT ad_group.name, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.policy_topic_entries FROM ad_group_ad WHERE campaign.id = ${camp} AND ad_group_ad.status != 'REMOVED'`);
  const fout = (d.results || []).filter((x: any) => ["DISAPPROVED", "APPROVED_LIMITED", "AREA_OF_INTEREST_ONLY"].includes(x.adGroupAd?.policySummary?.approvalStatus));
  if (!fout.length) return;
  await sql`update beheersite.klanten set ads_beleid_gemeld = current_date where id = ${kid}`;
  await mailJan(i, `Google keurt advertentie(s) af: ${naam}`, `<p>Google heeft ${fout.length} advertentie(s) van <b>${esc(naam)}</b> afgekeurd of beperkt:</p><ul>${fout.map((x: any) => `<li>${esc(x.adGroup?.name || "")}: ${esc(x.adGroupAd.policySummary.approvalStatus)} – ${esc((x.adGroupAd.policySummary.policyTopicEntries || []).map((p: any) => p.topic).join(", "))}</li>`).join("")}</ul><p>Pas de tekst aan in het voorstel of in Google Ads.</p>`);
}

// ---------- Mollie ----------
async function mollie(pad: string, body?: unknown) {
  if (!MOLLIE) throw new Fout(409, "Betalen is nog niet ingesteld.");
  const r = await fetch(`https://api.mollie.com/v2/${pad}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${MOLLIE}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Fout(502, "Betalen lukt nu even niet. Probeer het straks nog eens.");
  return d;
}
// factuur voor betaald advertentiebudget (zelfde factuursysteem als de abonnementen)
const VERKOPER = { naam: "Siteregelaar", merk: "Sitehulpje", adres: "Markt 9", postcode: "7551 CG", plaats: "Hengelo", kvk: "55667147", btw: "NL851809777B01", email: "info@sitehulpje.nl" };
async function factuurVoorBudget(kid: string, mollieId: string) {
  const [al] = await sql`select id from beheersite.vb_facturen where mollie_betaling = ${mollieId}`;
  if (al) return;
  const [t] = await sql`select bedrag_excl::float bedrag, btw::float, totaal::float, dagen from beheersite.ads_tegoed where mollie_id = ${mollieId}`;
  const [k] = await sql`select id, naam, vb_pakket from beheersite.klanten where id = ${kid}`;
  const [o] = await sql`select gegevens->'bedrijf' b from beheersite.vb_onboarding where klant_id = ${kid}`;
  const g = o?.b || {}, i = await inst();
  const echt = i.vb_facturen_modus === "aan";
  const nummer = echt ? (await sql`select beheersite.vb_factuurnummer() n`)[0].n : null;
  const oms = "Advertentiebudget Google Ads (1-op-1 naar Google)";
  const snap = { klant: { naam: g.naam || k.naam, contact: g.contact || "", straat: g.straat || "", postcode: g.postcode || "", plaats: g.plaats || "", kvk: g.kvk || "", btw: g.btw || "", email: g.factuur_email || "" },
    verkoper: VERKOPER, pakket: k.vb_pakket, regels: [{ bedrag: t.bedrag, omschrijving: oms }] };
  const periode = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
  const [f] = await sql`insert into beheersite.vb_facturen (nummer, klant_id, periode, soort, omschrijving, bedrag_excl, btw, totaal, status, gegevens, betaald, betaald_via, mollie_betaling)
    values (${nummer}, ${kid}, ${periode}, 'klus', ${oms}, ${t.bedrag}, ${t.btw}, ${t.totaal}, ${echt ? "betaald" : "concept"}, ${sql.json(snap)}, now(), 'mollie', ${mollieId}) returning id, token, nummer`;
  if (!echt || !f.nummer) return;
  const [u] = await sql`select email from beheersite.gebruikers where klant_id = ${kid} and rol = 'klant' and actief order by email limit 1`;
  const aan = g.factuur_email || u?.email;
  if (!aan || !i.resend_sleutel) return;
  const link = `https://sitehulpje.nl/factuur?id=${f.id}&t=${f.token}`;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${i.resend_sleutel}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: i.mail_van || "Sitehulpje <info@sitehulpje.nl>", to: [aan], subject: `Factuur ${f.nummer} van Sitehulpje`,
      html: `<p>Hoi,</p><p>Bedankt voor je betaling. Hierbij de factuur voor je advertentiebudget: ${euro(t.bedrag)} + ${euro(t.btw)} btw = <b>${euro(t.totaal)}</b>. Deze factuur is al betaald.</p><p><a href="${link}">Factuur bekijken of downloaden</a></p><p style="color:#5a6b82;font-size:14px">Vragen? Beantwoord gewoon deze mail.</p>` }) });
  if (r.ok) await sql`update beheersite.vb_facturen set gemaild = now() where id = ${f.id}`;
}
async function webhook(id: string) {
  const [t] = await sql`select id, klant_id, status, bedrag_excl::float bedrag from beheersite.ads_tegoed where mollie_id = ${id}`;
  if (!t) return;
  const p = await mollie(`payments/${id}`);
  const st = p.status === "paid" ? "betaald" : ["failed", "canceled", "expired"].includes(p.status) ? (p.status === "expired" ? "verlopen" : "mislukt") : "open";
  if (st === t.status) return;
  await sql`update beheersite.ads_tegoed set status = ${st}, betaald_op = ${st === "betaald" ? new Date() : null} where id = ${t.id}`;
  if (st === "betaald") {
    await sql`update beheersite.klanten set ads_tellen_vanaf = coalesce(ads_tellen_vanaf, current_date) where id = ${t.klant_id}`;
    const i = await inst();
    const [k] = await sql`select naam, ads_campagne, ads_campagne_aan from beheersite.klanten where id = ${t.klant_id}`;
    await factuurVoorBudget(t.klant_id, id).catch((e) => console.error("factuur", e));
    try { const i0 = await inst(); const at = await toegang(i0); await totaalBijwerken(i0, at, t.klant_id, true); } catch (e) { console.error("totaal bijwerken", e); }
    const s = await saldo(t.klant_id);
    await mailJan(i, `Advertentiebudget betaald: ${k?.naam || t.klant_id} (${euro(t.bedrag)})`, `<p><b>${esc(k?.naam || t.klant_id)}</b> betaalde ${euro(t.bedrag)} advertentiebudget (excl. btw).</p>
<p>Tegoed nu: ${euro(s.over)}. Campagne: ${k?.ads_campagne ? (k.ads_campagne_aan ? "staat aan" : "staat klaar, nog gepauzeerd") : "nog niet klaargezet"}.</p><p>Aanzetten doe je in je beheer bij Advertenties.</p>`);
  }
}

// ---------- verzoeken ----------
async function handel(req: Request, b: any) {
  const a = b.actie;
  const i = await inst();
  if (a === "bewaken") {
    if (!i.cron_sleutel || req.headers.get("x-cron-key") !== i.cron_sleutel) throw new Fout(401, "Geen toegang");
    const lijst = await sql`select id, naam, ads_campagne_aan aan, ads_budget_soort soort, ads_dagbudget::float dag, ads_periode_eind eind from beheersite.klanten where ads_campagne is not null`;
    if (!lijst.length) return { ok: true, log: [] };
    const at = await toegang(i), log: string[] = [];
    for (const k of lijst) {
      try {
        await beleid(i, at, k.id, k.naam).catch((e) => console.error("beleid", e));
        if (!k.aan) continue;
        await uitgaven(i, at, k.id);
        const s = await saldo(k.id);
        // vangnet: bij een dagbudget pauzeren als er minder dan 2 dagen over is (Google mag op één dag 2x uitgeven)
        const grens = k.soort === "dag" ? Math.max(0.5, 2 * (k.dag || 0)) : 0.5;
        if (s.over <= grens) {
          await zetStatus(i, at, k.id, false);
          await mailJan(i, `Advertenties gepauzeerd: ${k.naam}, budget op`, `<p>Het advertentiebudget van <b>${esc(k.naam)}</b> is (bijna) op: ${euro(s.uitgegeven)} van ${euro(s.gestort)} gebruikt, ${euro(s.over)} blijft als tegoed staan. De campagne is automatisch gepauzeerd.</p>`);
          log.push(`${k.id}: gepauzeerd`);
        } else if (k.soort === "totaal" && k.eind && new Date(k.eind).getTime() < Date.now() && s.over >= 5) {
          const r = await totaalBijwerken(i, at, k.id, true);
          log.push(`${k.id}: nieuwe periode tot ${r?.eind?.toISOString().slice(0, 10)}`);
        } else log.push(`${k.id}: ${euro(s.over)} over`);
      } catch (e) { console.error(k.id, e); log.push(`${k.id}: ${(e as Error).message}`); }
    }
    return { ok: true, log };
  }
  const g = await gebruikerVan(req);
  if (!g) throw new Fout(401, "Niet ingelogd");
  const kid = g.rol === "admin" && b.klant_id ? String(b.klant_id) : g.klant_id;
  if (!kid) throw new Fout(400, "Geen klant");

  if (a === "saldo") return await saldo(kid);
  if (a === "betaal") {
    const bedrag = r2(Number(b.bedrag));
    if (!isFinite(bedrag) || bedrag < 5 || bedrag > 10000) throw new Fout(400, "Kies een bedrag tussen €5 en €10.000.");
    const btw = r2(bedrag * 0.21), totaal = r2(bedrag + btw);
    const [k] = await sql`select naam from beheersite.klanten where id = ${kid}`;
    const dagen = Math.max(3, Math.min(30, Math.round(Number(b.dagen) || 14)));
    const [t] = await sql`insert into beheersite.ads_tegoed (klant_id, bedrag_excl, btw, totaal, dagen) values (${kid}, ${bedrag}, ${btw}, ${totaal}, ${dagen}) returning id`;
    const terug = (i.platform_url || "https://sitehulpje.nl").replace(/\/$/, "") + "/portaal?betaald=ads#advertenties";
    const p = await mollie("payments", { amount: { currency: "EUR", value: totaal.toFixed(2) }, description: `Advertentiebudget ${k?.naam || kid}`.slice(0, 250),
      redirectUrl: terug, webhookUrl: FN + "?mollie=1", metadata: { soort: "ads_tegoed", tegoed: t.id, klant: kid } });
    await sql`update beheersite.ads_tegoed set mollie_id = ${p.id} where id = ${t.id}`;
    return { url: p._links?.checkout?.href };
  }
  if (g.rol !== "admin") throw new Fout(403, "Geen toegang");
  if (a === "klaarzetten") {
    const [k] = await sql`select ads_klant, ads_campagne from beheersite.klanten where id = ${kid}`;
    if (!k?.ads_klant) throw new Fout(409, "Deze klant heeft geen Google Ads-account.");
    if (k.ads_campagne && !b.toets) throw new Fout(409, "Er staat al een campagne klaar.");
    const [v] = await sql`select data, keuzes, status from beheersite.ads_voorstellen where klant_id = ${kid} and status in ('akkoord','concept') order by (status = 'akkoord') desc, gemaakt desc limit 1`;
    if (!v) throw new Fout(404, "Er is nog geen voorstel.");
    const s = await saldo(kid);
    if (!b.toets && s.over < 5) throw new Fout(409, "Er is nog geen tegoed. Laat de klant eerst budget betalen (minimaal €5).");
    const [t] = await sql`select dagen from beheersite.ads_tegoed where klant_id = ${kid} and status = 'betaald' order by betaald_op desc limit 1`;
    const dagen = Math.max(3, Math.min(30, Number(b.dagen) || t?.dagen || 14));
    const bedrag = s.over >= 5 ? s.over : 5, eind = new Date(Date.now() + dagen * 864e5);
    const cid = k.ads_klant.replace(/\D/g, "");
    const at = await toegang(i);
    // eerst een vast totaalbudget (Google gaat daar nooit overheen); lukt dat niet, dan een dagbudget met vangnet
    let o = opbouw(cid, v, { soort: "totaal", bedrag, eind }), soort: "totaal" | "dag" = "totaal", waarom = "";
    try { await gads(i, at, `customers/${cid}/googleAds:mutate`, { mutateOperations: o.ops, validateOnly: true }); }
    catch (e) { waarom = (e as Error).message; soort = "dag"; o = opbouw(cid, v, { soort: "dag", bedrag: Math.max(1, r2(bedrag / dagen)) }); await gads(i, at, `customers/${cid}/googleAds:mutate`, { mutateOperations: o.ops, validateOnly: true }); }
    const uitleg = { budget: soort === "totaal" ? `vast totaal ${euro(bedrag)} t/m ${eind.toLocaleDateString("nl-NL")}` : `dagbudget ${euro(Math.max(1, r2(bedrag / dagen)))} (totaalbudget lukte niet: ${waarom})`,
      zoekwoorden: o.woorden, groepen: o.groepen, koppen: o.koppen, teksten: o.teksten, gebied: o.gebied.soort === "straal" ? `${v.data.adres?.plaats} + ${o.gebied.km || 25} km` : (o.gebied.landen || ["NL"]).join(" + "), tijden: o.tijden, voorstel: v.status, meting: v.data.meting };
    if (b.toets) return { ok: true, toets: true, ...uitleg };
    const d = await gads(i, at, `customers/${cid}/googleAds:mutate`, { mutateOperations: o.ops });
    const camp = (d.mutateOperationResponses || []).map((x: any) => x.campaignResult?.resourceName).find(Boolean);
    await sql`update beheersite.klanten set ads_campagne = ${camp}, ads_campagne_aan = false, ads_campagne_start = current_date, ads_budget_soort = ${soort},
      ads_periode_eind = ${soort === "totaal" ? eind : null}, ads_dagbudget = ${soort === "dag" ? Math.max(1, r2(bedrag / dagen)) : null}, ads_tellen_vanaf = coalesce(ads_tellen_vanaf, current_date) where id = ${kid}`;
    return { ok: true, campagne: camp, ...uitleg };
  }
  if (a === "aanzetten") {
    const s = await saldo(kid);
    if (s.over < 1) throw new Fout(409, "Er is geen tegoed. Laat de klant eerst budget betalen.");
    const at = await toegang(i);
    if (s.soort === "totaal") { await totaalBijwerken(i, at, kid, true); await zetStatus(i, at, kid, true); }
    else { const dag = Number(b.dagbudget) || s.dag || 5; await sql`update beheersite.klanten set ads_dagbudget = ${dag} where id = ${kid}`; await zetStatus(i, at, kid, true, dag); }
    return { ok: true };
  }
  if (a === "pauzeren") { const at = await toegang(i); await zetStatus(i, at, kid, false); return { ok: true }; }
  if (a === "bijwerken") { const at = await toegang(i); await uitgaven(i, at, kid); return await saldo(kid); }
  throw new Fout(400, "Onbekende actie");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fout: "Alleen POST" }, 405);
  const url = new URL(req.url);
  if (url.searchParams.get("mollie")) {
    try { const f = await req.formData(); const id = String(f.get("id") || ""); if (/^tr_\w+$/.test(id)) await webhook(id); } catch (e) { console.error("webhook", e); return new Response("fout", { status: 500 }); }
    return new Response("ok");
  }
  try { return json(await handel(req, await req.json().catch(() => ({})))); }
  catch (e) {
    if (e instanceof Fout) return json({ fout: e.message }, e.code);
    console.error(e);
    return json({ fout: "Er ging iets mis." }, 500);
  }
});
