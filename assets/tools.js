// Siteregelaar – gratis tools. Eén script voor alle tools op /tools en op de plaatspagina's.
// Gebruik: <div data-sr-tool="snelheid" data-plaats="Almelo"></div>
(function () {
  const API = "https://dauvsivoxfdfzurmyuug.supabase.co/functions/v1/sr-tools";
  const BESTEL = "https://sitehulpje.nl/bestellen";
  const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TOOLS = {
    snelheid: { naam: "Snelheidstest", pad: "snelheidstest", ico: "⚡", duur: 35, knop: "Test mijn snelheid" },
    concurrent: { naam: "Jij tegen je concurrent", pad: "concurrent-vergelijken", ico: "🥊", duur: 40, knop: "Vergelijk", twee: true },
    "google-voorbeeld": { naam: "Google-voorbeeld", pad: "google-voorbeeld", ico: "🔎", duur: 6, knop: "Laat zien" },
    ai: { naam: "Vindbaar in ChatGPT?", pad: "vindbaar-in-chatgpt", ico: "🤖", duur: 8, knop: "Check mijn site" },
    veiligheid: { naam: "Veiligheidscheck", pad: "veiligheidscheck", ico: "🛡️", duur: 8, knop: "Check de beveiliging" },
    toegankelijkheid: { naam: "Toegankelijkheidscheck", pad: "toegankelijkheid-check", ico: "♿", duur: 30, knop: "Check mijn site" },
    mobiel: { naam: "Telefoon-check", pad: "mobiel-check", ico: "📱", duur: 30, knop: "Check op de telefoon" },
    links: { naam: "Kapotte-linkszoeker", pad: "kapotte-links-checker", ico: "🔗", duur: 20, knop: "Zoek kapotte links" },
    bedrijfsgegevens: { naam: "Bedrijfsgegevens-check", pad: "bedrijfsgegevens-check", ico: "🏪", duur: 8, knop: "Check mijn gegevens" },
    social: { naam: "Deel-voorbeeld", pad: "deel-voorbeeld", ico: "💬", duur: 8, knop: "Laat zien" },
    afbeeldingen: { naam: "Afbeeldingen-check", pad: "afbeeldingen-check", ico: "🖼️", duur: 15, knop: "Check mijn afbeeldingen" },
    koppen: { naam: "Kopjes-check", pad: "koppen-check", ico: "🧱", duur: 6, knop: "Check de opbouw" },
    leesbaarheid: { naam: "Leesbaarheidscheck", pad: "leesbaarheid-check", ico: "📖", duur: 6, knop: "Check mijn tekst" },
    indexeerbaar: { naam: "Google-toegang-check", pad: "google-toegang-check", ico: "🚪", duur: 10, knop: "Check of Google erbij kan" },
    mail: { naam: "Mail-check", pad: "mail-check", ico: "✉️", duur: 6, knop: "Check mijn mail", domein: true },
    kosten: { naam: "Wat kost je website per jaar?", pad: "website-kosten-berekenen", ico: "🧮", los: true },
    omzetverlies: { naam: "Wat kost een trage site je?", pad: "omzetverlies-berekenen", ico: "📉", los: true },
    qr: { naam: "QR-code maker", pad: "qr-code-maken", ico: "🔳", los: true },
  };
  window.SR_TOOLS = TOOLS;
  const STAP = ["We openen je website…", "We lezen alles na…", "We meten en vergelijken…", "We zetten de uitkomst in gewone taal…", "Bijna klaar…"];

  function ring(score, grootte = 120) {
    if (score === null || score === undefined) return "";
    const r = grootte / 2 - 10, o = 2 * Math.PI * r, k = score >= 80 ? "var(--accent)" : score >= 50 ? "#f5a524" : "#ff6b81";
    return `<svg class="srt-ring" viewBox="0 0 ${grootte} ${grootte}" width="${grootte}" height="${grootte}" role="img" aria-label="${score} van 100">
      <circle cx="50%" cy="50%" r="${r}" fill="none" stroke="var(--lijn)" stroke-width="10"/>
      <circle cx="50%" cy="50%" r="${r}" fill="none" stroke="${k}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(o * score) / 100} ${o}" transform="rotate(-90 ${grootte / 2} ${grootte / 2})"/>
      <text x="50%" y="50%" dy=".35em" text-anchor="middle" class="srt-getal">${score}</text></svg>`;
  }
  const stip = (s) => `<span class="srt-stip srt-${s}" aria-hidden="true">${s === "goed" ? "✓" : s === "let" ? "!" : "✕"}</span>`;
  const itemsHtml = (items) => `<ul class="srt-items">${items.map((i) => `<li>${stip(i.status)}<div><b>${e(i.titel)}</b>${i.uitleg ? `<span>${e(i.uitleg)}</span>` : ""}</div></li>`).join("")}</ul>`;

  // extra beeld per tool
  const EXTRA = {
    snelheid: (x) => `<div class="srt-duo"><div><span>Op de telefoon</span>${ring(x.mobiel, 96)}</div><div><span>Op de computer</span>${ring(x.computer, 96)}</div>${x.echt ? `<div class="srt-echt"><span>Echte bezoekers ervaren je site als</span><b>${e(x.echt)}</b></div>` : ""}</div>`,
    "google-voorbeeld": (x) => `<div class="srt-serp"><div class="srt-serp-url"><img src="${e(x.icoon)}" alt="" width="18" height="18" onerror="this.style.visibility='hidden'"><span>${e(x.host)}<small>${e(x.pad && x.pad !== "/" ? " › " + x.pad.replace(/^\/|\/$/g, "").replace(/\//g, " › ") : "")}</small></span></div>
      <div class="srt-serp-titel">${e((x.titel || "(geen titel)").length > 60 ? x.titel.slice(0, 58) + " …" : x.titel || "(geen titel)")}</div>
      <div class="srt-serp-oms">${e((x.omschrijving || "Geen omschrijving: Google kiest zelf een stukje tekst van je pagina.").length > 158 ? x.omschrijving.slice(0, 155) + " …" : x.omschrijving || "Geen omschrijving: Google kiest zelf een stukje tekst van je pagina.")}</div></div>
      <p class="zacht srt-klein">Zo ziet je pagina er ongeveer uit tussen de zoekresultaten.</p>`,
    social: (x) => `<div class="srt-deel"><div class="srt-deel-bel">${x.beeld ? `<img src="${e(x.beeld)}" alt="">` : `<div class="srt-deel-leeg">Geen afbeelding</div>`}<div class="srt-deel-tekst"><b>${e(x.titel || x.host)}</b><span>${e((x.omschrijving || "").slice(0, 120))}</span><small>${e(x.host)}</small></div></div></div>
      <p class="zacht srt-klein">Zo ziet je link er ongeveer uit als iemand hem in WhatsApp deelt.</p>`,
    concurrent: (x) => `<div class="srt-vs"><div class="srt-vs-kop"><span></span><b>${e(x.jij)}</b><b>${e(x.zij)}</b></div>${x.rijen.map((r) => `<div class="srt-vs-rij"><span>${e(r.naam)}</span>${[r.jij, r.zij].map((w, i) => `<div class="srt-balk ${w !== null && w >= (i ? r.jij : r.zij) ? "wint" : ""}"><i style="width:${w ?? 0}%"></i><em>${w ?? "–"}</em></div>`).join("")}</div>`).join("")}</div>`,
    koppen: (x) => x.koppen?.length ? `<div class="srt-koppen">${x.koppen.map((k) => `<div style="padding-left:${(k.n - 1) * 18}px"><code>H${k.n}</code> ${e(k.t || "(leeg)")}</div>`).join("")}</div>` : "",
    ai: (x) => `<div class="srt-chips">${x.bots.map((b) => `<span class="${b.mag ? "mag" : "niet"}">${b.mag ? "✓" : "✕"} ${e(b.naam)}</span>`).join("")}</div>`,
    mail: (x) => x.dienst ? `<p class="srt-klein zacht">Je mail voor <b>${e(x.domein)}</b> loopt via ${e(x.dienst)}.</p>` : "",
    leesbaarheid: (x) => `<div class="srt-duo"><div><span>Woorden</span><b class="srt-groot">${x.woorden}</b></div><div><span>Zinnen</span><b class="srt-groot">${x.zinnen}</b></div><div><span>Taalniveau</span><b class="srt-groot">${e(x.niveau)}</b></div></div>`,
    links: (x) => `<div class="srt-duo"><div><span>Gecontroleerd</span><b class="srt-groot">${x.gecontroleerd}</b></div><div><span>Werken niet</span><b class="srt-groot">${x.kapot}</b></div></div>`,
    afbeeldingen: (x) => x.aantal ? `<div class="srt-duo"><div><span>Afbeeldingen</span><b class="srt-groot">${x.aantal}</b></div><div><span>Gewicht (eerste 20)</span><b class="srt-groot">${x.kb > 1024 ? (x.kb / 1024).toFixed(1).replace(".", ",") + " MB" : x.kb + " kB"}</b></div></div>` : "",
    mobiel: (x) => `<div class="srt-duo"><div><span>Snelheid op de telefoon</span>${ring(x.snelheid, 96)}</div></div>`,
  };

  function oplossen(d, tool) {
    const n = (d.items || []).filter((i) => i.status !== "goed").length;
    if (!n) return `<div class="srt-cta srt-cta-goed"><b>Netjes! Hier valt weinig te verbeteren.</b><span>Probeer gerust een andere check hieronder, of laat je hele website gratis nakijken.</span><a class="knop rand" href="https://siteregelaar.nl/#check">Volledige website-check</a></div>`;
    return `<div class="srt-cta"><div><b>${n === 1 ? "1 punt" : n + " punten"} om te verbeteren</b><span>Sitehulpje lost dit voor je op. Je bevindingen gaan direct mee naar je account, dus je hoeft niets opnieuw uit te leggen.</span></div>
      <a class="knop" href="${BESTEL}?ref=check:${e(d.id)}&sh=1">Laat Sitehulpje dit oplossen →</a></div>`;
  }
  function meer(tool) {
    const keuze = Object.entries(TOOLS).filter(([k]) => k !== tool).sort(() => Math.random() - 0.5).slice(0, 4);
    return `<div class="srt-meer"><span class="zacht">Doe nog een check:</span>${keuze.map(([k, t]) => `<a href="https://siteregelaar.nl/tools/${t.pad}">${t.ico} ${e(t.naam)}</a>`).join("")}</div>`;
  }

  function maakMeetTool(el, tool, t) {
    const plaats = el.dataset.plaats || "", bron = el.dataset.bron || location.pathname;
    el.innerHTML = `<form class="srt-form" novalidate>
      <div class="srt-velden">
        <label><span>${t.twee ? "Jouw website" : t.domein ? "Je website of e-mailadres" : "Adres van je website"}</span><input name="site" inputmode="url" autocomplete="url" placeholder="${t.domein ? "jouwbedrijf.nl of naam@jouwbedrijf.nl" : "www.jouwbedrijf.nl"}" required></label>
        ${t.twee ? `<label><span>Website van je concurrent</span><input name="site2" inputmode="url" placeholder="www.concurrent.nl" required></label>` : ""}
      </div>
      <button class="knop" type="submit">${e(t.knop)} →</button>
      <p class="zacht srt-klein">Gratis, zonder account. ${t.duur > 15 ? `Duurt ongeveer ${t.duur} seconden.` : "Duurt een paar seconden."}</p>
    </form><div class="srt-uit" aria-live="polite"></div>`;
    const f = el.querySelector("form"), uit = el.querySelector(".srt-uit");
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      let site = f.site.value.trim(); if (t.domein && site.includes("@")) site = site.split("@").pop();
      if (!site) { uit.innerHTML = `<div class="melding fout">Vul eerst het adres van je website in.</div>`; return; }
      if (t.twee && !f.site2.value.trim()) { uit.innerHTML = `<div class="melding fout">Vul ook de website van je concurrent in.</div>`; return; }
      const knop = f.querySelector("button"); knop.disabled = true;
      let i = 0, pct = 0;
      uit.innerHTML = `<div class="srt-laden"><div class="srt-robot">${typeof robotSvg === "function" ? robotSvg("denkt") : "🤖"}</div><b>${STAP[0]}</b><div class="srt-voort"><i style="width:3%"></i></div></div>`;
      const tik = setInterval(() => { pct = Math.min(94, pct + 100 / (t.duur * 2.2)); i = Math.min(STAP.length - 1, Math.floor((pct / 100) * STAP.length));
        const b = uit.querySelector(".srt-laden b"), v = uit.querySelector(".srt-voort i"); if (b) b.textContent = STAP[i]; if (v) v.style.width = pct + "%"; }, 450);
      try {
        const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actie: "meet", tool, site, site2: f.site2?.value, plaats, bron }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.fout || "Er ging iets mis. Probeer het zo nog eens.");
        clearInterval(tik);
        uit.innerHTML = `<div class="srt-uitslag">
          <div class="srt-kop">${ring(d.score)}<div><span class="srt-label">${e(t.naam)} · ${e(d.site)}</span><h3>${e(d.kop)}</h3></div></div>
          ${EXTRA[tool] && d.extra ? EXTRA[tool](d.extra) : ""}
          ${itemsHtml(d.items || [])}
          ${oplossen(d, tool)}</div>${meer(tool)}`;
        uit.scrollIntoView({ behavior: "smooth", block: "start" });
        try { window.dataLayer?.push({ event: "sr_tool", tool }); } catch {}
      } catch (err) { clearInterval(tik); uit.innerHTML = `<div class="melding fout">${e(err.message)}</div>`; }
      knop.disabled = false;
    };
  }

  // ---------- rekentools (rekenen in de browser) ----------
  const euro = (n) => "€" + Math.round(n).toLocaleString("nl-NL");
  async function bewaar(tool, uitslag, punten, site) {
    try { const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actie: "opslaan", tool, uitslag, punten, site: site || undefined, bron: location.pathname }) }); return (await r.json()).id; } catch { return null; }
  }
  function kosten(el) {
    el.innerHTML = `<form class="srt-form srt-reken">
      <div class="srt-velden srt-drie">
        <label><span>Hosting per maand</span><input name="host" type="number" min="0" step="1" value="15"></label>
        <label><span>Domeinnaam per jaar</span><input name="dom" type="number" min="0" step="1" value="15"></label>
        <label><span>Plugins, thema's en licenties per jaar</span><input name="lic" type="number" min="0" step="10" value="100"></label>
        <label><span>Wijzigingen per maand</span><input name="wijz" type="number" min="0" step="1" value="4"></label>
        <label><span>Uurtarief van je webbouwer</span><input name="tarief" type="number" min="0" step="5" value="75"></label>
        <label><span>Gemiddeld werk per wijziging (uur)</span><input name="uur" type="number" min="0" step="0.25" value="0.5"></label>
        <label><span>Onderhoud en updates per jaar (uur)</span><input name="ond" type="number" min="0" step="1" value="6"></label>
        <label><span>Je eigen tijd per wijziging (minuten)</span><input name="eigen" type="number" min="0" step="5" value="20"></label>
        <label><span>Wat is een uur van jou waard?</span><input name="jij" type="number" min="0" step="5" value="50"></label>
      </div></form><div class="srt-uit"></div>`;
    const f = el.querySelector("form"), uit = el.querySelector(".srt-uit");
    const reken = () => {
      const v = (n) => Math.max(0, Number(f[n].value) || 0);
      const vast = v("host") * 12 + v("dom") + v("lic"), werk = (v("wijz") * 12 * v("uur") + v("ond")) * v("tarief"), eigen = (v("wijz") * 12 * v("eigen") / 60) * v("jij");
      const tot = vast + werk + eigen;
      uit.innerHTML = `<div class="srt-uitslag"><div class="srt-kop"><div><span class="srt-label">Wat je website je per jaar kost</span><h3 class="srt-bedrag">${euro(tot)}</h3></div></div>
        <div class="srt-staaf">${[["Hosting, domein en licenties", vast], ["Webbouwer (wijzigingen en onderhoud)", werk], ["Je eigen tijd (uitleggen, nabellen, controleren)", eigen]].map(([n, b]) => `<div><span>${n}</span><div class="srt-balk"><i style="width:${tot ? (b / tot) * 100 : 0}%"></i><em>${euro(b)}</em></div></div>`).join("")}</div>
        <p class="srt-klein zacht">Bedragen excl. btw. Dit is een schatting op basis van wat je hebt ingevuld.</p>
        <div class="srt-cta"><div><b>Met Sitehulpje: ${euro(1500)} per jaar</b><span>€125 per maand excl. btw voor al je wijzigingen. Je typt of spreekt in wat er moet veranderen en het is meestal binnen een paar minuten klaar.</span></div><a class="knop" href="#" data-sr-naar>Laat Sitehulpje dit regelen →</a></div></div>`;
      uit.querySelector("[data-sr-naar]").onclick = async (ev) => { ev.preventDefault(); const id = await bewaar("kosten", { totaal: Math.round(tot) }, [{ titel: `Je website kost nu ongeveer ${euro(tot)} per jaar`, uitleg: `${v("wijz")} wijzigingen per maand` }]); location.href = `${BESTEL}?sh=1${id ? "&ref=check:" + id : ""}`; };
    };
    f.oninput = reken; reken();
  }
  function omzetverlies(el) {
    el.innerHTML = `<form class="srt-form srt-reken">
      <div class="srt-velden srt-drie">
        <label><span>Bezoekers per maand</span><input name="bez" type="number" min="0" step="50" value="1000"></label>
        <label><span>Hoeveel procent wordt klant of vraagt iets aan?</span><input name="conv" type="number" min="0" max="100" step="0.5" value="2"></label>
        <label><span>Wat levert een klant gemiddeld op?</span><input name="waarde" type="number" min="0" step="10" value="150"></label>
        <label><span>Hoe lang laadt je site nu? (seconden)</span><input name="nu" type="number" min="0" step="0.5" value="5"></label>
        <label><span>Snel is (seconden)</span><input name="doel" type="number" min="0" step="0.5" value="2"></label>
      </div>
      <p class="zacht srt-klein">Weet je niet hoe snel je site is? <a href="https://siteregelaar.nl/tools/snelheidstest">Doe eerst de snelheidstest</a>.</p></form><div class="srt-uit"></div>`;
    const f = el.querySelector("form"), uit = el.querySelector(".srt-uit");
    const reken = () => {
      const v = (n) => Math.max(0, Number(f[n].value) || 0);
      const sec = Math.max(0, v("nu") - v("doel")), verlies = Math.min(0.6, sec * 0.07);
      const nuKlanten = v("bez") * (v("conv") / 100), mis = (nuKlanten / Math.max(0.01, 1 - verlies)) - nuKlanten, bedrag = mis * v("waarde");
      uit.innerHTML = `<div class="srt-uitslag"><div class="srt-kop"><div><span class="srt-label">Wat je mogelijk misloopt door een trage site</span><h3 class="srt-bedrag">${euro(bedrag)} <small>per maand</small></h3></div></div>
        <div class="srt-duo"><div><span>Extra klanten per maand</span><b class="srt-groot">${mis.toFixed(1).replace(".", ",")}</b></div><div><span>Per jaar</span><b class="srt-groot">${euro(bedrag * 12)}</b></div></div>
        <p class="srt-klein zacht">Vuistregel: elke seconde extra laadtijd kost ongeveer 7% van je aanvragen. Dit is een schatting, geen garantie.</p>
        ${sec > 0 ? `<div class="srt-cta"><div><b>Je site kan ${sec.toString().replace(".", ",")} seconde sneller</b><span>Sitehulpje maakt je site sneller en houdt dat bij. Je berekening gaat mee naar je account.</span></div><a class="knop" href="#" data-sr-naar>Laat Sitehulpje dit oplossen →</a></div>` : `<div class="srt-cta srt-cta-goed"><b>Je site is al snel. Mooi zo!</b></div>`}</div>`;
      const k = uit.querySelector("[data-sr-naar]");
      if (k) k.onclick = async (ev) => { ev.preventDefault(); const id = await bewaar("omzetverlies", { bedrag: Math.round(bedrag), laadtijd: v("nu") }, [{ titel: `Site sneller maken: laadt nu in ${v("nu")} seconden`, uitleg: `Mogelijk ${euro(bedrag)} per maand misgelopen` }]); location.href = `${BESTEL}?sh=1${id ? "&ref=check:" + id : ""}`; };
    };
    f.oninput = reken; reken();
  }
  function qr(el) {
    el.innerHTML = `<form class="srt-form srt-reken"><div class="srt-velden">
        <label><span>Waar moet de QR-code naartoe?</span><input name="tekst" placeholder="https://www.jouwbedrijf.nl" value="https://"></label>
        <label><span>Kleur</span><select name="kleur"><option value="#0b1626">Donker</option><option value="#0b9f8a">Groen</option><option value="#2563eb">Blauw</option><option value="#000000">Zwart</option></select></label>
      </div><p class="zacht srt-klein">Tip: maak een QR-code naar je Google-reviewpagina en leg hem bij de kassa.</p></form><div class="srt-uit"></div>`;
    const f = el.querySelector("form"), uit = el.querySelector(".srt-uit");
    const teken = () => {
      const t = f.tekst.value.trim();
      if (!t || t === "https://" || typeof qrcode !== "function") { uit.innerHTML = ""; return; }
      const q = qrcode(0, "M"); q.addData(t); q.make();
      const n = q.getModuleCount(), m = 10, z = (n + 8) * m, c = document.createElement("canvas"); c.width = c.height = z;
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, z, z); x.fillStyle = f.kleur.value;
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect((k + 4) * m, (r + 4) * m, m, m);
      uit.innerHTML = `<div class="srt-uitslag srt-qr"><img alt="QR-code" src="${c.toDataURL("image/png")}" width="240" height="240"><div><b>Je QR-code is klaar</b><p class="zacht">Scan hem even met je telefoon om te testen. Werkt hij? Download hem en zet hem op je visitekaartje, flyer of raam.</p><a class="knop" download="qr-code.png" href="${c.toDataURL("image/png")}">Download (PNG)</a></div></div>`;
    };
    f.oninput = teken; teken();
  }

  window.SR_RENDER = { ring, itemsHtml, EXTRA, e };
  function start() {
    document.querySelectorAll("[data-sr-tool]").forEach((el) => {
      const tool = el.dataset.srTool, t = TOOLS[tool]; if (!t || el.dataset.klaar) return; el.dataset.klaar = "1"; el.classList.add("srt");
      if (tool === "kosten") return kosten(el);
      if (tool === "omzetverlies") return omzetverlies(el);
      if (tool === "qr") return qr(el);
      maakMeetTool(el, tool, t);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
