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

## Recomendador personal

`js/taste.js` es el motor de gustos de cada cuenta. Describe cada peli con rasgos (géneros, director, reparto, temas sacados de la sinopsis con TF-IDF, década y duración) y aprende de cada gesto: «La veré», «Ya la vi», «Paso», añadir a una lista, abrir la ficha, las estrellas de tus reseñas y la encuesta. La evidencia caduca con una vida media de 90 días. Con eso ordena Descubrir (con algo de exploración y variedad), el match de «Para ti» y la peli de la semana, y explica en cada carta por qué te la propone. El modelo se guarda en la cuenta (`tastes/{uid}`) y se ve en «Mi cuenta → Tus gustos».

## Cuentas y reseñas (Firebase)

Al abrir la app, lo primero es entrar o crear la cuenta, con correo y contraseña o con Google. Justo después se elige un nombre de usuario único y una foto. Las cuentas con correo tienen 24 horas para verificarlo: la app muestra la cuenta atrás y `.github/workflows/purge-unverified.yml` borra cada hora las que caducan (necesita el secreto `FIREBASE_SERVICE_ACCOUNT`, la clave JSON de una cuenta de servicio del proyecto). Desde «Mi cuenta» (botón de arriba a la derecha) cambia su nombre y su foto, su contraseña y su correo, y puede borrar la cuenta. Con la cuenta se publican reseñas (de 1 a 5 estrellas y un texto) que ve todo el mundo en la ficha de cada peli.

Límites de las cuentas (explicados en `terminos.html`, que hay que aceptar al crear la cuenta):
- Como mucho 2.000 cuentas (`MAX_USERS` en `js/cloud.js` y `maxUsers()` en `firestore.rules`). El plan gratis de Firebase da 1 GiB y 20.000 escrituras al día; una cuenta normal ocupa unos 250 KB (perfil con foto, gustos y unas reseñas con copia de la foto) y hace unas 30 escrituras en un día de uso, así que 2.000 cuentas caben con margen aunque una de cada cuatro entre a diario. `meta/stats` lleva la cuenta: las reglas solo dejan terminar un perfil nuevo si suma 1 sin pasar del límite. Con el límite lleno, la app avisa y ofrece el modo invitado.
- Las cuentas que llevan 3 meses sin usarse se borran con todos sus datos. Lo hace el mismo trabajo de cada hora, que además recuenta las cuentas.

- `js/cloud.js` usa Firebase Authentication y Cloud Firestore (SDK web 13.1.0 desde gstatic). Solo se carga si hay configuración.
- `js/firebase-config.js` guarda la configuración web del proyecto de Firebase. No es secreta. Si está vacía, la app funciona sin cuentas y cada reseña se queda en el móvil.
- `firestore.rules` son las reglas de la base de datos: las reseñas las lee cualquiera, pero solo su autor las escribe o borra; cada perfil solo lo ve su dueño.
- Las fotos de perfil se recortan y reducen en el móvil (192 px, unos 15 KB) y se guardan en Firestore. Así no hace falta Cloud Storage, que exige el plan de pago.

Para activarlo en la consola de Firebase (console.firebase.google.com):

1. Crea un proyecto y añade una app web. Copia el objeto `firebaseConfig` en `js/firebase-config.js` como `window.CINDER_FIREBASE = { ... };`.
2. En Authentication → Método de acceso, activa «Correo electrónico/contraseña» y «Google».
3. En Authentication → Configuración → Dominios autorizados, añade `ivanminguezdelabanda-source.github.io`.
4. En Firestore Database, crea la base de datos (modo producción) y pega el contenido de `firestore.rules` en la pestaña Reglas.

## IA en «Para ti» (opcional)

La carpeta `worker/` es un Cloudflare Worker que recibe la encuesta y las 40 mejores candidatas del recomendador local, y le pide a Claude (`claude-opus-5-5`) que elija las 8 mejores y explique por qué. La clave de Anthropic se guarda como secreto del Worker y nunca llega al navegador; el Worker solo acepta peticiones desde la web publicada.

Para activarla, añade estos secretos en GitHub (Settings → Secrets and variables → Actions):

- `ANTHROPIC_API_KEY`: clave de console.anthropic.com
- `CLOUDFLARE_API_TOKEN`: token de Cloudflare con la plantilla «Edit Cloudflare Workers»
- `CLOUDFLARE_ACCOUNT_ID`: el Account ID de tu cuenta de Cloudflare

El siguiente despliegue publica el Worker y escribe su dirección en `js/config.js`. Si falta algún secreto o la IA falla, «Para ti» usa el recomendador local.
