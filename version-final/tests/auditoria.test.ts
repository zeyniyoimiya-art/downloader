// Fase 10 · auditoría: abrir carpetas, títulos del historial y caché de fichas.
//
// Los tres salieron de mirar la app con lupa:
//  · «abrir carpeta» mandaba a Documentos cuando el archivo no existía,
//  · el historial se llenaba de «https://youtu.be/…» como título,
//  · la vista previa volvía a extraer metadatos una y otra vez.
import { describe, expect, it, beforeEach } from "vitest";
import { queAbrir, rutaPermitida } from "../src/lib/shared/abrir";
import { autorDeRuta, esUrl, tituloDeArchivo, tituloFinal } from "../src/lib/shared/nombres";
import {
  alturasDe, claveSonda, guardarSonda, leerSonda, limpiarSondas, mejorAudioDe, tamanoDe, tamanoSondas,
} from "../src/lib/server/probe-cache";

// ── Abrir carpeta ───────────────────────────────────────────────────────────
describe("queAbrir", () => {
  it("con el archivo en su sitio, lo selecciona", () => {
    expect(queAbrir({ existe: true, esArchivo: true, existeCarpeta: true })).toEqual({ tipo: "seleccionar" });
  });

  it("si falta el archivo pero está la carpeta, abre la carpeta y avisa", () => {
    const r = queAbrir({ existe: false, esArchivo: false, existeCarpeta: true });
    expect(r.tipo).toBe("carpeta");
    if (r.tipo === "carpeta") expect(r.aviso).toMatch(/ya no está/i);
  });

  it("si no hay ni archivo ni carpeta, no lanza nada", () => {
    const r = queAbrir({ existe: false, esArchivo: false, existeCarpeta: false });
    expect(r.tipo).toBe("nada");
    if (r.tipo === "nada") expect(r.error).toMatch(/movido o borrado/i);
  });

  it("una carpeta que existe se abre tal cual", () => {
    expect(queAbrir({ existe: true, esArchivo: false, existeCarpeta: true })).toEqual({ tipo: "seleccionar" });
  });
});

describe("rutaPermitida", () => {
  it("la propia raíz está permitida", () => {
    expect(rutaPermitida("/home/u/Linyue", ["/home/u/Linyue"])).toBe(true);
  });
  it("lo de dentro está permitido", () => {
    expect(rutaPermitida("/home/u/Linyue/Autor/x.mp3", ["/home/u/Linyue"])).toBe(true);
  });
  it("lo de fuera no", () => {
    expect(rutaPermitida("/home/u/Otra/x.mp3", ["/home/u/Linyue"])).toBe(false);
  });
  it("no se deja engañar por un prefijo parecido", () => {
    expect(rutaPermitida("/home/u/Linyue-vieja/x.mp3", ["/home/u/Linyue"])).toBe(false);
  });
  it("funciona con rutas de Windows", () => {
    expect(rutaPermitida("C:\\Users\\Z\\Downloads\\Linyue\\a.mp3", ["C:\\Users\\Z\\Downloads\\Linyue"], "\\")).toBe(true);
    expect(rutaPermitida("C:\\Windows\\system32\\x.dll", ["C:\\Users\\Z\\Downloads\\Linyue"], "\\")).toBe(false);
  });
});

// ── Títulos del historial ───────────────────────────────────────────────────
describe("títulos", () => {
  it("reconoce una URL", () => {
    expect(esUrl("https://youtu.be/Gf4P3iZ1Lz0")).toBe(true);
    expect(esUrl("Eternxlkz - DEIXA ROLAR")).toBe(false);
  });

  it("saca el título del nombre del archivo", () => {
    expect(tituloDeArchivo("C:\\x\\Eternxlkz - DEIXA ROLAR [dQw4w9WgXcQ].m4a")).toBe("Eternxlkz - DEIXA ROLAR");
    expect(tituloDeArchivo("/tmp/Charla (taller).mp3")).toBe("Charla");
  });

  it("no toca un nombre que ya está limpio", () => {
    expect(tituloDeArchivo("/tmp/胡桃 - 断线.mp3")).toBe("胡桃 - 断线");
  });

  it("si el motor dio un título bueno, se respeta", () => {
    expect(tituloFinal("Eternxlkz - DEIXA ROLAR", "/tmp/x [abc].mp3")).toBe("Eternxlkz - DEIXA ROLAR");
  });

  it("si el «título» es una URL, se deduce del archivo", () => {
    expect(tituloFinal("https://youtu.be/Gf4P3iZ1Lz0", "/tmp/DEIXA ROLAR [abc].m4a")).toBe("DEIXA ROLAR");
  });

  it("sin nada, no se inventa un vacío", () => {
    expect(tituloFinal("", "/tmp/.mp3")).toBe("Sin título");
  });

  it("el autor sale de la carpeta del canal", () => {
    expect(autorDeRuta("/home/u/Linyue/Sound Surround Music/x.mp3", "/home/u/Linyue")).toBe("Sound Surround Music");
    expect(autorDeRuta("/home/u/Linyue/x.mp3", "/home/u/Linyue")).toBe("");
    expect(autorDeRuta("/home/u/Linyue/Audio/x.mp3", "/home/u/Linyue")).toBe("");
  });
});

// ── Caché de fichas ─────────────────────────────────────────────────────────
const json = {
  title: "Demo",
  duration: 215,
  formats: [
    { vcodec: "avc1", height: 1080, filesize: 900 },
    { vcodec: "vp9", height: 2160, filesize: 3000 },
    { vcodec: "none", acodec: "opus", abr: 160 },
    { vcodec: "none", acodec: "mp4a.40.2", abr: 128 },
  ],
};

describe("probe-cache", () => {
  beforeEach(() => limpiarSondas());

  it("guarda y devuelve la misma sonda", () => {
    const k = claveSonda("https://x/1", "video");
    guardarSonda(k, json, { title: "Demo" });
    expect(leerSonda(k)?.respuesta.title).toBe("Demo");
  });

  it("la clave incluye el modo: el motor puede cambiar", () => {
    expect(claveSonda("https://x/1", "audio")).not.toBe(claveSonda("https://x/1", "video"));
  });

  it("caduca", () => {
    const k = claveSonda("https://x/2", "video");
    guardarSonda(k, json, {});
    expect(leerSonda(k, -1)).toBeNull(); // TTL negativo = siempre caducado
  });

  it("no se come la memoria: límite de entradas", () => {
    for (let i = 0; i < 200; i++) guardarSonda(claveSonda(`https://x/${i}`, "video"), json, {});
    expect(tamanoSondas()).toBeLessThanOrEqual(60);
  });

  it("no guarda un JSON absurdo", () => {
    const gigante = { relleno: "x".repeat(8 * 1024 * 1024) };
    const k = claveSonda("https://x/grande", "video");
    guardarSonda(k, gigante, {});
    expect(leerSonda(k)).toBeNull();
  });

  it("alturas ordenadas y sin repetir", () => {
    expect(alturasDe(json)).toEqual([2160, 1080]);
  });

  it("tamaño del mejor vídeo", () => {
    expect(tamanoDe(json)).toBe(3000);
    expect(tamanoDe({})).toBeUndefined();
  });

  it("códec del mejor audio de solo-audio", () => {
    expect(mejorAudioDe(json)).toMatchObject({ codec: "opus", abr: 160 });
  });
});
