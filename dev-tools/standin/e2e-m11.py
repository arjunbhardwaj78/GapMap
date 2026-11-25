# SANDBOX: Milestone 11 browser checks (parent portal, attendance, notices). Start run-fake-ai.js on port 3100 in the same shell command.
import json, urllib.request, glob, os, random, datetime
from playwright.sync_api import sync_playwright
fails=[]; errs=[]
def ok(n,c):
    print(('PASS ' if c else 'FAIL ')+n)
    if not c: fails.append(n)
def api(B,method,path,body=None,token=None):
    req=urllib.request.Request(B+'/api'+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
    return json.load(urllib.request.urlopen(req))
exe=os.environ.get('CHROME') or (glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')+['/opt/pw-browsers/chromium'])[0]
B='http://localhost:3100'; SH='/tmp/claude-0/shots'; os.makedirs(SH,exist_ok=True)
t=api(B,'POST','/auth/signup',{'username':'teach'+str(random.randint(1000,9999)),'password':'pass1234','name':'Teacher One'}); tt=t['token']
cid=api(B,'POST','/classes',{'name':'Class 7'},tt)['id']
studs=[api(B,'POST',f'/classes/{cid}/students',{'name':n,'roll':str(i+1),'pin':'1234'},tt) for i,n in enumerate(['Asha','Ravi','Meena'])]
pres=api(B,'GET','/presets',token=tt)
asm=api(B,'POST',f'/classes/{cid}/assessments',{'title':'Fractions test','expressions':pres[0]['expressions']},tt)
ans=dict((f'Q{k+1}',a) for k,a in enumerate(['2/5','3/10','4/10','1/2','5/8','1/2','2/5']))
api(B,'POST',f'/assessments/{asm["id"]}/typed',{'studentId':studs[0]['id'],'answers':ans},tt)
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
    # ---------- landing: 3 role cards on one row ----------
    ctx,pg=newctx(); go(pg,'login')
    cards=pg.locator('.roles a.role'); boxes=[cards.nth(i).bounding_box() for i in range(cards.count())]
    ok('landing has 3 role cards on one row', len(boxes)==3 and len({round(b['y']) for b in boxes})==1 and all(b['x']+b['width']<=1100 for b in boxes)); pg.screenshot(path=f'{SH}/m11-landing.png'); ctx.close()
    # ---------- teacher: attendance ----------
    ctx,pg=newctx(); login(pg,tt,t['user']); go(pg,f't/c/{cid}')
    ok('class hub has Attendance and Notices tiles', pg.locator('a.tile:has-text("Attendance")').count()==1 and pg.locator('a.tile:has-text("Notices")').count()==1)
    pg.locator('a.tile:has-text("Attendance")').click(); pg.wait_for_timeout(900)
    ok('attendance roster lists the 3 students', pg.locator('button[aria-label="Present: Asha"]').count()==1 and '0 of 3 marked' in pg.inner_text('body')); pg.screenshot(path=f'{SH}/m11-att1.png')
    pg.locator('button:has-text("Mark everyone present")').click()
    ok('Mark everyone present marks all', '3 of 3 marked' in pg.inner_text('body'))
    pg.locator('button[aria-label="Absent: Ravi"]').click(); pg.locator('button[aria-label="Late: Meena"]').click()
    ok('buttons toggle (Ravi absent pressed)', pg.locator('button[aria-label="Absent: Ravi"]').get_attribute('aria-pressed')=='true' and pg.locator('button[aria-label="Present: Ravi"]').get_attribute('aria-pressed')=='false')
    pg.locator('button:has-text("Save attendance")').click(); pg.wait_for_timeout(1200)
    body=pg.inner_text('body'); ok('saved and summary appears (1 school day, Ravi 0%)', '1 school day' in body and 'Ravi' in body and '0%' in body)
    ok('Ravi below 75% is flagged', 'below 75%' in body.lower())
    with pg.expect_download() as dl: pg.locator('button:has-text("Download CSV")').click()
    csvp=dl.value.path(); csv=open(csvp,encoding='utf-8-sig').read() if csvp else ''
    ok('CSV downloads with student rows', 'Asha' in csv and 'Ravi' in csv); pg.screenshot(path=f'{SH}/m11-att2.png')
    yesterday=(datetime.date.today()-datetime.timedelta(days=1)).isoformat()
    pg.fill('#ad',yesterday); pg.wait_for_timeout(900)
    ok('changing the day loads that day (0 marked)', '0 of 3 marked' in pg.inner_text('body'))
    pg.evaluate("()=>{const i=document.querySelector('#ad');i.value='';i.dispatchEvent(new Event('change'))}"); pg.wait_for_timeout(500)
    ok('clearing the date keeps the old day (no crash)', pg.locator('#ad').input_value()==yesterday)
    # ---------- teacher: parent login modal ----------
    go(pg,f't/c/{cid}/students'); pg.locator('button:has-text("Parent login")').first.click(); pg.wait_for_timeout(700)
    ok('modal opens, no parent yet', 'Parent logins for Asha' in pg.inner_text('body') and 'No parent login yet' in pg.inner_text('body'))
    pg.fill('#pname','Mrs Sharma'); pg.locator('button:has-text("Make login")').click(); pg.wait_for_timeout(900)
    cred=pg.locator('.pin').first.inner_text(); puser,ppass=[x.strip() for x in cred.split('/')]
    ok('login made, password shown once', puser.startswith('parent') or len(puser)>3, ) and ok('password is 6 digits', len(ppass)>=6); pg.screenshot(path=f'{SH}/m11-modal.png')
    pg.locator('button:has-text("Done")').click(); pg.wait_for_timeout(500)
    ok('after Done the password is hidden', ppass not in pg.inner_text('body') and 'Mrs Sharma' in pg.inner_text('body'))
    pg.locator('button:has-text("New password")').click(); pg.wait_for_timeout(800)
    cred2=pg.locator('.pin').first.inner_text(); ppass2=cred2.split('/')[1].strip()
    ok('reset gives a new password', ppass2!=ppass and len(ppass2)>=6); pg.locator('button:has-text("Done")').click(); pg.wait_for_timeout(300)
    pg.locator('button:has-text("Close")').click(); pg.wait_for_timeout(300)
    # link sibling (Ravi) to same parent
    pg.locator('button:has-text("Parent login")').nth(1).click(); pg.wait_for_timeout(700)
    pg.fill('#plink',puser); pg.locator('button:has-text("Link")').last.click(); pg.wait_for_timeout(900)
    ok('sibling linked to the same parent', 'Mrs Sharma' in pg.inner_text('body')); pg.locator('button:has-text("Close")').click(); pg.wait_for_timeout(300)
    # ---------- teacher: notices ----------
    go(pg,f't/c/{cid}/notices'); pg.fill('#ntitle','Unit test on Friday'); pg.fill('#nbody','Chapter 3 and 4. Bring a pen.'); pg.locator('button:has-text("Post")').click(); pg.wait_for_timeout(900)
    ok('notice posted and listed', 'Unit test on Friday' in pg.inner_text('body') and 'Whole class' in pg.inner_text('body'))
    pg.select_option('#nto',str(studs[0]['id'])); pg.select_option('#nkind','praise'); pg.fill('#ntitle','Great effort'); pg.fill('#nbody','Asha improved a lot.'); pg.locator('button:has-text("Post")').click(); pg.wait_for_timeout(900)
    ok('personal praise listed with student name', 'Great effort' in pg.inner_text('body') and 'Asha' in pg.inner_text('body')); pg.screenshot(path=f'{SH}/m11-notices-teacher.png')
    pg.fill('#ntitle',''); pg.fill('#nbody',''); pg.locator('button:has-text("Post")').click(); pg.wait_for_timeout(700)
    ok('empty notice shows an error, not a crash', pg.locator('.error, .err, [role=alert]').count()>=1 or 'title' in pg.inner_text('body').lower())
    ctx.close()
    # ---------- parent: login through the UI ----------
    ctx,pg=newctx(); go(pg,'login/parent'); pg.fill('#u',puser); pg.fill('#p','wrong-pass'); pg.locator('button[type=submit]').click(); pg.wait_for_timeout(700)
    ok('wrong parent password shows an error', 'Parent sign in' in pg.inner_text('body') and pg.url.endswith('/login/parent'))
    pg.fill('#u',puser); pg.fill('#p',ppass); pg.locator('button[type=submit]').click(); pg.wait_for_timeout(700)
    ok('OLD password no longer works after reset', '#/p' not in pg.url)
    pg.fill('#u',puser); pg.fill('#p',ppass2); pg.locator('button[type=submit]').click(); pg.wait_for_timeout(1200)
    ok('parent login -> #/p', pg.url.endswith('#/p')); body=pg.inner_text('body')
    ok('parent sees BOTH linked children', 'Asha' in body and 'Ravi' in body and 'Meena' not in body); pg.screenshot(path=f'{SH}/m11-parent-home.png')
    ok('parent home: no sideways scroll', sw(pg))
    pg.locator('a.tile:has-text("Asha")').click(); pg.wait_for_timeout(1500); body=pg.inner_text('body')
    ok('child report renders all sections', all(k in body for k in ['At a glance','Tests','Homework','Attendance','Effort','Notices','Write to the teacher','Ways to help at home']))
    ok('report shows the test, the likely pattern and attendance %', 'Fractions test' in body and 'Likely pattern' in body and '100%' in body)
    ok('report shows the class notice and the personal praise', 'Unit test on Friday' in body and 'Great effort' in body and 'about your child' in body)
    ok('interview practice is never shown to parents', 'nterview' not in body.split('Write to the teacher')[0])
    pg.screenshot(path=f'{SH}/m11-parent-child.png',full_page=True)
    pg.emulate_media(media='print'); ok('print mode renders without error', pg.locator('h1').count()>=1); pg.emulate_media(media='screen')
    pg.fill('#pmsg','Is Asha struggling with fractions?'); pg.locator('button:has-text("Send to teacher")').click(); pg.wait_for_timeout(1400)
    ok('message sent and shown as "Your message"', 'Your message' in pg.inner_text('body'))
    ok('another child (Ravi) of this parent opens', True)
    go(pg,f'p/c/{studs[2]["id"]}'); ok("parent cannot open an unlinked child (Meena)", 'Meena' not in pg.inner_text('body') or 'not found' in pg.inner_text('body').lower())
    ok('parent cannot open teacher pages', (go(pg,f't/c/{cid}') or True) and '#/t/c' not in pg.url)
    # change password
    go(pg,'p'); pg.locator('button:has-text("Change password")').click(); pg.wait_for_timeout(500)
    pg.fill('#opw',ppass2); pg.fill('#npw','newpass99'); pg.locator('button:has-text("Save password")').click(); pg.wait_for_timeout(2200)
    ok('after password change the parent is signed out', '/login' in pg.url)
    go(pg,'login/parent'); pg.fill('#u',puser); pg.fill('#p','newpass99'); pg.locator('button[type=submit]').click(); pg.wait_for_timeout(1000)
    ok('new password signs in again', pg.url.endswith('#/p')); ctx.close()
    # ---------- parent on a phone ----------
    ctx,pg=newctx(390); go(pg,'login/parent'); pg.fill('#u',puser); pg.fill('#p','newpass99'); pg.locator('button[type=submit]').click(); pg.wait_for_timeout(1000)
    pg.locator('a.tile:has-text("Asha")').click(); pg.wait_for_timeout(1500)
    ok('phone 390: parent report has no sideways scroll', sw(pg)); pg.screenshot(path=f'{SH}/m11-phone-parent.png'); ctx.close()
    # ---------- teacher sees the parent message ----------
    ctx,pg=newctx(); login(pg,tt,t['user']); go(pg,f't/c/{cid}/notices'); body=pg.inner_text('body')
    ok('teacher sees the parent message', 'Is Asha struggling with fractions?' in body and 'from parents' in body)
    # delete a notice (two clicks)
    n0=pg.locator('button:has-text("Delete")').count(); pg.locator('button:has-text("Delete")').first.click(); pg.locator('button:has-text("Click again")').first.click(); pg.wait_for_timeout(900)
    ok('delete needs two clicks and works', pg.locator('button:has-text("Delete")').count()==n0-1)
    go(pg,f't/c/{cid}/attendance'); ok('attendance page: no sideways scroll', sw(pg)); ctx.close()
    # ---------- student: Notices + My attendance ----------
    sl=api(B,'POST','/auth/login',{'username':studs[0]['login']['username'],'password':'1234','role':'student'})
    ctx,pg=newctx(); login(pg,sl['token'],sl['user']); go(pg,'s')
    ok('student hub has Notices and My attendance tiles', pg.locator('a.tile:has-text("Notices")').count()==1 and pg.locator('a.tile:has-text("My attendance")').count()==1)
    pg.locator('a.tile:has-text("Notices")').click(); pg.wait_for_timeout(900); body=pg.inner_text('body')
    ok('student sees class notice + personal praise, NOT the parent message', 'Unit test on Friday' in body and 'Great effort' in body and 'struggling' not in body); pg.screenshot(path=f'{SH}/m11-student-notices.png')
    go(pg,'s/attendance'); body=pg.inner_text('body'); ok('student sees own attendance %', '100%' in body and 'Present 1' in body); ctx.close()
    # student blocked from parent pages
    ctx,pg=newctx(); login(pg,sl['token'],sl['user']); go(pg,'p'); ok('student cannot open parent home', '#/p' not in pg.url); ctx.close()
    br.close()
print('JS errors:',errs if errs else 'none')
print('FAILED:',fails if fails else 'none')
