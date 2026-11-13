// Fase 9 · recortes, SponsorBlock, capítulos, suscripciones y apagado.
//
// Se prueba lo que puede romperse en silencio: que un texto de recorte mal
// escrito NO llegue al motor, que un canal nuevo encole solo lo nuevo, y que el
// apagado no se dispare por su cuenta.
import { describe, expect, it, afterEach } from "vitest";
import {
  argSponsor, describirSeccion, describirSponsor, parseSeccion, parseSecciones,
  SPONSOR_QUITAR, TPL_CAPITULOS,
} from "../src/lib/shared/recortes";
import { buildArgs, plantillaSalida, type ArgOptions } from "../src/lib/shared/args";
import { detect } from "../src/lib/shared/platforms";
import {
  describirRevision, nuevosIds, parseListado, podarVistos, proximaRevision,
  tocaRevisar, urlDesdeId, horasValidas, MAX_VISTOS, type Sub,
} from "../src/lib/shared/subs";
import { _resetApagado, cancelarApagado, estadoApagado } from "../src/lib/server/power";

// ── Recortes ─────────────────────────────────────────────────────────────────
describe("parseSecciones", () => {
  it("entiende mm:ss-mm:ss", () => {
    const [s] = parseSecciones("1:00-2:30");
    expect(s.desde).toBe(60);
    expect(s.hasta).toBe(150);
    expect(s.argumento).toBe("*1:00-2:30");
  });

  it("mezcla minutos y segundos sueltos", () => {
    const [s] = parseSecciones("0:45-90");
    expect(s.desde).toBe(45);
    expect(s.hasta).toBe(90);
  });

  it("acepta horas", () => {
    const [s] = parseSecciones("01:02:03-01:05:00");
    expect(s.desde).toBe(3723);
    expect(s.hasta).toBe(3900);
  });

  it("acepta el asterisco de «relativo al vídeo»", () => {
    expect(parseSeccion("*10:00-11:00")?.argumento).toBe("*10:00-11:00");
  });

  it("acepta varias secciones separadas por comas", () => {
    const s = parseSecciones("0:10-0:20, 1:00-1:30");
    expect(s).toHaveLength(2);
    expect(s[1].desde).toBe(60);
  });

  it("ignora espacios", () => {
    const s = parseSecciones(" 1:00 - 2:30 ");
    expect(s).toHaveLength(1);
    expect(s[0].desde).toBe(60);
  });

  it("rechaza lo que no es un recorte", () => {
    for (const malo of ["", "   ", "abc", "1:00", "1:00-", "-2:00", "2:30-1:00", "1:00-1:00", "1:00--2:00"]) {
      expect(parseSecciones(malo), malo).toEqual([]);
    }
  });

  it("rechaza más de 20 secciones (casi seguro, un error de pegado)", () => {
    const muchas = Array.from({ length: 21 }, (_, i) => `${i}:00-${i}:30`).join(",");
    expect(parseSecciones(muchas)).toEqual([]);
  });

  it("describe la sección en lenguaje humano", () => {
    const s = parseSeccion("1:00-2:30")!;
    expect(describirSeccion(s)).toBe("1:00 → 2:30 (90s)");
  });
});

// ── SponsorBlock ─────────────────────────────────────────────────────────────
describe("argSponsor", () => {
  it("apagado no añade nada", () => {
    expect(argSponsor("off")).toEqual([]);
    expect(argSponsor(null)).toEqual([]);
    expect(argSponsor(undefined)).toEqual([]);
  });

  it("marcar usa --sponsorblock-mark con todas las categorías", () => {
    expect(argSponsor("marcar")).toEqual(["--sponsorblock-mark", SPONSOR_QUITAR]);
  });

  it("quitar usa --sponsorblock-remove con todas las categorías", () => {
    expect(argSponsor("quitar")).toEqual(["--sponsorblock-remove", SPONSOR_QUITAR]);
  });

  it("las categorías que se quitan incluyen patrocinio e intro", () => {
    const cats = SPONSOR_QUITAR.split(",");
    expect(cats).toContain("sponsor");
    expect(cats).toContain("intro");
    expect(cats).toContain("outro");
  });

  it("hay descripción para las tres opciones", () => {
    for (const m of ["off", "marcar", "quitar"] as const) expect(describirSponsor(m)).toBeTruthy();
  });
});

// ── Plantilla de salida y banderas del motor ────────────────────────────────
describe("plantillaSalida", () => {
  it("sin capítulos devuelve la plantilla normal", () => {
    expect(plantillaSalida("ordenado", false, false)).not.toContain("%(section_number)");
  });

  it("con capítulos lleva número y título de sección", () => {
    const t = plantillaSalida("ordenado", false, true);
    expect(t).toContain("%(section_number)");
    expect(t).toContain("%(section_title)");
    expect(t.endsWith("/" + TPL_CAPITULOS)).toBe(true);
  });

  it("conserva la carpeta de la plantilla elegida", () => {
    for (const naming of ["ordenado", "compacto", "plano", "fecha"]) {
      const base = plantillaSalida(naming, false, false);
      const carpeta = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
      expect(plantillaSalida(naming, false, true), naming).toBe(carpeta + TPL_CAPITULOS);
    }
  });

  it("audio y vídeo usan plantillas distintas", () => {
    const audio = plantillaSalida("ordenado", true, false);
    const video = plantillaSalida("ordenado", false, false);
    expect(audio).not.toBe(video);
  });
});

describe("buildArgs con recortes", () => {
  const base: ArgOptions = {
    mode: "video", format: "mp4", quality: "1080", outputDir: "/tmp/salida",
    turbo: false, aria2Healthy: false, noRepeat: false, embedMetadata: false,
    archiveFile: "/tmp/archivo.txt", profileLimit: 5, cookies: null, ffmpegDir: null,
  };

  it("no mete banderas de recorte si no se piden", () => {
    const a = buildArgs("yt-dlp", detect("https://www.youtube.com/watch?v=abc12345678")!, base)!;
    expect(a).not.toContain("--download-sections");
    expect(a).not.toContain("--sponsorblock-mark");
    expect(a.join(" ")).not.toContain("--split-chapters");
  });

  it("marca patrocinios cuando se pide", () => {
    const a = buildArgs("yt-dlp", detect("https://www.youtube.com/watch?v=abc12345678")!, { ...base, sponsorblock: "marcar" })!;
    const i = a.indexOf("--sponsorblock-mark");
    expect(i).toBeGreaterThan(-1);
    expect(a[i + 1]).toBe(SPONSOR_QUITAR);
  });

  it("recorta con --download-sections y limpia el trozo", () => {
    const a = buildArgs("yt-dlp", detect("https://www.youtube.com/watch?v=abc12345678")!, { ...base, sections: "1:00-2:30" })!;
    const i = a.indexOf("--download-sections");
    expect(a[i + 1]).toBe("*1:00-2:30");
  });

  it("ignora un recorte inválido en vez de pasárselo al motor", () => {
    const a = buildArgs("yt-dlp", detect("https://www.youtube.com/watch?v=abc12345678")!, { ...base, sections: "basura" })!;
    expect(a).not.toContain("--download-sections");
  });

  it("parte por capítulos y cambia la plantilla de nombre", () => {
    const a = buildArgs("yt-dlp", detect("https://www.youtube.com/watch?v=abc12345678")!, { ...base, splitChapters: true })!;
    expect(a).toContain("--split-chapters");
    expect(a[a.indexOf("-o") + 1]).toContain("%(section_number)");
  });

  it("las banderas van ANTES del separador --", () => {
    const a = buildArgs("yt-dlp", detect("https://www.youtube.com/watch?v=abc12345678")!, { ...base, sponsorblock: "quitar", sections: "0:10-0:20", splitChapters: true })!;
    const sep = a.indexOf("--");
    expect(sep).toBeGreaterThan(-1);
    expect(a.indexOf("--sponsorblock-remove")).toBeLessThan(sep);
    expect(a.indexOf("--download-sections")).toBeLessThan(sep);
    expect(a.indexOf("--split-chapters")).toBeLessThan(sep);
  });
});

// ── Suscripciones ───────────────────────────────────────────────────────────
const subBase: Sub = {
  id: "abc123", url: "https://www.youtube.com/@canal", label: "canal", mode: "video",
  format: "mp4", quality: "1080", everyHours: 6, lastCheck: 0, nextCheck: 0, seen: [], maxNuevos: 5,
};

describe("nuevosIds", () => {
  it("no repite lo ya visto", () => {
    expect(nuevosIds(["a", "b"], ["b", "c", "a", "d"])).toEqual(["c", "d"]);
  });

  it("respeta el límite por revisión", () => {
    expect(nuevosIds([], ["1", "2", "3", "4", "5", "6", "7"], 3)).toEqual(["1", "2", "3"]);
  });

  it("no duplica dentro del propio listado", () => {
    expect(nuevosIds([], ["x", "x", "y"])).toEqual(["x", "y"]);
  });

  it("con todo visto no devuelve nada", () => {
    expect(nuevosIds(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("ignora entradas vacías", () => {
    expect(nuevosIds([], ["", "a"])).toEqual(["a"]);
  });
});

describe("podarVistos", () => {
  it("corta por la cola, no por la cabeza", () => {
    expect(podarVistos(["nuevo", "medio", "viejo"], 2)).toEqual(["nuevo", "medio"]);
  });

  it("no toca listas cortas", () => {
    expect(podarVistos(["a", "b"], 10)).toEqual(["a", "b"]);
  });

  it("el tope por defecto son 3000", () => {
    const grande = Array.from({ length: MAX_VISTOS + 50 }, (_, i) => `id${i}`);
    expect(podarVistos(grande)).toHaveLength(MAX_VISTOS);
  });
});

describe("tocaRevisar / proximaRevision", () => {
  it("una suscripción nueva se revisa al momento", () => {
    expect(tocaRevisar(subBase, 1000)).toBe(true);
  });

  it("no se revisa antes de tiempo", () => {
    const ahora = 10_000_000;
    expect(tocaRevisar({ ...subBase, nextCheck: ahora + 60_000 }, ahora)).toBe(false);
  });

  it("se revisa cuando llega la hora", () => {
    const ahora = 10_000_000;
    expect(tocaRevisar({ ...subBase, nextCheck: ahora }, ahora)).toBe(true);
  });

  it("tras 5 fallos seguidos deja de reintentar sola", () => {
    expect(tocaRevisar({ ...subBase, fallos: 5 }, Date.now())).toBe(false);
    expect(tocaRevisar({ ...subBase, fallos: 4 }, Date.now())).toBe(true);
  });

  it("la próxima revisión respeta las horas configuradas", () => {
    expect(proximaRevision(6, 0)).toBe(6 * 3600_000);
    expect(proximaRevision(24, 0)).toBe(24 * 3600_000);
  });

  it("las horas se acotan entre 1 y 168", () => {
    expect(horasValidas(0)).toBe(1);
    expect(horasValidas(-5)).toBe(1);
    expect(horasValidas(999)).toBe(168);
    expect(horasValidas(NaN)).toBe(6);
    expect(horasValidas(7.4)).toBe(7);
  });
});

describe("parseListado", () => {
  it("lee «id url» por línea", () => {
    const r = parseListado("abc123 https://www.youtube.com/watch?v=abc123\ndef456 https://www.youtube.com/watch?v=def456\n");
    expect(r).toHaveLength(2);
    expect(r[1].id).toBe("def456");
    expect(r[1].url).toContain("def456");
  });

  it("acepta líneas con solo el ID", () => {
    const r = parseListado("abc123\n");
    expect(r[0]).toEqual({ id: "abc123", url: null });
  });

  it("ignora líneas vacías y separadores de Windows", () => {
    expect(parseListado("\r\n\r\nabc\r\n")).toEqual([{ id: "abc", url: null }]);
  });

  it("no deja pasar un id gigante", () => {
    expect(parseListado("x".repeat(300))).toEqual([]);
  });
});

describe("urlDesdeId", () => {
  it("reconstruye la URL de YouTube", () => {
    expect(urlDesdeId("https://www.youtube.com/@canal", "abc123")).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("reconstruye la de Bilibili", () => {
    expect(urlDesdeId("https://space.bilibili.com/123", "BV1xx411c7mD")).toBe("https://www.bilibili.com/video/BV1xx411c7mD");
  });

  it("no inventa URLs en sitios cuyo patrón no conoce", () => {
    expect(urlDesdeId("https://vimeo.com/canal", "123")).toBeNull();
  });

  it("rechaza IDs con caracteres raros", () => {
    expect(urlDesdeId("https://www.youtube.com/@x", "../../etc/passwd")).toBeNull();
  });
});

describe("describirRevision", () => {
  it("lo nunca revisado se dice tal cual", () => {
    expect(describirRevision({ ...subBase, lastCheck: 0 }, Date.now())).toContain("nunca");
  });

  it("cuenta las horas transcurridas", () => {
    const ahora = Date.now();
    expect(describirRevision({ ...subBase, lastCheck: ahora - 2 * 3600_000 }, ahora)).toContain("hace 2 h");
  });

  it("recuerda cada cuánto se revisa", () => {
    expect(describirRevision(subBase, Date.now())).toContain("cada 6 h");
  });
});

// ── Apagado ─────────────────────────────────────────────────────────────────
describe("apagado al terminar", () => {
  afterEach(() => _resetApagado());

  it("recién arrancado no hay apagado pendiente", () => {
    _resetApagado();
    const e = estadoApagado();
    expect(e.en).toBeNull();
  });

  it("sabe si el sistema lo soporta", () => {
    expect(typeof estadoApagado().soportado).toBe("boolean");
  });

  it("cancelar sin apagado pendiente no falla ni lanza procesos", () => {
    _resetApagado();
    expect(cancelarApagado().ok).toBe(true);
    expect(estadoApagado().en).toBeNull();
  });
});
