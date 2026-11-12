// 3D で見る（施主向けの絵）。three.js は開いたときにだけ読む。
// 図の部品（scene3d.js）を立体にする。質感は絵を描いて作り（画像ファイルは持たない）、
// 光は ACES のトーンマッピング・空の色からの環境光・太陽一灯の柔らかい影。後処理は使わない（iPhone でも回るように）。

import { buildParts, groundGrid, groundOf, sceneBox, sunAt, rng } from './scene3d.js';
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
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));

// ---------- 質感：小さな絵を描いてテクスチャにする ----------

// 各質感：size は絵の一辺が実際の何 m か、draw は絵を描く。bump は凹凸の強さ（0 なら平ら）。
const TEX = {
  芝: { size: 1.2, bump: 0.012, rough: 1, draw: (c, r, s) => grass(c, r, s, ['#5f9146', '#6fa352', '#7fb45f', '#558640']) },
  人工芝: { size: 1.0, bump: 0.006, rough: 0.95, draw: (c, r, s) => grass(c, r, s, ['#5a9a45', '#63a44d', '#6cad55']) },
  地面: { size: 2.4, bump: 0.01, rough: 1, draw: (c, r, s) => grass(c, r, s, ['#9fb07a', '#a9b984', '#b3c08e', '#97a873', '#b5b08c']) },
  砂利: { size: 0.9, bump: 0.02, rough: 1, draw: (c, r, s) => pebbles(c, r, s, '#a9a49a', ['#c9c5bb', '#b7b2a7', '#9c978c', '#d6d2c8', '#8e897f'], 3.2) },
  防草シート砂利敷: { size: 0.9, bump: 0.02, rough: 1, draw: (c, r, s) => pebbles(c, r, s, '#a39e94', ['#c4c0b6', '#b0aba0', '#97928a', '#cfcbc1'], 3.0) },
  洗い出し: { size: 0.6, bump: 0.008, rough: 0.9, draw: (c, r, s) => pebbles(c, r, s, '#cdbf9f', ['#e0d5b9', '#b9a984', '#a59570', '#d8cba9', '#8f8468'], 1.3) },
  土間コンクリート: { size: 2.0, bump: 0.002, rough: 0.85, draw: (c, r, s) => concrete(c, r, s, '#cfccc5') },
  タイル: { size: 0.6, bump: 0.004, rough: 0.55, draw: (c, r, s) => tiles(c, r, s, 2, 2, '#d7c7ad', '#a7997f', 0.06) },
  平板: { size: 0.6, bump: 0.004, rough: 0.9, draw: (c, r, s) => tiles(c, r, s, 2, 2, '#cbc3b4', '#9d9689', 0.1) },
  インターロッキング: { size: 0.4, bump: 0.005, rough: 0.9, draw: (c, r, s) => bricks(c, r, s, 2, 4, ['#b98d6c', '#c49a78', '#a97f60', '#b28666'], '#8a6a52') },
  ウッドデッキ: { size: 0.72, bump: 0.004, rough: 0.7, draw: (c, r, s) => planks(c, r, s, 6, ['#8c6646', '#96704e', '#84603f', '#9a7552']) },
  土: { size: 1.2, bump: 0.015, rough: 1, draw: (c, r, s) => pebbles(c, r, s, '#5a4a3a', ['#6a5846', '#4e4032', '#75624e', '#463a2d'], 2.2) },
  ブロック: { size: 0.8, bump: 0.004, rough: 0.95, draw: (c, r, s) => bricks(c, r, s, 2, 4, ['#c4c1b8', '#bdbab1', '#cbc8bf'], '#9a978f', true) },
  外壁: { size: 2.0, bump: 0.002, rough: 0.9, draw: (c, r, s) => concrete(c, r, s, '#ebe5d8') },
  屋根: { size: 1.2, bump: 0.006, rough: 0.6, draw: (c, r, s) => roofing(c, r, s) },
  石: { size: 1.0, bump: 0.02, rough: 0.95, draw: (c, r, s) => concrete(c, r, s, '#9f998c', 34) },
};

function grass(c, r, s, cols) {
  c.fillStyle = cols[0];
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) {
    c.strokeStyle = cols[Math.floor(r() * cols.length)];
    c.globalAlpha = 0.35 + r() * 0.5;
    const x = r() * s, y = r() * s, l = 2 + r() * 5, a = -Math.PI / 2 + (r() - 0.5) * 1.2;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
  c.globalAlpha = 1;
}

function pebbles(c, r, s, base, cols, size) {
  c.fillStyle = base;
  c.fillRect(0, 0, s, s);
  const n = Math.floor((s * s) / (size * size * 5));
  for (let i = 0; i < n; i++) {
    const x = r() * s, y = r() * s, w = size * (0.5 + r()), h = size * (0.4 + r() * 0.8);
    c.fillStyle = cols[Math.floor(r() * cols.length)];
    // 端でつながるよう、はみ出た分は反対側にも描く
    for (const dx of [0, -s, s]) for (const dy of [0, -s, s]) {
      c.beginPath();
      c.ellipse(x + dx, y + dy, w, h, r() * Math.PI, 0, Math.PI * 2);
      c.fill();
    }
  }
}

function concrete(c, r, s, base, noise = 14) {
  c.fillStyle = base;
  c.fillRect(0, 0, s, s);
  const img = c.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const d = (r() - 0.5) * noise;
    img.data[i] += d; img.data[i + 1] += d; img.data[i + 2] += d;
  }
  c.putImageData(img, 0, 0);
}

function tiles(c, r, s, nx, ny, base, joint, vary) {
  concrete(c, r, s, base, 8);
  const w = s / nx, h = s / ny;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    c.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * vary})`;
    c.fillRect(i * w, j * h, w, h);
  }
  c.strokeStyle = joint;
  c.lineWidth = Math.max(2, s / 90);
  for (let i = 0; i <= nx; i++) { c.beginPath(); c.moveTo(i * w, 0); c.lineTo(i * w, s); c.stroke(); }
  for (let j = 0; j <= ny; j++) { c.beginPath(); c.moveTo(0, j * h); c.lineTo(s, j * h); c.stroke(); }
}

function bricks(c, r, s, nx, ny, cols, joint, block = false) {
  c.fillStyle = joint;
  c.fillRect(0, 0, s, s);
  const w = s / nx, h = s / ny, g = Math.max(1.5, s / 110);
  for (let j = 0; j < ny; j++) {
    const off = j % 2 ? w / 2 : 0;
    for (let i = -1; i <= nx; i++) {
      c.fillStyle = cols[Math.floor(r() * cols.length)];
      c.fillRect(i * w + off + g / 2, j * h + g / 2, w - g, h - g);
      if (block) { c.fillStyle = 'rgba(0,0,0,0.035)'; c.fillRect(i * w + off + g / 2, j * h + h * 0.55, w - g, h * 0.4); }
    }
  }
}

function planks(c, r, s, n, cols) {
  const h = s / n;
  for (let j = 0; j < n; j++) {
    c.fillStyle = cols[Math.floor(r() * cols.length)];
    c.fillRect(0, j * h, s, h);
    c.strokeStyle = 'rgba(60,40,25,0.25)';
    for (let k = 0; k < 5; k++) {
      const y = j * h + r() * h;
      c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(s * 0.3, y + (r() - 0.5) * 3, s * 0.7, y + (r() - 0.5) * 3, s, y); c.stroke();
    }
    c.fillStyle = 'rgba(40,25,15,0.7)';
    c.fillRect(0, j * h, s, Math.max(1.5, s / 120));
  }
}

function roofing(c, r, s) {
  concrete(c, r, s, '#6f6c66', 10);
  c.strokeStyle = 'rgba(0,0,0,0.28)';
  c.lineWidth = Math.max(1.5, s / 100);
  for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo((i * s) / 4, 0); c.lineTo((i * s) / 4, s); c.stroke(); }
}

export class Viewer3D {
  constructor(host) {
    this.host = host;
    this.hour = 10.5;
    this.person = false;
    this.texCache = new Map();
  }

  async open(doc, { library = [] } = {}) {
    await load();
    this.doc = doc;
    this.library = library;
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
    r.toneMapping = THREE.ACESFilmicToneMapping;
    this.host.append(r.domElement);
    this.renderer = r;
    this.coarse = matchMedia('(pointer: coarse)').matches;
    this.scene = new THREE.Scene();
    this.pmrem = new THREE.PMREMGenerator(r);
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

  // 質感のテクスチャ（色と凹凸）。一度作ったら使い回す。
  tex(name) {
    if (this.texCache.has(name)) return this.texCache.get(name);
    const def = TEX[name];
    const s = this.coarse ? 256 : 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const c = cv.getContext('2d', { willReadFrequently: true });
    let seed = 7;
    for (const ch of name) seed = (seed * 31 + ch.codePointAt(0)) | 0;
    def.draw(c, rng(seed), s);
    const map = new THREE.CanvasTexture(cv);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    map.repeat.set(1 / def.size, 1 / def.size);
    const out = { map, def };
    this.texCache.set(name, out);
    return out;
  }

  // 質感つきの素材。色を掛けて調子を変えられる。
  matOf(name, { tint = '#ffffff', ...opts } = {}) {
    const t = this.tex(name);
    return new THREE.MeshStandardMaterial({
      map: t.map, color: tint, roughness: t.def.rough, metalness: 0,
      bumpMap: t.def.bump ? t.map : null, bumpScale: t.def.bump ? t.def.bump * 60 : 0,
      ...opts,
    });
  }

  mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...opts });
  }

  build() {
    this.clear();
    const doc = this.doc;
    const root = new THREE.Group();
    this.root = root;
    this.scene.add(root);
    const box = sceneBox(doc) || { x0: -5000, y0: -5000, x1: 5000, y1: 5000 };
    const span = Math.max(box.x1 - box.x0, box.y1 - box.y0);
    const pad = span * 1.6 + 20000;
    const gb = { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
    this.box = box;
    this.span = M(span);

    // 光：空からの光（環境光は applyLight で空の色から作る）と太陽
    this.hemi = new THREE.HemisphereLight('#dfeaff', '#8a8468', 0.5);
    this.sun = new THREE.DirectionalLight('#fff4e0', 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.coarse ? 2048 : 4096, this.coarse ? 2048 : 4096);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 4;
    root.add(this.hemi, this.sun, this.sun.target);

    const parts = buildParts(doc, { library: this.library });
    this.groundAt = groundOf(doc);
    this.topZ = Math.max(0, ...parts.map((p) => p.z1 ?? (p.type === 'tree' ? p.z + p.h : 0)));

    // 地面：部材のまわりは細かく、遠くは霞で消える
    const near = { x0: box.x0 - span * 0.6 - 6000, y0: box.y0 - span * 0.6 - 6000, x1: box.x1 + span * 0.6 + 6000, y1: box.y1 + span * 0.6 + 6000 };
    const step = Math.max(200, Math.max(near.x1 - near.x0, near.y1 - near.y0) / 180);
    root.add(this.groundMesh(groundGrid(doc, near, step, parts), gb));

    for (const p of parts) {
      if (p.type === 'prism') root.add(p.kind === 'bldg' ? this.building(p) : p.kind === 'stone' ? this.stone(p) : this.prism(p));
      else if (p.type === 'wall') root.add(this.wall(p));
      else if (p.type === 'tree') root.add(this.tree(p));
      else if (p.type === 'outline') root.add(this.outline(p));
    }
    this.personMesh = this.personFigure();
    this.personMesh.visible = this.person;
    root.add(this.personMesh);
    this.applyLight();
  }

  // 時刻に合わせて、太陽・空・環境光・霞を決める
  applyLight() {
    const north = sheetOf(this.doc).north || 0;
    const s = sunAt({ north, hour: this.hour, date: new Date() });
    const low = clamp01((25 - s.elevation) / 21); // 朝夕ほど 1
    const b = this.box;
    const cx = M((b.x0 + b.x1) / 2), cz = M((b.y0 + b.y1) / 2);
    const reach = this.span * 0.9 + 12;
    this.sun.position.set(cx + s.dir[0] * reach * 2, s.dir[1] * reach * 2, cz + s.dir[2] * reach * 2);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -reach; sc.right = reach; sc.top = reach; sc.bottom = -reach;
    sc.near = 0.5; sc.far = reach * 5;
    sc.updateProjectionMatrix();
    this.sun.color.set(new THREE.Color('#fff4e0').lerp(new THREE.Color('#ffb070'), low));
    this.sun.intensity = lerp(3.2, 3.6, low);
    this.hemi.intensity = lerp(0.45, 1.1, low);
    this.renderer.toneMappingExposure = lerp(0.95, 1.15, low);

    // 空：天頂から地平へのぼかし。朝夕は地平が暖かい色に寄る
    const zenith = new THREE.Color('#5d93cf').lerp(new THREE.Color('#6b86b8'), low);
    const horizon = new THREE.Color('#dce9f2').lerp(new THREE.Color('#f6cfa4'), low);
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 256;
    const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, `#${zenith.getHexString()}`);
    g.addColorStop(0.42, `#${zenith.clone().lerp(horizon, 0.55).getHexString()}`);
    g.addColorStop(0.5, `#${horizon.getHexString()}`);
    g.addColorStop(1, `#${horizon.clone().multiplyScalar(0.92).getHexString()}`);
    c.fillStyle = g;
    c.fillRect(0, 0, 8, 256);
    this.skyTex?.dispose();
    this.envTex?.dispose();
    this.skyTex = new THREE.CanvasTexture(cv);
    this.skyTex.mapping = THREE.EquirectangularReflectionMapping;
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.skyTex;
    this.envTex = this.pmrem.fromEquirectangular(this.skyTex).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = lerp(0.85, 1.0, low);
    this.scene.fog = new THREE.Fog(horizon, this.span * 2.2 + 30, this.span * 7 + 160);
    this.render();
  }

  setHour(h) {
    this.hour = h;
    if (this.root) this.applyLight();
  }

  setPerson(on) {
    this.person = on;
    if (this.personMesh) this.personMesh.visible = on;
    this.render();
  }

  groundMesh({ nx, ny, hs, box }, far) {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = box.x0 + (i * (box.x1 - box.x0)) / nx, y = box.y0 + (j * (box.y1 - box.y0)) / ny;
        pos.push(...V([x, y], hs[j * (nx + 1) + i]));
        uv.push(M(x), M(y));
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
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(geo, this.matOf('地面'));
    mesh.receiveShadow = true;
    g.add(mesh);
    // 遠くまでの平らな地面（細かい地面の下に少し沈めて敷く）
    const w = M(far.x1 - far.x0), d = M(far.y1 - far.y0);
    const plane = new THREE.PlaneGeometry(w, d);
    plane.rotateX(-Math.PI / 2);
    const puv = plane.attributes.uv;
    for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * w, puv.getY(i) * d);
    const edge = hs.reduce((a, v) => a + v, 0) / hs.length;
    const farMesh = new THREE.Mesh(plane, this.matOf('地面'));
    farMesh.position.set(M((far.x0 + far.x1) / 2), M(edge) - 0.25, M((far.y0 + far.y1) / 2));
    farMesh.receiveShadow = true;
    g.add(farMesh);
    return g;
  }

  // 多角形を押し出す。Shape は (x, -y) で作り、x 軸まわりに回して寝かせる。上の面の UV は m のまま（質感が実寸で並ぶ）。
  extrude(pts, z0, z1, opts = {}) {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(M(x), -M(y))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(M(z1 - z0), 0.01), bevelEnabled: false, ...opts });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, M(z0), 0);
    return geo;
  }

  prism(p) {
    if (p.kind === 'plant') return this.plantBed(p);
    const top = TEX[p.material] ? this.matOf(p.material) : this.mat(p.color);
    const side = this.mat(new THREE.Color(p.color).multiplyScalar(0.8));
    const mesh = new THREE.Mesh(this.extrude(p.pts, p.z0, p.z1), [top, side]);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
  }

  // 植栽帯：土の上に、大きさと色の違う低木の塊を散らす
  plantBed(p) {
    const g = new THREE.Group();
    const bed = new THREE.Mesh(this.extrude(p.pts, p.z0, p.z1), [this.matOf('土'), this.mat('#4a3d30')]);
    bed.receiveShadow = true;
    g.add(bed);
    const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const r = rng(Math.round(x0 * 7 + y0 * 13) | 1);
    const geo = new THREE.IcosahedronGeometry(1, 2);
    roughen(geo, 0.16, 5);
    const cols = ['#4f7f3a', '#5c8c42', '#6a9a4c', '#487535', '#7aa556'];
    const mats = cols.map((c) => this.mat(c, { flatShading: true, roughness: 1 }));
    const stepS = 620;
    for (let y = y0 + stepS / 2; y < y1; y += stepS) {
      for (let x = x0 + stepS / 2; x < x1; x += stepS) {
        const px = x + (r() - 0.5) * stepS * 0.7, py = y + (r() - 0.5) * stepS * 0.7;
        if (!inside([px, py], p.pts) || r() < 0.12) continue;
        const sR = 0.22 + r() * 0.22;
        const s = new THREE.Mesh(geo, mats[Math.floor(r() * mats.length)]);
        s.position.set(M(px), M(p.z1) + sR * 0.55, M(py));
        s.scale.set(sR * (0.9 + r() * 0.4), sR * (0.7 + r() * 0.3), sR * (0.9 + r() * 0.4));
        s.rotation.y = r() * Math.PI;
        s.castShadow = true;
        s.receiveShadow = true;
        g.add(s);
      }
    }
    return g;
  }

  // 景石：でこぼこの塊を、描いた形の大きさに合わせる
  stone(p) {
    const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const w = M(Math.max(...xs) - Math.min(...xs)), d = M(Math.max(...ys) - Math.min(...ys)), h = M(p.z1 - p.z0);
    const geo = new THREE.IcosahedronGeometry(0.5, 2);
    roughen(geo, 0.22, 3.1, Math.round(cx + cy));
    const mesh = new THREE.Mesh(geo, this.matOf('石', { flatShading: true }));
    mesh.scale.set(w * 1.02, h * 1.5, d * 1.02);
    mesh.position.set(M(cx), M(p.z0) + h * 0.55, M(cy));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // 建物：基礎・外壁・屋根。四角い建物は切妻屋根と窓、ほかは陸屋根（軒を出す）。
  building(p) {
    const g = new THREE.Group();
    const base = p.z0, floor = p.z0 + 300, top = p.z1;
    const baseMesh = new THREE.Mesh(this.extrude(p.pts, base, floor + 80), this.mat('#a9a69e'));
    const walls = new THREE.Mesh(this.extrude(p.pts, floor + 80, top), this.matOf('外壁', { tint: '#f4efe4' }));
    for (const m of [baseMesh, walls]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    const roofMat = this.matOf('屋根');
    if (p.rect) {
      const { c, angle, a, b } = p.rect;
      const A = M(a), B = M(b), o = 0.5, pitch = 0.42, th = 0.09;
      const grp = new THREE.Group();
      grp.position.set(M(c[0]), M(top), M(c[1]));
      grp.rotation.y = -angle;
      const slope = Math.hypot(B + o, (B + o) * pitch);
      const tilt = Math.atan(pitch);
      for (const side of [1, -1]) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry((A + o) * 2, th, slope), roofMat);
        slab.position.set(0, ((B + o) * pitch) / 2 - o * pitch + th, (side * (B + o)) / 2);
        slab.rotation.x = side * tilt;
        slab.castShadow = true;
        slab.receiveShadow = true;
        grp.add(slab);
      }
      // 妻壁（三角）
      const tri = new THREE.Shape([new THREE.Vector2(-B, 0), new THREE.Vector2(B, 0), new THREE.Vector2(0, B * pitch)]);
      for (const side of [1, -1]) {
        const gable = new THREE.Mesh(new THREE.ShapeGeometry(tri), this.matOf('外壁', { tint: '#f4efe4', side: THREE.DoubleSide }));
        gable.rotation.y = Math.PI / 2;
        gable.position.set(side * A, 0, 0);
        gable.castShadow = true;
        grp.add(gable);
      }
      // 窓：長い面に並べ、短い面にも一つ
      const glass = new THREE.MeshStandardMaterial({ color: '#2f3b45', roughness: 0.12, metalness: 0.2, envMapIntensity: 1.6 });
      const frame = this.mat('#3b3a37', { roughness: 0.6 });
      const wallH = M(top - floor);
      const addWin = (x, z, rotY, w, h, sill) => {
        const win = new THREE.Group();
        const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.06), frame);
        const gl = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), glass);
        win.add(fr, gl);
        win.position.set(x, -wallH + sill + h / 2, z);
        win.rotation.y = rotY;
        grp.add(win);
      };
      const stories = wallH > 4.6 ? 2 : 1;
      const n = Math.max(1, Math.floor((A * 2) / 3.2));
      for (let s = 0; s < stories; s++) {
        const sill = s === 0 ? 0.55 : 3.3;
        const h = s === 0 ? 1.75 : 1.1;
        for (let i = 0; i < n; i++) {
          const x = -A + ((i + 0.5) * A * 2) / n;
          for (const side of [1, -1]) addWin(x, side * (B + 0.02), 0, Math.min(1.7, (A * 2) / n - 0.9), h, sill);
        }
        if (B * 2 > 3) for (const side of [1, -1]) addWin(side * (A + 0.02), 0, Math.PI / 2, 1.2, 1.0, s === 0 ? 1.0 : 3.4);
      }
      g.add(grp);
    } else {
      // 陸屋根：形を少し広げた薄い板
      const cx = p.pts.reduce((s, q) => s + q[0], 0) / p.pts.length, cy = p.pts.reduce((s, q) => s + q[1], 0) / p.pts.length;
      const wide = p.pts.map(([x, y]) => {
        const d = Math.hypot(x - cx, y - cy) || 1;
        return [x + ((x - cx) / d) * 450, y + ((y - cy) / d) * 450];
      });
      const roof = new THREE.Mesh(this.extrude(wide, top, top + 180), [roofMat, this.mat('#55524d')]);
      roof.castShadow = true;
      roof.receiveShadow = true;
      g.add(roof);
    }
    return g;
  }

  wall(p) {
    const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1];
    const len = M(Math.hypot(dx, dy) + p.thickness * 0.5), h = M(p.z1 - p.z0), th = M(p.thickness);
    const g = new THREE.Group();
    const isCurb = p.kind === 'enseki';
    const geo = new THREE.BoxGeometry(len, h, th);
    // 質感が実寸で並ぶよう、UV を m に直す
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) + pos.getZ(i), pos.getY(i));
    const stone = /石|擁壁/.test(p.material || '');
    const mat = isCurb ? this.mat('#bdb8ad') : stone ? this.matOf('石', { tint: '#d9d2c2' }) : this.matOf('ブロック');
    const body = new THREE.Mesh(geo, mat);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    if (!isCurb) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len + 0.02, 0.05, th + 0.04), this.mat('#d6d3ca'));
      cap.position.y = h / 2 + 0.025;
      cap.castShadow = true;
      g.add(cap);
    }
    g.position.set(M((p.a[0] + p.b[0]) / 2), M((p.z0 + p.z1) / 2), M((p.a[1] + p.b[1]) / 2));
    g.rotation.y = -Math.atan2(dy, dx);
    return g;
  }

  // 樹木：幹と枝、葉の塊をいくつも重ねた樹冠（針葉樹は段になった円すい）。木ごとに少しずつ違える。
  tree(p) {
    const g = new THREE.Group();
    const r = rng(p.seed || 1);
    const H = M(p.h), R = M(p.r);
    const trunkMat = this.mat(p.trunk, { roughness: 1 });
    const tone = new THREE.Color(p.color).offsetHSL((r() - 0.5) * 0.03, (r() - 0.5) * 0.08, (r() - 0.5) * 0.06);
    const leaf = (k) => this.mat(tone.clone().multiplyScalar(k), { flatShading: true, roughness: 1 });
    if (p.needle) {
      const trunkH = H * 0.22;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(M(p.trunkR) * 0.6, M(p.trunkR), trunkH, 8), trunkMat);
      trunk.position.y = trunkH / 2;
      trunk.castShadow = true;
      g.add(trunk);
      const tiers = 4;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(R * (1 - t * 0.72), (H * 0.86) / tiers * 1.7, 9), leaf(0.9 + t * 0.2));
        cone.position.y = trunkH * 0.6 + (H * 0.86 * (i + 0.85)) / tiers;
        cone.rotation.y = r() * Math.PI;
        cone.castShadow = true;
        cone.receiveShadow = true;
        g.add(cone);
      }
    } else {
      const crownY = M(p.crownZ), crownV = M(p.crownR[1]);
      const trunkH = crownY + crownV * 0.2;
      const lean = (r() - 0.5) * 0.08;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(M(p.trunkR) * 0.55, M(p.trunkR), trunkH, 8), trunkMat);
      trunk.position.y = trunkH / 2;
      trunk.rotation.z = lean;
      trunk.castShadow = true;
      g.add(trunk);
      // 枝
      for (let i = 0; i < 3; i++) {
        const a = r() * Math.PI * 2, len = R * (0.5 + r() * 0.3);
        const br = new THREE.Mesh(new THREE.CylinderGeometry(M(p.trunkR) * 0.2, M(p.trunkR) * 0.38, len, 6), trunkMat);
        br.position.set(Math.cos(a) * len * 0.33, trunkH * (0.62 + r() * 0.2), Math.sin(a) * len * 0.33);
        br.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
        br.castShadow = true;
        g.add(br);
      }
      // 葉の塊
      const geo = new THREE.IcosahedronGeometry(1, 2);
      roughen(geo, 0.14, 4.3, p.seed);
      const blobs = 6 + Math.floor(r() * 3);
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * Math.PI * 2 + r() * 0.6;
        const ring = i === 0 ? 0 : R * (0.32 + r() * 0.2);
        const size = i === 0 ? R * 0.72 : R * (0.42 + r() * 0.2);
        const blob = new THREE.Mesh(geo, leaf(0.88 + r() * 0.26));
        blob.position.set(Math.cos(a) * ring, crownY + (i === 0 ? crownV * 0.28 : (r() - 0.45) * crownV * 0.7), Math.sin(a) * ring);
        blob.scale.set(size, size * Math.min(1, crownV / R) * (0.85 + r() * 0.25), size);
        blob.rotation.y = r() * Math.PI;
        blob.castShadow = true;
        blob.receiveShadow = true;
        g.add(blob);
      }
    }
    g.position.set(M(p.c[0]), M(p.z), M(p.c[1]));
    return g;
  }

  outline(p) {
    const geo = new THREE.BufferGeometry().setFromPoints([...p.pts, p.pts[0]].map((q) => new THREE.Vector3(...V(q, q[2]))));
    return new THREE.Line(geo, new THREE.LineDashedMaterial({ color: p.color, dashSize: 0.6, gapSize: 0.3 })).computeLineDistances();
  }

  // 大きさの目安に立てる人（身長 1.7 m）
  personFigure() {
    const g = new THREE.Group();
    const m = this.mat('#4b5560', { roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.62, 4, 10), m);
    body.position.y = 1.0;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.78, 10), this.mat('#3a4048'));
    legs.position.y = 0.39;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), this.mat('#d9b89a', { roughness: 0.7 }));
    head.position.y = 1.585;
    for (const x of [body, legs, head]) { x.castShadow = true; g.add(x); }
    const b = this.box;
    const px = (b.x0 + b.x1) / 2 + (b.x1 - b.x0) * 0.12, py = b.y1 - (b.y1 - b.y0) * 0.18;
    g.position.set(M(px), M(this.groundAt([px, py])), M(py));
    return g;
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
      this.camera.position.set(cx + ex * size * 1.15, Math.max(size * 0.62, top * 1.5), cz + ez * size * 1.15);
      c.target.set(cx, top * 0.22, cz);
    }
    this.camera.fov = kind === 'eye' ? 60 : 40;
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

// 球を少しでこぼこにする（葉の塊・石）。同じ位置の頂点は同じだけ動かすので、割れ目はできない。
function roughen(geo, amount, freq, seed = 0) {
  const pos = geo.attributes.position;
  const o = (seed % 97) * 0.37;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const s = 1 + amount * (Math.sin(x * freq + o) * Math.cos(y * freq * 1.3 + o) + Math.sin(z * freq * 0.9 + x * 2 + o) * 0.6);
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  geo.computeVertexNormals();
}

function inside([x, y], pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
