// Advertentieklik vastleggen (Supabase Edge Function "sr-klik", openbaar)
// Staat als tracking-template op de campagnes. Google pingt deze URL bij elke klik vanuit de browser
// van de bezoeker (parallel tracking), dus we zien het echte IP-adres. Daarna door naar de landingspagina.
// Template: .../sr-klik?k=<klant>&g={gclid}&c={campaignid}&a={adgroupid}&kw={keyword}&m={matchtype}&d={device}&l={loc_physical_ms}&n={network}&u={lpurl}
// Klikgegevens worden na 30 dagen gewist.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const sites = new Map<string, { host: string | null; t: number }>();
const kort = (s: string | null, n = 200) => (s ? s.slice(0, n) : null);
const hostVan = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };

async function siteVan(k: string) {
  const c = sites.get(k);
  if (c && Date.now() - c.t < 600000) return c.host;
  const [r] = await sql`select site from beheersite.klanten where id = ${k}`;
  const host = r ? hostVan(r.site || "") || "" : null; // null = onbekende klant
  sites.set(k, { host, t: Date.now() });
  return host;
}
function ipVan(req: Request) {
  const x = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";
  const ip = x.split(",")[0].trim();
  return /^[0-9a-f:.]{3,45}$/i.test(ip) ? ip : null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url), p = url.searchParams;
  const k = (p.get("k") || "").slice(0, 80);
  const u = p.get("u") || "";
  let doel = "https://sitehulpje.nl/";
  try {
    const host = k ? await siteVan(k) : null;
    // alleen doorsturen naar de eigen site van de klant (geen open redirect)
    if (host && hostVan(u) === host) doel = u;
    else if (host) doel = "https://" + host + "/";
    if (host !== null) {
      const ip = ipVan(req);
      // simpele rem: hetzelfde IP hooguit 60 keer per uur vastleggen
      const [n] = ip ? await sql`select count(*)::int n from beheersite.ads_klikken where klant_id = ${k} and ip = ${ip}::inet and tijd > now() - interval '1 hour'` : [{ n: 0 }];
      if (n.n < 60) await sql`insert into beheersite.ads_klikken (klant_id, gclid, ip, ua, campagne_id, adgroep_id, zoekwoord, matchtype, toestel, plaats, netwerk, test)
        values (${k}, ${kort(p.get("g"), 300)}, ${ip}::inet, ${kort(req.headers.get("user-agent"), 400)}, ${kort(p.get("c"), 30)}, ${kort(p.get("a"), 30)},
          ${kort(p.get("kw"))}, ${kort(p.get("m"), 20)}, ${kort(p.get("d"), 10)}, ${kort(p.get("l"), 20)}, ${kort(p.get("n"), 10)}, ${p.get("t") === "1"})`;
      // af en toe oude klikken wissen (bewaartermijn 30 dagen)
      if (Math.random() < 0.02) await sql`delete from beheersite.ads_klikken where tijd < now() - interval '30 days'`;
    }
  } catch (e) { console.error("klik", e); }
  return new Response(null, { status: 302, headers: { Location: doel, "Cache-Control": "no-store" } });
});
