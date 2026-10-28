// Motor de gustos de Cinder: un modelo por cuenta que aprende de cada gesto.
//
// Cada peli se describe con rasgos: géneros, director, reparto, temas (palabras clave de la sinopsis,
// elegidas con TF-IDF), década y duración. Cada gesto suma evidencia a favor o en contra de sus rasgos:
//   «La veré» +1 · «Ya la vi» +0,6 · a una lista +0,8 · abrir la ficha +0,15 · «Paso» −0,45
//   reseña: de −1,5 (1★) a +1,5 (5★) · encuesta: favoritas +2,5, géneros +1,5, evitar −3
// La evidencia caduca poco a poco (vida media de 90 días), así el modelo sigue tus gustos actuales.
// Afinidad de un rasgo = (a favor − en contra) / (a favor + en contra + 2): con pocos datos tiende a 0.
// Puntuación = Σ por tipo de rasgo (peso del tipo × afinidad media) + calidad (nota) + exploración.
// La lista final se reordena para que haya variedad (no cinco pelis seguidas del mismo género o director).
(function () {
  const HALF_LIFE_DAYS = 90;
  const DAY = 86400000;
  const MAX_FEATURES = 600; // los que se guardan en la cuenta
  const TYPE_WEIGHT = { g: 1.2, d: 1.8, a: 1.0, k: 0.9, e: 0.5, t: 0.35 };
  const TYPE_LABEL = { g: "género", d: "director", a: "reparto", k: "tema", e: "época", t: "duración" };
  const STOP = new Set(("a al algo algun alguna algunas alguno algunos ante antes aquel aquella aquellas aquello aquellos aqui asi aun aunque bajo bien cada casi como con contra cual cuales cuando cuanto de del desde donde dos el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta estaba estado estan estar estas este esto estos fue fueron gran ha habia han hasta hay hace hacer la las le les lo los mas me mi mientras mismo mucho muy nada ni no nos nuestra nuestro nunca o otra otras otro otros para pero poco por porque pronto que quien quienes se sea ser si sido sin sobre solo son su sus tambien tan tanto te tiene tienen todo todos tras tu tus un una uno unos ya vez veces vida dia dias ano anos tiempo mundo nueva nuevo nuevos nuevas joven jovenes hombre mujer hijo hija familia historia pelicula film tras durante cuando junto juntos parte primer primera tres cuatro despues entonces mientras donde ahora toda todas cosas manera forma lugar momento descubre decide debe deben puede pueden intenta busca comienza empieza encuentra lleva hacia").split(" "));

  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const now = () => Date.now();

  function createTaste(movies) {
    // ---------- Rasgos de cada peli ----------
    // Temas: palabras de la sinopsis con TF-IDF (las comunes a 3–300 pelis dicen algo del tema)
    const tokens = new Map();
    const df = new Map();
    // Los nombres propios (Vito, Corleone…) no son temas: se descartan las palabras que casi siempre van en mayúscula
    const caps = new Map();
    for (const m of movies) {
      for (const w of (m.desc || "").match(/[\p{L}]{4,}/gu) || []) {
        const k = norm(w);
        const c = caps.get(k) || [0, 0];
        c[w[0] === w[0].toUpperCase() ? 0 : 1]++;
        caps.set(k, c);
      }
    }
    const proper = (w) => { const c = caps.get(w); return c && c[0] > c[1] * 2; };
    for (const m of movies) {
      const words = (norm(m.desc || "").match(/[a-zñ]{4,}/g) || []).filter((w) => !proper(w));
      const tf = new Map();
      words.forEach((w) => { if (!STOP.has(w)) tf.set(w, (tf.get(w) || 0) + 1); });
      tokens.set(m.id, tf);
      tf.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1));
    }
    const N = movies.length;
    const featCache = new Map();
    function features(m) {
      let f = featCache.get(m.id);
      if (f) return f;
      f = [];
      (m.genres || []).forEach((g) => f.push("g:" + g));
      if (m.director && m.director !== "Desconocido") f.push("d:" + m.director);
      (m.cast || []).slice(0, 4).forEach((a) => f.push("a:" + a));
      const kw = [...(tokens.get(m.id) || [])]
        .filter(([w]) => { const d = df.get(w); return d >= 3 && d <= 300; })
        .map(([w, n]) => [w, n * Math.log(N / df.get(w))])
        .sort((a, b) => b[1] - a[1]).slice(0, 6);
      kw.forEach(([w]) => f.push("k:" + w));
      if (m.year) f.push("e:" + Math.floor(m.year / 10) * 10);
      if (m.runtime) f.push("t:" + (m.runtime < 95 ? "corta" : m.runtime <= 135 ? "media" : "larga"));
      featCache.set(m.id, f);
      return f;
    }

    // ---------- Modelo ----------
    // model.f[rasgo] = [a favor, en contra, día de la última actualización]
    let model = { v: 1, f: {}, n: 0 };
    let changed = () => {};
    const decayTo = (rec, day) => {
      const k = Math.pow(0.5, (day - rec[2]) / HALF_LIFE_DAYS);
      return [rec[0] * k, rec[1] * k, day];
    };
    const today = () => Math.floor(now() / DAY);

    // signal > 0 suma a favor; < 0 suma en contra. Los rasgos raros pesan un poco más que los comunes.
    // undo = true resta lo que sumó ese mismo gesto (botón «Deshacer»).
    function learnFeatures(feats, signal, undo = false) {
      const day = today();
      const share = 1 / Math.sqrt(feats.length || 1);
      for (const key of feats) {
        const rec = model.f[key] ? decayTo(model.f[key], day) : [0, 0, day];
        const amount = Math.abs(signal) * share * (key[0] === "g" ? 1 : 1.6);
        const side = signal > 0 ? 0 : 1;
        rec[side] = Math.max(0, rec[side] + (undo ? -amount : amount));
        model.f[key] = rec.map((x, i) => (i < 2 ? Math.round(x * 1000) / 1000 : x));
      }
      model.n = Math.max(0, model.n + (undo ? -1 : 1));
      ranked = null;
      changed();
    }
    const learn = (m, signal, undo) => m && learnFeatures(features(m), signal, undo);

    function affinity(key, day) {
      const rec = model.f[key];
      if (!rec) return { a: 0, n: 0 };
      const [p, n] = decayTo(rec, day);
      return { a: (p - n) / (p + n + 2), n: p + n };
    }

    // ---------- Puntuación ----------
    function score(m, { explore = 0.25, rand = Math.random } = {}) {
      const day = today();
      const byType = {};
      const reasons = [];
      let unknown = 0;
      for (const key of features(m)) {
        const t = key[0];
        const { a, n } = affinity(key, day);
        (byType[t] ||= []).push(a);
        if (n < 0.5) unknown++;
        if (a > 0.25 && "gdak".includes(t)) reasons.push([a * TYPE_WEIGHT[t], key]);
      }
      let s = 0;
      for (const t in byType) {
        const list = byType[t];
        // media suavizada: un rasgo que encanta cuenta más que varios neutros
        const sum = list.reduce((x, y) => x + y, 0);
        s += TYPE_WEIGHT[t] * sum / Math.sqrt(list.length);
      }
      if (m.rating != null) s += (m.rating - 6.5) * 0.35;
      // Exploración: un empujón al azar mayor cuanto menos sabemos de la peli
      s += explore * (unknown / (features(m).length || 1)) * rand();
      reasons.sort((x, y) => y[0] - x[0]);
      return { s, reasons: reasons.slice(0, 3).map((r) => r[1]) };
    }

    function reasonText(key) {
      const v = key.slice(2);
      switch (key[0]) {
        case "g": return `Te suele gustar ${v.toLowerCase()}`;
        case "d": return `Te gustan las pelis de ${v}`;
        case "a": return `Sale ${v}, que te gusta`;
        case "k": return `Trata temas que te interesan («${v}»)`;
        case "e": return `De los ${v}, una época que te va`;
        default: return `Su duración (${v}) es la que prefieres`;
      }
    }

    // Reordena para que haya variedad: penaliza repetir director o géneros de las últimas elegidas
    function diversify(items, take) {
      const pool = items.slice(0, Math.max(take * 3, 60));
      const out = [];
      while (out.length < take && pool.length) {
        let best = 0, bestVal = -Infinity;
        const recent = out.slice(-4);
        for (let i = 0; i < Math.min(pool.length, 40); i++) {
          const m = pool[i].m;
          let pen = 0;
          for (const r of recent) {
            if (r.m.director === m.director) pen += 1.2;
            pen += 0.35 * m.genres.filter((g) => r.m.genres.includes(g)).length / Math.max(m.genres.length, 1);
          }
          const val = pool[i].s - pen;
          if (val > bestVal) { bestVal = val; best = i; }
        }
        out.push(pool.splice(best, 1)[0]);
      }
      return out.concat(pool, items.slice(Math.max(take * 3, 60)));
    }

    // Lista personalizada de ids. Se calcula una vez y se reutiliza hasta que aprende algo nuevo.
    let ranked = null;
    function rank(list = movies, opts = {}) {
      if (!opts.fresh && ranked && list === movies) return ranked;
      const scored = list.map((m) => ({ m, ...score(m, opts) })).sort((a, b) => b.s - a.s);
      const out = diversify(scored, Math.min(200, scored.length));
      if (list === movies) ranked = out;
      return out;
    }

    // ---------- Guardar y cargar ----------
    // Solo se guardan los rasgos con más evidencia, para que quepa en la cuenta
    function exportModel() {
      const day = today();
      const entries = Object.entries(model.f)
        .map(([k, r]) => [k, decayTo(r, day)])
        .filter(([, r]) => r[0] + r[1] > 0.05)
        .sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]))
        .slice(0, MAX_FEATURES)
        .map(([k, r]) => [k, [Math.round(r[0] * 1000) / 1000, Math.round(r[1] * 1000) / 1000, r[2]]]);
      return { v: 1, n: model.n, f: Object.fromEntries(entries) };
    }
    function importModel(data) {
      if (!data || typeof data.f !== "object") return;
      model = { v: 1, n: Number(data.n) || 0, f: {} };
      for (const [k, r] of Object.entries(data.f)) {
        if (Array.isArray(r) && r.length === 3 && r.every((x) => typeof x === "number")) model.f[k] = r;
      }
      ranked = null;
    }

    // Resumen legible de lo que ha aprendido (para «Tus gustos»)
    function summary(limit = 6) {
      const day = today();
      const items = Object.keys(model.f).map((k) => ({ k, ...affinity(k, day) })).filter((x) => x.n >= 0.5);
      const top = (type, sign) => items.filter((x) => x.k[0] === type && Math.sign(x.a) === sign)
        .sort((a, b) => sign * (b.a * Math.sqrt(b.n) - a.a * Math.sqrt(a.n)))
        .slice(0, limit).map((x) => x.k.slice(2));
      return { genres: top("g", 1), directors: top("d", 1), actors: top("a", 1), themes: top("k", 1), dislikes: top("g", -1), events: model.n };
    }

    return {
      features, learn, learnFeatures, score, rank, reasonText, summary,
      exportModel, importModel,
      get events() { return model.n; },
      onChange(fn) { changed = fn; },
      reset() { model = { v: 1, f: {}, n: 0 }; ranked = null; },
      TYPE_LABEL,
    };
  }

  window.createTaste = createTaste;
})();
