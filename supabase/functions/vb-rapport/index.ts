// Sitehulpje SEO – maandrapport (Supabase Edge Function "vb-rapport")
// Maakt per klant per maand een vaste momentopname, zodat oude rapporten altijd hetzelfde blijven.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
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
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const maandNaam = (m: string) => `${MAANDEN[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const vorigeMaand = (m: string) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const eindVan = (m: string) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)); return d.toISOString().slice(0, 10); };
// Naam voor de klant: Sitehulpje Basis/Plus/Pro (Sitehulpje zit erin), of Sitehulpje SEO Basis/Plus/Pro (alleen SEO)
const PK: Record<string, string> = { basis: "Basis", plus: "Plus", pro: "Pro" };
const pakketNaam = (k: any) => {
  const n = PK[k.bundel || k.vb_pakket || ""] || "";
  return ((k.bundel || Number(k.sh_prijs) > 0) ? `Sitehulpje ${n}` : `Sitehulpje SEO ${n}`).trim();
};

async function inst() {
  const r = await sql`select sleutel, waarde from beheersite.instellingen`;
  return Object.fromEntries(r.map((x) => [x.sleutel, x.waarde])) as Record<string, string>;
}
async function gebruikerVan(req: Request) {
  const t = req.headers.get("x-sessie");
  if (!t) throw new Fout(401, "Niet ingelogd");
  const r = await sql`select g.id, g.rol, g.klant_id from beheersite.sessies s join beheersite.gebruikers g on g.id = s.gebruiker_id
    where s.token_hash = ${await sha256(t)} and s.verloopt > now() and g.actief`;
  if (!r.length) throw new Fout(401, "Niet ingelogd");
  return r[0];
}
async function klantVoor(g: any, gevraagd?: string) {
  const id = g.rol === "admin" ? String(gevraagd || g.klant_id || "") : g.klant_id;
  const [k] = id ? await sql`select id, naam, site, vindbaarheid, vb_pakket, bundel, sh_prijs, vb_rapport_mail, vb_start from beheersite.klanten where id = ${id}` : [];
  if (!k) throw new Fout(404, "Klant niet gevonden.");
  if (!k.vindbaarheid && g.rol !== "admin") throw new Fout(403, "Sitehulpje SEO staat niet aan voor jouw account.");
  return k;
}

async function totalen(klantId: string, maand: string) {
  const van = `${maand}-01`, tot = eindVan(maand);
  const [g] = await sql`select coalesce(sum(klikken),0)::int klikken, coalesce(sum(vertoningen),0)::int vertoningen,
      case when sum(vertoningen) > 0 then round(sum(positie * vertoningen) / sum(vertoningen), 1)::float end positie, count(*)::int dagen
    from beheersite.vb_gsc_dag where klant_id = ${klantId} and datum between ${van} and ${tot}`;
  const [a] = await sql`select coalesce(sum(bezoekers),0)::int bezoekers, coalesce(sum(sessies),0)::int sessies,
      coalesce(sum(organisch),0)::int organisch, coalesce(sum(acties),0)::int acties, count(*)::int dagen
    from beheersite.vb_ga4_dag where klant_id = ${klantId} and datum between ${van} and ${tot}`;
  return { gsc: g, ga4: a };
}

const maandTerug = (m: string, n: number) => { let x = m; for (let i = 0; i < n; i++) x = vorigeMaand(x); return x; };
const perDag = (t: any, veld: string, bron: "gsc" | "ga4") => (t?.[bron]?.dagen ? t[bron][veld] / t[bron].dagen : null);
const verschil = (a: number | null, b: number | null) => (a == null || b == null || !b ? null : Math.round(((a - b) / b) * 100));

// Uitleg bij stijging of daling, op basis van regels (gratis, geen AI).
async function analyse(k: { id: string }, maand: string, nu: any, vorig: any, jaar: any, jaarVorig: any, gz: any, gzV: any) {
  const redenen: { soort: string; tekst: string }[] = [];
  const kNu = perDag(nu, "klikken", "gsc"), kVo = perDag(vorig, "klikken", "gsc");
  const vNu = perDag(nu, "vertoningen", "gsc"), vVo = perDag(vorig, "vertoningen", "gsc");
  const dKlik = verschil(kNu, kVo), dVert = verschil(vNu, vVo);
  const richting = dKlik == null ? "onbekend" : dKlik <= -10 ? "daling" : dKlik >= 10 ? "stijging" : "stabiel";

  // 1. Seizoen: deed vorig jaar dezelfde maand hetzelfde?
  const dJaarOvergang = verschil(perDag(jaar, "klikken", "gsc"), perDag(jaarVorig, "klikken", "gsc"));
  if (dKlik != null && dJaarOvergang != null && Math.abs(dKlik) >= 10 && Math.sign(dKlik) === Math.sign(dJaarOvergang) && Math.abs(dJaarOvergang) >= 8)
    redenen.push({ soort: "seizoen", tekst: `Vorig jaar was er in dezelfde maand ook een ${dJaarOvergang < 0 ? "daling" : "stijging"} (${dJaarOvergang > 0 ? "+" : ""}${dJaarOvergang}%). Dit lijkt dus deels seizoen: in deze periode wordt er ${dJaarOvergang < 0 ? "minder" : "meer"} gezocht.` });
  const dJaar = verschil(kNu, perDag(jaar, "klikken", "gsc"));
  if (dJaar != null && richting === "daling" && dJaar > 0)
    redenen.push({ soort: "jaar", tekst: `Vergeleken met dezelfde maand vorig jaar staat de site er juist beter voor (+${dJaar}% klikken per dag).` });

  // 2. Minder vertoningen = minder gezocht of lager in Google; zelfde vertoningen maar minder klikken = minder aantrekkelijk in de zoekresultaten
  const pNu = nu.gsc.positie, pVo = vorig.gsc.positie;
  if (richting === "daling") {
    if (pNu != null && pVo != null && pNu - pVo >= 1)
      redenen.push({ soort: "positie", tekst: `De site staat gemiddeld lager in Google (plek ${pNu} tegen ${pVo} de maand ervoor). Lager staan geeft minder klikken.` });
    if (dVert != null && dVert <= -10 && !(pNu != null && pVo != null && pNu - pVo >= 1))
      redenen.push({ soort: "vraag", tekst: `De site werd ${Math.abs(dVert)}% minder vaak getoond, terwijl de plek in Google ongeveer gelijk bleef. Er is dus minder gezocht op deze onderwerpen.` });
    if (dVert != null && dVert > -5)
      redenen.push({ soort: "ctr", tekst: `De site werd even vaak getoond, maar er werd minder vaak op geklikt. Mogelijk tonen concurrenten of Google zelf (AI-antwoorden, kaarten) een aantrekkelijker resultaat. Betere titels en omschrijvingen helpen hier.` });
  } else if (richting === "stijging") {
    if (pNu != null && pVo != null && pVo - pNu >= 1)
      redenen.push({ soort: "positie", tekst: `De site staat gemiddeld hoger in Google (plek ${pNu} tegen ${pVo}).` });
    if (dVert != null && dVert >= 10)
      redenen.push({ soort: "vraag", tekst: `De site werd ${dVert}% vaker getoond in Google.` });
  }

  // 3. Technische meldingen en bereikbaarheid in deze maand
  const van = `${maand}-01`, tot = eindVan(maand);
  const meld = await sql`select soort, ernst, tekst from beheersite.vb_meldingen where klant_id = ${k.id}
    and gemaakt >= ${van}::date and gemaakt < (${tot}::date + interval '1 day') order by gemaakt limit 10`;
  const [up] = await sql`select count(*)::int n, count(*) filter (where not ok)::int fout from beheersite.vb_uptime
    where klant_id = ${k.id} and tijd >= ${van}::date and tijd < (${tot}::date + interval '1 day')`;
  const bereikbaar = up?.n ? Math.round((1 - up.fout / up.n) * 1000) / 10 : null;
  if (bereikbaar != null && bereikbaar < 99.5)
    redenen.push({ soort: "storing", tekst: `De website was ${Math.round((100 - bereikbaar) * 10) / 10}% van de tijd niet bereikbaar. Dat kost bezoekers en Google ziet het ook.` });
  for (const m of meld.filter((m) => m.ernst === "hoog" && m.soort !== "daling").slice(0, 2)) redenen.push({ soort: "melding", tekst: m.tekst });
  if (gz && gzV && gzV.score - gz.score >= 10)
    redenen.push({ soort: "gezondheid", tekst: `De gezondheidsscore van de website ging van ${gzV.score} naar ${gz.score}. Er zijn technische problemen bijgekomen.` });

  // 4. Welke zoekwoorden en pagina's verloren of wonnen het meest
  const verschuiving = async (soort: string, richtingSql: "asc" | "desc") => await sql`select n.sleutel, n.klikken nu, coalesce(o.klikken,0) vorig, (n.klikken - coalesce(o.klikken,0)) verschil
    from beheersite.vb_gsc_top n left join beheersite.vb_gsc_top o on o.klant_id = n.klant_id and o.soort = n.soort and o.periode = 'vorige' and o.sleutel = n.sleutel
    where n.klant_id = ${k.id} and n.soort = ${soort} and n.periode = 'nu'
    union all
    select o.sleutel, 0, o.klikken, -o.klikken from beheersite.vb_gsc_top o
    where o.klant_id = ${k.id} and o.soort = ${soort} and o.periode = 'vorige'
      and not exists (select 1 from beheersite.vb_gsc_top n where n.klant_id = o.klant_id and n.soort = o.soort and n.periode = 'nu' and n.sleutel = o.sleutel)
    order by verschil ${sql.unsafe(richtingSql)} limit 5`;
  const verliezers = (await verschuiving("zoekwoord", "asc")).filter((x) => x.verschil < 0);
  const winnaars = (await verschuiving("zoekwoord", "desc")).filter((x) => x.verschil > 0);
  const paginaVerlies = (await verschuiving("pagina", "asc")).filter((x) => x.verschil < 0);
  if (richting === "daling" && verliezers.length) {
    const totaalVerlies = verliezers.reduce((s, x) => s + x.verschil, 0);
    redenen.push({ soort: "zoekwoorden", tekst: `De grootste daling zit in: ${verliezers.slice(0, 3).map((x) => `"${x.sleutel}" (${x.verschil})`).join(", ")}. Samen ${Math.abs(totaalVerlies)} klikken minder.` });
  }
  if (richting === "daling" && !redenen.length)
    redenen.push({ soort: "onbekend", tekst: "Er is geen duidelijke technische oorzaak gevonden. Kleine schommelingen zijn normaal; we houden het in de gaten." });

  const samenvatting = richting === "daling" ? `Minder klikken uit Google dan de maand ervoor (${dKlik}% per dag).`
    : richting === "stijging" ? `Meer klikken uit Google dan de maand ervoor (+${dKlik}% per dag).`
    : richting === "stabiel" ? "Het aantal klikken uit Google bleef ongeveer gelijk." : "Nog niet genoeg gegevens om te vergelijken.";
  return { richting, samenvatting, verschil_klikken: dKlik, verschil_vertoningen: dVert, verschil_jaar: dJaar, redenen,
    verliezers: verliezers.slice(0, 5), winnaars: winnaars.slice(0, 5), pagina_verlies: paginaVerlies.slice(0, 3), bereikbaar,
    meldingen: meld.length };
}

// Optioneel: korte uitleg in gewone taal door Claude. Staat UIT (kost geld). Aanzetten: instellingen.vb_ai_uitleg = 'aan'.
async function aiUitleg(k: any, maand: string, a: any) {
  const s = await inst();
  if (s.vb_ai_uitleg !== "aan" || !s.anthropic_sleutel || a.richting !== "daling") return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": s.anthropic_sleutel, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: s.ai_model || "claude-haiku-5-5", max_tokens: 400,
        messages: [{ role: "user", content: `Leg in maximaal 4 korte zinnen, in eenvoudig Nederlands voor een ondernemer zonder SEO-kennis, uit waarom de website ${k.site} in ${maandNaam(maand)} minder klikken uit Google kreeg en wat we eraan doen. Gebruik het woord "vindbaarheid" niet. Verzin niets dat niet in de gegevens staat. Gegevens: ${JSON.stringify(a)}` }] }),
    });
    const j = await r.json();
    const u = j.usage || {};
    const kosten = ((u.input_tokens || 0) * 0.10 + (u.output_tokens || 0) * 0.50) / 1e6;
    await sql`insert into beheersite.ai_kosten (klant_id, model, invoer, uitvoer, usd) values (${k.id}, ${s.ai_model || "claude-haiku-5-5"}, ${u.input_tokens || 0}, ${u.output_tokens || 0}, ${kosten})`.catch(() => {});
    return j.content?.[0]?.text || null;
  } catch { return null; }
}

async function maak(k: { id: string; naam: string; site: string; vb_pakket: string | null; bundel?: string | null; sh_prijs?: any; vb_start?: string | null }, maand: string, metAi = true) {
  const nu = await totalen(k.id, maand), vorig = await totalen(k.id, vorigeMaand(maand));
  const jaarM = maandTerug(maand, 12);
  const jaar = await totalen(k.id, jaarM), jaarVorig = await totalen(k.id, vorigeMaand(jaarM));
  // Nulmeting: de laatste volle maand vóór de start van Sitehulpje SEO (of de eerste maand met gegevens)
  let nulMaand: string | null = k.vb_start ? vorigeMaand(String(k.vb_start).slice(0, 7)) : null;
  if (!nulMaand) { const [e] = await sql`select to_char(min(datum),'YYYY-MM') m from beheersite.vb_gsc_dag where klant_id = ${k.id}`; nulMaand = e?.m || null; }
  const nul = nulMaand && nulMaand < maand ? await totalen(k.id, nulMaand) : null;
  const [v] = await sql`select google_email, gsc_site, ga4_naam from beheersite.vb_koppelingen where klant_id = ${k.id}`;
  // per week (voor de grafiek in het rapport): 12 maanden terug, per maand
  const reeks = await sql`select to_char(date_trunc('month', datum), 'YYYY-MM') m, sum(klikken)::int k, sum(vertoningen)::int v
    from beheersite.vb_gsc_dag where klant_id = ${k.id} and datum <= ${eindVan(maand)} and datum > (${eindVan(maand)}::date - interval '13 months')
    group by 1 order by 1`;
  const zoekwoorden = await sql`select n.sleutel, n.klikken, n.vertoningen, n.positie::float positie, o.positie::float vorige_positie
    from beheersite.vb_gsc_top n left join beheersite.vb_gsc_top o on o.klant_id = n.klant_id and o.soort = n.soort and o.periode = 'vorige' and o.sleutel = n.sleutel
    where n.klant_id = ${k.id} and n.soort = 'zoekwoord' and n.periode = 'nu' order by n.klikken desc, n.vertoningen desc limit 15`;
  // kansen: veel vertoningen, positie 4–20 (net niet bovenaan)
  const kansen = await sql`select sleutel, vertoningen, positie::float positie from beheersite.vb_gsc_top
    where klant_id = ${k.id} and soort = 'zoekwoord' and periode = 'nu' and positie between 4 and 20 and vertoningen >= 20
    order by vertoningen desc limit 5`;
  const paginas = await sql`select sleutel, klikken, vertoningen, positie::float positie from beheersite.vb_gsc_top
    where klant_id = ${k.id} and soort = 'pagina' and periode = 'nu' order by klikken desc limit 5`;
  const [gz] = await sql`select score, gemeten, uitslag from beheersite.vb_gezondheid where klant_id = ${k.id}
    and gemeten < (${eindVan(maand)}::date + interval '1 day') order by gemeten desc limit 1`;
  const [gzV] = await sql`select score from beheersite.vb_gezondheid where klant_id = ${k.id}
    and gemeten < (${maand + "-01"}::date) order by gemeten desc limit 1`;
  const werk = await sql`select nr, onderwerp, bijgewerkt from beheersite.verzoeken where klant_id = ${k.id} and status = 'klaar'
    and bijgewerkt >= (${maand + "-01"}::date::timestamp at time zone 'Europe/Amsterdam')
    and bijgewerkt < ((${maand + "-01"}::date + interval '1 month')::timestamp at time zone 'Europe/Amsterdam') order by bijgewerkt`;

  // Volgende stappen: belangrijkste gezondheidspunten + zoekwoordkansen
  const stappen: string[] = [];
  for (const p of (gz?.uitslag?.problemen || []).filter((x: any) => x.ernst !== "laag").slice(0, 3)) stappen.push(`${p.tekst} ${p.oplossing || ""}`.trim());
  for (const z of kansen.slice(0, 2)) stappen.push(`"${z.sleutel}" staat op plek ${Math.round(z.positie)} met ${z.vertoningen} vertoningen. Een betere pagina hiervoor kan veel extra klikken opleveren.`);
  if (stappen.length < 5) for (const p of (gz?.uitslag?.problemen || []).filter((x: any) => x.ernst === "laag").slice(0, 5 - stappen.length)) stappen.push(`${p.tekst} ${p.oplossing || ""}`.trim());

  const uitleg = await analyse(k, maand, nu, vorig, jaar, jaarVorig, gz, gzV);
  const ai = metAi ? await aiUitleg(k, maand, uitleg) : null;
  if (ai) (uitleg as any).ai = ai;
  // Bij een daling: zet het herstel bovenaan de stappen
  if (uitleg.richting === "daling" && uitleg.verliezers.length)
    stappen.unshift(`Herstel van "${uitleg.verliezers[0].sleutel}": deze zoekterm gaf ${Math.abs(uitleg.verliezers[0].verschil)} klikken minder. We bekijken de pagina die hierop gevonden wordt.`);

  const data = {
    klant: { naam: k.naam, site: k.site, pakket: k.bundel || k.vb_pakket, pakket_naam: pakketNaam(k) }, maand, maand_naam: maandNaam(maand), vorige_naam: maandNaam(vorigeMaand(maand)),
    bronnen: { search_console: v?.gsc_site || null, analytics: v?.ga4_naam || null },
    nu, vorig, reeks, zoekwoorden, kansen, paginas,
    jaar: jaar.gsc.dagen || jaar.ga4.dagen ? jaar : null, jaar_naam: maandNaam(jaarM),
    nulmeting: nul && (nul.gsc.dagen || nul.ga4.dagen) ? { ...nul, maand: nulMaand, naam: maandNaam(nulMaand!) } : null,
    uitleg,
    gezondheid: gz ? { score: gz.score, vorige: gzV?.score ?? null, gemeten: gz.gemeten,
      problemen: (gz.uitslag.problemen || []).slice(0, 8).map((p: any) => ({ ernst: p.ernst, tekst: p.tekst, groep: p.groep })),
      goed: (gz.uitslag.goed || []).slice(0, 6), snelheid: gz.uitslag.snelheid?.score ?? null } : null,
    werk: werk.map((w) => ({ nr: w.nr, onderwerp: w.onderwerp, datum: w.bijgewerkt })),
    stappen,
  };
  await sql`insert into beheersite.vb_rapporten (klant_id, maand, data) values (${k.id}, ${maand}, ${sql.json(data)})
    on conflict (klant_id, maand) do update set data = excluded.data, gemaakt = now()`;
  return data;
}

const getal = (n: number) => Math.round(n || 0).toLocaleString("nl-NL");
const pct = (nu: number, vorig: number) => (!vorig ? "" : (() => { const p = Math.round(((nu - vorig) / vorig) * 100); return p === 0 ? " (gelijk)" : ` (${p > 0 ? "+" : ""}${p}%)`; })());

async function mail(k: any, d: any, naarKlant: boolean) {
  const i = await inst();
  if (!i.resend_sleutel) return false;
  const van = (i.mail_van || "Sitehulpje <onboarding@resend.dev>").replace(/^[^<]*</, "Sitehulpje <");
  const link = `${i.platform_url || "https://sitehulpje.nl"}/rapport?maand=${d.maand}`;
  const pakket = d.klant?.pakket_naam || pakketNaam(k);
  const regels = [
    d.nu.gsc.dagen ? `Klikken uit Google: ${getal(d.nu.gsc.klikken)}${pct(d.nu.gsc.klikken, d.vorig.gsc.klikken)}` : null,
    d.nu.gsc.dagen ? `Vertoningen in Google: ${getal(d.nu.gsc.vertoningen)}${pct(d.nu.gsc.vertoningen, d.vorig.gsc.vertoningen)}` : null,
    d.nu.ga4.dagen ? `Bezoeken via Google: ${getal(d.nu.ga4.organisch)}${pct(d.nu.ga4.organisch, d.vorig.ga4.organisch)}` : null,
    d.nu.ga4.dagen ? `Acties op je site: ${getal(d.nu.ga4.acties)}${pct(d.nu.ga4.acties, d.vorig.ga4.acties)}` : null,
    d.jaar?.gsc?.dagen && d.nu.gsc.dagen ? `Tegenover ${d.jaar_naam}: ${pct(d.nu.gsc.klikken, d.jaar.gsc.klikken).trim().replace(/[()]/g, "") || "geen vergelijking"} klikken` : null,
    d.gezondheid ? `Website-gezondheid: ${d.gezondheid.score} van 100` : null,
    d.werk.length ? `Uitgevoerd door Sitehulpje: ${d.werk.length} aanpassing${d.werk.length > 1 ? "en" : ""}` : null,
  ].filter(Boolean);
  // Factuur van deze maand (wordt samen met het rapport verstuurd, een dag voor de incasso)
  const [f] = naarKlant ? await sql`select id, nummer, totaal, omschrijving from beheersite.vb_facturen where klant_id = ${k.id}
    and periode = ${new Date().toISOString().slice(0, 7)} and status in ('open','betaald') and nummer is not null order by gemaakt desc limit 1` : [];
  const factuurBlok = f ? `<div style="background:#f5f8fc;border-radius:10px;padding:12px 16px;margin:18px 0"><b>Je factuur ${f.nummer}</b><br>${f.omschrijving}: <b>€${Number(f.totaal).toLocaleString("nl-NL", { minimumFractionDigits: 2 })}</b> (incl. btw).<br>
    Dit bedrag wordt de komende werkdagen automatisch afgeschreven; je hoeft niets te doen. <a href="${i.platform_url || "https://sitehulpje.nl"}/factuur?id=${f.id}">Factuur bekijken of downloaden</a></div>` : "";
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0b1a2e">
    <h2 style="margin:0 0 4px">Je maandrapport over ${d.maand_naam}</h2><p style="color:#5a6b82;margin:0 0 16px">${k.naam} · ${pakket}</p>
    <ul style="padding-left:18px;line-height:1.7">${regels.map((r) => `<li>${r}</li>`).join("")}</ul>
    ${d.uitleg?.richting === "daling" ? `<p><b>Waarom minder?</b></p><ul style="padding-left:18px;line-height:1.5">${(d.uitleg.ai ? [d.uitleg.ai] : d.uitleg.redenen.slice(0, 3).map((r: any) => r.tekst)).map((t: string) => `<li>${t.replace(/</g, "&lt;")}</li>`).join("")}</ul>` : ""}
    ${d.stappen.length ? `<p><b>Wat we nu gaan aanpakken:</b></p><ol style="padding-left:18px;line-height:1.5">${d.stappen.slice(0, 3).map((s: string) => `<li>${s.replace(/</g, "&lt;")}</li>`).join("")}</ol>` : ""}
    ${factuurBlok}
    <p style="margin:24px 0"><a href="${link}" style="background:#0b9f8a;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold">Bekijk het volledige rapport</a></p>
    <p style="color:#5a6b82;font-size:13px">Je kunt het rapport ook als PDF downloaden. Vragen? Beantwoord deze mail.</p></div>`;
  const aan = naarKlant && k.vb_rapport_mail ? [k.vb_rapport_mail] : [i.jan_email];
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${i.resend_sleutel}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: van, to: aan, reply_to: "info@sitehulpje.nl",
      subject: `${naarKlant ? "" : "[Kopie voor Jan] "}${pakket}: je maandrapport over ${d.maand_naam}${f ? " + factuur" : ""} – ${k.naam}`, html }),
  });
  return r.ok;
}

async function handel(req: Request, b: any) {
  const a = b.actie;
  if (a === "maandelijks") {
    const i = await inst();
    if (!i.cron_sleutel || req.headers.get("x-cron-key") !== i.cron_sleutel) throw new Fout(401, "Geen toegang");
    const maand = vorigeMaand(new Date().toISOString().slice(0, 7));
    const ks = await sql`select id, naam, site, vb_pakket, bundel, sh_prijs, vb_rapport_mail, vb_start from beheersite.klanten where vindbaarheid and actief`;
    const uit: Record<string, unknown> = {};
    for (const k of ks) {
      try {
        const d = await maak(k, maand);
        const naarKlant = !!k.vb_rapport_mail;
        const ok = await mail(k, d, naarKlant);
        if (naarKlant && ok) await sql`update beheersite.vb_rapporten set gemaild_klant = now() where klant_id = ${k.id} and maand = ${maand}`;
        if (naarKlant) await mail(k, d, false); // kopie voor Jan
        uit[k.id] = ok ? "gemaild" : "gemaakt";
      } catch (e) { uit[k.id] = (e as Error).message; }
    }
    return { ok: true, maand, uit };
  }
  const g = await gebruikerVan(req);
  const k = await klantVoor(g, b.klant_id);
  if (a === "lijst") {
    const r = await sql`select maand, gemaakt from beheersite.vb_rapporten where klant_id = ${k.id} order by maand desc`;
    return { rapporten: r.map((x) => ({ maand: x.maand, naam: maandNaam(x.maand), gemaakt: x.gemaakt })) };
  }
  if (a === "toon") {
    const maand = /^\d{4}-\d{2}$/.test(b.maand || "") ? b.maand : null;
    if (!maand) throw new Fout(400, "Geen maand gekozen.");
    const [r] = await sql`select data from beheersite.vb_rapporten where klant_id = ${k.id} and maand = ${maand}`;
    // oude rapporten: altijd de huidige pakketnaam tonen
    if (r) return { rapport: { ...r.data, klant: { ...r.data.klant, pakket_naam: pakketNaam(k) } } };
    // lopende maand of nog niet gemaakt: tussenstand (niet opslaan)
    if (g.rol === "admin" || maand >= vorigeMaand(new Date().toISOString().slice(0, 7))) {
      const d = await maak(k, maand, false);
      if (maand === new Date().toISOString().slice(0, 7)) await sql`delete from beheersite.vb_rapporten where klant_id = ${k.id} and maand = ${maand}`;
      return { rapport: { ...d, tussenstand: maand === new Date().toISOString().slice(0, 7) } };
    }
    throw new Fout(404, "Voor deze maand is geen rapport.");
  }
  if (g.rol !== "admin") throw new Fout(403, "Geen toegang");
  if (a === "maak") {
    const maand = /^\d{4}-\d{2}$/.test(b.maand || "") ? b.maand : vorigeMaand(new Date().toISOString().slice(0, 7));
    const d = await maak(k, maand);
    if (b.mail) await mail(k, d, b.mail === "klant");
    return { ok: true, maand };
  }
  if (a === "mail_instellen") {
    const adres = String(b.adres || "").trim().toLowerCase();
    if (adres && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adres)) throw new Fout(400, "Ongeldig e-mailadres.");
    await sql`update beheersite.klanten set vb_rapport_mail = ${adres || null} where id = ${k.id}`;
    return { ok: true };
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
