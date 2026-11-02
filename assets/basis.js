// Gedeelde hulpjes voor Beheersite
// Thema: licht/donker (onthouden per apparaat; standaard volgt het apparaat)
function huidigThema() {
  let t = null; try { t = localStorage.getItem("bs_thema"); } catch {}
  return t || (matchMedia("(prefers-color-scheme: light)").matches ? "licht" : "donker");
}
document.documentElement.dataset.thema = huidigThema();
function themaKnop(el) {
  const zet = () => { el.textContent = document.documentElement.dataset.thema === "licht" ? "🌙" : "☀️";
    el.title = document.documentElement.dataset.thema === "licht" ? "Donker thema" : "Licht thema"; };
  zet();
  el.onclick = () => {
    const t = document.documentElement.dataset.thema === "licht" ? "donker" : "licht";
    document.documentElement.dataset.thema = t; try { localStorage.setItem("bs_thema", t); } catch {}
    zet();
  };
}
document.addEventListener("DOMContentLoaded", () => document.querySelectorAll(".thema").forEach(themaKnop));

const API = "https://eiejxciyfcynppldonaw.supabase.co/functions/v1/beheersite";

function sessie() { try { return localStorage.getItem("bs_sessie") || ""; } catch { return ""; } }
function zetSessie(t) { try { t ? localStorage.setItem("bs_sessie", t) : localStorage.removeItem("bs_sessie"); } catch {} }

async function api(actie, data = {}) {
  let r;
  try {
    r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sessie": sessie() },
      body: JSON.stringify({ actie, ...data }),
    });
  } catch {
    throw new Error("Geen verbinding. Controleer je internet en probeer het opnieuw.");
  }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && !["inloggen", "eerste_wachtwoord", "link_inloggen", "contact"].includes(actie)) {
    zetSessie(""); location.href = "inloggen"; throw new Error("Niet ingelogd");
  }
  if (!r.ok) throw new Error(d.fout || "Er ging iets mis.");
  return d;
}

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const datum = (s) => new Date(s).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const STATUS = {
  nieuw: "Ontvangen", bezig: "Bezig", wacht_op_klant: "Vraag voor jou", klaar: "Klaar",
  kan_niet: "Niet gelukt", doorgestuurd: "Wacht op Jan", terugdraaien: "Wordt teruggedraaid", teruggedraaid: "Teruggedraaid",
};
const ACTIEF = ["nieuw", "bezig", "terugdraaien"];
const WIE = { klant: "Jij", webbeheer: "Webbeheer", jan: "Jan" };

function toonMelding(el, tekst, soort = "fout") {
  if (!tekst) { el.className = "verborgen"; el.textContent = ""; return; }
  el.className = "melding " + soort; el.textContent = tekst;
}

// Foto verkleinen naar max 1600px JPEG en uploaden
async function uploadFoto(bestand) {
  const url = URL.createObjectURL(bestand);
  const img = await new Promise((ok, fout) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fout; i.src = url; });
  const schaal = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * schaal); c.height = Math.round(img.height * schaal);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  const data = c.toDataURL("image/jpeg", 0.85).split(",")[1];
  return api("foto_upload", { data, type: "image/jpeg" });
}

// Invoerblok: tekst + spraak + foto's (kiezen of plakken)
function maakInvoer(houder, { plaats = "Wat wil je laten aanpassen?", knop = "Versturen", opVersturen }) {
  houder.innerHTML = `
    <textarea placeholder="${esc(plaats)}"></textarea>
    <div class="duimen"></div>
    <div class="rij" style="margin-top:10px">
      <button class="knop rand klein mic" type="button" title="Inspreken">🎤 Inspreken</button>
      <label class="knop rand klein" style="margin:0;color:inherit">📷 Foto<input type="file" accept="image/*" multiple hidden></label>
      <span class="vul"></span>
      <button class="knop verstuur" type="button">${esc(knop)}</button>
    </div>
    <div class="verborgen"></div>`;
  const ta = $("textarea", houder), duimen = $(".duimen", houder), mic = $(".mic", houder);
  const bestand = $("input[type=file]", houder), verstuur = $(".verstuur", houder), meld = houder.lastElementChild;
  let fotos = [], bezigMet = 0;

  async function voegToe(files) {
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      if (fotos.length >= 10) { toonMelding(meld, "Maximaal 10 foto's per bericht."); break; }
      const d = document.createElement("div"); d.className = "d";
      d.innerHTML = `<img alt="" src="${URL.createObjectURL(f)}" style="opacity:.4">`;
      duimen.append(d); bezigMet++; verstuur.disabled = true;
      try {
        const r = await uploadFoto(f);
        fotos.push(r.pad); $("img", d).style.opacity = 1;
        const w = document.createElement("button"); w.className = "weg"; w.type = "button"; w.textContent = "✕";
        w.onclick = () => { fotos = fotos.filter((p) => p !== r.pad); d.remove(); };
        d.append(w);
      } catch (e) { d.remove(); toonMelding(meld, e.message); }
      bezigMet--; verstuur.disabled = bezigMet > 0;
    }
  }
  bestand.onchange = () => { voegToe([...bestand.files]); bestand.value = ""; };
  ta.addEventListener("paste", (e) => {
    const f = [...(e.clipboardData?.files || [])];
    if (f.length) { e.preventDefault(); voegToe(f); }
  });

  // Spraak (Chrome, Edge, Safari, Android)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) mic.classList.add("verborgen");
  else {
    let rec = null;
    mic.onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = "nl-NL"; rec.continuous = true; rec.interimResults = false;
      const begin = ta.value;
      let gehoord = "";
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) gehoord += e.results[i][0].transcript + " ";
        ta.value = (begin ? begin.trimEnd() + " " : "") + gehoord.trim();
      };
      rec.onend = () => { rec = null; mic.classList.remove("aan"); mic.textContent = "🎤 Inspreken"; };
      rec.onerror = () => toonMelding(meld, "Inspreken lukte niet. Geef de browser toestemming voor de microfoon.");
      rec.start(); mic.classList.add("aan"); mic.textContent = "■ Stop";
    };
  }

  verstuur.onclick = async () => {
    toonMelding(meld, "");
    verstuur.disabled = true;
    try {
      await opVersturen(ta.value.trim(), fotos);
      ta.value = ""; fotos = []; duimen.innerHTML = "";
    } catch (e) { toonMelding(meld, e.message); }
    verstuur.disabled = false;
  };
  return { focus: () => ta.focus() };
}

// Maak webadressen in een tekst klikbaar (openen in een nieuw tabblad)
function linkjes(tekst) {
  return esc(tekst).replace(/\bhttps?:\/\/[^\s<]+/g, (url) => {
    const eind = url.match(/[.,;:!?)\]]+$/); const schoon = eind ? url.slice(0, -eind[0].length) : url;
    return `<a href="${schoon}" target="_blank" rel="noopener noreferrer">${schoon}</a>${eind ? eind[0] : ""}`;
  });
}
function berichtenHtml(berichten, wieNamen = WIE) {
  return berichten.map((b) => `
    <div class="bericht ${b.van}">
      <div class="wie">${b.van === "webbeheer" ? robotSvg("rust") : ""}${esc(wieNamen[b.van] || b.van)} · ${datum(b.aangemaakt)}</div>
      ${b.tekst ? `<div class="tekst">${linkjes(b.tekst)}</div>` : ""}
      ${(b.fotos || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Foto"></a>`).join("")}
    </div>`).join("");
}

// ---------- Webbeheer-robot ----------
let _botNr = 0;
function robotSvg(extra = "") {
  const id = "bg" + (++_botNr);
  return `<svg class="bot ${extra}" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22e3c4"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
    <g class="antenne"><line x1="32" y1="6" x2="32" y2="14" stroke="url(#${id})" stroke-width="2.5" stroke-linecap="round"/><circle cx="32" cy="5" r="3" fill="#22e3c4"/></g>
    <rect x="8" y="26" width="5" height="12" rx="2.5" fill="url(#${id})" opacity=".8"/><rect x="51" y="26" width="5" height="12" rx="2.5" fill="url(#${id})" opacity=".8"/>
    <rect x="12" y="14" width="40" height="36" rx="12" fill="#0c1322" stroke="url(#${id})" stroke-width="2.5"/>
    <rect x="18" y="22" width="28" height="15" rx="7.5" fill="#06101c" stroke="#22e3c4" stroke-opacity=".35"/>
    <rect class="oog" x="23" y="26" width="6" height="7" rx="3" fill="#22e3c4"/><rect class="oog" x="35" y="26" width="6" height="7" rx="3" fill="#22e3c4"/>
    <rect class="scan" x="18" y="18" width="28" height="2" rx="1" fill="#8b5cf6"/>
    <path d="M25 43 q7 4 14 0" stroke="#22e3c4" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <rect x="22" y="52" width="20" height="6" rx="3" fill="url(#${id})" opacity=".6"/>
  </svg>`;
}

const WEETJES = [
  "Het world wide web werd in 1989 bedacht door Tim Berners-Lee bij CERN in Zwitserland.",
  "De allereerste website, info.cern.ch, ging in 1991 online en is nog steeds te bezoeken.",
  "Het eerste .com-domein ooit was symbolics.com, geregistreerd in 1985.",
  "Nederland kreeg de extensie .nl in 1986, als een van de eerste landen ter wereld.",
  "Er zijn ruim 6 miljoen .nl-domeinnamen geregistreerd.",
  "WordPress draait op meer dan 40% van alle websites ter wereld.",
  "Meer dan de helft van al het websiteverkeer komt van mobiele telefoons.",
  "Google verwerkt elke dag miljarden zoekopdrachten.",
  "Het apenstaartje (@) in e-mailadressen werd in 1971 gekozen door Ray Tomlinson.",
  "De eerste webcam liet een koffiepot zien op de universiteit van Cambridge, zodat niemand voor niets naar een lege pot liep.",
  "Het woord 'spam' komt uit een sketch van Monty Python.",
  "De QR-code werd in 1994 in Japan bedacht om auto-onderdelen te volgen.",
  "Het slotje in je adresbalk betekent dat de verbinding met de website versleuteld is.",
  "Een favicon is het kleine icoontje dat je in je browsertabblad ziet.",
  "De grijze tekst onder je link in Google heet de meta-omschrijving. Die kun je zelf bepalen.",
  "Een alt-tekst bij een foto helpt blinde bezoekers én Google begrijpen wat erop staat.",
  "Kleinere foto's laden sneller, en snelle sites scoren beter in Google.",
  "Google kijkt bij het rangschikken vooral naar hoe je site op mobiel werkt.",
  "Veel bezoekers lezen een pagina in een F-vorm: eerst bovenaan, dan langs de linkerkant naar beneden.",
  "Webshops testen soms twee versies van een knop om te zien welke meer klikken krijgt. Dat heet A/B-testen.",
  "Elke pagina op je site kan een eigen titel in Google krijgen. Dat is een van de belangrijkste SEO-instellingen.",
  "Een duidelijke telefoonknop op mobiel levert lokale bedrijven vaak extra telefoontjes op.",
];
const FASES = ["Verbinding maken met je website", "Verzoek analyseren", "Momentopname maken", "Aanpassing doorvoeren", "Resultaat controleren"];

function wachtHtml(status, sinds) {
  const titel = status === "terugdraaien" ? "Terugdraaien" : status === "nieuw" ? "Webbeheer wordt opgestart" : "Webbeheer is aan het werk";
  return `<div class="wacht" data-sinds="${esc(sinds || "")}">
    ${robotSvg()}
    <div><div style="font-weight:600">${titel}</div>
    <div class="fase"></div>
    <div class="weetje"></div></div></div>`;
}
function tikWacht() {
  const nu = Date.now();
  const w = WEETJES[Math.floor(nu / 8000) % WEETJES.length];
  document.querySelectorAll(".wacht").forEach((el) => {
    const s = Date.parse(el.dataset.sinds) || nu;
    const f = Math.min(FASES.length - 1, Math.floor((nu - s) / 9000));
    const fe = el.querySelector(".fase"), we = el.querySelector(".weetje");
    if (fe.textContent !== FASES[f] + "…") fe.textContent = FASES[f] + "…";
    const wt = "💡 Wist je dat… " + w;
    if (we.textContent !== wt) we.textContent = wt;
  });
}
setInterval(tikWacht, 1000);
