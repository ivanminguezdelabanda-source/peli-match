function startApp(MOVIES) {
  "use strict";

  const byId = Object.fromEntries(MOVIES.map((m) => [m.id, m]));

  // ---------- Persistencia local (en la app móvil se cambiaría por almacenamiento nativo) ----------
  const KEY = "pelimatch:v1";
  const store = {
    load() {
      try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) { /* sin almacenamiento */ }
      return null;
    },
    save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* idem */ } },
  };

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const state = {
    order: [],    // orden del mazo
    library: [],  // [{ id, at, watched }] el más reciente al final
    passed: [],   // ids descartados
    history: [],  // [{ id, action }] para deshacer
  };
  Object.assign(state, store.load() || {});
  const known = state.order.filter((id) => byId[id]);
  const fresh = MOVIES.map((m) => m.id).filter((id) => !known.includes(id));
  state.order = fresh.length ? [...known, ...shuffle(fresh)] : known;
  state.library = state.library.filter((l) => byId[l.id]);
  state.passed = state.passed.filter((id) => byId[id]);
  const persist = () => store.save(state);
  persist();

  const inLibrary = (id) => state.library.some((l) => l.id === id);
  const entry = (id) => state.library.find((l) => l.id === id);
  let mood = "Todo";
  const matchesMood = (m) => mood === "Todo" || m.genres.includes(mood);
  const queue = () => state.order.filter((id) => !inLibrary(id) && !state.passed.includes(id) && matchesMood(byId[id]));

  // ---------- Utilidades ----------
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtTime = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min` : `${min} min`);
  const shortTime = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}`;
  const trailerUrl = (m) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${m.title} ${m.year} tráiler español`)}`;
  const whereUrl = (m) => m.providersLink || `https://www.justwatch.com/es/buscar?q=${encodeURIComponent(m.title)}`;
  const genresOf = (list) => {
    const count = {};
    list.forEach((m) => m.genres.forEach((g) => (count[g] = (count[g] || 0) + 1)));
    return Object.keys(count).sort((a, b) => count[b] - count[a]);
  };

  // Póster: imagen de TMDB si existe (m.poster); si no, un cartel tipográfico
  function poster(m) {
    const wrap = el("div", "poster");
    wrap.style.setProperty("--c1", m.c[0]);
    wrap.style.setProperty("--c2", m.c[1]);
    const len = m.title.length;
    const size = len > 30 ? " xlong" : len > 14 ? " long" : "";
    wrap.append(el("div", "poster-art", `
      <div>
        <div class="poster-credit">Una película de ${esc(m.director)}</div>
        <div class="poster-title${size}">${esc(m.title)}</div>
      </div>
      <div class="poster-year">${m.year}</div>`));
    if (m.poster) {
      const img = new Image();
      img.alt = "";
      img.draggable = false;
      img.onload = () => wrap.append(img);
      img.src = m.poster;
    }
    return wrap;
  }

  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    tv: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v17l-7-4-7 4z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  // ---------- Filtro de humor (Descubrir) ----------
  const MOODS = ["Todo", ...genresOf(MOVIES).slice(0, 12)];
  function renderMoods() {
    const box = $("#moods");
    box.replaceChildren();
    MOODS.forEach((g) => {
      const b = el("button", "filter", esc(g));
      b.type = "button";
      b.setAttribute("aria-pressed", String(g === mood));
      b.onclick = () => { mood = g; renderMoods(); deckEl.replaceChildren(); renderDeck(); };
      box.append(b);
    });
  }

  // ---------- Mazo ----------
  const deckEl = $("#deck");
  const DEPTH = 3;
  const topCard = () => deckEl.querySelector('.card[data-depth="0"]');

  function cardFor(m) {
    const c = el("div", "card");
    c.dataset.id = m.id;
    c.setAttribute("role", "group");
    c.setAttribute("aria-label", `${m.title}, ${m.year}, de ${m.director}`);
    c.append(poster(m));
    c.append(el("span", "stamp stamp-like", "LA VERÉ"));
    c.append(el("span", "stamp stamp-nope", "PASO"));
    c.append(el("div", "card-info", `
      <p class="card-meta">${m.year} · ${fmtTime(m.runtime)}</p>
      <h2 class="card-title">${esc(m.title)}</h2>
      <p class="card-desc">${esc(m.desc)}</p>
      <ul class="chips">${m.genres.map((g) => `<li class="chip">${esc(g)}</li>`).join("")}</ul>`));
    return c;
  }

  function renderDeck() {
    const ids = queue().slice(0, DEPTH);
    const existing = new Map([...deckEl.children].map((n) => [n.dataset.id, n]));
    const leaving = [...deckEl.children].filter((n) => n.dataset.leaving);
    deckEl.replaceChildren();
    ids.slice().reverse().forEach((id) => {
      const card = existing.get(id) || cardFor(byId[id]);
      card.style.transform = "";
      card.style.opacity = "";
      card.querySelectorAll(".stamp").forEach((s) => (s.style.opacity = 0));
      card.dataset.depth = ids.indexOf(id);
      deckEl.append(card);
    });
    deckEl.append(...leaving);
    const empty = ids.length === 0;
    $("#deck-empty").hidden = !empty;
    deckEl.hidden = empty;
    $("#deck-empty-text").textContent = mood === "Todo"
      ? "Ya has visto todas. Gira la ruleta con tu biblioteca o vuelve a ver las que descartaste."
      : `No quedan pelis de ${mood.toLowerCase()}. Prueba con otro género o vuelve a ver las descartadas.`;
    $("#btn-nope").disabled = $("#btn-like").disabled = $("#btn-info").disabled = empty;
    $("#btn-undo").disabled = state.history.length === 0;
    $("#reset-passed").hidden = state.passed.length === 0;
    if (topCard()) bindDrag(topCard());
  }

  function decide(action, card = topCard()) {
    if (!card || card.dataset.leaving) return;
    card.dataset.leaving = "1";
    card.dataset.depth = "out";
    const id = card.dataset.id;
    const dir = action === "like" ? 1 : -1;
    const cur = card._drag || { dx: 0, dy: 0 };
    card.classList.remove("dragging");
    card.style.transform = `translate(${dir * deckEl.clientWidth * 1.6}px, ${cur.dy + 40}px) rotate(${dir * 28}deg)`;
    card.style.opacity = "0";
    card.querySelector(dir > 0 ? ".stamp-like" : ".stamp-nope").style.opacity = 1;

    if (action === "like") {
      state.library.push({ id, at: Date.now(), watched: false });
      bumpCount();
    } else {
      state.passed.push(id);
    }
    state.history = [...state.history, { id, action }].slice(-30);
    persist();
    const next = queue().slice(0, DEPTH);
    [...deckEl.children].forEach((n) => {
      if (n !== card && next.includes(n.dataset.id)) n.dataset.depth = next.indexOf(n.dataset.id);
    });
    if (topCard()) bindDrag(topCard());
    setTimeout(() => { card.remove(); renderDeck(); }, 320);
  }

  function undo() {
    const last = state.history.pop();
    if (!last) return;
    if (last.action === "like") state.library = state.library.filter((l) => l.id !== last.id);
    else state.passed = state.passed.filter((id) => id !== last.id);
    state.order = [last.id, ...state.order.filter((id) => id !== last.id)];
    persist();
    renderDeck();
    updateCount();
  }

  function bindDrag(card) {
    if (card._bound) return;
    card._bound = true;
    const like = card.querySelector(".stamp-like");
    const nope = card.querySelector(".stamp-nope");
    let start = null;
    card.addEventListener("pointerdown", (e) => {
      if (card.dataset.depth !== "0" || card.dataset.leaving) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now() };
      card._drag = { dx: 0, dy: 0 };
      card.setPointerCapture(e.pointerId);
      card.classList.add("dragging");
    });
    card.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      card._drag = { dx, dy };
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx * 0.06}deg)`;
      like.style.opacity = Math.max(0, Math.min(1, dx / 90));
      nope.style.opacity = Math.max(0, Math.min(1, -dx / 90));
    });
    const end = () => {
      if (!start) return;
      const { dx, dy } = card._drag;
      const dt = performance.now() - start.t;
      start = null;
      const fast = Math.abs(dx) / dt > 0.6 && Math.abs(dx) > 40;
      if (Math.abs(dx) > deckEl.clientWidth * 0.3 || fast) {
        decide(dx > 0 ? "like" : "pass", card);
      } else {
        card.classList.remove("dragging");
        card.style.transform = "";
        like.style.opacity = nope.style.opacity = 0;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) openSheet(card.dataset.id, "deck");
      }
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
  }

  // ---------- Contador ----------
  const countEl = $("#saved-count");
  function updateCount() {
    const n = state.library.filter((l) => !l.watched).length;
    countEl.textContent = n;
    countEl.hidden = n === 0;
  }
  function bumpCount() {
    updateCount();
    countEl.classList.remove("bump");
    void countEl.offsetWidth;
    countEl.classList.add("bump");
  }

  // ---------- Biblioteca ----------
  let showWatched = false;
  let libGenre = "Todos";

  function tileFor(m, from) {
    const li = el("li", "tile" + (entry(m.id)?.watched ? " watched" : ""));
    const btn = el("button", "tile-btn");
    btn.type = "button";
    btn.setAttribute("aria-label", `Ver ficha de ${m.title}`);
    btn.append(poster(m));
    btn.onclick = () => openSheet(m.id, from);
    li.append(btn);
    li.append(el("p", "tile-name", esc(m.title)));
    li.append(el("p", "tile-meta", `${m.year} · ${shortTime(m.runtime)}`));
    return li;
  }

  function chipRow(box, options, current, onPick) {
    box.replaceChildren();
    options.forEach((o) => {
      const b = el("button", "filter", esc(o));
      b.type = "button";
      b.setAttribute("aria-pressed", String(o === current));
      b.onclick = () => onPick(o);
      box.append(b);
    });
  }

  function renderLibrary() {
    const pending = state.library.filter((l) => !l.watched);
    const watched = state.library.filter((l) => l.watched);
    $("#n-pending").textContent = pending.length;
    $("#n-watched").textContent = watched.length;
    $("#seg-pending").setAttribute("aria-selected", String(!showWatched));
    $("#seg-watched").setAttribute("aria-selected", String(showWatched));

    const items = (showWatched ? watched : pending).slice().reverse().map((l) => byId[l.id]);
    const genres = genresOf(items);
    if (libGenre !== "Todos" && !genres.includes(libGenre)) libGenre = "Todos";
    const filters = $("#lib-filters");
    filters.hidden = items.length < 2;
    chipRow(filters, ["Todos", ...genres], libGenre, (g) => { libGenre = g; renderLibrary(); });

    const grid = $("#lib-grid");
    grid.replaceChildren();
    items.filter((m) => libGenre === "Todos" || m.genres.includes(libGenre)).forEach((m) => grid.append(tileFor(m, "library")));

    const empty = items.length === 0;
    $("#lib-empty").hidden = !empty;
    if (empty) {
      $("#lib-empty-title").textContent = showWatched ? "Aún no has marcado ninguna" : "Nada pendiente";
      $("#lib-empty-text").textContent = showWatched
        ? "Cuando veas una peli de tu biblioteca, márcala como vista desde su ficha."
        : "Desliza a la derecha las pelis que te apetezca ver y aparecerán aquí.";
      $("#lib-empty-cta").hidden = showWatched;
    }
  }
  $("#seg-pending").onclick = () => { showWatched = false; renderLibrary(); };
  $("#seg-watched").onclick = () => { showWatched = true; renderLibrary(); };

  // ---------- Ruleta ----------
  const TIMES = [
    { label: "Sin prisa", max: Infinity },
    { label: "Menos de 2h 30", max: 150 },
    { label: "Menos de 2 h", max: 120 },
    { label: "Menos de 1h 45", max: 105 },
  ];
  let wheelGenre = "Todas";
  let wheelTime = TIMES[0];
  let wheelProvider = "Cualquier sitio";
  let wheelItems = [];
  let wheelAngle = 0;
  let spinning = false;
  const MAX_SLICES = 12;
  const SLICE_COLORS = ["#e0414b", "#f2d39b", "#2d2423", "#9a2b33", "#d9b77a", "#3d3130"];
  const SLICE_TEXT = ["#fff", "#14100f", "#f6ece0", "#fff", "#14100f", "#f6ece0"];

  function wheelPool() {
    return state.library
      .filter((l) => !l.watched)
      .map((l) => byId[l.id])
      .filter((m) => (wheelGenre === "Todas" || m.genres.includes(wheelGenre)) && m.runtime <= wheelTime.max)
      .filter((m) => wheelProvider === "Cualquier sitio" || (m.providers || []).includes(wheelProvider));
  }

  function renderWheel() {
    const pendingMovies = state.library.filter((l) => !l.watched).map((l) => byId[l.id]);
    const genres = genresOf(pendingMovies);
    if (wheelGenre !== "Todas" && !genres.includes(wheelGenre)) wheelGenre = "Todas";
    chipRow($("#wheel-genres"), ["Todas", ...genres], wheelGenre, (g) => { wheelGenre = g; $("#wheel-result").hidden = true; renderWheel(); });
    chipRow($("#wheel-time"), TIMES.map((t) => t.label), wheelTime.label, (label) => {
      wheelTime = TIMES.find((t) => t.label === label);
      $("#wheel-result").hidden = true;
      renderWheel();
    });

    const providers = [...new Set(pendingMovies.flatMap((m) => m.providers || []))].sort();
    if (!providers.includes(wheelProvider)) wheelProvider = "Cualquier sitio";
    const provBox = $("#wheel-providers");
    provBox.hidden = providers.length === 0;
    chipRow(provBox, ["Cualquier sitio", ...providers], wheelProvider, (p) => { wheelProvider = p; $("#wheel-result").hidden = true; renderWheel(); });

    const tooFew = pendingMovies.length < 2;
    $("#wheel-empty").hidden = !tooFew;
    $(".wheel-filters").hidden = tooFew;
    $("#wheel-wrap").hidden = tooFew;
    $("#wheel-note").hidden = tooFew;
    if (tooFew) { $("#wheel-result").hidden = true; return; }

    const pool = wheelPool();
    wheelItems = pool.length > MAX_SLICES ? shuffle(pool).slice(0, MAX_SLICES) : pool;
    $("#wheel-spin").disabled = pool.length === 0;
    $("#wheel-note").textContent = pool.length === 0
      ? "Ninguna peli de tu biblioteca encaja con estos filtros."
      : pool.length > MAX_SLICES
        ? `${pool.length} pelis encajan; en la ruleta entran ${MAX_SLICES} al azar cada vez.`
        : `${pool.length} ${pool.length === 1 ? "peli encaja" : "pelis encajan"} con tus filtros.`;
    drawWheel();
  }

  function drawWheel() {
    const canvas = $("#wheel");
    const size = canvas.clientWidth || 340;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(wheelAngle);
    const n = Math.max(wheelItems.length, 1);
    const step = (Math.PI * 2) / n;
    for (let i = 0; i < n; i++) {
      const m = wheelItems[i];
      const ci = n % SLICE_COLORS.length === 1 && i === n - 1 ? 2 : i % SLICE_COLORS.length;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r - 4, i * step - Math.PI / 2, (i + 1) * step - Math.PI / 2);
      ctx.closePath();
      ctx.fillStyle = m ? SLICE_COLORS[ci] : "#2d2423";
      ctx.fill();
      ctx.strokeStyle = "#14100f";
      ctx.lineWidth = 2;
      ctx.stroke();
      if (!m) continue;
      ctx.save();
      ctx.rotate(i * step + step / 2 - Math.PI / 2);
      ctx.fillStyle = SLICE_TEXT[ci];
      ctx.font = `700 ${n > 8 ? 11 : 13}px Figtree, system-ui, sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const maxW = r * 0.62;
      let label = m.title;
      while (ctx.measureText(label).width > maxW && label.length > 4) label = label.slice(0, -2);
      if (label !== m.title) label = label.trimEnd() + "…";
      ctx.fillText(label, r - 16, 0);
      ctx.restore();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(r, r, r - 3, 0, Math.PI * 2);
    ctx.strokeStyle = "#f2d39b";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function spin() {
    if (spinning || wheelItems.length === 0) return;
    spinning = true;
    $("#wheel-spin").disabled = true;
    $("#wheel-result").hidden = true;
    const n = wheelItems.length;
    const step = (Math.PI * 2) / n;
    const winner = Math.floor(Math.random() * n);
    // El puntero está arriba: el centro del gajo ganador tiene que acabar en ángulo 0
    const jitter = (Math.random() - 0.5) * step * 0.6;
    const target = -(winner * step + step / 2) + jitter;
    const base = wheelAngle - (wheelAngle % (Math.PI * 2));
    const end = base + Math.PI * 2 * 6 + ((target - base) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const from = wheelAngle;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 1 : 4200;
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 4);
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      wheelAngle = from + (end - from) * ease(t);
      drawWheel();
      if (t < 1) return requestAnimationFrame(frame);
      wheelAngle %= Math.PI * 2;
      spinning = false;
      $("#wheel-spin").disabled = false;
      showResult(wheelItems[winner]);
    };
    requestAnimationFrame(frame);
  }

  function showResult(m) {
    const box = $("#wheel-result");
    box.replaceChildren();
    const btn = el("button", "tile-btn");
    btn.type = "button";
    btn.setAttribute("aria-label", `Ver ficha de ${m.title}`);
    btn.append(poster(m));
    btn.onclick = () => openSheet(m.id, "wheel");
    const body = el("div", "result-body", `
      <div>
        <p class="result-label">Esta noche toca</p>
        <p class="result-title">${esc(m.title)}</p>
        <p class="tile-meta">${m.year} · ${fmtTime(m.runtime)} · ${esc(m.genres.join(", "))}</p>
      </div>`);
    const actions = el("div", "result-actions");
    const where = el("a", "btn btn-solid", `${ICON.tv} Dónde verla`);
    where.href = whereUrl(m);
    where.target = "_blank";
    where.rel = "noopener";
    const again = el("button", "btn btn-ghost", "Otra vez");
    again.type = "button";
    again.onclick = spin;
    actions.append(where, again);
    body.append(actions);
    box.append(btn, body);
    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  $("#wheel-spin").onclick = spin;
  window.addEventListener("resize", () => { if (!$("#view-ruleta").hidden) drawWheel(); });

  // ---------- Ficha ----------
  const sheet = $("#sheet");
  const backdrop = $("#sheet-backdrop");
  let lastFocus = null;

  function openSheet(id, from) {
    const m = byId[id];
    const e = entry(id);
    lastFocus = document.activeElement;
    const body = $("#sheet-body");
    body.replaceChildren();

    const top = el("div", "sheet-top");
    const pst = el("div", "sheet-poster");
    pst.append(poster(m));
    top.append(pst, el("div", "", `
      <h2 class="sheet-title" id="sheet-title">${esc(m.title)}</h2>
      ${m.original !== m.title ? `<p class="sheet-original">${esc(m.original)}</p>` : ""}`));
    body.append(top);

    const content = el("div", "sheet-content", `
      <dl class="facts">
        <div class="fact"><dt>Año</dt><dd>${m.year}</dd></div>
        <div class="fact"><dt>Duración</dt><dd>${fmtTime(m.runtime)}</dd></div>
        <div class="fact"><dt>${m.rating != null ? "Nota" : "Género"}</dt><dd>${m.rating != null ? m.rating.toFixed(1) : esc(m.genres[0])}</dd></div>
      </dl>
      <p class="sheet-desc">${esc(m.desc)}</p>
      <div>
        <p class="section-label">Dirección</p>
        <p style="margin:0;font-weight:700">${esc(m.director)}</p>
      </div>
      ${m.cast && m.cast.length ? `<div><p class="section-label">Reparto</p><p style="margin:0">${esc(m.cast.join(", "))}</p></div>` : ""}
      ${m.providers
        ? `<div><p class="section-label">En streaming en España</p>${m.providers.length
            ? `<ul class="chips">${m.providers.map((p) => `<li class="chip chip-provider">${esc(p)}</li>`).join("")}</ul>`
            : `<p style="margin:0;color:var(--muted)">No está en ninguna plataforma de suscripción ahora mismo.</p>`}</div>`
        : ""}
      <div>
        <p class="section-label">Géneros</p>
        <ul class="chips">${m.genres.map((g) => `<li class="chip">${esc(g)}</li>`).join("")}</ul>
      </div>
      <div class="links">
        <a class="link-card" href="${m.trailer || trailerUrl(m)}" target="_blank" rel="noopener">
          <span class="link-icon play">${ICON.play}</span>
          <span class="link-text"><b>Tráiler</b><span>En YouTube</span></span>
        </a>
        <a class="link-card" href="${whereUrl(m)}" target="_blank" rel="noopener">
          <span class="link-icon where">${ICON.tv}</span>
          <span class="link-text"><b>Dónde verla</b><span>Plataformas en España</span></span>
        </a>
      </div>
      <div class="sheet-actions" id="sheet-actions"></div>
      ${m.tmdb ? `<p class="credit">Datos e imágenes de TMDB. Plataformas: JustWatch.</p>` : ""}`);
    body.append(content);

    const actions = content.querySelector("#sheet-actions");
    const button = (cls, html, fn) => {
      const b = el("button", cls, html);
      b.type = "button";
      b.onclick = () => { closeSheet(); fn(); };
      return b;
    };
    if (from === "deck" && !e) {
      actions.append(
        button("btn btn-ghost", `${ICON.x} Paso`, () => decide("pass")),
        button("btn btn-solid", `${ICON.save} La quiero ver`, () => decide("like")),
      );
    } else if (e) {
      actions.append(
        e.watched
          ? button("btn btn-ghost", "Marcar como no vista", () => setWatched(id, false))
          : button("btn btn-solid", `${ICON.check} Ya la he visto`, () => setWatched(id, true)),
        button("btn btn-danger", "Quitar de la biblioteca", () => removeFromLibrary(id)),
      );
    }

    sheet.hidden = backdrop.hidden = false;
    sheet.scrollTop = 0;
    $("#sheet-close").focus();
  }

  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = backdrop.hidden = true;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  function refreshViews() {
    updateCount();
    if (!$("#view-biblioteca").hidden) renderLibrary();
    if (!$("#view-ruleta").hidden) { $("#wheel-result").hidden = true; renderWheel(); }
  }

  function setWatched(id, watched) {
    const e = entry(id);
    if (!e) return;
    e.watched = watched;
    persist();
    refreshViews();
    toast(watched ? `Vista: ${byId[id].title}` : `Pendiente otra vez: ${byId[id].title}`);
  }

  function removeFromLibrary(id) {
    const idx = state.library.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const [removed] = state.library.splice(idx, 1);
    state.passed.push(id);
    state.history = state.history.filter((h) => h.id !== id);
    persist();
    refreshViews();
    toast(`Quitada: ${byId[id].title}`, "Deshacer", () => {
      state.passed = state.passed.filter((x) => x !== id);
      state.library.splice(idx, 0, removed);
      persist();
      refreshViews();
    });
  }

  // ---------- Aviso ----------
  let toastTimer;
  function toast(msg, actionLabel, onAction) {
    const t = $("#toast");
    t.replaceChildren(el("span", "", esc(msg)));
    if (actionLabel) {
      const b = el("button", "", esc(actionLabel));
      b.type = "button";
      b.onclick = () => { t.hidden = true; onAction(); };
      t.append(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 4000);
  }

  // ---------- Navegación (#descubrir, #biblioteca, #ruleta) ----------
  const VIEWS = ["descubrir", "biblioteca", "ruleta"];
  function route() {
    const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "descubrir";
    closeSheet();
    VIEWS.forEach((v) => ($("#view-" + v).hidden = v !== view));
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t.dataset.view === view;
      t.classList.toggle("active", on);
      if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    if (view === "biblioteca") renderLibrary();
    else if (view === "ruleta") { $("#wheel-result").hidden = true; renderWheel(); }
    else renderDeck();
  }

  // ---------- Eventos ----------
  $("#btn-like").onclick = () => decide("like");
  $("#btn-nope").onclick = () => decide("pass");
  $("#btn-undo").onclick = undo;
  $("#btn-info").onclick = () => { const c = topCard(); if (c) openSheet(c.dataset.id, "deck"); };
  $("#reset-passed").onclick = () => {
    state.passed = [];
    state.history = state.history.filter((h) => h.action !== "pass");
    state.order = shuffle(state.order);
    persist();
    renderDeck();
  };
  $("#sheet-close").onclick = closeSheet;
  backdrop.onclick = closeSheet;

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return closeSheet();
    if (!sheet.hidden || $("#view-descubrir").hidden || e.target.closest("input, textarea")) return;
    if (e.key === "ArrowRight") decide("like");
    else if (e.key === "ArrowLeft") decide("pass");
    else if (e.key === "ArrowUp") $("#btn-info").click();
    else if (e.key.toLowerCase() === "z") undo();
  });

  window.addEventListener("hashchange", route);
  renderMoods();
  updateCount();
  route();
}

// Carga las pelis de TMDB (data/movies.json, generado por scripts/sync-tmdb.mjs).
// Si no existe o no hay red, usa la selección local de js/movies.js.
(async () => {
  let movies = window.MOVIES;
  try {
    const res = await fetch("data/movies.json", { cache: "no-cache" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.movies) && data.movies.length) movies = data.movies;
    }
  } catch (e) { /* abierto como archivo o sin red */ }
  startApp(movies);
})();
