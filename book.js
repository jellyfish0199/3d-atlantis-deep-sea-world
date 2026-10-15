/* =====================================================================
   《潮汐之书》 — a real page-flip book (three.js)
   Local frame: spine along z (the reader sits at +z), pages open toward ±x, y up.
   Leaf 0 is the hard front cover; leaves 1..N are paper that curls while it turns.
   Every leaf rests on a page block whose height follows how many leaves lie on that side,
   so nothing ever sinks into the lectern or into another page.
   ===================================================================== */
import { THREE } from './vendor/three-kit.js';

const TAU = Math.PI * 2;
const ease = t => t * t * (3 - 2 * t);

/* ---------- page art (canvas) ---------- */
function wrapText(g, text, maxW){
  const lines = []; let line = '';
  for (const ch of text){
    if (ch === '\n'){ lines.push(line); line = ''; continue; }
    if (line && g.measureText(line + ch).width > maxW){
      if (/[，。、！？；：」』）…]/.test(ch)){ lines.push(line + ch); line = ''; continue; }   // hanging punctuation
      lines.push(line); line = '';
    }
    line += ch;
  }
  if (line) lines.push(line);
  return lines;
}
function ornament(g, x, y, w, col){
  g.save(); g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x - w / 2, y); g.lineTo(x - 12, y); g.moveTo(x + 12, y); g.lineTo(x + w / 2, y); g.stroke();
  g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y); g.closePath(); g.stroke(); g.restore();
}
function drawWave(g, x, y, w, col){ g.save(); g.strokeStyle = col; g.lineWidth = 1.5; for (let r = 0; r < 3; r++){ g.beginPath(); for (let i = 0; i <= 40; i++){ const px = x + w * i / 40, py = y + r * 9 + Math.sin(i / 40 * TAU * 2 + r) * 4; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); } g.restore(); }
const ICONS = {
  trident(g, x, y, s){ g.beginPath(); g.moveTo(x, y + s); g.lineTo(x, y - s * 0.6); g.moveTo(x - s * 0.45, y - s * 0.75); g.quadraticCurveTo(x - s * 0.45, y - s * 0.1, x, y - s * 0.1); g.quadraticCurveTo(x + s * 0.45, y - s * 0.1, x + s * 0.45, y - s * 0.75); g.moveTo(x, y - s * 0.6); g.lineTo(x, y - s); g.stroke(); },
  shell(g, x, y, s){ g.beginPath(); g.moveTo(x - s, y + s * 0.4); g.quadraticCurveTo(x, y - s * 1.3, x + s, y + s * 0.4); g.closePath(); g.stroke(); for (let k = -2; k <= 2; k++){ g.beginPath(); g.moveTo(x, y + s * 0.4); g.lineTo(x + k * s * 0.38, y - s * 0.45 + Math.abs(k) * s * 0.18); g.stroke(); } },
  cat(g, x, y, s){ g.beginPath(); g.arc(x, y, s * 0.7, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(x - s * 0.6, y - s * 0.35); g.lineTo(x - s * 0.5, y - s * 1.05); g.lineTo(x - s * 0.15, y - s * 0.68); g.moveTo(x + s * 0.6, y - s * 0.35); g.lineTo(x + s * 0.5, y - s * 1.05); g.lineTo(x + s * 0.15, y - s * 0.68); g.stroke(); g.beginPath(); g.arc(x - s * 0.25, y - s * 0.05, s * 0.07, 0, TAU); g.arc(x + s * 0.25, y - s * 0.05, s * 0.07, 0, TAU); g.fill(); },
  river(g, x, y, s){ for (let r = 0; r < 3; r++){ g.beginPath(); for (let i = 0; i <= 20; i++){ const px = x - s + 2 * s * i / 20, py = y - s * 0.4 + r * s * 0.4 + Math.sin(i / 20 * TAU + r) * s * 0.12; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); } },
  star(g, x, y, s){ g.beginPath(); for (let i = 0; i <= 10; i++){ const a = i / 10 * TAU - Math.PI / 2, r = i % 2 ? s * 0.42 : s; i ? g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.stroke(); },
  boat(g, x, y, s){ g.beginPath(); g.moveTo(x - s, y); g.quadraticCurveTo(x, y + s * 0.7, x + s, y); g.closePath(); g.stroke(); g.beginPath(); g.arc(x - s * 0.3, y - s * 0.25, s * 0.25, 0, TAU); g.arc(x + s * 0.3, y - s * 0.25, s * 0.25, 0, TAU); g.stroke(); g.beginPath(); g.arc(x, y - s * 0.65, s * 0.25, 0, TAU); g.stroke(); },
  phone(g, x, y, s){ g.strokeRect(x - s * 0.5, y - s, s, s * 2); g.beginPath(); g.arc(x, y - s * 0.2, s * 0.25, 0, TAU); g.stroke(); },
  swing(g, x, y, s){ g.beginPath(); g.moveTo(x - s, y - s); g.lineTo(x + s, y - s); g.moveTo(x - s * 0.5, y - s); g.lineTo(x - s * 0.5, y + s * 0.5); g.moveTo(x + s * 0.5, y - s); g.lineTo(x + s * 0.5, y + s * 0.5); g.moveTo(x - s * 0.7, y + s * 0.5); g.quadraticCurveTo(x, y + s * 0.9, x + s * 0.7, y + s * 0.5); g.stroke(); },
  mermaid(g, x, y, s){ g.beginPath(); g.arc(x, y - s * 0.7, s * 0.28, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(x, y - s * 0.4); g.quadraticCurveTo(x + s * 0.5, y + s * 0.3, x - s * 0.1, y + s * 0.8); g.moveTo(x - s * 0.1, y + s * 0.8); g.lineTo(x - s * 0.5, y + s); g.moveTo(x - s * 0.1, y + s * 0.8); g.lineTo(x + s * 0.3, y + s * 1.05); g.stroke(); },
  coral(g, x, y, s){ const br = (px, py, a, l, d) => { const ex = px + Math.sin(a) * l, ey = py - Math.cos(a) * l; g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.stroke(); if (d > 0){ br(ex, ey, a - 0.45, l * 0.7, d - 1); br(ex, ey, a + 0.45, l * 0.7, d - 1); } }; br(x, y + s, 0, s * 0.8, 3); },
};
/** paints one page; `p` = { kind, title, sub, body, icon, lines } */
export function paintPage(p, w, h){
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'), k = w / 512;
  const ink = '#4a2e1c', soft = '#8a6a48', gold = '#b48a3c', teal = '#2f7d8c';
  if (p.kind === 'cover'){
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#1c4a5c'); gr.addColorStop(0.5, '#123848'); gr.addColorStop(1, '#0c2a38'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++){ g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.strokeStyle = '#d8b46a'; g.lineWidth = 5 * k; g.strokeRect(26 * k, 26 * k, w - 52 * k, h - 52 * k); g.lineWidth = 1.6 * k; g.strokeRect(40 * k, 40 * k, w - 80 * k, h - 80 * k);
    for (const [cx, cy] of [[40, 40], [w / k - 40, 40], [40, h / k - 40], [w / k - 40, h / k - 40]]){ g.beginPath(); g.arc(cx * k, cy * k, 12 * k, 0, TAU); g.stroke(); }
    g.lineWidth = 3 * k; g.strokeStyle = '#e8c87a'; ICONS.trident(g, w / 2, h * 0.36, 70 * k); g.beginPath(); g.arc(w / 2, h * 0.36, 110 * k, 0, TAU); g.lineWidth = 2 * k; g.stroke();
    g.fillStyle = '#f0d58e'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 ${62 * k}px "Noto Serif SC","Songti SC","STSong",serif`; g.fillText('潮汐之书', w / 2, h * 0.63);
    g.font = `${18 * k}px Georgia,serif`; g.fillStyle = '#cdb27a'; g.fillText('LIBER  AESTUUM', w / 2, h * 0.7);
    drawWave(g, w * 0.3, h * 0.78, w * 0.4, 'rgba(232,200,122,0.75)');
  } else {
    g.fillStyle = '#f4ead2'; g.fillRect(0, 0, w, h);
    const vg = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75); vg.addColorStop(0, 'rgba(255,250,235,0)'); vg.addColorStop(1, 'rgba(150,110,60,0.22)'); g.fillStyle = vg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++){ g.fillStyle = `rgba(120,90,50,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    // gutter shading on the spine side
    const gut = p.side === 'L' ? g.createLinearGradient(w, 0, w - 60 * k, 0) : g.createLinearGradient(0, 0, 60 * k, 0); gut.addColorStop(0, 'rgba(90,60,30,0.28)'); gut.addColorStop(1, 'rgba(90,60,30,0)'); g.fillStyle = gut; g.fillRect(0, 0, w, h);
    g.strokeStyle = gold; g.lineWidth = 2 * k; g.strokeRect(30 * k, 30 * k, w - 60 * k, h - 60 * k); g.lineWidth = 0.8 * k; g.strokeRect(38 * k, 38 * k, w - 76 * k, h - 76 * k);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    let y = 92 * k;
    if (p.icon && ICONS[p.icon]){ g.strokeStyle = teal; g.fillStyle = teal; g.lineWidth = 2.2 * k; ICONS[p.icon](g, w / 2, y + 6 * k, 30 * k); y += 70 * k; }
    if (p.sub){ g.fillStyle = soft; g.font = `${17 * k}px "Noto Serif SC","Songti SC",serif`; g.fillText(p.sub, w / 2, y); y += 40 * k; }
    if (p.title){ g.fillStyle = ink; g.font = `600 ${34 * k}px "Noto Serif SC","Songti SC","STSong",serif`; g.fillText(p.title, w / 2, y); y += 26 * k; ornament(g, w / 2, y, 200 * k, gold); y += 42 * k; }
    if (p.body){ g.fillStyle = ink; g.textAlign = 'left'; const fs = 20 * k; g.font = `${fs}px "Noto Serif SC","Songti SC","STSong",serif`;
      for (const para of p.body.split('\n')){ for (const ln of wrapText(g, '　　' + para, w - 120 * k)){ g.fillText(ln, 60 * k, y); y += fs * 1.75; if (y > h - 90 * k) break; } y += fs * 0.4; } }
    if (p.lines){ g.strokeStyle = 'rgba(138,106,72,0.45)'; g.lineWidth = 1 * k; for (let i = 0; i < p.lines; i++){ const ly = y + i * 40 * k; if (ly > h - 80 * k) break; g.beginPath(); g.moveTo(62 * k, ly); g.lineTo(w - 62 * k, ly); g.stroke(); } }
    if (p.list){ g.textAlign = 'left'; g.fillStyle = teal; g.font = `${21 * k}px "Noto Serif SC","Songti SC",serif`; p.list.slice(-10).forEach((n, i) => g.fillText('✧ ' + n, 70 * k, y + i * 38 * k)); }
    if (p.page){ g.textAlign = 'center'; g.fillStyle = soft; g.font = `${16 * k}px Georgia,serif`; g.fillText('— ' + p.page + ' —', w / 2, h - 50 * k); }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/* ---------- the book ---------- */
export function createBook({ pages, W = 0.74, H = 1.0, low = false }){
  // pages: [coverArt, page1 (inside front cover, left), page2 (right) ... , lastPage (inside back cover, right)]
  const nLeaf = (pages.length - 3) / 2;          // paper leaves between the covers
  const S = low ? 10 : 18, th = 0.0085, ct = 0.022, pw = low ? 320 : 512, ph = Math.round(pw * H / W);
  const group = new THREE.Group();
  const tex = pages.map((p, i) => paintPage({ ...p, side: i % 2 ? 'L' : 'R' }, p.kind === 'cover' ? pw : pw, ph));
  const leather = new THREE.MeshStandardMaterial({ color: 0x173f50, roughness: 0.55, metalness: 0.1 });
  const goldEdge = new THREE.MeshStandardMaterial({ color: 0xd8b46a, roughness: 0.35, metalness: 0.8 });
  const paperEdge = new THREE.MeshStandardMaterial({ color: 0xeee2c4, roughness: 0.9 });
  const pageMat = t => new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.22 });
  const mats = [];
  const leafGeo = () => {
    const pos = new Float32Array((S + 1) * 2 * 3), nor = new Float32Array((S + 1) * 2 * 3), uvF = new Float32Array((S + 1) * 2 * 2), uvB = new Float32Array((S + 1) * 2 * 2), idx = [];
    for (let k = 0; k <= S; k++) for (let r = 0; r < 2; r++){ const i = k * 2 + r; uvF[i * 2] = k / S; uvF[i * 2 + 1] = r ? 0 : 1; uvB[i * 2] = 1 - k / S; uvB[i * 2 + 1] = r ? 0 : 1; }
    for (let k = 0; k < S; k++){ const a = k * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, c, b, d); }
    const P = new THREE.BufferAttribute(pos, 3), N = new THREE.BufferAttribute(nor, 3);
    const gF = new THREE.BufferGeometry(); gF.setIndex(idx); gF.setAttribute('position', P); gF.setAttribute('normal', N); gF.setAttribute('uv', new THREE.BufferAttribute(uvF, 2));
    const gB = new THREE.BufferGeometry(); gB.setIndex(idx); gB.setAttribute('position', P); gB.setAttribute('normal', N); gB.setAttribute('uv', new THREE.BufferAttribute(uvB, 2));
    gF.boundingSphere = gB.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), W * 1.2);
    return { gF, gB, P, N };
  };
  /** bend the strip: angle a (0 = lying right, π = lying left), curl lags the free edge behind */
  const deform = (L, a, curl) => {
    const p = L.P.array, n = L.N.array, ds = W / S; let x = 0, y = 0;
    for (let k = 0; k <= S; k++){
      if (k > 0){ const tm = (k - 0.5) / S, th2 = a - curl * Math.sin(a) * Math.pow(tm, 1.4); x += Math.cos(th2) * ds; y += Math.sin(th2) * ds; }
      const tk = k / S, thk = a - curl * Math.sin(a) * Math.pow(tk, 1.4), nx = -Math.sin(thk), ny = Math.cos(thk);
      for (let r = 0; r < 2; r++){ const i = (k * 2 + r) * 3; p[i] = x; p[i + 1] = y; p[i + 2] = r ? H / 2 : -H / 2; n[i] = nx; n[i + 1] = ny; n[i + 2] = 0; }
    }
    L.P.needsUpdate = true; L.N.needsUpdate = true;
  };
  // static back cover + the inside-back-cover page
  const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, ct, H + 0.05), leather); back.position.set(W / 2 + 0.005, -ct / 2, 0); back.castShadow = back.receiveShadow = true; group.add(back);
  { const L = leafGeo(); deform(L, 0, 0); const m = pageMat(tex[tex.length - 1]); mats.push(m); const pl = new THREE.Mesh(L.gF, m); pl.position.y = 0.0006; group.add(pl); }
  // page blocks (thickness = leaves lying on each side)
  const blockR = new THREE.Mesh(new THREE.BoxGeometry(W - 0.012, 1, H - 0.01), paperEdge), blockL = blockR.clone();
  blockR.position.x = W / 2; blockL.position.x = -W / 2; group.add(blockR, blockL);
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, H + 0.05, 12, 1, false, Math.PI, Math.PI), leather); spine.rotation.x = Math.PI / 2; spine.position.y = -ct; group.add(spine);
  // leaves: 0 = hard cover (outer art + inside-cover page), then paper leaves
  const leaves = [];
  for (let i = 0; i <= nLeaf; i++){
    const pivot = new THREE.Group(); group.add(pivot);
    const L = leafGeo(); const lf = { i, pivot, L, a: 0, from: 0, to: 0, t: 1, delay: 0, dur: i ? 0.75 : 0.95, curl: i ? 0.9 : 0 };
    if (i === 0){
      const box = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, ct, H + 0.05), [leather, leather, pageMat(tex[0]), leather, leather, leather]);
      mats.push(box.material[2]); box.position.set(W / 2 + 0.005, ct / 2, 0); box.castShadow = true; pivot.add(box);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.012, ct + 0.002, H + 0.052), goldEdge); trim.position.set(W + 0.02, ct / 2, 0); pivot.add(trim);
      deform(L, 0, 0); const inner = new THREE.Mesh(L.gB, pageMat(tex[1])); inner.material.side = THREE.BackSide; mats.push(inner.material); inner.position.y = -0.0006; pivot.add(inner);
      lf.flatOnly = true;
    } else {
      const mf = pageMat(tex[i * 2]), mb = pageMat(tex[i * 2 + 1]); mb.side = THREE.BackSide; mats.push(mf, mb);
      const f = new THREE.Mesh(L.gF, mf), b = new THREE.Mesh(L.gB, mb); f.frustumCulled = b.frustumCulled = false; pivot.add(f, b); deform(L, 0, 0);
    }
    leaves.push(lf);
  }
  let spread = 0, active = 0, glow = 0;
  const stackY = () => {
    let right = 0, left = 0; for (const lf of leaves) if (lf.i > 0){ if (lf.a < Math.PI / 2) right++; else left++; }
    blockR.scale.y = Math.max(0.0001, right * th); blockR.position.y = right * th / 2; blockR.visible = right > 0;
    blockL.scale.y = Math.max(0.0001, left * th); blockL.position.y = left * th / 2; blockL.visible = left > 0;
    return { right, left };
  };
  const restY = (lf, side) => {   // height a leaf rests at on a given side
    if (lf.i === 0) return side ? 0 : nLeaf * th;
    return side ? lf.i * th : (nLeaf - lf.i + 1) * th;
  };
  function setSpread(s){
    s = Math.max(0, Math.min(nLeaf + 1, s)); if (s === spread) return false;
    const fwd = s > spread; spread = s;
    const order = fwd ? leaves : [...leaves].reverse(); let k = 0;
    for (const lf of order){ const to = lf.i < s ? Math.PI : 0; if (Math.abs(lf.to - to) < 1e-3) continue; lf.from = lf.a; lf.to = to; lf.t = 0; lf.delay = k++ * (fwd ? 0.13 : 0.08); }
    return true;
  }
  function update(dt, time){
    for (const lf of leaves){
      if (lf.t < 1){ if (lf.delay > 0){ lf.delay -= dt; } else { lf.t = Math.min(1, lf.t + dt / lf.dur); lf.a = lf.from + (lf.to - lf.from) * ease(lf.t); } }
      const u = ease(lf.a / Math.PI), y0 = restY(lf, 0), y1 = restY(lf, 1);
      const lift = Math.sin(lf.a) * (lf.i === 0 ? 0.01 : 0.02);
      lf.pivot.position.y = y0 + (y1 - y0) * u + lift;
      if (lf.i === 0){ lf.pivot.rotation.z = lf.a; }
      else if (lf.t < 1 || lf.dirty !== lf.a){ deform(lf.L, lf.a, lf.curl * (lf.to > lf.from ? 1 : -1)); lf.dirty = lf.a; }
    }
    stackY();
    glow += ((spread > 0 ? 1 : 0) * (0.6 + active * 0.4) - glow) * Math.min(1, dt * 2.5);
    for (const m of mats) m.emissiveIntensity = 0.2 + glow * 0.32 + Math.sin(time * 2.2) * 0.02 * glow;
  }
  /** repaint one page (e.g. the guest list after someone writes their name) */
  function repaint(i, p){ const t = paintPage({ ...p, side: i % 2 ? 'L' : 'R' }, pw, ph); const old = tex[i]; tex[i] = t; for (const m of mats) if (m.map === old){ m.map = t; m.emissiveMap = t; m.needsUpdate = true; } old.dispose(); }
  update(0, 0);
  return {
    group, update, repaint, nLeaf,
    get spread(){ return spread; }, get open(){ return spread > 0; },
    set active(v){ active = v; },
    openTo: s => setSpread(s), close: () => setSpread(0),
    next(){ return setSpread(spread >= nLeaf + 1 ? 1 : spread + 1); },
    prev(){ return setSpread(Math.max(1, spread - 1)); },
    size: { W, H },
  };
}
