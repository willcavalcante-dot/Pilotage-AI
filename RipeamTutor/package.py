#!/usr/bin/env python3
"""Build RIPEAM Tutor: generate bank.rs, compile with the SDK's exact flags,
inline the companion and validate. Usage: python3 RipeamTutor/package.py [out.html]"""
from pathlib import Path
import base64, json, subprocess, sys, tempfile
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / 'CompanionExample'))
from validate import validate_html

def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'dist' / 'RIPEAMTutor.html')
    subprocess.run([sys.executable, str(HERE / 'gen_bank.py')], check=True)
    with tempfile.TemporaryDirectory(prefix='ripeam-tutor-') as d:
        module = Path(d) / 'tutor.wasm'
        subprocess.run(['rustc', str(HERE / 'tutor.rs'), '--edition=2021', '--target=wasm32-unknown-unknown', '--crate-type=cdylib',
            '-C', 'opt-level=z', '-C', 'panic=abort', '-C', 'lto=fat', '-C', 'codegen-units=1', '-C', 'link-arg=--no-entry',
            '-C', 'link-arg=--strip-all', '-C', 'target-feature=-bulk-memory,-bulk-memory-opt,-reference-types',
            '-C', 'link-arg=-zstack-size=8192', '-C', 'link-arg=--initial-memory=65536', '-C', 'link-arg=--max-memory=65536',
            '-A', 'dead_code', '-o', str(module)], check=True)
        wasm = module.read_bytes()
    bank = json.loads((HERE / 'questions.json').read_text(encoding='utf-8'))
    scripts = ['window.RT_BANK=' + json.dumps(bank, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + ';',
               (HERE / 'companion' / 'grade.js').read_text(encoding='utf-8'), (HERE / 'companion' / 'app.js').read_text(encoding='utf-8')]
    html = (HERE / 'companion' / 'index.html').read_text(encoding='utf-8').replace('<!--SCRIPTS-->',
        '\n'.join('<script>' + s + '</script>' for s in scripts) + '\n<script type="application/mira-wasm">' + base64.b64encode(wasm).decode() + '</script>')
    title, size = validate_html(html)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding='utf-8')
    print(f'{out}: {len(html.encode())} bytes HTML, {size} bytes WASM, title {title!r}')

if __name__ == '__main__':
    main()
