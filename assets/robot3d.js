// Sitehulpje – 3D-robot voor de homepage (Three.js r128)
(function () {
  const holder = document.getElementById("robot3d");
  if (!holder) return;
  const fallback = () => { holder.innerHTML = robotSvg("zwaai kijkt"); holder.classList.add("fallback"); };
  let gl = null;
  try { const c = document.createElement("canvas"); gl = c.getContext("webgl2") || c.getContext("webgl"); } catch (e) {}
  if (!window.THREE || !gl) { fallback(); return; }
  const rustig = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const W = () => holder.clientWidth || 400, H = () => holder.clientHeight || 400;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W(), H());
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  holder.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(35, W() / H(), 0.1, 100);
  cam.position.set(0, 0.4, 12.5); cam.lookAt(0, -0.25, 0);

  // licht: wit hoofdlicht + turquoise en paarse randlichten (cyber)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1b2a4a, 0.85));
  const hoofdLicht = new THREE.DirectionalLight(0xffffff, 1.5); hoofdLicht.position.set(3, 5, 6); scene.add(hoofdLicht);
  const randT = new THREE.PointLight(0x22e3c4, 4, 14); randT.position.set(-4.5, 1.5, -1); scene.add(randT);
  const randP = new THREE.PointLight(0x8b5cf6, 4, 14); randP.position.set(4.5, 2, -2); scene.add(randP);
  const front = new THREE.PointLight(0x9ffcef, 0.6, 10); front.position.set(0, 0, 5); scene.add(front);

  // afgeronde blokken
  function blok(w, h, d, r, mat) {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const bev = Math.min(r * 0.7, d * 0.45);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, d - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.9, bevelSegments: 10, curveSegments: 20 });
    g.translate(0, 0, -Math.max(0.01, d - 2 * bev) / 2);
    return new THREE.Mesh(g, mat);
  }
  const wit = new THREE.MeshPhysicalMaterial({ color: 0xf4f7fc, roughness: 0.25, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12 });
  const turq = new THREE.MeshPhysicalMaterial({ color: 0x22e3c4, roughness: 0.25, metalness: 0.25, clearcoat: 1, emissive: 0x0a6d60, emissiveIntensity: 0.5 });
  const scherm = new THREE.MeshPhysicalMaterial({ color: 0x07101d, roughness: 0.1, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.03 });
  const gloei = new THREE.MeshBasicMaterial({ color: 0x3cf2d6, toneMapped: false });
  const metaal = new THREE.MeshStandardMaterial({ color: 0xa9bacd, roughness: 0.35, metalness: 0.7 });

  const robot = new THREE.Group(); scene.add(robot);
  const hoofd = new THREE.Group(); hoofd.position.y = 0.95; robot.add(hoofd);
  hoofd.add(blok(2.7, 1.95, 1.75, 0.65, wit));
  const sch = blok(2.15, 1.28, 0.22, 0.48, scherm); sch.position.z = 0.84; hoofd.add(sch);

  const ogen = new THREE.Group(); ogen.position.z = 0.97; hoofd.add(ogen);
  const oogGeo = new THREE.SphereGeometry(0.17, 32, 32);
  const oogL = new THREE.Mesh(oogGeo, gloei); oogL.scale.set(1, 1.4, 0.45); oogL.position.set(-0.43, 0.1, 0);
  const oogR = new THREE.Mesh(oogGeo, gloei); oogR.scale.set(1, 1.4, 0.45); oogR.position.set(0.43, 0.1, 0);
  ogen.add(oogL, oogR);
  const mond = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 12, 40, Math.PI), gloei);
  mond.rotation.z = Math.PI; mond.position.set(0, -0.27, 0.97); hoofd.add(mond);
  const wangMat = new THREE.MeshBasicMaterial({ color: 0xff7aa8, transparent: true, opacity: 0.35 });
  [-0.82, 0.82].forEach((x) => { const w = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), wangMat); w.position.set(x, -0.28, 0.97); hoofd.add(w); });

  const oorGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.28, 40);
  [-1.45, 1.45].forEach((x) => { const o = new THREE.Mesh(oorGeo, turq); o.rotation.z = Math.PI / 2; o.position.x = x; hoofd.add(o); });
  const stang = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.55, 16), metaal); stang.position.y = 1.22; hoofd.add(stang);
  const bol = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 32), gloei); bol.position.y = 1.55; hoofd.add(bol);
  const bolLicht = new THREE.PointLight(0x22e3c4, 1.6, 3.5); bolLicht.position.copy(bol.position); hoofd.add(bolLicht);

  const nek = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.28, 32), metaal); nek.position.y = -0.14; robot.add(nek);
  const lijf = blok(1.75, 1.35, 1.25, 0.48, wit); lijf.position.y = -0.88; robot.add(lijf);
  const hart = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 32), gloei); hart.position.set(0, -0.82, 0.66); robot.add(hart);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 12, 40), turq); ring.position.copy(hart.position); robot.add(ring);

  function arm(x) {
    const g = new THREE.Group(); g.position.set(x, -0.45, 0);
    const schouder = new THREE.Mesh(new THREE.SphereGeometry(0.21, 24, 24), wit); g.add(schouder);
    const bovenarm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.75, 24), wit); bovenarm.position.y = -0.4; g.add(bovenarm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.23, 24, 24), turq); hand.position.y = -0.85; g.add(hand);
    robot.add(g); return g;
  }
  const armL = arm(-1.08), armR = arm(1.08);

  const straal = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x22e3c4, transparent: true, opacity: 0.32, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  straal.rotation.x = Math.PI; straal.position.y = -2.0; robot.add(straal);

  const ringen = [], satellieten = [];
  [[2.35, 0x22e3c4, -0.35], [2.85, 0x8b5cf6, 0.45]].forEach(([r, kleur, kantel]) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 8, 160), new THREE.MeshBasicMaterial({ color: kleur, transparent: true, opacity: 0.6 }));
    m.rotation.x = Math.PI / 2.25; m.rotation.y = kantel; scene.add(m); ringen.push(m);
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 16), new THREE.MeshBasicMaterial({ color: kleur === 0x22e3c4 ? 0xb8fff4 : 0xd8ccff }));
    m.add(s); satellieten.push([s, r]);
  });

  const aantal = 320, pos = new Float32Array(aantal * 3);
  for (let i = 0; i < aantal; i++) { pos[i * 3] = (Math.random() - 0.5) * 16; pos[i * 3 + 1] = (Math.random() - 0.5) * 9; pos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 2.5; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const deeltjes = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x5ff7e0, size: 0.045, transparent: true, opacity: 0.75, depthWrite: false }));
  scene.add(deeltjes);

  const vloer = new THREE.GridHelper(24, 48, 0x22e3c4, 0x22e3c4);
  vloer.material.transparent = true; vloer.material.opacity = 0.07; vloer.position.y = -2.75; scene.add(vloer);
  const schijf = new THREE.Mesh(new THREE.CircleGeometry(1.4, 64), new THREE.MeshBasicMaterial({ color: 0x22e3c4, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  schijf.rotation.x = -Math.PI / 2; schijf.position.y = -2.73; scene.add(schijf);

  let mx = 0, my = 0;
  addEventListener("pointermove", (e) => {
    const r = holder.getBoundingClientRect();
    mx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (innerWidth / 2)));
    my = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (innerHeight / 2)));
  }, { passive: true });

  function maat() {
    renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix();
    cam.position.z = W() < 460 ? 14 : 12.5;
  }
  new ResizeObserver(maat).observe(holder);
  let zichtbaar = true;
  new IntersectionObserver(([e]) => { zichtbaar = e.isIntersecting; }).observe(holder);

  const klok = new THREE.Clock(); let knipTot = 0, volgendeKnip = 2;
  function frame() {
    requestAnimationFrame(frame);
    if (!zichtbaar) return;
    const t = rustig ? 1 : klok.getElapsedTime();
    robot.position.y = Math.sin(t * 1.6) * 0.14;
    robot.rotation.y += (mx * 0.55 - robot.rotation.y) * 0.05;
    hoofd.rotation.x += (my * 0.3 - hoofd.rotation.x) * 0.06;
    hoofd.rotation.z = Math.sin(t * 0.8) * 0.04;
    ogen.position.x += (mx * 0.08 - ogen.position.x) * 0.1;
    ogen.position.y += (-my * 0.05 - ogen.position.y) * 0.1;
    const z = t % 7, doel = z < 2.2 ? 2.55 + Math.sin(z * 11) * 0.32 : 0.12;
    armR.rotation.z += (doel - armR.rotation.z) * 0.1;
    armL.rotation.z = -0.12 - Math.sin(t * 1.6) * 0.06;
    if (t > volgendeKnip) { knipTot = t + 0.13; volgendeKnip = t + 2.5 + Math.random() * 3; }
    const sy = t < knipTot ? 0.12 : 1.4; oogL.scale.y = sy; oogR.scale.y = sy;
    const p = 1 + Math.sin(t * 4) * 0.12; hart.scale.setScalar(p); ring.rotation.z = t;
    bolLicht.intensity = 1.3 + Math.sin(t * 3) * 0.5;
    straal.material.opacity = 0.25 + Math.sin(t * 20) * 0.05 + Math.sin(t * 1.6) * 0.05;
    schijf.material.opacity = 0.18 + Math.sin(t * 1.6) * 0.05;
    ringen[0].rotation.z = t * 0.35; ringen[1].rotation.z = -t * 0.25;
    satellieten.forEach(([s, r], i) => { const a = t * (i ? -0.9 : 1.2); s.position.set(Math.cos(a) * r, Math.sin(a) * r, 0); });
    deeltjes.rotation.y = t * 0.03; deeltjes.position.y = Math.sin(t * 0.3) * 0.1;
    renderer.render(scene, cam);
  }
  frame();
})();
