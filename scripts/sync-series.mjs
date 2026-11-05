// Descarga series de TMDB y genera data/series.json (el apartado «Series» de la web, separado de las pelis).
// Necesita TMDB_API_KEY, como sync-tmdb.mjs. Uso local: TMDB_API_KEY=xxxx node scripts/sync-series.mjs
// Variables opcionales: PAGES (páginas por lista, 20 series cada una; 60 por defecto) y MIN_VOTES (100).

import { writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "series.json");
// Capítulos de cada serie (título, nota y fecha) en un archivo aparte por serie: la app lo pide al abrir su ficha
const EPS_DIR = join(ROOT, "data", "eps");
const KEY = process.env.TMDB_API_KEY;
const PAGES = Number(process.env.PAGES || 60);
const MIN_VOTES = Number(process.env.MIN_VOTES || 100);
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

// Los géneros de series de TMDB son otros («Sci-Fi & Fantasy», «War & Politics»…): se pasan a los de las pelis
// para que el motor de gustos (que aprende de las pelis) también sepa recomendar series
const GENRES = {
  10759: ["Acción", "Aventura"], 16: ["Animación"], 35: ["Comedia"], 80: ["Crimen"], 99: ["Documental"], 18: ["Drama"],
  10751: ["Familia"], 10762: ["Infantil"], 9648: ["Misterio"], 10764: ["Reality"], 10765: ["Ciencia ficción", "Fantasía"],
  10766: ["Telenovela"], 10768: ["Bélica"], 37: ["Western"],
};
const SKIP_GENRES = new Set([10763, 10767]); // noticias y programas de entrevistas: no son series
const STATUS = { "Returning Series": "En emisión", Ended: "Terminada", Canceled: "Cancelada", "In Production": "En producción", Planned: "Anunciada" };

const LOGOS = {};
const names = (list = []) => list.map((p) => { if (p.logo_path) LOGOS[p.provider_name] = p.logo_path; return p.provider_name; });
const yearOf = (d) => Number(String(d || "").slice(0, 4)) || null;

export function toSeries(d) {
  const es = d["watch/providers"]?.results?.ES;
  const flatrate = names(es?.flatrate);
  const pay = [...new Set([...names(es?.rent), ...names(es?.buy)])].filter((p) => !flatrate.includes(p)).slice(0, 6);
  const genres = [...new Set((d.genres || []).flatMap((g) => GENRES[g.id] || [g.name]))].slice(0, 3);
  const seasons = (d.seasons || []).filter((s) => s.season_number > 0 && s.episode_count > 0)
    .map((s) => [s.season_number, s.episode_count, yearOf(s.air_date)]);
  const next = d.next_episode_to_air;
  const status = STATUS[d.status] || null;
  return {
    id: `tv-${d.id}`,
    tmdb: d.id,
    kind: "tv",
    title: d.name,
    original: d.original_name,
    year: yearOf(d.first_air_date),
    ...(status === "Terminada" || status === "Cancelada" ? { end: yearOf(d.last_air_date) } : {}),
    status,
    director: (d.created_by || []).map((c) => c.name).slice(0, 2).join(", ") || "Desconocido",
    cast: (d.credits?.cast || []).slice(0, 4).map((c) => c.name),
    network: d.networks?.[0]?.name || null,
    episodeTime: d.episode_run_time?.[0] || d.last_episode_to_air?.runtime || 0,
    seasons,
    episodes: seasons.reduce((n, s) => n + s[1], 0),
    ...(next ? { next: { date: next.air_date, s: next.season_number, e: next.episode_number } } : {}),
    genres,
    desc: d.overview && d.overview.length > 420 ? d.overview.slice(0, 417).replace(/\s+\S*$/, "") + "…" : d.overview,
    rating: d.vote_count ? Math.round(d.vote_average * 10) / 10 : null,
    votes: d.vote_count || 0,
    popularity: Math.round(d.popularity || 0),
    poster: d.poster_path ? `${IMG}/w500${d.poster_path}` : null,
    backdrop: d.backdrop_path ? `${IMG}/w780${d.backdrop_path}` : null,
    trailer: pickTrailer(d.videos?.results),
    providers: flatrate,
    ...(pay.length ? { pay } : {}),
    providersLink: es?.link || null,
    c: colorsFor(d.name),
  };
}

async function main() {
  if (!KEY) throw new Error("Falta TMDB_API_KEY");
  const ids = new Set();
  const lists = [
    ["/discover/tv", { sort_by: "popularity.desc", "vote_count.gte": MIN_VOTES }],
    ["/discover/tv", { sort_by: "vote_average.desc", "vote_count.gte": Math.max(MIN_VOTES, 400) }],
    ["/discover/tv", { sort_by: "vote_count.desc", "vote_count.gte": MIN_VOTES }],
    ["/trending/tv/week", {}],
  ];
  for (const [path, params] of lists) {
    for (let page = 1; page <= (path.startsWith("/trending") ? 3 : PAGES); page++) {
      const r = await tmdb(path, { ...params, language: "es-ES", watch_region: "ES", without_genres: "10763,10767", page });
      r.results.forEach((s) => ids.add(s.id));
      if (page >= r.total_pages) break;
      await sleep(60);
    }
  }
  // Capítulos de las temporadas que vengan en la respuesta (append_to_response season/N): [título, nota, fecha]
function episodesOf(d) {
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    const n = k.match(/^season\/(\d+)$/)?.[1];
    if (!n || n === "0" || !Array.isArray(v?.episodes)) continue;
    out[n] = v.episodes.map((e) => [e.name || "", e.vote_count ? Math.round(e.vote_average * 10) / 10 : null, e.air_date || null]);
  }
  return out;
}
const seasonParts = (numbers) => {
  const parts = [];
  for (let i = 0; i < numbers.length; i += 17) parts.push(numbers.slice(i, i + 17).map((n) => `season/${n}`));
  return parts;
};

// Las que están en tendencia esta semana, para la fila «En tendencia»
  const trending = (await tmdb("/trending/tv/week", { language: "es-ES" })).results.map((s) => `tv-${s.id}`);
  console.log(`${ids.size} series en la lista; pidiendo fichas…`);

  const series = [];
  await rm(EPS_DIR, { recursive: true, force: true });
  await mkdir(EPS_DIR, { recursive: true });
  let n = 0;
  for (const id of ids) {
    try {
      // La ficha y las primeras 17 temporadas en una sola petición (TMDB admite 20 añadidos por petición)
      const d = await tmdb(`/tv/${id}`, { language: "es-ES", append_to_response: "videos,credits,watch/providers," + Array.from({ length: 17 }, (_, i) => `season/${i + 1}`).join(","), include_video_language: "es,en" });
      if ((d.genres || []).some((g) => SKIP_GENRES.has(g.id))) continue;
      const s = toSeries(d);
      if (s.desc && s.poster && s.year && s.genres.length && s.seasons.length) {
        series.push(s);
        const eps = episodesOf(d);
        const rest = s.seasons.map((x) => x[0]).filter((x) => !eps[x]);
        for (const part of seasonParts(rest)) {
          Object.assign(eps, episodesOf(await tmdb(`/tv/${id}`, { language: "es-ES", append_to_response: part.join(",") })));
          await sleep(40);
        }
        await writeFile(join(EPS_DIR, `${d.id}.json`), JSON.stringify(eps));
      }
    } catch (e) {
      console.warn(`  ${id}: ${e.message}`);
    }
    if (++n % 100 === 0) console.log(`  ${n}/${ids.size}`);
    await sleep(40);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    updatedAt: new Date().toISOString(),
    logos: LOGOS,
    trending: trending.filter((id) => series.some((s) => s.id === id)),
    attribution: "Este producto usa la API de TMDB, pero no está respaldado ni certificado por TMDB. Datos de plataformas: JustWatch.",
    series,
  }));
  console.log(`Guardadas ${series.length} series en data/series.json`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
