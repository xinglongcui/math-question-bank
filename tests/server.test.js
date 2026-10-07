import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createApp} from '../src/server.js';

test('HTTP protects host, CSRF and secrets, and local proof status is honest',async t=>{
  const server=http.createServer();server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>server.close());
  const origin=`http://127.0.0.1:${server.address().port}`;
  const vault={data:{hostId:'urn:uuid:11111111-1111-4111-8111-111111111111'},save:async()=>{}};
  const app=createApp({vault,origin});server.on('request',app.handler);
  const status=await fetch(`${origin}/api/status`);const data=await status.json();
  assert.equal(data.mode,'local');assert.equal(data.connected,false);assert.equal(data.verifiedAt,undefined);
  assert.doesNotMatch(JSON.stringify(data),/access_token|refresh_token|idToken/);
  const cookie=status.headers.get('set-cookie').split(';')[0];
  const post=(path,headers={})=>fetch(`${origin}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...headers},body:'{}'});
  assert.equal((await post('/api/connect')).status,403);
  const connected=await post('/api/connect',{Origin:origin,'X-CSRF-Token':data.csrf});
  assert.equal(connected.status,200);assert.equal(new URL((await connected.json()).url).origin,'https://auth.openai.com');
  assert.equal((await fetch(`${origin}/.local/profile.dpapi`)).status,404);
  const badHost=await new Promise((resolve,reject)=>{
    const req=http.get(`${origin}/api/status`,{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);
  });
  assert.equal(badHost,403);
  const page=await fetch(origin);assert.match(await page.text(),/今晚一题/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
