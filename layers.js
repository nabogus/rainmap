/* layers.js: ชั้นเมฆ (ดาวเทียม Himawari ผ่าน NASA GIBS) ลมเคลื่อนไหว และเส้นความกดอากาศเท่า */
window.RainLayers = (() => {
  'use strict';

  // ---------- เมฆ ----------
  // tile ของ GIBS เป็นภาพอินฟราเรดทึบ: โทนเทา ยิ่งสว่าง = ยอดเมฆยิ่งเย็น/สูง ส่วนยอดเมฆเย็นจัดถูกระบายสี
  // แปลงเป็นเมฆสีขาวโปร่งแสง เพื่อวางทับแผนที่และชั้นฝนได้
  const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Himawari_AHI_Band13_Clean_Infrared/default/';
  const CloudLayer = L.GridLayer.extend({
    options: { pane: 'cloudPane', maxNativeZoom: 6, minZoom: 2, maxZoom: 12, opacity: 0.9, attribution: 'Himawari / NASA GIBS', zIndex: 5, className: 'cloud-tiles' },
    _time: 'default',
    setTime(t) { t = t || 'default'; if (t === this._time) return; this._time = t; if (this._map) this.redraw(); },
    // ภาพต้นทางละเอียดประมาณ 2 กม. ต่อจุด (ซูม 6) ซูมเข้ากว่านั้นจะเห็นเป็นบล็อก จึงเกลี่ยทั้งชั้นด้วย blur ตามระดับซูม
    _smooth() {
      const c = this.getContainer(); if (!c || !this._map) return;
      const over = this._map.getZoom() - this.options.maxNativeZoom;
      c.style.filter = over > 0.3 ? `blur(${Math.min(40, 0.6 * Math.pow(2, over)).toFixed(1)}px)` : '';
    },
    onAdd(map) { L.GridLayer.prototype.onAdd.call(this, map); map.on('zoom zoomend', this._smooth, this); this._smooth(); },
    onRemove(map) { map.off('zoom zoomend', this._smooth, this); L.GridLayer.prototype.onRemove.call(this, map); },
    createTile(coords, done) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 256;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const load = (time) => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          const im = ctx.getImageData(0, 0, 256, 256), d = im.data;
          for (let p = 0; p < d.length; p += 4) {
            const r = d[p], g = d[p + 1], b = d[p + 2];
            if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {            // โทนเทา
              const a = Math.max(0, Math.min(1, (r - 122) / 68));   // ทะเล/พื้นดินอุ่น ~100-115, เมฆต่ำ ~120-140, เมฆกลาง-สูง 150+
              d[p] = 245; d[p + 1] = 247; d[p + 2] = 250; d[p + 3] = Math.round(Math.pow(a, 1.4) * 225);
            } else { d[p] = d[p + 1] = d[p + 2] = 255; d[p + 3] = 240; }     // ยอดเมฆเย็นจัด = เมฆหนา
          }
          ctx.putImageData(im, 0, 0);
          done(null, cv);
        };
        // เวลาที่ขอไม่มีภาพ (ใหม่เกินไปหรือเก่าเกิน 4 ชม.) ใช้ภาพล่าสุดแทน
        img.onerror = () => { if (time !== 'default') load('default'); else done(new Error('no cloud tile'), cv); };
        img.src = `${GIBS}${time}/GoogleMapsCompatible_Level6/${coords.z}/${coords.y}/${coords.x}.png`;
      };
      load(this._time);
      return cv;
    },
  });

  // เก็บชั้นเมฆแยกตามเวลา โหลดล่วงหน้าไว้แบบโปร่งใส แล้วสลับด้วย opacity
  // (ถ้าล้างแล้วโหลด tile ใหม่ทุกเฟรม ภาพจะกระพริบตอนเล่น)
  function CloudStack(map) {
    const OP = 0.9, layers = new Map();     // time -> { layer, loaded }
    let want = null, shown = null, on = false;
    function ensure(t) {
      let e = layers.get(t);
      if (!e) {
        const layer = new CloudLayer({ opacity: 0 });
        layer._time = t;
        e = { layer, loaded: false };
        layer.on('load', () => { e.loaded = true; if (on && want === t) swap(t); });
        layers.set(t, e);
      }
      if (on && !map.hasLayer(e.layer)) e.layer.addTo(map);
      return e;
    }
    function swap(t) {
      if (shown === t) return;
      const old = shown && layers.get(shown);
      layers.get(t).layer.setOpacity(OP);
      if (old) old.layer.setOpacity(0);
      shown = t;
    }
    return {
      show(t) {            // แสดงเวลานี้ ถ้ายังโหลดไม่เสร็จ คงภาพเดิมไว้ก่อน
        on = true; want = t;
        const e = ensure(t);
        if (e.loaded || !shown) swap(t);
      },
      preload(times) {     // เตรียมทุกเวลาที่จะใช้ และทิ้งเวลาที่ไม่ใช้แล้ว
        if (!on) return;
        const keep = new Set(times);
        for (const [t, e] of layers) if (!keep.has(t) && t !== want && t !== shown) { map.removeLayer(e.layer); layers.delete(t); }
        times.forEach(ensure);
      },
      hide() {
        on = false; want = shown = null;
        for (const e of layers.values()) map.removeLayer(e.layer);
        layers.clear();
      },
    };
  }

  // เวลาเมฆที่ใช้กับเฟรม: ปัดลงเป็น 10 นาที และไม่ใหม่กว่า 40 นาทีก่อนปัจจุบัน (ภาพดาวเทียมมาช้ากว่าเรดาร์)
  function cloudTime(iso) {
    const lim = Date.now() - 40 * 60000, t = Math.min(new Date(iso).getTime(), lim);
    return new Date(Math.floor(t / 600000) * 600000).toISOString().slice(0, 19) + 'Z';
  }

  // ---------- ลม ----------
  // g = { lat0, lon0, dlat, dlon, nx, ny }  u, v = อาร์เรย์ ม./วินาที เรียงแถวใต้ไปเหนือ
  function sampleGrid(g, arr, lat, lon) {
    const fx = (lon - g.lon0) / g.dlon, fy = (lat - g.lat0) / g.dlat;
    if (fx < 0 || fy < 0 || fx > g.nx - 1 || fy > g.ny - 1) return NaN;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(g.nx - 1, x0 + 1), y1 = Math.min(g.ny - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    return (arr[y0 * g.nx + x0] * (1 - tx) + arr[y0 * g.nx + x1] * tx) * (1 - ty) + (arr[y1 * g.nx + x0] * (1 - tx) + arr[y1 * g.nx + x1] * tx) * ty;
  }

  function WindLayer(map) {
    const cv = L.DomUtil.create('canvas', 'wind-canvas', map.getContainer());
    const ctx = cv.getContext('2d');
    const CELL = 12, PX_PER_MS = 0.16, MAX_AGE = 90;
    let data = null, on = false, raf = null, last = 0, fw = 0, fh = 0, FX = null, FY = null, parts = [], color = 'rgba(25,45,85,0.85)';

    function spawn(p) { p.x = Math.random() * cv.width; p.y = Math.random() * cv.height; p.age = Math.floor(Math.random() * MAX_AGE); return p; }
    function build() {
      const s = map.getSize(); cv.width = s.x; cv.height = s.y;
      fw = Math.ceil(s.x / CELL) + 1; fh = Math.ceil(s.y / CELL) + 1;
      FX = new Float32Array(fw * fh); FY = new Float32Array(fw * fh);
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
        const ll = map.containerPointToLatLng([i * CELL, j * CELL]);
        const u = sampleGrid(data.g, data.u, ll.lat, ll.lng), v = sampleGrid(data.g, data.v, ll.lat, ll.lng);
        FX[j * fw + i] = u * PX_PER_MS; FY[j * fw + i] = -v * PX_PER_MS;      // v บวก = ไปทางเหนือ = ขึ้นบนจอ
      }
      const n = Math.min(2200, Math.round((s.x * s.y) / 380));
      parts = []; for (let i = 0; i < n; i++) parts.push(spawn({}));
    }
    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (ts - last < 33) return;
      last = ts;
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(0,0,0,0.92)'; ctx.fillRect(0, 0, cv.width, cv.height);   // หางจางลงทีละเฟรม
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath();
      for (const p of parts) {
        const k = Math.floor(p.y / CELL) * fw + Math.floor(p.x / CELL), dx = FX[k], dy = FY[k];
        if (p.age++ > MAX_AGE || !(dx === dx) || p.x < 0 || p.y < 0 || p.x >= cv.width || p.y >= cv.height) { spawn(p); p.age = 0; continue; }
        ctx.moveTo(p.x, p.y); p.x += dx; p.y += dy; ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } ctx.clearRect(0, 0, cv.width, cv.height); }
    function start() { stop(); if (!on || !data) return; build(); raf = requestAnimationFrame(frame); }
    map.on('movestart zoomstart', stop);
    map.on('moveend zoomend resize', start);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    return {
      setData(d) { data = d; if (on) start(); },
      show(v) { on = v; cv.style.display = v ? 'block' : 'none'; if (v) start(); else stop(); },
      setDark(dark) { color = dark ? 'rgba(255,255,255,0.85)' : 'rgba(25,45,85,0.85)'; },
    };
  }

  // ---------- ความกดอากาศ ----------
  // p = Float32Array hPa (ny x nx แถวใต้ไปเหนือ) คืนเส้นความกดอากาศเท่าทุก 1 hPa และจุดสูง/ต่ำ
  function isobars(g, p0) {
    const nx = g.nx, ny = g.ny;
    let p = Float32Array.from(p0);
    for (let pass = 0; pass < 2; pass++) {                    // เกลี่ยให้เส้นเรียบ
      const t = Float32Array.from(p);
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        let s = 0, c = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && xx < nx && yy >= 0 && yy < ny) { s += t[yy * nx + xx]; c++; } }
        p[y * nx + x] = s / c;
      }
    }
    const lines = new Map();
    const lat = (y) => g.lat0 + y * g.dlat, lon = (x) => g.lon0 + x * g.dlon;
    for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
      const a = p[y * nx + x], b = p[y * nx + x + 1], c = p[(y + 1) * nx + x + 1], d = p[(y + 1) * nx + x];
      const lo = Math.ceil(Math.min(a, b, c, d)), hi = Math.floor(Math.max(a, b, c, d));
      for (let L0 = lo; L0 <= hi; L0++) {
        const pts = [];
        const cross = (v1, v2, x1, y1, x2, y2) => { if ((v1 < L0) !== (v2 < L0)) { const t = (L0 - v1) / (v2 - v1); pts.push([lat(y1 + (y2 - y1) * t), lon(x1 + (x2 - x1) * t)]); } };
        cross(a, b, x, y, x + 1, y); cross(b, c, x + 1, y, x + 1, y + 1); cross(c, d, x + 1, y + 1, x, y + 1); cross(d, a, x, y + 1, x, y);
        if (pts.length < 2) continue;
        if (!lines.has(L0)) lines.set(L0, []);
        const arr = lines.get(L0);
        arr.push([pts[0], pts[1]]);
        if (pts.length === 4) arr.push([pts[2], pts[3]]);
      }
    }
    // จุดความกดอากาศสูง/ต่ำ: ค่าสุดขีดในรัศมี 8 ช่อง (4 องศา) และต่างจากค่าเฉลี่ยรอบข้างอย่างน้อย 2 hPa
    const R = 8, highs = [], lows = [];
    for (let y = 2; y < ny - 2; y++) for (let x = 2; x < nx - 2; x++) {
      const v = p[y * nx + x];
      let isMin = true, isMax = true, s = 0, c = 0;
      for (let j = -R; j <= R && (isMin || isMax); j++) for (let i = -R; i <= R; i++) {
        const xx = x + i, yy = y + j;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny || (!i && !j)) continue;
        const w = p[yy * nx + xx]; s += w; c++;
        if (w <= v) isMin = false;
        if (w >= v) isMax = false;
      }
      if (isMin && s / c - v >= 2) lows.push({ lat: lat(y), lon: lon(x), hpa: v });
      if (isMax && v - s / c >= 2) highs.push({ lat: lat(y), lon: lon(x), hpa: v });
    }
    return { lines, highs, lows };
  }

  const DIRS = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'];
  // ลมพัด "มาจาก" ทิศไหน
  function windFrom(u, v) { const deg = (Math.atan2(-u, -v) * 180) / Math.PI; return DIRS[Math.round(((deg + 360) % 360) / 45) % 8]; }

  return { CloudLayer, CloudStack, cloudTime, WindLayer, isobars, sampleGrid, windFrom };
})();
