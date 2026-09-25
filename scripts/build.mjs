import { mkdir, copyFile, cp, rm } from 'node:fs/promises';
if (process.env.VERCEL) await import('./migrate.mjs');
await rm('public',{recursive:true,force:true});
await mkdir('public',{recursive:true});
for(const file of ['index.html','careers.html','admin.html']) await copyFile(file,'public/'+file);
await cp('assets','public/assets',{recursive:true});
console.log('Built public website assets. Server code is excluded from the public directory.');
