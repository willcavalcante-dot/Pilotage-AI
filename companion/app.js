/* Pilotage AI - iPhone companion. Owns persistence, SM-2 scheduling, analytics,
 * imports and oral evaluation. Talks to the glasses only through the
 * documented miraCompanion bridge (sendToApp / setSnapshotForApp / onFromApp). */
(function () {
  'use strict';
  var BANK = window.PAI_BANK, SRS = window.PilotageSRS, EV = window.PilotageEval, LAY = window.PilotageLayout;
  var MC = window.miraCompanion;
  var SUBJ = BANK.subjects.map(function (s) { return s.key; });
  var SCH = { verified: 'v', reviewed: 'r', ai_generated: 'a', unverified: 'u' };
  var SLABEL = { verified: 'Verificado', reviewed: 'Revisado - conferir edição', ai_generated: 'Gerado por IA', unverified: 'Não verificado' };
  var MODES = ['Revisão rápida', 'Flashcards', 'Simulado', 'Luzes e marcas'];
  var KEY = 'pilotage-state-v1';
  var S = null, saveTimer = 0, stateTimer = 0;

  function blank() {
    return { v: 1, cards: {}, log: {}, sessions: [], runs: {}, imported: [], oral: [], recent: [],
      settings: { lang: 0, goal: 20, aiOn: false, aiUrl: '' }, glasses: { lastSeen: 0, run: 0, bank: '', deck: 0, pending: 0 } };
  }
  // ---------- storage (miraCompanion store, browser fallback) ----------
  function parse(v) { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return null; } }
  function load() {
    var get = MC && MC.storeGet ? Promise.resolve().then(function () { return MC.storeGet(KEY); })
      : Promise.resolve(window.localStorage ? localStorage.getItem(KEY) : null);
    return get.then(parse).catch(function () { return null; });
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var data = JSON.stringify(S);
      try {
        if (MC && MC.storeSet) Promise.resolve(MC.storeSet(KEY, data)).catch(function (e) { toast('Falha ao salvar: ' + (e && e.message || e)); });
        else if (window.localStorage) localStorage.setItem(KEY, data);
      } catch (e) { toast('Falha ao salvar: ' + e.message); }
    }, 250);
  }
  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { return SRS.dayNumber(); }
  function pct(a, b) { return b ? Math.round(100 * a / b) : 0; }
  function toast(m) { var t = document.getElementById('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { t.style.display = 'none'; }, 2600); }
  function questions() { return BANK.questions.concat(S.imported); }
  function byId(id) { return questions().find(function (q) { return q.id === id; }); }
  function subjName(k) { var s = BANK.subjects.find(function (x) { return x.key === k; }); return s ? s.pt : k; }
  function topicKey(q) { return q.rule ? 'Regra ' + q.rule : subjName(q.subject); }
  function utf8Len(s) { return new TextEncoder().encode(s).length; }
  function fmtMin(ms) { var m = Math.round(ms / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; }
  function dueLabel(c) {
    if (!c || !c.n) return '<span class="muted">nova</span>';
    if (c.susp) return '<span class="muted">suspensa</span>';
    var d = c.due - today();
    return d < 0 ? '<span class="warn">vencida ' + (-d) + ' d</span>' : d === 0 ? '<span class="ok">hoje</span>' : 'em ' + d + ' d';
  }
  function badge(st) { return '<span class="badge b-' + (SCH[st] || 'u') + '">' + esc(SLABEL[st] || st) + '</span>'; }

  // ---------- analytics (derived only from recorded answers) ----------
  function aggregate() {
    var bySubj = {}, byTopic = {}, n = 0, ok = 0, due = 0, fresh = 0, t = today();
    questions().forEach(function (q) {
      var c = S.cards[q.id];
      if (!c || !c.n) { if (!(c && c.susp)) fresh++; return; }
      if (!c.susp && c.due <= t) due++;
      n += c.n; ok += c.ok;
      var s = bySubj[q.subject] || (bySubj[q.subject] = { n: 0, ok: 0 }); s.n += c.n; s.ok += c.ok;
      var k = topicKey(q), tp = byTopic[k] || (byTopic[k] = { n: 0, ok: 0 }); tp.n += c.n; tp.ok += c.ok;
    });
    var days = Object.keys(S.log).map(Number).sort(function (a, b) { return a - b; });
    var streak = 0;
    for (var d = t; S.log[d] && S.log[d].n > 0; d--) streak++;
    if (!streak && S.log[t - 1] && S.log[t - 1].n) for (d = t - 1; S.log[d] && S.log[d].n > 0; d--) streak++;
    var ms = days.reduce(function (a, k) { return a + (S.log[k].ms || 0); }, 0);
    var topics = Object.keys(byTopic).map(function (k) { return { k: k, n: byTopic[k].n, ok: byTopic[k].ok, a: pct(byTopic[k].ok, byTopic[k].n) }; });
    return { n: n, ok: ok, due: due, fresh: fresh, streak: streak, ms: ms, bySubj: bySubj, topics: topics, todayN: (S.log[t] || {}).n || 0 };
  }
  function weakTopics() {
    var w = {};
    aggregate().topics.forEach(function (x) { if (x.n >= 3 && x.a < 60) w[x.k] = true; });
    return w;
  }
  function prioString() {
    var w = weakTopics(), t = today();
    return BANK.questions.map(function (q) { return String(SRS.priority(S.cards[q.id], t, w[topicKey(q)])); }).join('');
  }
  function statLines() {
    var a = aggregate(), en = S.settings.lang === 1, weak = a.topics.filter(function (x) { return x.n >= 3; }).sort(function (x, y) { return x.a - y.a; })[0];
    var L = en
      ? ['Overall: ' + pct(a.ok, a.n) + '% in ' + a.n + ' answers', 'Streak: ' + a.streak + ' d | Today: ' + a.todayN + '/' + S.settings.goal,
        'Due: ' + a.due + ' | New: ' + a.fresh, weak ? 'Weakest: ' + weak.k + ' (' + weak.a + '%)' : 'Weakest: not enough data', 'Scheduler: simplified SM-2']
      : ['Geral: ' + pct(a.ok, a.n) + '% em ' + a.n + ' respostas', 'Sequência: ' + a.streak + ' d | Hoje: ' + a.todayN + '/' + S.settings.goal,
        'Vencidas: ' + a.due + ' | Novas: ' + a.fresh, weak ? 'Mais fraca: ' + weak.k + ' (' + weak.a + '%)' : 'Mais fraca: dados insuficientes', 'Agendador: SM-2 simplificado'];
    var out = L.join('\n');
    while (utf8Len(out) > 350) out = out.slice(0, -1);
    return out;
  }

  // ---------- glasses link ----------
  function online() { return Date.now() - S.glasses.lastSeen < 40000; }
  function pushState(hello) {
    if (!MC || !MC.setSnapshotForApp) return;
    var st = { type: 'state', run: S.glasses.run || 0, seq: S.runs[S.glasses.run] || 0, p: prioString(), lang: S.settings.lang, lines: statLines(), t: Date.now() % 1e6 };
    if (hello) st.hello = 1;
    try { Promise.resolve(MC.setSnapshotForApp(st)).catch(function () {}); } catch (e) {}
  }
  function schedulePush() { clearTimeout(stateTimer); stateTimer = setTimeout(function () { pushState(false); }, 300); }
  function send(obj, quiet) {
    if (!MC || !MC.sendToApp) { if (!quiet) toast('Sem ponte Mira (prévia no navegador).'); return Promise.resolve(false); }
    return Promise.resolve().then(function () { return MC.sendToApp(obj); }).then(function () { return true; }, function (e) { if (!quiet) toast('Óculos indisponíveis: ' + (e && e.message || e)); return false; });
  }
  function clean(s) { return String(s == null ? '' : s).replace(/[\x00\x1e\x1f]/g, ' '); }
  function deckEligible(q) { return q.toGlasses !== false && q._fits && q._glyphs; }
  function buildDeck() {
    var t = today(), w = weakTopics();
    var list = S.imported.filter(deckEligible).sort(function (a, b) { return SRS.priority(S.cards[b.id], t, w[topicKey(b)]) - SRS.priority(S.cards[a.id], t, w[topicKey(a)]); });
    var recs = [], ids = [];
    for (var i = 0; i < list.length && recs.length < 24; i++) {
      var q = list[i];
      var r = [q.id, SUBJ.indexOf(q.subject), q.difficulty, q.lang === 'en' ? 'e' : 'p', SCH[q.status] || 'u', q.answer, q.rule || '', q.fig || '',
        q.question, q.explanation, q.ref || '']
        .concat(q.options).map(clean).join('\x1f');
      var next = recs.concat([r]).join('\x1e');
      var msg = JSON.stringify({ type: 'deck', name: 'iPhone', items: next });
      if (utf8Len(next) > 2000 || utf8Len(msg) > 2200) continue;
      recs.push(r); ids.push(q.id);
    }
    return { items: recs.join('\x1e'), ids: ids };
  }
  function sendDeck(quiet) {
    var d = buildDeck();
    return send({ type: 'deck', name: 'iPhone', items: d.items }, quiet).then(function (ok) { if (ok && !quiet) toast(d.ids.length + ' questões importadas enviadas aos óculos'); });
  }
  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    S.glasses.lastSeen = Date.now();
    if (m.type === 'hello') {
      S.glasses.run = m.run; S.glasses.bank = m.bank; S.glasses.deck = m.deck; S.glasses.pending = m.pending;
      if (m.langset && S.settings.lang !== m.lang) { S.settings.lang = m.lang; save(); }
      pushState(false);
      if (S.imported.some(deckEligible)) sendDeck(true);
    } else if (m.type === 'results') {
      var last = S.runs[m.run] || 0, max = last, t = today();
      (m.r || []).forEach(function (e) {
        var seq = e[0], id = e[1], ok = !!e[2], rating = e[3], mode = e[5];
        if (seq <= last) return;
        max = Math.max(max, seq);
        var prev = S.cards[id] || {};
        var c = SRS.schedule(prev, rating, t); c.susp = !!prev.susp; S.cards[id] = c;
        var L = S.log[t] || (S.log[t] = { n: 0, ok: 0, ms: 0 }); L.n++; if (ok) L.ok++;
        S.recent.unshift([Date.now(), id, ok ? 1 : 0, rating, mode]);
      });
      S.recent.length = Math.min(S.recent.length, 400);
      S.runs[m.run] = max;
      var runs = Object.keys(S.runs); if (runs.length > 8) delete S.runs[runs[0]];
      if (m.run !== S.glasses.run) S.glasses.run = m.run;
      save(); pushState(false);
    } else if (m.type === 'session') {
      var t2 = today(), L2 = S.log[t2] || (S.log[t2] = { n: 0, ok: 0, ms: 0 });
      L2.ms += m.ms || 0;
      S.sessions.unshift({ t: Date.now(), mode: m.mode, subj: m.subj, n: m.n, ok: m.ok, ms: m.ms });
      S.sessions.length = Math.min(S.sessions.length, 200);
      save();
    } else if (m.type === 'deck_ok') {
      S.glasses.deck = m.n;
    } else if (m.type === 'oral') {
      evaluateOral(m.id, m.text || '');
    }
    render();
  }
  function followUp(item) {
    var t = today(), cands = questions().filter(function (q) { return q.rule && q.rule === item.rule; });
    cands.sort(function (a, b) { return SRS.priority(S.cards[b.id], t) - SRS.priority(S.cards[a.id], t); });
    if (!cands.length) return '';
    var q = cands[0].question; return q.length > 140 ? q.slice(0, 137) + '...' : q;
  }
  function evaluateOral(id, text) {
    var item = BANK.oral.find(function (o) { return o.id === id; });
    if (!item) return;
    var res = EV.evaluate(item, text), fu = followUp(item), en = S.settings.lang === 1;
    var finish = function (r) {
      var out = EV.glassesText(r, fu, en);
      while (utf8Len(out) > 460) out = out.slice(0, -1);
      S.oral.unshift({ t: Date.now(), id: id, text: text, score: r.score, missing: r.missing, incorrect: r.incorrect, method: r.method });
      S.oral.length = Math.min(S.oral.length, 50);
      save(); render();
      send({ type: 'oral_result', text: out }, true);
    };
    if (S.settings.aiOn && /^https:\/\//.test(S.settings.aiUrl) && text.trim()) {
      var rule = BANK.rules.find(function (r) { return r.id === item.rule; });
      var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 15000);
      fetch(S.settings.aiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ task: 'evaluate_oral', prompt: item.prompt, reference: item.reference, keypoints: item.keypoints.map(function (k) { return k.label; }),
          retrieved: rule ? [{ id: rule.id, title: rule.title, body: rule.body }] : [], transcript: text, lang: en ? 'en' : 'pt' }) })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          clearTimeout(timer);
          finish({ method: 'ai', score: j.score | 0, covered: res.covered, missing: j.missing || res.missing, incorrect: j.incorrect || [], feedback: String(j.feedback || '').slice(0, 160), words: res.words });
        })
        .catch(function (e) { clearTimeout(timer); toast('IA indisponível (' + e.message + '); usando avaliação offline.'); finish(res); });
    } else finish(res);
  }

  // ---------- import ----------
  function validate(q, ids) {
    var e = [];
    if (!q || typeof q !== 'object') return ['registro inválido'];
    if (typeof q.id !== 'string' || !/^[\x21-\x7e]{1,23}$/.test(q.id)) e.push('id ASCII de 1-23 caracteres');
    else if (ids[q.id]) e.push('id duplicado ' + q.id);
    if (SUBJ.indexOf(q.subject) < 0) e.push('subject deve ser um de ' + SUBJ.join(','));
    if (typeof q.question !== 'string' || !q.question.trim()) e.push('question');
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 5 || q.options.some(function (o) { return typeof o !== 'string' || !o.trim(); })) e.push('options: 2-5 textos');
    else if (!(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length)) e.push('answer: índice da alternativa correta');
    if (typeof q.explanation !== 'string' || !q.explanation.trim()) e.push('explanation');
    if (q.fig && !/^[LS]:[A-Z]{1,4}$/.test(q.fig)) e.push('fig (ex.: "L:RWR" ou "S:BDB")');
    return e;
  }
  function importJson(text) {
    var data; try { data = JSON.parse(text); } catch (e) { return { error: 'JSON inválido: ' + e.message }; }
    var list = Array.isArray(data) ? data : data && Array.isArray(data.questions) ? data.questions : null;
    if (!list) return { error: 'Esperado um array de questões ou {"questions": [...]}' };
    var ids = {}; questions().forEach(function (q) { ids[q.id] = 1; });
    var ok = [], errs = [], warns = [];
    list.forEach(function (raw, i) {
      var v = validate(raw, ids);
      if (v.length) { errs.push('#' + (i + 1) + ' ' + (raw && raw.id || '') + ': ' + v.join('; ')); return; }
      var q = { id: raw.id, subject: raw.subject, topic: String(raw.topic || ''), rule: String(raw.rule || ''), ref: String(raw.ref || (raw.source && raw.source.section) || ''),
        lang: raw.lang === 'en' ? 'en' : 'pt', difficulty: Math.min(5, Math.max(1, raw.difficulty | 0 || 2)), question: raw.question.trim(), options: raw.options.map(function (o) { return o.trim(); }),
        answer: raw.answer, explanation: raw.explanation.trim(), distractors: Array.isArray(raw.distractors) ? raw.distractors.map(String) : undefined,
        status: SCH[raw.status] ? raw.status : 'unverified', source: raw.source || null, tags: Array.isArray(raw.tags) ? raw.tags : [], fig: raw.fig || '',
        version: raw.version || 1, origin: 'import', importedAt: Date.now() };
      var all = [q.question, q.explanation, q.ref, q.rule].concat(q.options).join('\n');
      q._glyphs = LAY.glyphsOk(all);
      q._fits = LAY.fits(q);
      if (!q._glyphs) warns.push(q.id + ': caracteres fora da fonte dos óculos (fica só no iPhone)');
      if (!q._fits) warns.push(q.id + ': não cabe na tela dos óculos; encurte enunciado/alternativas (fica só no iPhone)');
      if (q.status === 'ai_generated') warns.push(q.id + ': marcada como gerada por IA - exibida como NÃO verificada');
      ids[q.id] = 1; ok.push(q);
    });
    S.imported = S.imported.concat(ok); save();
    return { ok: ok.length, errs: errs, warns: warns };
  }
  function download(name, text) {
    try {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) { toast('Download indisponível; use o texto abaixo.'); }
  }

  // ---------- views ----------
  var TABS = [['dash', 'Painel'], ['session', 'Sessão'], ['cal', 'Revisões'], ['cards', 'Cartões'], ['import', 'Importar'], ['oral', 'Oral'], ['sources', 'Fontes'], ['settings', 'Ajustes']];
  var tab = 'dash', cardFilter = { subj: '', q: '' }, lastImport = null;
  function renderTabs() {
    document.getElementById('tabs').innerHTML = TABS.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</button>'; }).join('');
    TABS.forEach(function (t) { document.getElementById('t-' + t[0]).className = t[0] === tab ? 'on' : ''; });
  }
  function renderConn() {
    var c = document.getElementById('conn');
    if (!MC) { c.innerHTML = '<span class="dot" style="background:var(--warn)"></span>Prévia fora do app Mira: sem óculos; dados ficam neste navegador.'; return; }
    var ago = Math.round((Date.now() - S.glasses.lastSeen) / 1000);
    c.innerHTML = online()
      ? '<span class="dot" style="background:var(--ok)"></span>Óculos conectados (contato há ' + ago + ' s) · banco ' + esc(S.glasses.bank || '?') + (S.glasses.bank && S.glasses.bank !== BANK.version ? ' <span class="warn">(difere do iPhone ' + esc(BANK.version) + ')</span>' : '')
      : '<span class="dot" style="background:var(--bad)"></span>Óculos sem contato. Abra o Pilotage AI nos óculos; o estudo offline continua e sincroniza depois.';
  }
  function vDash() {
    var a = aggregate(), acc = pct(a.ok, a.n);
    var subj = BANK.subjects.map(function (s) {
      var x = a.bySubj[s.key]; if (!x) return '<div class="row"><span class="grow">' + esc(s.pt) + '</span><span class="muted">sem respostas</span></div>';
      return '<div class="row"><span class="grow">' + esc(s.pt) + '</span><b>' + pct(x.ok, x.n) + '%</b><span class="muted">' + x.n + '</span></div><div class="bar"><i style="width:' + pct(x.ok, x.n) + '%"></i></div>';
    }).join('');
    var tp = a.topics.filter(function (x) { return x.n >= 2; });
    var weak = tp.slice().sort(function (x, y) { return x.a - y.a; }).slice(0, 5), strong = tp.slice().sort(function (x, y) { return y.a - x.a; }).slice(0, 5);
    var trow = function (x) { return '<tr><td>' + esc(x.k) + '</td><td>' + x.a + '%</td><td class="muted">' + x.n + '</td></tr>'; };
    var hist = S.sessions.slice(0, 6).map(function (s) {
      return '<tr><td>' + new Date(s.t).toLocaleDateString('pt-BR') + '</td><td>' + esc(MODES[s.mode] || 'Regra') + '</td><td>' + s.ok + '/' + s.n + '</td><td>' + fmtMin(s.ms) + '</td></tr>';
    }).join('');
    return '<div class="card"><h2>Visão geral</h2><div class="kpis">' +
      '<div class="kpi"><b>' + (a.n ? acc + '%' : '-') + '</b><span>Aproveitamento geral</span></div>' +
      '<div class="kpi"><b>' + a.n + '</b><span>Respostas registradas</span></div>' +
      '<div class="kpi"><b>' + fmtMin(a.ms) + '</b><span>Tempo de estudo</span></div>' +
      '<div class="kpi"><b>' + a.streak + ' d</b><span>Sequência atual</span></div>' +
      '<div class="kpi"><b>' + a.due + '</b><span>Revisões vencidas</span></div>' +
      '<div class="kpi"><b>' + a.todayN + '/' + S.settings.goal + '</b><span>Meta de hoje</span></div></div>' +
      '<p class="muted" style="font-size:12px">Retenção estimada: indisponível - o agendador ' + esc(SRS.NAME) + ' não modela probabilidade de recordação (planejado com FSRS). Nenhuma estatística é simulada: tudo vem das suas respostas.</p></div>' +
      '<div class="card"><h2>Por matéria</h2>' + subj + '</div>' +
      '<div class="card"><h2>Tópicos mais fracos</h2>' + (weak.length ? '<table><tr><th>Tópico</th><th>Acerto</th><th>Resp.</th></tr>' + weak.map(trow).join('') + '</table>' : '<p class="muted">Responda ao menos 2 questões por tópico.</p>') +
      '<h2 style="margin-top:12px">Mais fortes</h2>' + (strong.length ? '<table>' + strong.map(trow).join('') + '</table>' : '<p class="muted">Sem dados ainda.</p>') + '</div>' +
      '<div class="card"><h2>Sessões recentes</h2>' + (hist ? '<table><tr><th>Data</th><th>Modo</th><th>Acertos</th><th>Tempo</th></tr>' + hist + '</table>' : '<p class="muted">Nenhuma sessão concluída nos óculos.</p>') + '</div>';
  }
  function subjOptions(sel, withAll) {
    return (withAll ? '<option value="255">Todas as matérias</option>' : '') + BANK.subjects.map(function (s, i) { return '<option value="' + i + '"' + (String(sel) === String(i) ? ' selected' : '') + '>' + esc(s.pt) + '</option>'; }).join('') +
      (S.imported.length ? '<option value="254">Importadas (iPhone)</option>' : '');
  }
  function vSession() {
    var p = [['5 min - revisão rápida', { mode: 0, count: 10, minutes: 5, level: 0 }], ['10 min - flashcards', { mode: 1, count: 15, minutes: 10, level: 0 }],
      ['15 min - prática avançada (nível 3+)', { mode: 0, count: 15, minutes: 15, level: 13 }], ['30 min - simulado', { mode: 2, count: 20, minutes: 30, level: 0 }]];
    return '<div class="card"><h2>Sessões rápidas</h2><label>Matéria</label><select id="ps-subj">' + subjOptions(255, true) + '</select>' +
      p.map(function (x, i) { return '<div class="row" style="margin-top:8px"><span class="grow">' + x[0] + '</span><button class="act" data-preset="' + i + '">Enviar</button></div>'; }).join('') +
      '<p class="muted" style="font-size:12px">A sessão começa nos óculos imediatamente. Sem o iPhone, os mesmos modos estão no menu dos óculos.</p></div>' +
      '<div class="card"><h2>Personalizada</h2><label>Modo</label><select id="cs-mode">' + MODES.map(function (m, i) { return '<option value="' + i + '">' + m + '</option>'; }).join('') + '</select>' +
      '<label>Matéria</label><select id="cs-subj">' + subjOptions(255, true) + '</select>' +
      '<label>Nível</label><select id="cs-level"><option value="0">Todos</option><option value="1">1-2 fundamentos</option><option value="2">3 cenários</option><option value="3">4-5 armadilhas</option><option value="14">4+</option></select>' +
      '<div class="row"><div><label>Questões</label><input id="cs-count" type="number" min="1" max="40" value="10"></div><div><label>Minutos (0 = sem limite)</label><input id="cs-min" type="number" min="0" max="180" value="10"></div></div>' +
      '<div style="margin-top:10px"><button class="act" id="cs-send">Enviar aos óculos</button></div></div>';
  }
  function vCal() {
    var t = today(), counts = [], overdue = 0;
    for (var i = 0; i < 14; i++) counts.push(0);
    questions().forEach(function (q) { var c = S.cards[q.id]; if (!c || !c.n || c.susp) return; var d = c.due - t; if (d < 0) overdue++; else if (d < 14) counts[d]++; });
    var dn = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    var cells = counts.map(function (n, i) { var dt = new Date(Date.now() + i * 864e5); return '<div class="day' + (n >= 10 ? ' hot' : '') + '">' + (i === 0 ? 'hoje' : dn[dt.getDay()] + ' ' + dt.getDate()) + '<b>' + n + '</b></div>'; }).join('');
    var od = questions().filter(function (q) { var c = S.cards[q.id]; return c && c.n && !c.susp && c.due < t; }).slice(0, 30)
      .map(function (q) { return '<tr><td>' + esc(q.id) + '</td><td>' + esc(topicKey(q)) + '</td><td>' + dueLabel(S.cards[q.id]) + '</td></tr>'; }).join('');
    return '<div class="card"><h2>Próximos 14 dias</h2><p>Vencidas: <b class="' + (overdue ? 'warn' : '') + '">' + overdue + '</b></p><div class="cal">' + cells + '</div></div>' +
      '<div class="card"><h2>Vencidas</h2>' + (od ? '<table>' + od + '</table>' : '<p class="muted">Nada vencido.</p>') + '<p class="muted" style="font-size:12px">Agendamento: ' + esc(SRS.NAME) + '. Os óculos priorizam vencidas, erros repetidos, tópicos fracos e cartões nunca vistos.</p></div>';
  }
  function vCards() {
    var t = cardFilter.q.toLowerCase();
    var list = questions().filter(function (q) { return (!cardFilter.subj || q.subject === cardFilter.subj) && (!t || (q.id + ' ' + q.question + ' ' + (q.rule || '')).toLowerCase().indexOf(t) >= 0); });
    var rows = list.map(function (q) {
      var c = S.cards[q.id] || {};
      var opts = q.options.map(function (o, i) { return '<li' + (i === q.answer ? ' class="ok"' : '') + '>' + esc(o) + (q.distractors && q.distractors[i] ? ' <span class="muted">- ' + esc(q.distractors[i]) + '</span>' : '') + '</li>'; }).join('');
      return '<details><summary><b>' + esc(q.id) + '</b> ' + badge(q.status) + ' <span class="muted">' + esc(topicKey(q)) + ' · nível ' + q.difficulty + ' · ' + (c.n ? pct(c.ok, c.n) + '% de ' + c.n : 'sem respostas') + ' · </span>' + dueLabel(c) +
        (q.origin === 'import' ? ' <span class="pill">importada' + (deckEligible(q) ? '' : ' · só iPhone') + '</span>' : '') + '</summary>' +
        '<p>' + esc(q.question) + '</p><ol type="A">' + opts + '</ol><p>' + esc(q.explanation) + '</p><p class="muted">Ref.: ' + esc(q.ref) + ' · erros: ' + (c.lapses || 0) + ' · próxima revisão: ' + (c.due != null ? new Date((c.due) * 864e5).toISOString().slice(0, 10) : '-') + '</p>' +
        '<div class="row"><button class="sec" data-susp="' + esc(q.id) + '">' + (c.susp ? 'Reativar' : 'Suspender') + '</button><button class="sec" data-reset="' + esc(q.id) + '">Reiniciar progresso</button>' +
        (q.origin === 'import' ? '<button class="sec" data-del="' + esc(q.id) + '">Remover</button>' : '') + '</div></details>';
    }).join('');
    return '<div class="card"><h2>Cartões (' + list.length + ')</h2><div class="row"><select id="cf-subj"><option value="">Todas</option>' +
      BANK.subjects.map(function (s) { return '<option value="' + s.key + '"' + (cardFilter.subj === s.key ? ' selected' : '') + '>' + esc(s.pt) + '</option>'; }).join('') + '</select>' +
      '<input id="cf-q" class="grow" placeholder="Buscar id, texto, regra" value="' + esc(cardFilter.q) + '"></div>' + rows + '</div>';
  }
  function vImport() {
    var r = lastImport, rep = '';
    if (r) rep = r.error ? '<p class="bad">' + esc(r.error) + '</p>' : '<p class="ok">' + r.ok + ' questões importadas.</p>' +
      (r.errs.length ? '<p class="bad">Rejeitadas:</p><ul>' + r.errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '') +
      (r.warns.length ? '<p class="warn">Avisos:</p><ul>' + r.warns.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '');
    var nDeck = S.imported.filter(deckEligible).length;
    return '<div class="card"><h2>Importar banco de questões (JSON)</h2><p class="muted" style="font-size:12px">Formato: array ou {"questions":[...]} com id, subject (' + SUBJ.join(', ') + '), question, options (2-5), answer (índice), explanation, ref, difficulty 1-5, lang pt/en, status (verified | reviewed | ai_generated | unverified), source {title, edition, section}, tags, fig opcional. Sem status, a questão fica como NÃO verificada.</p>' +
      '<input type="file" id="im-file" accept=".json,application/json"><label>ou cole o JSON</label><textarea id="im-text" placeholder="[{&quot;id&quot;:&quot;MEU-01&quot;, ...}]"></textarea>' +
      '<div class="row" style="margin-top:8px"><button class="act" id="im-go">Validar e importar</button></div>' + rep + '</div>' +
      '<div class="card"><h2>Enviar aos óculos</h2><p>' + S.imported.length + ' importadas, ' + nDeck + ' cabem nos óculos. O envio usa até 24 questões (limite de memória dos óculos), priorizando as vencidas. Elas aparecem em “Enviadas pelo iPhone” e em “Todas as matérias”.</p>' +
      '<button class="act" id="im-deck"' + (nDeck ? '' : ' disabled') + '>Enviar questões importadas</button> <span class="muted">nos óculos agora: ' + (S.glasses.deck || 0) + '</span></div>' +
      '<div class="card"><h2>Backup</h2><div class="row"><button class="sec" id="bk-export">Exportar backup</button><button class="sec" id="bk-show">Mostrar como texto</button><button class="sec" id="bk-restore">Restaurar do texto</button></div><textarea id="bk-text" placeholder="Cole aqui um backup para restaurar"></textarea></div>';
  }
  function vOral() {
    var hist = S.oral.slice(0, 10).map(function (o) {
      var it = BANK.oral.find(function (x) { return x.id === o.id; }) || {};
      return '<details><summary>' + new Date(o.t).toLocaleString('pt-BR') + ' · <b>' + o.score + '%</b> ' + (o.method === 'ai' ? '(IA)' : '(palavras-chave)') + ' · ' + esc((it.prompt || o.id).slice(0, 60)) + '</summary>' +
        '<p><b>Transcrição:</b> ' + esc(o.text || '(vazia)') + '</p><p><b>Faltou:</b> ' + esc((o.missing || []).join('; ') || 'nada') + '</p>' + ((o.incorrect || []).length ? '<p class="warn"><b>Possível erro:</b> ' + esc(o.incorrect.join('; ')) + '</p>' : '') +
        '<p class="muted"><b>Referência:</b> ' + esc(it.reference || '') + '</p></details>';
    }).join('');
    return '<div class="card"><h2>Exame oral</h2><p>Nos óculos: Exame oral → escolha a pergunta → <b>Gravar</b> (toque explícito; indicador “GRAVANDO” visível) → toque para parar → <b>Avaliar no iPhone</b>. A transcrição usa o serviço documentado do Mira (0x0001-0x0003). Gravação para sozinha em 2 min, ao sair da tela ou ao fechar o app.</p>' +
      '<p class="muted" style="font-size:12px">Transcrever voz não é compreender. A avaliação padrão compara palavras-chave da resposta de referência e indica pontos faltantes; ela não julga o significado. Avaliação semântica requer o backend opcional abaixo.</p></div>' +
      '<div class="card"><h2>Avaliações</h2>' + (hist || '<p class="muted">Nenhuma ainda.</p>') + '</div>' +
      '<div class="card"><h2>IA opcional (seu backend)</h2><label><input type="checkbox" id="ai-on"' + (S.settings.aiOn ? ' checked' : '') + '> Usar backend de IA para avaliar respostas orais</label>' +
      '<label>URL HTTPS do seu backend (nenhuma chave é guardada aqui)</label><input id="ai-url" style="width:100%" value="' + esc(S.settings.aiUrl) + '" placeholder="https://seu-servidor/evaluate">' +
      '<p class="muted" style="font-size:12px">O backend recebe a pergunta, a referência, os pontos-chave, o resumo da regra (recuperado do banco) e a transcrição, e guarda as chaves de API no servidor. Se falhar, a avaliação offline é usada. Veja backend/README.md.</p></div>';
  }
  function vSources() {
    var cov = BANK.subjects.map(function (s) {
      var b = BANK.questions.filter(function (q) { return q.subject === s.key; }).length, im = S.imported.filter(function (q) { return q.subject === s.key; }).length;
      return '<tr><td>' + esc(s.pt) + '</td><td>' + b + '</td><td>' + im + '</td><td>' + (b + im ? '' : '<span class="warn">sem conteúdo - importe da edição vigente</span>') + '</td></tr>';
    }).join('');
    return '<div class="card"><h2>Aviso sobre o conteúdo</h2><p>' + esc(BANK.notice) + '</p><p class="muted">Banco: ' + esc(BANK.title) + ' · versão ' + esc(BANK.version) + ' · ' + BANK.questions.length + ' questões, ' + BANK.rules.length + ' resumos de regras, ' + BANK.oral.length + ' perguntas orais.</p>' +
      '<p class="muted" style="font-size:12px">A lista de matérias não é o edital: confirme no edital oficial do PSCPP 2027 quais matérias e bibliografias são exigidas.</p></div>' +
      '<div class="card"><h2>Cobertura</h2><table><tr><th>Matéria</th><th>Banco</th><th>Import.</th><th></th></tr>' + cov + '</table></div>' +
      '<div class="card"><h2>Fontes citadas</h2><table>' + BANK.sources.map(function (s) { return '<tr><td><b>' + esc(s.title) + '</b><br><span class="muted">' + esc(s.publisher) + ' · ' + esc(s.edition) + '</span></td><td>' + (s.official ? '<span class="badge b-v">oficial</span>' : '<span class="badge b-a">doutrina</span>') + '</td></tr>'; }).join('') + '</table></div>';
  }
  function vSettings() {
    return '<div class="card"><h2>Preferências</h2><label>Idioma do conteúdo nos óculos</label><select id="st-lang"><option value="0">Português</option><option value="1">English (Maritime English)</option><option value="2">Misto PT + EN</option></select>' +
      '<label>Meta diária de respostas</label><input id="st-goal" type="number" min="5" max="300" value="' + S.settings.goal + '"></div>' +
      '<div class="card"><h2>Privacidade</h2><ul><li>Sem chaves de API, senhas ou contas embutidas no app.</li><li>Progresso fica no armazenamento do app no iPhone; nada é enviado a servidores, exceto a transcrição oral se você ativar seu backend de IA.</li><li>O microfone só é usado no Exame oral, após toque explícito, com indicador de gravação; para ao tocar, ao sair da tela, após 2 min ou ao fechar o app.</li><li>Ferramenta de estudo: não usar para navegação real ou prevenção de colisão.</li></ul></div>' +
      '<div class="card"><h2>Dados</h2><button class="sec" id="st-reset">Apagar todo o progresso</button></div>';
  }
  function render() {
    if (!S) return;
    renderTabs(); renderConn();
    var el = document.getElementById('t-' + tab);
    if (tab === 'cards' && document.activeElement && document.activeElement.id === 'cf-q') return; // keep typing focus
    if (tab === 'import' && document.activeElement && /im-text|bk-text/.test(document.activeElement.id)) return;
    el.innerHTML = { dash: vDash, session: vSession, cal: vCal, cards: vCards, import: vImport, oral: vOral, sources: vSources, settings: vSettings }[tab]();
    if (tab === 'settings') document.getElementById('st-lang').value = String(S.settings.lang);
  }
  function num(id, lo, hi, d) { var v = parseInt(document.getElementById(id).value, 10); return isNaN(v) ? d : Math.max(lo, Math.min(hi, v)); }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b || !S) return;
    if (b.dataset.tab) { tab = b.dataset.tab; render(); window.scrollTo(0, 0); return; }
    if (b.dataset.preset) {
      var P = [{ mode: 0, count: 10, minutes: 5, level: 0 }, { mode: 1, count: 15, minutes: 10, level: 0 }, { mode: 0, count: 15, minutes: 15, level: 13 }, { mode: 2, count: 20, minutes: 30, level: 0 }][+b.dataset.preset];
      send(Object.assign({ type: 'session', subj: +document.getElementById('ps-subj').value }, P)).then(function (ok) { if (ok) toast('Sessão enviada aos óculos'); });
      return;
    }
    switch (b.id) {
      case 'cs-send': send({ type: 'session', mode: +document.getElementById('cs-mode').value, subj: +document.getElementById('cs-subj').value, level: +document.getElementById('cs-level').value,
        count: num('cs-count', 1, 40, 10), minutes: num('cs-min', 0, 180, 10) }).then(function (ok) { if (ok) toast('Sessão enviada aos óculos'); }); return;
      case 'im-go': lastImport = importJson(document.getElementById('im-text').value); render(); return;
      case 'im-deck': sendDeck(false); return;
      case 'bk-export': download('pilotage-ai-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(S)); return;
      case 'bk-show': document.getElementById('bk-text').value = JSON.stringify(S); return;
      case 'bk-restore':
        var d = parse(document.getElementById('bk-text').value);
        if (!d || d.v !== 1 || typeof d.cards !== 'object') { toast('Backup inválido'); return; }
        if (!confirm('Substituir todo o progresso atual por este backup?')) return;
        S = Object.assign(blank(), d); save(); pushState(false); render(); toast('Backup restaurado'); return;
      case 'st-reset':
        if (!confirm('Apagar todo o progresso, importações e histórico?')) return;
        S = blank(); save(); pushState(false); render(); return;
    }
    if (b.dataset.susp) { var c = S.cards[b.dataset.susp] || SRS.fresh(); c.susp = !c.susp; S.cards[b.dataset.susp] = c; save(); schedulePush(); render(); }
    else if (b.dataset.reset) { if (confirm('Reiniciar o progresso desta questão?')) { delete S.cards[b.dataset.reset]; save(); schedulePush(); render(); } }
    else if (b.dataset.del) { if (confirm('Remover esta questão importada?')) { S.imported = S.imported.filter(function (q) { return q.id !== b.dataset.del; }); delete S.cards[b.dataset.del]; save(); render(); } }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!S) return;
    if (t.id === 'cf-subj') { cardFilter.subj = t.value; render(); }
    else if (t.id === 'st-lang') { S.settings.lang = +t.value; save(); pushState(false); }
    else if (t.id === 'st-goal') { S.settings.goal = num('st-goal', 5, 300, 20); save(); schedulePush(); }
    else if (t.id === 'ai-on') { S.settings.aiOn = t.checked; save(); }
    else if (t.id === 'ai-url') { S.settings.aiUrl = t.value.trim(); save(); if (S.settings.aiUrl && !/^https:\/\//.test(S.settings.aiUrl)) toast('Use uma URL https://'); }
    else if (t.id === 'im-file' && t.files && t.files[0]) { t.files[0].text().then(function (x) { document.getElementById('im-text').value = x; }); }
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'cf-q') { cardFilter.q = ev.target.value; clearTimeout(render.t); render.t = setTimeout(function () { var el = document.getElementById('t-cards'); el.innerHTML = vCards(); var i = document.getElementById('cf-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); }
  });

  // ---------- start ----------
  load().then(function (d) {
    S = Object.assign(blank(), d && d.v === 1 ? d : {});
    S.settings = Object.assign(blank().settings, S.settings || {});
    S.glasses = Object.assign(blank().glasses, S.glasses || {});
    S.imported.forEach(function (q) { q._glyphs = LAY.glyphsOk([q.question, q.explanation, q.ref, q.rule].concat(q.options).join('\n')); q._fits = LAY.fits(q); });
    render();
    if (MC && MC.onFromApp) {
      var off = MC.onFromApp(onMessage);
      window.addEventListener('pagehide', function () { if (typeof off === 'function') off(); });
      pushState(true);
      send({ type: 'sync' }, true);
      setInterval(function () { pushState(false); renderConn(); }, 12000);
    }
  });
})();
