// Shelf Audit Capture API. Live-camera captures only: every capture must carry an HMAC made with a
// server-issued, short-lived session key, plus capture time, location and the SHA-256 of the image.
const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha=async d=>hex(await crypto.subtle.digest('SHA-256',typeof d==='string'?new TextEncoder().encode(d):d));
const rnd=n=>hex(crypto.getRandomValues(new Uint8Array(n)));
const SESSION_MS=12*3600e3, MAXB=600*1024, MODELS=['@cf/meta/llama-4-scout-17b-16e-instruct','@cf/meta/llama-3.2-11b-vision-instruct'];
let ready=false;
async function init(env){if(ready)return;
  await env.DB.batch([
   env.DB.prepare("CREATE TABLE IF NOT EXISTS cap_sessions(nonce TEXT PRIMARY KEY, key TEXT, issued INTEGER, expires INTEGER, ip_hash TEXT)"),
   env.DB.prepare("CREATE TABLE IF NOT EXISTS captures(id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT DEFAULT (datetime('now')), source TEXT DEFAULT 'app_capture', status TEXT, reasons TEXT, store_id INTEGER, store_name TEXT, chain TEXT, product_key TEXT, product_name TEXT, ticket_name TEXT, ticket_code TEXT, shelf_price REAL, was_price REAL, unit_price REAL, unit_basis TEXT, special TEXT, pct_label REAL, save_label REAL, online_price REAL, online_was REAL, national_median REAL, national_median_regular REAL, match_score REAL, ai_json TEXT, img BLOB, img_hash TEXT UNIQUE, cap_ts INTEGER, lat REAL, lng REAL, acc REAL, nonce TEXT, device TEXT, ip_hash TEXT)"),
   env.DB.prepare("CREATE INDEX IF NOT EXISTS cap_status ON captures(status)"),
   env.DB.prepare("CREATE TABLE IF NOT EXISTS hits(ip_hash TEXT, kind TEXT, ts INTEGER)")]);await env.DB.prepare("UPDATE captures SET source='app_capture_test' WHERE (device LIKE 'test%' OR device LIKE '%test-e2e%') AND source='app_capture'").run();ready=true}
async function limit(env,ip,kind,max,win){const now=Date.now();
  const c=(await env.DB.prepare('SELECT COUNT(*) n FROM hits WHERE ip_hash=? AND kind=? AND ts>?').bind(ip,kind,now-win).first()).n;
  if(c>=max)return false;await env.DB.prepare('INSERT INTO hits VALUES(?,?,?)').bind(ip,kind,now).run();return true}
async function hmac(keyHex,msg){const k=await crypto.subtle.importKey('raw',new Uint8Array(keyHex.match(/../g).map(h=>parseInt(h,16))),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(msg)))}
const cache={};
async function asset(env,req,path){if(cache[path])return cache[path];
  const r=await env.ASSETS.fetch(new URL(path,req.url));if(!r.ok)return null;const j=await r.json();
  if(Object.keys(cache).length>6)for(const k in cache)if(!k.startsWith('/cd/stores'))delete cache[k];
  return cache[path]=j}
const num=v=>{if(v==null||v==='')return null;const n=parseFloat(String(v).replace(/[^0-9.]/g,''));return isFinite(n)?n:null};
const STOP=new Set('the and with of pack ea each a in for pk'.split(' '));
const toks=s=>String(s||'').toLowerCase().replace(/&/g,' ').replace(/(\d)\s+(g|kg|ml|l)\b/g,'$1$2').split(/[^a-z0-9.]+/).filter(t=>t&&!STOP.has(t));
function size(s){const m=String(s||'').toLowerCase().replace(/\s+/g,'').match(/(\d+(?:\.\d+)?)(kg|g|ml|l)(?![a-z])/);if(!m)return null;
  let v=parseFloat(m[1]),u=m[2];if(u==='kg'){v*=1000;u='g'}if(u==='l'){v*=1000;u='ml'}return{v,u}}
const PROMPT=`You are reading a photo of ONE New Zealand supermarket shelf price ticket (Woolworths yellow or white electronic ticket, or Pak'nSave / New World / FreshChoice ticket).
Return ONLY a JSON object, no prose, with these keys:
{"readable":true|false,"problem":null|"blur"|"glare"|"no_ticket"|"cut_off"|"too_far"|"other","product_name":string|null,"size":string|null,"price":number|null,"was_price":number|null,"save_amount":number|null,"percent_off":number|null,"special_type":null|"special"|"club"|"everyday_low"|"multibuy"|"percent_off"|"clearance","unit_price":number|null,"unit_basis":null|"100g"|"1kg"|"100ml"|"1L"|"each","ticket_code":string|null,"confidence":0.0-1.0}
Rules: price is the big current price in dollars (e.g. 3.00). was_price is any "was" or "non-member" price. ticket_code is the product number printed on the ticket (digits, often 5 to 8 digits, sometimes near a small barcode), not the barcode digits under the barcode unless that is the only code. unit_price is the small "$x.xx per 100g" figure. If you cannot clearly read the main price set readable false and say why in problem.`;
function parseAI(t){if(typeof t==='object'&&t)return t;t=String(t||'');const m=t.match(/\{[\s\S]*\}/);if(!m)return null;
  try{return JSON.parse(m[0])}catch(e){try{return JSON.parse(m[0].replace(/,\s*}/g,'}').replace(/'/g,'"'))}catch(e2){return null}}}
async function readTicket(env,bytes){const b64=btoa(Array.from(bytes,c=>String.fromCharCode(c)).join(''));let last;
  for(const model of MODELS){try{const t0=Date.now();
    const r=await env.AI.run(model,{messages:[{role:'user',content:[{type:'text',text:PROMPT},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+b64}}]}],max_tokens:400,temperature:0});
    const o=parseAI(r.response??r.result?.response??r);if(o)return{...o,_model:model,_ms:Date.now()-t0};last='unparseable reply'}catch(e){last=e.message}}
  return{readable:false,problem:'other',_error:last}}
function nscore(q,qs,n){const nt=new Set(toks(n));let hit=0;for(const t of q)if(nt.has(t))hit++;else if(t.length>4&&[...nt].some(x=>x.startsWith(t.slice(0,5))))hit+=.6;
  let s=hit/Math.max(q.length,1)*0.75+hit/Math.max(nt.size,1)*0.25;const ns=size(n);if(qs&&ns)s+=(qs.v===ns.v&&qs.u===ns.u)?0.15:-0.3;return s}
async function match(env,req,store,ai){const fam=store.fam,stock=await asset(env,req,`/cd/s/${store.id}.json`)||{};
  const names=await asset(env,req,`/cd/n/${fam}.json`)||{};const q=toks((ai.product_name||'')+' '+(ai.size||''));const qs=size((ai.product_name||'')+' '+(ai.size||''));
  const code=String(ai.ticket_code||'').replace(/\D/g,'');let byCode=null;
  if(code.length>=4){for(const c of [code,code.replace(/^0+/,''),code.slice(0,-1)]){if(names[c]){byCode={key:fam+':'+c,name:names[c],by:'code'};break}}
    if(!byCode&&fam==='fs')for(const id in names)if(id.split('-')[0]===code){byCode={key:fam+':'+id,name:names[id],by:'code'};break}}
  if(byCode){byCode.stocked=!!stock[byCode.key];byCode.score=q.length?Math.min(1,Math.max(.6,nscore(q,qs,byCode.name)+.3)):0.8;const sp=stock[byCode.key];if(!q.length||nscore(q,qs,byCode.name)>=0.2||(sp&&ai.price&&Math.abs(sp[0]-ai.price)<0.005))return byCode}
  if(!q.length)return null;let best=null;const pool=Object.keys(stock).length?Object.keys(stock):Object.keys(names).map(i=>fam+':'+i);
  for(const k of pool){const n=names[k.split(':').slice(1).join(':')];if(!n)continue;let s=nscore(q,qs,n);
    if(ai.price&&stock[k]&&Math.abs(stock[k][0]-ai.price)<0.005)s+=0.1;
    if(!best||s>best.score)best={key:k,name:n,score:s,by:'name',stocked:!!stock[k]}}
  if(best)best.score=Math.min(1,Math.round(best.score*100)/100);return best}
function checks(ai,name){const out=[],flags=[];const p=num(ai.price),w=num(ai.was_price),u=num(ai.unit_price);
  const z=size((ai.size||'')+' '+(name||''))||size(ai.product_name);
  if(p&&u&&z){const per={'100g':100,'100ml':100,'1kg':1000,'1L':1000}[ai.unit_basis||(z.u==='g'?'100g':'100ml')];
    if(per){const calc=Math.round(p/z.v*per*100)/100,ok=Math.abs(calc-u)<=0.011;out.push({k:'Unit price',ticket:u,calc,ok});if(!ok)flags.push(`Unit price on ticket $${u.toFixed(2)} vs calculated $${calc.toFixed(2)}`)}}
  if(p&&w&&w>p){const save=Math.round((w-p)*100)/100,sl=num(ai.save_amount);
    if(sl!=null){const ok=Math.abs(sl-save)<=0.011;out.push({k:'Save amount',ticket:sl,calc:save,ok});if(!ok)flags.push(`Save amount on ticket $${sl.toFixed(2)} vs was minus now $${save.toFixed(2)}`)}
    const pct=Math.round((w-p)/w*1000)/10,pl=num(ai.percent_off);
    if(pl!=null){const ok=pl<=pct+0.5;out.push({k:'% off',ticket:pl,calc:pct,ok});if(!ok)flags.push(`Ticket says ${pl}% off, actual ${pct}% off`)}}
  return{out,flags}}
export async function onRequest({request:req,env,params}){
  const p=(params.path||[]).join('/'),m=req.method;const ip=await sha((req.headers.get('cf-connecting-ip')||'x')+'|cap');
  try{await init(env);
  if(p==='session'&&m==='POST'){if(!await limit(env,ip,'capsess',60,3600e3))return J({error:'Too many camera sessions, try again shortly'},429);
    const now=Date.now(),n=Math.min(5,Math.max(1,(await req.json().catch(()=>({}))).n|0||1)),out=[];
    await env.DB.prepare('DELETE FROM cap_sessions WHERE expires<?').bind(now-86400e3).run();
    for(let i=0;i<n;i++){const s={nonce:rnd(16),key:rnd(32),issued:now,expires:now+SESSION_MS};out.push(s);
      await env.DB.prepare('INSERT INTO cap_sessions VALUES(?,?,?,?,?)').bind(s.nonce,s.key,s.issued,s.expires,ip).run()}
    return J({sessions:out,server_time:now})}
  if(p==='capture'&&m==='POST'){if(!await limit(env,ip,'cap',400,86400e3))return J({error:'Daily capture limit reached'},429);
    const f=await req.formData(),img=f.get('img'),meta=JSON.parse(f.get('meta')||'{}'),sig=String(f.get('sig')||'');
    if(!img||typeof img==='string'||!img.size)return J({error:'No image'},400);if(img.size>MAXB)return J({error:'Image over 600 KB'},400);
    const bytes=new Uint8Array(await img.arrayBuffer());
    if(bytes[0]!==0xFF||bytes[1]!==0xD8)return J({error:'Not a camera frame'},400);
    const h=await sha(bytes);if(h!==meta.hash)return J({error:'Image hash does not match the signed capture',code:'bad_sig'},403);
    const s=await env.DB.prepare('SELECT * FROM cap_sessions WHERE nonce=?').bind(String(meta.nonce||'')).first();
    if(!s)return J({error:'Capture token unknown. Only photos taken in the app are accepted.',code:'bad_token'},403);
    const ts=+meta.ts;if(!(ts>=s.issued-60e3&&ts<=s.expires&&ts<=Date.now()+120e3))return J({error:'Capture token expired for that photo',code:'stale'},403);
    const msg=[meta.nonce,meta.ts,meta.lat,meta.lng,meta.acc,meta.store_id,meta.hash,meta.seq].join('|');
    if(await hmac(s.key,msg)!==sig)return J({error:'Capture signature invalid',code:'bad_sig'},403);
    const dup=await env.DB.prepare('SELECT id,status FROM captures WHERE img_hash=?').bind(h).first();if(dup)return J({error:'Already checked in',dup:dup.id,code:'dup'},409);
    const stores=await asset(env,req,'/cd/stores.json');const store=stores.find(x=>x.id===(meta.store_id|0));if(!store)return J({error:'Pick a store first'},400);
    const t0=Date.now(),ai=await readTicket(env,bytes);const reasons=[];
    const price=num(ai.price);
    if(ai.readable===false||!price){const why={blur:'the photo is blurry',glare:'glare on the ticket',no_ticket:'no ticket in the frame',cut_off:'the ticket is cut off',too_far:'the ticket is too far away'}[ai.problem]||'it could not be read clearly';
      reasons.push(`Couldn't read the price, ${why}`)}
    const mt=price||ai.product_name?await match(env,req,store,ai):null;
    if(!mt||mt.score<0.55)reasons.push(price?"Couldn't match the product, try closer so the name and code are sharp":"Couldn't match the product");
    if(ai.confidence!=null&&ai.confidence<0.5&&!reasons.length)reasons.push('Low confidence read, check the photo');
    const stock=await asset(env,req,`/cd/s/${store.id}.json`)||{};const on=mt?stock[mt.key]:null;
    const sh=mt?await asset(env,req,`/cd/c/${mt.key.split(':')[0]}-${mt.key.slice(-1)}.json`):null;const nat=sh?.[mt.key]||null;
    const ck=checks(ai,mt?.name);const flags=[...ck.flags];
    if(on&&price&&Math.abs(on[0]-price)>0.005)flags.push(`Shelf $${price.toFixed(2)} vs online $${on[0].toFixed(2)} at this store`);
    if(!reasons.length&&flags.length&&mt.by!=='code'&&mt.score<0.8)reasons.push("Not sure which product this is. Retake closer so the product code is sharp");
    const status=reasons.length?'needs_check':flags.length?'flagged':'match';
    const r=await env.DB.prepare(`INSERT INTO captures(status,reasons,store_id,store_name,chain,product_key,product_name,ticket_name,ticket_code,shelf_price,was_price,unit_price,unit_basis,special,pct_label,save_label,online_price,online_was,national_median,national_median_regular,match_score,ai_json,img,img_hash,cap_ts,lat,lng,acc,nonce,device,ip_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
      .bind(status,JSON.stringify(reasons.length?reasons:flags),store.id,store.nm,store.ch,mt?.key||null,mt?.name||null,ai.product_name||null,ai.ticket_code||null,price,num(ai.was_price),num(ai.unit_price),ai.unit_basis||null,ai.special_type||null,num(ai.percent_off),num(ai.save_amount),
        on?on[0]:null,on?on[1]:null,nat?nat[1]:null,nat?nat[2]:null,mt?.score??null,JSON.stringify(ai),bytes,h,ts,num(meta.lat),num(meta.lng),num(meta.acc),meta.nonce,String(meta.device||'').slice(0,80),ip).first();
    if(String(meta.device||'').startsWith('test'))await env.DB.prepare("UPDATE captures SET source='app_capture_test' WHERE id=?").bind(r.id).run();
    return J({id:r.id,status,reasons,flags,ms:Date.now()-t0,ai,match:mt,store:{id:store.id,nm:store.nm,ch:store.ch},online:on?{price:on[0],was:on[1],special:!!on[2]}:null,national:nat?{median:nat[1],regular:nat[2]}:null,checks:ck.out})}
  if(p==='export'){const h=(await env.DB.prepare("SELECT v FROM config WHERE k='admin_hash'").first())?.v,t=req.headers.get('x-admin-token')||'';
    if(!h||t.length<20||await sha(t)!==h)return J({error:'no'},403);
    const r=await env.DB.prepare("SELECT id,created,source,status,reasons,store_id,store_name,chain,product_key,product_name,ticket_name,ticket_code,shelf_price,was_price,unit_price,unit_basis,special,pct_label,save_label,online_price,online_was,national_median,national_median_regular,match_score,img_hash,cap_ts,lat,lng,acc FROM captures WHERE source='app_capture' ORDER BY id").all();return J({rows:r.results})}
  if(p==='tally'){const r=await env.DB.prepare("SELECT status,COUNT(*) n FROM captures WHERE source='app_capture' GROUP BY status").all();
    const l=await env.DB.prepare("SELECT id,created,status,store_name,product_name,ticket_name,shelf_price,reasons FROM captures WHERE source='app_capture' ORDER BY id DESC LIMIT 30").all();return J({counts:r.results,recent:l.results})}
  if(p.startsWith('photo/')){const row=await env.DB.prepare('SELECT img FROM captures WHERE id=?').bind(p.split('/')[1]|0).first();if(!row)return J({error:'none'},404);
    return new Response(new Uint8Array(row.img),{headers:{'content-type':'image/jpeg','cache-control':'private, max-age=3600'}})}
  return J({error:'not found'},404)}catch(e){return J({error:e.message||'error'},500)}}
