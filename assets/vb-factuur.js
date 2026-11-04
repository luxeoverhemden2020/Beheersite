// Sitehulpje Vindbaarheid – facturen (beheer) en pauzemelding (klant)
const VBF_API = "https://eiejxciyfcynppldonaw.supabase.co/functions/v1/vb-factuur";
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
