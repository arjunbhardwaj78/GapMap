# SANDBOX: Milestone 12 step 3 browser checks (report cards). Start run-fake-ai.js on port 3100 first.
import json, urllib.request, glob, os, random, datetime
from playwright.sync_api import sync_playwright
fails=[]; errs=[]
def ok(n,c,extra=''):
    print(('PASS ' if c else 'FAIL ')+n+('' if c or extra=='' else '  '+str(extra)))
    if not c: fails.append(n)
def api(B,method,path,body=None,token=None,raw=False):
    req=urllib.request.Request(B+'/api'+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
    r=urllib.request.urlopen(req); return r.read().decode() if raw else json.load(r)
exe=os.environ.get('CHROME') or (glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')+['/opt/pw-browsers/chromium'])[0]
B='http://localhost:3100'; SH='/tmp/claude-0/shots'; os.makedirs(SH,exist_ok=True)
t=api(B,'POST','/auth/signup',{'username':'teach'+str(random.randint(1000,9999)),'password':'pass1234','name':'Teacher One'}); tt=t['token']
cid=api(B,'POST','/classes',{'name':'Class 7'},tt)['id']
studs=[api(B,'POST',f'/classes/{cid}/students',{'name':n,'roll':str(i+1),'pin':'1234'},tt) for i,n in enumerate(['Asha','Ravi','Meena'])]
par=api(B,'POST',f'/students/{studs[0]["id"]}/parents',{'name':'Mrs Rao'},tt)
P=api(B,'POST','/auth/login',{'username':par['login']['username'],'password':par['login']['password'],'role':'parent'})
S=api(B,'POST','/auth/login',{'username':studs[0]['login']['username'],'password':'1234','role':'student'})
for i,(title,ex) in enumerate([('Test 1','1/2+1/3'),('Test 2','2/3-1/6'),('Test 3','1/4+1/4')]):
    a=api(B,'POST',f'/classes/{cid}/assessments',{'title':title,'expressions':[ex]},tt)['id']
    for j,s in enumerate(studs): api(B,'POST',f'/assessments/{a}/typed',{'studentId':s['id'],'answers':{'Q1':'5/6' if (i+j)%2==0 else '9/9'}},tt)
a4=api(B,'POST',f'/classes/{cid}/assessments',{'title':'Test 4 Maths','subject':'Maths','expressions':['1/2+1/2']},tt)['id']
for j,s_ in enumerate(studs): api(B,'POST',f'/assessments/{a4}/typed',{'studentId':s_['id'],'answers':{'Q1':'1' if j!=1 else '2/4'}},tt)
today=datetime.date.today().isoformat(); yest=(datetime.date.today()-datetime.timedelta(days=1)).isoformat()
for d,st in ((today,'present'),(yest,'absent')): api(B,'POST',f'/classes/{cid}/attendance',{'date':d,'marks':{str(s['id']):st for s in studs}},tt)
api(B,'POST',f'/classes/{cid}/assessments',{'title':'Fractions HW','kind':'homework','due':yest,'expressions':['1/2+1/3']},tt)
sid=studs[0]['id']
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
    ct,pg=newctx(t)
    go(pg,f't/c/{cid}'); ok('class hub has Report cards tile','Report cards' in pg.inner_text('body'))
    pg.locator('a.tile:has-text("Report cards")').click(); pg.wait_for_timeout(900)
    body=pg.inner_text('body'); ok('hub lists the students, CSV and print-all buttons','Asha' in body and 'Download class CSV' in body and 'Print all reports' in body)
    ok('class hub shows 3 class charts (bands, attendance, needs support)', pg.locator('.classcharts svg[role=img]').count()==3, pg.locator('.classcharts svg[role=img]').count())
    ct_txt=pg.locator('.classcharts').inner_text()
    ok('class charts: counts only, no student names, no ranking words', not any(nm in ct_txt for nm in ('Asha','Ravi','Meena')) and not any(w in ct_txt.lower() for w in ('best','worst','topper','1st','position')) and '0-40%' in ct_txt and '80-100%' in ct_txt and 'Open alerts' in ct_txt, ct_txt[:300])
    bands=pg.locator('.classcharts svg[aria-label^="Number of children"]').text_content()
    ok('band chart text lists the children counts', 'child' in bands)
    cc=api(B,'GET',f'/classes/{cid}/charts',token=tt)
    ok('class charts API: 3 children counted in bands, no names', sum(b['count'] for b in cc['bands']['items'])+cc['bands']['noResult']==3 and 'Asha' not in json.dumps(cc))
    pg.screenshot(path=f'{SH}/m12-charts-hub-1100.png',full_page=True)
    try: api(B,'GET',f'/classes/{cid}/charts',token=P['token']); leak=True
    except Exception: leak=False
    ok('a parent cannot read the class charts', not leak)
    go(pg,f't/c/{cid}/students'); ok('students list has a Report button', pg.locator('a:has-text("Report")').count()>=3)
    go(pg,f't/r/{sid}')
    body=pg.inner_text('body')
    ok('teacher report shows name, teacher, formula, tests table, attendance, homework', 'Asha' in body and 'Class teacher: Teacher One' in body and 'total marks obtained / total marks available' in body and 'Test 1' in body and 'Attendance' in body and 'Fractions HW' in body, body[:400])
    ok('class average shown as one number (3 children have results)', pg.locator('table.rtable').first.inner_text().count('%')>=3)
    ok('no other child names on Asha report', 'Ravi' not in body and 'Meena' not in body)
    ok('missed homework shown as not handed in','Not handed in' in body)
    pg.screenshot(path=f'{SH}/m12-report-teacher.png',full_page=True)
    pg.fill('#rremark','Good effort. <b>x</b>'); pg.locator('button:has-text("Save remarks")').click(); pg.wait_for_timeout(900)
    ok('remark saved as plain text', api(B,'GET',f'/reports/student/{sid}',token=tt)['remarks']['text']=='Good effort. <b>x</b>' and pg.locator('textarea b').count()==0)
    ok('teacher sees "not yet seen"','Not yet seen by a parent' in pg.inner_text('body'))
    # ---- step 4: charts ----
    svgs=pg.locator('.report-page svg[role=img]'); n=svgs.count()
    ok('teacher report has 5 charts (trend, marks, attendance, homework, subjects)', n==5, n)
    ok('every chart has role=img and a short aria-label', all(len((svgs.nth(i).get_attribute('aria-label') or ''))>10 for i in range(n)))
    ok('every chart writes its values as text (not colour only)', all('%' in svgs.nth(i).text_content() or any(ch.isdigit() for ch in svgs.nth(i).text_content()) for i in range(n)) and all(len(svgs.nth(i).text_content())>8 for i in range(n)))
    ok('marks chart shows a class-average marker line (3 children have results)', pg.locator('.report-page .c-mark').count()>=1 and 'class avg' in pg.locator('.report-page').inner_text())
    hwtxt=pg.locator('.report-page svg[aria-label^="Homework"]').text_content()
    ok('homework stacked bar writes done/late/not handed in counts','Not handed in: 1' in hwtxt and 'Done on time: 0' in hwtxt, hwtxt)
    ok('subject chart shows Maths', 'Maths' in pg.locator('.report-page svg[aria-label^="Marks in 1 subject"]').text_content())
    ok('attendance chart shows the month and 50%', '50%' in pg.locator('.report-page svg[aria-label^="Attendance by month"]').text_content())
    ok('no other child names in any chart', 'Ravi' not in ' '.join(svgs.nth(i).text_content() for i in range(n)))
    ok('charts are drawn with SVG shapes (rect/line/circle), not images', pg.locator('.report-page svg rect').count()>5 and pg.locator('.report-page svg img, .report-page canvas').count()==0)
    pg.screenshot(path=f'{SH}/m12-charts-teacher-1100.png',full_page=True)
    # print: black/white friendly (bars go grey, charts stay visible)
    pg.emulate_media(media='print')
    fill=pg.evaluate("getComputedStyle(document.querySelector('.report-page .c-bar')).fill")
    ok('print: bars are grey and charts stay visible', fill in ('rgb(85, 85, 85)','#555555') and pg.locator('.report-page svg[role=img]').first.is_visible(), fill)
    pg.pdf(path='/tmp/m12-report.pdf'); pg.emulate_media(media='screen')
    # scope switch changes numbers
    pg.select_option('#rscope','custom'); pg.fill('#rfrom','2020-01-01'); pg.fill('#rto','2020-06-01'); pg.locator('button:has-text("Show")').click(); pg.wait_for_timeout(900)
    ok('no data in the range: no empty chart is drawn, it says Not enough data yet', pg.locator('.report-page svg[role=img]').count()==0 and pg.locator('.chart-empty').count()>=2 and 'Not enough data yet' in pg.locator('.report-page').inner_text())
    ok('custom range with no data says Not enough data yet (not 0%)','Not enough data yet' in pg.inner_text('body') and 'Test 1' not in pg.inner_text('table.rtable').split('Class average')[-1] if pg.locator('table.rtable').count() else 'Not enough data yet' in pg.inner_text('body'))
    pg.select_option('#rscope','year'); pg.locator('button:has-text("Show")').click(); pg.wait_for_timeout(900)
    ok('full academic year shows the results again','Test 1' in pg.inner_text('body') and 'Full academic year' in pg.inner_text('body'))
    pg.select_option('#rscope','term1'); pg.locator('button:has-text("Show")').click(); pg.wait_for_timeout(900)
    ok('term without a split date explains what to do','Term split' in pg.inner_text('body') or 'term split' in pg.inner_text('body'))
    # print all
    go(pg,f't/c/{cid}/reports/print'); ok('print-all has one report per student', pg.locator('article.report-page').count()==3)
    pg.emulate_media(media='print'); ok('print: toolbar hidden, reports remain', pg.locator('.report-page').first.is_visible() and not pg.locator('.topbar').first.is_visible()); pg.emulate_media(media='screen')
    pg.screenshot(path=f'{SH}/m12-report-printall.png')
    # CSV
    csv=api(B,'GET',f'/classes/{cid}/reports.csv',token=tt,raw=True)
    ok('CSV has 3 students and a header', csv.count('\n')>=4 and 'Overall %' in csv)
    # parent
    cp,pp=newctx(P)
    go(pp,f'p/c/{sid}'); ok('parent child page has Academic report button','Academic report' in pp.inner_text('body'))
    pp.locator('a:has-text("Academic report")').click(); pp.wait_for_timeout(900)
    body=pp.inner_text('body'); ok('parent sees teacher remark as text and the seen button','Good effort. <b>x</b>' in body and 'I have seen this report' in body)
    ok('parent report shows the charts too', pp.locator('.report-page svg[role=img]').count()>=4)
    ok('parent view has no remark editor', pp.locator('#rremark').count()==0)
    pp.locator('button:has-text("I have seen this report")').click(); pp.wait_for_timeout(900)
    ok('parent sees confirmation','Seen by you on' in pp.inner_text('body'))
    ok('teacher API now shows the date', api(B,'GET',f'/reports/student/{sid}',token=tt)['remarks']['seenOn'] is not None)
    for u in (f'/reports/student/{studs[1]["id"]}',):
        try: api(B,'GET',u,token=P['token']); leak=True
        except Exception: leak=False
        ok("parent cannot open another child's report", not leak)
    pp.screenshot(path=f'{SH}/m12-report-parent.png',full_page=True)
    # student
    cs,ps=newctx(S)
    go(ps,'s'); ok('student home has My report card','My report card' in ps.inner_text('body'))
    go(ps,'s/report'); body=ps.inner_text('body'); ok('student sees own report','Asha' in body and 'Test 1' in body and ps.locator('#rremark').count()==0)
    # phone
    cm,pm=newctx(t,390)
    go(pm,f't/r/{sid}'); ok('phone: report has no sideways scroll', sw(pm)); pm.screenshot(path=f'{SH}/m12-report-phone.png',full_page=True)
    ok('phone: every chart sits inside the 390 px screen', pm.evaluate("[...document.querySelectorAll('.chart svg')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=window.innerWidth+1})"))
    ok('phone: chart text is not tiny (rendered >= 8 px)', pm.evaluate("[...document.querySelectorAll('.chart svg text')].every(t=>t.getBoundingClientRect().height>=7)"))
    pm.screenshot(path=f'{SH}/m12-charts-phone-390.png',full_page=True)
    go(pm,f't/c/{cid}/reports'); ok('phone: class hub no sideways scroll', sw(pm))
    ok('phone: class charts inside the screen', pm.evaluate("[...document.querySelectorAll('.chart svg')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=window.innerWidth+1})"))
    pm.screenshot(path=f'{SH}/m12-charts-hub-phone-390.png',full_page=True)
    # other teacher
    o=api(B,'POST','/auth/signup',{'username':'other'+str(random.randint(1000,9999)),'password':'pass1234','name':'Other'})
    try: api(B,'GET',f'/reports/student/{sid}',token=o['token']); leak=True
    except Exception: leak=False
    ok('another teacher cannot open the report', not leak)
    for c in (ct,cp,cs,cm): c.close()
    ok('no console or page errors', not errs, errs[:3])
print('\nFAILED:' if fails else '\nALL PASSED', fails)
