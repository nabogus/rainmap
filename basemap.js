/* basemap.js: แผนที่ฐานของ RainMap เอง (ข้อมูล Natural Earth ใน basemap.json)
   - พื้นบก/ทะเลโทนเข้ม อยู่ชั้นล่างสุด ให้เมฆสีขาวและฝนสีสดเห็นชัดพร้อมกัน
   - เส้นชายฝั่ง เส้นแบ่งประเทศ เส้นแบ่งจังหวัด และชื่อภาษาไทย อยู่ชั้นบนสุด ทะลุเมฆและฝน */
window.RainBase = (map) => {
  'use strict';
  const SEA = '#17212c', LAND = '#566159';
  const pane = (name, z) => { const p = map.createPane(name); p.style.zIndex = z; p.style.pointerEvents = 'none'; return p; };
  pane('landPane', 150);                       // ใต้ tilePane (200)
  pane('linePane', 460);                       // เหนือชั้นฝน (400) และลม (450)
  const labelPane = pane('labelPane', 470);    // ใต้หมุดตำแหน่ง (600)
  const landR = L.canvas({ pane: 'landPane', padding: 0.5 }), lineR = L.canvas({ pane: 'linePane', padding: 0.5 });

  const base = L.layerGroup();                 // ใส่ใน layer control เป็นแผนที่ฐาน
  const top = L.layerGroup();                  // เส้น + ชื่อ เปิดปิดได้
  const borderLines = [], provLines = [];
  const groups = [];                           // { g, show(zoom) }
  let dark = true;

  const ll = (ring) => ring.map((p) => [p[1], p[0]]);
  const lineStyle = () => ({ color: dark ? '#ffffff' : '#30363d', opacity: dark ? 0.78 : 0.7, weight: 1 });
  const provStyle = () => ({ color: dark ? '#ffffff' : '#30363d', opacity: dark ? 0.38 : 0.4, weight: 0.7 });

  function refresh() {
    const z = map.getZoom(), onMap = map.hasLayer(top);
    for (const { g, show } of groups) {
      const want = onMap && show(z);
      if (want && !top.hasLayer(g)) top.addLayer(g); else if (!want && top.hasLayer(g)) top.removeLayer(g);
    }
  }

  function label(lat, lon, cls, html) {
    return L.marker([lat, lon], { pane: 'labelPane', interactive: false, keyboard: false, icon: L.divIcon({ className: 'map-lbl ' + cls, html, iconSize: [0, 0] }) });
  }

  function build(d) {
    for (const c of d.countries) {
      const shape = c.rings.map((r) => [ll(r)]);
      L.polygon(shape, { renderer: landR, stroke: true, color: LAND, weight: 1, fillColor: LAND, fillOpacity: 1, interactive: false }).addTo(base);
      borderLines.push(L.polygon(shape, Object.assign({ renderer: lineR, fill: false, interactive: false }, lineStyle())));
    }
    const gBorder = L.layerGroup(borderLines), gProvLine = L.layerGroup(), gProvLbl = L.layerGroup(), gCountry = L.layerGroup();
    for (const p of d.provinces) {
      const pl = L.polygon(p.rings.map((r) => [ll(r)]), Object.assign({ renderer: lineR, fill: false, interactive: false }, provStyle()));
      provLines.push(pl); gProvLine.addLayer(pl);
      gProvLbl.addLayer(label(p.lat, p.lon, 'prov', `<span>${p.th}</span>`));
    }
    for (const c of d.countries) if (c.th) gCountry.addLayer(label(c.lat, c.lon, 'country', `<span>${c.th}</span>`));
    groups.push({ g: gBorder, show: () => true });
    groups.push({ g: gCountry, show: (z) => z < 8 });
    groups.push({ g: gProvLine, show: (z) => z >= 7 });
    groups.push({ g: gProvLbl, show: (z) => z >= 7 });
    // เมือง: ยิ่งซูมเข้ายิ่งแสดงเมืองรองมากขึ้น เมืองในไทยซ่อนเมื่อชื่อจังหวัดขึ้นแล้ว
    const MIN_Z = [3.5, 4.5, 5.5, 6.5, 7];
    for (let rank = 0; rank <= 4; rank++) for (const inTH of [true, false]) {
      const g = L.layerGroup();
      d.cities.filter((c) => c.rank === rank && c.inTH === inTH).forEach((c) => g.addLayer(label(c.lat, c.lon, 'city', `<i></i><span>${c.th}</span>`)));
      groups.push({ g, show: (z) => z >= MIN_Z[rank] && (!inTH || z < 7) });
    }
    refresh();
  }

  base.on('add', () => { map.getContainer().style.background = SEA; });
  base.on('remove', () => { map.getContainer().style.background = ''; });
  top.on('add remove', refresh);
  map.on('zoomend', refresh);

  fetch('basemap.json').then((r) => r.json()).then(build).catch(() => { /* ไม่มีไฟล์ก็ยังใช้แผนที่ฐานแบบ tile ได้ */ });

  return {
    base, top,
    setDark(v) {
      dark = v;
      labelPane.classList.toggle('light', !v);
      borderLines.forEach((l) => l.setStyle(lineStyle()));
      provLines.forEach((l) => l.setStyle(provStyle()));
    },
  };
};
