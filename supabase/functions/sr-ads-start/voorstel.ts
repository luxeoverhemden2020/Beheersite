// Automatisch advertentievoorstel: teksten eenmalig met AI (Haiku, een paar cent), anders sjabloon zonder AI.
// Bronnen: Search Console-zoekwoorden (Vindbaarheid), Google Ads zoekwoordplanner (zoekvolume + klikprijs),
// de eigen landingspagina (titel + omschrijving als voorbeeld) en de Merchant Center-koppeling (Shopping).
// Zet NIETS aan in Google Ads.
// deno-lint-ignore-file no-explicit-any
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

async function adsInst(sql: any) {
  const r = await sql`select sleutel, waarde from beheersite.instellingen where sleutel in ('ads_token_id','google_client_id','ads_developer_token','ads_manager','ads_api_versie')`;
  return Object.fromEntries(r.map((x: any) => [x.sleutel, x.waarde])) as Record<string, string>;
}
async function adsToegang(sql: any, i: Record<string, string>) {
  if (!i.ads_token_id) return null;
  const [{ t }] = await sql`select beheersite.vb_token_lezen(${i.ads_token_id}::uuid) t`;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: i.google_client_id || "", client_secret: CLIENT_SECRET, grant_type: "refresh_token", refresh_token: t }) });
  const d = await r.json(); return r.ok ? d.access_token as string : null;
}
function adsKop(i: Record<string, string>, at: string) {
  const h: Record<string, string> = { Authorization: `Bearer ${at}`, "Content-Type": "application/json", "login-customer-id": (i.ads_manager || "3429828197").replace(/\D/g, "") };
  if (i.ads_developer_token) h["developer-token"] = i.ads_developer_token;
  return h;
}
const V = (i: Record<string, string>) => i.ads_api_versie || "v22";

async function zoekwoordCijfers(i: Record<string, string>, at: string, cid: string, woorden: string[]) {
  const r = await fetch(`https://googleads.googleapis.com/${V(i)}/customers/${cid}:generateKeywordHistoricalMetrics`, { method: "POST", headers: adsKop(i, at),
    body: JSON.stringify({ keywords: woorden, language: "languageConstants/1010", geoTargetConstants: ["geoTargetConstants/2528"], keywordPlanNetwork: "GOOGLE_SEARCH" }), signal: AbortSignal.timeout(30000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Zoekwoordplanner ${r.status}: ${d?.error?.message || ""}`.slice(0, 300));
  const uit = new Map<string, { volume: number; laag: number; hoog: number }>();
  for (const x of d.results || []) {
    const m = x.keywordMetrics || {};
    const v = { volume: Number(m.avgMonthlySearches || 0), laag: Number(m.lowTopOfPageBidMicros || 0) / 1e6, hoog: Number(m.highTopOfPageBidMicros || 0) / 1e6 };
    for (const t of [x.text, ...(x.closeVariants || [])]) if (t) uit.set(String(t).toLowerCase(), v);
  }
  return uit;
}
async function merchant(i: Record<string, string>, at: string, cid: string) {
  const r = await fetch(`https://googleads.googleapis.com/${V(i)}/customers/${cid}/googleAds:search`, { method: "POST", headers: adsKop(i, at),
    body: JSON.stringify({ query: "SELECT product_link.product_link_id, product_link.merchant_center.merchant_center_id FROM product_link" }), signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { gekoppeld: null };
  const mc = (d.results || []).map((x: any) => x.productLink?.merchantCenter?.merchantCenterId).filter(Boolean);
  return { gekoppeld: mc.length > 0, merchant_id: mc[0] ? String(mc[0]) : null };
}
async function pagina(url: string) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Sitehulpje/1.0)" }, signal: AbortSignal.timeout(10000) });
    const h = (await r.text()).slice(0, 300000);
    const ont = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
    const titel = ont((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const tekst = ont((h.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || h.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) || [])[1] || "");
    return { titel: titel.slice(0, 90), tekst: tekst.slice(0, 180) };
  } catch { return { titel: "", tekst: "" }; }
}


// ---------- landingspagina per zoekwoord (uit de sitemap van de site) ----------
const stam2 = (w: string) => w.toLowerCase().replace(/[^a-z0-9à-ÿ]/g, "").replace(/(en|s)$/, "");
async function sitemapUrls(site: string) {
  const urls: string[] = [];
  const haal = async (u: string) => { try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Sitehulpje/1.0)" }, signal: AbortSignal.timeout(10000) }); return r.ok ? (await r.text()).slice(0, 3_000_000) : ""; } catch { return ""; } };
  let x = await haal(site + "/sitemap.xml");
  if (!x) x = await haal(site + "/pub/sitemap.xml");
  const locs = (t: string) => [...t.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  if (/<sitemapindex/i.test(x)) { for (const sub of locs(x).slice(0, 4)) urls.push(...locs(await haal(sub))); }
  else urls.push(...locs(x));
  return urls.slice(0, 20000);
}
function bestePagina(term: string, urls: string[], standaard: string) {
  const ALG = new Set(["heer", "her", "dame", "voor", "kop", "online", "goedkop", "beste", "mooi", "mooist", "luxe", "nieuw", "man", "mann", "vrouw"]);
  const w = term.split(/\s+/).map(stam2).filter((x) => x.length >= 3 && !ALG.has(x));
  if (!w.length) return standaard;
  let best = "", bestLen = 1e9;
  for (const u of urls) {
    let pad = ""; try { pad = new URL(u).pathname.toLowerCase(); } catch { continue; }
    if (pad.length <= 1 || /\.(jpg|png|pdf)$/.test(pad)) continue;
    const delen = pad.split(/[\/\-_.]+/).map(stam2).filter(Boolean);
    if (w.every((x) => delen.some((d) => d === x || d.startsWith(x))) && pad.length < bestLen) { best = u; bestLen = pad.length; }
  }
  if (!best) return standaard;
  try { const u = new URL(best), s = new URL(standaard); u.host = s.host; u.protocol = s.protocol; return u.toString(); } catch { return best; }
}
// ---------- openingstijden ("ma 13:00–18:00, di–vr 10:30–18:00") -> advertentietijden ----------
const DAGEN = ["ma", "di", "wo", "do", "vr", "za", "zo"], GDAG = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
export function leesTijden(t: string) {
  const uit: { dag: string; van: string; tot: string }[] = [];
  for (const m of String(t || "").toLowerCase().matchAll(/\b(ma|di|wo|do|vr|za|zo)(?:\s*[–-]\s*(ma|di|wo|do|vr|za|zo))?[a-z]*\.?\s*:?\s*(\d{1,2})[:.](\d{2})\s*[–-]\s*(\d{1,2})[:.](\d{2})/g)) {
    const a = DAGEN.indexOf(m[1]), b = m[2] ? DAGEN.indexOf(m[2]) : a;
    for (let d = a; d <= b; d++) uit.push({ dag: GDAG[d], van: `${m[3].padStart(2, "0")}:${m[4]}`, tot: `${m[5].padStart(2, "0")}:${m[6]}` });
  }
  return uit;
}
async function meting(i: Record<string, string>, at: string, cid: string) {
  const r = await fetch(`https://googleads.googleapis.com/${V(i)}/customers/${cid}/googleAds:search`, { method: "POST", headers: adsKop(i, at),
    body: JSON.stringify({ query: "SELECT conversion_action.name, conversion_action.category, conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.status = 'ENABLED'" }), signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { bekend: false, aantal: 0, namen: [] as string[] };
  const ECHT = ["PURCHASE", "SUBMIT_LEAD_FORM", "PHONE_CALL_LEAD", "CONTACT", "REQUEST_QUOTE", "BOOK_APPOINTMENT", "QUALIFIED_LEAD", "CONVERTED_LEAD", "IMPORTED_LEAD", "STORE_VISIT", "STORE_SALE", "GET_DIRECTIONS", "SIGNUP"];
  const lijst = (d.results || []).filter((x: any) => x.conversionAction?.primaryForGoal !== false && ECHT.includes(x.conversionAction?.category));
  return { bekend: true, aantal: lijst.length, namen: lijst.map((x: any) => x.conversionAction.name).slice(0, 5) };
}

// Advertentieteksten zonder AI: uit de eigen paginatitel, omschrijving en zoekwoorden. Max 30 tekens per kop, 90 per omschrijving.
const hoofd = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const pas = (t: string, n: number) => { t = t.replace(/\s+/g, " ").trim(); if (t.length <= n) return t; const k = t.slice(0, n + 1); const i = Math.max(k.lastIndexOf(". "), k.lastIndexOf(", "), k.lastIndexOf(" ")); return k.slice(0, i > n * 0.5 ? i : n).replace(/[ ,.;:–-]+$/, ""); };
function maakAdvertenties(naam: string, woorden: string[], titel: string, tekst: string, webshop: boolean, plaats = "") {
  const n = pas(naam, 30), cta = webshop ? "Bekijk de collectie" : "Neem vandaag contact op", cta2 = webshop ? "Bestel eenvoudig online" : "Vraag vrijblijvend advies";
  const delen = titel.split(/\s[|–-]\s/).map((x) => x.trim()).filter((x) => x && x.length <= 30 && x.toLowerCase() !== naam.toLowerCase());
  const zinnen = tekst.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const kw = woorden.map((w) => pas(hoofd(w), 30)).filter((w) => w.length >= 4);
  // vangnet zonder zoekwoorden: stukken uit de paginatitel, plaats en vaste zinnen (nooit "naam bij naam")
  const reserve = [...delen, plaats ? pas(`Actief in ${plaats}`, 30) : "", webshop ? "Snel in huis" : "Vakkundig en betrouwbaar", webshop ? "Veilig online betalen" : "Gratis offerte", cta2, cta].filter(Boolean);
  const bron = kw.length ? kw : reserve;
  const k = (i: number) => bron[i % bron.length] || n;
  const heel = (lijst: string[]) => { let u = ""; for (const z of lijst) { if ((u ? u + " " + z : z).length > 90) break; u = u ? u + " " + z : z; } return u || pas(lijst[0] || "", 90); };
  const zin = (i: number) => woorden[i] || woorden[0] ? pas(`${hoofd(woorden[i] || woorden[0])} door ${naam}${plaats ? " in " + plaats : ""}. ${cta}.`, 90)
    : pas(`${naam}${plaats ? " in " + plaats : ""}. ${webshop ? "Bekijk het aanbod online." : "Vakkundig werk, eerlijke prijs."} ${cta}.`, 90);
  const oms = (i: number) => zinnen[i] ? heel(zinnen.slice(i)) : zin(i);
  const set = [
    { koppen: [k(0), n, cta], tekst: oms(0) },
    { koppen: [k(1), delen[0] || cta2, n], tekst: oms(1) },
    { koppen: [n, k(2), cta2], tekst: zin(2) },
    { koppen: [k(3), cta, delen[1] || n], tekst: pas(titel ? `${titel.replace(/\s[|–-]\s/g, ". ")}. ${cta2}.` : oms(0), 90) },
  ];
  return set.map((a) => {
    const koppen = [...new Set(a.koppen.map((x) => pas(x, 30)))];
    for (const x of [...reserve, n]) { if (koppen.length >= 3) break; const p = pas(x, 30); if (!koppen.includes(p)) koppen.push(p); }
    return { koppen: koppen.slice(0, 3), tekst: a.tekst };
  });
}

// ---------- advertentieteksten met AI (Haiku): eenmalig per voorstel, een paar cent ----------
async function homepageTekst(url: string) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Sitehulpje/1.0)" }, signal: AbortSignal.timeout(10000) });
    const h = (await r.text()).slice(0, 400000);
    return h.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 5000);
  } catch { return ""; }
}
// omschrijving nooit midden in een zin afkappen: alleen hele zinnen die samen binnen de grens passen
function heleZinnen(t: string, n: number) {
  t = t.replace(/\s+/g, " ").trim(); if (t.length <= n) return t;
  let u = ""; for (const z of t.split(/(?<=[.!?])\s+/)) { if ((u ? u + " " + z : z).length > n) break; u = u ? u + " " + z : z; }
  return u;
}
async function aiAdvertenties(sql: any, klantId: string, d: { naam: string; site: string; titel: string; tekst: string; woorden: string[]; webshop: boolean; plaats: string }) {
  const [s] = await sql`select waarde from beheersite.instellingen where sleutel = 'anthropic_sleutel'`;
  if (!s?.waarde) return null;
  const inhoud = await homepageTekst(d.site + "/");
  if (!inhoud && !d.tekst) return null;
  const model = "claude-haiku-5-5";
  const vraag = `Bedrijf: ${d.naam}\nWebsite: ${d.site}\nSoort: ${d.webshop ? "webshop" : "dienstverlener / lokaal bedrijf"}${d.plaats ? `\nPlaats: ${d.plaats}` : ""}
Paginatitel: ${d.titel}\nOmschrijving: ${d.tekst}${d.woorden.length ? `\nZoekwoorden waarop ze al gevonden worden: ${d.woorden.slice(0, 12).join(", ")}` : ""}
Tekst van de homepage:\n${inhoud}

Schrijf 4 verschillende Google-zoekadvertenties in het Nederlands die klanten opleveren.
- Per advertentie 3 koppen van MAXIMAAL 30 tekens en 1 omschrijving van MAXIMAAL 85 tekens, als volledige zin(nen) (tel goed!).
- Gewone Nederlandse schrijfwijze: alleen een hoofdletter aan het begin en bij namen (dus "Dak reinigen in Twente", niet "Dak Reinigen In Twente").
- Koppen bevatten waar mensen echt op zoeken (de dienst of het product, liefst met plaats/regio), concrete voordelen of een duidelijke actie. Hooguit één kop per advertentie met de bedrijfsnaam.
- Elke advertentie een eigen invalshoek (bijv. dienst + plaats, voordeel, vertrouwen, actie).
- Verzin niets: alleen wat uit de tekst blijkt (geen prijzen, kortingen of garanties die er niet staan).
- Geen uitroeptekens in koppen, geen hoofdletters-schreeuwen.
Geef ook: "zoekwoorden" = 10 zoektermen (2 tot 4 woorden, kleine letters) waarop deze klanten in Google zoeken, met plaats/regio waar dat past; "plaats" = de plaats of regio waar het bedrijf werkt (leeg als onbekend of landelijk) en "lokaal" = true als het bedrijf vooral in een regio werkt.
Antwoord alleen met JSON: {"advertenties":[{"koppen":["","",""],"tekst":""}],"zoekwoorden":[""],"plaats":"","lokaal":true}`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": s.waarde, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 2000, thinking: { type: "disabled" }, system: "Je bent een ervaren Google Ads-tekstschrijver voor Nederlandse mkb-bedrijven. Antwoord alleen met JSON.", messages: [{ role: "user", content: vraag }] }),
      signal: AbortSignal.timeout(45000) });
    const j = await r.json();
    if (!r.ok) { console.error("ai ads", r.status, JSON.stringify(j).slice(0, 300)); return null; }
    const u = j.usage || {}, inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    await sql`insert into beheersite.vb_ai_kosten (klant_id, model, invoer, uitvoer, usd, wat) values (${klantId}, ${model}, ${inTok}, ${u.output_tokens || 0}, ${(inTok * 0.10 + (u.output_tokens || 0) * 0.50) / 1e6}, 'ads-voorstel')`;
    const t = (j.content || []).filter((x: any) => x.type === "text").map((x: any) => x.text).join("");
    const m = t.match(/\{[\s\S]*\}/); if (!m) { console.error("ai ads geen json", j.stop_reason); return null; }
    const o = JSON.parse(m[0]);
    const ads = (o.advertenties || []).map((a: any) => ({
      koppen: [...new Set((a.koppen || []).map((x: any) => String(x || "").replace(/\s+/g, " ").trim()).filter((x: string) => x && x.length <= 30))].slice(0, 3) as string[],
      tekst: heleZinnen(String(a.tekst || ""), 90),
    })).filter((a: any) => a.koppen.length >= 2 && a.tekst.length >= 20).slice(0, 4);
    if (ads.length < 2) return null;
    const zw = [...new Set((o.zoekwoorden || []).map((x: any) => String(x || "").toLowerCase().replace(/[^a-z0-9à-ÿ\s-]/g, "").replace(/\s+/g, " ").trim()).filter((x: string) => x.length >= 4 && x.split(" ").length <= 5))].slice(0, 10) as string[];
    return { ads, zoekwoorden: zw, plaats: String(o.plaats || "").trim().slice(0, 40), lokaal: o.lokaal !== false };
  } catch (e) { console.error("ai ads", e); return null; }
}

export async function maakVoorstel(sql: any, klantId: string) {
  const [k] = await sql`select id, naam, site, soort, ads_klant from beheersite.klanten where id = ${klantId}`;
  if (!k) throw new Error("Klant niet gevonden");
  const site = String(k.site || "").replace(/\/$/, "");
  const stam = site.replace(/^https?:\/\/(www\.)?/, "").split(".")[0].toLowerCase();
  // 1. zoekwoorden uit Search Console
  const rij = await sql`select lower(zoekwoord) term, max(vertoningen)::int vertoningen, avg(positie)::float positie, max(pagina) pagina from (
      select zoekwoord, vertoningen, positie, pagina from beheersite.vb_gsc_kansen where klant_id = ${klantId}
      union all select sleutel, vertoningen, positie, null from beheersite.vb_gsc_top where klant_id = ${klantId} and soort = 'zoekwoord') x
    group by 1 order by 2 desc limit 80`;
  const kandidaten = rij.filter((x: any) => x.vertoningen >= 15 && x.positie > 2.5 && !x.term.includes("?") && x.term.split(/\s+/).length <= 5
    && !x.term.includes(".nl") && x.term.replace(/\s+/g, "") !== stam).slice(0, 20);
  // 2. cijfers uit Google Ads
  let cijfers = new Map<string, { volume: number; laag: number; hoog: number }>(), bron = "schatting", shopping: any = { gekoppeld: null }, meet: any = { bekend: false, aantal: 0, namen: [] };
  const i = await adsInst(sql), at = await adsToegang(sql, i).catch(() => null);
  const cid = String(k.ads_klant || "").replace(/\D/g, "");
  if (at && cid) {
    try { if (kandidaten.length) { cijfers = await zoekwoordCijfers(i, at, cid, kandidaten.map((x: any) => x.term)); bron = "google"; } } catch (e) { console.error(e); }
    shopping = await merchant(i, at, cid).catch(() => ({ gekoppeld: null }));
    meet = await meting(i, at, cid).catch(() => meet);
  }
  const zoekwoorden = kandidaten.map((x: any) => {
    const c = cijfers.get(x.term);
    const cpc = c && (c.laag || c.hoog) ? Math.round(((c.laag + (c.hoog || c.laag)) / 2) * 100) / 100 : null;
    return { term: x.term, volume: c ? c.volume : null, cpc, positie: Math.round(x.positie * 10) / 10, vertoningen: x.vertoningen, pagina: x.pagina || site + "/" };
  }).filter((z: any) => bron !== "google" || (z.volume ?? 0) >= 10)
    .sort((a: any, b: any) => (b.volume ?? b.vertoningen) - (a.volume ?? a.vertoningen)).slice(0, 12);
  // landingspagina per zoekwoord
  const urls = await sitemapUrls(site).catch(() => []);
  for (const z of zoekwoorden) z.pagina = bestePagina(z.term, urls, site + "/");
  // 3. budgetadvies
  const metPrijs = zoekwoorden.filter((z: any) => z.cpc), cpcGem = metPrijs.length ? metPrijs.reduce((s: number, z: any) => s + z.cpc, 0) / metPrijs.length : 0.6;
  // advies: genoeg voor ongeveer 150 klikken per maand (zo'n 5 per dag) om mee te starten
  const advies = [100, 250, 500, 1000].find((b) => b >= 150 * cpcGem * 0.8) || 1000;
  // 4. voorbeeld uit de eigen pagina
  const doelUrl = zoekwoorden[0]?.pagina || site + "/";
  const p = await pagina(doelUrl);
  const [o] = await sql`select gegevens->'bedrijf' b from beheersite.vb_onboarding where klant_id = ${klantId}`;
  const bedrijf = o?.b || {};
  const webshop = ["magento", "shopify", "woocommerce", "lightspeed"].includes(String(k.soort || "").toLowerCase());
  const woordLijst = [...zoekwoorden].sort((a: any, b: any) => b.vertoningen - a.vertoningen).map((z: any) => z.term);
  // teksten: eerst AI (eenmalig, een paar cent), anders het gratis vangnet
  const ai = await aiAdvertenties(sql, klantId, { naam: String(k.naam || ""), site, titel: p.titel, tekst: p.tekst, woorden: woordLijst, webshop, plaats: bedrijf.plaats || "" });
  const plaats = bedrijf.plaats || ai?.plaats || "";
  const advertenties = ai?.ads?.length ? ai.ads.map((a: any) => {
      const reserve = maakAdvertenties(String(k.naam || ""), woordLijst, p.titel, p.tekst, webshop, plaats)[0].koppen;
      const koppen = [...a.koppen]; for (const x of reserve) { if (koppen.length >= 3) break; if (!koppen.includes(x)) koppen.push(x); }
      return { koppen, tekst: a.tekst };
    })
    : maakAdvertenties(String(k.naam || ""), woordLijst, p.titel, p.tekst, webshop, plaats);
  // geen zoekwoorden uit Search Console: de door AI voorgestelde zoekwoorden gebruiken
  if (!zoekwoorden.length && ai?.zoekwoorden?.length)
    for (const t of ai.zoekwoorden) zoekwoorden.push({ term: t, volume: null, cpc: null, positie: null, vertoningen: 0, pagina: bestePagina(t, urls, site + "/"), voorgesteld: true });
  const lokaal = !webshop && (!!bedrijf.plaats || (!!ai?.plaats && ai.lokaal));
  return {
    gemaakt: new Date().toISOString(), site, naam: k.naam, webshop, doel: webshop ? "kopen" : "bellen",
    zoekwoorden, bron, cpc_gem: Math.round(cpcGem * 100) / 100, advies,
    advertenties, teksten_door: ai ? "ai" : "sjabloon",
    voorbeeld: { url: doelUrl, weergave: doelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\//g, " › "), titel: p.titel || k.naam, tekst: p.tekst },
    shopping: webshop ? shopping : { gekoppeld: null, nvt: true },
    meting: meet,
    gebied: lokaal ? { soort: "straal", km: 25 } : { soort: "land", landen: ["NL"] },
    adres: { straat: bedrijf.straat || "", postcode: bedrijf.postcode || "", plaats },
    tijden: leesTijden(bedrijf.openingstijden || ""), openingstijden: bedrijf.openingstijden || "",
  };
}
