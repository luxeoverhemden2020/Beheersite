// Sitehulpje Vindbaarheid – dashboard (klantpagina en beheer gebruiken dit allebei)
const VB_API = "https://dauvsivoxfdfzurmyuug.supabase.co/functions/v1/vindbaarheid";

async function vbApi(actie, data = {}) {
  let r;
  try {
    r = await fetch(VB_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sessie": sessie() },
      body: JSON.stringify({ actie, ...data }),
    });
  } catch { throw new Error("Geen verbinding. Controleer je internet en probeer het opnieuw."); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.fout || "Er ging iets mis."); e.status = r.status; throw e; }
  return d;
}

async function vbGzApi(actie, data = {}) {
  const r = await fetch(VB_API.replace(/vindbaarheid$/, "vb-gezondheid"), {
    method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": sessie() }, body: JSON.stringify({ actie, ...data }),
  }).catch(() => { throw new Error("Geen verbinding. Controleer je internet en probeer het opnieuw."); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.fout || "Er ging iets mis.");
  return d;
}

async function vbRvApi(actie, data = {}) {
  const r = await fetch(VB_API.replace(/vindbaarheid$/, "vb-reviews"), {
    method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": sessie() }, body: JSON.stringify({ actie, ...data }),
  }).catch(() => { throw new Error("Geen verbinding. Controleer je internet en probeer het opnieuw."); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.fout || "Er ging iets mis.");
  return d;
}

// Wat er per pakket bij hoort (zie plan). "later" = komt nog.
const VB_PAKKETTEN = {
  basis: { naam: "Basis", zoekwoorden: 25, voorstellen: 5, punten: ["Dashboard met Google- en Bing-cijfers, dagelijks bijgewerkt", "Website-check elke week", "5 pagina's per maand verbeterd (titels, omschrijvingen)", "Bedrijfsgegevens voor Google en AI (structured data)", "Maandrapport met cijfers en uitgevoerd werk", "Bedrijfsprofiel: cijfers en reviews", "Kansen: zoekwoorden waarop je bijna bovenaan staat", "Bezoekers uit AI-diensten zoals ChatGPT", "Nieuwe pagina's meteen aangemeld bij Google en Bing", "Elke maand: wat ontbreekt er op je Bedrijfsprofiel"], later: [] },
  plus: { naam: "Plus", zoekwoorden: 75, voorstellen: 15, punten: ["Alles uit Basis", "15 pagina's per maand verbeterd", "75 zoekwoorden gevolgd", "Maandrapport met verbeterpunten en uitleg", "Kant-en-klare antwoorden op nieuwe reviews", "Review-verzoeken aan je klanten", "Openingstijden, diensten en veelgestelde vragen als structured data", "1 nieuwe pagina per maand (per dienst of werkgebied)", "Elke week een bericht op je Bedrijfsprofiel", "Ontbrekende Bedrijfsprofiel-gegevens klaargezet", "Elk kwartaal controle van bedrijvengidsen"], later: [] },
  pro: { naam: "Pro", zoekwoorden: 200, voorstellen: 30, punten: ["Alles uit Plus", "30 pagina's per maand verbeterd", "200 zoekwoorden gevolgd", "Melding binnen een dag bij problemen", "Kwartaalgesprek van 30 minuten met Jan", "3 concurrenten elke week gevolgd", "Elke week gemeten of AI-diensten je noemen", "Producten en reviews vindbaar in Google en AI", "3 nieuwe pagina's per maand", "2 berichten per week op je Bedrijfsprofiel", "Elke maand controle van bedrijvengidsen"], later: [] },
};
const vbPakket = (p) => VB_PAKKETTEN[p] || VB_PAKKETTEN.basis;

const vbGetal = (n) => Math.round(n || 0).toLocaleString("nl-NL");
const vbPos = (p) => (p == null ? "–" : p.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const vbDatum = (s, opt = { day: "numeric", month: "short" }) => new Date(s + (s.length === 10 ? "T12:00:00" : "")).toLocaleDateString("nl-NL", opt);
const vbDag = (d, n) => new Date(new Date(d + "T12:00:00").getTime() + n * 86400000).toISOString().slice(0, 10);

function vbVerschil(nu, vorig, eenheid = "") {
  if (!vorig && !nu) return `<span class="vb-gelijk">geen verschil</span>`;
  if (!vorig) return `<span class="vb-op">nieuw</span>`;
  const pct = Math.round(((nu - vorig) / vorig) * 100);
  if (pct === 0) return `<span class="vb-gelijk">gelijk aan de 28 dagen ervoor</span>`;
  return `<span class="${pct > 0 ? "vb-op" : "vb-af"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%${eenheid}</span> <span class="vb-gelijk">t.o.v. de 28 dagen ervoor</span>`;
}

function vbPositieVerschil(nu, vorig) {
  if (vorig == null) return `<span class="vb-op">nieuw</span>`;
  const v = vorig - nu; // lager getal = beter
  if (Math.abs(v) < 0.5) return `<span class="vb-gelijk">gelijk</span>`;
  return `<span class="${v > 0 ? "vb-op" : "vb-af"}">${v > 0 ? "▲" : "▼"} ${vbPos(Math.abs(v))} <span class="verberg-mobiel">${Math.abs(v) >= 1.5 ? "plaatsen" : "plaats"}</span></span>`;
}

// Som over een periode van dagrijen [datum, ...waarden]
function vbSom(rijen, kol, vanaf, tot) {
  return rijen.filter((r) => r[0] >= vanaf && r[0] <= tot).reduce((s, r) => s + (r[kol] || 0), 0);
}

// Lijngrafiek per week (SVG, zonder extra bibliotheek)
function vbGrafiek(weken, titel, breedte = 640) {
  if (weken.length < 2) return `<p class="zacht">Nog te weinig gegevens voor een grafiek.</p>`;
  const W = Math.max(300, Math.round(breedte)), H = W < 500 ? 180 : 230, L = 44, R = 12, T = 14, B = 28;
  const max = Math.max(1, ...weken.map((w) => w.k));
  const stap = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / stap) * stap;
  const x = (i) => L + (i * (W - L - R)) / (weken.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const pad = weken.map((w, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(w.k).toFixed(1)}`).join("");
  const vlak = `${pad}L${x(weken.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const lijnen = [0, top / 2, top].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="vb-as"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="vb-label">${vbGetal(v)}</text>`).join("");
  const labels = [0, Math.floor((weken.length - 1) / 2), weken.length - 1].map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === weken.length - 1 ? "end" : "middle"}" class="vb-label">${vbDatum(weken[i].d, { day: "numeric", month: "short" })}</text>`).join("");
  const laatste = weken[weken.length - 1];
  const punten = weken.map((w, i) => `<circle cx="${x(i)}" cy="${y(w.k)}" r="10" class="vb-raak"><title>Week van ${vbDatum(w.d)}: ${vbGetal(w.k)} klikken, ${vbGetal(w.v)} vertoningen</title></circle>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="vb-svg" role="img" aria-label="${esc(titel)}">${lijnen}
    <path d="${vlak}" class="vb-vlak"/><path d="${pad}" class="vb-lijn"/>
    <circle cx="${x(weken.length - 1)}" cy="${y(laatste.k)}" r="4" class="vb-punt"/>
    ${labels}${punten}</svg>`;
}

function vbWeken(gsc) {
  // Hele weken (ma–zo) tot en met de laatste dag met gegevens
  const per = new Map();
  for (const [d, k, v] of gsc) {
    const dt = new Date(d + "T12:00:00"), ma = new Date(dt.getTime() - ((dt.getDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    const w = per.get(ma) || { d: ma, k: 0, v: 0, n: 0 };
    w.k += k; w.v += v; w.n++; per.set(ma, w);
  }
  const lijst = [...per.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
  if (lijst.length && lijst[lijst.length - 1].n < 7) lijst.pop(); // onvolledige laatste week weglaten
  if (lijst.length && lijst[0].n < 7) lijst.shift();
  return lijst;
}

const VB_UITLEG = {
  klikken: "Hoe vaak iemand in Google op jouw website klikte.",
  vertoningen: "Hoe vaak jouw website in de zoekresultaten van Google stond.",
  organisch: "Bezoeken die via de gewone (niet betaalde) zoekresultaten binnenkwamen. Bron: Google Analytics.",
  acties: "Belangrijke acties op je site, zoals een bestelling, offerteaanvraag of contactformulier. Bron: Google Analytics.",
  positie: "De gemiddelde plek in Google. 1 is bovenaan; lager is beter.",
};

function vbTegel(titel, waarde, verschil, uitleg, label = "Gemeten") {
  return `<div class="vb-tegel"><div class="vb-tegel-kop"><span>${titel}</span><span class="vb-label-chip" title="${label === "Gemeten" ? "Echte cijfers uit Google" : ""}">${label}</span></div>
    <div class="vb-waarde">${waarde}</div><div class="vb-sub">${verschil}</div><p class="vb-uitleg">${uitleg}</p></div>`;
}

function vbTabel(rijen, soort, n) {
  if (!rijen.length) return `<p class="zacht">Nog geen ${soort === "pagina" ? "pagina's" : "zoekwoorden"} met vertoningen in deze periode.</p>`;
  const naam = (s) => soort === "pagina" ? esc(s.replace(/^https?:\/\/[^/]+/, "") || "/") : esc(s);
  return `<div class="vb-tabelwrap"><table class="vb-tabel"><thead><tr><th>${soort === "pagina" ? "Pagina" : "Zoekwoord"}</th><th class="r">Positie</th><th class="r">Klikken</th><th class="r verberg-mobiel">Vertoningen</th><th class="r"><span class="verberg-mobiel">Verschil</span><span class="alleen-mobiel">±</span></th></tr></thead><tbody>
    ${rijen.slice(0, n).map((r) => `<tr><td class="vb-naam" title="${esc(r.sleutel)}">${naam(r.sleutel)}</td><td class="r mono">${vbPos(r.positie)}</td><td class="r mono">${vbGetal(r.klikken)}</td><td class="r mono verberg-mobiel">${vbGetal(r.vertoningen)}</td><td class="r">${vbPositieVerschil(r.positie, r.vorige_positie)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

// Hoofdfunctie: teken het dashboard in `el`. klantId alleen nodig voor Jan (beheer).
// Google Bedrijfsprofiel: hoe vaak gevonden in Zoeken en Maps, en wat mensen daarna deden; plus reviews
function vbGbpKaart(d) {
  const k = d.koppeling;
  if (!k?.gbp_locatie || !(d.gbp || []).length) return "";
  const eind = d.gbp[d.gbp.length - 1][0], start = vbDag(eind, -27), vEind = vbDag(eind, -28), vStart = vbDag(eind, -55);
  const heeftVorig = d.gbp.some((r) => r[0] <= vEind);
  const t = (kol) => [vbSom(d.gbp, kol, start, eind), vbSom(d.gbp, kol, vStart, vEind)];
  const v = ([nu, vorig]) => (heeftVorig ? vbVerschil(nu, vorig) : `<span class="vb-gelijk">vergelijking volgt</span>`);
  const [zk, mp, bl, rt, ws] = [1, 2, 3, 4, 5].map(t);
  const ster = (n) => `<span aria-label="${n} van 5 sterren" style="color:#f5b301;letter-spacing:1px">${"★".repeat(n || 0)}<span style="opacity:.3">${"★".repeat(5 - (n || 0))}</span></span>`;
  const open = (d.reviews || []).filter((r) => !r.antwoord && r.status !== "overgeslagen").length;
  return `<div class="kaart"><h2><span class="tag">&gt;_</span>Google Bedrijfsprofiel</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">${esc(k.gbp_naam || "")} · ${vbDatum(start)} t/m ${vbDatum(eind, { day: "numeric", month: "short", year: "numeric" })}</p>
    <div class="vb-tegels">
      ${vbTegel("Gevonden in Google Zoeken", vbGetal(zk[0]), v(zk), "Hoe vaak je bedrijfsprofiel verscheen als iemand in Google zocht.")}
      ${vbTegel("Gevonden in Google Maps", vbGetal(mp[0]), v(mp), "Hoe vaak je bedrijfsprofiel verscheen in Google Maps.")}
      ${vbTegel("Gebeld", vbGetal(bl[0]), v(bl), "Hoe vaak iemand vanuit je profiel op Bellen tikte.")}
      ${vbTegel("Route gevraagd", vbGetal(rt[0]), v(rt), "Hoe vaak iemand een route naar je zaak opvroeg.")}
      ${vbTegel("Naar je website", vbGetal(ws[0]), v(ws), "Hoe vaak iemand vanuit je profiel naar je website ging.")}
    </div>
    ${k.gbp_aantal ? `<div class="rij" style="margin-top:14px;gap:10px"><span>${ster(Math.round(k.gbp_score || 0))} <b>${Number(k.gbp_score || 0).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}</b> <span class="zacht vb-klein">uit ${vbGetal(k.gbp_aantal)} reviews</span></span>
      ${open ? `<span class="vb-let vb-klein">${open} ${open === 1 ? "review wacht" : "reviews wachten"} op een antwoord</span>` : ""}<button class="knop rand klein" data-vb-naar="reviews">Reviews bekijken</button></div>` : ""}
    <p class="zacht vb-klein" style="margin-bottom:0">Bron: Google Bedrijfsprofiel. Google geeft deze cijfers met een paar dagen vertraging door.</p></div>`;
}

// Bezoekers die via een AI-dienst (ChatGPT, Perplexity, Copilot…) op de site kwamen
function vbAiKaart(d) {
  if (!d.koppeling?.ga4_property || !(d.ga4 || []).length) return "";
  const rijen = d.ai || [], eind = d.ga4[d.ga4.length - 1][0], start = vbDag(eind, -27), vEind = vbDag(eind, -28), vStart = vbDag(eind, -55);
  const som = (s, e, bron) => rijen.filter((r) => r[0] >= s && r[0] <= e && (!bron || r[1] === bron)).reduce((t, r) => t + r[2], 0);
  const nu = som(start, eind), vorig = som(vStart, vEind), jaar = som(vbDag(eind, -364), eind);
  const bronnen = [...new Set(rijen.map((r) => r[1]))].map((b) => [b, som(start, eind, b)]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]);
  return `<div class="kaart"><h2><span class="tag">&gt;_</span>Bezoekers uit AI-diensten</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">Mensen die via ChatGPT, Perplexity, Copilot, Gemini of een andere AI-dienst op je site kwamen. Laatste 28 dagen.</p>
    <div class="vb-tegels">${vbTegel("Bezoeken via AI", vbGetal(nu), rijen.some((r) => r[0] <= vEind) ? vbVerschil(nu, vorig) : `<span class="vb-gelijk">vergelijking volgt</span>`, "Bezoeken waarbij iemand vanuit een AI-antwoord doorklikte naar je website.")}
      ${vbTegel("Afgelopen jaar", vbGetal(jaar), `<span class="vb-gelijk">totaal</span>`, "Alle bezoeken via AI-diensten in de laatste 12 maanden.")}</div>
    ${bronnen.length ? `<ul class="lijst vb-klein" style="margin:10px 0 0;padding-left:18px">${bronnen.map(([b, n]) => `<li><b>${esc(b)}</b>: ${vbGetal(n)} ${n === 1 ? "bezoek" : "bezoeken"}</li>`).join("")}</ul>` :
      `<p class="zacht vb-klein" style="margin:10px 0 0">Nog geen bezoekers via AI deze maand. Dat is nu nog normaal; het groeit snel. Sitehulpje zorgt dat AI-diensten je bedrijf goed kunnen begrijpen.</p>`}</div>`;
}
// Zoekwoorden waarop je bijna op de eerste pagina van Google staat, met een schatting van wat een betere plek oplevert
const VB_CTR = [0, 0.28, 0.15, 0.10, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
const vbCtr = (p) => p <= 10 ? VB_CTR[Math.max(1, Math.round(p))] : 0.008;
function vbKansen(d, n = 8) {
  const k = (d.kansen || []).map((r) => ({ ...r, extra: Math.max(0, Math.round(r.vertoningen * (VB_CTR[3] - vbCtr(r.positie)))) }))
    .filter((r) => r.extra >= 2).sort((a, b) => b.extra - a.extra).slice(0, n);
  if (!k.length) return "";
  return `<div class="kaart"><h2><span class="tag">&gt;_</span>Kansen: bijna bovenaan in Google</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">Op deze zoekwoorden sta je net buiten de top. Met een betere tekst op die pagina kun je flink meer klikken krijgen. Laatste 28 dagen.</p>
    <div class="tabel-scroll"><table><thead><tr><th>Zoekwoord</th><th>Pagina</th><th class="r">Nu op plek</th><th class="r">Vertoningen</th><th class="r">Op plek 3</th></tr></thead><tbody>
    ${k.map((r) => `<tr><td><b>${esc(r.zoekwoord)}</b></td><td class="vb-klein"><a href="${esc(r.pagina)}" target="_blank" rel="noopener">${esc(vbKort(r.pagina))}</a></td>
      <td class="r mono">${r.positie.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}</td><td class="r mono">${vbGetal(r.vertoningen)}</td><td class="r mono vb-op">+${vbGetal(r.extra)} klikken</td></tr>`).join("")}</tbody></table></div>
    <p class="zacht vb-klein" style="margin-bottom:0">"Op plek 3" is een schatting van de extra klikken per maand als je naar plek 3 stijgt. Sitehulpje neemt deze pagina's mee in de verbetervoorstellen.</p></div>`;
}
// Reviews: concept-antwoorden nakijken en plaatsen
// Google zet bij vertaalde reviews "(Translated by Google) … (Original) …" in de tekst: toon alleen het origineel
const vbRvTekst = (t) => { t = String(t || ""); const o = t.split(/\(Original\)/i); return (o.length > 1 ? o[o.length - 1] : t.replace(/\(Translated by Google\)/i, "")).trim(); };
function vbReviewsHtml(d) {
  const ster = (n) => `<span aria-label="${n} van 5 sterren" style="color:#f5b301;letter-spacing:1px">${"★".repeat(n || 0)}<span style="opacity:.3">${"★".repeat(5 - (n || 0))}</span></span>`;
  const lijst = [...(d.reviews || [])].sort((a, b) => (!!a.antwoord - !!b.antwoord) || String(b.datum).localeCompare(String(a.datum)));
  if (!lijst.length) return `<div class="kaart"><p class="zacht">Nog geen reviews opgehaald.</p></div>`;
  return `<div class="kaart"><h2><span class="tag">&gt;_</span>Reviews op Google</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">${d.klant.pakket === "basis" ? "Bij een nieuwe review krijg je een seintje. Typ je antwoord en klik op Plaatsen; dan staat het meteen op Google. Met Plus of Pro zet Sitehulpje het antwoord alvast voor je klaar." : "Bij een nieuwe review zet Sitehulpje een antwoord voor je klaar."} ${d.klant.pakket === "basis" ? "" : " Pas het aan als je wilt en klik op Plaatsen; dan staat het meteen op Google."} Er gaat nooit iets online zonder jouw klik.</p>
    ${lijst.map((r) => `<div class="vb-review" data-rv="${esc(r.review_id)}" style="padding:12px 0;border-top:1px solid var(--lijn)">
      <div class="rij" style="gap:8px">${ster(r.sterren)} <b>${esc(r.naam)}</b> <span class="zacht vb-klein">${r.datum ? vbDatum(String(r.datum).slice(0, 10), { day: "numeric", month: "short", year: "numeric" }) : ""}</span></div>
      ${r.tekst ? `<p style="margin:6px 0 0">${esc(vbRvTekst(r.tekst))}</p>` : `<p class="zacht vb-klein" style="margin:6px 0 0">Alleen sterren, geen tekst.</p>`}
      ${r.antwoord ? `<p class="zacht vb-klein" style="margin:6px 0 0">↳ <b>Jouw antwoord:</b> ${esc(r.antwoord)}</p>` : r.status === "overgeslagen" ? `<p class="zacht vb-klein" style="margin:6px 0 0">Overgeslagen · <button class="knop rand klein" data-rv-terug>Toch beantwoorden</button></p>` :
        `<div data-rv-vak style="margin-top:8px">${r.concept ? `<label class="vb-klein">Voorstel voor je antwoord</label><textarea rows="3" data-rv-tekst>${esc(r.concept)}</textarea>` : `<textarea rows="3" data-rv-tekst placeholder="${d.klant.pakket !== "basis" ? "Typ een antwoord, of laat Sitehulpje een voorstel maken" : "Typ je antwoord"}"></textarea>`}
          <div class="rij" style="margin-top:6px;gap:6px"><button class="knop klein" data-rv-plaats>Plaatsen op Google</button>${d.klant.pakket !== "basis" ? `<button class="knop rand klein" data-rv-concept>${r.concept ? "Ander voorstel" : "Maak voorstel"}</button>` : ""}<button class="knop rand klein" data-rv-over>Overslaan</button></div>
          <div data-rv-meld></div></div>`}</div>`).join("")}</div>`;
}
function vbReviewsKoppel(el, klantId) {
  el.querySelectorAll("[data-rv]").forEach((blok) => {
    const id = blok.dataset.rv, meld = (t, s = "fout") => { const m = blok.querySelector("[data-rv-meld]"); if (m) toonMelding(m, t, s); };
    const tekst = () => blok.querySelector("[data-rv-tekst]")?.value || "";
    const knop = (sel, fn) => { const b = blok.querySelector(sel); if (b) b.onclick = async () => { b.disabled = true; try { await fn(b); } catch (e) { meld(e.message); } b.disabled = false; }; };
    knop("[data-rv-plaats]", async () => { await vbRvApi("plaats", { klant_id: klantId, review_id: id, tekst: tekst() }); vbToon(el, klantId, "reviews"); });
    knop("[data-rv-concept]", async (b) => { b.textContent = "Even denken…"; const r = await vbRvApi("concept", { klant_id: klantId, review_id: id }); blok.querySelector("[data-rv-tekst]").value = r.concept; b.textContent = "Ander voorstel"; });
    knop("[data-rv-over]", async () => { await vbRvApi("overslaan", { klant_id: klantId, review_id: id }); vbToon(el, klantId, "reviews"); });
    knop("[data-rv-terug]", async () => { await vbRvApi("concept", { klant_id: klantId, review_id: id }); vbToon(el, klantId, "reviews"); });
  });
}

async function vbToon(el, klantId, beginTab) {
  el.innerHTML = `<div class="kaart"><p class="zacht">Laden…</p></div>`;
  let d;
  try { d = await vbApi("dashboard", { klant_id: klantId }); }
  catch (e) { el.innerHTML = `<div class="kaart"><div class="melding fout">${esc(e.message)}</div></div>`; return; }
  el.vbData = d;
  const k = d.koppeling;
  const params = new URLSearchParams(location.search);
  let melding = "";
  if (params.get("google") === "ok") melding = `<div class="melding ok">Google is gekoppeld. De cijfers staan hieronder; ze worden elke nacht bijgewerkt.</div>`;
  if (params.get("google") === "ga4") melding = `<div class="melding ok">Toestemming gegeven. Kies hieronder waar Sitehulpje je Analytics aanmaakt.</div>`;
  if (params.get("google") === "kies") melding = `<div class="melding let">Google is gekoppeld. Kies hieronder welke website en welke Analytics-gegevens bij jouw bedrijf horen.</div>`;

  const pk = vbPakket(d.klant.pakket);
  const pakketKaart = `<div class="kaart"><h2><span class="tag">&gt;_</span>Jouw pakket: ${pk.naam}</h2>
    <ul class="vb-goed">${pk.punten.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    ${pk.later.length ? `<p class="zacht vb-klein" style="margin:10px 0 4px"><b>Komt eraan</b> (zonder extra kosten):</p><ul class="lijst vb-klein zacht" style="margin:0;padding-left:18px">${pk.later.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    <p class="zacht vb-klein" style="margin-bottom:0">Ander pakket? Neem contact op met Jan. · <a href="uitleg-vindbaarheid">Uitleg: hoe werkt Vindbaarheid?</a></p></div>`;
  const koppelKaart = pakketKaart + `<div class="kaart vb-koppel">
    <h2><span class="tag">&gt;_</span>Koppelingen</h2>
    <ul class="vb-bronnen">
      <li><span class="vb-stip ${k?.gsc_site && k.status !== "ingetrokken" ? "aan" : ""}"></span>Google Search Console${k?.gsc_site ? ` · <span class="zacht">${esc(k.gsc_site.replace(/^sc-domain:/, ""))}</span>` : ""}</li>
      <li><span class="vb-stip ${k?.ga4_property && k.status !== "ingetrokken" ? "aan" : ""}"></span>Google Analytics${k?.ga4_naam ? ` · <span class="zacht">${esc(k.ga4_naam)}${k.ga4_meet_id ? ` (${esc(k.ga4_meet_id)})` : ""}</span>` : ""}${k && !k.ga4_property && d.ga4_aanmaken ? ` · <button class="knop klein" data-vb="ga4">Analytics voor mij instellen</button>` : ""}</li>
      <li><span class="vb-stip ${k?.gbp_locatie && !k.gbp_fout && k.status !== "ingetrokken" ? "aan" : k?.gbp_locatie ? "" : "later"}"></span>Google Bedrijfsprofiel · <span class="zacht">${k?.gbp_naam ? esc(k.gbp_naam) : !k ? "" : !k.gbp_toestemming ? "koppel Google opnieuw en geef ook toestemming voor je Bedrijfsprofiel" : "kies je profiel via \"Website kiezen\""}</span></li>
      <li><span class="vb-stip later"></span>Bing · <span class="zacht">nog niet gekoppeld</span></li>
    </ul>
    ${k ? `<p class="zacht vb-klein">Gekoppeld met ${esc(k.google_email || "je Google-account")}${k.laatst_opgehaald ? ` · bijgewerkt ${datum(k.laatst_opgehaald)}` : ""}.
      Wij lezen je cijfers en plaatsen alleen iets op Google (zoals een antwoord op een review) als jij op Plaatsen klikt. Je kunt de koppeling altijd stoppen.</p>` :
      `<p class="zacht">Koppel je Google-account, dan zie je hier hoe vaak je gevonden wordt. Je logt in bij Google zelf; wij krijgen geen wachtwoord. We lezen je cijfers en plaatsen alleen iets op Google als jij dat goedkeurt.</p>`}
    ${k?.fout ? `<div class="melding ${k.status === "ingetrokken" ? "fout" : "let"}">${esc(k.status === "ingetrokken" ? k.fout : "Niet alles kon worden opgehaald. Jan is op de hoogte.")}</div>` : ""}
    <div class="rij">
      ${!k && d.ga4_aanmaken ? `<button class="knop" data-vb="koppelga4">Koppel Google en stel Analytics voor me in</button>` : ""}
      <button class="knop ${k ? "rand klein" : ""}" data-vb="koppel">${k ? (k.status === "ingetrokken" ? "Google opnieuw koppelen" : "Ander Google-account koppelen") : "Koppel Google"}</button>
      ${k ? `<button class="knop rand klein" data-vb="kies">Website kiezen</button><button class="knop rand klein" data-vb="ontkoppel">Koppeling stoppen</button>` : ""}
    </div>
    <div data-vb-kies></div>
    <div class="verborgen" data-vb-fout></div>
  </div>`;

  if (!k || (!d.gsc.length && !d.ga4.length)) {
    el.innerHTML = melding + koppelKaart + (k ? `<div class="kaart"><p class="zacht">Er zijn nog geen cijfers uit Google. ${!k.gsc_site && !k.ga4_property ? "Kies eerst hierboven welke website bij jouw bedrijf hoort." : "Ze worden vannacht opgehaald."}</p></div>` : "") +
      `<div data-vb-vs></div><div data-vb-gz-kort class="verborgen"></div><div data-vb-gz></div>`;
    vbKnoppen(el, klantId, d);
    if (k && !k.gsc_site && !k.ga4_property) vbKiezer(el, klantId);
    vbGezondheid(el, klantId, () => {});
    vbVoorstellen(el.querySelector("[data-vb-vs]"), klantId, el);
    return;
  }

  // Periode: laatste 28 dagen met gegevens vs de 28 dagen daarvoor
  const eind = (d.gsc.length ? d.gsc[d.gsc.length - 1][0] : d.ga4[d.ga4.length - 1][0]);
  const start = vbDag(eind, -27), vEind = vbDag(eind, -28), vStart = vbDag(eind, -55);
  const kl = vbSom(d.gsc, 1, start, eind), klV = vbSom(d.gsc, 1, vStart, vEind);
  const vt = vbSom(d.gsc, 2, start, eind), vtV = vbSom(d.gsc, 2, vStart, vEind);
  const og = vbSom(d.ga4, 3, start, eind), ogV = vbSom(d.ga4, 3, vStart, vEind);
  const ac = vbSom(d.ga4, 4, start, eind), acV = vbSom(d.ga4, 4, vStart, vEind);
  const heeftVorig = d.gsc.some((r) => r[0] <= vEind) || d.ga4.some((r) => r[0] <= vEind);
  const v = (nu, vorig) => (heeftVorig ? vbVerschil(nu, vorig) : `<span class="vb-gelijk">vergelijking volgt</span>`);

  let zin = "";
  if (heeftVorig && klV) {
    const pct = Math.round(((kl - klV) / klV) * 100);
    zin = pct > 2 ? `Je kreeg <b>${pct}% meer klikken</b> uit Google dan in de 28 dagen ervoor.` :
      pct < -2 ? `Je kreeg <b>${Math.abs(pct)}% minder klikken</b> uit Google dan in de 28 dagen ervoor.` :
      `Je kreeg ongeveer <b>evenveel klikken</b> uit Google als in de 28 dagen ervoor.`;
  }
  const weken = vbWeken(d.gsc);

  el.innerHTML = `${melding}
  <div class="vb-tabs" role="tablist">
    <button class="vb-tab aan" data-vb-tab="overzicht">Overzicht</button>
    <button class="vb-tab" data-vb-tab="zoekwoorden">Zoekwoorden</button>
    <button class="vb-tab" data-vb-tab="paginas">Pagina's</button>
    ${d.koppeling?.gbp_locatie ? `<button class="vb-tab" data-vb-tab="reviews">Reviews${(d.reviews || []).some((r) => !r.antwoord && r.status !== "overgeslagen") ? ` (${(d.reviews || []).filter((r) => !r.antwoord && r.status !== "overgeslagen").length})` : ""}</button>` : ""}
    <button class="vb-tab" data-vb-tab="voorstellen">Voorstellen</button>
    <button class="vb-tab" data-vb-tab="gezondheid">Website-gezondheid</button>
    <button class="vb-tab" data-vb-tab="rapporten">Rapporten</button>
    <button class="vb-tab" data-vb-tab="koppelingen">Koppelingen</button>
  </div>
  <div data-vb-paneel="overzicht">
    <div class="kaart" data-vb-blok="tegels">
      <h2><span class="tag">&gt;_</span>Laatste 28 dagen in één oogopslag</h2>
      <p class="zacht vb-klein" style="margin-top:-4px"><a href="uitleg-vindbaarheid#cijfers" style="float:right">Wat betekenen de cijfers?</a>${vbDatum(start)} t/m ${vbDatum(eind, { day: "numeric", month: "short", year: "numeric" })}${zin ? ` · ${zin}` : ""}</p>
      <div class="vb-tegels">
        ${d.gsc.length ? vbTegel("Klikken uit Google", vbGetal(kl), v(kl, klV), VB_UITLEG.klikken) : ""}
        ${d.gsc.length ? vbTegel("Vertoningen in Google", vbGetal(vt), v(vt, vtV), VB_UITLEG.vertoningen) : ""}
        ${d.ga4.length ? vbTegel("Bezoeken via Google", vbGetal(og), v(og, ogV), VB_UITLEG.organisch) : ""}
        ${d.ga4.length ? vbTegel("Acties op je site", vbGetal(ac), v(ac, acV), VB_UITLEG.acties) : ""}
      </div>
    </div>
    <div data-vb-blok="gbp">${vbGbpKaart(d)}</div>
    <div data-vb-blok="ai">${vbAiKaart(d)}</div>
    ${d.gsc.length ? `<div class="kaart" data-vb-blok="grafiek"><h2><span class="tag">&gt;_</span>Klikken uit Google per week</h2><div data-vb-grafiek></div>
      <p class="zacht vb-klein">Bron: Google Search Console. De laatste twee dagen kunnen nog iets veranderen.</p></div>` : ""}
    <div data-vb-gz-kort></div>
    ${d.zoekwoorden.length ? `<div class="kaart" data-vb-blok="beste"><h2><span class="tag">&gt;_</span>Beste zoekwoorden</h2>${vbTabel(d.zoekwoorden, "zoekwoord", 10)}
      <div class="rij" style="margin-top:10px"><button class="knop rand klein" data-vb-naar="zoekwoorden">Alle zoekwoorden</button></div>
      <p class="zacht vb-klein">${VB_UITLEG.positie} "Verschil" vergelijkt met de 28 dagen ervoor.</p></div>` : ""}
    <div data-vb-blok="kansen">${vbKansen(d)}</div>
  </div>
  <div data-vb-paneel="zoekwoorden" class="verborgen"><div class="kaart" data-vb-blok="zoektabel">
    <h2><span class="tag">&gt;_</span>Alle zoekwoorden</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">Waarop mensen zochten toen jouw site in Google verscheen, laatste 28 dagen. Google toont om privacyredenen niet elke zoekopdracht.</p>
    <input type="search" placeholder="Zoek een woord…" data-vb-filter="zoekwoord" style="margin-bottom:10px">
    <div data-vb-lijst="zoekwoord">${vbTabel(d.zoekwoorden, "zoekwoord", vbPakket(d.klant.pakket).zoekwoorden)}</div>
    ${d.zoekwoorden.length > vbPakket(d.klant.pakket).zoekwoorden ? `<p class="zacht vb-klein">Je pakket ${vbPakket(d.klant.pakket).naam} toont de beste ${vbPakket(d.klant.pakket).zoekwoorden} zoekwoorden. Met een groter pakket zie je er meer.</p>` : ""}
  </div></div>
  <div data-vb-paneel="paginas" class="verborgen"><div class="kaart">
    <h2><span class="tag">&gt;_</span>Pagina's in Google</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">Welke pagina's van je site het vaakst in Google verschenen, laatste 28 dagen.</p>
    <input type="search" placeholder="Zoek een pagina…" data-vb-filter="pagina" style="margin-bottom:10px">
    <div data-vb-lijst="pagina">${vbTabel(d.paginas, "pagina", 200)}</div>
  </div></div>
  <div data-vb-paneel="reviews" class="verborgen">${d.koppeling?.gbp_locatie ? vbReviewsHtml(d) : ""}</div>
  <div data-vb-paneel="voorstellen" class="verborgen" data-vb-vs></div>
  <div data-vb-paneel="gezondheid" class="verborgen" data-vb-gz></div>
  <div data-vb-paneel="rapporten" class="verborgen" data-vb-rap></div>
  <div data-vb-paneel="koppelingen" class="verborgen">${koppelKaart}</div>`;

  const gr = el.querySelector("[data-vb-grafiek]");
  if (gr) {
    const teken = () => { gr.innerHTML = vbGrafiek(weken, "Klikken uit Google per week", gr.clientWidth || 640); };
    teken();
    let w = gr.clientWidth;
    if (window.ResizeObserver) new ResizeObserver(() => { if (Math.abs(gr.clientWidth - w) > 40) { w = gr.clientWidth; teken(); } }).observe(gr);
  }
  const toonTab = (t) => {
    if (window.vbNaarPagina && window.vbNaarPagina(t)) return;
    el.querySelectorAll(".vb-tab").forEach((b) => b.classList.toggle("aan", b.dataset.vbTab === t));
    el.querySelectorAll("[data-vb-paneel]").forEach((p) => p.classList.toggle("verborgen", p.dataset.vbPaneel !== t));
  };
  el.querySelectorAll(".vb-tab").forEach((b) => (b.onclick = () => toonTab(b.dataset.vbTab)));
  el.querySelectorAll("[data-vb-naar]").forEach((b) => (b.onclick = () => { toonTab(b.dataset.vbNaar); el.scrollIntoView({ behavior: "smooth" }); }));
  el.querySelectorAll("[data-vb-filter]").forEach((inp) => {
    const soort = inp.dataset.vbFilter, bron = soort === "pagina" ? d.paginas : d.zoekwoorden;
    inp.oninput = () => {
      const q = inp.value.trim().toLowerCase();
      el.querySelector(`[data-vb-lijst="${soort}"]`).innerHTML = vbTabel(q ? bron.filter((r) => r.sleutel.toLowerCase().includes(q)) : bron, soort, soort === "zoekwoord" ? vbPakket(d.klant.pakket).zoekwoorden : 200);
    };
  });
  if (params.get("google") === "kies") { toonTab("koppelingen"); vbKiezer(el, klantId); }
  else if (beginTab) toonTab(beginTab);
  vbReviewsKoppel(el, klantId);
  vbKnoppen(el, klantId, d);
  vbGezondheid(el, klantId, toonTab);
  vbRapporten(el.querySelector("[data-vb-rap]"), klantId);
  vbBing(el, klantId, eind);
  vbVoorstellen(el.querySelector("[data-vb-vs]"), klantId, el);
}

// ---------- Bing ----------
async function vbBing(el, klantId, eind) {
  try {
    const r = await fetch(VB_API.replace(/vindbaarheid$/, "vb-bing"), { method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": sessie() }, body: JSON.stringify({ actie: "dashboard", klant_id: klantId }) });
    const d = await r.json(); if (!r.ok || !d.koppeling) return;
    el.querySelectorAll(".vb-bronnen li").forEach((li) => {
      if (/^\s*Bing/.test(li.textContent)) li.innerHTML = `<span class="vb-stip ${d.koppeling.fout ? "" : "aan"}"></span>Bing Webmaster Tools · <span class="zacht">${esc(d.koppeling.site.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</span>`;
    });
    if (!d.dagen.length) return;
    const e = eind || d.dagen[d.dagen.length - 1][0];
    const start = vbDag(e, -27), vEind = vbDag(e, -28), vStart = vbDag(e, -55);
    const kl = vbSom(d.dagen, 1, start, e), klV = vbSom(d.dagen, 1, vStart, vEind);
    const tegels = el.querySelector('[data-vb-paneel="overzicht"] .vb-tegels');
    if (tegels) tegels.insertAdjacentHTML("beforeend", vbTegel("Klikken uit Bing", vbGetal(kl), d.dagen.some((x) => x[0] <= vEind) ? vbVerschil(kl, klV) : `<span class="vb-gelijk">vergelijking volgt</span>`, "Hoe vaak iemand in Bing (ook gebruikt door ChatGPT-zoeken en Copilot) op jouw website klikte."));
    if (d.zoekwoorden.length) {
      const zw = el.querySelector('[data-vb-paneel="zoekwoorden"]');
      if (zw) zw.insertAdjacentHTML("beforeend", `<div class="kaart"><h2><span class="tag">&gt;_</span>Zoekwoorden in Bing</h2>${vbTabel(d.zoekwoorden.map((z) => ({ ...z, vorige_positie: z.positie })), "zoekwoord", 50)}
        <p class="zacht vb-klein">Bing wordt ook gebruikt door ChatGPT-zoeken, Copilot en DuckDuckGo.</p></div>`);
    }
  } catch { /* geen Bing */ }
}

// ---------- Maandrapporten ----------
function vbRapportUrl(klantId, maand) {
  const q = new URLSearchParams(); if (maand) q.set("maand", maand);
  if (IS_BEHEER) { q.set("beheer", "1"); q.set("klant", klantId || ""); }
  return "rapport?" + q;
}
async function vbRapporten(el, klantId) {
  if (!el) return;
  let lijst = [];
  try {
    const r = await fetch(VB_API.replace(/vindbaarheid$/, "vb-rapport"), { method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": sessie() }, body: JSON.stringify({ actie: "lijst", klant_id: klantId }) });
    lijst = (await r.json()).rapporten || [];
  } catch { /* lege lijst */ }
  el.innerHTML = `<div class="kaart"><h2><span class="tag">&gt;_</span>Maandrapporten</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">Elke maand een overzicht van je vindbaarheid, wat er is gedaan en wat de volgende stappen zijn. Te downloaden als PDF.</p>
    <ul class="vb-rapporten">
      <li><a href="${vbRapportUrl(klantId, new Date().toISOString().slice(0, 7))}">Deze maand (tussenstand)</a></li>
      ${lijst.map((r) => `<li><a href="${vbRapportUrl(klantId, r.maand)}">${esc(r.naam.charAt(0).toUpperCase() + r.naam.slice(1))}</a></li>`).join("")}
    </ul>
    ${!lijst.length ? `<p class="zacht vb-klein">Het eerste volledige rapport verschijnt begin volgende maand.</p>` : ""}</div>`;
}

// ---------- Website-gezondheid ----------
const VB_ERNST = { hoog: ["Belangrijk", "vb-af"], middel: ["Verbeterpunt", "vb-let"], laag: ["Klein", "vb-gelijk"] };
const VB_ECHT = { FAST: "snel", AVERAGE: "gemiddeld", SLOW: "traag" };
function vbScoreRing(score, groot = true) {
  const r = groot ? 34 : 22, o = 2 * Math.PI * r, kleur = score >= 80 ? "var(--accent)" : score >= 55 ? "var(--let)" : "var(--fout)", z = (r + 6) * 2;
  return `<svg viewBox="0 0 ${z} ${z}" width="${z}" height="${z}" class="vb-ring" role="img" aria-label="Score ${score} van 100">
    <circle cx="${z / 2}" cy="${z / 2}" r="${r}" fill="none" stroke="var(--lijn)" stroke-width="7"/>
    <circle cx="${z / 2}" cy="${z / 2}" r="${r}" fill="none" stroke="${kleur}" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${(o * score) / 100} ${o}" transform="rotate(-90 ${z / 2} ${z / 2})"/>
    <text x="50%" y="50%" dy=".35em" text-anchor="middle" class="vb-ring-getal" style="font-size:${groot ? 22 : 15}px">${score}</text></svg>`;
}
function vbKort(u) { return (u || "").replace(/^https?:\/\/[^/]+/, "") || "/"; }

async function vbGezondheid(el, klantId, toonTab) {
  const paneel = el.querySelector("[data-vb-gz]"), kort = el.querySelector("[data-vb-gz-kort]");
  if (!paneel) return;
  const teken = (d) => {
    const L = d.laatste;
    if (!L) {
      kort.innerHTML = "";
      paneel.innerHTML = `<div class="kaart"><h2><span class="tag">&gt;_</span>Website-gezondheid</h2>
        <p class="zacht">Nog niet gecontroleerd. De controle loopt elke maandagnacht vanzelf, of start hem nu (duurt 1 tot 2 minuten).</p>
        <div class="rij"><button class="knop" data-vb-gz-nu>Nu controleren</button></div><div data-vb-gz-meld></div></div>`;
    } else {
      const u = L.uitslag, ps = u.snelheid, p = u.problemen || [];
      const tel = (e) => p.filter((x) => x.ernst === e).length;
      const verschil = d.vorige ? L.score - d.vorige.score : null;
      kort.innerHTML = `<div class="kaart vb-gz-kort"><div class="rij" style="gap:14px;flex-wrap:nowrap">${vbScoreRing(L.score, false)}
        <div class="vul"><b>Website-gezondheid: ${L.score} van 100</b>${verschil ? ` <span class="${verschil > 0 ? "vb-op" : "vb-af"}">${verschil > 0 ? "▲" : "▼"} ${Math.abs(verschil)}</span>` : ""}
        <div class="zacht vb-klein">${tel("hoog")} belangrijk · ${tel("middel")} verbeterpunten · ${tel("laag")} klein · gecontroleerd ${datum(L.gemeten)}</div></div>
        <button class="knop rand klein" data-vb-naar-gz>Bekijk</button></div></div>`;
      kort.querySelector("[data-vb-naar-gz]").onclick = () => toonTab("gezondheid");
      const groepen = ["Techniek", "Inhoud", "Snelheid", "AI-vindbaarheid"];
      const probleemHtml = (x) => `<details class="vb-probleem"><summary><span class="vb-ernst ${VB_ERNST[x.ernst][1]}">${VB_ERNST[x.ernst][0]}</span><span>${esc(x.tekst)}</span></summary>
        <div class="vb-probleem-lijf">${x.oplossing ? `<p><b>Zo los je het op:</b> ${esc(x.oplossing)}</p>` : ""}
        ${x.voorbeelden?.length ? `<p class="zacht vb-klein" style="margin-bottom:4px">${x.aantal > x.voorbeelden.length ? `Voorbeelden (${x.voorbeelden.length} van ${x.aantal}):` : "Waar:"}</p>
          <ul class="vb-vb">${x.voorbeelden.map((v) => { const [url, rest] = v.split(" (op "); return `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(vbKort(url))}</a>${rest ? ` <span class="zacht">(op ${esc(vbKort(rest.replace(/\)$/, "")))})</span>` : ""}</li>`; }).join("")}</ul>` : ""}
        <div data-vb-fix="${p.indexOf(x)}"></div></div></details>`;
      paneel.innerHTML = `<div class="kaart">
        <div class="rij" style="gap:18px;align-items:center">${vbScoreRing(L.score)}
          <div class="vul"><h2 style="margin:0"><span class="tag">&gt;_</span>Website-gezondheid</h2>
          <p class="zacht vb-klein" style="margin:4px 0 0">${u.gecontroleerd} pagina's gecontroleerd${u.sitemap_aantal ? ` (van de ${u.sitemap_aantal} in de sitemap)` : ""}${u.links_gecontroleerd ? ` en ${u.links_gecontroleerd} extra links` : ""} · ${datum(L.gemeten)}${d.vorige ? ` · vorige keer ${d.vorige.score}` : ""}</p></div>
          <button class="knop rand klein" data-vb-gz-nu>Opnieuw controleren</button></div>
        <div data-vb-gz-meld></div>
        ${ps?.fout ? `<p class="zacht vb-klein">De snelheidsmeting van Google lukte deze keer niet; bij de volgende controle opnieuw.</p>` : ""}
        ${ps && !ps.fout ? `<div class="vb-tegels" style="margin-top:14px">
          ${vbTegel("Snelheid mobiel", ps.score ?? "–", ps.lcp ? `hoofdinhoud zichtbaar na ${String(ps.lcp).replace(".", ",")} s` : "", "Score van Google (0 tot 100) voor hoe snel je homepage laadt op een telefoon.", "Google")}
          ${ps.echt ? vbTegel("Echte bezoekers", VB_ECHT[ps.echt.oordeel] || "–", "cijfers van Chrome-gebruikers, laatste 28 dagen", "Hoe snel de site aanvoelt voor echte bezoekers met Chrome, gemeten door Google.", "Google") : ""}
          ${ps.seo != null ? vbTegel("SEO-basis", ps.seo, "technische zoekmachinecheck van Google", "Basischeck van Google: titels, omschrijvingen, links en indexeerbaarheid.", "Google") : ""}
          ${ps.toegankelijkheid != null ? vbTegel("Toegankelijkheid", ps.toegankelijkheid, "leesbaarheid en bruikbaarheid", "Hoe goed de site werkt voor iedereen, ook met een beperking.", "Google") : ""}
        </div>
        ${ps.kansen?.length ? `<p style="margin:14px 0 4px"><b>Snelste winst volgens Google:</b></p><ul class="vb-kansen">${ps.kansen.map((k) => `<li>${esc(k.tekst)} <span class="zacht">· tot ${String(k.winst_s).replace(".", ",")} s sneller</span></li>`).join("")}</ul>` : ""}` : ""}
      </div>
      ${groepen.map((g) => { const lijst = p.filter((x) => (x.groep || "Techniek") === g); return lijst.length ? `<div class="kaart"><h2><span class="tag">&gt;_</span>${g} <span class="zacht" style="font-weight:400">(${lijst.length})</span></h2>${lijst.map(probleemHtml).join("")}</div>` : ""; }).join("")}
      ${u.goed?.length ? `<div class="kaart"><h2><span class="tag">&gt;_</span>Dit is in orde</h2><ul class="vb-goed">${u.goed.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}`;
    }
    if (L) vbFixVul(paneel, L.uitslag.problemen || [], klantId);
    paneel.querySelectorAll("[data-vb-gz-nu]").forEach((b) => (b.onclick = async () => {
      b.disabled = true; b.textContent = "Bezig met controleren… (1 tot 2 minuten)";
      try { await vbGzApi("nu", { klant_id: klantId }); teken(await vbGzApi("laatste", { klant_id: klantId })); }
      catch (e) { toonMelding(paneel.querySelector("[data-vb-gz-meld]"), e.message); b.disabled = false; b.textContent = "Opnieuw controleren"; }
    }));
  };
  try { teken(await vbGzApi("laatste", { klant_id: klantId })); }
  catch (e) { paneel.innerHTML = `<div class="kaart"><div class="melding fout">${esc(e.message)}</div></div>`; }
  vbBereikbaarheid(paneel, klantId);
}

// ---------- Website-check: direct een oplossing laten zien, met één knop toepassen ----------
const VB_TEKSTSOORT = ["titel", "titel_lang", "titel_kort", "titel_dubbel", "omschrijving", "omschrijving_lang", "omschrijving_dubbel"];
async function vbFixVul(paneel, problemen, klantId) {
  const vakken = [...paneel.querySelectorAll("[data-vb-fix]")];
  if (!vakken.length) return;
  let vs = null;
  const laadVs = async () => { try { vs = await vbVsApi("lijst", { klant_id: klantId }); } catch { vs = { voorstellen: [], automatisch: false }; } };
  await laadVs();
  const urlsVan = (x) => (x.voorbeelden || []).map((v) => v.split(" (op ")[0]);
  const zelfde = (a, b) => (a || "").replace(/\/$/, "") === (b || "").replace(/\/$/, "");
  vakken.forEach((vak) => {
    const x = problemen[+vak.dataset.vbFix]; if (!x) return;
    const tekst = VB_TEKSTSOORT.includes(x.soort), alt = x.soort === "alt";
    if (tekst || alt) {
      const urls = urlsVan(x);
      const eigen = vs.voorstellen.filter((v) => v.soort === (alt ? "alt" : "titel_omschrijving") && urls.some((u) => zelfde(u, v.pagina)));
      const open = eigen.filter((v) => v.status === "nieuw"), klaar = eigen.filter((v) => v.status !== "nieuw" && v.status !== "geweigerd");
      const toepasKnop = vs.automatisch ? "Toepassen op mijn website" : "Goedkeuren";
      let h = "";
      if (open.length) {
        h += `<p style="margin:10px 0 6px"><b>Ons voorstel</b> <span class="zacht vb-klein">· volgens de regels van Google: titel maximaal 60 tekens, omschrijving maximaal 155. Je kunt het nog aanpassen.</span></p>`;
        h += open.map((v) => alt ? `<div class="vb-fix" data-fixid="${v.id}"><div class="zacht vb-klein">${esc(vbKort(v.pagina))}</div>
            <ul class="vb-vb">${v.voorstel.afbeeldingen.map((a) => `<li><span class="zacht">${esc(a.src.split("/").pop().slice(0, 50))}</span> → <b>${esc(a.alt)}</b></li>`).join("")}</ul>
            <div class="rij" style="margin-top:6px"><button class="knop klein" data-fixja>${toepasKnop}</button><button class="knop rand klein" data-fixnee>Niet doen</button></div><div data-fixmeld></div></div>`
          : `<div class="vb-fix" data-fixid="${v.id}"><div class="zacht vb-klein">${esc(vbKort(v.pagina))}</div>
            <label class="vb-klein">Titel in Google</label><input data-fixt value="${esc(v.voorstel.titel)}"><div class="vb-klein" data-fixtt></div>
            <label class="vb-klein">Omschrijving in Google</label><textarea data-fixo rows="2">${esc(v.voorstel.omschrijving)}</textarea><div class="vb-klein" data-fixot></div>
            <div class="rij" style="margin-top:8px"><button class="knop klein" data-fixja>${toepasKnop}</button><button class="knop rand klein" data-fixnee>Niet doen</button></div><div data-fixmeld></div></div>`).join("");
      }
      if (klaar.length) h += `<p class="vb-op vb-klein" style="margin:8px 0 0">✓ Al aangepakt voor ${klaar.length} ${klaar.length === 1 ? "pagina" : "pagina's"}. Bij de volgende check verdwijnt dit punt.</p>`;
      if (open.length + klaar.length < urls.length) h += `<div class="rij" style="margin-top:10px"><button class="knop klein" data-fixmaak>${open.length ? "Ook voor de andere pagina's" : alt ? "Maak beschrijvingen" : "Maak betere teksten"}</button><span class="zacht vb-klein">Sitehulpje schrijft ze in ongeveer een minuut, volgens de regels van Google.</span></div><div data-fixmeld></div>`;
      if (!vs.automatisch && open.length) h += `<p class="zacht vb-klein" style="margin:6px 0 0">Na goedkeuren zet Jan het op je website.</p>`;
      vak.innerHTML = h;
      vak.querySelectorAll("[data-fixid]").forEach((blok) => {
        const v = vs.voorstellen.find((y) => String(y.id) === blok.dataset.fixid);
        const ti = blok.querySelector("[data-fixt]"), om = blok.querySelector("[data-fixo]");
        const tel = () => { if (!ti) return; blok.querySelector("[data-fixtt]").innerHTML = vbTeller(ti.value.length, 60); blok.querySelector("[data-fixot]").innerHTML = vbTeller(om.value.length, 155); };
        if (ti) { ti.oninput = om.oninput = tel; tel(); }
        const meld = (t, s = "fout") => toonMelding(blok.querySelector("[data-fixmeld]"), t, s);
        blok.querySelector("[data-fixja]").onclick = async (e) => {
          if (ti && (ti.value.length > 60 || om.value.length > 155)) return meld("Maak de tekst iets korter: Google kapt hem anders af.");
          e.target.disabled = true; e.target.textContent = "Bezig…";
          try { const r = await vbVsApi("goedkeuren", { klant_id: klantId, id: v.id, voorstel: ti ? { titel: ti.value, omschrijving: om.value } : undefined });
            blok.innerHTML = `<div class="melding ok">${r.status === "handmatig" ? "Goedgekeurd. Jan zet dit op je website." : r.status === "uitgevoerd" ? "Klaar! Het staat op je website. Google neemt het binnen een paar dagen over." : "Goedgekeurd. Sitehulpje zet het nu op je website."}</div>`; }
          catch (err) { meld(err.message); e.target.disabled = false; e.target.textContent = toepasKnop; }
        };
        blok.querySelector("[data-fixnee]").onclick = async () => { try { await vbVsApi("weiger", { klant_id: klantId, id: v.id }); blok.remove(); } catch (err) { meld(err.message); } };
      });
      const maak = vak.querySelector("[data-fixmaak]");
      if (maak) maak.onclick = async () => {
        maak.disabled = true; maak.textContent = "Bezig met schrijven… (± 1 minuut)";
        try { await vbVsApi("maak", { klant_id: klantId }); await laadVs(); vbFixVul(paneel, problemen, klantId); }
        catch (e) { toonMelding(vak.querySelector("[data-fixmeld]"), e.message); maak.disabled = false; maak.textContent = "Probeer opnieuw"; }
      };
    } else if (!IS_BEHEER && typeof api === "function") {
      vak.innerHTML = `<div class="rij" style="margin-top:10px"><button class="knop klein" data-fixverzoek>Laat Sitehulpje dit oplossen</button><span class="zacht vb-klein">Eén klik, wij regelen de rest. Je ziet het bij Iets laten aanpassen.</span></div><div data-fixmeld></div>`;
      vak.querySelector("[data-fixverzoek]").onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = "Versturen…";
        const urls = urlsVan(x).slice(0, 10);
        try { await api("verzoek_nieuw", { tekst: `Uit de website-check: ${x.tekst}\n${x.oplossing ? "Oplossing: " + x.oplossing + "\n" : ""}${urls.length ? "Pagina's:\n" + urls.map((u) => "- " + u).join("\n") : ""}`, fotos: [] });
          vak.innerHTML = `<div class="melding ok">Verstuurd. Sitehulpje gaat ermee aan de slag; je ziet de voortgang bij Iets laten aanpassen.</div>`; }
        catch (err) { toonMelding(vak.querySelector("[data-fixmeld]"), err.message); e.target.disabled = false; e.target.textContent = "Laat Sitehulpje dit oplossen"; }
      };
    } else vak.innerHTML = "";
  });
}

async function vbBereikbaarheid(paneel, klantId) {
  try {
    const r = await fetch(VB_API.replace(/vindbaarheid$/, "vb-waakhond"), { method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": sessie() }, body: JSON.stringify({ actie: "bereikbaarheid", klant_id: klantId }) });
    const d = await r.json(); if (!r.ok || !d.metingen) return;
    const kaart = document.createElement("div"); kaart.className = "kaart";
    const dagen = Math.max(1, Math.round((Date.now() - new Date(d.sinds).getTime()) / 86400000));
    kaart.innerHTML = `<h2><span class="tag">&gt;_</span>Bereikbaarheid</h2>
      <div class="vb-tegels">${vbTegel("Online", String(d.procent).replace(".", ",") + "%", `laatste ${Math.min(30, dagen)} dag${dagen > 1 ? "en" : ""}, elk half uur gecontroleerd`, "Hoe vaak je website bereikbaar was als we keken.", "Gemeten")}
      ${d.ms ? vbTegel("Reactietijd", (d.ms / 1000).toFixed(1).replace(".", ",") + " s", "gemiddeld, homepage", "Hoe snel je server antwoordt. Onder 1 seconde is goed.", "Gemeten") : ""}</div>
      ${d.storingen.length ? `<p class="zacht vb-klein" style="margin-bottom:0">Niet bereikbaar op: ${d.storingen.map((x) => datum(x.tijd)).join(", ")}</p>` : `<p class="zacht vb-klein" style="margin-bottom:0">Geen storingen gezien.</p>`}`;
    paneel.appendChild(kaart);
  } catch { /* niet erg */ }
}

// ---------- "Nog geen Google-account?" – zo simpel mogelijk voor de klant ----------
function vbGeenGoogle(knop, klantId) {
  if (!knop || knop.parentElement.querySelector(".vb-geengoogle")) return;
  const w = document.createElement("div"); w.className = "vb-geengoogle"; w.style.cssText = "margin-top:10px;font-size:14px";
  w.innerHTML = `<button type="button" class="link" style="background:none;border:0;padding:0;color:var(--accent);cursor:pointer;font:inherit;text-decoration:underline">Nog geen Google-account, of weet je het niet zeker?</button>
    <div hidden style="margin-top:10px;padding:14px;border:1px solid var(--lijn);border-radius:14px;background:var(--bg2)">
      <p style="margin:0 0 8px"><b>Geen probleem, het is gratis en wij doen de rest.</b></p>
      <ol style="margin:0 0 12px;padding-left:20px;line-height:1.6">
        <li>Maak een gratis Google-account. Gebruik gewoon je eigen mailadres, je hebt geen Gmail nodig.<br>
          <a class="knop rand klein" style="margin-top:6px" href="https://accounts.google.com/signup/v2/createaccount?flowName=GlifWebSignIn&flowEntry=SignUp" target="_blank" rel="noopener">Gratis Google-account maken</a>
          <span class="zacht" style="display:block;margin-top:4px">Kies daar "Mijn huidige e-mailadres gebruiken".</span></li>
        <li>Kom terug en klik op <b>Google koppelen</b>.</li>
        <li>Wij zetten de rest voor je klaar: Search Console en je Google-bedrijfsprofiel (Google Maps). Je krijgt alleen nog een bericht als Google iets van jou nodig heeft, zoals een code die per post komt.</li>
      </ol>
      <button type="button" class="knop klein" data-regel>Ja, regel het voor mij</button> <span class="zacht" data-regelmeld></span>
    </div>`;
  knop.insertAdjacentElement("afterend", w);
  w.querySelector("button.link").onclick = () => { const v = w.querySelector("div"); v.hidden = !v.hidden; };
  const b = w.querySelector("[data-regel]");
  b.onclick = async () => {
    b.disabled = true; b.textContent = "Even geduld…";
    try {
      await api("verzoek_nieuw", { tekst: "Ik heb nog geen (complete) Google-omgeving. Graag voor mij klaarzetten:\n- Search Console voor mijn website (bevestigen via de website)\n- Mijn Google-bedrijfsprofiel (Google Maps) invullen en de bevestiging aanvragen\nLaat me weten wat ik zelf moet doen (bijvoorbeeld een code invullen of een uitnodiging accepteren).", fotos: [] });
      b.textContent = "Geregeld ✓"; w.querySelector("[data-regelmeld]").textContent = "We gaan ermee aan de slag. Je ziet het verzoek bij \"Iets laten aanpassen\".";
    } catch (e) { b.disabled = false; b.textContent = "Ja, regel het voor mij"; w.querySelector("[data-regelmeld]").textContent = e.message || "Dat lukte niet, probeer het nog eens."; }
  };
}
function vbKnoppen(el, klantId, d) {
  if (!(typeof IS_BEHEER !== "undefined" && IS_BEHEER)) el.querySelectorAll('[data-vb="koppel"]').forEach((b) => vbGeenGoogle(b, klantId));
  const fout = (t) => el.querySelectorAll("[data-vb-fout]").forEach((f) => toonMelding(f, t));
  el.querySelectorAll('[data-vb="koppel"]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await vbApi("google_start", { klant_id: klantId }); location.href = r.url; }
    catch (e) { fout(e.message); b.disabled = false; }
  }));
  el.querySelectorAll('[data-vb="kies"]').forEach((b) => (b.onclick = () => vbKiezer(el, klantId)));
  el.querySelectorAll('[data-vb="ga4"]').forEach((b) => (b.onclick = () => vbGa4(el, klantId)));
  el.querySelectorAll('[data-vb="koppelga4"]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await vbApi("google_start", { klant_id: klantId, ga4: true }); location.href = r.url; }
    catch (e) { fout(e.message); b.disabled = false; }
  }));
  if (new URLSearchParams(location.search).get("google") === "ga4" && el.querySelector('[data-vb="ga4"]')) vbGa4(el, klantId);
  el.querySelectorAll('[data-vb="ontkoppel"]').forEach((b) => (b.onclick = async () => {
    if (!confirm("Koppeling met Google stoppen? Je dashboard toont dan geen nieuwe cijfers meer.")) return;
    try { await vbApi("ontkoppel", { klant_id: klantId }); vbToon(el, klantId); } catch (e) { fout(e.message); }
  }));
}

async function vbKiezer(el, klantId) {
  const houders = el.querySelectorAll("[data-vb-kies]");
  const houder = [...houders].find((h) => h.offsetParent !== null) || houders[0];
  if (!houder) return;
  houder.innerHTML = `<p class="zacht">Even kijken wat er bij dit Google-account hoort…</p>`;
  try {
    const [b, s] = await Promise.all([vbApi("bronnen", { klant_id: klantId }), vbApi("status", { klant_id: klantId })]);
    const k = s.koppeling || {};
    houder.innerHTML = `<label>Website in Search Console</label>
      <select data-vb-gsc><option value="">– geen –</option>${b.gsc.map((x) => `<option value="${esc(x.id)}" ${x.id === k.gsc_site ? "selected" : ""}>${esc(x.naam)}</option>`).join("")}</select>
      ${!b.gsc.length ? `<p class="zacht vb-klein">Dit Google-account heeft geen websites in Search Console. Koppel het account dat de website beheert.</p>` : ""}
      <label>Gegevens in Google Analytics</label>
      <select data-vb-ga4><option value="">– geen –</option>${b.ga4.map((x) => `<option value="${esc(x.id)}" ${x.id === k.ga4_property ? "selected" : ""}>${esc(x.naam)}</option>`).join("")}</select>
      <div class="rij" style="margin-top:10px"><button class="knop" data-vb-opslaan>Opslaan en cijfers ophalen</button></div>
      ${b.gbp?.length ? `<label style="margin-top:14px">Google Bedrijfsprofiel</label>
      <select data-vb-gbp><option value="">– geen –</option>${b.gbp.map((x) => `<option value="${esc(x.id)}" ${x.id === k.gbp_locatie ? "selected" : ""}>${esc(x.naam)}</option>`).join("")}</select>
      <div class="rij" style="margin-top:10px"><button class="knop rand" data-vb-gbpopslaan>Bedrijfsprofiel opslaan</button></div>` :
      `<p class="zacht vb-klein" style="margin-top:12px">${k.gbp_toestemming ? "Bij dit Google-account vonden we geen Bedrijfsprofiel." : "Wil je ook de cijfers van je Google Bedrijfsprofiel zien? Koppel Google dan opnieuw en vink ook het Bedrijfsprofiel aan."}</p>`}`;
    const gbpKnop = houder.querySelector("[data-vb-gbpopslaan]");
    if (gbpKnop) gbpKnop.onclick = async () => {
      gbpKnop.disabled = true; gbpKnop.textContent = "Ophalen…";
      try {
        const r = await vbApi("gbp_kies", { klant_id: klantId, gbp: houder.querySelector("[data-vb-gbp]").value });
        if (r.fout) houder.insertAdjacentHTML("beforeend", `<div class="melding let">Opgeslagen, maar nog niet alles kon worden opgehaald: ${esc(r.fout)}</div>`);
        else vbToon(el, klantId);
      } catch (err) { houder.insertAdjacentHTML("beforeend", `<div class="melding fout">${esc(err.message)}</div>`); }
      gbpKnop.disabled = false; gbpKnop.textContent = "Bedrijfsprofiel opslaan";
    };
    houder.querySelector("[data-vb-opslaan]").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Cijfers ophalen… (kan een minuut duren)";
      try {
        await vbApi("bron_kies", { klant_id: klantId, gsc: houder.querySelector("[data-vb-gsc]").value, ga4: houder.querySelector("[data-vb-ga4]").value });
        history.replaceState(null, "", location.pathname + location.hash);
        vbToon(el, klantId);
      } catch (err) { houder.insertAdjacentHTML("beforeend", `<div class="melding fout">${esc(err.message)}</div>`); e.target.disabled = false; e.target.textContent = "Opslaan en cijfers ophalen"; }
    };
  } catch (e) { houder.innerHTML = `<div class="melding fout">${esc(e.message)}</div>`; }
}

// ---------- Analytics voor de klant aanmaken ----------
async function vbGa4(el, klantId) {
  const houders = el.querySelectorAll("[data-vb-kies]");
  const houder = [...houders].find((h) => h.offsetParent !== null) || houders[0];
  if (!houder) return;
  houder.innerHTML = `<p class="zacht">Even kijken in je Google Analytics…</p>`;
  const fout = (t) => { houder.innerHTML = `<div class="melding fout">${esc(t)}</div>`; };
  let o;
  try { o = await vbApi("ga4_opties", { klant_id: klantId }); } catch (e) { return fout(e.message); }
  if (!o.toestemming) {
    houder.innerHTML = `<div class="melding let"><b>Analytics voor je instellen</b><br>Sitehulpje maakt in jouw eigen Google Analytics een meetplek aan voor je website. Daarvoor vraagt Google je één keer om toestemming om Analytics te <b>bewerken</b>. Wij maken alleen de meetplek voor jouw website aan en wijzigen of verwijderen verder niets.</div>
      <div class="rij"><button class="knop" data-vb-ga4-ok>Toestemming geven bij Google</button></div>`;
    houder.querySelector("[data-vb-ga4-ok]").onclick = async (e) => {
      e.target.disabled = true;
      try { const r = await vbApi("google_start", { klant_id: klantId, ga4: true }); location.href = r.url; } catch (err) { fout(err.message); }
    };
    return;
  }
  const site = esc((o.site || "").replace(/^https?:\/\//, "").replace(/\/$/, ""));
  houder.innerHTML = `<label>In welk Analytics-account maken we de meetplek voor ${site} aan?</label>
    <select data-vb-ga4-acc>${o.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === o.voorstel ? "selected" : ""}>${esc(a.naam)}</option>`).join("")}
      <option value="nieuw" ${!o.voorstel ? "selected" : ""}>Nieuw account: ${esc(o.naam || site)}</option></select>
    <p class="zacht vb-klein">Tip: kies een account dat bij jouw bedrijf hoort. Bij een nieuw account vraagt Google je eerst de voorwaarden te accepteren.</p>
    <div class="rij"><button class="knop" data-vb-ga4-maak>Analytics aanmaken</button></div>`;
  houder.querySelector("[data-vb-ga4-maak]").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Bezig…";
    try {
      const r = await vbApi("ga4_aanmaken", { klant_id: klantId, account: houder.querySelector("[data-vb-ga4-acc]").value });
      if (r.voorwaarden) {
        try { sessionStorage.setItem("vb_ga4_terug", location.pathname + "?" + new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), google: "ga4" }) + location.hash); } catch { /* geen opslag */ }
        location.href = r.voorwaarden; return;
      }
      history.replaceState(null, "", location.pathname + location.hash);
      await vbToon(el, klantId);
      const m = el.querySelector("[data-vb-kies]");
      if (m) m.innerHTML = `<div class="melding ok">Klaar! ${r.bestond ? "We vonden al een Analytics-meetplek voor je website en hebben die gekoppeld" : "Analytics is aangemaakt voor je website"}${r.meet_id ? ` (meet-ID <b>${esc(r.meet_id)}</b>)` : ""}. ${r.bestond ? "" : "De meetcode moet nog op je website; Sitehulpje regelt dat. Daarna verschijnen hier vanzelf je bezoekerscijfers."}</div>`;
    } catch (err) { fout(err.message); }
  };
}

// ---------- Verbetervoorstellen ----------
async function vbVsApi(actie, data = {}) {
  const r = await fetch(VB_API.replace(/vindbaarheid$/, "vb-voorstellen"), { method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": sessie() }, body: JSON.stringify({ actie, ...data }) })
    .catch(() => { throw new Error("Geen verbinding. Controleer je internet en probeer het opnieuw."); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.fout || "Er ging iets mis.");
  return d;
}
const VB_VS_SOORT = { titel_omschrijving: "Titel en omschrijving in Google", alt: "Beschrijvingen bij afbeeldingen", llms: "Uitleg voor AI-diensten (llms.txt)", schema: "Bedrijfsgegevens voor Google (LocalBusiness)" };
const VB_VS_STATUS = { nieuw: ["Wacht op jou", "vb-let"], goedgekeurd: ["Wordt uitgevoerd", "vb-op"], uitgevoerd: ["Uitgevoerd", "vb-op"], handmatig: ["Goedgekeurd · Jan zet het erop", "vb-op"], geweigerd: ["Niet gedaan", "vb-gelijk"] };
function vbTeller(n, max) { return `<span class="${n > max ? "vb-af" : "vb-gelijk"} vb-klein">${n} tekens</span>`; }

const VB_VOLGEND = { basis: ["Plus", 30, 179, "plus"], plus: ["Pro", 75, 249, "pro"] };
async function vbVoorstellen(houder, klantId, el) {
  if (!houder) return;
  let d;
  try { d = await vbVsApi("lijst", { klant_id: klantId }); } catch (e) { houder.innerHTML = ""; return; }
  const open = d.voorstellen.filter((v) => v.status === "nieuw");
  const tab = el?.querySelector('.vb-tab[data-vb-tab="voorstellen"]');
  if (tab) tab.textContent = open.length ? `Voorstellen (${open.length})` : "Voorstellen";
  const kaart = (v) => {
    const [st, kl] = VB_VS_STATUS[v.status] || [v.status, ""];
    const pad = (v.pagina || "").replace(/^https?:\/\/[^/]+/, "") || "/";
    let inhoud = "";
    if (v.soort === "titel_omschrijving") {
      inhoud = `<div class="vb-vs-grid"><div><div class="vb-vs-kop">Nu</div>
          <div class="vb-vs-titel">${esc(v.huidig.titel || "(geen titel)")}</div>${vbTeller((v.huidig.titel || "").length, 60)}
          <div class="vb-vs-oms">${esc(v.huidig.omschrijving || "(geen omschrijving)")}</div>${vbTeller((v.huidig.omschrijving || "").length, 155)}</div>
        <div><div class="vb-vs-kop">Voorstel</div>
          ${v.status === "nieuw" ? `<input data-vs-titel value="${esc(v.voorstel.titel)}"><textarea data-vs-oms rows="3">${esc(v.voorstel.omschrijving)}</textarea>`
            : `<div class="vb-vs-titel">${esc(v.voorstel.titel)}</div><div class="vb-vs-oms">${esc(v.voorstel.omschrijving)}</div>`}
          <div data-vs-tel class="vb-klein"></div></div></div>`;
    } else if (v.soort === "alt") {
      inhoud = `<ul class="vb-vb">${v.voorstel.afbeeldingen.map((a) => `<li><span class="zacht">${esc(a.src.split("/").pop().slice(0, 60))}</span> → <b>${esc(a.alt)}</b></li>`).join("")}</ul>`;
    } else if (v.soort === "llms") {
      inhoud = `<pre class="vb-pre">${esc(v.voorstel.tekst)}</pre>`;
    } else if (v.soort === "schema") {
      inhoud = `<pre class="vb-pre">${esc(JSON.stringify(v.voorstel.jsonld, null, 2))}</pre>`;
    }
    const handmatig = v.soort === "llms" || v.soort === "schema" || !d.automatisch;
    return `<div class="vb-voorstel" data-vs="${v.id}">
      <div class="rij" style="gap:8px"><b class="vul">${VB_VS_SOORT[v.soort] || v.soort}</b><span class="${kl} vb-klein">${st}${v.verzoek_nr ? ` · verzoek #${v.verzoek_nr}` : ""}</span></div>
      <div class="zacht vb-klein" style="margin:2px 0 8px"><a href="${esc(v.pagina)}" target="_blank" rel="noopener">${esc(pad)}</a>${v.uitleg ? " · " + esc(v.uitleg) : ""}</div>
      ${inhoud}
      ${v.status === "nieuw" ? `<div class="rij" style="margin-top:10px"><button class="knop klein" data-vs-ja>${handmatig ? "Goedkeuren" : "Goedkeuren en uitvoeren"}</button><button class="knop rand klein" data-vs-nee>Niet doen</button>
        ${handmatig && v.soort !== "titel_omschrijving" ? `<button class="knop rand klein" data-vs-kopie>Kopiëren</button>` : ""}</div>` : ""}
      ${v.status === "handmatig" ? `<div class="rij" style="margin-top:10px"><button class="knop rand klein" data-vs-kopie>Kopiëren</button>${IS_BEHEER ? `<button class="knop rand klein" data-vs-klaar>Staat erop</button>` : ""}</div>` : ""}
      <div data-vs-meld></div></div>`;
  };
  const isLopend = (v) => ["nieuw", "goedgekeurd", "handmatig"].includes(v.status);
  const lopend = d.voorstellen.filter(isLopend), afgerond = d.voorstellen.filter((v) => !isLopend(v));
  houder.innerHTML = `<div class="kaart"><div class="rij"><h2 class="vul" style="margin:0"><span class="tag">&gt;_</span>Verbetervoorstellen</h2>
      <button class="knop ${d.voorstellen.length ? "rand " : ""}klein" data-vs-maak>${d.voorstellen.length ? "Nieuwe voorstellen maken" : "Maak voorstellen"}</button></div>
    <p class="zacht vb-klein" style="margin:6px 0 0">Sitehulpje stelt betere teksten voor op basis van de website-check. Er verandert niets op je site zonder jouw goedkeuring.${d.automatisch ? " Na goedkeuren voert Sitehulpje het meteen uit; terugdraaien kan altijd via Verzoeken." : ""}</p>
    <p class="zacht vb-klein" style="margin:4px 0 0">Deze maand: ${d.deze_maand} van ${d.per_maand} pagina's (pakket ${vbPakket(d.pakket).naam}).</p>
    ${!IS_BEHEER && d.deze_maand >= d.per_maand && VB_VOLGEND[d.pakket] ? `<div class="vb-aanbod" style="margin-top:10px;padding:12px 14px;border-radius:14px;border:1px solid var(--lijn);background:var(--bg2)">
      <b>Je maand zit vol.</b> <span class="vb-klein">Met ${VB_VOLGEND[d.pakket][0]} verbetert Sitehulpje elke maand ${VB_VOLGEND[d.pakket][1]} pagina's in plaats van ${d.per_maand}, voor €${VB_VOLGEND[d.pakket][2]} per maand. Het gaat meteen in.</span>
      <div style="margin-top:8px"><button class="knop klein" data-vs-upgrade="${VB_VOLGEND[d.pakket][3]}">Overstappen naar ${VB_VOLGEND[d.pakket][0]}</button></div><div data-vs-upmeld></div></div>` : ""}
    <div data-vs-maakmeld></div></div>
    ${lopend.length ? `<div class="kaart">${lopend.map(kaart).join("")}</div>` : ""}
    ${afgerond.length ? `<details class="kaart"><summary style="cursor:pointer"><b>Afgerond (${afgerond.length})</b> <span class="zacht vb-klein">· een aangepaste pagina laten we ${Math.round((d.rust_dagen || 56) / 7)} weken met rust, zodat Google de nieuwe tekst kan oppakken</span></summary>${afgerond.map(kaart).join("")}</details>` : ""}`;

  const up = houder.querySelector("[data-vs-upgrade]");
  if (up) up.onclick = async () => {
    up.disabled = true;
    try { await vbfApi("wissel", { pakket: up.dataset.vsUpgrade }); toonMelding(houder.querySelector("[data-vs-upmeld]"), "Gelukt! Je pakket is aangepast. Je kunt meteen nieuwe voorstellen maken.", "ok"); setTimeout(() => vbVoorstellen(houder, klantId, el), 1800); }
    catch (e) { toonMelding(houder.querySelector("[data-vs-upmeld]"), e.message); up.disabled = false; }
  };
  const tekst = (v) => v.soort === "llms" ? v.voorstel.tekst : v.soort === "schema" ? `<script type="application/ld+json">\n${JSON.stringify(v.voorstel.jsonld, null, 2)}\n</script>` :
    v.soort === "alt" ? v.voorstel.afbeeldingen.map((a) => `${a.src}\t${a.alt}`).join("\n") : `Titel: ${v.voorstel.titel}\nOmschrijving: ${v.voorstel.omschrijving}`;
  houder.querySelectorAll("[data-vs]").forEach((blok) => {
    const v = d.voorstellen.find((x) => String(x.id) === blok.dataset.vs);
    const meld = (t, s = "fout") => toonMelding(blok.querySelector("[data-vs-meld]"), t, s);
    const ti = blok.querySelector("[data-vs-titel]"), om = blok.querySelector("[data-vs-oms]"), tel = blok.querySelector("[data-vs-tel]");
    const telBij = () => { if (tel) tel.innerHTML = `Titel ${vbTeller(ti.value.length, 60)} · omschrijving ${vbTeller(om.value.length, 155)}`; };
    if (ti) { ti.oninput = om.oninput = telBij; telBij(); }
    const ja = blok.querySelector("[data-vs-ja]");
    if (ja) ja.onclick = async () => {
      ja.disabled = true; ja.textContent = "Bezig…";
      try {
        const r = await vbVsApi("goedkeuren", { klant_id: klantId, id: v.id, voorstel: ti ? { titel: ti.value, omschrijving: om.value } : undefined });
        meld(r.status === "handmatig" ? "Goedgekeurd. Jan zet dit op de site." : "Goedgekeurd. Sitehulpje voert het nu uit; je ziet het ook bij Verzoeken.", "ok");
        setTimeout(() => vbVoorstellen(houder, klantId, el), 1500);
      } catch (e) { meld(e.message); ja.disabled = false; ja.textContent = "Goedkeuren"; }
    };
    const nee = blok.querySelector("[data-vs-nee]");
    if (nee) nee.onclick = async () => { try { await vbVsApi("weiger", { klant_id: klantId, id: v.id }); vbVoorstellen(houder, klantId, el); } catch (e) { meld(e.message); } };
    const kopie = blok.querySelector("[data-vs-kopie]");
    if (kopie) kopie.onclick = async () => { try { await navigator.clipboard.writeText(tekst(v)); meld("Gekopieerd.", "ok"); } catch { meld("Kopiëren lukte niet; selecteer de tekst zelf."); } };
    const klaar = blok.querySelector("[data-vs-klaar]");
    if (klaar) klaar.onclick = async () => { try { await vbVsApi("klaar", { klant_id: klantId, id: v.id }); vbVoorstellen(houder, klantId, el); } catch (e) { meld(e.message); } };
  });
  const maak = houder.querySelector("[data-vs-maak]");
  maak.onclick = async () => {
    maak.disabled = true; maak.textContent = "Voorstellen maken… (± 1 minuut)";
    try { const r = await vbVsApi("maak", { klant_id: klantId }); toonMelding(houder.querySelector("[data-vs-maakmeld]"), r.vol ? "Je hebt het aantal pagina's voor deze maand bereikt. Volgende maand komen er nieuwe voorstellen." : r.nieuw ? `${r.nieuw} nieuwe voorstellen.` : (r.rust ? `Geen nieuwe voorstellen. ${r.rust === 1 ? "1 pagina is" : r.rust + " pagina's zijn"} net aangepast; die laten we even met rust zodat Google de nieuwe tekst kan oppakken.` : "Geen nieuwe voorstellen: alles wat de check vond, staat al in de lijst of is in orde."), "ok"); setTimeout(() => vbVoorstellen(houder, klantId, el), 1200); }
    catch (e) { toonMelding(houder.querySelector("[data-vs-maakmeld]"), e.message); maak.disabled = false; maak.textContent = "Maak voorstellen"; }
  };
}
