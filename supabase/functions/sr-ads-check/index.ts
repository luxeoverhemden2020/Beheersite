// Gratis Google Ads-check (Supabase Edge Function "sr-ads-check")
// Een ondernemer koppelt zijn eigen Google Ads-account (alleen voor deze ene check), wij rekenen uit
// waar geld weglekt en trekken de toegang daarna direct weer in. Er wordt niets gewijzigd in Google Ads.
// Geen AI, geen kosten: alleen de Google Ads API (gratis).
// Acties: start (gegevens + Google-link), terug (na Google: analyse), rapport (uitslag tonen).
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
class Fout extends Error { constructor(public code: number, msg: string) { super(msg); } }
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const isoDag = (d: Date) => d.toISOString().slice(0, 10);
const DAGEN = 90;
const SCOPE = "https://www.googleapis.com/auth/adwords";
const RAPPORT_URL = "https://siteregelaar.nl/google-ads-check";
// zoekopdrachten die bijna nooit een klant opleveren
const ONZIN = ["gratis", "vacature", "vacatures", "baan", "banen", "werken bij", "stage", "zelf maken", "zelf doen", "diy", "tweedehands", "2dehands", "marktplaats", "wat is", "betekenis", "definitie", "cursus", "opleiding", "salaris", "wikipedia", "youtube", "huren", "gebruikt", "handleiding", "inloggen", "login", "klantenservice", "retour", "recensie", "review", "ervaringen"];

async function inst() {
  const r = await sql`select sleutel, waarde from beheersite.instellingen`;
  return Object.fromEntries(r.map((x) => [x.sleutel, x.waarde])) as Record<string, string>;
}
async function hmac(geheim: string, tekst: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(geheim), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(tekst))));
}
const terugUrl = (i: Record<string, string>) => (i.platform_url || "https://sitehulpje.nl").replace(/\/$/, "") + "/google-terug";
const versie = (i: Record<string, string>) => i.ads_api_versie || "v22";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);

// ---------- Google Ads (met het token van de ondernemer zelf) ----------
function kop(i: Record<string, string>, at: string, login?: string) {
  const h: Record<string, string> = { Authorization: `Bearer ${at}`, "Content-Type": "application/json" };
  if (i.ads_developer_token) h["developer-token"] = i.ads_developer_token;
  if (login) h["login-customer-id"] = login;
  return h;
}
async function zoek(i: Record<string, string>, at: string, klant: string, query: string, login?: string) {
  const rijen: any[] = []; let pageToken: string | undefined;
  for (let n = 0; n < 20; n++) {
    const r = await fetch(`https://googleads.googleapis.com/${versie(i)}/customers/${klant}/googleAds:search`, { method: "POST", headers: kop(i, at, login),
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }), signal: AbortSignal.timeout(60000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const det = d?.error?.details?.[0]?.errors?.[0];
      throw new Error(`Google Ads ${r.status}: ${det?.message || d?.error?.message || ""}`.slice(0, 300));
    }
    rijen.push(...(d.results || []));
    pageToken = d.nextPageToken; if (!pageToken) break;
  }
  return rijen;
}
const m = (x: any) => ({ kosten: Number(x?.costMicros || 0) / 1e6, klikken: Number(x?.clicks || 0), conversies: Number(x?.conversions || 0), waarde: Number(x?.conversionsValue || 0) });
const veilig = async <T>(f: () => Promise<T>, anders: T): Promise<T> => { try { return await f(); } catch (e) { console.error("deelvraag", (e as Error).message); return anders; } };

// alle adverteerders-accounts waar deze persoon bij kan (ook onder een beheerdersaccount)
async function accounts(i: Record<string, string>, at: string) {
  const r = await fetch(`https://googleads.googleapis.com/${versie(i)}/customers:listAccessibleCustomers`, { headers: kop(i, at), signal: AbortSignal.timeout(30000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = String(d?.error?.message || "");
    if (/not.*enabled|NOT_ADS_USER|USER_PERMISSION_DENIED/i.test(JSON.stringify(d))) throw new Fout(404, "Bij dit Google-account hoort geen Google Ads-account. Probeer het met het Google-account waarmee je adverteert.");
    throw new Error("Google Ads gaf een fout: " + msg.slice(0, 200));
  }
  const ids: string[] = (d.resourceNames || []).map((x: string) => x.split("/")[1]).slice(0, 10);
  const lijst = new Map<string, { id: string; naam: string; valuta: string; login?: string }>();
  for (const id of ids) {
    const c = await veilig(() => zoek(i, at, id, "SELECT customer.id, customer.descriptive_name, customer.manager, customer.currency_code, customer.status FROM customer"), []);
    const k = c[0]?.customer; if (!k) continue;
    if (!k.manager) { if (k.status === "ENABLED" || !k.status) lijst.set(id, { id, naam: k.descriptiveName || id, valuta: k.currencyCode || "EUR" }); continue; }
    const kids = await veilig(() => zoek(i, at, id, "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code FROM customer_client WHERE customer_client.manager = FALSE AND customer_client.status = 'ENABLED' AND customer_client.level <= 2 LIMIT 25", id), []);
    for (const x of kids) { const cid = String(x.customerClient.id); if (!lijst.has(cid)) lijst.set(cid, { id: cid, naam: x.customerClient.descriptiveName || cid, valuta: x.customerClient.currencyCode || "EUR", login: id }); }
  }
  return [...lijst.values()].slice(0, 25);
}

async function analyse(i: Record<string, string>, at: string, acc: { id: string; naam: string; valuta: string; login?: string }) {
  const tot = new Date(); tot.setDate(tot.getDate() - 1); const van = new Date(tot); van.setDate(van.getDate() - (DAGEN - 1));
  const per = `segments.date BETWEEN '${isoDag(van)}' AND '${isoDag(tot)}'`;
  const q = (s: string) => zoek(i, at, acc.id, s, acc.login);
  const [t] = await q(`SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM customer WHERE ${per}`);
  const totaal = m(t?.metrics);
  const uit = { account: acc.naam, valuta: acc.valuta, dagen: DAGEN, van: isoDag(van), tot: isoDag(tot), totaal, verspild: 0, perMaand: 0, metingWerkt: true, bevindingen: [] as any[], goed: [] as string[] };
  if (totaal.kosten < 1) { uit.bevindingen.push({ soort: "leeg", titel: "Er liepen geen advertenties", tekst: `In de afgelopen ${DAGEN} dagen is er in dit account niets uitgegeven. Er valt dus (nog) niets te besparen.` }); return uit; }

  // conversiemeting
  const acties = await veilig(() => q("SELECT conversion_action.id FROM conversion_action WHERE conversion_action.status = 'ENABLED'"), [] as any[]);
  if (!acties.length || totaal.conversies === 0) {
    uit.metingWerkt = false;
    uit.bevindingen.push({ soort: "meting", titel: "Je ziet niet wat je advertenties opleveren", bedrag: totaal.kosten,
      tekst: !acties.length ? `Er staat geen meting aan voor verkopen of aanvragen. Google weet dus niet welke klikken klant worden, en kan daar ook niet slim op sturen. Je gaf ${geld(totaal.kosten, acc.valuta)} uit zonder te kunnen zien wat het opleverde.`
        : `Er staat wel een meting, maar die telde in ${DAGEN} dagen geen enkele verkoop of aanvraag. Vaak werkt de meting niet goed. Zonder werkende meting stuurt Google in het blinde.` });
  }

  // zoekopdrachten die geld kosten zonder resultaat
  const termen = await veilig(() => q(`SELECT search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.conversions_value FROM search_term_view WHERE ${per} AND metrics.cost_micros > 0`), [] as any[]);
  const tm = new Map<string, any>();
  for (const r of termen) { const s = r.searchTermView?.searchTerm; if (!s) continue; const a = tm.get(s) || { kosten: 0, klikken: 0, conversies: 0 }; const x = m(r.metrics); a.kosten += x.kosten; a.klikken += x.klikken; a.conversies += x.conversies; tm.set(s, a); }
  const cpa = totaal.conversies > 0 ? totaal.kosten / totaal.conversies : 0;
  const drempel = Math.max(5, (cpa || 10) * 0.8);
  const gezien = new Set<string>();
  const onzin = [...tm].filter(([s, a]) => a.conversies === 0 && ONZIN.some((w) => (" " + s + " ").includes(" " + w + " "))).sort((a, b) => b[1].kosten - a[1].kosten);
  if (onzin.length) {
    const som = onzin.reduce((s, x) => s + x[1].kosten, 0); onzin.forEach(([s]) => gezien.add(s));
    uit.verspild += som;
    uit.bevindingen.push({ soort: "onzin", titel: "Je betaalt voor zoekopdrachten van mensen die niet kopen", bedrag: som,
      tekst: `${onzin.length} zoekopdracht${onzin.length > 1 ? "en" : ""} met woorden als "gratis", "vacature" of "zelf maken" kostten samen ${geld(som, acc.valuta)}. Die mensen zoeken iets anders dan wat jij verkoopt.`,
      voorbeelden: onzin.slice(0, 5).map(([s, a]) => ({ t: s, k: a.kosten })) });
  }
  if (uit.metingWerkt) {
    const weg = [...tm].filter(([s, a]) => !gezien.has(s) && a.conversies === 0 && (a.kosten >= drempel || a.klikken >= 15)).sort((a, b) => b[1].kosten - a[1].kosten);
    if (weg.length) {
      const som = weg.reduce((s, x) => s + x[1].kosten, 0);
      uit.verspild += som;
      uit.bevindingen.push({ soort: "zoektermen", titel: "Zoekopdrachten die geld kosten maar niets opleveren", bedrag: som,
        tekst: `${weg.length} zoekopdracht${weg.length > 1 ? "en" : ""} kostten samen ${geld(som, acc.valuta)} zonder één verkoop of aanvraag. Die kun je uitsluiten.`,
        voorbeelden: weg.slice(0, 5).map(([s, a]) => ({ t: s, k: a.kosten })) });
    }
  }

  // zoekcampagnes die ook op websites/partners adverteren
  const net = await veilig(() => q(`SELECT campaign.id, segments.ad_network_type, metrics.cost_micros, metrics.conversions FROM campaign WHERE campaign.advertising_channel_type = 'SEARCH' AND ${per}`), [] as any[]);
  let display = 0, displayConv = 0, partner = 0, partnerConv = 0;
  for (const r of net) { const x = m(r.metrics); const n = r.segments?.adNetworkType; if (n === "CONTENT") { display += x.kosten; displayConv += x.conversies; } if (n === "SEARCH_PARTNERS") { partner += x.kosten; partnerConv += x.conversies; } }
  if (display >= 5 && (displayConv === 0 || !uit.metingWerkt)) {
    uit.verspild += display;
    uit.bevindingen.push({ soort: "display", titel: "Je zoekadvertenties staan ook als banner op andere websites", bedrag: display,
      tekst: `Je zoekcampagnes tonen ook banners op allerlei websites en apps. Dat kostte ${geld(display, acc.valuta)}${uit.metingWerkt ? " zonder één verkoop of aanvraag" : ""}. Met één instelling zet je dit uit.` });
  }
  if (partner >= 10 && partnerConv === 0 && uit.metingWerkt) {
    uit.bevindingen.push({ soort: "partners", titel: "Advertenties op zoekmachines van partners leveren niets op", bedrag: partner,
      tekst: `Op zoekpartners van Google (andere zoeksites) ging ${geld(partner, acc.valuta)} zonder resultaat. Dit is vaak de moeite waard om uit te zetten.` });
  }

  // budget verkeerd verdeeld
  let camp = await veilig(() => q(`SELECT campaign.id, campaign.name, campaign.advertising_channel_type, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.search_budget_lost_impression_share FROM campaign WHERE ${per} AND metrics.cost_micros > 0`), [] as any[]);
  if (!camp.length) camp = await veilig(() => q(`SELECT campaign.id, campaign.name, campaign.advertising_channel_type, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE ${per} AND metrics.cost_micros > 0`), [] as any[]);
  const cm = new Map<string, any>();
  for (const r of camp) { const id = String(r.campaign.id); const a = cm.get(id) || { naam: r.campaign.name, kosten: 0, conversies: 0, waarde: 0, verloren: 0 }; const x = m(r.metrics); a.kosten += x.kosten; a.conversies += x.conversies; a.waarde += x.waarde; a.verloren = Math.max(a.verloren, Number(r.metrics?.searchBudgetLostImpressionShare || 0)); cm.set(id, a); }
  const cs = [...cm.values()].filter((c) => c.kosten >= 20);
  if (uit.metingWerkt && cs.length >= 2) {
    const opbr = (c: any) => c.waarde > 0 ? c.waarde / c.kosten : c.conversies / c.kosten;
    const r = cs.sort((a, b) => opbr(b) - opbr(a)); const best = r[0], slecht = r[r.length - 1];
    if (opbr(best) > 0 && opbr(best) >= opbr(slecht) * 2 && slecht.kosten >= totaal.kosten * 0.15) {
      const fmt = (c: any) => c.waarde > 0 ? `${(c.waarde / c.kosten).toFixed(1).replace(".", ",")}× terug per euro` : c.conversies > 0 ? `${geld(c.kosten / c.conversies, acc.valuta)} per aanvraag` : "nog geen resultaat";
      uit.bevindingen.push({ soort: "budget", titel: "Je budget gaat naar de verkeerde campagne", bedrag: null,
        tekst: `"${best.naam}" doet het het best (${fmt(best)})${best.verloren > 0.1 ? ` en mist ${Math.round(best.verloren * 100)}% van de vertoningen omdat het budget op is` : ""}. Tegelijk gaat ${Math.round(slecht.kosten / totaal.kosten * 100)}% van je geld naar "${slecht.naam}" (${fmt(slecht)}).` });
    }
  }

  // kwaliteitsscore
  const kw = await veilig(() => q(`SELECT ad_group_criterion.keyword.text, ad_group_criterion.quality_info.quality_score, metrics.cost_micros FROM keyword_view WHERE ${per} AND ad_group_criterion.status = 'ENABLED' AND metrics.cost_micros > 0`), [] as any[]);
  const laag = new Map<string, number>(); let kwTot = 0;
  for (const r of kw) { const x = m(r.metrics); kwTot += x.kosten; const qs = Number(r.adGroupCriterion?.qualityInfo?.qualityScore || 0); if (qs > 0 && qs <= 4) { const s = r.adGroupCriterion.keyword?.text || "?"; laag.set(s, (laag.get(s) || 0) + x.kosten); } }
  const laagSom = [...laag.values()].reduce((s, x) => s + x, 0);
  if (laagSom >= 10 && laagSom >= kwTot * 0.2) {
    uit.bevindingen.push({ soort: "kwaliteit", titel: "Google vindt een deel van je advertenties matig, en dan betaal je meer per klik", bedrag: laagSom,
      tekst: `Op zoekwoorden met een lage kwaliteitsscore (4 of lager van de 10) ging ${geld(laagSom, acc.valuta)}. Met een betere advertentietekst en een pagina die beter aansluit, wordt elke klik vaak goedkoper.`,
      voorbeelden: [...laag].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, k]) => ({ t, k })) });
  }

  // producten zonder verkoop (Shopping)
  if (uit.metingWerkt) {
    const prod = await veilig(() => q(`SELECT segments.product_title, segments.product_item_id, metrics.cost_micros, metrics.conversions FROM shopping_performance_view WHERE ${per}`), [] as any[]);
    const pm = new Map<string, any>();
    for (const r of prod) { const id = r.segments?.productItemId; if (!id) continue; const a = pm.get(id) || { t: r.segments.productTitle || id, kosten: 0, conversies: 0 }; const x = m(r.metrics); a.kosten += x.kosten; a.conversies += x.conversies; pm.set(id, a); }
    const p = [...pm.values()].filter((a) => a.conversies === 0 && a.kosten >= drempel).sort((a, b) => b.kosten - a.kosten);
    if (p.length) {
      const som = p.reduce((s, x) => s + x.kosten, 0);
      uit.bevindingen.push({ soort: "producten", titel: "Producten die veel kosten maar niet verkopen", bedrag: som,
        tekst: `${p.length} product${p.length > 1 ? "en" : ""} in Google Shopping kostten samen ${geld(som, acc.valuta)} zonder één verkoop. Die kun je minder vaak tonen, zodat het geld naar je bestsellers gaat.`,
        voorbeelden: p.slice(0, 5).map((a) => ({ t: a.t, k: a.kosten })) });
    } else if (pm.size) uit.goed.push("Je Shopping-producten die geld kosten, verkopen ook.");
  }

  // extra's bij advertenties (sitelinks, belknop, ...)
  const as1 = await veilig(() => q("SELECT customer_asset.field_type FROM customer_asset WHERE customer_asset.status = 'ENABLED'"), [] as any[]);
  const as2 = await veilig(() => q("SELECT campaign_asset.field_type FROM campaign_asset WHERE campaign_asset.status = 'ENABLED'"), [] as any[]);
  const soorten = new Set([...as1.map((x) => x.customerAsset?.fieldType), ...as2.map((x) => x.campaignAsset?.fieldType)].filter(Boolean));
  const mist = [["SITELINK", "extra links (sitelinks)"], ["CALLOUT", "korte voordelen (zoals 'gratis verzending')"], ["CALL", "een belknop"], ["STRUCTURED_SNIPPET", "een opsomming van je diensten of merken"], ["AD_IMAGE", "afbeeldingen"]].filter(([s]) => !soorten.has(s)).map(([, n]) => n);
  if (net.length && mist.length >= 2) uit.bevindingen.push({ soort: "extras", titel: "Je advertenties kunnen groter en opvallender", bedrag: null,
    tekst: `Er ontbreken ${mist.join(", ")}. Daarmee neemt je advertentie meer ruimte in, klikken er vaak meer mensen op, en kost dat niets extra.` });
  else if (net.length) uit.goed.push("Je advertenties hebben de belangrijkste extra's (zoals extra links).");

  if (uit.metingWerkt) uit.goed.push("Je meet verkopen of aanvragen, zodat je kunt zien wat het oplevert.");
  if (!display && net.length) uit.goed.push("Je zoekadvertenties staan niet ongewild als banner op andere websites.");
  uit.verspild = Math.round(uit.verspild * 100) / 100;
  uit.perMaand = Math.round(uit.verspild / DAGEN * 30 * 100) / 100;
  // volgorde: eerst de meting, dan het meeste geld
  uit.bevindingen.sort((a, b) => (a.soort === "meting" ? -1 : b.soort === "meting" ? 1 : (b.bedrag || 0) - (a.bedrag || 0)));
  return uit;
}

async function mail(i: Record<string, string>, aan: string, onderwerp: string, html: string) {
  try {
    if (!i.resend_sleutel || !aan) return;
    await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${i.resend_sleutel}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: i.mail_van || "Sitehulpje <info@sitehulpje.nl>", to: [aan], subject: onderwerp, html, reply_to: "info@siteregelaar.nl" }) });
  } catch (e) { console.error("mail", e); }
}
const geld = (n: number, v = "EUR") => { try { return new Intl.NumberFormat("nl-NL", { style: "currency", currency: v, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n); } catch { return "€" + n.toFixed(2); } };

async function handel(req: Request, b: any) {
  const a = b.actie;
  const i = await inst();
  if (a === "start") {
    if (b.website2) return { url: RAPPORT_URL }; // bot-val
    const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Fout(400, "Vul een geldig e-mailadres in.");
    const naam = String(b.naam || "").trim().slice(0, 120), bedrijf = String(b.bedrijf || "").trim().slice(0, 120);
    const ip = (req.headers.get("x-forwarded-for") || "?").split(",")[0].trim();
    const [n] = await sql`select count(*)::int n from beheersite.ads_checks where (ip = ${ip} or email = ${email}) and aangemaakt > now() - interval '1 day'`;
    if (n.n >= 5) throw new Fout(429, "Je hebt vandaag al een paar checks gedaan. Probeer het morgen opnieuw, of neem contact met ons op.");
    const token = b64u(crypto.getRandomValues(new Uint8Array(18)));
    const [r] = await sql`insert into beheersite.ads_checks (token, naam, bedrijf, email, ip) values (${token}, ${naam || null}, ${bedrijf || null}, ${email}, ${ip}) returning id`;
    const data = b64u(new TextEncoder().encode(JSON.stringify({ t: Date.now(), c: r.id })));
    const state = "adscheck." + data + "." + await hmac(i.geheim || "", data);
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({ client_id: i.google_client_id || "", redirect_uri: terugUrl(i), response_type: "code", scope: SCOPE, access_type: "online", prompt: "select_account consent", include_granted_scopes: "false", state, login_hint: email }).toString();
    return { url: u.toString() };
  }
  if (a === "terug") {
    const st = String(b.state || ""), [, data, sig] = st.split(".");
    if (!data || !sig || sig !== await hmac(i.geheim || "", data)) throw new Fout(400, "Ongeldige koppeling. Start de check opnieuw.");
    const p = JSON.parse(atob(data.replace(/-/g, "+").replace(/_/g, "/")));
    if (Date.now() - p.t > 30 * 60 * 1000) throw new Fout(400, "Dat duurde te lang. Start de check opnieuw.");
    const [c] = await sql`select id, token, status, naam, bedrijf, email from beheersite.ads_checks where id = ${p.c}`;
    if (!c) throw new Fout(404, "Check niet gevonden. Start opnieuw.");
    if (c.status === "klaar") return { token: c.token };
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: String(b.code || ""), client_id: i.google_client_id || "", client_secret: CLIENT_SECRET, redirect_uri: terugUrl(i), grant_type: "authorization_code" }) });
    const d = await r.json();
    if (!r.ok || !d.access_token) throw new Fout(400, "Google gaf geen toestemming terug. Start de check opnieuw.");
    const at = d.access_token as string;
    try {
      if (!String(d.scope || "").includes(SCOPE)) throw new Fout(400, "Je hebt geen toestemming voor Google Ads aangevinkt. Start opnieuw en vink het aan.");
      const lijst = await accounts(i, at);
      if (!lijst.length) throw new Fout(404, "We vonden geen actief Google Ads-account bij dit Google-account. Probeer het met het account waarmee je adverteert.");
      // kies het account met de meeste uitgaven
      const tot = new Date(); const van = new Date(tot); van.setDate(van.getDate() - DAGEN);
      const metKosten = [];
      for (const acc of lijst) {
        const [x] = await veilig(() => zoek(i, at, acc.id, `SELECT metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${isoDag(van)}' AND '${isoDag(tot)}'`, acc.login), [] as any[]);
        metKosten.push({ ...acc, kosten: m(x?.metrics).kosten });
      }
      metKosten.sort((x, y) => y.kosten - x.kosten);
      const uit: any = await analyse(i, at, metKosten[0]);
      uit.andere = metKosten.slice(1, 6).filter((x) => x.kosten > 0).map((x) => ({ naam: x.naam, kosten: x.kosten, valuta: x.valuta }));
      await sql`update beheersite.ads_checks set status = 'klaar', fout = null, account_naam = ${uit.account}, verspild_eur = ${uit.verspild}, uitslag = ${sql.json(uit)}, klaar_op = now() where id = ${c.id}`;
      const link = `${RAPPORT_URL}?r=${c.token}`;
      await mail(i, c.email, "Je gratis Google Ads-check is klaar",
        `<p>Hoi${c.naam ? " " + esc(c.naam.split(" ")[0]) : ""},</p><p>Je Google Ads-check voor <b>${esc(uit.account)}</b> is klaar.${uit.verspild > 0 ? ` In de afgelopen ${DAGEN} dagen ging er ongeveer <b>${geld(uit.verspild, uit.valuta)}</b> naar klikken die niets opleverden.` : ""}</p><p><a href="${link}">Bekijk je rapport</a></p><p>Vragen? Antwoord gewoon op deze mail, of bel 06 27 25 43 83.</p><p>Groet,<br>Jan · Siteregelaar</p>`);
      await mail(i, i.jan_email, `Nieuwe Google Ads-check: ${c.bedrijf || uit.account}${uit.verspild > 0 ? " · " + geld(uit.verspild, uit.valuta) + " verspild" : ""}`,
        `<p>Er is een gratis Google Ads-check gedaan.</p><ul><li>Naam: ${esc(c.naam || "-")}</li><li>Bedrijf: ${esc(c.bedrijf || "-")}</li><li>E-mail: ${esc(c.email)}</li><li>Account: ${esc(uit.account)}</li><li>Uitgegeven (${DAGEN} dagen): ${geld(uit.totaal.kosten, uit.valuta)}</li><li>Verspild: ${geld(uit.verspild, uit.valuta)} (± ${geld(uit.perMaand, uit.valuta)} per maand)</li><li>Meting werkt: ${uit.metingWerkt ? "ja" : "nee"}</li></ul><p><a href="${link}">Rapport bekijken</a></p>`);
      return { token: c.token };
    } catch (e) {
      const f = e instanceof Fout ? e.message : "De check lukte niet. Probeer het later opnieuw of neem contact met ons op.";
      await sql`update beheersite.ads_checks set status = 'fout', fout = ${String((e as Error).message).slice(0, 300)} where id = ${c.id}`;
      throw e instanceof Fout ? e : new Fout(500, f);
    } finally {
      // toegang direct weer intrekken: wij bewaren niets van de koppeling
      await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: at }) }).catch(() => {});
    }
  }
  if (a === "rapport") {
    const t = String(b.token || "");
    const [c] = await sql`select status, uitslag, klaar_op, gezien from beheersite.ads_checks where token = ${t} and aangemaakt > now() - interval '120 days'`;
    if (!c || c.status !== "klaar") throw new Fout(404, "Dit rapport bestaat niet (meer).");
    if (!c.gezien) await sql`update beheersite.ads_checks set gezien = now() where token = ${t}`;
    return { uitslag: c.uitslag, klaar_op: c.klaar_op };
  }
  throw new Fout(400, "Onbekende actie");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fout: "Alleen POST" }, 405);
  try { return json(await handel(req, await req.json().catch(() => ({})))); }
  catch (e) {
    if (e instanceof Fout) return json({ fout: e.message }, e.code);
    console.error(e);
    return json({ fout: "Er ging iets mis. Probeer het later opnieuw." }, 500);
  }
});
