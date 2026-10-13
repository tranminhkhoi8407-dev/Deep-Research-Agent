import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGuard } from '../../scripts/opencode_direct_guard.mjs';
const upstream = 'https://opencode.ai/inference/openai/v1/chat/completions';
const model = 'mimo-v2.6-flash-free';
function fixture() {
  const actions=[], providers=[]; let approved=true;
  const fetchImpl=async (url, init) => {
    if (String(url)===upstream) { providers.push(JSON.parse(init.body)); return Response.json({ usage:{prompt_tokens:20,completion_tokens:1},choices:[{message:{content:'OK'}}] }); }
    const action=String(url).split('/').pop(), body=JSON.parse(init.body); actions.push({action,body});
    if (!approved) return Response.json({detail:'opencode_direct_budget'},{status:429});
    return Response.json(action==='reserve'?{request_id:body.request_id,output_cap:64,deadline:Date.now()/1000+60}:{ok:true});
  };
  const guard=createGuard({controlURL:'http://127.0.0.1:8000/internal/opencode/direct',token:'synthetic-token-with-at-least-32-characters',key:'synthetic-key',model,fetchImpl});
  const params=()=>guard.params({sessionID:'ses_fixture',agent:'build',model:{id:model,providerID:'opencode'}},{maxOutputTokens:99999});
  const send=changes=>guard.fetch(upstream,{method:'POST',headers:{'x-opencode-session':'ses_fixture'},body:JSON.stringify({model,messages:[{role:'user',content:'public fixture'}],tools:[{type:'function',function:{name:'bash'}}],stream:false,max_tokens:99999,...changes})});
  return {guard,actions,providers,params,send,deny:()=>{approved=false;}};
}
test('real request is authorized and reserved before native provider fetch',async()=>{
  const f=fixture(); await f.params(); await f.send();
  assert.deepEqual(f.actions.map(x=>x.action),['check','reserve','settle']);
  assert.equal(f.providers[0].max_tokens,64);
  assert.equal(f.providers[0].tools[0].function.name,'bash','The genuine tool definition is not stripped or fabricated');
  assert.equal(f.actions[1].body.model,model);
  assert(!JSON.stringify(f.actions).includes('synthetic-key'));
});
test('denied authorization/budget never reaches provider',async()=>{
  const f=fixture(); await f.params(); f.deny(); await assert.rejects(f.send(),/opencode_direct_budget/); assert.equal(f.providers.length,0);
});
test('no model switch, unguarded fetch, alternate provider URL or tool execution',async()=>{
  const f=fixture(); await assert.rejects(f.send(),/request_rejected/);
  await f.params(); await assert.rejects(f.send({model:'paid-model'}),/model_changed/);
  for (const tool of ['bash','read','edit','task','webfetch','nexora_evidence_read_other']) await assert.rejects(f.guard.tool({tool,sessionID:'ses_fixture'}),/tool_denied/);
  assert.equal(f.providers.length,0);
  await f.guard.tool({tool:'nexora_evidence_read',sessionID:'ses_fixture'});
  assert.equal(f.actions.at(-1).action,'tool');
});
test('invalid settings fail closed before attaching a provider',()=>{
  assert.throws(()=>createGuard({controlURL:'https://evil.invalid',token:'x',key:'x',model}),/configuration/);
  const f=fixture(); assert.throws(()=>f.guard.configure({enabled_providers:['opencode'],provider:{opencode:{options:{}}},permission:{'*':'allow'},agent:{build:{permission:{'*':'ask'}}}}),/configuration/);
});

test('Muse uses Responses, bounds output and measures nested SSE usage',async()=>{
  const actions=[],sent=[];
  const muse='muse-spark-1.3-contributor-free',url='https://opencode.ai/inference/openai/v1/responses';
  const fetchImpl=async (target,init)=>{
    if (String(target)===url) {
      sent.push(JSON.parse(init.body));
      const event='data: '+JSON.stringify({type:'response.completed',response:{usage:{input_tokens:51,output_tokens:7}}})+'\n\n';
      return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(event));c.close();}}));
    }
    const action=String(target).split('/').pop(),body=JSON.parse(init.body);actions.push({action,body});
    return Response.json(action==='reserve'?{request_id:body.request_id,output_cap:64,deadline:Date.now()/1000+60}:{ok:true});
  };
  const guard=createGuard({model:muse,interactive:true,controlURL:'http://127.0.0.1:8000/internal/opencode/direct',token:'synthetic-token-with-at-least-32-characters',key:'synthetic-key',fetchImpl});
  await guard.params({sessionID:'ses_fixture',agent:'build',model:{id:muse,providerID:'opencode'}},{});
  const request=changes=>guard.fetch(url,{method:'POST',headers:{'x-opencode-session':'ses_fixture'},body:JSON.stringify({model:muse,input:[{role:'user',content:'Public fixture'}],stream:true,max_output_tokens:99999,store:true,...changes})});
  await (await request()).text();
  assert.equal(sent[0].max_output_tokens,64);assert.equal(sent[0].store,false);assert(!('stream_options' in sent[0]));
  assert.deepEqual(actions.at(-1).body.usage,{input_tokens:51,output_tokens:7});
  await guard.tool({tool:'question',sessionID:'ses_fixture'});
  for (const tool of ['bash','read','edit','task']) await assert.rejects(guard.tool({tool,sessionID:'ses_fixture'}),/tool_denied/);
  for (const changes of [{previous_response_id:'resp_other'},{conversation:'other'},{background:true},{model:'muse-spark-1.3'}]) await assert.rejects(request(changes));
  assert.equal(sent.length,1);
});
