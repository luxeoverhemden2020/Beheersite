// Sitehulpje – zelf bestellen via de site (Supabase Edge Function "vb-bestel")
// adres (postcode-check via PDOK) → plaats (bestelling + eerste betaling via vb-factuur/Mollie)
// → na betaling maakt "betaald" het account aan, stuurt de welkomstmail en meldt het aan Jan.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1/`;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-sessie, x-cron-key, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
class Fout extends Error { constructor(public code: number, msg: string) { super(msg); } }
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomToken = () => b64u(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (s: string) => b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
async function gebruikerVan(req: Request) {
  const t = req.headers.get("x-sessie");
  if (!t) throw new Fout(401, "Niet ingelogd");
  const [g] = await sql`select g.id, g.rol, g.klant_id, g.email from beheersite.sessies s join beheersite.gebruikers g on g.id = s.gebruiker_id
    where s.token_hash = ${await sha256(t)} and s.verloopt > now() and g.actief`;
  if (!g) throw new Fout(401, "Niet ingelogd");
  return g;
}
// welk systeem draait de site? (eenvoudige herkenning aan de homepage)
async function herken(site: string) {
  try {
    const r = await fetch(site, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SitehulpjeCheck/1.0)" }, signal: AbortSignal.timeout(10000) });
    const h = (await r.text()).slice(0, 400000).toLowerCase();
    if (h.includes("woocommerce")) return "woocommerce";
    if (h.includes("wp-content") || h.includes("wp-includes")) return "wordpress";
    if (h.includes("cdn.shopify.com")) return "shopify";
    if (h.includes("wixstatic.com") || h.includes("wix.com")) return "wix";
    if (h.includes("squarespace")) return "squarespace";
    if (h.includes("lightspeed") || h.includes("webshopapp.com")) return "lightspeed";
    if (h.includes("mage/") || h.includes("magento")) return "magento";
  } catch { /* */ }
  return "onbekend";
}
const PAKKET: Record<string, { naam: string; prijs: number }> = { basis: { naam: "Basis", prijs: 99 }, plus: { naam: "Plus", prijs: 179 }, pro: { naam: "Pro", prijs: 249 } };
// Sitehulpje-pakketten (Sitehulpje zit erin, Pro ook advertentiebeheer); nieuwe klanten 10% korting het eerste jaar
const BUNDEL: Record<string, number> = { basis: 169, plus: 239, pro: 369 };
const BUNDEL_KORTING = 0.10;
const SH_MET = 75, SH_LOS = 125;
const VOORWAARDEN_VERSIE = "2026-11";

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
    body: JSON.stringify({ from: van, to: [aan], reply_to: "info@sitehulpje.nl", subject: onderwerp, html }),
  });
  return r.ok;
}
// mails in Sitehulpje-stijl (zelfde als de website-check)
const LOGO = "https://sitehulpje.nl/assets/icoon-192.png";
function kader(inhoud: string, o: { kop?: string; sub?: string } = {}) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef4fb">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4fb;padding:24px 10px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:separate">
    <tr><td style="border-radius:22px 22px 0 0;background:#0c1a36;background-image:radial-gradient(120% 160% at 100% 0%,rgba(139,92,246,.55),transparent 55%),radial-gradient(100% 140% at 0% 100%,rgba(34,227,196,.45),transparent 55%),linear-gradient(160deg,#081226,#0c1a36 60%,#101034);padding:22px 24px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle"><img src="${LOGO}" width="44" height="44" alt="" style="display:block;border-radius:12px"></td>
        <td valign="middle" style="padding-left:10px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#ffffff">Site<span style="color:#22e3c4;font-family:'JetBrains Mono',Menlo,Consolas,monospace">hulpje</span></td></tr></table>
      ${o.kop ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.15;font-weight:700;color:#ffffff;margin-top:18px">${o.kop}</div>` : ""}
      ${o.sub ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#a9bdd8;margin-top:6px">${o.sub}</div>` : ""}</td></tr>
    <tr><td style="height:4px;line-height:4px;font-size:0;background:#22e3c4;background-image:linear-gradient(90deg,#22e3c4,#3b82f6,#8b5cf6)">&nbsp;</td></tr>
    <tr><td style="background:#ffffff;border-radius:0 0 22px 22px;padding:26px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#0b1a2e;box-shadow:0 14px 34px -14px rgba(20,50,100,.25)">${inhoud}</td></tr>
    <tr><td align="center" style="padding:18px 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#5a6b82">
      Sitehulpje · een dienst van Siteregelaar · Markt 9, 7551 CG Hengelo<br>info@sitehulpje.nl · 06 27 25 43 83 · <a href="https://sitehulpje.nl" style="color:#0b9f8a">sitehulpje.nl</a></td></tr>
  </table></td></tr></table></body></html>`;
}
const knop = (link: string, tekst: string) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0"><tr><td style="border-radius:12px;background:#0b9f8a;background-image:linear-gradient(135deg,#22e3c4,#3b82f6)">
  <a href="${link}" style="display:inline-block;padding:14px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#04111a;text-decoration:none;border-radius:12px">${tekst} &rarr;</a></td></tr></table>`;
const cronSleutel = async () => (await inst()).cron_sleutel || "";

// ---------- prijzen ----------
export function prijzen(pakket: string | null, sitehulpje: boolean, bundel = false) {
  if (bundel && pakket && BUNDEL[pakket]) {
    const t = Math.round(BUNDEL[pakket] * (1 - BUNDEL_KORTING) * 100) / 100;
    return { vb: t, sh: 0, totaal: t, vol: BUNDEL[pakket] };
  }
  const vb = pakket ? PAKKET[pakket].prijs : 0;
  const sh = sitehulpje ? (pakket ? SH_MET : SH_LOS) : 0;
  return { vb, sh, totaal: vb + sh, vol: vb + sh };
}
const watNaam = (pakket: string | null, sitehulpje: boolean, bundel: boolean) => bundel && pakket
  ? `Sitehulpje ${PAKKET[pakket].naam}`
  : [pakket ? `Vindbaarheid ${PAKKET[pakket].naam}` : "", sitehulpje ? "Sitehulpje" : ""].filter(Boolean).join(" + ");

// ---------- adres via PDOK (gratis adresservice van de overheid) ----------
async function adres(postcode: string, nummer: string) {
  const pc = postcode.toUpperCase().replace(/\s/g, "");
  const m = nummer.trim().match(/^(\d{1,5})\s*[-\s]?\s*([a-zA-Z0-9]{0,4})$/);
  if (!/^\d{4}[A-Z]{2}$/.test(pc) || !m) return { gevonden: false };
  const q = new URLSearchParams({ q: `postcode:${pc} and huisnummer:${m[1]}`, fq: "type:adres", rows: "10", fl: "straatnaam,woonplaatsnaam,huisnummer,huisletter,huisnummertoevoeging,postcode" });
  try {
    const r = await fetch(`https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?${q}`, { signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    const docs: any[] = d?.response?.docs || [];
    if (!docs.length) return { gevonden: false };
    const t = (m[2] || "").toUpperCase();
    const doc = docs.find((x) => ((x.huisletter || "") + (x.huisnummertoevoeging || "")).toUpperCase() === t) || docs[0];
    return { gevonden: true, straat: doc.straatnaam, plaats: doc.woonplaatsnaam, postcode: `${pc.slice(0, 4)} ${pc.slice(4)}` };
  } catch { return { gevonden: false, storing: true }; }
}

// ---------- invoer ----------
const tekst = (x: unknown, max = 200) => String(x ?? "").trim().slice(0, max);
const isMail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
function siteVan(s: string) {
  try { const u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s); return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) ? u.origin : null; } catch { return null; }
}
const _ip = new Map<string, number[]>();

async function slug(naam: string) {
  const basis = naam.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " en ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "klant";
  for (let i = 0; i < 50; i++) {
    const id = i ? `${basis}-${i + 1}` : basis;
    const [x] = await sql`select 1 from beheersite.klanten where id = ${id}`;
    if (!x) return id;
  }
  return `${basis}-${Date.now().toString(36)}`;
}

// ---------- kortingscodes ----------
const codeNorm = (c: unknown) => String(c || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 30);
async function codeVan(c: string) {
  if (!c) return null;
  const vandaag = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
  const [k] = await sql`select * from beheersite.kortingscodes where code = ${c} and actief and (geldig_tot is null or geldig_tot >= ${vandaag}) and (max_gebruik is null or gebruikt < max_gebruik)`;
  return k || null;
}
// korting voor dit abonnement: per onderdeel wordt omgerekend naar een vast bedrag per maand
export function codeKorting(k: any, vb: number, sh: number) {
  if (k.soort === "deel") return { soort: "eur", waarde: Math.round(vb * Number(k.pct_vb || 0) + sh * Number(k.pct_sh || 0)) / 100 };
  return { soort: k.soort, waarde: Number(k.waarde) };
}
const codeTekst = (k: any) => `${k.soort === "deel" ? [Number(k.pct_sh) ? `${Number(k.pct_sh)}% op Sitehulpje` : "", Number(k.pct_vb) ? `${Number(k.pct_vb)}% op Vindbaarheid` : ""].filter(Boolean).join(" en ").replace(/^/, "Korting: ") + (k.maanden ? (k.maanden === 1 ? ", alleen de eerste maand" : `, de eerste ${k.maanden} maanden`) : "") + "​" : k.soort === "pct" ? `${Number(k.waarde)}% korting` : `€${Number(k.waarde).toLocaleString("nl-NL")} korting per maand`}${k.soort !== "deel" && k.maanden ? (k.maanden === 1 ? " op de eerste maand" : ` op de eerste ${k.maanden} maanden`) : ""}`.replace("​", "");

// ---------- na betaling: account aanmaken, welkom, melding ----------
async function betaald(id: string, mollieKlant: string, mandaat: string | null) {
  const [bs] = await sql`select * from beheersite.vb_bestellingen where id = ${id}`;
  if (!bs) throw new Fout(404, "Bestelling niet gevonden");
  if (bs.klant_id) return { klant_id: bs.klant_id, nieuw: false };
  const g = bs.gegevens, bun = !!bs.bundel && !!bs.pakket, p = prijzen(bs.pakket, bs.sitehulpje, bun);
  const kid = await slug(g.bedrijf.naam);
  const vandaag = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
  const kortingTot = bun ? new Date(Date.now() + 365 * 86400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" }) : null;
  // bij een pakket staat sh_prijs alleen als teken "Sitehulpje zit erin"; de prijs komt uit het pakket
  const shPrijs = bun ? SH_MET : (p.sh || null);
  await sql.begin(async (t) => {
    await t`insert into beheersite.klanten (id, naam, site, vindbaarheid, vb_pakket, vb_start, mollie_klant, mollie_mandaat, sh_prijs, vb_rapport_mail, bundel, bundel_korting_tot)
      values (${kid}, ${g.bedrijf.naam}, ${g.site}, ${!!bs.pakket}, ${bs.pakket}, ${bs.pakket ? vandaag : null}, ${mollieKlant}, ${mandaat}, ${shPrijs}, ${bs.pakket ? g.email : null}, ${bun ? bs.pakket : null}, ${kortingTot})`;
    const [bestaat] = await t`select id from beheersite.gebruikers where email = ${g.email}`;
    if (bestaat) await t`update beheersite.gebruikers set klant_id = coalesce(klant_id, ${kid}), actief = true where id = ${bestaat.id} and rol = 'klant'`;
    else await t`insert into beheersite.gebruikers (email, naam, rol, klant_id, wachtwoord_hash, inloglink)
      values (${g.email}, ${g.bedrijf.contact}, 'klant', ${kid}, extensions.crypt(${randomToken()}, extensions.gen_salt('bf', 10)), ${randomToken() + randomToken()})`;
    await t`insert into beheersite.vb_onboarding (klant_id, gegevens, akkoord, welkom_gestuurd) values (${kid}, ${t.json({ bedrijf: g.bedrijf })}, ${t.json(bs.akkoord)}, ${bs.pakket ? new Date() : null})
      on conflict (klant_id) do update set gegevens = beheersite.vb_onboarding.gegevens || excluded.gegevens, akkoord = excluded.akkoord, welkom_gestuurd = coalesce(beheersite.vb_onboarding.welkom_gestuurd, excluded.welkom_gestuurd)`;
    await t`update beheersite.vb_bestellingen set klant_id = ${kid}, status = 'betaald' where id = ${id}`;
  });
  // kortingscode: geldt meteen (ook al voor de eerste betaling), tot en met de laatste dag van de laatste maand
  if (bs.kortingscode) {
    const [kc] = await sql`select * from beheersite.kortingscodes where code = ${bs.kortingscode}`;
    if (kc) {
      const nu = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
      const tot = kc.maanden ? new Date(Date.UTC(nu.getFullYear(), nu.getMonth() + kc.maanden, 0)).toISOString().slice(0, 10) : null;
      const kk = codeKorting(kc, p.vb, p.sh);
      await sql`update beheersite.klanten set korting_pct = ${kk.soort === "pct" ? kk.waarde : null}, korting_eur = ${kk.soort === "eur" ? kk.waarde : null},
        korting_van = null, korting_tot = ${tot}, korting_reden = ${"Kortingscode " + kc.code}, korting_gemeld = false where id = ${kid}`;
      await sql`update beheersite.kortingscodes set gebruikt = gebruikt + 1 where code = ${kc.code}`;
    }
  }
  // vriend-voordeel: allebei de volgende volle maand korting (alleen als er nog geen andere korting loopt)
  const i = await inst();
  if (bs.vriend) {
    const pct = Number(i.vriend_korting_pct || 50);
    const nu = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
    const eind = new Date(Date.UTC(nu.getFullYear(), nu.getMonth() + 2, 0)).toISOString().slice(0, 10);
    const [vk] = await sql`select id, naam from beheersite.klanten where vriend_code = ${bs.vriend}`;
    const zet = (id: string, reden: string) => sql`update beheersite.klanten set korting_pct = ${pct}, korting_eur = null, korting_van = ${eind.slice(0, 8) + "01"}, korting_tot = ${eind}, korting_reden = ${reden}, korting_gemeld = true
      where id = ${id} and korting_pct is null and korting_eur is null returning id`;
    const a1 = pct > 0 ? await zet(kid, "Vriendenkorting") : [];
    const a2 = pct > 0 && vk ? await zet(vk.id, `Vriendenkorting (${g.bedrijf.naam})`) : [];
    await mail(i.jan_email, `[Sitehulpje] Vriend-voordeel: ${g.bedrijf.naam} via ${vk?.naam || bs.vriend}`, kader(`<p style="margin:0">${esc(g.bedrijf.naam)} kwam via de link van <b>${esc(vk?.naam || bs.vriend)}</b>. ${pct}% korting volgende maand: nieuwe klant ${a1.length ? "gezet" : "niet gezet (had al korting)"}, ${esc(vk?.naam || "aanbrenger")} ${a2.length ? "gezet" : "niet gezet (had al korting)"}.</p>`, { kop: "Vriend-voordeel", sub: esc(g.bedrijf.naam) }));
    if (vk && a2.length) {
      const [u] = await sql`select email from beheersite.gebruikers where klant_id = ${vk.id} and rol = 'klant' and actief limit 1`;
      if (u) await mail(u.email, `Dank je wel voor het doorsturen!`, kader(`<p style="margin:0 0 12px">Hoi,</p><p style="margin:0 0 12px"><b>${esc(g.bedrijf.naam)}</b> is via jouw link klant geworden bij Sitehulpje. Als dank krijg je volgende maand <b>${pct}% korting</b>. Dat zie je vanzelf op je factuur.</p><p style="margin:0">Groet,<br><b>Jan</b></p>`, { kop: "Bedankt!", sub: "Vriend-voordeel" }));
    }
  }
  // welkomstmail met inloglink
  let [u] = await sql`select id, inloglink from beheersite.gebruikers where email = ${g.email}`;
  if (u && !u.inloglink) { const l = randomToken() + randomToken(); await sql`update beheersite.gebruikers set inloglink = ${l} where id = ${u.id}`; u.inloglink = l; }
  const link = `${i.platform_url || "https://sitehulpje.nl"}/?link=${u?.inloglink || ""}`;
  const voornaam = esc(String(g.bedrijf.contact || "").split(" ")[0]);
  const wat = watNaam(bs.pakket, bs.sitehulpje, bun);
  const stappen = bs.pakket
    ? `<p style="margin:0 0 10px">We hebben nog een paar dingen van je nodig om te beginnen: wat je wilt bereiken, Google koppelen (één klik) en toegang tot je website. Dat kost ongeveer 10 minuten. Je bedrijfsgegevens en akkoord hebben we al.</p>${knop(link + "#vindbaarheid", "Start de laatste stappen")}`
    : `<p style="margin:0 0 10px">Nog één stap: geef ons toegang tot je website. In de app staat precies hoe dat moet voor jouw systeem, het kost een paar minuten. Daarna kun je meteen je eerste verzoek doen.</p>${knop(link, "Open je Sitehulpje")}`;
  await mail(g.email, `Welkom bij Sitehulpje! Je bestelling is gelukt`, kader(`<p style="margin:0 0 12px">Hoi ${voornaam},</p>
    <p style="margin:0 0 12px">Bedankt voor je bestelling van <b>${esc(wat)}</b>. Je betaling is gelukt, de factuur krijg je apart.</p>${stappen}
    <p style="margin:0;color:#5a6b82;font-size:14px">Met deze knop log je direct in. Zet Sitehulpje daarna op je telefoon, dan heb je je webbouwer altijd bij de hand. Vragen? Beantwoord gewoon deze mail.</p>`,
    { kop: "Welkom bij Sitehulpje", sub: esc(g.site.replace(/^https?:\/\/(www\.)?/, "")) }));
  await mail(i.jan_email, `[Sitehulpje] Nieuwe bestelling: ${g.bedrijf.naam} – ${wat}`, kader(`<p style="margin:0 0 10px"><b>${esc(g.bedrijf.naam)}</b> heeft besteld en de eerste betaling gedaan.</p>
    <p style="margin:0 0 10px">${esc(wat)} · €${p.totaal.toLocaleString("nl-NL")} per maand excl. btw${bun ? ` (eerste jaar 10% korting, daarna €${p.vol})` : ""}<br>${esc(g.bedrijf.contact)} · ${esc(g.email)} · ${esc(g.bedrijf.telefoon || "-")}<br>${esc(g.site)}${bs.ref ? `<br>Via: ${esc(bs.ref)}` : ""}${bs.kortingscode ? `<br>Kortingscode: <b>${esc(bs.kortingscode)}</b>` : ""}</p>
    <p style="margin:0">${bs.pakket ? "De klant heeft de welkomstmail met de startstappen gekregen." : "De klant geeft ons zelf toegang tot de website via de app; je krijgt een seintje als dat gedaan is."}</p>
    ${knop("https://sitehulpje.nl/beheer", "Naar beheer")}`, { kop: "Nieuwe bestelling", sub: esc(g.bedrijf.naam) }));
  return { klant_id: kid, nieuw: true };
}

async function handel(req: Request, b: any) {
  const a = b.actie;
  if (a === "code_check") {
    const k = await codeVan(codeNorm(b.code));
    return k ? { geldig: true, code: k.code, soort: k.soort, waarde: Number(k.waarde || 0), pct_vb: Number(k.pct_vb || 0), pct_sh: Number(k.pct_sh || 0), maanden: k.maanden, tekst: codeTekst(k) } : { geldig: false };
  }
  if (["codes", "code_zet", "code_aan"].includes(a)) {
    const g = await gebruikerVan(req);
    if (g.rol !== "admin") throw new Fout(403, "Geen toegang");
    if (a === "code_zet") {
      const code = codeNorm(b.code), soort = ["eur", "deel"].includes(b.soort) ? b.soort : "pct", waarde = soort === "deel" ? null : Number(b.waarde);
      const pvb = soort === "deel" ? Number(b.pct_vb || 0) : null, psh = soort === "deel" ? Number(b.pct_sh || 0) : null;
      const maanden = b.maanden ? Math.round(Number(b.maanden)) : null, max = b.max_gebruik ? Math.round(Number(b.max_gebruik)) : null;
      const tot = /^\d{4}-\d{2}-\d{2}$/.test(String(b.geldig_tot || "")) ? String(b.geldig_tot) : null;
      if (code.length < 3) throw new Fout(400, "Een code heeft minimaal 3 letters of cijfers.");
      if (soort === "deel" ? !((pvb! + psh!) > 0 && pvb! <= 100 && psh! <= 100 && pvb! >= 0 && psh! >= 0) : (!(waarde! > 0) || (soort === "pct" && waarde! > 100))) throw new Fout(400, "Vul een geldige korting in.");
      if (maanden !== null && !(maanden >= 1 && maanden <= 60)) throw new Fout(400, "Aantal maanden moet tussen 1 en 60 liggen.");
      await sql`insert into beheersite.kortingscodes (code, soort, waarde, pct_vb, pct_sh, maanden, geldig_tot, max_gebruik, omschrijving)
        values (${code}, ${soort}, ${waarde}, ${pvb}, ${psh}, ${maanden}, ${tot}, ${max}, ${tekst(b.omschrijving, 200) || null})
        on conflict (code) do update set soort = excluded.soort, waarde = excluded.waarde, pct_vb = excluded.pct_vb, pct_sh = excluded.pct_sh, maanden = excluded.maanden, geldig_tot = excluded.geldig_tot,
          max_gebruik = excluded.max_gebruik, omschrijving = excluded.omschrijving, actief = true`;
    }
    if (a === "code_aan") await sql`update beheersite.kortingscodes set actief = ${b.aan === true} where code = ${codeNorm(b.code)}`;
    const lijst = await sql`select code, soort, waarde::float waarde, pct_vb::float pct_vb, pct_sh::float pct_sh, maanden, geldig_tot, max_gebruik, gebruikt, actief, omschrijving from beheersite.kortingscodes order by aangemaakt desc`;
    return { codes: lijst.map((k) => ({ ...k, tekst: codeTekst(k) })) };
  }
  if (a === "adres") return await adres(tekst(b.postcode, 10), tekst(b.huisnummer, 12));

  if (a === "plaats") {
    if (b.website2) return { ok: true }; // spamval
    const ip = (req.headers.get("x-forwarded-for") || "?").split(",")[0].trim();
    const nu = Date.now(), lijst = (_ip.get(ip) || []).filter((t) => nu - t < 3600_000);
    if (lijst.length >= 5) throw new Fout(429, "Je hebt al een paar keer geprobeerd te bestellen. Bel of mail ons gerust, dan regelen we het samen.");
    const pakket = PAKKET[b.pakket] ? String(b.pakket) : null;
    const bundel = b.bundel === true && !!pakket, sitehulpje = bundel || b.sitehulpje === true;
    if (!pakket && !sitehulpje) throw new Fout(400, "Kies een pakket of Sitehulpje.");
    const site = siteVan(tekst(b.site, 200));
    if (!site) throw new Fout(400, "Vul het adres van je website in, bijvoorbeeld www.jouwbedrijf.nl.");
    const email = tekst(b.email, 150).toLowerCase();
    if (!isMail(email)) throw new Fout(400, "Vul een geldig e-mailadres in.");
    const bedrijf = {
      naam: tekst(b.bedrijf, 120), contact: tekst(b.naam, 80), telefoon: tekst(b.telefoon, 30),
      postcode: tekst(b.postcode, 10).toUpperCase().replace(/^(\d{4})\s*([A-Z]{2})$/, "$1 $2"), huisnummer: tekst(b.huisnummer, 12),
      straat: "", plaats: "", kvk: tekst(b.kvk, 12).replace(/\D/g, ""), btw: tekst(b.btw, 20).toUpperCase().replace(/\s/g, ""), factuur_email: email,
    };
    if (bedrijf.naam.length < 2) throw new Fout(400, "Vul de naam van je bedrijf in.");
    if (bedrijf.contact.length < 3) throw new Fout(400, "Vul je naam in.");
    if (bedrijf.kvk && bedrijf.kvk.length !== 8) throw new Fout(400, "Een KvK-nummer heeft 8 cijfers.");
    const [al] = await sql`select 1 from beheersite.gebruikers where email = ${email}`;
    if (al) throw new Fout(409, "Er is al een Sitehulpje-account met dit e-mailadres. Log in, of bel ons, dan zetten we het erbij.");
    // adres altijd zelf opnieuw opzoeken; lukt dat niet, dan wat de klant intypte
    const ad = await adres(bedrijf.postcode, bedrijf.huisnummer);
    if (ad.gevonden) { bedrijf.straat = `${ad.straat} ${bedrijf.huisnummer}`; bedrijf.plaats = ad.plaats!; bedrijf.postcode = ad.postcode!; }
    else if ((ad as any).storing && tekst(b.straat, 120) && tekst(b.plaats, 80)) { bedrijf.straat = `${tekst(b.straat, 120)} ${bedrijf.huisnummer}`; bedrijf.plaats = tekst(b.plaats, 80); }
    else throw new Fout(400, "We vinden dit adres niet. Controleer je postcode en huisnummer.");
    const ondertekend = tekst(b.handtekening, 120);
    if (!b.voorwaarden || !b.verwerker) throw new Fout(400, "Vink beide vakjes aan om akkoord te gaan.");
    if (ondertekend.length < 3) throw new Fout(400, "Typ je volledige naam als ondertekening.");
    const p = prijzen(pakket, sitehulpje, bundel);
    const akkoord = {
      versie: VOORWAARDEN_VERSIE, naam: ondertekend, datum: new Date().toISOString(), email, pakket, bundel,
      prijs: bundel ? p.vol : (p.vb || null), korting_eerste_jaar: bundel ? "10%" : null, sitehulpje, sitehulpje_prijs: bundel ? null : (p.sh || null),
      minimaal_maanden: pakket ? 3 : null, via: "bestellen", ip: ip.slice(0, 60), browser: (req.headers.get("user-agent") || "").slice(0, 200),
    };
    lijst.push(nu); _ip.set(ip, lijst);
    const ref = /^(check:[0-9a-f-]{36}|partner:[a-z0-9-]{1,30})$/i.test(String(b.ref || "")) ? String(b.ref) : null;
    const vcode = String(b.vriend || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
    const [vk] = vcode ? await sql`select id from beheersite.klanten where vriend_code = ${vcode} and actief` : [];
    const kcode = codeNorm(b.kortingscode);
    const kc = kcode ? await codeVan(kcode) : null;
    if (kcode && !kc) throw new Fout(400, "Deze kortingscode kennen we niet, of hij is verlopen. Haal hem weg of controleer de spelling.");
    const [bs] = await sql`insert into beheersite.vb_bestellingen (pakket, sitehulpje, bundel, gegevens, akkoord, ip, ref, vriend, kortingscode)
      values (${pakket}, ${sitehulpje}, ${bundel}, ${sql.json({ email, site, bedrijf, bericht: tekst(b.bericht, 1000) })}, ${sql.json(akkoord)}, ${ip.slice(0, 60)}, ${ref}, ${vk && !kc ? vcode : null}, ${kc ? kc.code : null}) returning id, token`;
    const r = await fetch(FN + "vb-factuur", { method: "POST", headers: { "Content-Type": "application/json", "x-cron-key": await cronSleutel() }, body: JSON.stringify({ actie: "bestel_betaling", id: bs.id }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.url) {
      await sql`update beheersite.vb_bestellingen set status = 'fout', fout = ${String(d.fout || r.status).slice(0, 300)} where id = ${bs.id}`;
      throw new Fout(502, d.fout || "Betalen kon niet starten. Probeer het zo nog eens, of bel ons.");
    }
    return { ok: true, url: d.url, id: bs.id, token: bs.token };
  }

  if (a === "hervat") {
    // link uit de herinneringsmail: nieuwe betaling voor dezelfde bestelling
    const [bs] = await sql`select id, status from beheersite.vb_bestellingen where id = ${String(b.id || "")} and token = ${String(b.t || "")}`;
    if (!bs) throw new Fout(404, "Bestelling niet gevonden.");
    if (bs.status === "betaald") return { ok: true, betaald: true };
    if (bs.status !== "nieuw") await sql`update beheersite.vb_bestellingen set status = 'nieuw', betaallink = null, mollie_betaling = null where id = ${bs.id}`;
    const r = await fetch(FN + "vb-factuur", { method: "POST", headers: { "Content-Type": "application/json", "x-cron-key": await cronSleutel() }, body: JSON.stringify({ actie: "bestel_betaling", id: bs.id }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.url) throw new Fout(502, d.fout || "Betalen kon niet starten. Bel ons gerust.");
    return { ok: true, url: d.url };
  }
  if (a === "status") {
    const [bs] = await sql`select status, pakket, sitehulpje, bundel, gegevens->>'email' email from beheersite.vb_bestellingen where id = ${String(b.id || "")} and token = ${String(b.t || "")}`;
    if (!bs) throw new Fout(404, "Bestelling niet gevonden.");
    return bs;
  }

  if (a === "betaald") {
    if (req.headers.get("x-cron-key") !== (await cronSleutel())) throw new Fout(401, "Geen toegang");
    return await betaald(String(b.id || ""), String(b.mollie_klant || ""), b.mandaat ? String(b.mandaat) : null);
  }
  if (a === "sh_status" || a === "sh_gedaan") {
    // startstap voor klanten met alleen Sitehulpje: ons toegang geven tot de website
    const g = await gebruikerVan(req);
    const [k] = await sql`select k.id, k.naam, k.site, k.sh_prijs, k.vindbaarheid, k.deurbel_url, o.stappen, o.platform from beheersite.klanten k
      left join beheersite.vb_onboarding o on o.klant_id = k.id where k.id = ${g.klant_id}`;
    if (!k || !(Number(k.sh_prijs) > 0) || k.vindbaarheid) return { nodig: false };
    const [toe] = await sql`select status from beheersite.site_toegang where klant_id = ${k.id}`;
    if (k.deurbel_url || toe?.status === "gekoppeld") return { nodig: false, klaar: true };
    let platform = k.platform;
    if (!platform) { platform = await herken(k.site); await sql`update beheersite.vb_onboarding set platform = ${platform} where klant_id = ${k.id}`; }
    if (a === "sh_status") return { nodig: true, platform, site: k.site, website: k.stappen?.website || null };
    const keuze = ["gedaan", "webbouwer"].includes(String(b.keuze)) ? String(b.keuze) : "";
    if (!keuze) throw new Fout(400, "Onbekende keuze.");
    const info = { status: keuze, datum: new Date().toISOString(), notitie: tekst(b.notitie, 500), webbouwer: tekst(b.webbouwer, 160), door: "klant" };
    await sql`update beheersite.vb_onboarding set stappen = jsonb_set(coalesce(stappen, '{}'::jsonb), '{website}', ${sql.json(info)}::jsonb, true) where klant_id = ${k.id}`;
    const i = await inst();
    await mail(i.jan_email, `[Sitehulpje] ${k.naam}: toegang tot de website`, kader(`<p style="margin:0 0 10px"><b>${esc(k.naam)}</b> (${esc(k.site)}, ${esc(platform)}) ${keuze === "gedaan"
      ? "heeft info@sitehulpje.nl toegevoegd aan de website. Accepteer de uitnodiging in je mail en zet daarna de koppeling op."
      : `laat de toegang regelen door de webbouwer${info.webbouwer ? `: <b>${esc(info.webbouwer)}</b>` : ""}.`}</p>${info.notitie ? `<p style="margin:0">Opmerking: ${esc(info.notitie)}</p>` : ""}
      ${knop("https://sitehulpje.nl/beheer", "Naar beheer")}`, { kop: "Toegang website", sub: esc(k.naam) }));
    return { nodig: true, platform, site: k.site, website: info };
  }
  if (a === "opruimen") {
    if (req.headers.get("x-cron-key") !== (await cronSleutel())) throw new Fout(401, "Geen toegang");
    const r = await sql`update beheersite.vb_bestellingen set status = 'verlopen' where status = 'nieuw' and aangemaakt < now() - interval '2 days' returning id`;
    return { ok: true, verlopen: r.length };
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
    return json({ fout: "Er ging iets mis. Probeer het zo nog eens." }, 500);
  }
});
