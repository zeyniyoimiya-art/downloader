// Regresión del «me manda a otra carpeta y no al archivo».
//
// En el Taller se lanzaba `spawn("explorer", ["/select,", ruta])`: DOS
// argumentos. Explorer recibía `/select,` suelto, no sabía qué seleccionar y se
// abría en su última carpeta (Documentos). La forma correcta es UN argumento:
// `"/select,C:\ruta\archivo.mp4"`.
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const llamadas: { cmd: string; args: string[] }[] = [];

vi.mock("node:child_process", () => ({
  spawn: (cmd: string, args: string[]) => {
    llamadas.push({ cmd, args });
    // Se devuelve un hijo falso con la superficie que usa la app (.on, .unref).
    return { on: () => {}, unref: () => {}, kill: () => true, pid: 4242, stdout: null, stderr: null };
  },
}));

import { abrirEnSistema, comandoPara } from "@/lib/server/abrir-sistema";

describe("comandoPara", () => {
  it("Windows: seleccionar = UN solo argumento /select,<ruta>", () => {
    const r = comandoPara("win32", "C:\\Users\\Yo\\Mis descargas\\video.mp4", true);
    expect(r.cmd).toBe("explorer.exe");
    expect(r.args).toEqual(["/select,C:\\Users\\Yo\\Mis descargas\\video.mp4"]);
    // Lo que estaba mal: dos elementos en el array.
    expect(r.args).toHaveLength(1);
  });

  it("Windows: abrir carpeta = la ruta a secas", () => {
    expect(comandoPara("win32", "D:\\Salida", false)).toEqual({ cmd: "explorer.exe", args: ["D:\\Salida"] });
  });

  it("macOS: -R para seleccionar", () => {
    expect(comandoPara("darwin", "/Users/yo/v.mp4", true)).toEqual({ cmd: "open", args: ["-R", "/Users/yo/v.mp4"] });
    expect(comandoPara("darwin", "/Users/yo", false)).toEqual({ cmd: "open", args: ["/Users/yo"] });
  });

  it("Linux: xdg-open no sabe seleccionar, abre la carpeta contenedora", () => {
    expect(comandoPara("linux", "/home/yo/salida/v.mp4", true)).toEqual({ cmd: "xdg-open", args: ["/home/yo/salida"] });
    expect(comandoPara("linux", "/home/yo/salida", false)).toEqual({ cmd: "xdg-open", args: ["/home/yo/salida"] });
  });
});

describe("abrirEnSistema", () => {
  let dir = "";
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "linyue-abrir-"));
    fs.writeFileSync(path.join(dir, "clip.mp4"), "x");
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it("con un archivo real lanza el comando una sola vez", () => {
    llamadas.length = 0;
    const r = abrirEnSistema(path.join(dir, "clip.mp4"), true);
    expect(r.ok).toBe(true);
    expect(r.aviso).toBeUndefined();
    expect(llamadas).toHaveLength(1);
  });

  it("si el archivo no está pero la carpeta sí, abre la carpeta y avisa", () => {
    llamadas.length = 0;
    const r = abrirEnSistema(path.join(dir, "fantasma.mp4"), true);
    expect(r.ok).toBe(true);
    expect(r.destino).toBe(dir);
    expect(r.aviso).toMatch(/carpeta/i);
    expect(llamadas).toHaveLength(1);
  });

  it("si no existe nada, NO lanza nada y lo explica", () => {
    llamadas.length = 0;
    const r = abrirEnSistema(path.join(dir, "no", "existe", "nada.mp4"), true);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no existen|ni su carpeta existen/i);
    expect(llamadas).toHaveLength(0); // nunca se manda a Explorer a ciegas
  });

  it("una carpeta con «seleccionar» se abre tal cual y se avisa", () => {
    llamadas.length = 0;
    const r = abrirEnSistema(dir, true);
    expect(r.ok).toBe(true);
    expect(r.aviso).toMatch(/carpeta/i);
  });
});
