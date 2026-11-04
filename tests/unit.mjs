// Unit tests for the companion's pure modules. Usage: node tests/unit.mjs
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require = createRequire(import.meta.url);
const SRS = require('../companion/srs.js'), EV = require('../companion/evaluate.js'), LAY = require('../companion/layout.js');
const bank = JSON.parse(readFileSync(new URL('../bank/starter.json', import.meta.url), 'utf8'));
let ok = 0, bad = 0;
const t = (name, cond) => { cond ? ok++ : bad++; console.log((cond ? '  ok   ' : '  FAIL ') + name); };

// Scheduler
let c = SRS.schedule(null, 3, 100);
t('first Good -> 1 day', c.ivl === 1 && c.due === 101 && c.reps === 1);
c = SRS.schedule(c, 3, 101); t('second Good -> 4 days', c.ivl === 4 && c.due === 105);
c = SRS.schedule(c, 3, 105); t('third Good -> ivl*ease (10)', c.ivl === 10);
const easy = SRS.schedule(c, 4, 115); t('Easy grows faster than Good and raises ease', easy.ivl > SRS.schedule(c, 3, 115).ivl && easy.ease > c.ease);
const lapse = SRS.schedule(c, 1, 115); t('Again resets reps, interval 1, counts lapse, lowers ease', lapse.reps === 0 && lapse.ivl === 1 && lapse.lapses === 1 && lapse.ease < c.ease);
let e = null; for (let i = 0; i < 20; i++) e = SRS.schedule(e, 1, 100 + i); t('ease never below 1.3', e.ease >= 1.3);
t('never-seen card priority 6 (coverage gap)', SRS.priority(null, 100) === 6);
t('overdue outranks not-due', SRS.priority({ n: 3, due: 90, lapses: 0 }, 100) > SRS.priority({ n: 3, due: 130, lapses: 0 }, 100));
t('mastered (due far ahead) rests at 0', SRS.priority({ n: 9, due: 200, lapses: 0 }, 100) === 0);
t('repeated lapses and weak topic raise priority', SRS.priority({ n: 3, due: 100, lapses: 2 }, 100, true) === 9);
t('suspended card priority 0', SRS.priority({ n: 3, due: 90, susp: true }, 100) === 0);

// Oral evaluation
const item = bank.oral.find(o => o.id === 'O-27');
const full = EV.evaluate(item, 'Luzes encarnada branca encarnada, de dia esfera losango esfera; com seguimento acrescenta mastro e bordo. Pela natureza do trabalho as outras ficam fora do caminho. Nevoeiro: um longo e dois curtos.');
t('complete answer covers all key points', full.score === 100 && full.missing.length === 0);
const part = EV.evaluate(item, 'duas esferas e duas luzes encarnadas');
t('confused answer flags misconception and missing points', part.incorrect.length === 1 && part.missing.length >= 4);
t('accent-insensitive matching', EV.evaluate(item, 'ENCARNADA e BRANCA').covered.length >= 1);
t('glasses text labels method honestly', EV.glassesText(full, '', false).includes('palavras-chave'));
t('empty transcript reported', EV.glassesText(EV.evaluate(item, ''), '', false).startsWith('Nenhuma fala'));

// Layout mirror (must agree with tools/gen_bank.py, which accepted every bundled question)
t('every bundled question fits the glasses layout (JS mirror)', bank.questions.every(q => LAY.fits(q)));
t('over-long question rejected', !LAY.fits({ question: 'x '.repeat(900), options: ['a', 'b'] }));
t('unsupported glyphs rejected', !LAY.glyphsOk('Seta → e emoji 🚢') && LAY.glyphsOk('Ação à ré, ênfase'));
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
