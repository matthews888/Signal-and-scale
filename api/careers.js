import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { sql } from 'drizzle-orm';
import { getDatabase } from '../server/db.js';
import { digest, fingerprint, checkCode, csvCell, isExpectedMedia } from '../server/security.js';
const CHUNK = 1024 * 1024;
const cookieName = '__Host-ss_admin';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TYPES = ['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime','video/webm'];
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
function textField(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) fail(400, 'Please enter a valid ' + name + '.');
  return value.trim();
}
export function createHandler(database, env = process.env) {
 // ADMIN_CODE is a server-only Vercel secret for simple owner setup.
 // Prefer ADMIN_CODE_HASH when provisioning via the supplied local helper.
 const adminCode = env.ADMIN_CODE ?? env.Clientpassword;
 const storedHash = env.ADMIN_CODE_HASH || (/^\d{6}$/.test(adminCode || '') ? (()=>{
  const salt=digest('signal-and-scale:'+env.SITE_ORIGIN).slice(0,32);
  return salt+':'+scryptSync(adminCode,salt,32).toString('hex');
 })() : '');
 env={...env,ADMIN_CODE_HASH:storedHash};
 return async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const json = (status, data) => res.status(status).json(data);
  try {
   if (!env.SITE_ORIGIN || !env.ADMIN_CODE_HASH) fail(503, 'Applications are temporarily unavailable. Please try again later.');
   const db = database || getDatabase();
   const query = async statement => (await db.execute(statement)).rows;
   const url = new URL(req.url, env.SITE_ORIGIN);
   const action = url.searchParams.get('action') || '';
   if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow','GET, POST'); fail(405,'Method not allowed.'); }
   if (req.method === 'POST') {
    const allowed = [env.SITE_ORIGIN, ...(env.VERCEL_ENV !== 'production' && env.VERCEL_URL ? ['https://' + env.VERCEL_URL] : [])];
    if (!allowed.includes(req.headers.origin)) fail(403, 'Please submit this form from our website.');
    if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'JSON required.');
   }
   const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) : {};
   if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid request.');
   async function limit(key, maximum, seconds) {
    const window = Math.floor(Date.now() / (seconds * 1000));
    const id = key + ':' + window;
    const [row] = await query(sql`INSERT INTO career_limits(key,count,expires_at) VALUES(${id},1,now()+${seconds}*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=career_limits.count+1 RETURNING count`);
    if (row.count > maximum) { res.setHeader('Retry-After', String(seconds)); fail(429,'Too many attempts. Please try again later.'); }
   }
   const ip = (req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
   const ipHash = fingerprint(ip, env.ADMIN_CODE_HASH);
   function tokenFromCookie() { return (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1) || ''; }
   async function admin() {
    const token = tokenFromCookie();
    if (!/^[a-f0-9]{64}$/.test(token)) fail(401,'Please sign in to continue.');
    const [session] = await query(sql`SELECT token_hash FROM career_sessions WHERE token_hash=${digest(token)} AND expires_at>now() AND code_version=${digest(env.ADMIN_CODE_HASH)}`);
    if (!session) fail(401,'Your session has expired. Please sign in again.');
    return digest(token);
   }
   async function draft() {
    if (!UUID.test(body.applicationId || '') || !/^[a-f0-9]{64}$/.test(body.uploadToken || '')) fail(403,'Invalid upload session.');
    const [app] = await query(sql`SELECT id,submitted_at FROM career_applications WHERE id=${body.applicationId} AND upload_hash=${digest(body.uploadToken)} AND upload_expires>now()`);
    if (!app) fail(403,'Your upload session has expired. Please submit again.');
    return app;
   }
   if (action === 'login' && req.method === 'POST') {
    await limit('login:'+ipHash, 5, 900); await limit('login:all', 30, 900);
    if (!await checkCode(body.code, env.ADMIN_CODE_HASH)) fail(401,'Incorrect code. Please try again.');
    const token = randomBytes(32).toString('hex');
    await query(sql`INSERT INTO career_sessions(token_hash,code_version,expires_at) VALUES(${digest(token)},${digest(env.ADMIN_CODE_HASH)},now()+interval '12 hours')`);
    res.setHeader('Set-Cookie',cookieName+'='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200');
    return json(200,{ok:true});
   }
   if (action === 'logout' && req.method === 'POST') {
    const token = tokenFromCookie();
    if (token) await query(sql`DELETE FROM career_sessions WHERE token_hash=${digest(token)}`);
    res.setHeader('Set-Cookie',cookieName+'=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
    return json(200,{ok:true});
   }
   if (action === 'start' && req.method === 'POST') {
    await limit('apply:'+ipHash, 10, 3600); await limit('apply:all', 500, 3600);
    if (body.website) fail(400,'Unable to submit this application.');
    const first = textField(body.first_name,'first name',100), last = textField(body.last_name,'last name',100);
    const email = textField(body.email,'email address',254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'Please enter a valid email address.');
    const phoneRaw = textField(body.phone,'phone number',40);
    const phone = phoneRaw.replace(/[\s().-]/g,'');
    if (!/^\+?[0-9]{7,15}$/.test(phone)) fail(400,'Please enter a valid phone number, including your country code.');
    const files = body.files || [];
    if (!Array.isArray(files) || files.length>3 || files.reduce((n,f)=>n+Number(f?.size||0),0)>10*CHUNK) fail(400,'Attach up to 3 files, 10 MB combined.');
    const manifest = files.map(f=>{
     if (!f || !TYPES.includes(f.type) || !Number.isInteger(f.size) || f.size<=0 || f.size>10*CHUNK) fail(400,'Please attach a supported photo or video.');
     const name=textField(f.name,'file name',200).replace(/[\\/]/g,'_');
     return {id:randomUUID(),name,mime:f.type,size:f.size,parts:Math.ceil(f.size/CHUNK)};
    });
    const id=randomUUID(), token=randomBytes(32).toString('hex');
    await db.transaction(async tx=>{
     await tx.execute(sql`INSERT INTO career_applications(id,first_name,last_name,phone,email,role,upload_hash,upload_expires) VALUES(${id},${first},${last},${phone},${email},'UGC Creator',${digest(token)},now()+interval '1 hour')`);
     for (const f of manifest) await tx.execute(sql`INSERT INTO career_media(id,application_id,name,mime,size,parts) VALUES(${f.id},${id},${f.name},${f.mime},${f.size},${f.parts})`);
     await tx.execute(sql`DELETE FROM career_applications WHERE submitted_at IS NULL AND upload_expires<now()-interval '1 day'`);
     await tx.execute(sql`DELETE FROM career_limits WHERE expires_at<now()-interval '1 day'`);
     await tx.execute(sql`DELETE FROM career_sessions WHERE expires_at<now()`);
    });
    return json(201,{applicationId:id,uploadToken:token,files:manifest,chunkSize:CHUNK});
   }
   if (action === 'upload' && req.method === 'POST') {
    const app=await draft();
    if (app.submitted_at) fail(409,'This application has already been submitted.');
    if (!UUID.test(body.mediaId||'') || !Number.isInteger(body.part)) fail(400,'Invalid upload.');
    const [file]=await query(sql`SELECT * FROM career_media WHERE id=${body.mediaId} AND application_id=${app.id}`);
    if (!file || body.part<0 || body.part>=file.parts || typeof body.data!=='string' || body.data.length>Math.ceil(CHUNK/3)*4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) fail(400,'Invalid upload.');
    const bytes=Buffer.from(body.data,'base64');
    const expected=body.part===file.parts-1 ? file.size-body.part*CHUNK : CHUNK;
    if (bytes.length!==expected || bytes.toString('base64')!==body.data) fail(400,'The upload is incomplete. Please try again.');
    if (body.part===0 && !isExpectedMedia(bytes,file.mime)) fail(400,'This file does not match its photo or video format.');
    await query(sql`INSERT INTO career_chunks(media_id,part,data) SELECT ${file.id},${body.part},decode(${bytes.toString('hex')},'hex') WHERE EXISTS (SELECT 1 FROM career_applications WHERE id=${app.id} AND submitted_at IS NULL) ON CONFLICT(media_id,part) DO NOTHING`);
    const [existing]=await query(sql`SELECT encode(data,'hex') AS hex FROM career_chunks WHERE media_id=${file.id} AND part=${body.part}`);
    if (existing?.hex!==bytes.toString('hex')) fail(409,'The file changed. Please reload and submit again.');
    return json(200,{ok:true});
   }
   if (action==='complete' && req.method==='POST') {
    const app=await draft();
    if (app.submitted_at) return json(200,{ok:true});
    const missing=await query(sql`SELECT f.id FROM career_media f LEFT JOIN career_chunks c ON c.media_id=f.id WHERE f.application_id=${app.id} GROUP BY f.id HAVING count(c.part)<>f.parts OR coalesce(sum(octet_length(c.data)),0)<>f.size`);
    if (missing.length) fail(409,'Please finish uploading all files before submitting.');
    await query(sql`UPDATE career_applications SET submitted_at=now() WHERE id=${app.id} AND submitted_at IS NULL`);
    return json(200,{ok:true});
   }
   if (['dashboard','csv','media'].includes(action) && req.method==='GET') {
    await admin();
    if (action==='dashboard') {
     const page=Math.max(1,Math.min(100000,Number(url.searchParams.get('page'))||1));
     const offset=(Math.floor(page)-1)*25;
     const [count]=await query(sql`SELECT count(*)::integer AS total FROM career_applications WHERE submitted_at IS NOT NULL`);
     const apps=await query(sql`SELECT id,first_name,last_name,phone,email,role,submitted_at FROM career_applications WHERE submitted_at IS NOT NULL ORDER BY submitted_at DESC,id DESC LIMIT 25 OFFSET ${offset}`);
     const media=apps.length ? await query(sql`SELECT id,application_id,name,size FROM career_media WHERE application_id IN (${sql.join(apps.map(a=>sql`${a.id}::uuid`),sql`,`)}) ORDER BY name`) : [];
     return json(200,{total:count.total,page:Math.floor(page),applications:apps.map(a=>({...a,media:media.filter(f=>f.application_id===a.id)}))});
    }
    if (action==='csv') {
     const kind=url.searchParams.get('kind');
     if (!['phones','emails'].includes(kind)) fail(400,'Choose a CSV file.');
     res.setHeader('Content-Type','text/csv; charset=utf-8');
     res.setHeader('Content-Disposition','attachment; filename="'+(kind==='phones'?'phone-numbers':'emails')+'.csv"');
     const [snapshot]=await query(sql`SELECT now() AS cutoff`);
     res.write('\uFEFF'+['First name','Last name',kind==='phones'?'Phone number':'Email address'].map(csvCell).join(',')+'\r\n');
     let cursor=null;
     while (true) {
      const condition=cursor ? sql`AND id>${cursor}::uuid` : sql``;
      const rows=await query(sql`SELECT id,first_name,last_name,phone,email FROM career_applications WHERE submitted_at IS NOT NULL AND submitted_at<=${snapshot.cutoff} ${condition} ORDER BY id LIMIT 500`);
      for (const a of rows) {
       if (!res.write([a.first_name,a.last_name,kind==='phones'?a.phone:a.email].map(csvCell).join(',')+'\r\n')) await once(res,'drain');
      }
      if (rows.length<500) break;
      cursor=rows.at(-1).id;
     }
     return res.end();
    }
    const id=url.searchParams.get('id');
    if (!UUID.test(id||'')) fail(404,'File not found.');
    const [file]=await query(sql`SELECT f.* FROM career_media f JOIN career_applications a ON a.id=f.application_id WHERE f.id=${id} AND a.submitted_at IS NOT NULL`);
    if (!file) fail(404,'File not found.');
    res.setHeader('Content-Type','application/octet-stream');
    res.setHeader('Content-Disposition',"attachment; filename=\"attachment\"; filename*=UTF-8''"+encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)));
    res.setHeader('Content-Length',file.size);
    for(let part=0;part<file.parts;part++) {
     const [chunk]=await query(sql`SELECT encode(data,'hex') AS hex FROM career_chunks WHERE media_id=${file.id} AND part=${part}`);
     if (!chunk) throw new Error('Missing media chunk');
     if (!res.write(Buffer.from(chunk.hex,'hex'))) await once(res,'drain');
    }
    return res.end();
   }
   fail(404,'Not found.');
  } catch(error) {
   if (res.headersSent) { res.destroy(); return; }
   const status=error.status || (error instanceof SyntaxError ? 400 : 503);
   if (!error.status && !(error instanceof SyntaxError)) console.error('Careers request failed:',error.code || error.name);
   return json(status,{error:error.status ? error.message : status===400 ? 'Invalid request.' : 'Something went wrong. Please try again shortly.'});
  }
 };
}
export default createHandler();
