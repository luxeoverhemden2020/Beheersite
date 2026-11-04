// 3D kantelen van kaarten bij de muis (alleen op apparaten met een muis, niet bij "minder beweging")
(() => {
  if (!matchMedia("(pointer:fine)").matches || matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  const doel = ".kaart.pad, .pk, .voordeel, .project, .prijs-combi, .vier .kaart, .stappen3 .kaart, .kaart.stap";
  document.querySelectorAll(doel).forEach((el) => {
    el.setAttribute("data-tilt", "");
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty("--ry", ((x - 0.5) * 8).toFixed(2) + "deg");
      el.style.setProperty("--rx", ((0.5 - y) * 8).toFixed(2) + "deg");
      el.style.setProperty("--mx", (x * 100).toFixed(1) + "%");
      el.style.setProperty("--my", (y * 100).toFixed(1) + "%");
      el.classList.add("tilt-aan");
    });
    el.addEventListener("pointerleave", () => { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); el.classList.remove("tilt-aan"); });
  });
})();
