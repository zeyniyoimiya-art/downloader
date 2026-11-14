// «El archivo ya no está en esa ruta» con el archivo delante.
//
// La ruta del historial es una promesa, no un hecho: el motor pudo sanear el
// nombre de otra forma, el post-proceso cambió la extensión o la descarga fue a
// otra carpeta. Antes se comprobaba con `existsSync` y la tarjeta mentía.
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizar, nucleo, puntuar, UMBRAL, mejorCandidato } from "@/lib/shared/parecido";
import { indiceDe, invalidarIndice, primerAncestroExistente, resolverRutaReal } from "@/lib/server/rutas";

describe("parecido: cuándo dos nombres son el mismo archivo", () => {
  it("normaliza tildes, emoji y puntuación", () => {
    expect(normalizar("Canción Ñoña 🎵 ‖ TikTok")).toBe("cancion nona tiktok");
    expect(normalizar("他不懂 (抖音DJ版)")).toBe("他不懂 抖音dj版");
  });

  it("quita el [videoId] y los sufijos del taller", () => {
    expect(normalizar(nucleo("Me at the zoo [jNQXAC9IVRw] (taller).mp3"))).toBe("me at the zoo");
    expect(normalizar(nucleo("Frozen [dQw4w9WgXcQ]_audio.m4a"))).toBe("frozen");
  });

  it("mismo nombre en otra carpeta = el mismo archivo", () => {
    const r = puntuar("/otra/carpeta/Frozen.mp3", { path: "/descargas/Frozen.mp3" });
    expect(r.nota).toBeGreaterThanOrEqual(UMBRAL);
    expect(r.motivo).toBe("exacta");
  });

  it("el identificador del vídeo manda aunque el título cambie", () => {
    const r = puntuar("/x/Un titulo completamente distinto [jNQXAC9IVRw].mp4", { path: "/y/Me at the zoo [jNQXAC9IVRw].mp4" });
    expect(r.motivo).toBe("id");
    expect(r.nota).toBeGreaterThanOrEqual(UMBRAL);
  });

  it("título con emoji/recortes y otra extensión también vale", () => {
    const r = puntuar("/x/他不懂 (抖音DJ版) - 张杰 『他留给你是背影』🎵.mp3", {
      path: "/y/他不懂 (抖音DJ版) - 张杰 『他留给你是背影』🎵.m4a",
      title: "他不懂 (抖音DJ版) - 张杰 『他留给你是背影』🎵",
    });
    expect(r.motivo).toBe("titulo");
    expect(r.nota).toBeGreaterThanOrEqual(UMBRAL);
  });

  it("nombres que no tienen nada que ver no se aceptan", () => {
    expect(puntuar("/x/Otra cancion.mp4", { path: "/y/Frozen.mp3", title: "Frozen" }).nota).toBe(0);
    expect(puntuar("/x/a.mp4", { path: "/y/b.mp4" }).nota).toBe(0);
  });

  it("a igualdad, gana el más reciente", () => {
    const lista = [
      { ruta: "/x/1/Frozen.mp3", mtime: 10 },
      { ruta: "/x/2/Frozen.mp3", mtime: 99 },
    ];
    const mejor = mejorCandidato(lista, { path: "/x/Frozen.mp3" }, (r) => lista.find((l) => l.ruta === r)?.mtime ?? 0);
    expect(mejor?.ruta).toBe("/x/2/Frozen.mp3");
  });
});

describe("resolverRutaReal: encontrar el archivo de verdad", () => {
  let base = "";
  const crear = (rel: string, bytes = 64) => {
    const p = path.join(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(bytes));
    return p;
  };

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "linyue-rutas-"));
    fs.mkdirSync(path.join(base, "out"), { recursive: true });
  });
  afterAll(() => { try { fs.rmSync(base, { recursive: true, force: true }); } catch {} });
  beforeEach(() => invalidarIndice());

  it("ruta guardada desfasada, archivo en la carpeta del autor", () => {
    const real = crear("out/Madonna/Audio/Madonna Vs Sickick - Frozen [Gf4P3iZ1Lz0].m4a");
    const vieja = path.join(base, "out", "Madonna Vs Sickick - Frozen [Gf4P3iZ1Lz0].m4a");
    const r = resolverRutaReal({ path: vieja, title: "Madonna Vs Sickick - Frozen" }, path.join(base, "out"));
    expect(r?.ruta).toBe(real);
    expect(r?.corregida).toBe(true);
  });

  it("misma canción con otra extensión (conversión)", () => {
    const real = crear("out/Otra/Canción bonita [aaaaaaaaaaa].mp3");
    const r = resolverRutaReal({ path: path.join(base, "out", "Otra", "Canción bonita [aaaaaaaaaaa].m4a") }, path.join(base, "out"));
    expect(r?.ruta).toBe(real);
    expect(r?.motivo).toBe("id");
  });

  it("el índice no ve los temporales del motor", () => {
    crear("out/Tmp/video grande [bbbbbbbbbbb].mp4.part");
    const nombres = indiceDe(path.join(base, "out")).map((x) => path.basename(x.ruta));
    expect(nombres.some((n) => n.endsWith(".part"))).toBe(false);
  });

  it("si de verdad no está, devuelve null (no inventa)", () => {
    const r = resolverRutaReal({ path: path.join(base, "out", "no-existe-jamas.mp4"), title: "Otra cosa" }, path.join(base, "out"));
    expect(r).toBeNull();
  });

  it("primerAncestroExistente sube hasta encontrar carpeta", () => {
    const hondo = path.join(base, "out", "a", "b", "c", "d", "archivo.mp4");
    expect(primerAncestroExistente(hondo)).toBe(path.join(base, "out"));
  });
});
