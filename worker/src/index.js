// Peli Match IA: recibe la encuesta «Para ti» y una lista de candidatas ya filtradas
// por la app, y pide a Claude que elija y explique las mejores para esta persona.
// La clave de Anthropic vive como secreto del Worker (ANTHROPIC_API_KEY) y nunca llega al navegador.
import Anthropic from "@anthropic-ai/sdk";

const MAX_CANDIDATES = 40;
const MAX_PICKS = 8;

const SYSTEM = `Eres el recomendador de cine de Peli Match, una app española para decidir qué película ver hoy.
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });

export default {
  async fetch(request, env) {
    const { ok, headers } = cors(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: ok ? 204 : 403, headers });
    if (request.method === "GET") return json({ ok: true }, 200, headers);
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
            content: `<encuesta>\n${JSON.stringify(encuesta)}\n</encuesta>\n\n<candidatas>\n${JSON.stringify(candidates)}\n</candidatas>`,
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
      .slice(0, MAX_PICKS)
      .map((x) => ({ id: x.id, reason: clip(x.reason, 200) }));
    return json({ picks, model: response.model }, 200, headers);
  },
};
