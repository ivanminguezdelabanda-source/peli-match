// Novedades de Cinder: genera data/news.json con
//   - películas de TMDB: en cines en España, próximos estrenos y tendencias de la semana (con su ficha completa)
//   - una película destacada (la más en tendencia que tenga imagen de fondo)
//   - noticias de webs de cine en español, leídas de sus RSS (titular, foto, un trozo y el enlace a la noticia)
// Necesita TMDB_API_KEY. Lo ejecuta el workflow de sincronizar cada pocas horas.
// Uso local: TMDB_API_KEY=xxxx node scripts/sync-news.mjs

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toMovie, LOGOS } from "./sync-tmdb.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "news.json");
const KEY = process.env.TMDB_API_KEY;
const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

// Webs de noticias de cine en español. Si alguna falla o cambia su RSS, se salta y se usan las demás.
const FEEDS = [
  { name: "Espinof", url: "https://www.espinof.com/feedburner.xml" },
  { name: "Fotogramas", url: "https://www.fotogramas.es/rss/all.xml/" },
  { name: "SensaCine", url: "https://www.sensacine.com/rss/noticias.xml" },
  { name: "Cinemanía", url: "https://www.20minutos.es/rss/cinemania/" },
];
const MAX_NEWS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tmdb(path, params = {}) {
  const url = new URL(API + path);
  url.searchParams.set("api_key", KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let i = 1; ; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (i >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`${path}: HTTP ${res.status}`);
    await sleep(2000 * i);
  }
}

// ---------- Películas ----------
async function movieList(path, params, pages = 2) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const r = await tmdb(path, { language: "es-ES", region: "ES", page, ...params });
    out.push(...r.results);
    if (page >= r.total_pages) break;
  }
  return out;
}

async function movies(genreNames) {
  const day = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const today = day(0);
  // En cines y próximos en España: la lista de TMDB y, además, todo lo estrenado (o por estrenar) en cines españoles
  // según las fechas de estreno de España, ordenado por popularidad. Así no se escapan pelis que TMDB no pone en su lista.
  const discover = (from, to, pages) => movieList("/discover/movie", {
    "release_date.gte": from, "release_date.lte": to, with_release_type: "2|3", sort_by: "popularity.desc", include_adult: "false",
  }, pages);
  const nowPlaying = [...await movieList("/movie/now_playing", {}, 5), ...await discover(day(-45), today, 4)];
  const upcoming = [...await movieList("/movie/upcoming", {}, 5), ...await discover(day(1), day(180), 4)];
  const trending = await movieList("/trending/movie/week", {}, 1);
  const uniq = (list) => [...new Map(list.map((m) => [m.id, m])).values()];

  // Ficha completa (reparto, tráiler, plataformas) de cada una, sin repetir
  const full = new Map();
  const pop = (list) => uniq(list).filter((m) => m.poster_path).sort((a, b) => b.popularity - a.popularity);
  for (const m of [...pop(nowPlaying).slice(0, 70), ...pop(upcoming).slice(0, 70), ...trending.slice(0, 20)]) {
    if (full.has(m.id)) continue;
    try {
      const d = await tmdb(`/movie/${m.id}`, { language: "es-ES", append_to_response: "videos,credits,watch/providers,release_dates,keywords", include_video_language: "es,en" });
      const movie = toMovie(d, genreNames);
      // Fecha de estreno en cines de España si la hay (la de TMDB es la mundial)
      const es = d.release_dates?.results?.find((r) => r.iso_3166_1 === "ES")?.release_dates?.filter((r) => r.type === 3 || r.type === 2)
        .map((r) => r.release_date.slice(0, 10)).sort()[0];
      movie.release = es || (d.release_date || "").slice(0, 10) || null;
      movie.backdrop = d.backdrop_path ? `${IMG}/w780${d.backdrop_path}` : null;
      movie.tagline = d.tagline || "";
      movie.pop = m.popularity;
      if (!movie.year && movie.release) movie.year = Number(movie.release.slice(0, 4));
      if (movie.title && movie.year) full.set(m.id, movie);
    } catch (e) {
      console.warn(`  ${m.id}: ${e.message}`);
    }
    await sleep(30);
  }
  const got = (list) => uniq(list).map((m) => full.get(m.id)).filter(Boolean);
  // En cines: ya estrenadas en España (como mucho hace 2 meses), las más populares primero
  const inCinemas = got(nowPlaying).filter((m) => m.release && m.release <= today && m.release >= day(-60))
    .sort((a, b) => b.pop - a.pop).slice(0, 40);
  // Próximas: las que aún no se han estrenado en España (las de la lista de cines con fecha futura también), por fecha
  const next = got([...upcoming, ...nowPlaying]).filter((m) => m.release && m.release > today)
    .sort((a, b) => b.pop - a.pop).slice(0, 40).sort((a, b) => a.release.localeCompare(b.release) || b.pop - a.pop);
  const ids = (list) => list.map((m) => m.id);
  const all = [...full.values()];
  for (const m of all) delete m.pop;
  const featured = trending.map((m) => full.get(m.id)).find((m) => m && m.backdrop && m.desc) || all.find((m) => m.backdrop) || null;
  return {
    movies: all,
    featured: featured?.id || null,
    nowPlaying: ids(inCinemas),
    upcoming: ids(next),
    trending: ids(got(trending).slice(0, 20)),
  };
}

// ---------- Noticias (RSS y Atom, sin dependencias) ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", laquo: "«", raquo: "»", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", iexcl: "¡", iquest: "¿",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", uuml: "ü", ccedil: "ç" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m);
const cdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i")); return m ? cdata(m[1]).trim() : ""; };
const attr = (xml, name, a) => { const m = xml.match(new RegExp(`<${name}\\s[^>]*${a}=["']([^"']+)["']`, "i")); return m ? decode(m[1]) : ""; };
const text = (html) => decode(decode(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/\s+([,.;:!?)»”])/g, "$1").replace(/([(«“¿¡])\s+/g, "$1").trim();
const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href.replace(/^http:/, "https:") : ""; } catch (e) { return ""; } };

function parseFeed(xml, source) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return items.map((it) => {
    const body = tag(it, "content:encoded") || tag(it, "description") || tag(it, "summary") || tag(it, "content");
    const image = attr(it, "media:content", "url") || attr(it, "media:thumbnail", "url") || attr(it, "enclosure", "url")
      || (decode(body).match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || "";
    const link = tag(it, "link") || attr(it, "link", "href");
    const date = Date.parse(tag(it, "pubDate") || tag(it, "dc:date") || tag(it, "published") || tag(it, "updated"));
    let excerpt = text(body);
    if (excerpt.length > 220) excerpt = excerpt.slice(0, 217).replace(/\s+\S*$/, "") + "…";
    return { title: text(tag(it, "title")), link: safeUrl(decode(link)), image: safeUrl(image), excerpt, date: Number.isFinite(date) ? date : 0, source };
  }).filter((n) => n.title && n.link);
}

async function news() {
  const all = [];
  for (const f of FEEDS) {
    try {
      const res = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 (Cinder; +https://ivanminguezdelabanda-source.github.io/peli-match/)" }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseFeed(await res.text(), f.name);
      console.log(`  ${f.name}: ${items.length} noticias`);
      all.push(...items.slice(0, 15));
    } catch (e) {
      console.log(`::warning::Noticias de ${f.name} no disponibles (${e.message})`);
    }
  }
  // Las más recientes, sin repetir titular, y sin que una sola web lo llene todo
  const seen = new Set(), perSource = {};
  return all.sort((a, b) => b.date - a.date).filter((n) => {
    const k = n.title.toLowerCase();
    if (seen.has(k) || (perSource[n.source] = (perSource[n.source] || 0) + 1) > 10) return false;
    seen.add(k);
    return true;
  }).slice(0, MAX_NEWS);
}

async function main() {
  if (!KEY) throw new Error("Falta TMDB_API_KEY");
  const { genres } = await tmdb("/genre/movie/list", { language: "es-ES" });
  const genreNames = Object.fromEntries(genres.map((g) => [g.id, g.name]));
  const data = { updatedAt: new Date().toISOString(), ...(await movies(genreNames)), news: await news(), logos: LOGOS };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data));
  console.log(`::notice::Novedades: ${data.nowPlaying.length} en cines, ${data.upcoming.length} próximas, ${data.trending.length} en tendencia, ${data.news.length} noticias.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
