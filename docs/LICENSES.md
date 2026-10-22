# Data, asset and library attribution

| Item | Source | Licence / terms | Where used |
|---|---|---|---|
| Airports, runways, frequencies, navaids (magnetic variation) | [OurAirports](https://ourairports.com/data/) | Public domain | `public/data/airports`, `public/data/navaids` |
| Terrain elevation | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium encoding), produced by Mapzen/Tilezen from SRTM, GMTED2010, ETOPO1, NED/3DEP, Canadian CDEM, EU-DEM, Geoscience Australia, Kartverket, LINZ and others | Open; attribution to the source datasets required (see [Tilezen attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)) | Streamed at runtime; baked fallback packs in `public/data/terrain` |
| KSFO airport layout, buildings; San Francisco tall buildings | © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), via Overpass API | ODbL 1.0: attribution; derived databases must be shared under ODbL | `public/data/hero/KSFO.json` |
| Populated places | [Natural Earth](https://www.naturalearthdata.com/) | Public domain | `public/data/places.json` |
| three.js | three.js authors | MIT | runtime |
| Vite, Vitest | Vite/Vitest authors | MIT | dev |
| Playwright | Microsoft | Apache-2.0 | dev (E2E tests) |
| pngjs | pngjs authors | MIT | dev (terrain bake) |

## Original content
- Aircraft model, cockpit, textures (runway markings, windows, noise), lights and all sounds are generated in code for this project. No third-party 3D models, textures or audio samples are included.
- No Microsoft Flight Simulator assets, data or trademarks are used. Aircraft are described by class ("Cessna 172-class"); names such as Cessna, Airbus and Boeing are trademarks of their owners and are used only descriptively.

## Not used (and why)
- Satellite/aerial imagery: no free global imagery is licensed for this use. Bing and Google terms prohibit it, and Sentinel-2 cloudless is non-commercial only. The ground is textured procedurally.
- OpenStreetMap raster tiles: their tile usage policy forbids heavy application use.

## Project code licence
Not yet chosen. The repository owner should add a `LICENSE` file.
