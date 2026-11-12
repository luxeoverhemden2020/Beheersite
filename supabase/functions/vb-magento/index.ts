// Sitehulpje – verzoeken uitvoeren op Magento 2 (Supabase Edge Function "vb-magento")
// Komt binnen via de deurbel. Werkt via de REST API, dus los van het thema (Luma, Hyvä of eigen).
// Momentopnames: soort 'mg' met {method, body}; terugdraaien gaat via vb-voorstellen (mg_terug).
// Met de Sitehulpje-module (Sitehulpje_Koppeling) op de shop ook: doorverwijzingen, sitemap, robots.txt, canonical, cache, indexen, gezondheid.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300 });
const UA = "Mozilla/5.0 (compatible; Sitehulpje/1.0; +https://sitehulpje.nl)";
const SITE = "https://sitehulpje.nl";
const PRIJS: Record<string, { in: number; uit: number }> = { "claude-haiku-5-5": { in: 0.10, uit: 0.50 }, "claude-sonnet-5-5": { in: 2, uit: 10 } };
const enc = new TextEncoder();
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const pct = (x: string) => encodeURIComponent(x).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

async function inst() {
  const r = await sql`select sleutel, waarde from beheersite.instellingen`;
  return Object.fromEntries(r.map((x) => [x.sleutel, x.waarde])) as Record<string, string>;
}
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
const knop = (link: string, t: string) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0"><tr><td style="border-radius:12px;background:#0b9f8a;background-image:linear-gradient(135deg,#22e3c4,#3b82f6)">
  <a href="${link}" style="display:inline-block;padding:14px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#04111a;text-decoration:none;border-radius:12px">${t} &rarr;</a></td></tr></table>`;
async function mailJan(onderwerp: string, html: string) {
  const i = await inst();
  if (!i.resend_sleutel || !i.jan_email) return;
  await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${i.resend_sleutel}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: (i.mail_van || "Sitehulpje <onboarding@resend.dev>").replace(/^[^<]*</, "Sitehulpje <"), to: [i.jan_email], subject: `[Sitehulpje] ${onderwerp}`, html: kader((html + knop(`${SITE}/beheer`, "Naar beheer")).replace(/<p>/g, '<p style="margin:0 0 12px">'), { kop: "Melding", sub: esc(onderwerp) }) }) }).catch(() => {});
}
async function oauthKop(method: string, url: string, c: any) {
  const u = new URL(url);
  const o: Record<string, string> = { oauth_consumer_key: c.ck, oauth_nonce: crypto.randomUUID().replace(/-/g, ""), oauth_signature_method: "HMAC-SHA256", oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_version: "1.0", oauth_token: c.at };
  const norm = [...Object.entries(o), ...[...u.searchParams.entries()]].map(([k, v]) => [pct(k), pct(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const basis = [method, pct(u.origin + u.pathname), pct(norm)].join("&");
  const key = await crypto.subtle.importKey("raw", enc.encode(`${pct(c.cs)}&${pct(c.as)}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  o.oauth_signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(basis)))));
  return "OAuth " + Object.entries(o).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(", ");
}
async function toegang(klantId: string) {
  const [t] = await sql`select geheim_id from beheersite.site_toegang where klant_id = ${klantId} and methode = 'mg_oauth' and status = 'gekoppeld'`;
  if (!t?.geheim_id) return null;
  const [{ w }] = await sql`select beheersite.vb_token_lezen(${t.geheim_id}) w`;
  const g = JSON.parse(w || "{}");
  return g.base && g.at ? g : null;
}
async function api(g: any, method: string, pad: string, body?: unknown) {
  const url = g.base + pad;
  const r = await fetch(url, { method, headers: { Authorization: await oauthKop(method, url, g), "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(method === "POST" && /sitehulpje\/(sitemap|indexen)/.test(pad) ? 300000 : 40000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 500)}`);
  try { return JSON.parse(t); } catch { return t; }
}
// alleen deze onderdelen; bestellingen, klanten, beheerders, integraties e.d. blijven buiten bereik
const MAG = /^rest\/(all\/|[a-z0-9_]+\/)?V1\/(products(\/|\?|$)|categories(\/|\?|$)|cmsPage(\/|\?|$)|cmsBlock(\/|\?|$)|store\/|configurable-products\/|sitehulpje\/)/;
function mag(method: string, pad: string) {
  if (pad.includes("..") || !MAG.test(pad)) return "Dit onderdeel is niet toegestaan.";
  if (method === "DELETE") return /V1\/sitehulpje\/doorverwijzingen\/\d+$/.test(pad) ? null : "Verwijderen mag niet. Rond af met kan_niet.";
  if (!["GET", "PUT", "POST"].includes(method)) return "Deze methode is niet toegestaan.";
  if (method !== "GET" && /V1\/store\//.test(pad)) return "Winkelinstellingen wijzigen mag niet.";
  return null;
}
// wat is dit voor shop? De API is overal gelijk, maar thema en versie bepalen wat veilig is
async function shopInfo(g: any) {
  const uit: any = { versie: "onbekend", thema: "onbekend", hyva: false, pagebuilder: false, winkels: 1, module: null };
  try { const r = await fetch(g.base + "magento_version", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) }); const t = (await r.text()).trim(); if (r.ok && /^Magento\//i.test(t)) uit.versie = t.slice(0, 40); } catch { /* verborgen is normaal */ }
  try {
    const r = await fetch(g.base, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    const h = (await r.text()).slice(0, 500_000).toLowerCase();
    uit.hyva = /hyva|hyvä|\/frontend\/hyva/.test(h) || (h.includes("alpine") && !h.includes("requirejs"));
    uit.pagebuilder = h.includes("data-content-type");
    const m = h.match(/\/static\/(?:version\d+\/)?frontend\/([^/]+\/[^/]+)\//); if (m) uit.thema = m[1];
  } catch { /* niets */ }
  try { const s = await api(g, "GET", "rest/V1/store/storeViews"); if (Array.isArray(s)) uit.winkels = s.filter((x: any) => x.id !== 0).length; } catch { /* niets */ }
  try { const s = await api(g, "GET", "rest/V1/sitehulpje/status"); const d = typeof s === "string" ? JSON.parse(s) : s; if (d?.module) uit.module = d.module; } catch { /* module niet geïnstalleerd */ }
  return uit;
}
const TOOLS = [
  { name: "magento_api", description: "Roep de Magento 2 REST API aan. pad begint met rest/... Gebruik rest/all/V1/ voor producten en categorieën (alle winkels) en rest/V1/ voor cmsPage, cmsBlock en sitehulpje/... Vraag alleen nodige velden met fields=... Antwoord wordt ingekort tot 12000 tekens.",
    input_schema: { type: "object", properties: { method: { type: "string", enum: ["GET", "PUT", "POST", "DELETE"] }, pad: { type: "string" }, body: { type: "object" } }, required: ["method", "pad"] } },
  { name: "momentopname", description: "Verplicht vóór elke wijziging. type: product (id = sku), category, cms_page of cms_block (id = nummer). Gebruik nieuw:true direct NA het aanmaken van een nieuwe cms_page of cms_block.",
    input_schema: { type: "object", properties: { type: { type: "string", enum: ["product", "category", "cms_page", "cms_block"] }, id: { type: "string" }, nieuw: { type: "boolean" } }, required: ["type", "id"] } },
  { name: "afronden", description: "Sluit af met een kort, vriendelijk Nederlands bericht aan de eigenaar. status: klaar, wacht_op_klant, kan_niet, doorgestuurd (alleen echt extreme verzoeken).",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["klaar", "wacht_op_klant", "kan_niet", "doorgestuurd"] }, bericht: { type: "string" }, reden_jan: { type: "string" } }, required: ["status", "bericht"] } },
];
async function moment(g: any, verzoekId: string, type: string, id: string, nieuw: boolean) {
  const pad = type === "product" ? `rest/all/V1/products/${encodeURIComponent(id)}` : type === "category" ? `rest/all/V1/categories/${encodeURIComponent(id)}` : type === "cms_page" ? `rest/V1/cmsPage/${encodeURIComponent(id)}` : `rest/V1/cmsBlock/${encodeURIComponent(id)}`;
  let data: any;
  if (nieuw) {
    if (!["cms_page", "cms_block"].includes(type)) return "Nieuw kan alleen bij cms_page of cms_block.";
    data = { method: "DELETE" };
  } else if (type === "product") {
    const p = await api(g, "GET", `${pad}?fields=sku,name,price,status,visibility,weight,custom_attributes`);
    data = { method: "PUT", body: { product: p } };
  } else if (type === "category") {
    const c = await api(g, "GET", pad);
    data = { method: "PUT", body: { category: { id: c.id, name: c.name, is_active: c.is_active, include_in_menu: c.include_in_menu, custom_attributes: c.custom_attributes } } };
  } else if (type === "cms_page") data = { method: "PUT", body: { page: await api(g, "GET", pad) } };
  else data = { method: "PUT", body: { block: await api(g, "GET", pad) } };
  await sql`insert into beheersite.momentopnames (verzoek_id, soort, pad, data) values (${verzoekId}, 'mg', ${pad}, ${sql.json(data)})`;
  return "Bewaard.";
}
async function bericht(id: string, t: string) { await sql`insert into beheersite.berichten (verzoek_id, van, tekst) values (${id}, 'webbeheer', ${t})`; }
async function kanNiet(v: any, reden: string) {
  await sql`update beheersite.verzoeken set status = 'kan_niet', bijgewerkt = now() where id = ${v.id}`;
  await bericht(v.id, "Dit verzoek kon nu niet automatisch worden uitgevoerd. Jan is op de hoogte gebracht en kijkt ernaar.");
  await mailJan(`Magento-verzoek #${v.nr} (${v.klant_id}) niet uitgevoerd`, `<p>Reden: ${esc(reden)}</p><p>Verzoek: ${esc(v.onderwerp)}</p>`);
}
const MODULE_UITLEG = `Sitehulpje-module op deze shop: gebruik deze vaste acties (antwoord is JSON als tekst):
- GET rest/V1/sitehulpje/status → gezondheid (cron, sitemaps, indexen, cache, recente fouten).
- GET rest/V1/sitehulpje/adres?pad=... → wat zit er achter een adres en bestaat het doel nog. Gebruik dit eerst bij een kapotte of niet-werkende pagina (404/500).
- GET rest/V1/sitehulpje/doorverwijzingen?zoek=... → doorverwijzingen zoeken.
- POST rest/V1/sitehulpje/doorverwijzingen {"van":"oud-pad","naar":"nieuw-pad"} → permanente 301-doorverwijzing (vervangt ook een kapotte rewrite). Kies als doel de best passende bestaande pagina (zelfde product in andere kleur/variant, anders de categorie). Geen momentopname nodig; het oude adres staat in je bericht.
- DELETE rest/V1/sitehulpje/doorverwijzingen/{id} → alleen eigen doorverwijzingen (entity_type custom).
- POST rest/V1/sitehulpje/sitemap/genereren → sitemap opnieuw maken. Doe dit na het oplossen van kapotte adressen uit de sitemap.
- POST rest/V1/sitehulpje/sitemap/automatisch {"aan":true} → sitemap dagelijks automatisch bijwerken.
- GET/POST rest/V1/sitehulpje/robots {"tekst":"..."} → robots.txt lezen/instellen (lees eerst, pas alleen het nodige aan, filter- en sorteer-URL's blijven geblokkeerd).
- POST rest/V1/sitehulpje/canonical {"aan":true} → canonieke links aan.
- POST rest/V1/sitehulpje/cache/legen {} → cache legen na wijzigingen.
- POST rest/V1/sitehulpje/indexen/bijwerken {} → indexen bijwerken die het nodig hebben.`;
async function uitvoeren(v: any) {
  const g = await toegang(v.klant_id);
  if (!g) return kanNiet(v, "De webshop is niet (meer) gekoppeld.");
  const i = await inst(), koers = Number(i.usd_naar_eur || 0.92), model = i.ai_model || "claude-haiku-5-5", prijs = PRIJS[model] || PRIJS["claude-haiku-5-5"];
  const kosten = async () => { const [r] = await sql`select coalesce(sum(usd),0)::float usd from beheersite.ai_kosten where klant_id = ${v.klant_id} and aangemaakt >= (date_trunc('month', now() at time zone 'Europe/Amsterdam') at time zone 'Europe/Amsterdam')`; return r.usd * koers; };
  if (!i.anthropic_sleutel) return kanNiet(v, "Geen API-sleutel.");
  if ((await kosten()) >= Number(v.b ?? 5) - 0.05) return kanNiet(v, "Het maandbudget van deze klant is op.");
  await sql`update beheersite.verzoeken set status = 'bezig', laatste_activiteit = now(), bijgewerkt = now() where id = ${v.id}`;
  const s = await shopInfo(g);
  const berichten = await sql`select van, tekst, fotos from beheersite.berichten where verzoek_id = ${v.id} order by id`;
  const gesprek = berichten.map((b) => `[${b.van === "klant" ? "Eigenaar" : b.van === "jan" ? "Jan" : "Webbeheer"}] ${b.tekst || ""}${(b.fotos as string[] | null)?.length ? " (met bijlage; foto's plaatsen kan bij Magento nog niet automatisch)" : ""}`).join("\n");
  const systeem = `Je bent "Sitehulpje", de webbeheerder van ${v.naam}, een Magento 2-webshop (${g.base}). Je voert wensen van de eigenaar uit met je tools. Noem jezelf nooit Claude of AI. Schrijf in eenvoudig Nederlands.
Deze shop: versie ${s.versie}, thema ${s.hyva ? "Hyvä" : s.thema}, ${s.winkels} winkelweergave(n), Page Builder ${s.pagebuilder ? "in gebruik" : "niet gezien"}${s.module ? `, Sitehulpje-module ${s.module}` : ""}.
Je mag: producten (naam, prijs, omschrijving, SEO), categorieën, CMS-pagina's en CMS-blokken aanpassen; nieuwe CMS-pagina's maken${s.module ? "; via de Sitehulpje-module ook doorverwijzingen, sitemap, robots.txt, canonieke links, cache en indexen" : ""}. Je mag niet: iets verwijderen (behalve eigen doorverwijzingen), bestellingen, klanten, betalingen, voorraad, extensies, thema, code of ${s.module ? "andere " : ""}instellingen aanpassen. Kan het daardoor niet, rond af met kan_niet${s.module ? "" : " en zeg dat dit kan zodra de Sitehulpje-module op de shop staat (vraag Jan)"}.
Werkwijze: zoek het item op, doe een momentopname, stuur alleen de velden die veranderen, controleer het resultaat en rond af met afronden. Producten: PUT rest/all/V1/products/{sku} met {"product":{"sku":...,...}}; aanbieding en SEO via custom_attributes (special_price, meta_title, meta_description, description). Zoeken: rest/all/V1/products?searchCriteria[filter_groups][0][filters][0][field]=name&searchCriteria[filter_groups][0][filters][0][value]=%25woord%25&searchCriteria[filter_groups][0][filters][0][condition_type]=like&searchCriteria[pageSize]=10&fields=items[sku,name,price,type_id].
Product met maten of kleuren (type_id configurable): de prijs staat op de onderliggende simple producten. Haal die op via rest/all/V1/configurable-products/{sku}/children en wijzig elk apart, elk met momentopname. Zijn het er meer dan 25, rond dan af met doorgestuurd.
Meerdere winkelweergaven: waarden kunnen per winkel afwijken. Vermeld dat in je bericht als de wijziging niet overal zichtbaar lijkt.
${s.module ? MODULE_UITLEG : ""}
${s.hyva ? "Hyvä-thema: bestaande CSS-klassen zijn vooraf samengesteld, dus nieuwe Tailwind-klassen doen vaak niets. Wijzig in CMS-inhoud alleen tekst en links en kopieer bestaande HTML-structuur; voeg geen JavaScript of nieuwe klassen toe." : "Wijzig in CMS-inhoud alleen tekst en links en kopieer de bestaande HTML-structuur; voeg geen JavaScript toe."}
${s.pagebuilder ? "Page Builder: behoud alle data-* attributen en de opbouw exact, anders breekt de pagina in het beheer. Is de wijziging groter dan tekst vervangen, rond dan af met doorgestuurd." : ""}
Vertel de eigenaar dat het door de cache even kan duren voor hij het op de site ziet${s.module ? " (of leeg de cache via de module)" : ""}. Verzin geen feiten.`;
  const msgs: any[] = [{ role: "user", content: `Verzoek #${v.nr}. Gesprek:\n${gesprek}\n\nVoer de laatste wens van de eigenaar uit.` }];
  for (let ronde = 0; ronde < 20; ronde++) {
    if ((await kosten()) >= Number(v.b ?? 5) - 0.05) return kanNiet(v, "Maandbudget op tijdens het uitvoeren.");
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": i.anthropic_sleutel, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 3000, system: systeem, tools: TOOLS, tool_choice: { type: "any" }, messages: msgs }) });
    const d = await r.json();
    if (!r.ok) return kanNiet(v, `API ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);
    const u = d.usage || {}, inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    await sql`insert into beheersite.ai_kosten (klant_id, verzoek_id, model, invoer, uitvoer, usd) values (${v.klant_id}, ${v.id}, ${model}, ${inTok}, ${u.output_tokens || 0}, ${(inTok * prijs.in + (u.output_tokens || 0) * prijs.uit) / 1e6})`;
    await sql`update beheersite.verzoeken set laatste_activiteit = now() where id = ${v.id}`;
    msgs.push({ role: "assistant", content: d.content });
    const res: any[] = [];
    for (const c of (d.content || []).filter((x: any) => x.type === "tool_use")) {
      const a = c.input || {};
      let uit = "";
      try {
        if (c.name === "afronden") {
          await bericht(v.id, String(a.bericht || "").slice(0, 8000));
          await sql`update beheersite.verzoeken set status = ${a.status}, laatste_activiteit = now(), bijgewerkt = now() where id = ${v.id}`;
          if (a.status === "doorgestuurd" || a.status === "kan_niet") await mailJan(`Magento-verzoek #${v.nr} (${v.klant_id}): ${a.status}`, `<p>${esc(a.reden_jan || a.bericht)}</p>`);
          return;
        }
        if (c.name === "magento_api") {
          const method = String(a.method || "GET").toUpperCase(), pad = String(a.pad || "").replace(/^\/+/, "");
          const blok = mag(method, pad);
          uit = blok || JSON.stringify(await api(g, method, pad, method === "GET" || method === "DELETE" ? undefined : (a.body ?? {}))).slice(0, 12000);
        } else if (c.name === "momentopname") uit = await moment(g, v.id, String(a.type), String(a.id), !!a.nieuw);
        else uit = "Onbekende tool.";
      } catch (e) { uit = `Fout: ${String(e).slice(0, 800)}`; }
      res.push({ type: "tool_result", tool_use_id: c.id, content: uit });
    }
    if (!res.length) return kanNiet(v, "Geen actie van de webbeheerder.");
    msgs.push({ role: "user", content: res });
  }
  return kanNiet(v, "Te veel stappen nodig.");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ fout: "Alleen POST" }, 405);
  try {
    const i = await inst();
    if (!i.cron_sleutel || (req.headers.get("authorization") !== `Bearer ${i.cron_sleutel}` && req.headers.get("x-cron-key") !== i.cron_sleutel)) return json({ fout: "Geen toegang" }, 401);
    const b = await req.json().catch(() => ({}));
    if (b.actie === "info") { const g = await toegang(String(b.klant_id || "")); return json(g ? await shopInfo(g) : { fout: "niet gekoppeld" }); }
    const id = String(b.text || "").match(/\(id ([0-9a-f-]{36})\)/)?.[1];
    if (!id) return json({ fout: "Geen verzoek" }, 400);
    const [v] = await sql`select v.id, v.nr, v.klant_id, v.onderwerp, k.naam, k.ai_budget_eur::float b from beheersite.verzoeken v join beheersite.klanten k on k.id = v.klant_id where v.id = ${id}`;
    if (!v) return json({ fout: "Geen verzoek" }, 404);
    const klus = uitvoeren(v).catch(async (e) => { console.error(e); await kanNiet(v, String(e).slice(0, 300)).catch(() => {}); });
    // @ts-ignore EdgeRuntime bestaat in Supabase
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(klus); else await klus;
    return json({ ok: true });
  } catch (e) { console.error(e); return json({ fout: "Er ging iets mis." }, 500); }
});
