#!/usr/bin/env python3
"""Build Pilotage AI: generate the bank module, compile the glasses WASM with the
SDK's exact flags, inline the iPhone companion, then validate the HTML."""
from pathlib import Path
import base64, json, subprocess, sys, tempfile
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'CompanionExample'))
from validate import validate_html

def main():
    output = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'dist' / 'PilotageAI.html')
    subprocess.run([sys.executable, str(ROOT / 'tools' / 'gen_bank.py')], check=True)
    with tempfile.TemporaryDirectory(prefix='pilotage-') as folder:
        module = Path(folder) / 'pilotage.wasm'
        subprocess.run(['rustc', str(ROOT / 'PilotageAI' / 'pilotage.rs'), '--edition=2021', '--target=wasm32-unknown-unknown',
            '--crate-type=cdylib', '-C', 'opt-level=z', '-C', 'panic=abort', '-C', 'lto=fat', '-C', 'codegen-units=1',
            '-C', 'link-arg=--no-entry', '-C', 'link-arg=--strip-all', '-C', 'target-feature=-bulk-memory,-bulk-memory-opt,-reference-types',
            '-C', 'link-arg=-zstack-size=8192', '-C', 'link-arg=--initial-memory=65536', '-C', 'link-arg=--max-memory=65536',
            '-A', 'dead_code', '-o', str(module)], check=True)
        wasm = module.read_bytes()
    comp = ROOT / 'companion'
    bank = json.loads((ROOT / 'bank' / 'starter.json').read_text(encoding='utf-8'))
    bank_js = 'window.PAI_BANK=' + json.dumps(bank, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + ';'
    scripts = [bank_js] + [(comp / n).read_text(encoding='utf-8') for n in ('srs.js', 'evaluate.js', 'layout.js', 'app.js')]
    for s in scripts:
        if '</script' in s.lower():
            raise SystemExit('script content must not contain </script')
    html = (comp / 'index.html').read_text(encoding='utf-8')
    tags = '\n'.join('<script>' + s + '</script>' for s in scripts)
    tags += '\n<script type="application/mira-wasm">' + base64.b64encode(wasm).decode() + '</script>'
    html = html.replace('<!--SCRIPTS-->', tags)
    title, size = validate_html(html)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding='utf-8')
    print(f'{output}: {len(html.encode())} bytes HTML, {size} bytes WASM, title {title!r}')

if __name__ == '__main__':
    main()
