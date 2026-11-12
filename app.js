/* RainMap: แผนที่ฝนตอนนี้ (เรดาร์ + nowcast 2 ชม.) และฝนคาดการณ์ 1/3/7/15 วัน
   อ่านไฟล์จาก data/ ที่ fetch.py ดึงมาไว้ */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TZ = 'Asia/Bangkok';
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const fmtDate = (d) => d.toLocaleDateString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short' });
  const fmtDateTime = (iso) => new Date(iso).toLocaleString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // สี: ค่าตั้งแต่ระดับ k ขึ้นไปใช้สี RATE[k] / ACC[k]
  const RATE_COLORS = [[150, 200, 255], [60, 140, 255], [40, 190, 90], [250, 220, 50], [255, 140, 20], [220, 30, 40]];
  const ACC_COLORS = [[200, 225, 255], [110, 170, 255], [40, 120, 230], [60, 190, 110], [250, 200, 40], [220, 40, 60]];

  // ---------- แผนที่ ----------
  const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([13.5, 101], 6);
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const basemaps = {
    'แผนที่ถนน (OSM)': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: OSM_ATTR }),
    'ภูมิประเทศ': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 12, subdomains: 'abc', attribution: OSM_ATTR + ' | SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>' }),
    'ดาวเทียม': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 12, attribution: 'Tiles &copy; Esri' }),
    'โทนมืด': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 12, attribution: 'Tiles &copy; Esri' }),
  };
  basemaps['แผนที่ถนน (OSM)'].addTo(map);
  const rainGroup = L.layerGroup().addTo(map);            // ชั้นฝน เปิดปิดได้จาก layer control
  const borders = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 12, opacity: 0.9, attribution: 'Esri' });
  L.control.layers(basemaps, { 'ชั้นฝน': rainGroup, 'ชื่อเมือง / เส้นเขต (สำหรับดาวเทียม)': borders }, { position: 'topright', collapsed: true }).addTo(map);
  const cornersToBounds = (c) => L.latLngBounds([c[2][1], c[0][0]], [c[0][1], c[1][0]]); // [[W,N],[E,N],[E,S],[W,S]]

  let overlay = null;
  function showImage(url, bounds, opacity) {
    if (!overlay) { overlay = L.imageOverlay(url, bounds, { opacity, interactive: false, className: 'rain-img' }).addTo(rainGroup); return; }
    overlay.setBounds(bounds); overlay.setOpacity(opacity); overlay.setUrl(url);
  }
  function clearImage() { if (overlay) { rainGroup.removeLayer(overlay); overlay = null; } }

  function legend(title, levels, colors, unit, note) {
    const el = $('legend');
    let h = `<div class="t">${title}</div>`;
    for (let i = levels.length - 1; i >= 0; i--) {
      const c = colors[i];
      h += `<div class="r"><span class="sw" style="background:rgb(${c.join(',')})"></span>${i === levels.length - 1 ? '&ge; ' + levels[i] : levels[i] + ' - ' + levels[i + 1]} ${unit}</div>`;
    }
    if (note) h += `<div class="n">${note}</div>`;
    el.innerHTML = h;
  }

  // ---------- หน้า ฝนตอนนี้ ----------
  const now = { idx: null, frames: [], urls: [], cur: 0, timer: null, bounds: null };

  async function colorize(src, levelsN) {
    // PNG จากต้นทางเป็นภาพเทา ค่าพิกเซล k = ระดับฝน (1..6), 0 = ไม่มีฝน
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const im = ctx.getImageData(0, 0, cv.width, cv.height), d = im.data;
    for (let p = 0; p < d.length; p += 4) {
      const k = d[p];
      if (k < 1 || k > levelsN) { d[p + 3] = 0; continue; }
      const c = RATE_COLORS[Math.min(k, RATE_COLORS.length) - 1];
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 235;
    }
    ctx.putImageData(im, 0, 0);
    return new Promise((res) => cv.toBlob((b) => res(URL.createObjectURL(b)), 'image/png'));
  }

  function nowRender() {
    const f = now.frames[now.cur];
    if (!f || page !== 'now') return;
    $('nowSlider').value = now.cur;
    $('nowTime').textContent = fmtTime(f.time);
    const nowcast = f.kind === 'nowcast';
    $('nowKind').textContent = nowcast ? 'คาดการณ์จากทิศทางและความเร็วกลุ่มฝน' : (now.cur === now.obsLast ? 'ข้อมูลล่าสุดจากเรดาร์' : 'ภาพเรดาร์ย้อนหลัง');
    const url = now.urls[now.cur];
    if (url) showImage(url, now.bounds, nowcast ? 0.75 : 0.9);
  }
  function nowStep(d) { now.cur = (now.cur + d + now.frames.length) % now.frames.length; nowRender(); }
  function nowPlay(on) {
    if (now.timer) { clearInterval(now.timer); now.timer = null; $('nowPlay').innerHTML = '&#9654;'; }
    if (on) { now.timer = setInterval(() => nowStep(1), 650); $('nowPlay').innerHTML = '&#10074;&#10074;'; }
  }

  async function loadNow() {
    const idx = await (await fetch('data/radar/index.json?t=' + Date.now())).json();
    now.idx = idx;
    now.frames = [...idx.frames, ...idx.nowcast];
    now.obsLast = idx.frames.length - 1;
    now.bounds = cornersToBounds(idx.corners);
    now.cur = now.obsLast;
    const sl = $('nowSlider'); sl.max = now.frames.length - 1; sl.value = now.cur;
    $('nowTicks').innerHTML = `<span>${fmtTime(now.frames[0].time)}</span><b>ตอนนี้ ${fmtTime(idx.latest)}</b><span>${fmtTime(now.frames[now.frames.length - 1].time)}</span>`;
    const ageMin = (Date.now() - new Date(idx.latest)) / 60000;
    const b = $('nowBadge');
    if (ageMin > 60) { b.textContent = 'ข้อมูลเก่า ' + Math.round(ageMin) + ' นาที'; b.className = 'badge stale'; }
    else { b.textContent = 'สด ' + fmtTime(idx.latest); b.className = 'badge'; }
    legend('ฝน (มม./ชม.)', idx.levels, RATE_COLORS, '');
    // แปลงสีเฟรมปัจจุบันก่อน แล้วค่อยทยอยทำที่เหลือ
    now.urls = new Array(now.frames.length).fill(null);
    now.urls[now.cur] = await colorize('data/' + now.frames[now.cur].file, idx.levels.length);
    nowRender();
    const order = [];
    for (let k = 1; k < now.frames.length; k++) { if (now.cur + k < now.frames.length) order.push(now.cur + k); if (now.cur - k >= 0) order.push(now.cur - k); }
    for (const i of order) { now.urls[i] = await colorize('data/' + now.frames[i].file, idx.levels.length); if (i === now.cur) nowRender(); }
  }

  $('nowPrev').onclick = () => { nowPlay(false); nowStep(-1); };
  $('nowNext').onclick = () => { nowPlay(false); nowStep(1); };
  $('nowPlay').onclick = () => nowPlay(!now.timer);
  $('nowSlider').oninput = (e) => { nowPlay(false); now.cur = +e.target.value; nowRender(); };

  // ---------- หน้า ฝนคาดการณ์ ----------
  const fc = { meta: null, grid: null, data: null, win: 3, start: 0, cache: new Map(), bounds: null, days: [] };
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const unmerc = (y) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;

  // สีไล่ต่อเนื่องตามระดับ acc (มม.): ต่ำกว่าระดับแรกจางหายไป
  function accRamp(v, lv) {
    if (v < lv[0] * 0.5) return null;
    if (v < lv[0]) { const c = ACC_COLORS[0]; return [c[0], c[1], c[2], Math.round(((v - lv[0] * 0.5) / (lv[0] * 0.5)) * 100)]; }
    let i = 0; while (i < lv.length - 1 && v >= lv[i + 1]) i++;
    if (i >= lv.length - 1) { const c = ACC_COLORS[lv.length - 1]; return [c[0], c[1], c[2], 205]; }
    const t = (v - lv[i]) / (lv[i + 1] - lv[i]), a = ACC_COLORS[i], b = ACC_COLORS[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 100 + 105 * Math.min(1, (i + t) / 3)];
  }

  function fcImage(win, start) {
    const key = win + ':' + start;
    if (fc.cache.has(key)) return fc.cache.get(key);
    const g = fc.grid, nx = g.nx, ny = g.ny, nd = g.days, lv = fc.meta.levels.acc;
    const acc = new Float32Array(nx * ny);
    for (let d = start; d < Math.min(nd, start + win); d++) {
      const off = d * nx * ny;
      for (let i = 0; i < nx * ny; i++) { const v = fc.data[off + i]; if (v !== g.nodata) acc[i] += v * g.scale; }
    }
    // วาดด้วย bilinear interpolation ระหว่างจุดกริด 0.25 องศา (ค่าระหว่างจุดเป็นค่าประมาณ)
    const S = g.lat0 - g.dlat / 2, N = g.lat0 + (ny - 1) * g.dlat + g.dlat / 2, Wl = g.lon0 - g.dlon / 2;
    const PX = 16, W = nx * PX, H = ny * PX;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), im = ctx.createImageData(W, H), px = im.data;
    const yN = merc(N), yS = merc(S);
    const at = (r, c) => acc[Math.max(0, Math.min(ny - 1, r)) * nx + Math.max(0, Math.min(nx - 1, c))];
    for (let y = 0; y < H; y++) {
      const lat = unmerc(yN - ((y + 0.5) / H) * (yN - yS));
      const fr = (lat - g.lat0) / g.dlat, r0 = Math.floor(fr), tr = fr - r0;
      for (let x = 0; x < W; x++) {
        const lon = Wl + ((x + 0.5) / W) * (nx * g.dlon);
        const fcc = (lon - g.lon0) / g.dlon, c0 = Math.floor(fcc), tc = fcc - c0;
        const v = (at(r0, c0) * (1 - tc) + at(r0, c0 + 1) * tc) * (1 - tr) + (at(r0 + 1, c0) * (1 - tc) + at(r0 + 1, c0 + 1) * tc) * tr;
        const col = accRamp(v, lv);
        if (!col) continue;
        const p = (y * W + x) * 4;
        px[p] = col[0]; px[p + 1] = col[1]; px[p + 2] = col[2]; px[p + 3] = col[3];
      }
    }
    ctx.putImageData(im, 0, 0);
    const url = cv.toDataURL('image/png');
    fc.cache.set(key, url);
    return url;
  }

  function fcRender() {
    if (page !== 'fc') return;
    const nd = fc.grid.days, maxStart = Math.max(0, nd - fc.win);
    fc.start = Math.min(fc.start, maxStart);
    const sl = $('fcSlider'); sl.max = maxStart; sl.value = fc.start;
    const d0 = fc.days[fc.start], d1 = fc.days[Math.min(nd - 1, fc.start + fc.win - 1)];
    $('fcTime').textContent = fc.win === 1 ? fmtDate(d0) : `${fmtDate(d0)} - ${fmtDate(d1)}`;
    $('fcKind').textContent = `ฝนสะสม ${fc.win} วัน | ${fc.meta.source.toUpperCase()} รอบ ${fmtDateTime(fc.meta.init)}`;
    document.querySelectorAll('#fcWin button').forEach((b) => b.classList.toggle('active', +b.dataset.w === fc.win));
    showImage(fcImage(fc.win, fc.start), fc.bounds, 1);
  }

  async function loadFc() {
    fc.meta = await (await fetch('data/forecast/meta.json?t=' + Date.now())).json();
    fc.grid = fc.meta.grid;
    const buf = await (await fetch('data/forecast/daily.bin?t=' + Date.now())).arrayBuffer();
    const dv = new DataView(buf), n = buf.byteLength / 2, arr = new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = dv.getUint16(i * 2, true);
    fc.data = arr;
    fc.days = fc.meta.dayStarts.map((s) => new Date(new Date(s).getTime() + 7 * 3600e3)); // วันตามเวลาไทย
    fc.bounds = cornersToBounds(fc.meta.corners);
    const nd = fc.grid.days;
    $('fcTicks').innerHTML = `<b>วันนี้</b><span>${fmtDate(fc.days[Math.floor(nd / 2)])}</span><span>${fmtDate(fc.days[nd - 1])}</span>`;
    $('fcTotal').textContent = `${fmtDate(fc.days[0])} ถึง ${fmtDate(fc.days[nd - 1])}`;
  }
  function fcShow() { legend('ฝนสะสม (มม.)', fc.meta.levels.acc, ACC_COLORS, '', 'ไล่สีระหว่างจุดกริด 0.25 องศา (ค่าประมาณ)'); fcRender(); }

  document.querySelectorAll('#fcWin button').forEach((b) => { b.onclick = () => { fc.win = +b.dataset.w; fcRender(); }; });
  $('fcSlider').oninput = (e) => { fc.start = +e.target.value; fcRender(); };

  // ---------- สลับหน้า ----------
  let page = 'now';
  function showPage(p) {
    page = p;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.page === p));
    document.querySelectorAll('.page').forEach((s) => s.classList.toggle('active', s.id === 'page-' + p));
    nowPlay(false); clearImage();
    if (p === 'now') { if (now.idx) { legend('ฝน (มม./ชม.)', now.idx.levels, RATE_COLORS, ''); nowRender(); } }
    else if (fc.meta) fcShow();
    location.hash = p;
    setTimeout(() => map.invalidateSize(), 50);
  }
  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => showPage(t.dataset.page); });

  // ---------- เริ่ม ----------
  (async () => {
    try {
      const st = await (await fetch('data/status.json?t=' + Date.now())).json();
      $('foot').textContent = `ดึงข้อมูลล่าสุด ${fmtDateTime(st.fetched)} | เรดาร์: กรมอุตุนิยมวิทยา (ภาพยังไม่ผ่านการตรวจสอบ) | ฝนคาดการณ์: NOAA GFS | ผ่านระบบสมดุลน้ำ กรมชลประทาน (ทดลอง)`;
    } catch (e) { $('foot').textContent = 'ยังไม่มีไฟล์สถานะ (รัน fetch.py ก่อน)'; }
    const want = location.hash === '#fc' ? 'fc' : 'now';
    const pn = loadNow().catch((e) => { $('nowKind').textContent = 'โหลดเรดาร์ไม่ได้: ' + e.message; });
    const pf = loadFc().catch((e) => { $('fcKind').textContent = 'โหลด forecast ไม่ได้: ' + e.message; });
    if (want === 'fc') { await pf; showPage('fc'); } else { await pn; }
    await Promise.all([pn, pf]);
    if (page === 'fc' && fc.meta) fcShow();
  })();
})();
