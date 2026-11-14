// Klikfraude-bescherming (Supabase Edge Function "sr-klikfraude", alleen via cron-sleutel)
// - "template": zet het klik-adres (tracking-template, zie sr-klik) op accountniveau bij elke klant met een Google Ads-account.
//   Kost niets en verandert de advertenties niet; alleen elke klik wordt via sr-klik vastgelegd.
// - "controle" (elk uur): verdachte IP-adressen zoeken in beheersite.ads_klikken.
//   Modus "aan" (instelling klikfraude_modus): verdachte IP's 30 dagen uitsluiten in alle lopende campagnes (max. 500 per campagne).
//   Modus "melden": alleen als voorstel in ads_ip_uit + mail aan Jan.
// - beheer (admin, sessie): "overzicht", "wit" (nooit uitsluiten), "terug" (witte lijst eraf)
// deno-lint-ignore-file no-explicit-any
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const KLIK = "https://dauvsivoxfdfzurmyuug.supabase.co/functions/v1/sr-klik";
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-sessie, x-cron-key, authorization, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (s: string) => b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
async function gebruikerVan(req: Request) {
  const t = req.headers.get("x-sessie");
  if (!t) return null;
  const [g] = await sql`select g.id, g.rol from beheersite.sessies s join beheersite.gebruikers g on g.id = s.gebruiker_id
    where s.token_hash = ${await sha256(t)} and s.verloopt > now() and g.actief`;
  return g || null;
}
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
    on conflict (klant_id, ip, campagne) do update set klikken = excluded.klikken, reden = excluded.reden, status = 'voorstel',
      sinds = case when beheersite.ads_ip_uit.status = 'verlopen' then now() else beheersite.ads_ip_uit.sinds end
      where beheersite.ads_ip_uit.status in ('voorstel', 'verlopen')
    returning klant_id, host(ip) ip, reden, (xmax = 0) nieuw`;
  await sql`update beheersite.ads_klikken c set verdacht = true, reden = u.reden from beheersite.ads_ip_uit u
    where c.klant_id = u.klant_id and c.ip = u.ip and u.status in ('voorstel','actief') and not c.verdacht and c.tijd > now() - interval '7 days'`;
  const nieuw = rijen.filter((x: any) => x.nieuw);
  const aan = i.klikfraude_modus === "aan";
  let uit: string[] = [];
  if (aan) uit = await uitsluiten(i);
  if (nieuw.length) await mailJan(i, `Klikfraude: ${nieuw.length} verdacht IP-adres${nieuw.length > 1 ? "sen" : ""}${aan ? "" : " (alleen gemeld)"}`,
    `<p>Deze IP-adressen klikten verdacht vaak op advertenties. ${aan ? "Ze worden 30 dagen uitgesloten in de lopende campagnes." : "Er is <b>niets</b> uitgesloten in Google Ads (modus: alleen melden)."}</p>
<ul>${nieuw.map((x: any) => `<li>${esc(x.klant_id)}: ${esc(x.ip)} – ${esc(x.reden)}</li>`).join("")}</ul><p>Klopt er een niet (bijv. de winkel zelf)? Zet hem in het beheer bij Advertenties op "nooit uitsluiten".</p>`);
  return { verdacht: rijen.length, nieuw: nieuw.length, modus: aan ? "aan" : "melden", uit };
}

// IP-uitsluitingen in Google Ads bijwerken: nieuwe voorstellen erin, verlopen (30 dagen) en witte lijst eruit
const SOORTEN = ["SEARCH", "DISPLAY", "SHOPPING", "VIDEO", "PERFORMANCE_MAX"];
async function uitsluiten(i: Record<string, string>) {
  const log: string[] = [];
  const klanten = await sql`select distinct u.klant_id, k.ads_klant from beheersite.ads_ip_uit u join beheersite.klanten k on k.id = u.klant_id
    where k.ads_klant is not null and (u.status = 'voorstel' or (u.status = 'actief' and u.tot < now()) or (u.status = 'wit' and u.resource_name is not null))`;
  if (!klanten.length) return log;
  const at = await toegang(i);
  for (const k of klanten) {
    const cid = String(k.ads_klant).replace(/\D/g, "");
    try {
      // eerst opruimen: verlopen en witte lijst uit Google halen
      const weg = await sql`select ip, status, resource_name from beheersite.ads_ip_uit where klant_id = ${k.klant_id} and resource_name is not null and (status = 'wit' or (status = 'actief' and tot < now()))`;
      for (const w of weg) {
        const namen = JSON.parse(w.resource_name || "[]");
        if (namen.length) await gads(i, at, `customers/${cid}/googleAds:mutate`, { partialFailure: true, mutateOperations: namen.map((r: string) => ({ campaignCriterionOperation: { remove: r } })) }).catch((e) => log.push(`${k.klant_id}: opruimen ${w.ip}: ${e.message}`));
        await sql`update beheersite.ads_ip_uit set resource_name = null, status = case when status = 'wit' then 'wit' else 'verlopen' end where klant_id = ${k.klant_id} and ip = ${w.ip}`;
      }
      const nieuw = await sql`select host(ip) ip from beheersite.ads_ip_uit where klant_id = ${k.klant_id} and status = 'voorstel' order by sinds`;
      if (!nieuw.length) continue;
      const camp = (await gads(i, at, `customers/${cid}/googleAds:search`, { query: `SELECT campaign.resource_name, campaign.advertising_channel_type FROM campaign WHERE campaign.status = 'ENABLED'` })).results || [];
      const lopend = camp.filter((c: any) => SOORTEN.includes(c.campaign?.advertisingChannelType)).map((c: any) => c.campaign.resourceName);
      if (!lopend.length) { log.push(`${k.klant_id}: geen lopende campagne, ${nieuw.length} IP('s) wachten`); continue; }
      // ruimte houden onder de grens van 500 per campagne: oudste actieve eruit
      const [{ n }] = await sql`select count(*)::int n from beheersite.ads_ip_uit where klant_id = ${k.klant_id} and status = 'actief'`;
      if (n + nieuw.length > 480) await sql`update beheersite.ads_ip_uit set tot = now() - interval '1 second' where klant_id = ${k.klant_id} and ip in
        (select ip from beheersite.ads_ip_uit where klant_id = ${k.klant_id} and status = 'actief' order by sinds limit ${n + nieuw.length - 480})`;
      for (const x of nieuw) {
        const d = await gads(i, at, `customers/${cid}/googleAds:mutate`, { partialFailure: true,
          mutateOperations: lopend.map((c: string) => ({ campaignCriterionOperation: { create: { campaign: c, negative: true, ipBlock: { ipAddress: x.ip } } } })) });
        const namen = (d.mutateOperationResponses || []).map((r: any) => r.campaignCriterionResult?.resourceName).filter(Boolean);
        await sql`update beheersite.ads_ip_uit set status = ${namen.length ? "actief" : "voorstel"}, resource_name = ${namen.length ? JSON.stringify(namen) : null},
          tot = ${namen.length ? new Date(Date.now() + 30 * 864e5) : null} where klant_id = ${k.klant_id} and ip = ${x.ip}::inet`;
        log.push(`${k.klant_id}: ${x.ip} uitgesloten in ${namen.length} campagne(s)${d.partialFailureError ? " (deels: " + String(d.partialFailureError.message).slice(0, 120) + ")" : ""}`);
      }
    } catch (e) { log.push(`${k.klant_id}: ${(e as Error).message}`); }
  }
  return log;
}

// ---------- beheer ----------
async function overzicht(i: Record<string, string>) {
  const klikken = await sql`select klant_id, tijd, host(ip) ip, zoekwoord, toestel, plaats, test, verdacht from beheersite.ads_klikken order by tijd desc limit 100`;
  const ips = await sql`select klant_id, host(ip) ip, status, reden, klikken, sinds, tot from beheersite.ads_ip_uit order by sinds desc limit 200`;
  const [tel] = await sql`select count(*) filter (where not test)::int klikken, count(*) filter (where verdacht)::int verdacht from beheersite.ads_klikken where tijd > now() - interval '30 days'`;
  return { modus: i.klikfraude_modus === "aan" ? "aan" : "melden", klikken, ips, tel };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fout: "Alleen POST" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const i = await inst();
    if (["overzicht", "wit", "terug"].includes(b.actie)) {
      const g = await gebruikerVan(req);
      if (!g) return json({ fout: "Niet ingelogd" }, 401);
      if (g.rol !== "admin") return json({ fout: "Geen toegang" }, 403);
      if (b.actie === "overzicht") return json(await overzicht(i));
      const ip = String(b.ip || ""), kid = String(b.klant_id || "");
      if (!/^[0-9a-f:.]{3,45}$/i.test(ip) || !kid) return json({ fout: "Ongeldig IP-adres" }, 400);
      if (b.actie === "wit") await sql`insert into beheersite.ads_ip_uit (klant_id, ip, status, reden) values (${kid}, ${ip}::inet, 'wit', 'nooit uitsluiten')
        on conflict (klant_id, ip, campagne) do update set status = 'wit'`;
      else await sql`update beheersite.ads_ip_uit set status = 'verlopen' where klant_id = ${kid} and ip = ${ip}::inet and status = 'wit' and resource_name is null`;
      if (b.actie === "wit" && i.klikfraude_modus === "aan") await uitsluiten(i).catch((e) => console.error(e));
      return json({ ok: true });
    }
    if (!i.cron_sleutel || req.headers.get("x-cron-key") !== i.cron_sleutel) return json({ fout: "Geen toegang" }, 401);
    if (b.actie === "template") return json({ ok: true, log: await template(i) });
    if (b.actie === "controle") return json({ ok: true, ...(await controle(i)) });
    return json({ fout: "Onbekende actie" }, 400);
  } catch (e) { console.error(e); return json({ fout: String((e as Error).message).slice(0, 300) }, 500); }
});
