/* Mirrors PilotageAI/ui.rs::wrap and the question layout so imported
 * questions can be checked before they are sent to the glasses. */
(function (root) {
  'use strict';
  var A18 = [6,7,8,15,11,17,13,4,7,7,9,15,6,7,6,6,11,11,11,11,11,11,11,11,11,11,6,6,15,15,15,10,18,12,12,13,14,11,10,14,14,6,6,12,10,16,14,14,11,14,13,11,12,14,12,19,13,12,13,7,6,7,15,9,9,10,11,9,11,11,6,11,11,5,5,10,5,17,11,11,11,11,8,8,7,11,11,16,11,11,9,11,6,11,15];
  var A24 = [6,7,8,15,13,19,17,4,8,8,12,14,5,7,5,8,15,10,13,12,15,14,14,13,14,14,7,7,14,14,14,12,24,16,15,15,17,14,13,17,18,6,11,15,13,21,18,18,15,18,16,14,14,18,16,24,15,14,15,8,8,8,14,8,6,13,15,12,15,13,9,14,13,5,6,12,4,22,14,14,15,14,9,11,10,14,13,20,12,13,12,8,6,8,14];
  var OK = /^[\n\x20-\x7eáàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ]*$/;
  function bytes(s) { return Array.from(new TextEncoder().encode(s)); }
  function adv(b, f) { if (b >= 0x80) return b >= 0xC0 ? (f === 18 ? 11 : 14) : 0; if (b < 32) return 0; return (f === 18 ? A18 : A24)[b - 32]; }
  function wrapCount(str, f, w) {
    var s = bytes(str), n = 0, i = 0;
    while (i < s.length) {
      while (i < s.length && s[i] === 32) i++;
      if (i >= s.length) break;
      var start = i, wd = 0, space = 0;
      for (;;) {
        if (i >= s.length) break;
        var b = s[i];
        if (b === 10) { i++; break; }
        if (b === 32) space = i;
        var a = adv(b, f);
        if (wd + a > w && i > start) { if (space > start) i = space + 1; break; }
        wd += a; i++;
      }
      n++;
    }
    return n;
  }
  function fits(q) {
    var fig = !!q.fig, tw = fig ? 446 : 592, ow = tw - 52, oh = 0, tooLong = false;
    q.options.forEach(function (o) { var k = wrapCount(o, 18, ow); if (k > 3) tooLong = true; oh += Math.min(k, 3) * 22 + 10; });
    if (tooLong) return false;
    return 74 + wrapCount(q.question, 24, tw) * 28 + 8 + oh <= 444 || 74 + wrapCount(q.question, 18, tw) * 22 + 8 + oh <= 444;
  }
  function glyphsOk(s) { return OK.test(s); }
  var api = { fits: fits, glyphsOk: glyphsOk, wrapCount: wrapCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PilotageLayout = api;
})(this);
