// Sitehulpje Vindbaarheid – facturen (beheer) en pauzemelding (klant)
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

// Klantpagina: staat Vindbaarheid op pauze door een openstaande factuur? Toon dan een melding met betaallink.
async function vbfPauzeMelding(el) {
  try {
    const s = await vbfApi("status");
    if (!s.pauze) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="melding let"><b>Vindbaarheid staat op pauze.</b> ${s.open.length
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
async function vbfAbonnement(el, klanten) {
  const lijst = (klanten || []).filter((k) => k.vb_pakket || k.vindbaarheid || k.sh_prijs);
  const opties = (klanten || []).map((k) => `<option value="${esc(k.id)}">${esc(k.naam)}</option>`).join("");
  el.innerHTML = `<div class="kaart"><h2 style="font-size:16px"><span class="tag">%</span>Abonnement en korting</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">Kies een klant. Een korting staat als aparte regel op de factuur, en de incasso schrijft het lagere bedrag af.</p>
    <select id="vbfab_klant" style="width:auto;min-width:220px"><option value="">Kies een klant…</option>${opties}</select>
    <div id="vbfab_uit" style="margin-top:12px"></div></div>`;
  const uit = $("#vbfab_uit");
  $("#vbfab_klant").onchange = async (e) => {
    const id = e.target.value; uit.innerHTML = "";
    if (!id) return;
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
        setTimeout(() => $("#vbfab_klant").onchange({ target: { value: id } }), 1800);
      } catch (err) { toonMelding($("#vbfab_meld"), err.message); }
    };
    const t = $("#vbfab_terug"); if (t) t.onclick = async () => { try { await vbfApi("opzeg_terug", { klant_id: id }); $("#vbfab_klant").onchange({ target: { value: id } }); } catch (err) { toonMelding($("#vbfab_meld"), err.message); } };
  };
}

// Klant: abonnement bekijken en opzeggen (onopvallend onder het account)
async function vbfOpzegKlant(el) {
  let d; try { d = await vbfApi("abonnement"); } catch { el.innerHTML = ""; return; }
  if (!d.delen.length) { el.innerHTML = ""; return; }
  const datum = (s) => new Date(s).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  el.innerHTML = `<details class="kaart abonnement"><summary>Abonnement</summary>
    <table style="margin-top:8px"><tbody>${d.delen.map((x) => `<tr><td>${esc(x.naam)}</td><td class="r mono">${vbfEuro(x.prijs)} /mnd</td></tr>`).join("")}
    ${d.korting ? `<tr><td>Persoonlijke korting</td><td class="r mono">–${vbfEuro(d.korting)}</td></tr>` : ""}</tbody></table>
    <p class="zacht vb-klein">Prijzen exclusief btw. De factuur krijg je elke maand per mail.</p>
    ${d.opzeg_per ? `<p>Je hebt opgezegd per <b>${datum(d.opzeg_per)}</b>. Tot die dag loopt alles gewoon door.</p><button class="knop rand klein" id="vbo_terug">Toch niet opzeggen</button>`
      : `<details style="margin-top:8px"><summary class="zacht vb-klein">Opzeggen</summary>
        <p class="vb-klein">Opzeggen kan per het einde van de maand. Vindbaarheid heeft een minimale looptijd van 3 maanden.</p>
        ${d.delen.map((x) => `<label class="vb-klein" style="display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" value="${x.id}" class="vbo_wat" style="width:auto"${d.delen.length === 1 ? " checked" : ""}> ${esc(x.naam)}</label>`).join("")}
        <label class="vb-klein" for="vbo_reden">Waarom stop je? (mag leeg, helpt ons beter te worden)</label><textarea id="vbo_reden" rows="2"></textarea>
        <button class="knop rand klein" id="vbo_knop" style="margin-top:6px">Opzeggen</button></details>`}
    <div id="vbo_meld"></div></details>`;
  const k = $("#vbo_knop");
  if (k) k.onclick = async () => {
    const wat = [...el.querySelectorAll(".vbo_wat:checked")].map((x) => x.value);
    if (!wat.length) { toonMelding($("#vbo_meld"), "Kies wat je wilt opzeggen."); return; }
    k.disabled = true;
    try {
      const r = await vbfApi("opzeggen", { wat, reden: $("#vbo_reden").value });
      if (r.te_vroeg) toonMelding($("#vbo_meld"), `${r.naam} loopt minimaal 3 maanden. Vanaf ${datum(r.vanaf)} kun je opzeggen; het stopt dan op ${datum(r.eind)}. We hebben je dit ook gemaild.`);
      else { toonMelding($("#vbo_meld"), `Opgezegd per ${datum(r.per)}. Je krijgt een bevestiging per mail.`, "ok"); setTimeout(() => vbfOpzegKlant(el), 2500); }
    } catch (e) { toonMelding($("#vbo_meld"), e.message); }
    k.disabled = false;
  };
  const t = $("#vbo_terug");
  if (t) t.onclick = async () => { try { await vbfApi("opzeg_terug"); vbfOpzegKlant(el); } catch (e) { toonMelding($("#vbo_meld"), e.message); } };
}
