// 3D で見る（施主向けの絵）。three.js は開いたときにだけ読む。
// 図の部品（scene3d.js）を三角形にして並べ、回して見る。絵を PNG で書き出せる。

import { buildParts, groundGrid, groundOf, sceneBox, sunDirection } from './scene3d.js';
import { sheetOf } from './sheet.js';

let THREE, OrbitControls;
async function load() {
  if (!THREE) {
    THREE = await import('../vendor/three/three.module.min.js');
    ({ OrbitControls } = await import('../vendor/three/OrbitControls.js'));
  }
}

const M = (mm) => mm / 1000; // mm → m
const V = (p, z) => [M(p[0]), M(z), M(p[1])]; // 図の (x, y) と高さ → 3D

export class Viewer3D {
  constructor(host) {
    this.host = host;
  }

  async open(doc) {
    await load();
    this.doc = doc;
    if (!this.renderer) this.init();
    this.build();
    this.resize();
    this.view('bird');
  }

  init() {
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.host.append(r.domElement);
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#dfe9ef');
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('change', () => this.render());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);
  }

  resize() {
    if (!this.renderer) return;
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (this.renderer) this.renderer.render(this.scene, this.camera);
  }

  clear() {
    if (!this.root) return;
    this.root.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) [].concat(o.material).forEach((m) => m.dispose());
    });
    this.scene.remove(this.root);
  }

  build() {
    this.clear();
    const doc = this.doc;
    const root = new THREE.Group();
    this.root = root;
    this.scene.add(root);
    const box = sceneBox(doc) || { x0: -5000, y0: -5000, x1: 5000, y1: 5000 };
    const pad = Math.max(box.x1 - box.x0, box.y1 - box.y0) * 0.6 + 8000;
    const gb = { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
    this.box = box;

    // 光：空と地面の照り返し、南の太陽（影を落とす）
    root.add(new THREE.HemisphereLight('#f4f8ff', '#8a8a70', 1.6));
    const sun = new THREE.DirectionalLight('#fff6e8', 2.2);
    const sd = sunDirection(sheetOf(doc).north || 0);
    const cx = M((box.x0 + box.x1) / 2), cz = M((box.y0 + box.y1) / 2);
    const span = M(Math.max(gb.x1 - gb.x0, gb.y1 - gb.y0));
    sun.position.set(cx + sd[0] * span, sd[1] * span, cz + sd[2] * span);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -span / 2; sc.right = span / 2; sc.top = span / 2; sc.bottom = -span / 2;
    sc.near = 0.1; sc.far = span * 3;
    sun.shadow.bias = -0.0005;
    root.add(sun, sun.target);

    // 地面
    const step = Math.max(200, Math.max(gb.x1 - gb.x0, gb.y1 - gb.y0) / 160);
    const parts = buildParts(doc);
    this.groundAt = groundOf(doc);
    this.topZ = Math.max(0, ...parts.map((p) => p.z1 ?? (p.type === 'tree' ? p.z + p.h : 0)));
    root.add(this.groundMesh(groundGrid(doc, gb, step, parts)));

    for (const p of parts) {
      if (p.type === 'prism') root.add(this.prism(p));
      else if (p.type === 'wall') root.add(this.wall(p));
      else if (p.type === 'tree') root.add(this.tree(p));
      else if (p.type === 'outline') root.add(this.outline(p));
    }
    this.render();
  }

  mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...opts });
  }

  groundMesh({ nx, ny, hs, box }) {
    const pos = [], idx = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = box.x0 + (i * (box.x1 - box.x0)) / nx, y = box.y0 + (j * (box.y1 - box.y0)) / ny;
        pos.push(...V([x, y], hs[j * (nx + 1) + i]));
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.mat('#b9c7a0'));
    mesh.receiveShadow = true;
    return mesh;
  }

  // 多角形を押し出す。Shape は (x, -y) で作り、x 軸まわりに回して寝かせる。
  prism(p) {
    const shape = new THREE.Shape(p.pts.map(([x, y]) => new THREE.Vector2(M(x), -M(y))));
    const depth = Math.max(M(p.z1 - p.z0), 0.01);
    const bevel = p.rough ? { bevelEnabled: true, bevelThickness: Math.min(depth * 0.4, 0.12), bevelSize: 0.06, bevelSegments: 2 } : { bevelEnabled: false };
    const geo = new THREE.ExtrudeGeometry(shape, { depth, ...bevel });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, M(p.z0), 0);
    const mats = p.roof ? [this.mat(p.roof), this.mat(p.color)] : this.mat(p.color);
    const mesh = new THREE.Mesh(geo, mats);
    mesh.castShadow = p.kind !== 'hoso';
    mesh.receiveShadow = true;
    if (!p.shrubs) return mesh;
    // 植栽帯：低木を散らす
    const g = new THREE.Group();
    g.add(mesh);
    const ys = p.pts.map((q) => q[1]), xs = p.pts.map((q) => q[0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const stepS = 700;
    const shrubGeo = new THREE.IcosahedronGeometry(0.32, 1);
    const shrubMat = this.mat('#5f8a43');
    let k = 0;
    for (let y = y0 + stepS / 2; y < y1; y += stepS) {
      for (let x = x0 + stepS / 2 + ((k++ % 2) * stepS) / 2; x < x1; x += stepS) {
        if (!inside([x, y], p.pts)) continue;
        const s = new THREE.Mesh(shrubGeo, shrubMat);
        s.position.set(M(x), M(p.z1) + 0.2, M(y));
        s.scale.set(1, 0.75, 1);
        s.castShadow = true;
        g.add(s);
      }
    }
    return g;
  }

  wall(p) {
    const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1];
    const len = Math.hypot(dx, dy);
    const geo = new THREE.BoxGeometry(M(len + p.thickness * 0.5), M(p.z1 - p.z0), M(p.thickness));
    const mesh = new THREE.Mesh(geo, this.mat(p.color));
    mesh.position.set(M((p.a[0] + p.b[0]) / 2), M((p.z0 + p.z1) / 2), M((p.a[1] + p.b[1]) / 2));
    mesh.rotation.y = -Math.atan2(dy, dx);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  tree(p) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(M(p.trunkR) * 0.7, M(p.trunkR), M(p.crownZ + p.crownR[1] * 0.3), 8), this.mat(p.trunk));
    trunk.position.set(0, M(p.crownZ + p.crownR[1] * 0.3) / 2, 0);
    trunk.castShadow = true;
    g.add(trunk);
    const geo = new THREE.IcosahedronGeometry(1, 2);
    // 少し揺らして葉の塊らしく
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const s = 1 + 0.12 * Math.sin(pos.getX(i) * 7.1 + pos.getZ(i) * 5.3) * Math.cos(pos.getY(i) * 6.7);
      pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s, pos.getZ(i) * s);
    }
    geo.computeVertexNormals();
    const crown = new THREE.Mesh(geo, this.mat(p.color, { flatShading: true }));
    crown.scale.set(M(p.crownR[0]), M(p.crownR[1]), M(p.crownR[0]));
    crown.position.set(0, M(p.crownZ), 0);
    crown.castShadow = true;
    g.add(crown);
    g.position.set(M(p.c[0]), M(p.z), M(p.c[1]));
    return g;
  }

  outline(p) {
    const geo = new THREE.BufferGeometry().setFromPoints([...p.pts, p.pts[0]].map((q) => new THREE.Vector3(...V(q, q[2]))));
    return new THREE.Line(geo, new THREE.LineDashedMaterial({ color: p.color, dashSize: 0.6, gapSize: 0.3 })).computeLineDistances();
  }

  // 視点：bird（南東の上から）、eye（人の目線 1.5m、敷地の南の端から）、top（真上）
  view(kind) {
    const b = this.box;
    const cx = M((b.x0 + b.x1) / 2), cz = M((b.y0 + b.y1) / 2);
    // 縦長の画面（iPhone）では横が狭いので、その分だけ引く
    const size = Math.max(M(b.x1 - b.x0), M(b.y1 - b.y0), 5) * Math.min(Math.max(1 / this.camera.aspect, 1), 2.2);
    const north = ((sheetOf(this.doc).north || 0) * Math.PI) / 180;
    // 南（図の下）を north だけ回した向き
    const sx = -Math.sin(north), sz = Math.cos(north);
    const c = this.controls;
    if (kind === 'top') {
      this.camera.position.set(cx, size * 1.6, cz + 0.001);
      c.target.set(cx, 0, cz);
    } else if (kind === 'eye') {
      // 敷地の南の外から、目の高さ 1.5m で
      const d = size / 2 + Math.max(4, size * 0.35);
      const gx = cx + sx * d, gz = cz + sz * d;
      const gh = M(this.groundAt([gx * 1000, gz * 1000]));
      this.camera.position.set(gx, gh + 1.5, gz);
      c.target.set(cx, gh + 1.2, cz);
    } else {
      const ex = sx * 0.8 + sz * 0.6, ez = sz * 0.8 - sx * 0.6; // 南から少し東へ
      const top = M(this.topZ || 0);
      this.camera.position.set(cx + ex * size * 1.25, Math.max(size * 0.85, top * 1.6), cz + ez * size * 1.25);
      c.target.set(cx, top * 0.25, cz);
    }
    this.camera.fov = kind === 'eye' ? 60 : 45;
    this.camera.updateProjectionMatrix();
    c.update();
    this.render();
  }

  // 今の視点の絵を PNG にする（長辺 2400 画素ほど）。
  async snapshot() {
    const r = this.renderer;
    const ratio = r.getPixelRatio();
    const w = this.host.clientWidth, h = this.host.clientHeight;
    r.setPixelRatio(Math.min(4, 2400 / Math.max(w, h)));
    r.setSize(w, h, false);
    this.render();
    const blob = await new Promise((res) => r.domElement.toBlob(res, 'image/png'));
    r.setPixelRatio(ratio);
    r.setSize(w, h, false);
    this.render();
    return blob;
  }
}

function inside([x, y], pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
