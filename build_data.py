# Builds capture lookup data from the national scrape DB, mirroring shelfaudit/scripts/export.py grouping.
import sqlite3,re,json,statistics as st,os,sys
from collections import defaultdict
DB='/workspace/nz-supermarket-scraper/national/prices.db';AA='/workspace/aa2';OUT='public/cd'
src=open(AA+'/n.py').read();exec(src[src.index('def size'):src.index('# load')])
c=sqlite3.connect(f'file:{DB}?mode=ro',uri=True)
snaps={}
for sid,ch,sk,nm,town,ta,n in c.execute('select id,chain,store_key,store_name,town,taken_at,n_products from snapshots order by taken_at'):snaps[(ch,sk)]=(sid,nm,town,ta,n)
sids={v[0]:k for k,v in snaps.items()}
SID={k:i for i,(k,v) in enumerate(sorted(snaps.items(),key=lambda x:x[1][1]))}
def cid(ch,pid):return ('fs' if ch in('paknsave','newworld') else ch)+':'+pid
parent={}
def find(x):
  while parent.get(x,x)!=x:x=parent[x]
  return x
items=[];cname={}
for sid,ch,sk,pid,name,price,stype,was in c.execute('select snapshot_id,chain,store_key,product_id,name,price,special_type,was_price from prices where price>0'):
  if sids.get(sid)!=(ch,sk):continue
  items.append((SID[(ch,sk)],ch,pid,price,stype,was));cname.setdefault(cid(ch,pid),(ch,name))
nk={}
for k,(ch,name) in cname.items():
  z=size(name);t=toks(name)
  if z and t:
    key=(z,t)
    if key in nk and find(nk[key])!=find(k):
      a,b=find(nk[key]),find(k);parent[b]=a
    else:nk.setdefault(key,k)
S=defaultdict(dict);G=defaultdict(lambda:([],[]))
for si,ch,pid,price,stype,was in items:
  k=cid(ch,pid);S[si][k]=[price,was or None,1 if (stype or was) else 0]
  g=G[find(k)];g[0].append(price);g[1].append(was or price)
for si,d in S.items():json.dump(d,open(f'{OUT}/s/{si}.json','w'),separators=(',',':'))
cat={k:[nm,round(st.median(G[find(k)][0]),2),round(st.median(G[find(k)][1]),2),len(G[find(k)][0])] for k,(ch,nm) in cname.items()}
json.dump(cat,open(f'{OUT}/cat.json','w'),separators=(',',':'))
print(len(S),len(cat))
# shards and store list
import hashlib
os.makedirs(OUT+'/c',exist_ok=True);os.makedirs(OUT+'/n',exist_ok=True)
sh=defaultdict(dict);nm=defaultdict(dict)
for k,v in cat.items():
  fam=k.split(':')[0];sh[f'{fam}-{k[-1]}'][k]=v[:3]
  nm[fam][k.split(':',1)[1]]=v[0]
for f,d in sh.items():json.dump(d,open(f'{OUT}/c/{f}.json','w'),separators=(',',':'))
for f,d in nm.items():json.dump(d,open(f'{OUT}/n/{f}.json','w'),separators=(',',':'))
os.remove(f'{OUT}/cat.json')
norm=lambda s:re.sub(r'[^a-z0-9]','',s.lower())
geo={}
for r in json.load(open(AA+'/stores.json')):geo[norm(r[0])]=(r[4],r[5])
for r in json.load(open(AA+'/pp.json')):geo.setdefault(norm(r['name']),(r['lat'],r['lng']))
PROPER={r[1]:r[2] for r in json.load(open(AA+'/idx2.json'))}
old={norm(s['nm']):(s['la'],s['lo'],s['nm']) for s in json.load(open('/workspace/shelfaudit/public/data/stores.json'))}
CH={'woolworths':'Woolworths','paknsave':"Pak'nSave",'newworld':'New World','freshchoice':'FreshChoice'}
L=[]
for (ch,sk),i in SID.items():
  n=PROPER.get(sk,snaps[(ch,sk)][1]).replace('PAKnSAVE',"Pak'nSave").replace("PAK'nSAVE","Pak'nSave")
  o=old.get(norm(n));g=geo.get(norm(n))
  la,lo=(o[0],o[1]) if o and o[0] else (g if g else (None,None))
  L.append(dict(id=i,ch=CH.get(ch,ch),fam=('fs' if ch in('paknsave','newworld') else ch),nm=o[2] if o else n,t=snaps[(ch,sk)][2],la=la,lo=lo))
L.sort(key=lambda s:s['id']);json.dump(L,open(f'{OUT}/stores.json','w'),separators=(',',':'))
print('geo',sum(1 for s in L if s['la']),len(L))
# drop coords that were copied onto a click-and-collect duplicate (e.g. Woolworths Victoria Ave landed on Whanganui)
from collections import Counter
cc=Counter((s['la'],s['lo']) for s in L if s['la'])
for s in L:
  if s['la'] and cc[(s['la'],s['lo'])]>1 and 'click and collect' in str(s['t']).lower():s['la']=s['lo']=None
json.dump(L,open(f'{OUT}/stores.json','w'),separators=(',',':'))
