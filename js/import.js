// Importar el historial de Letterboxd o FilmAffinity (o cualquier CSV con título, año y nota).
//
// Letterboxd: Ajustes → Data → Export your data da un .zip con watched.csv, ratings.csv, diary.csv y watchlist.csv
// (columnas Date, Name, Year, Letterboxd URI y Rating de 0,5 a 5). FilmAffinity no tiene exportación oficial:
// las herramientas que la sacan dan un CSV con Title, Year, Directors, WatchedDate y Rating (de 1 a 10).
// Aquí se lee todo eso, se busca cada peli en el catálogo (título u original + año, con un año de margen)
// y se devuelve qué se ha encontrado; app.js decide cómo guardarlo (Vistas, Por ver y el motor de gustos).
(function () {
  // ---------- CSV (con comillas, saltos de línea dentro de comillas y separador , ; o tabulador) ----------
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, "");
    const first = text.slice(0, text.indexOf("\n") + 1 || text.length);
    const count = (ch) => first.split(ch).length;
    const sep = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"' && cell === "") quoted = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some((x) => x.trim())) rows.push(row);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim());
    return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
  }

  // ---------- ZIP (solo lo necesario para leer el .zip de Letterboxd en el navegador) ----------
  async function inflate(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }
  async function readZip(buffer) {
    const data = new Uint8Array(buffer);
    const view = new DataView(buffer);
    // Directorio central: al final del archivo (firma 0x06054b50)
    let end = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error("No es un .zip válido");
    const total = view.getUint16(end + 10, true);
    let p = view.getUint32(end + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < total; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const size = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true), extra = view.getUint16(p + 30, true), comment = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = dec.decode(data.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extra + comment;
      if (!/\.csv$/i.test(name)) continue;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = data.subarray(start, start + size);
      if (method !== 0 && method !== 8) continue;
      files[name] = dec.decode(method === 8 ? await inflate(raw) : raw);
    }
    return files;
  }

  // ---------- De filas a pelis ----------
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " y ").replace(/[^a-z0-9]+/g, " ").trim();
  const pick = (row, names) => {
    for (const k of Object.keys(row)) if (names.includes(norm(k))) return row[k];
    return "";
  };
  const TITLE = ["name", "title", "titulo", "film", "pelicula", "original title", "titulo original"];
  const YEAR = ["year", "ano", "release year", "anio"];
  const RATING10 = ["rating10", "nota10", "rating 10"];
  const RATING = ["rating", "nota", "mi nota", "your rating", "puntuacion", "valoracion"];
  const DATE = ["watched date", "watcheddate", "date", "fecha", "fecha vista", "watched"];
  // De qué tipo es cada archivo: lo que quieres ver va a «Por ver»; el resto, a «Vistas»
  const kindOf = (fileName) => (/watchlist|pendientes|por[ _-]?ver/i.test(fileName) ? "watchlist" : "watched");

  // Filas de uno o varios archivos → [{ title, year, rating (0–1 o null), date, kind }] sin repetir
  function itemsFrom(files) {
    const byKey = new Map();
    for (const [name, text] of Object.entries(files)) {
      const base = name.split("/").pop();
      if (/^(reviews|comments|profile|lists?)\b/i.test(base) || name.includes("/lists/")) continue;
      const kind = kindOf(base);
      for (const row of parseCSV(text)) {
        const title = pick(row, TITLE);
        if (!title) continue;
        const year = Number(pick(row, YEAR)) || null;
        let rating = null;
        const r10 = parseFloat(String(pick(row, RATING10)).replace(",", "."));
        const r = parseFloat(String(pick(row, RATING)).replace(",", "."));
        if (r10 > 0) rating = Math.min(1, r10 / 10);
        else if (r > 0) rating = Math.min(1, r > 5 ? r / 10 : r / 5);
        const d = Date.parse(pick(row, DATE));
        const key = norm(title) + "|" + (year || "");
        const old = byKey.get(key);
        // La misma peli en watched.csv y ratings.csv: se juntan (vista gana a «por ver»; se queda la nota)
        if (old) {
          if (kind === "watched") old.kind = "watched";
          if (rating != null) old.rating = rating;
          if (d && !old.date) old.date = d;
        } else byKey.set(key, { title, year, rating, date: d || null, kind });
      }
    }
    return [...byKey.values()];
  }

  // Busca cada peli en el catálogo; devuelve { found: [{ item, m }], missing: [item] }
  function match(movies, items) {
    const index = new Map();
    const add = (key, m) => { if (!key) return; const l = index.get(key); if (l) l.push(m); else index.set(key, [m]); };
    for (const m of movies) {
      add(norm(m.title), m);
      if (m.original && norm(m.original) !== norm(m.title)) add(norm(m.original), m);
      if (m.en) add(norm(m.en), m); // título en inglés (el que usa Letterboxd)
    }
    // Para los títulos que no coinciden tal cual (Letterboxd usa el título en inglés: «Parasite» → «Parásitos»):
    // pelis del mismo año con un título muy parecido (coeficiente de Dice sobre pares de letras ≥ 0,75)
    const byYear = new Map();
    for (const m of movies) { const l = byYear.get(m.year); if (l) l.push(m); else byYear.set(m.year, [m]); }
    const pairs = (s) => { const out = new Map(); for (let i = 0; i < s.length - 1; i++) { const p = s.slice(i, i + 2); out.set(p, (out.get(p) || 0) + 1); } return out; };
    const dice = (a, b) => {
      if (a.length < 4 || b.length < 4) return 0;
      const pa = pairs(a), pb = pairs(b);
      let common = 0, na = 0, nb = 0;
      pa.forEach((n, k) => { na += n; common += Math.min(n, pb.get(k) || 0); });
      pb.forEach((n) => (nb += n));
      return (2 * common) / (na + nb);
    };
    const fuzzy = (item) => {
      const t = norm(item.title);
      let best = null, bestScore = 0.75, tie = false;
      for (const m of byYear.get(item.year) || []) {
        const sc = Math.max(dice(t, norm(m.title)), dice(t, norm(m.original)), m.en ? dice(t, norm(m.en)) : 0);
        if (sc > bestScore) { best = m; bestScore = sc; tie = false; } else if (sc === bestScore && best) tie = true;
      }
      return tie ? null : best;
    };
    const found = [], missing = [], used = new Set();
    for (const item of items) {
      const cands = (index.get(norm(item.title)) || []).filter((m) => !used.has(m.id));
      let best = null;
      if (item.year) {
        best = cands.find((m) => m.year === item.year) || cands.find((m) => Math.abs((m.year || 0) - item.year) === 1) || null;
      } else if (cands.length === 1) best = cands[0];
      if (!best && item.year) { best = fuzzy(item); if (best && used.has(best.id)) best = null; }
      if (best) { used.add(best.id); found.push({ item, m: best }); } else missing.push(item);
    }
    return { found, missing };
  }

  // Lee lo que suba el usuario (.zip de Letterboxd o uno o varios .csv) → { [nombre]: texto }
  async function readFiles(fileList) {
    const files = {};
    for (const f of fileList) {
      if (/\.zip$/i.test(f.name) || f.type === "application/zip") Object.assign(files, await readZip(await f.arrayBuffer()));
      else files[f.name] = await f.text();
    }
    return files;
  }

  const api = { parseCSV, readZip, itemsFrom, match, readFiles, norm };
  if (typeof window !== "undefined") window.CinderImport = api;
  if (typeof module !== "undefined") module.exports = api;
})();
