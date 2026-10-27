// Descarga películas de TMDB y genera data/movies.json para la web.
// Necesita la variable TMDB_API_KEY (clave v3). En GitHub se guarda como secreto del repositorio.
// Uso local: TMDB_API_KEY=xxxx node scripts/sync-tmdb.mjs
// Variables opcionales: PAGES (páginas por lista, 20 pelis cada una; 300 por defecto, TMDB permite 500) y MIN_VOTES (80).

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "movies.json");
const KEY = process.env.TMDB_API_KEY;
const PAGES = Number(process.env.PAGES || 300);
const MIN_VOTES = Number(process.env.MIN_VOTES || 80);
const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tmdb(path, params = {}, tries = 4) {
  const url = new URL(API + path);
  url.searchParams.set("api_key", KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let i = 1; ; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (i >= tries || (res.status !== 429 && res.status < 500)) throw new Error(`${path}: HTTP ${res.status}`);
    await sleep(2000 * i);
  }
}

function colorsFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  return [`hsl(${h} 50% 20%)`, `hsl(${(h + 22) % 360} 80% 72%)`];
}

function pickTrailer(videos = []) {
  const yt = videos.filter((v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"));
  const rank = (v) => (v.iso_639_1 === "es" ? 0 : 2) + (v.type === "Trailer" ? 0 : 1) - (v.official ? 0.5 : 0);
  const best = yt.sort((a, b) => rank(a) - rank(b))[0];
  return best ? `https://www.youtube.com/watch?v=${best.key}` : null;
}

export function toMovie(d, genreNames) {
  const es = d["watch/providers"]?.results?.ES;
  const year = Number((d.release_date || "").slice(0, 4)) || null;
  return {
    id: `tmdb-${d.id}`,
    tmdb: d.id,
    title: d.title,
    original: d.original_title,
    year,
    director: (d.credits?.crew || []).filter((c) => c.job === "Director").map((c) => c.name).join(", ") || "Desconocido",
    cast: (d.credits?.cast || []).slice(0, 4).map((c) => c.name),
    runtime: d.runtime || 0,
    genres: (d.genres || []).map((g) => genreNames[g.id] || g.name).slice(0, 3),
    desc: d.overview && d.overview.length > 420 ? d.overview.slice(0, 417).replace(/\s+\S*$/, "") + "…" : d.overview,
    rating: d.vote_count ? Math.round(d.vote_average * 10) / 10 : null,
    poster: d.poster_path ? `${IMG}/w500${d.poster_path}` : null,
    trailer: pickTrailer(d.videos?.results),
    providers: (es?.flatrate || []).map((p) => p.provider_name),
    providersLink: es?.link || null,
    c: colorsFor(d.title),
  };
}

async function main() {
  if (!KEY) throw new Error("Falta TMDB_API_KEY");
  const { genres } = await tmdb("/genre/movie/list", { language: "es-ES" });
  const genreNames = Object.fromEntries(genres.map((g) => [g.id, g.name]));

  // Lista: las más populares y las mejor valoradas, sin repetir
  const ids = new Set();
  const lists = [
    ["/discover/movie", { sort_by: "popularity.desc", "vote_count.gte": MIN_VOTES }],
    ["/discover/movie", { sort_by: "vote_average.desc", "vote_count.gte": Math.max(MIN_VOTES, 500) }],
    ["/discover/movie", { sort_by: "vote_count.desc", "vote_count.gte": MIN_VOTES }],
  ];
  for (const [path, params] of lists) {
    for (let page = 1; page <= PAGES; page++) {
      const r = await tmdb(path, { ...params, language: "es-ES", region: "ES", include_adult: "false", page });
      r.results.forEach((m) => ids.add(m.id));
      if (page >= r.total_pages) break;
      await sleep(60);
    }
  }
  console.log(`${ids.size} películas en la lista; pidiendo fichas…`);

  const movies = [];
  let n = 0;
  for (const id of ids) {
    try {
      const d = await tmdb(`/movie/${id}`, {
        language: "es-ES",
        append_to_response: "videos,credits,watch/providers",
        include_video_language: "es,en",
      });
      const m = toMovie(d, genreNames);
      if (m.desc && m.runtime && m.year && m.genres.length) movies.push(m);
    } catch (e) {
      console.warn(`  ${id}: ${e.message}`);
    }
    if (++n % 100 === 0) console.log(`  ${n}/${ids.size}`);
    await sleep(40); // TMDB admite unas 40-50 peticiones por segundo
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    updatedAt: new Date().toISOString(),
    attribution: "Este producto usa la API de TMDB, pero no está respaldado ni certificado por TMDB. Datos de plataformas: JustWatch.",
    movies,
  }));
  console.log(`Guardadas ${movies.length} películas en data/movies.json`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
