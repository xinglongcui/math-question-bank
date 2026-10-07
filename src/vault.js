import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DpapiProtector} from './dpapi.js';

// One local runtime, one profile. No browser token storage or cloud filesystem assumption.
export class Vault {
  constructor(directory, protector = new DpapiProtector()) {
    this.directory = directory; this.protector = protector; this.data = null;
  }
  async load() {
    await mkdir(this.directory, {recursive: true});
    try {
      this.data = JSON.parse((await this.protector.unprotect(await readFile(join(this.directory, 'profile.dpapi')))).toString());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error; // Never silently replace unreadable credentials.
      this.data = {hostId: `urn:uuid:${randomUUID()}`, registration: null, credential: null, model: null, verifiedAt: null};
      await this.save();
    }
    return this;
  }
  async save() {
    const bytes = await this.protector.protect(Buffer.from(JSON.stringify(this.data)));
    const temp = join(this.directory, `profile.${randomUUID()}.tmp`);
    await writeFile(temp, bytes, {mode: 0o600});
    await rename(temp, join(this.directory, 'profile.dpapi'));
  }
}
