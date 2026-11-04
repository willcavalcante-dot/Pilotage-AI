/* RIPEAM Tutor grading. The model judges the spoken answer ONLY against the
 * bundled reference answer for that question. The citation shown to the user
 * always comes from the bank, never from the model. */
(function (root) {
  'use strict';
  var SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['verdict', 'right', 'missed', 'wrong', 'unverifiable', 'comment'],
    properties: {
      verdict: { type: 'string', enum: ['correct', 'partial', 'incorrect', 'unverifiable'] },
      right: { type: 'array', items: { type: 'string' } },
      missed: { type: 'array', items: { type: 'string' } },
      wrong: { type: 'array', items: { type: 'string' } },
      unverifiable: { type: 'array', items: { type: 'string' } },
      comment: { type: 'string' }
    }
  };
  var SYSTEM = [
    'You are an examiner for the Brazilian maritime pilot exam (Praticagem), grading a spoken answer about RIPEAM / COLREG 1972.',
    'The REFERENCE ANSWER supplied with each request is the only authority. Judge the technical meaning of the student\'s answer against it, not the wording.',
    'Treat Portuguese and English maritime terms as equivalent (e.g. encarnada = vermelha = red, boreste = starboard, bombordo = port, alcançado = sternlight, seguimento = making way).',
    'The answer comes from speech recognition: ignore obvious mis-hearings, filler words and punctuation.',
    'verdict: "correct" = every essential element of the reference is present and nothing contradicts it; "partial" = core idea right but at least one essential element missing or a minor inaccuracy; "incorrect" = core idea wrong, contradicts the reference, or most essential elements missing; "unverifiable" = the transcript is empty/unintelligible or cannot be judged against the reference.',
    'right: elements the student got right. missed: essential elements of the reference the student omitted, including important details even when the answer is mostly correct (numbers, shall/may, exceptions, vessel categories). wrong: statements that contradict the reference.',
    'unverifiable: statements the student made that the reference does not cover. Never judge them true or false and never add rule content, numbers or citations that are not in the reference.',
    'Write every list item and the comment in Brazilian Portuguese, keeping English maritime terms where useful. Keep each item under 120 characters and the comment under 200.'
  ].join('\n');
  function userContent(q, transcript) {
    return 'QUESTION:\n' + q.q + '\n\nREFERENCE ANSWER (authoritative):\n' + q.a + '\n\nRULE CITATION: ' + q.ref +
      '\n\nESSENTIAL ELEMENTS:\n- ' + q.k.map(function (k) { return k[0]; }).join('\n- ') +
      '\n\nSTUDENT ANSWER (speech transcript):\n' + transcript;
  }
  function requestBody(q, transcript) {
    return { model: 'claude-opus-5-5', max_tokens: 4000, fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM, messages: [{ role: 'user', content: userContent(q, transcript) }] };
  }
  function parseMessage(msg) {
    if (!msg || !Array.isArray(msg.content)) throw new Error('resposta inválida da IA');
    if (msg.stop_reason === 'refusal') throw new Error('a IA recusou a solicitação');
    if (msg.stop_reason === 'max_tokens') throw new Error('resposta da IA truncada');
    var text = msg.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
    return validate(JSON.parse(text));
  }
  function validate(r) {
    var V = ['correct', 'partial', 'incorrect', 'unverifiable'];
    if (!r || V.indexOf(r.verdict) < 0) throw new Error('avaliação sem veredito');
    ['right', 'missed', 'wrong', 'unverifiable'].forEach(function (k) { r[k] = Array.isArray(r[k]) ? r[k].map(String) : []; });
    r.comment = String(r.comment || '');
    return r;
  }
  /* Offline fallback: keyword coverage cannot judge meaning, so the verdict is
   * always "not verified"; it only hints which elements seem absent. */
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function keywordHints(q, transcript) {
    var t = norm(transcript), found = [], absent = [];
    q.k.forEach(function (k) {
      var ok = k[1].every(function (g) { return g.some(function (a) { return t.indexOf(norm(a)) >= 0; }); });
      (ok ? found : absent).push(k[0]);
    });
    return { found: found, absent: absent };
  }
  var VCODE = { correct: 0, partial: 1, incorrect: 2, unverifiable: 3 };
  function bytes(s) { return new TextEncoder().encode(s).length; }
  function clip(s, max) { while (bytes(s) > max) s = s.slice(0, -1); return s; }
  /* Text shown under "Correction:" on the glasses. */
  function correctionText(q, r, transcript) {
    var out = [], list = function (label, items) { if (items.length) out.push(label + '\n- ' + items.join('\n- ')); };
    if (r) {
      if (r.comment) out.push(r.comment);
      list('Acertou:', r.right);
      list('Faltou:', r.missed);
      list('Incorreto:', r.wrong);
      list('Não verificável na referência:', r.unverifiable);
    } else {
      var h = keywordHints(q, transcript);
      out.push('Sem IA configurada no iPhone: não foi possível verificar o significado da sua resposta.');
      if (h.absent.length) out.push('Pontos que parecem ausentes (palavras-chave):\n- ' + h.absent.join('\n- '));
    }
    var head = clip(out.join('\n\n'), 700);
    return clip(head + '\n\nResposta completa:\n' + q.a, 1600);
  }
  var api = { SCHEMA: SCHEMA, SYSTEM: SYSTEM, requestBody: requestBody, userContent: userContent, parseMessage: parseMessage,
    validate: validate, keywordHints: keywordHints, correctionText: correctionText, VCODE: VCODE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RTGrade = api;
})(this);
