# SANDBOX: Milestone 10 browser checks (multiple-choice paper tests). Start run-fake-ai.js on port 3100 in the same shell command.
import json, urllib.request, glob, os, random
from playwright.sync_api import sync_playwright
fails=[]; errs=[]
def ok(n,c):
    print(('PASS ' if c else 'FAIL ')+n)
    if not c: fails.append(n)
def api(B,method,path,body=None,token=None):
    req=urllib.request.Request(B+'/api'+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
    return json.load(urllib.request.urlopen(req))
exe=os.environ.get('CHROME') or (glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')+['/opt/pw-browsers/chromium'])[0]
B='http://localhost:3100'
t=api(B,'POST','/auth/signup',{'username':'teach'+str(random.randint(1000,9999)),'password':'pass1234','name':'Teacher One'}); tt=t['token']
cid=api(B,'POST','/classes',{'name':'Class 7'},tt)['id']
studs=[api(B,'POST',f'/classes/{cid}/students',{'name':n,'roll':str(i+1),'pin':'1234'},tt) for i,n in enumerate(['Asha','Ravi','Meena','Karan'])]
BLOCK="""Which part of the cell makes energy?
*Mitochondria
Nucleus | Thinks the nucleus does every job
Ribosome | Mixes up protein with energy
Chloroplast

Which part controls the cell?
*Nucleus
Vacuole
Ribosome | Mixes up protein with energy
Cell wall

Where is protein made?
Nucleus | Thinks the nucleus does every job
*Ribosome
Vacuole
Cell wall

Which part stores water?
Nucleus | Thinks the nucleus does every job
Mitochondria
*Vacuole
Cell wall

What gives a plant cell its shape?
Cell membrane
*Cell wall
Nucleus | Thinks the nucleus does every job
Chloroplast"""
jpg='/tmp/sheet.jpg'; open(jpg,'wb').write(b'\xff\xd8\xff\xe0'+b'0'*200+b'\xff\xd9')
with sync_playwright() as p:
    br=p.chromium.launch(executable_path=exe,args=['--no-sandbox'])
    ctx=br.new_context(viewport={'width':1100,'height':1000}); pg=ctx.new_page()
    pg.on('pageerror',lambda e: errs.append('PAGEERR '+str(e)))
    pg.on('console',lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
    pg.goto(B+'/'); pg.wait_for_timeout(800)
    def login(tok,user):
        pg.evaluate("([t,u])=>{sessionStorage.setItem('gm_token',t);sessionStorage.setItem('gm_user',JSON.stringify(u))}",[tok,user])
    def go(h): pg.goto('about:blank'); pg.goto(B+'/#/'+h); pg.wait_for_timeout(900)
    login(tt,t['user'])
    go(f't/c/{cid}/tests')
    ok('Tests page has the "New multiple-choice test" button', pg.locator('a:has-text("New multiple-choice test")').count()>=1)
    pg.locator('a:has-text("New multiple-choice test")').first.click(); pg.wait_for_timeout(700)
    ok('builder opens', pg.locator('#pm').count()==1 and 'New multiple-choice test' in pg.inner_text('body'))
    pg.fill('#pt','Cells check'); pg.fill('#ps','Science'); pg.fill('#pm',BLOCK)
    pg.locator('button:has-text("Make the draft")').click(); pg.wait_for_timeout(1200)
    body=pg.inner_text('body')
    ok('draft opens with the paper-test note and letter keys', 'Paper test: students do not answer in the app' in body and 'Key A: Mitochondria' in body)
    ok('draft has 5 questions', body.count('Key ')>=5)
    ok('draft shows the mistaken-idea tags', 'Thinks the nucleus does every job' in body)
    qurl=pg.url; qid=qurl.split('/t/q/')[1].split('/')[0]
    ok('draft shows Print question paper', pg.locator('a:has-text("Print question paper")').count()>=1)
    pg.locator('a:has-text("Print question paper")').first.click(); pg.wait_for_timeout(700)
    body=pg.inner_text('body')
    ok('question paper shows A-D options and NO key', 'A.  Mitochondria' in body and 'Key' not in body and 'Circle one letter' in body)
    go(f't/q/{qid}')
    pg.locator('button:has-text("Publish (key is right")').click(); pg.wait_for_timeout(1200)
    body=pg.inner_text('body')
    ok('published: shows sheets entered counters', 'sheets entered' in body and "Add a student's sheet" in body)
    pg.locator("a:has-text(\"Add a student's sheet\")").first.click(); pg.wait_for_timeout(700)
    ok('pick-student screen lists the class', all(n in pg.inner_text('body') for n in ['Asha','Ravi','Meena','Karan']))
    pg.locator('a.item:has-text("Asha")').click(); pg.wait_for_timeout(700)
    ok('method screen offers photo, camera and typing', all(x in pg.inner_text('body') for x in ['Upload a photo or PDF','Take a photo','Type the letters']))
    pg.locator('button.tile:has-text("Type the letters")').click(); pg.fill('#lt','BAAAB')
    pg.locator('button:has-text("Mark it")').click(); pg.wait_for_timeout(1200)
    body=pg.inner_text('body')
    ok('Asha: result shows 2/5 and a LIKELY idea', '2/5' in body and 'Likely' in body and 'Thinks the nucleus does every job' in body)
    ok('Asha: wording says likely is not proof', 'not proof' in body)
    ok('Asha: shows key letter and what she chose', 'Chose B: Nucleus' in body and 'Key A: Mitochondria' in body)
    go(f't/q/{qid}/sheet/{studs[2]["id"]}')
    pg.locator('button.tile:has-text("Type the letters")').click(); pg.fill('#lt','ABZ')
    pg.locator('button:has-text("Mark it")').click(); pg.wait_for_timeout(900)
    ok('bad letter gives a clear error', 'is not an option' in pg.inner_text('body'))
    go(f't/q/{qid}/sheet/{studs[1]["id"]}')
    pg.set_input_files('input[type=file]',jpg); pg.wait_for_timeout(1500)
    body=pg.inner_text('body')
    ok('photo: review screen shows two warnings where reads differed', 'Check the reading' in body and body.count('The two readings differed')==2)
    ok('photo: the differing rows are blank (no letter pre-selected)', pg.locator('.qrow.warn').count()==2 and pg.locator('.qrow.warn .lbtn.on:not(.none)').count()==0 and pg.locator('.qrow.warn .lbtn.none.on').count()==2)
    ok('photo: agreeing rows are pre-filled', pg.locator('.qrow:not(.warn) .lbtn.on:not(.none)').count()==3)
    rows=pg.locator('.qrow')
    rows.nth(1).locator('.lbtn:has-text("C")').first.click(); rows.nth(3).locator('.lbtn:has-text("C")').first.click()
    pg.wait_for_timeout(200)
    pg.locator('button:has-text("Confirm and mark")').click(); pg.wait_for_timeout(1200)
    body=pg.inner_text('body')
    ok('photo: after confirming, Ravi is marked 2/5 with a likely and a suspected idea', '2/5' in body and 'Likely' in body and 'Suspected' in body)
    ok('photo: the original sheet is shown on the result page', pg.locator('img.sheet-img').count()==1)
    for i,l in [(2,'AABCB'),(3,'AABCA')]:
        go(f't/q/{qid}/sheet/{studs[i]["id"]}'); pg.locator('button.tile:has-text("Type the letters")').click(); pg.fill('#lt',l); pg.locator('button:has-text("Mark it")').click(); pg.wait_for_timeout(900)
    ok('wrong answer with no recorded idea says unclear, no guess', 'will not guess' in pg.inner_text('body'))
    go(f't/q/{qid}')
    body=pg.inner_text('body')
    ok('participation shows 4 sheets entered', '4' in body and 'Open answers' in body)
    ok('participation shows the nucleus idea as a pattern with Send a practice quiz', 'Thinks the nucleus does every job' in body and pg.locator('button:has-text("Send a practice quiz")').count()>=1)
    pg.locator('button:has-text("Send a practice quiz")').first.click(); pg.wait_for_timeout(1500)
    body=pg.inner_text('body')
    ok('practice quiz opens as a DRAFT for 2 students only', 'Practice quiz for 2 students only' in body and 'Publish to these students' in body)
    pq=pg.url.split('/t/q/')[1].split('/')[0]
    pg.locator('button:has-text("Publish to these students")').click(); pg.wait_for_timeout(1200)
    ok('practice quiz published for 2 students', 'only' in pg.inner_text('body') and '2' in pg.inner_text('body'))
    def student(i):
        s=api(B,'POST','/auth/login',{'username':studs[i]['login']['username'],'password':'1234','role':'student'})
        login(s['token'],s['user']); return s
    student(0); go('s/quizzes'); body=pg.inner_text('body')
    ok('Asha sees the paper test labelled Paper test', 'Paper test' in body and 'Cells check' in body)
    ok('Asha sees the group practice quiz labelled For you', 'For you' in body and 'Practice: ' in body)
    pg.locator('a.item:has-text("Cells check")').first.click(); pg.wait_for_timeout(900)
    body=pg.inner_text('body')
    ok('Asha result: marked by teacher, her problem and the next-step wording', 'Your teacher marked your paper test: 2 out of 5' in body and 'Your problem' in body and 'Next step: your teacher may send you a practice quiz for this idea. Look in your Quizzes.' in body)
    ok('Asha result: per-question wording', 'You chose: Nucleus' in body and 'Right answer: Mitochondria' in body and 'Looks like: Thinks the nucleus does every job' in body)
    ok('no maths practice-set button on a choice test', 'Make a new practice' not in body)
    student(2); go('s/quizzes'); body=pg.inner_text('body')
    ok('Meena (not in the group) does NOT see the practice quiz', 'Practice: ' not in body and 'For you' not in body)
    student(3); go('s/quizzes'); body=pg.inner_text('body')
    ok('Karan sees his paper test too (sheet entered)', 'Cells check' in body and 'Practice: ' not in body)
    br.close()
bad=[e for e in errs]
ok('no console or page errors', not bad)
for e in bad[:5]: print('  ',e)
print('FAILS:',fails if fails else 'none')
