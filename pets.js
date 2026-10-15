/* =====================================================================
   深海萌物随宠 — five chibi cats floating in swim rings (refs 1–5)
   Each pet: one merged vertex-coloured matte mesh, one glossy mesh (ring,
   lenses, bells…), a painted face decal cut from the creator's artwork,
   and an inverted-hull outline for the hand-drawn look.
   Local frame: +z = the pet's front, +y up, ring centred at the origin.
   ===================================================================== */
import { THREE, mergeGeometries } from './vendor/three-kit.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = h => new THREE.Color(h);
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();

export const PETS = [
  { id: 'yingying', name: '嘤嘤子', face: 0, fur: '#f8c4d1', furDeep: '#f2a9bd', hair: '#f9c9d6', inner: '#fff1f4', ring: '#f7a7bf', frill: '#fff3f6', outline: '#7a2c3e', tail: '#f3b2c4', tailTip: '#6e2a35', paw: '#fff6f8' },
  { id: 'minaihua', name: '咪奈花', face: 1, fur: '#f9d2dc', furDeep: '#f2b6c8', hair: '#f8c7d6', inner: '#a8384f', ring: '#b88ce8', frill: '#cfb0f4', outline: '#4a1f3c', tail: '#f3c0cf', tailTip: '#f3c0cf', paw: '#fff3f6' },
  { id: 'langlangxian', name: '浪浪仙', face: 2, fur: '#f7dc8e', furDeep: '#efc56a', hair: '#f8de8a', inner: '#bfe6dc', ring: '#fccf3a', frill: '#f0b52a', outline: '#6a4418', tail: '#f3d68a', tailTip: '#f3d68a', paw: '#53505c' },
  { id: 'qiubangli', name: '球棒狸', face: 3, fur: '#aaaab8', furDeep: '#8f8fa0', hair: '#cbcbd8', inner: '#fff7fa', ring: '#f2524c', frill: '#dc3a36', outline: '#2c2836', tail: '#9a90b6', tailTip: '#c9c0de', paw: '#fff6f8' },
  { id: 'qingtianniaoniao', name: '晴天鸟鸟', face: 4, fur: '#eef0fb', furDeep: '#dfe2f6', hair: '#eceffc', inner: '#fff8fb', ring: '#8fd2f6', frill: '#f6fbff', outline: '#2a3866', tail: '#e6e8f8', tailTip: '#e6e8f8', paw: '#fff8fb' },
];

/* ---------- geometry helpers ---------- */
function paint(g, col){ const n = g.attributes.position.count, a = new Float32Array(n * 3); const c = col.isColor ? col : C(col); for (let i = 0; i < n; i++){ a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function paintFn(g, fn){ const p = g.attributes.position, n = p.count, a = new Float32Array(n * 3), c = new THREE.Color(); for (let i = 0; i < n; i++){ _v.fromBufferAttribute(p, i); fn(_v, c, i); a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function xf(g, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]){ _e.set(rot[0], rot[1], rot[2]); _q.setFromEuler(_e); _m.compose(_v.set(...pos), _q, _s.set(...scl)); g.applyMatrix4(_m); return g; }
const ell = (rx, ry, rz, ws = 22, hs = 14) => new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz);
/** tube along a Catmull-Rom curve with radius r(t); fx/fy flatten the section; colFn(t) optional */
function taper(points, rFn, { sides = 10, segs = 28, fx = 1, fy = 1, colFn = null } = {}){
  const curve = new THREE.CatmullRomCurve3(points), g = new THREE.TubeGeometry(curve, segs, 1, sides, false), pos = g.attributes.position;
  const cols = colFn ? new Float32Array(pos.count * 3) : null, c = new THREE.Color(), P = new THREE.Vector3();
  for (let i = 0; i <= segs; i++){
    const t = i / segs; curve.getPointAt(t, P); const N = g.normals[i], B = g.binormals[i], r = Math.max(0.0008, rFn(t));
    if (colFn) colFn(t, c);
    for (let j = 0; j <= sides; j++){ const k = i * (sides + 1) + j; _v.fromBufferAttribute(pos, k).sub(P); const a = _v.dot(N), b = _v.dot(B);
      _v.copy(P).addScaledVector(N, a * r * fx).addScaledVector(B, b * r * fy); pos.setXYZ(k, _v.x, _v.y, _v.z);
      if (cols){ cols[k * 3] = c.r; cols[k * 3 + 1] = c.g; cols[k * 3 + 2] = c.b; } }
  }
  g.computeVertexNormals(); if (cols) g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}
function starShape(R, r, n = 5){ const s = new THREE.Shape(); for (let i = 0; i <= n * 2; i++){ const a = i / (n * 2) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r : R; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? s.lineTo(x, y) : s.moveTo(x, y); } return s; }
const extrude = (shape, depth, bevel = 0.012) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 }); g.translate(0, 0, -depth / 2); return g; };
function norm(g){ g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k); if (!g.attributes.normal) g.computeVertexNormals(); return g; }

/* ---------- materials (shared by all pets) ---------- */
function selfLit(mat, k){ mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * ${k.toFixed(2)};`); }; mat.customProgramCacheKey = () => 'pet-self-' + k; return mat; }
let MATS = null;
function mats(){
  if (MATS) return MATS;
  const outline = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  outline.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normalize(normal) * 0.016;'); };
  outline.customProgramCacheKey = () => 'pet-outline';
  MATS = {
    matte: selfLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide }), 0.3),
    gloss: selfLit(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12 }), 0.22),
    outline,
  };
  return MATS;
}

/* ---------- one pet ---------- */
export function buildPet(def, faceTex){
  const M = mats(), matte = [], gloss = [], noOutline = [];
  const add = (g, col, list = matte, outline = true) => { if (col) paint(g, col); const n = norm(g); n.userData.noOutline = !outline; list.push(n); return n; };
  const fur = C(def.fur), white = C('#ffffff');
  const H = V(0, 0.98, 0.02), HR = V(0.53, 0.45, 0.47);
  /** point on (k-scaled) head surface; lon from +z toward +x, lat up */
  const hp = (lon, lat, k = 1) => V(H.x + Math.sin(lon) * Math.cos(lat) * HR.x * k, H.y + Math.sin(lat) * HR.y * k, H.z + Math.cos(lon) * Math.cos(lat) * HR.z * k);
  const hn = (lon, lat) => V(Math.sin(lon) * Math.cos(lat) / HR.x, Math.sin(lat) / HR.y, Math.cos(lon) * Math.cos(lat) / HR.z).normalize();
  const orient = (g, pos, dir, spin = 0) => { _q.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize()); if (spin) _q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), spin)); _m.compose(pos, _q, _s.set(1, 1, 1)); return g.applyMatrix4(_m); };

  // ---- swim ring + scalloped seam frill ----
  const ringG = new THREE.TorusGeometry(0.72, 0.3, 26, 72); ringG.rotateX(Math.PI / 2);
  const rc = C(def.ring), rcHi = rc.clone().lerp(white, 0.28), rcLo = rc.clone().multiplyScalar(0.86);
  paintFn(ringG, (p, c) => { const up = p.y / 0.3; c.copy(rc).lerp(up > 0 ? rcHi : rcLo, Math.abs(up) * 0.6); });
  add(ringG, null, gloss);
  { const pos = [], idx = [], N = 216;
    for (let i = 0; i <= N; i++){ const a = i / N * Math.PI * 2, sc = 0.035 * Math.pow(Math.abs(Math.cos(a * 18)), 0.6);
      for (const [r, y] of [[0.99, -0.06], [1.05 + sc, -0.075], [1.05 + sc, -0.105], [0.99, -0.12]]) pos.push(Math.cos(a) * r, y, Math.sin(a) * r); }
    for (let i = 0; i < N; i++) for (let j = 0; j < 3; j++){ const k = i * 4 + j; idx.push(k, k + 4, k + 1, k + 1, k + 4, k + 5); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    add(g, def.frill, gloss); }
  const ringOnly = { gloss: gloss.length };

  // ---- body (seated), belly, arms, legs, feet with toe beans, tail ----
  const bodyG = new THREE.LatheGeometry([V(0.001, -0.02), V(0.2, -0.01), V(0.28, 0.08), V(0.29, 0.2), V(0.26, 0.33), V(0.2, 0.44), V(0.14, 0.52), V(0.001, 0.56)].map(p => new THREE.Vector2(p.x, p.y)), 28);
  bodyG.scale(1, 1, 0.9);
  add(paintFn(bodyG, (p, c) => { const front = p.z / 0.26, side = Math.abs(p.x) / 0.26; c.copy(fur).lerp(white, THREE.MathUtils.smoothstep(front - side * 0.55, 0.15, 0.5)); }));
  const pawCol = C(def.paw), pad = C('#f6a3b3');
  for (const sx of [-1, 1]){
    if (!(def.id === 'minaihua' && sx < 0) && !(def.id === 'qingtianniaoniao' && sx < 0)){
      add(taper([V(sx * 0.2, 0.43, 0.0), V(sx * 0.28, 0.3, 0.1), V(sx * 0.3, 0.18, 0.2)], t => 0.075 - 0.01 * t, { colFn: (t, c) => c.copy(def.sleeve ? C(def.sleeve) : fur) }));
      add(xf(ell(0.085, 0.075, 0.09), [sx * 0.31, 0.15, 0.22]), pawCol);
    }
    add(taper([V(sx * 0.12, 0.08, 0.1), V(sx * 0.14, 0.17, 0.3), V(sx * 0.155, 0.27, 0.43)], t => 0.095 - 0.012 * t, { colFn: (t, c) => c.copy(fur).lerp(white, t * 0.9) }));
    add(xf(ell(0.11, 0.1, 0.125), [sx * 0.16, 0.29, 0.48]), C('#fff7f9'));
    add(xf(ell(0.052, 0.045, 0.018), [sx * 0.16, 0.27, 0.6]), pad);
    for (let k = -1; k <= 1; k++) add(xf(ell(0.022, 0.024, 0.012), [sx * 0.16 + k * 0.04, 0.34 - Math.abs(k) * 0.012, 0.592]), pad);
  }
  add(taper([V(0.0, 0.1, -0.24), V(0.22, 0.08, -0.32), V(0.4, 0.16, -0.24), V(0.48, 0.32, -0.12), V(0.47, 0.46, -0.04)], t => 0.06 + 0.014 * Math.sin(t * Math.PI), { colFn: (t, c) => c.copy(C(def.tail)).lerp(C(def.tailTip), THREE.MathUtils.smoothstep(t, 0.72, 0.8)) }));
  add(xf(ell(0.062, 0.062, 0.062), [0.47, 0.46, -0.04]), C(def.tailTip));

  // ---- head: fur with a white muzzle; ears; cheek tufts; hair ----
  const headG = new THREE.SphereGeometry(1, 48, 34); headG.scale(HR.x, HR.y, HR.z); headG.translate(H.x, H.y, H.z);
  const furDeep = C(def.furDeep);
  add(paintFn(headG, (p, c) => { const nx = (p.x - H.x) / HR.x, ny = (p.y - H.y) / HR.y, nz = (p.z - H.z) / HR.z;
    const muzzle = THREE.MathUtils.smoothstep(nz, 0.25, 0.6) * THREE.MathUtils.smoothstep(-ny, 0.1, 0.42) * (1 - THREE.MathUtils.smoothstep(Math.abs(nx), 0.55, 0.8));
    c.copy(fur).lerp(furDeep, THREE.MathUtils.smoothstep(-nz, 0.2, 0.9) * 0.4).lerp(white, muzzle); }));
  for (const sx of [-1, 1]){
    const base = hp(sx * 0.62, 0.92, 0.9), dir = hn(sx * 0.62, 0.92).add(V(0, 0.9, 0)).normalize();
    const ear = new THREE.ConeGeometry(0.21, 0.44, 18, 1); ear.translate(0, 0.19, 0); ear.scale(1, 1, 0.55); orient(ear, base, dir); add(ear, fur);
    const inn = new THREE.ConeGeometry(0.135, 0.31, 14, 1); inn.translate(0, 0.16, 0); inn.scale(1, 1, 0.35); orient(inn, base.clone().add(V(0, 0.01, 0.06)), dir); add(inn, def.inner);
    for (let k = 0; k < 3; k++){ const tuft = new THREE.ConeGeometry(0.03, 0.12, 6); tuft.translate(0, 0.05, 0); orient(tuft, base.clone().add(V(sx * (-0.03 + k * 0.03), 0.04 + k * 0.02, 0.08)), dir.clone().add(V(sx * 0.3 * (k - 1), 0, 0.3)).normalize()); add(tuft, C('#ffffff'), matte, false); }
    for (let k = 0; k < 4; k++){ const lat = -0.05 - k * 0.2, lon = sx * (1.28 + k * 0.05); const tf = new THREE.ConeGeometry(0.075 - k * 0.008, 0.2 - k * 0.02, 8); tf.translate(0, 0.07, 0);
      orient(tf, hp(lon, lat, 0.94), hn(lon, lat).add(V(0, -0.35 - k * 0.15, 0)).normalize()); add(tf, k > 1 ? fur.clone().lerp(white, 0.6) : fur); }
  }
  // hair cap + bangs (one lock dips between the eyes, as drawn)
  const capG = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, 1.25); capG.scale(HR.x * 1.045, HR.y * 1.07, HR.z * 1.05); capG.translate(H.x, H.y + 0.012, H.z - 0.01);
  const hairC = C(def.hair);
  add(paintFn(capG, (p, c) => c.copy(hairC).lerp(white, Math.max(0, (p.y - H.y) / HR.y - 0.7) * 0.5)));
  const bangs = [[-0.66, 0.46, 0.12], [-0.38, 0.42, 0.13], [-0.1, 0.3, 0.12], [0.16, 0.44, 0.13], [0.42, 0.42, 0.13], [0.68, 0.48, 0.11]];
  for (const [lon, end, r] of bangs){ const pts = []; for (let k = 0; k <= 5; k++){ const t = k / 5, lat = THREE.MathUtils.lerp(1.2, end, t); pts.push(hp(lon + Math.sin(t * 2) * 0.06 * Math.sign(lon || 1), lat, 1.075 - 0.04 * t)); }
    add(taper(pts, t => r * (1 - t * 0.9) * (0.75 + 0.25 * Math.sin(Math.min(1, t * 3) * Math.PI / 2)), { sides: 10, segs: 18, fx: 1, fy: 0.45 }), hairC, matte, false); }
  for (const sx of [-1, 1]){ const pts = []; for (let k = 0; k <= 5; k++){ const t = k / 5; pts.push(hp(sx * (0.95 + t * 0.35), THREE.MathUtils.lerp(0.75, -0.55, t), 1.05)); }
    add(taper(pts, t => 0.08 * (1 - t * 0.8), { sides: 8, segs: 18, fy: 0.6 }), hairC, matte, false); }

  // ---- per-pet costume & props ----
  const G = (g, col) => add(g, col, gloss);
  const bell = (p) => G(xf(ell(0.042, 0.042, 0.04), p), '#e0b04a');
  const neckBow = (col) => { add(xf(ell(0.05, 0.045, 0.035), [0, 0.5, 0.235]), col); for (const sx of [-1, 1]){ add(xf(ell(0.11, 0.068, 0.035), [sx * 0.1, 0.505, 0.215], [0, sx * 0.25, sx * 0.3]), col); add(xf(new THREE.BoxGeometry(0.05, 0.11, 0.02), [sx * 0.04, 0.43, 0.24], [0.1, 0, sx * 0.35]), col); } bell([0, 0.47, 0.27]); };
  const lapels = (col, trim) => { for (const sx of [-1, 1]){ const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(sx * 0.1, -0.02); s.lineTo(sx * 0.085, -0.15); s.lineTo(sx * 0.015, -0.13); s.closePath();
      add(xf(extrude(s, 0.02, 0.006), [sx * 0.025, 0.44, 0.255], [-0.25, 0, 0]), col); const t = new THREE.TorusGeometry(0.012, 0.004, 4, 6); add(xf(t, [sx * 0.07, 0.36, 0.27]), trim); } };
  const cape = (col, inner) => { const g = new THREE.LatheGeometry([new THREE.Vector2(0.17, 0.52), new THREE.Vector2(0.27, 0.36), new THREE.Vector2(0.34, 0.14), new THREE.Vector2(0.38, -0.02)], 26, Math.PI * 0.55, Math.PI * 0.9);
    add(paintFn(g, (p, c) => c.copy(C(col)).lerp(C(inner || col), Math.max(0, -p.z) > 0.2 ? 0 : 0.3)), null, matte, false); };
  const jacket = (col, edge) => { const g = new THREE.LatheGeometry([new THREE.Vector2(0.155, 0.52), new THREE.Vector2(0.215, 0.45), new THREE.Vector2(0.27, 0.33), new THREE.Vector2(0.3, 0.2), new THREE.Vector2(0.3, 0.06)], 30, 0.5, Math.PI * 2 - 1.0);
    g.scale(1, 1, 0.92); add(g, col, matte, false);
    if (edge) for (const sx of [-1, 1]) add(xf(new THREE.BoxGeometry(0.025, 0.36, 0.02), [sx * 0.085, 0.3, 0.27], [-0.12, 0, sx * -0.12]), edge); };

  if (def.id === 'yingying'){
    neckBow('#e8243a'); lapels('#7a3240', '#d8a648');
    const top = hp(0, 1.25, 0.98);
    add(xf(ell(0.11, 0.1, 0.1), [0, top.y + 0.02, top.z - 0.12]), C(def.hair));
    add(xf(ell(0.07, 0.065, 0.06), [0, top.y + 0.06, top.z - 0.07]), '#e8243a');
    for (const sx of [-1, 1]){ add(xf(ell(0.2, 0.14, 0.085), [sx * 0.18, top.y + 0.08, top.z - 0.1], [0.5, sx * 0.25, sx * 0.4]), '#e8243a'); add(xf(ell(0.1, 0.06, 0.04), [sx * 0.13, top.y + 0.1, top.z - 0.04], [0.5, 0, sx * 0.4]), '#ff5a68'); }
    const fc = hp(0.72, 0.84, 1.1), fn = hn(0.72, 0.84).add(V(0.15, 0.2, 0.9)).normalize();
    for (let k = 0; k < 5; k++){ const a = k / 5 * Math.PI * 2; const p = new THREE.Vector3(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0); const g = ell(0.1, 0.07, 0.018); g.rotateZ(a); g.translate(p.x, p.y, p.z); g.rotateX(-Math.PI / 2); orient(g, fc, fn); add(paintFn(g, (q, c) => c.set('#fff6f8'))); }
    const ctr = ell(0.045, 0.045, 0.024); ctr.rotateX(-Math.PI / 2); orient(ctr, fc.clone().addScaledVector(fn, 0.012), fn); add(ctr, '#f06a8a');
    for (let k = 0; k < 5; k++){ const a = k / 5 * Math.PI * 2 + 0.6, g = new THREE.CylinderGeometry(0.006, 0.006, 0.06, 4); g.rotateZ(Math.PI / 2); g.rotateZ(a); g.translate(Math.cos(a) * 0.055, Math.sin(a) * 0.055, 0.016); g.rotateX(-Math.PI / 2); orient(g, fc, fn); add(g, '#f48aa6', matte, false); }
  }
  if (def.id === 'minaihua'){
    neckBow('#e3283a'); lapels('#6b3040', '#d8a648'); cape('#3b2234', '#7a1d36');
    // top hat tilted on her right (viewer's left)
    const base = hp(-0.5, 0.92, 0.97), dir = hn(-0.5, 0.92).add(V(0, 1.4, 0)).normalize(), hat = '#3a2335';
    const hatParts = [[new THREE.CylinderGeometry(0.175, 0.16, 0.3, 28, 1), 0.17, hat], [new THREE.CylinderGeometry(0.29, 0.29, 0.03, 32, 1), 0.015, hat], [new THREE.CylinderGeometry(0.18, 0.18, 0.06, 28, 1), 0.06, '#7e1d2c'], [new THREE.CylinderGeometry(0.178, 0.178, 0.012, 28, 1), 0.32, '#4a2c44']];
    for (const [g, y, col] of hatParts){ g.translate(0, y, 0); orient(g, base, dir); add(g, col); }
    { const bc = base.clone().addScaledVector(dir, 0.07).add(V(-0.05, 0, 0.16)); for (const sx of [-1, 1]) add(xf(ell(0.065, 0.045, 0.025), [bc.x + sx * 0.06, bc.y, bc.z], [0, -0.4, sx * 0.35]), '#ffffff'); add(xf(ell(0.028, 0.03, 0.025), bc.toArray()), '#f2f2f6'); }
    // magician's glove wand in her right paw (viewer's left)
    add(taper([V(-0.2, 0.43, 0.0), V(-0.28, 0.36, 0.14), V(-0.32, 0.34, 0.28)], t => 0.072, {}), C(def.fur)); add(xf(ell(0.08, 0.075, 0.085), [-0.33, 0.34, 0.3]), C(def.paw));
    G(taper([V(-0.33, 0.12, 0.32), V(-0.38, 0.6, 0.33), V(-0.43, 1.06, 0.34)], () => 0.017, { sides: 8, segs: 8 }), '#dfe2ea'); G(xf(ell(0.03, 0.03, 0.03), [-0.33, 0.1, 0.32]), '#d8b050');
    const gw = V(-0.45, 1.17, 0.35), glove = '#9b1626';
    add(xf(ell(0.1, 0.11, 0.07), gw.toArray(), [0, 0, 0.15]), glove);
    add(taper([gw.clone().add(V(0.0, 0.06, 0.02)), gw.clone().add(V(0.01, 0.16, 0.03)), gw.clone().add(V(0.02, 0.24, 0.03))], t => 0.042 - 0.008 * t, { sides: 10, segs: 8 }), C(glove));
    add(xf(ell(0.043, 0.04, 0.04), gw.clone().add(V(0.02, 0.245, 0.03)).toArray()), glove);
    G(xf(ell(0.022, 0.026, 0.01), gw.clone().add(V(0.02, 0.25, 0.068)).toArray()), '#d8354a');
    for (let k = 0; k < 3; k++) add(xf(ell(0.04, 0.03, 0.035), gw.clone().add(V(0.07, 0.04 - k * 0.045, 0.04)).toArray()), glove);
    add(xf(ell(0.035, 0.05, 0.03), gw.clone().add(V(-0.08, 0.02, 0.04)).toArray(), [0, 0, 0.6]), glove);
    add(xf(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 14), gw.clone().add(V(0.0, -0.11, 0)).toArray()), '#7a1020');
  }
  if (def.id === 'langlangxian'){
    def.sleeve = '#a9dcec'; cape('#5b3f8e', '#6d4fa8'); jacket('#a9dcec', '#f6fbff');
    for (const sx of [-1, 1]){ add(taper([V(sx * 0.2, 0.43, 0.0), V(sx * 0.28, 0.3, 0.1), V(sx * 0.3, 0.18, 0.2)], t => 0.082 - 0.008 * t, {}), C('#a9dcec')); add(xf(new THREE.TorusGeometry(0.07, 0.022, 8, 18), [sx * 0.302, 0.19, 0.2], [Math.PI / 2 - 0.6, 0, sx * 0.3]), '#f1c25a'); }
    G(xf(new THREE.TorusGeometry(0.11, 0.008, 6, 30), [0, 0.47, 0.06], [Math.PI / 2 - 0.35, 0, 0], [1, 1.35, 1]), '#e8b84a');
    G(xf(ell(0.034, 0.055, 0.016), [0, 0.37, 0.265], [-0.25, 0, 0]), '#36b5ae');
    for (const sx of [-1, 1]) add(xf(new THREE.BoxGeometry(0.07, 0.09, 0.02), [sx * 0.07, 0.47, 0.24], [-0.4, 0, sx * 0.5]), '#f6fbff');
    // sunglasses pushed up on the head, tilted, plus a gold star
    const gl = new THREE.Group();
    for (const sx of [-1, 1]){ const lp = hp(sx * 0.33, 0.62, 1.1), ln = hn(sx * 0.33, 0.62);
      const lens = ell(0.115, 0.09, 0.03, 24, 12); lens.rotateX(-Math.PI / 2); orient(lens, lp, ln); paintFn(lens, (p, c) => c.set('#5ed6cc').lerp(C('#c9f6ff'), Math.max(0, (p.y - lp.y) / 0.09) * 0.7)); gloss.push(norm(lens));
      const fr = new THREE.TorusGeometry(0.115, 0.014, 8, 30); fr.scale(1, 0.8, 1); fr.rotateX(-Math.PI / 2); orient(fr, lp, ln); G(fr, '#d9a63a'); }
    G(taper([hp(-0.12, 0.66, 1.12), hp(0, 0.7, 1.13), hp(0.12, 0.66, 1.12)], () => 0.012, { sides: 6, segs: 6 }), '#d9a63a');
    const sp = hp(0.18, 1.02, 1.1), st = extrude(starShape(0.085, 0.036), 0.03, 0.01); st.rotateX(-0.4); st.translate(sp.x, sp.y + 0.04, sp.z); G(st, '#ffd23a');
  }
  if (def.id === 'qiubangli'){
    jacket('#2f2d38', '#f0b41e');
    for (const sx of [-1, 1]){ add(taper([V(sx * 0.2, 0.43, 0.0), V(sx * 0.28, 0.3, 0.1), V(sx * 0.3, 0.18, 0.2)], t => 0.082 - 0.008 * t, {}), C('#2f2d38')); }
    for (let k = 0; k < 5; k++){ const a = (k - 2) * 0.26, tf = new THREE.ConeGeometry(0.05, 0.1, 8); tf.translate(0, 0.05, 0); orient(tf, V(Math.sin(a) * 0.1, 0.44 - Math.abs(k - 2) * 0.02, 0.21 + Math.cos(a) * 0.03), V(Math.sin(a) * 0.4, -1, 0.6).normalize()); add(tf, '#ffffff', matte, false); }
    add(xf(new THREE.BoxGeometry(0.06, 0.08, 0.02), [0.08, 0.47, 0.24], [-0.4, 0, -0.5]), '#f0b41e');
    // baseball cap: black crown, yellow brim turned to the side, yellow badge
    const crown = new THREE.SphereGeometry(1, 30, 14, 0, Math.PI * 2, 0, Math.PI / 2); crown.scale(0.44, 0.3, 0.44); crown.rotateX(-0.18); crown.translate(0, H.y + 0.27, H.z - 0.03); add(crown, '#2a2633');
  
    add(xf(ell(0.04, 0.025, 0.04), [0, H.y + 0.57, H.z - 0.08]), '#2a2633');
    { const sh = new THREE.Shape(); sh.absellipse(0, 0, 0.33, 0.3, 0, Math.PI, false); sh.lineTo(-0.33, 0); const b = extrude(sh, 0.03, 0.01);
      b.rotateX(Math.PI / 2); b.rotateX(0.2); b.rotateY(0.5); const fz = 0.34; b.translate(Math.sin(0.5) * fz, H.y + 0.31, H.z - 0.03 + Math.cos(0.5) * fz); add(b, '#f7b81a'); }
    { const lg = extrude(starShape(0.06, 0.035, 3), 0.02, 0.006); lg.rotateX(-0.5); lg.translate(-0.04, H.y + 0.43, H.z + 0.33); add(lg, '#f7c21e'); }
  }
  if (def.id === 'qingtianniaoniao'){
    cape('#2e3378', '#3b3a8a');
    G(xf(new THREE.TorusGeometry(0.17, 0.035, 10, 28), [0, 0.5, 0.04], [Math.PI / 2 - 0.25, 0, 0], [1, 1.25, 1]), '#24306a');
    for (let k = 0; k < 8; k++) G(xf(ell(0.01, 0.01, 0.01), [Math.sin(k * 2.3) * 0.28, 0.1 + (k % 4) * 0.09, -0.3 - (k % 3) * 0.02]), '#ffffff');
    for (const sx of [-1, 1]) add(xf(ell(0.04, 0.025, 0.02), [sx * 0.03, 0.47, 0.25], [0, 0, sx * 0.6]), '#ffffff');
    add(xf(ell(0.018, 0.018, 0.018), [0, 0.47, 0.26]), '#ffd86a');
    // halo
    G(xf(new THREE.TorusGeometry(0.24, 0.022, 10, 40), [0.02, H.y + 0.68, H.z - 0.08], [Math.PI / 2 - 0.85, 0, -0.14]), '#e9c66f');
    { const st = extrude(starShape(0.05, 0.022), 0.02, 0.006); st.translate(0.25, H.y + 0.74, H.z + 0.04); G(st, '#e9c66f'); }
    // sunflower at her left ear (viewer's right)
    const fc = hp(0.72, 0.8, 1.1), fn = hn(0.72, 0.8).add(V(0.15, 0.2, 0.9)).normalize();
    for (let k = 0; k < 14; k++){ const a = k / 14 * Math.PI * 2, g = ell(0.095, 0.034, 0.014); g.translate(0.125, 0, 0); g.rotateZ(a); g.rotateX(-Math.PI / 2); orient(g, fc, fn); add(g, k % 2 ? '#f9c43a' : '#fbd24e'); }
    { const g = ell(0.075, 0.075, 0.03); g.rotateX(-Math.PI / 2); orient(g, fc.clone().addScaledVector(fn, 0.012), fn); add(g, '#6a3a1f'); }
    // microphone in her right paw (viewer's left)
    add(taper([V(-0.2, 0.43, 0.0), V(-0.28, 0.36, 0.14), V(-0.3, 0.36, 0.28)], () => 0.072, {}), C(def.fur)); add(xf(ell(0.08, 0.075, 0.085), [-0.31, 0.36, 0.3]), C(def.paw));
    const mc = V(-0.34, 0.62, 0.33);
    G(xf(new THREE.CylinderGeometry(0.045, 0.03, 0.34, 14), [-0.32, 0.43, 0.32], [0.08, 0, 0.1]), '#9fdcf0');
    G(xf(ell(0.08, 0.08, 0.08), mc.toArray()), '#bfe9f6');
    for (let k = -1; k <= 1; k++) G(xf(new THREE.TorusGeometry(0.08 * Math.cos(k * 0.45), 0.008, 6, 22), [mc.x, mc.y + Math.sin(k * 0.45) * 0.08, mc.z], [Math.PI / 2, 0, 0]), '#6ab8d8');
  }

  // ---- face decal: the creator's own drawing projected onto the head ----
  const FW = 0.43, FH = 0.215, FY = -0.07;
  const dec = new THREE.SphereGeometry(1, 64, 40, Math.PI / 2 - 1.15, 2.3, 0.95, 1.35);
  dec.scale(HR.x * 1.006, HR.y * 1.006, HR.z * 1.006);
  { const p = dec.attributes.position, uv = dec.attributes.uv; for (let i = 0; i < p.count; i++){ uv.setXY(i, 0.5 + p.getX(i) / (2 * FW), 0.5 + (p.getY(i) - FY) / (2 * FH)); } }
  dec.translate(H.x, H.y, H.z);

  // ---- assemble ----
  const root = new THREE.Group(), cat = new THREE.Group(), ringGrp = new THREE.Group(); root.add(ringGrp); root.add(cat);
  const catPose = new THREE.Group(); cat.add(catPose); catPose.scale.setScalar(1.12); catPose.position.set(0, 0.06, -0.03);
  const ringGeos = gloss.slice(0, ringOnly.gloss), propGloss = gloss.slice(ringOnly.gloss);
  const mk = (geos, mat, parent, shadow = true) => { if (!geos.length) return null; const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m; };
  const outCol = C(def.outline);
  mk(ringGeos, M.gloss, ringGrp); mk(ringGeos.map(g => paint(g.clone(), outCol)), M.outline, ringGrp, false);
  const body = mk(matte, M.matte, catPose); mk(propGloss, M.gloss, catPose);
  const ol = [...matte, ...propGloss].filter(g => !g.userData.noOutline).map(g => paint(g.clone(), outCol)); mk(ol, M.outline, catPose, false);
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, transparent: true, depthWrite: false, roughness: 0.65, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const face = new THREE.Mesh(dec, faceMat); face.renderOrder = 4; catPose.add(face);
  root.userData = { cat, ring: ringGrp, head: new THREE.Vector3(0, 2.0, 0), def };
  return root;
}

/** slice the 5-row face atlas into one CanvasTexture per pet */
export function sliceFaces(img){
  const w = img.width, h = img.height / 5, out = [];
  for (let i = 0; i < 5; i++){ const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, i * h, w, h, 0, 0, w, h);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; out.push(t); }
  return out;
}

/** just the swim ring (glossy torus + scalloped frill + ink outline) — the cat inside is now a Tripo model */
export function buildRing(def){
  const M = mats(), gloss = [], white = C('#ffffff');
  const ringG = new THREE.TorusGeometry(0.72, 0.3, 26, 72); ringG.rotateX(Math.PI / 2);
  const rc = C(def.ring), rcHi = rc.clone().lerp(white, 0.28), rcLo = rc.clone().multiplyScalar(0.86);
  paintFn(ringG, (p, c) => { const up = p.y / 0.3; c.copy(rc).lerp(up > 0 ? rcHi : rcLo, Math.abs(up) * 0.6); });
  gloss.push(norm(ringG));
  { const pos = [], idx = [], N = 216;
    for (let i = 0; i <= N; i++){ const a = i / N * Math.PI * 2, sc = 0.035 * Math.pow(Math.abs(Math.cos(a * 18)), 0.6);
      for (const [r, y] of [[0.99, -0.06], [1.05 + sc, -0.075], [1.05 + sc, -0.105], [0.99, -0.12]]) pos.push(Math.cos(a) * r, y, Math.sin(a) * r); }
    for (let i = 0; i < N; i++) for (let j = 0; j < 3; j++){ const k = i * 4 + j; idx.push(k, k + 4, k + 1, k + 1, k + 4, k + 5); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    gloss.push(norm(paint(g, def.frill))); }
  const grp = new THREE.Group(), outCol = C(def.outline);
  const m = new THREE.Mesh(mergeGeometries(gloss), M.gloss); m.castShadow = true; m.receiveShadow = true; grp.add(m);
  grp.add(new THREE.Mesh(mergeGeometries(gloss.map(g => paint(g.clone(), outCol))), M.outline));
  return grp;
}
