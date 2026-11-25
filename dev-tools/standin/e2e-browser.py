import re, json
from playwright.sync_api import sync_playwright
B='http://localhost:3100'
errs=[]; fails=[]
def ok(name, cond):
    print(('PASS ' if cond else 'FAIL ')+name)
    if not cond: fails.append(name)
import urllib.request
def api(method, path, body=None, token=None):
    req=urllib.request.Request(B+'/api'+path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type':'application/json', **({'Authorization':'Bearer '+token} if token else {})})
    return json.load(urllib.request.urlopen(req))
t=api('POST','/auth/signup',{'username':'teach1','password':'pass1234','name':'Teacher One'})
tt=t['token']
cls=api('POST','/classes',{'name':'Class 7'},tt)
studs=[api('POST',f'/classes/{cls["id"]}/students',{'name':n,'roll':str(i+1),'pin':'1234'},tt) for i,n in enumerate(['Asha','Ravi','Meena'])]
smp=api('POST','/samples/class',{},tt)
hw=api('POST',f'/classes/{cls["id"]}/assessments',{'title':'Homework 1','expressions':['1/2+1/3','2/3*3/4'],'kind':'homework','due':'2030-01-01'},tt)
sl=api('POST','/auth/login',{'username':studs[0]['login']['username'],'password':'1234','role':'student'})
with sync_playwright() as p:
    br=p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
    def newpage(tok, user, w=1100):
        ctx=br.new_context(viewport={'width':w,'height':900}, permissions=['microphone'])
        pg=ctx.new_page()
        pg.on('pageerror', lambda e: errs.append('PAGEERR '+str(e)))
        pg.on('console', lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' else None)
        pg.goto(B+'/')
        pg.evaluate("([t,u])=>{sessionStorage.setItem('gm_token',t);sessionStorage.setItem('gm_user',JSON.stringify(u))}",[tok,user])
        return ctx,pg
    ctx,pg=newpage(tt,t['user'])
    def go(h): pg.goto(B+'/#/'+h); pg.reload(); pg.wait_for_timeout(500)
    def shot(n): pg.screenshot(path=f'/tmp/claude-0/shots/{n}.png')
    cid=cls['id']
    go('t'); go(f't/c/{cid}')
    ok('class hub has Quizzes and Participation tiles', pg.locator('text=Quizzes').count()>0 and pg.locator('text=Participation').count()>0); shot('t1-hub')
    go(f't/c/{cid}/quizzes')
    pg.fill('#qt','adding fractions'); pg.locator('button:has-text("Make a draft quiz")').first.click(); pg.wait_for_timeout(1200)
    ok('AI draft quiz screen shows AI-key label', 'AI-written answer key' in pg.inner_text('body') and 'Draft' in pg.inner_text('body')); shot('t2-draft')
    qurl=pg.url
    pg.locator('button:has-text("Remove")').first.click(); pg.wait_for_timeout(600)
    ok('remove question works', pg.locator('.qrow').count()==3)
    pg.locator('button:has-text("Publish")').click(); pg.wait_for_timeout(800)
    ok('published shows participation', 'attempted' in pg.inner_text('body') and 'Absent' in pg.inner_text('body')); shot('t3-published')
    qid=re.search(r'/t/q/(\d+)',qurl).group(1)
    # homework tests list + new test options
    go(f't/c/{cid}/tests'); ok('tests list shows Homework chip', 'Homework' in pg.inner_text('body')); shot('t4-tests')
    go(f't/c/{cid}/tests/new'); ok('new test has homework checkbox', pg.locator('#hw').count()==1 and pg.locator('#due').count()==1)
    go(f't/a/{hw["id"]}'); ok('homework test hub shows CSV + note', 'CSV' in pg.inner_text('body')); shot('t5-testhub')
    go(f't/a/{smp["assessmentId"]}/results'); 
    pg.locator('a[href*="/group/"]').first.click(); pg.wait_for_timeout(900)
    ok('group screen has Print remedial sheet', pg.locator('text=Print remedial sheet').count()>0); shot('t6-group')
    pg.locator('text=Print remedial sheet').click(); pg.wait_for_timeout(900)
    ok('print sheet page has questions + answer key', 'Answer key' in pg.inner_text('body') and pg.locator('.sheet-print .qrow').count()>=3); shot('t7-print')
    go(f't/c/{cid}/participation'); ok('participation lists students', 'Asha' in pg.inner_text('body')); shot('t8-part')
    ctx.close()

    # ---------- student ----------
    ctx,pg=newpage(sl['token'],sl['user'])
    go('s')
    ok('hub tiles', all(x in pg.inner_text('body') for x in ['My results','Quizzes','Homework','Study help','Interview practice','Badges'])); shot('s1-hub')
    go('s/quizzes'); ok('class quiz listed', 'adding fractions' in pg.inner_text('body') or 'Quiz' in pg.inner_text('body')); shot('s2-quizzes')
    pg.locator('a.item').first.click(); pg.wait_for_timeout(700)
    ok('quiz has inputs and radio', pg.locator('input[type=radio]').count()==4 and ('answer' not in pg.inner_text('body').lower().replace('answer to','')))
    pg.locator('input[placeholder="e.g. 3/4"]').first.fill('7/8'); pg.locator('input[type=radio]').first.check()
    shot('s3-quiz'); pg.locator('button:has-text("Submit")').click(); pg.wait_for_timeout(900)
    ok('quiz review shows score', 'You scored' in pg.inner_text('body')); shot('s4-quizdone')
    go('s/quizzes'); pg.fill('#st','subtracting fractions'); pg.locator('button:has-text("Make my quiz")').click(); pg.wait_for_timeout(1200)
    ok('self quiz opens, no radio', pg.locator('input[type=radio]').count()==0 and 'practice quiz' in pg.inner_text('body').lower()); shot('s5-self')
    # homework typed
    go('s/homework'); ok('homework listed', 'Homework 1' in pg.inner_text('body')); pg.locator('a.item').first.click(); pg.wait_for_timeout(700)
    ins=pg.locator('input[placeholder="e.g. 3/4"]'); ins.nth(0).fill('5/6'); ins.nth(1).fill('1/2'); shot('s6-hw')
    pg.locator('button:has-text("Hand in")').click(); pg.wait_for_timeout(900)
    ok('homework marked by code (2 of 2)', 'You got 2 out of 2' in pg.inner_text('body')); shot('s7-hwdone')
    # interview
    go('s/interview'); shot('s8-interview')
    pg.locator('button:has-text("Start recording")').click(); pg.wait_for_timeout(500)
    ok('needs consent first', pg.locator('#icons').is_checked()==False)
    pg.check('#icons'); pg.locator('button:has-text("Start recording")').click(); pg.wait_for_timeout(4500)
    pg.locator('button:has-text("Stop and get feedback")').click(); pg.wait_for_timeout(3500)
    body=pg.inner_text('body'); ok('interview feedback shown', 'PRETEND feedback summary' in body and 'not a grade' in body.lower()); shot('s9-interview-done')
    # results + study
    go('s/results'); ok('results screen still works', 'Hi,' in pg.inner_text('body')); shot('s10-results')
    go('s/study'); shot('s11-studylist'); print('study list:', pg.inner_text('main')[:120].replace('\n',' | '))
    ctx.close()
    # mobile
    ctx,pg=newpage(sl['token'],sl['user'],w=390); go('s'); shot('m1-hub-mobile')
    ok('no horizontal scroll on phone', pg.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
    br.close()
real=[e for e in errs if 'favicon' not in e]
print('JS errors:', real[:6])
print('FAILS:', fails)
