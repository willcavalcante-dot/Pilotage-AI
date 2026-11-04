/* Offline oral-answer check: keyword coverage of reference key points.
 * It does not understand meaning; results are labelled accordingly. */
(function (root) {
  'use strict';
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
  }
  function has(text, alt) { return text.indexOf(norm(alt)) >= 0; }
  function evaluate(item, transcript) {
    var text = norm(transcript), covered = [], missing = [], incorrect = [];
    (item.keypoints || []).forEach(function (k) {
      var ok = (k.all || []).every(function (group) { return group.some(function (a) { return has(text, a); }); });
      (ok ? covered : missing).push(k.label);
    });
    (item.misconceptions || []).forEach(function (m) {
      if ((m.any || []).some(function (a) { return has(text, a); })) incorrect.push(m.label);
    });
    var total = covered.length + missing.length;
    return { score: total ? Math.round(100 * covered.length / total) : 0, covered: covered, missing: missing,
      incorrect: incorrect, words: text.trim() ? text.trim().split(' ').length : 0, method: 'keywords' };
  }
  function glassesText(r, followUp, en) {
    var L = en ? { cov: 'Coverage', miss: 'Missing', err: 'Possible error', next: 'Follow-up', none: 'none',
      warn: 'Keyword check only - not semantic understanding.', empty: 'No speech captured.' }
      : { cov: 'Cobertura', miss: 'Faltou', err: 'Possível erro', next: 'Próxima', none: 'nada',
      warn: 'Avaliação por palavras-chave: não é compreensão semântica.', empty: 'Nenhuma fala capturada.' };
    if (!r.words && r.method === 'keywords') return L.empty + '\n' + L.warn;
    var out = [];
    if (r.method === 'ai') out.push('IA: ' + (r.feedback || ''));
    out.push(L.cov + ': ' + r.covered.length + '/' + (r.covered.length + r.missing.length) + ' (' + r.score + '%)');
    out.push(L.miss + ': ' + (r.missing.length ? r.missing.join('; ') : L.none));
    if (r.incorrect.length) out.push(L.err + ': ' + r.incorrect.join('; '));
    if (followUp) out.push(L.next + ': ' + followUp);
    if (r.method === 'keywords') out.push(L.warn);
    return out.join('\n');
  }
  var api = { evaluate: evaluate, glassesText: glassesText, norm: norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PilotageEval = api;
})(this);
