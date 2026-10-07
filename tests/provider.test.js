import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeStream,ChatGPTProvider} from '../src/provider.js';
import {readJson,publicError} from '../src/errors.js';
const event = (type, more={}) => `data: ${JSON.stringify({type,...more})}\r\n\r\n`;
function response(text, byteSize=1) {
  const bytes=new TextEncoder().encode(text);let pos=0;
  return new Response(new ReadableStream({pull(controller){if(pos===bytes.length)return controller.close();controller.enqueue(bytes.slice(pos,pos+byteSize));pos+=Math.min(byteSize,bytes.length-pos);}}));
}
test('SSE accepts split CRLF and multibyte Chinese only after completed',async()=>{
  const result=await consumeStream(response(event('response.output_text.delta',{delta:'数学题库连接成功'})+event('response.completed',{response:{usage:{input_tokens:4}}})));
  assert.equal(result.text,'数学题库连接成功');assert.equal(result.usage.input_tokens,4);
});
test('partial output is not a successful inference',async()=>{
  await assert.rejects(consumeStream(response(event('response.output_text.delta',{delta:'partial'}))),{code:'interrupted_stream'});
});
test('late subscription usage limit is surfaced',async()=>{
  await assert.rejects(consumeStream(response(event('response.output_text.delta',{delta:'partial'})+event('response.failed',{response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}))),{code:'subscription_sharing_usage_limit_exceeded'});
});
test('HTTP 403 HTML is network failure without guessing subscription eligibility or leaking body',async()=>{
  try{await readJson(new Response('<html>secret user details</html>',{status:403}),'token_exchange');assert.fail();}
  catch(error){const value=publicError(error);assert.equal(value.code,'http_403');assert.equal(value.stage,'token_exchange');assert.doesNotMatch(value.message,/secret|订阅权限不足/);}
});
test('provider uses account directory, subscription token, and permitted request fields',async()=>{
  let sent;const vault={data:{},save:async()=>{}};
  const provider=new ChatGPTProvider({vault,oauth:{access:async()=>'subscription-token'},fetchImpl:async(url,init)=>{
    assert.equal(init.headers.Authorization,'Bearer subscription-token');
    if(url.endsWith('/models'))return Response.json({models:[{slug:'account-model',display_name:'Account Model',visibility:'list'},{slug:'hidden',visibility:'hidden'}]});
    sent=JSON.parse(init.body);return response(event('response.output_text.delta',{delta:'ok'})+event('response.completed'));
  }});
  assert.deepEqual(await provider.listModels(),[{id:'account-model',name:'Account Model'}]);
  await assert.rejects(provider.test('invented-model'),{code:'model_unavailable'});
  const result=await provider.test('account-model');
  assert.equal(result.completed,true);assert.equal(sent.store,false);assert.equal(sent.stream,true);
  assert.deepEqual(Object.keys(sent).sort(),['input','model','store','stream']);assert.ok(vault.data.verifiedAt);
});
