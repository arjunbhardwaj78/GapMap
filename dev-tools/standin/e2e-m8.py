# SANDBOX: Milestone 8 browser checks (subject on tests, honest "No pattern found"). Needs run-fake-ai.js on port 3100.
import json, urllib.request, glob, os, random
from playwright.sync_api import sync_playwright
fails=[]; errs=[]
def ok(n,c):
    print(('PASS ' if c else 'FAIL ')+n)
    if not c: fails.append(n)
def api(B,method,path,body=None,token=None):
    req=urllib.request.Request(B+'/api'+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
    return json.load(urllib.request.urlopen(req))
exe=os.environ.get('CHROME') or (glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')+['/opt/pw-browsers/chromium'])[0]
B='http://localhost:3100'
t=api(B,'POST','/auth/signup',{'username':'teach'+str(random.randint(1000,9999)),'password':'pass1234','name':'Teacher One'}); tt=t['token']
cls=api(B,'POST','/classes',{'name':'Class 7'},tt); cid=cls['id']
stud=api(B,'POST',f'/classes/{cid}/students',{'name':'Asha','roll':'1','pin':'1234'},tt)
with sync_playwright() as p:
    br=p.chromium.launch(executable_path=exe,args=['--no-sandbox'])
    ctx=br.new_context(viewport={'width':1100,'height':900}); pg=ctx.new_page()
    pg.on('pageerror',lambda e: errs.append('PAGEERR '+str(e)))
    pg.on('console',lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
    pg.goto(B+'/'); pg.evaluate("([t,u])=>{sessionStorage.setItem('gm_token',t);sessionStorage.setItem('gm_user',JSON.stringify(u))}",[tt,t['user']])
    pg.goto(B+'/#/t'); pg.reload(); pg.wait_for_timeout(500)
    def go(h): pg.goto(B+'/#/'+h); pg.reload(); pg.wait_for_timeout(700)
    go(f't/c/{cid}/tests/new')
    ok('subject box is on the new-test form and accepts any subject', pg.locator('#sj').count()==1 and pg.locator('#sjList option[value="Science"]').count()==1)
    pg.fill('#sj','Biology'); pg.wait_for_timeout(300)
    body=pg.inner_text('body')
    ok('Biology (typed, not in a fixed list): offers a multiple-choice paper test (M10)', 'multiple-choice test' in body and pg.locator('a:has-text("Make a Biology multiple-choice test")').count()==1)
    ok('Biology: Create test button is disabled', pg.locator('button:has-text("Create test")').is_disabled())
    pg.fill('#sj','Maths'); pg.wait_for_timeout(300)
    ok('Maths: Create test works again', pg.locator('button:has-text("Create test")').is_enabled())
    # honest label when no pattern fits
    a=api(B,'POST',f'/classes/{cid}/assessments',{'title':'Fractions check','subject':'Maths','expressions':['1/2+1/3','2/5+1/5']},tt)
    r=api(B,'POST',f'/assessments/{a["id"]}/typed',{'studentId':stud['id'],'answers':{'Q1':'9','Q2':'3/5'}},tt)
    go(f't/s/{r["submissionId"]}')
    body=pg.inner_text('body')
    ok('wrong answer with no pattern says "No pattern found"', 'No pattern found' in body)
    ok('it does NOT say "AI suggestion (unverified)" when nothing was suggested', 'AI suggestion (unverified)' not in body)
    ok('it tells the teacher to look at it', 'look at it yourself' in body)
    go(f't/c/{cid}/tests')
    ok('tests list shows the subject', 'Maths' in pg.inner_text('body'))
    ok('no browser console or page errors', not errs)
    if errs: print(errs[:5])
    br.close()
print('ALL BROWSER CHECKS PASSED' if not fails else 'FAILED: %s'%fails)
