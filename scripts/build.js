import {cp, mkdir} from 'node:fs/promises';
// Cloud output contains only the shell. Never bundle local credentials or Node OAuth routes.
await mkdir('dist', {recursive: true});
await cp('public', 'dist', {recursive: true});
console.log('Built static iPad PWA to dist/. Hosted subscription access is not enabled.');
