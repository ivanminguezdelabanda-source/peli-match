# Cinder

App para descubrir películas y decidir cuál ver. Desliza pósters: a la derecha van a tu biblioteca. Si sigues sin decidirte, gira la ruleta.

## Cómo funciona

- `index.html`, `styles.css` y `js/app.js` forman la web. No hace falta instalar ni compilar nada.
- `js/movies.js` es una selección de unas 140 películas. Se usa si todavía no hay datos de TMDB.
- `scripts/sync-tmdb.mjs` descarga de TMDB las películas más populares y las mejor valoradas y genera `data/movies.json`. Para cada una guarda sinopsis en español, póster, nota, director, reparto, tráiler y plataformas de streaming en España.
- `.github/workflows/sync-and-deploy.yml` ejecuta la descarga cada día y publica la web en GitHub Pages. Necesita el secreto `TMDB_API_KEY` en el repositorio.

## Ejecutarlo en local

```bash
TMDB_API_KEY=tu_clave node scripts/sync-tmdb.mjs   # Node 20+
npx serve .
```

## Datos guardados

La biblioteca se guarda en el `localStorage` del navegador, con la clave `pelimatch:v1`.

Este producto usa la API de TMDB, pero no está respaldado ni certificado por TMDB. Los datos de plataformas vienen de JustWatch.

## IA en «Para ti» (opcional)

La carpeta `worker/` es un Cloudflare Worker que recibe la encuesta y las 40 mejores candidatas del recomendador local, y le pide a Claude (`claude-opus-5-5`) que elija las 8 mejores y explique por qué. La clave de Anthropic se guarda como secreto del Worker y nunca llega al navegador; el Worker solo acepta peticiones desde la web publicada.

Para activarla, añade estos secretos en GitHub (Settings → Secrets and variables → Actions):

- `ANTHROPIC_API_KEY`: clave de console.anthropic.com
- `CLOUDFLARE_API_TOKEN`: token de Cloudflare con la plantilla «Edit Cloudflare Workers»
- `CLOUDFLARE_ACCOUNT_ID`: el Account ID de tu cuenta de Cloudflare

El siguiente despliegue publica el Worker y escribe su dirección en `js/config.js`. Si falta algún secreto o la IA falla, «Para ti» usa el recomendador local.
