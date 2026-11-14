// Errores de verdad, tal como los escupe yt-dlp, traducidos a algo accionable.
//
// El caso que originó esto: «Could not copy Chrome cookie database. See
// https://github.com/yt-dlp/yt-dlp/issues/7271 for more info» en la cola de una
// app de escritorio. Ni explica qué pasó ni qué hacer, y encima se queda ahí
// para siempre porque no se reintenta.
import { describe, expect, it } from "vitest";
import { causaDeError, errorParaAviso, esErrorDeCookies, explicarError } from "../src/lib/shared/errores";

const COOKIES_CHROME =
  "ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info";

describe("errores de cookies", () => {
  it("reconoce el error real de yt-dlp", () => {
    expect(esErrorDeCookies(COOKIES_CHROME)).toBe(true);
  });

  it("reconoce variantes (Edge, perfil bloqueado, cifrado nuevo)", () => {
    expect(esErrorDeCookies("ERROR: Could not copy Edge cookie database.")).toBe(true);
    expect(esErrorDeCookies("failed to decrypt with DPAPI")).toBe(true);
    expect(esErrorDeCookies("Permission denied while reading cookies")).toBe(true);
  });

  it("no confunde un 403 normal con un problema de cookies", () => {
    expect(esErrorDeCookies("ERROR: unable to download video data: HTTP Error 403")).toBe(false);
    expect(esErrorDeCookies("")).toBe(false);
    expect(esErrorDeCookies(undefined)).toBe(false);
  });

  it("la explicación dice qué hacer: cerrar el navegador o exportar cookies", () => {
    const e = explicarError(COOKIES_CHROME);
    expect(e.causa).toBe("cookies");
    expect(e.titulo).toMatch(/cookies/i);
    expect(e.arreglo).toMatch(/ciérralo|cerrarlo|exporta/i);
    expect(e.arreglo).toMatch(/cookies/i);
  });

  it("el aviso de sistema cabe en una frase", () => {
    const t = errorParaAviso(COOKIES_CHROME);
    expect(t).toContain("cookies");
    expect(t.length).toBeLessThan(400);
  });
});

describe("otras causas", () => {
  const casos: [string, string][] = [
    ["ERROR: Sign in to confirm you're not a bot. Use --cookies", "bot"],
    ["ERROR: Private video. Sign in if you've been granted access", "privado"],
    ["ERROR: This video is not available in your country", "geo"],
    ["ERROR: Requested format is not available", "formato"],
    ["OSError: [Errno 28] No space left on device", "disco"],
    ["ERROR: unable to download: Connection reset by peer", "red"],
    ["FileNotFoundError: [WinError 2] yt-dlp.exe", "motor"],
  ];

  for (const [msg, esperado] of casos) {
    it(`clasifica «${msg.slice(0, 40)}…» como ${esperado}`, () => {
      expect(causaDeError(msg)).toBe(esperado);
      const e = explicarError(msg);
      expect(e.causa).toBe(esperado);
      expect(e.titulo.length).toBeGreaterThan(3);
      expect(e.arreglo.length).toBeGreaterThan(3); // siempre dice qué hacer
    });
  }

  it("un mensaje desconocido se muestra limpio, sin ERROR: ni stack", () => {
    const e = explicarError('ERROR: algo raro pasó\nTraceback (most recent call last):\n  File "x.py"');
    expect(e.causa).toBe("otro");
    expect(e.titulo.startsWith("ERROR:")).toBe(false);
    expect(e.titulo).not.toContain("Traceback");
    expect(e.titulo).toContain("algo raro pasó");
  });

  it("mensaje vacío no rompe nada", () => {
    expect(explicarError("").titulo).toBe("Falló la descarga");
    expect(explicarError(null).arreglo).toBe("");
  });

  it("no deja pasar un mensaje kilométrico a la interfaz", () => {
    expect(explicarError("x".repeat(5000)).titulo.length).toBeLessThanOrEqual(200);
  });
});
