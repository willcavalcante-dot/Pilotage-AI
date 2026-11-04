//! RIPEAM Tutor - spoken open-answer quiz for Mira glasses.
//! Glasses: show question, capture the spoken answer with the documented Mira
//! transcription service (0x0001 start, 0x0002 stop, 0x0003 snapshot), send it to
//! the phone companion, show the AI evaluation. The citation always comes from
//! the bundled bank, never from the AI. Missed questions return sooner.
#![no_std]
#![allow(static_mut_refs)]
#[path = "../Shared/companion.rs"] mod companion;
#[path = "../Shared/content.rs"] mod content;
#[path = "../PilotageAI/ui.rs"] mod ui;
#[path = "../PilotageAI/json.rs"] mod json;
mod bank;
use ui::*;

// Speech-bubble icon with a question mark.
app_icon!(content::app_icon::Icon::new()
    .rect(4, 5, 24, 16).line(10, 21, 8, 27).line(8, 27, 15, 21)
    .line(13, 10, 16, 8).line(16, 8, 19, 10).line(19, 10, 16, 14).line(16, 14, 16, 16).line(16, 18, 16, 19).0);

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

const APP: &[u8] = b"RIPEAM Tutor";
#[derive(Clone, Copy, PartialEq)]
enum S { Ask, Rec, Eval, Result }

static mut BRIDGE: companion::Companion<2304, 1280> = companion::Companion::new(APP);
static mut OUT: json::W<1280> = json::W::new();
static mut SCR: S = S::Ask;
static mut DIRTY: bool = true;
static mut CLOCK: u32 = 0;
static mut SINCE_DRAW: u32 = 0;
static mut SEED: u32 = 1;
static mut BLE: bool = false;
static mut STATUS_MS: u32 = 10_000;
static mut LAST_RX: u32 = 0;
static mut RX_EVER: bool = false;
static mut AI_READY: bool = false;
static mut HELLO: bool = true;
static mut LAST_LONG: u32 = 0;
static mut LONG_EVER: bool = false;
static mut MSG: u8 = 0; // 1 no phone link, 2 transcription failed, 3 nothing heard

// Question selection and spaced revisits.
static mut CUR: usize = 0;
static mut ASKED: u16 = 0;
static mut SEEN: [u8; bank::N] = [0; bank::N];
static mut WRONG: [u8; bank::N] = [0; bank::N];
static mut DUE: [u16; bank::N] = [0; bank::N];
static mut RECENT: [u8; 5] = [255; 5];
static mut REVISIT: bool = false;

// Speech capture.
static mut SVC: i32 = 0;
static mut SVCK: u8 = 0;
static mut STOP_ID: i32 = 0;
static mut POLL: u32 = 0;
static mut REC_MS: u32 = 0;
static mut OTXT: [u8; 900] = [0; 900];
static mut OTLEN: usize = 0;
static mut PART: [u8; 384] = [0; 384]; // raw 0x0003 reply: state, final, text
static mut PARTN: usize = 0;
static mut SEND_ANSWER: bool = false;
static mut EVAL_MS: u32 = 0;

// Result.
static mut VERDICT: u8 = 3; // 0 correct, 1 partial, 2 incorrect, 3 not verified
static mut CORR: [u8; 1700] = [0; 1700];
static mut CLEN: usize = 0;
static mut PL: [(u16, u16); 80] = [(0, 0); 80];
static mut PLN: usize = 0;
static mut SCROLL: usize = 0;
static mut VIS: usize = 1;
static NOTHING: [u8; 1] = [0];

fn fld(x: &[u8], k: usize) -> &[u8] { x.split(|b| *b == 0).nth(k).unwrap_or(&[]) }
fn rec(i: usize) -> &'static [u8] { &bank::BLOB[bank::OFF[i] as usize..bank::OFF[i + 1] as usize] }
fn put(buf: &mut [u8], n: &mut usize, s: &[u8]) {
    let mut k = s.len().min(buf.len().saturating_sub(*n));
    while k > 0 && k < s.len() && (s[k] & 0xC0) == 0x80 { k -= 1; }
    buf[*n..*n + k].copy_from_slice(&s[..k]);
    *n += k;
}
unsafe fn rnd() -> u32 { SEED ^= SEED << 13; SEED ^= SEED >> 17; SEED ^= SEED << 5; SEED }
unsafe fn online() -> bool { BLE && RX_EVER && CLOCK.wrapping_sub(LAST_RX) < 30_000 }

unsafe fn next_question() {
    ASKED = ASKED.wrapping_add(1);
    // A missed question that is due comes back first.
    let mut pick = usize::MAX;
    for i in 0..bank::N {
        if i != CUR && DUE[i] != 0 && DUE[i] <= ASKED && (pick == usize::MAX || DUE[i] < DUE[pick]) { pick = i; }
    }
    REVISIT = pick != usize::MAX;
    if !REVISIT {
        let weight = |i: usize| -> u32 {
            if i == CUR || RECENT.contains(&(i as u8)) { 0 } else if SEEN[i] == 0 { 3 } else if WRONG[i] > 0 { 4 } else { 1 }
        };
        let total: u32 = (0..bank::N).map(weight).sum();
        if total == 0 { pick = (CUR + 1) % bank::N; } else {
            let mut r = rnd() % total;
            for i in 0..bank::N { let w = weight(i); if r < w { pick = i; break; } r -= w; }
        }
    }
    CUR = pick;
    SEEN[CUR] = 1;
    RECENT.rotate_right(1);
    RECENT[0] = CUR as u8;
    SCR = S::Ask; MSG = 0; OTLEN = 0; PARTN = 0;
}

unsafe fn record_verdict(v: u8) {
    match v {
        0 => { WRONG[CUR] = WRONG[CUR].saturating_sub(1); DUE[CUR] = 0; }
        1 => { WRONG[CUR] = WRONG[CUR].saturating_add(1); DUE[CUR] = ASKED.wrapping_add(5); }
        2 => { WRONG[CUR] = WRONG[CUR].saturating_add(1); DUE[CUR] = ASKED.wrapping_add(3); }
        _ => {}
    }
}

unsafe fn show_result(v: u8) {
    VERDICT = v;
    record_verdict(v);
    PLN = wrap(&CORR[..CLEN], F18, 592, &mut PL);
    SCROLL = 0;
    SCR = S::Result;
}

/// Used when the phone gives no evaluation: say so and show the reference answer.
unsafe fn local_fallback(reason: &[u8]) {
    CLEN = 0;
    put(&mut CORR, &mut CLEN, reason);
    put(&mut CORR, &mut CLEN, "\n\nResposta completa: ".as_bytes());
    put(&mut CORR, &mut CLEN, fld(rec(CUR), 3));
    show_result(3);
}

// ---------- speech capture ----------
unsafe fn start_rec() {
    MSG = 0; OTLEN = 0; PARTN = 0;
    if !BLE { MSG = 1; return; }
    SVC = ble_request(0x0001, NOTHING.as_ptr(), 0);
    SVCK = 1;
    if SVC <= 0 { SVC = 0; MSG = 2; return; }
    SCR = S::Rec; REC_MS = 0; POLL = 0;
}
unsafe fn stop_capture() {
    if STOP_ID <= 0 { STOP_ID = ble_request(0x0002, NOTHING.as_ptr(), 0); }
    if PARTN > 0 {
        if OTLEN > 0 { put(&mut OTXT, &mut OTLEN, b" "); }
        put(&mut OTXT, &mut OTLEN, &PART[2..2 + PARTN]);
        PARTN = 0;
    }
}
unsafe fn finish_rec() {
    stop_capture();
    if OTLEN == 0 { SCR = S::Ask; MSG = 3; return; }
    SEND_ANSWER = true; EVAL_MS = 0; SCR = S::Eval;
}
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
            if SVCK == 3 && SCR == S::Rec {
                let m = ble_response_read(SVC, PART.as_mut_ptr(), 384);
                if m >= 2 && m <= 384 { apply_snapshot(m as usize); }
            } else { let mut r = [0u8; 384]; ble_response_read(SVC, r.as_mut_ptr(), 384); }
            SVC = 0;
        } else if n != -1 {
            SVC = 0;
            if SVCK == 1 && SCR == S::Rec { SCR = S::Ask; MSG = 2; DIRTY = true; }
        }
    }
    if SCR == S::Rec {
        REC_MS = REC_MS.saturating_add(dt);
        if !BLE { stop_capture(); SCR = S::Ask; MSG = 1; DIRTY = true; }
        else if REC_MS >= 120_000 { finish_rec(); DIRTY = true; }
        else if SVC <= 0 {
            POLL += dt;
            if POLL >= 400 { POLL = 0; SVC = ble_request(0x0003, NOTHING.as_ptr(), 0); SVCK = 3; if SVC < 0 { SVC = 0; } }
        }
    }
    if SCR == S::Eval {
        EVAL_MS = EVAL_MS.saturating_add(dt);
        if EVAL_MS > 60_000 {
            SEND_ANSWER = false;
            local_fallback("Sem resposta da avaliação no iPhone: não foi possível verificar sua resposta.".as_bytes());
            DIRTY = true;
        }
    }
}

// ---------- phone messages ----------
unsafe fn on_msg(m: &[u8]) {
    LAST_RX = CLOCK; RX_EVER = true; DIRTY = true;
    let mut tb = [0u8; 16];
    let tn = json::unescape(json::get(m, b"type"), &mut tb);
    match &tb[..tn] {
        b"state" => {
            AI_READY = json::int(json::get(m, b"ai"), 0) == 1;
            if json::get(m, b"hello").is_some() { HELLO = true; }
        }
        b"result" => {
            let mut id = [0u8; 16];
            let n = json::unescape(json::get(m, b"id"), &mut id);
            if SCR != S::Eval || &id[..n] != fld(rec(CUR), 0) { return; }
            CLEN = json::unescape(json::get(m, b"c"), &mut CORR);
            let v = json::int(json::get(m, b"v"), 3).clamp(0, 3) as u8;
            show_result(v);
        }
        _ => {}
    }
}
unsafe fn pump() {
    OUT.clear();
    if HELLO {
        OUT.s(b"{\"type\":\"hello\",\"bank\":").q(bank::VERSION.as_bytes(), 0).s(b"}");
        if BRIDGE.send(OUT.bytes()) { HELLO = false; }
        return;
    }
    if SEND_ANSWER {
        OUT.s(b"{\"type\":\"answer\",\"id\":").q(fld(rec(CUR), 0), 0).s(b",\"text\":").q(&OTXT[..OTLEN], 2).s(b"}");
        if BRIDGE.send(OUT.bytes()) { SEND_ANSWER = false; }
    }
}

// ---------- drawing ----------
unsafe fn button(label_: &[u8], enabled: bool) -> (i32, i32) {
    let (x, y, w, h) = (170, 400, 300, 44);
    if enabled { stroke_round_rect(x, y, w, h, 12, 3, 15); } else { stroke_round_rect(x, y, w, h, 12, 2, 5); }
    raw(x, y + 8, w, if enabled { 15 } else { 6 }, F24, 1, label_);
    (x - 16, y + h / 2)
}
unsafe fn render() {
    DIRTY = false; SINCE_DRAW = 0;
    begin();
    raw(24, 42, 300, 15, F24, 0, b"RIPEAM TUTOR");
    let status: &[u8] = if !BLE { b"sem iPhone" } else if !online() { b"abra o app no iPhone" } else if REVISIT && SCR == S::Ask { "revisão".as_bytes() } else { b"" };
    raw(330, 46, 286, 9, F18, 2, status);
    let cur;
    let q = fld(rec(CUR), 2);
    match SCR {
        S::Ask => {
            raw(24, 82, 300, 9, F18, 0, b"Question:");
            para(24, 106, 592, 15, F24, q, 9);
            let msg: &[u8] = match MSG {
                1 => "Sem conexão com o iPhone: a transcrição roda no iPhone.".as_bytes(),
                2 => "A transcrição não iniciou. Toque para tentar de novo.".as_bytes(),
                3 => "Nada foi captado. Toque e fale sua resposta.".as_bytes(),
                _ => if online() && !AI_READY { "Configure a IA no app do iPhone para avaliar.".as_bytes() } else { b"" },
            };
            label(24, 368, 592, 11, F18, 1, msg);
            cur = Some(button(b"Speak Answer", true));
        }
        S::Rec | S::Eval => {
            let n = para(24, 82, 592, 12, F18, q, 3) as i32;
            let y = 86 + n * 22;
            if SCR == S::Rec {
                fill_circle(36, y + 16, 9, if (CLOCK / 500) % 2 == 0 { 15 } else { 5 });
                let mut b = [0u8; 32];
                let mut k = 0;
                put(&mut b, &mut k, b"Listening  ");
                let s = REC_MS / 1000;
                let d = [b'0' + (s / 60 % 10) as u8, b':', b'0' + (s % 60 / 10) as u8, b'0' + (s % 10) as u8];
                put(&mut b, &mut k, &d);
                raw(54, y + 2, 400, 15, F24, 0, &b[..k]);
            } else {
                raw(24, y + 2, 592, 15, F24, 0, b"Evaluating...");
            }
            // Transcript: finished text plus live partial, newest lines shown.
            CLEN = 0;
            let otxt = OTXT;
            put(&mut CORR, &mut CLEN, &otxt[..OTLEN]);
            if PARTN > 0 { put(&mut CORR, &mut CLEN, b" "); let part = PART; put(&mut CORR, &mut CLEN, &part[2..2 + PARTN]); }
            PLN = wrap(&CORR[..CLEN], F18, 592, &mut PL);
            let ty = y + 40;
            let room = ((392 - ty) / 22).max(0) as usize;
            if PLN == 0 { raw(24, ty, 592, 8, F18, 0, if SCR == S::Rec { b"Speak now..." } else { b"" }); }
            lines(24, ty, 592, 11, F18, &CORR[..CLEN], &PL[..PLN], PLN.saturating_sub(room), room);
            cur = Some(button(if SCR == S::Rec { b"Send Answer" } else { b"Evaluating" }, SCR == S::Rec));
        }
        S::Result => {
            let name: &[u8] = match VERDICT { 0 => b"Result: Correct", 1 => b"Result: Partial", 2 => b"Result: Incorrect", _ => b"Result: Not verified" };
            match VERDICT { 0 => check(24, 82, 15), 2 => cross(24, 82, 15), _ => {} }
            raw(if VERDICT == 0 || VERDICT == 2 { 64 } else { 24 }, 76, 552, 15, F32, 0, name);
            raw(24, 122, 300, 9, F18, 0, b"Correction:");
            // Reference block sits above the button; correction scrolls above it.
            let r = fld(rec(CUR), 4);
            let mut rb = [0u8; 160];
            let mut rn = 0;
            put(&mut rb, &mut rn, b"Reference: ");
            put(&mut rb, &mut rn, r);
            let mut rl = [(0u16, 0u16); 3];
            let rcount = wrap(&rb[..rn], F18, 592, &mut rl);
            let ref_y = 392 - rcount as i32 * 22;
            lines(24, ref_y, 592, 15, F18, &rb[..rn], &rl, 0, rcount);
            let top = 146;
            VIS = (((ref_y - 6) - top) / 22).max(1) as usize;
            if SCROLL + VIS > PLN { SCROLL = PLN.saturating_sub(VIS); }
            lines(24, top, 592, 13, F18, &CORR[..CLEN], &PL[..PLN], SCROLL, VIS);
            if SCROLL > 0 { arrow_up(620, top); }
            if SCROLL + VIS < PLN { arrow_down(620, ref_y - 14); }
            cur = Some(button(b"Next Question", true));
        }
    }
    match cur { Some((x, y)) => content::cursor(x, y, true), None => content::cursor(0, 0, false) }
    present();
}

// ---------- exports ----------
#[no_mangle]
pub unsafe extern "C" fn app_init() {
    BRIDGE = companion::Companion::new(APP);
    SEED = (now_ms() as u32) ^ 0x9E37_79B9;
    if SEED == 0 { SEED = 1; }
    CUR = rnd() as usize % bank::N;
    ASKED = 0;
    next_question();
    HELLO = true; DIRTY = true;
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
        let was = (BLE, online());
        let mut b = [0u8; 10];
        if device_status(b.as_mut_ptr(), 10) == 10 { BLE = b[3] != 0; }
        if was != (BLE, online()) { DIRTY = true; }
    }
    svc_tick(dt);
    if matches!(SCR, S::Rec | S::Eval) && SINCE_DRAW >= 500 { DIRTY = true; }
    pump();
    if DIRTY { render(); }
}

#[no_mangle]
pub unsafe extern "C" fn app_event(e: i32) {
    match e {
        0 => match SCR {
            S::Ask => start_rec(),
            S::Rec => finish_rec(),
            S::Eval => {}
            S::Result => next_question(),
        },
        1 | 2 => if SCR == S::Result {
            let d: i32 = if e == 1 { -3 } else { 3 };
            SCROLL = (SCROLL as i32 + d).clamp(0, PLN.saturating_sub(VIS) as i32) as usize;
        },
        9 | 10 => {
            if content::sidebar_open() || content::overlay_visible() { return; }
            if LONG_EVER && CLOCK.wrapping_sub(LAST_LONG) <= 1200 { return; }
            LAST_LONG = CLOCK; LONG_EVER = true;
            match SCR {
                S::Ask => next_question(),                                 // skip
                S::Rec => { stop_capture(); OTLEN = 0; SCR = S::Ask; }    // cancel
                S::Eval => { SEND_ANSWER = false; SCR = S::Ask; }          // give up waiting
                S::Result => {}
            }
        }
        _ => return,
    }
    render();
}

// Never leave transcription running behind a closed app.
#[no_mangle]
pub unsafe extern "C" fn app_stop() {
    if SCR == S::Rec { ble_send(0x0002, NOTHING.as_ptr(), 0); SCR = S::Ask; }
}
