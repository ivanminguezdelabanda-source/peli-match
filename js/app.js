function startApp(MOVIES) {
  "use strict";

  const byId = Object.fromEntries(MOVIES.map((m) => [m.id, m]));

  // ---------- Persistencia local (en la app móvil se cambiaría por almacenamiento nativo) ----------
  const KEY = "pelimatch:v1";
  // Modo pruebas: cada recarga empieza de cero (bienvenida y encuesta). Poner a false para guardar entre visitas.
  const RESET_ON_LOAD = true;
  if (RESET_ON_LOAD) { try { localStorage.removeItem(KEY); } catch (e) { /* sin almacenamiento */ } }
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
    profile: null, // respuestas de la encuesta «Para ti»
    history: [],  // [{ id, action }] para deshacer
    lists: [],    // [{ id, name, ids }] bibliotecas propias, independientes de los matches
    weekly: null, // { week, id, reason, ai } peli de la semana
  };
  Object.assign(state, store.load() || {});
  const known = state.order.filter((id) => byId[id]);
  const fresh = MOVIES.map((m) => m.id).filter((id) => !known.includes(id));
  state.order = fresh.length ? [...known, ...shuffle(fresh)] : known;
  state.library = state.library.filter((l) => byId[l.id]);
  state.passed = state.passed.filter((id) => byId[id]);
  state.lists = (state.lists || []).map((l) => ({ ...l, ids: l.ids.filter((id) => byId[id]) }));
  const persist = () => store.save(state);
  persist();

  const inLibrary = (id) => state.library.some((l) => l.id === id);
  const entry = (id) => state.library.find((l) => l.id === id);
  const FOR_YOU = "✨ Para ti";
  let mood = "Todo";
  const matchesMood = (m) => mood === "Todo" || mood === FOR_YOU || m.genres.includes(mood);
  const queue = () => (mood === FOR_YOU ? forYou : state.order)
    .filter((id) => !inLibrary(id) && !state.passed.includes(id) && matchesMood(byId[id]));

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
      // Mientras carga se ve un fondo neutro; el cartel tipográfico solo si la imagen falla
      wrap.classList.add("loading");
      img.onload = () => { wrap.append(img); wrap.classList.remove("loading"); };
      img.onerror = () => wrap.classList.remove("loading");
      img.src = m.poster;
      if (img.complete && img.naturalWidth) img.onload(); // ya estaba en caché
    }
    return wrap;
  }

  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    tv: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v17l-7-4-7 4z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  };

  // ---------- Filtro de humor (Descubrir) ----------
  const MOODS = ["Todo", ...genresOf(MOVIES).slice(0, 12)];
  function renderMoods() {
    const box = $("#moods");
    box.replaceChildren();
    (state.profile ? [FOR_YOU, ...MOODS] : MOODS).forEach((g) => {
      const b = el("button", "filter", esc(g));
      b.type = "button";
      b.setAttribute("aria-pressed", String(g === mood));
      b.onclick = () => {
        mood = g;
        if (g === FOR_YOU && !forYou.length) runMatch();
        renderMoods();
        deckEl.replaceChildren();
        renderDeck();
      };
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
    c.append(el("span", "stamp stamp-seen", "YA LA VI"));
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
      ? "Ya has visto todas. Abre la caja con tu biblioteca o vuelve a ver las que descartaste."
      : mood === FOR_YOU
        ? "Ya has visto toda tu selección. Repite la encuesta en «Para ti» para conseguir más."
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
    card.style.transform = action === "seen"
      ? `translate(${cur.dx}px, ${-deckEl.clientHeight * 1.4}px)`
      : `translate(${dir * deckEl.clientWidth * 1.6}px, ${cur.dy + 40}px) rotate(${dir * 28}deg)`;
    card.style.opacity = "0";
    card.querySelector(action === "seen" ? ".stamp-seen" : dir > 0 ? ".stamp-like" : ".stamp-nope").style.opacity = 1;

    if (action === "like") {
      state.library.push({ id, at: Date.now(), watched: false });
      bumpCount();
    } else if (action === "seen") {
      // deslizar hacia arriba: ya la he visto, va a Matches → Vistas
      state.library.push({ id, at: Date.now(), watched: true });
      toast(`A «Vistas»: ${byId[id].title}`);
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
    if (last.action === "like" || last.action === "seen") state.library = state.library.filter((l) => l.id !== last.id);
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
    const seen = card.querySelector(".stamp-seen");
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
      const up = -dy > Math.abs(dx) ? -dy : 0;
      like.style.opacity = up ? 0 : Math.max(0, Math.min(1, dx / 90));
      nope.style.opacity = up ? 0 : Math.max(0, Math.min(1, -dx / 90));
      seen.style.opacity = Math.max(0, Math.min(1, up / 90));
    });
    const end = () => {
      if (!start) return;
      const { dx, dy } = card._drag;
      const dt = performance.now() - start.t;
      start = null;
      const fast = Math.abs(dx) / dt > 0.6 && Math.abs(dx) > 40;
      const upward = -dy > Math.abs(dx) && (-dy > deckEl.clientHeight * 0.22 || (-dy / dt > 0.6 && -dy > 50));
      if (upward) {
        decide("seen", card);
      } else if (Math.abs(dx) > deckEl.clientWidth * 0.3 || fast) {
        decide(dx > 0 ? "like" : "pass", card);
      } else {
        card.classList.remove("dragging");
        card.style.transform = "";
        like.style.opacity = nope.style.opacity = seen.style.opacity = 0;
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
  let libList = null; // id de la lista abierta, o null = toda la biblioteca
  const listById = (id) => state.lists.find((l) => l.id === id);

  // Campo en línea para poner nombre a una lista (sin ventanas emergentes)
  function nameEditor(box, initial, saveLabel, onSave, onCancel) {
    box.replaceChildren();
    const form = el("form", "name-editor");
    const input = el("input", "q-search");
    input.type = "text";
    input.maxLength = 40;
    input.placeholder = "Nombre de la lista";
    input.setAttribute("aria-label", "Nombre de la lista");
    input.value = initial;
    const ok = el("button", "btn btn-solid", esc(saveLabel));
    ok.type = "submit";
    const cancel = el("button", "btn btn-ghost", "Cancelar");
    cancel.type = "button";
    cancel.onclick = onCancel;
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const name = input.value.trim();
      if (name) onSave(name); else input.focus();
    };
    form.append(input, ok, cancel);
    box.append(form);
    input.focus();
  }

  function createList(name) {
    const list = { id: "l" + Date.now().toString(36), name, ids: [] };
    state.lists.push(list);
    persist();
    return list;
  }

  function toggleInList(listId, movieId) {
    const list = listById(listId);
    if (!list) return;
    if (list.ids.includes(movieId)) {
      list.ids = list.ids.filter((x) => x !== movieId);
      toast(`Quitada de «${list.name}»`);
    } else {
      list.ids.push(movieId);
      toast(`Añadida a «${list.name}»`);
    }
    persist();
    refreshViews();
  }

  let libSection = "matches"; // "matches" | "lists"
  function renderCustom() {
    const head = $("#custom-head"), tools = $("#lib-list-tools"), cards = $("#list-cards"), grid = $("#list-grid");
    head.replaceChildren(); tools.replaceChildren(); cards.replaceChildren(); grid.replaceChildren();
    const list = listById(libList);
    if (!list) {
      head.append(el("h1", "page-title", "Mis listas"));
      state.lists.forEach((l) => {
        const li = el("li");
        const b = el("button", "list-card");
        b.type = "button";
        const stack = el("div", "list-stack");
        l.ids.slice(-3).reverse().forEach((id) => { const f = el("div", "list-stack-item"); f.append(poster(byId[id])); stack.append(f); });
        if (!l.ids.length) stack.append(el("div", "list-stack-item empty"));
        b.append(stack, el("span", "list-card-name", esc(l.name)), el("span", "list-card-n", `${l.ids.length} ${l.ids.length === 1 ? "peli" : "pelis"}`));
        b.onclick = () => { libList = l.id; renderLibrary(); $("#view-biblioteca").scrollTop = 0; };
        li.append(b);
        cards.append(li);
      });
      const li = el("li");
      const add = el("button", "list-card list-card-new", `<span class="list-stack">${ICON.plus}</span><span class="list-card-name">Nueva lista</span><span class="list-card-n">Para ver en pareja, clásicos…</span>`);
      add.type = "button";
      add.onclick = () => nameEditor(tools, "", "Crear", (name) => { libList = createList(name).id; renderLibrary(); }, renderLibrary);
      li.append(add);
      cards.append(li);
      $("#list-empty").hidden = true;
      return;
    }
    const back = el("button", "link-btn back-btn", "← Mis listas");
    back.type = "button";
    back.onclick = () => { libList = null; renderLibrary(); };
    head.append(back, el("h1", "page-title", esc(list.name)));
    const rename = el("button", "link-btn", "Renombrar");
    rename.type = "button";
    rename.onclick = () => nameEditor(tools, list.name, "Guardar", (name) => { list.name = name; persist(); renderLibrary(); }, renderLibrary);
    const del = el("button", "link-btn danger", "Borrar lista");
    del.type = "button";
    del.onclick = () => {
      const idx = state.lists.indexOf(list);
      state.lists.splice(idx, 1);
      libList = null;
      persist();
      renderLibrary();
      toast(`Lista «${list.name}» borrada`, "Deshacer", () => { state.lists.splice(idx, 0, list); libList = list.id; persist(); renderLibrary(); }, 6000);
    };
    tools.append(el("span", "list-hint", `${list.ids.length} ${list.ids.length === 1 ? "peli" : "pelis"}`), rename, del);
    list.ids.slice().reverse().forEach((id) => grid.append(tileFor(byId[id], "list")));
    $("#list-empty").hidden = list.ids.length > 0;
  }

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
    if (libList && !listById(libList)) libList = null;
    const onLists = libSection === "lists";
    $("#tab-matches").setAttribute("aria-selected", String(!onLists));
    $("#tab-lists").setAttribute("aria-selected", String(onLists));
    $("#n-matches").textContent = state.library.length;
    $("#n-lists").textContent = state.lists.length;
    $("#lib-matches").hidden = onLists;
    $("#lib-custom").hidden = !onLists;
    if (onLists) return renderCustom();
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
  $("#tab-matches").onclick = () => { libSection = "matches"; renderLibrary(); };
  $("#tab-lists").onclick = () => { libSection = "lists"; renderLibrary(); };
  $("#seg-pending").onclick = () => { showWatched = false; renderLibrary(); };
  $("#seg-watched").onclick = () => { showWatched = true; renderLibrary(); };

  // ---------- Caja: tira de carátulas que se desliza hasta parar en una al azar ----------
  const TIMES = [
    { label: "Sin prisa", max: Infinity },
    { label: "Menos de 2h 30", max: 150 },
    { label: "Menos de 2 h", max: 120 },
    { label: "Menos de 1h 45", max: 105 },
  ];
  let wheelGenre = "Todas";
  let wheelTime = TIMES[0];
  let wheelProvider = "Cualquier sitio";
  let wheelList = null;
  let wheelItems = [];
  let spinning = false;

  // Pelis base de la caja: las de la lista elegida, o los matches por ver
  const ANY = "any"; // sorteo entre todo el catálogo, sin matches
  const ANY_LABEL = "🎲 Cualquier peli";
  let wheelAuto = true; // si no hay matches, empieza en «Cualquier peli»
  function wheelBase() {
    if (wheelList === ANY) return MOVIES.filter((m) => !entry(m.id)?.watched);
    const list = listById(wheelList);
    return list
      ? list.ids.filter((id) => !entry(id)?.watched).map((id) => byId[id])
      : state.library.filter((l) => !l.watched).map((l) => byId[l.id]);
  }
  function wheelPool() {
    return wheelBase()
      .filter((m) => (wheelGenre === "Todas" || m.genres.includes(wheelGenre)) && m.runtime <= wheelTime.max)
      .filter((m) => wheelProvider === "Cualquier sitio" || (m.providers || []).includes(wheelProvider));
  }

  function renderWheel() {
    if (wheelList && wheelList !== ANY && !listById(wheelList)) wheelList = null;
    if (wheelAuto && !wheelList && state.library.filter((l) => !l.watched).length < 2) wheelList = ANY;
    const pendingMovies = wheelBase();
    const genres = genresOf(pendingMovies);
    if (wheelGenre !== "Todas" && !genres.includes(wheelGenre)) wheelGenre = "Todas";
    chipRow($("#wheel-genres"), ["Todas", ...genres], wheelGenre, (g) => { wheelGenre = g; $("#wheel-result").hidden = true; renderWheel(); });
    chipRow($("#wheel-time"), TIMES.map((t) => t.label), wheelTime.label, (label) => {
      wheelTime = TIMES.find((t) => t.label === label);
      $("#wheel-result").hidden = true;
      renderWheel();
    });

    const listBox = $("#wheel-lists");
    listBox.hidden = false;
    const listNames = ["Mis matches", ...state.lists.map((l) => l.name), ANY_LABEL];
    const current = wheelList === ANY ? ANY_LABEL : listById(wheelList)?.name || "Mis matches";
    chipRow(listBox, listNames, current, (name) => {
      wheelAuto = false;
      wheelList = name === ANY_LABEL ? ANY : state.lists.find((l) => l.name === name)?.id || null;
      $("#wheel-result").hidden = true;
      renderWheel();
    });

    const providers = wheelList === ANY
      ? PROVIDERS // en todo el catálogo, solo las plataformas principales
      : [...new Set(pendingMovies.flatMap((m) => m.providers || []))].sort();
    if (!providers.includes(wheelProvider)) wheelProvider = "Cualquier sitio";
    const provBox = $("#wheel-providers");
    provBox.hidden = providers.length === 0;
    chipRow(provBox, ["Cualquier sitio", ...providers], wheelProvider, (p) => { wheelProvider = p; $("#wheel-result").hidden = true; renderWheel(); });

    const tooFew = false; // siempre se puede sortear: como mínimo, entre todo el catálogo
    $("#wheel-empty").hidden = !tooFew;
    $(".wheel-filters").hidden = tooFew;
    $("#wheel-wrap").hidden = tooFew;
    $("#wheel-note").hidden = tooFew;
    if (tooFew) { $("#wheel-result").hidden = true; return; }

    const pool = wheelPool();
    wheelItems = pool;
    $("#wheel-spin").disabled = pool.length === 0 || spinning;
    $("#wheel-note").textContent = pool.length === 0
      ? (wheelList === null && !state.library.some((l) => !l.watched)
        ? "Aún no tienes matches por ver. Elige «Cualquier peli» o desliza en Descubrir."
        : "Ninguna peli encaja con estos filtros.")
      : `${pool.length.toLocaleString("es-ES")} ${pool.length === 1 ? "peli entra" : "pelis entran"} en la caja.`;
    if (!spinning) drawReel(shuffle(pool).slice(0, 24));
  }

  // Color de «rareza» según la nota, como en las cajas de los juegos
  const rarity = (m) => (m.rating == null ? "r1" : m.rating >= 8 ? "r5" : m.rating >= 7.5 ? "r4" : m.rating >= 7 ? "r3" : m.rating >= 6.5 ? "r2" : "r1");
  const reelEl = $("#reel");
  function drawReel(items) {
    reelEl.style.transition = "none";
    reelEl.style.transform = "translateX(0)";
    reelEl.replaceChildren();
    if (!items.length) return;
    let list = items;
    while (list.length < 12) list = list.concat(items);
    list.forEach((m) => {
      const li = el("li", "reel-item " + rarity(m));
      li.append(poster(m));
      reelEl.append(li);
    });
    // la primera carátula centrada bajo la marca
    const first = reelEl.firstElementChild;
    const win = reelEl.parentElement.clientWidth;
    reelEl.style.transform = `translateX(${win / 2 - first.offsetLeft - first.offsetWidth / 2}px)`;
  }

  // Sonido de la caja, sintetizado con Web Audio (sin archivos): tic al pasar cada carátula y premio al parar
  let soundOn = (() => { try { return localStorage.getItem("pelimatch:sound") !== "off"; } catch (e) { return true; } })();
  let audio = null;
  const SOUND_ICON = {
    on: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
  };
  const soundBtn = $("#reel-sound");
  const drawSoundBtn = () => {
    soundBtn.innerHTML = soundOn ? SOUND_ICON.on : SOUND_ICON.off;
    soundBtn.setAttribute("aria-pressed", String(soundOn));
  };
  soundBtn.onclick = () => {
    soundOn = !soundOn;
    try { localStorage.setItem("pelimatch:sound", soundOn ? "on" : "off"); } catch (e) { /* sin almacenamiento */ }
    drawSoundBtn();
  };
  drawSoundBtn();
  function ctx() {
    if (!soundOn) return null;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      return audio;
    } catch (e) { return null; }
  }
  function tone(freq, start, dur, type = "square", vol = 0.08) {
    const a = ctx();
    if (!a) return;
    const t = a.currentTime + start;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const tick = () => { tone(1700, 0, 0.035, "square", 0.05); tone(850, 0, 0.05, "triangle", 0.06); };
  function reward(m) {
    const lvl = Number(rarity(m).slice(1)); // 1 a 5
    const notes = [523, 659, 784, 1047, 1319].slice(0, 2 + Math.min(lvl, 3));
    notes.forEach((f, i) => tone(f, i * 0.09, 0.35, "triangle", 0.09));
    if (lvl >= 4) notes.forEach((f, i) => tone(f * 2, 0.45 + i * 0.05, 0.4, "sine", 0.05)); // destello para las mejores
  }
  // Sigue la posición de la tira y suena un tic cada vez que una carátula cruza la marca
  function followTicks(step) {
    let last = null;
    const loop = () => {
      if (!spinning) return;
      const x = new DOMMatrixReadOnly(getComputedStyle(reelEl).transform).m41;
      const idx = Math.floor(-x / step);
      if (last !== null && idx !== last) tick();
      last = idx;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  const REEL_LEN = 56;
  const WIN_AT = 48;
  function spin() {
    if (spinning || wheelItems.length === 0) return;
    spinning = true;
    $("#wheel-spin").disabled = true;
    $("#wheel-result").hidden = true;
    const pool = wheelItems;
    const winner = pool[Math.floor(Math.random() * pool.length)];
    // Tira aleatoria sin dos carátulas iguales seguidas (si se puede), con la ganadora en WIN_AT
    const strip = [];
    for (let i = 0; i < REEL_LEN; i++) {
      if (i === WIN_AT) { strip.push(winner); continue; }
      let m = pool[Math.floor(Math.random() * pool.length)];
      for (let k = 0; k < 4 && pool.length > 1 && (m === strip[i - 1] || (i === WIN_AT - 1 && m === winner)); k++) {
        m = pool[Math.floor(Math.random() * pool.length)];
      }
      strip.push(m);
    }
    drawReel(strip);
    const target = reelEl.children[WIN_AT];
    const win = reelEl.parentElement.clientWidth;
    const jitter = (Math.random() - 0.5) * target.offsetWidth * 0.7;
    const x = win / 2 - target.offsetLeft - target.offsetWidth / 2 + jitter;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 300 : 6500;
    void reelEl.offsetWidth; // fija la posición inicial antes de animar
    ctx(); // el navegador solo deja sonar tras un toque del usuario
    if (!reduce) followTicks(target.offsetWidth + 8);
    reelEl.style.transition = `transform ${duration}ms cubic-bezier(.08, .72, .16, 1)`;
    reelEl.style.transform = `translateX(${x}px)`;
    reelEl.addEventListener("transitionend", function done() {
      reelEl.removeEventListener("transitionend", done);
      target.classList.add("won");
      spinning = false;
      reward(winner);
      $("#wheel-spin").disabled = false;
      $("#wheel-spin").textContent = "Abrir otra";
      showResult(winner);
    });
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
    const again = el("button", "btn btn-ghost", "Abrir otra");
    again.type = "button";
    again.onclick = spin;
    actions.append(where, again);
    if (!inLibrary(m.id)) {
      const save = el("button", "btn btn-ghost", `${ICON.save} La quiero ver`);
      save.type = "button";
      save.onclick = () => { addToLibrary(m.id); save.remove(); };
      actions.prepend(save);
    }
    body.append(actions);
    box.append(btn, body);
    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  $("#wheel-spin").onclick = spin;
  window.addEventListener("resize", () => { if (!$("#view-ruleta").hidden && !spinning) drawReel(shuffle(wheelItems).slice(0, 24)); });

  // ---------- Para ti: encuesta y match personalizado ----------
  const ALL_GENRES = genresOf(MOVIES);
  // URL del Worker de Cloudflare que consulta a Claude (js/config.js, lo genera el despliegue).
  // Sin URL, «Para ti» funciona igual con el recomendador local.
  const AI_URL = String(window.PELIMATCH_AI_URL || "").trim();
  const PROVIDERS = (() => {
    const count = {};
    MOVIES.forEach((m) => (m.providers || []).forEach((p) => (count[p] = (count[p] || 0) + 1)));
    return Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 12);
  })();
  const MOOD_GENRES = {
    "Reírme": ["Comedia"],
    "Emocionarme": ["Drama", "Romance"],
    "Pasar miedo": ["Terror", "Suspense", "Thriller"],
    "Adrenalina": ["Acción", "Aventura", "Suspense", "Thriller"],
    "Pensar": ["Ciencia ficción", "Misterio", "Drama", "Documental"],
    "Algo ligero": ["Comedia", "Animación", "Familia", "Familiar"],
    "Misterio": ["Misterio", "Crimen", "Suspense", "Thriller"],
    "Otro mundo": ["Fantasía", "Ciencia ficción", "Aventura", "Animación"],
  };
  const ERAS = {
    "Me da igual": null,
    "Recientes (2010 en adelante)": [2010, 3000],
    "Años 90 y 2000": [1990, 2009],
    "Clásicos (antes de 1990)": [0, 1989],
  };
  const STEPS = [
    { key: "company", q: "¿Con quién la vas a ver?", type: "single", options: ["Solo", "En pareja", "Con amigos", "En familia"], required: true },
    { key: "moods", q: "¿Qué te apetece sentir?", hint: "Elige una o varias.", type: "multi", options: Object.keys(MOOD_GENRES), required: true },
    { key: "genres", q: "¿Tus géneros favoritos?", hint: "Elige los que más te gusten.", type: "multi", options: ALL_GENRES, required: true },
    { key: "favs", q: "Dime hasta 3 pelis que te encanten", hint: "Busco otras parecidas: mismo director, reparto, géneros y época.", type: "search" },
    { key: "note", q: "¿Algo más que deba saber?", hint: "Opcional. Escríbelo con tus palabras: «algo que me deje pensando», «nada de finales tristes», «como Amélie pero más moderna»…", type: "text", aiOnly: true },
    { key: "time", q: "¿Cuánto tiempo tienes?", type: "single", options: TIMES.map((t) => t.label) },
    { key: "era", q: "¿De qué época?", type: "single", options: Object.keys(ERAS) },
    { key: "platforms", q: "¿Qué plataformas tienes?", hint: "Si marcas alguna, te priorizo lo que puedes ver ya. Si no, sáltalo.", type: "multi", options: PROVIDERS, skipIfEmpty: true },
    { key: "avoid", q: "¿Algo que prefieras evitar?", hint: "Opcional.", type: "multi", options: ALL_GENRES },
  ].filter((s) => (!s.skipIfEmpty || s.options.length) && (!s.aiOnly || AI_URL));

  const emptyProfile = () => ({ company: null, moods: [], genres: [], favs: [], time: TIMES[0].label, era: "Me da igual", platforms: [], avoid: [], note: "" });
  let draft = null;     // respuestas mientras se hace la encuesta
  let stepIdx = 0;
  let results = null;   // [{ m, score, reasons }]
  let forYou = [];      // ids ordenados para el mazo «Para ti»

  function scoreMovie(m, p, favs) {
    const reasons = [];
    const add = (pts, why) => { if (pts > 0 && why) reasons.push([pts, why]); return pts; };
    let s = 0;
    const g = m.genres;
    const has = (list) => list.filter((x) => g.includes(x));

    if (p.company === "En familia") {
      if (g.includes("Terror")) return null;
      s += add(has(["Animación", "Familia", "Familiar"]).length * 2, "Perfecta para ver en familia");
    } else if (p.company === "En pareja") {
      s += add(has(["Romance", "Comedia"]).length * 0.8, "Buena para ver en pareja");
    } else if (p.company === "Con amigos") {
      s += add(has(["Comedia", "Acción", "Terror"]).length * 0.8, "Funciona muy bien con amigos");
    }

    const moodHits = p.moods.filter((mood) => MOOD_GENRES[mood].some((x) => g.includes(x)));
    s += add(Math.min(moodHits.length, 2) * 2.2, moodHits.length ? `Encaja con lo que te apetece: ${moodHits.join(", ").toLowerCase()}` : "");

    const genreHits = has(p.genres);
    s += add(Math.min(genreHits.length, 2) * 1.6, genreHits.length ? `Es de ${genreHits.join(" y ").toLowerCase()}, de tus géneros favoritos` : "");

    for (const f of favs) {
      if (f.id === m.id) return null;
      let sim = 0;
      const shared = f.genres.filter((x) => g.includes(x)).length;
      sim += shared * 0.7;
      if (f.director && f.director === m.director && m.director !== "Desconocido") {
        sim += 3.5;
        reasons.push([3.5, `Del mismo director que «${f.title}»: ${m.director}`]);
      }
      const castHits = (m.cast || []).filter((c) => (f.cast || []).includes(c));
      if (castHits.length) {
        sim += castHits.length * 1.4;
        reasons.push([castHits.length * 1.4, `Sale ${castHits.slice(0, 2).join(" y ")}, como en «${f.title}»`]);
      }
      if (m.year && f.year && Math.abs(m.year - f.year) <= 6) sim += 0.6;
      if (shared >= 2 && sim < 3.5) reasons.push([shared, `Parecida a «${f.title}»`]);
      s += sim;
    }

    const era = ERAS[p.era];
    if (era) s += m.year >= era[0] && m.year <= era[1] ? add(1.4, "") : -1;

    if (m.rating != null) s += add((m.rating - 6.3) * 1.1, m.rating >= 7.8 ? `Muy bien valorada: ${m.rating.toFixed(1)}/10` : "");

    if (p.platforms.length) {
      const on = (m.providers || []).filter((x) => p.platforms.includes(x));
      s += on.length ? add(2.2, `La tienes en ${on[0]}`) : -1.2;
    }

    s += Math.random() * 0.4; // algo de variedad entre una consulta y otra
    reasons.sort((a, b) => b[0] - a[0]);
    return { m, score: s, reasons: [...new Set(reasons.map((r) => r[1]))].slice(0, 3) };
  }

  function computeMatches(p) {
    const favs = p.favs.map((id) => byId[id]).filter(Boolean);
    const maxTime = (TIMES.find((t) => t.label === p.time) || TIMES[0]).max;
    const skip = new Set([...state.library.map((l) => l.id), ...state.passed]);
    const out = [];
    for (const m of MOVIES) {
      if (skip.has(m.id) || m.runtime > maxTime) continue;
      if (p.avoid.some((x) => m.genres.includes(x))) continue;
      const r = scoreMovie(m, p, favs);
      if (r) out.push(r);
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  function runMatch() {
    const all = computeMatches(state.profile);
    results = all.slice(0, 12);
    forYou = all.slice(0, 300).map((r) => r.m.id);
    renderMoods();
  }

  function renderMatch() {
    const box = $("#match-body");
    box.replaceChildren();
    if (draft) return renderStep(box);
    if (!state.profile) { renderWeekly(box); return renderIntro(box); }
    if (!results) runMatch();
    renderWeekly(box);
    const redo = el("button", "btn btn-ghost", "Repetir encuesta");
    redo.type = "button";
    redo.onclick = () => { draft = { ...emptyProfile(), ...state.profile }; stepIdx = 0; renderMatch(); };
    const mine = el("button", "btn btn-red", "Ir a mi match personalizado");
    mine.type = "button";
    mine.onclick = () => {
      if (!forYou.length) runMatch();
      mood = FOR_YOU;
      renderMoods();
      deckEl.replaceChildren();
      location.hash = "#descubrir";
    };
    const tour = el("button", "btn btn-ghost", "Ver tutorial");
    tour.type = "button";
    tour.onclick = startTour;
    const footer = el("div", "match-footer");
    footer.append(mine, redo, tour);
    box.append(footer);
  }

  // ---------- Peli de la semana: una recomendación fija cada semana según tus gustos ----------
  const weekStart = (d = new Date()) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // lunes
    return x;
  };
  const weekKey = () => { const w = weekStart(); return `${w.getFullYear()}-${w.getMonth() + 1}-${w.getDate()}`; };
  const shortDate = (d) => d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  let weeklyBusy = false;

  function tasteSignal() {
    return state.library.length + state.lists.reduce((n, l) => n + l.ids.length, 0) + (state.profile ? 3 : 0);
  }

  // Gustos a partir de matches, vistas, listas, descartes y encuesta
  function weeklyCandidates() {
    const g = {}, dir = {}, cast = {};
    const like = (m, w) => {
      m.genres.forEach((x) => (g[x] = (g[x] || 0) + w));
      if (m.director && m.director !== "Desconocido") dir[m.director] = (dir[m.director] || 0) + w;
      (m.cast || []).slice(0, 3).forEach((c) => (cast[c] = (cast[c] || 0) + w));
    };
    state.library.forEach((l) => like(byId[l.id], l.watched ? 1.3 : 1));
    state.lists.forEach((l) => l.ids.forEach((id) => like(byId[id], 0.8)));
    state.passed.slice(-150).forEach((id) => byId[id].genres.forEach((x) => (g[x] = (g[x] || 0) - 0.15)));
    const p = state.profile;
    if (p) {
      p.genres.forEach((x) => (g[x] = (g[x] || 0) + 2));
      p.favs.map((id) => byId[id]).filter(Boolean).forEach((m) => like(m, 2.5));
    }
    const total = Object.values(g).reduce((a, b) => a + Math.max(b, 0), 0) || 1;
    const skip = new Set([...state.library.map((l) => l.id), ...state.passed, ...state.lists.flatMap((l) => l.ids), ...(p ? p.favs : [])]);
    const out = [];
    for (const m of MOVIES) {
      if (skip.has(m.id) || m.rating == null || m.rating < 7) continue;
      if (p && p.avoid.some((x) => m.genres.includes(x))) continue;
      let s = m.genres.reduce((a, x) => a + (g[x] || 0), 0) / total * 6;
      s += Math.min(dir[m.director] || 0, 4) * 1.2;
      s += (m.cast || []).reduce((a, c) => a + Math.min(cast[c] || 0, 3) * 0.5, 0);
      s += (m.rating - 7) * 1.5;
      out.push({ m, s });
    }
    return out.sort((a, b) => b.s - a.s);
  }

  function localWeeklyReason(m) {
    const p = state.profile;
    const liked = [...(p ? p.favs.map((id) => byId[id]).filter(Boolean) : []), ...state.library.map((l) => byId[l.id])];
    const sameDir = liked.find((x) => x.director === m.director && m.director !== "Desconocido");
    if (sameDir) return `Es de ${m.director}, el director de «${sameDir.title}». Tiene un ${m.rating.toFixed(1)}/10.`;
    const fav = p && m.genres.find((x) => p.genres.includes(x));
    if (fav) return `Es de ${fav.toLowerCase()}, uno de tus géneros favoritos, y tiene un ${m.rating.toFixed(1)}/10.`;
    if (state.library.length) return `Se parece a lo que más guardas, sobre todo ${m.genres[0].toLowerCase()}, y tiene un ${m.rating.toFixed(1)}/10.`;
    return `De las mejor valoradas que encajan con tus respuestas: ${m.rating.toFixed(1)}/10.`;
  }

  async function ensureWeekly() {
    const week = weekKey();
    if (state.weekly && state.weekly.week === week && byId[state.weekly.id]) return;
    if (weeklyBusy || tasteSignal() < 3) return;
    const cands = weeklyCandidates().slice(0, 30);
    if (!cands.length) return;
    // Sin IA: una de las 5 mejores, fija para toda la semana
    const seed = [...week].reduce((a, c) => a + c.charCodeAt(0), 0);
    const pick = cands[seed % Math.min(5, cands.length)].m;
    state.weekly = { week, id: pick.id, reason: localWeeklyReason(pick), ai: false };
    persist();
    if (!AI_URL) return;
    weeklyBusy = true;
    try {
      const slim = (m) => ({ id: m.id, title: m.title, year: m.year, director: m.director, cast: m.cast, genres: m.genres,
        runtime: m.runtime, rating: m.rating, providers: m.providers, desc: m.desc });
      const liked = [...state.library.map((l) => byId[l.id]), ...state.lists.flatMap((l) => l.ids.map((id) => byId[id]))]
        .slice(-15).map((m) => `${m.title} (${m.year})`);
      const res = await fetch(AI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "weekly", profile: state.profile || {}, favs: (state.profile?.favs || []).map((id) => byId[id]).filter(Boolean).map(slim), liked, candidates: cands.map((c) => slim(c.m)) }),
      });
      if (!res.ok) throw new Error(`IA ${res.status}`);
      const top = ((await res.json()).picks || []).find((x) => byId[x.id]);
      if (top && state.weekly.week === week) {
        state.weekly = { week, id: top.id, reason: top.reason, ai: true };
        persist();
        if (!$("#view-para-ti").hidden && !draft) renderMatch();
      }
    } catch (e) {
      console.warn("Peli de la semana: sin IA,", e);
    } finally {
      weeklyBusy = false;
    }
  }

  function renderWeekly(box) {
    ensureWeekly();
    const w = state.weekly;
    const start = weekStart();
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const label = `Peli de la semana · ${shortDate(start)} – ${shortDate(end)}`;
    if (!w || w.week !== weekKey()) {
      box.append(el("div", "weekly weekly-empty", `<p class="result-label">${esc(label)}</p>
        <p>Guarda unas cuantas pelis o haz la encuesta y cada lunes te recomiendo una pensada para ti.</p>`));
      return;
    }
    const m = byId[w.id];
    const card = el("div", "weekly");
    const pbtn = el("button", "tile-btn");
    pbtn.type = "button";
    pbtn.setAttribute("aria-label", `Ver ficha de ${m.title}`);
    pbtn.append(poster(m));
    pbtn.onclick = () => openSheet(m.id, "weekly");
    const body = el("div", "result-body", `
      <div>
        <p class="result-label">${esc(label)}</p>
        <p class="result-title">${esc(m.title)}</p>
        <p class="tile-meta">${m.year} · ${fmtTime(m.runtime)} · ${m.rating.toFixed(1)}/10</p>
      </div>
      <p class="weekly-why">${esc(w.reason)}</p>`);
    const actions = el("div", "match-actions");
    if (inLibrary(m.id)) {
      actions.append(el("span", "tile-why", "✓ Ya está en tus matches"));
    } else {
      const save = el("button", "btn btn-solid", `${ICON.save} La quiero ver`);
      save.type = "button";
      save.onclick = () => { addToLibrary(m.id); renderMatch(); };
      actions.append(save);
    }
    body.append(actions);
    card.append(pbtn, body);
    box.append(card);
  }

  function renderIntro(box) {
    box.append(el("div", "match-intro", `
      <h1 class="page-title">Tu match personalizado</h1>
      <p>Responde ${STEPS.length} preguntas rápidas y ${AI_URL ? "Claude elige" : "elijo"} entre ${MOVIES.length.toLocaleString("es-ES")} películas tu peli de la semana, diciéndote por qué.</p>
      <ul class="match-steps">${STEPS.map((s) => `<li>${esc(s.q.replace(/[¿?]/g, ""))}</li>`).join("")}</ul>`));
    const start = el("button", "btn btn-red", "Empezar encuesta");
    start.type = "button";
    start.onclick = () => { startSurvey(); renderMatch(); };
    box.querySelector(".match-intro").append(start);
  }

  let firstRun = false;
  function startSurvey(first = false) {
    firstRun = first;
    draft = emptyProfile();
    stepIdx = 0;
  }

  function renderStep(box) {
    const step = STEPS[stepIdx];
    if (firstRun && stepIdx === 0) {
      box.append(el("div", "welcome", `<p class="result-label">Bienvenido a Cinder</p>
        <p>Antes de nada, ${STEPS.length} preguntas rápidas para conocerte. Al acabar te doy tu peli de la semana.</p>`));
    }
    box.append(el("div", "q-progress", `<span style="width:${((stepIdx + 1) / STEPS.length) * 100}%"></span>`));
    box.append(el("p", "q-count", `Pregunta ${stepIdx + 1} de ${STEPS.length}`));
    box.append(el("h2", "q-title", esc(step.q)));
    if (step.hint) box.append(el("p", "q-hint", esc(step.hint)));

    if (step.type === "search") {
      renderFavSearch(box);
    } else if (step.type === "text") {
      const ta = el("textarea", "q-search q-note");
      ta.id = "q-note";
      ta.rows = 3;
      ta.maxLength = 400;
      ta.placeholder = "Escribe lo que quieras (opcional)";
      ta.setAttribute("aria-label", step.q);
      ta.value = draft[step.key] || "";
      ta.addEventListener("input", () => { draft[step.key] = ta.value; updateNext(); });
      box.append(ta);
    } else {
      const opts = el("div", "opts");
      opts.setAttribute("role", "group");
      step.options.forEach((o) => {
        const b = el("button", "opt", esc(o));
        b.type = "button";
        const on = step.type === "single" ? draft[step.key] === o : draft[step.key].includes(o);
        b.setAttribute("aria-pressed", String(on));
        b.onclick = () => {
          if (step.type === "single") {
            draft[step.key] = o;
            return next();
          }
          const list = draft[step.key];
          draft[step.key] = list.includes(o) ? list.filter((x) => x !== o) : [...list, o];
          b.setAttribute("aria-pressed", String(draft[step.key].includes(o)));
          updateNext();
        };
        opts.append(b);
      });
      box.append(opts);
    }

    const nav = el("div", "q-nav");
    const back = el("button", "btn btn-ghost", stepIdx === 0 ? "Cancelar" : "Atrás");
    back.type = "button";
    back.hidden = stepIdx === 0 && !state.profile; // la primera encuesta es obligatoria
    back.onclick = () => {
      if (stepIdx === 0) draft = null; else stepIdx--;
      renderMatch();
    };
    const fwd = el("button", "btn btn-solid", "");
    fwd.type = "button";
    fwd.id = "q-next";
    fwd.onclick = next;
    nav.append(back, fwd);
    box.append(nav);
    updateNext();
    $("#view-para-ti").scrollTop = 0;
  }

  function updateNext() {
    const step = STEPS[stepIdx];
    const b = $("#q-next");
    if (!b) return;
    const v = draft[step.key];
    const empty = Array.isArray(v) ? v.length === 0 : !String(v || "").trim();
    const last = stepIdx === STEPS.length - 1;
    const blocked = step.required && empty;
    b.disabled = blocked;
    b.textContent = blocked ? (step.type === "single" ? "Elige una opción" : "Elige al menos una") : last ? "Ver mi match" : empty ? "Saltar" : "Siguiente";
  }

  function next() {
    if (stepIdx < STEPS.length - 1) { stepIdx++; return renderMatch(); }
    state.profile = draft;
    state.weekly = null; // la peli de la semana se recalcula con las nuevas respuestas
    draft = null;
    const wasFirst = firstRun;
    firstRun = false;
    persist();
    results = null;
    document.body.classList.remove("onboarding");
    renderMatch();
    if (wasFirst) setTimeout(startTour, 500);
  }

  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  function renderFavSearch(box) {
    const chips = el("div", "fav-chips");
    const input = el("input", "q-search");
    input.type = "search";
    input.id = "fav-search";
    input.placeholder = "Escribe el título…";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Buscar película favorita");
    const list = el("ul", "sugg");

    const drawChips = () => {
      chips.replaceChildren();
      draft.favs.forEach((id) => {
        const c = el("button", "fav-chip", `${esc(byId[id].title)} ${ICON.x}`);
        c.type = "button";
        c.setAttribute("aria-label", `Quitar ${byId[id].title}`);
        c.onclick = () => { draft.favs = draft.favs.filter((x) => x !== id); drawChips(); search(); updateNext(); };
        chips.append(c);
      });
      input.hidden = draft.favs.length >= 3;
    };
    const search = () => {
      list.replaceChildren();
      const q = norm(input.value.trim());
      if (q.length < 2 || draft.favs.length >= 3) return;
      MOVIES
        .filter((m) => !draft.favs.includes(m.id) && (norm(m.title).includes(q) || norm(m.original || "").includes(q)))
        .sort((a, b) => (norm(a.title).startsWith(q) ? 0 : 1) - (norm(b.title).startsWith(q) ? 0 : 1) || (b.rating || 0) - (a.rating || 0))
        .slice(0, 6)
        .forEach((m) => {
          const li = el("li");
          const b = el("button", "", `${esc(m.title)} <span>${m.year}</span>`);
          b.type = "button";
          b.onclick = () => { draft.favs.push(m.id); input.value = ""; drawChips(); search(); updateNext(); if (!input.hidden) input.focus(); };
          li.append(b);
          list.append(li);
        });
    };
    input.addEventListener("input", search);
    box.append(chips, input, list);
    drawChips();
  }

  function addToLibrary(id) {
    if (inLibrary(id)) return;
    state.library.push({ id, at: Date.now(), watched: false });
    state.passed = state.passed.filter((x) => x !== id);
    persist();
    bumpCount();
    toast(`Añadida: ${byId[id].title}`);
  }

  // ---------- Tutorial guiado: resalta cada parte de la app con una explicación ----------
  const TOUR = [
    { view: "para-ti", target: ".weekly", title: "Tu peli de la semana", text: "Cada lunes te recomiendo una peli según tu encuesta y lo que guardas. Si te convence, guárdala con «La quiero ver»." },
    { view: "descubrir", target: "#deck", demo: true, place: "bottom", title: "Desliza para decidir", text: "Derecha: la quieres ver. Izquierda: pasas. Arriba: ya la has visto. Toca la carátula para ver su ficha, tráiler y dónde verla." },
    { view: "descubrir", target: "#controls", title: "O usa los botones", text: "Deshacer, paso, la quiero ver, ya la vi y ficha. Lo mismo que deslizar." },
    { view: "descubrir", target: "#moods", title: "¿Qué te apetece?", text: "Filtra las cartas por género. «✨ Para ti» te enseña primero las que más encajan con tu encuesta." },
    { view: "descubrir", target: ".icon-btn", title: "Busca cualquier peli", text: "Por título, director o actor. Desde su ficha la guardas o la metes en tus listas." },
    { view: "biblioteca", target: ".lib-tabs", title: "Tu biblioteca", text: "En «Matches» está lo que guardas deslizando, separado en Por ver y Vistas. En «Mis listas» creas tus propias colecciones." },
    { view: "ruleta", target: ".view-wheel .list-head", title: "¿No sabes cuál ver?", text: "Abre la caja: las carátulas de tus pelis por ver pasan rápido hasta pararse en una al azar. El color indica la nota." },
  ];
  let tourIdx = -1;
  let tourBox = null;
  let demoAnims = [];

  // Animación de ejemplo: la carta de arriba hace sola derecha, izquierda y arriba, en bucle
  function startSwipeDemo() {
    stopSwipeDemo();
    const card = topCard();
    if (!card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rest = "translate(0, 0) rotate(0deg)";
    const opts = { duration: 7200, iterations: Infinity };
    const ease = (frames) => frames.map((f) => ({ ...f, easing: "ease-in-out" })); // suavizado entre cada pose
    demoAnims = [
      card.animate(ease([
        { offset: 0, transform: rest }, { offset: 0.08, transform: rest },
        { offset: 0.2, transform: "translate(38%, 10px) rotate(9deg)" }, { offset: 0.27, transform: "translate(38%, 10px) rotate(9deg)" },
        { offset: 0.36, transform: rest }, { offset: 0.42, transform: rest },
        { offset: 0.54, transform: "translate(-38%, 10px) rotate(-9deg)" }, { offset: 0.61, transform: "translate(-38%, 10px) rotate(-9deg)" },
        { offset: 0.7, transform: rest }, { offset: 0.76, transform: rest },
        { offset: 0.86, transform: "translate(0, -22%) rotate(0deg)" }, { offset: 0.92, transform: "translate(0, -22%) rotate(0deg)" },
        { offset: 1, transform: rest },
      ]), opts),
      ...[[".stamp-like", 0.2, 0.27], [".stamp-nope", 0.54, 0.61], [".stamp-seen", 0.86, 0.92]].map(([sel, a, b]) =>
        card.querySelector(sel).animate(ease([
          { offset: 0, opacity: 0 }, { offset: a - 0.08, opacity: 0 }, { offset: a, opacity: 1 },
          { offset: b, opacity: 1 }, { offset: Math.min(b + 0.06, 1), opacity: 0 }, { offset: 1, opacity: 0 },
        ]), opts)),
    ];
  }
  function stopSwipeDemo() {
    demoAnims.forEach((a) => a.cancel());
    demoAnims = [];
  }
  function startTour() {
    tourIdx = 0;
    if (!tourBox) {
      tourBox = el("div", "tour");
      tourBox.innerHTML = `<div class="tour-hole"></div>
        <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
          <p class="tour-count"></p><h2 class="tour-title" id="tour-title"></h2><p class="tour-text"></p>
          <div class="tour-nav"><button type="button" class="btn btn-ghost tour-skip">Saltar</button><button type="button" class="btn btn-solid tour-next"></button></div>
        </div>`;
      tourBox.querySelector(".tour-skip").onclick = endTour;
      tourBox.querySelector(".tour-next").onclick = () => { tourIdx++; tourIdx < TOUR.length ? showTourStep() : endTour(true); };
      document.body.append(tourBox);
      window.addEventListener("resize", () => { if (tourIdx >= 0) placeTour(); });
    }
    tourBox.hidden = false;
    showTourStep();
  }
  function endTour(done) {
    stopSwipeDemo();
    tourIdx = -1;
    tourBox.hidden = true;
    location.hash = done === true ? "#descubrir" : "#para-ti";
  }
  function showTourStep() {
    const step = TOUR[tourIdx];
    if (location.hash !== "#" + step.view) location.hash = "#" + step.view;
    tourBox.querySelector(".tour-count").textContent = `${tourIdx + 1} de ${TOUR.length}`;
    tourBox.querySelector(".tour-title").textContent = step.title;
    tourBox.querySelector(".tour-text").textContent = step.text;
    tourBox.querySelector(".tour-next").textContent = tourIdx === TOUR.length - 1 ? "¡A ver pelis!" : "Siguiente";
    tourBox.classList.add("moving");
    stopSwipeDemo();
    const idx = tourIdx;
    setTimeout(() => {
      if (tourIdx !== idx) return; // se saltó o avanzó mientras tanto
      placeTour();
      tourBox.classList.remove("moving");
      tourBox.querySelector(".tour-next").focus();
      if (step.demo) startSwipeDemo();
    }, 250);
  }
  function placeTour() {
    const step = TOUR[tourIdx];
    const target = $(step.target);
    const hole = tourBox.querySelector(".tour-hole");
    const card = tourBox.querySelector(".tour-card");
    const vh = window.innerHeight;
    if (!target || !target.getClientRects().length) {
      hole.style.cssText = `left:50%;top:40%;width:0;height:0`;
      card.style.top = "30%";
      return;
    }
    target.scrollIntoView({ block: "nearest" });
    const r = target.getBoundingClientRect();
    const pad = 6;
    const top = Math.max(r.top - pad, 4), bottom = Math.min(r.bottom + pad, vh - 4);
    hole.style.cssText = `left:${r.left - pad}px;top:${top}px;width:${r.width + pad * 2}px;height:${bottom - top}px`;
    const ch = card.offsetHeight;
    // la tarjeta va debajo del elemento si cabe; si no, encima; si tampoco, abajo del todo
    if (step.place === "bottom") { card.style.top = `${vh - ch - 8}px`; return; }
    let y = bottom + 12;
    if (y + ch > vh - 8) y = top - ch - 12;
    if (y < 8) y = vh - ch - 90;
    card.style.top = `${y}px`;
  }

  // ---------- Buscar ----------
  const searchInput = $("#search-input");
  function renderSearch() {
    const grid = $("#search-grid");
    grid.replaceChildren();
    const q = norm(searchInput.value.trim());
    const note = $("#search-note");
    if (q.length < 2) {
      note.textContent = `Busca entre ${MOVIES.length.toLocaleString("es-ES")} películas por título, director o actor.`;
      return;
    }
    const scored = [];
    for (const m of MOVIES) {
      const t = norm(m.title), o = norm(m.original || "");
      let s = 0;
      if (t === q || o === q) s = 5;
      else if (t.startsWith(q) || o.startsWith(q)) s = 4;
      else if (t.includes(q) || o.includes(q)) s = 3;
      else if (norm(m.director || "").includes(q)) s = 2;
      else if ((m.cast || []).some((c) => norm(c).includes(q))) s = 1;
      if (s) scored.push([s, m]);
    }
    scored.sort((a, b) => b[0] - a[0] || (b[1].rating || 0) - (a[1].rating || 0));
    note.textContent = scored.length
      ? `${scored.length > 60 ? "Las 60 mejores de " : ""}${scored.length} ${scored.length === 1 ? "resultado" : "resultados"}`
      : "No encuentro ninguna con ese nombre. Prueba con el título original o con el director.";
    scored.slice(0, 60).forEach(([, m]) => {
      const li = tileFor(m, "search");
      if (inLibrary(m.id)) li.append(el("p", "tile-why", "✓ En tu biblioteca"));
      grid.append(li);
    });
  }
  let searchTimer;
  searchInput.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderSearch, 120); });

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

    // Mis listas
    const listsBox = el("div", "sheet-lists");
    const drawLists = () => {
      listsBox.replaceChildren(el("p", "section-label", "Mis listas"));
      const row = el("div", "filters wrap");
      state.lists.forEach((l) => {
        const b = el("button", "filter", esc(l.name));
        b.type = "button";
        b.setAttribute("aria-pressed", String(l.ids.includes(id)));
        b.onclick = () => { toggleInList(l.id, id); drawLists(); drawActions(); };
        row.append(b);
      });
      const add = el("button", "filter filter-add", `${ICON.plus} Nueva lista`);
      add.type = "button";
      add.onclick = () => nameEditor(row, "", "Crear", (name) => { const l = createList(name); toggleInList(l.id, id); drawLists(); drawActions(); }, drawLists);
      row.append(add);
      listsBox.append(row);
    };
    drawLists();
    content.querySelector("#sheet-actions").before(listsBox);

    const actions = content.querySelector("#sheet-actions");
    const drawActions = () => {
    actions.replaceChildren();
    const e = entry(id);
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
        button("btn btn-ghost", `${ICON.check} Ya la he visto`, () => decide("seen")),
      );
    } else if (from === "match" && !e) {
      const drop = () => { results = (results || []).filter((r) => r.m.id !== id); renderMatch(); };
      actions.append(
        button("btn btn-ghost", `${ICON.x} Paso`, () => { state.passed.push(id); persist(); drop(); }),
        button("btn btn-solid", `${ICON.save} La quiero ver`, () => { addToLibrary(id); drop(); }),
      );
    } else if (e) {
      actions.append(
        e.watched
          ? button("btn btn-ghost", "Marcar como no vista", () => setWatched(id, false))
          : button("btn btn-solid", `${ICON.check} Ya la he visto`, () => setWatched(id, true)),
        button("btn btn-danger", "Quitar de la biblioteca", () => removeFromLibrary(id)),
      );
    } else {
      actions.append(button("btn btn-solid", `${ICON.save} La quiero ver`, () => { addToLibrary(id); if (from === "search") renderSearch(); }));
    }
    };
    drawActions();

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
    if (!$("#view-buscar").hidden) renderSearch();
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

  function emptyLibrary() {
    const before = { library: state.library, passed: state.passed, history: state.history };
    const ids = new Set(state.library.map((l) => l.id));
    const n = ids.size;
    state.library = [];
    state.passed = [...state.passed, ...ids];
    state.history = state.history.filter((h) => !ids.has(h.id));
    persist();
    refreshViews();
    toast(`Biblioteca vaciada (${n} ${n === 1 ? "peli" : "pelis"})`, "Deshacer", () => {
      Object.assign(state, before);
      persist();
      refreshViews();
    }, 7000);
  }

  // ---------- Aviso ----------
  let toastTimer;
  function toast(msg, actionLabel, onAction, ms = 4000) {
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
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  // ---------- Navegación (#descubrir, #biblioteca, #ruleta) ----------
  const VIEWS = ["descubrir", "biblioteca", "para-ti", "ruleta", "buscar"];
  let lastView = null;
  function route() {
    // Sin encuesta hecha no se entra al resto de la app
    const locked = !state.profile;
    document.body.classList.toggle("onboarding", locked);
    if (locked && location.hash !== "#para-ti") {
      history.replaceState(null, "", "#para-ti");
    }
    if (locked && !draft) startSurvey(true);
    const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "descubrir";
    // Al volver a Descubrir, ofrece empezar de cero con la biblioteca
    if (view === "descubrir" && lastView !== "descubrir" && state.library.length) {
      const n = state.library.length;
      toast(`Tienes ${n} ${n === 1 ? "match guardado" : "matches guardados"}`, "Vaciar biblioteca", emptyLibrary, 6000);
    }
    lastView = view;
    closeSheet();
    VIEWS.forEach((v) => ($("#view-" + v).hidden = v !== view));
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t.dataset.view === view;
      t.classList.toggle("active", on);
      if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    if (view === "biblioteca") renderLibrary();
    else if (view === "para-ti") renderMatch();
    else if (view === "ruleta") { $("#wheel-result").hidden = true; renderWheel(); }
    else if (view === "buscar") { renderSearch(); searchInput.focus(); }
    else renderDeck();
  }

  // ---------- Eventos ----------
  $("#btn-like").onclick = () => decide("like");
  $("#btn-nope").onclick = () => decide("pass");
  $("#btn-undo").onclick = undo;
  $("#btn-seen").onclick = () => decide("seen");
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
    else if (e.key === "ArrowUp") decide("seen");
    else if (e.key.toLowerCase() === "i") $("#btn-info").click();
    else if (e.key.toLowerCase() === "z") undo();
  });

  // Primera vez: directo a la encuesta, para empezar con el match y la peli de la semana
  if (!state.profile && !state.onboarded) {
    state.onboarded = true;
    persist();
    startSurvey(true);
    if (location.hash !== "#para-ti") history.replaceState(null, "", "#para-ti");
  }

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
