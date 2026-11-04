//! Minimal, allocation-free reader/writer for the companion's flat JSON
//! messages. Only top-level keys are looked up; nested values are skipped.
#![allow(dead_code)]

fn ws(b: &[u8], i: &mut usize) { while *i < b.len() && matches!(b[*i], b' ' | b'\n' | b'\r' | b'\t') { *i += 1; } }

fn skip_str(b: &[u8], i: usize) -> Option<usize> {
    let mut j = i + 1;
    while j < b.len() {
        match b[j] { b'\\' => j += 2, b'"' => return Some(j + 1), _ => j += 1 }
    }
    None
}

fn skip_val(b: &[u8], i: usize) -> Option<usize> {
    if i >= b.len() { return None; }
    if b[i] == b'"' { return skip_str(b, i); }
    if b[i] == b'{' || b[i] == b'[' {
        let (mut depth, mut j) = (0i32, i);
        while j < b.len() {
            match b[j] {
                b'"' => { j = skip_str(b, j)?; continue; }
                b'{' | b'[' => depth += 1,
                b'}' | b']' => { depth -= 1; if depth == 0 { return Some(j + 1); } }
                _ => {}
            }
            j += 1;
        }
        return None;
    }
    let mut j = i;
    while j < b.len() && !matches!(b[j], b',' | b'}' | b']' | b' ' | b'\n' | b'\r' | b'\t') { j += 1; }
    Some(j)
}

/// Raw value of a top-level key (strings keep their quotes).
pub fn get<'a>(b: &'a [u8], key: &[u8]) -> Option<&'a [u8]> {
    let mut i = 0;
    ws(b, &mut i);
    if i >= b.len() || b[i] != b'{' { return None; }
    i += 1;
    loop {
        ws(b, &mut i);
        if i >= b.len() || b[i] != b'"' { return None; }
        let ke = skip_str(b, i)?;
        let k = &b[i + 1..ke - 1];
        i = ke;
        ws(b, &mut i);
        if i >= b.len() || b[i] != b':' { return None; }
        i += 1;
        ws(b, &mut i);
        let ve = skip_val(b, i)?;
        if k == key { return Some(&b[i..ve]); }
        i = ve;
        ws(b, &mut i);
        if i < b.len() && b[i] == b',' { i += 1; continue; }
        return None;
    }
}

pub fn int(v: Option<&[u8]>, default: i32) -> i32 {
    let v = match v { Some(v) if !v.is_empty() => v, _ => return default };
    let (neg, digits) = if v[0] == b'-' { (true, &v[1..]) } else { (false, v) };
    if digits.is_empty() || !digits[0].is_ascii_digit() { return default; }
    let mut n: i32 = 0;
    for &c in digits { if !c.is_ascii_digit() { break; } n = n.saturating_mul(10).saturating_add((c - b'0') as i32); }
    if neg { -n } else { n }
}

fn hex4(b: &[u8]) -> Option<u32> {
    if b.len() < 4 { return None; }
    let mut v = 0u32;
    for &c in &b[..4] {
        v = v * 16 + match c { b'0'..=b'9' => c - b'0', b'a'..=b'f' => c - b'a' + 10, b'A'..=b'F' => c - b'A' + 10, _ => return None } as u32;
    }
    Some(v)
}

/// Decode a quoted JSON string into `out`; stops at a whole character when full.
pub fn unescape(v: Option<&[u8]>, out: &mut [u8]) -> usize {
    let v = match v { Some(v) if v.len() >= 2 && v[0] == b'"' => &v[1..v.len() - 1], _ => return 0 };
    let (mut i, mut n) = (0usize, 0usize);
    while i < v.len() {
        let mut cp: u32;
        let c = v[i];
        if c == b'\\' && i + 1 < v.len() {
            i += 2;
            cp = match v[i - 1] {
                b'n' => 10, b't' => 9, b'r' => 13, b'b' => 8, b'f' => 12,
                b'u' => {
                    let h = match hex4(&v[i..]) { Some(h) => h, None => break };
                    i += 4;
                    h
                }
                other => other as u32,
            };
            if (0xD800..0xDC00).contains(&cp) && i + 6 <= v.len() && v[i] == b'\\' && v[i + 1] == b'u' {
                if let Some(lo) = hex4(&v[i + 2..]) {
                    if (0xDC00..0xE000).contains(&lo) { cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00); i += 6; }
                }
            }
            let mut tmp = [0u8; 4];
            let len = match char::from_u32(cp) { Some(ch) => ch.encode_utf8(&mut tmp).len(), None => 0 };
            if n + len > out.len() { break; }
            out[n..n + len].copy_from_slice(&tmp[..len]);
            n += len;
        } else {
            // Copy raw UTF-8 sequences whole.
            let len = if c < 0x80 { 1 } else if c >= 0xF0 { 4 } else if c >= 0xE0 { 3 } else { 2 };
            let len = len.min(v.len() - i);
            if n + len > out.len() { break; }
            out[n..n + len].copy_from_slice(&v[i..i + len]);
            n += len;
            i += len;
        }
    }
    n
}

/// Fixed-capacity JSON writer. `ok` turns false if anything was truncated.
pub struct W<const N: usize> { pub b: [u8; N], pub n: usize, pub ok: bool }
impl<const N: usize> W<N> {
    pub const fn new() -> Self { Self { b: [0; N], n: 0, ok: true } }
    pub fn clear(&mut self) { self.n = 0; self.ok = true; }
    pub fn s(&mut self, v: &[u8]) -> &mut Self {
        if self.n + v.len() > N { self.ok = false; return self; }
        self.b[self.n..self.n + v.len()].copy_from_slice(v);
        self.n += v.len();
        self
    }
    pub fn num(&mut self, mut v: u32) -> &mut Self {
        let mut t = [0u8; 10];
        let mut k = 10;
        loop { k -= 1; t[k] = b'0' + (v % 10) as u8; v /= 10; if v == 0 { break; } }
        self.s(&t[k..])
    }
    /// Quoted, escaped string; truncated at a character boundary if needed,
    /// leaving `reserve` bytes free for the rest of the message.
    pub fn q(&mut self, v: &[u8], reserve: usize) -> &mut Self {
        self.s(b"\"");
        let mut i = 0;
        while i < v.len() {
            let c = v[i];
            let len = if c < 0x80 { 1 } else if c >= 0xF0 { 4 } else if c >= 0xE0 { 3 } else if c >= 0xC0 { 2 } else { 1 };
            let need = if c == b'"' || c == b'\\' { 2 } else if c < 0x20 { 6 } else { len };
            if self.n + need + 1 + reserve > N { break; }
            if c == b'"' || c == b'\\' { self.b[self.n] = b'\\'; self.b[self.n + 1] = c; self.n += 2; i += 1; }
            else if c < 0x20 {
                const H: &[u8; 16] = b"0123456789abcdef";
                let e = [b'\\', b'u', b'0', b'0', H[(c >> 4) as usize], H[(c & 15) as usize]];
                self.b[self.n..self.n + 6].copy_from_slice(&e); self.n += 6; i += 1;
            } else {
                let len = len.min(v.len() - i);
                self.b[self.n..self.n + len].copy_from_slice(&v[i..i + len]); self.n += len; i += len;
            }
        }
        self.s(b"\"")
    }
    pub fn bytes(&self) -> &[u8] { &self.b[..self.n] }
}
