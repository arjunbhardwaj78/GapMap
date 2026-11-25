/* SamajhSetu 3D scene: a floating book, a bridge over a gap, a bubble sheet, drifting particles and small shapes.
   Plain JavaScript. Uses Three.js (r128). The library is loaded from /vendor/three.min.js if you put it there (best: no outside
   dependency), otherwise from the cdnjs CDN. If WebGL or the library is not available, nothing breaks: the page keeps its plain look.
   window.SetuScene.mount(element, { variant: 'stage' | 'hero', onFail }) -> { destroy(), setProgress(0..1) } */
(() => {
'use strict';
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const LOCAL = '/vendor/three.min.js';
const COL = { teal: 0x2E8B8B, blue: 0x3B82C4, leaf: 0x43A06F, sun: 0xF2B94F, rose: 0xE26D7A, plum: 0x7C69C4, paper: 0xF8FBFA, ink: 0x1F3437 };
let loading = null;

function addScript(src) {
  return new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => (window.THREE ? ok(window.THREE) : no(new Error('three missing')));
    s.onerror = () => no(new Error('script failed'));
    document.head.appendChild(s);
  });
}
function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (!loading) { loading = addScript(LOCAL).catch(() => addScript(CDN)); loading.catch(() => { loading = null; }); }
  return loading;
}

function sheetTexture(THREE) {   // the bubble sheet is drawn on a small canvas, then used as a picture on a flat plane
  const c = document.createElement('canvas'); c.width = 256; c.height = 360;
  const g = c.getContext('2d');
  g.fillStyle = '#F8FBFA'; g.fillRect(0, 0, 256, 360);
  g.strokeStyle = '#C9D9D5'; g.lineWidth = 4; g.strokeRect(2, 2, 252, 356);
  g.fillStyle = '#1F3437';
  [[14, 14], [226, 14], [14, 328], [226, 328]].forEach(([x, y]) => g.fillRect(x, y, 16, 16));
  g.fillStyle = '#2E8B8B'; g.fillRect(52, 20, 100, 10);
  g.fillStyle = '#C9D9D5'; g.fillRect(52, 38, 150, 6);
  g.fillStyle = '#1F3437'; g.fillRect(190, 18, 14, 14);                          // the small QR block
  const picks = [1, 0, 3, 2, 1, 2, 0, 3, 1, 0];
  for (let r = 0; r < 10; r++) for (let k = 0; k < 4; k++) {
    const x = 70 + k * 36, y = 78 + r * 25;
    g.beginPath(); g.arc(x, y, 8.5, 0, Math.PI * 2);
    if (picks[r] === k) { g.fillStyle = '#1F3437'; g.fill(); } else { g.lineWidth = 2; g.strokeStyle = '#5A7276'; g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

function build(THREE, dense, full) {
  const scene = new THREE.Scene();
  const lam = (color) => new THREE.MeshLambertMaterial({ color });
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(3, 5, 6); scene.add(sun);
  const tint = new THREE.PointLight(COL.plum, 0.6, 20); tint.position.set(-4, -2, 4); scene.add(tint);

  // --- book ---
  const book = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.24, 1.1), lam(COL.plum));
  const pages = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.17, 1.02), lam(COL.paper)); pages.position.set(0.05, 0, 0);
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.5), lam(COL.sun)); ribbon.position.set(0.3, 0, 0.75);
  book.add(cover, pages, ribbon);
  book.rotation.set(0.55, 0.4, -0.25);

  // --- bridge over a gap ---
  const bridge = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.09, 0.5), lam(COL.teal));
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.05, 8, 48, Math.PI), lam(COL.sun)); arch.scale.set(1, 0.45, 1); arch.position.y = 0.04;
  bridge.add(deck, arch);
  for (let i = -4; i <= 4; i++) {
    const x = i * 0.34, h = 0.45 * Math.sqrt(Math.max(0, 1.6 * 1.6 - x * x));
    const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, h, 6), lam(COL.sun)); hang.position.set(x, 0.04 + h / 2, 0); bridge.add(hang);
  }
  const bankL = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.9), lam(COL.leaf)); bankL.position.set(-2.25, -0.32, 0);
  const bankR = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.9), lam(COL.leaf)); bankR.position.set(2.25, -0.32, 0);
  bridge.add(bankL, bankR);
  bridge.scale.setScalar(0.62); bridge.rotation.set(0.25, -0.35, 0);

  // --- bubble sheet ---
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.54), new THREE.MeshBasicMaterial({ map: sheetTexture(THREE), side: THREE.DoubleSide }));
  sheet.rotation.set(-0.15, -0.45, 0.12);

  // --- small abstract shapes ---
  const shapes = [];
  [[new THREE.IcosahedronGeometry(0.22, 0), COL.rose, [-1.3, 1.1, -0.5]], [new THREE.OctahedronGeometry(0.2, 0), COL.blue, [1.4, -1.0, 0.3]],
   [new THREE.TorusGeometry(0.17, 0.06, 8, 20), COL.sun, [0.2, 1.3, 0.2]], [new THREE.IcosahedronGeometry(0.14, 0), COL.leaf, [-0.4, -1.25, 0.4]],
   [new THREE.OctahedronGeometry(0.15, 0), COL.plum, [2.7, 1.0, -0.4]]].forEach(([geo, color, p]) => {
    const m = new THREE.Mesh(geo, lam(color)); m.position.set(p[0], p[1], p[2]); m.userData.base = p.slice(); shapes.push(m); scene.add(m);
  });

  // --- particles ---
  const N = full ? (dense ? 260 : 120) : (dense ? 140 : 70), pos = new Float32Array(N * 3), colr = new Float32Array(N * 3), pal = [COL.teal, COL.blue, COL.leaf, COL.sun, COL.rose, COL.plum].map((h) => new THREE.Color(h));
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * (full ? 26 : 9); pos[i * 3 + 1] = (Math.random() - 0.5) * (full ? 12 : 4.2); pos[i * 3 + 2] = (Math.random() - 0.5) * (full ? 8 : 3) - (full ? 2 : 0.5);
    const c = pal[i % pal.length]; colr[i * 3] = c.r; colr[i * 3 + 1] = c.g; colr[i * 3 + 2] = c.b;
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pgeo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  const points = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: full ? 0.11 : 0.07, vertexColors: true, transparent: true, opacity: 0.85 }));

  const stage = new THREE.Group();
  book.position.set(-2.5, 0.1, 0); bridge.position.set(0, -0.05, 0); sheet.position.set(2.3, 0.1, 0);
  book.userData.by = 0.1; bridge.userData.by = -0.05; sheet.userData.by = 0.1;
  if (full) {   // whole-page version: bigger objects spread across the screen
    stage.scale.setScalar(1.8);
    book.position.set(-2.9, -0.8, 0); bridge.position.set(0.3, -1.6, -0.6); sheet.position.set(2.8, 0.8, 0);
    book.userData.by = -0.8; bridge.userData.by = -1.6; sheet.userData.by = 0.8;
    shapes.forEach((m) => { m.userData.base = [m.userData.base[0] * 2.4, m.userData.base[1] * 1.9, m.userData.base[2]]; m.position.set(m.userData.base[0], m.userData.base[1], m.userData.base[2]); scene.add(m); });
  }
  stage.add(book, bridge, sheet);
  scene.add(stage, points);
  return { scene, stage, book, bridge, sheet, shapes, points, pos, N, ylim: full ? 6.2 : 2.1 };
}

function mount(el, opts) {
  opts = opts || {};
  let dead = false, api = { destroy() { dead = true; }, setProgress() {} };
  const fail = () => { if (el) el.classList.add('no3d'); if (opts.onFail) opts.onFail(); };
  if (!el || !('requestAnimationFrame' in window)) { fail(); return api; }
  const full = opts.variant === 'full';
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const weak = (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2;

  loadThree().then((THREE) => {
    if (dead || !el.isConnected) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: !weak, alpha: true, powerPreference: 'low-power' }); } catch (e) { fail(); return; }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, weak ? 1 : 1.5));
    const canvas = renderer.domElement; canvas.setAttribute('aria-hidden', 'true'); canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    el.appendChild(canvas); el.classList.add('is-3d');
    const S = build(THREE, !weak, full);
    const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 60);
    const look = { x: 0, y: 0 }, target = { x: 0, y: 0 }; let progress = 0, t = 0, raf = 0, last = performance.now(), frames = 0, slow = 0, visible = true, stopped = false;

    function fit() {
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight), aspect = w / h;
      renderer.setSize(w, h, false); camera.aspect = aspect;
      camera.position.z = full ? Math.min(16, 8.8 * Math.max(1, 1.9 / aspect)) : Math.min(14, 6.4 * Math.max(1, 2.2 / aspect));   // narrow screens: step back so nothing is cut off
      camera.updateProjectionMatrix(); draw();
    }
    function draw() { camera.position.x = look.x * (full ? 1.5 : 0.6); camera.position.y = look.y * (full ? 0.9 : 0.4); camera.lookAt(0, 0, 0); renderer.render(S.scene, camera); }
    function step(dt) {
      t += dt;
      look.x += (target.x - look.x) * 0.05; look.y += (target.y - look.y) * 0.05;
      S.stage.rotation.y = full ? Math.sin(t * 0.25) * 0.12 + look.x * 0.18 : Math.sin(t * 0.25) * 0.25 + progress * Math.PI * 1.6 + look.x * 0.3;
      S.book.rotation.y = 0.4 + t * 0.45; S.book.position.y = S.book.userData.by + Math.sin(t * 0.9) * 0.12;
      S.bridge.rotation.y = -0.35 + Math.sin(t * 0.4) * 0.35; S.bridge.position.y = S.bridge.userData.by + Math.sin(t * 0.7 + 1) * 0.08;
      S.sheet.rotation.y = -0.45 + Math.sin(t * 0.5 + 2) * 0.4; S.sheet.position.y = S.sheet.userData.by + Math.sin(t * 0.8 + 2) * 0.1;
      S.shapes.forEach((m, i) => { m.rotation.x += dt * (0.4 + i * 0.1); m.rotation.y += dt * (0.5 + i * 0.07); m.position.y = m.userData.base[1] + Math.sin(t * 0.8 + i * 1.3) * 0.15; });
      const p = S.pos; for (let i = 0; i < S.N; i++) { p[i * 3 + 1] += dt * (0.05 + (i % 5) * 0.015); if (p[i * 3 + 1] > S.ylim) p[i * 3 + 1] = -S.ylim; }
      S.points.geometry.attributes.position.needsUpdate = true;
      S.points.rotation.y = t * 0.03;
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!el.isConnected) { api.destroy(); return; }
      const raw = now - last; last = now;
      if (document.hidden || !visible) return;
      step(Math.min(0.05, raw / 1000)); draw();
      frames++; if (raw > 34) slow++;
      if (frames === 120 && slow > 70) { stopped = true; cancelAnimationFrame(raf); draw(); }   // too slow for this phone: stop moving, keep the picture
    }
    const onMove = (e) => { const r = el.getBoundingClientRect(); target.x = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2; target.y = -((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2; };
    const ro = window.ResizeObserver ? new ResizeObserver(fit) : null; if (ro) ro.observe(el); else window.addEventListener('resize', fit);
    const io = window.IntersectionObserver ? new IntersectionObserver((en) => { visible = en[0].isIntersecting; }) : null; if (io) io.observe(el);
    if (!reduce) window.addEventListener('pointermove', onMove, { passive: true });
    fit();
    if (reduce) { step(0.5); draw(); } else raf = requestAnimationFrame(frame);

    api.setProgress = (v) => { progress = Math.max(0, Math.min(1, v || 0)); if (reduce || stopped) { step(0); draw(); } };
    api.destroy = () => {
      if (api.destroyed) return; api.destroyed = true; dead = true; cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('resize', fit);
      if (ro) ro.disconnect(); if (io) io.disconnect();
      S.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      renderer.dispose(); if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
    if (dead) api.destroy();
  }).catch((e) => { if (window.console) console.warn('3D scene off:', e && e.message); fail(); });
  return { destroy: () => api.destroy(), setProgress: (v) => api.setProgress(v) };
}

window.SetuScene = { mount };
})();
