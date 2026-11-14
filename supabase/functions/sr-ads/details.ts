// "Meer details" voor Advertenties.
// Klant: uitgekozen weergave (maand, vorige maand, 90 dagen; top 25; alleen echt uitgevoerde besparingen).
// Beheer (admin): alles, ook per dag, prijs per klik, percentages en volledige lijsten met verspilling.
const isoDag = (d: Date) => d.toISOString().slice(0, 10);

function periodeVan(p: string, admin: boolean) {
  const nu = new Date(); const vandaag = new Date(Date.UTC(nu.getFullYear(), nu.getMonth(), nu.getDate()));
  const dagenTerug = (n: number) => { const d = new Date(vandaag); d.setUTCDate(d.getUTCDate() - n); return d; };
  const KLANT = ["maand", "vorige", "d90"], ALLES = ["maand", "vorige", "d7", "d14", "d30", "d90", "d365"];
  if (!(admin ? ALLES : KLANT).includes(p)) p = "maand";
  let van: Date, tot: Date = vandaag, label = "";
  if (p === "maand") { van = new Date(Date.UTC(vandaag.getUTCFullYear(), vandaag.getUTCMonth(), 1)); label = "deze maand"; }
  else if (p === "vorige") { van = new Date(Date.UTC(vandaag.getUTCFullYear(), vandaag.getUTCMonth() - 1, 1)); tot = new Date(Date.UTC(vandaag.getUTCFullYear(), vandaag.getUTCMonth(), 0)); label = "vorige maand"; }
  else { const n = Number(p.slice(1)); van = dagenTerug(n - 1); label = `afgelopen ${n} dagen`; }
  const lengte = Math.round((tot.getTime() - van.getTime()) / 864e5) + 1;
  const vtot = new Date(van); vtot.setUTCDate(vtot.getUTCDate() - 1);
  const vvan = new Date(vtot); vvan.setUTCDate(vvan.getUTCDate() - (lengte - 1));
  return { periode: p, van: isoDag(van), tot: isoDag(tot), label, vvan: isoDag(vvan), vtot: isoDag(vtot) };
}

// deno-lint-ignore no-explicit-any
export async function details(sql: any, klantId: string, periode: string, admin: boolean) {
  const [k] = await sql`select id, ads_klant, ads_laatst from beheersite.klanten where id = ${klantId}`;
  if (!k?.ads_klant) return { actief: false };
  const P = periodeVan(String(periode || ""), admin);
  const som = async (van: string, tot: string) => (await sql`select coalesce(sum(kosten),0)::float kosten, coalesce(sum(klikken),0)::int klikken, coalesce(sum(vertoningen),0)::int vertoningen, coalesce(sum(conversies),0)::float conversies, coalesce(sum(waarde),0)::float waarde from beheersite.ads_dag where klant_id = ${klantId} and datum between ${van}::date and ${tot}::date`)[0];
  const totaal = await som(P.van, P.tot), ervoor = await som(P.vvan, P.vtot);
  const campagnes = await sql`select campagne_id, (array_agg(campagne order by datum desc))[1] campagne, (array_agg(soort order by datum desc))[1] soort, (array_agg(status order by datum desc))[1] status,
      coalesce(sum(kosten) filter (where datum between ${P.van}::date and ${P.tot}::date),0)::float kosten,
      coalesce(sum(klikken) filter (where datum between ${P.van}::date and ${P.tot}::date),0)::int klikken,
      coalesce(sum(vertoningen) filter (where datum between ${P.van}::date and ${P.tot}::date),0)::int vertoningen,
      coalesce(sum(conversies) filter (where datum between ${P.van}::date and ${P.tot}::date),0)::float conversies,
      coalesce(sum(waarde) filter (where datum between ${P.van}::date and ${P.tot}::date),0)::float waarde
    from beheersite.ads_dag where klant_id = ${klantId} group by campagne_id order by 5 desc, 2`;
  const [hist] = await sql`select coalesce(sum(waarde),0)::float waarde from beheersite.ads_dag where klant_id = ${klantId}`;
  const omzet = hist.waarde > 0;
  const lijstVan = async (tabel: "zoektermen" | "producten") => {
    const naam = tabel === "zoektermen" ? sql`term` : sql`titel`;
    const t = tabel === "zoektermen" ? sql`beheersite.ads_zoektermen` : sql`beheersite.ads_producten`;
    return admin
      ? await sql`select ${naam} naam, kosten::float, klikken, vertoningen, conversies::float, waarde::float from ${t} where klant_id = ${klantId} order by kosten desc, klikken desc`
      : await sql`select ${naam} naam, kosten::float, klikken, conversies::float, waarde::float from ${t} where klant_id = ${klantId} and (conversies > 0 or klikken > 0) order by waarde desc, conversies desc, klikken desc limit 25`;
  };
  const zoektermen = await lijstVan("zoektermen"), producten = await lijstVan("producten");
  const basis = { actief: true, omzet, laatst: k.ads_laatst, ...P, totaal, ervoor, campagnes: campagnes.filter((c: { status: string; kosten: number }) => c.status !== "REMOVED" || c.kosten > 0), zoektermen, producten };
  if (!admin) {
    const reeks = await sql`select date_trunc('week', datum)::date week, sum(kosten)::float kosten, sum(waarde)::float waarde, sum(conversies)::float conversies from beheersite.ads_dag where klant_id = ${klantId} and datum between ${P.van}::date and ${P.tot}::date group by 1 order by 1`;
    const uitgevoerd = await sql`select week, soort, tekst, besparing_eur::float besparing from beheersite.ads_acties where klant_id = ${klantId} and status = 'uitgevoerd' order by aangemaakt desc limit 10`;
    return { ...basis, reeks, uitgevoerd };
  }
  const dagen = await sql`select datum, sum(kosten)::float kosten, sum(klikken)::int klikken, sum(vertoningen)::int vertoningen, sum(conversies)::float conversies, sum(waarde)::float waarde from beheersite.ads_dag where klant_id = ${klantId} and datum between ${P.van}::date and ${P.tot}::date group by 1 order by 1`;
  const acties = await sql`select week, soort, tekst, waarom, besparing_eur::float besparing, status, aangemaakt from beheersite.ads_acties where klant_id = ${klantId} order by aangemaakt desc limit 40`;
  return { ...basis, dagen, acties };
}
