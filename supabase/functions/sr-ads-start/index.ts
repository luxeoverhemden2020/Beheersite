// Advertenties starten (Supabase Edge Function "sr-ads-start")
// - voorstel: maakt eenmalig een advertentievoorstel (teksten met AI, een paar cent) of geeft het bestaande terug; opnieuw alleen door Jan
// - keuzes: klant past het voorstel aan (teksten, zoekwoorden, budget, doel)
// - akkoord: klant geeft akkoord -> mail naar Jan. Zet NIETS aan in Google Ads.
// - aanvraag/status: oude eenvoudige aanvraag (blijft werken)
import postgres from "npm:postgres@3.4.5";
import { maakVoorstel } from "./voorstel.ts";

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
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);
const DOEL: Record<string, string> = { kopen: "Online iets kopen", bellen: "Bellen of een aanvraag doen", winkel: "Langskomen in de winkel" };

async function gebruikerVan(req: Request) {
  const t = req.headers.get("x-sessie");
  if (!t) return null;
  const [g] = await sql`select g.id, g.rol, g.klant_id, g.email from beheersite.sessies s join beheersite.gebruikers g on g.id = s.gebruiker_id
    where s.token_hash = ${await sha256(t)} and s.verloopt > now() and g.actief`;
  return g || null;
}
async function inst() {
  const r = await sql`select sleutel, waarde from beheersite.instellingen where sleutel in ('resend_sleutel','mail_van','jan_email','platform_url')`;
  return Object.fromEntries(r.map((x) => [x.sleutel, x.waarde])) as Record<string, string>;
}
async function mailJan(onderwerp: string, html: string) {
  try {
    const i = await inst();
    if (!i.resend_sleutel || !i.jan_email) return;
    await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${i.resend_sleutel}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: i.mail_van || "Sitehulpje <info@sitehulpje.nl>", to: [i.jan_email], subject: onderwerp, html }) });
  } catch (e) { console.error("mail", e); }
}
// keuzes van de klant controleren en opschonen
function schoon(k: any, data: any) {
  const uit: any = {};
  if (DOEL[k?.doel]) uit.doel = k.doel;
  if (k?.budget !== undefined) { const b = k.budget === null || k.budget === "" ? null : Number(k.budget); if (b === null || (isFinite(b) && b >= 0 && b <= 100000)) uit.budget = b; }
  if (Array.isArray(k?.uit)) { const ok = new Set((data.zoekwoorden || []).map((z: any) => z.term)); uit.uit = k.uit.map(String).filter((t: string) => ok.has(t)).slice(0, 50); }
  if (Array.isArray(k?.advertenties)) uit.advertenties = k.advertenties.slice(0, 4).map((a: any) => ({
    koppen: (Array.isArray(a?.koppen) ? a.koppen : []).map((x: any) => String(x || "").replace(/\s+/g, " ").trim().slice(0, 30)).filter(Boolean).slice(0, 3),
    tekst: String(a?.tekst || "").replace(/\s+/g, " ").trim().slice(0, 90), aan: a?.aan !== false }));
  if (k?.gebied?.soort === "land") uit.gebied = { soort: "land", landen: (Array.isArray(k.gebied.landen) ? k.gebied.landen : ["NL"]).filter((x: string) => ["NL", "BE"].includes(x)) };
  if (k?.gebied?.soort === "straal" && [10, 25, 50].includes(Number(k.gebied.km))) uit.gebied = { soort: "straal", km: Number(k.gebied.km) };
  if (k?.niet !== undefined) uit.niet = String(k.niet || "").trim().slice(0, 300);
  if (k?.opmerking !== undefined) uit.opmerking = String(k.opmerking || "").trim().slice(0, 1000);
  return uit;
}

async function handel(req: Request, b: any) {
  const g = await gebruikerVan(req);
  if (!g) throw new Fout(401, "Niet ingelogd");
  const kid = g.rol === "admin" && b.klant_id ? String(b.klant_id) : g.klant_id;
  if (!kid) throw new Fout(400, "Geen klant");
  const a = b.actie;

  if (a === "voorstel") {
    let [v] = await sql`select id, data, keuzes, status, gemaakt, akkoord_op from beheersite.ads_voorstellen where klant_id = ${kid} and status in ('concept','akkoord') order by gemaakt desc limit 1`;
    // alleen Jan mag opnieuw laten maken; de klant krijgt altijd het bewaarde voorstel (ook na verversen)
    if (!v || (b.opnieuw && g.rol === "admin" && v.status === "concept")) {
      const data = await maakVoorstel(sql, kid);
      if (v) [v] = await sql`update beheersite.ads_voorstellen set data = ${sql.json(data)}, keuzes = '{}'::jsonb, gemaakt = now(), bijgewerkt = now() where id = ${v.id} returning id, data, keuzes, status, gemaakt, akkoord_op`;
      else [v] = await sql`insert into beheersite.ads_voorstellen (klant_id, data) values (${kid}, ${sql.json(data)}) returning id, data, keuzes, status, gemaakt, akkoord_op`;
    }
    return { voorstel: v };
  }
  if (a === "vstatus") {
    const [v] = await sql`select status, gemaakt, akkoord_op, keuzes, data->'advies' advies from beheersite.ads_voorstellen where klant_id = ${kid} and status in ('concept','akkoord') order by gemaakt desc limit 1`;
    return { voorstel: v || null };
  }
  if (a === "keuzes" || a === "akkoord") {
    const [v] = await sql`select id, data, keuzes, status from beheersite.ads_voorstellen where klant_id = ${kid} and status in ('concept','akkoord') order by gemaakt desc limit 1`;
    if (!v) throw new Fout(404, "Er is nog geen voorstel.");
    const keuzes = { ...(v.keuzes || {}), ...schoon(b.keuzes || {}, v.data) };
    if (a === "keuzes") { await sql`update beheersite.ads_voorstellen set keuzes = ${sql.json(keuzes)}, bijgewerkt = now() where id = ${v.id}`; return { ok: true }; }
    const ads = (keuzes.advertenties || v.data.advertenties || []).filter((x: any) => x.aan !== false && x.koppen?.length && x.tekst);
    if (!ads.length) throw new Fout(400, "Laat minstens één advertentie aan staan.");
    const woorden = (v.data.zoekwoorden || []).filter((z: any) => !(keuzes.uit || []).includes(z.term));
    if (!woorden.length) throw new Fout(400, "Laat minstens één zoekwoord aan staan.");
    await sql`update beheersite.ads_voorstellen set keuzes = ${sql.json(keuzes)}, status = 'akkoord', akkoord_op = now(), bijgewerkt = now() where id = ${v.id}`;
    const [k] = await sql`select naam, site from beheersite.klanten where id = ${kid}`;
    const budget = keuzes.budget === undefined ? v.data.advies : keuzes.budget;
    await mailJan(`Akkoord op advertenties: ${k?.naam || kid}`, `<p><b>${esc(k?.naam || kid)}</b> (${esc(k?.site || "")}) gaf akkoord op het advertentievoorstel.</p>
<ul><li>Doel: ${esc(DOEL[keuzes.doel || v.data.doel] || "")}</li><li>Budget per maand: ${budget ? "€" + Number(budget).toLocaleString("nl-NL") + " excl. btw" : "weet ik nog niet"}</li>
<li>Zoekwoorden (${woorden.length}): ${esc(woorden.map((z: any) => z.term).join(", "))}</li>${keuzes.niet ? `<li>Liever niet: ${esc(keuzes.niet)}</li>` : ""}${keuzes.opmerking ? `<li>Opmerking: ${esc(keuzes.opmerking)}</li>` : ""}</ul>
${ads.map((x: any, n: number) => `<p><b>Advertentie ${n + 1}</b><br>${esc(x.koppen.join(" | "))}<br>${esc(x.tekst)}</p>`).join("")}
<p>Verkopen meten: ${v.data.meting?.bekend ? (v.data.meting.aantal ? "staat aan (" + esc(v.data.meting.namen.join(", ")) + ")" : "<b>staat nog NIET aan</b>, regel dit voor de start") : "onbekend"}.</p>
<p>Er staat nog niets aan in Google Ads.</p>`);
    return { ok: true };
  }
  if (a === "status") {
    const [x] = await sql`select doel, budget_eur::float budget, niet_adverteren, opmerking, status, aangemaakt from beheersite.ads_aanvragen where klant_id = ${kid} and status in ('nieuw','in_behandeling') order by aangemaakt desc limit 1`;
    return { aanvraag: x || null };
  }
  if (a === "aanvraag") {
    const doel = String(b.doel || "");
    if (!DOEL[doel]) throw new Fout(400, "Kies wat mensen moeten doen na een klik.");
    const budget = b.budget === null || b.budget === "" || b.budget === undefined ? null : Number(b.budget);
    await sql`insert into beheersite.ads_aanvragen (klant_id, gebruiker_id, doel, budget_eur, niet_adverteren, opmerking) values (${kid}, ${g.id}, ${doel}, ${budget}, ${String(b.niet || "").slice(0, 300) || null}, ${String(b.opmerking || "").slice(0, 1000) || null})`;
    await mailJan(`Advertenties aangevraagd: ${kid}`, `<p>${esc(kid)} vraagt advertenties aan (${esc(DOEL[doel])}).</p>`);
    return { ok: true };
  }
  if (a === "lijst" && g.rol === "admin") {
    const voorstellen = await sql`select v.id, v.klant_id, k.naam, v.status, v.gemaakt, v.akkoord_op, v.keuzes, v.data from beheersite.ads_voorstellen v join beheersite.klanten k on k.id = v.klant_id order by v.bijgewerkt desc limit 50`;
    return { voorstellen };
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
    return json({ fout: "Er ging iets mis." }, 500);
  }
});
