#!/usr/bin/env node
/* Bygger index.html med innebygd ferskt datasett og skriver brief.md.
   Bruk: node bygg.js [mappe-med-logikk.js-og-mal.html] [utmappe] [YYYY-MM-DD]  */
const fs = require('fs'), path = require('path');
const inn = path.resolve(process.argv[2] || __dirname), ut = path.resolve(process.argv[3] || inn);
const L = require(path.join(inn, 'logikk.js'));
(async () => {
  const data = await L.hentAlt(fetch, { ua: 'svv-skredberedskap-nord/1.0 (Statens vegvesen beredskapsvakt)', dato: process.argv[4] });
  const ana = L.analyser(data);
  const gFil = [path.join(inn, 'grunnlag.json'), path.join(inn, 'vegnett', 'grunnlag_slank.json')].find(f => fs.existsSync(f));
  const grunnlagTekst = gFil ? fs.readFileSync(gFil, 'utf8') : 'null';
  const veg = gFil ? L.vegnett(data, JSON.parse(grunnlagTekst)) : null;
  const hFil = [path.join(inn, 'hoyde.json'), path.join(inn, 'vegnett', 'hoyde.json')].find(f => fs.existsSync(f));
  const hoydeTekst = hFil ? fs.readFileSync(hFil, 'utf8') : 'null';
  const ho = hFil ? L.hoyde(data, JSON.parse(hoydeTekst)) : null;
  // rader trengs ikke i siden (dogn beregnes på nytt) – men behold for kart/tabell. Fjern for å spare plass:
  const slank = JSON.parse(JSON.stringify(data));
  slank.punkt.forEach(p => { delete p.dogn; if (p.rader) p.rader = p.rader.filter(r => r.t < Date.now() + 4 * 864e5); });
  const logikk = fs.readFileSync(path.join(inn, 'logikk.js'), 'utf8');
  let html = fs.readFileSync(path.join(inn, 'mal.html'), 'utf8');
  html = html.replace('<script>/*LOGIKK*/</script>', () => '<script>\n' + logikk + '\n</script>')
             .replace('const BAKED=/*BAKED*/null;', () => 'const BAKED=' + JSON.stringify(slank).replace(/</g, '\\u003c') + ';')
             .replace('const GRUNNLAG=/*GRUNNLAG*/null;', () => 'const GRUNNLAG=' + grunnlagTekst.replace(/</g, '\\u003c') + ';')
             .replace('const HOYDE=/*HOYDE*/null;', () => 'const HOYDE=' + hoydeTekst + ';');
  fs.mkdirSync(ut, { recursive: true });
  fs.writeFileSync(path.join(ut, 'index.html'), html);
  fs.writeFileSync(path.join(ut, 'brief.md'), L.brief(data, ana, { veg, ho }) + '\n\n---\nTekstutkast:\n\n' + L.tekstutkast(data, ana));
  console.log('OK', Object.keys(data.feil).length ? 'feil: ' + JSON.stringify(data.feil) : 'alle kilder', '→', ut);
})().catch(e => { console.error(e); process.exit(1); });
