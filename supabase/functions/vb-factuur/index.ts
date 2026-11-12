// Sitehulpje Vindbaarheid – facturen en automatische incasso via Mollie (Supabase Edge Function "vb-factuur")
// Modus "concept" (standaard): facturen worden alleen als concept gemaakt en naar Jan gemaild; er wordt niets afgeschreven.
// Modus "aan" + MOLLIE_API_KEY: echte factuurnummers, incasso via Mollie, pauze bij terugboeking of mislukte betaling.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const MOLLIE = Deno.env.get("MOLLIE_API_KEY") || "";
const FUNCTIE_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/vb-factuur`;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-sessie, x-cron-key, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
class Fout extends Error { constructor(public code: number, msg: string) { super(msg); } }
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (s: string) => b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const euro = (n: number) => "€" + Number(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const maandNaam = (m: string) => `${MAANDEN[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const PRIJS: Record<string, number> = { basis: 99, plus: 179, pro: 249 };
const PAKKET: Record<string, string> = { basis: "Basis", plus: "Plus", pro: "Pro" };
const BTW = 0.21;
const ADS_PRIJS = 99;
// Sitehulpje-pakketten (Sitehulpje zit erin): Basis, Plus, Pro (Pro inclusief advertentiebeheer); 10% korting t/m bundel_korting_tot
const BUNDEL: Record<string, number> = { basis: 169, plus: 239, pro: 369 };
const BUNDEL_KORTING = 0.10;
// maandbedrag en omschrijving: Vindbaarheid-pakket en/of Sitehulpje webbeheer (sh_prijs)
// Persoonlijke korting (in beheer ingesteld): vast bedrag of percentage per maand, eventueel tot een datum
function abonnement(k: any, periode?: string) {
  const dag = (d: any) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
  const bun = k.bundel && BUNDEL[k.bundel] ? String(k.bundel) : "";
  const bunKort = !!bun && !!k.bundel_korting_tot && (!periode || `${periode}-01` <= dag(k.bundel_korting_tot));
  const bundel = bun ? (bunKort ? Math.round(BUNDEL[bun] * (1 - BUNDEL_KORTING) * 100) / 100 : BUNDEL[bun]) : 0;
  const vb = !bun && k.vindbaarheid && k.vb_pakket ? PRIJS[k.vb_pakket] : 0, sh = bun ? 0 : Number(k.sh_prijs || 0);
  // Google Advertenties beheer: loopt zodra de advertenties gestart zijn (ads_tellen_vanaf), standaard €99 (ads_prijs; 0 = opgezegd),
  // met 20% korting t/m ads_korting_tot (Sitehulpje-aanbod, eerste jaar)
  const adsVol = k.ads_tellen_vanaf && bun !== "pro" ? Number(k.ads_prijs ?? ADS_PRIJS) : 0;
  const adsKort = adsVol > 0 && !!k.ads_korting_tot && (!periode || `${periode}-01` <= dag(k.ads_korting_tot));
  const ads = adsVol > 0 ? (adsKort ? Math.round(adsVol * 80) / 100 : adsVol) : 0;
  const delen = [bundel ? `Sitehulpje ${PAKKET[bun]}${bunKort ? " (10% korting eerste jaar)" : ""}` : "", vb ? `Sitehulpje Vindbaarheid ${PAKKET[k.vb_pakket]}` : "", sh ? "Sitehulpje" : "", ads ? `Google Advertenties beheer${adsKort ? " (20% korting)" : ""}` : ""].filter(Boolean);
  const bruto = Math.round((bundel + vb + sh + ads) * 100) / 100;
  // korting_van: korting die pas later ingaat (pauzemaand, vriendenkorting); korting_tot: tot en met die datum
  const geldig = !periode || ((!k.korting_tot || `${periode}-01` <= dag(k.korting_tot)) && (!k.korting_van || `${periode}-01` >= dag(k.korting_van).slice(0, 7) + "-01"));
  let korting = 0;
  if (geldig && Number(k.korting_pct) > 0) korting = Math.round(bruto * Number(k.korting_pct)) / 100;
  else if (geldig && Number(k.korting_eur) > 0) korting = Math.min(bruto, Number(k.korting_eur));
  return { excl: Math.round((bruto - korting) * 100) / 100, bruto, korting, naam: delen.join(" + "),
    kortingNaam: korting ? `Persoonlijke korting${Number(k.korting_pct) > 0 ? ` (${Number(k.korting_pct)}%)` : ""}${k.korting_reden ? ` – ${k.korting_reden}` : ""}` : "" };
}
// factuurregels voor op de factuur: abonnement en (als die er is) de korting als aparte regel
const regelsVan = (ab: any, omschrijving: string, factor = 1) => ab.korting
  ? [{ omschrijving, bedrag: Math.round(ab.bruto * factor * 100) / 100 }, { omschrijving: ab.kortingNaam, bedrag: -Math.round(ab.korting * factor * 100) / 100 }]
  : null;
const nuAms = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
const maandVan = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const VERKOPER = { naam: "Siteregelaar", merk: "Sitehulpje", adres: "Markt 9", postcode: "7551 CG", plaats: "Hengelo", kvk: "55667147", btw: "NL851809777B01", email: "info@sitehulpje.nl" };

async function inst() {
  const r = await sql`select sleutel, waarde from beheersite.instellingen`;
  return Object.fromEntries(r.map((x) => [x.sleutel, x.waarde])) as Record<string, string>;
}
const modusAan = async () => (await inst()).vb_facturen_modus === "aan" && !!MOLLIE;

async function gebruikerVan(req: Request) {
  const t = req.headers.get("x-sessie");
  if (!t) throw new Fout(401, "Niet ingelogd");
  const r = await sql`select g.id, g.rol, g.klant_id, g.email from beheersite.sessies s join beheersite.gebruikers g on g.id = s.gebruiker_id
    where s.token_hash = ${await sha256(t)} and s.verloopt > now() and g.actief`;
  if (!r.length) throw new Fout(401, "Niet ingelogd");
  return r[0];
}

async function mail(aan: string, onderwerp: string, html: string) {
  const i = await inst();
  if (!i.resend_sleutel || !aan) return false;
  const van = (i.mail_van || "Sitehulpje <onboarding@resend.dev>").replace(/^[^<]*</, "Sitehulpje <");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${i.resend_sleutel}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: van, to: [aan], reply_to: VERKOPER.email, subject: onderwerp, html }),
  });
  return r.ok;
}
const kader = (inhoud: string, kop = "Bericht", sub = "") => mooi(inhoud.replace(/<p>/g, '<p style="margin:0 0 12px">'), kop, sub);
const knop = (link: string, tekst: string) => mooiKnop(link, tekst);
const mailJan = async (onderwerp: string, html: string) => mail((await inst()).jan_email, onderwerp, kader(html + mooiKnop("https://sitehulpje.nl/beheer", "Naar beheer"), "Melding", esc(onderwerp)));

// ---------- Mollie ----------
async function mollie(pad: string, body?: unknown, methode?: string) {
  if (!MOLLIE) throw new Fout(503, "Mollie is nog niet gekoppeld.");
  const r = await fetch(`https://api.mollie.com/v2/${pad}`, {
    method: methode || (body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${MOLLIE}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mollie ${r.status}: ${d.detail || d.title || "onbekend"}`);
  return d;
}
const bedrag = (n: number) => ({ currency: "EUR", value: Number(n).toFixed(2) });

async function mollieKlant(k: any, g: any) {
  if (k.mollie_klant) return k.mollie_klant;
  const c = await mollie("customers", { name: g?.bedrijf?.naam || k.naam, email: g?.bedrijf?.factuur_email || undefined, metadata: { klant_id: k.id } });
  await sql`update beheersite.klanten set mollie_klant = ${c.id} where id = ${k.id}`;
  return c.id as string;
}

// ---------- facturen ----------
async function klantGegevens(klantId: string) {
  const [o] = await sql`select gegevens from beheersite.vb_onboarding where klant_id = ${klantId}`;
  return o?.gegevens || {};
}
function bedragen(excl: number) {
  const e = Math.round(excl * 100) / 100, b = Math.round(e * BTW * 100) / 100;
  return { excl: e, btw: b, totaal: Math.round((e + b) * 100) / 100 };
}
async function maakFactuur(k: any, periode: string, soort: "maand" | "eerste" | "los" | "klus", excl: number, omschrijving: string, regels: any[] | null = null) {
  if (soort !== "klus") {
    const [bestaat] = await sql`select * from beheersite.vb_facturen where klant_id = ${k.id} and periode = ${periode} and soort = ${soort}`;
    if (bestaat) return bestaat;
  }
  const g = await klantGegevens(k.id);
  if (regels) excl = Math.round(regels.reduce((t, r) => t + Number(r.bedrag), 0) * 100) / 100;
  const b = bedragen(excl);
  const echt = await modusAan();
  const nummer = echt ? (await sql`select beheersite.vb_factuurnummer() n`)[0].n : null;
  const snap = { klant: { naam: g.bedrijf?.naam || k.naam, contact: g.bedrijf?.contact || "", straat: g.bedrijf?.straat || "", postcode: g.bedrijf?.postcode || "", plaats: g.bedrijf?.plaats || "",
      kvk: g.bedrijf?.kvk || "", btw: g.bedrijf?.btw || "", email: g.bedrijf?.factuur_email || "" }, verkoper: VERKOPER, pakket: k.vb_pakket, ...(regels ? { regels } : {}) };
  const [f] = await sql`insert into beheersite.vb_facturen (nummer, klant_id, periode, soort, omschrijving, bedrag_excl, btw, totaal, status, gegevens)
    values (${nummer}, ${k.id}, ${periode}, ${soort}, ${omschrijving}, ${b.excl}, ${b.btw}, ${b.totaal}, ${echt ? "open" : "concept"}, ${sql.json(snap)}) returning *`;
  return f;
}
const logRegel = (f: any, tekst: string) => sql`update beheersite.vb_facturen set log = log || ${sql.json([{ t: new Date().toISOString(), tekst }])}::jsonb where id = ${f.id}`;

async function pauze(k: any, reden: string) {
  await sql`update beheersite.klanten set vindbaarheid = false, vb_pauze = now(), vb_pauze_reden = ${reden} where id = ${k.id}`;
}
async function hervat(klantId: string) {
  const open = await sql`select 1 from beheersite.vb_facturen where klant_id = ${klantId} and status in ('teruggeboekt','mislukt')`;
  if (open.length) return false;
  const [k] = await sql`update beheersite.klanten set vindbaarheid = true, vb_pauze = null, vb_pauze_reden = null where id = ${klantId} and vb_pauze is not null returning id, naam`;
  if (k) await mailJan(`Weer actief: ${k.naam}`, `<p><b>${esc(k.naam)}</b> heeft betaald. Vindbaarheid loopt weer door.</p>`);
  return !!k;
}

// Losse betaallink (iDEAL e.d.) voor een factuur die niet via incasso betaald is
async function betaallink(f: any, k: any) {
  const p = await mollie("payments", {
    amount: bedrag(f.totaal), description: `Sitehulpje.nl factuur ${f.nummer}`, sequenceType: "oneoff",
    customerId: k.mollie_klant || undefined, redirectUrl: "https://sitehulpje.nl/verzoeken#vindbaarheid",
    webhookUrl: FUNCTIE_URL + "?mollie=1", metadata: { factuur: f.id },
  });
  const link = p._links?.checkout?.href || null;
  await sql`update beheersite.vb_facturen set betaallink = ${link} where id = ${f.id}`;
  return link;
}

async function klantMailAdres(klantId: string) {
  const g = await klantGegevens(klantId);
  if (g.bedrijf?.factuur_email) return g.bedrijf.factuur_email as string;
  const [u] = await sql`select email from beheersite.gebruikers where klant_id = ${klantId} and rol = 'klant' and actief order by email limit 1`;
  return u?.email || "";
}

async function verwerkBetaling(id: string) {
  const p = await mollie(`payments/${id}?embed=chargebacks`);
  if (p.metadata?.bestelling) return await bestellingBetaald(p);
  if (p.metadata?.klus) return await klusBetaald(p);
  const factuurId = p.metadata?.factuur;
  if (p.metadata?.eerste && p.status === "paid" && p.mandateId) {
    await sql`update beheersite.klanten set mollie_mandaat = ${p.mandateId} where mollie_klant = ${p.customerId}`;
  }
  const [f] = factuurId ? await sql`select * from beheersite.vb_facturen where id = ${factuurId}` : [];
  if (!f) return { ok: true, genegeerd: true };
  const [k] = await sql`select * from beheersite.klanten where id = ${f.klant_id}`;
  const teruggeboekt = Number(p.amountChargedBack?.value || 0) > 0;
  if (teruggeboekt && f.status !== "teruggeboekt") {
    // eerst pauze, dan pas mailen
    await sql`update beheersite.vb_facturen set status = 'teruggeboekt', betaald = null where id = ${f.id}`;
    await pauze(k, `Factuur ${f.nummer} teruggeboekt`);
    await logRegel(f, "Teruggeboekt via Mollie, klant op pauze");
    const link = await betaallink(f, k).catch(() => null);
    await mail(await klantMailAdres(k.id), `Je betaling voor factuur ${f.nummer} is teruggeboekt`, kader(`<p>Hoi,</p>
      <p>De automatische betaling van factuur <b>${esc(f.nummer)}</b> (${euro(f.totaal)}) is teruggeboekt. Daarom staat Sitehulpje Vindbaarheid voor <b>${esc(k.naam)}</b> even op pauze.</p>
      <p>Was dit een vergissing? Betaal dan hieronder; daarna gaat alles meteen weer verder.</p>${link ? knop(link, "Betaal " + euro(f.totaal)) : ""}
      <p style="color:#5a6b82;font-size:13px">Vragen? Beantwoord deze mail.</p>`, "Betaling teruggeboekt", `Factuur ${esc(f.nummer)}`));
    await mailJan(`Teruggeboekt: ${k.naam}`, `<p><b>${esc(k.naam)}</b> heeft factuur ${esc(f.nummer)} (${euro(f.totaal)}) teruggeboekt. De klant staat op pauze en heeft een betaallink gekregen.</p>`);
    return { ok: true, status: "teruggeboekt" };
  }
  if (p.status === "paid" && !teruggeboekt && f.status !== "betaald") {
    await sql`update beheersite.vb_facturen set status = 'betaald', betaald = now(), betaald_via = ${p.sequenceType === "recurring" ? "incasso" : "mollie"} where id = ${f.id}`;
    await logRegel(f, `Betaald via Mollie (${p.method || p.sequenceType})`);
    await hervat(k.id);
    if (f.soort === "eerste") await factuurMail(f.id).catch(() => {});
    return { ok: true, status: "betaald" };
  }
  if (["failed", "expired", "canceled"].includes(p.status) && f.status === "open" && f.mollie_betaling === p.id) {
    await sql`update beheersite.vb_facturen set status = 'mislukt' where id = ${f.id}`;
    await pauze(k, `Factuur ${f.nummer} niet betaald`);
    await logRegel(f, `Betaling ${p.status}, klant op pauze`);
    const link = await betaallink(f, k).catch(() => null);
    await mail(await klantMailAdres(k.id), `Je betaling voor factuur ${f.nummer} is niet gelukt`, kader(`<p>Hoi,</p>
      <p>De automatische betaling van factuur <b>${esc(f.nummer)}</b> (${euro(f.totaal)}) is niet gelukt. Daarom staat Sitehulpje Vindbaarheid voor <b>${esc(k.naam)}</b> even op pauze.</p>
      <p>Betaal hieronder, dan gaat alles meteen weer verder.</p>${link ? knop(link, "Betaal " + euro(f.totaal)) : ""}`, "Betaling niet gelukt", `Factuur ${esc(f.nummer)}`));
    await mailJan(`Betaling mislukt: ${k.naam}`, `<p>De incasso voor factuur ${esc(f.nummer)} van <b>${esc(k.naam)}</b> is mislukt (${esc(p.status)}). De klant staat op pauze en heeft een betaallink gekregen.</p>`);
    return { ok: true, status: "mislukt" };
  }
  return { ok: true, status: p.status };
}

// Maandfacturen: op de 2e van de maand, voor de lopende maand (vooruit betalen)
async function maandelijks() {
  const periode = maandVan(nuAms());
  const echt = await modusAan();
  const ks = await sql`select k.* from beheersite.klanten k left join beheersite.vb_onboarding o on o.klant_id = k.id
    where k.actief and k.vb_pauze is null and (
      (o.akkoord is not null and ((k.vindbaarheid and k.vb_pakket is not null) or k.sh_prijs > 0))
      or (k.ads_tellen_vanaf is not null and coalesce(k.ads_prijs, ${ADS_PRIJS}) > 0))`;
  const uit: Record<string, string> = {};
  for (const k of ks) {
    try {
      // wie deze maand net begonnen is, heeft de eerste (deel)maand al betaald
      const [eerder] = await sql`select 1 from beheersite.vb_facturen where klant_id = ${k.id} and periode = ${periode} and soort = 'eerste'`;
      if (eerder) { uit[k.id] = "eerste al betaald"; continue; }
      const ab = abonnement(k, periode);
      if (!ab.excl) continue;
      const oms = `${ab.naam} – ${maandNaam(periode)}`;
      const f = await maakFactuur(k, periode, "maand", ab.excl, oms, regelsVan(ab, oms));
      if (echt && f.status === "open" && !f.mollie_betaling && k.mollie_mandaat) {
        const p = await mollie("payments", {
          amount: bedrag(f.totaal), description: `Sitehulpje.nl factuur ${f.nummer}`, sequenceType: "recurring",
          customerId: k.mollie_klant, mandateId: k.mollie_mandaat, webhookUrl: FUNCTIE_URL + "?mollie=1", metadata: { factuur: f.id },
        });
        await sql`update beheersite.vb_facturen set mollie_betaling = ${p.id} where id = ${f.id}`;
        await logRegel(f, "Incasso aangemaakt bij Mollie");
      } else if (echt && f.status === "open" && !f.mollie_betaling && !k.mollie_mandaat) {
        // nog geen incasso-toestemming (bijv. alleen advertenties): betalen met iDEAL, dat geeft meteen toestemming voor de automatische incasso
        const klant = await mollieKlant(k, await klantGegevens(k.id));
        const p = await mollie("payments", {
          amount: bedrag(f.totaal), description: `Sitehulpje.nl factuur ${f.nummer}`, sequenceType: "first", customerId: klant,
          redirectUrl: "https://sitehulpje.nl/portaal", webhookUrl: FUNCTIE_URL + "?mollie=1", metadata: { factuur: f.id, eerste: true },
        });
        await sql`update beheersite.vb_facturen set mollie_betaling = ${p.id}, betaallink = ${p._links?.checkout?.href || null} where id = ${f.id}`;
        await logRegel(f, "iDEAL-betaallink aangemaakt (geeft toestemming voor incasso)");
      }
      // wie geen Vindbaarheid heeft (of nog via iDEAL moet betalen), krijgt de factuur los per mail
      if (echt && (!(k.vindbaarheid && k.vb_pakket) || !k.mollie_mandaat)) await factuurMail(f.id).catch(() => {});
      uit[k.id] = f.status;
    } catch (e) { uit[k.id] = (e as Error).message; }
  }
  if (!echt && Object.keys(uit).length) {
    await mailJan(`Concept-facturen ${maandNaam(periode)}`, `<p>Er staan ${Object.keys(uit).length} conceptfacturen klaar voor ${maandNaam(periode)}. Ze zijn nog niet verstuurd en er wordt niets afgeschreven, omdat Mollie nog niet aan staat.</p>`);
  }
  return { ok: true, periode, echt, uit };
}

// Herinneringen voor openstaande teruggeboekte/mislukte facturen:
// dag 7 en 14 herinnering, dag 21 laatste aanmaning, dag 28 dossier voor het incassobureau
function factuurHtml(f: any) {
  const k = f.gegevens?.klant || {}, v = f.gegevens?.verkoper || VERKOPER;
  return `<div style="font-family:Arial,sans-serif;max-width:640px;color:#0b1a2e"><h2>Factuur ${esc(f.nummer)}</h2>
    <p><b>Van:</b> ${esc(v.naam)}, ${esc(v.adres)}, ${esc(v.postcode)} ${esc(v.plaats)}, KvK ${esc(v.kvk)}, btw ${esc(v.btw)}</p>
    <p><b>Aan:</b> ${esc(k.naam)}${k.contact ? ", t.a.v. " + esc(k.contact) : ""}, ${esc(k.straat)}, ${esc(k.postcode)} ${esc(k.plaats)}${k.kvk ? ", KvK " + esc(k.kvk) : ""}${k.email ? ", " + esc(k.email) : ""}</p>
    <p><b>Datum:</b> ${esc(String(f.datum).slice(0, 10))} · <b>Periode:</b> ${esc(f.periode)}</p>
    <p>${esc(f.omschrijving)}<br>Subtotaal ${euro(f.bedrag_excl)} · btw 21% ${euro(f.btw)} · <b>totaal ${euro(f.totaal)}</b></p></div>`;
}
async function dossier(f: any) {
  const [o] = await sql`select akkoord from beheersite.vb_onboarding where klant_id = ${f.klant_id}`;
  const log = (f.log || []).map((x: any) => `<li>${esc(String(x.t).slice(0, 16).replace("T", " "))}: ${esc(x.tekst)}</li>`).join("");
  const a = o?.akkoord;
  return `<div style="font-family:Arial,sans-serif;max-width:640px;color:#0b1a2e;line-height:1.5">
    <p>Geachte heer/mevrouw,</p>
    <p>Hierbij dragen wij de onderstaande onbetaalde factuur aan u over ter incasso.</p>
    ${factuurHtml(f)}
    <h3>Verloop</h3><ul>${log}
      ${f.herinnerd_7 ? `<li>${esc(String(f.herinnerd_7).slice(0, 10))}: eerste herinnering</li>` : ""}
      ${f.herinnerd_14 ? `<li>${esc(String(f.herinnerd_14).slice(0, 10))}: tweede herinnering</li>` : ""}
      ${f.aanmaning ? `<li>${esc(String(f.aanmaning).slice(0, 10))}: laatste aanmaning (betaaltermijn 7 dagen)</li>` : ""}</ul>
    ${a ? `<h3>Overeenkomst</h3><p>Akkoord gegeven door ${esc(a.naam)} (${esc(a.email || "")}) op ${esc(String(a.datum).slice(0, 10))}, pakket ${esc(a.pakket || "")}, minimale looptijd ${esc(a.minimaal_maanden || 3)} maanden, voorwaarden versie ${esc(a.versie)}.</p>` : ""}
    <p>Voorwaarden: https://sitehulpje.nl/voorwaarden</p>
    <p>Met vriendelijke groet,<br>Jan<br>${esc(VERKOPER.naam)} · ${esc(VERKOPER.adres)}, ${esc(VERKOPER.postcode)} ${esc(VERKOPER.plaats)} · ${esc(VERKOPER.email)}</p></div>`;
}
async function naarIncasso(f: any) {
  const i = await inst();
  if (!i.vb_incasso_email) throw new Fout(400, "Er is nog geen incassobureau ingesteld.");
  const html = await dossier(f);
  const ok = await mail(i.vb_incasso_email, `Incasso-opdracht: factuur ${f.nummer} – ${f.gegevens?.klant?.naam || ""}`, html);
  if (!ok) throw new Fout(502, "Versturen naar het incassobureau is niet gelukt.");
  await sql`update beheersite.vb_facturen set incasso_gestuurd = now() where id = ${f.id}`;
  await logRegel(f, `Overgedragen aan incassobureau (${i.vb_incasso_email})`);
  await mailJan(`Naar incasso: factuur ${f.nummer}`, `<p>Factuur ${esc(f.nummer)} is doorgestuurd naar ${esc(i.vb_incasso_email)}. Kopie van het dossier:</p>` + html);
  return true;
}
async function herinneringen() {
  const i = await inst();
  const fs = await sql`select f.*, k.naam from beheersite.vb_facturen f join beheersite.klanten k on k.id = f.klant_id
    where f.status in ('teruggeboekt','mislukt') and f.betaallink is not null and f.incasso_gestuurd is null`;
  const uit: Record<string, string> = {};
  for (const f of fs) {
    const log = (f.log || []).filter((x: any) => /pauze/.test(x.tekst));
    const sinds = log.length ? new Date(log[log.length - 1].t).getTime() : new Date(f.gemaakt).getTime();
    const dagen = (Date.now() - sinds) / 86400_000;
    const aan = await klantMailAdres(f.klant_id);
    if (dagen >= 28 && f.aanmaning && !f.incasso_klaar) {
      await sql`update beheersite.vb_facturen set incasso_klaar = now() where id = ${f.id}`;
      if (i.vb_incasso_auto === "aan" && i.vb_incasso_email) { await naarIncasso(f); uit[f.id] = "naar incasso"; }
      else {
        await mailJan(`Klaar voor incasso: ${f.naam}`, `<p>Factuur ${esc(f.nummer)} van <b>${esc(f.naam)}</b> (${euro(f.totaal)}) is na de laatste aanmaning nog steeds niet betaald.</p>
          <p>Het dossier staat klaar. Klik in beheer bij de factuur op <b>Naar incasso sturen</b>.</p>`);
        uit[f.id] = "incasso klaar";
      }
      continue;
    }
    if (dagen >= 21 && !f.aanmaning) {
      await mail(aan, `Laatste aanmaning: factuur ${f.nummer}`, kader(`<p>Geachte heer/mevrouw,</p>
        <p>Ondanks eerdere herinneringen hebben wij de betaling van factuur <b>${esc(f.nummer)}</b> (${euro(f.totaal)}) nog niet ontvangen.</p>
        <p>Wij verzoeken u dit bedrag <b>binnen 7 dagen</b> te betalen. Gebeurt dat niet, dan dragen wij de vordering over aan een incassobureau. De kosten daarvan en de wettelijke handelsrente komen dan voor uw rekening, zoals vermeld in onze voorwaarden.</p>
        ${knop(f.betaallink, "Betaal " + euro(f.totaal))}<p>Met vriendelijke groet,<br>Sitehulpje (${esc(VERKOPER.naam)})</p>`, "Laatste aanmaning", `Factuur ${esc(f.nummer)}`));
      await sql`update beheersite.vb_facturen set aanmaning = now(), herinnerd_14 = coalesce(herinnerd_14, now()), herinnerd_7 = coalesce(herinnerd_7, now()) where id = ${f.id}`;
      await logRegel(f, "Laatste aanmaning verstuurd");
      uit[f.id] = "aanmaning";
      continue;
    }
    const welke = dagen >= 14 && !f.herinnerd_14 ? 14 : dagen >= 7 && !f.herinnerd_7 ? 7 : 0;
    if (!welke) continue;
    await mail(aan, `Herinnering: factuur ${f.nummer} staat nog open`, kader(`<p>Hoi,</p>
      <p>Factuur <b>${esc(f.nummer)}</b> (${euro(f.totaal)}) staat nog open. Sitehulpje Vindbaarheid voor <b>${esc(f.naam)}</b> staat daarom op pauze.</p>${knop(f.betaallink, "Betaal " + euro(f.totaal))}`, "Herinnering", `Factuur ${esc(f.nummer)}`));
    if (welke === 7) await sql`update beheersite.vb_facturen set herinnerd_7 = now() where id = ${f.id}`;
    else await sql`update beheersite.vb_facturen set herinnerd_14 = now(), herinnerd_7 = coalesce(herinnerd_7, now()) where id = ${f.id}`;
    uit[f.id] = `herinnering ${welke}`;
  }
  return { ok: true, uit };
}

// Eerste betaling na akkoord: rest van deze maand naar rato, via iDEAL; dat geeft meteen toestemming voor de incasso
async function eerste(k: any) {
  if (!(await modusAan())) return { ok: true, uit: true };
  const nu = nuAms(), periode = maandVan(nu);
  const dagen = new Date(nu.getFullYear(), nu.getMonth() + 1, 0).getDate();
  const rest = dagen - nu.getDate() + 1;
  const ab = abonnement({ ...k, vindbaarheid: true }, periode);
  const excl = Math.round(((ab.excl * rest) / dagen) * 100) / 100;
  const oms = `${ab.naam} – ${rest} van ${dagen} dagen ${maandNaam(periode)}`;
  const f = await maakFactuur(k, periode, "eerste", excl, oms, regelsVan(ab, oms, rest / dagen));
  if (f.betaallink && f.status === "open") return { ok: true, url: f.betaallink };
  const g = await klantGegevens(k.id);
  const klant = await mollieKlant(k, g);
  const p = await mollie("payments", {
    amount: bedrag(f.totaal), description: `Sitehulpje.nl factuur ${f.nummer} (eerste maand)`, sequenceType: "first", customerId: klant,
    redirectUrl: "https://sitehulpje.nl/verzoeken#vindbaarheid", webhookUrl: FUNCTIE_URL + "?mollie=1", metadata: { factuur: f.id, eerste: true },
  });
  await sql`update beheersite.vb_facturen set mollie_betaling = ${p.id}, betaallink = ${p._links?.checkout?.href || null} where id = ${f.id}`;
  return { ok: true, url: p._links?.checkout?.href };
}

// ---------- factuur per mail (Sitehulpje-stijl, met link zonder inloggen) ----------
const LOGO = "https://sitehulpje.nl/assets/icoon-192.png";
function mooi(inhoud: string, kop: string, sub = "") {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef4fb">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4fb;padding:24px 10px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:separate">
    <tr><td style="border-radius:22px 22px 0 0;background:#0c1a36;background-image:radial-gradient(120% 160% at 100% 0%,rgba(139,92,246,.55),transparent 55%),radial-gradient(100% 140% at 0% 100%,rgba(34,227,196,.45),transparent 55%),linear-gradient(160deg,#081226,#0c1a36 60%,#101034);padding:22px 24px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="middle"><img src="${LOGO}" width="44" height="44" alt="" style="display:block;border-radius:12px"></td>
        <td valign="middle" style="padding-left:10px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#ffffff">Site<span style="color:#22e3c4;font-family:'JetBrains Mono',Menlo,Consolas,monospace">hulpje</span></td></tr></table>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.15;font-weight:700;color:#ffffff;margin-top:18px">${kop}</div>
      ${sub ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#a9bdd8;margin-top:6px">${sub}</div>` : ""}</td></tr>
    <tr><td style="height:4px;line-height:4px;font-size:0;background:#22e3c4;background-image:linear-gradient(90deg,#22e3c4,#3b82f6,#8b5cf6)">&nbsp;</td></tr>
    <tr><td style="background:#ffffff;border-radius:0 0 22px 22px;padding:26px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#0b1a2e">${inhoud}</td></tr>
    <tr><td align="center" style="padding:18px 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#5a6b82">Sitehulpje · een dienst van Siteregelaar · Markt 9, 7551 CG Hengelo · KvK 55667147<br>info@sitehulpje.nl · 06 27 25 43 83</td></tr>
  </table></td></tr></table></body></html>`;
}
const mooiKnop = (link: string, tekst: string) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0"><tr><td style="border-radius:12px;background:#0b9f8a;background-image:linear-gradient(135deg,#22e3c4,#3b82f6)">
  <a href="${link}" style="display:inline-block;padding:14px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#04111a;text-decoration:none;border-radius:12px">${tekst} &rarr;</a></td></tr></table>`;
async function factuurMail(factuurId: string) {
  const [f] = await sql`select * from beheersite.vb_facturen where id = ${factuurId}`;
  if (!f || !f.nummer || f.gemaild || f.status === "concept") return false;
  const aan = await klantMailAdres(f.klant_id);
  if (!aan) return false;
  const link = `https://sitehulpje.nl/factuur?id=${f.id}&t=${f.token}`;
  const betaald = f.status === "betaald";
  const ok = await mail(aan, `Factuur ${f.nummer} van Sitehulpje`, mooi(`<p style="margin:0 0 12px">Hoi,</p>
    <p style="margin:0 0 12px">Hierbij je factuur voor <b>${esc(f.omschrijving)}</b>.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;border-collapse:collapse">
      ${(f.gegevens?.regels || []).map((r: any) => `<tr><td style="padding:6px 0">${esc(r.omschrijving)}</td><td align="right" style="padding:6px 0;${Number(r.bedrag) < 0 ? "color:#0b9f8a" : ""}">${euro(r.bedrag)}</td></tr>`).join("")}
      <tr><td style="padding:6px 0;color:#5a6b82">Subtotaal</td><td align="right" style="padding:6px 0">${euro(f.bedrag_excl)}</td></tr>
      <tr><td style="padding:6px 0;color:#5a6b82">Btw 21%</td><td align="right" style="padding:6px 0">${euro(f.btw)}</td></tr>
      <tr><td style="padding:8px 0;border-top:1px solid #dfe7f1;font-weight:700">Totaal</td><td align="right" style="padding:8px 0;border-top:1px solid #dfe7f1;font-weight:700">${euro(f.totaal)}</td></tr></table>
    <p style="margin:14px 0 0">${betaald ? "Deze factuur is al betaald. Dank je wel!" : f.betaallink ? "Betaal deze factuur met iDEAL via de knop hieronder. Daarna schrijven we volgende facturen automatisch af; je hoeft dan niets meer te doen." : "Dit bedrag wordt de komende werkdagen automatisch afgeschreven. Je hoeft niets te doen."}</p>
    ${!betaald && f.betaallink ? mooiKnop(f.betaallink, "Betaal " + euro(f.totaal) + " met iDEAL") : ""}
    ${mooiKnop(link, "Factuur bekijken of downloaden")}
    <p style="margin:0;color:#5a6b82;font-size:14px">Vragen over je factuur? Beantwoord gewoon deze mail.</p>`, `Factuur ${esc(f.nummer)}`, esc(f.gegevens?.klant?.naam || "")));
  if (ok) await sql`update beheersite.vb_facturen set gemaild = now() where id = ${f.id}`;
  return ok;
}

// ---------- opzeggen (onder het account) ----------
const laatsteDag = (j: number, m: number) => new Date(Date.UTC(j, m + 1, 0)); // m = 0..11
const iso = (d: Date) => d.toISOString().slice(0, 10);
const NL_DATUM = (d: Date | string) => new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
async function abonnementVan(klantId: string) {
  const [k] = await sql`select * from beheersite.klanten where id = ${klantId}`;
  if (!k) throw new Fout(404, "Account niet gevonden.");
  const [o] = await sql`select akkoord from beheersite.vb_onboarding where klant_id = ${klantId}`;
  const delen: { id: string; naam: string; prijs: number; minEind: string | null }[] = [];
  const nu = nuAms(), eindDeze = laatsteDag(nu.getFullYear(), nu.getMonth());
  if (k.bundel && BUNDEL[k.bundel]) {
    // pakket met Sitehulpje erin: één onderdeel, minimaal 3 maanden vanaf de start
    const st = k.vb_start ? new Date(k.vb_start) : nu;
    delen.push({ id: "pakket", naam: `Sitehulpje ${PAKKET[k.bundel]}`, prijs: BUNDEL[k.bundel], minEind: iso(laatsteDag(st.getFullYear(), st.getMonth() + 2)) });
  } else if (k.vb_pakket && (k.vindbaarheid || k.vb_pauze)) {
    const st = k.vb_start ? new Date(k.vb_start) : nu;
    const min = Number(o?.akkoord?.minimaal_maanden || 3);
    delen.push({ id: "vindbaarheid", naam: `Vindbaarheid ${PAKKET[k.vb_pakket]}`, prijs: PRIJS[k.vb_pakket], minEind: iso(laatsteDag(st.getFullYear(), st.getMonth() + min - 1)) });
  }
  if (!k.bundel && Number(k.sh_prijs) > 0) {
    // Sitehulpje webbeheer: ook minimaal 3 maanden, gerekend vanaf de maand van het akkoord
    const st = o?.akkoord?.datum ? new Date(o.akkoord.datum) : (k.vb_start ? new Date(k.vb_start) : nu);
    delen.push({ id: "sitehulpje", naam: "Sitehulpje", prijs: Number(k.sh_prijs), minEind: iso(laatsteDag(st.getFullYear(), st.getMonth() + 2)) });
  }
  if (k.ads_tellen_vanaf && k.bundel !== "pro" && Number(k.ads_prijs ?? ADS_PRIJS) > 0) {
    // Google Advertenties beheer: minimaal 3 maanden vanaf de start
    const st = new Date(k.ads_prijs_sinds || k.ads_tellen_vanaf);
    delen.push({ id: "advertenties", naam: "Google Advertenties beheer", prijs: Number(k.ads_prijs ?? ADS_PRIJS), minEind: iso(laatsteDag(st.getFullYear(), st.getMonth() + 2)) });
  }
  return { k, delen, eindDeze: iso(eindDeze) };
}
async function opzeggen(g: any, wat: string[], reden: string) {
  const { k, delen, eindDeze } = await abonnementVan(g.klant_id);
  const kies = delen.filter((d) => wat.includes(d.id));
  if (!kies.length) throw new Fout(400, "Kies wat je wilt opzeggen.");
  const aan = g.email || (await klantMailAdres(k.id));
  const teVroeg = kies.filter((d) => d.minEind && d.minEind > eindDeze);
  if (teVroeg.length) {
    const d = teVroeg[0], eind = new Date(d.minEind!), vanaf = new Date(Date.UTC(eind.getUTCFullYear(), eind.getUTCMonth(), 1));
    await mail(aan, `Over het opzeggen van ${d.naam}`, mooi(`<p style="margin:0 0 12px">Hoi,</p>
      <p style="margin:0 0 12px">Je wilt <b>${esc(d.naam)}</b> opzeggen. ${d.id === "vindbaarheid" ? "Vindbaarheid heeft een minimale looptijd van 3 maanden, omdat resultaat in Google tijd nodig heeft." : `${esc(d.naam)} heeft een minimale looptijd van 3 maanden.`}</p>
      <p style="margin:0 0 12px"><b>Vanaf ${NL_DATUM(vanaf)}</b> kun je opzeggen. Het abonnement stopt dan op ${NL_DATUM(eind)}.</p>
      <p style="margin:0;color:#5a6b82;font-size:14px">Twijfel je of gaat er iets niet goed? Beantwoord deze mail of bel 06 27 25 43 83, dan kijken we samen.</p>`, "Opzeggen", esc(k.naam)));
    await mailJan(`Wil opzeggen (te vroeg): ${k.naam}`, `<p><b>${esc(k.naam)}</b> wilde ${esc(d.naam)} opzeggen, maar zit nog in de minimale looptijd (kan vanaf ${NL_DATUM(vanaf)}).${reden ? ` Reden: ${esc(reden)}` : ""}</p><p>Misschien even bellen?</p>`);
    return { ok: false, te_vroeg: true, vanaf: iso(vanaf), eind: d.minEind, naam: d.naam };
  }
  const wat2 = [...new Set([...(k.opzeg_wat || []), ...kies.map((d) => d.id)])];
  await sql`update beheersite.klanten set opzeg_per = ${eindDeze}, opzeg_wat = ${wat2}, opzeg_gevraagd = now(), opzeg_reden = ${reden.slice(0, 500) || null} where id = ${k.id}`;
  const namen = kies.map((d) => d.naam).join(" en ");
  await mail(aan, `Je opzegging is ontvangen`, mooi(`<p style="margin:0 0 12px">Hoi,</p>
    <p style="margin:0 0 12px">We hebben je opzegging van <b>${esc(namen)}</b> ontvangen. Het stopt op <b>${NL_DATUM(eindDeze)}</b>. Tot die dag loopt alles gewoon door.</p>
    <p style="margin:0 0 12px">Daarna schrijven we niets meer af${kies.length < delen.length ? " voor wat je hebt opgezegd" : ""}. Je hoeft verder niets te doen.</p>
    <p style="margin:0;color:#5a6b82;font-size:14px">Jammer dat je gaat. Bedenk je je nog? Beantwoord deze mail, dan zetten we het terug.</p>`, "Opzegging ontvangen", esc(k.naam)));
  await mailJan(`Opgezegd: ${k.naam}`, `<p><b>${esc(k.naam)}</b> heeft ${esc(namen)} opgezegd per ${NL_DATUM(eindDeze)}.${reden ? `<br>Reden: ${esc(reden)}` : ""}</p>`);
  return { ok: true, per: eindDeze, naam: namen };
}
// dagelijks: opzeggingen waarvan de einddatum voorbij is uitvoeren, en bij Mollie de incasso-toestemming intrekken
async function opzegVerwerk() {
  const vandaag = iso(nuAms());
  // kortingen: een week van tevoren een seintje aan Jan, en na de einddatum vanzelf weg
  const over7 = iso(new Date(nuAms().getTime() + 7 * 86400_000));
  for (const k of await sql`select id, naam, korting_tot from beheersite.klanten where korting_tot is not null and not korting_gemeld and korting_tot <= ${over7}`) {
    await mailJan(`Korting loopt af: ${k.naam}`, `<p>De persoonlijke korting van <b>${esc(k.naam)}</b> loopt af op ${NL_DATUM(k.korting_tot)}. Daarna betaalt de klant weer de normale prijs. Verlengen kan in beheer.</p>`);
    await sql`update beheersite.klanten set korting_gemeld = true where id = ${k.id}`;
  }
  await sql`update beheersite.klanten set korting_eur = null, korting_pct = null, korting_van = null, korting_tot = null, korting_reden = null, korting_gemeld = false where korting_tot is not null and korting_tot < ${vandaag}`;
  const ks = await sql`select * from beheersite.klanten where opzeg_per is not null and opzeg_per < ${vandaag}`;
  const uit: Record<string, string> = {};
  for (const k of ks) {
    const wat: string[] = k.opzeg_wat || [];
    const pkWeg = wat.includes("pakket");
    const vbWeg = pkWeg || wat.includes("vindbaarheid"), shWeg = pkWeg || wat.includes("sitehulpje"), adsWeg = (pkWeg && k.bundel === "pro") || wat.includes("advertenties");
    await sql`update beheersite.klanten set vindbaarheid = ${vbWeg ? false : k.vindbaarheid}, vb_pakket = ${vbWeg ? null : k.vb_pakket},
      sh_prijs = ${shWeg ? null : k.sh_prijs}, ads_prijs = ${adsWeg ? 0 : k.ads_prijs}, ads_korting_tot = ${adsWeg ? null : k.ads_korting_tot},
      bundel = ${pkWeg ? null : k.bundel}, bundel_korting_tot = ${pkWeg ? null : k.bundel_korting_tot},
      opzeg_per = null, opzeg_wat = null where id = ${k.id}`;
    if (adsWeg) await mailJan(`Advertenties opgezegd: ${k.naam}`, `<p>Het advertentiebeheer van <b>${esc(k.naam)}</b> is gestopt. Pauzeer de campagne in je beheer bij Advertenties en kijk of er nog tegoed terug moet.</p>`);
    const blijft = (!vbWeg && k.vb_pakket) || (!shWeg && Number(k.sh_prijs) > 0) || (!adsWeg && !!k.ads_tellen_vanaf && Number(k.ads_prijs ?? ADS_PRIJS) > 0);
    if (!blijft && k.mollie_klant && k.mollie_mandaat) {
      await mollie(`customers/${k.mollie_klant}/mandates/${k.mollie_mandaat}`, undefined, "DELETE").catch(() => {});
      await sql`update beheersite.klanten set mollie_mandaat = null where id = ${k.id}`;
    }
    await mailJan(`Opzegging uitgevoerd: ${k.naam}`, `<p>Het abonnement van <b>${esc(k.naam)}</b> is gestopt (${esc(wat.join(", "))}).${!blijft ? " De incasso-toestemming bij Mollie is ingetrokken." : ""}</p>${shWeg ? "<p>Vergeet niet de website-koppeling weg te halen als dat nodig is.</p>" : ""}`);
    uit[k.id] = wat.join(",");
  }
  return { ok: true, uit };
}

// ---------- losse klussen (vaste prijs, direct betalen met iDEAL) ----------
async function klusBestel(g: any, klusId: string, toelichting: string) {
  if (!MOLLIE) throw new Fout(503, "Betalen kan nog niet. Bel of mail ons gerust.");
  const i = await inst();
  if (!(await modusAan()) && !MOLLIE.startsWith("test_")) throw new Fout(503, "Betalen kan nog niet. Bel of mail ons gerust.");
  const klus = (JSON.parse(i.klussen || "[]") as any[]).find((x) => x.id === klusId);
  if (!klus) throw new Fout(404, "Deze klus bestaat niet (meer).");
  const [k] = await sql`select * from beheersite.klanten where id = ${g.klant_id}`;
  if (!k) throw new Fout(404, "Account niet gevonden.");
  if (Number(k.sh_prijs) > 0 || !k.vindbaarheid) throw new Fout(400, "Dit kun je gewoon als verzoek doorgeven; het zit al in je Sitehulpje webbeheer.");
  if (toelichting.trim().length < 10) throw new Fout(400, "Vertel in een paar woorden wat je precies wilt, dan kan Sitehulpje meteen aan de slag.");
  const b = bedragen(Number(klus.prijs));
  const p = await mollie("payments", {
    amount: bedrag(b.totaal), description: `Sitehulpje.nl – ${klus.naam}`, sequenceType: "oneoff", customerId: k.mollie_klant || undefined,
    redirectUrl: "https://sitehulpje.nl/verzoeken?klus=betaald", webhookUrl: FUNCTIE_URL + "?mollie=1",
    metadata: { klus: klus.id, naam: klus.naam, prijs: Number(klus.prijs), klant: k.id, door: g.email, toelichting: toelichting.slice(0, 500) },
  });
  return { ok: true, url: p._links?.checkout?.href };
}
// betaalde klus meteen als verzoek aan Sitehulpje geven (alleen als de site gekoppeld is)
const KLUS_OPDRACHT: Record<string, string> = {
  pagina: "Maak een nieuwe pagina op de website. Schrijf de tekst zelf, in dezelfde stijl en opmaak als de rest van de site, en zet de pagina online. Zet hem in het menu als dat logisch is. Meld daarna de link.",
  blog: "Schrijf een blogartikel van ongeveer 600 woorden over het onderwerp hieronder, in de toon van de website, met tussenkopjes en een passende titel en meta-omschrijving. Plaats het als bericht op de site (als er een blog is) en meld daarna de link.",
};
async function klusUitvoeren(k: any, p: any) {
  const opdracht = KLUS_OPDRACHT[p.metadata.klus];
  const [toe] = await sql`select status from beheersite.site_toegang where klant_id = ${k.id}`;
  if (!opdracht || (!k.deurbel_url && toe?.status !== "gekoppeld") || k.soort !== "wordpress") return false;
  const [u] = await sql`select id from beheersite.gebruikers where klant_id = ${k.id} and rol = 'klant' and actief order by (lower(email) = lower(${p.metadata.door || ""})) desc limit 1`;
  if (!u) return false;
  const [vz] = await sql`insert into beheersite.verzoeken (klant_id, gebruiker_id, onderwerp, status, telt_mee, goedgekeurd)
    values (${k.id}, ${u.id}, ${`${p.metadata.naam}: ${p.metadata.toelichting || ""}`.replace(/\s+/g, " ").slice(0, 120)}, 'wacht_op_klant', false, true) returning id`;
  await sql`insert into beheersite.berichten (verzoek_id, van, tekst) values (${vz.id}, 'jan', ${`Betaalde losse klus: ${p.metadata.naam}.\n${opdracht}\n\nWat de klant wil:\n${p.metadata.toelichting || "-"}`})`;
  // korte sessie namens de klant, zodat Sitehulpje het verzoek direct oppakt
  const token = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await sql`insert into beheersite.sessies (token_hash, gebruiker_id, verloopt) values (${await sha256(token)}, ${u.id}, now() + interval '2 minutes')`;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/beheersite`, { method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": token },
      body: JSON.stringify({ actie: "reageer", id: vz.id, tekst: "Akkoord, voer deze klus uit." }) });
    if (!r.ok) throw new Error(`beheersite ${r.status}`);
  } finally { await sql`delete from beheersite.sessies where token_hash = ${await sha256(token)}`; }
  return true;
}
async function klusBetaald(p: any) {
  if (p.status !== "paid") return { ok: true, status: p.status };
  const [al] = await sql`select id from beheersite.vb_facturen where mollie_betaling = ${p.id}`;
  if (al) return { ok: true, al: true };
  const [k] = await sql`select * from beheersite.klanten where id = ${p.metadata.klant}`;
  if (!k) return { ok: true, genegeerd: true };
  const periode = maandVan(nuAms());
  const f = await maakFactuur(k, periode, "klus", Number(p.metadata.prijs), `${p.metadata.naam} (losse klus)`);
  await sql`update beheersite.vb_facturen set status = 'betaald', betaald = now(), betaald_via = 'mollie', mollie_betaling = ${p.id} where id = ${f.id}`;
  await logRegel(f, `Losse klus betaald via ${p.method || "ideal"}`);
  await factuurMail(f.id).catch(() => {});
  const auto = await klusUitvoeren(k, p).catch((e) => { console.error("klus automatisch", e); return false; });
  const aan = await klantMailAdres(k.id);
  if (auto) {
    await mail(aan, `We gaan aan de slag: ${p.metadata.naam}`, mooi(`<p style="margin:0 0 12px">Hoi,</p>
      <p style="margin:0 0 12px">Bedankt! Je betaling voor <b>${esc(p.metadata.naam)}</b> is binnen. Sitehulpje gaat er meteen mee aan de slag. Je ziet het verloop in je app bij <b>Verzoeken</b>, en daar kun je ook nog iets aanpassen of vragen.</p>
      ${mooiKnop("https://sitehulpje.nl/verzoeken", "Bekijk je verzoek")}
      <p style="margin:0;color:#5a6b82;font-size:14px">De factuur krijg je in een aparte mail.</p>`, "Bedankt voor je bestelling", esc(k.naam)));
    await mailJan(`Losse klus besteld: ${k.naam} – ${p.metadata.naam}`, `<p><b>${esc(k.naam)}</b> heeft <b>${esc(p.metadata.naam)}</b> besteld en betaald (${euro(f.totaal)} incl. btw). Sitehulpje voert het automatisch uit als verzoek.</p>
      ${p.metadata.toelichting ? `<p>Toelichting van de klant: “${esc(p.metadata.toelichting)}”</p>` : ""}`);
    return { ok: true, status: "betaald", automatisch: true };
  }
  await mail(aan, `We gaan aan de slag: ${p.metadata.naam}`, mooi(`<p style="margin:0 0 12px">Hoi,</p>
    <p style="margin:0 0 12px">Bedankt! Je betaling voor <b>${esc(p.metadata.naam)}</b> is binnen. Jan neemt binnen één werkdag contact met je op om het samen af te stemmen.</p>
    <p style="margin:0;color:#5a6b82;font-size:14px">De factuur krijg je in een aparte mail.</p>`, "Bedankt voor je bestelling", esc(k.naam)));
  await mailJan(`Losse klus besteld: ${k.naam} – ${p.metadata.naam}`, `<p><b>${esc(k.naam)}</b> heeft <b>${esc(p.metadata.naam)}</b> besteld en betaald (${euro(f.totaal)} incl. btw).</p>
    ${p.metadata.toelichting ? `<p>Toelichting van de klant: “${esc(p.metadata.toelichting)}”</p>` : ""}<p>Besteld door ${esc(p.metadata.door || "")}. De site is niet automatisch gekoppeld, dus dit moet je zelf doen. Neem binnen een werkdag contact op.</p>`);
  return { ok: true, status: "betaald" };
}

// ---------- overstappen, Sitehulpje erbij, pauzemaand (onder het account) ----------
async function wissel(g: any, b: any) {
  const [k] = await sql`select * from beheersite.klanten where id = ${g.klant_id}`;
  if (!k) throw new Fout(404, "Account niet gevonden.");
  const oud = abonnement(k).naam;
  if (b.pakket) {
    const p = String(b.pakket);
    if (!PRIJS[p]) throw new Fout(400, "Onbekend pakket.");
    if (k.bundel) {
      if (k.bundel === p) return { ok: true };
      await sql`update beheersite.klanten set bundel = ${p}, vb_pakket = ${p} where id = ${k.id}`;
    } else {
      if (!k.vb_pakket || !k.vindbaarheid) throw new Fout(400, "Je hebt nog geen pakket. Bestel het via sitehulpje.nl/bestellen.");
      if (k.vb_pakket === p) return { ok: true };
      await sql`update beheersite.klanten set vb_pakket = ${p} where id = ${k.id}`;
    }
  } else if (b.sitehulpje) {
    if (k.bundel || Number(k.sh_prijs) > 0) return { ok: true };
    // klant met alleen Vindbaarheid: wordt het pakket Sitehulpje Basis/Plus/Pro (Sitehulpje zit erin), 10% korting het eerste jaar
    if (k.vb_pakket) {
      const tot = iso(new Date(nuAms().getTime() + 365 * 86400_000));
      await sql`update beheersite.klanten set bundel = ${k.vb_pakket}, bundel_korting_tot = ${tot}, sh_prijs = 75 where id = ${k.id}`;
    } else await sql`update beheersite.klanten set sh_prijs = 125 where id = ${k.id}`;
  } else throw new Fout(400, "Wat wil je veranderen?");
  const [n] = await sql`select * from beheersite.klanten where id = ${k.id}`;
  const nv = nuAms(), nieuw = abonnement(n, maandVan(new Date(nv.getFullYear(), nv.getMonth() + 1, 1)));
  const aan = g.email || (await klantMailAdres(k.id));
  await mail(aan, `Je abonnement is aangepast`, mooi(`<p style="margin:0 0 12px">Hoi,</p>
    <p style="margin:0 0 12px">Je abonnement is aangepast naar <b>${esc(nieuw.naam)}</b>. Dat gaat meteen in. Vanaf de volgende factuur betaal je ${euro(nieuw.excl)} per maand (excl. btw).</p>
    <p style="margin:0;color:#5a6b82;font-size:14px">Was dit niet de bedoeling? Beantwoord deze mail, dan zetten we het terug.</p>`, "Abonnement aangepast", esc(k.naam)));
  await mailJan(`Abonnement aangepast: ${k.naam}`, `<p><b>${esc(k.naam)}</b> is overgestapt van ${esc(oud)} naar <b>${esc(nieuw.naam)}</b> (${euro(nieuw.excl)} per maand).${b.sitehulpje ? " Zet de Sitehulpje-koppeling klaar als die er nog niet is." : ""}</p>`);
  return { ok: true, naam: nieuw.naam, netto: nieuw.excl };
}
async function pauzemaand(g: any) {
  const [k] = await sql`select * from beheersite.klanten where id = ${g.klant_id}`;
  if (!k) throw new Fout(404, "Account niet gevonden.");
  if (k.pauzemaand_op && Date.now() - new Date(k.pauzemaand_op).getTime() < 365 * 86400_000) throw new Fout(400, "Je hebt dit jaar al een pauzemaand gehad. Bel of mail ons gerust, dan kijken we samen.");
  if (Number(k.korting_pct) > 0 || Number(k.korting_eur) > 0) throw new Fout(400, "Je hebt al een korting. Bel of mail ons gerust, dan kijken we samen.");
  const nu = nuAms(), eind = iso(laatsteDag(nu.getFullYear(), nu.getMonth() + 1)), maand = MAANDEN[(nu.getMonth() + 1) % 12];
  await sql`update beheersite.klanten set korting_pct = 100, korting_eur = null, korting_van = ${iso(new Date(Date.UTC(nu.getFullYear(), nu.getMonth() + 1, 1)))}, korting_tot = ${eind}, korting_reden = 'Pauzemaand', korting_gemeld = true, pauzemaand_op = ${iso(nu)} where id = ${k.id}`;
  const aan = g.email || (await klantMailAdres(k.id));
  await mail(aan, `Je pauzemaand staat klaar`, mooi(`<p style="margin:0 0 12px">Hoi,</p>
    <p style="margin:0 0 12px">Fijn dat je blijft! In <b>${maand}</b> betaal je niets. Alles blijft gewoon werken. Daarna gaat je abonnement vanzelf weer verder.</p>
    <p style="margin:0;color:#5a6b82;font-size:14px">Wil je toch iets anders? Beantwoord deze mail.</p>`, "Een maand pauze", esc(k.naam)));
  await mailJan(`Pauzemaand gekozen: ${k.naam}`, `<p><b>${esc(k.naam)}</b> wilde opzeggen maar koos een pauzemaand (${maand} gratis). Misschien even bellen hoe het gaat?</p>`);
  return { ok: true, maand };
}

// ---------- bestellen via de site ----------
// Eerste betaling (rest van deze maand naar rato) via iDEAL; dat geeft ook toestemming voor de maandelijkse incasso.
// In de testmodus van Mollie (test-sleutel) mag dit al, ook als de facturen nog op "concept" staan.
async function bestelBetaling(id: string) {
  if (!MOLLIE) throw new Fout(503, "Bestellen is nog niet open. Bel of mail ons gerust.");
  if (!(await modusAan()) && !MOLLIE.startsWith("test_")) throw new Fout(503, "Bestellen is nog niet open. Bel of mail ons gerust.");
  const [bs] = await sql`select * from beheersite.vb_bestellingen where id = ${id} and status = 'nieuw'`;
  if (!bs) throw new Fout(404, "Bestelling niet gevonden.");
  if (bs.betaallink) return { ok: true, url: bs.betaallink };
  const g = bs.gegevens;
  const [kc] = bs.kortingscode ? await sql`select * from beheersite.kortingscodes where code = ${bs.kortingscode}` : [];
  const shp = bs.bundel ? 0 : bs.sitehulpje ? (bs.pakket ? 75 : 125) : 0;
  const vbp = bs.bundel ? Math.round(BUNDEL[bs.pakket] * (1 - BUNDEL_KORTING) * 100) / 100 : bs.pakket ? PRIJS[bs.pakket] : 0;
  const kk = !kc ? null : kc.soort === "deel" ? { soort: "eur", waarde: Math.round(vbp * Number(kc.pct_vb || 0) + shp * Number(kc.pct_sh || 0)) / 100 } : { soort: kc.soort, waarde: Number(kc.waarde) };
  const ab = abonnement({ vindbaarheid: !!bs.pakket, vb_pakket: bs.pakket, sh_prijs: shp, bundel: bs.bundel ? bs.pakket : null, bundel_korting_tot: bs.bundel ? "2999-12-31" : null,
    korting_pct: kk?.soort === "pct" ? kk.waarde : null, korting_eur: kk?.soort === "eur" ? kk.waarde : null, korting_reden: kc ? `kortingscode ${kc.code}` : null });
  const nu = nuAms(), periode = maandVan(nu), dagen = new Date(nu.getFullYear(), nu.getMonth() + 1, 0).getDate(), rest = dagen - nu.getDate() + 1;
  const oms = `${ab.naam} – ${rest} van ${dagen} dagen ${maandNaam(periode)}`;
  const regels = regelsVan(ab, oms, rest / dagen);
  const excl = regels ? Math.round(regels.reduce((t: number, r: any) => t + r.bedrag, 0) * 100) / 100 : Math.round(((ab.excl * rest) / dagen) * 100) / 100, b = bedragen(excl);
  const c = await mollie("customers", { name: g.bedrijf.naam, email: g.email, metadata: { bestelling: bs.id } });
  const p = await mollie("payments", {
    amount: bedrag(b.totaal), description: `Sitehulpje.nl bestelling – eerste maand`, sequenceType: "first", customerId: c.id,
    redirectUrl: `https://sitehulpje.nl/bestellen?klaar=${bs.id}&t=${bs.token}`, webhookUrl: FUNCTIE_URL + "?mollie=1",
    metadata: { bestelling: bs.id, eerste: true, excl, periode, omschrijving: oms, ...(regels ? { regels } : {}) },
  });
  const link = p._links?.checkout?.href || null;
  await sql`update beheersite.vb_bestellingen set mollie_klant = ${c.id}, mollie_betaling = ${p.id}, betaallink = ${link} where id = ${bs.id}`;
  return { ok: true, url: link };
}
async function bestellingBetaald(p: any) {
  const [bs] = await sql`select * from beheersite.vb_bestellingen where id = ${p.metadata.bestelling}`;
  if (!bs) return { ok: true, genegeerd: true };
  if (p.status !== "paid") {
    if (["failed", "expired", "canceled"].includes(p.status) && bs.status === "nieuw") await sql`update beheersite.vb_bestellingen set betaallink = null, mollie_betaling = null where id = ${bs.id}`;
    return { ok: true, status: p.status };
  }
  if (bs.klant_id) return { ok: true, al: true };
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/vb-bestel`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-key": (await inst()).cron_sleutel || "" },
    body: JSON.stringify({ actie: "betaald", id: bs.id, mollie_klant: p.customerId, mandaat: p.mandateId || null }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.klant_id) throw new Error(`Account aanmaken mislukt: ${d.fout || r.status}`);
  const [k] = await sql`select * from beheersite.klanten where id = ${d.klant_id}`;
  const f = await maakFactuur(k, p.metadata.periode, "eerste", Number(p.metadata.excl), p.metadata.omschrijving, Array.isArray(p.metadata.regels) ? p.metadata.regels : null);
  await sql`update beheersite.vb_facturen set status = 'betaald', betaald = now(), betaald_via = 'mollie', mollie_betaling = ${p.id} where id = ${f.id}`;
  await logRegel(f, `Eerste betaling via de bestelpagina (${p.method || "ideal"})`);
  await factuurMail(f.id).catch(() => {});
  return { ok: true, status: "betaald", klant_id: d.klant_id };
}

async function handel(req: Request, b: any) {
  const url = new URL(req.url);
  if (url.searchParams.get("mollie")) {
    // Mollie stuurt alleen een id; we halen de echte status altijd zelf op bij Mollie
    const form = await req.formData().catch(() => null);
    const id = String(form?.get("id") || "");
    if (!/^tr_[A-Za-z0-9]+$/.test(id)) throw new Fout(400, "Onbekend");
    return await verwerkBetaling(id);
  }
  const a = b.actie;
  if (a === "bestel_betaling") {
    const i = await inst();
    if (!i.cron_sleutel || req.headers.get("x-cron-key") !== i.cron_sleutel) throw new Fout(401, "Geen toegang");
    return await bestelBetaling(String(b.id || ""));
  }
  if (a === "maandelijks" || a === "herinneringen" || a === "opzeg_verwerk") {
    const i = await inst();
    if (!i.cron_sleutel || req.headers.get("x-cron-key") !== i.cron_sleutel) throw new Fout(401, "Geen toegang");
    return a === "maandelijks" ? await maandelijks() : a === "herinneringen" ? await herinneringen() : await opzegVerwerk();
  }
  if (a === "toon_publiek") {
    // factuur bekijken via de link in de mail, zonder inloggen
    const [f] = await sql`select * from beheersite.vb_facturen where id = ${String(b.id || "")} and token = ${String(b.t || "")} and status <> 'concept'`;
    if (!f) throw new Fout(404, "Factuur niet gevonden.");
    return { factuur: f };
  }
  const g = await gebruikerVan(req);
  const isAdmin = g.rol === "admin";
  const klantId = isAdmin ? String(b.klant_id || "") : g.klant_id;

  if (a === "lijst") {
    const fs = isAdmin && !klantId
      ? await sql`select f.id, f.nummer, f.klant_id, k.naam, f.periode, f.soort, f.omschrijving, f.totaal, f.status, f.datum, f.betaald, f.betaald_via, f.aanmaning, f.incasso_klaar, f.incasso_gestuurd
          from beheersite.vb_facturen f join beheersite.klanten k on k.id = f.klant_id order by f.gemaakt desc limit 200`
      : await sql`select id, nummer, periode, soort, omschrijving, totaal, status, datum, betaald, betaallink from beheersite.vb_facturen
          where klant_id = ${klantId} and (status <> 'concept' or ${isAdmin}) order by gemaakt desc`;
    const pauzes = isAdmin ? await sql`select id, naam, vb_pauze, vb_pauze_reden from beheersite.klanten where vb_pauze is not null` : [];
    const ii = await inst();
    return { facturen: fs, pauzes, modus: ii.vb_facturen_modus, mollie: !!MOLLIE, ...(isAdmin ? { incasso_email: ii.vb_incasso_email || "", incasso_auto: ii.vb_incasso_auto === "aan" } : {}) };
  }
  if (a === "toon") {
    const [f] = await sql`select * from beheersite.vb_facturen where id = ${String(b.id || "")} and (klant_id = ${klantId} or ${isAdmin})`;
    if (!f || (f.status === "concept" && !isAdmin)) throw new Fout(404, "Factuur niet gevonden.");
    return { factuur: f };
  }
  if (a === "status") {
    // voor de klantpagina: staat de klant op pauze en is er iets te betalen?
    const [k] = await sql`select vb_pauze, vb_pauze_reden from beheersite.klanten where id = ${klantId}`;
    const open = await sql`select id, nummer, totaal, status, betaallink from beheersite.vb_facturen where klant_id = ${klantId} and status in ('teruggeboekt','mislukt')`;
    return { pauze: k?.vb_pauze || null, open };
  }
  if (a === "abonnement") {
    if (isAdmin && !klantId) throw new Fout(400, "Geen klant.");
    const { k, delen, eindDeze } = await abonnementVan(klantId);
    const ab = abonnement(k, maandVan(nuAms()));
    return { delen, eind_deze_maand: eindDeze, opzeg_per: k.opzeg_per, opzeg_wat: k.opzeg_wat || [], bruto: ab.bruto, korting: ab.korting, netto: ab.excl,
      ...(isAdmin ? { korting_eur: k.korting_eur, korting_pct: k.korting_pct, korting_tot: k.korting_tot, korting_van: k.korting_van, korting_reden: k.korting_reden } : {}),
      komend: (() => { const nv = nuAms(), v = abonnement(k, maandVan(new Date(nv.getFullYear(), nv.getMonth() + 1, 1))); return v.korting !== ab.korting ? { korting: v.korting, netto: v.excl, reden: k.korting_reden } : null; })() };
  }
  if (a === "opzeggen") {
    if (isAdmin) throw new Fout(400, "Opzeggen doet de klant zelf; jij kunt dit in beheer regelen.");
    const wat = (Array.isArray(b.wat) ? b.wat : []).map(String);
    return await opzeggen(g, wat, String(b.reden || "").trim());
  }
  if (a === "opzeg_terug") {
    await sql`update beheersite.klanten set opzeg_per = null, opzeg_wat = null where id = ${klantId}`;
    if (!isAdmin) { const [k] = await sql`select naam from beheersite.klanten where id = ${klantId}`; await mailJan(`Opzegging ingetrokken: ${k?.naam}`, `<p><b>${esc(k?.naam || "")}</b> heeft de opzegging zelf ingetrokken.</p>`); }
    return { ok: true };
  }
  if (a === "wissel") { if (isAdmin) throw new Fout(400, "Dit doet de klant zelf."); return await wissel(g, b); }
  if (a === "pauzemaand") { if (isAdmin) throw new Fout(400, "Dit doet de klant zelf."); return await pauzemaand(g); }
  if (a === "klus") { if (isAdmin) throw new Fout(400, "Dit doet de klant zelf."); return await klusBestel(g, String(b.klus || ""), String(b.toelichting || "")); }
  if (a === "eerste") {
    const [k] = await sql`select * from beheersite.klanten where id = ${klantId}`;
    if (!k) throw new Fout(404, "Klant niet gevonden.");
    return await eerste(k);
  }

  if (!isAdmin) throw new Fout(403, "Geen toegang");
  if (a === "korting") {
    const soort = String(b.soort || "geen"), w = Math.max(0, Number(String(b.waarde || 0).replace(",", ".")) || 0);
    if (soort === "procent" && (w <= 0 || w > 100)) throw new Fout(400, "Vul een percentage tussen 1 en 100 in.");
    if (soort === "bedrag" && w <= 0) throw new Fout(400, "Vul een bedrag in.");
    const tot = b.tot && /^\d{4}-\d{2}-\d{2}$/.test(String(b.tot)) ? String(b.tot) : null;
    const [k] = await sql`update beheersite.klanten set korting_eur = ${soort === "bedrag" ? w : null}, korting_pct = ${soort === "procent" ? w : null},
      korting_van = null, korting_tot = ${soort === "geen" ? null : tot}, korting_reden = ${soort === "geen" ? null : String(b.reden || "").trim().slice(0, 80) || null}, korting_gemeld = false
      where id = ${klantId} returning *`;
    if (!k) throw new Fout(404, "Klant niet gevonden.");
    const ab = abonnement(k, maandVan(nuAms()));
    return { ok: true, bruto: ab.bruto, korting: ab.korting, netto: ab.excl };
  }
  if (a === "handmatig_betaald") {
    const [f] = await sql`update beheersite.vb_facturen set status = 'betaald', betaald = now(), betaald_via = 'handmatig' where id = ${String(b.id || "")} and status <> 'concept' returning *`;
    if (!f) throw new Fout(404, "Factuur niet gevonden (of nog een concept).");
    await logRegel(f, "Door Jan op betaald gezet (buiten Mollie)");
    if (f.mollie_betaling && f.betaallink) await mollie(`payments/${f.mollie_betaling}`, undefined, "DELETE").catch(() => {});
    return { ok: true, hervat: await hervat(f.klant_id) };
  }
  if (a === "naar_incasso") {
    const [f] = await sql`select * from beheersite.vb_facturen where id = ${String(b.id || "")} and status in ('teruggeboekt','mislukt','open') and nummer is not null`;
    if (!f) throw new Fout(404, "Factuur niet gevonden of al betaald.");
    await naarIncasso(f);
    return { ok: true };
  }
  if (a === "incasso_instellen") {
    const adres = String(b.adres || "").trim().toLowerCase();
    if (adres && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adres)) throw new Fout(400, "Ongeldig e-mailadres.");
    await sql`update beheersite.instellingen set waarde = ${adres} where sleutel = 'vb_incasso_email'`;
    await sql`update beheersite.instellingen set waarde = ${b.auto && adres ? "aan" : "uit"} where sleutel = 'vb_incasso_auto'`;
    return { ok: true };
  }
  if (a === "pauze") {
    const [k] = await sql`select * from beheersite.klanten where id = ${klantId}`;
    if (!k) throw new Fout(404, "Klant niet gevonden.");
    if (b.aan) await pauze(k, String(b.reden || "Door Jan op pauze gezet").slice(0, 200));
    else await sql`update beheersite.klanten set vindbaarheid = true, vb_pauze = null, vb_pauze_reden = null where id = ${k.id}`;
    return { ok: true };
  }
  if (a === "kwartaal") {
    const jaar = Number(b.jaar) || nuAms().getFullYear(), kw = Math.min(4, Math.max(1, Number(b.kwartaal) || Math.ceil((nuAms().getMonth() + 1) / 3)));
    const van = `${jaar}-${String((kw - 1) * 3 + 1).padStart(2, "0")}-01`;
    const tot = kw === 4 ? `${jaar + 1}-01-01` : `${jaar}-${String(kw * 3 + 1).padStart(2, "0")}-01`;
    const rijen = await sql`select f.nummer, f.datum, f.gegevens->'klant'->>'naam' klant, f.omschrijving, f.bedrag_excl, f.btw, f.totaal, f.status, f.betaald, f.betaald_via
      from beheersite.vb_facturen f where f.nummer is not null and f.datum >= ${van} and f.datum < ${tot} order by f.nummer`;
    const som = rijen.reduce((s, r) => ({ excl: s.excl + Number(r.bedrag_excl), btw: s.btw + Number(r.btw), totaal: s.totaal + Number(r.totaal) }), { excl: 0, btw: 0, totaal: 0 });
    return { jaar, kwartaal: kw, rijen, som };
  }
  if (a === "modus") {
    const m = b.modus === "aan" ? "aan" : "concept";
    if (m === "aan" && !MOLLIE) throw new Fout(400, "Zet eerst de Mollie-sleutel (MOLLIE_API_KEY) in Supabase.");
    await sql`update beheersite.instellingen set waarde = ${m} where sleutel = 'vb_facturen_modus'`;
    return { ok: true, modus: m };
  }
  if (a === "proef") {
    // conceptfactuur voor deze maand maken om te bekijken (telt niet mee, geen nummer)
    const [k] = await sql`select * from beheersite.klanten where id = ${klantId}`;
    if (!k?.vb_pakket) throw new Fout(400, "Deze klant heeft geen pakket.");
    const periode = maandVan(nuAms());
    await sql`delete from beheersite.vb_facturen where klant_id = ${k.id} and periode = ${periode} and soort = 'los' and status = 'concept'`;
    const g = await klantGegevens(k.id), bb = bedragen(PRIJS[k.vb_pakket]);
    const [f] = await sql`insert into beheersite.vb_facturen (klant_id, periode, soort, omschrijving, bedrag_excl, btw, totaal, status, gegevens)
      values (${k.id}, ${periode}, 'los', ${`Sitehulpje Vindbaarheid ${PAKKET[k.vb_pakket]} – ${maandNaam(periode)}`}, ${bb.excl}, ${bb.btw}, ${bb.totaal}, 'concept',
      ${sql.json({ klant: { naam: g.bedrijf?.naam || k.naam, contact: g.bedrijf?.contact || "", straat: g.bedrijf?.straat || "", postcode: g.bedrijf?.postcode || "", plaats: g.bedrijf?.plaats || "", kvk: g.bedrijf?.kvk || "", btw: g.bedrijf?.btw || "", email: g.bedrijf?.factuur_email || "" }, verkoper: VERKOPER, pakket: k.vb_pakket })}) returning id`;
    return { ok: true, id: f.id };
  }
  throw new Fout(400, "Onbekende actie");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fout: "Alleen POST" }, 405);
  try {
    const isMollie = new URL(req.url).searchParams.get("mollie");
    return json(await handel(req, isMollie ? {} : await req.json().catch(() => ({}))));
  } catch (e) {
    if (e instanceof Fout) return json({ fout: e.message }, e.code);
    console.error(e);
    return json({ fout: "Er ging iets mis. Probeer het zo nog eens." }, 500);
  }
});

