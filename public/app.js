// Shelf Audit Capture. Live camera only: no file input exists anywhere in this app.
const $=s=>document.querySelector(s),LS=localStorage;
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const st={stores:[],store:null,pos:null,stream:null,seq:0,session:[],needs:[]};
// ---------- IndexedDB queue ----------
const idb=new Promise((ok,no)=>{const r=indexedDB.open('sacap',1);r.onupgradeneeded=()=>r.result.createObjectStore('q',{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
const qop=async(mode,fn)=>{const db=await idb;return new Promise((ok,no)=>{const t=db.transaction('q',mode),s=t.objectStore('q'),r=fn(s);t.oncomplete=()=>ok(r&&r.result);t.onerror=()=>no(t.error)})};
const qall=()=>qop('readonly',s=>s.getAll()),qput=v=>qop('readwrite',s=>s.put(v)),qdel=id=>qop('readwrite',s=>s.delete(id));
// ---------- capture tokens ----------
async function tokens(){let t=JSON.parse(LS.sacap_tok||'[]').filter(x=>x.expires>Date.now()+600e3);
  if(t.length<3&&navigator.onLine){try{const r=await fetch('/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({n:5-t.length})});
    if(r.ok)t=t.concat((await r.json()).sessions)}catch(e){}}
  LS.sacap_tok=JSON.stringify(t);return t}
async function token(){const t=await tokens();return t.sort((a,b)=>b.issued-a.issued)[0]}
async function sign(keyHex,msg){const k=await crypto.subtle.importKey('raw',new Uint8Array(keyHex.match(/../g).map(h=>parseInt(h,16))),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(msg)))}
// ---------- alerts ----------
let actx;function beep(bad){try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();const o=actx.createOscillator(),g=actx.createGain();o.connect(g);g.connect(actx.destination);
  const t=actx.currentTime;o.type=bad?'square':'sine';o.frequency.setValueAtTime(bad?440:880,t);if(bad)o.frequency.setValueAtTime(220,t+.18);else o.frequency.setValueAtTime(1320,t+.08);
  g.gain.setValueAtTime(.25,t);g.gain.exponentialRampToValueAtTime(.001,t+(bad?.45:.2));o.start(t);o.stop(t+.5)}catch(e){}}
function fail(title,msg){$('#btitle').textContent=title;$('#bmsg').textContent=msg;$('#banner').hidden=false;$('#banner').style.animation='none';void $('#banner').offsetWidth;$('#banner').style.animation='';
  navigator.vibrate&&navigator.vibrate([200,80,200,80,300]);beep(true)}
$('#retake').onclick=()=>{$('#banner').hidden=true;$('#result').hidden=true;$('#shoot').focus()};
// ---------- stores ----------
const hav=(a,b,c,d)=>{const R=6371e3,r=x=>x*Math.PI/180,dl=r(c-a),dn=r(d-b),q=Math.sin(dl/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(q))};
function setStore(s,how){st.store=s;$('#store').value=s?s.nm:'';LS.sacap_store=s?s.id:'';$('#storehint').textContent=s?how:'';$('#storelist').hidden=true}
function nearest(){if(!st.pos||!st.stores.length)return;const {latitude:la,longitude:lo,accuracy}=st.pos.coords;
  const d=st.stores.filter(s=>s.la).map(s=>[hav(la,lo,s.la,s.lo),s]).sort((a,b)=>a[0]-b[0]);
  if(LS.sacap_manual&&st.store)return;
  if(d[0]&&d[0][0]<=300+Math.min(accuracy||0,200))setStore(d[0][1],`Detected by location, ${Math.round(d[0][0])} m away. Tap to change.`);
  else $('#storehint').textContent=d[0]?`Nearest is ${d[0][1].nm}, ${(d[0][0]/1000).toFixed(1)} km away. Pick your store.`:'Pick your store.'}
function renderList(q){const ul=$('#storelist');q=q.toLowerCase().trim();let L=st.stores;
  if(q)L=L.filter(s=>(s.nm+' '+(s.t||'')+' '+s.ch).toLowerCase().includes(q));
  if(st.pos)L=L.map(s=>[s.la?hav(st.pos.coords.latitude,st.pos.coords.longitude,s.la,s.lo):1e9,s]).sort((a,b)=>a[0]-b[0]).map(x=>(x[1]._d=x[0],x[1]));
  ul.innerHTML=L.slice(0,12).map(s=>`<li data-id="${s.id}">${s.nm}<small>${s.ch}${s.t?' · '+s.t:''}${s._d&&s._d<1e9?' · '+(s._d<1000?Math.round(s._d)+' m':(s._d/1000).toFixed(1)+' km'):''}</small></li>`).join('')||'<li>No match</li>';ul.hidden=false}
$('#store').addEventListener('focus',e=>{e.target.select();renderList('')});$('#store').addEventListener('input',e=>renderList(e.target.value));
$('#storelist').addEventListener('pointerdown',e=>{const li=e.target.closest('li[data-id]');if(!li)return;e.preventDefault();LS.sacap_manual=1;setStore(st.stores.find(s=>s.id==li.dataset.id),'Picked by you.');$('#store').blur()});
$('#store').addEventListener('blur',()=>setTimeout(()=>{$('#storelist').hidden=true;if(st.store)$('#store').value=st.store.nm},150));
// ---------- camera ----------
async function openCam(){try{st.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:2560},height:{ideal:1920}}});
  $('#v').srcObject=st.stream;await $('#v').play();$('#camoff').hidden=true;$('#shoot').disabled=false;tokens();
  navigator.geolocation&&navigator.geolocation.watchPosition(p=>{st.pos=p;nearest()},()=>{$('#storehint').textContent='Location is off. Pick your store.'},{enableHighAccuracy:true,maximumAge:15000})}
  catch(e){fail('Camera blocked','Allow camera access for this app in Settings, then tap Open camera.')}}
$('#start').onclick=()=>{beep(false);openCam()};
function quality(cv){// quick blur (Laplacian variance) and glare (blown pixels) check in the frame box
  const w=320,h=Math.round(320*cv.height/cv.width),t=document.createElement('canvas');t.width=w;t.height=h;const x=t.getContext('2d');x.drawImage(cv,0,0,w,h);
  const d=x.getImageData(0,0,w,h).data,g=new Float32Array(w*h);for(let i=0;i<w*h;i++)g[i]=.3*d[i*4]+.59*d[i*4+1]+.11*d[i*4+2];
  let s=0,s2=0,n=0,blown=0;for(let y=Math.round(h*.15);y<h*.85;y++)for(let X=Math.round(w*.1);X<w*.9;X++){const i=y*w+X,l=4*g[i]-g[i-1]-g[i+1]-g[i-w]-g[i+w];s+=l;s2+=l*l;n++;if(g[i]>250)blown++}
  return{blur:s2/n-(s/n)**2,glare:blown/n}}
async function jpeg(cv){let q=.85,b;for(let i=0;i<6;i++){b=await new Promise(r=>cv.toBlob(r,'image/jpeg',q));if(b.size<=590*1024)return b;q-=.12}
  const t=document.createElement('canvas');t.width=cv.width*.7;t.height=cv.height*.7;t.getContext('2d').drawImage(cv,0,0,t.width,t.height);return jpeg(t)}
$('#shoot').onclick=async()=>{const v=$('#v');if(!v.videoWidth)return;if(!st.store){fail('Pick a store','Choose which store you are in before capturing.');$('#store').focus();return}
  $('#banner').hidden=true;const sh=$('#shoot');sh.disabled=true;sh.classList.add('busy');
  try{const cv=$('#c'),sc=Math.min(1,1600/Math.max(v.videoWidth,v.videoHeight));cv.width=Math.round(v.videoWidth*sc);cv.height=Math.round(v.videoHeight*sc);cv.getContext('2d').drawImage(v,0,0,cv.width,cv.height);
    const q=quality(cv);if(q.blur<18){addNeeds({t:'Blurry photo',store:st.store.nm});return fail("Couldn't read the ticket",'The photo is blurry. Hold steady and fill the yellow box with the ticket.')}
    if(q.glare>.12){addNeeds({t:'Glare on ticket',store:st.store.nm});return fail("Couldn't read the price",'Glare on the ticket. Tilt the phone slightly and retake.')}
    const blob=await jpeg(cv),hash=hex(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));const tk=await token();
    if(!tk)return fail('No capture token','Get one bar of signal for a moment so the app can get capture tokens, then retake.');
    const c=st.pos?.coords||{};const meta={nonce:tk.nonce,ts:Date.now(),lat:c.latitude??null,lng:c.longitude??null,acc:c.accuracy??null,store_id:st.store.id,hash,seq:++st.seq,device:navigator.userAgent.slice(0,80)};
    meta.sig=await sign(tk.key,[meta.nonce,meta.ts,meta.lat,meta.lng,meta.acc,meta.store_id,meta.hash,meta.seq].join('|'));
    const item={id:hash,meta,blob,store:st.store.nm};await qput(item);beep(false);navigator.vibrate&&navigator.vibrate(30);
    if(navigator.onLine)await send(item,true);else{showQueued(item);renderQ()}}
  catch(e){fail('Something went wrong',e.message)}finally{sh.disabled=false;sh.classList.remove('busy')}};
// ---------- send / sync ----------
async function send(item,live){const f=new FormData();const {sig,...m}=item.meta;f.append('img',item.blob,'c.jpg');f.append('meta',JSON.stringify(m));f.append('sig',sig);
  let r;try{r=await fetch('/api/capture',{method:'POST',body:f})}catch(e){if(live)showQueued(item);renderQ();return}
  const j=await r.json().catch(()=>({error:'Bad reply'}));
  if(r.status>=500){if(live)showQueued(item);renderQ();return}
  await qdel(item.id);renderQ();
  if(!r.ok){if(j.code==='dup')return live&&fail('Already checked in','That exact photo is already in the system.');addNeeds({t:j.error,store:item.store});return fail('Not accepted',j.error)}
  show(j,live)}
async function sync(){if(!navigator.onLine)return;tokens();for(const it of await qall())await send(it,false);tally()}
function showQueued(item){const R=$('#result');R.className='';R.hidden=false;R.innerHTML=`<span class="badge q">Queued</span><h3>Saved on your iPhone</h3><p class="hint">No signal. It will check in automatically when signal returns. If the read fails then, you'll get an alert.</p>`}
const $$=n=>n==null?'n/a':'$'+(+n).toFixed(2);
function show(j,live){const R=$('#result'),a=j.ai||{},nm=j.match?.name||a.product_name||'Unknown product';
  if(j.status==='needs_check'){addNeeds({t:j.reasons[0],store:j.store.nm,id:j.id,nm});if(live){R.hidden=true;fail(j.reasons[0].startsWith("Couldn't read")?"Couldn't read the ticket":'Needs checking',j.reasons.join('. '))}
    else fail('A queued photo needs checking',j.reasons.join('. '));return}
  const ok=j.status==='match';beep(!ok);navigator.vibrate&&navigator.vibrate(ok?[40]:[200,80,200]);
  R.className=ok?'match':'flagged';R.hidden=false;
  R.innerHTML=`<span class="badge ${ok?'g':'r'}">${ok?'Match':'Flagged'}</span> <span class="hint">${j.store.nm} · ${(j.ms/1000).toFixed(1)}s</span>
  <h3>${esc(nm)}</h3><div class="hint">${j.match?`Matched by ${j.match.by==='code'?'ticket code':'name'}${a.ticket_code?' · code '+esc(a.ticket_code):''}`:''}</div>
  <div class="prices"><div><small>Shelf</small><b>${$$(a.price)}</b>${a.was_price?`<small>was ${$$(a.was_price)}</small>`:''}</div><div><small>Online, this store</small><b>${$$(j.online?.price)}</b>${j.online?.was?`<small>was ${$$(j.online.was)}</small>`:''}</div><div><small>National median</small><b>${$$(j.national?.median)}</b></div></div>
  <ul class="ck">${(j.checks||[]).map(c=>`<li class="${c.ok?'ok':'bad'}">${c.ok?'✓':'✗'} ${c.k}: ticket ${c.k==='% off'?c.ticket+'%':$$(c.ticket)}, calculated ${c.k==='% off'?c.calc+'%':$$(c.calc)}</li>`).join('')}
  ${(j.flags||[]).map(f=>`<li class="bad">Flagged for checking: ${esc(f)}</li>`).join('')}</ul>`;
  st.session.unshift({ok,nm,p:a.price});renderS();tally()}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function addNeeds(n){st.needs.unshift(n);$('#needs').innerHTML=st.needs.map(x=>`<li><span class="dot r"></span>${esc(x.nm||x.t)}<small class="hint"> ${esc(x.nm?x.t:x.store||'')}</small></li>`).join('');$('#ncount').textContent=st.needs.length}
function renderS(){$('#session').innerHTML=st.session.map(x=>`<li><span class="dot ${x.ok?'g':'r'}"></span>${esc(x.nm)}<b>${$$(x.p)}</b></li>`).join('')}
async function renderQ(){const q=await qall();$('#qcount').textContent=q.length;$('#queue').innerHTML=q.map(x=>`<li><span class="dot"></span>${esc(x.store)} · ${new Date(x.meta.ts).toLocaleTimeString('en-NZ')}</li>`).join('')}
async function tally(){try{const j=await (await fetch('/api/tally')).json();const n=k=>(j.counts.find(c=>c.status===k)||{}).n||0;
  $('#tally').textContent=`${n('match')+n('flagged')} in · ${n('flagged')} flagged`}catch(e){}}
function net(){const on=navigator.onLine;$('#net').textContent=on?'Online':'Offline';$('#net').className='pill'+(on?'':' off');if(on)sync()}
addEventListener('online',net);addEventListener('offline',net);setInterval(sync,30000);
fetch('/cd/stores.json').then(r=>r.json()).then(s=>{st.stores=s;const id=LS.sacap_store;if(id!==undefined&&id!==''){const x=s.find(y=>y.id==id);if(x)setStore(x,'Last used store. Tap to change.')}nearest()});
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js');net();renderQ();tally();
