# SANDBOX: Milestone 6 browser checks. Needs both pretend-AI servers:
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
    br=p.chromium.launch(executable_path=exe,args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
    def newpage(B,tok,user,w=1100):
        ctx=br.new_context(viewport={'width':w,'height':900},permissions=['microphone','camera'])
        pg=ctx.new_page()
        pg.on('pageerror',lambda e: errs.append('PAGEERR '+str(e)))
        pg.on('console',lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' and 'favicon' not in m.text else None)
        pg.goto(B+'/'); pg.evaluate("([t,u])=>{sessionStorage.setItem('gm_token',t);sessionStorage.setItem('gm_user',JSON.stringify(u))}",[tok,user])
        pg.goto(B+'/#/'+('t' if user.get('role')=='teacher' else 's')); pg.reload(); pg.wait_for_timeout(500)
        return ctx,pg
    def go(pg,B,h): pg.goto(B+'/#/'+h); pg.reload(); pg.wait_for_timeout(600)
    # ---------- AI OFF: quizzes must still work ----------
    B='http://localhost:3101'; t,tt,cls,studs=setup(B); cid=cls['id']
    ctx,pg=newpage(B,tt,t['user'])
    go(pg,B,f't/c/{cid}/quizzes'); pg.fill('#qt','adding fractions'); pg.locator('button:has-text("Make a draft quiz")').first.click(); pg.wait_for_timeout(1500)
    body=pg.inner_text('body')
    ok('AI off: teacher still gets a draft quiz', 'Draft' in body and pg.locator('.qrow').count()>=3)
    ok('AI off: reason is shown (key missing + built-in bank)', 'key is missing' in body.lower() and 'built-in' in body.lower()); pg.screenshot(path='/tmp/claude-0/shots/m6-off-teacher.png')
    ok('AI off: no "AI not available" dead end', 'not available' not in body.lower() and 'not set up' not in body.lower())
    ctx.close()
    sl=api(B,'POST','/auth/login',{'username':studs[0]['login']['username'],'password':'1234','role':'student'})
    ctx,pg=newpage(B,sl['token'],sl['user'])
    go(pg,B,'s/quizzes'); pg.fill('input[type=text], input:not([type])','subtracting fractions') if False else None
    inp=pg.locator('input').first; inp.fill('subtracting fractions'); pg.locator('button:has-text("Make")').first.click(); pg.wait_for_timeout(1500)
    body=pg.inner_text('body'); ok('AI off: student own practice quiz is made and explained', pg.locator('.qrow').count()>=2 and 'built-in' in body.lower()); pg.screenshot(path='/tmp/claude-0/shots/m6-off-student.png')
    go(pg,B,'s/interview'); pg.check('#icons'); pg.locator('button:has-text("Start recording")').click(); pg.wait_for_timeout(4500); pg.locator('button:has-text("Stop and get feedback")').click(); pg.wait_for_timeout(2500)
    body=pg.inner_text('body'); ok('AI off: interview says clearly what is needed (no vague text)', 'GEMINI_API_KEY' in body)
    ctx.close()
    # ---------- AI ON: interview voice + video ----------
    B='http://localhost:3100'; t,tt,cls,studs=setup(B); cid=cls['id']
    sl=api(B,'POST','/auth/login',{'username':studs[0]['login']['username'],'password':'1234','role':'student'})
    ctx,pg=newpage(B,sl['token'],sl['user'])
    go(pg,B,'s/interview'); pg.screenshot(path='/tmp/claude-0/shots/m6-interview-modes.png')
    ok('interview offers Voice only and Video', pg.locator('#imode-voice').count()==1 and pg.locator('#imode-video').count()==1 and pg.locator('#imode-voice').is_checked())
    pg.check('#icons'); pg.locator('button:has-text("Start recording")').click(); pg.wait_for_timeout(4500); pg.locator('button:has-text("Stop and get feedback")').click(); pg.wait_for_timeout(2500)
    body=pg.inner_text('body'); ok('voice mode: feedback shown, no camera section', 'PRETEND feedback summary' in body and pg.locator('[data-testid=body-feedback]').count()==0 and pg.locator('#ipreview').is_visible()==False)
    go(pg,B,'s/interview'); pg.check('#imode-video')
    ok('video mode changes the permission text', 'pictures from my camera' in pg.inner_text('body'))
    pg.check('#icons'); pg.locator('button:has-text("Start recording")').click(); pg.wait_for_timeout(1500)
    ok('camera preview is shown while recording', pg.locator('#ipreview').is_visible()); pg.screenshot(path='/tmp/claude-0/shots/m6-video-recording.png')
    pg.wait_for_timeout(5500); pg.locator('button:has-text("Stop and get feedback")').click(); pg.wait_for_timeout(3000)
    body=pg.inner_text('body'); ok('video mode: on-camera feedback shown (eye contact, expression, posture)', pg.locator('[data-testid=body-feedback]').count()==1 and 'Looking at the camera' in body and 'Face expression' in body and 'Sitting posture' in body); pg.screenshot(path='/tmp/claude-0/shots/m6-video-result.png')
    ok('camera is switched off after stopping', pg.locator('#ipreview').is_visible()==False)
    ok('uploads folder has no leftover recordings or pictures', not [f for f in os.listdir('uploads') if f.startswith(('audio-','frame-','up-'))] if os.path.isdir('uploads') else True)
    ctx.close()
    # ---------- student sees the problem ----------
    pres=api(B,'GET','/presets',token=tt)
    asm=api(B,'POST',f'/classes/{cid}/assessments',{'title':'Fractions test','expressions':pres[0]['expressions']},tt)
    ans=dict((f'Q{k+1}',a) for k,a in enumerate(['2/5','3/10','4/10','1/2','5/8','1/2','2/5']))
    api(B,'POST',f'/assessments/{asm["id"]}/typed',{'studentId':studs[0]['id'],'answers':ans},tt)
    ctx,pg=newpage(B,sl['token'],sl['user'])
    go(pg,B,'s/results'); pc=pg.locator('[data-testid=problem-card]')
    ok('student results show a Problem card', pc.count()==1); txt=pc.inner_text() if pc.count() else ''
    ok('problem card names the mistake and the next step', 'Your problem' in txt and 'practice set' in txt.lower() and len(txt)>120); pg.screenshot(path='/tmp/claude-0/shots/m6-student-problem.png')
    ok('wrong answers show "Looks like:"', 'Looks like:' in pg.inner_text('body'))
    go(pg,B,'s'); ok('hub tile says problem found', 'Problem found' in pg.inner_text('body'))
    ctx.close()
    # phone width check for video screen
    ctx,pg=newpage(B,sl['token'],sl['user'],w=390); go(pg,B,'s/interview'); pg.check('#imode-video')
    ok('phone width: no sideways scroll on interview', pg.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')); pg.screenshot(path='/tmp/claude-0/shots/m6-phone.png'); ctx.close()
    br.close()
print('JS errors:',errs if errs else 'none')
print('FAILED:',fails if fails else 'none')
