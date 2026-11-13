/* RainMap: แผนที่ฝนตอนนี้ (เรดาร์ + nowcast 2 ชม.) และฝนคาดการณ์ 1/3/7/15 วัน
   เรดาร์ภูมิภาคโหลดตรงจาก RainViewer (nowcast.js) ส่วนเรดาร์ไทยและ forecast อ่านจาก data/ ที่ fetch.py ดึงมาไว้ */
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
  const map = L.map('map', { zoomControl: true, attributionControl: true, zoomSnap: 0.5 }).setView([13.5, 101], 6);
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const rb = window.RainBase(map);           // แผนที่ฐานของเราเอง + เส้นเขตแดน/ชื่อไทยชั้นบนสุด
  const BASE_OWN = 'แผนที่อากาศ';
  const basemaps = {
    [BASE_OWN]: rb.base,
    'แผนที่ถนน (OSM)': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: OSM_ATTR }),
    'ภูมิประเทศ': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 12, subdomains: 'abc', attribution: OSM_ATTR + ' | SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>' }),
    'ดาวเทียม': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 12, attribution: 'Tiles &copy; Esri' }),
    'โทนมืด': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 12, attribution: 'Tiles &copy; Esri' }),
  };
  rb.base.addTo(map); rb.top.addTo(map);
  const rainGroup = L.layerGroup().addTo(map);            // ชั้นฝน เปิดปิดได้จาก layer control
  L.control.layers(basemaps, { 'เส้นเขตแดนและชื่อ (ไทย)': rb.top }, { position: 'topright', collapsed: true }).addTo(map);
  const TH_BOUNDS = L.latLngBounds([5.6, 97.3], [20.5, 105.7]);   // กรอบประเทศไทย
  const fitted = { now: false, fc: false };
  function fitThailandOnce(p) { if (fitted[p]) return; fitted[p] = true; map.invalidateSize(); map.fitBounds(TH_BOUNDS, { padding: [6, 6] }); }
  const cornersToBounds = (c) => L.latLngBounds([c[2][1], c[0][0]], [c[0][1], c[1][0]]); // [[W,N],[E,N],[E,S],[W,S]]

  // ภาพฝนใช้ 2 ชั้นสลับกัน: โหลดรูปใหม่ลงชั้นที่ซ่อนอยู่ รอจนพร้อมแล้วค่อยเฟดข้าม ภาพจึงไม่กระตุกตอนเล่น
  const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  const ov = { layers: [], urls: [null, null], active: -1, token: 0 };
  function showImage(url, bounds, opacity) {
    if (!ov.layers.length) for (let i = 0; i < 2; i++) ov.layers.push(L.imageOverlay(TRANSPARENT, bounds, { opacity: 0, interactive: false, className: 'rain-img' }).addTo(rainGroup));
    const token = ++ov.token;
    if (ov.active >= 0 && ov.urls[ov.active] === url) { ov.layers[ov.active].setBounds(bounds).setOpacity(opacity); return; }
    const next = ov.active === 0 ? 1 : 0, lay = ov.layers[next], img = lay.getElement();
    const done = () => {
      if (token !== ov.token) return;                 // มีคำสั่งใหม่กว่าแล้ว
      lay.setOpacity(opacity);
      if (ov.active >= 0) ov.layers[ov.active].setOpacity(0);
      ov.active = next;
    };
    lay.setBounds(bounds);
    ov.urls[next] = url;
    if (img.getAttribute('src') === url && img.complete) { done(); return; }
    img.onload = done;
    lay.setUrl(url);
  }
  function clearImage() { ov.token++; ov.layers.forEach((l) => rainGroup.removeLayer(l)); ov.layers = []; ov.urls = [null, null]; ov.active = -1; }

  // legend หุบได้: แตะหัวข้อเพื่อหุบ/กาง และจำสถานะไว้
  let legendCollapsed = false;
  try { legendCollapsed = localStorage.getItem('rainmap.legend') === '0'; } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  function legend(title, levels, colors, unit, note) {
    const el = $('legend');
    let h = `<button type="button" class="t" aria-expanded="${!legendCollapsed}" title="แตะเพื่อหุบ/กาง">${title}<span class="chev" aria-hidden="true"></span></button><div class="body">`;
    for (let i = levels.length - 1; i >= 0; i--) {
      const c = colors[i];
      h += `<div class="r"><span class="sw" style="background:rgb(${c.join(',')})"></span>${i === levels.length - 1 ? '&ge; ' + levels[i] : levels[i] + ' - ' + levels[i + 1]} ${unit}</div>`;
    }
    if (note) h += `<div class="n">${note}</div>`;
    el.innerHTML = h + '</div>';
    el.classList.toggle('collapsed', legendCollapsed);
  }
  $('legend').addEventListener('click', (e) => {
    if (!e.target.closest('.t')) return;
    legendCollapsed = !legendCollapsed;
    try { localStorage.setItem('rainmap.legend', legendCollapsed ? '0' : '1'); } catch (err) { /* ข้ามได้ */ }
    $('legend').classList.toggle('collapsed', legendCollapsed);
    $('legend').querySelector('.t').setAttribute('aria-expanded', String(!legendCollapsed));
  });

  // ---------- หน้า ฝนตอนนี้ ----------
  // มี 2 แหล่ง: region = เรดาร์รวมทั้งภูมิภาค (RainViewer) + คาดการณ์ที่คำนวณเองใน nowcast.js
  //             th     = เรดาร์กรมอุตุฯ + คาดการณ์ จากระบบสมดุลน้ำ กรมชลประทาน (เฉพาะประเทศไทย)
  const NC = window.RainNowcast;
  const newState = () => ({ ready: false, loading: false, error: null, frames: [], urls: [], codes: [], cur: 0, obsLast: 0, bounds: null, latest: null, levels: [0.2, 1, 2, 5, 10, 20], status: '', motion: null });
  const nowStates = { region: newState(), th: newState() };
  let nowSrc = 'region', now = nowStates.region, nowTimer = null;
  try { const s = localStorage.getItem('rainmap.nowSrc'); if (s === 'th' || s === 'region') { nowSrc = s; now = nowStates[s]; } } catch (e) { /* ไม่มี storage ก็ใช้ค่าเริ่มต้น */ }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function colorize(src, levelsN) {
    // PNG จากกรมชลฯ เป็นภาพเทา ค่าพิกเซล k = ระดับฝน (1..6), 0 = ไม่มีฝน
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

  function nowHeader() {
    const st = now;
    if (page === 'now') credits();
    document.querySelectorAll('#nowSrc button').forEach((b) => b.classList.toggle('active', b.dataset.s === nowSrc));
    const sl = $('nowSlider'), b = $('nowBadge');
    if (!st.frames.length) {
      sl.max = 0; $('nowTicks').innerHTML = ''; $('nowTime').textContent = '--:--';
      $('nowKind').textContent = st.error ? 'โหลดไม่ได้: ' + st.error : 'กำลังโหลด';
      b.textContent = st.error ? 'ไม่มีข้อมูล' : 'กำลังโหลด'; b.className = 'badge stale';
      return;
    }
    sl.max = st.frames.length - 1;
    $('nowTicks').innerHTML = `<span>${fmtTime(st.frames[0].time)}</span><b>ตอนนี้ ${fmtTime(st.latest)}</b><span>${fmtTime(st.frames[st.frames.length - 1].time)}</span>`;
    const ageMin = (Date.now() - new Date(st.latest)) / 60000;
    if (ageMin > 60) { b.textContent = 'ข้อมูลเก่า ' + Math.round(ageMin) + ' นาที'; b.className = 'badge stale'; }
    else { b.textContent = 'สด ' + fmtTime(st.latest); b.className = 'badge'; }
  }

  function nowRender() {
    const st = now, f = st.frames[st.cur];
    if (page !== 'now') return;
    if (!f) { nowHeader(); return; }
    $('nowSlider').value = st.cur;
    $('nowTime').textContent = fmtTime(f.time);
    const nowcast = f.kind === 'nowcast', url = st.urls[st.cur];
    let kind = nowcast ? 'คาดการณ์จากทิศทางและความเร็วกลุ่มฝน' : (st.cur === st.obsLast ? 'ข้อมูลล่าสุดจากเรดาร์' : 'ภาพเรดาร์ย้อนหลัง');
    if (!url) kind = st.status || 'กำลังเตรียมภาพ';
    else if (st.status && st.loading) kind += ' | ' + st.status;
    $('nowKind').textContent = kind;
    if (url) showImage(url, st.bounds, nowcast ? 0.75 : 0.9);
    if (layersOn.cloud) cloud.show(RL.cloudTime(f.time));
  }
  function nowStep(d) { if (!now.frames.length) return; now.cur = (now.cur + d + now.frames.length) % now.frames.length; nowRender(); }
  function nowPlay(on) {
    if (nowTimer) { clearInterval(nowTimer); nowTimer = null; $('nowPlay').innerHTML = '&#9654;'; }
    if (on) { cloudPreload(); nowTimer = setInterval(() => nowStep(1), 650); $('nowPlay').innerHTML = '&#10074;&#10074;'; }
  }
  const isActive = (st) => st === now && page === 'now';
  function nowLegend() {
    legend('ฝน (มม./ชม.)', now.levels, RATE_COLORS, '', nowSrc === 'region' ? 'เรดาร์รวม RainViewer | คาดการณ์จากทิศทางและความเร็วของกลุ่มฝน ไม่รวมฝนก่อตัวใหม่' : 'เรดาร์กรมอุตุฯ | ประมวลผลและคาดการณ์โดยระบบสมดุลน้ำ (เฉพาะไทย)');
  }

  // ---- แหล่ง th ----
  async function loadTh(st) {
    const res = await fetch('data/radar/index.json?t=' + Date.now());
    if (!res.ok) throw new Error('แหล่งเรดาร์ไทยล่มหรือยังไม่มีข้อมูล ลองใช้ "ทั้งภูมิภาค"');
    const idx = await res.json();
    st.frames = [...idx.frames, ...idx.nowcast];
    st.obsLast = idx.frames.length - 1;
    st.bounds = cornersToBounds(idx.corners);
    st.latest = idx.latest; st.levels = idx.levels; st.cur = st.obsLast;
    st.urls = new Array(st.frames.length).fill(null);
    if (isActive(st)) { nowHeader(); nowLegend(); }
    st.urls[st.cur] = await colorize('data/' + st.frames[st.cur].file, idx.levels.length);
    st.ready = true;
    if (isActive(st)) nowRender();
    const order = [];
    for (let k = 1; k < st.frames.length; k++) { if (st.obsLast + k < st.frames.length) order.push(st.obsLast + k); if (st.obsLast - k >= 0) order.push(st.obsLast - k); }
    for (const i of order) { st.urls[i] = await colorize('data/' + st.frames[i].file, idx.levels.length); if (isActive(st) && i === st.cur) nowRender(); }
  }

  // ---- แหล่ง region ----
  async function loadRegion(st) {
    const { host, past } = await NC.index();
    const nObs = past.length, t0 = past[nObs - 1].time * 1000;
    const iso = (ms) => new Date(ms).toISOString();
    st.frames = past.map((p) => ({ time: iso(p.time * 1000), kind: 'obs' }));
    for (let k = 1; k <= NC.N_FC; k++) st.frames.push({ time: iso(t0 + k * NC.STEP_MIN * 60000), kind: 'nowcast' });
    st.obsLast = nObs - 1; st.cur = st.obsLast; st.latest = iso(t0); st.levels = NC.LEVELS;
    st.bounds = L.latLngBounds(NC.BOUNDS[0], NC.BOUNDS[1]);
    st.urls = new Array(st.frames.length).fill(null); st.codes = new Array(st.frames.length).fill(null);
    if (isActive(st)) { nowHeader(); nowLegend(); }
    // เฟรมล่าสุดก่อน แล้วไล่ย้อนหลัง
    let got = 0;
    for (let i = nObs - 1; i >= 0; i--) {
      st.status = `กำลังโหลดเรดาร์ ${++got}/${nObs}`;
      if (isActive(st)) nowRender();
      st.codes[i] = await NC.loadFrame(host, past[i].path);
      st.urls[i] = await NC.render(st.codes[i], RATE_COLORS);
      if (i === nObs - 1) st.ready = true;
      if (isActive(st) && i === st.cur) nowRender();
    }
    // เวกเตอร์การเคลื่อนที่จากคู่เฟรมห่างกัน 30 นาที (3 ขั้น) แล้วเลื่อนภาพล่าสุดไปข้างหน้า
    st.status = 'กำลังคำนวณคาดการณ์ 2 ชม.';
    if (isActive(st)) nowRender();
    const GAP = 3, small = st.codes.slice(0, nObs).map((c) => NC.shrink(c)), pairs = [];
    for (let i = nObs - 1; i - GAP >= 0 && pairs.length < 3; i -= GAP) pairs.push([small[i], small[i - GAP]]);
    st.motion = pairs.length ? await NC.motion(pairs, tick) : null;
    for (let k = 1; k <= NC.N_FC; k++) {
      const i = st.obsLast + k;
      st.codes[i] = st.motion ? NC.advect(st.codes[st.obsLast], st.motion, 1 / GAP, k) : st.codes[st.obsLast];
      st.urls[i] = await NC.render(st.codes[i], RATE_COLORS);
      if (isActive(st) && i === st.cur) nowRender();
      await tick();
    }
    st.status = '';
    if (isActive(st)) nowRender();
  }

  async function loadNow(force) {
    const st = now, src = nowSrc;
    if (st.loading || (st.ready && !force)) { if (page === 'now') { nowHeader(); nowLegend(); nowRender(); } return; }
    st.loading = true; st.error = null;
    try { await (src === 'region' ? loadRegion(st) : loadTh(st)); }
    catch (e) { st.error = e.message || String(e); st.status = ''; if (isActive(st)) { nowHeader(); nowRender(); } }
    st.loading = false;
    if (isActive(st)) nowRender();
  }

  function setNowSrc(s) {
    if (s === nowSrc) return;
    nowPlay(false); clearImage();
    nowSrc = s; now = nowStates[s];
    try { localStorage.setItem('rainmap.nowSrc', s); } catch (e) { /* ข้ามได้ */ }
    nowHeader(); nowLegend(); nowRender();
    loadNow();
  }

  $('nowPrev').onclick = () => { nowPlay(false); nowStep(-1); };
  $('nowNext').onclick = () => { nowPlay(false); nowStep(1); };
  $('nowPlay').onclick = () => nowPlay(!nowTimer);
  $('nowSlider').oninput = (e) => { nowPlay(false); now.cur = +e.target.value; nowRender(); };
  document.querySelectorAll('#nowSrc button').forEach((b) => { b.onclick = () => setNowSrc(b.dataset.s); });

  // โหลดข้อมูลใหม่ทุก 10 นาทีถ้าหน้ายังเปิดอยู่
  setInterval(() => { if (!document.hidden && page === 'now' && !now.loading && !nowTimer) { const keep = now.cur === now.obsLast; loadNow(true).then(() => { if (keep) { now.cur = now.obsLast; nowRender(); } }); } }, 10 * 60000);

  // ---------- ตำแหน่งปัจจุบัน ----------
  const loc = { marker: null, circle: null, latlng: null };
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 5000);
  }
  function locInfo() {
    const ll = loc.latlng; if (!ll) return '';
    let h = `<b>ตำแหน่งของคุณ</b><br><span class="small">${ll.lat.toFixed(3)}, ${ll.lng.toFixed(3)}</span>`;
    if (page === 'now' && nowSrc === 'region' && now.codes[now.obsLast]) {
      const r0 = NC.sample(now.codes[now.obsLast], ll.lat, ll.lng);
      if (r0 === null) return h + '<br>อยู่นอกกรอบเรดาร์';
      h += `<br>ฝนตอนนี้ (${fmtTime(now.latest)}): <b>${r0 >= 0.1 ? r0.toFixed(1) + ' มม./ชม.' : 'ไม่มีฝน'}</b>`;
      let hit = null, peak = 0, done = true;
      for (let i = now.obsLast + 1; i < now.frames.length; i++) {
        if (!now.codes[i]) { done = false; break; }
        const r = NC.sample(now.codes[i], ll.lat, ll.lng) || 0;
        if (r > peak) peak = r;
        if (hit === null && r >= 0.5) hit = i;
      }
      if (!done) h += '<br>กำลังคำนวณคาดการณ์';
      else if (r0 >= 0.5) h += `<br>คาดว่าแรงสุดใน 2 ชม.: ${peak.toFixed(1)} มม./ชม.`;
      else if (hit !== null) h += `<br>คาดว่าฝนถึงประมาณ <b>${fmtTime(now.frames[hit].time)}</b> (สูงสุด ${peak.toFixed(1)} มม./ชม.)`;
      else h += '<br>คาดว่าไม่มีฝนใน 2 ชม. ข้างหน้า';
    } else if (page === 'fc' && fc.data) {
      const g = fc.grid, r = Math.round((ll.lat - g.lat0) / g.dlat), c = Math.round((ll.lng - g.lon0) / g.dlon);
      if (r < 0 || c < 0 || r >= g.ny || c >= g.nx) return h + '<br>อยู่นอกกรอบข้อมูลพยากรณ์';
      let t = 0;
      for (let d = fc.start; d < Math.min(g.days, fc.start + fc.win); d++) { const v = fc.data[d * g.nx * g.ny + r * g.nx + c]; if (v !== g.nodata) t += v * g.scale; }
      h += `<br>ฝนสะสม ${fc.win} วัน (เริ่ม ${fmtDate(fc.days[fc.start])}): <b>${t.toFixed(1)} มม.</b>`;
      if (fc.wx) {
        const d = wxAt(fc.start), u = RL.sampleGrid(d.g, d.u, ll.lat, ll.lng), v = RL.sampleGrid(d.g, d.v, ll.lat, ll.lng), pp = RL.sampleGrid(d.g, d.p, ll.lat, ll.lng);
        if (u === u) h += `<br>ลม ${(Math.hypot(u, v) * 3.6).toFixed(0)} กม./ชม. จากทิศ${RL.windFrom(u, v)} | ${pp.toFixed(0)} hPa<br><span class="small">ณ ${fmtDateTime(fc.meta.dayStarts[fc.start])}</span>`;
      }
    }
    return h;
  }
  map.on('locationfound', (e) => {
    loc.latlng = e.latlng;
    if (!loc.marker) {
      loc.circle = L.circle(e.latlng, { radius: e.accuracy, color: '#1f6feb', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
      loc.marker = L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#1f6feb', fillOpacity: 1 }).addTo(map).bindPopup(locInfo, { autoPan: false });
    } else { loc.marker.setLatLng(e.latlng); loc.circle.setLatLng(e.latlng).setRadius(e.accuracy); }
    map.setView(e.latlng, Math.max(map.getZoom(), 8));
    loc.marker.openPopup();
    $('locBtn').classList.remove('busy');
  });
  map.on('locationerror', (e) => {
    $('locBtn').classList.remove('busy');
    toast(e.code === 1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง เปิดสิทธิ์ location ของเว็บนี้ใน browser ก่อน' : 'หาตำแหน่งไม่ได้: ' + e.message);
  });
  const LocControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const d = L.DomUtil.create('div', 'leaflet-bar');
      const a = L.DomUtil.create('a', 'loc-btn', d);
      a.id = 'locBtn'; a.href = '#'; a.title = 'ตำแหน่งปัจจุบัน'; a.setAttribute('role', 'button'); a.setAttribute('aria-label', 'ตำแหน่งปัจจุบัน');
      a.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/></svg>';
      L.DomEvent.on(a, 'click', (ev) => {
        L.DomEvent.stop(ev);
        if (!navigator.geolocation) { toast('browser นี้ไม่รองรับการหาตำแหน่ง'); return; }
        a.classList.add('busy');
        map.locate({ setView: false, enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
      });
      return d;
    },
  });
  map.addControl(new LocControl());

  // ---------- หน้า ฝนคาดการณ์ ----------
  const fc = { meta: null, grid: null, data: null, win: 3, start: 0, cache: new Map(), bounds: null, days: [] };
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const unmerc = (y) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;

  // สีไล่ต่อเนื่องตามระดับ acc (มม.): ต่ำกว่าระดับแรกจางหายไป
  function accRamp(v, lv) {
    if (v < lv[0] * 0.5) return null;
    if (v < lv[0]) { const c = ACC_COLORS[0]; return [c[0], c[1], c[2], Math.round(((v - lv[0] * 0.5) / (lv[0] * 0.5)) * 70)]; }
    let i = 0; while (i < lv.length - 1 && v >= lv[i + 1]) i++;
    if (i >= lv.length - 1) { const c = ACC_COLORS[lv.length - 1]; return [c[0], c[1], c[2], 205]; }
    const t = (v - lv[i]) / (lv[i + 1] - lv[i]), a = ACC_COLORS[i], b = ACC_COLORS[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 70 + 135 * Math.min(1, (i + t) / 3)];
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
    const PX = nx > 60 ? 8 : 16, W = nx * PX, H = ny * PX;   // กริดภูมิภาคใหญ่ ใช้พิกเซลต่อช่องน้อยลง
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
        // เฟดขอบกริด 3 ช่อง (0.75 องศา) ไม่ให้เห็นเป็นกรอบสี่เหลี่ยม (ข้อมูล GFS ที่ต้นทางตัดมาแค่กรอบนี้)
        const ex = Math.min(fcc + 0.5, nx - 0.5 - fcc), ey = Math.min(fr + 0.5, ny - 0.5 - fr);
        const edge = Math.max(0, Math.min(1, Math.min(ex, ey) / 3));
        const p = (y * W + x) * 4;
        px[p] = col[0]; px[p + 1] = col[1]; px[p + 2] = col[2]; px[p + 3] = Math.round(col[3] * edge * edge);
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
    const wxOn = fc.wx && (layersOn.wind || layersOn.pres);
    $('fcKind').textContent = `ฝนสะสม ${fc.win} วัน | ${fc.meta.source.toUpperCase()} รอบ ${fmtDateTime(fc.meta.init)}`
      + (wxOn ? ` | ${[layersOn.wind && 'ลม', layersOn.pres && 'ความกดอากาศ'].filter(Boolean).join(' + ')} ณ ${fmtDateTime(fc.meta.dayStarts[fc.start])}` : '');
    document.querySelectorAll('#fcWin button').forEach((b) => b.classList.toggle('active', +b.dataset.w === fc.win));
    showImage(fcImage(fc.win, fc.start), fc.bounds, 1);
    applyLayers();
    credits();
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
    if (fc.meta.wx) {
      try {
        const w = fc.meta.wx, [wb, pb] = await Promise.all([w.wind.file, w.pres.file].map((f) => fetch('data/forecast/' + f + '?t=' + Date.now()).then((r) => { if (!r.ok) throw new Error(f); return r.arrayBuffer(); })));
        const pv = new DataView(pb), pres = new Uint16Array(pb.byteLength / 2);
        for (let i = 0; i < pres.length; i++) pres[i] = pv.getUint16(i * 2, true);
        fc.wx = { g: { lat0: w.lat0, lon0: w.lon0, dlat: w.dlat, dlon: w.dlon, nx: w.nx, ny: w.ny }, wind: new Int8Array(wb), pres, scale: w.wind.scale, offsetPa: w.pres.offsetPa, cache: {} };
      } catch (e) { fc.wx = null; }
    }
    const nd = fc.grid.days;
    $('fcTicks').innerHTML = `<b>วันนี้</b><span>${fmtDate(fc.days[Math.floor(nd / 2)])}</span><span>${fmtDate(fc.days[nd - 1])}</span>`;
    $('fcTotal').textContent = `${fmtDate(fc.days[0])} ถึง ${fmtDate(fc.days[nd - 1])}`;
  }
  function fcShow() { legend('ฝนสะสม (มม.)', fc.meta.levels.acc, ACC_COLORS, '', 'ไล่สีระหว่างจุดกริด 0.25 องศา (ค่าประมาณ)'); fcRender(); }

  document.querySelectorAll('#fcWin button').forEach((b) => { b.onclick = () => { fc.win = +b.dataset.w; fcRender(); }; });
  $('fcSlider').oninput = (e) => { fc.start = +e.target.value; fcRender(); };

  // ---------- ชั้นข้อมูลเสริม: เมฆ ลม ความกดอากาศ ----------
  const RL = window.RainLayers;
  const layersOn = { rain: true, cloud: false, wind: false, pres: false };
  try { Object.assign(layersOn, JSON.parse(localStorage.getItem('rainmap.layers') || '{}')); } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  const cloud = RL.CloudStack(map);
  const wind = RL.WindLayer(map);
  const presGroup = L.layerGroup();
  const presRenderer = L.canvas({ padding: 0.5 });
  let darkBase = true, presKey = '';      // แผนที่อากาศ (ค่าเริ่มต้น) เป็นโทนเข้ม
  wind.setDark(true);
  map.on('baselayerchange', (e) => { darkBase = e.name === BASE_OWN || e.name === 'ดาวเทียม' || e.name === 'โทนมืด'; wind.setDark(darkBase); rb.setDark(darkBase); presKey = ''; applyLayers(); });

  function wxAt(t) {      // ข้อมูลลม/ความกดอากาศ ณ เวลาที่ t (ต้นวันของวันที่ t)
    const w = fc.wx, n = w.g.nx * w.g.ny;
    if (!w.cache[t]) {
      const u = new Float32Array(n), v = new Float32Array(n), p = new Float32Array(n);
      for (let i = 0; i < n; i++) { u[i] = w.wind[t * 2 * n + i] * w.scale; v[i] = w.wind[t * 2 * n + n + i] * w.scale; p[i] = (w.pres[t * n + i] + w.offsetPa) / 100; }
      w.cache[t] = { g: w.g, u, v, p };
    }
    return w.cache[t];
  }

  function drawPressure(t) {
    const key = t + ':' + darkBase;
    if (key === presKey) return;
    presKey = key; presGroup.clearLayers();
    const d = wxAt(t), iso = RL.isobars(d.g, d.p), col = darkBase ? '#f2f2f2' : '#3a3f47';
    for (const [lv, segs] of iso.lines) {
      const bold = lv % 4 === 0;
      L.polyline(segs, { renderer: presRenderer, color: col, weight: bold ? 1.6 : 0.7, opacity: bold ? 0.85 : 0.55, interactive: false }).addTo(presGroup);
      if (bold && segs.length > 12) for (const f of [0.2, 0.55, 0.9]) {
        const s = segs[Math.floor(segs.length * f)];
        L.marker([(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2], { interactive: false, icon: L.divIcon({ className: 'iso-lbl' + (darkBase ? ' dark' : ''), html: String(lv), iconSize: [34, 14] }) }).addTo(presGroup);
      }
    }
    const mark = (pt, ch, cls) => L.marker([pt.lat, pt.lon], { interactive: false, icon: L.divIcon({ className: 'hl ' + cls, html: `${ch}<span>${Math.round(pt.hpa)}</span>`, iconSize: [36, 36] }) }).addTo(presGroup);
    iso.highs.forEach((p) => mark(p, 'H', 'hi'));
    iso.lows.forEach((p) => mark(p, 'L', 'lo'));
  }

  function cloudPreload() { if (layersOn.cloud && page === 'now' && now.frames.length) cloud.preload([...new Set(now.frames.map((f) => RL.cloudTime(f.time)))]); }
  function applyLayers() {
    if (layersOn.rain) { if (!map.hasLayer(rainGroup)) rainGroup.addTo(map); } else if (map.hasLayer(rainGroup)) map.removeLayer(rainGroup);
    const cloudOn = layersOn.cloud && page === 'now';
    if (cloudOn) {
      const f = now.frames[now.cur];
      cloud.show(f ? RL.cloudTime(f.time) : 'default');
      cloudPreload();
    } else cloud.hide();
    const wxOk = page === 'fc' && fc.wx;
    if (wxOk && layersOn.wind) { wind.setData(wxAt(fc.start)); wind.show(true); } else wind.show(false);
    if (wxOk && layersOn.pres) { drawPressure(fc.start); if (!map.hasLayer(presGroup)) presGroup.addTo(map); } else if (map.hasLayer(presGroup)) map.removeLayer(presGroup);
    document.querySelectorAll('.chips button').forEach((b) => {
      b.classList.toggle('active', !!layersOn[b.dataset.l]);
      if (b.dataset.l === 'wind' || b.dataset.l === 'pres') b.disabled = !fc.wx;
    });
  }
  document.querySelectorAll('.chips button').forEach((b) => {
    b.onclick = () => {
      layersOn[b.dataset.l] = !layersOn[b.dataset.l];
      try { localStorage.setItem('rainmap.layers', JSON.stringify(layersOn)); } catch (e) { /* ข้ามได้ */ }
      applyLayers();
      if (page === 'fc' && fc.meta) fcRender(); else nowLegend();
    };
  });

  // ---------- แหล่งที่มา / เวลาข้อมูล ----------
  function credits() {
    let src, when = null;
    if (page === 'now') {
      src = nowSrc === 'region' ? 'RainViewer (เรดาร์รวมภูมิภาค) | คาดการณ์ 2 ชม. จากทิศทางและความเร็วของกลุ่มฝน' : 'เรดาร์กรมอุตุนิยมวิทยา (ยังไม่ผ่านการตรวจสอบ) | ประมวลผลและคาดการณ์โดยระบบสมดุลน้ำ (ทดลอง)';
      when = now.latest;
    } else {
      src = 'NOAA GFS' + (fc.meta && fc.meta.provider === 'rid' ? ' ผ่านระบบสมดุลน้ำ (ทดลอง)' : '');
      when = fc.meta ? fc.meta.init : null;
    }
    $('note').textContent = 'แหล่งที่มา: ' + src;
    $('foot').textContent = (when ? `ข้อมูล ณ ${fmtDateTime(when)}` : 'กำลังโหลดข้อมูล') + ' | แหล่งที่มา: ' + src;
  }

  // ---------- สลับหน้า ----------
  let page = 'now';
  function showPage(p) {
    page = p;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.page === p));
    document.querySelectorAll('.page').forEach((s) => s.classList.toggle('active', s.id === 'page-' + p));
    nowPlay(false); clearImage();
    fitThailandOnce(p);   // เปิดหน้าไหนครั้งแรก ให้เห็นประเทศไทยพอดี หลังจากนั้นไม่ยุ่งกับมุมมองของผู้ใช้
    credits();
    applyLayers();
    if (p === 'now') { nowHeader(); nowLegend(); nowRender(); loadNow(); }
    else if (fc.meta) fcShow();
    location.hash = p;
    setTimeout(() => map.invalidateSize(), 50);
  }
  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => showPage(t.dataset.page); });

  // ---------- เริ่ม ----------
  (async () => {
    const want = location.hash === '#fc' ? 'fc' : 'now';
    nowHeader(); nowLegend(); applyLayers();
    const pn = loadNow();
    const pf = loadFc().then(() => applyLayers()).catch((e) => { $('fcKind').textContent = 'โหลด forecast ไม่ได้: ' + e.message; });
    if (want === 'fc') { await pf; showPage('fc'); }
    else { fitThailandOnce('now'); credits(); }
    await Promise.all([pn, pf]);
  })();
})();
