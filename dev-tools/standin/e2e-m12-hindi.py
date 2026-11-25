# SANDBOX: Hindi step 1 browser checks (one-tap Hindi summary for parents). Start run-fake-ai.js on port 3100 first.
import json, urllib.request, glob, os, random, datetime, re
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
DEV=re.compile('[\u0900-\u097F]')
t=api(B,'POST','/auth/signup',{'username':'teach'+str(random.randint(1000,9999)),'password':'pass1234','name':'Teacher One'}); tt=t['token']
cid=api(B,'POST','/classes',{'name':'Class 7'},tt)['id']
studs=[api(B,'POST',f'/classes/{cid}/students',{'name':n,'roll':str(i+1),'pin':'1234'},tt) for i,n in enumerate(['Asha','Ravi','Meena'])]
par=api(B,'POST',f'/students/{studs[0]["id"]}/parents',{'name':'Mrs Rao'},tt)
api(B,'POST',f'/students/{studs[1]["id"]}/parents',{'linkUsername':par['login']['username']},tt)       # one login, two children
P=api(B,'POST','/auth/login',{'username':par['login']['username'],'password':par['login']['password'],'role':'parent'})
par3=api(B,'POST',f'/students/{studs[2]["id"]}/parents',{'name':'Mr Other'},tt)
P3=api(B,'POST','/auth/login',{'username':par3['login']['username'],'password':par3['login']['password'],'role':'parent'})
S=api(B,'POST','/auth/login',{'username':studs[0]['login']['username'],'password':'1234','role':'student'})
api(B,'PUT','/me/contact',{'phone':'9876543210','share':True},tt)
for i,(title,ex) in enumerate([('Test 1','1/2+1/3'),('Test 2','2/3-1/6')]):
    a=api(B,'POST',f'/classes/{cid}/assessments',{'title':title,'expressions':[ex]},tt)['id']
    for j,s in enumerate(studs): api(B,'POST',f'/assessments/{a}/typed',{'studentId':s['id'],'answers':{'Q1':'5/6' if (i+j)%2==0 else '9/9'}},tt)
today=datetime.date.today(); month=today.strftime('%Y-%m')
for d in range(1,4):
    day=f'{month}-{d:02d}'
    api(B,'POST',f'/classes/{cid}/attendance',{'date':day,'marks':{str(s['id']):('absent' if (d==2 and s['name']=='Ravi') else 'present') for s in studs}},tt)
api(B,'POST',f'/classes/{cid}/assessments',{'title':'Fractions HW','kind':'homework','due':(today+datetime.timedelta(days=2)).isoformat(),'expressions':['1/2+1/3']},tt)
sid=studs[0]['id']
FAKEVOICE="""window.__spoken=[];
window.SpeechSynthesisUtterance=function(t){this.text=t};
Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{lang:'hi-IN',name:'Fake Hindi'}],speak:(u)=>window.__spoken.push({text:u.text,lang:u.lang}),cancel:()=>{},addEventListener:()=>{}}});"""
NOVOICE="""Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{lang:'en-US',name:'English only'}],speak:()=>{},cancel:()=>{},addEventListener:()=>{}}});"""
with sync_playwright() as p:
    br=p.chromium.launch(executable_path=exe,args=['--no-sandbox'])
    def newctx(login,w=1100,script=None):
        ctx=br.new_context(viewport={'width':w,'height':900}); pg=ctx.new_page()
        if script: pg.add_init_script(script)
        pg.on('pageerror',lambda e: errs.append('PAGEERR '+str(e)))
        pg.on('console',lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
        pg.goto(B+'/'); pg.wait_for_timeout(400)
        pg.evaluate("([t,u])=>{sessionStorage.setItem('gm_token',t);sessionStorage.setItem('gm_user',JSON.stringify(u))}",[login['token'],login['user']]); pg.reload(); pg.wait_for_timeout(400)
        return ctx,pg
    def go(pg,h): pg.goto('about:blank'); pg.goto(B+'/#/'+h); pg.reload(); pg.wait_for_timeout(1000)
    def sw(pg): return pg.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
    # ---------- phone: parent home ----------
    cm,pm=newctx(P,390,NOVOICE); go(pm,'p')
    btn=pm.locator('a.hindi-btn')
    ok('phone: the big Hindi summary button is on the parent home', btn.count()==1 and 'हिंदी में सारांश सुनें / देखें' in btn.inner_text())
    bb=btn.bounding_box(); ok('phone: the button is fully on screen and big enough to tap (height >= 48)', bb and bb['x']>=0 and bb['x']+bb['width']<=390+1 and bb['height']>=48, bb)
    ok('phone: parent home has no sideways scroll', sw(pm)); pm.screenshot(path=f'{SH}/m12-hindi-home-390.png')
    btn.click(); pm.wait_for_timeout(1200)
    ok('one tap opens the summary screen', pm.url.endswith('#/p/summary') and pm.locator('.slab h2').count()==2, pm.url)
    heads=[x.inner_text() for x in pm.locator('.slab h2').all()]
    ok('two children: one card each, child name as heading', sorted(heads)==['Asha','Ravi'], heads)
    body=pm.inner_text('body')
    ok('summary is in Devanagari with the real names kept as stored','आपके बच्चे Asha की उपस्थिति इस महीने' in body and 'आपके बच्चे Ravi की उपस्थिति इस महीने' in body)
    asha=pm.locator('.slab').nth(0 if heads[0]=='Asha' else 1).inner_text()
    ravi=pm.locator('.slab').nth(0 if heads[0]=='Ravi' else 1).inner_text()
    ok('cards do not mix: Asha is 100% present, Ravi 67% (2 of 3 days)', '100%' in asha and 'Ravi' not in asha and '67%' in ravi and 'Asha' not in ravi, (asha[:200],ravi[:200]))
    ok('homework due soon and soft wording appear','Fractions HW' in body and 'गृहकार्य' in body and not re.search('कमज़ोर|फेल',body))
    ok('phone: summary screen has no sideways scroll', sw(pm)); pm.screenshot(path=f'{SH}/m12-hindi-summary-390.png',full_page=True)
    lbn=pm.locator('button:text-is("सुनें (Listen)")'); lbn.first.click(); pm.wait_for_timeout(2900)
    ok('phone, no Hindi voice: Listen is shown, and tapping it explains how to install a Hindi voice', lbn.count()>=1 and 'No Hindi voice' in pm.inner_text('body'))
    pm.locator('button:text-is("Roman Hindi")').click(); pm.wait_for_timeout(300)
    lines=' '.join(x.inner_text() for x in pm.locator('.hindi-line').all())
    ok('Roman Hindi toggle: Hinglish text with no Devanagari ("aapke bacche Asha ki attendance")', 'bacche Asha ki attendance' in lines and not DEV.search(lines), lines[:200])
    pm.locator('button:text-is("देवनागरी")').click(); pm.wait_for_timeout(300)
    ok('toggle back to Devanagari', DEV.search(pm.locator('.hindi-line').first.inner_text()) is not None)
    ok('Full report card button opens the English report', pm.locator('a:text-is("Full report card")').count()==2 and pm.locator('a:text-is("Full report card")').first.get_attribute('href').endswith('/report'))
    pm.locator('a:text-is("Full report card")').first.click(); pm.wait_for_timeout(1200)
    ok('report card opens', 'Academic report' in pm.inner_text('body') or 'report' in pm.url)
    # ---------- child page ----------
    go(pm,f'p/c/{sid}'); ok('child page has the Hindi button', pm.locator('a.hindi-btn').count()==1 and sw(pm)); pm.locator('a.hindi-btn').click(); pm.wait_for_timeout(1200)
    ok('child page button opens ONE card for that child', pm.url.endswith(f'#/p/c/{sid}/summary') and pm.locator('.slab h2').count()==1 and pm.locator('.slab h2').inner_text()=='Asha', pm.url)
    # ---------- desktop with a (fake) Hindi voice ----------
    cd,pd=newctx(P,1100,FAKEVOICE); go(pd,f'p/c/{sid}/summary')
    lb=pd.locator('button:text-is("सुनें (Listen)")'); ok('with a Hindi voice, the Listen button shows', lb.count()==1)
    lb.click(); sp=pd.evaluate('window.__spoken')
    pd.wait_for_timeout(400); sp=pd.evaluate('window.__spoken')
    ok('Listen speaks each Devanagari line in hi-IN through the browser voice (no paid API)', len(sp)>=4 and all(x['lang']=='hi-IN' for x in sp) and 'Asha' in sp[0]['text'], sp)
    pd.screenshot(path=f'{SH}/m12-hindi-summary-1100.png',full_page=True)
    ok('desktop: no sideways scroll', sw(pd))
    pd.emulate_media(media='print'); ok('not printed: the summary is hidden in print', pd.locator('.hindi-line').first.is_hidden()); pd.emulate_media(media='screen')
    # ---------- privacy ----------
    ok('no phone number on the summary page', not re.search(r'\d{10}',pd.inner_text('body')) and '9876543210' not in pd.inner_text('body'))
    ok('another family gets 404, a student gets 403, a teacher gets 403', status(B,'GET',f'/parent/children/{sid}/summary?lang=hi',P3['token'])==404 and status(B,'GET',f'/parent/children/{sid}/summary?lang=hi',S['token'])==403 and status(B,'GET',f'/parent/children/{sid}/summary?lang=hi',tt)==403)
    ok('bad language is 400', status(B,'GET',f'/parent/children/{sid}/summary?lang=zz',P['token'])==400)
    r=api(B,'GET',f'/parent/children/{sid}/summary?lang=hi',token=P['token'])
    ok('the API returns the text and the numbers it used', r['numbers']['attendance']['overall']['pct']==100 and r['numbers']['name']=='Asha' and len(r['lines'])>=6)
    ok('the other parent sees only their own child', [c['child']['name'] for c in api(B,'GET','/parent/summary?lang=hi',token=P3['token'])['children']]==['Meena'])
    for c in (cm,cd): c.close()
    ok('no console or page errors', not errs, errs[:3])
print('\nFAILED:' if fails else '\nALL PASSED', fails)
