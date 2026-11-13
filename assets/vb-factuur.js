// Sitehulpje SEO-pakket – facturen (beheer) en pauzemelding (klant)
const VBF_API = "https://dauvsivoxfdfzurmyuug.supabase.co/functions/v1/vb-factuur";
async function vbfApi(actie, data = {}) {
  const r = await fetch(VBF_API, { method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": sessie() }, body: JSON.stringify({ actie, ...data }) })
    .catch(() => { throw new Error("Geen verbinding. Controleer je internet en probeer het opnieuw."); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.fout || "Er ging iets mis.");
  return d;
}
const vbfEuro = (n) => "€" + Number(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const VBF_STATUS = { concept: ["concept", "zacht"], open: ["open", "vb-let"], betaald: ["betaald", "vb-op"], teruggeboekt: ["teruggeboekt", "vb-af"], mislukt: ["niet betaald", "vb-af"] };

// Klantpagina: staat SEO op pauze door een openstaande factuur? Toon dan een melding met betaallink.
async function vbfPauzeMelding(el) {
  try {
    const s = await vbfApi("status");
    if (!s.pauze) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="melding let"><b>Je SEO-pakket staat op pauze.</b> ${s.open.length
      ? `Er staat nog een factuur open: ${s.open.map((f) => `${esc(f.nummer)} (${vbfEuro(f.totaal)})${f.betaallink ? ` · <a href="${esc(f.betaallink)}">Nu betalen</a>` : ""}`).join(", ")}. Na betaling gaat alles meteen weer verder.`
      : "Neem contact op met Jan via info@sitehulpje.nl."}</div>`;
  } catch { el.innerHTML = ""; }
}

// Beheer: alle facturen, pauzes en het kwartaaloverzicht
async function vbfBeheer(el) {
  let d;
  try { d = await vbfApi("lijst"); } catch (e) { el.innerHTML = `<div class="kaart"><div class="melding fout">${esc(e.message)}</div></div>`; return; }
  const modusTekst = d.modus === "aan" ? `<span class="vb-op">● Aan</span>: echte facturen en automatische incasso via Mollie.`
    : `<span class="vb-let">● Concept</span>: facturen worden alleen als concept gemaakt, er wordt niets verstuurd of afgeschreven.`;
  el.innerHTML = `<div class="kaart"><div class="rij"><h2 class="vul" style="font-size:16px;margin:0"><span class="tag">&gt;_</span>Facturen en betalingen</h2>
      ${d.modus === "aan" ? `<button class="knop rand klein" data-vbfmodus="concept">Terug naar concept</button>`
        : `<button class="knop klein" data-vbfmodus="aan" ${d.mollie ? "" : "disabled title=\"Eerst de Mollie-sleutel instellen\""}>Facturen en incasso aanzetten</button>`}</div>
    <p class="zacht vb-klein" style="margin:6px 0">${modusTekst} ${d.mollie ? "Mollie is gekoppeld." : "Mollie is nog niet gekoppeld (sleutel MOLLIE_API_KEY in Supabase)."} Elke maand op de 2e worden de facturen gemaakt, samen met het rapport.</p>
    ${d.pauzes.length ? `<div class="melding let"><b>Op pauze:</b> ${d.pauzes.map((k) => `${esc(k.naam)} <span class="zacht">(${esc(k.vb_pauze_reden || "")})</span> <button class="knop rand klein" data-vbfhervat="${esc(k.id)}">Pauze opheffen</button>`).join(" · ")}</div>` : ""}
    ${d.facturen.length ? `<div class="tabel-scroll"><table><thead><tr><th>Nummer</th><th>Klant</th><th>Omschrijving</th><th class="r">Totaal</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.facturen.map((f) => { const [t, c] = VBF_STATUS[f.status] || [f.status, ""]; return `<tr>
        <td class="mono">${esc(f.nummer || "–")}</td><td>${esc(f.naam)}</td><td class="vb-klein">${esc(f.omschrijving)}</td><td class="r mono">${vbfEuro(f.totaal)}</td>
        <td><span class="${c}">${t}</span>${f.betaald_via === "handmatig" ? ` <span class="zacht vb-klein">(handmatig)</span>` : ""}</td>
        <td><div class="rij"><a class="knop rand klein" href="factuur?beheer=1&id=${esc(f.id)}">Bekijk</a>
          ${["open", "teruggeboekt", "mislukt"].includes(f.status) ? `<button class="knop rand klein" data-vbfbetaald="${esc(f.id)}">Betaald (buiten Mollie)</button>` : ""}
          ${f.aanmaning && !f.incasso_gestuurd && f.status !== "betaald" ? `<button class="knop klein" data-vbfincasso="${esc(f.id)}">Naar incasso sturen</button>` : ""}
          ${f.incasso_gestuurd ? `<span class="zacht vb-klein">bij incassobureau</span>` : ""}</div></td></tr>`; }).join("")}
      </tbody></table></div>` : `<p class="zacht">Nog geen facturen. De eerste worden gemaakt zodra een klant akkoord heeft gegeven.</p>`}
    <details class="vbs-alt"><summary>Incassobureau ${d.incasso_email ? `<span class="zacht">(${esc(d.incasso_email)}${d.incasso_auto ? ", automatisch" : ""})</span>` : `<span class="zacht">(nog niet ingesteld)</span>`}</summary>
      <p class="zacht vb-klein" style="margin:6px 0">Niet betaald na herinneringen op dag 7 en 14 en een laatste aanmaning op dag 21? Dan staat op dag 28 het dossier klaar voor het incassobureau.</p>
      <div class="rij"><input id="vbfincmail" type="email" class="vul" placeholder="E-mailadres van het incassobureau" value="${esc(d.incasso_email || "")}" style="min-width:220px">
        <label class="vbs-vink" style="margin:0"><input type="checkbox" id="vbfincauto" ${d.incasso_auto ? "checked" : ""}> Automatisch doorsturen</label>
        <button class="knop rand klein" id="vbfincopslaan">Opslaan</button></div></details>
    <details class="vbs-alt"><summary>Kwartaaloverzicht voor de btw-aangifte</summary>
      <div class="rij" style="margin-top:8px"><select id="vbfkw" style="width:auto">${[1, 2, 3, 4].map((q) => `<option value="${q}" ${q === Math.ceil((new Date().getMonth() + 1) / 3) ? "selected" : ""}>Kwartaal ${q}</option>`).join("")}</select>
        <input id="vbfjaar" type="number" value="${new Date().getFullYear()}" style="width:100px"><button class="knop rand klein" id="vbfkwtoon">Toon</button></div>
      <div id="vbfkwuit"></div></details>
    <div class="vbs-meld"></div></div>`;
  const meld = el.querySelector(".vbs-meld");
  el.querySelectorAll("[data-vbfmodus]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await vbfApi("modus", { modus: b.dataset.vbfmodus }); vbfBeheer(el); } catch (e) { toonMelding(meld, e.message); b.disabled = false; }
  }));
  el.querySelectorAll("[data-vbfbetaald]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await vbfApi("handmatig_betaald", { id: b.dataset.vbfbetaald }); toonMelding(meld, r.hervat ? "Op betaald gezet. De pauze is eraf." : "Op betaald gezet.", "ok"); vbfBeheer(el); }
    catch (e) { toonMelding(meld, e.message); b.disabled = false; }
  }));
  el.querySelectorAll("[data-vbfhervat]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await vbfApi("pauze", { klant_id: b.dataset.vbfhervat, aan: false }); vbfBeheer(el); } catch (e) { toonMelding(meld, e.message); b.disabled = false; }
  }));
  el.querySelectorAll("[data-vbfincasso]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await vbfApi("naar_incasso", { id: b.dataset.vbfincasso }); toonMelding(meld, "Dossier naar het incassobureau gestuurd. Je krijgt een kopie.", "ok"); vbfBeheer(el); }
    catch (e) { toonMelding(meld, e.message); b.disabled = false; }
  }));
  el.querySelector("#vbfincopslaan").onclick = async (e) => {
    e.target.disabled = true;
    try { await vbfApi("incasso_instellen", { adres: el.querySelector("#vbfincmail").value, auto: el.querySelector("#vbfincauto").checked }); vbfBeheer(el); }
    catch (err) { toonMelding(meld, err.message); e.target.disabled = false; }
  };
  el.querySelector("#vbfkwtoon").onclick = async () => {
    const uit = el.querySelector("#vbfkwuit");
    try {
      const k = await vbfApi("kwartaal", { kwartaal: el.querySelector("#vbfkw").value, jaar: el.querySelector("#vbfjaar").value });
      const csv = [["Nummer", "Datum", "Klant", "Omschrijving", "Excl. btw", "Btw", "Totaal", "Status"].join(";"),
        ...k.rijen.map((r) => [r.nummer, r.datum.slice(0, 10), r.klant, r.omschrijving, Number(r.bedrag_excl).toFixed(2).replace(".", ","), Number(r.btw).toFixed(2).replace(".", ","), Number(r.totaal).toFixed(2).replace(".", ","), r.status].map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";"))].join("\n");
      uit.innerHTML = `<p style="margin:10px 0 4px">${k.rijen.length} facturen in Q${k.kwartaal} ${k.jaar}. Omzet excl. btw <b class="mono">${vbfEuro(k.som.excl)}</b>, btw <b class="mono">${vbfEuro(k.som.btw)}</b> (rubriek 1a), totaal <b class="mono">${vbfEuro(k.som.totaal)}</b>.</p>
        ${k.rijen.length ? `<button class="knop rand klein" id="vbfcsv">Download als Excel-bestand (CSV)</button>` : ""}`;
      const knop = uit.querySelector("#vbfcsv");
      if (knop) knop.onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = `facturen-Q${k.kwartaal}-${k.jaar}.csv`; a.click(); };
    } catch (e) { uit.innerHTML = `<div class="melding fout">${esc(e.message)}</div>`; }
  };
}

// Beheer: abonnement van een klant bekijken, persoonlijke korting instellen, opzegging zien of terugdraaien
// abonnement en persoonlijke korting van één klant (in de klantpagina van beheer)
async function vbfAbonnementVoor(uit, id) {
  uit.innerHTML = '<p class="zacht">Laden…</p>';
  let d; try { d = await vbfApi("abonnement", { klant_id: id }); } catch (err) { uit.innerHTML = `<div class="melding fout">${esc(err.message)}</div>`; return; }
  if (!d.delen.length) { uit.innerHTML = '<p class="zacht">Deze klant heeft geen abonnement via het factuursysteem.</p>'; return; }
  const soort = d.korting_pct ? "procent" : d.korting_eur ? "bedrag" : "geen";
  uit.innerHTML = `<table><tbody>${d.delen.map((x) => `<tr><td>${esc(x.naam)}</td><td class="r mono">${vbfEuro(x.prijs)}</td><td class="zacht vb-klein">${x.minEind ? "minimaal t/m " + new Date(x.minEind).toLocaleDateString("nl-NL") : "per maand opzegbaar"}</td></tr>`).join("")}
    ${d.korting ? `<tr><td>Persoonlijke korting</td><td class="r mono vb-op">–${vbfEuro(d.korting)}</td><td></td></tr>` : ""}
    <tr><td><b>Per maand excl. btw</b></td><td class="r mono"><b>${vbfEuro(d.netto)}</b></td><td></td></tr></tbody></table>
    ${d.opzeg_per ? `<div class="melding fout" style="margin-top:10px">Opgezegd per ${new Date(d.opzeg_per).toLocaleDateString("nl-NL")} (${esc((d.opzeg_wat || []).join(", "))}). <button class="knop rand klein" id="vbfab_terug">Opzegging terugdraaien</button></div>` : ""}
    <form id="vbfab_form" class="rij" style="gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:12px">
      <div><label class="vb-klein">Korting</label><select id="vbfab_soort" style="width:auto">
        <option value="geen"${soort === "geen" ? " selected" : ""}>Geen</option><option value="bedrag"${soort === "bedrag" ? " selected" : ""}>Vast bedrag per maand (€)</option><option value="procent"${soort === "procent" ? " selected" : ""}>Percentage (%)</option></select></div>
      <div><label class="vb-klein">Hoeveel</label><input id="vbfab_w" inputmode="decimal" style="width:110px" value="${esc(d.korting_pct || d.korting_eur || "")}"></div>
      <div><label class="vb-klein">Tot en met (mag leeg)</label><input id="vbfab_tot" type="date" style="width:auto" value="${esc(d.korting_tot ? String(d.korting_tot).slice(0, 10) : "")}"></div>
      <div style="flex:1;min-width:160px"><label class="vb-klein">Reden (komt op de factuur, mag leeg)</label><input id="vbfab_reden" maxlength="80" value="${esc(d.korting_reden || "")}" placeholder="bijv. vaste klant"></div>
      <button class="knop klein">Opslaan</button></form><div id="vbfab_meld"></div>`;
  $("#vbfab_form").onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const r = await vbfApi("korting", { klant_id: id, soort: $("#vbfab_soort").value, waarde: $("#vbfab_w").value, tot: $("#vbfab_tot").value, reden: $("#vbfab_reden").value });
      toonMelding($("#vbfab_meld"), r.korting ? `Opgeslagen. Nieuw maandbedrag: ${vbfEuro(r.netto)} excl. btw (was ${vbfEuro(r.bruto)}).` : `Opgeslagen. Geen korting: ${vbfEuro(r.netto)} per maand excl. btw.`, "ok");
      setTimeout(() => vbfAbonnementVoor(uit, id), 1800);
    } catch (err) { toonMelding($("#vbfab_meld"), err.message); }
  };
  const t = $("#vbfab_terug"); if (t) t.onclick = async () => { try { await vbfApi("opzeg_terug", { klant_id: id }); vbfAbonnementVoor(uit, id); } catch (err) { toonMelding($("#vbfab_meld"), err.message); } };
}

// Klant: abonnement bekijken en opzeggen (onopvallend onder het account)
async function vbfOpzegKlant(el) {
  let d; try { d = await vbfApi("abonnement"); } catch { el.innerHTML = ""; return; }
  if (!d.delen.length) { el.innerHTML = ""; return; }
  const datum = (s) => new Date(s).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  // pakket = Sitehulpje Basis/Plus/Pro (Sitehulpje zit erin); vindbaarheid + sitehulpje = oude losse opzet
  const BUN = { basis: ["Basis", 169], plus: ["Plus", 239], pro: ["Pro", 369] }, OUD = { basis: ["Basis", 99], plus: ["Plus", 179], pro: ["Pro", 249] };
  const pkDeel = d.delen.find((x) => x.id === "pakket"), vb = d.delen.find((x) => x.id === "vindbaarheid"), sh = pkDeel || d.delen.find((x) => x.id === "sitehulpje");
  const PK = pkDeel ? BUN : OUD, hoofd = pkDeel || vb;
  const huidig = hoofd ? Object.keys(PK).find((p) => hoofd.naam.endsWith(PK[p][0])) : null;
  const kleiner = huidig === "pro" ? "plus" : huidig === "plus" ? "basis" : null;
  const wissel = [
    ...(huidig ? Object.keys(PK).filter((p) => p !== huidig).map((p) => `<button class="knop rand klein vbo_pk" data-pk="${p}">Naar ${pkDeel ? "Sitehulpje " : ""}${PK[p][0]} (€${PK[p][1]})</button>`) : []),
    ...(!sh ? [`<button class="knop klein" id="vbo_sh">${vb && huidig ? `Stap over naar Sitehulpje ${BUN[huidig][0]} (€${BUN[huidig][1]}, eerste jaar 10% korting)` : "Sitehulpje erbij (€125)"}</button>`] : []),
  ];
  el.innerHTML = `<details class="kaart abonnement"><summary>Abonnement</summary>
    <table style="margin-top:8px"><tbody>${d.delen.map((x) => `<tr><td>${esc(x.naam)}</td><td class="r mono">${vbfEuro(x.prijs)} /mnd</td></tr>`).join("")}
    ${d.korting ? `<tr><td>Persoonlijke korting</td><td class="r mono">–${vbfEuro(d.korting)}</td></tr>` : ""}</tbody></table>
    ${d.komend ? `<p class="vb-klein" style="margin:6px 0 0">Volgende maand: ${d.komend.korting ? `<b>${esc(d.komend.reden || "korting")}</b>, je betaalt ${vbfEuro(d.komend.netto)}` : `weer ${vbfEuro(d.komend.netto)}`}.</p>` : ""}
    <p class="zacht vb-klein">Prijzen exclusief btw. De factuur krijg je elke maand per mail.</p>
    ${wissel.length && !d.opzeg_per ? `<details style="margin-top:8px"><summary class="zacht vb-klein">Abonnement aanpassen</summary>
      <p class="vb-klein">Een ander pakket gaat meteen in. Vanaf de volgende factuur betaal je het nieuwe bedrag.</p><div style="display:flex;flex-wrap:wrap;gap:8px">${wissel.join("")}</div>
      ${!sh ? `<p class="zacht vb-klein">Sitehulpje: je website aanpassen door het gewoon te vragen. Minimaal 3 maanden.</p>` : ""}</details>` : ""}
    ${d.opzeg_per ? `<p>Je hebt opgezegd per <b>${datum(d.opzeg_per)}</b>. Tot die dag loopt alles gewoon door.</p><button class="knop rand klein" id="vbo_terug">Toch niet opzeggen</button>`
      : `<details style="margin-top:8px"><summary class="zacht vb-klein">Opzeggen</summary>
        <p class="vb-klein">Opzeggen kan per het einde van de maand, na een minimale looptijd van 3 maanden.</p>
        ${d.delen.map((x) => `<label class="vb-klein" style="display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" value="${x.id}" class="vbo_wat" style="width:auto"${d.delen.length === 1 ? " checked" : ""}> ${esc(x.naam)}</label>`).join("")}
        <label class="vb-klein" for="vbo_reden">Waarom stop je? (mag leeg, helpt ons beter te worden)</label><textarea id="vbo_reden" rows="2"></textarea>
        <div class="vb-aanbod" id="vbo_aanbod" hidden><b>Voordat je gaat…</b>
          <p class="vb-klein" style="margin:6px 0 0">Even geen budget of tijd? Kies dan een <b>pauzemaand</b>: volgende maand betaal je niets en blijft alles werken.${kleiner ? ` Of stap over naar <b>${PK[kleiner][0]}</b> voor €${PK[kleiner][1]} per maand.` : ""}</p>
          <div class="rij"><button class="knop klein" id="vbo_pauze">Pauzemaand nemen</button>${kleiner ? `<button class="knop rand klein vbo_pk" data-pk="${kleiner}">Naar ${PK[kleiner][0]}</button>` : ""}<button class="knop rand klein" id="vbo_toch">Nee, toch opzeggen</button></div></div>
        <button class="knop rand klein" id="vbo_knop" style="margin-top:6px">Opzeggen</button></details>`}
    <div id="vbo_meld"></div></details>`;
  const meld = (t, soort) => toonMelding($("#vbo_meld"), t, soort);
  const herlaad = () => setTimeout(() => vbfOpzegKlant(el).then(() => { const dd = el.querySelector("details.abonnement"); if (dd) dd.open = true; }), 2500);
  const opzeg = async (k) => {
    const wat = [...el.querySelectorAll(".vbo_wat:checked")].map((x) => x.value);
    if (!wat.length) { meld("Kies wat je wilt opzeggen."); return; }
    k.disabled = true;
    try {
      const r = await vbfApi("opzeggen", { wat, reden: $("#vbo_reden").value });
      if (r.te_vroeg) meld(`${r.naam} loopt minimaal 3 maanden. Vanaf ${datum(r.vanaf)} kun je opzeggen; het stopt dan op ${datum(r.eind)}. We hebben je dit ook gemaild.`);
      else { meld(`Opgezegd per ${datum(r.per)}. Je krijgt een bevestiging per mail.`, "ok"); herlaad(); }
    } catch (e) { meld(e.message); }
    k.disabled = false;
  };
  const k = $("#vbo_knop");
  if (k) k.onclick = () => {
    const wat = [...el.querySelectorAll(".vbo_wat:checked")].map((x) => x.value);
    if (!wat.length) { meld("Kies wat je wilt opzeggen."); return; }
    // eerst een aanbod laten zien (pauzemaand of kleiner pakket); daarna pas echt opzeggen
    if (!d.korting && $("#vbo_aanbod").hidden) { $("#vbo_aanbod").hidden = false; k.hidden = true; return; }
    opzeg(k);
  };
  const toch = $("#vbo_toch"); if (toch) toch.onclick = () => opzeg(toch);
  const pauze = $("#vbo_pauze");
  if (pauze) pauze.onclick = async () => {
    pauze.disabled = true;
    try { const r = await vbfApi("pauzemaand"); meld(`Geregeld! In ${r.maand} betaal je niets. Je krijgt een bevestiging per mail.`, "ok"); herlaad(); }
    catch (e) { meld(e.message); pauze.disabled = false; }
  };
  el.querySelectorAll(".vbo_pk").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { const r = await vbfApi("wissel", { pakket: b.dataset.pk }); meld(`Aangepast naar ${r.naam}. Je krijgt een bevestiging per mail.`, "ok"); herlaad(); }
    catch (e) { meld(e.message); b.disabled = false; }
  });
  const shk = $("#vbo_sh");
  if (shk) shk.onclick = async () => {
    shk.disabled = true;
    try { await vbfApi("wissel", { sitehulpje: true }); meld("Sitehulpje staat aan. We sturen je een mail; daarna zetten we samen de koppeling met je website klaar.", "ok"); setTimeout(() => location.reload(), 2500); }
    catch (e) { meld(e.message); shk.disabled = false; }
  };
  const t = $("#vbo_terug");
  if (t) t.onclick = async () => { try { await vbfApi("opzeg_terug"); vbfOpzegKlant(el); } catch (e) { meld(e.message); } };
}

// ---------- losse klussen (vaste prijs, meteen betalen) ----------
const VBG_API = VBF_API.replace(/vb-factuur$/, "vb-groei");
async function vbgApi(actie, data = {}) {
  const r = await fetch(VBG_API, { method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": sessie() }, body: JSON.stringify({ actie, ...data }) })
    .catch(() => { throw new Error("Geen verbinding. Controleer je internet en probeer het opnieuw."); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.fout || "Er ging iets mis.");
  return d;
}
async function vbfKlussen(el) {
  // alleen voor klanten met het SEO-pakket zonder webbeheer; met webbeheer vraag je dit gewoon als verzoek
  let d, ab; try { [d, ab] = await Promise.all([vbgApi("klussen"), vbfApi("abonnement")]); } catch { el.innerHTML = ""; return; }
  const ids = (ab.delen || []).map((x) => x.id);
  if (!d.klussen?.length || !ids.includes("vindbaarheid") || ids.includes("sitehulpje")) { el.innerHTML = ""; return; }
  const betaald = new URLSearchParams(location.search).get("klus") === "betaald";
  el.innerHTML = `<div class="kaart"><h2><span class="tag">+</span>Losse klussen</h2>
    ${betaald ? `<div class="melding ok" style="margin-bottom:10px">Bedankt! Je betaling is binnen. Jan neemt binnen één werkdag contact met je op.</div>` : ""}
    <p class="zacht" style="margin-top:0">Iets extra's op je website? Kies een klus, vertel kort wat je wilt en betaal met iDEAL. Sitehulpje gaat er meteen mee aan de slag.</p>
    <p class="zacht vb-klein" style="margin-top:0">Vaker iets nodig? Met <b>Sitehulpje</b> in je pakket vraag je dit soort dingen gewoon, zonder losse kosten. Dat zet je aan bij Abonnement hieronder.</p>
    <div class="klus-lijst">${d.klussen.map((x) => `<div class="klus"><b>${esc(x.naam)}</b>${x.uitleg ? `<span class="zacht vb-klein">${esc(x.uitleg)}</span>` : ""}
      <span class="prijs">€${Number(x.prijs).toLocaleString("nl-NL")} <span class="zacht vb-klein" style="font-weight:400">excl. btw</span></span>
      <button class="knop rand klein vbk_kies" data-id="${esc(x.id)}" style="margin-top:auto">Bestellen</button>
      <div class="vbk_form" hidden><label class="vb-klein">Wat wil je precies? Waar gaat het over?</label><textarea rows="2" class="vbk_tekst"></textarea>
        <button class="knop klein vbk_betaal" style="margin-top:6px">Betaal €${(Number(x.prijs) * 1.21).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} incl. btw &rarr;</button><div class="vbk_meld"></div></div></div>`).join("")}</div></div>`;
  if (betaald) history.replaceState(null, "", location.pathname + location.hash);
  el.querySelectorAll(".klus").forEach((kaart) => {
    const kies = kaart.querySelector(".vbk_kies"), form = kaart.querySelector(".vbk_form"), betaal = kaart.querySelector(".vbk_betaal");
    kies.onclick = () => { form.hidden = false; kies.hidden = true; kaart.querySelector(".vbk_tekst").focus(); };
    betaal.onclick = async () => {
      betaal.disabled = true;
      try { const r = await vbfApi("klus", { klus: kies.dataset.id, toelichting: kaart.querySelector(".vbk_tekst").value }); if (r.url) location.href = r.url; else throw new Error("Betalen kon niet starten."); }
      catch (e) { toonMelding(kaart.querySelector(".vbk_meld"), e.message); betaal.disabled = false; }
    };
  });
}

// ---------- vriend-voordeel: link om te delen ----------
async function vbfVriend(el) {
  let d; try { d = await vbgApi("vriend"); } catch { el.innerHTML = ""; return; }
  if (!d.pct) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="kaart"><h2><span class="tag">🎁</span>Tip een ondernemer</h2>
    <p class="zacht" style="margin-top:0">Ken je iemand die ook meer uit zijn website wil halen? Deel je eigen link. Bestelt diegene, dan krijgen jullie <b>allebei ${d.pct}% korting</b> op de volgende maand.</p>
    <div class="vriend-link"><input readonly value="${esc(d.link)}" id="vbv_link" aria-label="Jouw link"><button class="knop klein" id="vbv_kopie">Kopieer</button></div>
    ${d.vrienden ? `<p class="vb-klein" style="margin:8px 0 0">Al <b>${d.vrienden}</b> ${d.vrienden === 1 ? "ondernemer" : "ondernemers"} via jouw link. Dank je wel!</p>` : ""}</div>`;
  $("#vbv_kopie").onclick = async () => {
    const b = $("#vbv_kopie");
    try { await navigator.clipboard.writeText(d.link); b.textContent = "Gekopieerd"; }
    catch { $("#vbv_link").select(); b.textContent = "Selecteer en kopieer"; }
    setTimeout(() => (b.textContent = "Kopieer"), 1800);
  };
}

// ---------- beheer: omzet in één oogopslag ----------
async function vbgOmzet(el, modus = "alles") {
  let d; try { d = await vbgApi("omzet"); } catch (e) { el.innerHTML = `<div class="kaart"><h2>Omzet</h2><p class="zacht">${esc(e.message)}</p></div>`; return; }
  const tegel = (k, w, s = "") => `<div style="min-width:0"><div class="zacht vb-klein">${k}</div><div style="font-size:24px;font-weight:700" class="mono">${w}</div>${s ? `<div class="zacht vb-klein">${s}</div>` : ""}</div>`;
  const pp = d.per_pakket || {};
  if (modus === "lijsten") {
    el.innerHTML = `<div class="kaart"><h2 style="font-size:16px"><span class="tag">%</span>Kortingen en opzeggingen</h2>
      ${d.kortingen.length ? `<h3 style="font-size:15px;margin:6px 0">Kortingen nu</h3><ul>${d.kortingen.map((o) => `<li><b>${esc(o.naam)}</b> –${vbfEuro(o.korting)}/mnd${o.tot ? ` tot ${new Date(o.tot).toLocaleDateString("nl-NL")}` : ""}${o.reden ? ` (${esc(o.reden)})` : ""}</li>`).join("")}</ul>` : `<p class="zacht vb-klein" style="margin:0">Op dit moment geen kortingen.</p>`}
      ${d.opzeggingen.length ? `<h3 style="font-size:15px;margin:12px 0 6px">Opzeggingen</h3><ul>${d.opzeggingen.map((o) => `<li><b>${esc(o.naam)}</b> per ${new Date(o.per).toLocaleDateString("nl-NL")} (${esc((o.wat || []).join(", "))})${o.reden ? ` – “${esc(o.reden)}”` : ""}</li>`).join("")}</ul>` : ""}
      <p class="zacht vb-klein" style="margin:10px 0 0">Een korting geven doe je bij de klant zelf: Klanten → klant → Abonnement.</p></div>`;
    return d;
  }
  if (modus === "partners") {
    el.innerHTML = d.partners.length ? `<div style="overflow-x:auto;margin-top:10px"><table><thead><tr><th>Partner</th><th class="r">Checks</th><th class="r">Bestellingen</th></tr></thead>
      <tbody>${d.partners.map((p) => `<tr><td>${esc(p.partner)}</td><td class="r">${p.checks}</td><td class="r">${p.bestellingen}</td></tr>`).join("")}</tbody></table></div>` : `<p class="zacht vb-klein">Nog geen aanvragen via partners.</p>`;
    return d;
  }
  el.innerHTML = `<div class="kaart"><h2><span class="tag">€</span>Omzet</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px">
      ${tegel("Per maand (excl. btw)", vbfEuro(d.mrr), d.korting ? `na ${vbfEuro(d.korting)} korting` : "")}
      ${tegel("Binnen deze maand", vbfEuro(d.binnen_deze_maand), "incl. btw")}
      ${tegel("Betalende klanten", d.klanten.totaal, `${d.klanten.vindbaarheid} SEO · ${d.klanten.sitehulpje} Sitehulpje`)}
      ${tegel("Pakketten", `${pp.basis || 0} / ${pp.plus || 0} / ${pp.pro || 0}`, "Basis / Plus / Pro")}
      ${tegel("AI-kosten deze maand", "$" + Number(d.ai_kosten_usd).toFixed(2), "alleen voor jou")}
    </div>
    ${modus === "tegels" ? "" : `${d.opzeggingen.length ? `<h3 style="margin-top:18px">Opzeggingen</h3><ul>${d.opzeggingen.map((o) => `<li><b>${esc(o.naam)}</b> per ${esc(String(o.per).slice(0, 10))} (${esc((o.wat || []).join(", "))})${o.reden ? ` – “${esc(o.reden)}”` : ""}</li>`).join("")}</ul>` : ""}
    ${d.kortingen.length ? `<h3 style="margin-top:18px">Kortingen</h3><ul>${d.kortingen.map((o) => `<li><b>${esc(o.naam)}</b> –${vbfEuro(o.korting)}/mnd${o.tot ? ` tot ${esc(String(o.tot).slice(0, 10))}` : ""}${o.reden ? ` (${esc(o.reden)})` : ""}</li>`).join("")}</ul>` : ""}
    ${d.partners.length ? `<h3 style="margin-top:18px">Partners (check-widget)</h3><div style="overflow-x:auto"><table><thead><tr><th>Partner</th><th class="r">Checks</th><th class="r">Bestellingen</th></tr></thead>
      <tbody>${d.partners.map((p) => `<tr><td>${esc(p.partner)}</td><td class="r">${p.checks}</td><td class="r">${p.bestellingen}</td></tr>`).join("")}</tbody></table></div>` : ""}`}</div>`;
  return d;
}

// ---------- beheer: instellingen voor groei (vriendenkorting, review, maandbericht, klussen, widget) ----------
async function vbgInstellingen(el) {
  let d; try { d = await vbgApi("instellingen"); } catch (e) { el.innerHTML = ""; return; }
  const rij = (x = {}) => `<div class="vbi_klus" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center">
    <input class="vbi_naam" placeholder="Naam" value="${esc(x.naam || "")}" style="flex:1 1 150px;min-width:0;width:auto"><input class="vbi_prijs" inputmode="decimal" placeholder="€" value="${x.prijs ?? ""}" style="flex:0 0 80px;width:80px">
    <input class="vbi_uitleg" placeholder="Korte uitleg (mag leeg)" value="${esc(x.uitleg || "")}" style="flex:2 1 200px;min-width:0;width:auto"><button class="knop rand klein vbi_weg" type="button" aria-label="Weghalen">×</button>
    <input type="hidden" class="vbi_id" value="${esc(x.id || "")}"></div>`;
  el.innerHTML = `<div class="kaart"><h2 style="font-size:16px"><span class="tag">%</span>Groei en klussen</h2><p class="zacht vb-klein" style="margin-top:-4px">Vriendenkorting, review-link, maandbericht en losse klussen.</p>
    <div class="grid2" style="margin-top:12px">
      <div><label for="vbi_pct">Vriendenkorting (% op de eerste volle maand, voor allebei)</label><input id="vbi_pct" inputmode="numeric" value="${esc(d.vriend_korting_pct ?? 50)}"></div>
      <div><label for="vbi_review">Link naar je Google-review (na 60 dagen gemaild)</label><input id="vbi_review" placeholder="https://g.page/r/..." value="${esc(d.review_link || "")}"></div>
    </div>
    <label class="vinkje" style="margin-top:8px"><input type="checkbox" id="vbi_mb"${d.maandbericht_alle === "aan" ? " checked" : ""}><span>Maandbericht (“dit hebben we vorige maand voor je gedaan”) ook naar klanten met het SEO-pakket sturen</span></label>
    <h3 style="margin-top:16px">Losse klussen</h3><p class="zacht vb-klein" style="margin:0">Prijzen excl. btw. Alleen klanten met het SEO-pakket zonder webbeheer zien deze lijst en betalen meteen met iDEAL. Een nieuwe pagina en een blogartikel voert Sitehulpje automatisch uit (als de site gekoppeld is); andere klussen doe je zelf.</p>
    <div id="vbi_klussen">${(d.klussen || []).map(rij).join("")}</div>
    <button class="knop rand klein" type="button" id="vbi_plus" style="margin-top:8px">+ Klus toevoegen</button>
    <div style="margin-top:14px"><button class="knop" id="vbi_bewaar">Bewaren</button></div><div id="vbi_meld"></div></div>`;
  const lijst = $("#vbi_klussen");
  const koppel = () => lijst.querySelectorAll(".vbi_weg").forEach((b) => (b.onclick = () => b.closest(".vbi_klus").remove()));
  koppel();
  $("#vbi_plus").onclick = () => { lijst.insertAdjacentHTML("beforeend", rij()); koppel(); };
  $("#vbi_bewaar").onclick = async () => {
    const klussen = [...lijst.querySelectorAll(".vbi_klus")].map((r) => ({ id: r.querySelector(".vbi_id").value || r.querySelector(".vbi_naam").value.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20),
      naam: r.querySelector(".vbi_naam").value, prijs: Number(r.querySelector(".vbi_prijs").value.replace(",", ".")), uitleg: r.querySelector(".vbi_uitleg").value }));
    try { await vbgApi("instellingen_zet", { vriend_korting_pct: $("#vbi_pct").value, review_link: $("#vbi_review").value, maandbericht_alle: $("#vbi_mb").checked, klussen });
      toonMelding($("#vbi_meld"), "Bewaard.", "ok"); }
    catch (e) { toonMelding($("#vbi_meld"), e.message); }
  };

}

// ---------- beheer: check-widget voor partners (code om op hun site te zetten) + resultaat per partner ----------
async function vbgWidget(el) {
  el.innerHTML = `<div class="kaart"><h2 style="font-size:16px"><span class="tag">&lt;/&gt;</span>Partners en check-widget</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">Geef een partner (boekhouder, drukker, netwerkclub) deze code voor op zijn website. Aanvragen komen bij jou binnen met de naam van de partner.</p>
    <div class="grid2"><div><label for="vbi_partner">Naam van de partner (kort, zonder spaties)</label><input id="vbi_partner" placeholder="bijv. boekhouderjansen"></div></div>
    <textarea id="vbi_code" rows="3" readonly class="mono" style="font-size:12px;margin-top:6px"></textarea>
    <div class="rij" style="margin-top:6px"><button class="knop rand klein" type="button" id="vbi_kopie">Kopieer code</button><a class="knop rand klein" id="vbi_voorbeeld" target="_blank" rel="noopener">Voorbeeld bekijken</a></div>
    <h3 style="font-size:15px;margin:16px 0 0">Wat partners opleveren</h3><div id="vbi_partners"><p class="zacht vb-klein">Laden…</p></div></div>`;
  const code = () => {
    const p = $("#vbi_partner").value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);
    const src = `https://sitehulpje.nl/check-widget${p ? "?partner=" + p : ""}`;
    $("#vbi_code").value = `<iframe src="${src}" title="Gratis website-check" style="width:100%;max-width:520px;height:440px;border:0;border-radius:16px" loading="lazy"></iframe>`;
    $("#vbi_voorbeeld").href = src;
  };
  $("#vbi_partner").oninput = code; code();
  $("#vbi_kopie").onclick = async () => { try { await navigator.clipboard.writeText($("#vbi_code").value); $("#vbi_kopie").textContent = "Gekopieerd"; } catch { $("#vbi_code").select(); } setTimeout(() => ($("#vbi_kopie").textContent = "Kopieer code"), 1500); };
  vbgOmzet($("#vbi_partners"), "partners").catch(() => {});
}

// ---------- beheer: wat er op Jan wacht ----------
const VBG_TAAK = { koppeling: "🔌", factuur: "💶", rapport: "📄", bestelling: "🛒", opzegging: "👋", korting: "%", stil: "📞", instelling: "⚙️" };
async function vbgTaken(el, { opKlant, opCheck, extra = [] } = {}) {
  let t = [];
  try { t = (await vbgApi("taken")).taken; } catch (e) { el.innerHTML = `<div class="melding fout">${esc(e.message)}</div>`; return 0; }
  const alle = [...extra, ...t.filter((x) => x.belangrijk), ...t.filter((x) => !x.belangrijk)];
  el.innerHTML = `<div class="kaart"><h2>Wacht op jou${alle.length ? ` (${alle.length})` : ""}</h2>
    ${alle.length ? `<div class="taken">${alle.map((x, n) => `<div class="taak${x.belangrijk ? " belangrijk" : ""}"><span class="taak-ico" aria-hidden="true">${x.ico || VBG_TAAK[x.soort] || "•"}</span>
      <span class="vul">${x.tekst}</span>${x.klant || x.check || x.verzoek ? `<button class="knop rand klein" data-taak="${n}">Open</button>` : ""}</div>`).join("")}</div>`
    : `<div class="melding ok">Er ligt niets voor je klaar. Alles loopt vanzelf.</div>`}</div>`;
  el.querySelectorAll("[data-taak]").forEach((b) => (b.onclick = () => {
    const x = alle[+b.dataset.taak];
    if (x.verzoek && typeof toonVerzoek === "function") toonVerzoek(x.verzoek);
    else if (x.check && opCheck) opCheck(x.check);
    else if (x.klant && opKlant) opKlant(x.klant, x.soort);
  }));
  return alle.length;
}
