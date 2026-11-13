// Gedeeld: de 14 checks als 7 onderdelen tonen (gratis website-check en klantportaal). Heeft assets/tools.js nodig (SR_RENDER).
const RP_CAT = [
  ["Snelheid", "⚡", ["snelheid", "afbeeldingen"]], ["Op de telefoon", "📱", ["mobiel"]], ["Gevonden in Google", "🔎", ["google-voorbeeld", "indexeerbaar", "koppen"]],
  ["Vindbaar in AI", "🤖", ["ai", "bedrijfsgegevens"]], ["Veiligheid", "🛡️", ["veiligheid", "links"]], ["Je mail", "✉️", ["mail"]], ["Teksten en delen", "💬", ["leesbaarheid", "social", "toegankelijkheid"]]];
const RP_NAAM = { snelheid: "Snelheid", afbeeldingen: "Afbeeldingen", mobiel: "Telefoon", "google-voorbeeld": "Zo zie je eruit in Google", indexeerbaar: "Toegang voor Google", koppen: "Opbouw van je pagina",
  ai: "ChatGPT en andere AI", bedrijfsgegevens: "Bedrijfsgegevens", veiligheid: "Beveiliging", links: "Links", mail: "Komt je mail aan?", leesbaarheid: "Leesbaarheid", social: "Delen in WhatsApp en social media", toegankelijkheid: "Bruikbaar voor iedereen" };

function rpLaadTools() {
  if (window.SR_RENDER) return Promise.resolve();
  return new Promise((ok) => { const s = document.createElement("script"); s.src = "assets/tools.js?v=20261110v"; s.onload = ok; s.onerror = ok; document.body.appendChild(s); });
}
function rpLaden(el, tekst) {
  el.innerHTML = `<div class="srt-laden"><div class="srt-robot">${typeof robotSvg === "function" ? robotSvg("rust") : ""}</div><b>${tekst}</b><div class="srt-voort"><i style="width:4%"></i></div><p class="zacht" style="margin:0">Dit duurt ongeveer een minuut.</p></div>`;
  let pct = 4; const tik = setInterval(() => { pct = Math.min(95, pct + 1.6); const v = el.querySelector(".srt-voort i"); if (v) v.style.width = pct + "%"; else clearInterval(tik); }, 900);
  return () => clearInterval(tik);
}
// wie lost het op: alles wat met gevonden worden te maken heeft hoort bij het SEO-pakket
const RP_SEO = ["google-voorbeeld", "ai", "bedrijfsgegevens", "koppen", "leesbaarheid", "indexeerbaar", "social", "afbeeldingen"];
function rpDoor(T, t) { return RP_SEO.includes(t) ? "vb" : (T[t]?.door === "vb" ? "vb" : "sh"); }
function rpPunten(T, ts) { return (ts || Object.keys(T)).reduce((n, t) => n + (T[t]?.items || []).filter((i) => i.status !== "goed").length, 0); }
// tekent de 7 onderdelen met ringen en de details per onderdeel in el; opties.door = labels "Lost ... op" tonen
function rpCategorieen(el, T, opties = {}) {
  const R = window.SR_RENDER;
  const gem = (ts) => { const s = ts.map((t) => T[t]?.score).filter((x) => x != null); return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null; };
  el.innerHTML = `<div class="rp-cats">${RP_CAT.map(([n, ico, ts], i) => { const s = gem(ts), p = rpPunten(T, ts); return `<button type="button" class="rp-cat" data-cat="${i}">${R.ring(s ?? 100, 84).replace(/>\d+<\/text>/, s == null ? ">–</text>" : `>${s}</text>`)}<b>${ico} ${n}</b><span>${p ? p + (p === 1 ? " verbeterpunt" : " verbeterpunten") : "Alles in orde"}</span></button>`; }).join("")}</div><div class="rp-catdetail"></div>`;
  const toon = (i) => {
    el.querySelectorAll(".rp-cat").forEach((b) => b.classList.toggle("aan", +b.dataset.cat === i));
    const [n, ico, ts] = RP_CAT[i];
    el.querySelector(".rp-catdetail").innerHTML = `<div class="rp-catvak"><h3>${ico} ${n}</h3>${ts.filter((t) => T[t]).map((t) => `<div class="rp-tool"><div class="rp-toolkop"><b>${RP_NAAM[t]}</b>${opties.door === false ? "" : `<span class="rp-door ${rpDoor(T, t)}">${rpDoor(T, t) === "vb" ? "Lost het SEO-pakket op" : "Lost Sitehulpje op"}</span>`}</div>
      ${R.EXTRA[t] && T[t].extra && ["google-voorbeeld", "social", "ai"].includes(t) ? R.EXTRA[t](T[t].extra) : ""}${R.itemsHtml(T[t].items || [])}</div>`).join("")}</div>`;
  };
  el.querySelectorAll(".rp-cat").forEach((b) => (b.onclick = () => toon(+b.dataset.cat)));
  const eerste = RP_CAT.findIndex(([, , ts]) => rpPunten(T, ts) > 0); toon(eerste < 0 ? 0 : eerste);
}
