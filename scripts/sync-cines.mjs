// Carteleras de los cines de España → data/cines/index.json (todos los cines, con su sitio en el mapa)
// y data/cines/<id>.json (las pelis de ese cine con sus pases de los próximos 7 días).
//
// Los datos salen de las páginas públicas de cines de FilmAffinity: una por provincia con sus cines y una por
// cine con su cartelera (título, versión, duración, día, hora, sala y enlace para comprar la entrada).
// Se descargan despacio (pocas a la vez) una vez al día. Uso: node scripts/sync-cines.mjs [carpeta de salida]
// Para probar sin red: CINES_LOCAL=carpeta con theaters.html, state-ES-M.html y theater-235.html
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";

const OUT = process.argv[2] || "data/cines";
const BASE = "https://www.filmaffinity.com/es/";
const LOCAL = process.env.CINES_LOCAL;
const DAYS = 7;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const stats = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  if (LOCAL) {
    const name = path === "theaters.php" ? "theaters.html"
      : path.startsWith("theaters.php?state=") ? `state-${path.split("=")[1]}.html` : `theater-${path.split("=")[1]}.html`;
    return readFile(`${LOCAL}/${name}`, "utf8").catch(() => "");
  }
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(BASE + path, { headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9" } });
      if (r.ok) return await r.text();
      stats["http" + r.status] = (stats["http" + r.status] || 0) + 1;
      if (r.status === 404) return "";
      // Demasiadas peticiones: se espera más (lo que pida la web, o cada vez más)
      if (r.status === 429 || r.status >= 500) await sleep((Number(r.headers.get("retry-after")) || 0) * 1000 || 10000 * (i + 1));
    } catch { stats.neterr = (stats.neterr || 0) + 1; }
    await sleep(2000 * (i + 1));
  }
  return "";
}

const decode = (s) => String(s || "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

// Provincia → sus cines: { id, name, city, addr }
function parseState(html, prov) {
  const out = [];
  for (const group of html.split('class="fa-content-card city-group"').slice(1)) {
    const city = decode(group.match(/class="card-header">([\s\S]*?)<\/div>/)?.[1]);
    for (const li of group.split("data-theater-id=").slice(1)) {
      const m = li.match(/theater-showtimes\.php\?id=(\d+)"[^>]*title="([^"]*)"/);
      if (!m || out.some((t) => t.id === +m[1])) continue;
      out.push({ id: +m[1], name: decode(m[2]), city, prov, addr: decode(li.match(/<em>([\s\S]*?)<\/em>/)?.[1]) });
    }
  }
  return out;
}

// Cine → { lat, lon, web, screens, films: [{ fa, title, year, poster, runtime, versions: [{ name, days: { fecha: [[hora, sala, url]] } }] }] }
function parseTheater(html, today, last) {
  const cp = html.match(/[?&]cp=(-?[\d.]+)~(-?[\d.]+)/);
  const web = html.match(/Web oficial:[\s\S]*?href="([^"]+)"/)?.[1] || "";
  const screens = Number(html.match(/fa-camera-movie[\s\S]{0,200}?<div>\s*(\d+)\s+salas?/)?.[1]) || null;
  const cards = {};
  for (const c of html.split('class="row movie-card').slice(1)) {
    const id = c.match(/data-movie-id="(\d+)"/)?.[1];
    if (!id || cards[id]) continue;
    cards[id] = {
      fa: +id,
      title: decode(c.match(/class="fs-6 mc-title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1]),
      year: Number(c.match(/class="mc-year[^"]*">(\d{4})/)?.[1]) || null,
      poster: c.match(/data-srcset="[^"]*?(https:\/\/pics\.filmaffinity\.com\/[^ "]+-mmed\.jpg)/)?.[1]
        || c.match(/(https:\/\/pics\.filmaffinity\.com\/[^ "]+\.jpg)/)?.[1] || "",
      director: decode(c.match(/class="mt-2 mc-director">([\s\S]*?)<\/div><\/div>/)?.[1]).replace(/\s+,/g, ",").replace(/\s*\.\.\.$/, ""),
      versions: [],
    };
  }
  for (const b of html.split('class="movie-showtimes-n').slice(1)) {
    const id = b.match(/data-m-id="(\d+)"/)?.[1];
    const film = cards[id];
    if (!film) continue;
    const label = decode(b.match(/class="mv-title[\s\S]*?<span class="fs-5">([\s\S]*?)<\/span>/)?.[1]);
    if (!film.runtime) film.runtime = Number(b.match(/(\d+)\s*minutos/)?.[1]) || null;
    // «Dune: Parte Tres (VOS español) (Laser Ultra)» → versión «VOS español · Laser Ultra»; sin paréntesis es la normal
    const tail = label.toLowerCase().startsWith(film.title.toLowerCase()) ? label.slice(film.title.length) : (label.match(/(\s*\([^()]*\))+\s*$/)?.[0] || "");
    const name = [...tail.matchAll(/\(([^()]*)\)/g)].map((x) => x[1].trim()).join(" · ");
    const days = {};
    for (const row of b.split('data-sess-date="').slice(1)) {
      const date = row.slice(0, 10);
      if (date < today || date > last) continue;
      const times = [...row.split(/class="row g-0 mb-2"/)[0].matchAll(/<a ([^>]*)>\s*(\d{1,2}:\d{2})\s*<\/a>/g)].map(([, attrs, time]) => {
        const url = attrs.match(/href="([^"]*)"/)?.[1] || "";
        return [time.padStart(5, "0"), decode(attrs.match(/title="([^"]*)"/)?.[1]).replace(/^Sala\s*/i, ""), url.startsWith("http") ? decode(url) : ""];
      });
      if (times.length) days[date] = (days[date] || []).concat(times).sort((x, y) => x[0].localeCompare(y[0]));
    }
    if (Object.keys(days).length) film.versions.push({ name, days });
  }
  const films = Object.values(cards).filter((f) => f.versions.length);
  return { lat: cp ? +(+cp[1]).toFixed(5) : null, lon: cp ? +(+cp[2]).toFixed(5) : null, web, screens, films };
}

async function main() {
  const now = new Date(Date.now() + 3600e3); // hora de España (aprox.): el día empieza a las 00:00 de aquí
  const today = now.toISOString().slice(0, 10);
  const last = new Date(now.getTime() + (DAYS - 1) * 864e5).toISOString().slice(0, 10);
  const states = [...new Set([...(await get("theaters.php")).matchAll(/theaters\.php\?state=(ES-[A-Z]+)/g)].map((m) => m[1]))];
  if (!states.length) throw new Error("No se ha podido leer la lista de provincias");
  const theaters = [];
  for (const st of states) {
    const html = await get(`theaters.php?state=${st}`);
    const prov = decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]).replace(/^(Todos los )?cines (de|en)\s+/i, "");
    for (const t of parseState(html, prov)) if (!theaters.some((x) => x.id === t.id)) theaters.push(t);
    if (!LOCAL) await sleep(400);
  }
  console.log(`${states.length} provincias, ${theaters.length} cines`);
  if (theaters.length < (LOCAL ? 1 : 200)) throw new Error("Muy pocos cines: la web habrá cambiado");

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const index = [];
  let next = 0, withFilms = 0;
  const failed = [];
  let queue = theaters;
  async function worker() {
    while (next < queue.length) {
      const t = queue[next++];
      const html = await get(`theater-showtimes.php?id=${t.id}`);
      if (!html) { failed.push(t); continue; }
      const d = parseTheater(html, today, last);
      if (d.lat == null) { stats.nomap = (stats.nomap || 0) + 1; continue; } // sin sitio en el mapa no se puede ordenar por distancia
      index.push({ id: t.id, name: t.name, city: t.city, prov: t.prov, addr: t.addr, lat: d.lat, lon: d.lon, screens: d.screens, films: d.films.length });
      if (d.films.length) withFilms++;
      await writeFile(`${OUT}/${t.id}.json`, JSON.stringify({ id: t.id, name: t.name, city: t.city, addr: t.addr, web: d.web, screens: d.screens, updated: today, films: d.films }));
      if (!LOCAL) await sleep(900);
    }
  }
  await Promise.all(Array.from({ length: LOCAL ? 1 : 2 }, worker));
  // Los que han fallado, otra vez al final y de uno en uno, tras una pausa
  if (failed.length && !LOCAL) {
    console.log(`${failed.length} cines fallidos, se reintentan`, stats);
    await sleep(60000);
    queue = failed.splice(0); next = 0;
    await worker();
  }
  console.log("Errores:", stats, `sin descargar: ${failed.length}`);
  index.sort((a, b) => a.id - b.id);
  await writeFile(`${OUT}/index.json`, JSON.stringify({ updated: today, source: "FilmAffinity", cinemas: index }));
  console.log(`::notice::Cines: ${theaters.length} en la lista, ${index.length} guardados, ${withFilms} con cartelera, sin descargar ${failed.length}, errores ${JSON.stringify(stats)}`);
  if (!LOCAL && withFilms < 100) throw new Error("Muy pocos cines con cartelera: la web habrá cambiado");
}

main().catch((e) => { console.error(e); process.exit(1); });
