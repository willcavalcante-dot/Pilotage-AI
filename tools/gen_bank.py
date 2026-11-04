#!/usr/bin/env python3
"""Generate PilotageAI/bank.rs from bank/*.json and check glasses layout.

The glasses use the same wrap algorithm (PilotageAI/ui.rs::wrap) and the
SDK glyph advance tables, so a question that passes here is not clipped."""
from pathlib import Path
import json, sys

ROOT = Path(__file__).resolve().parent.parent
ADV18 = [6,7,8,15,11,17,13,4,7,7,9,15,6,7,6,6,11,11,11,11,11,11,11,11,11,11,6,6,15,15,15,10,18,12,12,13,14,11,10,14,14,6,6,12,10,16,14,14,11,14,13,11,12,14,12,19,13,12,13,7,6,7,15,9,9,10,11,9,11,11,6,11,11,5,5,10,5,17,11,11,11,11,8,8,7,11,11,16,11,11,9,11,6,11,15]
ADV24 = [6,7,8,15,13,19,17,4,8,8,12,14,5,7,5,8,15,10,13,12,15,14,14,13,14,14,7,7,14,14,14,12,24,16,15,15,17,14,13,17,18,6,11,15,13,21,18,18,15,18,16,14,14,18,16,24,15,14,15,8,8,8,14,8,6,13,15,12,15,13,9,14,13,5,6,12,4,22,14,14,15,14,9,11,10,14,13,20,12,13,12,8,6,8,14]
ADV32 = [8,8,10,19,18,25,22,6,10,10,17,18,7,11,7,10,19,12,17,17,19,18,19,18,20,18,7,7,18,18,18,15,31,22,20,20,22,17,17,22,23,7,15,20,16,27,23,23,19,23,20,18,18,23,21,32,20,20,20,11,10,10,18,10,8,18,19,16,19,18,11,19,19,7,7,16,7,29,19,18,19,19,11,14,12,19,17,27,16,17,16,10,8,11,18]
F24, F18, F32 = 0, 1, 2
LH = {F18: 22, F24: 28, F32: 38}
# Layout constants mirrored in PilotageAI/pilotage.rs
BODY_Y, BOTTOM = 74, 444
SUBJECTS = ["ripeam", "arte", "nav", "manobra", "meteo", "normam", "conv"]
STATUS = {"verified": "v", "reviewed": "r", "ai_generated": "a", "unverified": "u"}
ALLOWED = {10} | set(range(32, 127)) | set("áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ".encode('utf-8'))

def adv(b, font):
    if b >= 0x80:
        return {F18: 11, F32: 19}.get(font, 14) if b >= 0xC0 else 0
    if b < 32:
        return 0
    return (ADV18 if font == F18 else ADV32 if font == F32 else ADV24)[b - 32]

def wrap(s, font, w):
    lines, i, n = [], 0, len(s)
    while i < n:
        while i < n and s[i] == 32: i += 1
        if i >= n: break
        start, width, space = i, 0, 0
        while True:
            if i >= n: end = i; break
            b = s[i]
            if b == 10: end = i; i += 1; break
            if b == 32: space = i
            a = adv(b, font)
            if width + a > w and i > start:
                if space > start: end = space; i = space + 1
                else: end = i
                break
            width += a; i += 1
        e = end
        while e > start and s[e-1] == 32: e -= 1
        lines.append(s[start:e])
    return lines

def question_fits(q, opts, fig):
    tx, tw = (170, 446) if fig else (24, 592)
    ow = tw - 52
    oh = sum(min(len(wrap(o, F18, ow)), 3) * 22 + 10 for o in opts)
    over3 = [o for o in opts if len(wrap(o, F18, ow)) > 3]
    for font in (F24, F18):
        h = BODY_Y + len(wrap(q, font, tw)) * LH[font] + 8 + oh
        if h <= BOTTOM and not over3:
            return font
    return None

def check_text(label, s):
    bad = [c for c in s if c not in ALLOWED]
    if bad: raise SystemExit(f"{label}: unsupported glyph bytes {bytes(bad)!r} (use ASCII or Latin accented letters)")

def lit(b):
    out = []
    for c in b:
        if c == 0: out.append('\\0')
        elif c in (34, 92): out.append('\\' + chr(c))
        elif 32 <= c < 127: out.append(chr(c))
        else: out.append('\\x%02x' % c)
    return 'b"' + ''.join(out) + '"'

def blob(records):
    data, offs = bytearray(), [0]
    for fields in records:
        data += b'\0'.join(fields); offs.append(len(data))
    if len(data) > 65535: raise SystemExit('blob too large for u16 offsets')
    return bytes(data), offs

def main():
    bank = json.loads((ROOT/'bank'/'starter.json').read_text(encoding='utf-8'))
    qrec, ids, fonts = [], set(), {}
    for q in bank['questions']:
        qid = q['id']
        if qid in ids: raise SystemExit('duplicate id '+qid)
        ids.add(qid)
        if len(qid.encode()) > 23: raise SystemExit(qid+': id longer than 23 bytes')
        opts = [o.encode() for o in q['options']]
        if not 2 <= len(opts) <= 5: raise SystemExit(qid+': 2-5 options')
        if not 0 <= q['answer'] < len(opts): raise SystemExit(qid+': answer index')
        if not 1 <= q['difficulty'] <= 5: raise SystemExit(qid+': difficulty 1-5')
        fields = [qid.encode(), str(SUBJECTS.index(q['subject'])).encode(), str(q['difficulty']).encode(),
                  b'e' if q['lang'] == 'en' else b'p', STATUS[q['status']].encode(), str(q['answer']).encode(),
                  q.get('rule', '').encode(), q.get('fig', '').encode(), q['question'].encode(),
                  q['explanation'].encode(), q['ref'].encode()] + opts
        for k, f in enumerate(fields): check_text(f'{qid} field {k}', f)
        font = question_fits(fields[8], opts, bool(q.get('fig')))
        if font is None: raise SystemExit(qid+': question/options do not fit the glasses screen; shorten them')
        fonts[qid] = font
        qrec.append(fields)
    rrec = []
    for r in bank['rules']:
        f = [r['id'].encode(), r['title'].encode(), r['body'].encode()]
        for k, x in enumerate(f): check_text('rule '+r['id'], x)
        rrec.append(f)
    orec = []
    for o in bank['oral']:
        f = [o['id'].encode(), o['rule'].encode(), o['prompt'].encode(), o['reference'].encode()]
        for x in f: check_text('oral '+o['id'], x)
        orec.append(f)
    qb, qo = blob(qrec); rb, ro = blob(rrec); ob, oo = blob(orec)
    subj_pt = ', '.join(json.dumps(s['pt'], ensure_ascii=False) for s in bank['subjects'])
    subj_en = ', '.join(json.dumps(s['en'], ensure_ascii=False) for s in bank['subjects'])
    src = f"""// GENERATED by tools/gen_bank.py from bank/starter.json - do not edit.
// Record fields are NUL-separated: id, subject, difficulty, lang, status, answer,
// rule, fig, question, explanation, reference, options...
#![allow(dead_code)]
pub const VERSION: &str = {json.dumps(bank['version'])};
pub const N: usize = {len(qrec)};
pub static BLOB: &[u8] = {lit(qb)};
pub static QOFF: [u16; {len(qo)}] = {qo};
pub const R: usize = {len(rrec)};
pub static RBLOB: &[u8] = {lit(rb)};
pub static ROFF: [u16; {len(ro)}] = {ro};
pub const O: usize = {len(orec)};
pub static OBLOB: &[u8] = {lit(ob)};
pub static OOFF: [u16; {len(oo)}] = {oo};
pub static SUBJ_PT: [&str; 7] = [{subj_pt}];
pub static SUBJ_EN: [&str; 7] = [{subj_en}];
"""
    (ROOT/'PilotageAI'/'bank.rs').write_text(src, encoding='utf-8')
    print(f"bank {bank['version']}: {len(qrec)} questions ({len(qb)} B), {len(rrec)} rules ({len(rb)} B), {len(orec)} oral ({len(ob)} B); "
          f"{sum(1 for f in fonts.values() if f == F18)} questions use the 18 px fallback")

if __name__ == '__main__':
    main()
