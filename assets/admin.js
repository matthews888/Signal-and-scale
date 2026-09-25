const $ = selector => document.querySelector(selector);
let page=1, loading=false;
function showLogin(message='') { $('#dashboard').hidden=true;$('#logout').hidden=true;$('#login-panel').hidden=false;$('#loading').hidden=true;$('#login-status').textContent=message;$('#applications').replaceChildren();$('#total').textContent='—'; }
async function request(url, options) { const response=await fetch(url,{cache:'no-store',...options});if(!response.ok){const data=await response.json().catch(()=>({}));const error=new Error(data.error||'Unable to load applications. Please try again.');error.status=response.status;throw error;}return response; }
async function load() {
 if(loading)return;loading=true;
 try {
  const response=await request('/api/careers?action=dashboard&page='+page),data=await response.json();
  $('#login-panel').hidden=true;$('#dashboard').hidden=false;$('#logout').hidden=false;$('#loading').hidden=true;$('#dashboard-status').textContent='';
  $('#total').textContent=data.total.toLocaleString();document.querySelectorAll('.record-count').forEach(el=>el.textContent=data.total.toLocaleString()+' applicants');
  $('#page-label').textContent=data.total?'Page '+page+' of '+Math.ceil(data.total/25):'';
  $('#previous').disabled=page<=1;$('#next').disabled=page*25>=data.total;
  const list=$('#applications');list.replaceChildren();
  if(!data.applications.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='No applications yet. New applicants will appear here once they submit the careers form.';list.append(empty);}
  for(const app of data.applications){const card=document.createElement('article');card.className='applicant';const name=document.createElement('h3');name.textContent=app.first_name+' '+app.last_name;card.append(name);
   for(const text of [app.phone,app.email]){const p=document.createElement('p');p.textContent=text;card.append(p);}const date=document.createElement('p');date.className='date';date.textContent=new Date(app.submitted_at).toLocaleString();card.append(date);
   if(app.media.length){const files=document.createElement('div');files.className='media-links';for(const file of app.media){const button=document.createElement('button');button.className='secondary';button.textContent=file.name+' ↓';button.dataset.download='/api/careers?action=media&id='+file.id;button.dataset.filename=file.name;files.append(button);}card.append(files);}list.append(card);
  }
 } catch(error) { if(error.status===401)showLogin();else if($('#dashboard').hidden)showLogin(error.message);else $('#dashboard-status').textContent=error.message; }
 finally{loading=false;}
}
$('#login-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;$('#login-status').textContent='Signing in…';try{await request('/api/careers?action=login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('#code').value})});$('#code').value='';await load();}catch(error){$('#login-status').textContent=error.message;}finally{button.disabled=false;}});
$('#logout').addEventListener('click',async()=>{try{await request('/api/careers?action=logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});showLogin();}catch(error){$('#dashboard-status').textContent=error.message;}});
$('#refresh').addEventListener('click',load);$('#previous').addEventListener('click',()=>{page--;load();});$('#next').addEventListener('click',()=>{page++;load();});
document.addEventListener('click',async event=>{const button=event.target.closest('button[data-download]');if(!button)return;button.disabled=true;try{const response=await request(button.dataset.download),blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=button.dataset.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(error){if(error.status===401)showLogin('Please sign in again to download.');else $('#dashboard-status').textContent=error.message;}finally{button.disabled=false;}});
setInterval(()=>{if(!document.hidden&&!$('#dashboard').hidden)load();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('#dashboard').hidden)load();});
load();
