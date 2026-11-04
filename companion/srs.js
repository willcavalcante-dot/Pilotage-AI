/* Pilotage AI scheduler: simplified SM-2 (Anki-style). This is NOT FSRS.
 * Ratings: 1 Again, 2 Hard, 3 Good, 4 Easy. Multiple-choice answers map to
 * 3 (correct) or 1 (wrong). Days are integer local-day numbers. */
(function (root) {
  'use strict';
  var MIN_EASE = 1.3, START_EASE = 2.5;
  function fresh() { return { reps: 0, ivl: 0, ease: START_EASE, due: null, lapses: 0, n: 0, ok: 0, last: null, susp: false }; }
  function schedule(card, rating, today) {
    var c = Object.assign(fresh(), card || {});
    rating = Math.max(1, Math.min(4, rating | 0));
    c.n += 1; c.last = today;
    if (rating === 1) {
      c.lapses += 1; c.reps = 0; c.ivl = 1;
      c.ease = Math.max(MIN_EASE, +(c.ease - 0.2).toFixed(2));
    } else {
      c.ok += 1;
      if (c.reps === 0) c.ivl = rating === 4 ? 3 : 1;
      else if (c.reps === 1) c.ivl = rating === 2 ? 3 : rating === 3 ? 4 : 6;
      else c.ivl = Math.max(c.ivl + 1, Math.round(c.ivl * (rating === 2 ? 1.2 : rating === 3 ? c.ease : c.ease * 1.3)));
      c.ease = Math.max(MIN_EASE, +(c.ease + (rating === 2 ? -0.15 : rating === 4 ? 0.15 : 0)).toFixed(2));
      c.reps += 1;
    }
    c.due = today + c.ivl;
    return c;
  }
  /* Priority digit 0-9 sent to the glasses (higher = study sooner):
   * suspended 0; never seen 6 (coverage gap); overdue 7-9; repeated lapses +1;
   * weak topic +1; not yet due 0-3 by distance (mastered material rests). */
  function priority(card, today, weakTopic) {
    if (!card || !card.n) return card && card.susp ? 0 : 6 + (weakTopic ? 1 : 0);
    if (card.susp) return 0;
    var p;
    if (card.due <= today) p = 7 + Math.min(2, Math.floor((today - card.due) / 3));
    else p = Math.max(0, 3 - Math.floor((card.due - today) / 7));
    if (card.lapses >= 2) p += 1;
    if (weakTopic) p += 1;
    return Math.max(0, Math.min(9, p));
  }
  function dayNumber(date) {
    var d = date || new Date();
    return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  }
  var api = { fresh: fresh, schedule: schedule, priority: priority, dayNumber: dayNumber, NAME: 'SM-2 simplificado (estilo Anki) - não é FSRS' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PilotageSRS = api;
})(this);
