import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scryptSync } from 'node:crypto';
import { Writable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { createHandler } from '../api/careers.js';
import { csvCell } from '../server/security.js';
const origin='https://careers.example.test';
const salt='0123456789abcdef0123456789abcdef';
const codeHash=salt+':'+scryptSync('123456',salt,32).toString('hex');
class Response extends Writable {
 constructor(){super();this.statusCode=200;this.headers={};this.chunks=[];this.headersSent=false;}
 setHeader(k,v){this.headers[k.toLowerCase()]=v;}
 status(status){this.statusCode=status;return this;}
 json(data){this.data=data;this.end(JSON.stringify(data));return this;}
 _write(chunk,encoding,callback){this.headersSent=true;this.chunks.push(Buffer.from(chunk));callback();}
 get text(){return Buffer.concat(this.chunks).toString('utf8');}
}
test('applications, private media, admin sessions, exports and rate limiting',async()=>{
 const postgres=new PGlite();await postgres.exec(await readFile(new URL('../db/0001_careers.sql',import.meta.url),'utf8'));
 const db=drizzle(postgres);const env={SITE_ORIGIN:origin,ADMIN_CODE_HASH:codeHash};const handler=createHandler(db,env);
 async function call(action,{method='GET',body={},cookie='',ip='127.0.0.1',requestOrigin=origin}={}){
  const response=new Response();await handler({url:'/api/careers?action='+action,method,body,headers:{origin:requestOrigin,'content-type':'application/json',cookie,'x-vercel-forwarded-for':ip}},response);return response;
 }
 assert.equal((await call('dashboard')).statusCode,401);
 assert.equal((await call('csv&kind=phones')).statusCode,401);
 assert.equal((await call('login',{method:'POST',body:{code:'123456'},requestOrigin:'https://attacker.test'})).statusCode,403);
 const login=await call('login',{method:'POST',body:{code:'123456'}});assert.equal(login.statusCode,200);
 assert.match(login.headers['set-cookie'],/HttpOnly; Secure; SameSite=Strict/);const cookie=login.headers['set-cookie'].split(';')[0];
 const applicant={first_name:'=2+2',last_name:'O’Neil, "Jo"',phone:'+61 400 000 000',email:'Test@Example.com',files:[]};
 const start=await call('start',{method:'POST',body:applicant});assert.equal(start.statusCode,201,start.text);
 assert.equal((await call('dashboard',{cookie})).data.total,0,'Drafts do not count');
 const credentials={applicationId:start.data.applicationId,uploadToken:start.data.uploadToken};
 assert.equal((await call('complete',{method:'POST',body:credentials})).statusCode,200);
 assert.equal((await call('complete',{method:'POST',body:credentials})).statusCode,200,'Completion retries are idempotent');
 assert.equal((await call('dashboard',{cookie})).data.total,1);
 const phones=await call('csv&kind=phones',{cookie}),emails=await call('csv&kind=emails',{cookie});
 assert.match(phones.text,/Phone number/);assert.match(phones.text,/\+61400000000/);assert.doesNotMatch(phones.text,/test@example.com/);
 assert.match(phones.text,/"'=2\+2"/);assert.match(phones.text,/O’Neil, ""Jo""/);
 assert.match(emails.text,/test@example.com/);assert.doesNotMatch(emails.text,/61400000000/);
 assert.equal(phones.headers['cache-control'],'private, no-store, max-age=0');
 const bytes=Buffer.alloc(1024*1024+11);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
 const mediaStart=await call('start',{method:'POST',body:{...applicant,first_name:'Media',files:[{name:'work.png',type:'image/png',size:bytes.length}]}});
 assert.equal(mediaStart.statusCode,201,mediaStart.text);
 const mediaCredentials={applicationId:mediaStart.data.applicationId,uploadToken:mediaStart.data.uploadToken};const mediaId=mediaStart.data.files[0].id;
 assert.equal((await call('complete',{method:'POST',body:mediaCredentials})).statusCode,409);
 assert.equal((await call('media&id='+mediaId)).statusCode,401);
 assert.equal((await call('media&id='+mediaId,{cookie})).statusCode,404,'Draft files are not downloadable');
 const chunk={...mediaCredentials,mediaId,part:0,data:bytes.subarray(0,1024*1024).toString('base64')};
 assert.equal((await call('upload',{method:'POST',body:chunk})).statusCode,200);
 assert.equal((await call('upload',{method:'POST',body:chunk})).statusCode,200,'Chunk retry safe');
 assert.equal((await call('upload',{method:'POST',body:{...chunk,part:1,data:bytes.subarray(1024*1024).toString('base64')}})).statusCode,200);
 assert.equal((await call('complete',{method:'POST',body:mediaCredentials})).statusCode,200);
 const file=await call('media&id='+mediaId,{cookie});assert.deepEqual(Buffer.concat(file.chunks),bytes);
 assert.equal((await call('dashboard',{cookie})).data.total,2);
 assert.equal((await call('upload',{method:'POST',body:chunk})).statusCode,409,'Submitted uploads cannot be changed');
 assert.equal((await call('start',{method:'POST',body:{...applicant,email:'bad'}})).statusCode,400);
 assert.equal((await call('start',{method:'POST',body:{...applicant,files:[{name:'x',type:'text/html',size:10}]}})).statusCode,400);
 for(let i=0;i<5;i++)assert.equal((await call('login',{method:'POST',body:{code:'000000'},ip:'192.0.2.1'})).statusCode,401);
 assert.equal((await call('login',{method:'POST',body:{code:'123456'},ip:'192.0.2.1'})).statusCode,429,'Rate limits apply even if guessed code is correct');
 assert.equal((await call('logout',{method:'POST',cookie})).statusCode,200);
 assert.equal((await call('dashboard',{cookie})).statusCode,401,'Logout revokes session server-side');
 await postgres.close();
});
test('CSV cells neutralize formulas and quote correctly',()=>{
 assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell('+61412345678'),'"\'+61412345678"');
 assert.equal(csvCell('Hello, "world"'),'"Hello, ""world"""');
});
test('unconfigured backend never claims to save an application',async()=>{
 const response=new Response();await createHandler(null,{})({url:'/api/careers?action=start',headers:{},method:'POST'},response);
 assert.equal(response.statusCode,503);assert.ok(response.data.error);
});
