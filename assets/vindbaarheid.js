// Sitehulpje Vindbaarheid – dashboard (klantpagina en beheer gebruiken dit allebei)
const VB_API = "https://eiejxciyfcynppldonaw.supabase.co/functions/v1/vindbaarheid";

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
async function vbToon(el, klantId) {
  el.innerHTML = `<div class="kaart"><p class="zacht">Laden…</p></div>`;
  let d;
  try { d = await vbApi("dashboard", { klant_id: klantId }); }
  catch (e) { el.innerHTML = `<div class="kaart"><div class="melding fout">${esc(e.message)}</div></div>`; return; }
  const k = d.koppeling;
  const params = new URLSearchParams(location.search);
  let melding = "";
  if (params.get("google") === "ok") melding = `<div class="melding ok">Google is gekoppeld. De cijfers staan hieronder; ze worden elke nacht bijgewerkt.</div>`;
  if (params.get("google") === "kies") melding = `<div class="melding let">Google is gekoppeld. Kies hieronder welke website en welke Analytics-gegevens bij jouw bedrijf horen.</div>`;

  const koppelKaart = `<div class="kaart vb-koppel">
    <h2><span class="tag">&gt;_</span>Koppelingen</h2>
    <ul class="vb-bronnen">
      <li><span class="vb-stip ${k?.gsc_site && k.status !== "ingetrokken" ? "aan" : ""}"></span>Google Search Console${k?.gsc_site ? ` · <span class="zacht">${esc(k.gsc_site.replace(/^sc-domain:/, ""))}</span>` : ""}</li>
      <li><span class="vb-stip ${k?.ga4_property && k.status !== "ingetrokken" ? "aan" : ""}"></span>Google Analytics${k?.ga4_naam ? ` · <span class="zacht">${esc(k.ga4_naam)}</span>` : ""}</li>
      <li><span class="vb-stip later"></span>Google Bedrijfsprofiel · <span class="zacht">binnenkort</span></li>
      <li><span class="vb-stip later"></span>Bing · <span class="zacht">binnenkort</span></li>
    </ul>
    ${k ? `<p class="zacht vb-klein">Gekoppeld met ${esc(k.google_email || "je Google-account")}${k.laatst_opgehaald ? ` · bijgewerkt ${datum(k.laatst_opgehaald)}` : ""}.
      Wij kunnen alleen meekijken, niets aanpassen. Je kunt de koppeling altijd stoppen.</p>` :
      `<p class="zacht">Koppel je Google-account, dan zie je hier hoe vaak je gevonden wordt. Je logt in bij Google zelf; wij krijgen geen wachtwoord en kunnen alleen meekijken.</p>`}
    ${k?.fout ? `<div class="melding ${k.status === "ingetrokken" ? "fout" : "let"}">${esc(k.status === "ingetrokken" ? k.fout : "Niet alles kon worden opgehaald. Jan is op de hoogte.")}</div>` : ""}
    <div class="rij">
      <button class="knop ${k ? "rand klein" : ""}" data-vb="koppel">${k ? (k.status === "ingetrokken" ? "Google opnieuw koppelen" : "Ander Google-account koppelen") : "Koppel Google"}</button>
      ${k ? `<button class="knop rand klein" data-vb="kies">Website kiezen</button><button class="knop rand klein" data-vb="ontkoppel">Koppeling stoppen</button>` : ""}
    </div>
    <div data-vb-kies></div>
    <div class="verborgen" data-vb-fout></div>
  </div>`;

  if (!k || (!d.gsc.length && !d.ga4.length)) {
    el.innerHTML = melding + koppelKaart + (k ? `<div class="kaart"><p class="zacht">Er zijn nog geen cijfers uit Google. ${!k.gsc_site && !k.ga4_property ? "Kies eerst hierboven welke website bij jouw bedrijf hoort." : "Ze worden vannacht opgehaald."}</p></div>` : "") +
      `<div data-vb-gz-kort class="verborgen"></div><div data-vb-gz></div>`;
    vbKnoppen(el, klantId, d);
    if (k && !k.gsc_site && !k.ga4_property) vbKiezer(el, klantId);
    vbGezondheid(el, klantId, () => {});
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
    <button class="vb-tab" data-vb-tab="gezondheid">Website-gezondheid</button>
    <button class="vb-tab" data-vb-tab="rapporten">Rapporten</button>
    <button class="vb-tab" data-vb-tab="koppelingen">Koppelingen</button>
  </div>
  <div data-vb-paneel="overzicht">
    <div class="kaart">
      <h2><span class="tag">&gt;_</span>Laatste 28 dagen in één oogopslag</h2>
      <p class="zacht vb-klein" style="margin-top:-4px">${vbDatum(start)} t/m ${vbDatum(eind, { day: "numeric", month: "short", year: "numeric" })}${zin ? ` · ${zin}` : ""}</p>
      <div class="vb-tegels">
        ${d.gsc.length ? vbTegel("Klikken uit Google", vbGetal(kl), v(kl, klV), VB_UITLEG.klikken) : ""}
        ${d.gsc.length ? vbTegel("Vertoningen in Google", vbGetal(vt), v(vt, vtV), VB_UITLEG.vertoningen) : ""}
        ${d.ga4.length ? vbTegel("Bezoeken via Google", vbGetal(og), v(og, ogV), VB_UITLEG.organisch) : ""}
        ${d.ga4.length ? vbTegel("Acties op je site", vbGetal(ac), v(ac, acV), VB_UITLEG.acties) : ""}
      </div>
    </div>
    ${d.gsc.length ? `<div class="kaart"><h2><span class="tag">&gt;_</span>Klikken uit Google per week</h2><div data-vb-grafiek></div>
      <p class="zacht vb-klein">Bron: Google Search Console. De laatste twee dagen kunnen nog iets veranderen.</p></div>` : ""}
    <div data-vb-gz-kort></div>
    ${d.zoekwoorden.length ? `<div class="kaart"><h2><span class="tag">&gt;_</span>Beste zoekwoorden</h2>${vbTabel(d.zoekwoorden, "zoekwoord", 10)}
      <div class="rij" style="margin-top:10px"><button class="knop rand klein" data-vb-naar="zoekwoorden">Alle zoekwoorden</button></div>
      <p class="zacht vb-klein">${VB_UITLEG.positie} "Verschil" vergelijkt met de 28 dagen ervoor.</p></div>` : ""}
  </div>
  <div data-vb-paneel="zoekwoorden" class="verborgen"><div class="kaart">
    <h2><span class="tag">&gt;_</span>Alle zoekwoorden</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">Waarop mensen zochten toen jouw site in Google verscheen, laatste 28 dagen. Google toont om privacyredenen niet elke zoekopdracht.</p>
    <input type="search" placeholder="Zoek een woord…" data-vb-filter="zoekwoord" style="margin-bottom:10px">
    <div data-vb-lijst="zoekwoord">${vbTabel(d.zoekwoorden, "zoekwoord", 200)}</div>
  </div></div>
  <div data-vb-paneel="paginas" class="verborgen"><div class="kaart">
    <h2><span class="tag">&gt;_</span>Pagina's in Google</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">Welke pagina's van je site het vaakst in Google verschenen, laatste 28 dagen.</p>
    <input type="search" placeholder="Zoek een pagina…" data-vb-filter="pagina" style="margin-bottom:10px">
    <div data-vb-lijst="pagina">${vbTabel(d.paginas, "pagina", 200)}</div>
  </div></div>
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
    el.querySelectorAll(".vb-tab").forEach((b) => b.classList.toggle("aan", b.dataset.vbTab === t));
    el.querySelectorAll("[data-vb-paneel]").forEach((p) => p.classList.toggle("verborgen", p.dataset.vbPaneel !== t));
  };
  el.querySelectorAll(".vb-tab").forEach((b) => (b.onclick = () => toonTab(b.dataset.vbTab)));
  el.querySelectorAll("[data-vb-naar]").forEach((b) => (b.onclick = () => { toonTab(b.dataset.vbNaar); el.scrollIntoView({ behavior: "smooth" }); }));
  el.querySelectorAll("[data-vb-filter]").forEach((inp) => {
    const soort = inp.dataset.vbFilter, bron = soort === "pagina" ? d.paginas : d.zoekwoorden;
    inp.oninput = () => {
      const q = inp.value.trim().toLowerCase();
      el.querySelector(`[data-vb-lijst="${soort}"]`).innerHTML = vbTabel(q ? bron.filter((r) => r.sleutel.toLowerCase().includes(q)) : bron, soort, 200);
    };
  });
  if (params.get("google") === "kies") { toonTab("koppelingen"); vbKiezer(el, klantId); }
  vbKnoppen(el, klantId, d);
  vbGezondheid(el, klantId, toonTab);
  vbRapporten(el.querySelector("[data-vb-rap]"), klantId);
  vbBing(el, klantId, eind);
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
        <p class="zacht vb-klein" style="margin:6px 0 0">Wil je dat Sitehulpje dit oplost? Stuur een verzoek, dan pakken we het op.</p></div></details>`;
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

function vbKnoppen(el, klantId, d) {
  const fout = (t) => el.querySelectorAll("[data-vb-fout]").forEach((f) => toonMelding(f, t));
  el.querySelectorAll('[data-vb="koppel"]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await vbApi("google_start", { klant_id: klantId }); location.href = r.url; }
    catch (e) { fout(e.message); b.disabled = false; }
  }));
  el.querySelectorAll('[data-vb="kies"]').forEach((b) => (b.onclick = () => vbKiezer(el, klantId)));
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
      <div class="rij" style="margin-top:10px"><button class="knop" data-vb-opslaan>Opslaan en cijfers ophalen</button></div>`;
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
