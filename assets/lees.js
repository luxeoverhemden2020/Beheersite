// Leesgedrag van een checkrapport meten: hoe ver, hoe lang, waarop geklikt. Geen cookies.
// Gebruik: leesMeten({ soort: "website" | "ads", id, t })
function leesMeten(o) {
  const API = "https://dauvsivoxfdfzurmyuug.supabase.co/functions/v1/vb-lees";
  let sessie = ""; try { sessie = localStorage.getItem("bs_sessie_beheer") || ""; } catch {}
  const bezoek = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("");
  let diepte = 0, tot = "", sec = 0, verstuurd = "";
  const stuur = (klik) => {
    const k = `${diepte}|${sec}`;
    if (!klik && k === verstuurd) return;
    verstuurd = k;
    fetch(API, { method: "POST", keepalive: true, headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ actie: "meet", soort: o.soort, id: o.id, t: o.t, bezoek, diepte, tot, seconden: sec, klik: klik || null, sessie }) }).catch(() => {});
  };
  const meet = () => {
    const h = document.documentElement, p = Math.round(((scrollY + innerHeight) / Math.max(1, h.scrollHeight)) * 100);
    if (p > diepte) {
      diepte = Math.min(100, p);
      const koppen = [...document.querySelectorAll("main h2, section h2, h2")].filter((x) => x.getBoundingClientRect().top < innerHeight);
      const laatste = koppen[koppen.length - 1]; if (laatste) tot = laatste.textContent.trim().slice(0, 80);
    }
  };
  addEventListener("scroll", meet, { passive: true });
  setInterval(() => { if (document.visibilityState === "visible") sec++; }, 1000);
  setInterval(() => stuur(), 15000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") stuur(); });
  addEventListener("pagehide", () => stuur());
  document.addEventListener("click", (e) => {
    const el = e.target.closest("a, button"); if (!el) return;
    const tekst = (el.textContent || el.getAttribute("aria-label") || el.getAttribute("href") || "").trim();
    if (tekst) stuur(tekst);
  }, true);
  meet(); stuur("");
}
