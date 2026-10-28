// Novedades de Cinder: genera data/news.json con
//   - películas de TMDB: en cines en España, próximos estrenos y tendencias de la semana (con su ficha completa)
//   - una película destacada (la más en tendencia que tenga imagen de fondo)
//   - noticias de webs de cine en español, leídas de sus RSS (titular, foto, un trozo y el enlace a la noticia)
// Necesita TMDB_API_KEY. Lo ejecuta el workflow de sincronizar cada pocas horas.
// Uso local: TMDB_API_KEY=xxxx node scripts/sync-news.mjs

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toMovie } from "./sync-tmdb.mjs";

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
  { name: "eCartelera", url: "https://www.ecartelera.com/rss/noticias.xml" },
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
  const today = new Date().toISOString().slice(0, 10);
  const nowPlaying = await movieList("/movie/now_playing", {});
  const upcoming = (await movieList("/movie/upcoming", {}, 3))
    .filter((m) => m.release_date && m.release_date > today)
    .sort((a, b) => a.release_date.localeCompare(b.release_date));
  const trending = await movieList("/trending/movie/week", {}, 1);

  // Ficha completa (reparto, tráiler, plataformas) de cada una, sin repetir
  const full = new Map();
  for (const m of [...nowPlaying.slice(0, 20), ...upcoming.slice(0, 20), ...trending.slice(0, 20)]) {
    if (full.has(m.id)) continue;
    try {
      const d = await tmdb(`/movie/${m.id}`, { language: "es-ES", append_to_response: "videos,credits,watch/providers,release_dates", include_video_language: "es,en" });
      const movie = toMovie(d, genreNames);
      // Fecha de estreno en España si la hay (la de TMDB es la mundial)
      const es = d.release_dates?.results?.find((r) => r.iso_3166_1 === "ES")?.release_dates?.find((r) => r.type === 3 || r.type === 2);
      movie.release = (es?.release_date || d.release_date || "").slice(0, 10) || null;
      movie.backdrop = d.backdrop_path ? `${IMG}/w780${d.backdrop_path}` : null;
      movie.tagline = d.tagline || "";
      if (!movie.year && movie.release) movie.year = Number(movie.release.slice(0, 4));
      if (movie.title && movie.year) full.set(m.id, movie);
    } catch (e) {
      console.warn(`  ${m.id}: ${e.message}`);
    }
    await sleep(40);
  }
  const ids = (list) => list.map((m) => `tmdb-${m.id}`).filter((id) => [...full.values()].some((x) => x.id === id)).slice(0, 20);
  const all = [...full.values()];
  const featured = trending.map((m) => full.get(m.id)).find((m) => m && m.backdrop && m.desc) || all.find((m) => m.backdrop) || null;
  return {
    movies: all,
    featured: featured?.id || null,
    nowPlaying: ids(nowPlaying),
    upcoming: ids(upcoming),
    trending: ids(trending),
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
const text = (html) => decode(decode(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
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
  const data = { updatedAt: new Date().toISOString(), ...(await movies(genreNames)), news: await news() };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data));
  console.log(`::notice::Novedades: ${data.nowPlaying.length} en cines, ${data.upcoming.length} próximas, ${data.trending.length} en tendencia, ${data.news.length} noticias.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
