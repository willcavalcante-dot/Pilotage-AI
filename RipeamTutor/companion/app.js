/* RIPEAM Tutor companion: AI setup + grading. Talks to the glasses only
 * through the documented miraCompanion bridge. */
(function () {
  'use strict';
  var BANK = window.RT_BANK, G = window.RTGrade, MC = window.miraCompanion, KEY = 'ripeam-tutor-settings';
  var S = { mode: 'off', apiKey: '', url: '' }, last = null, busy = false;
  var $ = function (id) { return document.getElementById(id); };
  function parse(v) { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return null; } }
  function load() {
    var p = MC && MC.storeGet ? Promise.resolve().then(function () { return MC.storeGet(KEY); }) : Promise.resolve(window.localStorage ? localStorage.getItem(KEY) : null);
    return p.then(parse).catch(function () { return null; });
  }
  function save() {
    var v = JSON.stringify(S);
    try { if (MC && MC.storeSet) MC.storeSet(KEY, v); else if (window.localStorage) localStorage.setItem(KEY, v); } catch (e) {}
  }
  function aiReady() { return (S.mode === 'key' && /^sk-ant-/.test(S.apiKey)) || (S.mode === 'backend' && /^https:\/\//.test(S.url)); }
  function pushState(hello) {
    if (!MC || !MC.setSnapshotForApp) return;
    var st = { type: 'state', ai: aiReady() ? 1 : 0, t: Date.now() % 1e6 };
    if (hello) st.hello = 1;
    try { Promise.resolve(MC.setSnapshotForApp(st)).catch(function () {}); } catch (e) {}
  }
  function timeout(ms) { var c = new AbortController(); setTimeout(function () { c.abort(); }, ms); return c.signal; }
  function callAI(q, text) {
    if (S.mode === 'backend') {
      return fetch(S.url, { method: 'POST', signal: timeout(45000), headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'ripeam_tutor_grade', question: q.q, reference: q.a, citation: q.ref, essentials: q.k.map(function (k) { return k[0]; }), transcript: text }) })
        .then(function (r) { if (!r.ok) throw new Error('backend HTTP ' + r.status); return r.json(); }).then(G.validate);
    }
    // Direct mode: the key lives only in this phone's Mira app storage.
    return fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: timeout(45000),
      headers: { 'content-type': 'application/json', 'x-api-key': S.apiKey, 'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(G.requestBody(q, text)) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status); return j; }); })
      .then(G.parseMessage);
  }
  function grade(id, text) {
    var q = BANK.questions.find(function (x) { return x.id === id; });
    if (!q) return;
    busy = true; render();
    var done = function (r, err) {
      var verdict = r ? G.VCODE[r.verdict] : 3;
      var c = G.correctionText(q, r, text);
      if (err) c = 'A avaliação por IA falhou (' + err + '): não foi possível verificar sua resposta.\n\n' + c.slice(c.indexOf('Resposta completa:'));
      last = { q: q, text: text, verdict: verdict, correction: c };
      busy = false; render();
      MC.sendToApp({ type: 'result', id: id, v: verdict, c: c, r: q.ref });
    };
    if (!aiReady() || !text.trim()) { done(null); return; }
    callAI(q, text).then(function (r) { done(r); }, function (e) { done(null, e.name === 'AbortError' ? 'tempo esgotado' : e.message); });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render() {
    $('status').textContent = !MC ? 'Prévia no navegador: sem óculos.' : busy ? 'Avaliando resposta…' : aiReady() ? 'IA configurada. Abra o RIPEAM Tutor nos óculos.' : 'IA não configurada: os óculos mostrarão a resposta de referência sem avaliar.';
    $('mode').value = S.mode; $('key-row').hidden = S.mode !== 'key'; $('url-row').hidden = S.mode !== 'backend';
    $('key').value = S.apiKey ? '••••••••' + S.apiKey.slice(-4) : ''; $('url').value = S.url;
    var L = ['Correct', 'Partial', 'Incorrect', 'Not verified'];
    $('last').innerHTML = last ? '<b>' + esc(last.q.id) + ' — ' + L[last.verdict] + '</b><p>' + esc(last.q.q) + '</p><p><i>Você:</i> ' + esc(last.text) + '</p><pre>' + esc(last.correction) + '</pre><p>Reference: ' + esc(last.q.ref) + '</p>' : 'Nenhuma resposta avaliada ainda.';
  }
  $('mode').onchange = function () { S.mode = this.value; save(); pushState(); render(); };
  function msg(id, text, ok) { var el = $(id); el.textContent = text; el.className = ok ? 'ok' : 'bad'; }
  function setKey(v) {
    v = String(v || '').replace(/\s+/g, '');
    if (!v || v.indexOf('•') >= 0) return;
    if (!/^sk-ant-/.test(v)) { msg('key-msg', 'A chave deve começar com sk-ant- (copie a chave inteira do console da Anthropic).', false); return; }
    S.apiKey = v; save(); pushState(); render();
    msg('key-msg', 'Chave salva neste iPhone (termina em ' + v.slice(-4) + '). Toque em Testar IA.', true);
  }
  function testAI(id) {
    if (!aiReady()) { msg(id, S.mode === 'key' ? 'Salve uma chave sk-ant- primeiro.' : 'Informe uma URL https:// primeiro.', false); return; }
    msg(id, 'Testando…', true);
    var q = BANK.questions.find(function (x) { return x.id === 'R5'; }) || BANK.questions[0];
    callAI(q, 'Manter vigilância visual e auditiva o tempo todo, usando todos os meios disponíveis.')
      .then(function (r) { msg(id, 'IA funcionando ✓ (teste avaliado como: ' + r.verdict + '). Pode usar nos óculos.', true); },
        function (e) {
          var m = e.name === 'AbortError' ? 'tempo esgotado' : e.message;
          if (/Failed to fetch|Load failed|NetworkError/i.test(m)) m += ' — o app Mira pode estar bloqueando a chamada direta; use o modo Meu servidor.';
          else if (/credit|billing|balance/i.test(m)) m += ' — adicione créditos em console.anthropic.com → Billing.';
          else if (/authentication|invalid x-api-key|401/i.test(m)) m += ' — chave inválida ou revogada; gere outra.';
          msg(id, 'Falhou: ' + m, false);
        });
  }
  $('key').onchange = function () { setKey(this.value); render(); };
  $('save').onclick = function () { setKey($('key').value); };
  $('test').onclick = function () { testAI('key-msg'); };
  $('test2').onclick = function () { testAI('url-msg'); };
  if (MC && typeof MC.bindPasteButton === 'function') {
    $('paste').hidden = false;
    try { MC.bindPasteButton($('paste'), function (text) { $('key').value = ''; setKey(text); }); } catch (e) { $('paste').hidden = true; }
  }
  $('url').onchange = function () { S.url = this.value.trim(); save(); pushState(); render(); };
  $('forget').onclick = function () { S.apiKey = ''; save(); pushState(); render(); msg('key-msg', 'Chave apagada deste iPhone.', true); };
  load().then(function (d) {
    if (d) S = Object.assign(S, d);
    render();
    if (MC && MC.onFromApp) {
      var off = MC.onFromApp(function (m) {
        if (m && m.type === 'answer') grade(m.id, String(m.text || ''));
        else if (m && m.type === 'hello') pushState();
      });
      window.addEventListener('pagehide', function () { if (typeof off === 'function') off(); });
      pushState(true);
      setInterval(function () { pushState(); }, 12000);
    }
  });
})();
