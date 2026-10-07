import {cloudConfig} from '../future/supabase/cloud-config.js';
const headers={apikey:cloudConfig.key};
for(const path of ['/auth/v1/settings','/rest/v1/math_questions?select=id&limit=1']) {
  const response=await fetch(cloudConfig.url+path,{headers,signal:AbortSignal.timeout(20000)});
  const data=await response.json().catch(()=>({}));
  console.log(JSON.stringify({endpoint:path.split('?')[0],status:response.status,code:data.code ?? null,emailLoginEnabled:data.external?.email ?? null}));
}
