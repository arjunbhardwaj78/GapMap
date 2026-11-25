# SANDBOX: Milestone 12 step 2 browser checks (class settings, Alert centre, event-driven alert). Start run-fake-ai.js on port 3100 first.
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
t=api(B,'POST','/auth/signup',{'username':'teach'+str(random.randint(1000,9999)),'password':'pass1234','name':'Teacher One'}); tt=t['token']
cid=api(B,'POST','/classes',{'name':'Class 7'},tt)['id']
studs=[api(B,'POST',f'/classes/{cid}/students',{'name':n,'roll':str(i+1),'pin':'1234'},tt) for i,n in enumerate(['Asha','Ravi','Meena'])]
par=api(B,'POST',f'/students/{studs[0]["id"]}/parents',{'name':'Mrs Rao'},tt)
P=api(B,'POST','/auth/login',{'username':par['login']['username'],'password':par['login']['password'],'role':'parent'})
S=api(B,'POST','/auth/login',{'username':studs[0]['login']['username'],'password':'1234','role':'student'})
a1=api(B,'POST',f'/classes/{cid}/assessments',{'title':'Test 1','expressions':['1/2+1/3']},tt)['id']
a2=api(B,'POST',f'/classes/{cid}/assessments',{'title':'Test 2','expressions':['2/3-1/6']},tt)['id']
api(B,'POST',f'/assessments/{a1}/typed',{'studentId':studs[0]['id'],'answers':{'Q1':'9/9'}},tt)
ok('after one result no alert yet (needs 2)', api(B,'GET',f'/classes/{cid}/alerts',token=tt)['counts']['new']==0)
api(B,'POST',f'/assessments/{a2}/typed',{'studentId':studs[0]['id'],'answers':{'Q1':'9/9'}},tt)
al=api(B,'GET',f'/classes/{cid}/alerts',token=tt)
ok('saving the 2nd result created the alert by itself (event-driven, no scheduler)', al['counts']['new']==1 and al['items'][0]['type']=='performance_low' and al['items'][0]['numbers']['overall']==0)
pn=[n for n in api(B,'GET','/notifications',token=P['token'])['items'] if n['type']=='performance_low']
sn=[n for n in api(B,'GET','/notifications',token=S['token'])['items'] if n['type']=='performance_low']
ok('parent text names the child, student text speaks to the student', len(pn)==1 and pn[0]['body'].startswith("Asha's overall") and len(sn)==1 and sn[0]['body'].startswith('Your overall'))
with sync_playwright() as p:
    br=p.chromium.launch(executable_path=exe,args=['--no-sandbox'])
    def newctx(w=1100):
        ctx=br.new_context(viewport={'width':w,'height':1000}); pg=ctx.new_page()
        pg.on('pageerror',lambda e: errs.append('PAGEERR '+str(e)))
        pg.on('console',lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
        pg.goto(B+'/'); pg.wait_for_timeout(400)
        pg.evaluate("([t,u])=>{sessionStorage.setItem('gm_token',t);sessionStorage.setItem('gm_user',JSON.stringify(u))}",[tt,t['user']]); pg.reload(); pg.wait_for_timeout(400)
        return ctx,pg
    def go(pg,h): pg.goto('about:blank'); pg.goto(B+'/#/'+h); pg.reload(); pg.wait_for_timeout(900)
    def sw(pg): return pg.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
    ct,pg=newctx()
    go(pg,f't/c/{cid}')
    body=pg.inner_text('body')
    ok('class hub has the Alert centre tile with 1 new alert, and Class settings', 'Alert centre' in body and '1 new alert' in body and 'Class settings' in body)
    pg.locator('a.tile:has-text("Alert centre")').click(); pg.wait_for_timeout(900)
    body=pg.inner_text('body')
    ok('Alert centre lists Asha with the reason and numbers', 'Asha' in body and 'Overall score' in body and 'Overall 0% across 2 results' in body)
    ok('Alert centre card has the quick message buttons', 'Quick message to the family' in body and pg.locator('button:text-is("Please call me")').count()==1)
    pg.locator('button:text-is("Please call me")').click(); pg.wait_for_timeout(300)
    ok('first tap only asks to confirm: nothing is sent yet', not any('Please call me' in n['title'] for n in api(B,'GET','/notifications',token=P['token'])['items']))
    pg.locator('button:has-text("Tap again to confirm")').first.click(); pg.wait_for_timeout(900)
    ok('second tap sends the kind message to that family only', any('Please call me' in n['title'] for n in api(B,'GET','/notifications',token=P['token'])['items']))
    ok('alerts CSV downloads with a header row', 'Date sent,Student,Type' in pg.evaluate("async()=>{const r=await fetch('/api/classes/"+str(cid)+"/alerts.csv',{headers:{Authorization:'Bearer '+GM.state.token}});return await r.text()}"))
    ok('it says who was told', 'to 1 student and 1 parent' in body)
    pg.screenshot(path=f'{SH}/m12-alert-centre.png')
    pg.locator('textarea').first.fill('Called the parent. <b>x</b>')
    pg.locator('button:has-text("Mark seen")').click(); pg.wait_for_timeout(900)
    ok('mark seen moves it out of New', 'No alerts here' in pg.inner_text('body'))
    pg.locator('button:has-text("Seen (1)")').click(); pg.wait_for_timeout(700)
    body=pg.inner_text('body')
    ok('Seen tab shows it, note kept as plain text (not HTML)', 'Asha' in body and pg.locator('textarea').first.input_value()=='Called the parent. <b>x</b>' and pg.locator('textarea b').count()==0)
    pg.locator('button:has-text("Mark done")').click(); pg.wait_for_timeout(700)
    pg.locator('button:has-text("Done (1)")').click(); pg.wait_for_timeout(700)
    ok('Done tab shows it', 'Asha' in pg.inner_text('body') and 'done' in pg.inner_text('body'))
    pg.locator('button:has-text("Check now")').click(); pg.wait_for_timeout(1200)
    ok('Check now reports honestly and sends nothing twice (cooldown)', api(B,'GET',f'/classes/{cid}/alerts',token=tt)['counts']['new']==0 and len(api(B,'GET','/notifications',token=P['token'])['items'])>=1 and len([n for n in api(B,'GET','/notifications',token=P['token'])['items'] if n['type']=='performance_low'])==1)
    # settings
    go(pg,f't/c/{cid}/settings')
    body=pg.inner_text('body')
    ok('settings screen opens with the defaults', pg.locator('#s_floorPct').input_value()=='40' and pg.locator('#s_attPct').input_value()=='75' and pg.locator('#s_dropN').input_value()=='3' and 'Academic year' in body)
    ok('academic year defaults to 1 June to 31 March', pg.locator('#s_ys').input_value().endswith('-06-01') and pg.locator('#s_ye').input_value().endswith('-03-31'))
    pg.fill('#s_floorPct','101'); pg.locator('button:has-text("Save settings")').click(); pg.wait_for_timeout(700)
    ok('a bad number gets a clear message and nothing is saved', 'from 0 to 100' in pg.inner_text('body') and api(B,'GET',f'/classes/{cid}/settings',token=tt)['floorPct']==40)
    pg.fill('#s_floorPct','60'); pg.locator('button:has-text("Preview who would get an alert")').click(); pg.wait_for_timeout(900)
    body=pg.inner_text('body')
    ok('preview shows Asha, says nothing was sent or saved', 'If you saved these settings' in body and 'Asha' in body and 'Nothing was sent and nothing was saved' in body)
    ok('preview did not change the stored settings', api(B,'GET',f'/classes/{cid}/settings',token=tt)['floorPct']==40)
    pg.fill('#s_floorPct','50'); pg.uncheck('#s_positiveOn'); pg.locator('button:has-text("Save settings")').click(); pg.wait_for_timeout(900)
    s=api(B,'GET',f'/classes/{cid}/settings',token=tt)
    ok('save keeps the new values', s['floorPct']==50 and s['positiveOn']==False and s['attPct']==75)
    pg.fill('#s_ys','2027-05-01'); pg.fill('#s_ye','2027-03-31'); pg.locator('button:has-text("Save settings")').click(); pg.wait_for_timeout(700)
    ok('end before start is refused', 'must end after it starts' in pg.inner_text('body'))
    pg.screenshot(path=f'{SH}/m12-settings.png')
    # phone width
    cm,pm=newctx(390)
    go(pm,f't/c/{cid}/settings'); ok('phone: settings no sideways scroll', sw(pm)); pm.screenshot(path=f'{SH}/m12-settings-phone.png')
    go(pm,f't/c/{cid}/alerts'); ok('phone: alert centre no sideways scroll', sw(pm))
    # another teacher
    o=api(B,'POST','/auth/signup',{'username':'other'+str(random.randint(1000,9999)),'password':'pass1234','name':'Other'})
    try: api(B,'GET',f'/classes/{cid}/alerts',token=o['token']); leak=True
    except Exception: leak=False
    ok('another teacher cannot read my alerts or settings', not leak)
    for c in (ct,cm): c.close()
    ok('no console or page errors', not errs, errs[:3])
print('\nFAILED:' if fails else '\nALL PASSED', fails)
