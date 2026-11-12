// Sitehulpje-aanbod: klant met alleen Sitehulpje neemt Vindbaarheid erbij met 20% korting op het pakket (Supabase Edge Function "sh-aanbod")
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-sessie, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PRIJS: Record<string, number> = { basis: 99, plus: 179, pro: 249 };
const NAAM: Record<string, string> = { basis: "Basis", plus: "Plus", pro: "Pro" };
const KORTING = 0.2;
class Fout extends Error { constructor(public code: number, msg: string) { super(msg); } }
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const euro = (n: number) => "€ " + n.toFixed(2).replace(".", ",");
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");

async function gebruikerVan(req: Request) {
  const t = req.headers.get("x-sessie");
  if (!t) throw new Fout(401, "Niet ingelogd");
  const r = await sql`select g.id, g.rol, g.klant_id, g.email from beheersite.sessies s join beheersite.gebruikers g on g.id = s.gebruiker_id
    where s.token_hash = ${await sha256(t)} and s.verloopt > now() and g.actief`;
  if (!r.length) throw new Fout(401, "Niet ingelogd");
  return r[0];
}
async function inst() {
  const r = await sql`select sleutel, waarde from beheersite.instellingen`;
  return Object.fromEntries(r.map((x) => [x.sleutel, x.waarde])) as Record<string, string>;
}
async function mail(aan: string, onderwerp: string, html: string) {
  const i = await inst();
  if (!i.resend_sleutel || !aan) return false;
  const van = (i.mail_van || "Sitehulpje <onboarding@resend.dev>").replace(/^[^<]*</, "Sitehulpje <");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${i.resend_sleutel}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: van, to: [aan], reply_to: "info@sitehulpje.nl", subject: onderwerp,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0B1B3F;max-width:560px">${html}</div>` }),
  });
  return r.ok;
}
const magAanbod = (k: any) => k && k.actief !== false && !k.vindbaarheid && !k.vb_pakket && !k.vb_pauze && !k.opzeg_per;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const b = await req.json().catch(() => ({}));
    const g = await gebruikerVan(req);
    if (!g.klant_id) throw new Fout(403, "Dit aanbod is voor klanten.");
    const [k] = await sql`select * from beheersite.klanten where id = ${g.klant_id}`;
    if (!k) throw new Fout(404, "Account niet gevonden.");
    const shNu = Number(k.sh_prijs) || 0, shNieuw = shNu === 125 ? 75 : shNu;

    if (b.actie === "status") {
      return json({ mag: magAanbod(k), korting_pct: KORTING * 100, sh_nu: shNu, sh_nieuw: shNieuw,
        pakketten: Object.fromEntries(Object.entries(PRIJS).map(([p, v]) => [p, { naam: NAAM[p], prijs: v, met_korting: Math.round(v * (1 - KORTING) * 100) / 100 }])) });
    }
    if (b.actie === "kies") {
      const p = String(b.pakket || "");
      if (!PRIJS[p]) throw new Fout(400, "Kies een pakket.");
      if (!magAanbod(k)) throw new Fout(400, "Dit aanbod is niet (meer) beschikbaar voor je account. Neem gerust contact met ons op.");
      const kortingEur = Math.round(PRIJS[p] * KORTING * 100) / 100;
      const heeftKorting = Number(k.korting_pct) > 0 || Number(k.korting_eur) > 0;
      if (heeftKorting) {
        await sql`update beheersite.klanten set vindbaarheid = true, vb_pakket = ${p}, vb_start = now(), sh_prijs = ${shNieuw} where id = ${k.id}`;
      } else {
        await sql`update beheersite.klanten set vindbaarheid = true, vb_pakket = ${p}, vb_start = now(), sh_prijs = ${shNieuw},
          korting_eur = ${kortingEur}, korting_pct = null, korting_van = null, korting_tot = (current_date + interval '1 year' - interval '1 day')::date,
          ads_korting_tot = coalesce(ads_korting_tot, (current_date + interval '1 year' - interval '1 day')::date),
          korting_reden = 'Sitehulpje-aanbod: 20% op Vindbaarheid', korting_gemeld = false where id = ${k.id}`;
      }
      const totaal = Math.round((PRIJS[p] - kortingEur + shNieuw) * 100) / 100;
      const i = await inst();
      await mail(g.email, "Vindbaarheid staat voor je aan", `<p>Hoi,</p>
        <p>Leuk dat je Vindbaarheid erbij neemt! Je hebt nu het pakket <b>${NAAM[p]}</b> met 20% korting: het eerste jaar ${euro(PRIJS[p] - kortingEur)} per maand in plaats van ${euro(PRIJS[p])}.${shNu !== shNieuw ? ` Sitehulpje webbeheer kost je daardoor nog maar ${euro(shNieuw)} per maand.` : ""}</p>
        <p>Vanaf de volgende factuur betaal je samen ${euro(totaal)} per maand (excl. btw). De minimale looptijd van Vindbaarheid is 3 maanden.</p>
        <p>Log in op <a href="https://sitehulpje.nl/portaal">sitehulpje.nl/portaal</a>. Daar zetten we in een paar korte stappen alles voor je klaar.</p>
        <p style="color:#4A5878;font-size:14px">Was dit niet de bedoeling? Beantwoord deze mail, dan zetten we het terug.</p>`);
      await mail(i.jan_email, `Aanbod aangenomen: ${k.naam} neemt Vindbaarheid ${NAAM[p]}`, `<p><b>${esc(k.naam)}</b> (${esc(k.site || "")}) heeft via het Sitehulpje-aanbod Vindbaarheid <b>${NAAM[p]}</b> erbij genomen.</p>
        <p>Nieuw maandbedrag: ${euro(totaal)} excl. btw (Vindbaarheid ${euro(PRIJS[p])} − 20% = ${euro(PRIJS[p] - kortingEur)}, Sitehulpje ${euro(shNieuw)}).</p>
        ${heeftKorting ? `<p><b>Let op:</b> deze klant had al een persoonlijke korting. Die heb ik laten staan; de 20% is dus nog niet verwerkt. Pas de korting zelf aan in beheer.</p>` : ""}
        <p><a href="https://sitehulpje.nl/beheer">Naar beheer</a></p>`);
      return json({ ok: true, pakket: NAAM[p], totaal });
    }
    if (b.actie === "ads") {
      // klant uit het aanbod kijkt naar advertenties: 20% korting op het advertentiebeheer, als hij binnen een jaar start
      if (magAanbod(k)) await sql`update beheersite.klanten set ads_korting_tot = coalesce(ads_korting_tot, (current_date + interval '1 year' - interval '1 day')::date) where id = ${k.id}`;
      return json({ ok: true });
    }
    throw new Fout(400, "Onbekende actie.");
  } catch (e) {
    return json({ fout: e instanceof Fout ? e.message : "Er ging iets mis. Probeer het later nog eens." }, e instanceof Fout ? e.code : 500);
  }
});
