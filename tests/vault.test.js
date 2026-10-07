import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Vault} from '../src/vault.js';

test('Windows DPAPI vault encrypts tokens and reuses host after restart',{skip:process.platform!=='win32'},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'mathbank-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const first=await new Vault(directory).load();const host=first.data.hostId;
  first.data.credential={access:'private-test-token'};await first.save();
  assert.equal((await readFile(join(directory,'profile.dpapi'))).includes(Buffer.from('private-test-token')),false);
  const second=await new Vault(directory).load();assert.equal(second.data.hostId,host);assert.equal(second.data.credential.access,'private-test-token');
});
