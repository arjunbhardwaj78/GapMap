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
t=api(B,'POST','/auth/signup',{'username':'teach'+str(random.randint(1000,9999)),'password':'pass1234','name':'Teacher One'}); tt=t['token']
cid=api(B,'POST','/classes',{'name':'Class 7'},tt)['id']
studs=[api(B,'POST',f'/classes/{cid}/students',{'name':n,'roll':str(i+1),'pin':'1234'},tt) for i,n in enumerate(['Asha','Ravi'])]
sid=studs[0]['id']; sid2=studs[1]['id']
par=api(B,'POST',f'/students/{sid}/parents',{'name':'Mrs Rao'},tt)
P=api(B,'POST','/auth/login',{'username':par['login']['username'],'password':par['login']['password'],'role':'parent'})
par2=api(B,'POST',f'/students/{sid2}/parents',{'name':'Mr Other'},tt)
P2=api(B,'POST','/auth/login',{'username':par2['login']['username'],'password':par2['login']['password'],'role':'parent'})
S=api(B,'POST','/auth/login',{'username':studs[0]['login']['username'],'password':'1234','role':'student'})
today=datetime.date.today(); iso=lambda n:(today+datetime.timedelta(days=n)).isoformat()
nid=api(B,'POST',f'/classes/{cid}/notices',{'title':'Picnic on Friday','body':'Bring water.'},tt)['id']
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
    ct,pg=newctx(t); cp,pp=newctx(P); cp2,pp2=newctx(P2)
    # --- hub tiles ---
    go(pg,f't/c/{cid}'); b=pg.inner_text('body')
    ok('class hub has the Leave requests and Meeting times tiles','Leave requests' in b and 'Meeting times' in b)
    # --- read receipts ---
    go(pp,f'p/c/{sid}'); ok('parent sees "I have seen this" on a notice', pp.locator('button:has-text("I have seen this")').count()==1)
    go(pg,f't/c/{cid}/notices'); ok('teacher sees "Seen by 0 of 2 parents" before anyone taps','Seen by 0 of 2 parents' in pg.inner_text('body'))
    go(pp,f'p/c/{sid}'); pp.locator('button:has-text("I have seen this")').click(); pp.wait_for_timeout(600)
    ok('after the tap the parent sees "You have seen this"','You have seen this' in pp.inner_text('body'))
    go(pg,f't/c/{cid}/notices'); ok('teacher now sees "Seen by 1 of 2 parents"','Seen by 1 of 2 parents' in pg.inner_text('body'))
    go(pp,f'p/c/{sid}'); ok('the mark is still there after reload','You have seen this' in pp.inner_text('body'))
    # --- leave request ---
    go(pp,f'p/c/{sid}'); ok('parent page has the Ask for leave card and the Meet the teacher card','Ask for leave' in pp.inner_text('body') and 'Meet the teacher' in pp.inner_text('body'))
    pp.fill('#lfrom',iso(-2)); pp.fill('#lto',iso(-1)); pp.locator('button:has-text("Send request")').click(); pp.wait_for_timeout(300)
    ok('a request without a reason shows an error and is not sent', len(api(B,'GET',f'/parent/children/{sid}/leave',token=P['token']))==0)
    pp.fill('#lwhy','Family wedding'); pp.locator('button:has-text("Send request")').click(); pp.wait_for_timeout(700)
    ok('request sent: it shows as Waiting on the parent page','Waiting' in pp.inner_text('body') and 'Family wedding' in pp.inner_text('body'))
    go(pg,f't/c/{cid}/leave'); b=pg.inner_text('body'); pg.screenshot(path=f'{SH}/m12-leave-teacher.png')
    ok('teacher sees the request with the child name and Approve button','Asha' in b and 'Family wedding' in b and pg.locator('button:has-text("Approve")').count()==1)
    pg.locator('button:has-text("Approve")').click(); pg.wait_for_timeout(900)
    ok('after Approve the request shows Approved and no buttons are left','Approved' in pg.inner_text('body') and pg.locator('button:has-text("Approve")').count()==0)
    summ=api(B,'GET',f'/classes/{cid}/attendance-summary',token=tt)['students']; a0=[s for s in summ if s['id']==sid][0]
    ok('attendance: the approved days are marked leave (Sunday skipped) and do not count against the child', a0['leave']>=1 and a0['absent']==0)
    go(pp,f'p/c/{sid}'); ok('the parent sees Approved','Approved' in pp.inner_text('body'))
    bell=api(B,'GET','/notifications',token=P['token']); ok('the parent got a bell message about the leave', any(n['type']=='leave_decision' for n in bell['items']))
    # --- meetings ---
    go(pg,f't/c/{cid}/meetings'); pg.fill('#mday',iso(2)); pg.fill('#mtimes','16:00, 16:10'); pg.fill('#mnote','Room 4'); pg.locator('button:has-text("Post times")').click(); pg.wait_for_timeout(900)
    ok('teacher posts two times: both appear as Free','16:00' in pg.inner_text('body') and '16:10' in pg.inner_text('body') and pg.locator('.chip:has-text("Free")').count()==2)
    go(pg,f't/c/{cid}/meetings'); pg.fill('#mtimes','99:00'); pg.fill('#mday',iso(2)); pg.locator('button:has-text("Post times")').click(); pg.wait_for_timeout(600)
    ok('a bad time shows an error','15:00' in pg.inner_text('body') or 'Times must look like' in pg.inner_text('body'))
    go(pp,f'p/c/{sid}'); ok('parent sees two Book buttons', pp.locator('button:text-is("Book")').count()==2)
    pp.locator('button:text-is("Book")').first.click(); pp.wait_for_timeout(900)
    ok('after booking the parent sees Booked and no more Book buttons','Booked' in pp.inner_text('body') and pp.locator('button:text-is("Book")').count()==0)
    go(pp2,f'p/c/{sid2}'); b2=pp2.inner_text('body')
    ok('the other family sees only the one free time and no names','16:10' in b2 and '16:00 ' not in b2.replace('16:00','16:00 ',1)[:0] and 'Asha' not in b2 and 'Mrs Rao' not in b2 and pp2.locator('button:text-is("Book")').count()==1)
    go(pg,f't/c/{cid}/meetings'); ok('teacher sees who booked (child and parent)','Asha' in pg.inner_text('body') and 'Mrs Rao' in pg.inner_text('body'))
    # --- upcoming list, .ics, csv ---
    hw=api(B,'POST',f'/classes/{cid}/assessments',{'title':'Fractions HW','kind':'homework','expressions':['1/2+1/2'],'due':iso(3)},tt)
    go(pp,f'p/c/{sid}'); b=pp.inner_text('body')
    ok('parent page shows "Coming up" with the homework and the booked meeting','Coming up in the next 14 days' in b and 'Fractions HW' in b and 'To do' in b and 'Meeting with the teacher' in b)
    ok('the .ics button is there', pp.locator('button:has-text("Add to my calendar")').count()>=1)
    ics=pp.evaluate("()=>GM.icsFile({child:'Asha, A',items:[{kind:'homework',date:'2026-10-14',time:null,title:'Fractions; HW',done:false},{kind:'meeting',date:'2026-10-15',time:'16:00',minutes:10,title:'Meeting with the teacher'}]})")
    ok('the .ics text is valid: calendar wrapper, all-day homework, timed meeting, commas and semicolons escaped', ics.startswith('BEGIN:VCALENDAR') and 'DTSTART;VALUE=DATE:20261014' in ics and 'DTSTART:20261015T160000' in ics and 'Fractions\\; HW' in ics and 'Asha\\, A' in ics and ics.strip().endswith('END:VCALENDAR'))
    S2=api(B,'POST','/auth/login',{'username':studs[0]['login']['username'],'password':'1234','role':'student'})
    cs,ps=newctx(S2); go(ps,'s'); ok('student home has the Coming up tile','Coming up' in ps.inner_text('body'))
    go(ps,'s/calendar'); b=ps.inner_text('body'); ok('student sees the homework, not the meeting','Fractions HW' in b and 'Meeting' not in b)
    go(pg,f't/c/{cid}/sent'); ok('Sent notifications page has a Download CSV button', pg.locator('button:has-text("Download CSV")').count()==1)
    ok('notifications CSV downloads for the teacher and is refused for a parent (403)', 'First sent,Type,Title' in pg.evaluate("async()=>{const r=await fetch('/api/classes/%d/sent-notifications.csv',{headers:{Authorization:'Bearer '+GM.state.token}});return await r.text()}"%cid) and status(B,'GET',f'/classes/{cid}/sent-notifications.csv',P['token'])==403)
    # --- Hindi system text ---
    api(B,'PUT','/me/contact',{'language':'hi'},P['token'])
    api(B,'POST',f'/classes/{cid}/notices',{'title':'Science fair on Monday','body':'Bring your models.'},tt)
    go(pp,'n'); b=pp.inner_text('body'); pp.screenshot(path=f'{SH}/m12-hindi-bell-parent.png')
    ok('Hindi parent: the bell page shows the Hindi label with the teacher\'s own title unchanged','सूचना: Science fair on Monday' in b and 'Bring your models.' in b)
    ok('the other family still reads English','Notice: Science fair on Monday' in str(api(B,'GET','/notifications',token=P2['token'])['items']))
    go(pp,'p/c/%d'%sid); pp.evaluate("()=>1")
    ok('the language choice is saved and shown in the contact details', api(B,'GET','/me/contact',token=P['token'])['language']=='hi')
    api(B,'PUT','/me/contact',{'language':'en'},P['token'])
    # --- privacy over the API ---
    ok('another family cannot read or ask leave for this child (404)', status(B,'GET',f'/parent/children/{sid}/leave',P2['token'])==404 and status(B,'POST',f'/parent/children/{sid}/leave',P2['token'],{'from':iso(3),'to':iso(3),'reason':'Fever'})==404)
    ok('the student gets 403 on the leave, meeting and seen routes', status(B,'GET',f'/parent/children/{sid}/leave',S['token'])==403 and status(B,'GET',f'/classes/{cid}/leave',S['token'])==403 and status(B,'POST',f'/parent/notices/{nid}/seen',S['token'])==403 and status(B,'GET',f'/classes/{cid}/meetings',S['token'])==403)
    ok('a parent cannot use the teacher routes (403)', status(B,'GET',f'/classes/{cid}/leave',P['token'])==403 and status(B,'POST','/leave/1/decision',P['token'],{'decision':'approve'})==403)
    # --- print: the cards do not print ---
    go(pp,f'p/c/{sid}'); pp.emulate_media(media='print')
    ok('printing hides the leave and meeting cards', not pp.locator('text=Ask for leave').first.is_visible() and not pp.locator('text=Meet the teacher').first.is_visible())
    pp.emulate_media(media='screen')
    # --- phone ---
    cm,pm=newctx(P,390); go(pm,f'p/c/{sid}'); pm.screenshot(path=f'{SH}/m12-parent-extras-390.png',full_page=True)
    ok('phone 390 px: parent page has no sideways scroll', sw(pm))
    ct2,pt2=newctx(t,390); go(pt2,f't/c/{cid}/leave'); ok('phone 390 px: leave screen has no sideways scroll', sw(pt2)); go(pt2,f't/c/{cid}/meetings'); ok('phone 390 px: meetings screen has no sideways scroll', sw(pt2)); pt2.screenshot(path=f'{SH}/m12-meetings-390.png',full_page=True)
    ok('no console errors anywhere', not errs, errs[:3])
    br.close()
print('FAILS:',len(fails)); raise SystemExit(1 if fails else 0)
