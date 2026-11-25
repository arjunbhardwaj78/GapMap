import glob, os
from playwright.sync_api import sync_playwright
exe=(glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')+['/opt/pw-browsers/chromium'])[0]
B='http://localhost:3100'
MOCK='''
(()=>{const mk=()=>{const store={};const fn=function(){return mk()};return new Proxy(fn,{get(t,k){if(k===Symbol.toPrimitive)return()=>0;if(k==='then')return undefined;
 if(k==='traverse')return(cb)=>cb({});if(k==='userData')return store.userData||(store.userData={});if(k in store)return store[k];return store[k]=mk()},
 set(t,k,v){store[k]=v;return true},construct(){return mk()},apply(){return mk()}})};
 const T=new Proxy({},{get(t,k){ if(k==='then')return undefined; if(k==='WebGLRenderer')return function(){this.domElement=document.createElement('canvas');this.n=0;
   this.setClearColor=()=>{};this.setPixelRatio=()=>{};this.setSize=()=>{};this.render=()=>{window.__renders=++this.n};this.dispose=()=>{window.__disposed=1}};
   return mk()}});
 window.THREE=T;})();'''
ok=lambda n,c,*x:print(('PASS ' if c else 'FAIL ')+n)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=exe,args=['--no-sandbox'])
    # A: no three.js at all (no local file, CDN unreachable)
    for url,sel in [('/','#bg3d'),('/site/index.html','#hero3d')]:
        pg=b.new_page(viewport={'width':1280,'height':820}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(B+url); pg.wait_for_timeout(2500)
        ok(f'A {url}: no three.js -> page works, 3D box hidden, no JS errors', pg.evaluate(f"document.querySelector('{sel}').classList.contains('no3d')") and not errs, errs)
        pg.close()
    # B: mocked three.js
    for url,sel in [('/','#bg3d'),('/site/index.html','#hero3d')]:
        pg=b.new_page(viewport={'width':1280,'height':820}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.route('**/vendor/three.min.js',lambda r:r.fulfill(status=200,content_type='application/javascript',body=MOCK))
        pg.goto(B+url); pg.wait_for_timeout(1500)
        ok(f'B {url}: canvas added, animation loop renders', pg.evaluate(f"!!document.querySelector('{sel} canvas') && document.querySelector('{sel}').classList.contains('is-3d')") and (pg.evaluate('window.__renders||0')>5), (errs, pg.evaluate('window.__renders||0')))
        ok(f'B {url}: no JS errors', not errs, errs)
        if url=='/site/index.html':
            pg.mouse.wheel(0,500); pg.wait_for_timeout(600)
            ok('B site: scrolling works with no errors', not errs, errs)
            pg.click('#lang'); pg.wait_for_timeout(200)
            ok('site: language toggle switches to Hindi', 'वजह' in pg.inner_text('h1') and 'Every' not in pg.inner_text('h1'))
            pg.click('#lang'); ok('site: and back to English', 'reason' in pg.inner_text('h1'))
        else:
            pg.click('a.tile.role.blue'); pg.wait_for_timeout(800)
            ok('B app: leaving the landing page frees the 3D scene', pg.evaluate('window.__disposed===1'), errs)
            ok('B app: the sign-in page also has the full-page 3D background', pg.evaluate("!!document.querySelector('#bg3d canvas')") and not errs, errs)
        pg.close()
    # screenshots without 3D (checks layout)
    for name,w,h,url in [('site-d',1280,820,'/site/index.html'),('site-m',390,844,'/site/index.html')]:
        pg=b.new_page(viewport={'width':w,'height':h}); pg.goto(B+url); pg.wait_for_timeout(1200)
        pg.evaluate("document.querySelectorAll('.rv').forEach(e=>e.classList.add('in'))"); pg.screenshot(path=f'/tmp/shots/{name}.png',full_page=True); pg.close()
    b.close()
