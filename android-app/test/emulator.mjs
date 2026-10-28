// Prueba de la app de Android en un emulador (lo lanza .github/workflows/android-test.yml).
// Instala la APK de depuración, abre Cinder y la recorre entera conectándose al WebView con Playwright (CDP).
// Guarda capturas de la pantalla real del móvil (con barras del sistema) y un informe en results/<nombre>/.
// Uso: node test/emulator.mjs <nombre> [escala de letra]
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const NAME = process.argv[2] || "android";
const FONT = process.argv[3] || "1.0";
const OUT = `results/${NAME}`;
const PKG = "io.github.ivanminguez.cinder";
mkdirSync(OUT, { recursive: true });

const adb = (...args) => execFileSync("adb", args, { encoding: "utf8", timeout: 30000 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { name: NAME, fontScale: FONT, steps: [], errors: [], console: [] };
let shot = 0;
let page = null;
const visible = (sel) => page.fn((s) => { const e = document.querySelector(s); return Boolean(e && !e.hidden && e.getClientRects().length); }, sel);

// Cliente mínimo del protocolo de DevTools (WebSocket de Node)
function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map(), handlers = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { const { ok, fail } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? fail(new Error(msg.error.message)) : ok(msg.result); }
    else if (msg.method) (handlers.get(msg.method) || []).forEach((f) => f(msg.params));
  };
  const api = {
    send: (method, params = {}) => new Promise((ok, fail) => { const i = ++id; waiting.set(i, { ok, fail }); ws.send(JSON.stringify({ id: i, method, params })); }),
    on: (ev, f) => handlers.set(ev, [...(handlers.get(ev) || []), f]),
    async eval(expression) {
      const r = await api.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    fn: (f, arg) => api.eval(`(${f.toString()})(${JSON.stringify(arg)})`),
  };
  return new Promise((ok, fail) => { ws.onopen = () => ok(api); ws.onerror = () => fail(new Error("WebSocket")); });
}
async function snap(label) {
  shot++;
  const file = `${String(shot).padStart(2, "0")}-${label}.png`;
  execSync(`adb exec-out screencap -p > ${OUT}/${file}`);
  return file;
}
function step(label, data = {}) {
  report.steps.push({ label, ...data });
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2)); // se guarda a cada paso por si algo se cuelga
  console.log(label, JSON.stringify(data));
}

async function main() {
  // Barra de navegación con 3 botones (la que más espacio ocupa) y la letra del sistema que toque
  try { adb("shell", "cmd", "overlay", "enable", "com.android.internal.systemui.navbar.threebutton"); } catch (e) { report.errors.push("navbar: " + e.message); }
  adb("shell", "settings", "put", "system", "font_scale", FONT);
  const size = adb("shell", "wm", "size");
  const density = adb("shell", "wm", "density");
  step("device", { size, density, sdk: adb("shell", "getprop", "ro.build.version.sdk") });

  // esperar a que el emulador tenga internet
  for (let i = 0; i < 30; i++) {
    try { if (adb("shell", "ping", "-c", "1", "-W", "2", "8.8.8.8").includes("1 received")) break; } catch (e) { /* aún no */ }
    await sleep(2000);
  }
  adb("install", "-r", "app-debug.apk");
  adb("shell", "pm", "clear", PKG);
  adb("shell", "am", "start", "-W", "-n", `${PKG}/.MainActivity`);
  await sleep(4000);

  // Conectar con el WebView de la app (en la APK de depuración se puede inspeccionar)
  let sock = "";
  for (let i = 0; i < 20 && !sock; i++) {
    sock = (adb("shell", "cat", "/proc/net/unix").match(/@(webview_devtools_remote_\d+)/) || [])[1] || "";
    if (!sock) await sleep(1000);
  }
  if (!sock) throw new Error("No se encuentra el WebView");
  adb("forward", "tcp:9222", `localabstract:${sock}`);
  // Protocolo de DevTools a mano (Playwright no se entiende con el WebView de Android)
  let target = null;
  for (let i = 0; i < 30 && !target; i++) {
    const list = await fetch("http://127.0.0.1:9222/json").then((r) => r.json()).catch(() => []);
    target = list.find((t) => t.type === "page" && t.url.includes("github.io")) || null;
    if (!target) await sleep(1000);
  }
  if (!target) throw new Error("No se encuentra la página de Cinder");
  page = await cdp(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  page.on("Runtime.consoleAPICalled", (p) => { if (p.type === "error" || p.type === "warning") report.console.push(p.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300)); });
  page.on("Runtime.exceptionThrown", (p) => report.errors.push("pageerror: " + (p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 300)));
  // esperar a que Cinder arranque (pantalla de entrar o la app)
  for (let i = 0; i < 40; i++) {
    if (await page.eval(`!!document.querySelector("#account-body .btn, .opt, #deck .card")`)) break;
    await sleep(500);
  }
  await sleep(1000);

  // Medidas: lo que ve la web frente a la pantalla real
  const metrics = () => page.fn(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
    const over = [...document.querySelectorAll("body *")].filter((e) => {
      if (!e.getClientRects().length) return false;
      const b = e.getBoundingClientRect();
      return b.width > 0 && (b.right > innerWidth + 1) && getComputedStyle(e).position !== "fixed";
    }).slice(0, 5).map((e) => e.className || e.tagName);
    return {
      hash: location.hash, inner: [innerWidth, innerHeight], dpr: devicePixelRatio,
      scrollW: document.documentElement.scrollWidth,
      tabbar: r(".tabbar"), topbar: r(".topbar"), overflowX: over,
      ua: navigator.userAgent.includes("CinderApp"), native: Boolean(window.Capacitor?.isNativePlatform?.()),
    };
  });

  step("gate", { ...(await metrics()), shot: await snap("gate") });
  await page.eval(`[...document.querySelectorAll("#account-body button")].find((b) => b.textContent.includes("invitado"))?.click()`);
  await sleep(1000);
  step("encuesta", { ...(await metrics()), shot: await snap("encuesta") });

  // Encuesta: la primera opción de cada pregunta (y «Solo» en la de compañía)
  for (let i = 0; i < 30; i++) {
    const r = await page.fn(() => {
      const next = document.querySelector("#q-next");
      if (!next) return "fin";
      const opts = [...document.querySelectorAll(".opt")];
      if (opts.length && !opts.some((o) => o.getAttribute("aria-pressed") === "true")) {
        (opts.find((o) => o.textContent.trim() === "Solo") || opts[0]).click();
        return "opción";
      }
      const t = next.textContent;
      next.click();
      return t;
    });
    await sleep(400);
    if (r === "fin" || r === "Ver mi match") break;
  }
  await sleep(1500);
  step("tras encuesta", { hash: await page.eval("location.hash"), shot: await snap("tras-encuesta") });

  // Tutorial: cada paso con su captura y si la tarjeta cabe en pantalla
  for (let i = 0; i < 12 && await visible(".tour-next"); i++) {
    await sleep(700);
    const t = await page.fn(() => {
      const c = document.querySelector(".tour-card").getBoundingClientRect();
      const h = document.querySelector(".tour-hole").getBoundingClientRect();
      return { count: document.querySelector(".tour-count").textContent, title: document.querySelector(".tour-title").textContent,
        card: [Math.round(c.top), Math.round(c.bottom)], hole: [Math.round(h.top), Math.round(h.bottom)], vh: innerHeight,
        cardFits: c.top >= 0 && c.bottom <= innerHeight, overlap: c.top < h.bottom && c.bottom > h.top };
    });
    step("tour", { ...t, shot: await snap(`tour-${i + 1}`) });
    // pulsar con un toque de verdad en la pantalla (si algo lo tapa, no avanza)
    await tapEl(page, ".tour-next");
    await sleep(500);
  }

  // Cada pestaña: tocar el botón de la barra de abajo con un toque real
  for (const v of ["descubrir", "novedades", "biblioteca", "para-ti", "ruleta"]) {
    const ok = await tapEl(page, `.tab[data-view="${v}"]`);
    await sleep(1500);
    step("tab " + v, { tapped: ok, ...(await metrics()), shot: await snap(v) });
  }

  // Descubrir: deslizar una carta con el dedo y abrir una ficha
  await tapEl(page, '.tab[data-view="descubrir"]');
  await sleep(1000);
  const card = await rect(page, "#deck .card:last-child, #deck .card");
  if (card) {
    const y = Math.round(card.cy), x0 = Math.round(card.cx);
    adb("shell", "input", "swipe", String(x0), String(y), String(x0 + 500), String(y), "250");
    await sleep(1200);
    step("swipe derecha", { lib: await page.fn(() => JSON.parse(localStorage.getItem("pelimatch:v1") || "{}").library?.length || 0), shot: await snap("swipe") });
  }
  await tapEl(page, "#btn-info");
  await sleep(1500);
  step("ficha", { open: await visible(".sheet"), shot: await snap("ficha") });
  adb("shell", "input", "keyevent", "4"); // botón atrás
  await sleep(1200);
  step("atrás desde ficha", { hash: await page.eval("location.hash"), sheetOpen: await visible(".sheet"), shot: await snap("atras") });

  // Caja: abrir y esperar el resultado
  await tapEl(page, '.tab[data-view="ruleta"]');
  await sleep(1000);
  await tapEl(page, "#wheel-spin");
  await sleep(8000);
  step("caja", { result: await visible("#wheel-result"), shot: await snap("caja") });

  // Buscar con el teclado del móvil
  await tapEl(page, ".topbar .icon-btn");
  await sleep(800);
  adb("shell", "input", "text", "dune");
  await sleep(1500);
  step("buscar", { query: await page.eval(`document.querySelector("input[type=search], .q-search")?.value`), results: await page.eval(`document.querySelectorAll("#view-buscar .tile, #view-buscar li").length`), shot: await snap("buscar") });

  // Mi cuenta (invitado) y el botón de Google: debe abrir el navegador
  await page.eval(`location.hash = "#cuenta"`);
  await sleep(1200);
  step("cuenta", { ...(await metrics()), shot: await snap("cuenta") });

  // Volver a abrir la app: sigue donde estaba
  adb("shell", "am", "force-stop", PKG);
  adb("shell", "am", "start", "-W", "-n", `${PKG}/.MainActivity`);
  await sleep(6000);
  step("reabrir", { shot: await snap("reabrir") });

  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}

// Toque real en el centro de un elemento: convierte coordenadas de la web a píxeles de la pantalla
let webTop = null;
async function rect(page, sel) {
  const r = await page.fn((s) => {
    const e = document.querySelector(s);
    if (!e || !e.getClientRects().length) return null;
    const b = e.getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, dpr: devicePixelRatio, vh: innerHeight };
  }, sel);
  if (!r) return null;
  if (webTop === null) {
    // dónde está el WebView en la pantalla (bounds del árbol de vistas de Android)
    let xml = "";
    try { adb("shell", "uiautomator", "dump", "/sdcard/ui.xml"); xml = adb("shell", "cat", "/sdcard/ui.xml"); } catch (e) { report.errors.push("uiautomator: " + e.message.slice(0, 100)); }
    const m = xml.match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    webTop = m ? Number(m[2]) : Math.round(24 * r.dpr); // si no, la altura normal de la barra de estado
    report.layout = { webview: m ? m.slice(1, 5).map(Number) : null, screen: adb("shell", "wm", "size"), cssH: r.vh, dpr: r.dpr };
  }
  return { cx: r.cx * r.dpr, cy: webTop + r.cy * r.dpr };
}
async function tapEl(page, sel) {
  const r = await rect(page, sel);
  if (!r) return false;
  const before = await page.fn(() => location.hash + "|" + (document.querySelector(".tour-count")?.textContent || ""));
  adb("shell", "input", "tap", String(Math.round(r.cx)), String(Math.round(r.cy)));
  await sleep(400);
  const after = await page.fn(() => location.hash + "|" + (document.querySelector(".tour-count")?.textContent || ""));
  return before !== after ? "changed" : "same";
}

main().catch((e) => {
  report.errors.push("fatal: " + e.message);
  console.error(e);
  try { execSync(`adb exec-out screencap -p > ${OUT}/zz-fallo.png`); } catch (x) { /* nada */ }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
