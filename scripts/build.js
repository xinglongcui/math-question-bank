import {cp, mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {cloudConfig} from '../public/cloud-config.js';
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(cloudConfig.url) || !cloudConfig.key.startsWith('sb_publishable_')) throw new Error('Only a Supabase public client configuration may enter the bundle');
await build({entryPoints:['public/app.js'],outfile:'public/app.bundle.js',bundle:true,format:'esm',target:['safari16'],minify:true});
// Cloud output contains only the shell. Never bundle local credentials or Node OAuth routes.
await mkdir('dist', {recursive: true});
await cp('public', 'dist', {recursive: true});
console.log('Built static iPad PWA to dist/. Hosted subscription access is not enabled.');
