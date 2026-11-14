// Klikfraude-bescherming (Supabase Edge Function "sr-klikfraude", alleen via cron-sleutel)
// - "template": zet het klik-adres (tracking-template, zie sr-klik) op accountniveau bij elke klant met een Google Ads-account.
//   Kost niets en verandert de advertenties niet; alleen elke klik wordt via sr-klik vastgelegd.
// - "controle" (elk uur): verdachte IP-adressen zoeken in beheersite.ads_klikken.
//   Modus "melden" (standaard): alleen als voorstel in ads_ip_uit + mail aan Jan. Er wordt NIETS uitgesloten in Google Ads.
// deno-lint-ignore-file no-explicit-any
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const KLIK = "https://dauvsivoxfdfzurmyuug.supabase.co/functions/v1/sr-klik";
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
const klikTemplate = (kid: string) =>
  `${KLIK}?k=${encodeURIComponent(kid)}&g={gclid}&c={campaignid}&a={adgroupid}&kw={keyword}&m={matchtype}&d={device}&l={loc_physical_ms}&n={network}&u={lpurl}`;

async function inst() {
  const r = await sql`select sleutel, waarde from beheersite.instellingen`;
  return Object.fromEntries(r.map((x: any) => [x.sleutel, x.waarde])) as Record<string, string>;
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

// klik-adres op accountniveau zetten (alleen waar het nog niet goed staat)
async function template(i: Record<string, string>) {
  const lijst = await sql`select id, ads_klant from beheersite.klanten where actief and ads_klant is not null`;
  if (!lijst.length) return [];
  const at = await toegang(i), log: string[] = [];
  for (const k of lijst) {
    const cid = String(k.ads_klant).replace(/\D/g, ""), gewenst = klikTemplate(k.id);
    try {
      const d = await gads(i, at, `customers/${cid}/googleAds:search`, { query: "SELECT customer.tracking_url_template FROM customer" });
      const nu = d.results?.[0]?.customer?.trackingUrlTemplate || "";
      if (nu === gewenst) { log.push(`${k.id}: stond al goed`); continue; }
      if (nu && !nu.startsWith(KLIK)) { log.push(`${k.id}: heeft al een ander klik-adres (${nu.slice(0, 80)}), niet aangepast`); continue; }
      await gads(i, at, `customers/${cid}:mutate`, { operation: { update: { resourceName: `customers/${cid}`, trackingUrlTemplate: gewenst }, updateMask: "tracking_url_template" } });
      log.push(`${k.id}: klik-adres gezet`);
    } catch (e) { log.push(`${k.id}: ${(e as Error).message}`); }
  }
  return log;
}

// verdachte IP's: zelfde IP ≥ 3 klikken binnen 24 uur of ≥ 5 binnen 7 dagen (testklikken en de witte lijst tellen niet mee)
async function controle(i: Record<string, string>) {
  const rijen = await sql`
    with tel as (
      select klant_id, ip,
        count(*) filter (where tijd > now() - interval '24 hours')::int d1,
        count(*)::int d7
      from beheersite.ads_klikken where not test and ip is not null and tijd > now() - interval '7 days'
      group by 1, 2)
    insert into beheersite.ads_ip_uit (klant_id, ip, reden, klikken)
    select klant_id, ip, case when d1 >= 3 then d1 || ' klikken binnen 24 uur' else d7 || ' klikken binnen 7 dagen' end, d7
    from tel where d1 >= 3 or d7 >= 5
    on conflict (klant_id, ip, campagne) do update set klikken = excluded.klikken, reden = excluded.reden
      where beheersite.ads_ip_uit.status = 'voorstel'
    returning klant_id, host(ip) ip, reden, (xmax = 0) nieuw`;
  await sql`update beheersite.ads_klikken c set verdacht = true, reden = u.reden from beheersite.ads_ip_uit u
    where c.klant_id = u.klant_id and c.ip = u.ip and u.status in ('voorstel','actief') and not c.verdacht and c.tijd > now() - interval '7 days'`;
  const nieuw = rijen.filter((x: any) => x.nieuw);
  if (nieuw.length) await mailJan(i, `Klikfraude: ${nieuw.length} verdacht IP-adres${nieuw.length > 1 ? "sen" : ""} (alleen gemeld)`,
    `<p>Deze IP-adressen klikten verdacht vaak op advertenties. Er is <b>niets</b> uitgesloten in Google Ads (modus: alleen melden).</p>
<ul>${nieuw.map((x: any) => `<li>${esc(x.klant_id)}: ${esc(x.ip)} – ${esc(x.reden)}</li>`).join("")}</ul>`);
  return { verdacht: rijen.length, nieuw: nieuw.length };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ fout: "Alleen POST" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const i = await inst();
    if (!i.cron_sleutel || req.headers.get("x-cron-key") !== i.cron_sleutel) return json({ fout: "Geen toegang" }, 401);
    if (b.actie === "template") return json({ ok: true, log: await template(i) });
    if (b.actie === "controle") return json({ ok: true, ...(await controle(i)) });
    return json({ fout: "Onbekende actie" }, 400);
  } catch (e) { console.error(e); return json({ fout: String((e as Error).message).slice(0, 300) }, 500); }
});
