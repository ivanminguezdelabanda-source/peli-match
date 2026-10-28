// Servidor de Cinder (Cloudflare Worker):
// - POST /         IA de «Para ti»: recibe la encuesta y candidatas ya filtradas por la app, y Claude elige y explica.
//                  La clave de Anthropic vive como secreto del Worker (ANTHROPIC_API_KEY) y nunca llega al navegador.
// - /reviews       Reseñas públicas de cada peli, guardadas en Workers KV (binding REVIEWS).
import Anthropic from "@anthropic-ai/sdk";

const MAX_CANDIDATES = 40;
const MAX_PICKS = 8;

const SYSTEM = `Eres el recomendador de cine de Cinder, una app española para decidir qué película ver hoy.
Recibes las respuestas de una encuesta y una lista de películas candidatas (ya filtradas por duración, géneros a evitar y lo que la persona ya tiene guardado o ha descartado).
Elige las ${MAX_PICKS} candidatas que mejor encajan con esta persona hoy, ordenadas de mejor a peor, y explica cada elección.

Cómo elegir:
- Lo que escriba con sus propias palabras («nota») manda sobre todo lo demás.
- Las pelis favoritas dicen mucho de su gusto: tono, ritmo, temas, director, época. Busca afinidad real, no solo el mismo género.
- Ten en cuenta con quién la va a ver y lo que le apetece sentir.
- Si indicó plataformas, prefiere lo que puede ver ya, pero no descartes una joya por eso.
- Varía un poco: no devuelvas ocho pelis casi iguales.
- Elige solo ids de la lista de candidatas.

Cada motivo va en español de España, tuteando, en una frase corta (máximo 140 caracteres), concreto y sin spoilers. Habla de la peli y de por qué le va a gustar a esta persona, no de la encuesta.`;

const WEEKLY = `

Esta vez es la «peli de la semana»: devuelve una sola elección, la que más probabilidades tenga de encantarle según lo que ha guardado (le_gustaron_antes) y sus favoritas. El motivo puede tener hasta dos frases y debe mencionar alguna peli que guardó.`;

const SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["id", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["picks"],
  additionalProperties: false,
};

const clip = (v, n) => String(v ?? "").slice(0, n);
const list = (v, n, len = 60) => (Array.isArray(v) ? v.slice(0, n).map((x) => clip(x, len)) : []);

function describeMovie(m) {
  return {
    id: clip(m.id, 40),
    titulo: clip(m.title, 120),
    año: Number(m.year) || null,
    director: clip(m.director, 80),
    reparto: list(m.cast, 4, 60),
    generos: list(m.genres, 3, 30),
    minutos: Number(m.runtime) || null,
    nota_media: m.rating == null ? null : Number(m.rating),
    plataformas: list(m.providers, 6, 40),
    sinopsis: clip(m.desc, 300),
  };
}

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    ok,
    headers: {
      "Access-Control-Allow-Origin": ok ? origin : "null",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });

// ---------- Reseñas ----------
const MAX_REVIEWS_PER_MOVIE = 300;
const sha256 = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const publicReview = ({ tok, ...r }) => r;
const movieKey = (id) => `r:${id}`;

async function reviews(request, env, headers, url) {
  if (!env.REVIEWS) return json({ error: "no_storage" }, 503, headers);
  const movie = clip(url.searchParams.get("movie"), 40);
  if (!/^[\w-]{1,40}$/.test(movie)) return json({ error: "movie" }, 400, headers);
  const key = movieKey(movie);
  const list = (await env.REVIEWS.get(key, "json")) || [];

  if (request.method === "GET") {
    return json({ reviews: list.map(publicReview) }, 200, { ...headers, "Cache-Control": "no-store" });
  }

  // Límite sencillo contra spam: 5 escrituras por minuto y por IP
  const ip = request.headers.get("CF-Connecting-IP") || "?";
  const rlKey = `rl:${ip}`;
  const used = Number(await env.REVIEWS.get(rlKey)) || 0;
  if (used >= 5) return json({ error: "too_many" }, 429, headers);
  await env.REVIEWS.put(rlKey, String(used + 1), { expirationTtl: 60 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_json" }, 400, headers);
  }
  const token = clip(body.token, 80);
  if (token.length < 16) return json({ error: "token" }, 400, headers);
  const tok = await sha256(token);

  if (request.method === "DELETE") {
    const next = list.filter((r) => !(r.id === body.id && r.tok === tok));
    if (next.length === list.length) return json({ error: "not_found" }, 404, headers);
    await env.REVIEWS.put(key, JSON.stringify(next));
    return json({ ok: true }, 200, headers);
  }

  const stars = Math.round(Number(body.stars));
  const name = clip(String(body.name || "").trim(), 30) || "Anónimo";
  const text = clip(String(body.text || "").trim(), 600);
  if (!(stars >= 1 && stars <= 5)) return json({ error: "stars" }, 400, headers);
  // Una reseña por persona y peli: si ya tenía una, se sustituye
  const review = { id: crypto.randomUUID(), name, stars, text, at: Date.now(), tok };
  const next = [review, ...list.filter((r) => r.tok !== tok)].slice(0, MAX_REVIEWS_PER_MOVIE);
  await env.REVIEWS.put(key, JSON.stringify(next));
  return json({ review: publicReview(review) }, 201, headers);
}

export default {
  async fetch(request, env) {
    const { ok, headers } = cors(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: ok ? 204 : 403, headers });
    const url = new URL(request.url);
    if (url.pathname === "/reviews") {
      if (!ok) return json({ error: "origin" }, 403, headers);
      if (!["GET", "POST", "DELETE"].includes(request.method)) return json({ error: "method" }, 405, headers);
      return reviews(request, env, headers, url);
    }
    if (request.method === "GET") return json({ ok: true, ai: Boolean(env.ANTHROPIC_API_KEY), reviews: Boolean(env.REVIEWS) }, 200, headers);
    if (request.method !== "POST") return json({ error: "method" }, 405, headers);
    if (!ok) return json({ error: "origin" }, 403, headers);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "no_key" }, 503, headers);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad_json" }, 400, headers);
    }
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, MAX_CANDIDATES).map(describeMovie) : [];
    if (candidates.length < 2) return json({ error: "few_candidates" }, 400, headers);

    const p = body.profile || {};
    const encuesta = {
      con_quien: clip(p.company, 30) || null,
      quiere_sentir: list(p.moods, 8, 30),
      generos_favoritos: list(p.genres, 12, 30),
      evitar: list(p.avoid, 12, 30),
      tiempo: clip(p.time, 40),
      epoca: clip(p.era, 40),
      plataformas: list(p.platforms, 12, 40),
      nota: clip(p.note, 400) || null,
      pelis_favoritas: Array.isArray(body.favs) ? body.favs.slice(0, 3).map(describeMovie) : [],
      le_gustaron_antes: list(body.liked, 15, 120),
    };

    // «Peli de la semana»: una sola elección basada sobre todo en lo que ha guardado
    const weekly = body.task === "weekly";
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    let response;
    try {
      response = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: SCHEMA },
        },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `<encuesta>\n${JSON.stringify(encuesta)}\n</encuesta>\n\n<candidatas>\n${JSON.stringify(candidates)}\n</candidatas>${weekly ? WEEKLY : ""}`,
          },
        ],
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429, headers);
      if (err instanceof Anthropic.APIError) {
        console.error("Anthropic", err.status, err.message);
        return json({ error: "upstream", status: err.status ?? null }, 502, headers);
      }
      throw err;
    }

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      return json({ error: response.stop_reason }, 502, headers);
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let picks;
    try {
      picks = JSON.parse(text).picks;
    } catch {
      return json({ error: "bad_output" }, 502, headers);
    }
    const valid = new Set(candidates.map((c) => c.id));
    const seen = new Set();
    picks = picks
      .filter((x) => valid.has(x.id) && !seen.has(x.id) && seen.add(x.id))
      .slice(0, weekly ? 1 : MAX_PICKS)
      .map((x) => ({ id: x.id, reason: clip(x.reason, weekly ? 320 : 200) }));
    return json({ picks, model: response.model }, 200, headers);
  },
};
