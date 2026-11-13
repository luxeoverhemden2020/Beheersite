// Sitehulpje – website koppelen. Eén scherm voor alle klanten (SEO en alleen-Sitehulpje).
// WordPress: één klik op Goedkeuren in de eigen WordPress. Andere systemen: uitnodigen, webbouwer, of "iets anders".
const VBSITE_API = "https://dauvsivoxfdfzurmyuug.supabase.co/functions/v1/vb-site";
const VBSITE_TEGELS = ["wordpress", "woocommerce", "shopify", "wix", "webflow", "lightspeed", "magento", "prestashop", "joomla", "squarespace", "ccvshop", "mijnwebwinkel", "jouwweb", "jimdo"];

async function vbSiteApi(actie, data = {}) {
  const r = await fetch(VBSITE_API, { method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": sessie() }, body: JSON.stringify({ actie, ...data }) })
    .catch(() => { throw new Error("Geen verbinding. Controleer je internet en probeer het opnieuw."); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.fout || "Er ging iets mis.");
  return d;
}

// el: waar het scherm komt. opties.klaar(): als de koppeling rond is of doorgegeven. opties.kader: eigen kaart eromheen.
async function vbSiteToon(el, klantId, opties = {}) {
  let d;
  try { d = await vbSiteApi("status", { klant_id: klantId }); }
  catch (e) { el.innerHTML = `<div class="melding fout">${esc(e.message)}</div>`; return null; }
  const S = d.systemen || {};
  const naam = (s) => S[s]?.naam || (typeof VBS_PLATFORM !== "undefined" && VBS_PLATFORM[s]) || s;
  const t = d.toegang;
  const gekozen = t?.systeem && !["onbekend", "anders", "weet_niet"].includes(t.systeem);
  const kies = opties.kies ?? !gekozen;
  const auto = ["wordpress", "woocommerce"].includes(d.systeem);
  const kader = (inhoud) => opties.kader ? `<div class="kaart vbsite"><h2 style="margin:0 0 8px"><span class="tag">&gt;_</span>Koppel je website</h2>${inhoud}</div>` : `<div class="vbsite">${inhoud}</div>`;
  const opnieuw = (o = {}) => vbSiteToon(el, klantId, { ...opties, ...o });

  // 1. Gekoppeld
  if (t?.status === "gekoppeld") {
    el.innerHTML = kader(`<div class="vbsite-ok"><span class="vbsite-vink">✓</span><div><b>Je website is gekoppeld.</b><br>
      <span class="zacht">Sitehulpje kan nu zelf aanpassingen doen die jij goedkeurt${t.gebruiker ? ` (via je account <b>${esc(t.gebruiker)}</b>)` : ""}. Bij elke aanpassing bewaren we eerst hoe het was, zodat alles terug kan.</span></div></div>
      <details class="vbs-alt"><summary>Koppeling stoppen</summary><p class="zacht">Daarna kan Sitehulpje niets meer op je website aanpassen.</p>
        <button class="knop rand klein" type="button" data-site-los>Ja, stop de koppeling</button></details><div data-site-meld></div>`);
    el.querySelector("[data-site-los]").onclick = async (e) => { e.target.disabled = true; try { await vbSiteApi("los", { klant_id: klantId }); opnieuw({ kies: false }); } catch (err) { vbSiteMeld(el, err.message); e.target.disabled = false; } };
    return d;
  }

  // 2. Doorgegeven, wacht op ons
  if (t?.status === "wacht" && !opties.kies) {
    const w = { sh_app: "Dank je! We zetten de koppeling voor je klaar. Je krijgt een mail met een knop om te installeren.", uitnodiging: "Dank je! We accepteren je uitnodiging en zetten de koppeling op. Je krijgt bericht als het klaar is.", webbouwer: "Dank je! We nemen contact op met je webbouwer.",
      anders: "Dank je! We kijken hoe we je website het beste kunnen koppelen en laten het je weten.", weet_niet: "Geen probleem! We zoeken het voor je uit en laten het je weten." };
    el.innerHTML = kader(`<div class="melding ok">${w[t.methode] || w.uitnodiging}</div>
      <p class="zacht vbs-klein" style="margin-top:8px"><button class="vbsite-link" type="button" data-site-anders>Toch een andere manier kiezen</button></p>`);
    el.querySelector("[data-site-anders]").onclick = () => opnieuw({ kies: true });
    return d;
  }

  // 3. Adres invullen en scannen (of zelf kiezen)
  if (kies) {
    const adres = (d.site || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    el.innerHTML = kader(`<label for="vbsite_url" style="margin-top:0"><b>Wat is het adres van je website?</b></label>
      <form class="rij vbsite-scan" data-site-scanform><input id="vbsite_url" class="vul" inputmode="url" autocomplete="url" value="${esc(adres)}" placeholder="www.jouwbedrijf.nl">
        <button class="knop" type="submit" data-site-scan>Scan</button></form>
      <p class="zacht vbs-klein" style="margin:6px 0 0">Sitehulpje kijkt zelf waarmee je website gemaakt is.</p>
      <div class="vbsite-bezig" data-site-bezig hidden><span class="vbsite-draai" aria-hidden="true"></span>Sitehulpje bekijkt je website…</div>
      <div class="melding fout" data-site-nietgevonden hidden style="margin-top:10px">We konden niet zien waarmee je website gemaakt is. Kies het hieronder zelf, of laat ons het uitzoeken.</div>
      <details class="vbs-alt" data-site-zelf ${opties.kies === true ? "open" : ""}><summary>Ik weet het zelf, laat me kiezen</summary>
      <div class="vbsite-tegels" style="margin-top:10px">${VBSITE_TEGELS.map((s) => `<button type="button" class="vbsite-tegel" data-site-kies="${s}">${esc(naam(s))}</button>`).join("")}
        <button type="button" class="vbsite-tegel" data-site-open="anders">Iets anders</button>
        <button type="button" class="vbsite-tegel" data-site-open="weet_niet">Weet ik niet</button></div>
      <div data-site-paneel="anders" hidden><label for="vbsite_sys">Welk systeem gebruik je?</label><div class="rij"><input id="vbsite_sys" class="vul" placeholder="Bijv. Drupal, Odoo of de sitebouwer van je hoster" maxlength="80">
        <button class="knop" type="button" data-site-door="anders">Doorgeven</button></div></div>
      <div data-site-paneel="weet_niet" hidden><p>Geen probleem: wij zoeken het voor je uit en laten je weten wat er nodig is.</p>
        <button class="knop" type="button" data-site-door="weet_niet">Ja, zoek het voor mij uit</button></div></details>
      <div data-site-meld></div>`);
    el.querySelector("[data-site-scanform]").onsubmit = async (e) => {
      e.preventDefault();
      const knop = el.querySelector("[data-site-scan]"), url = el.querySelector("#vbsite_url").value.trim();
      vbSiteMeld(el, "");
      if (!url) { vbSiteMeld(el, "Vul het adres van je website in."); return; }
      knop.disabled = true; el.querySelector("[data-site-bezig]").hidden = false; el.querySelector("[data-site-nietgevonden]").hidden = true;
      try {
        const r = await vbSiteApi("scan", { klant_id: klantId, url });
        if (r.gevonden) { vbSitePling(); opnieuw({ kies: false, gescand: true }); return; }
        el.querySelector("[data-site-nietgevonden]").hidden = false;
        el.querySelector("[data-site-zelf]").open = true;
      } catch (err) { vbSiteMeld(el, err.message); }
      knop.disabled = false; el.querySelector("[data-site-bezig]").hidden = true;
    };
    el.querySelectorAll("[data-site-kies]").forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { await vbSiteApi("kies", { klant_id: klantId, systeem: b.dataset.siteKies }); opnieuw({ kies: false }); }
      catch (err) { vbSiteMeld(el, err.message); b.disabled = false; }
    }));
    el.querySelectorAll("[data-site-open]").forEach((b) => (b.onclick = () => {
      el.querySelectorAll("[data-site-paneel]").forEach((p) => (p.hidden = p.dataset.sitePaneel !== b.dataset.siteOpen));
      el.querySelector(`[data-site-paneel="${b.dataset.siteOpen}"] input, [data-site-paneel="${b.dataset.siteOpen}"] button`)?.focus();
    }));
    vbSiteDoorgeven(el, klantId, opties);
    return d;
  }

  // 4s. Shopify: één klik op Installeren in de eigen Shopify
  if (d.systeem === "shopify") {
    const fout = t?.status === "fout" && t.melding ? `<div class="melding fout" style="margin-bottom:10px">${esc(t.melding)}</div>` : "";
    el.innerHTML = kader(`<div class="vbsite-gevonden${opties.gescand ? " pling" : ""}"><span class="vbsite-vink">✓</span><div>Je webshop is gemaakt met <b>Shopify</b><br><button class="vbsite-link zacht vbs-klein" type="button" data-site-wissel>Klopt niet?</button></div></div>
      ${fout}<p style="margin:0 0 10px">Klik op de knop, log in bij Shopify en klik op <b>Installeren</b>. Je deelt geen wachtwoord.</p>
      <button class="knop" type="button" data-sh-start>Koppel mijn webshop</button>
      <div data-sh-adres hidden style="margin-top:12px"><label for="vbsite_sh">Je Shopify-adres</label><input id="vbsite_sh" class="vul" placeholder="jouwwinkel.myshopify.com"><p class="zacht vbs-klein" style="margin:6px 0 0">Dit adres zie je in je Shopify-beheer onder Instellingen → Domeinen. Vul het in en klik nog een keer op de knop.</p></div>
      <div data-site-meld></div>`);
    el.querySelector("[data-site-wissel]").onclick = () => opnieuw({ kies: true });
    el.querySelector("[data-sh-start]").onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; vbSiteMeld(el, "");
      try {
        const r = await fetch(VBSITE_API.replace("vb-site", "vb-shopify"), { method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": sessie() }, body: JSON.stringify({ actie: "start", klant_id: klantId, winkel: el.querySelector("#vbsite_sh").value.trim() }) });
        const x = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(x.fout || "Er ging iets mis.");
        if (x.kan) { location.href = x.url; return; }
        if (x.wacht) { opnieuw({ kies: false }); return; }
        el.querySelector("[data-sh-adres]").hidden = false; vbSiteMeld(el, x.melding); b.disabled = false;
      } catch (err) { vbSiteMeld(el, err.message); b.disabled = false; }
    };
    return d;
  }

  // 4a. Magento: integratie met kopieerknoppen; Magento stuurt de sleutels zelf naar ons
  if (d.systeem === "magento") {
    const fout = t?.status === "fout" && t.melding ? `<div class="melding fout" style="margin-bottom:10px">${esc(t.melding)}</div>` : "";
    el.innerHTML = kader(`<div class="vbsite-gevonden${opties.gescand ? " pling" : ""}"><span class="vbsite-vink">✓</span><div>Je webshop is gemaakt met <b>Magento</b><br><button class="vbsite-link zacht vbs-klein" type="button" data-site-wissel>Klopt niet?</button></div></div>
      ${fout}<p style="margin:0 0 10px">Bij Magento koppel je Sitehulpje met een <b>integratie</b> in je eigen beheer. Dat kost een paar minuten en je deelt geen wachtwoord.</p>
      <div class="rij" style="flex-wrap:wrap;gap:8px"><button class="knop" type="button" data-mg-start>Zelf snel en simpel koppelen</button>
        <button class="knop rand" type="button" data-site-wb>Mijn webbouwer regelt het</button></div>
      <div data-mg-stappen hidden style="margin-top:12px"></div>
      <div data-site-paneel="webbouwer" hidden style="margin-top:12px"><label for="vbsite_wb">E-mailadres van je webbouwer</label>
        <div class="rij"><input id="vbsite_wb" class="vul" type="email" placeholder="naam@webbouwer.nl"><button class="knop klein" type="button" data-site-door="webbouwer">Stuur hem de uitleg</button></div>
        <p class="zacht vbs-klein" style="margin:6px 0 0">Sitehulpje mailt je webbouwer een kant-en-klare uitleg. Jij hoeft verder niets te doen.</p></div>
      <div data-site-meld></div>`);
    el.querySelector("[data-site-wissel]").onclick = () => opnieuw({ kies: true });
    el.querySelector("[data-site-wb]").onclick = () => { el.querySelector('[data-site-paneel="webbouwer"]').hidden = false; el.querySelector("#vbsite_wb").focus(); };
    el.querySelector("[data-mg-start]").onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try {
        const w = await vbSiteApi("mg_start", { klant_id: klantId });
        const box = el.querySelector("[data-mg-stappen]");
        const plaatje = (n, alt) => `<a href="assets/uitleg/magento-${n}.webp" target="_blank" rel="noopener"><img class="vbsite-img" src="assets/uitleg/magento-${n}.webp" alt="${alt}" loading="lazy"></a>`;
        box.innerHTML = `<ol class="vbs-ol vbsite-stappen">
          <li>Log in op het beheer van je webshop (vaak ${vbsKopie(w.beheer)}). Klik links op <b>Systeem</b> en dan op <b>Integraties</b>.${plaatje(1, "Menu Systeem, Integraties")}</li>
          <li>Klik rechtsboven op <b>Nieuwe integratie toevoegen</b>.${plaatje(2, "Knop Nieuwe integratie toevoegen")}</li>
          <li>Vul de vier velden in. Gebruik de kopieerknoppen:
            <div class="vbsite-velden"><div><span>Naam</span>${vbsKopie("Sitehulpje")}</div><div><span>E-mail</span>${vbsKopie("info@sitehulpje.nl")}</div>
            <div><span>Callback URL</span>${vbsKopie(w.callback)}</div><div><span>Identiteits link URL</span>${vbsKopie(w.identiteit)}</div></div>
            Bij <b>Je wachtwoord</b> typ je je eigen Magento-wachtwoord. Dat blijft in Magento.${plaatje(3, "Formulier Nieuwe integratie ingevuld")}</li>
          <li>Klik links op <b>API</b>, kies bij <b>Brontoegang</b> voor <b>Alles</b> en klik op <b>Opslaan</b>.${plaatje(4, "Tab API, Brontoegang Alles")}</li>
          <li>Je komt terug in de lijst met integraties. Klik bij Sitehulpje op <b>Activeren</b>.${plaatje(5, "Activeren in de lijst")}</li>
          <li>Er opent een venster. Klik rechtsboven op <b>Toestaan</b>.${plaatje(6, "Venster met knop Toestaan")}</li>
          <li>Er opent nog een klein venster met een groen vinkje. Dat sluit vanzelf. Klaar! Hier verschijnt dan ook een groen vinkje.
            <span class="zacht" style="display:block;margin-top:4px">Gebeurt er niets? Je browser blokkeert dan misschien een pop-upvenster. Sta pop-ups toe voor je webshop en klik opnieuw op Activeren.</span>${plaatje(7, "Venster: Je webshop is gekoppeld")}</li></ol>
          <div class="vbsite-bezig"><span class="vbsite-draai" aria-hidden="true"></span>We wachten tot je op Toestaan klikt…</div>`;
        box.hidden = false; b.hidden = true;
        box.querySelectorAll("[data-kopie]").forEach((k) => (k.onclick = async () => { try { await navigator.clipboard.writeText(k.dataset.kopie); k.textContent = "Gekopieerd"; setTimeout(() => (k.textContent = "Kopieer"), 1500); } catch { /* mag mislukken */ } }));
        // kijken of de koppeling rond is
        const kijk = async () => {
          if (!el.isConnected) return;
          try { const s = await vbSiteApi("status", { klant_id: klantId }); if (s.toegang?.getest && s.toegang.getest !== t?.getest && ["gekoppeld", "fout"].includes(s.toegang.status)) { vbSitePling(); opnieuw({ kies: false }); if (s.toegang.status === "gekoppeld" && opties.klaar) setTimeout(opties.klaar, 1800); return; } } catch { /* opnieuw proberen */ }
          setTimeout(kijk, 5000);
        };
        setTimeout(kijk, 5000);
      } catch (err) { vbSiteMeld(el, err.message); b.disabled = false; }
    };
    vbSiteDoorgeven(el, klantId, opties);
    return d;
  }

  // 4. Automatisch koppelen (WordPress / WooCommerce)
  const fout = t?.status === "fout" && t.melding ? `<div class="melding fout">${esc(t.melding)}</div>` : "";
  const handmatig = `<div class="vbsite-hand"${auto ? " hidden" : ""}>
      ${auto ? "" : `<p class="zacht" style="margin:0 0 8px">Voor ${esc(naam(d.systeem))} voeg je ons toe als gebruiker. Zo hoef je nooit je wachtwoord te delen:</p>`}
      ${typeof vbsWebsiteUitleg === "function" ? vbsWebsiteUitleg(d.systeem, d.site) : ""}
      <label for="vbsite_not">Opmerking (mag leeg)</label><input id="vbsite_not" placeholder="Bijv. een andere inlogpagina">
      <div class="rij" style="margin-top:10px;flex-wrap:wrap;gap:8px"><button class="knop${auto ? " rand" : ""}" type="button" data-site-door="gedaan">Gedaan, ik heb jullie toegevoegd</button>
        <button class="knop rand" type="button" data-site-wb>Mijn webbouwer regelt het</button></div>
      <div data-site-paneel="webbouwer" hidden style="margin-top:8px"><label for="vbsite_wb">E-mail of telefoon van je webbouwer</label>
        <div class="rij"><input id="vbsite_wb" class="vul"><button class="knop klein" type="button" data-site-door="webbouwer">Doorgeven</button></div></div></div>`;
  el.innerHTML = kader(`<div class="vbsite-gevonden${opties.gescand ? " pling" : ""}"><span class="vbsite-vink">✓</span><div>Je website is gemaakt met <b>${esc(naam(d.systeem))}</b><br><button class="vbsite-link zacht vbs-klein" type="button" data-site-wissel>Klopt niet?</button></div></div>
    ${auto ? `<p class="zacht" style="margin:0 0 12px">Je logt in op je eigen website en klikt op <b>Goedkeuren</b>. Daarna kan Sitehulpje voor je aan de slag. Je wachtwoord krijgen wij niet en je kunt de koppeling altijd weer stoppen.</p>
      ${fout}<div class="rij" style="flex-wrap:wrap;gap:8px"><button class="knop" type="button" data-site-wp>Koppel mijn website</button></div>
      <p class="zacht vbs-klein" style="margin-top:10px"><button class="vbsite-link" type="button" data-site-hand>Lukt het niet? Kies een andere manier</button></p>` : ""}
    ${handmatig}<div data-site-meld></div>`);
  el.querySelector("[data-site-wissel]").onclick = () => opnieuw({ kies: true });
  el.querySelector("[data-site-hand]")?.addEventListener("click", (e) => { el.querySelector(".vbsite-hand").hidden = false; e.target.hidden = true; });
  el.querySelector("[data-site-wb]").onclick = () => { el.querySelector('[data-site-paneel="webbouwer"]').hidden = false; el.querySelector("#vbsite_wb").focus(); };
  el.querySelector("[data-site-wp]")?.addEventListener("click", async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = "Even geduld…";
    try {
      const r = await vbSiteApi("wp_start", { klant_id: klantId });
      if (r.kan) { location.href = r.url; return; }
      vbSiteMeld(el, r.melding);
      el.querySelector(".vbsite-hand").hidden = false; b.hidden = true;
    } catch (err) { vbSiteMeld(el, err.message); b.disabled = false; b.textContent = "Koppel mijn website"; }
  });
  el.querySelectorAll("[data-kopie]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.kopie); b.textContent = "Gekopieerd"; setTimeout(() => (b.textContent = "Kopieer"), 1500); } catch { /* mag mislukken */ } }));
  vbSiteDoorgeven(el, klantId, opties);
  return d;
}

// Kort "pling"-geluidje bij een gevonden systeem (mag stil blijven als de browser het niet toestaat)
function vbSitePling() {
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const c = new C(), o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(880, c.currentTime); o.frequency.exponentialRampToValueAtTime(1320, c.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.15, c.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.45);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.5);
  } catch { /* geen geluid, geen probleem */ }
}

function vbSiteMeld(el, t) { const m = el.querySelector("[data-site-meld]"); if (!m) return; m.className = t ? "melding fout" : ""; m.style.marginTop = t ? "10px" : ""; m.textContent = t || ""; }

function vbSiteDoorgeven(el, klantId, opties) {
  el.querySelectorAll("[data-site-door]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try {
      await vbSiteApi("doorgeven", { klant_id: klantId, keuze: b.dataset.siteDoor, notitie: el.querySelector("#vbsite_not")?.value || "",
        webbouwer: el.querySelector("#vbsite_wb")?.value || "", systeem_tekst: el.querySelector("#vbsite_sys")?.value || "" });
      if (opties.klaar) opties.klaar(); else vbSiteToon(el, klantId, { ...opties, kies: false });
    } catch (err) { vbSiteMeld(el, err.message); b.disabled = false; }
  }));
}
