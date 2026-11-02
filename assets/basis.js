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

// Twee aparte sessies per browser: één voor het beheerscherm (Jan) en één voor de klantpagina.
// Zo kan Jan een klant-inloglink openen zonder dat zijn beheerscherm uitlogt.
const IS_BEHEER = /\/beheer(\.html)?$/.test(location.pathname);
const SESSIE_SLEUTEL = { beheer: "bs_sessie_beheer", klant: "bs_sessie" };
function sessieVan(soort) { try { return localStorage.getItem(SESSIE_SLEUTEL[soort]) || ""; } catch { return ""; } }
function zetSessieVan(soort, t) { try { t ? localStorage.setItem(SESSIE_SLEUTEL[soort], t) : localStorage.removeItem(SESSIE_SLEUTEL[soort]); } catch {} }
function sessie() { return sessieVan(IS_BEHEER ? "beheer" : "klant"); }
function zetSessie(t) { zetSessieVan(IS_BEHEER ? "beheer" : "klant", t); }

async function api(actie, data = {}, metToken) {
  let r;
  try {
    r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sessie": metToken ?? sessie() },
      body: JSON.stringify({ actie, ...data }),
    });
  } catch {
    throw new Error("Geen verbinding. Controleer je internet en probeer het opnieuw.");
  }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && metToken === undefined && !["inloggen", "eerste_wachtwoord", "link_inloggen", "contact"].includes(actie)) {
    zetSessie(""); location.href = IS_BEHEER ? "inloggen?voor=beheer" : "inloggen"; throw new Error("Niet ingelogd");
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
const WIE = { klant: "Jij", webbeheer: "Sitehulpje", jan: "Jan" };

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

// ---------- Sitehulpje-robot (3D-look) ----------
let _botNr = 0;
function robotSvg(extra = "") {
  const n = ++_botNr, g = (x) => `${x}${n}`;
  return `<svg class="bot ${extra}" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <linearGradient id="${g("huid")}" x1=".2" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e6edf6"/><stop offset="1" stop-color="#b9c8db"/></linearGradient>
      <linearGradient id="${g("zij")}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2ff0d0"/><stop offset="1" stop-color="#0e9f8c"/></linearGradient>
      <linearGradient id="${g("scherm")}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16253b"/><stop offset="1" stop-color="#070d18"/></linearGradient>
      <radialGradient id="${g("lamp")}" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#d6fff7"/><stop offset=".4" stop-color="#22e3c4"/><stop offset="1" stop-color="#0b8f7d"/></radialGradient>
      <radialGradient id="${g("oog")}" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#eafffb"/><stop offset=".45" stop-color="#3cf2d6"/><stop offset="1" stop-color="#11b9a0"/></radialGradient>
      <filter id="${g("gloed")}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <ellipse class="schaduw" cx="50" cy="94" rx="20" ry="3.5" fill="#000" opacity=".18"/>
    <g class="lijf">
      <g class="antenne"><rect x="48.6" y="9" width="2.8" height="10" rx="1.4" fill="#9fb2c8"/><circle cx="50" cy="8" r="4.6" fill="url(#${g("lamp")})" filter="url(#${g("gloed")})"/></g>
      <rect class="arm-l" x="16" y="62" width="9" height="20" rx="4.5" fill="url(#${g("huid")})" stroke="#9fb2c8" stroke-width=".6"/>
      <g class="arm-r"><rect x="75" y="62" width="9" height="20" rx="4.5" fill="url(#${g("huid")})" stroke="#9fb2c8" stroke-width=".6"/></g>
      <rect x="26" y="60" width="48" height="28" rx="12" fill="url(#${g("huid")})" stroke="#9fb2c8" stroke-width=".6"/>
      <circle cx="50" cy="73" r="4.2" fill="url(#${g("lamp")})" filter="url(#${g("gloed")})" class="hartlamp"/>
      <rect x="11" y="31" width="8" height="18" rx="4" fill="url(#${g("zij")})"/><rect x="81" y="31" width="8" height="18" rx="4" fill="url(#${g("zij")})"/>
      <rect x="17" y="17" width="66" height="46" rx="20" fill="url(#${g("huid")})" stroke="#9fb2c8" stroke-width=".6"/>
      <ellipse cx="36" cy="24" rx="13" ry="4" fill="#fff" opacity=".85"/>
      <rect x="24" y="25" width="52" height="30" rx="14" fill="url(#${g("scherm")})"/>
      <rect x="27" y="27" width="46" height="6" rx="3" fill="#fff" opacity=".06"/>
      <g class="ogen" filter="url(#${g("gloed")})">
        <rect class="oog" x="34" y="33" width="9" height="11" rx="4.5" fill="url(#${g("oog")})"/>
        <rect class="oog" x="57" y="33" width="9" height="11" rx="4.5" fill="url(#${g("oog")})"/>
      </g>
      <path d="M43 48.5 q7 4.5 14 0" stroke="#3cf2d6" stroke-width="2.4" fill="none" stroke-linecap="round" filter="url(#${g("gloed")})"/>
      <circle cx="30" cy="48" r="2.6" fill="#ff7aa8" opacity=".35"/><circle cx="70" cy="48" r="2.6" fill="#ff7aa8" opacity=".35"/>
      <rect class="scan" x="26" y="27" width="48" height="2" rx="1" fill="#8b5cf6" opacity=".8"/>
    </g>
  </svg>`;
}
// Ogen volgen de muis (alleen op grote robots met class "kijkt")
document.addEventListener("pointermove", (e) => {
  document.querySelectorAll(".bot.kijkt").forEach((svg) => {
    const r = svg.getBoundingClientRect(); if (!r.width) return;
    const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 300));
    const dy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / 300));
    const o = svg.querySelector(".ogen"); if (o) o.style.transform = `translate(${dx * 3}px, ${dy * 2}px)`;
  });
}, { passive: true });

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
  const titel = status === "terugdraaien" ? "Terugdraaien" : status === "nieuw" ? "Sitehulpje wordt opgestart" : "Sitehulpje is aan het werk";
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
