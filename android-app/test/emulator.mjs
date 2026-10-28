// Prueba de la app de Android en un emulador (lo lanza .github/workflows/android-test.yml).
// Instala la APK de depuración, abre Cinder y la recorre entera conectándose al WebView con Playwright (CDP).
// Guarda capturas de la pantalla real del móvil (con barras del sistema) y un informe en results/<nombre>/.
// Uso: node test/emulator.mjs <nombre> [escala de letra]
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const NAME = process.argv[2] || "android";
const FONT = process.argv[3] || "1.0";
const OUT = `results/${NAME}`;
const PKG = "io.github.ivanminguez.cinder";
mkdirSync(OUT, { recursive: true });

const adb = (...args) => execFileSync("adb", args, { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { name: NAME, fontScale: FONT, steps: [], errors: [], console: [] };
let shot = 0;
async function snap(label) {
  shot++;
  const file = `${String(shot).padStart(2, "0")}-${label}.png`;
  execSync(`adb exec-out screencap -p > ${OUT}/${file}`);
  return file;
}
function step(label, data = {}) {
  report.steps.push({ label, ...data });
  console.log(label, JSON.stringify(data));
}

async function main() {
  // Barra de navegación con 3 botones (la que más espacio ocupa) y la letra del sistema que toque
  try { adb("shell", "cmd", "overlay", "enable", "com.android.internal.systemui.navbar.threebutton"); } catch (e) { report.errors.push("navbar: " + e.message); }
  adb("shell", "settings", "put", "system", "font_scale", FONT);
  const size = adb("shell", "wm", "size");
  const density = adb("shell", "wm", "density");
  step("device", { size, density, sdk: adb("shell", "getprop", "ro.build.version.sdk") });

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
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  let page = null;
  for (let i = 0; i < 30 && !page; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("github.io")) || null;
    if (!page) await sleep(1000);
  }
  if (!page) throw new Error("No se encuentra la página de Cinder");
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") report.console.push(m.text()); });
  page.on("pageerror", (e) => report.errors.push("pageerror: " + e.message));
  await page.waitForLoadState("load");
  await sleep(3000);

  // Medidas: lo que ve la web frente a la pantalla real
  const metrics = () => page.evaluate(() => {
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
  await page.click("text=Seguir como invitado");
  await sleep(1000);
  step("encuesta", { ...(await metrics()), shot: await snap("encuesta") });

  // Encuesta: las primeras opciones de cada pregunta
  await page.click(".opt >> text=Solo").catch(() => page.click(".opt >> nth=0"));
  await page.click(".opt >> nth=0");
  await page.click("#q-next");
  await page.click(".opt >> nth=0");
  for (let i = 0; i < 12; i++) {
    const nx = await page.$("#q-next");
    if (!nx) break;
    const t = await nx.textContent();
    await nx.click();
    await sleep(250);
    if (t === "Ver mi match") break;
  }
  await sleep(1500);

  // Tutorial: cada paso con su captura y si la tarjeta cabe en pantalla
  for (let i = 0; i < 12 && await page.isVisible(".tour-next"); i++) {
    await sleep(700);
    const t = await page.evaluate(() => {
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
    step("swipe derecha", { lib: await page.evaluate(() => JSON.parse(localStorage.getItem("pelimatch:v1") || "{}").library?.length || 0), shot: await snap("swipe") });
  }
  await tapEl(page, "#btn-info");
  await sleep(1500);
  step("ficha", { open: await page.isVisible(".sheet"), shot: await snap("ficha") });
  adb("shell", "input", "keyevent", "4"); // botón atrás
  await sleep(1200);
  step("atrás desde ficha", { hash: await page.evaluate(() => location.hash), sheetOpen: await page.isVisible(".sheet"), shot: await snap("atras") });

  // Caja: abrir y esperar el resultado
  await tapEl(page, '.tab[data-view="ruleta"]');
  await sleep(1000);
  await tapEl(page, "#wheel-spin");
  await sleep(8000);
  step("caja", { result: await page.isVisible("#wheel-result"), shot: await snap("caja") });

  // Buscar con el teclado del móvil
  await tapEl(page, ".topbar .icon-btn");
  await sleep(800);
  adb("shell", "input", "text", "dune");
  await sleep(1500);
  step("buscar", { results: await page.locator(".search-results .tile, #search-results > *").count().catch(() => -1), shot: await snap("buscar") });

  // Mi cuenta (invitado) y el botón de Google: debe abrir el navegador
  await page.evaluate(() => { location.hash = "#cuenta"; });
  await sleep(1200);
  step("cuenta", { ...(await metrics()), shot: await snap("cuenta") });

  // Volver a abrir la app: sigue donde estaba
  adb("shell", "am", "force-stop", PKG);
  adb("shell", "am", "start", "-W", "-n", `${PKG}/.MainActivity`);
  await sleep(6000);
  step("reabrir", { shot: await snap("reabrir") });

  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close().catch(() => {});
}

// Toque real en el centro de un elemento: convierte coordenadas de la web a píxeles de la pantalla
let webTop = null;
async function rect(page, sel) {
  const r = await page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e || !e.getClientRects().length) return null;
    const b = e.getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, dpr: devicePixelRatio, vh: innerHeight };
  }, sel);
  if (!r) return null;
  if (webTop === null) {
    // dónde está el WebView en la pantalla (bounds del árbol de vistas de Android)
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
    const xml = adb("shell", "cat", "/sdcard/ui.xml");
    const m = xml.match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    webTop = m ? Number(m[2]) : 0;
    report.layout = { webview: m ? m.slice(1, 5).map(Number) : null, screen: adb("shell", "wm", "size"), cssH: r.vh, dpr: r.dpr };
  }
  return { cx: r.cx * r.dpr, cy: webTop + r.cy * r.dpr };
}
async function tapEl(page, sel) {
  const r = await rect(page, sel);
  if (!r) return false;
  const before = await page.evaluate(() => location.hash + "|" + (document.querySelector(".tour-count")?.textContent || ""));
  adb("shell", "input", "tap", String(Math.round(r.cx)), String(Math.round(r.cy)));
  await sleep(400);
  const after = await page.evaluate(() => location.hash + "|" + (document.querySelector(".tour-count")?.textContent || ""));
  return before !== after ? "changed" : "same";
}

main().catch((e) => {
  report.errors.push("fatal: " + e.message);
  console.error(e);
  try { execSync(`adb exec-out screencap -p > ${OUT}/zz-fallo.png`); } catch (x) { /* nada */ }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
