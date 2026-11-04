# Question bank schema (`pilotage-ai/bank@1`)

The bank is data, separate from the app. `tools/gen_bank.py` compiles it into the
glasses module (`PilotageAI/bank.rs`) and `PilotageAI/package.py` embeds the same JSON
in the phone companion, so both sides always agree on card IDs.

Top level: `schema`, `version` (bump on every content change), `title`, `notice`,
`subjects[] {key, pt, en}`, `sources[] {id, title, publisher, edition, official}`,
`rules[]`, `questions[]`, `oral[]`.

## questions[]
| field | required | notes |
|---|---|---|
| `id` | yes | unique, ASCII, <= 23 bytes |
| `subject` | yes | one of `subjects[].key` |
| `topic` | no | free text |
| `rule` | no | rule / subdivision group id (e.g. `"6"`); links to `rules[]` and rule practice |
| `ref` | yes | human citation, e.g. `RIPEAM Regra 6(b)(ii)` |
| `lang` | yes | `pt` or `en` |
| `difficulty` | yes | 1 fundamentals, 2 normative interpretation, 3 scenarios, 4 traps, 5 integrated |
| `question`, `options[2-5]`, `answer` | yes | `answer` = index of the correct option |
| `explanation` | yes | shown on the glasses; should say why each distractor is wrong |
| `distractors[]` | no | per-option notes (phone only) |
| `status` | yes | `verified` (checked against the cited edition by a qualified reviewer), `reviewed` (author-written from the cited rule; edition check pending), `ai_generated`, `unverified` |
| `source` | yes | id from `sources[]` (bundled) or `{title, edition, section}` (imports) |
| `fig` | no | glasses diagram: `L:` all-round lights top-to-bottom (`W R G Y`), `S:` day shapes (`B` ball, `D` diamond, `C` cylinder, `U`/`N` cone apex up/down, `X` two cones apex-to-apex) |
| `tags[]`, `version` | no | |

Glasses constraints, enforced by the generator and by the companion importer:
text must use ASCII or Latin accented letters (the glasses font), and the question
plus options must fit one 640x480 screen (checked with the firmware glyph widths).

## rules[]
`{id, title, body}` - paraphrased study summaries. They are **not** the normative
text; import the exact wording only from an authorized edition.

## oral[]
`{id, rule, prompt, reference, keypoints[{label, all:[[alternatives...]...]}], misconceptions[{label, any:[...]}]}`.
A key point is covered when every group has at least one alternative present in the
transcript (accent/case-insensitive).
