// Fase 9 · taller (conversor local).
//
// Lo que puede salir mal en silencio y por eso se prueba: que el recorte se
// aplique en el sitio correcto del comando, que la calidad elegida llegue a
// ffmpeg, y que el progreso se lea bien (si no, la barra se queda en 0 %).
import { describe, expect, it } from "vitest";
import {
  argsTaller, avisoConversion, nombreSalida, porcentaje, recorteATexto,
  segundosDeProgreso, sinExtension, type OpcionesTaller,
} from "../src/lib/shared/taller";

const base: OpcionesTaller = {
  ruta: "/tmp/entrada/Charla.mp4",
  destino: "audio",
  formato: "mp3",
};

describe("nombres", () => {
  it("quita la extensión", () => {
    expect(sinExtension("/tmp/Charla.mp4")).toBe("Charla");
    expect(sinExtension("C:\\Users\\yo\\Charla.mp4")).toBe("Charla");
  });

  it("la salida lleva (taller) y la misma carpeta", () => {
    expect(nombreSalida("/tmp/Charla.mp4", "mp3")).toBe("/tmp/Charla (taller).mp3");
    expect(nombreSalida("/tmp/entrada/Charla.mp4", "mp3")).toBe("/tmp/entrada/Charla (taller).mp3");
  });

  it("funciona con rutas de Windows", () => {
    expect(nombreSalida("C:\\v\\Charla.mp4", "mkv")).toBe("C:\\v\\Charla (taller).mkv");
  });

  it("nunca sobrescribe el original", () => {
    expect(nombreSalida("/tmp/Charla.mp4", "mp4")).not.toBe("/tmp/Charla.mp4");
  });
});

describe("argsTaller · audio", () => {
  const a = argsTaller(base);
  it("quita el vídeo", () => expect(a).toContain("-vn"));
  it("pide progreso parseable", () => {
    expect(a).toContain("-progress");
    expect(a[a.indexOf("-progress") + 1]).toBe("pipe:1");
  });
  it("escribe el archivo de salida al final", () => {
    expect(a.at(-1)).toBe("/tmp/entrada/Charla (taller).mp3");
  });
  it("no pasa metadatos por alto", () => expect(a).toContain("-map_metadata"));
});

describe("argsTaller · vídeo y compresión", () => {
  it("aplica el CRF pedido", () => {
    const a = argsTaller({ ...base, destino: "video", formato: "mkv", codec: "h264", crf: 28 });
    const i = a.indexOf("-crf");
    expect(i).toBeGreaterThan(-1);
    expect(a[i + 1]).toBe("28");
  });

  it("acota el CRF a un rango sensato", () => {
    const bajo = argsTaller({ ...base, destino: "video", formato: "mp4", codec: "h264", crf: 5 });
    expect(bajo[bajo.indexOf("-crf") + 1]).toBe("14");
    const alto = argsTaller({ ...base, destino: "video", formato: "mp4", codec: "h264", crf: 99 });
    expect(alto[alto.indexOf("-crf") + 1]).toBe("32");
  });

  it("sin recodificar usa copia de flujos", () => {
    const a = argsTaller({ ...base, destino: "copia", formato: "mkv" });
    expect(a.join(" ")).toContain("-c copy");
    expect(a).not.toContain("-crf");
  });

  it("normaliza el volumen cuando se pide", () => {
    expect(argsTaller({ ...base, normalizar: true }).join(" ")).toContain("loudnorm");
    expect(argsTaller(base).join(" ")).not.toContain("loudnorm");
  });
});

describe("argsTaller · recorte", () => {
  it("corta con -ss y -to después de la entrada (corte preciso)", () => {
    const a = argsTaller({ ...base, desde: 60, hasta: 150 });
    const iEntrada = a.indexOf("-i");
    const iDesde = a.indexOf("-ss");
    expect(iDesde).toBeGreaterThan(iEntrada);
    expect(a[iDesde + 1]).toBe("60");
    expect(a[a.indexOf("-to") + 1]).toBe("150");
  });

  it("sin recorte no mete banderas de corte", () => {
    const a = argsTaller(base);
    expect(a).not.toContain("-ss");
    expect(a).not.toContain("-to");
  });

  it("solo desde el principio no añade -ss", () => {
    const a = argsTaller({ ...base, desde: 0, hasta: 30 });
    expect(a).not.toContain("-ss");
    expect(a).toContain("-to");
  });
});

describe("progreso", () => {
  it("lee out_time_us", () => {
    expect(segundosDeProgreso("out_time_us=1500000")).toBe(1.5);
  });

  it("lee out_time_ms (que también viene en microsegundos)", () => {
    expect(segundosDeProgreso("out_time_ms=2000000")).toBe(2);
  });

  it("ignora las líneas que no son de tiempo", () => {
    expect(segundosDeProgreso("frame=120")).toBeNull();
    expect(segundosDeProgreso("speed=1.2x")).toBeNull();
    expect(segundosDeProgreso("")).toBeNull();
  });

  it("calcula el porcentaje con la duración", () => {
    expect(porcentaje(60, 120)).toBe(50);
    expect(porcentaje(0, 120)).toBe(0);
    expect(porcentaje(500, 120)).toBe(100); // nunca pasa de 100
    expect(porcentaje(60, 0)).toBe(0); // sin duración no se inventa un número
  });
});

describe("recorteATexto", () => {
  it("describe el recorte", () => {
    expect(recorteATexto(60, 150)).toBe("1:00-2:30");
  });
  it("con horas", () => {
    expect(recorteATexto(3723, 3900)).toBe("1:02:03-1:05:00");
  });
  it("sin recorte devuelve vacío", () => {
    expect(recorteATexto(null, null)).toBe("");
  });
  it("hasta el final", () => {
    expect(recorteATexto(60, null)).toBe("1:00-fin");
  });
});

describe("avisoConversion", () => {
  it("avisa cuando el formato ya es el de origen", () => {
    expect(avisoConversion("/tmp/a.mp3", "mp3", "audio")).toContain("Ya es MP3");
  });
  it("no avisa si se cambia de formato", () => {
    expect(avisoConversion("/tmp/a.mp4", "mp3", "audio")).toBeNull();
  });
  it("con copia no hay nada que avisar", () => {
    expect(avisoConversion("/tmp/a.mp3", "mp3", "copia")).toBeNull();
  });
});
