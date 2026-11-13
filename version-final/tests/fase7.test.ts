// Tests de la fase 7: cola persistente, nombres, proxy, rangos y espacio.
import { afterEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { ConfigSchema, getConfig } from "../src/lib/server/store";
import { buildArgs, plantillaSalida, type ArgOptions } from "../src/lib/shared/args";
import { detect } from "../src/lib/shared/platforms";
import { aPersistible, esTransitorio, guardarCola, leerCola, reanudar, type JobPersistido } from "../src/lib/server/queue-store";

const d = detect("https://www.youtube.com/watch?v=abc")!;
const base: ArgOptions = {
  outputDir: "D:\\Descargas", profileLimit: 50, noRepeat: false, archiveFile: "D:\\a.txt",
  turbo: false, cookies: null, ffmpegDir: null, ffmpegPath: null, tempDir: null,
  quality: "1080", mode: "video", format: "mp4", aria2Healthy: false, embedMetadata: true,
};

const trabajo = (cam: Partial<JobPersistido> = {}): JobPersistido => ({
  id: "abc123", url: "https://youtu.be/x", platform: "youtube", label: "YouTube",
  mode: "video", format: "mp4", quality: "1080", engine: "yt-dlp",
  state: "queued", title: "t", thumbnail: "", files: [], log: [], createdAt: Date.now(), ...cam,
});

describe("cola persistente", () => {
  it("reconoce los estados transitorios", () => {
    for (const e of ["probing", "running", "post"]) expect(esTransitorio(e)).toBe(true);
    for (const e of ["queued", "done", "error", "canceled", "skipped", "paused"]) expect(esTransitorio(e)).toBe(false);
  });

  it("reanudar convierte lo que estaba corriendo en 'queued' y lo deja dicho", () => {
    const [j] = reanudar([trabajo({ state: "running" })]);
    expect(j.state).toBe("queued");
    expect(j.log.at(-1)).toMatch(/reanudado/i);
  });

  it("reanudar no toca los estados finales", () => {
    const [j] = reanudar([trabajo({ state: "done" })]);
    expect(j.state).toBe("done");
    expect(j.log).toHaveLength(0);
  });

  it("acota el log al guardar (la cola no es el historial)", () => {
    const enorme = trabajo({ log: Array.from({ length: 500 }, (_, i) => `línea ${i}`) });
    const g = aPersistible(enorme);
    expect(g.log.length).toBeLessThanOrEqual(120);
    expect(g.log.at(-1)).toBe("línea 499"); // se quedan las ÚLTIMAS
  });

  it("guarda y lee del disco (round-trip) y tolera un JSON roto", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyq-"));
    vi.stubEnv("LINYUE_DATA", dir);
    vi.resetModules();
    const mod = await import("../src/lib/server/queue-store");
    mod.guardarCola([trabajo({ id: "x1" }), trabajo({ id: "x2", state: "done" })]);
    const leidos = mod.leerCola();
    expect(leidos.map((j) => j.id).sort()).toEqual(["x1", "x2"]);
    // JSON corrupto → lista vacía, sin lanzar (un archivo roto no puede impedir arrancar)
    fs.writeFileSync(path.join(dir, "queue.json"), "{esto no es json");
    expect(mod.leerCola()).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("no arrastra archivos temporales .tmp al leer", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyq2-"));
    vi.stubEnv("LINYUE_DATA", dir);
    vi.resetModules();
    const mod = await import("../src/lib/server/queue-store");
    mod.guardarCola([trabajo()]);
    expect(fs.existsSync(path.join(dir, "queue.json.tmp"))).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("nombres de archivo", () => {
  it("cada estilo devuelve su plantilla, con audio en su subcarpeta", () => {
    expect(plantillaSalida("ordenado")).toContain("%(uploader");
    expect(plantillaSalida("ordenado", true)).toContain("Audio/");
    expect(plantillaSalida("compacto")).not.toContain("uploader");
    expect(plantillaSalida("plano")).not.toContain("[%(id)s]");
    expect(plantillaSalida("fecha")).toContain("%(upload_date");
  });

  it("un estilo desconocido cae al ordenado, no rompe", () => {
    expect(plantillaSalida("inventado")).toBe(plantillaSalida("ordenado"));
  });

  it("la plantilla llega a los argumentos del motor", () => {
    const a = buildArgs("yt-dlp", d, { ...base, naming: "plano" });
    const i = a.indexOf("-o");
    expect(a[i + 1]).toBe(plantillaSalida("plano"));
  });
});

describe("proxy y rangos", () => {
  it("el proxy se pasa a yt-dlp, curl y streamlink con el flag de cada uno", () => {
    const y = buildArgs("yt-dlp", d, { ...base, proxy: "socks5://127.0.0.1:1080" });
    expect(y.join(" ")).toContain("--proxy socks5://127.0.0.1:1080");
    const c = buildArgs("curl", detect("https://example.com/a.zip")!, { ...base, proxy: "http://1.2.3.4:8080" });
    expect(c.join(" ")).toContain("--proxy http://1.2.3.4:8080");
    const s = buildArgs("streamlink", detect("https://www.twitch.tv/x")!, { ...base, proxy: "http://1.2.3.4:8080" });
    expect(s.join(" ")).toContain("--http-proxy http://1.2.3.4:8080");
  });

  it("sin proxy no se añade el flag", () => {
    expect(buildArgs("yt-dlp", d, base)).not.toContain("--proxy");
  });

  it("el rango se aplica a listas y perfiles, y no a un vídeo suelto", () => {
    const lista = detect("https://www.youtube.com/playlist?list=PL123")!;
    const a = buildArgs("yt-dlp", lista, { ...base, playlistRange: "1-20" });
    expect(a.join(" ")).toContain("--playlist-items 1-20");
    const suelto = buildArgs("yt-dlp", d, { ...base, playlistRange: "1-20" });
    expect(suelto.join(" ")).not.toContain("--playlist-items");
  });
});

describe("validación de ajustes nuevos", () => {
  const cfg = getConfig();

  it("acepta proxys y rangos correctos", () => {
    for (const proxy of ["", "http://127.0.0.1:7890", "socks5://10.0.0.2:1080", "https://proxy.local:3128"]) {
      expect(ConfigSchema.safeParse({ ...cfg, proxy }).success, proxy).toBe(true);
    }
    for (const r of ["", "1-20", "-10", "5", "1,3,7-9"]) {
      expect(ConfigSchema.safeParse({ ...cfg, playlistRange: r }).success, r).toBe(true);
    }
  });

  it("rechaza proxys con credenciales y esquemas raros", () => {
    for (const proxy of ["http://user:pass@host:8080", "ftp://host:21", "127.0.0.1:7890", "http://host:99999"]) {
      expect(ConfigSchema.safeParse({ ...cfg, proxy }).success, proxy).toBe(false);
    }
  });

  it("rechaza rangos con inyección de argumentos", () => {
    for (const r of ["1-20; rm -rf /", "$(whoami)", "1-", "--exec calc", "1..20"]) {
      expect(ConfigSchema.safeParse({ ...cfg, playlistRange: r }).success, r).toBe(false);
    }
  });
});

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
