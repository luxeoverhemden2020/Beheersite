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
      <td><span class="${kl}">${st}</span>${c.gezien ? '<br><span class="zacht vb-klein">bekeken door klant</span>' : ""}${c.fout ? `<br><span class="vb-af vb-klein">${esc(c.fout)}</span>` : ""}</td>
      <td style="white-space:nowrap">${["klaar", "verstuurd"].includes(c.status) ? `<a class="knop rand klein" href="${esc(c.rapport)}" target="_blank" rel="noopener">Bekijk</a> ` : ""}
        ${c.status === "klaar" ? `<button class="knop klein" data-vbc="verstuur">Verstuur</button>` : ""}
        ${c.status === "verstuurd" ? `<button class="knop rand klein" data-vbc="verstuur">Opnieuw sturen</button>` : ""}
        ${["fout", "klaar", "verstuurd"].includes(c.status) ? `<button class="knop rand klein" data-vbc="opnieuw" title="Check opnieuw doen">↻</button>` : ""}</td></tr>`;
  };
  el.innerHTML = `<div class="kaart tabel-scroll"><h2>Gratis website-checks${klaar ? ` <span class="vb-op vb-klein">${klaar} klaar om te versturen</span>` : ""}</h2>
    <p class="zacht vb-klein" style="margin-top:-4px">Aanvragen via de Vindbaarheid-pagina. De check loopt vanzelf; jij bekijkt het rapport en verstuurt het met één klik.</p>
    <div id="vbcmeld"></div>
    ${d.checks.length ? `<table><thead><tr><th>Datum</th><th>Website</th><th>Wat ze doen</th><th>Score</th><th>Advies</th><th>Status</th><th></th></tr></thead><tbody>${d.checks.map(rij).join("")}</tbody></table>`
      : '<p class="zacht">Nog geen aanvragen.</p>'}</div>`;
  el.querySelectorAll("[data-vbc]").forEach((b) => b.onclick = async () => {
    const id = b.closest("tr").dataset.id, actie = b.dataset.vbc;
    b.disabled = true; const oud = b.textContent; b.textContent = actie === "verstuur" ? "Versturen…" : "Bezig…";
    try {
      await vbcApi(actie, { id });
      toonMelding($("#vbcmeld"), actie === "verstuur" ? "Verstuurd naar de klant." : "De check loopt opnieuw. Over een paar minuten is het rapport klaar.", "ok");
      setTimeout(() => vbcBeheer(el), 1200);
    } catch (e) { toonMelding($("#vbcmeld"), e.message); b.disabled = false; b.textContent = oud; }
  });
  if (open) el.querySelector(`tr[data-id="${open}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}
