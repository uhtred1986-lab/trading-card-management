import json, re, sys, base64, pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
import os
# Folder holding the prototype's built Main/Desktop/FXLab/AdminReview .dc.html files.
PROJ = pathlib.Path(os.environ.get('ARENA_PROTO_DIR', 'project'))
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else HERE / 'out'); OUT.mkdir(parents=True, exist_ok=True)
FONTS = HERE / 'node_modules/@fontsource'

def font_css():
    faces = []
    for w in (700, 800, 900):
        b = (FONTS / f'kanit/files/kanit-latin-{w}-italic.woff2').read_bytes()
        faces.append(f"@font-face{{font-family:'Kanit';font-style:italic;font-weight:{w};src:url(data:font/woff2;base64,{base64.b64encode(b).decode()}) format('woff2')}}")
    for w in (500, 600, 700, 800):
        b = (FONTS / f'barlow-semi-condensed/files/barlow-semi-condensed-latin-{w}-normal.woff2').read_bytes()
        faces.append(f"@font-face{{font-family:'Barlow Semi Condensed';font-style:normal;font-weight:{w};src:url(data:font/woff2;base64,{base64.b64encode(b).decode()}) format('woff2')}}")
    return '\n'.join(faces)

FONT_CSS = font_css()
RUNTIME = (HERE / 'runtime.js').read_text()
SCENES = (HERE / 'scenes.js').read_text()

def parts(path):
    src = path.read_text()
    helmet = re.search(r'<helmet>(.*?)</helmet>', src, re.S).group(1)
    css = '\n'.join(re.findall(r'<style>(.*?)</style>', helmet, re.S))
    xdc = re.search(r'<x-dc>(.*?)</x-dc>', src, re.S).group(1)
    tpl = re.sub(r'<helmet>.*?</helmet>', '', xdc, flags=re.S)
    code = re.search(r'<script type="text/x-dc"[^>]*>(.*?)</script>', src, re.S).group(1)
    return css, tpl, code

def page_html(css, tpl):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{FONT_CSS}</style><style>{css}</style>
<style>html,body{{margin:0}}</style></head><body><div id="app"></div><template id="tpl">{tpl}</template>
<script>{RUNTIME}</script><script>{SCENES}</script></body></html>"""

def shoot(browser, file, w, h, scale, name, js_setup, freeze, outname):
    css, tpl, code = parts(PROJ / file)
    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=scale)
    pg = ctx.new_page()
    pg.set_content(page_html(css, tpl))
    pg.evaluate("code => DC.boot(code, {})", code)
    pg.evaluate(js_setup)
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(80)
    pg.evaluate(f"DC.freeze({freeze})")
    pg.screenshot(path=str(OUT / outname), type='jpeg', quality=86)
    ctx.close()
    print('wrote', outname)

with sync_playwright() as p:
    b = p.chromium.launch()
    names = json.loads(b.new_page().evaluate(SCENES + "\nJSON.stringify(Object.keys(SCENES))"))
    for L, file, w, h, scale in (('phone', 'Main.dc.html', 390, 844, 2), ('desk', 'Desktop.dc.html', 1440, 900, 1)):
        for n in names:
            js = f"""() => {{ const sc = SCENES['{n}']; DC.S((s) => sc.setup(s, '{L}')); DC.render();
                 if (sc.post) {{ sc.post('{L}'); DC.render(); }} }}"""
            fr = b.new_page().evaluate(SCENES + f"\nSCENES['{n}'].freeze")
            shoot(b, file, w, h, scale, n, js, fr, f"{L}-{n}.jpg")
    shoot(b, 'FXLab.dc.html', 1280, 720, 1, 'fx', "() => { DC.S((s) => { s.on = {reveal:true, boom:true, ko:true, life:true, banner:true, clashHit:true}; }); DC.render(); }", 300, 'fx-lab-effects.jpg')
    shoot(b, 'AdminReview.dc.html', 1440, 900, 1, 'admin', "() => { DC.render(); }", 0, 'admin-match-review.jpg')
    b.close()
