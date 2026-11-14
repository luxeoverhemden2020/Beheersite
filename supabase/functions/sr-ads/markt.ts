// Extra gratis Google-bronnen voor Advertenties (Supabase Edge Function "sr-ads"):
// 1. Aanbevelingen van Google Ads zelf (alleen de nuttige, vertaald naar gewone taal; nooit automatisch uitgevoerd)
// 2. Merchant Center: prijsvergelijking met andere winkels (prijsbenchmark) en bestsellers in de categorie
// Alles alleen lezen. Merchant Center vraagt de toestemming "content" bij het koppelen in het beheer.
// deno-lint-ignore-file no-explicit-any
const euro = (n: number) => "€" + (Math.round(n * 100) / 100).toLocaleString("nl-NL", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const isoDag = (d: Date) => d.toISOString().slice(0, 10);

// ---------- 1. Aanbevelingen van Google ----------
// Alleen soorten die de klant echt helpen. Breed zoeken, zoekpartners en displaynetwerk laten we weg: die kosten vooral meer.
const AANBEVELING: Record<string, string> = {
  KEYWORD: "zoekwoorden", SITELINK_ASSET: "extra", CALLOUT_ASSET: "extra", CALL_ASSET: "extra", STRUCTURED_SNIPPET_ASSET: "extra", IMAGE_ASSET: "extra",
  RESPONSIVE_SEARCH_AD: "teksten", RESPONSIVE_SEARCH_AD_ASSET: "teksten", RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH: "teksten",
  MAXIMIZE_CONVERSIONS_OPT_IN: "bieden", MAXIMIZE_CONVERSION_VALUE_OPT_IN: "bieden", TARGET_CPA_OPT_IN: "bieden", TARGET_ROAS_OPT_IN: "bieden", SET_TARGET_CPA: "bieden", SET_TARGET_ROAS: "bieden",
  CAMPAIGN_BUDGET: "budget", FORECASTING_CAMPAIGN_BUDGET: "budget", MARGINAL_ROI_CAMPAIGN_BUDGET: "budget", MOVE_UNUSED_BUDGET: "budget",
  ENHANCED_CONVERSIONS: "meten", UPGRADE_SMART_SHOPPING_CAMPAIGN_TO_PERFORMANCE_MAX: "shopping",
  SHOPPING_ADD_PRODUCTS_TO_CAMPAIGN: "shopping", SHOPPING_FIX_DISAPPROVED_PRODUCTS: "shopping", SHOPPING_FIX_SUSPENDED_MERCHANT_CENTER_ACCOUNT: "shopping",
  SHOPPING_FIX_MERCHANT_CENTER_ACCOUNT_SUSPENSION_WARNING: "shopping", SHOPPING_TARGET_ALL_OFFERS: "shopping", SHOPPING_ADD_AGE_GROUP: "shopping",
  SHOPPING_ADD_COLOR: "shopping", SHOPPING_ADD_GENDER: "shopping", SHOPPING_ADD_GTIN: "shopping", SHOPPING_ADD_MORE_IDENTIFIERS: "shopping", SHOPPING_ADD_SIZE: "shopping",
};
const GROEP: Record<string, { tekst: string; waarom: string }> = {
  zoekwoorden: { tekst: "Nieuwe zoekwoorden toevoegen die Google bij jouw advertenties vindt passen.", waarom: "Google ziet zoekopdrachten waarop je nu niet in beeld komt." },
  extra: { tekst: "Extra regels onder de advertentie zetten (links, kenmerken, telefoonnummer).", waarom: "Advertenties met extra regels zijn groter en worden vaker aangeklikt." },
  teksten: { tekst: "Advertentieteksten aanvullen, zodat Google betere combinaties kan maken.", waarom: "Google beoordeelt de huidige teksten als te mager." },
  bieden: { tekst: "Google automatisch laten bieden op verkopen of aanvragen.", waarom: "Er zijn genoeg resultaten gemeten om slimmer te bieden." },
  budget: { tekst: "Het dagbudget is te krap: advertenties stoppen eerder op de dag.", waarom: "Google ziet dat je klanten misloopt. We verhogen dit nooit zonder jouw akkoord." },
  meten: { tekst: "De meting van verkopen en aanvragen nauwkeuriger maken.", waarom: "Betere metingen zorgen voor slimmere keuzes in de advertenties." },
  shopping: { tekst: "Producten in Google Shopping repareren of aanvullen.", waarom: "Sommige producten missen gegevens of worden niet getoond." },
};

export async function haalAanbevelingen(sql: any, zoek: any, i: any, at: string, klantId: string, cid: string) {
  // impact-velden zijn niet los op te vragen via de zoekopdracht; die laten we weg
  const r = await zoek(i, at, cid, `SELECT recommendation.resource_name, recommendation.type, recommendation.dismissed, recommendation.campaign FROM recommendation`);
  await sql`delete from beheersite.ads_aanbevelingen where klant_id = ${klantId}`;
  let n = 0;
  for (const x of r) {
    const a = x.recommendation; if (!a || a.dismissed) continue;
    const b = a.impact?.baseMetrics || {}, p = a.impact?.potentialMetrics || {};
    const data = { type: a.type, klikken: Number(p.clicks || 0) - Number(b.clicks || 0), conversies: Number(p.conversions || 0) - Number(b.conversions || 0),
      kosten: (Number(p.costMicros || 0) - Number(b.costMicros || 0)) / 1e6 };
    await sql`insert into beheersite.ads_aanbevelingen (klant_id, naam, soort, campagne, data) values (${klantId}, ${a.resourceName}, ${a.type}, ${a.campaign || null}, ${sql.json(data)})
      on conflict (klant_id, naam) do update set soort = excluded.soort, campagne = excluded.campagne, data = excluded.data, opgehaald = now()`;
    n++;
  }
  return n;
}

// ---------- 2. Merchant Center ----------
const MERCHANT = "https://merchantapi.googleapis.com";
async function merchantZoek(at: string, mc: string, query: string) {
  const r = await fetch(`${MERCHANT}/reports/v1/accounts/${mc}/reports:search`, { method: "POST",
    headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, pageSize: 1000 }), signal: AbortSignal.timeout(60000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Merchant Center ${r.status}: ${d?.error?.message || ""}`.slice(0, 400));
  return d.results || [];
}
// Eenmalig: het Google Cloud-project bij het Merchant Center-account aanmelden (verplicht voor de Merchant API)
async function registreer(at: string, mc: string, email: string) {
  const r = await fetch(`${MERCHANT}/accounts/v1/accounts/${mc}/developerRegistration:registerGcp`, { method: "POST",
    headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" }, body: JSON.stringify({ developerEmail: email }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(`Aanmelden Merchant Center ${r.status}: ${d?.error?.message || ""}`.slice(0, 300)); }
}
const prijsVan = (p: any) => p?.amountMicros ? Number(p.amountMicros) / 1e6 : null;

export async function haalMerchant(sql: any, i: any, at: string, klantId: string, mc: string, categorie: number | null) {
  let geregistreerd = false;
  const uit: Record<string, number | string> = {};
  const probeer = async (q: string) => {
    try { return await merchantZoek(at, mc, q); }
    catch (e) {
      const m = String((e as Error).message);
      if (!geregistreerd && /regist|GCP|developer/i.test(m) && i.jan_email) { geregistreerd = true; await registreer(at, mc, i.jan_email); return await merchantZoek(at, mc, q); }
      throw e;
    }
  };
  // prijs ten opzichte van andere winkels die hetzelfde product verkopen
  let prijzen: any[] = [];
  try { prijzen = await probeer(`SELECT id, report_country_code, offer_id, title, price, benchmark_price FROM price_competitiveness_product_view WHERE report_country_code = 'NL'`); }
  catch (e) { uit.prijzen_fout = String((e as Error).message).slice(0, 200); }
  if (!uit.prijzen_fout) await sql`delete from beheersite.ads_prijzen where klant_id = ${klantId}`;
  for (const x of prijzen) {
    const v = x.priceCompetitivenessProductView || {}, prijs = prijsVan(v.price), bm = prijsVan(v.benchmarkPrice);
    if (!v.offerId || !prijs || !bm) continue;
    await sql`insert into beheersite.ads_prijzen (klant_id, offer_id, titel, prijs, benchmark, verschil_pct) values (${klantId}, ${v.offerId}, ${v.title || v.offerId}, ${prijs}, ${bm}, ${Math.round((prijs / bm - 1) * 1000) / 10})
      on conflict (klant_id, offer_id) do update set titel = excluded.titel, prijs = excluded.prijs, benchmark = excluded.benchmark, verschil_pct = excluded.verschil_pct, opgehaald = now()`;
  }
  uit.prijzen = prijzen.length;
  // bestsellers in de categorie van de klant (standaard: kleding). Google loopt ± 3 weken achter:
  // zoek terug naar de laatste week met gegevens (maximaal 8 weken).
  const nu = new Date(); const maandag = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate()));
  maandag.setUTCDate(maandag.getUTCDate() - ((maandag.getUTCDay() + 6) % 7));
  let wk = isoDag(maandag);
  try {
    const BS = (w: string) => `SELECT report_date, report_granularity, report_country_code, report_category_id, rank, previous_rank, title, brand, category_l1, category_l2, inventory_status, brand_inventory_status, relative_demand
      FROM best_sellers_product_cluster_view WHERE report_date = '${w}' AND report_granularity = 'WEEKLY' AND report_country_code = 'NL'`;
    let bs: any[] = [];
    for (let n = 1; n <= 8 && !bs.length; n++) {
      const d = new Date(maandag); d.setUTCDate(d.getUTCDate() - 7 * n); wk = isoDag(d);
      bs = await probeer(`${BS(wk)} AND report_category_id = ${Number(categorie) || 1604}`);
      if (!bs.length) bs = await probeer(BS(wk)); // geen resultaat in de categorie: alle categorieën
    }
    bs.sort((a: any, b: any) => Number(a.bestSellersProductClusterView?.rank || 1e9) - Number(b.bestSellersProductClusterView?.rank || 1e9));
    uit.bestsellers_week = wk;
    uit.bestsellers_ruw = bs.length;
    // gericht: bestsellers die de klant zelf verkoopt, en bestsellers van merken die de klant al voert
    const cat = ` AND report_category_id = ${Number(categorie) || 1604}`;
    const extra: any[] = [];
    for (const f of [` AND inventory_status = 'IN_STOCK'`, ` AND brand_inventory_status = 'IN_STOCK' AND inventory_status = 'NOT_IN_INVENTORY'`]) {
      try { extra.push(...(await probeer(BS(wk) + cat + f))); } catch (e) { uit.bestsellers_filter_fout = String((e as Error).message).slice(0, 150); }
    }
    uit.bestsellers_eigen = extra.length;
    const alle = new Map<number, any>();
    for (const x of [...bs.slice(0, 50), ...extra]) { const v = x.bestSellersProductClusterView || {}; if (v.rank) alle.set(Number(v.rank), v); }
    const rijen = [...alle.values()].sort((a: any, b: any) => Number(a.rank) - Number(b.rank)).slice(0, 300);
    if (rijen.length) await sql`delete from beheersite.ads_bestsellers where klant_id = ${klantId} and week = ${wk}`;
    for (const v of rijen) await sql`insert into beheersite.ads_bestsellers (klant_id, week, rang, vorige_rang, titel, merk, categorie, voorraad, merk_voorraad, vraag)
      values (${klantId}, ${wk}, ${Number(v.rank)}, ${v.previousRank ? Number(v.previousRank) : null}, ${v.title || ""}, ${v.brand || null}, ${[v.categoryL1, v.categoryL2].filter(Boolean).join(" › ") || null}, ${v.inventoryStatus || null}, ${v.brandInventoryStatus || null}, ${v.relativeDemand || null}) on conflict do nothing`;
    await sql`delete from beheersite.ads_bestsellers where klant_id = ${klantId} and week < current_date - 63`;
    uit.bestsellers = rijen.length;
  } catch (e) { uit.bestsellers_fout = String((e as Error).message).slice(0, 200); }
  console.log("merchant", JSON.stringify(uit));
  if (uit.prijzen_fout && uit.bestsellers_fout) throw new Error(`${uit.prijzen_fout} | ${uit.bestsellers_fout}`);
  return uit;
}

// ---------- voorstellen voor de weekronde ----------
export async function extraActies(sql: any, klantId: string) {
  const acties: { soort: string; tekst: string; waarom: string; data?: unknown }[] = [];
  // Google-aanbevelingen, per groep samengevoegd
  const rec = await sql`select soort, campagne, data from beheersite.ads_aanbevelingen where klant_id = ${klantId}`;
  const groepen = new Map<string, any[]>();
  for (const r of rec) { const g = AANBEVELING[r.soort]; if (g) groepen.set(g, [...(groepen.get(g) || []), r]); }
  for (const [g, rijen] of groepen) {
    const extra = rijen.reduce((s, r) => s + Math.max(0, Number(r.data?.conversies || 0)), 0);
    acties.push({ soort: "google_" + g, tekst: GROEP[g].tekst,
      waarom: GROEP[g].waarom + (extra >= 1 ? ` Google verwacht ± ${Math.round(extra)} extra verkopen of aanvragen per week.` : ""), data: rijen.map((r) => ({ type: r.soort, ...r.data })) });
  }
  // prijs ten opzichte van andere winkels
  const [tel] = await sql`select count(*) filter (where verschil_pct >= 10)::int duur, count(*) filter (where verschil_pct <= -10)::int goedkoop from beheersite.ads_prijzen where klant_id = ${klantId}`;
  const duur = await sql`select titel, prijs::float, benchmark::float, verschil_pct::float from beheersite.ads_prijzen where klant_id = ${klantId} and verschil_pct >= 10 order by verschil_pct desc limit 20`;
  if (duur.length) acties.push({ soort: "prijs_duur", tekst: `${tel.duur} product${tel.duur > 1 ? "en zijn" : " is"} duurder dan bij andere winkels in Google, zoals "${duur[0].titel}" (${euro(duur[0].prijs)}, elders gemiddeld ${euro(duur[0].benchmark)}).`,
    waarom: "Duurdere producten worden minder aangeklikt en verkocht. Voorstel: daar minder advertentiegeld op zetten, of de prijs bekijken.", data: duur });
  const goedkoop = await sql`select titel, prijs::float, benchmark::float, verschil_pct::float from beheersite.ads_prijzen where klant_id = ${klantId} and verschil_pct <= -10 order by verschil_pct limit 20`;
  if (goedkoop.length) acties.push({ soort: "prijs_kans", tekst: `${tel.goedkoop} product${tel.goedkoop > 1 ? "en zijn" : " is"} goedkoper dan bij andere winkels, zoals "${goedkoop[0].titel}" (${euro(goedkoop[0].prijs)}, elders gemiddeld ${euro(goedkoop[0].benchmark)}).`,
    waarom: "Met een scherpe prijs is de kans op verkoop groot. Voorstel: deze producten meer in beeld brengen.", data: goedkoop });
  // bestsellers in de categorie
  const [w] = await sql`select max(week) week from beheersite.ads_bestsellers where klant_id = ${klantId}`;
  if (w?.week) {
    const eigen = await sql`select rang, titel, merk from beheersite.ads_bestsellers where klant_id = ${klantId} and week = ${w.week} and voorraad = 'IN_STOCK' order by rang limit 10`;
    if (eigen.length) acties.push({ soort: "bestseller", tekst: `${eigen.length} van jouw producten ${eigen.length > 1 ? "staan" : "staat"} in de Google-bestsellers van je categorie, zoals "${eigen[0].titel}".`,
      waarom: "Waar veel vraag naar is, levert een advertentie meestal het meeste op. Voorstel: hier extra ruimte voor maken.", data: eigen });
    const mist = await sql`select rang, titel, merk, merk_voorraad from beheersite.ads_bestsellers where klant_id = ${klantId} and week = ${w.week} and voorraad = 'NOT_IN_INVENTORY' and merk_voorraad in ('IN_STOCK','OUT_OF_STOCK') order by rang limit 10`;
    if (mist.length) acties.push({ soort: "bestseller_mist", tekst: `Populair in Google: ${mist.length} bestseller${mist.length > 1 ? "s" : ""} van merken die je al verkoopt, maar dit product niet, zoals "${mist[0].titel}".`,
      waarom: "Idee voor inkoop of voor je webshop: hier zoeken veel mensen naar.", data: mist });
  }
  return acties;
}
