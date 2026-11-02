// Probeer-het-zelf demo: Sitehulpje past een voorbeeldwinkel aan (draait volledig in de browser, geen AI-kosten)
(function () {
  const sec = document.getElementById("probeer"); if (!sec) return;
  const $$ = (s) => sec.querySelector(s);
  const chat = $$("#pchat"), invoer = $$("#pinvoer"), knop = $$("#pstuur"), winkel = $$("#pwinkel");
  $$("#pbot").innerHTML = robotSvg("zwaai kijkt");

  const BEGIN = {
    titel: "Winterjas Oslo", prijs: 119, sale: 0, kleur: "#0f172a", achtergrond: "#ffffff",
    melding: "", info: "", verzending: "", voorraad: "Op voorraad", code: "", foto: 0,
    omschrijving: "Warme, waterafstotende winterjas met afneembare capuchon. Perfect voor koude dagen in de stad.",
  };
  let st = { ...BEGIN }; const geschiedenis = [];
  const FOTO_TINT = [0, 140, 200, 300, 40];
  const KLEUREN = { rood: "#dc2626", blauw: "#2563eb", groen: "#16a34a", zwart: "#0f172a", roze: "#db2777", paars: "#7c3aed", oranje: "#ea580c", geel: "#ca8a04", turquoise: "#0d9488", goud: "#b8860b", grijs: "#475569", bruin: "#92400e" };
  const LICHT = { rood: "#fef2f2", blauw: "#eff6ff", groen: "#f0fdf4", zwart: "#f1f5f9", roze: "#fdf2f8", paars: "#f5f3ff", oranje: "#fff7ed", geel: "#fefce8", turquoise: "#f0fdfa", goud: "#fefce8", grijs: "#f8fafc", bruin: "#fdf8f3" };
  const smal = () => matchMedia("(max-width:1000px)").matches;
  const euro = (n) => "€" + (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", ",-");

  function teken(flits = []) {
    const nu = st.sale ? st.prijs * (1 - st.sale / 100) : st.prijs;
    winkel.style.setProperty("--wk", st.kleur);
    winkel.style.setProperty("--wbg", st.achtergrond);
    winkel.innerHTML = `
      <div class="w-browser"><i></i><i></i><i></i><span>modehuis-voorbeeld.nl/winterjas-oslo</span></div>
      ${st.melding ? `<div class="w-melding" data-v="melding">${esc(st.melding)}</div>` : ""}
      <div class="w-kop"><b>Modehuis</b><span>Heren · Dames · Sale</span><span class="w-mand">🛒</span></div>
      ${st.info ? `<div class="w-info" data-v="info">ℹ️ ${esc(st.info)}</div>` : ""}
      <div class="w-product">
        <div class="w-foto" data-v="foto" style="filter:hue-rotate(${FOTO_TINT[st.foto % FOTO_TINT.length]}deg)">
          <span>🧥</span>${st.sale ? `<em class="w-sale" data-v="sale">-${st.sale}%</em>` : ""}
        </div>
        <div class="w-info-blok">
          <h4 data-v="titel">${esc(st.titel)}</h4>
          <div class="w-prijs" data-v="prijs">${st.sale ? `<s>${euro(st.prijs)}</s>` : ""}<b>${euro(nu)}</b></div>
          <p data-v="omschrijving">${esc(st.omschrijving)}</p>
          <div class="w-maten"><span>S</span><span class="aan">M</span><span>L</span><span>XL</span></div>
          <button type="button" class="w-knop" data-v="kleur" tabindex="-1">In winkelmand</button>
          <div class="w-extra">
            <span data-v="voorraad" class="${st.voorraad === "Uitverkocht" ? "uit" : ""}">● ${esc(st.voorraad)}</span>
            ${st.verzending ? `<span data-v="verzending">🚚 ${esc(st.verzending)}</span>` : ""}
          </div>
          ${st.code ? `<div class="w-code" data-v="code">🎟️ ${esc(st.code)}</div>` : ""}
        </div>
      </div>`;
    flits.forEach((k) => winkel.querySelectorAll(`[data-v="${k}"]`).forEach((el) => { el.classList.remove("flits"); void el.offsetWidth; el.classList.add("flits"); }));
    if (flits.includes("achtergrond")) { winkel.classList.remove("flits-rand"); void winkel.offsetWidth; winkel.classList.add("flits-rand"); }
  }

  function bericht(van, html) {
    const el = document.createElement("div"); el.className = "p-bel " + van; el.innerHTML = html;
    chat.append(el); chat.scrollTop = chat.scrollHeight; return el;
  }
  function denkt() {
    const el = document.createElement("div"); el.className = "p-bel bot denkt";
    el.innerHTML = `<span class="p-dots"><i></i><i></i><i></i></span> <span class="p-fase">Ik kijk even naar je site…</span>`;
    chat.append(el); chat.scrollTop = chat.scrollHeight;
    setTimeout(() => { const f = el.querySelector(".p-fase"); if (f) f.textContent = "Aanpassing doorvoeren…"; }, 700);
    return el;
  }
  const naDubbelepunt = (t) => { const q = t.match(/["“'‘]([^"”'’]{2,80})["”'’]/); if (q) return q[1]; const i = t.indexOf(":"); return i >= 0 ? t.slice(i + 1).trim() : ""; };
  const hoofdletter = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function verwerk(tekst) {
    const t = tekst.toLowerCase().replace(",", ".");
    if (/\b(terug|ongedaan|undo|herstel)/.test(t)) {
      if (!geschiedenis.length) return { msg: "Er is nog niets om terug te draaien. Vraag eerst iets! 😉", flits: [] };
      st = geschiedenis.pop(); return { msg: "↩️ Teruggedraaid! Alles staat weer zoals het was.", flits: ["titel", "prijs", "kleur", "melding", "foto"] };
    }
    const oud = { ...st }; const gedaan = []; const flits = [];
    const pct = t.match(/(\d{1,2})\s*(%|procent)/);
    if (pct && /(sale|korting|actie|goedkoper|af)/.test(t) && !/code/.test(t)) {
      st.sale = Math.min(90, +pct[1]); gedaan.push(`de jas staat nu <b>${st.sale}% in de sale</b>`); flits.push("prijs", "sale");
    } else if (/(geen|stop|haal).*(sale|korting)|(sale|korting).*(weg|uit|stop)/.test(t)) {
      st.sale = 0; gedaan.push("de sale is eraf gehaald"); flits.push("prijs");
    }
    const prijs = t.match(/(?:€|eur(?:o)?\s*)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:€|euro|eur\b|,-)/);
    if (prijs && /(prijs|kost|maak|zet|euro|€)/.test(t) && !/verzend|vanaf/.test(t)) {
      const p = parseFloat(prijs[1] || prijs[2]); if (p > 0 && p < 100000) { st.prijs = p; gedaan.push(`de prijs is nu <b>${euro(p)}</b>`); flits.push("prijs"); }
    }
    const kleur = Object.keys(KLEUREN).find((k) => new RegExp("\\b" + k).test(t));
    if (kleur) {
      if (/(achtergrond|pagina|site)/.test(t) && !/knop/.test(t)) { st.achtergrond = LICHT[kleur]; gedaan.push(`de achtergrond is nu <b>${kleur}</b>`); flits.push("achtergrond"); }
      else { st.kleur = KLEUREN[kleur]; gedaan.push(`de knop is nu <b>${kleur}</b>`); flits.push("kleur"); }
    }
    if (/(melding|banner|bovenaan|aankondiging|balk)/.test(t)) {
      const m = naDubbelepunt(tekst) || (st.sale ? `🔥 Nu ${st.sale}% korting op winterjassen!` : "🎉 De nieuwe wintercollectie is binnen!");
      st.melding = hoofdletter(m); gedaan.push("er staat een <b>melding bovenaan</b>"); flits.push("melding");
    }
    if (/(openingstijd|gesloten|dicht|feestdag|vakantie|open op)/.test(t)) {
      st.info = hoofdletter(naDubbelepunt(tekst) || (/dicht|gesloten/.test(t) ? tekst.replace(/^(zet (erop|op de site) dat|zet erop:?)\s*/i, "") : "Open: ma t/m za 9:00 – 18:00, koopzondag 12:00 – 17:00"));
      gedaan.push("de <b>openingstijden/info</b> staan erop"); flits.push("info");
    }
    if (/gratis verzend/.test(t)) {
      const v = t.match(/vanaf\s*€?\s*(\d+)/); st.verzending = v ? `Gratis verzending vanaf €${v[1]}` : "Gratis verzending";
      gedaan.push(`<b>${st.verzending.toLowerCase()}</b> staat erbij`); flits.push("verzending");
    }
    if (/uitverkocht|niet (meer )?op voorraad/.test(t)) { st.voorraad = "Uitverkocht"; gedaan.push("het product staat op <b>uitverkocht</b>"); flits.push("voorraad"); }
    else if (/(weer )?op voorraad|voorraad/.test(t)) { const n = t.match(/(\d+)\s*(stuks|stuk)?/); st.voorraad = n && /voorraad/.test(t) ? `Op voorraad (${n[1]} stuks)` : "Op voorraad"; gedaan.push("de <b>voorraad</b> is bijgewerkt"); flits.push("voorraad"); }
    if (/(kortingscode|code)/.test(t)) {
      const c = tekst.match(/code\s+([A-Za-z0-9]{3,15})/i); const p = t.match(/(\d{1,2})\s*%/);
      const code = (c ? c[1] : "WINTER" + (p ? p[1] : "10")).toUpperCase();
      st.code = `Code ${code} = ${p ? p[1] : 10}% korting`; gedaan.push(`kortingscode <b>${code}</b> is aangemaakt`); flits.push("code");
    }
    const naam = tekst.match(/\b(?:titel|naam|productnaam)\b\s*(?:(?:wordt|naar|in|is|van het product)\b\s*|[:=]\s*)?["“']?([^"”']{2,40}?)["”']?[.!]?\s*$/i)
      || tekst.match(/\b(?:her)?noem\b\s+(?:(?:het|de|hem|deze)\s+)?(?:(?:product|jas|artikel)\s*)?(?:naar\s+|:\s*)?["“']?([^"”']{2,40}?)["”']?[.!]?\s*$/i);
    if (naam && !/^(aan|aanpassen|veranderen|wijzigen)$/i.test(naam[1].trim())) { st.titel = hoofdletter(naam[1].trim()); gedaan.push(`de naam is nu <b>${esc(st.titel)}</b>`); flits.push("titel"); }
    if (/(omschrijving|beschrijving|productekst|producttekst)/.test(t)) {
      const o = naDubbelepunt(tekst);
      st.omschrijving = o ? hoofdletter(o) : "Tijdloze winterjas van zacht wolmengsel. Lekker warm, licht van gewicht en met handige binnenzak. Een jas die je jaren meegaat.";
      gedaan.push("de <b>omschrijving</b> is herschreven"); flits.push("omschrijving");
    }
    if (/(foto|afbeelding|plaatje)/.test(t)) { st.foto++; gedaan.push("er staat een <b>nieuwe foto</b>"); flits.push("foto"); }

    if (!gedaan.length) {
      st = oud;
      if (/(fout|verkeerd|klopt niet|waarom|raar|niet goed)/.test(t))
        return { msg: "Oeps, sorry! 🙈 Dan begreep ik je niet goed. Tik op <b>↩ Terugdraaien</b> en probeer het nog eens, bijvoorbeeld: <i>noem het product: Luxe Winterjas</i>.<br><small>In het echt kun je me altijd verbeteren in het gesprek, of het met één tik terugdraaien.</small>", flits: [] };
      if (/(kost|prijs van sitehulpje|abonnement|tarief)/.test(t) && /\?/.test(t))
        return { msg: "Daar maakt Jan graag een voorstel voor dat bij jou past. 😊 Laat onderaan je gegevens achter bij <b>Gratis kennismaken</b>.", flits: [] };
      if (/^(hoi|hallo|hey|hi|goedemorgen|goedemiddag|goedenavond)\b/.test(t))
        return { msg: "Hoi! 👋 Vertel me maar wat er aan deze winkel moet veranderen. Bijvoorbeeld: <i>zet de jas 20% in de sale</i>.", flits: [] };
      if (/\?/.test(t))
        return { msg: "Goede vraag! In deze demo pas ik alleen deze voorbeeldwinkel aan. Wil je meer weten? Laat onderaan je gegevens achter bij <b>Gratis kennismaken</b>, dan neemt Jan contact met je op. 😊", flits: [] };
      return { msg: "In deze demo kan ik een paar dingen laten zien: <b>prijs</b>, <b>sale</b>, <b>kleur</b>, <b>melding</b>, <b>openingstijden</b>, <b>kortingscode</b>, <b>foto</b>, <b>voorraad</b> en <b>naam</b>. Probeer er een! 👇<br><small>In het echt kan ik álles op je site aanpassen.</small>", flits: [] };
    }
    geschiedenis.push(oud);
    const zin = gedaan.length === 1 ? gedaan[0] : gedaan.slice(0, -1).join(", ") + " en " + gedaan[gedaan.length - 1];
    return { msg: `✅ Klaar! ${hoofdletter(zin)}. Kijk maar ${smal() ? "hierboven 👆" : "rechts 👉"}`, flits, terug: true };
  }

  let bezig = false;
  function stuur(tekst) {
    tekst = (tekst || invoer.value).trim(); if (!tekst || bezig) return;
    bezig = true; invoer.value = ""; knop.disabled = true;
    bericht("jij", esc(tekst));
    const d = denkt();
    setTimeout(() => {
      d.remove(); const r = verwerk(tekst); teken(r.flits);
      if (smal() && r.flits.length && !auto) winkel.scrollIntoView({ behavior: "smooth", block: "start" });
      const el = bericht("bot", r.msg + (r.terug ? ` <button type="button" class="p-terug">↩ Terugdraaien</button>` : ""));
      const tb = el.querySelector(".p-terug"); if (tb) tb.onclick = () => { stopAuto(); stuur("terugdraaien"); };
      bezig = false; knop.disabled = false;
    }, 1300);
  }
  knop.onclick = () => { stopAuto(); stuur(); };
  invoer.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); stopAuto(); stuur(); } });
  invoer.addEventListener("focus", stopAuto);
  sec.querySelectorAll(".p-voorbeeld").forEach((b) => b.onclick = () => { stopAuto(); stuur(b.dataset.t); });

  // Automatische voorbeeldshow tot de bezoeker zelf iets doet
  const SHOW = ["Zet de winterjas 25% in de sale", "Maak de knop groen", "Zet bovenaan: 🎄 Kerstactie: gratis inpakken!"];
  let auto = true, autoTimer = null, gestart = false;
  function stopAuto() { auto = false; clearTimeout(autoTimer); }
  function typ(tekst, klaar) {
    let i = 0; invoer.value = "";
    (function stap() { if (!auto) return; invoer.value = tekst.slice(0, ++i); if (i < tekst.length) autoTimer = setTimeout(stap, 38); else autoTimer = setTimeout(klaar, 450); })();
  }
  function show(n) {
    if (!auto) return;
    if (n >= SHOW.length) { autoTimer = setTimeout(() => { if (!auto) return; st = { ...BEGIN }; geschiedenis.length = 0; teken(["titel"]); chat.innerHTML = ""; begroet(); autoTimer = setTimeout(() => show(0), 2500); }, 5000); return; }
    typ(SHOW[n], () => { if (!auto) return; stuur(SHOW[n]); autoTimer = setTimeout(() => show(n + 1), 3200); });
  }
  function begroet() { bericht("bot", "Hoi! 👋 Ik ben <b>Sitehulpje</b>. Vertel me wat ik moet wijzigen aan deze site. Typ maar, of kies een voorbeeld hieronder."); }

  teken(); begroet();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) auto = false;
  new IntersectionObserver(([e]) => { if (e.isIntersecting && !gestart && auto) { gestart = true; autoTimer = setTimeout(() => show(0), 1200); } }, { threshold: 0.35 }).observe(sec);
})();
