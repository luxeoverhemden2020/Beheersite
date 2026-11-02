// Chique 3D-zijmenu links: rail op grote schermen, uitschuifpaneel op mobiel.
(function () {
  var h = location.hostname, shop = h.indexOf("shopregelaar") > -1, hulp = h.indexOf("sitehulpje") > -1 || h === "localhost" && /beheer/i.test(location.pathname);
  var punten = [
    ["probeer", "Probeer het", "M4 12h10M10 6l6 6-6 6"],
    ["sitehulpje", "Hoe het werkt", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5v4l3 2"],
    ["demo", "Wat het kan", "M4 6h16M4 12h10M4 18h7"],
    ["los", hulp ? "Werkt het met mijn site?" : "Al een site?", "M8 12l3 3 5-6M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"],
    ["aanbod", hulp ? "Site laten maken" : shop ? "Webshop laten maken" : "Website laten maken", "M4 7h16v12H4zM8 7V5h8v2"],
    ["portfolio", "Portfolio", "M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z"],
    ["vragen", "Vragen", "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.5"],
    ["contact", "Contact", "M4 6h16v12H4zM4 7l8 6 8-6"]
  ].filter(function (p) { return document.getElementById(p[0]); });
  if (!punten.length) return;
  var nav = document.createElement("nav");
  nav.className = "zijmenu"; nav.setAttribute("aria-label", "Menu");
  nav.innerHTML = '<div class="zm-paneel"><div class="zm-kop"><span class="zm-dot"></span><b class="zm-label">MENU</b><span class="zm-sluit" role="button" aria-label="Sluiten">×</span></div>' +
    '<div class="zm-lijn"><i></i></div>' +
    punten.map(function (p, i) {
      return '<a class="zm-item" href="#' + p[0] + '" data-id="' + p[0] + '" style="--n:' + i + '">' +
        '<span class="zm-node"><svg viewBox="0 0 24 24"><path d="' + p[2] + '"/></svg></span>' +
        '<span class="zm-tekst"><small>' + ("0" + (i + 1)).slice(-2) + '</small>' + p[1] + '</span></a>';
    }).join("") + '</div>';
  var knop = document.createElement("button");
  knop.className = "zm-open"; knop.type = "button"; knop.setAttribute("aria-label", "Menu openen");
  knop.innerHTML = '<span></span><span></span><span></span>';
  document.body.appendChild(nav); document.body.appendChild(knop);
  function dicht() { document.body.classList.remove("zm-los"); }
  knop.onclick = function () { document.body.classList.toggle("zm-los"); };
  nav.querySelector(".zm-sluit").onclick = dicht;
  nav.addEventListener("click", function (e) { if (e.target.closest(".zm-item")) dicht(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") dicht(); });
  // Actieve sectie oplichten
  var items = nav.querySelectorAll(".zm-item");
  function zet(id) { items.forEach(function (a) { a.classList.toggle("aan", a.dataset.id === id); }); }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) zet(e.target.id); });
    }, { rootMargin: "-40% 0px -55% 0px" });
    punten.forEach(function (p) { io.observe(document.getElementById(p[0])); });
  }
  // Rail laat zich zien zodra je voorbij de bovenkant scrolt
  function scroll() { document.body.classList.toggle("zm-zicht", scrollY > 280); }
  addEventListener("scroll", scroll, { passive: true }); scroll();
})();
