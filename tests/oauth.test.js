import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatGPTOAuth, DIRECT_SCOPE} from '../src/oauth.js';
import {generateKeyPair,SignJWT} from 'jose';
const profile = () => ({data:{hostId:'urn:uuid:11111111-1111-4111-8111-111111111111'},save:async()=>{}});
const token = {access_token:'access-test',refresh_token:'refresh-test',id_token:'identity-test',token_type:'Bearer',expires_in:3600,scope:`openid ${DIRECT_SCOPE}`};
const setup = options => {
  const vault = profile();let exchanges=0;
  const oauth = new ChatGPTOAuth({vault,origin:'http://127.0.0.1:8010',
    fetchImpl: async(url,init)=>{exchanges++;assert.equal(url,'https://auth.openai.com/api/accounts/oauth/token');
      assert.equal(init.body.get('client_id'),'oaiapp_test');assert.equal(init.body.get('redirect_uri'),'http://127.0.0.1:8010/auth/callback');
      return Response.json(token);},
    verifyIdentity:async(t,client,nonce)=>({sub:'subject',email:'test@example.com',nonce}),...options});
  const url = new URL(oauth.start('browser'));
  const callback = new URL(`http://127.0.0.1:8010/auth/callback?state=${url.searchParams.get('state')}&code=one-use&client_id=oaiapp_test`);
  return {oauth,vault,url,callback,exchanges:()=>exchanges};
};
test('login starts without discovery, uses loopback PKCE and stable host',()=>{
  const {oauth,url,vault}=setup();
  assert.equal(url.origin,'https://auth.openai.com');
  assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');
  assert.equal(url.searchParams.get('ext_agent_host_id'),vault.data.hostId);
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.notEqual(new URL(oauth.start('other-browser')).searchParams.get('state'),url.searchParams.get('state'));
});
test('callback binds to browser and is one use; successful identity replaces profile',async()=>{
  const {oauth,vault,callback,exchanges}=setup();
  await assert.rejects(oauth.finish(callback,'attacker'),{code:'invalid_state'});
  assert.equal(exchanges(),0);
  await oauth.finish(callback,'browser');
  assert.equal(vault.data.registration.clientId,'oaiapp_test');
  assert.equal(await oauth.access(),'access-test');
  await assert.rejects(oauth.finish(callback,'browser'),{code:'invalid_state'});
  assert.equal(exchanges(),1);
});
test('nonce mismatch never saves calling credentials',async()=>{
  const {oauth,vault,callback}=setup({verifyIdentity:async()=>({sub:'subject',nonce:'incorrect'})});
  await assert.rejects(oauth.finish(callback,'browser'),{code:'invalid_identity'});
  assert.equal(vault.data.credential,undefined);
});
test('returning login rejects a changed client id before exchange',async()=>{
  const {oauth,vault,exchanges}=setup();vault.data.registration={clientId:'oaiapp_original',subject:'subject'};
  const start=new URL(oauth.start('browser'));
  assert.equal(start.searchParams.has('agent_name_hint'),false);
  const callback=new URL(`http://127.0.0.1:8010/auth/callback?state=${start.searchParams.get('state')}&code=code&client_id=oaiapp_test`);
  await assert.rejects(oauth.finish(callback,'browser'),{code:'client_mismatch'});assert.equal(exchanges(),0);
});
test('identity-only grant cannot power inference',async()=>{
  const vault=profile();vault.data.credential={access:'test',scopes:['openid'],expires:Date.now()+3_600_000};
  const oauth=new ChatGPTOAuth({vault,origin:'http://127.0.0.1:8010'});
  await assert.rejects(oauth.access(),{code:'scope_missing'});
});
test('refresh persists rotated token together and does not reuse dynamic client',async()=>{
  const vault=profile();vault.data.credential={access:'old',refresh:'old-refresh',clientId:'oaiapp_test',expires:0,scopes:[DIRECT_SCOPE]};
  const oauth=new ChatGPTOAuth({vault,origin:'http://127.0.0.1:8010',fetchImpl:async(url,init)=>{
    assert.equal(init.body.get('client_id'),'oaiapp_test');assert.equal(init.body.get('grant_type'),'refresh_token');
    assert.equal(init.body.has('scope'),false);return Response.json({...token,refresh_token:'rotated'});
  }});
  assert.equal(await oauth.access(),'access-test');assert.equal(vault.data.credential.refresh,'rotated');
});
test('declined and expired login attempts do not exchange a code',async()=>{
  const {oauth,url,callback,exchanges}=setup();
  callback.searchParams.set('error','access_denied');await assert.rejects(oauth.finish(callback,'browser'),{code:'access_denied'});
  const next=new URL(oauth.start('browser'));const state=next.searchParams.get('state');oauth.pending.get(state).expires=0;
  callback.searchParams.set('state',state);await assert.rejects(oauth.finish(callback,'browser'),{code:'invalid_state'});assert.equal(exchanges(),0);
});
test('production identity verification checks signature, issuer, audience and expiry',async()=>{
  const keys=await generateKeyPair('ES256');const attacker=await generateKeyPair('ES256');
  for(const invalid of [null,'signature','issuer','audience','expiry']) {
    const vault=profile();let signed;
    const oauth=new ChatGPTOAuth({vault,origin:'http://127.0.0.1:8010',fetchImpl:async()=>Response.json({...token,id_token:signed})});
    oauth.jwks=keys.publicKey;
    const start=new URL(oauth.start('browser'));
    signed=await new SignJWT({nonce:start.searchParams.get('nonce')}).setProtectedHeader({alg:'ES256'})
      .setSubject('subject').setIssuer(invalid==='issuer'?'https://attacker.example':'https://auth.openai.com')
      .setAudience(invalid==='audience'?'oaiapp_other':'oaiapp_test').setIssuedAt()
      .setExpirationTime(invalid==='expiry'?Math.floor(Date.now()/1000)-60:'5m')
      .sign(invalid==='signature'?attacker.privateKey:keys.privateKey);
    const callback=new URL(`http://127.0.0.1:8010/auth/callback?state=${start.searchParams.get('state')}&code=code&client_id=oaiapp_test`);
    if(invalid) {await assert.rejects(oauth.finish(callback,'browser'),{code:'identity_verification_failed'});assert.equal(vault.data.credential,undefined);}
    else {await oauth.finish(callback,'browser');assert.equal(vault.data.credential.subject,'subject');}
  }
});
