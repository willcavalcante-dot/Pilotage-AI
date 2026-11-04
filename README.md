# Mira apps for the Praticagem 2027 exam

| App | Install file | What it is |
|---|---|---|
| **RIPEAM Tutor** | [`dist/RIPEAMTutor.html`](dist/RIPEAMTutor.html) | Minimal spoken open-answer quiz with AI evaluation — see [`RipeamTutor/README.md`](RipeamTutor/README.md) |
| **Pilotage AI** | [`dist/PilotageAI.html`](dist/PilotageAI.html) | Full study assistant (quiz, flashcards, simulator, rule explorer) — below |

# Pilotage AI — Mira smart-glasses study assistant (PSCPP 2027)

Hands-free, bilingual (PT-BR / Maritime English) study tutor for the Brazilian
maritime pilot trainee exam (Processo Seletivo à Categoria de Praticante de Prático).
Rust/WebAssembly on the glasses + HTML/JS companion on the iPhone, delivered as one
validated Mira package.

**Install file: [`dist/PilotageAI.html`](dist/PilotageAI.html)** (216 KB, WASM 88 KB, 1×64 KiB memory page).

In the Mira app: **Apps → Create an app → Upload/Paste → Check code → Add → Install → Open**.
Updating: long-press the app card → **Edit App → Upload → Save → Update → Open**.

> Study tool only. Not for real navigation or collision avoidance.

## What it does

**Glasses (works offline with the bundled bank)**
- Main menu: Revisão rápida · Flashcards adaptativos · Simulado · Explorador de regras · Exame oral · Luzes e marcas · Meu progresso.
- Subject selection with per-subject counts; empty subjects say so (e.g. NORMAM) instead of inventing content.
- Multiple choice (2–5 options, shuffled), immediate feedback: CORRETO/INCORRETO, correct answer, your choice, explanation (covers distractors), citation and a **verification status note**.
- Flashcards with Again / Hard / Good / Easy; "Again" re-inserts the card later in the session.
- Simulator: 20 questions, 30 min, level filter (1–2, 3, 4–5), no per-question feedback, review of mistakes at the end.
- Session header: mode, subject, `n/N`, accuracy, countdown; timer pauses while the Casa sidebar/overlays cover the app. Summary with weakest topic and a suggested next step.
- Rule explorer (15 COLREG/RIPEAM rules, Rule 6 with every subdivision (a)(i)–(vi), (b)(i)–(vi)), EN terms, exam traps → "practise this rule".
- Lights & shapes ("memory palace"): vessel light stacks and day shapes drawn on the glasses (colours lettered, since the display is grayscale).
- Oral exam: explicit tap to record, blinking **GRAVANDO** indicator, live transcript via the documented Mira transcription service (0x0001–0x0003), auto-stop at 2 min / on leaving / on app close; evaluation done on the iPhone; reference answer available offline for self-assessment.
- Results are queued on the glasses and delivered with sequence numbers + acknowledgement when the phone is reachable; "offline" indicator from the local BLE flag.

**iPhone companion**
- Dashboard: accuracy (overall, by subject, weakest/strongest topics), reviews, study time, streak, due cards, daily goal, recent sessions. Only real recorded answers — no fake history.
- Session launcher: 5-min quick review, 10-min flashcards, 15-min advanced (level ≥3), 30-min exam, custom.
- Review calendar (14 days) and overdue list; card manager (suspend, reset, details with distractor notes and sources).
- JSON import with validation, glyph and screen-fit checks; up to 24 imported questions pushed to the glasses (marked by status; AI-generated/unverified flagged).
- Backup export/restore, language mode (PT / EN / mixed), sources & coverage page, privacy notes.
- Scheduler: **simplified SM-2 (Anki-style), explicitly not FSRS** (`companion/srs.js`). Glasses priorities favour overdue cards, repeated errors, weak topics (<60%) and never-seen cards; mastered cards rest.
- Oral evaluation: offline keyword coverage of reference key points (labelled as *not* semantic understanding); optional user-run AI backend (`backend/`) with server-side key and grounding in retrieved rule text.

## Content status — read this
The starter bank (52 MCQs, 15 rule summaries, 5 oral prompts) was written from the cited
COLREG/RIPEAM rules and standard doctrine and is marked `reviewed` = author-reviewed,
**not yet checked against the current official edition**. Rule summaries are paraphrases.
NORMAM has no bundled questions on purpose (structure changed recently; import from the
current edition). The subject list is not the official syllabus — confirm with the PSCPP
2027 edital. See `bank/SCHEMA.md` for the format and status levels.

## Build & test
Requires Rust with `wasm32-unknown-unknown`, Python 3, Node.js (+ Playwright for e2e).
```sh
rustup target add wasm32-unknown-unknown
python3 PilotageAI/package.py            # gen bank -> compile (SDK flags) -> inline companion -> validate
python3 CompanionExample/validate.py dist/PilotageAI.html
node tests/unit.mjs                      # scheduler, oral evaluator, layout mirror (19 checks)
node tests/e2e.mjs                       # final HTML in Chromium with an emulated Mira host (60 checks, screenshots in dist/screens)
```
Layout: `PilotageAI/` glasses app (`pilotage.rs`, `ui.rs`, `json.rs`, generated `bank.rs`) ·
`companion/` phone UI · `bank/` content · `tools/gen_bank.py` · `Shared/`, `CompanionExample/`,
`SDK-ABI.json` = unchanged files extracted from the Mira SDK guide (only those needed to build) ·
`backend/` optional evaluator · `tests/`.

## Validation status
| Check | Status |
|---|---|
| Compiles with the SDK's exact flags; memory initial = max = 64 KiB, 8 KiB stack | ✅ |
| Official `validate.py` (ABI, exports, memory, JS syntax, WASM engine) | ✅ PASS |
| Software e2e: render, menu, subjects, answering, correct/incorrect feedback, flashcards, simulator, diagrams, rule explorer, oral capture + evaluation, phone↔glasses messaging, persistence, disconnect/reconnect queueing, phone-started sessions, imported deck, language toggle, app_stop releases transcription | ✅ 60/60 in an emulated host |
| On physical Mira glasses (startup, gestures, double tap → sidebar → Home, real transcription, BLE timing, readability) | ⚠️ **Not tested — no hardware was available.** |

The emulator implements the companion protocol as `Shared/companion.rs` expects it; the
real phone host may differ in timing. Unknowns to verify on device: exact shape of the
0x0003 transcription snapshot (handled both as segments and cumulative text), whether
long-press arrives as event 9 or 10 (both handled, debounced), status-bar overlap at the top.

## Controls (glasses)
Swipe = move selection / scroll · Tap = select / answer / next · Long press = back, end
session, or show explanation (on the flashcard back) · Double tap = Mira sidebar (not overridden).
Every action is also reachable by swipe + tap.

## Known limitations
- Glasses memory is 64 KiB: bundled bank is compiled in (~33 KB); imported content is limited to 24 questions per push; progress persists on the phone (glasses state resets on app switch; unsent offline answers are lost if the app is closed before reconnecting — the progress screen shows the pending count).
- Grayscale display: navy/cyan theme applies to the phone only; light colours are lettered.
- No exact normative text bundled; no official past exams bundled.
- Retention estimate not shown (SM-2 does not model it).
- Rules/oral prompts are not importable yet (questions are).

## Roadmap
1. Verify the starter bank against the current RIPEAM-72 edition and the PSCPP 2027 edital; promote items to `verified`.
2. FSRS scheduler with retention estimates and parameter fitting on the student's history.
3. Import of rules, oral prompts and diagrams; versioned bank sync with diff/rollback.
4. Retrieval over an authorized corpus (RIPEAM, NORMAM, conventions) for grounded AI explanations and question generation, always tagged `ai_generated` until reviewed.
5. Richer diagrams on the phone (sectors, towing configurations, relative positions) with simplified glasses versions.
6. Device-tested tuning: font sizes, timings, hold gestures, battery impact.
