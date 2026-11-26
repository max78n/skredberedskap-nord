"""Høydefordeling for vegnett E/R/F i Nord (NVDB Z-verdier), samplet hver 100 m.
Utdata hoyde.json: per fylke og per nærmeste prognosepunkt (CFG.punkt i logikk.js) – veglengde (m) per 50 m høydebånd."""
import json, sys, time, urllib.request, math
from shapely import wkt as swkt
from shapely.geometry import LineString
from pyproj import Transformer

H = {'X-Client': 'svv-skredberedskap-nord', 'Accept': 'application/json'}
BAND = 50; NB = 30  # 0–1500 moh
TIL = Transformer.from_crs(4326, 25833, always_xy=True)
# prognosepunkt (samme rekkefølge som CFG.punkt)
PUNKT = json.load(open(sys.argv[1]))  # [[f, lat, lon], ...]
PU = [TIL.transform(p[2], p[1]) for p in PUNKT]

def get(url):
    for i in range(4):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=180))
        except Exception:
            if i == 3: raise
            time.sleep(3 + 3 * i)

ut = {'band_m': BAND, 'fylke': {}, 'punkt': [[0] * NB for _ in PUNKT]}
ukjent = {}
for f in ['18', '55', '56']:
    hist = [0] * NB
    url = f'https://nvdbapiles.atlas.vegvesen.no/vegnett/api/v4/veglenkesekvenser/segmentert?fylke={f}&vegsystemreferanse=E,R,F&srid=4326&antall=1000'
    while url:
        d = get(url)
        for o in d['objekter']:
            vs = o.get('vegsystemreferanse') or {}; st = vs.get('strekning') or {}
            if (vs.get('vegsystem') or {}).get('fase') != 'V' or st.get('trafikantgruppe') != 'K': continue
            if o.get('type') != 'HOVED' or o.get('detaljnivå') not in ('Vegtrase og kjørebane', 'Vegtrase'): continue
            try: g = swkt.loads(o['geometri']['wkt'])
            except Exception: continue
            for ln in (g.geoms if g.geom_type == 'MultiLineString' else [g]):
                cs = [(*TIL.transform(c[1], c[0]), c[2]) for c in ln.coords if len(c) > 2 and -500 < c[2] < 3000]
                if len(cs) < 2:
                    ukjent[f] = ukjent.get(f, 0) + (o.get('lengde') or 0); continue
                u = LineString(cs)
                n = max(1, int(round(u.length / 100)))
                for j in range(n):
                    p = u.interpolate((j + 0.5) / n, normalized=True)
                    z = p.z if p.has_z else 0
                    b = min(NB - 1, max(0, int(z // BAND)))
                    l = u.length / n
                    hist[b] += l
                    # nærmeste prognosepunkt i samme fylke
                    best, bd = None, 1e18
                    for k, (px, py) in enumerate(PU):
                        if PUNKT[k][0] != f: continue
                        dd = (px - p.x) ** 2 + (py - p.y) ** 2
                        if dd < bd: best, bd = k, dd
                    if best is not None: ut['punkt'][best][b] += l
        m = d['metadata']
        url = m.get('neste', {}).get('href') if m['returnert'] == m['sidestørrelse'] else None
    ut['fylke'][f] = [round(x) for x in hist]
    print(f, round(sum(hist) / 1000), 'km', file=sys.stderr)
ut['punkt'] = [[round(x) for x in r] for r in ut['punkt']]
ut['ukjent_m'] = {k: round(v) for k, v in ukjent.items()}
print('ukjent høyde', ut['ukjent_m'], file=sys.stderr)
json.dump(ut, open('hoyde.json', 'w'), separators=(',', ':'))
