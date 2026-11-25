# SANDBOX: Milestone 12 step 5 browser checks (contact numbers with consent). Start run-fake-ai.js on port 3100 first.
import json, urllib.request, glob, os, random, datetime
from playwright.sync_api import sync_playwright
fails=[]; errs=[]
def ok(n,c,extra=''):
    print(('PASS ' if c else 'FAIL ')+n+('' if c or extra=='' else '  '+str(extra)))
    if not c: fails.append(n)
def api(B,method,path,body=None,token=None):
    req=urllib.request.Request(B+'/api'+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
    return json.load(urllib.request.urlopen(req))
def status(B,method,path,token,body=None):
    try: api(B,method,path,body,token); return 200
    except urllib.error.HTTPError as e: return e.code
exe=os.environ.get('CHROME') or (glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')+['/opt/pw-browsers/chromium'])[0]
B='http://localhost:3100'; SH='/tmp/claude-0/shots'; os.makedirs(SH,exist_ok=True)
NUM='9876543210'
t=api(B,'POST','/auth/signup',{'username':'teach'+str(random.randint(1000,9999)),'password':'pass1234','name':'Teacher One'}); tt=t['token']
cid=api(B,'POST','/classes',{'name':'Class 7'},tt)['id']
studs=[api(B,'POST',f'/classes/{cid}/students',{'name':n,'roll':str(i+1),'pin':'1234'},tt) for i,n in enumerate(['Asha','Ravi'])]
sid=studs[0]['id']
par=api(B,'POST',f'/students/{sid}/parents',{'name':'Mrs Rao'},tt)
P=api(B,'POST','/auth/login',{'username':par['login']['username'],'password':par['login']['password'],'role':'parent'})
S=api(B,'POST','/auth/login',{'username':studs[0]['login']['username'],'password':'1234','role':'student'})
par2=api(B,'POST',f'/students/{studs[1]["id"]}/parents',{'name':'Mr Other'},tt)
P2=api(B,'POST','/auth/login',{'username':par2['login']['username'],'password':par2['login']['password'],'role':'parent'})
today=datetime.date.today()
for k in range(3):
    d=(today-datetime.timedelta(days=k)).isoformat()
    api(B,'POST',f'/classes/{cid}/attendance',{'date':d,'marks':{str(studs[0]['id']):'absent',str(studs[1]['id']):'present'}},tt)
api(B,'POST',f'/classes/{cid}/alerts/run',{},tt)
with sync_playwright() as p:
    br=p.chromium.launch(executable_path=exe,args=['--no-sandbox'])
    def newctx(login,w=1100):
        ctx=br.new_context(viewport={'width':w,'height':1000}); pg=ctx.new_page()
        pg.on('pageerror',lambda e: errs.append('PAGEERR '+str(e)))
        pg.on('console',lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
        pg.goto(B+'/'); pg.wait_for_timeout(400)
        pg.evaluate("([t,u])=>{sessionStorage.setItem('gm_token',t);sessionStorage.setItem('gm_user',JSON.stringify(u))}",[login['token'],login['user']]); pg.reload(); pg.wait_for_timeout(400)
        return ctx,pg
    def go(pg,h): pg.goto('about:blank'); pg.goto(B+'/#/'+h); pg.reload(); pg.wait_for_timeout(1000)
    def sw(pg): return pg.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
    ct,pg=newctx(t); cp,pp=newctx(P)
    # --- default: nothing shared ---
    go(pp,f'p/c/{sid}'); body=pp.inner_text('body')
    ok('parent page: contact card says use in-app messages by default (no number)','Contact the teacher' in body and 'Use in-app messages' in body and NUM not in body)
    # --- teacher saves a number, sharing OFF ---
    go(pg,'t'); pg.locator('button:has-text("My contact details")').click(); pg.wait_for_timeout(500)
    ok('contact dialog opens, sharing switch is OFF by default', pg.locator('#cshare').is_visible() and not pg.locator('#cshare').is_checked())
    pg.fill('#cphone','12345'); pg.locator('.modal button:has-text("Save"), [role=dialog] button:has-text("Save")').first.click(); pg.wait_for_timeout(500)
    ok('a bad number shows an error and the dialog stays open','10-digit' in pg.inner_text('body') and pg.locator('#cphone').is_visible())
    pg.fill('#cphone','+91 98765 43210'); pg.fill('#ctime','After 4 pm'); pg.select_option('#clang','hi')
    pg.screenshot(path=f'{SH}/m12-contact-dialog.png')
    pg.locator('[role=dialog] button:has-text("Save"), .modal button:has-text("Save")').first.click(); pg.wait_for_timeout(700)
    ok('teacher number saved, still not shared', api(B,'GET','/me/contact',token=tt)['phone']==NUM and api(B,'GET','/me/contact',token=tt)['share'] is False)
    go(pp,f'p/c/{sid}'); ok('sharing OFF: parent still sees no number', NUM not in pp.inner_text('body') and 'Use in-app messages' in pp.inner_text('body'))
    # --- teacher shares ---
    go(pg,'t'); pg.locator('button:has-text("My contact details")').click(); pg.wait_for_timeout(500)
    ok('dialog shows the saved number', pg.input_value('#cphone')==NUM)
    pg.check('#cshare'); pg.locator('[role=dialog] button:has-text("Save"), .modal button:has-text("Save")').first.click(); pg.wait_for_timeout(700)
    go(pp,f'p/c/{sid}'); body=pp.inner_text('body')
    ok('sharing ON: parent sees the masked number, Call and WhatsApp','98xxxxx210' in body and NUM not in body and 'After 4 pm' in body)
    ok('Call and WhatsApp links are built from the checked digits', pp.locator(f'a[href="tel:+91{NUM}"]').count()==1 and pp.locator(f'a[href="https://wa.me/91{NUM}"]').count()==1)
    pp.locator('.contact-card button:has-text("Show")').click(); ok('Show reveals the number', NUM in pp.locator('.contact-card').inner_text())
    pp.screenshot(path=f'{SH}/m12-contact-parent-1100.png',full_page=True)
    go(pp,f'p/c/{sid}/report'); ok('parent report page also has the contact card', pp.locator('.contact-card').count()==1 and '98xxxxx210' in pp.locator('.contact-card').inner_text())
    pp.emulate_media(media='print'); ok('print: the contact card is NOT printed and the number is not in the printed page', not pp.locator('.contact-card').first.is_visible() and NUM not in pp.locator('.report-page').inner_text()); pp.emulate_media(media='screen')
    # other family
    ok('another family\'s parent cannot read this child\'s teacher contact (404)', status(B,'GET',f'/parent/children/{sid}/teacher-contact',P2['token'])==404)
    # student
    ok('a student cannot read or set contact details (403)', status(B,'GET','/me/contact',S['token'])==403 and status(B,'PUT','/me/contact',S['token'],{'phone':NUM})==403)
    cs,ps=newctx(S); go(ps,'s'); ok('student home shows no phone number or contact card', NUM not in ps.inner_text('body') and 'Contact the teacher' not in ps.inner_text('body'))
    # --- parent saves a number, sharing OFF, then ON ---
    go(pp,'p'); pp.locator('button:has-text("My contact details")').click(); pp.wait_for_timeout(500)
    ok('parent dialog: switch OFF by default, label is clear', not pp.locator('#cshare').is_checked() and "Share my number with my child's teacher" in pp.inner_text('body'))
    pp.fill('#cphone','91234 56780'); pp.locator('[role=dialog] button:has-text("Save"), .modal button:has-text("Save")').first.click(); pp.wait_for_timeout(700)
    go(pg,f't/c/{cid}/students'); pg.locator('button:has-text("Parent login")').first.click(); pg.wait_for_timeout(700)
    ok('teacher: parent has a number but did not share, so it is hidden','No number shared' in pg.inner_text('body') and '9123456780' not in pg.inner_text('body') and '91xxxxx780' not in pg.inner_text('body'))
    api(B,'PUT','/me/contact',{'share':True},P['token'])
    go(pg,f't/c/{cid}/students'); pg.locator('button:has-text("Parent login")').first.click(); pg.wait_for_timeout(700)
    ok('parent switched sharing ON: teacher sees the masked number','91xxxxx780' in pg.inner_text('body') and '9123456780' not in pg.inner_text('body'))
    pg.screenshot(path=f'{SH}/m12-contact-teacher-modal.png')
    # --- alert centre ---
    go(pg,f't/c/{cid}/alerts'); pg.get_by_role('button',name='All',exact=True).click(); pg.wait_for_timeout(800)
    body=pg.inner_text('body')
    ok('Alert centre shows a parent contact line for the child (masked)','Parent contact' in body and '91xxxxx780' in body, body[:300])
    ok('Alert centre: the other child (no consent) is never shown with a number', '9123456780' not in body)
    pg.screenshot(path=f'{SH}/m12-contact-alerts-1100.png',full_page=True)
    # --- teacher enters number when making the login ---
    ok('bad parent number refused by the API (400)', status(B,'POST',f'/students/{studs[1]["id"]}/parents',tt,{'name':'Mr X','phone':'555'})==400)
    # --- phone view ---
    cm,pm=newctx(P,390); go(pm,f'p/c/{sid}'); ok('phone: parent page no sideways scroll with the contact card', sw(pm))
    pm.locator('.contact-card').scroll_into_view_if_needed(); pm.screenshot(path=f'{SH}/m12-contact-parent-390.png',full_page=True)
    ok('phone: contact buttons stay inside the screen', pm.evaluate("[...document.querySelectorAll('.contact-card .btn')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=window.innerWidth+1})"))
    go(pm,'p'); pm.locator('button:has-text("My contact details")').click(); pm.wait_for_timeout(500); ok('phone: contact dialog fits the screen', sw(pm)); pm.screenshot(path=f'{SH}/m12-contact-dialog-390.png')
    for c in (ct,cp,cs,cm): c.close()
    ok('no console or page errors', not errs, errs[:3])
print('\nFAILED:' if fails else '\nALL PASSED', fails)
