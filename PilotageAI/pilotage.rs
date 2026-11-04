//! Pilotage AI - adaptive PSCPP study assistant for Mira glasses.
//! Glasses: menus, quiz, flashcards, simulator, rule explorer, signal diagrams,
//! oral practice capture. Phone companion: SRS scheduling, persistence,
//! analytics, imports and oral evaluation. Everything here works offline with
//! the bundled bank; results are queued and delivered when the phone returns.
#![no_std]
#![allow(static_mut_refs)]
#[path = "../Shared/companion.rs"] mod companion;
#[path = "../Shared/content.rs"] mod content;
mod bank;
mod json;
mod ui;
use ui::*;

// Anchor icon for the Casa sidebar.
app_icon!(content::app_icon::Icon::new()
    .circle(16, 6, 4).line(16, 10, 16, 28).line(9, 14, 23, 14)
    .line(5, 20, 16, 28).line(27, 20, 16, 28).line(5, 20, 5, 17).line(27, 20, 27, 17).0);

#[link(wasm_import_module = "mira")]
extern "C" {
    fn now_ms() -> i32;
    fn device_status(out: *mut u8, cap: i32) -> i32;
    fn ble_request(method: i32, payload: *const u8, len: i32) -> i32;
    fn ble_response_len(id: i32) -> i32;
    fn ble_response_read(id: i32, out: *mut u8, cap: i32) -> i32;
    fn ble_send(method: i32, payload: *const u8, len: i32) -> i32;
}
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! { loop {} }

const APP: &[u8] = b"Pilotage AI";
const HEAD_Y: i32 = 44;
const BODY_Y: i32 = 74;
const BOTTOM: i32 = 444;
const FOOT_Y: i32 = 452;

#[derive(Clone, Copy, PartialEq)]
enum S { Menu, Subject, Level, Quest, Feedback, Front, Back, Page, Summary, Rules, Orals, Oral, Progress }

const M_QUICK: u8 = 0; const M_CARDS: u8 = 1; const M_EXAM: u8 = 2; const M_FIG: u8 = 3; const M_RULE: u8 = 4;
const ALL: u8 = 255; const PHONE: u8 = 254;
// Record field indices (see tools/gen_bank.py).
const F_ID: usize = 0; const F_SUBJ: usize = 1; const F_DIFF: usize = 2; const F_LANG: usize = 3; const F_STAT: usize = 4;
const F_ANS: usize = 5; const F_RULE: usize = 6; const F_FIG: usize = 7; const F_Q: usize = 8; const F_EXP: usize = 9;
const F_REF: usize = 10; const F_OPT: usize = 11;

static mut BRIDGE: companion::Companion<2304, 960> = companion::Companion::new(APP);
static mut OUT: json::W<960> = json::W::new();

// Screen state
static mut SCR: S = S::Menu;
static mut SEL: usize = 0;
static mut TOP: usize = 0;
static mut SCROLL: usize = 0;
static mut VIS: usize = 1;
static mut DIRTY: bool = true;
static mut CLOCK: u32 = 0;
static mut SINCE_DRAW: u32 = 0;
static mut LANG: u8 = 0; // 0 PT, 1 EN, 2 mixed content
static mut LANG_SET: bool = false; // changed on the glasses during this run
static mut SEED: u32 = 1;
static mut BLE: bool = false;
static mut STATUS_MS: u32 = 10_000;
static mut LAST_RX: u32 = 0;
static mut RX_EVER: bool = false;
static mut LAST_LONG: u32 = 0;
static mut LONG_EVER: bool = false;
static mut MODE: u8 = 0;
static mut PICK_SUBJ: u8 = ALL;
static mut RULE_ID: [u8; 8] = [0; 8];
static mut RULE_LEN: usize = 0;

// Session
const QMAX: usize = 40;
static mut Q: [u16; QMAX] = [0; QMAX];
static mut ANS: [u8; QMAX] = [255; QMAX];
static mut QN: usize = 0;
static mut QPOS: usize = 0;
static mut OKS: u32 = 0;
static mut BAD: u32 = 0;
static mut LIMIT: u32 = 0;
static mut SPENT: u32 = 0;
static mut QMS: u32 = 0;
static mut PERM: [u8; 5] = [0, 1, 2, 3, 4];
static mut NOPT: usize = 0;
static mut SUBJ: u8 = ALL;
static mut AGAIN: u8 = 0;
static mut ACTIVE: bool = false;
static mut REVIEW: bool = false;
static mut RV: usize = 0;
static mut LAST: (u8, u8, u8, usize, u32) = (0, ALL, 0, 10, 5);
static mut TITLE: [u8; 64] = [0; 64];
static mut TLEN: usize = 0;
static mut RUN_OK: u32 = 0;
static mut RUN_BAD: u32 = 0;
static mut WRONG: [u8; bank::N] = [0; bank::N];
static mut PRIO: [u8; bank::N] = [5; bank::N];
static mut DECK_DEFER: bool = false;

// Text page
static mut PAGE: [u8; 1536] = [0; 1536];
static mut PLEN: usize = 0;
static mut PL: [(u16, u16); 80] = [(0, 0); 80];
static mut PLN: usize = 0;
static mut PTITLE: [u8; 64] = [0; 64];
static mut PTLEN: usize = 0;
static mut PRET: S = S::Menu;
static mut PRACTICE: bool = false;

// List labels
static mut LBL: [[u8; 48]; 20] = [[0; 48]; 20];
static mut LBN: [u8; 20] = [0; 20];
static mut ACT: [u8; 20] = [0; 20];
static mut NITEMS: usize = 0;

// Phone-supplied deck: records separated by 0x1e, fields by 0x1f (-> NUL).
static mut DECK: [u8; 2048] = [0; 2048];
static mut DS: [u16; 24] = [0; 24];
static mut DE: [u16; 24] = [0; 24];
static mut DN: usize = 0;
static mut STATS: [u8; 360] = [0; 360];
static mut STLEN: usize = 0;

// Results waiting for the phone's acknowledgement.
#[derive(Clone, Copy)]
struct Res { seq: u32, ms: u32, id: [u8; 24], idn: u8, ok: u8, rating: u8, mode: u8 }
const RMAX: usize = 24;
static mut RES: [Res; RMAX] = [Res { seq: 0, ms: 0, id: [0; 24], idn: 0, ok: 0, rating: 0, mode: 0 }; RMAX];
static mut RHEAD: usize = 0;
static mut RCOUNT: usize = 0;
static mut NEXT_SEQ: u32 = 1;
static mut INFLIGHT: bool = false;
static mut SENT_AT: u32 = 0;
static mut DROPPED: u32 = 0;
static mut RUN: u32 = 1;
static mut HELLO: bool = true;
static mut DECK_OK: bool = false;
static mut SUM_PEND: bool = false;
static mut SUM: (u8, u8, u32, u32, u32) = (0, 0, 0, 0, 0);

// Oral practice (transcription via documented phone APIs 0x0001-0x0003).
static mut OI: usize = 0;
static mut OST: u8 = 0; // 0 idle, 1 recording, 2 stopped, 3 awaiting evaluation, 4 evaluated
static mut OERR: u8 = 0;
static mut REC_MS: u32 = 0;
static mut OWAIT: u32 = 0;
static mut SVC: i32 = 0;
static mut SVCK: u8 = 0;
static mut POLL: u32 = 0;
static mut STOP_ID: i32 = 0;
static mut ORAL_PEND: bool = false;
static mut OTXT: [u8; 600] = [0; 600];
static mut OTLEN: usize = 0;
static mut PART: [u8; 384] = [0; 384]; // raw 0x0003 reply: state, final, then text
static mut PARTN: usize = 0;         // live partial text length at PART[2..]
static mut ORES: [u8; 480] = [0; 480];
static mut ORESN: usize = 0;
static NOTHING: [u8; 1] = [0];

// ---------- helpers ----------
unsafe fn t(pt: &'static str, en: &'static str) -> &'static [u8] { if LANG == 1 { en.as_bytes() } else { pt.as_bytes() } }
unsafe fn rnd() -> u32 { SEED ^= SEED << 13; SEED ^= SEED >> 17; SEED ^= SEED << 5; SEED }
fn fld(x: &[u8], k: usize) -> &[u8] { x.split(|b| *b == 0).nth(k).unwrap_or(&[]) }
fn dig(f: &[u8]) -> u8 { if !f.is_empty() && f[0].is_ascii_digit() { f[0] - b'0' } else { 0 } }
fn nopts(x: &[u8]) -> usize { if x.is_empty() { 0 } else { x.split(|b| *b == 0).count().saturating_sub(F_OPT).min(5) } }
fn put(buf: &mut [u8], n: &mut usize, s: &[u8]) {
    let k = s.len().min(buf.len().saturating_sub(*n));
    let mut k2 = k;
    while k2 > 0 && k2 < s.len() && (s[k2] & 0xC0) == 0x80 { k2 -= 1; }
    buf[*n..*n + k2].copy_from_slice(&s[..k2]);
    *n += k2;
}
fn putn(buf: &mut [u8], n: &mut usize, mut v: u32) {
    let mut t = [0u8; 10];
    let mut k = 10;
    loop { k -= 1; t[k] = b'0' + (v % 10) as u8; v /= 10; if v == 0 { break; } }
    put(buf, n, &t[k..]);
}
fn pct(a: u32, b: u32) -> u32 { if b == 0 { 0 } else { a * 100 / b } }

unsafe fn rec(r: u16) -> &'static [u8] {
    if r & 0x8000 == 0 {
        let i = r as usize;
        if i >= bank::N { return &[]; }
        &bank::BLOB[bank::QOFF[i] as usize..bank::QOFF[i + 1] as usize]
    } else {
        let k = (r & 0x7fff) as usize;
        if k >= DN { return &[]; }
        &DECK[DS[k] as usize..DE[k] as usize]
    }
}
fn rrec(i: usize) -> &'static [u8] { &bank::RBLOB[bank::ROFF[i] as usize..bank::ROFF[i + 1] as usize] }
fn orec(i: usize) -> &'static [u8] { &bank::OBLOB[bank::OOFF[i] as usize..bank::OOFF[i + 1] as usize] }
unsafe fn subj_name(s: u8) -> &'static [u8] {
    match s {
        ALL => t("Todas", "All"),
        PHONE => b"iPhone",
        s if (s as usize) < 7 => if LANG == 1 { bank::SUBJ_EN[s as usize].as_bytes() } else { bank::SUBJ_PT[s as usize].as_bytes() },
        _ => b"?",
    }
}
unsafe fn mode_name(m: u8) -> &'static [u8] {
    match m {
        M_QUICK => t("Revisão rápida", "Quick review"),
        M_CARDS => t("Flashcards", "Flashcards"),
        M_EXAM => t("Simulado", "Exam simulator"),
        M_FIG => t("Luzes e marcas", "Lights & shapes"),
        M_RULE => t("Praticar regra", "Rule practice"),
        _ => t("Sessão do iPhone", "iPhone session"),
    }
}
unsafe fn online() -> bool { BLE && RX_EVER && CLOCK.wrapping_sub(LAST_RX) < 30_000 }

// ---------- selection ----------
unsafe fn eligible(r: u16, subj: u8, level: u8, fig: bool, rule: &[u8], any_lang: bool) -> bool {
    let x = rec(r);
    if x.is_empty() || nopts(x) < 2 { return false; }
    if subj == PHONE && r & 0x8000 == 0 { return false; }
    if subj < 200 && dig(fld(x, F_SUBJ)) != subj { return false; }
    if !any_lang {
        let l = fld(x, F_LANG);
        if LANG == 0 && l != b"p" { return false; }
        if LANG == 1 && l != b"e" { return false; }
    }
    let d = dig(fld(x, F_DIFF));
    let ok = match level { 0 => true, 1 => d <= 2, 2 => d == 3, 3 => d >= 4, m => d + 10 >= m };
    if !ok { return false; }
    if fig && fld(x, F_FIG).is_empty() { return false; }
    rule.is_empty() || fld(x, F_RULE) == rule
}
unsafe fn count(subj: u8) -> u32 {
    let mut n = 0;
    for i in 0..bank::N { if eligible(i as u16, subj, 0, false, &[], false) { n += 1; } }
    for k in 0..DN { if eligible(0x8000 | k as u16, subj, 0, false, &[], false) { n += 1; } }
    n
}

unsafe fn start(mode: u8, subj: u8, level: u8, want: usize, minutes: u32) -> bool {
    let mut rule = [0u8; 8];
    let rl = if mode == M_RULE { RULE_LEN } else { 0 };
    rule[..rl].copy_from_slice(&RULE_ID[..rl]);
    let fig = mode == M_FIG;
    let mut cand = [0u16; 80];
    let mut score = [0u32; 80];
    let mut n = 0;
    for pass in 0..2 {
        if pass == 1 && (n > 0 || LANG == 2) { break; }
        let any = pass == 1 && (mode == M_RULE || mode == M_FIG);
        if pass == 1 && !any { break; }
        for i in 0..bank::N + DN {
            let r = if i < bank::N { i as u16 } else { 0x8000 | (i - bank::N) as u16 };
            if n < cand.len() && eligible(r, subj, level, fig, &rule[..rl], any) {
                let rand = rnd() % 1000;
                score[n] = if mode == M_EXAM { rand } else {
                    let p = if r & 0x8000 != 0 { 6 } else { PRIO[r as usize] as u32 };
                    let w = if r & 0x8000 == 0 { WRONG[r as usize] as u32 } else { 0 };
                    w * 3000 + p * 1000 + rand
                };
                cand[n] = r;
                n += 1;
            }
        }
    }
    if n == 0 { return false; }
    for i in 1..n {
        let mut j = i;
        while j > 0 && score[j - 1] < score[j] { score.swap(j - 1, j); cand.swap(j - 1, j); j -= 1; }
    }
    if ACTIVE { finish_quiet(); }
    QN = n.min(want.max(1)).min(QMAX);
    Q[..QN].copy_from_slice(&cand[..QN]);
    for a in ANS.iter_mut() { *a = 255; }
    QPOS = 0; OKS = 0; BAD = 0; SPENT = 0; AGAIN = 8; REVIEW = false;
    LIMIT = minutes * 60_000;
    MODE = mode; SUBJ = subj; ACTIVE = true;
    LAST = (mode, subj, level, want, minutes);
    TLEN = 0;
    put(&mut TITLE, &mut TLEN, mode_name(mode));
    put(&mut TITLE, &mut TLEN, b" - ");
    if mode == M_RULE { put(&mut TITLE, &mut TLEN, t("Regra ", "Rule ")); put(&mut TITLE, &mut TLEN, &rule[..rl]); }
    else { put(&mut TITLE, &mut TLEN, subj_name(subj)); }
    show_item();
    true
}

unsafe fn show_item() {
    let x = rec(Q[QPOS]);
    NOPT = nopts(x);
    if NOPT < 2 { advance(); return; }
    for i in 0..5 { PERM[i] = i as u8; }
    if MODE != M_CARDS { for i in (1..NOPT).rev() { let j = rnd() as usize % (i + 1); PERM.swap(i, j); } }
    SEL = 0; QMS = 0; SCROLL = 0;
    SCR = if MODE == M_CARDS { S::Front } else { S::Quest };
}

unsafe fn advance() {
    QPOS += 1;
    if QPOS >= QN || (LIMIT > 0 && SPENT >= LIMIT) { finish(); } else { show_item(); }
}

unsafe fn push_result(id: &[u8], ok: bool, rating: u8, ms: u32) {
    if RCOUNT == RMAX { RHEAD = (RHEAD + 1) % RMAX; RCOUNT -= 1; DROPPED += 1; INFLIGHT = false; }
    let r = &mut RES[(RHEAD + RCOUNT) % RMAX];
    r.seq = NEXT_SEQ; NEXT_SEQ += 1;
    let n = id.len().min(23);
    r.id[..n].copy_from_slice(&id[..n]); r.idn = n as u8;
    r.ok = ok as u8; r.rating = rating; r.mode = MODE; r.ms = ms;
    RCOUNT += 1;
}

unsafe fn tally(ok: bool, rating: u8) {
    let r = Q[QPOS];
    if ok { OKS += 1; RUN_OK += 1; } else {
        BAD += 1; RUN_BAD += 1;
        if r & 0x8000 == 0 { WRONG[r as usize] = WRONG[r as usize].saturating_add(1); }
    }
    push_result(fld(rec(r), F_ID), ok, rating, QMS);
}

unsafe fn answer() {
    let x = rec(Q[QPOS]);
    let chosen = PERM[SEL.min(4)];
    let ok = chosen == dig(fld(x, F_ANS));
    ANS[QPOS] = chosen;
    tally(ok, if ok { 3 } else { 1 });
    if MODE == M_EXAM { advance(); } else { open_feedback(QPOS); }
}

unsafe fn rate(r: u8) {
    ANS[QPOS] = 100 + r;
    tally(r > 1, r);
    if r == 1 && AGAIN > 0 && QN < QMAX {
        let at = (QPOS + 4).min(QN);
        let mut k = QN;
        while k > at { Q[k] = Q[k - 1]; k -= 1; }
        Q[at] = Q[QPOS];
        ANS[at] = 255;
        QN += 1; AGAIN -= 1;
    }
    advance();
}

unsafe fn was_wrong(p: usize) -> bool {
    let a = ANS[p];
    if a == 255 { return false; }
    if a >= 100 { return a == 101; }
    a != dig(fld(rec(Q[p]), F_ANS))
}

unsafe fn finish_quiet() {
    ACTIVE = false;
    SUM = (MODE, SUBJ, OKS + BAD, OKS, SPENT);
    SUM_PEND = true;
    if DECK_DEFER { DECK_DEFER = false; HELLO = true; }
}

unsafe fn finish() {
    finish_quiet();
    // Summary text.
    pg_clear();
    let n = OKS + BAD;
    pg(t("Respondidas: ", "Answered: ")); pgn(n); pg(b" / "); pgn(QN as u32);
    pg(t("\nCorretas: ", "\nCorrect: ")); pgn(OKS); pg(t("   Incorretas: ", "   Wrong: ")); pgn(BAD);
    pg(t("\nAproveitamento: ", "\nAccuracy: ")); pgn(pct(OKS, n)); pg(b"%");
    // Weakest topic: most frequent rule/subject among wrong answers.
    let (mut best, mut best_n) = (usize::MAX, 0);
    for p in 0..QN {
        if !was_wrong(p) { continue; }
        let mut c = 0;
        for k in 0..QN { if was_wrong(k) && topic_eq(Q[p], Q[k]) { c += 1; } }
        if c > best_n { best = p; best_n = c; }
    }
    pg(t("\nPonto fraco: ", "\nWeakest: "));
    if best == usize::MAX { pg(t("nenhum", "none")); } else { topic(Q[best]); }
    pg(t("\nSugestão: ", "\nNext: "));
    let a = pct(OKS, n);
    pg(if n == 0 { t("comece uma nova sessão.", "start a new session.") }
       else if a < 60 { t("Flashcards no tópico fraco hoje.", "flashcards on the weak topic today.") }
       else if a < 85 { t("nova revisão rápida amanhã.", "another quick review tomorrow.") }
       else { t("simulado nível 4-5.", "level 4-5 exam.") });
    pg_wrap(F24, 592);
    SCR = S::Summary; SEL = 0; TOP = 0;
}
unsafe fn topic_eq(a: u16, b: u16) -> bool {
    let (x, y) = (rec(a), rec(b));
    let (ra, rb) = (fld(x, F_RULE), fld(y, F_RULE));
    if !ra.is_empty() || !rb.is_empty() { ra == rb } else { fld(x, F_SUBJ) == fld(y, F_SUBJ) }
}
unsafe fn topic(r: u16) {
    let x = rec(r);
    let rule = fld(x, F_RULE);
    if !rule.is_empty() { pg(t("Regra ", "Rule ")); pg(rule); } else { pg(subj_name(dig(fld(x, F_SUBJ)))); }
}

// ---------- text pages ----------
unsafe fn pg_clear() { PLEN = 0; }
unsafe fn pg(s: &[u8]) { put(&mut PAGE, &mut PLEN, s); }
unsafe fn pgn(v: u32) { putn(&mut PAGE, &mut PLEN, v); }
unsafe fn pg_wrap(font: i32, w: i32) { PLN = wrap(&PAGE[..PLEN], font, w, &mut PL); SCROLL = 0; }
unsafe fn open_page(title: &[u8], ret: S, practice: bool) {
    PTLEN = 0; put(&mut PTITLE, &mut PTLEN, title);
    pg_wrap(F24, 592);
    PRET = ret; PRACTICE = practice; SCR = S::Page;
}
unsafe fn info(title: &[u8], msg: &[u8], ret: S) { pg_clear(); pg(msg); open_page(title, ret, false); }
unsafe fn status_note(x: &[u8]) {
    pg(match fld(x, F_STAT) {
        b"v" => t("Conteúdo verificado na edição citada.", "Verified against the cited edition."),
        b"r" => t("Revisado pelo autor; confira na edição oficial vigente.", "Author-reviewed; check the current official edition."),
        b"a" => t("Gerado por IA - NÃO verificado.", "AI-generated - NOT verified."),
        _ => t("NÃO verificado - não use como referência.", "NOT verified - do not rely on it."),
    });
}
unsafe fn explanation_body(x: &[u8]) {
    pg_clear();
    pg(fld(x, F_EXP));
    pg(b"\n\nRef: "); pg(fld(x, F_REF));
    pg(b"\n"); status_note(x);
}
unsafe fn open_feedback(p: usize) {
    RV = p;
    explanation_body(rec(Q[p]));
    PLN = wrap(&PAGE[..PLEN], F18, 592, &mut PL);
    SCROLL = 0;
    SCR = S::Feedback;
}
unsafe fn next_review(from: usize) {
    let mut p = from;
    while p < QN && !was_wrong(p) { p += 1; }
    if p < QN { REVIEW = true; open_feedback(p); } else { REVIEW = false; finish_view(); }
}
unsafe fn finish_view() { finish_rebuild(); SCR = S::Summary; SEL = 0; TOP = 0; }
unsafe fn finish_rebuild() {
    // Re-render summary text without queueing another session message.
    let pend = SUM_PEND; let sum = SUM; let defer = DECK_DEFER;
    finish();
    SUM_PEND = pend; SUM = sum; DECK_DEFER = defer;
}
unsafe fn build_progress() {
    pg_clear();
    let n = RUN_OK + RUN_BAD;
    pg(t("Neste uso: ", "This run: ")); pgn(n); pg(t(" respostas, ", " answers, ")); pgn(pct(RUN_OK, n)); pg(t("% de acerto.", "% correct."));
    pg(t("\nA enviar ao iPhone: ", "\nWaiting for iPhone: ")); pgn(RCOUNT as u32);
    if DROPPED > 0 { pg(t(" (perdidas: ", " (lost: ")); pgn(DROPPED); pg(b")"); }
    pg(b"\n");
    if STLEN > 0 { pg(&STATS[..STLEN]); }
    else { pg(t("Abra o Pilotage AI no iPhone para histórico, sequência e revisões.", "Open Pilotage AI on the iPhone for history, streak and reviews.")); }
    pg(t("\nBanco: ", "\nBank: ")); pg(bank::VERSION.as_bytes()); pg(b", "); pgn(bank::N as u32);
    if DN > 0 { pg(b" + "); pgn(DN as u32); pg(b" iPhone"); }
    PLN = wrap(&PAGE[..PLEN], F18, 592, &mut PL);
}

// ---------- lists ----------
unsafe fn item(i: usize, a: &[u8], b: &[u8], n: i32, code: u8) {
    let mut k = 0;
    put(&mut LBL[i], &mut k, a);
    put(&mut LBL[i], &mut k, b);
    if n >= 0 { put(&mut LBL[i], &mut k, b" ("); putn(&mut LBL[i], &mut k, n as u32); put(&mut LBL[i], &mut k, b")"); }
    LBN[i] = k as u8; ACT[i] = code;
}
unsafe fn build_items() {
    let mut n = 0;
    match SCR {
        S::Menu => {
            let m: [&[u8]; 7] = [t("Revisão rápida", "Quick review"), t("Flashcards adaptativos", "Adaptive flashcards"),
                t("Simulado", "Exam simulator"), t("Explorador de regras", "Rule explorer"), t("Exame oral", "Oral exam"),
                t("Luzes e marcas", "Lights & shapes"), t("Meu progresso", "My progress")];
            for (i, s) in m.iter().enumerate() { item(i, s, b"", -1, i as u8); }
            n = 7;
        }
        S::Subject => {
            item(0, t("Todas as matérias", "All subjects"), b"", count(ALL) as i32, ALL); n = 1;
            for s in 0..7u8 { item(n, subj_name(s), b"", count(s) as i32, s); n += 1; }
            if DN > 0 { item(n, t("Enviadas pelo iPhone", "Sent from iPhone"), b"", count(PHONE) as i32, PHONE); n += 1; }
        }
        S::Level => {
            item(0, t("Todos os níveis", "All levels"), b"", -1, 0);
            item(1, t("Níveis 1-2: fundamentos", "Levels 1-2: fundamentals"), b"", -1, 1);
            item(2, t("Nível 3: cenários", "Level 3: scenarios"), b"", -1, 2);
            item(3, t("Níveis 4-5: armadilhas", "Levels 4-5: traps"), b"", -1, 3);
            n = 4;
        }
        S::Rules => { for i in 0..bank::R.min(20) { item(i, fld(rrec(i), 1), b"", -1, i as u8); } n = bank::R.min(20); }
        S::Orals => { for i in 0..bank::O.min(20) { item(i, fld(orec(i), 2), b"", -1, i as u8); } n = bank::O.min(20); }
        S::Summary => {
            if BAD > 0 && MODE != M_CARDS { item(n, t("Revisar erros", "Review mistakes"), b"", -1, 0); n += 1; }
            item(n, t("Repetir sessão", "Repeat session"), b"", -1, 1); n += 1;
            item(n, t("Menu principal", "Main menu"), b"", -1, 2); n += 1;
        }
        S::Progress => {
            item(0, t("Idioma: ", "Language: "), match LANG { 0 => "Português".as_bytes(), 1 => "English".as_bytes(), _ => t("Misto PT+EN", "Mixed PT+EN") }, -1, 0);
            item(1, t("Voltar", "Back"), b"", -1, 1);
            n = 2;
        }
        S::Oral => {
            let mut add = |s: &[u8], c: u8| { item(n, s, b"", -1, c); n += 1; };
            match OST {
                0 => { add(t("Gravar resposta (microfone)", "Record answer (mic)"), 1); add(t("Ver referência", "Show reference"), 4); }
                2 => {
                    if OTLEN > 0 { add(t("Avaliar no iPhone", "Evaluate on iPhone"), 3); }
                    add(t("Ver referência", "Show reference"), 4); add(t("Regravar", "Record again"), 1);
                }
                3 => add(t("Ver referência", "Show reference"), 4),
                4 => { add(t("Ver avaliação", "Show evaluation"), 5); add(t("Ver referência", "Show reference"), 4); add(t("Regravar", "Record again"), 1); }
                _ => {}
            }
            if OST != 1 { add(t("Voltar", "Back"), 6); }
        }
        _ => {}
    }
    NITEMS = n;
}

unsafe fn select() {
    let code = ACT[SEL.min(19)];
    match SCR {
        S::Menu => match code {
            0 | 1 | 2 => { MODE = code; SCR = S::Subject; SEL = 0; TOP = 0; }
            3 => { SCR = S::Rules; SEL = 0; TOP = 0; }
            4 => { SCR = S::Orals; SEL = 0; TOP = 0; }
            5 => { if !start(M_FIG, ALL, 0, 10, 0) { info(mode_name(M_FIG), t("Nenhuma figura no idioma atual.", "No diagrams in this language."), S::Menu); } }
            _ => { build_progress(); SCR = S::Progress; SEL = 0; TOP = 0; }
        },
        S::Subject => {
            if count(code) == 0 {
                info(subj_name(code), t("Sem questões desta matéria no banco atual (ou no idioma escolhido). Importe conteúdo verificado pelo iPhone.",
                    "No questions for this subject in the current bank or language. Import verified content from the iPhone."), S::Subject);
            } else if MODE == M_EXAM { PICK_SUBJ = code; SCR = S::Level; SEL = 0; TOP = 0; }
            else {
                let (c, m) = if MODE == M_CARDS { (15, 10) } else { (10, 5) };
                start(MODE, code, 0, c, m);
            }
        }
        S::Level => {
            if !start(M_EXAM, PICK_SUBJ, code, 20, 30) {
                info(t("Simulado", "Exam"), t("Nenhuma questão neste nível para a matéria escolhida.", "No questions at this level for the chosen subject."), S::Level);
            }
        }
        S::Rules => {
            let r = rrec(code as usize);
            let id = fld(r, 0);
            RULE_LEN = id.len().min(8); RULE_ID[..RULE_LEN].copy_from_slice(&id[..RULE_LEN]);
            pg_clear(); pg(fld(r, 2));
            pg(t("\n\nResumo parafraseado; o texto normativo exato deve vir da edição oficial importada.", "\n\nParaphrased summary; exact wording must come from the official edition."));
            open_page(fld(r, 1), S::Rules, true);
        }
        S::Orals => { OI = code as usize; OST = 0; OERR = 0; OTLEN = 0; PARTN = 0; ORESN = 0; SCR = S::Oral; SEL = 0; TOP = 0; }
        S::Summary => match code {
            0 => next_review(0),
            1 => { let (m, s, l, c, min) = LAST; if !start(m, s, l, c, min) { SCR = S::Menu; } }
            _ => { SCR = S::Menu; SEL = 0; TOP = 0; }
        },
        S::Progress => {
            if code == 0 { LANG = (LANG + 1) % 3; LANG_SET = true; HELLO = true; build_progress(); } else { SCR = S::Menu; SEL = 6; TOP = 0; }
        }
        S::Oral => match code {
            1 => start_rec(),
            3 => { ORAL_PEND = true; OST = 3; OWAIT = 0; OERR = 0; SEL = 0; }
            4 => { let o = orec(OI); pg_clear(); pg(fld(o, 3)); open_page(t("Referência", "Reference"), S::Oral, false); }
            5 => { pg_clear(); pg(&ORES[..ORESN]); open_page(t("Avaliação (iPhone)", "Evaluation (iPhone)"), S::Oral, false); }
            _ => leave_oral(),
        },
        _ => {}
    }
}

// ---------- oral capture ----------
unsafe fn start_rec() {
    OERR = 0; OTLEN = 0; PARTN = 0;
    if !BLE { OERR = 1; return; }
    SVC = ble_request(0x0001, NOTHING.as_ptr(), 0);
    SVCK = 1;
    if SVC <= 0 { OERR = 2; SVC = 0; return; }
    OST = 1; REC_MS = 0; POLL = 0;
}
unsafe fn stop_rec() {
    if OST != 1 { return; }
    if STOP_ID <= 0 { STOP_ID = ble_request(0x0002, NOTHING.as_ptr(), 0); }
    if PARTN > 0 {
        if OTLEN > 0 { put(&mut OTXT, &mut OTLEN, b" "); }
        put(&mut OTXT, &mut OTLEN, &PART[2..2 + PARTN]);
        PARTN = 0;
    }
    OST = 2; SEL = 0; TOP = 0;
}
unsafe fn leave_oral() { stop_rec(); SCR = S::Orals; SEL = OI; TOP = 0; }
unsafe fn apply_snapshot(m: usize) {
    let fin = PART[1] != 0;
    let txt = &PART[2..m];
    if fin && !txt.is_empty() {
        if txt.len() >= OTLEN && &txt[..OTLEN] == &OTXT[..OTLEN] {
            OTLEN = 0; put(&mut OTXT, &mut OTLEN, txt); // cumulative snapshot
        } else if !(OTLEN >= txt.len() && &OTXT[OTLEN - txt.len()..OTLEN] == txt) {
            if OTLEN > 0 { put(&mut OTXT, &mut OTLEN, b" "); }
            put(&mut OTXT, &mut OTLEN, txt);
        }
        PARTN = 0;
    } else {
        PARTN = txt.len();
    }
    DIRTY = true;
}
unsafe fn svc_tick(dt: u32) {
    if STOP_ID > 0 {
        let n = ble_response_len(STOP_ID);
        if n != -1 { if n >= 0 { let mut r = [0u8; 384]; ble_response_read(STOP_ID, r.as_mut_ptr(), 384); } STOP_ID = 0; }
    }
    if SVC > 0 {
        let n = ble_response_len(SVC);
        if n >= 0 {
            if SVCK == 3 && OST == 1 {
                let m = ble_response_read(SVC, PART.as_mut_ptr(), 384);
                if m >= 2 && m <= 384 { apply_snapshot(m as usize); } else { PARTN = 0; }
            } else { let mut r = [0u8; 384]; ble_response_read(SVC, r.as_mut_ptr(), 384); }
            SVC = 0;
        } else if n != -1 {
            SVC = 0;
            if SVCK == 1 && OST == 1 { OST = 0; OERR = 2; DIRTY = true; }
        }
    }
    if OST == 1 {
        REC_MS = REC_MS.saturating_add(dt);
        if REC_MS >= 120_000 || !BLE { stop_rec(); DIRTY = true; }
        else if SVC <= 0 {
            POLL += dt;
            if POLL >= 400 { POLL = 0; SVC = ble_request(0x0003, NOTHING.as_ptr(), 0); SVCK = 3; if SVC < 0 { SVC = 0; } }
        }
    }
    if OST == 3 {
        OWAIT += dt;
        if OWAIT > 20_000 { OST = 2; OERR = 3; DIRTY = true; }
    }
}

// ---------- phone messages ----------
unsafe fn on_msg(m: &[u8]) {
    LAST_RX = CLOCK; RX_EVER = true; DIRTY = true;
    let mut tb = [0u8; 16];
    let tn = json::unescape(json::get(m, b"type"), &mut tb);
    match &tb[..tn] {
        b"sync" => HELLO = true,
        // "state" is the companion's replaceable snapshot (setSnapshotForApp):
        // latest ack, review priorities, stats lines and language. Re-sent as a
        // heartbeat, so a lost or replaced copy is harmless.
        b"state" | b"ack" => {
            if json::int(json::get(m, b"run"), 0) as u32 == RUN {
                let seq = json::int(json::get(m, b"seq"), 0) as u32;
                while RCOUNT > 0 && RES[RHEAD].seq <= seq { RHEAD = (RHEAD + 1) % RMAX; RCOUNT -= 1; }
                INFLIGHT = false;
            }
            if let Some(v) = json::get(m, b"p") {
                for (i, &c) in v.iter().skip(1).take(bank::N).enumerate() { if c.is_ascii_digit() { PRIO[i] = c - b'0'; } }
            }
            if json::get(m, b"lines").is_some() { STLEN = json::unescape(json::get(m, b"lines"), &mut STATS); }
            let l = json::int(json::get(m, b"lang"), LANG as i32);
            if (0..3).contains(&l) && !HELLO { LANG = l as u8; }
            if json::get(m, b"hello").is_some() { HELLO = true; }
            if SCR == S::Progress { build_progress(); }
        }
        b"deck" => load_deck(m),
        b"session" => {
            if OST == 1 { return; }
            let mode = json::int(json::get(m, b"mode"), 0).clamp(0, 3) as u8;
            let subj = json::int(json::get(m, b"subj"), ALL as i32).clamp(0, 255) as u8;
            let want = json::int(json::get(m, b"count"), 10).clamp(1, QMAX as i32) as usize;
            let minutes = json::int(json::get(m, b"minutes"), 0).clamp(0, 180) as u32;
            let level = json::int(json::get(m, b"level"), 0).clamp(0, 15) as u8;
            if !start(mode, subj, level, want, minutes) {
                info(t("Sessão do iPhone", "iPhone session"), t("Nenhuma questão disponível para esta configuração.", "No questions match this configuration."), S::Menu);
            }
        }
        b"oral_result" => {
            ORESN = json::unescape(json::get(m, b"text"), &mut ORES);
            if OST == 3 { OST = 4; }
            if SCR == S::Oral { SEL = 0; pg_clear(); pg(&ORES[..ORESN]); open_page(t("Avaliação (iPhone)", "Evaluation (iPhone)"), S::Oral, false); }
        }
        _ => {}
    }
}

unsafe fn load_deck(m: &[u8]) {
    if ACTIVE { DECK_DEFER = true; return; }
    let n = json::unescape(json::get(m, b"items"), &mut DECK);
    DN = 0;
    let mut start = 0usize;
    for i in 0..=n {
        if i == n || DECK[i] == 0x1e {
            if i > start && DN < DS.len() {
                DS[DN] = start as u16; DE[DN] = i as u16;
                let x = &DECK[start..i];
                if nopts(x) >= 2 && fld(x, F_ID).len() <= 23 { DN += 1; }
            }
            start = i + 1;
        } else if DECK[i] == 0x1f { DECK[i] = 0; }
    }
    DECK_OK = true;
}

unsafe fn pump() {
    OUT.clear();
    if HELLO {
        OUT.s(b"{\"type\":\"hello\",\"run\":").num(RUN).s(b",\"bank\":").q(bank::VERSION.as_bytes(), 0)
            .s(b",\"n\":").num(bank::N as u32).s(b",\"lang\":").num(LANG as u32).s(b",\"deck\":").num(DN as u32)
            .s(b",\"pending\":").num(RCOUNT as u32).s(b",\"langset\":").num(LANG_SET as u32).s(b"}");
        if BRIDGE.send(OUT.bytes()) { HELLO = false; INFLIGHT = false; }
        return;
    }
    if DECK_OK {
        OUT.s(b"{\"type\":\"deck_ok\",\"run\":").num(RUN).s(b",\"n\":").num(DN as u32).s(b"}");
        if BRIDGE.send(OUT.bytes()) { DECK_OK = false; }
        return;
    }
    if ORAL_PEND {
        let o = orec(OI);
        OUT.s(b"{\"type\":\"oral\",\"run\":").num(RUN).s(b",\"id\":").q(fld(o, 0), 0).s(b",\"text\":").q(&OTXT[..OTLEN], 2).s(b"}");
        if BRIDGE.send(OUT.bytes()) { ORAL_PEND = false; }
        return;
    }
    if SUM_PEND {
        let (mode, subj, n, ok, ms) = SUM;
        OUT.s(b"{\"type\":\"session\",\"run\":").num(RUN).s(b",\"mode\":").num(mode as u32).s(b",\"subj\":").num(subj as u32)
            .s(b",\"n\":").num(n).s(b",\"ok\":").num(ok).s(b",\"ms\":").num(ms).s(b"}");
        if BRIDGE.send(OUT.bytes()) { SUM_PEND = false; }
        return;
    }
    if RCOUNT > 0 && (!INFLIGHT || CLOCK.wrapping_sub(SENT_AT) > 6000) {
        OUT.s(b"{\"type\":\"results\",\"run\":").num(RUN).s(b",\"r\":[");
        for j in 0..RCOUNT.min(12) {
            let r = RES[(RHEAD + j) % RMAX];
            if j > 0 { OUT.s(b","); }
            OUT.s(b"[").num(r.seq).s(b",").q(&r.id[..r.idn as usize], 0).s(b",").num(r.ok as u32).s(b",")
                .num(r.rating as u32).s(b",").num(r.ms).s(b",").num(r.mode as u32).s(b"]");
        }
        OUT.s(b"]}");
        if OUT.ok && BRIDGE.send(OUT.bytes()) { INFLIGHT = true; SENT_AT = CLOCK; }
    }
}

// ---------- rendering ----------
unsafe fn foot(s: &[u8]) { label(24, FOOT_Y, 592, 7, F18, 1, s); }
unsafe fn mmss(buf: &mut [u8], n: &mut usize, sec: u32) {
    let (m, s) = (sec / 60, sec % 60);
    if m < 10 { put(buf, n, b"0"); } putn(buf, n, m); put(buf, n, b":");
    if s < 10 { put(buf, n, b"0"); } putn(buf, n, s);
}
unsafe fn header(title: &[u8]) {
    label(24, HEAD_Y, 466, 12, F18, 0, title);
    let mut b = [0u8; 32];
    let mut n = 0;
    if ACTIVE && LIMIT > 0 && matches!(SCR, S::Quest | S::Front | S::Back | S::Feedback) {
        mmss(&mut b, &mut n, LIMIT.saturating_sub(SPENT) / 1000);
        put(&mut b, &mut n, b"  ");
    }
    put(&mut b, &mut n, if online() { &b"iPhone"[..] } else { &b"offline"[..] });
    raw(494, HEAD_Y, 122, if online() { 10 } else { 15 }, F18, 2, &b[..n]);
    line(24, HEAD_Y + 25, 616, HEAD_Y + 25, 1, 5);
}
unsafe fn sess_header() {
    let mut b = [0u8; 96];
    let mut n = 0;
    put(&mut b, &mut n, &TITLE[..TLEN]);
    put(&mut b, &mut n, b"  "); putn(&mut b, &mut n, (QPOS + 1).min(QN) as u32); put(&mut b, &mut n, b"/"); putn(&mut b, &mut n, QN as u32);
    if MODE != M_EXAM && OKS + BAD > 0 { put(&mut b, &mut n, b"  "); putn(&mut b, &mut n, pct(OKS, OKS + BAD)); put(&mut b, &mut n, b"%"); }
    header(&b[..n]);
}
unsafe fn list(y0: i32, rows_max: usize) -> Option<(i32, i32)> {
    build_items();
    let n = NITEMS;
    if n == 0 { return None; }
    if SEL >= n { SEL = n - 1; }
    let rows = rows_max.min(n);
    if SEL < TOP { TOP = SEL; }
    if SEL >= TOP + rows { TOP = SEL + 1 - rows; }
    for k in 0..rows {
        let i = TOP + k;
        let y = y0 + k as i32 * 42;
        if i == SEL { fill_round_rect(52, y - 3, 564, 38, 10, 3); stroke_round_rect(52, y - 3, 564, 38, 10, 2, 15); }
        label(68, y, 524, if i == SEL { 15 } else { 10 }, F24, 0, &LBL[i][..LBN[i] as usize]);
    }
    if TOP > 0 { arrow_up(604, y0 - 14); }
    if TOP + rows < n { arrow_down(604, y0 + rows as i32 * 42); }
    Some((34, y0 + (SEL - TOP) as i32 * 42 + 16))
}
unsafe fn body_lines(y: i32, font: i32, gray: i32) {
    VIS = ((BOTTOM - y) / lh(font)).max(1) as usize;
    if SCROLL + VIS > PLN { SCROLL = PLN.saturating_sub(VIS); }
    lines(24, y, 592, gray, font, &PAGE[..PLEN], &PL[..PLN], SCROLL, VIS);
    if SCROLL > 0 { arrow_up(620, y); }
    if SCROLL + VIS < PLN { arrow_down(620, BOTTOM - 6); }
}

unsafe fn draw_question(x: &[u8], show_opts: bool) -> Option<(i32, i32)> {
    let fig = fld(x, F_FIG);
    let (tx, tw) = if fig.is_empty() { (24, 592) } else { (170, 446) };
    if !fig.is_empty() { figure(85, BODY_Y + 16, fig, LANG == 1); }
    let q = fld(x, F_Q);
    let ow = tw - 52;
    let mut ol = [[(0u16, 0u16); 3]; 5];
    let mut on = [0usize; 5];
    let mut oh = 0;
    if show_opts {
        for p in 0..NOPT { on[p] = wrap(fld(x, F_OPT + PERM[p] as usize), F18, ow, &mut ol[p]); oh += on[p] as i32 * 22 + 10; }
    }
    let mut ql = [(0u16, 0u16); 12];
    let mut qf = F24;
    let mut qn = wrap(q, F24, tw, &mut ql);
    if BODY_Y + qn as i32 * 28 + 8 + oh > BOTTOM { qf = F18; qn = wrap(q, F18, tw, &mut ql); }
    lines(tx, BODY_Y, tw, 15, qf, q, &ql, 0, qn);
    if !show_opts { return None; }
    let mut cur = None;
    let mut y = BODY_Y + qn as i32 * lh(qf) + 8;
    for p in 0..NOPT {
        let h = on[p] as i32 * 22 + 4;
        let sel = p == SEL;
        if sel { stroke_round_rect(tx + 20, y - 3, tw - 20, h + 2, 8, 2, 15); cur = Some((tx + 6, y + h / 2)); }
        let letter = [b'A' + p as u8, b')'];
        raw(tx + 26, y, 22, if sel { 15 } else { 8 }, F18, 0, &letter);
        lines(tx + 48, y, ow, if sel { 15 } else { 9 }, F18, fld(x, F_OPT + PERM[p] as usize), &ol[p], 0, on[p]);
        y += on[p] as i32 * 22 + 10;
    }
    cur
}

unsafe fn render() {
    DIRTY = false;
    SINCE_DRAW = 0;
    begin();
    let mut cur: Option<(i32, i32)> = None;
    match SCR {
        S::Menu => {
            raw(24, 44, 592, 15, F32, 1, b"PILOTAGE AI");
            raw(24, 86, 592, 9, F18, 1, t("Praticante de Prático - PSCPP 2027", "Pilot trainee exam - PSCPP 2027"));
            raw(24, 110, 592, if online() { 8 } else { 12 }, F18, 1,
                if online() { t("iPhone conectado", "iPhone connected") } else { t("Modo offline: banco local", "Offline: local bank") });
            cur = list(150, 7);
        }
        S::Subject => { header(mode_name(MODE)); cur = list(BODY_Y + 10, 8); foot(t("Toque: escolher matéria  Segurar: voltar", "Tap: choose subject  Hold: back")); }
        S::Level => { header(t("Simulado - nível", "Exam - level")); cur = list(BODY_Y + 10, 8); foot(t("Toque: iniciar (20 questões, 30 min)", "Tap: start (20 questions, 30 min)")); }
        S::Rules => { header(t("Explorador de regras", "Rule explorer")); cur = list(BODY_Y + 10, 8); foot(t("Toque: abrir  Segurar: voltar", "Tap: open  Hold: back")); }
        S::Orals => { header(t("Exame oral", "Oral exam")); cur = list(BODY_Y + 10, 8); foot(t("Toque: escolher pergunta  Segurar: voltar", "Tap: choose prompt  Hold: back")); }
        S::Quest => {
            sess_header();
            cur = draw_question(rec(Q[QPOS]), true);
            foot(t("Deslize: alternativa  Toque: responder  Segurar: encerrar", "Swipe: option  Tap: answer  Hold: end"));
        }
        S::Front => {
            sess_header();
            draw_question(rec(Q[QPOS]), false);
            foot(t("Toque: ver resposta  Segurar: encerrar", "Tap: show answer  Hold: end"));
        }
        S::Back => {
            sess_header();
            let x = rec(Q[QPOS]);
            raw(24, BODY_Y, 592, 9, F18, 0, t("Resposta", "Answer"));
            let n = para(24, BODY_Y + 26, 592, 15, F24, fld(x, F_OPT + dig(fld(x, F_ANS)) as usize), 6);
            label(24, BODY_Y + 34 + n as i32 * 28, 592, 8, F18, 0, fld(x, F_REF));
            let names: [&[u8]; 4] = [t("De novo", "Again"), t("Difícil", "Hard"), t("Bom", "Good"), t("Fácil", "Easy")];
            for k in 0..4 {
                let bx = 24 + k as i32 * 150;
                let sel = k == SEL;
                if sel { fill_round_rect(bx, 384, 140, 42, 10, 15); } else { stroke_round_rect(bx, 384, 140, 42, 10, 2, 7); }
                raw(bx, 394, 140, if sel { 0 } else { 12 }, F18, 1, names[k]);
                if sel { cur = Some((bx + 12, 405)); }
            }
            foot(t("Deslize/Toque: avaliar  Segurar: explicação", "Swipe/Tap: rate  Hold: explanation"));
        }
        S::Feedback => {
            sess_header();
            let p = RV;
            let x = rec(Q[p]);
            let correct = dig(fld(x, F_ANS));
            let chosen = ANS[p];
            let ok = chosen == correct;
            if ok { check(24, BODY_Y, 15); raw(64, BODY_Y - 6, 400, 15, F32, 0, t("CORRETO", "CORRECT")); }
            else { cross(24, BODY_Y, 15); raw(64, BODY_Y - 6, 400, 15, F32, 0, t("INCORRETO", "INCORRECT")); }
            if REVIEW { raw(456, BODY_Y, 160, 9, F18, 2, t("revisão", "review")); }
            let mut b = [0u8; 300];
            let mut n = 0;
            put(&mut b, &mut n, t("Resposta: ", "Answer: ")); put(&mut b, &mut n, fld(x, F_OPT + correct as usize));
            let mut y = BODY_Y + 40;
            y += para(24, y, 592, 15, F18, &b[..n], 3) as i32 * 22;
            if !ok && chosen < 5 {
                n = 0; put(&mut b, &mut n, t("Sua escolha: ", "Your choice: ")); put(&mut b, &mut n, fld(x, F_OPT + chosen as usize));
                y += para(24, y, 592, 9, F18, &b[..n], 2) as i32 * 22;
            }
            line(24, y + 4, 616, y + 4, 1, 5);
            body_lines(y + 12, F18, 12);
            foot(if REVIEW { t("Toque: próximo erro  Deslize: rolar  Segurar: resumo", "Tap: next mistake  Swipe: scroll  Hold: summary") }
                 else { t("Toque: próxima  Deslize: rolar  Segurar: encerrar", "Tap: next  Swipe: scroll  Hold: end") });
        }
        S::Page => {
            header(&PTITLE[..PTLEN]);
            body_lines(BODY_Y, F24, 15);
            foot(if PRACTICE { t("Toque: praticar  Deslize: rolar  Segurar: voltar", "Tap: practise  Swipe: scroll  Hold: back") }
                 else { t("Toque: voltar  Deslize: rolar", "Tap: back  Swipe: scroll") });
        }
        S::Summary => {
            header(t("Resumo da sessão", "Session summary"));
            lines(24, BODY_Y, 592, 15, F24, &PAGE[..PLEN], &PL[..PLN], 0, PLN.min(7));
            cur = list(BODY_Y + 7 * 28 + 24, 3);
        }
        S::Progress => {
            header(t("Meu progresso", "My progress"));
            lines(24, BODY_Y, 592, 13, F18, &PAGE[..PLEN], &PL[..PLN], 0, PLN.min(11));
            cur = list(352, 2);
        }
        S::Oral => {
            header(t("Exame oral", "Oral exam"));
            let o = orec(OI);
            let mut y = BODY_Y + para(24, BODY_Y, 592, 15, F24, fld(o, 2), 4) as i32 * 28 + 8;
            if OST == 1 {
                let on = (CLOCK / 500) % 2 == 0;
                fill_circle(36, y + 15, 10, if on { 15 } else { 5 });
                let mut b = [0u8; 40];
                let mut n = 0;
                put(&mut b, &mut n, t("GRAVANDO  ", "RECORDING  ")); mmss(&mut b, &mut n, REC_MS / 1000);
                raw(56, y, 400, 15, F24, 0, &b[..n]);
                y += 38;
            }
            // Transcript (finished text plus live partial).
            pg_clear(); pg(&OTXT[..OTLEN]);
            if PARTN > 0 { if OTLEN > 0 { pg(b" "); } pg(&PART[2..2 + PARTN]); }
            PLN = wrap(&PAGE[..PLEN], F18, 592, &mut PL);
            build_items();
            let list_y = BOTTOM - NITEMS as i32 * 42 + 6;
            let room = (((list_y - 8) - y) / 22).max(0) as usize;
            if OST == 3 { raw(24, y, 592, 15, F18, 0, t("Avaliando no iPhone...", "Evaluating on iPhone...")); y += 24; }
            let msg: &[u8] = match OERR {
                1 => t("iPhone desconectado: transcrição indisponível. Use a referência.", "iPhone disconnected: transcription unavailable."),
                2 => t("Transcrição não iniciou. Tente de novo ou use a referência.", "Transcription did not start. Retry or use the reference."),
                3 => t("Sem resposta do iPhone. Use a referência para autoavaliar.", "No reply from iPhone. Self-assess with the reference."),
                _ => b"",
            };
            if !msg.is_empty() { y += para(24, y, 592, 15, F18, msg, 2) as i32 * 22; }
            let room = room.min((((list_y - 8) - y) / 22).max(0) as usize);
            if PLN > 0 && room > 0 {
                let first = if OST == 1 { PLN.saturating_sub(room) } else { 0 };
                lines(24, y, 592, 11, F18, &PAGE[..PLEN], &PL[..PLN], first, room);
            } else if OST == 1 && PLN == 0 && room > 0 {
                raw(24, y, 592, 9, F18, 0, t("Fale sua resposta...", "Speak your answer..."));
            }
            if OST == 1 { foot(t("Toque: parar gravação", "Tap: stop recording")); }
            else { cur = list(list_y, 4); }
        }
    }
    match cur { Some((cx, cy)) => content::cursor(cx, cy, true), None => content::cursor(0, 0, false) }
    present();
}

// ---------- input ----------
unsafe fn nav(d: i32) {
    match SCR {
        S::Quest => { SEL = (SEL as i32 + d).clamp(0, NOPT.max(1) as i32 - 1) as usize; }
        S::Back => { SEL = (SEL as i32 + d).clamp(0, 3) as usize; }
        S::Page | S::Feedback => { SCROLL = (SCROLL as i32 + d * 3).clamp(0, PLN.saturating_sub(VIS) as i32) as usize; }
        S::Front => {}
        S::Oral if OST == 1 => {}
        _ => { build_items(); if NITEMS > 0 { SEL = (SEL as i32 + d).clamp(0, NITEMS as i32 - 1) as usize; } }
    }
}
unsafe fn tap() {
    match SCR {
        S::Quest => answer(),
        S::Front => { SCR = S::Back; SEL = 2; }
        S::Back => rate(SEL as u8 + 1),
        S::Feedback => if REVIEW { next_review(RV + 1); } else { advance(); },
        S::Page => {
            if PRACTICE {
                if !start(M_RULE, ALL, 0, 10, 0) {
                    info(t("Praticar regra", "Rule practice"), t("Ainda não há questões desta regra no banco. Importe pelo iPhone.", "No questions for this rule yet. Import them from the iPhone."), S::Rules);
                }
            } else { SCR = PRET; SEL = 0; TOP = 0; }
        }
        S::Oral if OST == 1 => stop_rec(),
        _ => { build_items(); if NITEMS > 0 { select(); } }
    }
}
unsafe fn long() {
    match SCR {
        S::Menu => {}
        S::Subject | S::Rules | S::Orals | S::Progress => { SCR = S::Menu; SEL = 0; TOP = 0; }
        S::Level => { SCR = S::Subject; SEL = 0; TOP = 0; }
        S::Quest | S::Front => finish(),
        S::Back => { explanation_body(rec(Q[QPOS])); open_page(t("Explicação", "Explanation"), S::Back, false); }
        S::Feedback => if REVIEW { finish_view(); } else { finish(); },
        S::Page => { SCR = PRET; SEL = 0; TOP = 0; }
        S::Summary => { SCR = S::Menu; SEL = 0; TOP = 0; }
        S::Oral => if OST == 1 { stop_rec(); } else { leave_oral(); },
    }
}

// ---------- exports ----------
#[no_mangle]
pub unsafe extern "C" fn app_init() {
    BRIDGE = companion::Companion::new(APP);
    SEED = (now_ms() as u32) ^ 0x2545_F491;
    if SEED == 0 { SEED = 1; }
    RUN = (rnd() & 0x3fff_ffff) | 1;
    SCR = S::Menu; SEL = 0; TOP = 0; DIRTY = true; CLOCK = 0; HELLO = true;
    ACTIVE = false; OST = 0; RCOUNT = 0; RHEAD = 0; DN = 0; STLEN = 0;
    content::holds_local(true);
    render();
}

#[no_mangle]
pub unsafe extern "C" fn app_render(ms: i32) {
    let dt = ms.clamp(0, 1000) as u32;
    CLOCK = CLOCK.wrapping_add(dt);
    SINCE_DRAW = SINCE_DRAW.saturating_add(dt);
    if content::context_changed() { DIRTY = true; }
    if let Some(m) = BRIDGE.tick(dt) { on_msg(m); }
    STATUS_MS += dt;
    if STATUS_MS >= 1000 {
        STATUS_MS = 0;
        let was = online();
        let mut b = [0u8; 10];
        if device_status(b.as_mut_ptr(), 10) == 10 { BLE = b[3] != 0; }
        if was != online() { DIRTY = true; }
    }
    let covered = content::sidebar_open() || content::overlay_visible();
    if ACTIVE && !covered && matches!(SCR, S::Quest | S::Front | S::Back) {
        SPENT = SPENT.saturating_add(dt);
        QMS = QMS.saturating_add(dt);
        if LIMIT > 0 && SPENT >= LIMIT && SCR != S::Back { finish(); DIRTY = true; }
    }
    if ACTIVE && LIMIT > 0 && SINCE_DRAW >= 1000 && matches!(SCR, S::Quest | S::Front | S::Back | S::Feedback) { DIRTY = true; }
    svc_tick(dt);
    if OST == 1 && SINCE_DRAW >= 500 && SCR == S::Oral { DIRTY = true; }
    pump();
    if DIRTY { render(); }
}

#[no_mangle]
pub unsafe extern "C" fn app_event(e: i32) {
    match e {
        1 => nav(-1),
        2 => nav(1),
        0 => tap(),
        9 | 10 => {
            if content::sidebar_open() || content::overlay_visible() { return; }
            if !LONG_EVER || CLOCK.wrapping_sub(LAST_LONG) > 1200 { long(); }
            LAST_LONG = CLOCK; LONG_EVER = true;
        }
        _ => return, // hold release (12) and others: nothing held to end
    }
    render();
}

// The host releases this instance after this callback. Never leave the
// microphone transcription running behind a closed app.
#[no_mangle]
pub unsafe extern "C" fn app_stop() {
    if OST == 1 { ble_send(0x0002, NOTHING.as_ptr(), 0); OST = 0; }
}
