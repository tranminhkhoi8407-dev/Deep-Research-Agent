/* Real ResearchChat question UI; all API calls mocked, no inference or user auth. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.NEXORA_PLAYWRIGHT_DIR,'playwright'));
const browser=await chromium.launch({headless:true,executablePath:process.env.NEXORA_BROWSER_EXECUTABLE});
const base=process.env.NEXORA_TEST_URL||'http://127.0.0.1:5173';
const errors=[];
try {
  for (const [theme,lang,width] of [['light','vi',1440],['dark','vi',390],['light','en',320]]) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.addInitScript(({theme,lang})=>{
      localStorage.setItem('deep-research-language',lang);
      localStorage.setItem('deep-research-appearance',theme);
      localStorage.setItem('nexora-research-chat:browser-fixture','question-fixture');
    },{theme,lang});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    let replies=0,skips=0;
    const job={id:'job-fixture',action:'chat',status:'awaiting_input',stage:'awaiting_input',usage:{}};
    const question={id:'question-fixture',job_id:job.id,state:'pending',expires_at:Date.now()/1000+1800,questions:[{header:'Goal',question:'Bạn muốn học nguyên lý hay triển khai thực tế?',options:[{label:'Học nguyên lý',description:'Giải thích nền tảng'},{label:'Triển khai',description:'Các bước ứng dụng'}],custom:true,multiple:false}]};
    const detail={id:'question-fixture',engine:'opencode',model:'muse-spark-1.3-contributor-free',runtime_transport:'direct_hil_v1',title:'Public RAG question',archived:false,pinned:false,updated_at:Date.now()/1000,settings:{},messages:[{id:'msg-fixture',role:'user',body:'Giúp tôi tìm hiểu RAG',job_id:job.id}],jobs:[job],questions:[question]};
    await context.route('**/api/research/chats**',async route=>{
      const request=route.request(),suffix=new URL(request.url()).pathname.replace('/api/research/chats','');
      if(suffix==='/config')return route.fulfill({json:{opencode:{configured:true,ready:true,code:'ready',direct_enabled:true,models:[{id:detail.model,name:'Muse Spark 1.3 Free',policy:'training_data',transport:'direct_hil_v1',private_allowed:false,ready:true}]}}});
      if(suffix===''&&request.method()==='GET')return route.fulfill({json:{conversations:[detail]}});
      if(suffix.endsWith('/answer')){
        const data=request.postDataJSON();replies++;
        if(data.reject){skips++;question.state='rejected';question.answers=[];}
        else {assert.equal(data.answers.length,1);question.state='answered';question.answers=data.answers;}
        job.status='queued';job.stage='resuming';
        return route.fulfill({json:question});
      }
      if(suffix.endsWith('/stop')){job.status='cancelled';job.stage='stopped';question.state='cancelled';return route.fulfill({json:{status:'stop_requested'}});}
      return route.fulfill({json:detail});
    });
    await page.goto(base+'/tests/research-chat-preview.html?theme='+theme+'&lang='+lang);
    const card=page.locator('.research-chat__question');await card.waitFor();
    assert.equal(await page.locator('.research-chat__model-info').count(),0);
    const submit=card.getByRole('button',{name:lang==='vi'?'Gửi câu trả lời':'Submit answer',exact:true});
    assert(await submit.isDisabled(),'No answer is preselected or auto-submitted');
    assert.equal(await page.getByRole('combobox',{name:'Model OpenCode',exact:true}).count(),0);
    assert(await page.locator('.research-chat__composer textarea').isDisabled());
    await page.reload();await card.waitFor();assert.equal(replies,0);
    await page.screenshot({path:path.resolve('../tmp/research-visuals-qa/chat/muse-question-pending-'+theme+'-'+lang+'.png')});
    await card.getByRole('button',{name:/Triển khai/}).click();
    assert.equal(await card.getByRole('button',{name:/Triển khai/}).getAttribute('aria-pressed'),'true');
    assert.equal(replies,0,'Selection is not submission');
    await card.getByRole('textbox').fill('Tập trung vào ứng dụng trong một cửa hàng nhỏ.');
    assert.equal(await card.getByRole('button',{name:/Triển khai/}).getAttribute('aria-pressed'),'false');
    await card.getByRole('textbox').press('Enter');assert.equal(replies,0,'Enter in custom input is a newline, not hidden submission');
    await submit.click();await page.getByText(lang==='vi'?'Đã trả lời':'Answered',{exact:true}).waitFor();
    assert.equal(replies,1);assert.deepEqual(question.answers,[['Tập trung vào ứng dụng trong một cửa hàng nhỏ.']]);
    await page.screenshot({path:path.resolve('../tmp/research-visuals-qa/chat/muse-question-'+theme+'-'+lang+'.png')});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Question UI has no horizontal overflow');
    const pane=await page.locator('.research-chat__composer').boundingBox();assert(pane.bottom===undefined?pane.y+pane.height<=900:pane.bottom<=900);
    question.state='pending';question.answers=null;job.status='awaiting_input';job.stage='awaiting_input';
    await page.reload();await card.waitFor();
    await card.getByRole('button',{name:lang==='vi'?'Bỏ qua':'Skip',exact:true}).click();
    await page.getByText(lang==='vi'?'Đã bỏ qua':'Skipped',{exact:true}).waitFor();assert.equal(skips,1);
    question.state='pending';job.status='awaiting_input';job.stage='awaiting_input';
    await page.reload();await card.waitFor();
    await page.getByRole('button',{name:lang==='vi'?'Dừng':'Stop',exact:true}).click();
    await page.getByText(lang==='vi'?'Câu hỏi đã đóng':'Question closed',{exact:true}).waitFor();
    assert.equal(replies,2,'Stop never submits an answer');
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log('Question UI passed: VI/EN, light/dark, 320–1440px, refresh, explicit submit, custom text, skip, stop, no model selector or automatic answer.');
} finally {await browser.close();}
