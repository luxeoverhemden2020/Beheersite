// Sitehulpje Vindbaarheid – gratis website-checks van nieuwe bezoekers (beheer)
const VBC_API = "https://dauvsivoxfdfzurmyuug.supabase.co/functions/v1/vb-check";
async function vbcApi(actie, data = {}) {
  const r = await fetch(VBC_API, { method: "POST", headers: { "Content-Type": "application/json", "X-Sessie": sessie() }, body: JSON.stringify({ actie, ...data }) })
    .catch(() => { throw new Error("Geen verbinding. Controleer je internet en probeer het opnieuw."); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.fout || "Er ging iets mis.");
  return d;
}
const VBC_STATUS = { nieuw: ["in de wachtrij", "zacht"], bezig: ["check loopt", "vb-let"], gecontroleerd: ["rapport maken", "vb-let"], klaar: ["klaar om te versturen", "vb-op"], verstuurd: ["verstuurd", "zacht"], fout: ["mislukt", "vb-af"] };
const VBC_PAKKET = { basis: "Basis", plus: "Plus", pro: "Pro" };

const autoOm = (c) => new Date(new Date(c.klaar_op || c.aangemaakt).getTime() + 2 * 3600_000).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });

// bestellingen via de bestelpagina
const VBB_STATUS = { nieuw: ["nog niet betaald", "vb-let"], betaald: ["betaald", "vb-op"], verlopen: ["afgehaakt", "zacht"], fout: ["fout", "vb-af"] };
async function vbbBestellingen(el) {
  let d;
  try { d = await vbcApi("bestellingen"); } catch (e) { el.innerHTML = ""; return; }
  if (!d.bestellingen.length) { el.innerHTML = ""; return; }
  const open = d.bestellingen.filter((b) => b.status === "nieuw" || b.status === "verlopen").length;
  el.innerHTML = `<div class="kaart tabel-scroll"><h2>Bestellingen${open ? ` <span class="vb-let vb-klein">${open} niet afgerond</span>` : ""}</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">Via sitehulpje.nl/bestellen. Wie niet betaald heeft, kun je even bellen.</p>
    <table><thead><tr><th>Datum</th><th>Bedrijf</th><th>Contact</th><th>Wat</th><th>Status</th></tr></thead><tbody>
    ${d.bestellingen.map((b) => { const [st, kl] = VBB_STATUS[b.status] || [b.status, "zacht"];
      return `<tr><td>${new Date(b.aangemaakt).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}<br><span class="zacht vb-klein">${new Date(b.aangemaakt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</span></td>
        <td><b>${esc(b.bedrijf || "")}</b><br><span class="zacht vb-klein">${esc((b.site || "").replace(/^https?:\/\//, ""))}</span></td>
        <td class="vb-klein">${esc(b.contact || "")}<br>${esc(b.email || "")}${b.telefoon ? "<br>" + esc(b.telefoon) : ""}</td>
        <td class="vb-klein">${[b.pakket ? "Vindbaarheid " + (VBC_PAKKET[b.pakket] || b.pakket) : "", b.sitehulpje ? "Sitehulpje" : ""].filter(Boolean).join(" + ")}${b.bericht ? `<br><span class="zacht">${esc(b.bericht.slice(0, 120))}</span>` : ""}</td>
        <td><span class="${kl}">${st}</span>${b.fout ? `<br><span class="vb-af vb-klein">${esc(b.fout)}</span>` : ""}</td></tr>`; }).join("")}</tbody></table></div>`;
}

async function vbcBeheer(el, open) {
  let d;
  try { d = await vbcApi("lijst"); } catch (e) { el.innerHTML = `<div class="kaart"><p>${esc(e.message)}</p></div>`; return; }
  const klaar = d.checks.filter((c) => c.status === "klaar").length;
  const rij = (c) => {
    const [st, kl] = VBC_STATUS[c.status] || [c.status, "zacht"];
    return `<tr data-id="${c.id}"${c.id === open ? ' style="outline:2px solid var(--accent)"' : ""}>
      <td>${new Date(c.aangemaakt).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}</td>
      <td><b>${esc(c.site.replace(/^https?:\/\//, ""))}</b><br><span class="zacht vb-klein">${esc(c.naam || "")}${c.bedrijf ? " · " + esc(c.bedrijf) : ""}<br>${esc(c.email)}</span></td>
      <td class="vb-klein">${esc((c.woorden || []).join(", ") || "–")}<br><span class="zacht">${esc(c.werkgebied || "")}${c.plaats ? " · " + esc(c.plaats) : ""}</span></td>
      <td class="mono">${c.score ?? "–"}</td><td>${c.pakket ? VBC_PAKKET[c.pakket] : "–"}${c.sitehulpje ? '<br><span class="zacht vb-klein">+ Sitehulpje</span>' : ""}</td>
      <td><span class="${kl}">${st}</span>${c.status === "klaar" ? (c.auto ? `<br><span class="zacht vb-klein">gaat vanzelf rond ${autoOm(c)}</span>` : '<br><span class="zacht vb-klein">tegengehouden</span>') : ""}${c.via === "beheer" ? '<br><span class="zacht vb-klein">door jou gestart</span>' : ""}${c.gezien ? '<br><span class="zacht vb-klein">bekeken door klant</span>' : ""}${c.fout ? `<br><span class="vb-af vb-klein">${esc(c.fout)}</span>` : ""}</td>
      <td style="white-space:nowrap">${["klaar", "verstuurd"].includes(c.status) ? `<a class="knop rand klein" href="${esc(c.rapport)}" target="_blank" rel="noopener">Bekijk</a> ` : ""}
        ${c.status === "klaar" ? `<button class="knop klein" data-vbc="verstuur">Verstuur nu</button> <button class="knop rand klein" data-vbc="houd" data-auto="${c.auto ? "" : "1"}">${c.auto ? "Tegenhouden" : "Toch vanzelf"}</button>` : ""}
        ${c.status === "verstuurd" ? `<button class="knop rand klein" data-vbc="verstuur">Opnieuw sturen</button>` : ""}
        ${["fout", "klaar", "verstuurd"].includes(c.status) ? `<button class="knop rand klein" data-vbc="opnieuw" title="Check opnieuw doen">↻</button>` : ""}</td></tr>`;
  };
  el.innerHTML = `<div class="kaart tabel-scroll"><h2>Gratis website-checks${klaar ? ` <span class="vb-op vb-klein">${klaar} klaar om te versturen</span>` : ""}</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">Aanvragen via de Vindbaarheid-pagina. De check loopt vanzelf en het rapport gaat 2 uur na klaar vanzelf naar de aanvrager, tenzij je het tegenhoudt.</p>
    <form id="vbcstart" class="rij" style="gap:8px;align-items:flex-end;margin:6px 0 12px;flex-wrap:wrap">
      <div style="flex:1;min-width:180px"><label for="vbc_site" class="vb-klein">Website checken</label><input id="vbc_site" inputmode="url" placeholder="www.hunbedrijf.nl" required></div>
      <div style="flex:1;min-width:180px"><label for="vbc_email" class="vb-klein">E-mailadres klant</label><input id="vbc_email" type="email" placeholder="naam@hunbedrijf.nl" required></div>
      <label class="vb-klein" style="display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" id="vbc_meteen" checked style="width:auto"> Meteen mailen als het klaar is</label>
      <button class="knop klein" id="vbc_knop">Check nu</button>
    </form>
    <div id="vbcmeld"></div>
    ${d.checks.length ? `<table><thead><tr><th>Datum</th><th>Website</th><th>Wat ze doen</th><th>Score</th><th>Advies</th><th>Status</th><th></th></tr></thead><tbody>${d.checks.map(rij).join("")}</tbody></table>`
      : '<p class="zacht">Nog geen aanvragen.</p>'}</div>`;
  $("#vbcstart").onsubmit = async (e) => {
    e.preventDefault(); const k = $("#vbc_knop"); k.disabled = true; k.textContent = "Starten…";
    // het rapport meteen openen; het laat zien dat de check loopt en verschijnt vanzelf als hij klaar is (ongeveer 1 minuut)
    const venster = window.open("about:blank", "_blank");
    try {
      const d = await vbcApi("beheer_start", { site: $("#vbc_site").value, email: $("#vbc_email").value, meteen: $("#vbc_meteen").checked });
      if (venster) venster.location.href = d.rapport; else { const m = $("#vbcmeld"); m.className = "melding ok"; m.innerHTML = `De check loopt. <a href="${esc(d.rapport)}" target="_blank" rel="noopener">Open het rapport</a>; het verschijnt vanzelf.`; }
      setTimeout(() => vbcBeheer(el), 800);
    } catch (err) { if (venster) venster.close(); toonMelding($("#vbcmeld"), err.message); k.disabled = false; k.textContent = "Check nu"; }
  };
  el.querySelectorAll("[data-vbc]").forEach((b) => b.onclick = async () => {
    const id = b.closest("tr").dataset.id, actie = b.dataset.vbc;
    b.disabled = true; const oud = b.textContent; b.textContent = actie === "verstuur" ? "Versturen…" : "Bezig…";
    try {
      await vbcApi(actie, { id, auto: b.dataset.auto === "1" });
      toonMelding($("#vbcmeld"), actie === "verstuur" ? "Verstuurd naar de klant." : actie === "houd" ? (b.dataset.auto === "1" ? "Het rapport gaat weer vanzelf." : "Tegengehouden. Het gaat pas als jij op Verstuur klikt.") : "De check loopt opnieuw. Over een paar minuten is het rapport klaar.", "ok");
      setTimeout(() => vbcBeheer(el), 1200);
    } catch (e) { toonMelding($("#vbcmeld"), e.message); b.disabled = false; b.textContent = oud; }
  });
  if (open) el.querySelector(`tr[data-id="${open}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}
