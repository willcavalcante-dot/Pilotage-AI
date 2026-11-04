# RIPEAM Tutor (Mira glasses)

Minimal spoken quiz for the Praticagem 2027 exam: random open RIPEAM/COLREG question →
answer by voice → AI evaluation → Result / Correction / Reference → Next Question.

**Install file: [`dist/RIPEAMTutor.html`](../dist/RIPEAMTutor.html)** —
Mira app: **Apps → Create an app → Upload/Paste → Check code → Add → Install → Open**.

## Use
- **Tap**: Speak Answer → (speak) → Send Answer → read result → Next Question.
- **Swipe**: scroll the correction. **Long press**: skip question / cancel recording.
- **Double tap**: Mira sidebar (not overridden).

## AI setup (on the iPhone, in the app's phone screen)
- **Meu servidor (recommended)**: run `backend/` (`npm install && ANTHROPIC_API_KEY=... npm start` behind HTTPS) and paste its URL. The key stays on your server.
- **Chave neste iPhone**: paste an Anthropic API key; it is kept only in the Mira app's storage on your phone (never in the app file) and sent only to `api.anthropic.com`. Use a dedicated key with a spending limit.
- **Desligada**: the glasses show "Result: Not verified" plus the full reference answer and citation.

## How evaluation works
- Speech → text: the documented Mira transcription service (0x0001/0x0002/0x0003), started only by your tap.
- Text → verdict: `claude-opus-5-5` with a JSON schema, judged **only against the bundled reference answer** for that question; PT/EN terms treated as equivalent; reports what you got right, what you missed (including details), what contradicts the reference, and anything it cannot verify. Server-side refusal fallback (`fallbacks: "default"`) is enabled.
- The **Reference** line always comes from the bank, never from the AI. If the AI is off, fails or times out (60 s), the result says **Not verified**.
- Incorrect answers return after 3 questions, partial ones after 5; unseen and previously missed questions are favoured.

## Content
44 open questions (levels 1–5): definitions (Rule 3), look-out, safe speed, risk of collision, manoeuvres, narrow channels, TSS, overtaking/head-on/crossing, sailing vessels, stand-on duties, responsibilities, restricted visibility, lights, shapes, sound signals and integrated scenarios. Reference answers are the author's paraphrase of the COLREG/RIPEAM text with exact rule/subsection citations, marked as author-reviewed — **confirm against the current official RIPEAM-72 edition**. Edit `questions.json` and rebuild with `python3 RipeamTutor/package.py`.

## Validation
- Official `validate.py`: PASS (WASM 53 KB, memory initial = max = 64 KiB).
- `node tests/tutor-e2e.mjs`: 29/29 in an emulated Mira host with the real companion (question display, capture, answer delivery, no-AI/partial/incorrect/AI-failure results, revisits, cancel/skip, no-phone message, transcription stopped on app close, API key never in request body).
- **Not tested on physical glasses** (no hardware here): real transcription quality and timing, gesture mapping, double tap → sidebar → Home, and whether the phone allows the direct API call (backend mode avoids that dependency).

## Limitations
- No text-to-speech: the documented SDK has no TTS for apps, so questions are read on screen.
- Transcription language follows the phone's Mira settings.
- Session memory (missed questions) resets when the app is closed; no history by design.
