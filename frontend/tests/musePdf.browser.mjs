/* Default-public PDF processing and clean composer, mocked APIs only. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.NEXORA_PLAYWRIGHT_DIR,'playwright'));
const browser=await chromium.launch({headless:true,executablePath:process.env.NEXORA_BROWSER_EXECUTABLE});
const base=process.env.NEXORA_TEST_URL||'http://127.0.0.1:5173';
const errors=[];
try {
  for(const [theme,lang,width] of [['light','vi',1440],['dark','vi',390],['light','en',320]]) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.addInitScript(()=>localStorage.setItem('nexora-muse-public-consent:v1:browser-fixture','accepted'));
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    const files=new Map();let uploads=0,sends=0,conversation;
    await context.route('**/api/research/chats**',async route=>{
      const request=route.request(),suffix=new URL(request.url()).pathname.replace('/api/research/chats','');
      const fulfill=(json,status=200)=>route.fulfill({json,status});
      if(suffix==='/config')return fulfill({opencode:{configured:true,ready:true,code:'ready',direct_enabled:true,models:[{id:'muse-spark-1.3-contributor-free',name:'Muse Spark 1.3 Free',ready:true,private_allowed:false,pdf_attachments:true,image_inputs:false,transport:'direct_hil_v1'}]}});
      if(suffix===''&&request.method()==='GET')return fulfill({conversations:conversation?[conversation]:[]});
      if(suffix===''&&request.method()==='POST'){
        conversation={...request.postDataJSON(),id:'pdf-fixture',title:'Public PDF',runtime_transport:'direct_hil_v1',archived:false,pinned:false,updated_at:Date.now()/1000,messages:[],jobs:[]};
        return fulfill(conversation,201);
      }
      if(suffix==='/attachments'){
        uploads++;const value={id:String(uploads).padStart(32,'0'),name:decodeURIComponent(request.headers()['x-attachment-name']),kind:'document',mime:'application/octet-stream',size:90,warning:''};
        files.set(value.id,value);return fulfill(value,201);
      }
      if(suffix.endsWith('/messages')){
        const body=request.postDataJSON();sends++;assert(!('attachment_data_ack' in body));
        const job={id:'pdf-job-'+sends,status:'completed',stage:'completed',action:'chat',usage:{}};conversation.jobs=[job];
        conversation.messages.push({id:'pdf-message-'+sends,role:'user',body:body.text||'Attached PDF',job_id:job.id,attachments:body.attachment_ids.map(id=>files.get(id))});
        return fulfill(job,202);
      }
      return fulfill(conversation||{});
    });
    await page.goto(base+'/tests/research-chat-preview.html?theme='+theme+'&lang='+lang);
    await page.getByRole('combobox',{name:lang==='vi'?'Chế độ chat':'Chat engine'}).selectOption('opencode');
    assert.equal(await page.locator('.research-chat__model-info').count(),0);
    const input=page.locator('input[type=file]'),send=page.getByRole('button',{name:lang==='vi'?'Gửi':'Send',exact:true});
    const fixture=name=>({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF- synthetic browser API fixture, not parsed')});
    await input.setInputFiles(fixture('public.pdf'));
    const consent=page.locator('.research-chat__pdf-consent');
    assert.equal(await consent.count(),0);assert(await send.isEnabled());assert.equal(uploads,0);
    await input.setInputFiles(fixture('second.pdf'));assert(await send.isEnabled(),'Added PDFs do not require confirmation');
    await page.getByRole('button',{name:(lang==='vi'?'Gỡ ':'Remove ')+'second.pdf',exact:true}).click();
    assert(await send.isEnabled());assert.equal(await consent.count(),0);
    await page.screenshot({path:path.resolve('../tmp/research-visuals-qa/chat/muse-pdf-'+theme+'-'+lang+'.png')});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await send.click();await page.locator('.research-chat__sent-files .research-chat__file').waitFor();
    assert.equal(uploads,1);assert.equal(sends,1);
    await page.reload();await page.locator('.research-chat__sent-files .research-chat__file').waitFor();
    assert.equal(uploads,1);assert.equal(sends,1,'Reload does not send the PDF again');
    await input.setInputFiles({name:'private.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic, not a real private document')});
    assert(await send.isDisabled());assert.equal(uploads,1);
    assert.equal(await page.locator('.research-chat__pdf-consent').count(),0);
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log('Muse PDF UI passed: no model bar or PDF confirmation, send enabled immediately, upload only on Send, PDF-only capability, file-only messages, refresh without replay, VI/EN and 320–1440px.');
} finally {await browser.close();}
