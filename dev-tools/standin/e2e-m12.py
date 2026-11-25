# SANDBOX: Milestone 12 browser checks. Start run-fake-ai.js on port 3100 first (see RESUME-M12.md). New sections are added per milestone.
import json, urllib.request, glob, os, random
from playwright.sync_api import sync_playwright
fails=[]; errs=[]
def ok(n,c,extra=''):
    print(('PASS ' if c else 'FAIL ')+n+('' if c or extra=='' else '  '+str(extra)))
    if not c: fails.append(n)
def api(B,method,path,body=None,token=None):
    req=urllib.request.Request(B+'/api'+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
    return json.load(urllib.request.urlopen(req))
exe=os.environ.get('CHROME') or (glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')+['/opt/pw-browsers/chromium'])[0]
B='http://localhost:3100'; SH='/tmp/claude-0/shots'; os.makedirs(SH,exist_ok=True)
rid=str(random.randint(1000,9999))
t=api(B,'POST','/auth/signup',{'username':'teach'+rid,'password':'pass1234','name':'Teacher One'}); tt=t['token']
cid=api(B,'POST','/classes',{'name':'Class 7'},tt)['id']
studs=[api(B,'POST',f'/classes/{cid}/students',{'name':n,'roll':str(i+1),'pin':'1234'},tt) for i,n in enumerate(['Asha','Ravi','Meena'])]
par=api(B,'POST',f'/students/{studs[0]["id"]}/parents',{'name':'Mrs Rao'},tt)
api(B,'POST',f'/students/{studs[2]["id"]}/parents',{'linkUsername':par['login']['username']},tt)   # sibling: one login, two children
S=api(B,'POST','/auth/login',{'username':studs[0]['login']['username'],'password':'1234','role':'student'})
P=api(B,'POST','/auth/login',{'username':par['login']['username'],'password':par['login']['password'],'role':'parent'})
def unread(tok): return api(B,'GET','/notifications/unread-count',token=tok)['unread']
with sync_playwright() as p:
    br=p.chromium.launch(executable_path=exe,args=['--no-sandbox'])
    def newctx(w=1100):
        ctx=br.new_context(viewport={'width':w,'height':1000}); pg=ctx.new_page()
        pg.on('pageerror',lambda e: errs.append('PAGEERR '+str(e)))
        pg.on('console',lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
        pg.goto(B+'/'); pg.wait_for_timeout(500); return ctx,pg
    def login(pg,tok,user): pg.evaluate("([t,u])=>{sessionStorage.setItem('gm_token',t);sessionStorage.setItem('gm_user',JSON.stringify(u))}",[tok,user])
    def go(pg,h): pg.goto('about:blank'); pg.goto(B+'/#/'+h); pg.wait_for_timeout(900)
    def sw(pg): return pg.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
    def badge(pg):
        b=pg.locator('.bell-badge').first
        return 0 if (b.count()==0 or not b.is_visible()) else int(b.inner_text().replace('+',''))
    # ---------- student and parent open their pages first; bell is empty ----------
    cs,pgS=newctx(); login(pgS,S['token'],S['user']); go(pgS,'s')
    cp,pgP=newctx(); login(pgP,P['token'],P['user']); go(pgP,'p')
    ok('bell is in the header for student and parent', pgS.locator('a.bell').count()==1 and pgP.locator('a.bell').count()==1)
    ok('both bells start empty (no badge)', badge(pgS)==0 and badge(pgP)==0)
    # ---------- teacher assigns homework and publishes a quiz (UI); nothing else clicked ----------
    ct,pgT=newctx(); login(pgT,tt,t['user'])
    hw=api(B,'POST',f'/classes/{cid}/assessments',{'title':'Fractions homework','kind':'homework','due':'2026-12-20','expressions':['1/2+1/3','2/5+1/5']},tt)
    ok('API tells the teacher how many were told', hw['notifiedText']=='Sent to 3 students and 1 parent.' or 'Sent to 3 students and 1 parents.' in hw['notifiedText'] or 'Sent to 3 students' in hw['notifiedText'])
    q=api(B,'POST',f'/classes/{cid}/quizzes',{'title':'Fraction quiz','expressions':['1/2+1/4','1/3+1/3']},tt)
    go(pgT,f't/q/{q["id"]}')
    pgT.locator('button:has-text("Publish to every student")').click(); pgT.wait_for_timeout(900)
    ok('teacher sees a "Sent to ..." toast after publishing', 'Sent to 3 students' in pgT.inner_text('body') or pgT.locator('.toast:has-text("Sent to")').count()>0)
    ok('API: student has 2 unread, parent has 4 (2 items x 2 children)', unread(S['token'])==2 and unread(P['token'])==4, [unread(S['token']),unread(P['token'])])
    # bell updates on the next page change, no extra click on a notification
    go(pgS,'s'); ok('student bell shows 2', badge(pgS)==2, badge(pgS))
    go(pgP,'p'); ok('parent bell shows 4', badge(pgP)==4, badge(pgP))
    # ---------- open the list ----------
    pgP.locator('a.bell').click(); pgP.wait_for_timeout(900)
    body=pgP.inner_text('body')
    ok('parent list names each child and has the unread highlight', 'Asha' in body and 'Meena' in body and pgP.locator('.item.notif.unread').count()==4); pgP.screenshot(path=f'{SH}/m12-parent-list.png')
    ok('parent sees mute switches and the "cannot be muted" note', pgP.locator('label:has-text("Notices from the teacher")').count()==1 and 'cannot be muted' in body)
    # tap one: goes to the child page, count drops by 1
    pgP.locator('.item.notif.unread').first.click(); pgP.wait_for_timeout(1000)
    ok('tapping opens the child page', '/p/c/' in pgP.url, pgP.url)
    ok('count dropped to 3', unread(P['token'])==3 and badge(pgP)==3, [unread(P['token']),badge(pgP)])
    go(pgP,'n'); pgP.locator('button:has-text("Mark all read")').click(); pgP.wait_for_timeout(900)
    ok('Mark all read clears the badge', badge(pgP)==0 and unread(P['token'])==0)
    # student: tap opens the quiz
    go(pgS,'n'); pgS.locator('.item.notif:has-text("New quiz")').click(); pgS.wait_for_timeout(1000)
    ok('student tap opens the quiz page', '/s/quiz/' in pgS.url, pgS.url)
    # mute a low-priority type from the UI
    go(pgP,'n'); pgP.locator('label:has-text("Notices from the teacher")').click(); pgP.wait_for_timeout(700)
    ok('mute saved', 'notice_posted' in api(B,'GET','/notifications/prefs',token=P['token'])['muted'])
    api(B,'POST',f'/classes/{cid}/notices',{'title':'Holiday','body':'Closed Monday.'},tt)
    ok('muted notices do not reach the parent, but still reach the student', unread(P['token'])==0 and unread(S['token'])>=1)
    # ---------- teacher: sent page ----------
    go(pgT,f't/c/{cid}'); ok('class hub has Sent notifications tile', pgT.locator('a.tile:has-text("Sent notifications")').count()==1)
    pgT.locator('a.tile:has-text("Sent notifications")').click(); pgT.wait_for_timeout(900)
    body=pgT.inner_text('body'); ok('sent page shows read counts', 'Students read' in body and 'Parents read' in body and 'Fractions homework' in body); pgT.screenshot(path=f'{SH}/m12-sent.png')
    # ---------- privacy through the API ----------
    other=api(B,'POST','/auth/signup',{'username':'other'+rid,'password':'pass1234','name':'Other'})
    ok('another teacher has an empty bell and cannot read my log', unread(other['token'])==0)
    try: api(B,'GET',f'/classes/{cid}/sent-notifications',token=other['token']); leak=True
    except Exception as e: leak=False
    ok('another teacher cannot read my sent log', not leak)
    # ---------- phone width ----------
    cm,pgM=newctx(390); login(pgM,P['token'],P['user']); api(B,'POST',f'/classes/{cid}/notices',{'title':'Another','body':'x'},tt)
    api(B,'POST',f'/classes/{cid}/assessments',{'title':'Unit test 2','expressions':['1/2+1/3']},tt)
    go(pgM,'n'); ok('phone: notification list has no sideways scroll', sw(pgM)); pgM.screenshot(path=f'{SH}/m12-phone-list.png')
    go(pgM,'p'); ok('phone: bell fits in the header', sw(pgM) and pgM.locator('a.bell').is_visible()); pgM.screenshot(path=f'{SH}/m12-phone-home.png')
    for c in (cs,cp,ct,cm): c.close()
    ok('no console or page errors', not errs, errs[:3])
print('\nFAILED:' if fails else '\nALL PASSED', fails)
