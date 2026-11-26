# Skred- og flomberedskap Nord – vakt

Statisk nettside for beredskapsvakt i skred- og flomberedskapen (Statens vegvesen), Nordland, Troms og Finnmark. GitHub Actions bygger sida og publiserer den på GitHub Pages. Sida henter ferske varsler og prognoser fra NVE og MET hver gang den åpnes.

Automatisk generert grunnlag, ikke kvalitetssikret. Vurderingen gjøres av vakthavende.

## Oppbygning
| Fil/mappe | Innhold |
|---|---|
| `kilde/logikk.js` | Datahenting og analyse: nivåforslag, utsatt vegnett, høyde, tekstutkast, brief. `CFG` øverst: fylker, snøskredregioner, nøkkelpunkt, terskler |
| `kilde/mal.html` | Sida (Leaflet og CSS innlimt) |
| `kilde/bygg.js` | `node kilde/bygg.js kilde site` → `site/index.html` med innebygd data + `site/brief.md` |
| `kilde/grunnlag.json`, `kilde/hoyde.json` | Statisk grunnlag for vegnett (NVDB, NVE aktsomhet) |
| `kilde/vegnett/` | `lag_grunnlag.py`, `lag_hoyde.py` – lager grunnlaget på nytt. Kjøres sjelden |
| `site/fliser/norge.js` | Reserve-kartfliser |
| `.github/workflows/oppdater.yml` | Kjøreplan |

## Kjøreplan
- Hver time kl. xx:17, 06:17–21:17 norsk vintertid, ved push til `main` og manuelt (**Actions → Oppdater beredskap → Run workflow**).
- Innebygd data er bare reserve. På github.io og som lokal fil henter sida live data fra NVE (varsom), MET og Kartverket.
- Notater lagres i nettleseren til den enkelte (localStorage), ikke delt.

## Oppsett (én gang)
1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions**: slå på arbeidsflytene hvis GitHub spør, og kjør **Oppdater beredskap → Run workflow**.
3. Sida ligger på `https://max78n.github.io/skredberedskap-nord/`.

## Datakilder
- NVE/varsom: snøskred v6.3.0, jordskred v1.0.10, flom v1.0.6 (fylke 18, 55, 56).
- MET: metalerts 2.0, locationforecast 2.0.
- NVDB: vegnett og skredpunkt (824). NVE: aktsomhetskart jord-/flomskred og flom.
