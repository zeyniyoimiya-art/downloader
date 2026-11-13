#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TEST_DIR = path.join(ROOT, "test");
const PORT = 3099;
const BASE = `http://127.0.0.1:${PORT}`;

// Usar process.execPath (node.exe) + el CLI de next directamente.
// Evita problemas de espacios en rutas con npx.cmd y shell:true en Windows.
const NEXT_CLI = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const NODE_EXE = process.execPath;

// Log a archivo para poder sondear el progreso sin bloquear
const LOG_FILE = path.join(__dirname, "e2e-run.log");
fs.writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Inicio del test E2E\n`);
const _origLog = console.log.bind(console);
console.log = (...a) => { _origLog(...a); try { fs.appendFileSync(LOG_FILE, a.join(" ") + "\n"); } catch {} };
process.on("uncaughtException", (e) => { console.log("UNCAUGHT:", e?.message || String(e)); });
process.on("unhandledRejection", (e) => { console.log("UNHANDLED:", e?.message || String(e)); });
// Capturar también stderr en el log (si no, las causas de muerte quedan invisibles)
const _origErr = console.error.bind(console);
console.error = (...a) => { _origErr(...a); try { fs.appendFileSync(LOG_FILE, "STDERR: " + a.map(x => x?.stack || x?.message || String(x)).join(" ") + "\n"); } catch {} };

const SUITE = [
  // ── YouTube: 8 formatos (audio + video) ──
  { name: "YouTube MP3",  platform: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mode: "audio", format: "mp3",  quality: "best" },
  { name: "YouTube M4A",  platform: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mode: "audio", format: "m4a",  quality: "best" },
  { name: "YouTube WAV",  platform: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mode: "audio", format: "wav",  quality: "best" },
  { name: "YouTube FLAC", platform: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mode: "audio", format: "flac", quality: "best" },
  { name: "YouTube OPUS", platform: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mode: "audio", format: "opus", quality: "best" },
  { name: "YouTube MP4",  platform: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mode: "video", format: "mp4",  quality: "480" },
  { name: "YouTube MKV",  platform: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mode: "video", format: "mkv",  quality: "480" },
  { name: "YouTube WEBM", platform: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mode: "video", format: "webm", quality: "480" },
  // ── TikTok ──
  { name: "TikTok MP4", platform: "tiktok", url: "https://www.tiktok.com/@scout2015/video/6718335390845095173", mode: "video", format: "mp4", quality: "480" },
  { name: "TikTok MP3", platform: "tiktok", url: "https://www.tiktok.com/@scout2015/video/6718335390845095173", mode: "audio", format: "mp3", quality: "best" },
  // ── X/Twitter: tweet verificado con video (yt-dlp _TESTS) ──
  { name: "X Video", platform: "x", url: "https://twitter.com/BrooklynNets/status/1349794411333394432", mode: "video", format: "mp4", quality: "480" },
  { name: "X Foto",  platform: "x", url: "https://twitter.com/BrooklynNets/status/1349794411333394432", mode: "photo", format: "original", quality: "best" },
  // ── Facebook (reel público de los tests de yt-dlp) ──
  { name: "Facebook MP4", platform: "facebook", url: "https://www.facebook.com/video.php?v=274175099429670", mode: "video", format: "mp4", quality: "480" },
  // ── Instagram reel (verificado: 8 formatos de video) ──
  { name: "Instagram Reel", platform: "instagram", url: "https://www.instagram.com/reel/DeDfpT1gDm_", mode: "video", format: "mp4", quality: "480" },
  // ── Pinterest (pin vivo, gallery-dl) ──
  { name: "Pinterest Foto", platform: "pinterest", url: "https://www.pinterest.com/pin/323485185757914429/", mode: "photo", format: "original", quality: "best" },
  // ── SoundCloud ──
  { name: "SoundCloud MP3", platform: "soundcloud", url: "https://soundcloud.com/forss/flickermood", mode: "audio", format: "mp3", quality: "best" },
  // ── Bilibili (verificado: 80s, 8.7MiB — los vídeos largos corta el edge
  //    Akamai de esta red en el byte 89.4MB, límite del CDN, no de la app) ──
  { name: "Bilibili MP4", platform: "bilibili", url: "https://www.bilibili.com/video/BV1nx411u79K", mode: "video", format: "mp4", quality: "480" },
  // ── Spotify ──
  { name: "Spotify MP3", platform: "spotify", url: "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh", mode: "audio", format: "mp3", quality: "best" },
  // ── Douyin: pide cookies frescas (sin necesidad de login) ──
  { name: "Douyin Video", platform: "douyin", url: "https://www.douyin.com/video/7685438549092843151", mode: "video", format: "mp4", quality: "480", expect: "cookies" },
  // ── Perfil X: gallery-dl pide cookies de X ──
  { name: "Perfil X Fotos", platform: "x-profile", url: "https://x.com/YanYanCosplay/media", mode: "photo", format: "original", quality: "best", expect: "cookies" },
  // ── Threads: sin extractor en ningún motor → rechazo honesto ──
  { name: "Threads (sin soporte)", platform: "threads", url: "https://www.threads.net/@threads/post/DACJgJSOSu3", mode: "video", format: "mp4", quality: "480", expect: "unsupported" },
];

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  return res.json();
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function countFiles(dir) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && !e.name.endsWith(".part")) n++;
      else if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    }
  } catch {}
  return n;
}

async function main() {
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // Staging de cookies: copiar las cookies reales del usuario (si existen) al
  // DATA_DIR de pruebas, igual que en producción. El servidor de tests usa
  // LINYUE_DATA=test/.linyue-test, así que sin este paso plataformas con login
  // (x-profile, douyin) acaban en NEEDS_COOKIES aunque el usuario SÍ tenga cookies.
  const PROD_COOKIES = path.join(process.env.LINYUE_DATA_PROD || path.join(os.homedir(), ".linyue"), "cookies");
  const SANDBOX_COOKIES = path.join(TEST_DIR, ".linyue-test", "cookies");
  try {
    if (fs.existsSync(PROD_COOKIES)) {
      fs.mkdirSync(SANDBOX_COOKIES, { recursive: true });
      let n = 0;
      for (const f of fs.readdirSync(PROD_COOKIES)) {
        if (!f.endsWith(".txt")) continue;
        fs.copyFileSync(path.join(PROD_COOKIES, f), path.join(SANDBOX_COOKIES, f));
        n++;
      }
      if (n) console.log(`Cookies del usuario copiadas al sandbox: ${n} archivo(s)`);
    }
  } catch (e) { console.log("No se pudieron copiar cookies:", e?.message || e); }

  console.log("Levantando servidor en puerto", PORT);
  console.log(`  Node: ${NODE_EXE}`);
  console.log(`  Next CLI: ${NEXT_CLI}`);

  // Spawn SIN shell: node.exe ejecuta el script de next directamente
  const server = spawn(NODE_EXE, [NEXT_CLI, "dev", "-p", String(PORT)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      LINYUE_DATA: path.join(TEST_DIR, ".linyue-test"),
      PORT: String(PORT),
    },
  });

  let out = "";
  server.stdout.on("data", d => out += d);
  server.stderr.on("data", d => out += d);

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try {
      if ((await fetch(BASE + "/api/health")).ok) { ready = true; break; }
    } catch {}
    if (server.exitCode !== null) {
      console.error("Server died:\n", out.slice(-2000));
      process.exit(1);
    }
  }
  if (!ready) {
    console.error("Timeout esperando servidor:\n", out.slice(-2000));
    server.kill();
    process.exit(1);
  }
  console.log("Servidor listo\n");

  // Config: PUT con config completo (POST resetea; y noRepeat=false para poder
  // probar varios formatos del mismo video sin que el archive lo salte)
  try {
    const cur = await fetchJSON(BASE + "/api/config");
    await fetchJSON(BASE + "/api/config", {
      method: "PUT",
      body: JSON.stringify({ ...cur, outputDir: TEST_DIR, noRepeat: false }),
    });
    console.log("Config OK: outputDir=" + TEST_DIR + ", noRepeat=false");
  } catch (e) { console.log("Config falló:", e?.message || e); }

  const results = [];
  // Filtro opcional: node e2e-real.mjs <subcadena> (p.ej. "bilibili")
  const filtros = (process.argv[2] || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const suite = filtros.length
    ? SUITE.filter(t => filtros.some(f => t.platform.includes(f) || t.name.toLowerCase().includes(f)))
    : SUITE;
  if (filtros.length) console.log(`Filtro: "${filtros.join(",")}" → ${suite.length} tests`);
  // SECUENCIAL a propósito: en la ronda 1, tests del mismo URL en paralelo
  // colisionaban (.part y renombres compartidos del mismo video de YouTube)
  for (const tc of suite) {
    const tag = `[${tc.platform}] ${tc.name}`;
    console.log(`Enqueue: ${tag}`);
    try {
      const res = await fetchJSON(BASE + "/api/jobs", {
        method: "POST",
        body: JSON.stringify({ urls: [tc.url], mode: tc.mode, format: tc.format, quality: tc.quality }),
      });
      if (res.rejected?.length) {
        const motivo = String(res.rejected[0]);
        const status = tc.expect === "unsupported" ? "UNSUPPORTED" : "REJECTED";
        results.push({ ...tc, status, detail: motivo });
        console.log(`${status}: ${tag} — ${motivo}`);
        continue;
      }
      const ids = (res.added || []).map(j => j.id);
      if (!ids.length) {
        results.push({ ...tc, status: "SKIP" });
        console.log(`SKIP: ${tag}`);
        continue;
      }
      // Esperar hasta 180s por job (descargas reales pueden ser lentas)
      const t0 = Date.now();
      let st = "unknown";
      while (Date.now() - t0 < 180000) {
        await sleep(3000);
        const jobs = await fetchJSON(BASE + "/api/jobs");
        const j = jobs.find(x => ids.includes(x.id));
        if (!j) continue;
        if (["done", "error", "canceled", "skipped"].includes(j.state)) { st = j.state; break; }
      }
      if (st === "done") {
        results.push({ ...tc, status: "PASS" });
        console.log(`PASS: ${tag}`);
      } else {
        const jobs = await fetchJSON(BASE + "/api/jobs");
        const j = jobs.find(x => ids.includes(x.id));
        const detail = String(j?.error || st);
        // Douyin/perfil X sin cookies NO es fallo del app: es estado esperado
        const status = tc.expect === "cookies" && /cookie/i.test(detail) ? "COOKIES" : "FAIL";
        results.push({ ...tc, status, detail });
        console.log(`${status}: ${tag} — ${detail}`);
      }
    } catch (e) {
      results.push({ ...tc, status: "FAIL", detail: e.message });
      console.log(`FAIL: ${tag} — ${e.message}`);
    }
  }

  // Mover todo a test/passed/ (fusionando carpetas de la ronda 1)
  const passedDir = path.join(TEST_DIR, "passed");
  fs.mkdirSync(passedDir, { recursive: true });
  const merge = (src, dst) => {
    if (fs.existsSync(dst)) {
      if (fs.statSync(dst).isDirectory() && fs.statSync(src).isDirectory()) {
        for (const e of fs.readdirSync(src)) merge(path.join(src, e), path.join(dst, e));
        try { fs.rmSync(src, { recursive: true, force: true }); } catch {}
        return;
      }
      try { fs.rmSync(dst, { force: true }); } catch {}
    }
    try { fs.renameSync(src, dst); } catch {}
  };
  if (results.some(r => r.status === "PASS")) {
    for (const e of fs.readdirSync(TEST_DIR, { withFileTypes: true })) {
      if (e.name === "passed" || e.name === ".linyue-test") continue;
      merge(path.join(TEST_DIR, e.name), path.join(passedDir, e.name));
    }
  }

  console.log("\n" + "═".repeat(70));
  console.log("=== REPORTE E2E REAL (ronda 2) ===");
  console.log("═".repeat(70));
  const count = (s) => results.filter(r => r.status === s).length;
  const p = results.filter(r => r.status === "PASS");
  const f = results.filter(r => ["FAIL", "ERROR", "REJECTED"].includes(r.status));
  const ck = results.filter(r => r.status === "COOKIES");
  const un = results.filter(r => r.status === "UNSUPPORTED");
  console.log(`Total: ${results.length} | PASS: ${p.length} | FAIL: ${f.length} | NEEDS_COOKIES: ${ck.length} | SIN_SOPORTE: ${un.length} | SKIP: ${count("SKIP")}`);
  console.log(`Archivos en test/passed/: ${countFiles(passedDir)}`);
  if (p.length) {
    console.log("\n✅ Pasaron:");
    for (const x of p) console.log(`  [${x.platform}] ${x.name} (${x.format})`);
  }
  if (f.length) {
    console.log("\n❌ Fallaron:");
    for (const x of f) console.log(`  [${x.platform}] ${x.name}: ${x.detail}`);
  }
  if (ck.length) {
    console.log("\n🍪 Requieren cookies del usuario (esperado, no es bug):");
    for (const x of ck) console.log(`  [${x.platform}] ${x.name}: ${x.detail}`);
  }
  if (un.length) {
    console.log("\n🚫 Sin extractor en ningún motor (rechazo honesto):");
    for (const x of un) console.log(`  [${x.platform}] ${x.name}: ${x.detail}`);
  }
  console.log("\n— Cobertura por red —");
  for (const pl of [...new Set(results.map(r => r.platform))]) {
    const rows = results.filter(r => r.platform === pl);
    const ok = rows.filter(r => r.status === "PASS").length;
    const nota = rows.some(r => r.status === "COOKIES") ? " [necesita cookies]"
      : rows.some(r => r.status === "UNSUPPORTED") ? " [sin extractor]" : "";
    console.log(`  ${pl}: ${ok}/${rows.length} OK${nota}`);
  }
  console.log("═".repeat(70));

  server.kill("SIGTERM");
  await sleep(2000);
  if (server.exitCode === null) server.kill("SIGKILL");
  try { fs.rmSync(path.join(TEST_DIR, ".linyue-test"), { recursive: true, force: true }); } catch {}

  process.exit(f.length > 0 ? 1 : 0);
}
main().catch(e => { console.error("MAIN_ERROR:", e); process.exit(1); });
