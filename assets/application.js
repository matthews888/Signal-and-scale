const form = document.querySelector('#application-form');
const media = document.querySelector('#media');
const list = document.querySelector('#selected-files');
const status = document.querySelector('#form-status');
const submit = form.querySelector('button[type=submit]');
let draft, busy = false, completed = false;
form.addEventListener('input', () => { if (!busy) draft = null; });
media.addEventListener('change', () => {
  const files = [...media.files]; list.replaceChildren(); draft = null;
  media.setCustomValidity(files.length > 3 ? 'Please attach up to 3 files.' : files.reduce((n,f)=>n+f.size,0) > 10*1024*1024 ? 'Please keep attachments under 10 MB combined.' : '');
  files.forEach(file => { const li=document.createElement('li'); li.textContent=file.name+' ('+(file.size/1024/1024).toFixed(1)+' MB)'; list.append(li); });
});
async function post(action, body) {
  const response = await fetch('/api/careers?action='+action, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result = await response.json().catch(()=>({error:'Unable to submit right now. Please try again.'}));
  if (!response.ok) { const error=new Error(result.error); error.status=response.status; throw error; }
  return result;
}
const base64 = blob => new Promise((resolve,reject)=>{ const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Unable to read this file. Please select it again.'));reader.readAsDataURL(blob); });
form.addEventListener('submit', async event => {
 event.preventDefault(); if (busy || completed || !form.reportValidity()) return;
 busy=true; submit.disabled=true; status.className='';
 const controls=[...form.querySelectorAll('input')];
 const data=Object.fromEntries(new FormData(form));
 const files=[...media.files];
 controls.forEach(input=>input.disabled=true);
 try {
  status.textContent='Saving your application…';
  if (!draft) draft=await post('start',{first_name:data.first_name,last_name:data.last_name,phone:data.phone,email:data.email,website:data.website,files:files.map(f=>({name:f.name,size:f.size,type:f.type}))});
  for(let i=0;i<files.length;i++) {
   const file=files[i], descriptor=draft.files[i];
   for(let part=0;part<descriptor.parts;part++) {
    status.textContent='Uploading '+file.name+' — '+Math.round(part/descriptor.parts*100)+'%';
    await post('upload',{applicationId:draft.applicationId,uploadToken:draft.uploadToken,mediaId:descriptor.id,part,data:await base64(file.slice(part*draft.chunkSize,(part+1)*draft.chunkSize))});
   }
  }
  await post('complete',{applicationId:draft.applicationId,uploadToken:draft.uploadToken});
  completed=true;
  form.querySelector('.form-grid').hidden=true;form.querySelector('.media-field').hidden=true;
  form.querySelectorAll('.form-intro').forEach(el=>el.hidden=true);
  status.className='success';status.textContent='Application submitted. Thank you — we’ll be in touch if you’re a match for the role.';
  submit.hidden=true; draft=null;
 } catch(error) {
  status.textContent=error.message || 'Your application could not be submitted. Please try again.';
  if ([400,403,409].includes(error.status)) draft=null;
 } finally { busy=false; if (!completed) {submit.disabled=false;controls.forEach(input=>input.disabled=false);} }
});
