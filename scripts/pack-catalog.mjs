// Prepara el catálogo para la web, para que la app arranque antes (lo ejecuta la publicación, no se guarda en el repo).
//
// data/movies.json (≈8 MB) y data/series.json se quedan como están, y de cada uno salen dos archivos:
//   data/<nombre>.min.json → lo necesario para abrir la app: todo menos la sinopsis y el enlace de TMDB
//     (que se rehace con el id), más los temas de cada peli ya calculados (kw), que antes se sacaban
//     de las sinopsis en el móvil al abrir
//   data/<nombre>.desc.json → { id: sinopsis }, que la app descarga después, sin hacer esperar
// Uso: node scripts/pack-catalog.mjs [carpeta de datos]
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { keywordIndex } = require("../js/taste.js");
const DIR = process.argv[2] || "data";
const NAVIDAD = /navidad|papá noel|santa claus|nochebuena|reyes magos/i;

for (const [name, key] of [["movies", "movies"], ["series", "series"]]) {
  const raw = await readFile(`${DIR}/${name}.json`, "utf8").catch(() => null);
  if (!raw) { console.log(`${name}.json no está: se deja como está`); continue; }
  const data = JSON.parse(raw);
  const list = data[key] || [];
  const kw = keywordIndex(list);
  const desc = {};
  data[key] = list.map((m) => {
    const { desc: d, providersLink, ...rest } = m;
    if (d) desc[m.id] = d;
    // La temporada «navidad» se miraba también en la sinopsis: se marca aquí para no necesitarla al abrir
    if (NAVIDAD.test(`${m.title} ${d || ""}`) && !(rest.season || []).includes("navidad")) rest.season = [...(rest.season || []), "navidad"];
    const k = kw.get(m.id);
    return k && k.length ? { ...rest, kw: k } : rest;
  });
  const min = JSON.stringify(data);
  await writeFile(`${DIR}/${name}.min.json`, min);
  await writeFile(`${DIR}/${name}.desc.json`, JSON.stringify(desc));
  console.log(`${name}: ${list.length} · ${(raw.length / 1e6).toFixed(1)} MB → ${(min.length / 1e6).toFixed(1)} MB al abrir + ${(JSON.stringify(desc).length / 1e6).toFixed(1)} MB de sinopsis después`);
}
