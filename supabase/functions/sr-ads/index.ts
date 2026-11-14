// Advertenties (Supabase Edge Function "sr-ads")
// - Koppeling met Google Ads via het beheerdersaccount Siteregelaar (één toestemming van Jan, geldt voor alle gekoppelde klantaccounts)
// - Elke nacht: cijfers per campagne per dag, zoekopdrachten en producten (laatste 30 dagen)
//   + aanbevelingen van Google Ads en Merchant Center (prijsvergelijking, bestsellers) via markt.ts
// - Elke week: analyse (verspilling, winnaars, budgetverdeling, Google-aanbevelingen, prijzen, bestsellers) -> voorstellen + weekbericht voor de klant
// - Portaal: overzicht voor de klant; beheer: koppelen en accounts toewijzen
// - "details": Meer details (klant: uitgekozen, beheer: volledig)
// Alleen lezen: dit wijzigt (nog) niets in Google Ads of Merchant Center.
import postgres from "npm:postgres@3.4.5";
import { details } from "./details.ts";
import { haalAanbevelingen, haalMerchant, extraActies } from "./markt.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-sessie, x-cron-key, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
class Fout extends Error { constructor(public code: number, msg: string) { super(msg); } }
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (s: string) => b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
const SCOPE = "https://www.googleapis.com/auth/adwords";
const SCOPE_MC = "https://www.googleapis.com/auth/content";
const euro = (n: number) => "€" + (Math.round(n * 100) / 100).toLocaleString("nl-NL", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const isoDag = (d: Date) => d.toISOString().slice(0, 10);

async function inst() {
  const r = await sql`select sleutel, waarde from beheersite.instellingen`;
  return Object.fromEntries(r.map((x) => [x.sleutel, x.waarde])) as Record<string, string>;
}
async function zetInst(sleutel: string, waarde: string) {
  await sql`insert into beheersite.instellingen (sleutel, waarde) values (${sleutel}, ${waarde}) on conflict (sleutel) do update set waarde = excluded.waarde`;
}
async function gebruikerVan(req: Request) {
  const t = req.headers.get("x-sessie");
  if (!t) return null;
  const [g] = await sql`select g.id, g.rol, g.klant_id from beheersite.sessies s join beheersite.gebruikers g on g.id = s.gebruiker_id
    where s.token_hash = ${await sha256(t)} and s.verloopt > now() and g.actief`;
  return g || null;
}
async function hmac(geheim: string, tekst: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(geheim), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(tekst))));
}
const terugUrl = (i: Record<string, string>) => (i.platform_url || "https://sitehulpje.nl").replace(/\/$/, "") + "/google-terug";
const manager = (i: Record<string, string>) => (i.ads_manager || "3429828197").replace(/\D/g, "");
const versie = (i: Record<string, string>) => i.ads_api_versie || "v22";
const merchantMag = (i: Record<string, string>) => String(i.ads_scopes || "").includes("auth/content");

// ---------- Google Ads ----------
async function toegang(i: Record<string, string>) {
  if (!i.ads_token_id) throw new Fout(409, "Google Ads is nog niet gekoppeld. Koppel eerst in het beheer.");
  const [{ t }] = await sql`select beheersite.vb_token_lezen(${i.ads_token_id}::uuid) t`;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: i.google_client_id || "", client_secret: CLIENT_SECRET, grant_type: "refresh_token", refresh_token: t }) });
  const d = await r.json();
  if (!r.ok) throw new Fout(502, "Google Ads-toegang verlopen. Koppel opnieuw in het beheer.");
  return d.access_token as string;
}
async function zoek(i: Record<string, string>, at: string, klant: string, query: string) {
  const rijen: any[] = []; let pageToken: string | undefined;
  for (let n = 0; n < 50; n++) {
    const h: Record<string, string> = { Authorization: `Bearer ${at}`, "Content-Type": "application/json", "login-customer-id": manager(i) };
    if (i.ads_developer_token) h["developer-token"] = i.ads_developer_token;
    const r = await fetch(`https://googleads.googleapis.com/${versie(i)}/customers/${klant}/googleAds:search`, { method: "POST", headers: h,
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }), signal: AbortSignal.timeout(60000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const det = d?.error?.details?.[0]?.errors?.[0];
      throw new Error(`Google Ads ${r.status}: ${det?.message || d?.error?.message || ""}`.slice(0, 400));
    }
    rijen.push(...(d.results || []));
    pageToken = d.nextPageToken; if (!pageToken) break;
  }
  return rijen;
}
const m = (x: any) => ({ kosten: Number(x?.costMicros || 0) / 1e6, klikken: Number(x?.clicks || 0), vertoningen: Number(x?.impressions || 0), conversies: Number(x?.conversions || 0), waarde: Number(x?.conversionsValue || 0) });

async function synchroniseer(klantId: string) {
  const i = await inst();
  const [k] = await sql`select id, ads_klant, ads_laatst, mc_id, mc_categorie from beheersite.klanten where id = ${klantId}`;
  if (!k?.ads_klant) throw new Fout(404, "Geen Google Ads-account gekoppeld aan deze klant.");
  const at = await toegang(i);
  const cid = k.ads_klant.replace(/\D/g, "");
  const tot = new Date(); const van = new Date(tot); van.setDate(van.getDate() - (k.ads_laatst ? 35 : 730));
  try {
    const camp = await zoek(i, at, cid, `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.status, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${isoDag(van)}' AND '${isoDag(tot)}'`);
    for (const r of camp) {
      const x = m(r.metrics);
      await sql`insert into beheersite.ads_dag (klant_id, datum, campagne_id, campagne, soort, status, kosten, klikken, vertoningen, conversies, waarde)
        values (${k.id}, ${r.segments.date}, ${String(r.campaign.id)}, ${r.campaign.name}, ${r.campaign.advertisingChannelType}, ${r.campaign.status}, ${x.kosten}, ${x.klikken}, ${x.vertoningen}, ${x.conversies}, ${x.waarde})
        on conflict (klant_id, datum, campagne_id) do update set campagne = excluded.campagne, soort = excluded.soort, status = excluded.status, kosten = excluded.kosten, klikken = excluded.klikken, vertoningen = excluded.vertoningen, conversies = excluded.conversies, waarde = excluded.waarde`;
    }
    // huidige status van alle campagnes (ook zonder kosten)
    const stat = await zoek(i, at, cid, `SELECT campaign.id, campaign.status FROM campaign WHERE campaign.status != 'REMOVED'`);
    for (const r of stat) await sql`update beheersite.ads_dag set status = ${r.campaign.status} where klant_id = ${k.id} and campagne_id = ${String(r.campaign.id)}`;
    const v30 = new Date(tot); v30.setDate(v30.getDate() - 30);
    const termen = await zoek(i, at, cid, `SELECT search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM search_term_view WHERE segments.date DURING LAST_30_DAYS`);
    await sql`delete from beheersite.ads_zoektermen where klant_id = ${k.id}`;
    const tm = new Map<string, any>();
    for (const r of termen) { const t = r.searchTermView?.searchTerm; if (!t) continue; const a = tm.get(t) || { kosten: 0, klikken: 0, vertoningen: 0, conversies: 0, waarde: 0 }; const x = m(r.metrics); for (const s of Object.keys(a)) a[s] += x[s as keyof typeof x]; tm.set(t, a); }
    for (const [t, a] of tm) await sql`insert into beheersite.ads_zoektermen (klant_id, term, kosten, klikken, vertoningen, conversies, waarde, van, tot) values (${k.id}, ${t}, ${a.kosten}, ${a.klikken}, ${a.vertoningen}, ${a.conversies}, ${a.waarde}, ${isoDag(v30)}, ${isoDag(tot)})`;
    let prod: any[] = [];
    try { prod = await zoek(i, at, cid, `SELECT segments.product_item_id, segments.product_title, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM shopping_performance_view WHERE segments.date DURING LAST_30_DAYS`); } catch { /* geen shopping */ }
    await sql`delete from beheersite.ads_producten where klant_id = ${k.id}`;
    const pm = new Map<string, any>();
    for (const r of prod) { const id = r.segments?.productItemId; if (!id) continue; const a = pm.get(id) || { titel: r.segments.productTitle || id, kosten: 0, klikken: 0, vertoningen: 0, conversies: 0, waarde: 0 }; const x = m(r.metrics); for (const s of ["kosten", "klikken", "vertoningen", "conversies", "waarde"]) a[s] += x[s as keyof typeof x]; pm.set(id, a); }
    for (const [id, a] of pm) await sql`insert into beheersite.ads_producten (klant_id, product_id, titel, kosten, klikken, vertoningen, conversies, waarde, van, tot) values (${k.id}, ${id}, ${a.titel}, ${a.kosten}, ${a.klikken}, ${a.vertoningen}, ${a.conversies}, ${a.waarde}, ${isoDag(v30)}, ${isoDag(tot)})`;
    await sql`update beheersite.klanten set ads_laatst = now(), ads_fout = null, ads_sinds = coalesce(ads_sinds, now()) where id = ${k.id}`;
    // extra gratis bronnen: fouten hierin stoppen de gewone cijfers niet
    const extra: Record<string, unknown> = {};
    try { extra.aanbevelingen = await haalAanbevelingen(sql, zoek, i, at, k.id, cid); }
    catch (e) { console.error("aanbevelingen", e); extra.aanbevelingen_fout = String((e as Error).message).slice(0, 200); }
    if (merchantMag(i)) {
      try {
        let mc = k.mc_id as string | null;
        if (!mc) {
          const pl = await zoek(i, at, cid, `SELECT product_link.merchant_center.merchant_center_id FROM product_link`).catch(() => []);
          const id = pl.map((x: any) => x.productLink?.merchantCenter?.merchantCenterId).find(Boolean);
          if (id) { mc = String(id); await sql`update beheersite.klanten set mc_id = ${mc} where id = ${k.id}`; }
        }
        if (mc) { extra.merchant = await haalMerchant(sql, i, at, k.id, mc, k.mc_categorie); await sql`update beheersite.klanten set mc_fout = null where id = ${k.id}`; }
        else extra.merchant = "geen Merchant Center gekoppeld aan dit Ads-account";
      } catch (e) {
        const f = String((e as Error).message).slice(0, 300);
        extra.merchant_fout = f; await sql`update beheersite.klanten set mc_fout = ${f} where id = ${k.id}`;
      }
    } else extra.merchant = "nog geen toestemming: koppel Google Ads opnieuw in het beheer";
    return { ok: true, dagen: camp.length, zoektermen: tm.size, producten: pm.size, ...extra };
  } catch (e) {
    await sql`update beheersite.klanten set ads_fout = ${String((e as Error).message).slice(0, 300)} where id = ${k.id}`;
    throw e;
  }
}

// ---------- weekanalyse ----------
async function weekAnalyse(klantId: string) {
  const vandaag = new Date(); const week = new Date(vandaag); week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
  const wk = isoDag(week);
  await sql`delete from beheersite.ads_acties where klant_id = ${klantId} and week = ${wk} and status = 'voorstel'`;
  const acties: { soort: string; tekst: string; waarom: string; besparing?: number; data?: unknown }[] = [];
  const [w7] = await sql`select coalesce(sum(kosten),0)::float k, coalesce(sum(waarde),0)::float w, coalesce(sum(conversies),0)::float c from beheersite.ads_dag where klant_id = ${klantId} and datum > current_date - 7`;
  if (w7.k < 0.01) {
    acties.push({ soort: "status", tekst: "Er liepen deze week geen advertenties, dus er is niets uitgegeven.", waarom: "Alle campagnes staan uit of hebben geen budget." });
  } else {
    // 1. verspilling: zoekopdrachten die geld kosten zonder resultaat
    const [gem] = await sql`select case when sum(conversies) > 0 then sum(kosten)/sum(conversies) else null end::float cpa from beheersite.ads_zoektermen where klant_id = ${klantId}`;
    const drempel = Math.max(5, (gem?.cpa || 10) * 0.8);
    const weg = await sql`select term, kosten::float, klikken from beheersite.ads_zoektermen where klant_id = ${klantId} and conversies = 0 and (kosten >= ${drempel} or klikken >= 15) order by kosten desc limit 15`;
    if (weg.length) {
      const bespaar = weg.reduce((s, x) => s + x.kosten, 0) / 30 * 7;
      acties.push({ soort: "uitsluiten", tekst: `${weg.length} zoekopdracht${weg.length > 1 ? "en" : ""} uitsluiten die geld kostten maar niets opleverden, zoals "${weg[0].term}".`,
        waarom: `Samen ${euro(weg.reduce((s, x) => s + x.kosten, 0))} in 30 dagen zonder één verkoop of aanvraag.`, besparing: Math.round(bespaar * 100) / 100, data: weg });
    }
    // 2. winnaars: zoekopdrachten die verkopen
    const top = await sql`select term, kosten::float, conversies::float, waarde::float from beheersite.ads_zoektermen where klant_id = ${klantId} and conversies > 0 order by (case when kosten > 0 then waarde/kosten else waarde end) desc, conversies desc limit 5`;
    if (top.length) acties.push({ soort: "uitbouwen", tekst: `Meer ruimte voor zoekopdrachten die verkopen, zoals "${top[0].term}".`,
      waarom: `"${top[0].term}" leverde ${top[0].waarde ? euro(top[0].waarde) + " omzet" : top[0].conversies + " aanvragen"} op voor ${euro(top[0].kosten)}.`, data: top });
    // 3. budgetverdeling tussen soorten campagnes (28 dagen)
    const soorten = await sql`select soort, sum(kosten)::float k, sum(waarde)::float w, sum(conversies)::float c from beheersite.ads_dag where klant_id = ${klantId} and datum > current_date - 28 group by soort having sum(kosten) > 5`;
    if (soorten.length >= 2) {
      const r = soorten.map((s) => ({ ...s, roas: s.w > 0 ? s.w / s.k : s.c / s.k })).sort((a, b) => b.roas - a.roas);
      if (r[0].roas >= r[r.length - 1].roas * 1.5) {
        const naam = (s: string) => ({ SHOPPING: "Shopping", PERFORMANCE_MAX: "Shopping en meer (Performance Max)", SEARCH: "Zoekadvertenties", DISPLAY: "Banners", VIDEO: "Video", SMART: "Slimme campagnes" } as Record<string, string>)[s] || s;
        const fmt = (s: any) => s.w > 0 ? `${euro(s.roas)} omzet per euro` : `${euro(s.k / Math.max(s.c, 1))} per aanvraag`;
        acties.push({ soort: "budget", tekst: `Tot 20% budget verschuiven van ${naam(r[r.length - 1].soort)} naar ${naam(r[0].soort)}.`,
          waarom: `${naam(r[0].soort)}: ${fmt(r[0])}. ${naam(r[r.length - 1].soort)}: ${fmt(r[r.length - 1])}.`, data: r });
      }
    }
    // 4. producten die kosten zonder verkoop
    const pr = await sql`select titel, kosten::float, klikken from beheersite.ads_producten where klant_id = ${klantId} and conversies = 0 and kosten >= ${drempel} order by kosten desc limit 10`;
    if (pr.length) acties.push({ soort: "producten", tekst: `${pr.length} product${pr.length > 1 ? "en" : ""} minder vaak tonen die veel kosten maar niet verkopen, zoals "${pr[0].titel}".`,
      waarom: `Samen ${euro(pr.reduce((s, x) => s + x.kosten, 0))} in 30 dagen zonder verkoop.`, data: pr });
  }
  // 5. Google-aanbevelingen, prijsvergelijking en bestsellers (ook als er nu geen advertenties lopen)
  try { acties.push(...(await extraActies(sql, klantId))); } catch (e) { console.error("extra acties", e); }
  for (const a of acties) await sql`insert into beheersite.ads_acties (klant_id, week, soort, tekst, waarom, besparing_eur, data) values (${klantId}, ${wk}, ${a.soort}, ${a.tekst}, ${a.waarom}, ${a.besparing ?? null}, ${a.data ? sql.json(a.data as any) : null})`;
  return { week: wk, acties: acties.length };
}

// ---------- overzicht voor portaal ----------
async function overzicht(klantId: string) {
  const [k] = await sql`select id, naam, ads_klant, ads_laatst, ads_fout from beheersite.klanten where id = ${klantId}`;
  if (!k?.ads_klant) return { actief: false };
  const som = async (van: string, tot: string) => (await sql`select coalesce(sum(kosten),0)::float kosten, coalesce(sum(klikken),0)::int klikken, coalesce(sum(vertoningen),0)::int vertoningen, coalesce(sum(conversies),0)::float conversies, coalesce(sum(waarde),0)::float waarde from beheersite.ads_dag where klant_id = ${klantId} and datum between ${van}::date and ${tot}::date`)[0];
  const nu = new Date(); const begin = new Date(nu.getFullYear(), nu.getMonth(), 1); const vorigB = new Date(nu.getFullYear(), nu.getMonth() - 1, 1); const vorigT = new Date(nu.getFullYear(), nu.getMonth() - 1, nu.getDate());
  const deze = await som(isoDag(begin), isoDag(nu)), vorige = await som(isoDag(vorigB), isoDag(vorigT));
  const d30 = await som(isoDag(new Date(Date.now() - 30 * 864e5)), isoDag(nu));
  const [laatsteKosten] = await sql`select max(datum) d from beheersite.ads_dag where klant_id = ${klantId} and kosten > 0`;
  const soorten = await sql`select soort, sum(kosten)::float kosten, sum(conversies)::float conversies, sum(waarde)::float waarde, sum(klikken)::int klikken from beheersite.ads_dag where klant_id = ${klantId} and datum > current_date - 30 group by soort order by 2 desc`;
  const reeks = await sql`select date_trunc('week', datum)::date week, sum(kosten)::float kosten, sum(waarde)::float waarde, sum(conversies)::float conversies from beheersite.ads_dag where klant_id = ${klantId} and datum > current_date - 84 group by 1 order by 1`;
  const campagnes = await sql`select distinct on (campagne_id) campagne_id, campagne, soort, status from beheersite.ads_dag where klant_id = ${klantId} order by campagne_id, datum desc`;
  const producten = await sql`select titel, kosten::float, klikken, conversies::float, waarde::float from beheersite.ads_producten where klant_id = ${klantId} order by waarde desc, conversies desc, klikken desc limit 8`;
  const zoekterm = await sql`select term, kosten::float, klikken, conversies::float, waarde::float from beheersite.ads_zoektermen where klant_id = ${klantId} order by conversies desc, klikken desc limit 12`;
  const acties = await sql`select week, soort, tekst, waarom, besparing_eur::float besparing, status, aangemaakt from beheersite.ads_acties where klant_id = ${klantId} order by aangemaakt desc limit 20`;
  const [hist] = await sql`select min(datum) eerste, coalesce(sum(kosten),0)::float kosten, coalesce(sum(waarde),0)::float waarde, coalesce(sum(conversies),0)::float conversies from beheersite.ads_dag where klant_id = ${klantId}`;
  const lopend = campagnes.filter((c) => c.status === "ENABLED").length;
  const status = k.ads_fout ? "fout" : !k.ads_laatst ? "wachten" : lopend === 0 ? "uit" : (!laatsteKosten?.d || (Date.now() - new Date(laatsteKosten.d).getTime()) > 3 * 864e5) ? "stil" : "loopt";
  return { actief: true, status, fout: k.ads_fout ? true : false, laatst: k.ads_laatst, deze, vorige, d30, soorten, reeks, campagnes, lopend, producten, zoektermen: zoekterm, acties, historie: hist, soortKlant: d30.waarde > 0 || hist.waarde > 0 ? "omzet" : "aanvragen" };
}

async function handel(req: Request, b: any) {
  const a = b.actie;
  if (a === "dagelijks" || a === "wekelijks") {
    const i = await inst();
    if (!i.cron_sleutel || req.headers.get("x-cron-key") !== i.cron_sleutel) throw new Fout(401, "Geen toegang");
    const lijst = await sql`select id from beheersite.klanten where actief and ads_klant is not null`;
    const log: string[] = [];
    for (const { id } of lijst) {
      try { if (a === "dagelijks") await synchroniseer(id); else await weekAnalyse(id); log.push(`${id}: ok`); }
      catch (e) { console.error(id, e); log.push(`${id}: ${(e as Error).message}`); }
    }
    return { ok: true, log };
  }
  if (a === "google_terug") {
    const i = await inst();
    const st = String(b.state || ""), [, data, sig] = st.split(".");
    if (!data || !sig || sig !== await hmac(i.geheim || "", data)) throw new Fout(400, "Ongeldige koppeling. Probeer het opnieuw.");
    const p = JSON.parse(atob(data.replace(/-/g, "+").replace(/_/g, "/")));
    if (Date.now() - p.t > 30 * 60 * 1000) throw new Fout(400, "De koppeling duurde te lang. Probeer het opnieuw.");
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: String(b.code || ""), client_id: i.google_client_id || "", client_secret: CLIENT_SECRET, redirect_uri: terugUrl(i), grant_type: "authorization_code" }) });
    const d = await r.json();
    if (!r.ok || !d.refresh_token) throw new Fout(400, "Google gaf geen toestemming terug. Probeer het opnieuw.");
    if (!String(d.scope || "").includes(SCOPE)) throw new Fout(400, "Je hebt geen toestemming voor Google Ads aangevinkt. Probeer het opnieuw en vink alles aan.");
    if (i.ads_token_id) await sql`select vault.update_secret(${i.ads_token_id}::uuid, ${d.refresh_token})`;
    else { const [{ id }] = await sql`select vault.create_secret(${d.refresh_token}, ${"ads_beheerder_" + Date.now()}, 'Google Ads refresh token beheerder') id`; await zetInst("ads_token_id", id); }
    await zetInst("ads_gekoppeld", new Date().toISOString());
    await zetInst("ads_scopes", String(d.scope || ""));
    return { ok: true, beheer: true, ads: true };
  }
  const g = await gebruikerVan(req);
  if (!g) throw new Fout(401, "Niet ingelogd");
  if (g.rol === "admin") {
    const i = await inst();
    if (a === "koppel_start") {
      const data = b64u(new TextEncoder().encode(JSON.stringify({ t: Date.now(), s: "ads" })));
      const state = "ads." + data + "." + await hmac(i.geheim || "", data);
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.search = new URLSearchParams({ client_id: i.google_client_id || "", redirect_uri: terugUrl(i), response_type: "code", scope: `${SCOPE} ${SCOPE_MC}`, access_type: "offline", prompt: "consent", include_granted_scopes: "false", state }).toString();
      return { url: u.toString() };
    }
    if (a === "status") {
      const klanten = await sql`select id, naam, ads_klant, ads_laatst, ads_fout, mc_id, mc_fout from beheersite.klanten where actief order by naam`;
      return { gekoppeld: !!i.ads_token_id, sinds: i.ads_gekoppeld || null, manager: manager(i), merchant: merchantMag(i), klanten };
    }
    if (a === "accounts") {
      const at = await toegang(i);
      const r = await zoek(i, at, manager(i), `SELECT customer_client.id, customer_client.descriptive_name, customer_client.status, customer_client.manager FROM customer_client WHERE customer_client.level = 1`);
      return { accounts: r.map((x) => ({ id: String(x.customerClient.id), naam: x.customerClient.descriptiveName, status: x.customerClient.status, manager: x.customerClient.manager })) };
    }
    if (a === "toewijzen") {
      const nr = String(b.ads_klant || "").replace(/\D/g, "") || null;
      await sql`update beheersite.klanten set ads_klant = ${nr}, ads_laatst = null, ads_fout = null, mc_id = null, mc_fout = null where id = ${String(b.klant_id || "")}`;
      return { ok: true };
    }
    if (a === "nu") {
      const kid = String(b.klant_id || "");
      const s = await synchroniseer(kid);
      const w = await weekAnalyse(kid);
      return { ...s, week: w };
    }
    if (a === "markt") {
      // beheer: prijsvergelijking, bestsellers en Google-aanbevelingen van één klant
      const kid = String(b.klant_id || "");
      const prijzen = await sql`select titel, prijs::float, benchmark::float, verschil_pct::float from beheersite.ads_prijzen where klant_id = ${kid} order by verschil_pct desc`;
      const bestsellers = await sql`select week, rang, vorige_rang, titel, merk, categorie, voorraad, merk_voorraad, vraag from beheersite.ads_bestsellers where klant_id = ${kid} and week = (select max(week) from beheersite.ads_bestsellers where klant_id = ${kid}) order by rang`;
      const aanbevelingen = await sql`select soort, campagne, data, opgehaald from beheersite.ads_aanbevelingen where klant_id = ${kid} order by soort`;
      return { prijzen, bestsellers, aanbevelingen };
    }
  }
  const kid = g.rol === "admin" && b.klant_id ? String(b.klant_id) : g.klant_id;
  if (!kid) throw new Fout(400, "Geen klant");
  if (a === "details") return await details(sql, kid, String(b.periode || ""), g.rol === "admin");
  return await overzicht(kid);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fout: "Alleen POST" }, 405);
  try { return json(await handel(req, await req.json().catch(() => ({})))); }
  catch (e) {
    if (e instanceof Fout) return json({ fout: e.message }, e.code);
    console.error(e);
    return json({ fout: String((e as Error).message || "Er ging iets mis.").slice(0, 300) }, 500);
  }
});
