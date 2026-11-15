/* Sitehulpje aanvragenbak – zet op de klantsite:
   <script src="https://sitehulpje.nl/aanvraag.js" data-k="KLANT-ID" defer></script>
   - Vangt ingevulde formulieren op (de formulieren zelf blijven gewoon werken) en stuurt ze naar Sitehulpje.
   - Onthoudt van welke Google-advertentieklik de bezoeker kwam (gclid, 90 dagen), maar alleen met toestemming
     voor marketingcookies als de site een cookiemelding heeft (Cookiebot, CookieYes, Complianz).
   - Wachtwoorden, betaalgegevens en verborgen beveiligingsvelden worden nooit meegestuurd. */
(function () {
  var s = document.currentScript, k = s && s.getAttribute("data-k");
  if (!k) return;
  var URL_ = "https://dauvsivoxfdfzurmyuug.supabase.co/functions/v1/sr-aanvraag", SLEUTEL = "sh_gclid";
  function toestemming() {
    try {
      if (window.Cookiebot && window.Cookiebot.consent) return !!window.Cookiebot.consent.marketing;
      if (typeof window.getCkyConsent === "function") { var c = window.getCkyConsent(); return !!(c && c.categories && c.categories.advertisement); }
      if (typeof window.cmplz_has_consent === "function") return !!window.cmplz_has_consent("marketing");
    } catch (e) { return false; }
    // onbekende cookiemelding: niets bewaren; geen cookiemelding: de site gebruikt geen toestemmingsvraag
    return !/CookieConsent|cookieyes|cmplz_|cookie_?consent|borlabs|klaro|OptanonConsent/i.test(document.cookie);
  }
  var q = new URLSearchParams(location.search), gclid = q.get("gclid");
  try {
    if (gclid && toestemming()) localStorage.setItem(SLEUTEL, JSON.stringify({ g: gclid, t: Date.now() }));
    if (!gclid && toestemming()) {
      var o = JSON.parse(localStorage.getItem(SLEUTEL) || "null");
      if (o && Date.now() - o.t < 90 * 864e5) gclid = o.g;
    }
  } catch (e) {}
  var VERBODEN = /pass|wachtw|token|nonce|captcha|honeypot|iban|creditcard|card|cvc|bsn|form_key|_wp/i;
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!f || f.tagName !== "FORM" || f.querySelector('input[type="password"]') || (f.getAttribute("role") === "search")) return;
    var v = {}, n = 0;
    for (var i = 0; i < f.elements.length; i++) {
      var el = f.elements[i], naam = el.name || el.id;
      if (!naam || VERBODEN.test(naam) || el.disabled || /^(submit|button|reset|file|password|hidden)$/i.test(el.type)) continue;
      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
      var w = String(el.value || "").trim();
      if (!w) continue;
      v[naam] = v[naam] ? v[naam] + ", " + w : w; n++;
    }
    if (n < 2) return; // zoekvelden en losse knoppen overslaan
    var data = JSON.stringify({ actie: "nieuw", k: k, velden: v, pagina: location.origin + location.pathname, gclid: gclid || null });
    try { if (!navigator.sendBeacon(URL_, new Blob([data], { type: "text/plain" }))) throw 0; }
    catch (x) { try { fetch(URL_, { method: "POST", body: data, keepalive: true, headers: { "Content-Type": "text/plain" } }); } catch (y) {} }
  }, true);
})();
