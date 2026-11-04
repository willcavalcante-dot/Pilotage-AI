# Pilotage AI - optional AI evaluator

The glasses app and the iPhone companion work fully without this. Enable it only
if you want semantic grading of oral answers (Companion -> Oral -> "IA opcional").

* Secrets stay here: set `ANTHROPIC_API_KEY` (or run `ant auth login`). Nothing
  secret is ever embedded in the installable HTML.
* Grounding: the companion sends the question, the reference answer, the key
  points and the rule summary retrieved from the bank; the system prompt forbids
  introducing provisions that are not in those sources.
* Output: structured JSON `{score, missing[], incorrect[], feedback}` enforced by
  `output_config.format` (JSON Schema).
* Model: `claude-opus-5-5`, with server-side refusal fallback (`fallbacks: "default"`)
  enabled; remove those two lines if you do not want it.
* Serve over HTTPS (reverse proxy or a platform with TLS). Optionally set
  `PILOTAGE_TOKEN` and restrict `ALLOW_ORIGIN`. (The companion does not send the
  token yet - add it in `companion/app.js` if you enable it.)

```sh
cd backend && npm install && ANTHROPIC_API_KEY=... npm start
```

Request (POST, JSON): `{task:"evaluate_oral", prompt, reference, keypoints[], retrieved[{id,title,body}], transcript, lang}`.
If the backend fails or times out (15 s), the companion falls back to the offline keyword check.
