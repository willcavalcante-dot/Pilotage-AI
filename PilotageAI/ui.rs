//! Drawing and text layout for Pilotage AI. The firmware paints each text row
//! literally, so wrapping happens here with the SDK glyph advance tables.
//! `tools/gen_bank.py` mirrors `wrap` exactly to pre-check bundled content.
#![allow(dead_code)]
#[link(wasm_import_module = "mira")]
extern "C" {
    pub fn begin();
    pub fn present();
    fn text(x: i32, y: i32, w: i32, h: i32, c: i32, f: i32, a: i32, s: i32, p: *const u8, n: i32);
    pub fn fill_rect(x: i32, y: i32, w: i32, h: i32, c: i32);
    pub fn fill_round_rect(x: i32, y: i32, w: i32, h: i32, r: i32, c: i32);
    pub fn stroke_round_rect(x: i32, y: i32, w: i32, h: i32, r: i32, s: i32, c: i32);
    pub fn fill_circle(x: i32, y: i32, r: i32, c: i32);
    pub fn stroke_circle(x: i32, y: i32, r: i32, s: i32, c: i32);
    pub fn line(x0: i32, y0: i32, x1: i32, y1: i32, w: i32, c: i32);
    pub fn fill_triangle(x0: i32, y0: i32, x1: i32, y1: i32, x2: i32, y2: i32, c: i32);
}

pub const F24: i32 = 0;
pub const F18: i32 = 1;
pub const F32: i32 = 2;

const ADV18: [u8; 95] = [6,7,8,15,11,17,13,4,7,7,9,15,6,7,6,6,11,11,11,11,11,11,11,11,11,11,6,6,15,15,15,10,18,12,12,13,14,11,10,14,14,6,6,12,10,16,14,14,11,14,13,11,12,14,12,19,13,12,13,7,6,7,15,9,9,10,11,9,11,11,6,11,11,5,5,10,5,17,11,11,11,11,8,8,7,11,11,16,11,11,9,11,6,11,15];
const ADV24: [u8; 95] = [6,7,8,15,13,19,17,4,8,8,12,14,5,7,5,8,15,10,13,12,15,14,14,13,14,14,7,7,14,14,14,12,24,16,15,15,17,14,13,17,18,6,11,15,13,21,18,18,15,18,16,14,14,18,16,24,15,14,15,8,8,8,14,8,6,13,15,12,15,13,9,14,13,5,6,12,4,22,14,14,15,14,9,11,10,14,13,20,12,13,12,8,6,8,14];
const ADV32: [u8; 95] = [8,8,10,19,18,25,22,6,10,10,17,18,7,11,7,10,19,12,17,17,19,18,19,18,20,18,7,7,18,18,18,15,31,22,20,20,22,17,17,22,23,7,15,20,16,27,23,23,19,23,20,18,18,23,21,32,20,20,20,11,10,10,18,10,8,18,19,16,19,18,11,19,19,7,7,16,7,29,19,18,19,19,11,14,12,19,17,27,16,17,16,10,8,11,18];

/// Advance of one byte. Accented Latin letters (2-byte UTF-8) are counted once,
/// on their lead byte, with a conservative width.
pub fn adv(b: u8, font: i32) -> i32 {
    if b >= 0x80 {
        return if b >= 0xC0 { match font { F18 => 11, F32 => 19, _ => 14 } } else { 0 };
    }
    if b < 32 { return 0; }
    let i = (b - 32) as usize;
    (match font { F18 => ADV18[i], F32 => ADV32[i], _ => ADV24[i] }) as i32
}
pub fn width(s: &[u8], font: i32) -> i32 { s.iter().map(|&b| adv(b, font)).sum() }
pub fn lh(font: i32) -> i32 { match font { F18 => 22, F32 => 38, _ => 28 } }

/// Word wrap into (start, end) byte ranges. Mirrored by tools/gen_bank.py.
pub fn wrap(s: &[u8], font: i32, w: i32, out: &mut [(u16, u16)]) -> usize {
    let (mut n, mut i, len) = (0usize, 0usize, s.len());
    while i < len && n < out.len() {
        while i < len && s[i] == b' ' { i += 1; }
        if i >= len { break; }
        let start = i;
        let (mut wd, mut space) = (0i32, 0usize);
        let end;
        loop {
            if i >= len { end = i; break; }
            let b = s[i];
            if b == b'\n' { end = i; i += 1; break; }
            if b == b' ' { space = i; }
            let a = adv(b, font);
            if wd + a > w && i > start {
                if space > start { end = space; i = space + 1; } else { end = i; }
                break;
            }
            wd += a;
            i += 1;
        }
        let mut e = end;
        while e > start && s[e - 1] == b' ' { e -= 1; }
        out[n] = (start as u16, e as u16);
        n += 1;
    }
    n
}

pub unsafe fn raw(x: i32, y: i32, w: i32, gray: i32, font: i32, align: i32, s: &[u8]) {
    if s.is_empty() { return; }
    text(x, y, w, lh(font) + 6, gray, font, align, lh(font), s.as_ptr(), s.len() as i32);
}

static mut TMP: [u8; 160] = [0; 160];
/// One line; ellipsized when wider than `w`.
pub unsafe fn label(x: i32, y: i32, w: i32, gray: i32, font: i32, align: i32, s: &[u8]) {
    if width(s, font) <= w { raw(x, y, w, gray, font, align, s); return; }
    let room = w - width(b"...", font);
    let (mut n, mut wd) = (0usize, 0i32);
    while n < s.len() && n < TMP.len() - 4 {
        let a = adv(s[n], font);
        if wd + a > room { break; }
        wd += a;
        n += 1;
    }
    while n > 0 && n < s.len() && (s[n] & 0xC0) == 0x80 { n -= 1; }
    TMP[..n].copy_from_slice(&s[..n]);
    TMP[n..n + 3].copy_from_slice(b"...");
    raw(x, y, w, gray, font, align, &TMP[..n + 3]);
}

/// Draw already wrapped lines [first, first+count).
pub unsafe fn lines(x: i32, y: i32, w: i32, gray: i32, font: i32, s: &[u8], ls: &[(u16, u16)], first: usize, count: usize) {
    let h = lh(font);
    for k in first..(first + count).min(ls.len()) {
        let (a, b) = ls[k];
        raw(x, y + (k - first) as i32 * h, w, gray, font, 0, &s[a as usize..b as usize]);
    }
}

/// Wrap and draw at most `max` lines; returns lines drawn.
pub unsafe fn para(x: i32, y: i32, w: i32, gray: i32, font: i32, s: &[u8], max: usize) -> usize {
    let mut ls = [(0u16, 0u16); 16];
    let n = wrap(s, font, w, &mut ls).min(max);
    lines(x, y, w, gray, font, s, &ls[..n], 0, n);
    n
}

pub unsafe fn check(x: i32, y: i32, gray: i32) {
    line(x, y + 14, x + 10, y + 24, 4, gray);
    line(x + 10, y + 24, x + 28, y + 2, 4, gray);
}
pub unsafe fn cross(x: i32, y: i32, gray: i32) {
    line(x + 2, y + 2, x + 24, y + 24, 4, gray);
    line(x + 24, y + 2, x + 2, y + 24, 4, gray);
}
pub unsafe fn arrow_up(x: i32, y: i32) { fill_triangle(x - 7, y + 7, x + 7, y + 7, x, y, 8); }
pub unsafe fn arrow_down(x: i32, y: i32) { fill_triangle(x - 7, y, x + 7, y, x, y + 7, 8); }

/// Vessel signal diagram: "L:RWR" all-round lights (top to bottom) or
/// "S:BDB" day shapes (B ball, D diamond, C cylinder, U/N cone apex up/down,
/// X two cones apex to apex). Colours are lettered because the display is
/// grayscale. Returns false for an unknown figure string.
pub unsafe fn figure(cx: i32, top: i32, fig: &[u8], en: bool) -> bool {
    if fig.len() < 3 || fig[1] != b':' { return false; }
    let items = &fig[2..];
    let step = 52;
    let bottom = top + items.len() as i32 * step + 8;
    line(cx, top - 10, cx, bottom, 2, 6);
    line(cx - 46, bottom, cx + 46, bottom, 3, 6);
    for (k, &c) in items.iter().enumerate() {
        let y = top + 18 + k as i32 * step;
        if fig[0] == b'L' {
            let letter: &[u8] = match (c, en) {
                (b'W', false) => b"B", (b'R', false) => b"E", (b'G', false) => b"V", (b'Y', false) => b"A",
                (b'W', true) => b"W", (b'R', true) => b"R", (b'G', true) => b"G", _ => b"Y",
            };
            if c == b'W' {
                fill_circle(cx, y, 19, 15);
                raw(cx - 19, y - 12, 38, 0, F18, 1, letter);
            } else {
                fill_circle(cx, y, 19, 0);
                stroke_circle(cx, y, 19, 3, 15);
                raw(cx - 19, y - 12, 38, 15, F18, 1, letter);
            }
        } else {
            match c {
                b'B' => fill_circle(cx, y, 17, 15),
                b'D' => { fill_triangle(cx - 17, y, cx + 17, y, cx, y - 22, 15); fill_triangle(cx - 17, y, cx + 17, y, cx, y + 22, 15); }
                b'C' => fill_rect(cx - 13, y - 20, 26, 40, 15),
                b'U' => fill_triangle(cx - 18, y + 16, cx + 18, y + 16, cx, y - 18, 15),
                b'N' => fill_triangle(cx - 18, y - 16, cx + 18, y - 16, cx, y + 18, 15),
                b'X' => { fill_triangle(cx - 17, y - 24, cx + 17, y - 24, cx, y, 15); fill_triangle(cx - 17, y + 24, cx + 17, y + 24, cx, y, 15); }
                _ => return false,
            }
        }
    }
    if fig[0] == b'L' {
        let legend: &[u8] = if en { b"W white R red G green" } else { b"B branca E encarnada V verde" };
        para(cx - 70, bottom + 8, 140, 9, F18, legend, 3);
    }
    true
}
