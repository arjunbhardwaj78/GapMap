# SANDBOX: Milestone 7 browser checks (any subject). Needs both pretend-AI servers:
#   NODE_PATH=dev-tools/standin/node_modules node dev-tools/standin/run-fake-ai.js            (port 3100, AI on)
#   AI_OFF=1 PORT=3101 NODE_PATH=dev-tools/standin/node_modules node dev-tools/standin/run-fake-ai.js   (port 3101, AI off)
import json, urllib.request, glob, os, random
from playwright.sync_api import sync_playwright
fails=[]; errs=[]
def ok(n,c):
    print(('PASS ' if c else 'FAIL ')+n)
    if not c: fails.append(n)
def api(B,method,path,body=None,token=None):
    req=urllib.request.Request(B+'/api'+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
    return json.load(urllib.request.urlopen(req))
def setup(B):
    t=api(B,'POST','/auth/signup',{'username':'teach'+str(random.randint(1000,9999)),'password':'pass1234','name':'Teacher One'}); tt=t['token']
    cls=api(B,'POST','/classes',{'name':'Class 7'},tt)
    studs=[api(B,'POST',f'/classes/{cls["id"]}/students',{'name':n,'roll':str(i+1),'pin':'1234'},tt) for i,n in enumerate(['Asha','Ravi'])]
    return t,tt,cls,studs
exe=os.environ.get('CHROME') or (glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')+['/opt/pw-browsers/chromium'])[0]
os.makedirs('/tmp/claude-0/shots',exist_ok=True)
with sync_playwright() as p:
    br=p.chromium.launch(executable_path=exe,args=['--no-sandbox'])
    def newpage(B,tok,user,w=1100):
        ctx=br.new_context(viewport={'width':w,'height':900})
        pg=ctx.new_page()
        pg.on('response',lambda r: errs.append('HTTP %s %s'%(r.status,r.url)) if r.status>=500 else None)
        pg.on('pageerror',lambda e: errs.append('PAGEERR '+str(e)))
        pg.on('console',lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
        pg.goto(B+'/'); pg.evaluate("([t,u])=>{sessionStorage.setItem('gm_token',t);sessionStorage.setItem('gm_user',JSON.stringify(u))}",[tok,user])
        pg.goto(B+'/#/'+('t' if user.get('role')=='teacher' else 's')); pg.reload(); pg.wait_for_timeout(500)
        return ctx,pg
    def go(pg,B,h): pg.goto(B+'/#/'+h); pg.reload(); pg.wait_for_timeout(600)

    # ================= AI ON: Biology quiz from a topic =================
    B='http://localhost:3100'; t,tt,cls,studs=setup(B); cid=cls['id']
    ctx,pg=newpage(B,tt,t['user'])
    go(pg,B,f't/c/{cid}/quizzes')
    body=pg.inner_text('body')
    ok('form asks for any subject, not only maths', pg.locator('#qs').count()==1 and 'any subject' in body.lower())
    pg.fill('#qs','Biology'); pg.fill('#qt','photosynthesis'); pg.locator('button:has-text("Make a draft quiz")').first.click(); pg.wait_for_timeout(1500)
    body=pg.inner_text('body')
    ok('teacher gets a draft Biology quiz (3 questions)', 'Draft' in body and pg.locator('.qrow').count()==3)
    ok('draft shows the mistaken ideas to check, with counts', 'Mistaken ideas in this quiz' in body and 'Thinks plants breathe like animals (2)' in body)
    ok('each wrong option shows its mistaken idea', 'Mistaken idea: Thinks plants breathe like animals' in body and 'Mistaken idea: Mixes up making food' in body)
    ok('AI key is labelled so the teacher checks it', 'AI-written answer key' in body)
    pg.screenshot(path='/tmp/claude-0/shots/m7-draft.png')
    pg.locator('button:has-text("Publish to every student")').click(); pg.wait_for_timeout(1000)
    ok('quiz published', 'Open for students' in pg.inner_text('body'))
    quiz_url=pg.url; qid=quiz_url.rstrip('/').split('/')[-1]
    ctx.close()

    # ---- student attempts: picks the "breathe like animals" option on Q1 and Q2 ----
    sl=api(B,'POST','/auth/login',{'username':studs[0]['login']['username'],'password':'1234','role':'student'})
    ctx,pg=newpage(B,sl['token'],sl['user'])
    go(pg,B,f's/quiz/{qid}')
    body=pg.inner_text('body')
    ok('before attempting the student sees NO mistaken-idea text', 'Thinks plants breathe' not in body and 'Mistaken idea' not in body and 'Looks like' not in body)
    for i in (0,1): pg.locator('.qrow').nth(i).locator('label.opt').nth(1).click()
    pg.locator('.qrow').nth(2).locator('label.opt').nth(0).click()
    pg.locator('button:has-text("Submit")').click(); pg.wait_for_timeout(1000)
    body=pg.inner_text('body')
    ok('score shown', 'You scored 1 out of 3' in body)
    ok('"Your problem" card names the mistaken idea (likely)', 'Your problem' in body and 'Thinks plants breathe like animals' in body and 'Likely' in body)
    ok('wrong answers show "Looks like"', body.count('Looks like: Thinks plants breathe like animals')==2)
    ok('never says "Nice work" or "diagnosed"', 'nice work' not in body.lower() and 'diagnosed' not in body.lower())
    pg.screenshot(path='/tmp/claude-0/shots/m7-student-problem.png')
    pg.locator('button:has-text("Help me with this")').click(); pg.wait_for_timeout(1200)
    body=pg.inner_text('body')
    ok('help opens with an AI-labelled explanation and a facts warning', 'PRETEND concept step one' in body and 'AI explanation' in body and 'cannot check facts' in body)
    pg.screenshot(path='/tmp/claude-0/shots/m7-help.png')
    pg.locator('button:has-text("Close")').click(); pg.wait_for_timeout(300)
    ctx.close()

    # ---- second student gets only 1 wrong tagged answer -> suspected ----
    sl2=api(B,'POST','/auth/login',{'username':studs[1]['login']['username'],'password':'1234','role':'student'})
    api(B,'POST',f'/student/quizzes/{qid}/submit',{'answers':{'1':1,'2':0,'3':0}},sl2['token'])

    # ---- teacher sees class patterns ----
    ctx,pg=newpage(B,tt,t['user'])
    go(pg,B,f't/q/{qid}'); body=pg.inner_text('body')
    ok('teacher sees "Mistake patterns in this class"', 'Mistake patterns in this class' in body)
    ok('likely student listed (Asha), suspected student listed (Ravi)', 'Likely: Asha' in body and 'Suspected: Ravi' in body)
    pg.screenshot(path='/tmp/claude-0/shots/m7-teacher-patterns.png')
    ctx.close()

    # ================= AI OFF: typed multiple-choice, History =================
    B='http://localhost:3101'; t,tt,cls,studs=setup(B); cid=cls['id']
    ctx,pg=newpage(B,tt,t['user'])
    go(pg,B,f't/c/{cid}/quizzes')
    pg.fill('#qs','History'); pg.fill('#qt','Mughal empire'); pg.locator('button:has-text("Make a draft quiz")').first.click(); pg.wait_for_timeout(1200)
    body=pg.inner_text('body')
    ok('AI off + History: clear message telling how to type questions (not a dead end)', 'type your own multiple-choice' in body.lower() and 'not available' not in body.lower())
    typed = "Who founded the Mughal empire?\n*Babur\nAkbar | Mixes up the founder with the greatest ruler\nHumayun\nShah Jahan | Mixes up the founder with the greatest ruler\n\nWhich ruler built the Taj Mahal?\n*Shah Jahan\nBabur\nAkbar | Mixes up the founder with the greatest ruler\nAurangzeb"
    pg.fill('#qm',typed); pg.locator('button:has-text("Make a draft quiz")').nth(1).click(); pg.wait_for_timeout(1200)
    body=pg.inner_text('body')
    ok('typed History quiz becomes a draft with 2 questions', 'Draft' in body and pg.locator('.qrow').count()==2)
    ok('typed questions are labelled "Typed by you", not "AI-written"', 'Typed by you' in body and 'AI-written answer key' not in body)
    ok('tag list counts the shared mistaken idea twice', 'Mixes up the founder with the greatest ruler (3)' in body)
    pg.screenshot(path='/tmp/claude-0/shots/m7-typed-history.png')
    ok('bad typed text shows the helpful problem', True)
    go(pg,B,f't/c/{cid}/quizzes'); pg.fill('#qm','Only a question\n*A\nB'); pg.locator('button:has-text("Make a draft quiz")').nth(1).click(); pg.wait_for_timeout(800)
    ok('bad typed text shows what to fix', 'exactly 4 options' in pg.inner_text('body'))
    ctx.close()

    # ================= phone width: form does not overflow =================
    B='http://localhost:3100'; t,tt,cls,studs=setup(B)
    ctx,pg=newpage(B,tt,t['user'],w=390)
    go(pg,B,f't/c/{cls["id"]}/quizzes')
    over=pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    ok('phone width: no sideways scrolling on the quiz form', over<=1)
    pg.screenshot(path='/tmp/claude-0/shots/m7-phone.png',full_page=True)
    ctx.close(); br.close()
ok('no browser console or page errors', not errs); 
for e in sorted(set(errs)): print('  ',e)
print('\nFAILED:',fails) if fails else print('\nALL BROWSER CHECKS PASSED')
