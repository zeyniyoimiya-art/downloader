// Regresión del «le doy a la ubicación del archivo y no abre nada / me manda a
// Documentos».
//
//  · `spawn("explorer", ["/select,", ruta])` → dos argumentos, Explorer recibe
//    `/select,` suelto y abre Documentos.
//  · `spawn("explorer", ["/select," + ruta])` con una ruta CON ESPACIOS
//    («Madonna Vs Sickick - Frozen.m4a») tampoco: Node entrecomilla el
//    argumento entero y Explorer solo acepta las comillas alrededor de la RUTA.
//    La buena es `/select,"C:\…\archivo con espacios.mp4"` +
//    `windowsVerbatimArguments: true`.
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface Llamada { cmd: string; args: string[]; opts: Record<string, unknown> }
const llamadas: Llamada[] = [];

vi.mock("node:child_process", () => ({
  spawn: (cmd: string, args: string[], opts: Record<string, unknown> = {}) => {
    llamadas.push({ cmd, args, opts });
    const oyentes: Record<string, ((...a: unknown[]) => void)[]> = {};
    const hijo = {
      on: (ev: string, fn: (...a: unknown[]) => void) => { (oyentes[ev] ??= []).push(fn); return hijo; },
      unref: () => {},
      kill: () => true,
      pid: 4242,
      stdout: null,
      stderr: null,
    };
    // `lanzar()` espera el evento `spawn`, que es la señal fiable en Windows
    // (explorer.exe termina siempre con código 1).
    queueMicrotask(() => (oyentes.spawn ?? []).forEach((f) => f()));
    return hijo;
  },
}));

import { abrirEnSistema, comandoAlterno, comandoPara } from "@/lib/server/abrir-sistema";

describe("comandoPara (Windows)", () => {
  it("seleccionar: UN argumento, con las comillas DENTRO y verbatim", () => {
    const r = comandoPara("win32", "C:\\Users\\Zenith\\Descargas\\Madonna Vs Sickick - Frozen.m4a", true);
    expect(r.cmd).toBe("explorer.exe");
    // Un solo argumento (el fallo original: dos).
    expect(r.args).toHaveLength(1);
    // Las comillas envuelven la RUTA, no el conjunto.
    expect(r.args[0]).toBe('/select,"C:\\Users\\Zenith\\Descargas\\Madonna Vs Sickick - Frozen.m4a"');
    // Sin esto, Node escapa las comillas internas y Explorer vuelve a ignorarlo.
    expect(r.opciones.windowsVerbatimArguments).toBe(true);
  });

  it("abrir carpeta: la ruta entrecomillada", () => {
    const r = comandoPara("win32", "D:\\Mis Descargas", false);
    expect(r.args).toEqual(['"D:\\Mis Descargas"']);
    expect(r.opciones.windowsVerbatimArguments).toBe(true);
  });

  it("no deja una barra final dentro de las comillas (rompería el escapado)", () => {
    expect(comandoPara("win32", "C:\\carpeta\\", false).args).toEqual(['"C:\\carpeta"']);
    // La raíz de una unidad se respeta tal cual.
    expect(comandoPara("win32", "C:\\", false).args).toEqual(['"C:\\"']);
  });

  it("hay un plan B por cmd /c start", () => {
    const b = comandoAlterno("win32", "C:\\a b\\v.mp4", true);
    expect(b?.cmd).toBe("cmd.exe");
    expect(b?.args).toEqual(["/c", "start", "", "explorer.exe", '/select,"C:\\a b\\v.mp4"']);
    expect(comandoAlterno("linux", "/tmp/x", true)).toBeNull();
  });
});

describe("comandoPara (macOS y Linux)", () => {
  it("macOS: -R para seleccionar", () => {
    const r = comandoPara("darwin", "/Users/yo/v.mp4", true);
    expect(r.cmd).toBe("open");
    expect(r.args).toEqual(["-R", "/Users/yo/v.mp4"]);
    expect(r.opciones.windowsVerbatimArguments).toBeUndefined();
  });

  it("Linux: xdg-open abre la carpeta contenedora", () => {
    expect(comandoPara("linux", "/home/yo/salida/v.mp4", true)).toEqual({ cmd: "xdg-open", args: ["/home/yo/salida"], metodo: "xdg-open", opciones: {} });
  });
});

describe("abrirEnSistema", () => {
  let dir = "";
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "linyue abrir ")); // con espacio a propósito
    fs.writeFileSync(path.join(dir, "clip con espacios.mp4"), "x");
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it("con un archivo real lanza el comando una sola vez", async () => {
    llamadas.length = 0;
    const r = await abrirEnSistema(path.join(dir, "clip con espacios.mp4"), true);
    expect(r.ok).toBe(true);
    expect(r.aviso).toBeUndefined();
    expect(r.comando).toBeTruthy();
    expect(llamadas).toHaveLength(1);
  });

  it("si el archivo no está pero la carpeta sí, abre la carpeta y avisa", async () => {
    llamadas.length = 0;
    const r = await abrirEnSistema(path.join(dir, "fantasma.mp4"), true);
    expect(r.ok).toBe(true);
    expect(r.destino).toBe(dir);
    expect(r.aviso).toMatch(/carpeta/i);
    expect(llamadas).toHaveLength(1);
  });

  it("si el archivo y su carpeta no están, abre la carpeta más cercana que SÍ existe", async () => {
    llamadas.length = 0;
    const r = await abrirEnSistema(path.join(dir, "no", "existe", "nada.mp4"), true);
    // Antes se devolvía error y el usuario se quedaba sin nada. Ahora abre lo
    // más cercano que existe (la carpeta de salida, normalmente) y lo cuenta.
    expect(r.ok).toBe(true);
    expect(r.destino).toBe(dir);
    expect(r.aviso).toMatch(/más cercana/i);
    expect(llamadas).toHaveLength(1);
  });

  it("si no hay NADA cerca (solo la raíz del disco), no abre nada y lo explica", async () => {
    llamadas.length = 0;
    const r = await abrirEnSistema("/no-existe-linyue/a/b/c/d.mp4", true);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no existe|no hay ninguna carpeta/i);
    expect(llamadas).toHaveLength(0); // nunca se manda a Explorer a ciegas
  });

  it("una carpeta con «seleccionar» se abre tal cual y se avisa", async () => {
    llamadas.length = 0;
    const r = await abrirEnSistema(dir, true);
    expect(r.ok).toBe(true);
    expect(r.aviso).toMatch(/carpeta/i);
  });
});
