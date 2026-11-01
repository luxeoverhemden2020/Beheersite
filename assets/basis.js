// Gedeelde hulpjes voor Beheersite
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
  if (r.status === 401 && actie !== "inloggen" && actie !== "eerste_wachtwoord") {
    zetSessie(""); location.href = "./"; throw new Error("Niet ingelogd");
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

function berichtenHtml(berichten, wieNamen = WIE) {
  return berichten.map((b) => `
    <div class="bericht ${b.van}">
      <div class="wie">${esc(wieNamen[b.van] || b.van)} · ${datum(b.aangemaakt)}</div>
      ${b.tekst ? `<div class="tekst">${esc(b.tekst)}</div>` : ""}
      ${(b.fotos || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Foto"></a>`).join("")}
    </div>`).join("");
}
