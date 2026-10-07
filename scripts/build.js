import {cp, mkdir, readFile, writeFile, rm, realpath, lstat} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {build} from 'esbuild';
await build({entryPoints:['public/app.js'],outfile:'public/app.bundle.js',bundle:true,format:'esm',target:['safari16'],minify:true});
// Cloud output contains only the shell. Never bundle local credentials or Node OAuth routes.
const root=await realpath('.'), output=resolve(root,'dist');
if(!output.startsWith(root+sep) || output!==resolve(root,'dist'))throw new Error('Unsafe build output path');
const previous=await lstat(output).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
if(previous?.isSymbolicLink())throw new Error('Build output must not be a symbolic link');
await rm(output,{recursive:true,force:true});
await mkdir(output, {recursive: true});
await cp('public', output, {recursive: true});
// A folder upload serves the built directory directly, so keep its headers
// without the repository's install/build/output settings.
const deployment=JSON.parse(await readFile('vercel.json','utf8'));
await writeFile('dist/vercel.json',JSON.stringify({headers:deployment.headers},null,2)+'\n');
console.log('Built static iPad PWA to dist/. Hosted subscription access is not enabled.');
