"""Lager statisk grunnlag for vegnett-eksponering i Nord (Nordland 18, Troms 55, Finnmark 56).
- Vegnett E/R/F (NVDB) samplet hver 100 m, koblet til NVEs aktsomhetsområder for jord-/flomskred og flom.
- Skredpunkt (NVDB 824) koblet til snøskredvarslingsregion (varsom-API, oppslag på koordinat).
Utdata: grunnlag.json (kompakt, til innbygging i siden). Kjøres sjelden (ved endringer i NVDB/aktsomhetskart)."""
import json, math, sys, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from shapely.geometry import shape, Point, LineString
from shapely.strtree import STRtree
from shapely import wkt as swkt

H = {'X-Client': 'svv-skredberedskap-nord', 'Accept': 'application/json'}
FYLKER = ['18', '55', '56']
STEG = 100.0  # m mellom samplingspunkt

def get(url, data=None, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=H)
            return json.load(urllib.request.urlopen(req, timeout=180))
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(2 + 3 * i)

def latlon_wkt_til_lonlat(geom):
    # NVDB srid=4326 gir "lat lon" – bytt til lon/lat
    from shapely.ops import transform
    return transform(lambda x, y, z=None: (y, x), geom)

# ---------- 1. vegnett ----------
def hent_vegnett():
    seg = []
    for f in FYLKER:
        url = f'https://nvdbapiles.atlas.vegvesen.no/vegnett/api/v4/veglenkesekvenser/segmentert?fylke={f}&vegsystemreferanse=E,R,F&srid=4326&antall=1000'
        n0 = len(seg)
        while url:
            d = get(url)
            for o in d['objekter']:
                vs = o.get('vegsystemreferanse') or {}
                st = vs.get('strekning') or {}
                if (vs.get('vegsystem') or {}).get('fase') != 'V' or st.get('trafikantgruppe') != 'K': continue
                if o.get('type') != 'HOVED' or o.get('detaljnivå') not in ('Vegtrase og kjørebane', 'Vegtrase'): continue
                try: g = latlon_wkt_til_lonlat(swkt.loads(o['geometri']['wkt']))
                except Exception: continue
                kontr = [k['navn'] for k in o.get('kontraktsområder', []) if k.get('nummer') and k.get('nummer') < 9600 and k.get('nummer') >= 9100]
                seg.append({'f': f, 'k': o.get('kommune'), 'v': vs.get('kortform', ''), 'kat': vs['vegsystem'].get('vegkategori'),
                            'nr': vs['vegsystem'].get('nummer'), 'l': o.get('lengde') or 0, 'kontr': kontr[-1] if kontr else '', 'g': g})
            m = d['metadata']
            url = m.get('neste', {}).get('href') if m['returnert'] == m['sidestørrelse'] else None
        print('vegnett', f, len(seg) - n0, file=sys.stderr)
    return seg

# ---------- 2. sampling ----------
from pyproj import Transformer
TIL = Transformer.from_crs(4326, 25833, always_xy=True)
FRA = Transformer.from_crs(25833, 4326, always_xy=True)

def sample(seg):
    pts = []  # (segindex, lon, lat)
    for i, s in enumerate(seg):
        g = s['g']
        lines = list(g.geoms) if g.geom_type == 'MultiLineString' else [g]
        for ln in lines:
            u = LineString([TIL.transform(x, y) for x, y, *_ in ln.coords])
            n = max(1, int(round(u.length / STEG)))
            for j in range(n):
                p = u.interpolate((j + 0.5) / n, normalized=True)
                lon, lat = FRA.transform(p.x, p.y)
                pts.append((i, lon, lat, u.length / n))
    return pts

# ---------- 3. aktsomhet ----------
LAG = {
    'jf': 'https://kart.nve.no/enterprise/rest/services/JordFlomskredAktsomhet/MapServer/1',
    'flom': 'https://kart.nve.no/enterprise/rest/services/Flomaktsomhet/MapServer/1',
}

def ids_for_punkt(lag, batch):
    geom = {'points': [[round(lon, 6), round(lat, 6)] for _, lon, lat, _ in batch], 'spatialReference': {'wkid': 4326}}
    data = urllib.parse.urlencode({'geometry': json.dumps(geom), 'geometryType': 'esriGeometryMultipoint', 'inSR': 4326,
                                   'spatialRel': 'esriSpatialRelIntersects', 'returnIdsOnly': 'true', 'f': 'json'}).encode()
    d = get(LAG[lag] + '/query', data)
    return d.get('objectIds') or []

def geometri_for_ids(lag, ids):
    data = urllib.parse.urlencode({'objectIds': ','.join(map(str, ids)), 'outFields': 'objectid', 'outSR': 4326,
                                   'maxAllowableOffset': 0.00005, 'returnGeometry': 'true', 'f': 'geojson'}).encode()
    d = get(LAG[lag] + '/query', data)
    return [shape(ft['geometry']) for ft in d.get('features', []) if ft.get('geometry')]

def flagg(lag, pts):
    B = 400
    batcher = [pts[i:i + B] for i in range(0, len(pts), B)]
    ids = set()
    with ThreadPoolExecutor(8) as ex:
        for k, r in enumerate(ex.map(lambda b: ids_for_punkt(lag, b), batcher)):
            ids.update(r)
    print(lag, 'polygoner nær veg:', len(ids), file=sys.stderr)
    ids = sorted(ids); polys = []
    with ThreadPoolExecutor(6) as ex:
        for r in ex.map(lambda b: geometri_for_ids(lag, b), [ids[i:i + 150] for i in range(0, len(ids), 150)]):
            polys.extend(r)
    tre = STRtree(polys)
    ut = []
    for (i, lon, lat, l) in pts:
        p = Point(lon, lat)
        ut.append(any(polys[j].covers(p) for j in tre.query(p)))
    print(lag, 'flaggede punkt:', sum(ut), 'av', len(pts), file=sys.stderr)
    return ut

# ---------- 4. skredpunkt ----------
def hent_skredpunkt():
    raw = []
    for f in FYLKER:
        url = f'https://nvdbapiles.atlas.vegvesen.no/vegobjekter/824?fylke={f}&inkluder=egenskaper,lokasjon,geometri&srid=4326&antall=1000'
        while url:
            d = get(url)
            for o in d['objekter']:
                e = {x['navn']: x.get('verdi') for x in o.get('egenskaper', [])}
                lok = o.get('lokasjon', {})
                try: g = latlon_wkt_til_lonlat(swkt.loads(o['geometri']['wkt']))
                except Exception: continue
                kontr = [k['navn'] for k in lok.get('kontraktsområder', []) if k.get('nummer') and 9100 <= k['nummer'] < 9600]
                raw.append({'id': o['id'], 'f': f, 'e': e, 'g': g, 'k': (lok.get('kommuner') or [None])[0],
                            'v': ([v.get('kortform') for v in lok.get('vegsystemreferanser', [])] or [''])[0], 'l': lok.get('lengde') or 0,
                            'kontr': kontr[-1] if kontr else ''})
            m = d['metadata']
            url = m.get('neste', {}).get('href') if m['returnert'] == m['sidestørrelse'] else None
    def region(sp):
        c = sp['g'].interpolate(0.5, normalized=True)
        try:
            d = get(f'https://api01.nve.no/hydrology/forecast/avalanche/v6.3.0/api/AvalancheWarningByCoordinates/Simple/{c.y:.5f}/{c.x:.5f}/1/2026-11-19/2026-11-19')
            return d[0]['RegionId'] if d else None
        except Exception: return None
    with ThreadPoolExecutor(8) as ex:
        reg = list(ex.map(region, raw))
    T = {'sno': 'Snøskred', 'sorpe': 'Sørpeskred', 'stein': 'Steinsprang', 'is': 'Isskred', 'jord': 'Jord-/løsmasseskred', 'flom': 'Flomskred'}
    ut = []
    for sp, r in zip(raw, reg):
        e = sp['e']
        typer = {k: e.get(v + ', sannsynlighet') for k, v in T.items() if (e.get(v + ', sannsynlighet') or 0) > 0}
        g = sp['g'].simplify(0.0001)
        lines = list(g.geoms) if g.geom_type == 'MultiLineString' else [g]
        ut.append({'id': sp['id'], 'navn': e.get('Navn') or '', 'f': sp['f'], 'k': sp['k'], 'v': sp['v'], 'kontr': sp['kontr'], 'reg': r,
                   'typer': typer, 'kat': e.get('Skredfaktorkategori') or '', 'adt': e.get('ÅDT'), 'omk': e.get('Omkjøringstid (Ny)'),
                   'stengn': e.get('Stengningsfrekvens, skred'), 'l': round(sp['l']),
                   'c': [[[round(x, 5), round(y, 5)] for x, y, *_ in ln.coords] for ln in lines]})
    print('skredpunkt', len(ut), 'uten region', sum(1 for x in ut if not x['reg']), file=sys.stderr)
    return ut

# ---------- 5. slå sammen flaggede punkt til strekninger ----------
def strekninger(seg, pts, flagg_, typ):
    ut = []; cur = None
    for (i, lon, lat, l), fl in zip(pts, flagg_):
        if fl and cur and cur['_i'] == i:
            cur['c'].append([round(lon, 5), round(lat, 5)]); cur['m'] += l
        else:
            if cur: ut.append(cur)
            cur = None
            if fl:
                s = seg[i]; cur = {'_i': i, 't': typ, 'f': s['f'], 'k': s['k'], 'v': s['v'], 'kat': s['kat'], 'kontr': s['kontr'], 'm': l, 'c': [[round(lon, 5), round(lat, 5)]]}
    if cur: ut.append(cur)
    for u in ut: u.pop('_i'); u['m'] = round(u['m'])
    return ut

if __name__ == '__main__':
    import pickle, os
    t0 = time.time()
    if os.path.exists('cache_sp.pkl'): sp = pickle.load(open('cache_sp.pkl', 'rb'))
    else: sp = hent_skredpunkt(); pickle.dump(sp, open('cache_sp.pkl', 'wb'))
    print('skredpunkt ok', round(time.time() - t0), file=sys.stderr)
    if os.path.exists('cache_seg.pkl'): seg = pickle.load(open('cache_seg.pkl', 'rb'))
    else: seg = hent_vegnett(); pickle.dump(seg, open('cache_seg.pkl', 'wb'))
    print('vegnett ok', round(time.time() - t0), file=sys.stderr)
    pts = sample(seg)
    print('samplingspunkt', len(pts), file=sys.stderr)
    tot = {}
    for s in seg:
        key = (s['f'], s['k']); tot[key] = tot.get(key, 0) + s['l']
    ak = []
    for lag in LAG:
        cf = f'cache_fl_{lag}.pkl'
        if os.path.exists(cf): fl = pickle.load(open(cf, 'rb'))
        else: fl = flagg(lag, pts); pickle.dump(fl, open(cf, 'wb'))
        ak += strekninger(seg, pts, fl, lag)
    ut = {'laget': time.strftime('%Y-%m-%d'), 'steg_m': STEG,
          'vegnett_m': [{'f': f, 'k': k, 'm': round(m)} for (f, k), m in tot.items()],
          'skredpunkt': sp, 'aktsomhet': ak}
    json.dump(ut, open('grunnlag.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    print('ferdig', round(time.time() - t0), 's', file=sys.stderr)
