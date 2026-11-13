// Demo van het klantportaal zonder inloggen: alles draait in de browser met verzonnen gegevens.
// Aan via ?demo=1 (blijft aan in dit tabblad). Er gaat niets naar de server en er kan niets worden veranderd.
(function () {
  const q = new URLSearchParams(location.search);
  let aan = false;
  try {
    if (q.get("demo") === "uit") sessionStorage.removeItem("sh_demo");
    else if (q.has("demo")) sessionStorage.setItem("sh_demo", "1");
    aan = sessionStorage.getItem("sh_demo") === "1";
  } catch { aan = q.has("demo"); }
  if (!aan) return;
  window.SH_DEMO = true;

  // eigen inlog van de bezoeker niet aanraken: in de demo is de sessie altijd "demo"
  const SLEUTELS = ["bs_sessie", "bs_sessie_beheer"];
  const get = Storage.prototype.getItem, set = Storage.prototype.setItem, del = Storage.prototype.removeItem;
  Storage.prototype.getItem = function (k) { return SLEUTELS.includes(k) ? "demo" : get.call(this, k); };
  Storage.prototype.setItem = function (k, v) { if (!SLEUTELS.includes(k)) set.call(this, k, v); };
  Storage.prototype.removeItem = function (k) { if (!SLEUTELS.includes(k)) del.call(this, k); };

  // ---------- verzonnen bedrijf ----------
  const NAAM = "Studio Lente", SITE = "https://demo.sitehulpje.nl", PLAATS = "Zwolle";
  let zaad = 7; const rnd = () => ((zaad = (zaad * 16807) % 2147483647) / 2147483647);
  const dag = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const nu = new Date().toISOString();
  const maandStr = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); };
  const MND = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const mNaam = (m) => `${MND[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;

  // 200 dagen cijfers, langzaam stijgend (het gaat de goede kant op)
  const gsc = [], ga4 = [], gbp = [], ai = [];
  for (let i = -201; i <= -2; i++) {
    const t = (i + 201) / 200, week = [0.8, 1.15, 1.1, 1.05, 1.0, 1.2, 0.7][new Date(dag(i)).getDay()];
    const k = Math.round((18 + 34 * t) * week * (0.85 + rnd() * 0.3));
    gsc.push([dag(i), k, Math.round(k * (24 + rnd() * 8))]);
    const org = Math.round(k * 1.25), bez = Math.round(org * 1.9);
    ga4.push([dag(i), bez, Math.round(bez * 1.2), org, Math.round(1 + t * 4 * week * (0.6 + rnd() * 0.8))]);
    const zk = Math.round((70 + 90 * t) * week * (0.85 + rnd() * 0.3));
    gbp.push([dag(i), zk, Math.round(zk * 0.7), Math.round((1 + 4 * t) * rnd() * 1.6), Math.round((1 + 3 * t) * rnd() * 1.6), Math.round(zk * 0.08)]);
    if (rnd() < 0.15 + t * 0.5) ai.push([dag(i), ["ChatGPT", "ChatGPT", "Perplexity", "Copilot", "Gemini"][Math.floor(rnd() * 5)], 1 + Math.floor(rnd() * 2)]);
  }
  const ZW = [["kapper zwolle", 3.2, 4.8], ["kapsalon zwolle", 2.6, 3.9], ["dameskapper zwolle", 1.8, 2.5], ["balayage zwolle", 1.4, 3.1], ["herenkapper zwolle", 4.1, 6.2],
    ["kapper zwolle centrum", 2.2, 2.9], ["krullen knippen zwolle", 1.6, 4.4], ["bruidskapsel zwolle", 3.7, 7.8], ["kapper assendorp", 2.9, 3.4], ["olaplex behandeling", 6.8, 11.2],
    ["kinderkapper zwolle", 5.4, 8.1], ["haar verven zwolle", 4.6, 6.0], ["studio lente", 1.0, 1.0], ["kapper stadshagen", 8.4, 12.7], ["keratine behandeling zwolle", 7.2, 9.9],
    ["kapper open zaterdag zwolle", 3.3, 5.6], ["highlights zwolle", 5.9, 9.4], ["kapper kampen", 11.8, 16.3], ["wenkbrauwen zwolle", 9.6, 14.1], ["kapper dalfsen", 13.2, 18.8]];
  const zoekwoorden = ZW.map(([s, p, v], i) => { const vt = Math.round(1400 / (i + 1.4) + 30); return { sleutel: s, positie: p, vorige_positie: v, vertoningen: vt, klikken: Math.max(1, Math.round(vt * (p < 3 ? 0.22 : p < 6 ? 0.09 : 0.025))) }; });
  const PG = ["/", "/prijzen", "/balayage", "/bruidskapsels", "/afspraak-maken", "/team", "/herenkapper", "/contact", "/blog/haar-verzorgen-in-de-winter"];
  const paginas = PG.map((p, i) => { const vt = Math.round(5200 / (i + 1.2)); return { sleutel: SITE + p, positie: 2 + i * 0.9, vorige_positie: 3 + i * 1.3, vertoningen: vt, klikken: Math.round(vt * (0.12 - i * 0.008)) }; });
  const kansen = [["haar verven zwolle", "/prijzen", 4.6, 820], ["highlights zwolle", "/balayage", 5.9, 610], ["kinderkapper zwolle", "/prijzen", 5.4, 470], ["olaplex behandeling", "/behandelingen", 6.8, 390]]
    .map(([z, p, pos, v]) => ({ zoekwoord: z, pagina: SITE + p, positie: pos, vertoningen: v }));
  const reviews = [
    { review_id: "r1", naam: "Sanne de Vries", sterren: 5, datum: dag(-2), tekst: "Wat een fijne salon! Mijn balayage is precies geworden zoals ik wilde. Ik kom zeker terug.", status: "nieuw", concept: "Dank je wel Sanne, wat leuk om te lezen! Fijn dat je zo blij bent met je balayage. Tot de volgende keer bij Studio Lente!" },
    { review_id: "r2", naam: "Mark Jansen", sterren: 5, datum: dag(-6), tekst: "Snel geholpen op zaterdag, goed geknipt en een prima kop koffie erbij.", antwoord: "Dank je Mark! Graag tot de volgende keer." },
    { review_id: "r3", naam: "Fatima El Amrani", sterren: 5, datum: dag(-11), tekst: "Mijn bruidskapsel zat de hele dag perfect. Super bedankt team!", antwoord: "Wat mooi Fatima, nogmaals gefeliciteerd!" },
    { review_id: "r4", naam: "Peter Bos", sterren: 4, datum: dag(-19), tekst: "Goede kapper, soms even wachten maar dat is het waard.", antwoord: "Dank je Peter! We hebben sinds kort online afspraken maken, dan hoef je niet te wachten." },
    { review_id: "r5", naam: "Lisa Hendriks", sterren: 5, datum: dag(-27), tekst: "Eindelijk een kapper die weet wat ze met krullen moet doen!", antwoord: "Dat horen we graag Lisa! Krullen zijn onze favoriet." }];

  const dashboard = {
    klant: { pakket: "pro", naam: NAAM, site: SITE },
    koppeling: { gsc_site: "sc-domain:demo.sitehulpje.nl", ga4_property: "properties/1", ga4_naam: NAAM, ga4_meet_id: "G-DEMO123", gbp_locatie: "locations/1", gbp_naam: `${NAAM} ${PLAATS}`,
      gbp_toestemming: true, gbp_score: 4.9, gbp_aantal: 187, google_email: "demo@sitehulpje.nl", laatst_opgehaald: nu, status: "actief" },
    gsc, ga4, gbp, ai, zoekwoorden, paginas, kansen, reviews, ga4_aanmaken: false };

  const TOOLS = { snelheid: 94, afbeeldingen: 91, mobiel: 100, "google-voorbeeld": 96, indexeerbaar: 100, koppen: 94, ai: 92, bedrijfsgegevens: 100, veiligheid: 98, links: 100, mail: 100, leesbaarheid: 93, social: 95, toegankelijkheid: 96 };
  const TITELS = { snelheid: "Je homepage laadt in 1,4 seconde", afbeeldingen: "Alle foto's zijn klein genoeg gemaakt", mobiel: "Je site werkt prima op de telefoon", "google-voorbeeld": "Titels en omschrijvingen zijn in orde",
    indexeerbaar: "Google kan al je pagina's vinden", koppen: "Je pagina's hebben een duidelijke opbouw", ai: "ChatGPT en andere AI kunnen je site lezen", bedrijfsgegevens: "Je bedrijfsgegevens staan goed voor Google",
    veiligheid: "Je site is beveiligd (https)", links: "Alle 214 links werken", mail: "Je mail komt goed aan", leesbaarheid: "Je teksten lezen makkelijk", social: "Je site ziet er goed uit als je hem deelt", toegankelijkheid: "Je site is goed bruikbaar voor iedereen" };
  const tools = Object.fromEntries(Object.entries(TOOLS).map(([t, s]) => [t, { score: s, items: [{ status: "goed", titel: TITELS[t] }].concat(
    t === "afbeeldingen" ? [{ status: "let", titel: "2 foto's op /team kunnen nog iets kleiner", uitleg: "Dat scheelt een fractie van een seconde laadtijd. Wij pakken dit deze week op." }] : []) }]));

  const ads = {
    actief: true, soortKlant: "aanvragen", status: "loopt", laatst: nu,
    deze: { kosten: 186.4, conversies: 31, waarde: 0, klikken: 412, vertoningen: 9840 },
    vorige: { kosten: 201.1, conversies: 24, waarde: 0, klikken: 398, vertoningen: 9310 },
    d30: { kosten: 284.9, conversies: 46, waarde: 0, klikken: 633, vertoningen: 15120 },
    historie: { kosten: 1840, conversies: 262, waarde: 0, eerste: dag(-190) },
    acties: [{ week: dag(-3), tekst: "Meer budget naar 'balayage zwolle'", waarom: "Daar kwamen deze week de meeste afspraken vandaan.", besparing: 0 },
      { week: dag(-3), tekst: "Zoekterm 'kapper opleiding' uitgesloten", waarom: "Dat waren mensen die een opleiding zochten, geen klanten.", besparing: 14 },
      { week: dag(-3), tekst: "Advertentie voor zaterdag-afspraken toegevoegd", waarom: "Op zaterdag wordt het meest gezocht." }],
    soorten: [{ soort: "SEARCH", kosten: 214.3, conversies: 37, waarde: 0 }, { soort: "PERFORMANCE_MAX", kosten: 70.6, conversies: 9, waarde: 0 }],
    producten: [],
    zoektermen: [{ term: "kapper zwolle", naam: "kapper zwolle", conversies: 14, klikken: 188 }, { term: "balayage zwolle", naam: "balayage zwolle", conversies: 11, klikken: 96 },
      { term: "kapper zwolle zaterdag", naam: "kapper zwolle zaterdag", conversies: 8, klikken: 71 }, { term: "bruidskapsel zwolle", naam: "bruidskapsel zwolle", conversies: 5, klikken: 39 }],
    reeks: Array.from({ length: 8 }, (_, i) => ({ week: dag(-7 * (8 - i)), kosten: 60 + i * 3 + Math.round(rnd() * 10), conversies: 6 + Math.round(i * 0.8 + rnd() * 3), waarde: 0 })),
    campagnes: [{ campagne: "Kapper Zwolle – zoeken", soort: "SEARCH", status: "ENABLED" }, { campagne: "Balayage & kleur", soort: "SEARCH", status: "ENABLED" }, { campagne: "Studio Lente – overal", soort: "PERFORMANCE_MAX", status: "ENABLED" }] };

  const verzoeken = [
    { id: "v4", nr: 24, onderwerp: "Zet de prijs van knippen dames op €42", status: "klaar", aangemaakt: dag(-1) + "T09:12:00Z", bijgewerkt: dag(-1) + "T09:13:00Z",
      berichten: [["klant", "Zet de prijs van knippen dames op €42"], ["webbeheer", "Klaar! Knippen dames staat nu op €42 op je prijzenpagina: https://demo.sitehulpje.nl/prijzen"]] },
    { id: "v3", nr: 23, onderwerp: "Kerstopeningstijden bovenaan de site", status: "klaar", aangemaakt: dag(-4) + "T20:40:00Z", bijgewerkt: dag(-4) + "T20:41:00Z",
      berichten: [["klant", "Kun je bovenaan zetten dat we 24 december tot 16:00 open zijn en 25 en 26 december dicht?"], ["webbeheer", "Klaar! Er staat nu een melding bovenaan je website. Wil je dat ik hem na 27 december weer weghaal?"], ["klant", "Ja graag!"], ["webbeheer", "Komt goed, ik haal hem op 27 december automatisch weg."]] },
    { id: "v2", nr: 22, onderwerp: "Nieuwe foto van het team op de over-ons pagina", status: "klaar", aangemaakt: dag(-9) + "T13:05:00Z", bijgewerkt: dag(-9) + "T13:07:00Z",
      berichten: [["klant", "Zet deze teamfoto op de pagina Over ons, in plaats van de oude."], ["webbeheer", "Klaar! De nieuwe teamfoto staat op https://demo.sitehulpje.nl/team. De oude foto heb ik bewaard, je kunt altijd terug."]] },
    { id: "v1", nr: 21, onderwerp: "Nieuwe medewerker Noor toevoegen aan het team", status: "klaar", aangemaakt: dag(-15) + "T10:30:00Z", bijgewerkt: dag(-15) + "T10:32:00Z",
      berichten: [["klant", "Noor is bij ons begonnen als kleurspecialist, zet haar erbij op de teampagina."], ["webbeheer", "Klaar! Noor staat nu op de teampagina met de tekst 'Kleurspecialist – balayage en highlights'. Stuur gerust nog een foto, dan zet ik die erbij."]] }];

  const volg = {
    pakket: "pro", concurrenten: ["kapperhetplein.voorbeeld", "salonnoord.voorbeeld", "haarstudio-zwolle.voorbeeld"], voorgesteld: [],
    metingen: ["kapperhetplein.voorbeeld", "salonnoord.voorbeeld", "haarstudio-zwolle.voorbeeld"].map((h, i) => ({ site2: "https://" + h, aangemaakt: dag(-4),
      rijen: [["Snelheid", 94, 61 + i * 8], ["Op de telefoon", 100, 82], ["Gevonden in Google", 96, 70 + i * 5], ["Vindbaar in AI", 92, 48 + i * 6], ["Beveiliging", 98, 90], ["Reviews", 98, 74 + i * 4]].map(([naam, jij, zij]) => ({ naam, jij, zij })) })),
    ai: [0, 1, 2, 3, 4, 5].map((n) => ({ datum: dag(-7 * (5 - n) - 4), genoemd: [1, 2, 2, 3, 4, 5][n], totaal: 6,
      antwoorden: [["Wat is een goede kapper in Zwolle?", 1, 2], ["Waar kan ik balayage laten doen in Zwolle?", 1, 1], ["Welke kapsalon in Zwolle is open op zaterdag?", 1, 3],
        ["Goede bruidskapper in de buurt van Zwolle?", 1, 2], ["Kapper in Zwolle die goed is met krullen?", 1, 1], ["Herenkapper Zwolle centrum aanrader?", 0, null]]
        .map(([vraag, g, plek]) => ({ vraag, genoemd: !!g, plek, bedrijven: [{ naam: g ? NAAM : "Kapper Het Plein" }, { naam: "Salon Noord" }, { naam: "Haarstudio Zwolle" }] })) })),
    plan: { vragen: [{ status: "goed" }, { status: "goed" }, { status: "goed" }, { status: "online", titel: "Bruidskapsels in Zwolle", datum: dag(-20) }, { status: "goed" },
      { status: "gepland", maand: "december" }], gegevens: { status: "online", datum: dag(-40) }, volgende: dag(3) } };

  const inhoud = { items: [
    { id: "i1", soort: "artikel", status: "nieuw", titel: "Balayage of highlights: wat past bij jou?", inhoud: { omschrijving: "Een nieuw artikel voor je website. Mensen in Zwolle zoeken hier veel op, en het brengt ze direct naar je afspraakpagina.",
      html: "<h2>Balayage of highlights: wat past bij jou?</h2><p>Twijfel je tussen balayage en highlights? Bij Studio Lente in Zwolle helpen we je kiezen. Balayage geeft een zachte, natuurlijke overgang; highlights zijn strakker en lichter.</p><h3>Wat kost het?</h3><p>Balayage vanaf €95, highlights vanaf €75. Plan je afspraak online of bel ons.</p>" } },
    { id: "i2", soort: "profiel", status: "nieuw", titel: "Nieuwe omschrijving voor je Google-bedrijfsprofiel", inhoud: { omschrijving: "Studio Lente is dé kapsalon in het centrum van Zwolle voor knippen, kleuren, balayage en bruidskapsels. Ook op zaterdag open. Maak eenvoudig online een afspraak." } },
    { id: "i3", soort: "gegevens", status: "goedgekeurd", titel: "Veelgestelde vragen en openingstijden voor Google en AI", inhoud: { faq: [] } },
    { id: "i4", soort: "artikel", status: "goedgekeurd", titel: "Bruidskapsels in Zwolle: zo bereid je je voor", inhoud: { omschrijving: "" } }] };

  const lokaal = { pakket: "pro", profiel: { compleet: 96, mist: ["Een foto van de buitenkant van je zaak"] },
    berichten: [{ tekst: "Nieuw bij Studio Lente: Noor, onze kleurspecialist. Plan nu je balayage!", datum: dag(-3), geplaatst: true },
      { tekst: "Kerst komt eraan! Plan op tijd je afspraak, op 24 december zijn we open tot 16:00.", datum: dag(-7), geplaatst: true },
      { tekst: "Krullen? Wij knippen ze droog, zodat je precies ziet hoe het valt.", datum: dag(-10), geplaatst: true }],
    gidsen: { datum: dag(-12), gidsen: [["Telefoonboek", 1, 1], ["Opendi", 1, 1], ["Cylex", 1, 1], ["Bedrijvenpagina", 1, 1], ["Hotfrog", 1, 1]].map(([site, gevonden, klopt]) => ({ site, gevonden: !!gevonden, klopt: !!klopt })) },
    gbp: true };

  const vorigeM = maandStr(-1);
  const rapport = (m) => ({
    klant: { naam: NAAM, site: SITE, pakket: "pro", pakket_naam: "Sitehulpje Pro" }, maand: m, maand_naam: mNaam(m), vorige_naam: mNaam(m.slice(0, 5) + String(+m.slice(5) - 1 || 12).padStart(2, "0")),
    bronnen: { search_console: "sc-domain:demo.sitehulpje.nl", analytics: NAAM },
    nu: { gsc: { klikken: 1312, vertoningen: 38120, positie: 6.1, dagen: 30 }, ga4: { bezoekers: 3110, sessies: 3740, organisch: 1650, acties: 118, dagen: 30 } },
    vorig: { gsc: { klikken: 1104, vertoningen: 33480, positie: 7.0, dagen: 31 }, ga4: { bezoekers: 2760, sessies: 3290, organisch: 1390, acties: 94, dagen: 31 } },
    reeks: Array.from({ length: 12 }, (_, i) => ({ m: maandStr(i - 12), k: 520 + i * 70 + Math.round(rnd() * 60), v: 16000 + i * 1900 })),
    zoekwoorden: zoekwoorden.slice(0, 15), kansen: kansen.map((k) => ({ sleutel: k.zoekwoord, vertoningen: k.vertoningen, positie: k.positie })), paginas: paginas.slice(0, 5),
    jaar: { gsc: { klikken: 610, vertoningen: 19800, positie: 9.4, dagen: 30 }, ga4: { bezoekers: 1500, sessies: 1800, organisch: 790, acties: 41, dagen: 30 } }, jaar_naam: mNaam(String(+m.slice(0, 4) - 1) + m.slice(4)),
    nulmeting: { gsc: { klikken: 540, vertoningen: 17600, positie: 10.2, dagen: 31 }, ga4: { bezoekers: 1310, sessies: 1590, organisch: 690, acties: 33, dagen: 31 }, maand: maandStr(-8), naam: mNaam(maandStr(-8)) },
    uitleg: { richting: "stijging", samenvatting: "Meer klikken uit Google dan de maand ervoor (+22% per dag).", verschil_klikken: 22, verschil_vertoningen: 17, verschil_jaar: 115,
      redenen: [{ soort: "positie", tekst: "De site staat gemiddeld hoger in Google (plek 6,1 tegen 7,0)." }, { soort: "vraag", tekst: "De site werd 17% vaker getoond in Google." }],
      verliezers: [], winnaars: [{ sleutel: "balayage zwolle", nu: 64, vorig: 31, verschil: 33 }, { sleutel: "kapper zwolle", nu: 212, vorig: 188, verschil: 24 }], pagina_verlies: [], bereikbaar: 100, meldingen: 0 },
    gezondheid: { score: 96, vorige: 89, gemeten: dag(-3), problemen: [{ ernst: "laag", tekst: "2 foto's kunnen nog iets kleiner", groep: "Snelheid" }], goed: ["Alle pagina's zijn vindbaar voor Google", "Je site is beveiligd", "Snel op de telefoon"], snelheid: 94 },
    werk: verzoeken.map((v) => ({ nr: v.nr, onderwerp: v.onderwerp, datum: v.bijgewerkt })),
    stappen: ["\"haar verven zwolle\" staat op plek 5 met 820 vertoningen. Een betere pagina hiervoor kan veel extra klikken opleveren.", "Nieuw artikel over balayage en highlights staat klaar om goed te keuren."] });

  // ---------- antwoorden per functie en actie ----------
  const DEMO_NEE = "Dit is een demo met verzonnen gegevens, dus hier gebeurt nu niets. Met je eigen Sitehulpje werkt dit echt.";
  const A = {
    beheersite: {
      ik: { gebruiker: { id: "demo", email: "demo@sitehulpje.nl", naam: "Lisa", rol: "klant", klant_id: "demo" }, klant: { id: "demo", naam: NAAM, site: SITE } },
      verzoeken_lijst: { verzoeken: verzoeken.map(({ berichten, ...v }) => v) },
      verzoek: (b) => { const v = verzoeken.find((x) => x.id === b.id) || verzoeken[0];
        return { verzoek: { ...v, klant_id: "demo", klant_naam: NAAM, site: SITE, berichten: v.berichten.map(([van, tekst], i) => ({ id: i, van, tekst, fotos: [], aangemaakt: v.aangemaakt })) }, reacties_over: 10 }; },
      uitloggen: () => { try { sessionStorage.removeItem("sh_demo"); } catch {} setTimeout(() => (location.href = "/"), 50); return { ok: true }; },
    },
    vindbaarheid: { status: { klant: { aan: true } }, dashboard },
    "vb-gezondheid": { laatste: { laatste: { score: 96, gemeten: dag(-3), uitslag: { gecontroleerd: 48, sitemap_aantal: 48, links_gecontroleerd: 214,
      problemen: [{ ernst: "laag", groep: "Snelheid", soort: "foto", tekst: "2 foto's kunnen nog iets kleiner", oplossing: "Wij verkleinen ze deze week, je hoeft niets te doen.", voorbeelden: [SITE + "/team"], aantal: 2 }],
      goed: ["Alle 48 pagina's zijn vindbaar voor Google", "Elke pagina heeft een goede titel en omschrijving", "Je site is beveiligd (https)", "Geen kapotte links", "Je bedrijfsgegevens staan in een vorm die Google en AI begrijpen"],
      snelheid: { score: 94, lcp: "1.4", echt: { oordeel: "FAST" }, seo: 100, toegankelijkheid: 96, kansen: [] } } }, vorige: { score: 89 } } },
    "vb-waakhond": { bereikbaarheid: { metingen: 1440, sinds: dag(-30), procent: 100, ms: 380, storingen: [] } },
    "vb-voorstellen": { lijst: { automatisch: true, voorstellen: [
      { id: 1, soort: "titel_omschrijving", status: "nieuw", pagina: SITE + "/prijzen", uitleg: "", huidig: { titel: "Prijzen", omschrijving: "" },
        voorstel: { titel: "Prijzen kapper Zwolle | Knippen, kleuren & balayage", omschrijving: "Bekijk de prijzen van Studio Lente in Zwolle: knippen vanaf €32, balayage vanaf €95. Ook op zaterdag open. Maak direct online een afspraak." } },
      { id: 2, soort: "titel_omschrijving", status: "uitgevoerd", pagina: SITE + "/balayage", huidig: { titel: "Balayage", omschrijving: "" }, voorstel: { titel: "Balayage in Zwolle | Studio Lente", omschrijving: "Natuurlijke balayage door onze kleurspecialist in Zwolle. Plan online je afspraak." } },
      { id: 3, soort: "alt", status: "uitgevoerd", pagina: SITE + "/team", voorstel: { afbeeldingen: [{ src: "/foto/team.jpg", alt: "Het team van Studio Lente in de salon in Zwolle" }] } }] } },
    "vb-rapport": { lijst: { rapporten: [1, 2, 3, 4].map((n) => ({ maand: maandStr(-n), naam: mNaam(maandStr(-n)), gemaakt: nu })) }, toon: (b) => ({ rapport: { ...rapport(b.maand || vorigeM), tussenstand: (b.maand || "") === maandStr(0) } }) },
    "vb-bing": { dashboard: { koppeling: { site: SITE, fout: null }, dagen: gsc.map(([d, k, v]) => [d, Math.round(k * 0.12), Math.round(v * 0.1)]),
      zoekwoorden: zoekwoorden.slice(0, 6).map((z) => ({ ...z, klikken: Math.round(z.klikken * 0.12), vertoningen: Math.round(z.vertoningen * 0.1) })) } },
    "vb-factuur": { status: { pauze: null, open: [] },
      abonnement: { delen: [{ id: "pakket", naam: "Sitehulpje Pro", prijs: 369, minEind: dag(-30) }], korting: 0, bruto: 369, netto: 369, eind_deze_maand: dag(20), opzeg_per: null, opzeg_wat: [], komend: null },
      lijst: { facturen: [], pauzes: [], modus: "aan", mollie: true } },
    "vb-groei": { vriend: { pct: 50, link: "https://sitehulpje.nl/?vriend=DEMO", vrienden: 3 } },
    "vb-bestel": { sh_status: { nodig: false } },
    "sh-aanbod": { status: { mag: false, ads_mag: false } },
    "sr-ads": { overzicht: ads },
    "sr-inhoud": { lijst: inhoud },
    "sr-lokaal": { lijst: lokaal },
    "sr-volg": { lijst: volg, onderwerpen: { groepen: [{ naam: "Knippen", emoji: "✂️" }, { naam: "Kleuren en balayage", emoji: "🎨" }, { naam: "Bruidskapsels", emoji: "💍" }, { naam: "Behandelingen", emoji: "✨" }],
      woord: Object.fromEntries(ZW.map(([s]) => [s, [/balayage|verven|highlights/.test(s) ? 1 : /bruid/.test(s) ? 2 : /olaplex|keratine|wenkbrauw/.test(s) ? 3 : 0,
        (s.match(/zwolle|kampen|dalfsen|assendorp|stadshagen/) || [""])[0].replace(/^./, (c) => c.toUpperCase())]])), artikelen: [] } },
    "sr-reviewvraag": { status: { klaar: true, verstuurd: 38, geklikt: 27, laatste: [["Sanne", -2, 1, 0], ["Mark", -6, 1, 0], ["Eva", -8, 0, 1], ["Fatima", -11, 1, 0]].map(([naam, d, g, h]) => ({ naam, aangemaakt: dag(d), geklikt: !!g, herinnerd: !!h })) } },
    "sr-tools": { mijnrapport: { datum: dag(-3), tools } },
  };

  const echteFetch = window.fetch.bind(window);
  const antwoord = (d, status = 200) => Promise.resolve(new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } }));
  window.fetch = (url, opt = {}) => {
    const u = String(url && url.url ? url.url : url);
    const m = u.match(/\/functions\/v1\/([a-z0-9-]+)/);
    if (!m) return echteFetch(url, opt);
    let b = {}; try { b = JSON.parse(opt.body || "{}"); } catch {}
    const h = (A[m[1]] || {})[b.actie];
    if (h === undefined) return antwoord({ fout: DEMO_NEE }, 400);
    return new Promise((ok) => setTimeout(ok, 150 + Math.random() * 250)).then(() => antwoord(typeof h === "function" ? h(b) : h));
  };

  // balk bovenaan: duidelijk dat dit een demo is
  const balk = () => {
    if (document.getElementById("demobalk")) return;
    const el = document.createElement("div"); el.id = "demobalk";
    el.style.cssText = "position:sticky;top:0;z-index:9999;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;justify-content:center;padding:9px 14px;background:linear-gradient(90deg,#22e3c4,#3b82f6);color:#04111a;font:600 14px/1.3 system-ui,Arial,sans-serif;text-align:center";
    el.innerHTML = `<span>👀 Dit is een demo van Sitehulpje Pro met een verzonnen kapsalon. Kijk gerust rond, er verandert niets.</span>
      <a href="/#prijs" style="background:#04111a;color:#fff;padding:6px 12px;border-radius:999px;text-decoration:none">Bekijk de pakketten</a>
      <a href="/?demo=uit" style="color:#04111a">Demo sluiten</a>`;
    document.body.prepend(el);
  };
  if (document.body) balk(); else document.addEventListener("DOMContentLoaded", balk);

  // ---------- menu in de volgorde van het verhaal: eerst wat het oplevert, dan hoe makkelijk het is, dan gerustheid ----------
  window.SH_DEMO_MENU = [
    ["overzicht", "Overzicht", []],
    ["klanten", "Klanten", [["acties", "Telefoontjes en routes"], ["reviews", "Reviews"]]],
    ["gevonden", "Gevonden worden", [["maps", "Google Maps"], ["ai", "ChatGPT en andere AI"], ["concurrenten", "Je concurrenten"], ["zoekwoorden", "In Google zoeken"]]],
    ["verzoeken", "Iets laten aanpassen", []],
    ["website", "Je website", [["voorstellen", "Klaar om goed te keuren"], ["gezondheid", "Werkt alles goed?"], ["paginas", "Meest bekeken pagina's"]]],
    ["advertenties", "Advertenties", []],
    ["rapporten", "Rapporten", []], ["-"],
    ["inst", "Instellingen", [["koppelingen", "Google-account"], ["abonnement", "Abonnement"]]]];

  // ---------- rondleiding ----------
  if (!/portaal/.test(location.pathname)) return;
  const STAP = [
    ["overzicht", "Zo staat je bedrijf ervoor", "In één oogopslag zie je hoe vaak je gevonden wordt in Google. Bij Studio Lente gaat het duidelijk de goede kant op."],
    ["acties", "Dit levert het op", "Telefoontjes, routebeschrijvingen en aanvragen: echte klanten die via Google bij je terechtkomen."],
    ["maps", "Gevonden in Google Maps", "Wij houden je Google-bedrijfsprofiel compleet en plaatsen er elke week een bericht op. Zo blijf je zichtbaar in de buurt."],
    ["ai", "Aangeraden door ChatGPT", "Steeds meer mensen vragen AI om een tip. Wij meten elke week of jij genoemd wordt, en zorgen dat het steeds vaker gebeurt."],
    ["concurrenten", "Jij tegen je concurrenten", "Elke week zie je hoe je ervoor staat tegenover je concurrenten, en waar je ze voorbij gaat."],
    ["verzoeken", "Iets aanpassen? Gewoon vragen", "Typ, spreek in of stuur een foto. Sitehulpje past je website aan, meestal binnen een minuut. Zo te zien deed Studio Lente dat al vaak."],
    ["voorstellen", "Jij houdt de regie", "Wij schrijven verbeteringen en nieuwe pagina's voor je. Er gaat niets online zonder jouw akkoord: één klik op Goedkeuren."],
    ["reviews", "Reviews in één klik beantwoord", "Bij elke nieuwe review staat een antwoord voor je klaar. Even nakijken, op Plaatsen klikken, klaar."],
    ["advertenties", "Sneller klanten met advertenties", "Wij maken je Google-advertenties en sturen ze elke week bij. Je ziet precies wat het kost en wat het oplevert."],
    ["gezondheid", "Wij houden alles in de gaten", "Elke week controleren we je website op 14 punten, en elk half uur of hij bereikbaar is. Gaat er iets mis, dan lossen we het op."],
    ["rapporten", "Elke maand een rapport", "In gewone taal: wat er beter ging en wat we voor je deden. Het komt vanzelf in je mail."]];
  let nr = 0; try { nr = Math.min(+sessionStorage.getItem("sh_demo_stap") || 0, STAP.length - 1); } catch {}
  const css = document.createElement("style");
  css.textContent = `#demotour{position:fixed;right:20px;bottom:20px;z-index:9998;width:min(370px,calc(100vw - 24px));background:#0c1a36;color:#fff;border-radius:20px;padding:18px 18px 14px;
      box-shadow:0 20px 60px rgba(4,17,26,.45);border:1px solid rgba(34,227,196,.45);font:15px/1.5 system-ui,Arial,sans-serif;animation:dtIn .35s ease}
    @keyframes dtIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
    #demotour .dt-tel{font:12px/1 ui-monospace,Menlo,monospace;color:#22e3c4;letter-spacing:.04em}
    #demotour h3{margin:6px 0 6px;font-size:19px;color:#fff}#demotour p{margin:0 0 12px;color:#c9d6ea}
    #demotour .dt-balk{height:4px;border-radius:9px;background:rgba(255,255,255,.12);margin:0 0 12px;overflow:hidden}#demotour .dt-balk i{display:block;height:100%;background:linear-gradient(90deg,#22e3c4,#3b82f6,#8b5cf6);transition:width .3s}
    #demotour .dt-rij{display:flex;gap:8px;align-items:center}#demotour button,#demotour a.dt-knop{font:600 14px system-ui,Arial,sans-serif;border-radius:999px;padding:9px 16px;cursor:pointer;border:0;text-decoration:none}
    #demotour .dt-volg{background:linear-gradient(135deg,#22e3c4,#3b82f6);color:#04111a;margin-left:auto}#demotour .dt-terug{background:transparent;color:#c9d6ea;border:1px solid rgba(255,255,255,.25)}
    #demotour .dt-x{position:absolute;top:10px;right:12px;background:none;color:#8aa0bf;font-size:20px;padding:2px 6px}
    #demostart{position:fixed;right:20px;bottom:20px;z-index:9998;background:linear-gradient(135deg,#22e3c4,#3b82f6);color:#04111a;border:0;border-radius:999px;padding:12px 18px;font:700 15px system-ui,Arial,sans-serif;cursor:pointer;box-shadow:0 12px 30px rgba(59,130,246,.45)}
    @media (max-width:640px){#demotour{right:12px;bottom:12px;padding:14px 14px 12px}#demotour h3{font-size:17px}#demotour p{font-size:14px}#demostart{right:12px;bottom:12px}}`;
  const bewaar = () => { try { sessionStorage.setItem("sh_demo_stap", nr); } catch {} };
  const weg = () => { document.getElementById("demotour")?.remove(); document.getElementById("demostart")?.remove(); };
  const startKnop = () => {
    weg(); const b = document.createElement("button"); b.id = "demostart"; b.textContent = "▶ Rondleiding";
    b.onclick = () => { nr = 0; toon(); }; document.body.append(b);
  };
  const toon = () => {
    weg(); bewaar();
    const [p, titel, tekst] = STAP[nr], laatste = nr === STAP.length - 1;
    if (typeof window.kpNaar === "function" && document.body.dataset.pagina !== p) window.kpNaar(p);
    const el = document.createElement("div"); el.id = "demotour"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Rondleiding");
    el.innerHTML = `<button class="dt-x" aria-label="Rondleiding sluiten">×</button><span class="dt-tel">RONDLEIDING · ${nr + 1} VAN ${STAP.length}</span>
      <h3>${titel}</h3><div class="dt-balk"><i style="width:${((nr + 1) / STAP.length) * 100}%"></i></div><p>${tekst}</p>
      <div class="dt-rij">${nr ? `<button class="dt-terug">← Vorige</button>` : ""}${laatste ? `<a class="dt-knop dt-volg" href="/#prijs">Bekijk de pakketten →</a>` : `<button class="dt-volg">Volgende →</button>`}</div>`;
    el.querySelector(".dt-x").onclick = startKnop;
    const t = el.querySelector(".dt-terug"); if (t) t.onclick = () => { nr--; toon(); };
    const v = el.querySelector("button.dt-volg"); if (v) v.onclick = () => { nr++; toon(); };
    document.body.append(el);
  };
  // wachten tot het portaal klaar is (menu getekend), dan de rondleiding starten
  const wacht = () => {
    if (typeof window.kpNaar === "function" && document.body?.dataset.pagina && document.getElementById("kpnav")?.children.length) { document.head.append(css); toon(); }
    else setTimeout(wacht, 200);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wacht); else wacht();
})();
