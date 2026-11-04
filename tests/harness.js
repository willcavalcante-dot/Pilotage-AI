/* Test-only Mira host emulator, injected before the app's scripts. It runs the
 * package's embedded WASM with stub SDK imports, implements the companion
 * mailbox protocol (0x0062/0x0063/0x0064) the way Shared/companion.rs expects,
 * and exposes a fake miraCompanion to the page's own phone UI. */
(function () {
  'use strict';
  var enc = new TextEncoder(), dec = new TextDecoder();
  var G = window.__glasses = { frames: [], log: [], fromApp: [], toAppLog: [], ble: true, sidebar: 0, transcript: [], cursor: null, requests: {}, stopped: 0, started: 0 };
  var store = {}, handlers = [];
  // ---- phone-side mailbox state ----
  var queue = [], pendingSnapshot = null, cur = { seq: 0, bytes: enc.encode('0\0') }, rev = 1, seqCounter = 0, inbound = {};
  function nextMessage() {
    var m = queue.length ? queue.shift() : pendingSnapshot;
    if (!queue.length && m === pendingSnapshot) pendingSnapshot = null;
    if (!m) return false;
    seqCounter++; cur = { seq: seqCounter, bytes: enc.encode(seqCounter + '\0' + JSON.stringify(m)) }; rev++;
    G.toAppLog.push(m);
    return true;
  }
  window.miraCompanion = {
    sendToApp: function (o) { queue.push(o); if (cur.seq === 0 || cur.acked) { cur.acked = false; nextMessage(); } return Promise.resolve(); },
    setSnapshotForApp: function (o) { pendingSnapshot = o; if (cur.seq === 0 || cur.acked) { cur.acked = false; nextMessage(); } return Promise.resolve(); },
    onFromApp: function (h) { handlers.push(h); return function () { handlers = handlers.filter(function (x) { return x !== h; }); }; },
    storeGet: function (k) { return Promise.resolve(k in store ? store[k] : null); },
    storeSet: function (k, v) { store[k] = v; return Promise.resolve(); },
    storeRemove: function (k) { delete store[k]; return Promise.resolve(); }
  };
  G.store = store;
  // ---- SDK host ----
  var mem, ex, nextId = 1, frame = null, ms = 0;
  function bytesAt(p, n) { return new Uint8Array(mem.buffer, p, n).slice(); }
  function respond(method, payload) {
    if (method === 0x64) { var r = new Uint8Array(4); new DataView(r.buffer).setUint32(0, 7, true); return r; }
    if (method === 0x62) {
      var dv = new DataView(payload.buffer), reqRev = dv.getUint32(0, true), off = dv.getUint16(4, true);
      var out = new Uint8Array(384), o = new DataView(out.buffer);
      o.setUint32(0, rev, true);
      if (reqRev === rev && off === 0) { o.setUint16(4, 0, true); o.setUint16(6, 0xffff, true); return out.slice(0, 8); }
      var chunk = cur.bytes.slice(off, off + 376);
      o.setUint16(4, off, true); o.setUint16(6, cur.bytes.length, true); out.set(chunk, 8);
      return out.slice(0, 8 + chunk.length);
    }
    if (method === 0x63) {
      var d = new DataView(payload.buffer);
      if (payload[0] === 0) { var s = d.getUint32(1, true); if (s === cur.seq) { cur.acked = true; nextMessage() && (cur.acked = false); } return new Uint8Array(0); }
      if (payload[0] === 1) {
        var id = d.getUint32(1, true), off2 = d.getUint16(5, true), total = d.getUint16(7, true);
        var buf = inbound[id] || (inbound[id] = new Uint8Array(total)); buf.set(payload.slice(9), off2);
        if (off2 + payload.length - 9 === total) {
          delete inbound[id];
          var msg = JSON.parse(dec.decode(buf)); G.fromApp.push(msg);
          setTimeout(function () { handlers.forEach(function (h) { h(msg); }); }, 0);
        }
        return new Uint8Array(0);
      }
    }
    if (method === 1) { G.started++; return new Uint8Array(0); }
    if (method === 2) { G.stopped++; return new Uint8Array(0); }
    if (method === 3) {
      var t = G.transcript.length ? G.transcript[0] : { fin: 0, text: '' };
      if (G.transcript.length > 1) G.transcript.shift();
      var tb = enc.encode(t.text), r3 = new Uint8Array(2 + tb.length); r3[0] = 1; r3[1] = t.fin; r3.set(tb, 2); return r3;
    }
    return new Uint8Array(0);
  }
  var imports = { mira: {
    begin: function () { frame = []; },
    present: function () { G.frames.push(frame); if (G.frames.length > 40) G.frames.shift(); },
    text: function (x, y, w, h, c, f, a, s, p, n) { frame.push({ k: 'text', x: x, y: y, w: w, h: h, c: c, f: f, a: a, s: dec.decode(bytesAt(p, n)) }); },
    fill_rect: function (x, y, w, h, c) { frame.push({ k: 'rect', x: x, y: y, w: w, h: h, c: c }); },
    stroke_rect: function (x, y, w, h, s, c) { frame.push({ k: 'srect', x: x, y: y, w: w, h: h, s: s, c: c }); },
    fill_round_rect: function (x, y, w, h, r, c) { frame.push({ k: 'rrect', x: x, y: y, w: w, h: h, r: r, c: c }); },
    stroke_round_rect: function (x, y, w, h, r, s, c) { frame.push({ k: 'srrect', x: x, y: y, w: w, h: h, r: r, s: s, c: c }); },
    fill_circle: function (x, y, r, c) { frame.push({ k: 'circle', x: x, y: y, r: r, c: c }); },
    stroke_circle: function (x, y, r, s, c) { frame.push({ k: 'scircle', x: x, y: y, r: r, s: s, c: c }); },
    line: function (a, b, c2, d, w, c) { frame.push({ k: 'line', x: a, y: b, x2: c2, y2: d, w: w, c: c }); },
    fill_triangle: function (a, b, c2, d, e, f, c) { frame.push({ k: 'tri', p: [a, b, c2, d, e, f], c: c }); },
    now_ms: function () { return 12345; },
    device_status: function (p, cap) { var b = new Uint8Array(mem.buffer, p, 10); b.set([80, 0, 1, G.ble ? 1 : 0, 1, 10, 30, 11, 4, 3]); return 10; },
    ble_request: function (m, p, n) { if (!G.ble && m !== 0x70) return -1; var id = nextId++; G.requests[id] = respond(m, bytesAt(p, n)); G.log.push(m); return id; },
    ble_response_len: function (id) { var r = G.requests[id]; return r ? r.length : -2; },
    ble_response_read: function (id, p, cap) { var r = G.requests[id]; if (!r) return -2; if (r.length > cap) return -4; new Uint8Array(mem.buffer, p, r.length).set(r); delete G.requests[id]; return r.length; },
    ble_send: function (m) { if (m === 2) G.stopped++; return 0; },
    gesture_policy: function () { return 1; },
    content_cursor: function (x, y, f) { G.cursor = f ? [x, y] : null; },
    content_info: function (f) { return f === 5 ? G.sidebar : 0; },
    app_launch: function () { return 1; }
  } };
  G.boot = function () {
    var b64 = document.querySelector('script[type="application/mira-wasm"]').textContent.replace(/\s+/g, '');
    var bin = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
    var mod = new WebAssembly.Module(bin);
    WebAssembly.Module.imports(mod).forEach(function (i) { if (!imports.mira[i.name]) imports.mira[i.name] = function () { return 0; }; });
    var inst = new WebAssembly.Instance(mod, imports);
    ex = inst.exports; mem = ex.memory;
    G.memPages = mem.buffer.byteLength / 65536;
    ex.app_init();
  };
  G.tick = function (n, step) { step = step || 50; for (var i = 0; i < n; i++) { ms += step; ex.app_render(step); } };
  G.event = function (e) { ex.app_event(e); G.tick(4); };
  G.stop = function () { ex.app_stop(); };
  G.texts = function () { var f = G.frames[G.frames.length - 1] || []; return f.filter(function (p) { return p.k === 'text'; }).map(function (p) { return p.s; }); };
  G.draw = function (canvas) {
    var f = G.frames[G.frames.length - 1] || [], ctx = canvas.getContext('2d');
    function col(c) { var v = Math.round(c * 17); return 'rgb(' + Math.round(v * 0.55) + ',' + v + ',' + Math.round(v * 0.75) + ')'; }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 640, 480);
    f.forEach(function (p) {
      ctx.fillStyle = col(p.c); ctx.strokeStyle = col(p.c);
      if (p.k === 'text') { var px = [24, 18, 32, 40][p.f]; ctx.font = px + 'px Helvetica, Arial, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = ['left', 'center', 'right'][p.a];
        ctx.fillText(p.s, p.a === 0 ? p.x : p.a === 1 ? p.x + p.w / 2 : p.x + p.w, p.y + 2); }
      else if (p.k === 'rect') ctx.fillRect(p.x, p.y, p.w, p.h);
      else if (p.k === 'srect') { ctx.lineWidth = p.s; ctx.strokeRect(p.x, p.y, p.w, p.h); }
      else if (p.k === 'rrect' || p.k === 'srrect') { ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, p.r); if (p.k === 'rrect') ctx.fill(); else { ctx.lineWidth = p.s; ctx.stroke(); } }
      else if (p.k === 'circle' || p.k === 'scircle') { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); if (p.k === 'circle') ctx.fill(); else { ctx.lineWidth = p.s; ctx.stroke(); } }
      else if (p.k === 'line') { ctx.lineWidth = p.w; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke(); }
      else if (p.k === 'tri') { ctx.beginPath(); ctx.moveTo(p.p[0], p.p[1]); ctx.lineTo(p.p[2], p.p[3]); ctx.lineTo(p.p[4], p.p[5]); ctx.fill(); }
    });
    if (G.cursor) { ctx.fillStyle = '#7ff'; ctx.beginPath(); ctx.arc(G.cursor[0], G.cursor[1], 7, 0, 7); ctx.fill(); }
  };
})();
