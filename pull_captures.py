# Pulls app captures (match + flagged only; needs_check stays out) into shelfaudit/data/app_captures.json,
# the same shape idea as data/field_observations.json. Needs SA_ADMIN_TOKEN (the admin page password).
import os,json,urllib.request
req=urllib.request.Request('https://shelfaudit-capture.pages.dev/api/export',headers={'x-admin-token':os.environ['SA_ADMIN_TOKEN']})
rows=json.load(urllib.request.urlopen(req))['rows']
obs=[dict(name=r['product_name'],product_key=r['product_key'],store_id=r['store_id'],store=r['store_name'],chain=r['chain'],shelf_price=r['shelf_price'],was_price=r['was_price'],
  ticket_unit=r['unit_price'],unit_basis=r['unit_basis'],online_same_store={'price':r['online_price'],'was_price':r['online_was']},national_median_now=r['national_median'],
  national_median_regular=r['national_median_regular'],shelf_vs_online=r['status'],notes=json.loads(r['reasons'] or '[]'),captured_at_ms=r['cap_ts'],photo=f"https://shelfaudit-capture.pages.dev/api/photo/{r['id']}",capture_id=r['id'])
  for r in rows if r['status'] in('match','flagged')]
out=dict(source='app_capture',observer='Guy Hollister',observations=obs,needs_checking=sum(1 for r in rows if r['status']=='needs_check'))
json.dump(out,open('/workspace/shelfaudit/data/app_captures.json','w'),indent=1);print(len(obs),'captures written')
