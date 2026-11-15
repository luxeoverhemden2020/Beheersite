// Aanvragenbak (Supabase Edge Function "sr-aanvraag")
// - "nieuw" (openbaar, vanuit aanvraag.js op de klantsite): ingevuld formulier opslaan (geen mail; staat in portaal en maandrapport)
// - portaal (sessie): "lijst", "status" (klant / geen klant). Bij "klant" met een Google-klik (gclid):
//   melden aan Google Ads als conversie "Werd klant (Sitehulpje)", zodat Google leert welke klikken klanten opleveren.
// - cron "voorbereiden": conversieactie "Werd klant (Sitehulpje)" aanmaken in elk gekoppeld Ads-account
//   (moet bestaan vóór de klik, anders weigert Google de melding).
// Kosten: geen (e-mail via Resend, Google Ads API gratis).
// deno-lint-ignore-file no-explicit-any
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-sessie, x-cron-key, authorization, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (s: string) => b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
const CONV_NAAM = "Werd klant (Sitehulpje)";

async function inst() {
  const r = await sql`select sleutel, waarde from beheersite.instellingen`;
  return Object.fromEntries(r.map((x: any) => [x.sleutel, x.waarde])) as Record<string, string>;
}
async function gebruikerVan(req: Request) {
  const t = req.headers.get("x-sessie");
  if (!t) return null;
  const [g] = await sql`select g.id, g.rol, g.klant_id from beheersite.sessies s join beheersite.gebruikers g on g.id = s.gebruiker_id
    where s.token_hash = ${await sha256(t)} and s.verloopt > now() and g.actief`;
  return g || null;
}
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

// ---------- nieuwe aanvraag vanaf de klantsite ----------
const VERBODEN = /pass|wachtw|token|nonce|captcha|recaptcha|honeypot|iban|creditcard|cvc|bsn|_wp|form_id|form_key|^action$/i;
function velden(ruw: any) {
  const uit: Record<string, string> = {};
  if (!ruw || typeof ruw !== "object") return uit;
  for (const [k, v] of Object.entries(ruw).slice(0, 40)) {
    if (VERBODEN.test(k) || typeof v !== "string") continue;
    const w = v.trim(); if (!w) continue;
    uit[k.slice(0, 60)] = w.slice(0, 2000);
  }
  return uit;
}
const zoekVeld = (v: Record<string, string>, re: RegExp) => Object.entries(v).find(([k]) => re.test(k))?.[1] || null;
async function nieuw(req: Request, b: any) {
  const k = String(b.k || "").slice(0, 80);
  const [kl] = k ? await sql`select id, naam from beheersite.klanten where id = ${k} and actief` : [];
  if (!kl) return { ok: false };
  const v = velden(b.velden);
  if (Object.keys(v).length < 2) return { ok: false }; // zoekvelden, losse knoppen
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  if (ip) { const [{ n }] = await sql`select count(*)::int n from beheersite.aanvragen where ip = ${ip}::inet and tijd > now() - interval '1 hour'`; if (n >= 10) return { ok: false }; }
  const email = zoekVeld(v, /e-?mail/i) || Object.values(v).find((x) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x)) || null;
  const telefoon = zoekVeld(v, /tel|phone|mobiel|gsm/i);
  const naam = zoekVeld(v, /^(naam|name|your-name|voornaam|first.?name|full.?name)$|naam|name/i);
  const bericht = zoekVeld(v, /bericht|message|opmerking|vraag|comment|omschrijving|toelichting/i);
  const gclid = typeof b.gclid === "string" && /^[\w-]{10,200}$/.test(b.gclid) ? b.gclid : null;
  const pagina = typeof b.pagina === "string" ? b.pagina.slice(0, 500) : null;
  if (b.test) { // proefmail (alleen met cron-sleutel): niets opslaan
    const i = await inst();
    if (!i.cron_sleutel || req.headers.get("x-cron-key") !== i.cron_sleutel) return { ok: false };
    await mailOndernemer(kl, v, { naam, email, telefoon, bericht, gclid, pagina }, b.test_aan);
    return { ok: true, test: true };
  }
  const [a] = await sql`insert into beheersite.aanvragen (klant_id, naam, email, telefoon, bericht, velden, pagina, gclid, ip)
    values (${kl.id}, ${naam}, ${email}, ${telefoon}, ${bericht}, ${sql.json(v)}, ${pagina}, ${gclid}, ${ip}::inet) returning id`;
  // Geen mail per aanvraag (de site mailt zelf al): aanvragen staan in het portaal en in het maandrapport.
  // Alleen als instelling "aanvraag_mail" = "aan" (voor later, bijv. sites waarvan de eigen mail niet goed werkt).
  if ((await inst()).aanvraag_mail === "aan") await mailOndernemer(kl, v, { naam, email, telefoon, bericht, gclid, pagina });
  return { ok: true, id: a.id };
}

// nette mail in de Sitehulpje-stijl (zelfde opmaak als de budgetmail)
const LABEL: [RegExp, string][] = [[/^(your-)?(naam|name|full.?name)$/i, "Naam"], [/voornaam|first.?name/i, "Voornaam"], [/achternaam|last.?name/i, "Achternaam"],
  [/e-?mail/i, "E-mail"], [/tel|phone|mobiel|gsm/i, "Telefoon"], [/bericht|message|opmerking|comment/i, "Bericht"], [/onderwerp|subject/i, "Onderwerp"],
  [/bedrijf|company/i, "Bedrijf"], [/adres|address|straat/i, "Adres"], [/postcode|zip/i, "Postcode"], [/plaats|city|woonplaats/i, "Plaats"], [/datum|date/i, "Datum"]];
const label = (k: string) => LABEL.find(([re]) => re.test(k))?.[1] || (k.replace(/^your[-_]/i, "").replace(/[-_\[\]]+/g, " ").trim().replace(/^./, (c) => c.toUpperCase()) || k);
async function mailOndernemer(kl: any, v: Record<string, string>, x: any, testAan?: string) {
  const i = await inst();
  const aan = testAan ? [testAan] : (await sql`select email from beheersite.gebruikers where klant_id = ${kl.id} and rol = 'klant' and actief and email is not null`).map((r: any) => r.email);
  if (!i.resend_sleutel || !aan.length) return;
  const link = (i.platform_url || "https://sitehulpje.nl").replace(/\/$/, "") + "/portaal#aanvragen";
  const pad = (() => { try { const u = new URL(x.pagina); return u.pathname === "/" ? "de homepage" : u.pathname; } catch { return ""; } })();
  // bekende velden eerst, het bericht apart en groot
  const rest = Object.entries(v).filter(([, w]) => w !== x.bericht);
  rest.sort((a, b) => { const o = (k: string) => ["Naam", "Voornaam", "Achternaam", "Bedrijf", "Telefoon", "E-mail"].indexOf(label(k)); const oa = o(a[0]), ob = o(b[0]); return (oa < 0 ? 99 : oa) - (ob < 0 ? 99 : ob); });
  const rij = (k: string, w: string) => `<tr><td style="padding:7px 12px 7px 0;color:#5F5E5A;font-size:14px;vertical-align:top;white-space:nowrap">${esc(label(k))}</td><td style="padding:7px 0;font-size:15px;color:#0B1B3F">${esc(w).replace(/\n/g, "<br>")}</td></tr>`;
  const knop = (href: string, tekst: string, kleur: string) => `<a href="${href}" style="display:inline-block;background:${kleur};color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;margin:0 8px 8px 0;font-size:15px">${tekst}</a>`;
  const voornaam = String(x.naam || "").trim();
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0B1B3F;max-width:560px">
<div style="background:#0B1B3F;color:#fff;padding:14px 18px;font-size:18px;font-weight:bold;border-radius:10px 10px 0 0">Site<span style="color:#5DCAA5">hulpje</span></div>
<div style="padding:20px 18px;border:1px solid #e3e7ef;border-top:0;border-radius:0 0 10px 10px">
<p style="margin:0 0 4px;font-size:20px;font-weight:bold">Nieuwe aanvraag${voornaam ? " van " + esc(voornaam) : ""}</p>
<p style="margin:0 0 16px;color:#5F5E5A;font-size:14px">${x.gclid ? `<span style="display:inline-block;background:#E1F5EE;color:#085041;border-radius:20px;padding:2px 10px;font-weight:bold;margin-right:6px">Via je Google-advertentie</span>` : ""}Ingevuld op ${esc(kl.naam || "je website")}${pad ? ", " + esc(pad) : ""}</p>
${x.bericht ? `<div style="background:#F4F6FA;border-radius:10px;padding:14px 16px;margin:0 0 16px;font-size:15px">${esc(x.bericht).replace(/\n/g, "<br>")}</div>` : ""}
<table style="border-collapse:collapse;margin:0 0 18px">${rest.map(([k, w]) => rij(k, w)).join("")}</table>
<div style="margin:0 0 10px">${x.telefoon ? knop(`tel:${esc(x.telefoon.replace(/[^\d+]/g, ""))}`, "Bel " + esc(x.telefoon), "#0F6E56") : ""}${x.email ? knop(`mailto:${esc(x.email)}`, "Mail terug", "#0B1B3F") : ""}</div>
<p style="margin:0 0 18px;color:#5F5E5A;font-size:14px">Tip: wie binnen een uur reageert, krijgt veel vaker de klus.</p>
<div style="border-top:1px solid #e3e7ef;padding-top:14px">
<p style="margin:0 0 10px;font-size:14px">Werd het een klant? Geef het door met één klik. Dan leert Google welke advertenties echte klanten opleveren.</p>
<a href="${link}" style="color:#0F6E56;font-weight:bold;text-decoration:none">Naar je aanvragen →</a></div>
</div></div>`;
  await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${i.resend_sleutel}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: (i.mail_van || "Sitehulpje <info@sitehulpje.nl>").replace(/^[^<]*</, "Sitehulpje <"), to: aan, ...(x.email ? { reply_to: x.email } : {}),
      subject: `${testAan ? "[TEST] " : ""}Nieuwe aanvraag${voornaam ? " van " + voornaam : ""} via je website`, html }) }).catch((e) => console.error("mail", e));
}

// ---------- conversieactie "Werd klant" ----------
async function conversieActie(i: Record<string, string>, at: string, k: any) {
  if (k.ads_conv_klant) return k.ads_conv_klant;
  const cid = String(k.ads_klant).replace(/\D/g, "");
  const r = await gads(i, at, `customers/${cid}/googleAds:search`, { query: `SELECT conversion_action.resource_name FROM conversion_action WHERE conversion_action.name = '${CONV_NAAM}' AND conversion_action.status != 'REMOVED'` });
  let rn = r.results?.[0]?.conversionAction?.resourceName;
  if (!rn) {
    const d = await gads(i, at, `customers/${cid}/googleAds:mutate`, { mutateOperations: [{ conversionActionOperation: { create: {
      name: CONV_NAAM, type: "UPLOAD_CLICKS", category: "QUALIFIED_LEAD", status: "ENABLED", countingType: "ONE_PER_CLICK",
      valueSettings: { defaultValue: 0, alwaysUseDefaultValue: false, defaultCurrencyCode: "EUR" }, clickThroughLookbackWindowDays: 90 } } }] });
    rn = d.mutateOperationResponses?.[0]?.conversionActionResult?.resourceName;
  }
  if (rn) await sql`update beheersite.klanten set ads_conv_klant = ${rn} where id = ${k.id}`;
  return rn;
}
async function voorbereiden(i: Record<string, string>) {
  const ks = await sql`select id, ads_klant, ads_conv_klant from beheersite.klanten where actief and ads_klant is not null and ads_conv_klant is null`;
  if (!ks.length) return [];
  const at = await toegang(i), log: string[] = [];
  for (const k of ks) { try { log.push(`${k.id}: ${await conversieActie(i, at, k)}`); } catch (e) { log.push(`${k.id}: ${(e as Error).message}`); } }
  return log;
}

// ---------- portaal ----------
async function status(i: Record<string, string>, kid: string | null, id: number, st: string) {
  if (!["klant", "geen", "nieuw"].includes(st)) throw new Error("Onbekende keuze");
  const [a] = kid ? await sql`select a.*, k.ads_klant, k.ads_conv_klant from beheersite.aanvragen a join beheersite.klanten k on k.id = a.klant_id where a.id = ${id} and a.klant_id = ${kid}`
    : await sql`select a.*, k.ads_klant, k.ads_conv_klant from beheersite.aanvragen a join beheersite.klanten k on k.id = a.klant_id where a.id = ${id}`;
  if (!a) throw new Error("Aanvraag niet gevonden");
  let google = a.google;
  if (st === "klant" && a.gclid && a.ads_klant && !a.google?.startsWith("gemeld")) {
    try {
      const at = await toegang(i);
      const conv = await conversieActie(i, at, { id: a.klant_id, ads_klant: a.ads_klant, ads_conv_klant: a.ads_conv_klant });
      const cid = String(a.ads_klant).replace(/\D/g, "");
      const d = await gads(i, at, `customers/${cid}:uploadClickConversions`, { partialFailure: true, conversions: [{ gclid: a.gclid, conversionAction: conv,
        conversionDateTime: new Date().toISOString().slice(0, 19).replace("T", " ") + "+00:00", conversionValue: 0, currencyCode: "EUR" }] });
      google = d.partialFailureError ? "fout: " + String(d.partialFailureError.message).slice(0, 200) : "gemeld " + new Date().toISOString().slice(0, 10);
    } catch (e) { google = "fout: " + String((e as Error).message).slice(0, 200); }
  }
  await sql`update beheersite.aanvragen set status = ${st}, status_op = now(), google = ${google} where id = ${id}`;
  return { ok: true, google };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fout: "Alleen POST" }, 405);
  try {
    // sendBeacon stuurt text/plain; daarom zelf de tekst lezen
    const b = JSON.parse((await req.text()) || "{}");
    if (b.actie === "nieuw") return json(await nieuw(req, b));
    const i = await inst();
    if (b.actie === "voorbereiden") {
      if (!i.cron_sleutel || req.headers.get("x-cron-key") !== i.cron_sleutel) return json({ fout: "Geen toegang" }, 401);
      return json({ ok: true, log: await voorbereiden(i) });
    }
    const g = await gebruikerVan(req);
    if (!g) return json({ fout: "Niet ingelogd" }, 401);
    const kid = g.rol === "admin" ? (b.klant_id ? String(b.klant_id) : null) : g.klant_id;
    if (g.rol !== "admin" && !kid) return json({ fout: "Geen klant" }, 400);
    if (b.actie === "lijst") {
      const lijst = kid
        ? await sql`select id, klant_id, tijd, naam, email, telefoon, bericht, velden, pagina, (gclid is not null) via_advertentie, status, google from beheersite.aanvragen where klant_id = ${kid} order by tijd desc limit 200`
        : await sql`select id, klant_id, tijd, naam, email, telefoon, bericht, velden, pagina, (gclid is not null) via_advertentie, status, google from beheersite.aanvragen order by tijd desc limit 200`;
      return json({ lijst });
    }
    if (b.actie === "status") return json(await status(i, kid, Number(b.id), String(b.status)));
    return json({ fout: "Onbekende actie" }, 400);
  } catch (e) { console.error(e); return json({ fout: String((e as Error).message).slice(0, 300) }, 500); }
});
