// Animaciones del estilo pop (2026-11-06). Van aparte de app.js y no cambian cómo funciona nada:
// miran lo que pasa en la página (qué pestaña está activa, qué se añade, cuándo para la caja…) y le ponen movimiento.
// Los estilos de cada animación están al final de pop.css. Con «reducir movimiento» en el móvil no se hace nada.
(function () {
  if (!window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const root = document.documentElement;
  root.classList.add("fx");

  // ---------- 3. La pestaña amarilla se desliza hasta la nueva, y la pantalla entra ----------
  const tabbar = document.querySelector(".tabbar");
  if (tabbar) {
    const pill = document.createElement("span");
    pill.className = "tab-pill";
    pill.setAttribute("aria-hidden", "true");
    tabbar.prepend(pill);
    let shown = false;
    const place = () => {
      const t = tabbar.querySelector(".tab.active");
      if (!t || !t.offsetWidth) { pill.style.opacity = "0"; return; }
      pill.style.opacity = "1";
      pill.style.transform = `translate(${t.offsetLeft}px, ${t.offsetTop}px)`;
      pill.style.width = t.offsetWidth + "px";
      pill.style.height = t.offsetHeight + "px";
      if (!shown) { shown = true; requestAnimationFrame(() => tabbar.classList.add("has-pill")); }
    };
    new MutationObserver(place).observe(tabbar, { subtree: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", place);
    setTimeout(place, 50);
  }
  // Cada pantalla, al mostrarse, entra con un pequeño deslizamiento
  document.querySelectorAll(".view").forEach((v) => {
    new MutationObserver(() => {
      if (v.hidden) return;
      v.classList.remove("fx-in");
      void v.offsetWidth;
      v.classList.add("fx-in");
    }).observe(v, { attributes: true, attributeFilter: ["hidden"] });
  });

  // ---------- 4. Carteles y tarjetas que aparecen en cascada ----------
  const CASCADE = ".grid > li, .news-row > li, .list-cards > li, .news-list > li, .cines-list > li, .cine-films > li, .sugg > li";
  const stagger = (nodes) => {
    let i = 0;
    nodes.forEach((n) => {
      if (n.nodeType !== 1 || !n.matches(CASCADE) || n.dataset.fx) return;
      n.dataset.fx = "1";
      n.style.setProperty("--fx-i", Math.min(i++, 12));
      n.classList.add("fx-drop");
    });
  };
  new MutationObserver((list) => {
    const added = [];
    for (const r of list) r.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.matches(CASCADE)) added.push(n);
      else n.querySelectorAll && added.push(...n.querySelectorAll(CASCADE));
    });
    if (added.length) stagger(added);
  }).observe(document.body, { childList: true, subtree: true });

  // ---------- 7. Caja: la tira tiembla antes de parar y la ganadora sale con un «¡BOOM!» ----------
  document.addEventListener("transitionrun", (e) => {
    const reel = e.target;
    if (!reel.classList || !reel.classList.contains("reel") || e.propertyName !== "transform") return;
    const ms = parseFloat(getComputedStyle(reel).transitionDuration) * 1000;
    if (!(ms > 2000)) return;
    const wrap = reel.closest(".reel-wrap");
    setTimeout(() => {
      wrap?.classList.add("fx-shake");
      setTimeout(() => wrap?.classList.remove("fx-shake"), 900);
    }, ms - 1300);
  });
  const WORDS = ["¡BOOM!", "¡ZAS!", "¡PUM!", "¡TOMA!"];
  new MutationObserver((list) => {
    for (const r of list) {
      const t = r.target;
      if (!t.classList || !t.classList.contains("won") || (r.oldValue || "").includes("won")) continue;
      const wrap = t.closest(".reel-wrap");
      if (!wrap) continue;
      const b = document.createElement("div");
      b.className = "fx-boom";
      b.textContent = WORDS[Math.floor(Math.random() * WORDS.length)];
      wrap.appendChild(b);
      setTimeout(() => b.remove(), 1400);
    }
  }).observe(document.getElementById("view-ruleta") || document.body, { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });

  // ---------- 8. Sello de goma al votar ----------
  // app.js pone el sello a opacidad 1 cuando la carta sale: entonces cae como un sello y la carta tiembla
  new MutationObserver((list) => {
    for (const r of list) {
      const s = r.target;
      if (!s.classList || !s.classList.contains("stamp") || s.style.opacity !== "1") continue;
      const card = s.closest(".card");
      if (!card || !card.dataset.leaving || s.dataset.fx) continue;
      s.dataset.fx = "1";
      s.classList.add("fx-slam");
    }
  }).observe(document.getElementById("deck") || document.body, { subtree: true, attributes: true, attributeFilter: ["style"] });

  // ---------- 9. En el ordenador, las tarjetas se inclinan un poco hacia el ratón ----------
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    const TILT = ".tile-btn, .news-hero, .list-card, .link-card, .news-item, .match-hero, .weekly";
    let cur = null;
    document.addEventListener("pointermove", (e) => {
      const t = e.target.closest && e.target.closest(TILT);
      if (cur && cur !== t) { cur.classList.remove("fx-tilt"); cur.style.removeProperty("--rx"); cur.style.removeProperty("--ry"); }
      cur = t;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      const k = r.width > 400 ? 3 : 8; // las grandes, menos
      t.classList.add("fx-tilt");
      t.style.setProperty("--rx", (-y * k).toFixed(2) + "deg");
      t.style.setProperty("--ry", (x * k).toFixed(2) + "deg");
    }, { passive: true });
  }
})();
