// Letras: buscar sí, equivocarse no.
//
// La prueba que importa aquí es la de la versión japonesa de «Never Gonna Give
// You Up»: LRCLIB devuelve 20 resultados y el primero NO es la canción que el
// usuario bajó. Puntuar es lo que evita pegar la letra equivocada dentro del
// archivo.
import { describe, expect, it } from "vitest";
import { comparable, elegirLetra, lrcAPlano, puntuarLetra, UMBRAL_LETRA } from "@/lib/server/letras";

const Q = { titulo: "Never Gonna Give You Up", artista: "Rick Astley", duracion: 213 };

describe("comparable", () => {
  it("normaliza acentos, mayúsculas y puntuación", () => {
    expect(comparable("Canción Ñoña")).toBe("cancion nona");
    expect(comparable("  Hello, World!!  ")).toBe("hello world");
  });
  it("quita el ruido de YouTube y los feat.", () => {
    expect(comparable("Song (Official Video)")).toBe("song");
    expect(comparable("Song (feat. Otro)")).toBe("song");
  });
  it("conserva chino y japonés (hay canciones que sólo existen así)", () => {
    expect(comparable("刀群舞 (Dj酷炫版)")).toContain("刀群舞");
  });
});

describe("lrcAPlano", () => {
  it("quita las marcas de tiempo y deja el texto en orden", () => {
    const lrc = "[00:19.67] We're no strangers to love\n[00:23.56] You know the rules";
    expect(lrcAPlano(lrc)).toBe("We're no strangers to love\nYou know the rules");
  });
  it("no deja líneas vacías si el LRC las trae", () => {
    expect(lrcAPlano("[00:01.00] a\n\n[00:02.00] b\n")).toBe("a\nb");
  });

  it("quita también las marcas de palabra del LRC «enhanced»", () => {
    // LRCLIB devuelve esto tal cual para «Never Gonna Give You Up». Antes se
    // colaba entero dentro del archivo: «<00:18.89>we're <00:19.25>no…».
    const lrc = "[00:18.89] <00:18.89>We're <00:19.25>no <00:19.53>strangers <00:20.07>to <00:20.33>love";
    expect(lrcAPlano(lrc)).toBe("We're no strangers to love");
    expect(lrcAPlano(lrc)).not.toContain("<");
  });
});

describe("puntuarLetra", () => {
  it("la canción correcta pasa de sobra el umbral", () => {
    const nota = puntuarLetra({ trackName: "Never Gonna Give You Up", artistName: "Rick Astley", duration: 214 }, Q);
    expect(nota).toBeGreaterThanOrEqual(UMBRAL_LETRA);
    expect(nota).toBeGreaterThan(100);
  });

  it("misma canción con OTRO artista se queda corta (es una versión)", () => {
    const nota = puntuarLetra({ trackName: "Never Gonna Give You Up", artistName: "Reinaeiry", duration: 193 }, Q);
    expect(nota).toBeLessThan(100);
  });

  it("otra canción con el título parecido pero la duración muy distinta no pasa", () => {
    const nota = puntuarLetra({ trackName: "Never Gonna Give You Up (Live)", artistName: "Rick Astley", duration: 400 }, Q);
    expect(nota).toBeLessThan(puntuarLetra({ trackName: "Never Gonna Give You Up", artistName: "Rick Astley", duration: 214 }, Q));
  });

  it("una canción distinta da 0", () => {
    expect(puntuarLetra({ trackName: "Bohemian Rhapsody", artistName: "Queen", duration: 354 }, Q)).toBe(0);
  });
});

describe("elegirLetra", () => {
  const correcta = { trackName: "Never Gonna Give You Up", artistName: "Rick Astley", duration: 214, plainLyrics: "We're no strangers to love\nYou know the rules", syncedLyrics: "[00:19.67] We're no strangers to love\n[00:23.56] You know the rules" };
  const japonesa = { trackName: "NEVER GONNA GIVE YOU UP", artistName: "倉木麻衣", duration: 240, plainLyrics: "x".repeat(50), syncedLyrics: "[00:30.30] Never gonna give you up" };

  it("elige la correcta aunque la lista venga con la versión japonesa primero", () => {
    const l = elegirLetra([japonesa, correcta], Q);
    expect(l?.texto).toContain("We're no strangers");
    expect(l?.sincronizada).toBe(true);
    expect(l?.fuente).toBe("LRCLIB");
  });

  it("prefiere la sincronizada cuando las dos son la misma canción", () => {
    const sinSync = { ...correcta, syncedLyrics: null };
    expect(elegirLetra([sinSync, correcta], Q)?.sincronizada).toBe(true);
  });

  it("guarda TEXTO PLANO aunque la elegida venga sincronizada", () => {
    // La etiqueta `lyrics` no entiende LRC: dentro del archivo nunca hay marcas.
    const l = elegirLetra([correcta], Q);
    expect(l?.texto).toBe("We're no strangers to love\nYou know the rules");
    expect(l?.texto).not.toMatch(/\[\d\d:/);
  });

  it("descarta instrumentales y textos demasiado cortos", () => {
    expect(elegirLetra([{ ...correcta, instrumental: true }], Q)).toBeNull();
    expect(elegirLetra([{ ...correcta, plainLyrics: "corto", syncedLyrics: null }], Q)).toBeNull();
  });

  it("sin candidatos o con basura devuelve null (nunca lanza)", () => {
    expect(elegirLetra(undefined, Q)).toBeNull();
    expect(elegirLetra([], Q)).toBeNull();
    expect(elegirLetra([{} as never], Q)).toBeNull();
  });

  it("si sólo hay texto plano, lo devuelve marcado como no sincronizado", () => {
    const l = elegirLetra([{ ...correcta, syncedLyrics: null }], Q);
    expect(l?.sincronizada).toBe(false);
    expect(l?.texto).toContain("strangers");
  });

  it("no deja pasar una letra de más de 40 000 caracteres", () => {
    const enorme = { ...correcta, plainLyrics: "a".repeat(90000), syncedLyrics: null };
    expect((elegirLetra([enorme], Q)?.texto.length ?? 0)).toBeLessThanOrEqual(40000);
  });
});
