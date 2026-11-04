// Sitehulpje Vindbaarheid – startstappen (klant) en overzicht daarvan (beheer)
const VBS_API = "https://eiejxciyfcynppldonaw.supabase.co/functions/v1/vb-start";
const VBS_ADRES = "info@sitehulpje.nl";

async function vbsApi(actie, data = {}) {
  const r = await fetch(VBS_API, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": sessie() }, body: JSON.stringify({ actie, ...data }),
  }).catch(() => { throw new Error("Geen verbinding. Controleer je internet en probeer het opnieuw."); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.fout || "Er ging iets mis.");
  return d;
}

const VBS_PLATFORM = {
  wordpress: "WordPress", woocommerce: "WordPress met WooCommerce", shopify: "Shopify", wix: "Wix", magento: "Magento",
  lightspeed: "Lightspeed", squarespace: "Squarespace", jimdo: "Jimdo", ccvshop: "CCV Shop", mijnwebwinkel: "Mijnwebwinkel", webflow: "Webflow", onbekend: "een ander systeem",
};
const vbsKopie = (tekst) => `<span class="vbs-kopie"><code>${esc(tekst)}</code><button type="button" class="knop rand klein" data-kopie="${esc(tekst)}">Kopieer</button></span>`;

// Uitleg per systeem: altijd een aparte gebruiker voor ons, nooit een wachtwoord delen.
function vbsWebsiteUitleg(p, site) {
  const host = (site || "").replace(/\/$/, "");
  const wp = `<ol class="vbs-ol">
      <li>Log in op je website: ${vbsKopie(host + "/wp-admin")}</li>
      <li>Klik links in het menu op <b>Gebruikers</b> en daarna op <b>Nieuwe gebruiker</b>.</li>
      <li>Vul in: gebruikersnaam ${vbsKopie("sitehulpje")} en e-mail ${vbsKopie(VBS_ADRES)}</li>
      <li>Kies bij <b>Rol</b>: <b>Beheerder</b>. Laat het vinkje "Stuur de nieuwe gebruiker een e-mail" aan staan.</li>
      <li>Klik op <b>Nieuwe gebruiker toevoegen</b>. Klaar! Wij kiezen zelf een wachtwoord.</li></ol>`;
  const m = {
    wordpress: wp, woocommerce: wp,
    shopify: `<ol class="vbs-ol">
      <li>Log in op Shopify en ga naar <b>Instellingen</b> (linksonder) → <b>Gebruikers</b>.</li>
      <li>Klik op <b>Medewerker toevoegen</b> en vul in: ${vbsKopie(VBS_ADRES)}</li>
      <li>Geef toegang tot <b>Online winkel</b>, <b>Producten</b>, <b>Collecties</b> en <b>Apps</b>. Betalingen en uitbetalingen hoeven niet.</li>
      <li>Klik op <b>Uitnodiging versturen</b>.</li></ol>
      <p class="zacht">Krijg je van ons een <b>samenwerkingsverzoek</b>? Dan hoef je alleen dat verzoek goed te keuren, dat is nog makkelijker.</p>`,
    wix: `<ol class="vbs-ol">
      <li>Open je site in Wix en ga naar <b>Instellingen</b> → <b>Rollen en machtigingen</b>.</li>
      <li>Klik op <b>Mensen uitnodigen</b> en vul in: ${vbsKopie(VBS_ADRES)}</li>
      <li>Kies de rol <b>Beheerder (Admin)</b> en klik op <b>Uitnodiging versturen</b>.</li></ol>`,
    squarespace: `<ol class="vbs-ol">
      <li>Ga in Squarespace naar <b>Instellingen</b> → <b>Machtigingen en eigendom</b>.</li>
      <li>Klik op <b>Bijdrager uitnodigen</b>, vul ${vbsKopie(VBS_ADRES)} in en kies <b>Beheerder</b>.</li></ol>`,
    lightspeed: `<ol class="vbs-ol">
      <li>Ga in je Lightspeed-beheer naar <b>Instellingen</b> → <b>Gebruikers</b> (of Accounts).</li>
      <li>Voeg een gebruiker toe met ${vbsKopie(VBS_ADRES)} en geef rechten voor de webwinkel (producten, pagina's, SEO).</li></ol>`,
    magento: `<p>Bij Magento regelt meestal je webbouwer dit. Vraag of hij een beheerder aanmaakt voor ${vbsKopie(VBS_ADRES)} (Systeem → Rechten → Alle gebruikers).</p>`,
  };
  return m[p] || `<p>Maak in het beheer van je website een <b>aparte beheerder</b> aan voor ${vbsKopie(VBS_ADRES)}.
    Zoek naar een menu als <i>Gebruikers</i>, <i>Team</i> of <i>Rechten</i>. Weet je niet hoe het moet? Kies dan "Mijn webbouwer regelt het", dan nemen wij contact op.</p>`;
}

const VBS_DOEL = { bellen: "Bellen", formulier: "Contactformulier", offerte: "Offerte aanvragen", afspraak: "Afspraak maken", kopen: "Online kopen", langskomen: "Langskomen" };

function vbsStapInhoud(s, d, admin) {
  const g = d.gegevens || {};
  if (s.id === "bedrijf") {
    const b = g.bedrijf || {};
    const v = (id, label, waarde, opts = "") => `<div><label for="vbs_${id}">${label}</label><input id="vbs_${id}" name="${id}" value="${esc(waarde || "")}" ${opts}></div>`;
    return `<form class="vbs-form" data-stap="bedrijf">
      <div class="vbs-raster">
        ${v("naam", "Bedrijfsnaam *", b.naam || d.klant.naam, 'required autocomplete="organization"')}
        ${v("kvk", "KvK-nummer", b.kvk, 'inputmode="numeric" maxlength="8"')}
        ${v("straat", "Straat en huisnummer", b.straat, 'autocomplete="street-address"')}
        ${v("postcode", "Postcode", b.postcode, 'autocomplete="postal-code" maxlength="7"')}
        ${v("plaats", "Plaats *", b.plaats, 'required autocomplete="address-level2"')}
        ${v("telefoon", "Telefoon (zoals op je site)", b.telefoon, 'type="tel" autocomplete="tel"')}
        ${v("contact", "Contactpersoon", b.contact, 'autocomplete="name"')}
        ${v("btw", "Btw-nummer (voor de factuur)", b.btw)}
        ${v("factuur_email", "E-mail voor facturen *", b.factuur_email, 'type="email" required')}
        ${v("rapport_email", "E-mail voor het maandrapport", b.rapport_email, 'type="email" placeholder="Leeg = zelfde als facturen"')}
        ${v("branche", "Soort bedrijf", b.branche, 'placeholder="Bijv. schoonmaakbedrijf, kledingwinkel"')}
        <div><label for="vbs_bezoekadres">Kunnen klanten bij je langskomen?</label><select id="vbs_bezoekadres" name="bezoekadres">
          <option value="ja" ${b.bezoekadres !== "nee" ? "selected" : ""}>Ja, op dit adres</option><option value="nee" ${b.bezoekadres === "nee" ? "selected" : ""}>Nee, ik kom bij de klant of verkoop online</option></select></div>
      </div>
      <label for="vbs_openingstijden">Openingstijden</label><textarea id="vbs_openingstijden" name="openingstijden" rows="2" placeholder="Bijv. ma–vr 8:00–17:00, za 9:00–12:00">${esc(b.openingstijden || "")}</textarea>
      <label for="vbs_werkgebied">Werkgebied</label><input id="vbs_werkgebied" name="werkgebied" value="${esc(b.werkgebied || "")}" placeholder="Bijv. Hengelo, Enschede, Almelo en omgeving (30 km)">
      <p class="zacht vbs-klein">Waarom? Google en AI-diensten vertrouwen een bedrijf meer als naam, adres en telefoon overal precies hetzelfde zijn.</p>
      <div class="rij"><button class="knop">Opslaan en verder</button></div><div class="vbs-meld"></div></form>`;
  }
  if (s.id === "doelen") {
    const o = g.doelen || {};
    return `<form class="vbs-form" data-stap="doelen">
      <label for="vbs_diensten">Wat verkoop of doe je? *</label>
      <textarea id="vbs_diensten" name="diensten" rows="3" required placeholder="Eén per regel, het belangrijkste eerst. Bijv.&#10;Gevelreiniging&#10;Dakreiniging">${esc(o.diensten || "")}</textarea>
      <label for="vbs_zoekwoorden">Waarop wil je gevonden worden in Google?</label>
      <textarea id="vbs_zoekwoorden" name="zoekwoorden" rows="3" placeholder="Wat typen jouw klanten in? Eén per regel. Bijv.&#10;gevel reinigen hengelo&#10;dak schoonmaken prijs">${esc((o.zoekwoorden || []).join("\n"))}</textarea>
      <label for="vbs_concurrenten">Wie zijn je grootste concurrenten?</label>
      <textarea id="vbs_concurrenten" name="concurrenten" rows="2" placeholder="Websites, één per regel (mag ook leeg)">${esc((o.concurrenten || []).join("\n"))}</textarea>
      <label>Wat moet een bezoeker op je site doen?</label>
      <div class="vbs-vinkjes">${Object.entries(VBS_DOEL).map(([w, n]) => `<label class="vbs-vink"><input type="checkbox" name="doel" value="${w}" ${(o.doel || []).includes(w) ? "checked" : ""}> ${n}</label>`).join("")}</div>
      <label for="vbs_niet">Is er iets wat we níet mogen aanpassen?</label>
      <input id="vbs_niet" name="niet_aanpassen" value="${esc(o.niet_aanpassen || "")}" placeholder="Bijv. de teksten op de pagina Over ons">
      <label for="vbs_eerder">Heb je eerder iemand aan je vindbaarheid laten werken?</label>
      <input id="vbs_eerder" name="eerder_seo" value="${esc(o.eerder_seo || "")}" placeholder="Bijv. nee, of: ja, bureau X tot 2025">
      <label for="vbs_extra">Nog iets wat we moeten weten?</label>
      <textarea id="vbs_extra" name="extra" rows="2">${esc(o.extra || "")}</textarea>
      <div class="rij"><button class="knop">Opslaan en verder</button></div><div class="vbs-meld"></div></form>`;
  }
  if (s.id === "google") {
    if (s.status === "klaar") return `<p>Google is gekoppeld${d.google?.email ? ` met <b>${esc(d.google.email)}</b>` : ""}. De cijfers worden elke nacht opgehaald.</p>`;
    return `<p>Met één klik geef je ons <b>alleen leesrechten</b> op je cijfers in Google Search Console en Google Analytics. Je logt in bij Google zelf; wij zien je wachtwoord nooit.</p>
      <div class="rij"><button class="knop" type="button" data-vbs="google">Koppel Google</button></div>
      <details class="vbs-alt"><summary>Lukt het niet, of beheert iemand anders je Google-account?</summary>
        <p>Je kunt ons ook uitnodigen. Doe dit in allebei:</p>
        <ol class="vbs-ol">
          <li><b>Search Console</b> (search.google.com/search-console): Instellingen → Gebruikers en rechten → Gebruiker toevoegen → ${vbsKopie(VBS_ADRES)} → rechten <b>Volledig</b>.</li>
          <li><b>Analytics</b> (analytics.google.com): Beheer → Toegangsbeheer voor property → + → ${vbsKopie(VBS_ADRES)} → rol <b>Lezer</b>.</li>
        </ol>
        <p class="zacht vbs-klein">Heb je deze nog niet? Geen probleem: kies hieronder "Gedaan" en zet in de opmerking dat je ze nog niet hebt. Wij zetten ze dan voor je klaar.</p>
        <label for="vbs_gnot">Opmerking (mag leeg)</label><input id="vbs_gnot" data-notitie="google">
        <div class="rij" style="margin-top:8px"><button class="knop rand klein" type="button" data-vbs-gedaan="google" data-keuze="via_uitnodiging">Gedaan: ik heb jullie uitgenodigd</button></div>
      </details>${s.status === "wacht" ? `<div class="melding ok">Dank je! We accepteren de uitnodiging en koppelen het verder zelf.</div>` : ""}<div class="vbs-meld"></div>`;
  }
  if (s.id === "website") {
    const p = d.platform || "onbekend";
    const wacht = s.status === "wacht", klaar = s.status === "klaar";
    if (klaar) return `<p>We hebben toegang tot je website en alles werkt. Wij veranderen nooit iets zonder dat je het in Sitehulpje kunt zien.</p>`;
    return `<p>Om je website te verbeteren hebben we een <b>eigen account</b> nodig. Zo hoef je nooit je eigen wachtwoord te delen en kun je ons altijd weer verwijderen.</p>
      <p class="zacht">Je website draait op <b>${esc(VBS_PLATFORM[p] || p)}</b>${d.platform_info?.zeker ? "" : " (denken we)"}. Zo voeg je ons toe:</p>
      ${vbsWebsiteUitleg(p, d.klant.site)}
      ${wacht ? `<div class="melding ok">${s.info?.status === "webbouwer" ? "Dank je! We nemen contact op met je webbouwer." : "Dank je! We controleren of het werkt en melden ons als er iets niet lukt."}</div>` : ""}
      <label for="vbs_wnot">Opmerking (mag leeg)</label><input id="vbs_wnot" data-notitie="website" placeholder="Bijv. andere inlogpagina, of extra uitleg">
      <div class="rij" style="margin-top:10px">
        <button class="knop" type="button" data-vbs-gedaan="website" data-keuze="gedaan">Gedaan, ik heb jullie toegevoegd</button>
        <button class="knop rand" type="button" data-vbs-webbouwer>Mijn webbouwer regelt het</button></div>
      <div class="vbs-webbouwer verborgen"><label for="vbs_wb">E-mail of telefoon van je webbouwer</label><div class="rij"><input id="vbs_wb" class="vul"><button class="knop klein" type="button" data-vbs-gedaan="website" data-keuze="webbouwer">Doorgeven</button></div></div>
      <div class="vbs-meld"></div>`;
  }
  if (s.id === "profiel") {
    if (s.status === "klaar") return `<p>${s.info?.status === "geen_nodig" ? "Je hebt geen Bedrijfsprofiel nodig. Prima!" : "We beheren je Google Bedrijfsprofiel mee."}</p>`;
    return `<p>Je <b>Google Bedrijfsprofiel</b> is het blokje met je bedrijf in Google en Google Maps (met reviews, openingstijden en foto's). Voor lokaal gevonden worden is dit het belangrijkste wat er is.</p>
      <p><b>Heb je al een Bedrijfsprofiel?</b></p>
      <details class="vbs-alt" open><summary>Ja: voeg ons toe als beheerder</summary>
        <ol class="vbs-ol">
          <li>Zoek in Google op je bedrijfsnaam terwijl je bent ingelogd, of ga naar business.google.com.</li>
          <li>Klik bij je profiel op <b>⋮</b> (drie puntjes) → <b>Bedrijfsprofielinstellingen</b> → <b>Mensen en toegang</b>.</li>
          <li>Klik op <b>Toevoegen</b>, vul ${vbsKopie(VBS_ADRES)} in en kies de rol <b>Beheerder</b>. Klik op <b>Uitnodigen</b>.</li></ol>
        <div class="rij"><button class="knop" type="button" data-vbs-gedaan="profiel" data-keuze="gedaan">Gedaan</button></div></details>
      <div class="rij" style="margin-top:10px">
        <button class="knop rand" type="button" data-vbs-gedaan="profiel" data-keuze="aanmaken">Nee, maak er een voor mij</button>
        <button class="knop rand" type="button" data-vbs-gedaan="profiel" data-keuze="geen_nodig">Niet nodig (alleen online, geen werkgebied)</button></div>
      ${s.status === "wacht" ? `<div class="melding ok">${s.info?.status === "aanmaken" ? "We maken je profiel aan. Google stuurt soms een code per post of vraagt een korte video; we laten je weten wat er nodig is." : "Dank je! We accepteren de uitnodiging."}</div>` : ""}
      <div class="vbs-meld"></div>`;
  }
  if (s.id === "akkoord") {
    if (s.status === "klaar") return `<p>Bevestigd door ${esc(d.akkoord.naam)} op ${new Date(d.akkoord.datum).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}.</p>`;
    const pk = typeof vbPakket === "function" ? vbPakket(d.klant.pakket).naam : d.klant.pakket;
    return `<ul class="vbs-afspraken">
        <li><b>Pakket:</b> Vindbaarheid ${esc(pk)}${d.klant.prijs ? `, €${d.klant.prijs} per maand (excl. btw)` : ""}.</li>
        <li><b>Looptijd:</b> minimaal 3 maanden. Daarna per maand opzegbaar.</li>
        <li><b>Betalen:</b> de eerste (deel)maand betaal je met iDEAL; daarmee geef je ook toestemming voor de automatische incasso. Daarna gaat het elke maand vanzelf. Je krijgt de factuur een dag van tevoren, samen met je rapport.</li>
        <li><b>Geen garantie op een plek in Google:</b> niemand kan dat beloven. Wel doen we elke maand het werk uit je pakket en laten we precies zien wat het oplevert.</li>
        <li><b>Je gegevens:</b> we gebruiken ze alleen voor deze dienst en bewaren ze in de EU. Hoe we dat regelen staat in de verwerkersovereenkomst.</li></ul>
      ${admin ? `<p class="zacht">De klant bevestigt dit zelf in het eigen portaal.</p>` : `<form class="vbs-form" data-stap="akkoord">
        <label class="vbs-vink"><input type="checkbox" name="voorwaarden" required> Ik ga akkoord met de <a href="voorwaarden#vindbaarheid" target="_blank" rel="noopener">voorwaarden</a>.</label>
        <label class="vbs-vink"><input type="checkbox" name="verwerker" required> Ik ga akkoord met de <a href="verwerkersovereenkomst" target="_blank" rel="noopener">verwerkersovereenkomst</a>.</label>
        <label for="vbs_tnaam">Je volledige naam (als handtekening)</label><input id="vbs_tnaam" name="naam" required autocomplete="name">
        <div class="rij" style="margin-top:10px"><button class="knop">Akkoord en starten</button></div><div class="vbs-meld"></div></form>`}`;
  }
  return "";
}

async function vbStartToon(el, klantId, opties = {}) {
  let d;
  try { d = await vbsApi("status", { klant_id: klantId }); }
  catch (e) { el.innerHTML = opties.stil ? "" : `<div class="kaart"><div class="melding fout">${esc(e.message)}</div></div>`; return null; }
  const admin = !!klantId;
  if (d.klant_klaar && !opties.altijd) {
    el.innerHTML = "";
    return d;
  }
  const n = d.stappen.filter((s) => s.status !== "open").length;
  const eerste = d.stappen.find((s) => s.status === "open");
  const open = opties.open || eerste?.id;
  el.innerHTML = `<div class="kaart vbs">
    <div class="rij"><h2 class="vul" style="margin:0"><span class="tag">&gt;_</span>${d.klant_klaar ? "Startstappen" : "Zo gaan we van start"}</h2><span class="vbs-teller mono">${n} van ${d.stappen.length}</span></div>
    <div class="vbs-balk" role="progressbar" aria-valuemin="0" aria-valuemax="${d.stappen.length}" aria-valuenow="${n}"><span style="width:${(n / d.stappen.length) * 100}%"></span></div>
    <p class="zacht" style="margin:8px 0 4px">${d.klant_klaar ? "Alles is gedaan. Dank je wel!" : "Een paar dingen hebben we van je nodig. Je kunt tussendoor stoppen; wat je invult wordt bewaard."}</p>
    ${d.stappen.map((s, i) => `<details class="vbs-stap" data-st="${s.status}" data-id="${s.id}" ${s.id === open ? "open" : ""}>
      <summary><span class="vbs-nr">${s.status === "open" ? i + 1 : "✓"}</span><span class="vul">${esc(s.naam)}</span>
        <span class="vbs-label">${s.status === "klaar" ? "klaar" : s.status === "wacht" ? (admin ? "actie voor jou" : "doorgegeven") : "te doen"}</span></summary>
      <div class="vbs-inhoud">${vbsStapInhoud(s, d, admin)}</div></details>`).join("")}
  </div>`;

  const opnieuw = (volgende) => vbStartToon(el, klantId, { ...opties, open: volgende, altijd: true }).then((x) => { if (x?.klant_klaar && !opties.altijd && opties.klaar) opties.klaar(x); });
  const volgendeNa = (id) => { const i = d.stappen.findIndex((s) => s.id === id); return d.stappen.slice(i + 1).find((s) => s.status === "open")?.id; };

  el.querySelectorAll("[data-kopie]").forEach((b) => (b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.kopie); b.textContent = "Gekopieerd"; setTimeout(() => (b.textContent = "Kopieer"), 1500); } catch { /* kopiëren mag mislukken */ }
  }));
  el.querySelectorAll("form.vbs-form").forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    const knop = f.querySelector("button.knop"); knop.disabled = true;
    const meld = f.querySelector(".vbs-meld");
    const fd = new FormData(f);
    try {
      if (f.dataset.stap === "akkoord") {
        await vbsApi("akkoord", { voorwaarden: fd.get("voorwaarden") === "on", verwerker: fd.get("verwerker") === "on", naam: fd.get("naam") });
        // eerste (deel)maand met iDEAL betalen; dat geeft ook toestemming voor de automatische incasso (alleen als betalen aan staat)
        if (typeof vbfApi === "function") { try { const b = await vbfApi("eerste"); if (b.url) { location.href = b.url; return; } } catch { /* betalen nog niet aan */ } }
      } else {
        const g = Object.fromEntries(fd.entries());
        if (f.dataset.stap === "doelen") g.doel = fd.getAll("doel");
        await vbsApi("opslaan", { klant_id: klantId, stap: f.dataset.stap, gegevens: g });
      }
      opnieuw(volgendeNa(f.dataset.stap));
    } catch (err) { toonMelding(meld, err.message); knop.disabled = false; }
  }));
  el.querySelectorAll("[data-vbs-webbouwer]").forEach((b) => (b.onclick = () => el.querySelector(".vbs-webbouwer").classList.toggle("verborgen")));
  el.querySelectorAll("[data-vbs-gedaan]").forEach((b) => (b.onclick = async () => {
    const stap = b.dataset.vbsGedaan;
    const vak = b.closest(".vbs-inhoud");
    b.disabled = true;
    try {
      await vbsApi("gedaan", { klant_id: klantId, stap, keuze: b.dataset.keuze, notitie: vak.querySelector(`[data-notitie="${stap}"]`)?.value || "", webbouwer: vak.querySelector("#vbs_wb")?.value || "" });
      opnieuw(volgendeNa(stap));
    } catch (err) { toonMelding(vak.querySelector(".vbs-meld"), err.message); b.disabled = false; }
  }));
  el.querySelectorAll('[data-vbs="google"]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await vbApi("google_start", { klant_id: klantId }); location.href = r.url; }
    catch (err) { toonMelding(b.closest(".vbs-inhoud").querySelector(".vbs-meld"), err.message); b.disabled = false; }
  }));
  return d;
}

// ---------- beheer ----------
function vbsDagenGeleden(s) { if (!s) return null; return Math.floor((Date.now() - new Date(s).getTime()) / 86400000); }

async function vbStartOverzicht(el, opBekijk) {
  let d;
  try { d = await vbsApi("lijst"); } catch (e) { el.innerHTML = `<div class="melding fout">${esc(e.message)}</div>`; return; }
  const bezig = d.klanten.filter((k) => !k.alles_klaar);
  if (!bezig.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="kaart"><h2 style="font-size:16px"><span class="tag">&gt;_</span>Startstappen</h2>
    <div class="tabel-scroll"><table><thead><tr><th>Klant</th><th>Voortgang</th><th>Actie voor jou</th><th>Welkomstmail</th><th></th></tr></thead><tbody>
    ${bezig.map((k) => {
      const n = k.stappen.filter((s) => s.status !== "open").length;
      const jij = k.stappen.filter((s) => s.status === "wacht").map((s) => s.naam);
      const dg = vbsDagenGeleden(k.welkom_gestuurd);
      return `<tr><td><b>${esc(k.klant.naam)}</b><br><span class="zacht vb-klein">${esc(VBS_PLATFORM[k.platform] || k.platform || "")}</span></td>
        <td><div class="vbs-mini" title="${k.stappen.map((s) => s.naam + ": " + s.status).join("\n")}">${k.stappen.map((s) => `<span data-st="${s.status}"></span>`).join("")}</div><span class="zacht vb-klein">${n} van 6</span></td>
        <td>${jij.length ? `<span class="vb-af">${esc(jij.join(", "))}</span>` : `<span class="zacht">–</span>`}</td>
        <td>${k.welkom_gestuurd ? `<span class="zacht vb-klein">${dg === 0 ? "vandaag" : dg + " dagen geleden"}${k.herinnerd_7 ? " · 2 herinneringen" : k.herinnerd_2 ? " · 1 herinnering" : ""}</span>` : `<button class="knop klein" data-vbswelkom="${esc(k.klant.id)}">Sturen</button>`}</td>
        <td><button class="knop rand klein" data-vbsbekijk="${esc(k.klant.id)}">Bekijk</button></td></tr>`;
    }).join("")}</tbody></table></div><div class="vbs-meld"></div></div>`;
  el.querySelectorAll("[data-vbswelkom]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await vbsApi("welkom", { klant_id: b.dataset.vbswelkom }); toonMelding(el.querySelector(".vbs-meld"), r.ok ? "Welkomstmail verstuurd." : "Versturen lukte niet.", r.ok ? "ok" : "fout"); vbStartOverzicht(el, opBekijk); }
    catch (e) { toonMelding(el.querySelector(".vbs-meld"), e.message); b.disabled = false; }
  }));
  el.querySelectorAll("[data-vbsbekijk]").forEach((b) => (b.onclick = () => opBekijk && opBekijk(b.dataset.vbsbekijk)));
}

// Kaart in het detailscherm van een klant: wat Jan moet doen + de stappen zoals de klant ze ziet
async function vbStartBeheer(el, klantId) {
  el.innerHTML = `<div class="kaart"><p class="zacht">Laden…</p></div>`;
  let d;
  try { d = await vbsApi("status", { klant_id: klantId }); } catch (e) { el.innerHTML = `<div class="kaart"><div class="melding fout">${esc(e.message)}</div></div>`; return; }
  const s = Object.fromEntries(d.stappen.map((x) => [x.id, x]));
  const g = d.gegevens || {};
  const taken = [];
  if (s.website.status === "wacht") taken.push(`<li>Website (${esc(VBS_PLATFORM[d.platform] || d.platform)}): ${s.website.info?.status === "webbouwer" ? `webbouwer regelt het${s.website.info.webbouwer ? ` (<b>${esc(s.website.info.webbouwer)}</b>)` : ""}` : `klant heeft ${VBS_ADRES} toegevoegd. Accepteer de uitnodiging en zet het koppelstuk erop.`}
    ${s.website.info?.notitie ? `<br><span class="zacht">“${esc(s.website.info.notitie)}”</span>` : ""} <button class="knop klein" data-vbsbev="website">Toegang werkt</button></li>`);
  if (s.profiel.status === "wacht") taken.push(`<li>Bedrijfsprofiel: ${s.profiel.info?.status === "aanmaken" ? "aanmaken voor de klant" : "uitnodiging accepteren"}. <button class="knop klein" data-vbsbev="profiel">Geregeld</button></li>`);
  if (s.google.status === "wacht") taken.push(`<li>Google: klant heeft ons uitgenodigd${s.google.info?.notitie ? ` (“${esc(s.google.info.notitie)}”)` : ""}. Accepteer en koppel met de knop hieronder bij Koppelingen.</li>`);
  el.innerHTML = `<div class="kaart"><div class="rij"><h2 class="vul" style="font-size:16px;margin:0"><span class="tag">&gt;_</span>Startstappen</h2>
      <span class="zacht vb-klein">${d.stappen.filter((x) => x.status !== "open").length} van 6 · ${esc(VBS_PLATFORM[d.platform] || d.platform || "?")}</span>
      <button class="knop rand klein" data-vbsherken>Systeem opnieuw bepalen</button></div>
    ${taken.length ? `<p style="margin:10px 0 4px"><b>Voor jou</b></p><ul class="lijst">${taken.join("")}</ul>` : ""}
    ${g.bedrijf ? `<details class="vbs-alt"><summary>Gegevens van de klant</summary><div class="vbs-gegevens">
      ${[["Naam", g.bedrijf.naam], ["KvK", g.bedrijf.kvk], ["Adres", [g.bedrijf.straat, g.bedrijf.postcode, g.bedrijf.plaats].filter(Boolean).join(", ")], ["Telefoon", g.bedrijf.telefoon], ["Contact", g.bedrijf.contact],
         ["Facturen", g.bedrijf.factuur_email], ["Rapport", g.bedrijf.rapport_email], ["Btw", g.bedrijf.btw], ["Openingstijden", g.bedrijf.openingstijden], ["Werkgebied", g.bedrijf.werkgebied], ["Branche", g.bedrijf.branche],
         ["Diensten", g.doelen?.diensten], ["Zoekwoorden", (g.doelen?.zoekwoorden || []).join(", ")], ["Concurrenten", (g.doelen?.concurrenten || []).join(", ")], ["Doel", (g.doelen?.doel || []).map((x) => VBS_DOEL[x]).join(", ")],
         ["Niet aanpassen", g.doelen?.niet_aanpassen], ["Eerder SEO", g.doelen?.eerder_seo], ["Extra", g.doelen?.extra]]
        .filter(([, w]) => w).map(([l, w]) => `<div class="zacht">${l}</div><div>${esc(w).replace(/\n/g, "<br>")}</div>`).join("")}</div></details>` : ""}
    ${d.akkoord ? `<p class="zacht vb-klein">Akkoord: ${esc(d.akkoord.naam)}, ${new Date(d.akkoord.datum).toLocaleString("nl-NL")} (versie ${esc(d.akkoord.versie)}).</p>` : ""}
    <details class="vbs-alt"><summary>Stappen invullen namens de klant</summary><div data-vbsklant></div></details>
    <div class="vbs-meld"></div></div>`;
  const meldEl = el.querySelector(".vbs-meld");
  el.querySelectorAll("[data-vbsbev]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await vbsApi("bevestig", { klant_id: klantId, stap: b.dataset.vbsbev }); vbStartBeheer(el, klantId); } catch (e) { toonMelding(meldEl, e.message); b.disabled = false; }
  }));
  el.querySelector("[data-vbsherken]").onclick = async (e) => {
    e.target.disabled = true;
    try { await vbsApi("herken", { klant_id: klantId }); vbStartBeheer(el, klantId); } catch (err) { toonMelding(meldEl, err.message); e.target.disabled = false; }
  };
  const det = el.querySelector("details:last-of-type");
  det.addEventListener("toggle", () => { if (det.open) vbStartToon(det.querySelector("[data-vbsklant]"), klantId, { altijd: true }); }, { once: true });
}

// Klantpagina: eerst de startstappen (zolang die niet af zijn), daaronder het dashboard
function vbMetStart(el) {
  el.innerHTML = `<div data-vbs-start></div><div data-vbs-dash></div>`;
  vbStartToon(el.querySelector("[data-vbs-start]"), undefined, { stil: true });
  vbToon(el.querySelector("[data-vbs-dash]"));
}
