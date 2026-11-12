/* nowcast.js: เรดาร์ฝนทั้งภูมิภาคจาก RainViewer และคาดการณ์ 2 ชม. ที่คำนวณเองในเบราว์เซอร์

   ขั้นตอน
   1. โหลด tile ซูม 4 ขนาด 512 px (2 x 3 แผ่น) ของแต่ละเฟรม ต่อเป็นภาพเดียว แล้วตัดเฉพาะภูมิภาค
   2. ถอดสีแต่ละพิกเซลกลับเป็น dBZ (เก็บเป็น code = dBZ + 33, 0 = ไม่มีฝน)
   3. หาเวกเตอร์การเคลื่อนที่ของกลุ่มฝนด้วย block matching ระหว่างเฟรมห่างกัน 30 นาที
   4. เลื่อนภาพล่าสุดไปตามเวกเตอร์ทีละ 10 นาที 12 ขั้น
   ข้อจำกัด: ถือว่ากลุ่มฝนเคลื่อนที่คงที่ ไม่ก่อตัวใหม่และไม่สลายตัว */
window.RainNowcast = (() => {
  'use strict';
  // ตารางสี Universal Blue ของ RainViewer (dBZ -> สี) จาก rainviewer_api_colors_table.csv
  const UB_OPAQUE = [[15,136,221,238],[16,108,209,235],[17,81,197,232],[18,54,186,229],[19,27,174,226],[20,0,163,224],[21,0,154,213],[22,0,145,202],[23,0,136,191],[24,0,127,180],[25,0,119,170],[26,0,112,163],[27,0,105,156],[28,0,98,149],[29,0,91,142],[30,0,85,136],[31,0,81,128],[32,0,78,120],[33,0,74,112],[34,0,71,104],[35,255,238,0],[36,255,224,0],[37,255,210,0],[38,255,197,0],[39,255,183,0],[40,255,170,0],[41,255,159,0],[42,255,149,0],[43,255,139,0],[44,255,129,0],[45,255,68,0],[46,242,54,0],[47,230,40,0],[48,217,27,0],[49,205,13,0],[50,193,0,0],[51,168,0,0],[52,143,0,0],[53,118,0,0],[54,93,0,0],[55,255,170,255],[56,255,159,255],[57,255,149,255],[58,255,139,255],[59,255,129,255],[60,255,119,255],[61,255,108,255],[62,255,98,255],[63,255,88,255],[64,255,78,255],[65,255,255,255]];
  const UB_ALPHA = [[-10,20],[-9,25],[-8,30],[-7,36],[-6,41],[-5,46],[-4,52],[-3,57],[-2,62],[-1,68],[0,73],[1,78],[2,84],[3,89],[4,94],[5,100],[6,110],[7,120],[8,130],[9,140],[10,150],[11,160],[12,170],[13,180],[14,190]];

  const API = 'https://api.rainviewer.com/public/weather-maps.json';
  const Z = 4, TS = 512, TX = [12, 13], TY = [6, 7, 8];
  const CROP_Y = 308, W = 640, H = 900;              // ตัดให้เหลือลองจิจูด 90-118 ละติจูดประมาณ 30 ถึง -8
  const WORLD = TS * (1 << Z);
  const GX0 = TX[0] * TS, GY0 = TY[0] * TS + CROP_Y; // พิกัดพิกเซลโลกของมุมซ้ายบน
  const STEP_MIN = 10, N_FC = 12;
  const lonOf = (gx) => (gx / WORLD) * 360 - 180;
  const latOf = (gy) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / WORLD))) * 180) / Math.PI;
  const BOUNDS = [[latOf(GY0 + H), lonOf(GX0)], [latOf(GY0), lonOf(GX0 + W)]];   // [[S,W],[N,E]]
  const LEVELS = [0.2, 1, 2, 5, 10, 20];             // มม./ชม.
  // Marshall-Palmer: Z = 200 R^1.6
  const rateOf = (code) => (code ? Math.pow(Math.pow(10, (code - 33) / 10) / 200, 0.625) : 0);

  // ---- ถอดสีเป็น code ----
  const exact = new Map(UB_OPAQUE.map(([d, r, g, b]) => [(r << 16) | (g << 8) | b, d + 33]));
  function codeOf(r, g, b, a) {
    if (a < 16) return 0;
    if (a < 250) {                                   // โทนเบจโปร่งแสง = ต่ำกว่า 15 dBZ ดูจากค่า alpha
      let best = UB_ALPHA[0];
      for (const e of UB_ALPHA) if (Math.abs(e[1] - a) < Math.abs(best[1] - a)) best = e;
      return Math.max(1, best[0] + 33);
    }
    const key = (r << 16) | (g << 8) | b;
    let c = exact.get(key);
    if (c !== undefined) return c;
    let bd = 1e9; c = 0;
    for (const [d, R, G, B] of UB_OPAQUE) {
      const e = (R - r) * (R - r) + (G - g) * (G - g) + (B - b) * (B - b);
      if (e < bd) { bd = e; c = d + 33; }
    }
    exact.set(key, c);
    return c;
  }

  function loadImage(url) {
    return new Promise((res, rej) => {
      const i = new Image(); i.crossOrigin = 'anonymous';
      i.onload = () => res(i); i.onerror = () => rej(new Error('โหลด tile เรดาร์ไม่ได้')); i.src = url;
    });
  }

  async function loadFrame(host, path) {
    const cv = document.createElement('canvas'); cv.width = TX.length * TS; cv.height = TY.length * TS;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const jobs = [];
    TX.forEach((x, i) => TY.forEach((y, j) => jobs.push(
      loadImage(`${host}${path}/${TS}/${Z}/${x}/${y}/2/0_0.png`).then((img) => ctx.drawImage(img, i * TS, j * TS)))));
    await Promise.all(jobs);
    const d = ctx.getImageData(0, CROP_Y, W, H).data, out = new Uint8Array(W * H);
    for (let p = 0, q = 0; p < d.length; p += 4, q++) if (d[p + 3]) out[q] = codeOf(d[p], d[p + 1], d[p + 2], d[p + 3]);
    return out;
  }

  // ---- เวกเตอร์การเคลื่อนที่ ----
  const DS = 2, BW = W / DS, BH = H / DS, BLK = 32, STP = 16, SR = 8, MIN_DBZ = 12;
  function shrink(codes) {
    const o = new Uint8Array(BW * BH);
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
      let s = 0;
      for (let j = 0; j < DS; j++) for (let i = 0; i < DS; i++) {
        const c = codes[(y * DS + j) * W + x * DS + i] - 33;
        if (c >= MIN_DBZ) s += c;
      }
      o[y * BW + x] = s / (DS * DS);
    }
    return o;
  }

  // pairs: [[ใหม่, เก่า], ...] ห่างกันช่วงเวลาเท่ากัน คืน field หน่วยพิกเซลย่อ ต่อช่วงนั้น
  async function motion(pairs, tick) {
    const gw = Math.floor((BW - BLK) / STP) + 1, gh = Math.floor((BH - BLK) / STP) + 1;
    const U = new Float32Array(gw * gh), V = new Float32Array(gw * gh), ok = new Uint8Array(gw * gh);
    const n = 2 * SR + 1, cost = new Float32Array(n * n);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const x0 = gx * STP, y0 = gy * STP;
        let wet = 0;
        for (const [A] of pairs) for (let y = 0; y < BLK; y += 2) for (let x = 0; x < BLK; x += 2) if (A[(y0 + y) * BW + x0 + x]) wet++;
        if (wet < pairs.length * (BLK * BLK / 4) * 0.05) continue;
        for (let dy = -SR; dy <= SR; dy++) for (let dx = -SR; dx <= SR; dx++) {
          let s = 0;
          for (const [A, B] of pairs) {
            for (let y = 0; y < BLK; y++) {
              const ya = y0 + y, yb = ya - dy, ra = ya * BW + x0;
              if (yb < 0 || yb >= BH) { for (let x = 0; x < BLK; x++) s += A[ra + x]; continue; }
              const rb = yb * BW + x0 - dx;
              for (let x = 0; x < BLK; x++) {
                const xb = x0 + x - dx, a = A[ra + x], b = xb < 0 || xb >= BW ? 0 : B[rb + x];
                s += a > b ? a - b : b - a;
              }
            }
          }
          cost[(dy + SR) * n + dx + SR] = s / (pairs.length * BLK * BLK) + 0.03 * Math.hypot(dx, dy);
        }
        let bi = 0;
        for (let i = 1; i < cost.length; i++) if (cost[i] < cost[bi]) bi = i;
        const dx = (bi % n) - SR, dy = Math.floor(bi / n) - SR;
        if (Math.abs(dx) === SR || Math.abs(dy) === SR) continue;       // ชนขอบการค้นหา ไม่น่าเชื่อถือ
        let fx = 0, fy = 0;
        { const l = cost[bi - 1], c = cost[bi], r = cost[bi + 1], den = l - 2 * c + r; if (den > 1e-6) fx = (0.5 * (l - r)) / den; }
        { const u = cost[bi - n], c = cost[bi], d = cost[bi + n], den = u - 2 * c + d; if (den > 1e-6) fy = (0.5 * (u - d)) / den; }
        const k = gy * gw + gx; U[k] = dx + fx; V[k] = dy + fy; ok[k] = 1;
      }
      if (tick && gy % 3 === 2) await tick();
    }
    // ตัดค่าผิดปกติเทียบกับ median แล้วเติมช่องว่างด้วยค่าถ่วงน้ำหนักตามระยะ
    const med = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
    const us = [], vs = [];
    for (let k = 0; k < ok.length; k++) if (ok[k]) { us.push(U[k]); vs.push(V[k]); }
    const mu = med(us), mv = med(vs);
    for (let k = 0; k < ok.length; k++) if (ok[k] && Math.hypot(U[k] - mu, V[k] - mv) > 5) ok[k] = 0;
    const pts = [];
    for (let k = 0; k < ok.length; k++) if (ok[k]) pts.push([k % gw, Math.floor(k / gw), U[k], V[k]]);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const k = gy * gw + gx;
      if (ok[k]) continue;
      if (!pts.length) { U[k] = 0; V[k] = 0; continue; }
      let su = 0, sv = 0, sw = 0;
      for (const [px, py, u, v] of pts) {
        const w = 1 / (1 + (px - gx) * (px - gx) + (py - gy) * (py - gy));
        su += u * w; sv += v * w; sw += w;
      }
      U[k] = su / sw; V[k] = sv / sw;
    }
    for (let pass = 0; pass < 2; pass++) for (const F of [U, V]) {
      const T = Float32Array.from(F);
      for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        let s = 0, c = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const x = gx + i, y = gy + j;
          if (x >= 0 && x < gw && y >= 0 && y < gh) { s += T[y * gw + x]; c++; }
        }
        F[gy * gw + gx] = s / c;
      }
    }
    return { gw, gh, U, V, valid: pts.length, median: [mu, mv] };
  }

  // เวกเตอร์ ณ พิกเซลเต็ม (x, y) หน่วย: พิกเซลเต็ม ต่อ 1 ขั้น (10 นาที)
  function fieldAt(f, x, y, perStep, out) {
    const fx = Math.min(f.gw - 1, Math.max(0, (x / DS - BLK / 2) / STP)), fy = Math.min(f.gh - 1, Math.max(0, (y / DS - BLK / 2) / STP));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(f.gw - 1, x0 + 1), y1 = Math.min(f.gh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const g = (F) => (F[y0 * f.gw + x0] * (1 - tx) + F[y0 * f.gw + x1] * tx) * (1 - ty) + (F[y1 * f.gw + x0] * (1 - tx) + F[y1 * f.gw + x1] * tx) * ty;
    out[0] = g(f.U) * DS * perStep; out[1] = g(f.V) * DS * perStep;
  }

  // เลื่อนภาพ src ไป k ขั้น (ย้อนหาต้นทางของแต่ละเซลล์ 8x8 พิกเซล)
  function advect(src, f, perStep, k) {
    const out = new Uint8Array(W * H), v = [0, 0], CELL = 8;
    for (let cy = 0; cy < H; cy += CELL) for (let cx = 0; cx < W; cx += CELL) {
      fieldAt(f, cx + CELL / 2, cy + CELL / 2, perStep, v);
      const sx = Math.round(v[0] * k), sy = Math.round(v[1] * k);
      for (let y = cy; y < cy + CELL && y < H; y++) {
        const yy = y - sy; if (yy < 0 || yy >= H) continue;
        for (let x = cx; x < cx + CELL && x < W; x++) { const xx = x - sx; if (xx >= 0 && xx < W) out[y * W + x] = src[yy * W + xx]; }
      }
    }
    return out;
  }

  // ---- วาดเป็นภาพสี ----
  function render(codes, colors) {
    const lut = new Uint8Array(256 * 4), th = LEVELS.map((r) => 23 + 16 * Math.log10(r));
    for (let c = 1; c < 256; c++) {
      let k = -1; for (let i = 0; i < th.length; i++) if (c - 33 >= th[i]) k = i;
      if (k < 0) continue;
      lut.set([colors[k][0], colors[k][1], colors[k][2], 235], c * 4);
    }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), im = ctx.createImageData(W, H), d = im.data;
    for (let q = 0, p = 0; q < codes.length; q++, p += 4) {
      const c = codes[q];
      if (c) { const l = c * 4; d[p] = lut[l]; d[p + 1] = lut[l + 1]; d[p + 2] = lut[l + 2]; d[p + 3] = lut[l + 3]; }
    }
    ctx.putImageData(im, 0, 0);
    return new Promise((res) => cv.toBlob((b) => res(URL.createObjectURL(b)), 'image/png'));
  }

  async function index() {
    const j = await (await fetch(API, { cache: 'no-store' })).json();
    const past = (j.radar && j.radar.past) || [];
    if (!past.length) throw new Error('RainViewer ไม่มีเฟรมเรดาร์');
    return { host: j.host, past };
  }

  // ค่าฝน (มม./ชม.) ที่ตำแหน่ง lat/lon ของหนึ่งเฟรม: เฉลี่ยรอบจุด 3x3 พิกเซล (นอกกรอบคืน null)
  function sample(codes, lat, lon) {
    const s = Math.sin((lat * Math.PI) / 180);
    const x = Math.round(((lon + 180) / 360) * WORLD - GX0);
    const y = Math.round((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD - GY0);
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return null;
    let t = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) t += rateOf(codes[(y + j) * W + x + i]);
    return t / 9;
  }

  const kmPerPx = (lat) => (40075 * Math.cos((lat * Math.PI) / 180)) / WORLD;

  return { index, loadFrame, shrink, motion, advect, render, sample, rateOf, kmPerPx, BOUNDS, LEVELS, STEP_MIN, N_FC, W, H, DS };
})();
