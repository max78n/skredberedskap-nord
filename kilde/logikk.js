/* Skred- og flomberedskap Nord – datahenting og analyse.
   Felles for nettsiden (live) og byggeskriptet (innebygd data + morgenbrief). */
(function (root) {
'use strict';

/* ---------------- konfigurasjon (kan endres) ---------------- */
const CFG = {
  fylker: [
    { id: '18', navn: 'Nordland' },
    { id: '55', navn: 'Troms' },
    { id: '56', navn: 'Finnmark' }
  ],
  // snøskredregioner per fylke
  snoRegioner: {
    '18': [3018, 3017, 3016, 3015, 3014],
    '55': [3012, 3013, 3011, 3010, 3009],
    '56': [3007, 3006, 3008, 3005]
  },
  // Nøkkelpunkt for prognose. Koordinater er omtrentlige; moh = høyde prognosen justeres til.
  // lav: true = lav terskel for nysnø (øst/nord for Kvænangen, store henteområder)
  punkt: [
    { f: '18', navn: 'Helgeland – E6 Korgfjellet', lat: 66.08, lon: 13.83, moh: 550 },
    { f: '18', navn: 'Saltfjellet – E6', lat: 66.66, lon: 15.32, moh: 690 },
    { f: '18', navn: 'Salten – Fauske/Sørfold', lat: 67.40, lon: 15.55, moh: 400 },
    { f: '18', navn: 'Lofoten – E10 Flakstad', lat: 68.10, lon: 13.30, moh: 300 },
    { f: '18', navn: 'Vesterålen – Rv85 Gullesfjord', lat: 68.53, lon: 15.72, moh: 300 },
    { f: '18', navn: 'Ofoten – E6 Beisfjord/Narvik', lat: 68.38, lon: 17.55, moh: 400 },
    { f: '18', navn: 'Ofoten – E10 Bjørnfjell', lat: 68.44, lon: 18.07, moh: 520 },
    { f: '55', navn: 'Sør-Troms – E6 Gratangsfjellet', lat: 68.70, lon: 17.65, moh: 380 },
    { f: '55', navn: 'Senja', lat: 69.35, lon: 17.60, moh: 300 },
    { f: '55', navn: 'Indre Troms – E8 Lavangsdalen', lat: 69.50, lon: 19.40, moh: 300 },
    { f: '55', navn: 'Tamokdalen', lat: 69.15, lon: 19.60, moh: 350 },
    { f: '55', navn: 'Tromsø – Breivikeidet', lat: 69.65, lon: 19.55, moh: 300 },
    { f: '55', navn: 'Lyngen – E6 Kåfjord/Olderdalen', lat: 69.60, lon: 20.55, moh: 300 },
    { f: '55', navn: 'Nord-Troms – E6 Kvænangsfjellet', lat: 69.92, lon: 21.30, moh: 400, lav: true },
    { f: '56', navn: 'Vest-Finnmark – E6 Sennalandet', lat: 70.35, lon: 23.70, moh: 380, lav: true },
    { f: '56', navn: 'Rv94 Kvalsund–Hammerfest', lat: 70.55, lon: 23.90, moh: 200, lav: true },
    { f: '56', navn: 'E69 Olderfjord–Nordkapp', lat: 70.75, lon: 25.15, moh: 200, lav: true },
    { f: '56', navn: 'E6 Ifjordfjellet', lat: 70.40, lon: 27.20, moh: 380, lav: true },
    { f: '56', navn: 'Øst-Finnmark – Båtsfjord/Kongsfjord', lat: 70.65, lon: 29.50, moh: 350, lav: true },
    { f: '56', navn: 'Finnmarksvidda – E45/Rv93', lat: 69.20, lon: 23.60, moh: 400, lav: true }
  ],
  terskel: {
    snoT: 0.5,          // °C: nedbør ved T <= dette regnes som snø
    sno: 20,            // cm/døgn (≈ mm vannekv.), normal terskel (wiki: >20–30 cm)
    snoLav: 10,         // cm/døgn, øst/nord for Kvænangen (wiki: ned mot 10 cm)
    regn: 30,           // mm/døgn regn → vurder gult (grovt, juster)
    regnOransje: 60,    // mm/døgn regn → vurder oransje
    vind: 20,           // m/s middelvind → merknad snøtransport/uvær
    mildvaer: 1,        // °C Tmax etter snøfall → merknad
    lapse: 0.0065,      // °C per m (standard temperaturgradient) for estimert 0-grense
    regnSnoT: 1         // °C: grense regn/snø brukt for regn-/snøgrense under nedbør
  }
};

const NVE = 'https://api01.nve.no/hydrology/forecast';
const NIVA = ['', 'Grønt', 'Gult', 'Oransje', 'Rødt'];
const NIVA_TXT = ['', 'normal oppmerksomhet', 'økt oppmerksomhet', 'restriksjoner/stengninger', 'omfattende restriksjoner/stengninger'];

/* ---------------- hjelpere ---------------- */
function osloDato(d) { // YYYY-MM-DD i norsk tid
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function leggTilDager(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dagNavn(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'][d.getUTCDay()] + ' ' + d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.';
}
const r1 = x => x == null ? null : Math.round(x * 10) / 10;
const KOMPASS = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];
const retning = deg => deg == null ? '' : KOMPASS[Math.round(((deg % 360) / 45)) % 8];

async function hentJson(fetchFn, url, opt) {
  const r = await fetchFn(url, opt);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url.split('?')[0]);
  return r.json();
}

/* ---------------- henting ---------------- */
async function hentSno(fetchFn, d0, d2) {
  const j = await hentJson(fetchFn, `${NVE}/avalanche/v6.3.0/api/RegionSummary/Detail/1/${d0}/${d2}`);
  const ids = new Set(Object.values(CFG.snoRegioner).flat());
  const ut = {};
  j.filter(r => ids.has(r.Id)).forEach(r => {
    ut[r.Id] = {
      id: r.Id, navn: r.Name,
      dager: (r.AvalancheWarningList || []).map(w => ({
        dato: w.ValidFrom.slice(0, 10), fg: +w.DangerLevel || 0,
        beredskap: w.EmergencyWarning && w.EmergencyWarning !== 'Ikke gitt' ? w.EmergencyWarning : '',
        tekst: w.MainText || '',
        problem: (w.AvalancheProblems || []).map(p => p.AvalancheProblemTypeName || p.AvalancheExtName).filter(Boolean)
      }))
    };
  });
  return ut;
}

async function hentJordFlom(fetchFn, type, d0, d2) {
  const path = type === 'jord' ? 'landslide/v1.0.10' : 'flood/v1.0.6';
  const ut = {};
  for (const f of CFG.fylker) {
    const j = await hentJson(fetchFn, `${NVE}/${path}/api/Warning/County/${f.id}/1/${d0}/${d2}`);
    const perDag = {};
    j.forEach(w => {
      const dato = w.ValidFrom.slice(0, 10), niv = +w.ActivityLevel || 1;
      const p = perDag[dato] || (perDag[dato] = { maks: 1, varsler: [], kn: {} });
      if (niv > p.maks) p.maks = niv;
      (w.MunicipalityList || []).forEach(m => { const id = String(m.Id); if (!p.kn[id] || p.kn[id] < niv) p.kn[id] = niv; });
      if (niv >= 2) {
        const kommuner = (w.MunicipalityList || []).map(m => m.Name);
        const nokkel = niv + '|' + (w.MainText || '');
        let v = p.varsler.find(x => x.nokkel === nokkel);
        if (!v) { v = { nokkel, niva: niv, tekst: w.MainText || '', varsel: w.WarningText || '', kommuner: [] }; p.varsler.push(v); }
        kommuner.forEach(k => { if (!v.kommuner.includes(k)) v.kommuner.push(k); });
      }
    });
    ut[f.id] = perDag;
  }
  return ut;
}

function polygonSenter(geom) {
  try {
    let ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
    let la = 0, lo = 0; ring.forEach(c => { lo += c[0]; la += c[1]; });
    return [la / ring.length, lo / ring.length];
  } catch (e) { return [null, null]; }
}

async function hentMetVarsler(fetchFn) {
  const j = await hentJson(fetchFn, 'https://api.met.no/weatherapi/metalerts/2.0/current.json?lang=no');
  const fyl = CFG.fylker.map(f => f.id);
  return (j.features || []).map(ft => {
    const p = ft.properties, [la, lo] = polygonSenter(ft.geometry);
    const fylkeTreff = (p.county || []).map(String).filter(c => fyl.includes(c));
    let fylker = fylkeTreff;
    if (!fylker.length && la != null && la >= 65) fylker = [la < 68.3 ? '18' : (lo < 22 ? '55' : '56')];
    const lvl = String(p.awareness_level || '').split(';')[1]?.trim() || (p.riskMatrixColor || '').toLowerCase();
    return {
      id: p.id, hendelse: p.eventAwarenessName || p.event, event: p.event, type: +(String(p.awareness_type || '').split(';')[0]) || 0,
      farge: lvl, omrade: p.area, beskrivelse: p.description, tittel: p.title, slutt: p.eventEndingTime || '',
      land: p.geographicDomain !== 'marine', fylker, lat: la, geom: ft.geometry
    };
  }).filter(v => v.fylker.length);
}

async function hentPunkt(fetchFn, p, ua) {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}&altitude=${Math.round(p.moh)}`;
  const j = await hentJson(fetchFn, url, ua ? { headers: { 'User-Agent': ua } } : undefined);
  return { oppdatert: j.properties.meta.updated_at, rader: forenkleLF(j) };
}

function forenkleLF(j) {
  // timeserie -> [{t, T, FF, FG, DD, RR, varighet}] uten overlapp
  const ut = []; let dekketTil = 0;
  j.properties.timeseries.forEach(x => {
    const t = Date.parse(x.time), i = x.data.instant.details;
    let rr = null, h = 0, S = null, rrMaks = null;
    if (x.data.next_1_hours && t >= dekketTil) { rr = x.data.next_1_hours.details.precipitation_amount; rrMaks = x.data.next_1_hours.details.precipitation_amount_max ?? null; S = x.data.next_1_hours.summary?.symbol_code || null; h = 1; }
    else if (x.data.next_6_hours && t >= dekketTil) { rr = x.data.next_6_hours.details.precipitation_amount; rrMaks = x.data.next_6_hours.details.precipitation_amount_max ?? null; S = x.data.next_6_hours.summary?.symbol_code || null; h = 6; }
    if (h) dekketTil = t + h * 3600e3;
    ut.push({ t, T: i.air_temperature, FF: i.wind_speed, FG: i.wind_speed_of_gust ?? null, DD: i.wind_from_direction, RR: rr, RRx: rrMaks, S, h });
  });
  return ut.filter(r => r.h);
}

/* Henter alt. fetchFn = fetch. ua = User-Agent (kun i Node). Feil per kilde lagres, resten fortsetter. */
async function hentAlt(fetchFn, opt = {}) {
  const d0 = opt.dato || osloDato(new Date()), d2 = leggTilDager(d0, 2);
  const data = { hentet: new Date().toISOString(), datoer: [d0, leggTilDager(d0, 1), d2], feil: {}, sno: {}, jord: {}, flom: {}, met: [], punkt: [] };
  const jobb = async (navn, fn) => { try { await fn(); } catch (e) { data.feil[navn] = e.message || String(e); } };
  await Promise.all([
    jobb('sno', async () => { data.sno = await hentSno(fetchFn, d0, d2); }),
    jobb('jord', async () => { data.jord = await hentJordFlom(fetchFn, 'jord', d0, d2); }),
    jobb('flom', async () => { data.flom = await hentJordFlom(fetchFn, 'flom', d0, d2); }),
    jobb('met', async () => { data.met = await hentMetVarsler(fetchFn); }),
    jobb('punkt', async () => {
      const res = await Promise.all(CFG.punkt.map(p => hentPunkt(fetchFn, p, opt.ua).then(x => ({ ...p, ...x })).catch(e => ({ ...p, feil: e.message }))));
      data.punkt = res;
      const n = res.filter(x => x.feil).length;
      if (n === res.length) throw new Error('ingen prognosepunkt hentet');
      if (n) data.feil.punkt = n + ' av ' + res.length + ' punkt feilet';
    })
  ]);
  return data;
}

/* ---------------- analyse ---------------- */
function dognVerdier(rader, dato) {
  // Døgn 06–06 UTC (07–07 norsk vintertid), datert med start – som varsom jordskred/flom
  const fra = Date.parse(dato + 'T06:00:00Z'), til = fra + 864e5;
  const xs = rader.filter(r => r.t >= fra && r.t < til);
  if (!xs.length) return null;
  let rr = 0, sno = 0, regn = 0, ff = null, fg = null, dd = null, tmin = null, tmax = null, timer = 0, tp = 0;
  xs.forEach(r => {
    const v = r.RR || 0; rr += v; timer += r.h; if (r.T != null) tp += r.T * v;
    if (r.T != null && r.T <= CFG.terskel.snoT) sno += v; else regn += v;
    if (r.FF != null && (ff == null || r.FF > ff)) { ff = r.FF; dd = r.DD; }
    if (r.FG != null && (fg == null || r.FG > fg)) fg = r.FG;
    if (r.T != null) { tmin = tmin == null ? r.T : Math.min(tmin, r.T); tmax = tmax == null ? r.T : Math.max(tmax, r.T); }
  });
  return { rr: r1(rr), sno: r1(sno), regn: r1(regn), ff: r1(ff), fg: r1(fg), dd: retning(dd), tmin: r1(tmin), tmax: r1(tmax), timer: Math.min(24, timer), tnedbor: rr >= 0.5 ? r1(tp / rr) : null };
}

const MET_RELEVANT = new Set(['snow', 'rain', 'rainFlood', 'flood', 'avalanches', 'polarLow']); // MET event-koder som gir nivå
const MET_VIND = new Set(['wind', 'gale', 'blowingSnow']);
const fargeNiva = f => ({ yellow: 2, gul: 2, orange: 3, oransje: 3, red: 4, rød: 4 })[(f || '').toLowerCase()] || 1;

function analyser(data) {
  const T = CFG.terskel;
  // døgnverdier per punkt
  data.punkt.forEach(p => { p.dogn = p.rader ? data.datoer.map(d => dognVerdier(p.rader, d)) : []; });
  const res = {};
  CFG.fylker.forEach(f => {
    res[f.id] = { navn: f.navn, dager: data.datoer.map((dato, i) => {
      const grunner = []; // {niva, kilde, tekst}
      const merk = [];
      // snøskred
      let snoAktiv = 0; const snoReg = CFG.snoRegioner[f.id] || [];
      snoReg.forEach(id => {
        const r = data.sno[id]; const w = r && r.dager.find(x => x.dato === dato);
        if (!w || !w.fg) return; snoAktiv++;
        if (w.fg >= 5) grunner.push({ niva: 4, kilde: 'snø', tekst: `${r.navn}: faregrad 5` });
        else if (w.fg === 4) grunner.push({ niva: 3, kilde: 'snø', tekst: `${r.navn}: faregrad 4` });
        else if (w.fg === 3 && w.beredskap) grunner.push({ niva: 2, kilde: 'snø', tekst: `${r.navn}: faregrad 3 med beredskapsvarsel (${w.beredskap})` });
        else if (w.fg === 3) merk.push(`${r.navn}: faregrad 3 uten beredskapsvarsel – vurder relevans for veg`);
      });
      const snoMangler = !snoAktiv;
      if (snoAktiv && snoAktiv < snoReg.length) merk.push(`Snøskredvarsel mangler for ${snoReg.length - snoAktiv} av ${snoReg.length} regioner`);
      // jord og flom
      [['jord', 'jordskred'], ['flom', 'flom']].forEach(([k, navn]) => {
        const p = data[k][f.id] && data[k][f.id][dato];
        if (p && p.maks >= 2) {
          grunner.push({ niva: p.maks, kilde: k, tekst: `${navn}varsel ${NIVA[p.maks].toLowerCase()} nivå (${p.varsler.map(v => v.kommuner.length + ' kommuner').join(', ')})` });
          if (k === 'flom') merk.push('Flom: sjekk flomsonekart/naturfareplan mot vegnett – kan ligge ett nivå lavere hvis veg ikke berøres');
        }
      });
      // MET farevarsler (gjeldende – brukes på dag 0 og 1 dersom de ikke er utløpt)
      data.met.filter(v => v.land && v.fylker.includes(f.id)).forEach(v => {
        const slutt = v.slutt ? osloDato(new Date(v.slutt)) : null;
        if (slutt && slutt < dato) return;
        if (i > 1 && !slutt) return;
        const relevant = MET_RELEVANT.has(v.event) || /polar/i.test(v.event || '');
        const n = fargeNiva(v.farge);
        if (relevant) grunner.push({ niva: n, kilde: 'met', tekst: `MET ${v.hendelse} (${v.farge}) – ${v.omrade}` });
        else if (v.event === 'ice') merk.push(`MET ${v.hendelse} (${v.farge}) – ${v.omrade}: glatte veger, ikke skred/flom`);
        else if (MET_VIND.has(v.event) || v.type === 1) {
          merk.push(`MET ${v.hendelse} (${v.farge}) – ${v.omrade}: snøtransport/uvær, mulig stengning fjelloverganger`);
          if (n >= 3) grunner.push({ niva: 2, kilde: 'met', tekst: `MET ${v.hendelse} oransje – vurder (snøtransport)` });
        }
      });
      // vær i nøkkelpunkt
      data.punkt.filter(p => p.f === f.id && p.dogn && p.dogn[i]).forEach(p => {
        const d = p.dogn[i], ts = p.lav ? T.snoLav : T.sno;
        if (d.sno >= 2 * ts) grunner.push({ niva: 3, kilde: 'vær', tekst: `${p.navn}: ≈${Math.round(d.sno)} cm nysnø (≥ 2 × terskel ${ts} cm) – vurder` });
        else if (d.sno >= ts) grunner.push({ niva: 2, kilde: 'vær', tekst: `${p.navn}: ≈${Math.round(d.sno)} cm nysnø (terskel ${ts} cm) – vurder` });
        if (d.regn >= T.regnOransje) grunner.push({ niva: 3, kilde: 'vær', tekst: `${p.navn}: ${Math.round(d.regn)} mm regn – vurder` });
        else if (d.regn >= T.regn) grunner.push({ niva: 2, kilde: 'vær', tekst: `${p.navn}: ${Math.round(d.regn)} mm regn – vurder` });
        if (d.ff >= T.vind) merk.push(`${p.navn}: middelvind ${Math.round(d.ff)} m/s fra ${d.dd} – snøtransport/uvær`);
        const forrige = i > 0 ? p.dogn[i - 1] : null;
        if (forrige && forrige.sno >= 5 && d.tmax > T.mildvaer && d.regn > 2) merk.push(`${p.navn}: mildvær/regn etter snøfall – våtsnø/sørpeskred`);
      });
      // Uten snøskredvarsel for fylket gis ikke forslag til aktsomhetsnivå (niva = null)
      const niva = snoMangler ? null : grunner.reduce((m, g) => Math.max(m, g.niva), 1);
      return { dato, niva, snoMangler, grunner: grunner.sort((a, b) => b.niva - a.niva), merk: [...new Set(merk)] };
    }) };
    // gradvis opptrapping
    const d = res[f.id].dager;
    for (let i = 1; i < d.length; i++) if (d[i].niva != null && d[i - 1].niva != null && d[i].niva - d[i - 1].niva >= 2)
      d[i - 1].merk.unshift(`Hopp fra ${NIVA[d[i - 1].niva].toLowerCase()} til ${NIVA[d[i].niva].toLowerCase()} neste dag – vurder gradvis opptrapping`);
  });
  return res;
}

/* ---------------- vegnett-eksponering ----------------
   G = statisk grunnlag (vegnett/lag_grunnlag.py): skredpunkt (NVDB 824) med snøskredregion,
   og vegstrekninger i NVEs aktsomhetsområder for jord-/flomskred (t='jf') og flom (t='flom').
   Første utkast: et punkt/strekning regnes som utsatt når det ligger innenfor område med varsom-nivå ≥ terskel
   (snø: faregrad ≥ 3; jord/flom: gult ≥ 2). Ingen værterskler. */
function pakkUtGrunnlag(G) {
  if (!G || Array.isArray(G.aktsomhet)) return G;
  const V = G.aktsomhet.vegnavn;
  G.aktsomhet = G.aktsomhet.rader.map(r => { const c = []; for (let i = 0; i < r[5].length; i += 2) c.push([r[5][i], r[5][i + 1]]);
    return { t: r[0] ? 'flom' : 'jf', f: String(r[1]), k: r[2], v: V[r[3]], m: r[4], c }; });
  return G;
}
function vegnett(data, G) {
  if (!G) return null;
  pakkUtGrunnlag(G);
  const ut = {};
  const totVeg = {}; (G.vegnett_m || []).forEach(x => { totVeg[x.f] = (totVeg[x.f] || 0) + x.m; });
  CFG.fylker.forEach(f => {
    ut[f.id] = { totVeg_km: (totVeg[f.id] || 0) / 1000, dager: data.datoer.map(dato => {
      const sno = { fg: [0, 0, 0, 0, 0, 0], km: [0, 0, 0, 0, 0, 0], hoy: 0, utsatt: [] }, sorpe = { n: [0, 0, 0, 0, 0], utsatt: [] };
      const jf = { m: [0, 0, 0, 0, 0] }, flom = { m: [0, 0, 0, 0, 0] };
      G.skredpunkt.filter(p => p.f === f.id).forEach(p => {
        if (p.typer.sno) {
          const r = data.sno[p.reg]; const w = r && r.dager.find(x => x.dato === dato); const fg = w ? w.fg : 0;
          sno.fg[fg]++; sno.km[fg] += p.l / 1000;
          if (fg >= 3) { sno.utsatt.push(p.id); if (p.kat === 'Høy') sno.hoy++; }
        }
        if (p.typer.sorpe) {
          const n = data.jord[f.id]?.[dato]?.kn?.[String(p.k)] || 1; sorpe.n[n]++; if (n >= 2) sorpe.utsatt.push(p.id);
        }
      });
      G.aktsomhet.filter(a => a.f === f.id).forEach(a => {
        const kilde = a.t === 'jf' ? data.jord : data.flom; const n = kilde[f.id]?.[dato]?.kn?.[String(a.k)] || 1;
        (a.t === 'jf' ? jf : flom).m[n] += a.m;
      });
      const km = x => x / 1000;
      return { dato, sno, sorpe, jf: { km: jf.m.map(km), utsatt_km: km(jf.m[2] + jf.m[3] + jf.m[4]), tot_km: km(jf.m.reduce((a, b) => a + b, 0)) },
        flom: { km: flom.m.map(km), utsatt_km: km(flom.m[2] + flom.m[3] + flom.m[4]), tot_km: km(flom.m.reduce((a, b) => a + b, 0)) },
        sno_utsatt_km: sno.km[3] + sno.km[4] + sno.km[5] };
    }) };
  });
  return ut;
}

/* ---------------- vegnett og høyde ----------------
   HO = hoyde.json: veglengde per 50 m høydebånd per prognosepunkt. Estimert 0-grense per punkt og døgn:
   moh + Tmax / lapse (standard gradient, ingen inversjon). Regn-/snøgrense under nedbør: moh + (Tnedbør − regnSnoT) / lapse. */
function hoyde(data, HO) {
  if (!HO) return null;
  const T = CFG.terskel, B = HO.band_m, ut = {};
  CFG.fylker.forEach(f => {
    const hist = HO.fylke[f.id] || [], tot = hist.reduce((a, b) => a + b, 0) / 1000;
    ut[f.id] = { hist, tot_km: tot, dager: data.datoer.map((dato, i) => {
      let mild = 0, regn = 0, z0 = [], zs = [];
      data.punkt.forEach((p, k) => {
        if (p.f !== f.id || !p.dogn || !p.dogn[i]) return;
        const d = p.dogn[i], h = HO.punkt[k] || [];
        const g0 = d.tmax == null ? null : p.moh + d.tmax / T.lapse;
        const gs = d.tnedbor == null || d.rr < 2 ? null : p.moh + (d.tnedbor - T.regnSnoT) / T.lapse;
        if (g0 != null) z0.push(g0); if (gs != null) zs.push(gs);
        h.forEach((m, b) => { const z = (b + 0.5) * B; if (g0 != null && z < g0) mild += m; if (gs != null && z < gs) regn += m; });
      });
      const med = a => a.length ? Math.round(a.sort((x, y) => x - y)[Math.floor(a.length / 2)]) : null;
      return { dato, mild_km: mild / 1000, regn_km: regn / 1000, z0_med: med(z0), z0_min: z0.length ? Math.round(Math.min(...z0)) : null, z0_maks: z0.length ? Math.round(Math.max(...z0)) : null, zs_med: med(zs) };
    }) };
  });
  return ut;
}

/* ---------------- tekstutkast ---------------- */
function maksPunkt(data, fylke, i, felt) {
  return data.punkt.filter(p => p.f === fylke && p.dogn && p.dogn[i]).sort((a, b) => (b.dogn[i][felt] || 0) - (a.dogn[i][felt] || 0))[0];
}
function tekstutkast(data, ana) {
  const linjer = [];
  data.datoer.forEach((dato, i) => {
    const aktive = CFG.fylker.filter(f => ana[f.id].dager[i].niva >= 2);
    const mangler = CFG.fylker.filter(f => ana[f.id].dager[i].niva == null);
    linjer.push(`=== ${dagNavn(dato)} ===`);
    if (mangler.length) linjer.push(`Snøskredvarsel mangler for ${mangler.map(f => f.navn).join(', ')} – ikke vurdert.`);
    if (!aktive.length) { linjer.push(mangler.length === CFG.fylker.length ? '' : mangler.length ? 'Øvrige fylker: grønt nivå. Ingen tekst.' : 'Grønt nivå i Nord. Ingen tekst.', ''); return; }
    aktive.forEach(f => {
      const d = ana[f.id].dager[i];
      linjer.push(`${f.navn} – ${NIVA[d.niva]} (${NIVA_TXT[d.niva]})`);
      const kilder = new Set(d.grunner.filter(g => g.niva >= 2).map(g => g.kilde));
      const ps = maksPunkt(data, f.id, i, 'rr'), pn = maksPunkt(data, f.id, i, 'sno'), pr = maksPunkt(data, f.id, i, 'regn');
      // hovedbudskap
      const hb = [];
      if (ps && ps.dogn[i].rr >= 5) {
        hb.push(`${i === 0 ? 'I dag' : dagNavn(dato).replace(/^./, c => c.toUpperCase())} kan det komme opp mot ${Math.round(ps.dogn[i].rr)} mm nedbør i ${f.navn}.`);
        hb.push(`Mest nedbør er ventet ${ps.navn.split(' – ')[0].replace(/^/, 'i ')}.`);
      }
      const neste = ana[f.id].dager[i + 1];
      if (neste && neste.niva != null) hb.push(neste.niva > d.niva ? `Faren for skred og flom på veg øker ${dagNavn(neste.dato)}.` : neste.niva < d.niva ? `Faren for skred og flom på veg avtar ${dagNavn(neste.dato)}.` : '');
      linjer.push('Hovedbudskap: ' + hb.filter(Boolean).join(' '));
      if (kilder.has('snø') || (pn && pn.dogn[i].sno >= (pn.lav ? CFG.terskel.snoLav : CFG.terskel.sno))) {
        linjer.push('SNØSKRED: ' + [
          pn && pn.dogn[i].sno >= 5 ? `Det kan komme ${Math.round(pn.dogn[i].sno)} cm nysnø i ${pn.navn.split(' – ')[0]}` + (pn.dogn[i].ff >= 10 ? ` med vind fra ${pn.dogn[i].dd}.` : '.') : '',
          'Store skred kan løsne av seg selv når det kommer vind og nedbør.',
          'Skred kan få lange utløp og nå vegen ved kjente skredpunkt.'
        ].filter(Boolean).join(' '));
      }
      if (kilder.has('jord') || (pr && pr.dogn[i].regn >= CFG.terskel.regn)) {
        linjer.push('JORDSKRED: Bakken er våt på grunn av nedbør. Dette kan gi ustabile skråninger over eller under veg. Skråninger langs elver og bekker med høy vannføring er utsatt. Sørg for at stikkrenner er åpne før nedbøren starter.');
      }
      if (kilder.has('flom')) {
        linjer.push('FLOM: Der det kommer nedbør kan vannføringen øke. Vegene kan både bli oversvømt og skadet på grunn av erosjon i vegkroppen. Vær spesielt oppmerksom der vegen går langs elver med høy vannføring.');
      }
      linjer.push('');
    });
  });
  return linjer.join('\n');
}

/* ---------------- morgenbrief (markdown) ---------------- */
function brief(data, ana, opt) {
  const L = [];
  L.push(`**Skred- og flomberedskap Nord – ${dagNavn(data.datoer[0])}** (data hentet ${new Date(data.hentet).toLocaleTimeString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' })})`, '');
  L.push('Forslag til aktsomhetsnivå (heuristikk, ikke vurdering):', '');
  L.push('| | ' + data.datoer.map(dagNavn).join(' | ') + ' |', '|---|' + data.datoer.map(() => '---').join('|') + '|');
  CFG.fylker.forEach(f => L.push(`| ${f.navn} | ` + ana[f.id].dager.map(d => d.niva == null ? 'Ikke vurdert' : NIVA[d.niva]).join(' | ') + ' |'));
  L.push('');
  const mgl = CFG.fylker.filter(f => ana[f.id].dager[0].niva == null);
  if (mgl.length) L.push(`Snøskredvarsel mangler i dag for ${mgl.map(f => f.navn).join(', ')} – ingen nivåforslag.`, '');
  CFG.fylker.forEach(f => {
    const g = ana[f.id].dager.flatMap((d, i) => d.grunner.map(x => `${dagNavn(d.dato)}: ${x.tekst}`));
    const m = [...new Set(ana[f.id].dager.flatMap(d => d.merk))];
    if (g.length || m.length) { L.push(`**${f.navn}**`); g.slice(0, 6).forEach(x => L.push('- ' + x)); m.slice(0, 4).forEach(x => L.push('- (merk) ' + x)); L.push(''); }
  });
  if (opt && opt.veg) {
    const V = opt.veg; L.push('Utsatt vegnett (varsom-nivå, ingen værterskel):');
    CFG.fylker.forEach(f => { const d = V[f.id].dager[0], d1 = V[f.id].dager[1];
      const sno = x => x.sno.fg[3] + x.sno.fg[4] + x.sno.fg[5];
      L.push(`- ${f.navn}: i dag ${sno(d)} snøskredpunkt i faregrad ≥ 3, ${Math.round(d.jf.utsatt_km)} km veg i jord-/flomskredaktsomhet og ${Math.round(d.flom.utsatt_km)} km i flomaktsomhet med gult+ varsel; i morgen ${sno(d1)} / ${Math.round(d1.jf.utsatt_km)} / ${Math.round(d1.flom.utsatt_km)}.`); });
    L.push('');
  }
  if (opt && opt.ho) {
    L.push('Vegnett og høyde (estimert 0-grense, standard gradient):');
    CFG.fylker.forEach(f => { const h = opt.ho[f.id]; const t = h.dager.map(d => `${dagNavn(d.dato).split(' ')[0]} ${d.z0_med == null ? '–' : Math.max(0, d.z0_med) + ' m'} (${Math.round(d.mild_km)} km med plussgrader)`).join(', ');
      L.push(`- ${f.navn}: ${t}.`); });
    L.push('');
  }
  const met = data.met.filter(v => v.land);
  L.push(`MET farevarsler land i Nord: ${met.length ? met.map(v => `${v.hendelse} ${v.farge} (${v.omrade})`).join('; ') : 'ingen'}.`);
  const top = data.punkt.filter(p => p.dogn && p.dogn[1]).sort((a, b) => b.dogn[1].rr - a.dogn[1].rr).slice(0, 3);
  if (top.length) L.push('Mest nedbør i morgen: ' + top.map(p => `${p.navn} ${p.dogn[1].rr} mm (${p.dogn[1].sno} som snø), maks ${p.dogn[1].ff} m/s ${p.dogn[1].dd}`).join('; ') + '.');
  if (Object.keys(data.feil).length) L.push('', 'Feil ved henting: ' + Object.entries(data.feil).map(([k, v]) => k + ': ' + v).join('; '));
  return L.join('\n');
}

const API = { CFG, NIVA, NIVA_TXT, osloDato, leggTilDager, dagNavn, hentAlt, analyser, tekstutkast, brief, dognVerdier, vegnett, pakkUtGrunnlag, hoyde };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.LOGIKK = API;
})(typeof window !== 'undefined' ? window : globalThis);
