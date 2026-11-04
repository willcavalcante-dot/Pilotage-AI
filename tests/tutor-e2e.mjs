// End-to-end software test of dist/RIPEAMTutor.html (emulated Mira host + real companion).
import { createRequire } from 'module';
import { readFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(process.argv[2] || path.join(here, '..', 'dist', 'RIPEAMTutor.html'));
const shots = path.resolve(process.argv[3] || path.join(here, '..', 'dist', 'tutor-screens'));
mkdirSync(shots, { recursive: true });
let passed = 0, failed = 0;
const check = (n, ok, d) => { ok ? passed++ : failed++; console.log((ok ? '  ok   ' : '  FAIL ') + n + (ok || !d ? '' : ' :: ' + d)); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript({ content: readFileSync(path.join(here, 'harness.js'), 'utf8') });
await page.goto('file://' + html);
await page.evaluate(() => window.__glasses.boot());
const G = (f, a) => page.evaluate(f, a);
const tick = async (n = 10) => { for (let i = 0; i < n; i++) await G(() => window.__glasses.tick(2)); };
const ev = async e => { await G(e => window.__glasses.event(e), e); await tick(2); };
const lp = async () => { await tick(14); await ev(9); };
const texts = () => G(() => window.__glasses.texts());
const has = async s => (await texts()).some(t => t.includes(s));
const current = () => G(() => { const t = window.__glasses.texts().join(' '); return window.RT_BANK.questions.find(q => t.includes(q.q.slice(0, 40))) || null; });
async function shot(name) {
  await G(() => { let c = document.getElementById('__g'); if (!c) { c = document.createElement('canvas'); c.id = '__g'; c.width = 640; c.height = 480; c.style.cssText = 'position:fixed;left:0;top:0;z-index:99'; document.body.appendChild(c); } c.style.display = 'block'; window.__glasses.draw(c); });
  await page.setViewportSize({ width: 640, height: 480 });
  await page.screenshot({ path: path.join(shots, name + '.png'), clip: { x: 0, y: 0, width: 640, height: 480 } });
  await G(() => { document.getElementById('__g').style.display = 'none'; });
  await page.setViewportSize({ width: 390, height: 844 });
}
async function speak(text) {
  await G(t => { window.__glasses.transcript = [{ fin: 0, text: t.slice(0, 20) }, { fin: 1, text: t }]; }, text);
  await ev(0); await tick(20); await ev(0); await tick(30); await page.waitForTimeout(50); await tick(20);
}
const fakeAI = r => G(r => { window.__fetchCalls = []; window.fetch = async (url, opts) => { window.__fetchCalls.push({ url, opts }); if (r === 'fail') throw new Error('network down');
  return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(r) }], stop_reason: 'end_turn' }), { status: 200 }); }; }, r);

console.log('RIPEAM Tutor e2e: ' + html);
await tick(40);
check('one 64 KiB memory page', await G(() => window.__glasses.memPages) === 1);
check('question screen: title, Question:, Speak Answer', await has('RIPEAM TUTOR') && await has('Question:') && await has('Speak Answer'));
let q = await current();
check('question comes from the bank', !!q);
check('glasses warn when AI is not configured', await has('Configure a IA'));
await shot('01-question');

// 1) No AI configured: honest "not verified" with full reference answer and bank citation.
await speak('Duas luzes encarnadas em linha vertical');
check('transcription start/stop requested', await G(() => window.__glasses.started >= 1 && window.__glasses.stopped >= 1));
check('answer sent to companion with question id', await G(id => window.__glasses.fromApp.some(m => m.type === 'answer' && m.id === id && m.text.includes('encarnadas')), q.id));
check('result without AI is "Not verified"', await has('Result: Not verified'));
check('correction includes full reference answer', (await texts()).some(t => t.includes('Resposta completa')));
check('reference is the bank citation', (await texts()).some(t => t === 'Reference: ' + q.ref || t.startsWith('Reference: ' + q.ref.slice(0, 10))));
check('Next Question button', await has('Next Question'));
await shot('02-not-verified');
await ev(0);
check('next question shown', await has('Speak Answer'));

// 2) AI configured (direct key on phone): partial verdict with missed details.
await page.selectOption('#mode', 'key');
await page.fill('#key', 'sk-ant-test-key'); await page.dispatchEvent('#key', 'change');
await fakeAI({ verdict: 'partial', right: ['Identificou as duas luzes encarnadas'], missed: ['Com seguimento: luzes de bordo e alcançado'], wrong: [], unverifiable: [], comment: 'Boa base, faltou um detalhe.' });
await tick(30);
check('glasses learn AI is configured', !(await has('Configure a IA')));
q = await current();
await speak('Resposta falada de teste sobre a regra');
const call = await G(() => window.__fetchCalls[0]);
check('AI request sent to Anthropic Messages API', call && call.url === 'https://api.anthropic.com/v1/messages');
const body = call ? JSON.parse(call.opts.body) : {};
check('request: claude-opus-5-5 + JSON schema output', body.model === 'claude-opus-5-5' && body.output_config && body.output_config.format.type === 'json_schema');
check('request carries the bank reference answer and transcript', body.messages && body.messages[0].content.includes(q.a.slice(0, 60)) && body.messages[0].content.includes('Resposta falada'));
check('key sent only as API header, not in body', call && call.opts.headers['x-api-key'] === 'sk-ant-test-key' && !call.opts.body.includes('sk-ant-test-key'));
check('partial verdict shown', await has('Result: Partial'));
check('missed details shown', (await texts()).some(t => t.includes('Faltou')) || (await texts()).some(t => t.includes('luzes de bordo')));
await shot('03-partial');

// 3) Incorrect answers come back sooner.
await ev(0);
q = await current();
await fakeAI({ verdict: 'incorrect', right: [], missed: ['Elemento essencial'], wrong: ['Afirmou o contrário da referência'], unverifiable: [], comment: 'Incorreto.' });
await speak('resposta errada');
check('incorrect verdict shown', await has('Result: Incorrect') && (await texts()).some(t => t.includes('Incorreto')));
await shot('04-incorrect');
await ev(0); await lp(); await lp();
const back = await current();
check('missed question revisited after 3 questions', back && back.id === q.id, (back && back.id) + ' vs ' + q.id);
check('revisit is marked', await has('revisão'));

// 4) AI failure: says it could not verify.
await fakeAI('fail');
await speak('qualquer resposta');
check('AI failure -> Not verified with explanation', await has('Result: Not verified') && (await texts()).some(t => t.includes('falhou')));
await ev(0);

// 5) Nothing heard, cancel, no phone link, app close.
await G(() => { window.__glasses.transcript = [{ fin: 0, text: '' }]; }); await ev(0); await tick(10); await ev(0); await tick(4);
check('nothing heard -> prompt to retry', await has('Nada foi captado'));
await G(() => { window.__glasses.transcript = [{ fin: 0, text: 'abc' }]; }); await ev(0); await tick(6);
check('listening indicator', (await texts()).some(t => t.startsWith('Listening')));
await shot('05-listening');
await lp();
check('long press cancels recording', await has('Speak Answer') && !(await texts()).some(t => t.startsWith('Listening')));
await ev(0); await tick(4);
const s0 = await G(() => window.__glasses.stopped);
await G(() => window.__glasses.stop());
check('app_stop stops transcription', await G(s => window.__glasses.stopped > s, s0));
await G(() => window.__glasses.boot()); await tick(30);
await G(() => { window.__glasses.ble = false; }); await tick(30); await ev(0);
check('no phone link -> clear message', await has('Sem conexão com o iPhone'));
await G(() => { window.__glasses.ble = true; }); await tick(30);
await lp();
check('long press skips to another question', await has('Speak Answer'));
await page.screenshot({ path: path.join(shots, 'phone.png'), fullPage: true });
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
