// Optional Pilotage AI backend: grades an oral answer against the reference
// answer and the rule text retrieved from the verified bank (sent by the
// companion). The API key lives only here (ANTHROPIC_API_KEY or `ant auth login`).
// Run behind HTTPS (reverse proxy / platform TLS); the companion requires https://.
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { createRequire } from 'node:module';
// RIPEAM Tutor: same prompt, schema and parser as the phone's direct mode.
const RT = createRequire(import.meta.url)('../RipeamTutor/companion/grade.js');

const client = new Anthropic();
const PORT = Number(process.env.PORT || 8787);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const TOKEN = process.env.PILOTAGE_TOKEN || ''; // optional shared secret checked in X-Pilotage-Token

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'missing', 'incorrect', 'feedback'],
  properties: {
    score: { type: 'integer', description: '0-100: coverage and correctness versus the reference' },
    missing: { type: 'array', items: { type: 'string' }, description: 'Reference points the answer omitted' },
    incorrect: { type: 'array', items: { type: 'string' }, description: 'Statements in the answer that contradict the reference or rule text' },
    feedback: { type: 'string', description: 'At most 150 characters, in the requested language' },
  },
};

const SYSTEM = `You grade oral answers for the Brazilian maritime pilot exam (PSCPP).
Judge ONLY against the reference answer and the retrieved rule text supplied in the request.
Never introduce rule content, numbers or citations that are not in those sources; if the answer
mentions something the sources do not cover, say it cannot be verified rather than judging it.
The transcript comes from speech recognition and may contain recognition errors: do not penalise
obvious mis-hearings of the same word. Pay attention to shall/may, numeric limits and vessel categories.`;

async function grade(body) {
  const sources = [
    `QUESTION:\n${body.prompt}`,
    `REFERENCE ANSWER:\n${body.reference}`,
    `KEY POINTS:\n- ${(body.keypoints || []).join('\n- ')}`,
    ...(body.retrieved || []).map((r) => `RETRIEVED RULE ${r.id} - ${r.title}:\n${r.body}`),
    `STUDENT TRANSCRIPT:\n${body.transcript}`,
    `Respond in ${body.lang === 'en' ? 'English' : 'Brazilian Portuguese'}.`,
  ].join('\n\n');
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system: SYSTEM,
    messages: [{ role: 'user', content: sources }],
  });
  if (response.stop_reason === 'refusal') throw new Error('model declined the request');
  if (response.stop_reason === 'max_tokens') throw new Error('response truncated');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = JSON.parse(text);
  out.score = Math.max(0, Math.min(100, out.score | 0));
  out.feedback = String(out.feedback).slice(0, 160);
  return out;
}

async function gradeTutor(b) {
  const q = { q: b.question, a: b.reference, ref: b.citation, k: (b.essentials || []).map((e) => [String(e)]) };
  const response = await client.beta.messages.create({ ...RT.requestBody(q, b.transcript), betas: ['server-side-fallback-2026-07-01'] });
  return RT.parseMessage(response);
}

function validTutor(b) {
  return b && b.task === 'ripeam_tutor_grade' && typeof b.question === 'string' && typeof b.reference === 'string'
    && typeof b.transcript === 'string' && b.transcript.length <= 4000 && b.reference.length <= 4000;
}

function valid(b) {
  return b && b.task === 'evaluate_oral' && typeof b.prompt === 'string' && typeof b.reference === 'string'
    && typeof b.transcript === 'string' && b.transcript.length <= 4000 && b.reference.length <= 4000;
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Pilotage-Token');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  if (TOKEN && req.headers['x-pilotage-token'] !== TOKEN) { res.writeHead(401).end(); return; }
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 32_000) { res.writeHead(413).end(); return; } }
  let body;
  try { body = JSON.parse(raw); } catch { res.writeHead(400).end('bad json'); return; }
  if (!valid(body) && !validTutor(body)) { res.writeHead(400).end('invalid request'); return; }
  try {
    const result = validTutor(body) ? await gradeTutor(body) : await grade(body);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  } catch (err) {
    console.error(err);
    res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'evaluation unavailable' }));
  }
}).listen(PORT, () => console.log(`Pilotage AI evaluator on :${PORT}`));
