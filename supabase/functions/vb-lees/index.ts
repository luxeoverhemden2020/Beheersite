// Leesgedrag van de gratis checkrapporten (Supabase Edge Function "vb-lees")
// meet: het rapport meldt hoe ver iemand leest, hoe lang en waarop hij klikt (één rij per bezoek).
// overzicht: alleen voor de beheerder; totalen per check voor het beheer.
// Bezoeken van de beheerder zelf tellen niet mee. Geen cookies, geen kosten.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-sessie, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
class Fout extends Error { constructor(public code: number, msg: string) { super(msg); } }
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (s: string) => b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
const UUID = /^[0-9a-f-]{36}$/i;

async function isBeheerder(req: Request, b: Record<string, unknown>) {
  const t = req.headers.get("x-sessie") || String(b.sessie || "");
  if (!t) return false;
  const [g] = await sql`select g.rol from beheersite.sessies s join beheersite.gebruikers g on g.id = s.gebruiker_id
    where s.token_hash = ${await sha256(t)} and s.verloopt > now() and g.actief`;
  return g?.rol === "admin";
}

async function handel(req: Request, b: Record<string, any>) {
  const a = b.actie;
  if (a === "meet") {
    if (await isBeheerder(req, b)) return { ok: true, eigen: true };
    const bezoek = String(b.bezoek || "");
    if (!/^[A-Za-z0-9_-]{12,40}$/.test(bezoek)) throw new Fout(400, "Ongeldig bezoek");
    const soort = b.soort === "ads" ? "ads" : "website";
    let id: string | undefined;
    if (soort === "website") {
      if (!UUID.test(String(b.id || ""))) throw new Fout(400, "Ongeldig");
      const [c] = await sql`select id from beheersite.vb_checks where id = ${b.id} and token = ${String(b.t || "")}`;
      id = c?.id;
    } else {
      const [c] = await sql`select id from beheersite.ads_checks where token = ${String(b.t || "")}`;
      id = c?.id;
    }
    if (!id) throw new Fout(404, "Onbekend rapport");
    const diepte = Math.max(0, Math.min(100, Math.round(Number(b.diepte) || 0)));
    const sec = Math.max(0, Math.min(7200, Math.round(Number(b.seconden) || 0)));
    const tot = b.tot ? String(b.tot).slice(0, 80) : null;
    const klik = b.klik ? String(b.klik).replace(/\s+/g, " ").trim().slice(0, 60) : null;
    await sql`insert into beheersite.check_lezen (bezoek, soort, check_id, diepte, tot, seconden, klikken)
      values (${bezoek}, ${soort}, ${id}, ${diepte}, ${tot}, ${sec}, ${klik ? [klik] : []})
      on conflict (bezoek) do update set laatst = now(),
        tot = case when excluded.diepte > check_lezen.diepte and excluded.tot is not null then excluded.tot else check_lezen.tot end,
        diepte = greatest(check_lezen.diepte, excluded.diepte),
        seconden = greatest(check_lezen.seconden, excluded.seconden),
        klikken = case when ${klik}::text is null or ${klik}::text = any(check_lezen.klikken) or cardinality(check_lezen.klikken) >= 30
          then check_lezen.klikken else array_append(check_lezen.klikken, ${klik}::text) end
      where check_lezen.check_id = excluded.check_id`;
    return { ok: true };
  }
  if (a === "overzicht") {
    if (!(await isBeheerder(req, b))) throw new Fout(401, "Log opnieuw in.");
    const rijen = await sql`select soort, check_id::text id, count(*)::int keer, max(laatst) laatst, max(diepte)::int diepte,
        (array_agg(tot order by diepte desc) filter (where tot is not null))[1] tot, sum(seconden)::int seconden,
        (select coalesce(array_agg(distinct k), '{}') from beheersite.check_lezen l2, unnest(l2.klikken) k where l2.soort = l.soort and l2.check_id = l.check_id) klikken
      from beheersite.check_lezen l group by soort, check_id`;
    const ads = await sql`select id::text, aangemaakt, naam, bedrijf, email, status, account_naam, verspild_eur, gezien
      from beheersite.ads_checks order by aangemaakt desc limit 50`;
    return { lezen: rijen, ads };
  }
  throw new Fout(400, "Onbekende actie");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fout: "Alleen POST" }, 405);
  try {
    // text/plain zodat de browser geen extra vooraf-verzoek doet en het ook bij wegklikken nog aankomt
    let b: Record<string, unknown> = {};
    try { b = JSON.parse(await req.text()); } catch { /* leeg */ }
    return json(await handel(req, b));
  } catch (e) {
    if (e instanceof Fout) return json({ fout: e.message }, e.code);
    console.error(e);
    return json({ fout: "Er ging iets mis." }, 500);
  }
});
