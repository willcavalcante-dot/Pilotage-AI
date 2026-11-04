// End-to-end software test of dist/PilotageAI.html in headless Chromium.
// Runs the embedded WASM against tests/harness.js (SDK host emulator) and the
// package's real companion UI. Usage: node tests/e2e.mjs [html] [shotsDir]
import { createRequire } from 'module';
import { readFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(process.argv[2] || path.join(here, '..', 'dist', 'PilotageAI.html'));
const shots = path.resolve(process.argv[3] || path.join(here, '..', 'dist', 'screens'));
mkdirSync(shots, { recursive: true });

let passed = 0, failed = 0; const dbg = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); if (process.env.DEBUG) dbg.push(name); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('dialog', d => d.accept());
await page.addInitScript({ content: readFileSync(path.join(here, 'harness.js'), 'utf8') });
await page.goto('file://' + html);
await page.evaluate(() => window.__glasses.boot());

const G = (fn, arg) => page.evaluate(fn, arg);
const tick = async (n = 10) => { for (let i = 0; i < n; i++) await G(() => window.__glasses.tick(2)); };
const ev = async e => { await G(e => window.__glasses.event(e), e); await tick(2); };
const lp = async () => { await tick(14); await ev(9); };
const texts = () => G(() => window.__glasses.texts());
const has = async s => (await texts()).some(t => t.includes(s));
async function shot(name) {
  await G(() => {
    let c = document.getElementById('__g');
    if (!c) { c = document.createElement('canvas'); c.id = '__g'; c.width = 640; c.height = 480; c.style.cssText = 'position:fixed;left:0;top:0;z-index:99'; document.body.appendChild(c); }
    c.style.display = 'block'; window.__glasses.draw(c);
  });
  await page.setViewportSize({ width: 640, height: 480 });
  await page.screenshot({ path: path.join(shots, name + '.png'), clip: { x: 0, y: 0, width: 640, height: 480 } });
  await G(() => { document.getElementById('__g').style.display = 'none'; });
  await page.setViewportSize({ width: 390, height: 844 });
}
async function toMenu() { for (let i = 0; i < 4 && !(await has('PILOTAGE AI')); i++) await lp(); }
async function selectItem(label) {
  for (let i = 0; i < 12; i++) await ev(1);
  for (let i = 0; i < 25; i++) {
    const f = await G(() => { const fr = window.__glasses.frames.at(-1); const sel = fr.find(p => p.k === 'srrect' && p.c === 15); return sel ? fr.filter(p => p.k === 'text' && p.y >= sel.y && p.y <= sel.y + sel.h).map(p => p.s) : []; });
    if (f.some(t => t.includes(label))) { await ev(0); return true; }
    await ev(2);
  }
  return false;
}
// Find the on-screen option order of the current question and the correct letter.
async function currentQuestion() {
  return G(() => {
    const fr = window.__glasses.frames.at(-1), tx = fr.filter(p => p.k === 'text');
    const bank = window.PAI_BANK.questions;
    const lettersY = tx.filter(p => /^[A-E]\)$/.test(p.s)).map(p => p.y);
    const optTexts = lettersY.map(y => tx.filter(p => p.y >= y && p.y < y + 70 && !/^[A-E]\)$/.test(p.s) && p.x > 60 && p.y > 74).filter(p => Math.abs(p.y - y) < 1 || true));
    const qtext = tx.filter(p => p.y >= 74 && p.y < (lettersY[0] || 999) && p.f !== undefined && p.c === 15).map(p => p.s).join(' ');
    const q = bank.find(b => qtext.startsWith(b.question.slice(0, 25))) || null;
    if (!q) return { qtext, q: null };
    const firstLines = lettersY.map(y => (tx.find(p => p.y === y && p.x > 60 && !/^[A-E]\)$/.test(p.s)) || {}).s || '');
    const correctPos = firstLines.findIndex(l => q.options[q.answer].startsWith(l.replace(/\.\.\.$/, '')));
    const wrongPos = firstLines.findIndex((l, i) => i !== correctPos);
    return { qtext, id: q.id, n: firstLines.length, correctPos, wrongPos };
  });
}
async function answer(pos) { for (let i = 0; i < 6; i++) await ev(1); for (let i = 0; i < pos; i++) await ev(2); await ev(0); }

console.log('Pilotage AI e2e: ' + html);
await tick(40);
const mem = await G(() => window.__glasses.memPages);
check('WASM memory is exactly one 64 KiB page', mem === 1, 'pages=' + mem);
check('initial render shows menu', await has('PILOTAGE AI') && await has('Revisão rápida') && await has('Meu progresso'));
const hello = await G(() => window.__glasses.fromApp.find(m => m.type === 'hello'));
check('glasses registered and sent hello to companion', !!hello, JSON.stringify(hello));
check('companion answered with state snapshot', await G(() => window.__glasses.toAppLog.some(m => m.type === 'state')));
await tick(10);
check('menu shows iPhone connected', await has('iPhone conectado'));
await shot('01-menu');

// Quick review on RIPEAM
await ev(0);
check('subject list shown', await has('Todas as matérias') && await has('RIPEAM / COLREG'));
await shot('02-subjects');
check('select RIPEAM', await selectItem('RIPEAM'));
check('question screen with options', await has('A)') && await has('B)'));
check('session header shows mode, position and timer', (await texts()).some(t => t.includes('Revisão rápida - RIPEAM') && t.includes('1/10')) && (await texts()).some(t => /0[45]:\d\d/.test(t)));
let q = await currentQuestion();
check('question identified in bank', !!q.id, q.qtext);
await shot('03-question');
await answer(q.correctPos);
check('correct feedback', await has('CORRETO') && !(await has('INCORRETO')));
check('explanation + reference + status note shown', (await texts()).some(t => t.startsWith('Ref:')) || (await texts()).some(t => t.includes('Revisado pelo autor')));
await shot('04-feedback-correct');
await ev(0);
q = await currentQuestion();
check('second question identified', !!q.id, q.qtext);
await answer(q.wrongPos);
check('incorrect feedback shows correct answer and choice', await has('INCORRETO') && (await texts()).some(t => t.startsWith('Resposta:')) && (await texts()).some(t => t.startsWith('Sua escolha:')));
await shot('05-feedback-wrong');
await tick(30);
const res = await G(() => window.__glasses.fromApp.filter(m => m.type === 'results').flatMap(m => m.r));
check('results delivered to companion', res.length >= 2, JSON.stringify(res));
await page.waitForTimeout(400);
const stored = await G(() => JSON.parse(window.__glasses.store['pilotage-state-v1'] || '{}'));
check('companion persisted SRS state for answered cards', stored.cards && Object.keys(stored.cards).length >= 2, JSON.stringify(Object.keys(stored.cards || {})));
await lp();
check('long press ends session with summary', await has('Resumo da sessão') && (await texts()).some(t => t.includes('Respondidas: 2')));
await shot('06-summary');
check('review mistakes available', await selectItem('Revisar erros') && await has('INCORRETO'));
await lp();
await tick(20);
check('session summary reached companion', await G(() => window.__glasses.fromApp.some(m => m.type === 'session' && m.n === 2)));
await toMenu();

// Flashcards
check('open flashcards', await selectItem('Flashcards'));
await selectItem('Todas');
check('card front', await has('Toque: ver resposta'));
await ev(0);
check('card back with ratings', await has('Resposta') && await has('De novo') && await has('Fácil'));
await shot('07-flashcard-back');
await lp();
check('long press shows explanation page', await has('Explicação'));
await ev(0);
await ev(1); await ev(1); await ev(0); // rate "De novo"
check('next card after rating', await has('Toque: ver resposta'));
await lp(); await toMenu();

// Exam simulator with level selection
check('open simulator', await selectItem('Simulado'));
await selectItem('Todas');
check('level list', await has('Níveis 4-5'));
await selectItem('Níveis 4-5');
check('exam question with 30-min timer', await has('A)') && (await texts()).some(t => /(29|30):\d\d/.test(t)));
await ev(0);
check('exam mode gives no per-question feedback', !(await has('CORRETO')) && await has('A)'));
await lp(); await toMenu();

// Lights & shapes (memory palace diagrams)
check('open lights & shapes', await selectItem('Luzes e marcas'));
const figPrims = await G(() => window.__glasses.frames.at(-1).filter(p => p.k === 'circle' || p.k === 'tri' || p.k === 'scircle' || (p.k === 'rect' && p.w === 26)).length);
check('diagram primitives drawn', figPrims >= 1, 'prims=' + figPrims);
await shot('08-lights');
await lp(); await toMenu();

// Rule explorer
check('open rule explorer', await selectItem('Explorador de regras'));
check('rule 6 present', await selectItem('Regra 6'));
check('rule page lists subdivisions', (await texts()).some(t => t.includes('(a) TODAS')));
await shot('09-rule6');
await ev(0);
check('practice from rule page starts rule-6 quiz', (await texts()).some(t => t.includes('Praticar regra - Regra 6')));
await lp(); await toMenu();

// Disconnection handling
await G(() => { window.__glasses.ble = false; });
await tick(30);
check('offline indicator when phone link drops', await has('Modo offline'));
await selectItem('Revisão rápida'); await selectItem('Todas');
q = await currentQuestion(); await answer(q.correctPos); await ev(0);
q = await currentQuestion(); await answer(q.correctPos);
const before = await G(() => window.__glasses.fromApp.filter(m => m.type === 'results').length);
await lp(); await toMenu();
await selectItem('Meu progresso');
check('offline answers queued locally', (await texts()).some(t => /A enviar ao iPhone: [1-9]/.test(t)));
await shot('10-progress-offline');
await G(() => { window.__glasses.ble = true; });
await tick(60);
const after = await G(() => window.__glasses.fromApp.filter(m => m.type === 'results').length);
check('queued results delivered after reconnect', after > before, before + ' -> ' + after);
await lp(); await selectItem('Meu progresso');
check('queue drained after companion ack', (await texts()).some(t => t.includes('A enviar ao iPhone: 0')));
check('companion stats shown on glasses', (await texts()).some(t => t.startsWith('Geral:')));
await shot('11-progress');
await toMenu();

// Oral exam with transcription
check('open oral exam', await selectItem('Exame oral'));
await ev(0);
check('oral prompt screen', await has('Gravar resposta'));
await G(() => { window.__glasses.transcript = [{ fin: 0, text: 'luzes encarnada' }, { fin: 1, text: 'Três luzes encarnada, branca e encarnada; de dia esfera, losango e esfera. Pela natureza do trabalho, as outras ficam fora do caminho.' }]; });
await ev(0);
await tick(6);
check('transcription start requested (0x0001)', await G(() => window.__glasses.started === 1));
check('recording indicator visible', (await texts()).some(t => t.includes('GRAVANDO')));
await tick(30);
check('transcript appears on glasses', (await texts()).some(t => t.includes('losango')));
await shot('12-oral-recording');
await ev(0);
check('stop requested (0x0002)', await G(() => window.__glasses.stopped >= 1));
check('evaluate option', await selectItem('Avaliar no iPhone'));
await tick(40);
check('oral transcript reached companion', await G(() => window.__glasses.fromApp.some(m => m.type === 'oral' && m.text.includes('losango'))));
check('evaluation returned to glasses', await has('Avaliação (iPhone)') && (await texts()).some(t => t.startsWith('Cobertura:')));
await shot('13-oral-evaluation');
await lp(); await lp(); await toMenu();

// Recording is stopped when the app closes
await selectItem('Exame oral'); await ev(0); await ev(0); await tick(4);
const stopsBefore = await G(() => window.__glasses.stopped);
await G(() => window.__glasses.stop());
check('app_stop stops an active transcription', await G(s => window.__glasses.stopped > s, stopsBefore));
await G(() => window.__glasses.boot()); await tick(40);

// Phone → glasses session and imported deck
await page.click('button[data-tab="session"]');
await page.click('button[data-preset="0"]');
await tick(30);
check('phone-started session opens on glasses', (await texts()).some(t => t.includes('Revisão rápida - Todas')) && await has('A)'));
await lp(); await toMenu();
await page.click('button[data-tab="import"]');
await page.fill('#im-text', JSON.stringify([{ id: 'TEST-01', subject: 'normam', question: 'Questão de teste importada pelo iPhone: qual alternativa está correta?', options: ['Primeira', 'Segunda', 'Terceira', 'Quarta'], answer: 2, explanation: 'Explicação de teste.', ref: 'Teste', difficulty: 2, lang: 'pt', status: 'unverified' }]));
await page.click('#im-go');
check('import validated', (await page.textContent('#t-import')).includes('1 questões importadas'));
await page.click('#im-deck');
await tick(40);
check('glasses acknowledged deck', await G(() => window.__glasses.fromApp.some(m => m.type === 'deck_ok' && m.n === 1)));
await selectItem('Revisão rápida');
check('imported question counted in its subject', await has('NORMAM (1)'));
for (let i = 0; i < 10; i++) await ev(2);
check('imported deck listed as its own subject', await has('Enviadas pelo iPhone (1)'));
await selectItem('NORMAM');
check('imported question shown', await has('Questão de teste importada'));
await ev(0);
check('unverified warning shown with imported answer', (await texts()).some(t => t.includes('NÃO verificado')));
await lp(); await toMenu();

// Language toggle
await selectItem('Meu progresso'); await selectItem('Idioma');
await lp();
check('English UI after toggle', await has('Quick review') && await has('My progress'));
await tick(20); await page.waitForTimeout(400);
if (process.env.DEBUG) console.log('DBG', JSON.stringify(await G(() => ({h: window.__glasses.fromApp.filter(m => m.type === 'hello'), st: JSON.parse(window.__glasses.store['pilotage-state-v1']).settings, q: window.__glasses.toAppLog.slice(-3)}))));
check('companion adopted glasses language', await G(() => JSON.parse(window.__glasses.store['pilotage-state-v1']).settings.lang === 1));

// Companion screenshots
await page.click('button[data-tab="dash"]');
await page.screenshot({ path: path.join(shots, 'phone-dashboard.png'), fullPage: true });
await page.click('button[data-tab="cards"]');
await page.screenshot({ path: path.join(shots, 'phone-cards.png') });
check('companion lists cards with status badges', (await page.textContent('#t-cards')).includes('Revisado'));
check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
