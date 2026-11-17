// El color es lo único del sistema visual que el usuario puede tocar, así que
// tiene que ser imposible romperlo desde la interfaz: un hex mal escrito, un
// brillo de 900 o un JSON viejo en localStorage no pueden dejar la app sin
// acento ni transparente.
import { describe, expect, it } from "vitest";
import {
  TEMA_DEFECTO, PRESETS, normalizarHex, normalizarTema, duracionDe, varsDeTema,
  rgbDeHex, hslDeHex, contrasteSobre, esTemaDefecto,
} from "@/lib/shared/tema";

describe("normalizarHex", () => {
  it("acepta #rrggbb en cualquier caja y lo devuelve en minúsculas", () => {
    expect(normalizarHex("#E1122B")).toBe("#e1122b");
    expect(normalizarHex("#38bdf8")).toBe("#38bdf8");
  });

  it("rechaza todo lo que <input>, un CSS o un humano escriben mal", () => {
    for (const malo of ["", "#fff", "#12345", "e1122b", "#gggggg", "rgb(1,2,3)", " #e1122b", null, 42, {}]) {
      expect(normalizarHex(malo)).toBeNull();
    }
  });
});

describe("normalizarTema", () => {
  it("un objeto vacío o basura da el tema de fábrica", () => {
    for (const basura of [undefined, null, {}, "x", 7, []]) {
      expect(normalizarTema(basura)).toEqual(TEMA_DEFECTO);
    }
  });

  it("conserva lo válido y rellena sólo lo que falta (config vieja)", () => {
    expect(normalizarTema({ acento: "#8B5CF6" })).toEqual({ ...TEMA_DEFECTO, acento: "#8b5cf6" });
  });

  it("recorta el brillo a 0..100 y lo redondea", () => {
    expect(normalizarTema({ brillo: 1000 }).brillo).toBe(100);
    expect(normalizarTema({ brillo: -5 }).brillo).toBe(0);
    expect(normalizarTema({ brillo: 61.6 }).brillo).toBe(62);
    expect(normalizarTema({ brillo: Number.NaN }).brillo).toBe(TEMA_DEFECTO.brillo);
  });

  it("una fluidez desconocida cae en la de fábrica", () => {
    expect(normalizarTema({ fluidez: "instantanea" }).fluidez).toBe(TEMA_DEFECTO.fluidez);
    expect(normalizarTema({ fluidez: "suave" }).fluidez).toBe("suave");
    expect(normalizarTema({ fluidez: "ninguna" }).fluidez).toBe("ninguna");
  });
});

describe("varsDeTema", () => {
  it("emite las cuatro variables que lee globals.css", () => {
    const v = varsDeTema({ acento: "#10b981", acento2: "#34d399", brillo: 54, fluidez: "suave" });
    expect(v).toEqual({ "--acento": "#10b981", "--acento-2": "#34d399", "--brillo": "0.54", "--dur": "380ms", "--acento-tinta": "#0b0b0c" });
  });

  it("la tinta del botón sigue a la luminancia: oscura sobre ámbar, blanca sobre carmesí", () => {
    expect(varsDeTema({ ...TEMA_DEFECTO, acento: "#f59e0b" })["--acento-tinta"]).toBe("#0b0b0c");
    expect(varsDeTema(TEMA_DEFECTO)["--acento-tinta"]).toBe("#ffffff");
  });

  it("el brillo sale normalizado 0..1, no 0..100", () => {
    expect(varsDeTema(TEMA_DEFECTO)["--brillo"]).toBe("0.62");
    expect(varsDeTema({ ...TEMA_DEFECTO, brillo: 250 })["--brillo"]).toBe("1");
  });
});

describe("duracionDe", () => {
  it("extrema respira más que suave y ninguna no anima", () => {
    expect(duracionDe("extrema")).toBe("620ms");
    expect(duracionDe("suave")).toBe("380ms");
    expect(duracionDe("ninguna")).toBe("1ms");
    expect(parseInt(duracionDe("extrema"))).toBeGreaterThan(parseInt(duracionDe("suave")));
  });
});

describe("rgbDeHex / hslDeHex", () => {
  it("convierte a 0..1, que es lo que espera el shader de la aurora", () => {
    const [r, g, b] = rgbDeHex("#ffffff");
    expect([r, g, b]).toEqual([1, 1, 1]);
    expect(rgbDeHex("#000000")).toEqual([0, 0, 0]);
    const [r2, g2, b2] = rgbDeHex("#e1122b");
    expect(r2).toBeCloseTo(225 / 255, 5);
    expect(g2).toBeCloseTo(18 / 255, 5);
    expect(b2).toBeCloseTo(43 / 255, 5);
  });

  it("un hex roto no da NaN: cae en el acento de fábrica", () => {
    expect(rgbDeHex("nope")).toEqual(rgbDeHex(TEMA_DEFECTO.acento));
  });

  it("el tono del carmesí está en la familia del rojo", () => {
    const { h, s } = hslDeHex("#e1122b");
    expect(h).toBeGreaterThan(345);
    expect(h).toBeLessThanOrEqual(360);
    expect(s).toBeGreaterThan(70);
    expect(hslDeHex("#808080").s).toBe(0);
  });
});

describe("contrasteSobre", () => {
  it("texto oscuro sobre acentos claros y blanco sobre los oscuros", () => {
    expect(contrasteSobre("#f59e0b")).toBe("#0b0b0c"); // ámbar
    expect(contrasteSobre("#d4af37")).toBe("#0b0b0c"); // oro
    expect(contrasteSobre("#e1122b")).toBe("#ffffff"); // carmesí
    expect(contrasteSobre("#8b5cf6")).toBe("#0b0b0c"); // violeta (L≈0.20)
    expect(contrasteSobre("#38bdf8")).toBe("#0b0b0c"); // hielo
    expect(contrasteSobre("#000000")).toBe("#ffffff");
    expect(contrasteSobre("#ffffff")).toBe("#0b0b0c");
  });
});

describe("PRESETS", () => {
  it("todos son válidos y no hay dos iguales", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(8);
    const vistos = new Set<string>();
    for (const p of PRESETS) {
      expect(p.nombre.length).toBeGreaterThan(2);
      expect(normalizarHex(p.acento)).toBe(p.acento);
      expect(normalizarHex(p.acento2)).toBe(p.acento2);
      expect(p.brillo).toBeGreaterThanOrEqual(0);
      expect(p.brillo).toBeLessThanOrEqual(100);
      // Un preset aplicado tal cual no debe perder nada al normalizarlo.
      expect(normalizarTema(p)).toEqual({ acento: p.acento, acento2: p.acento2, brillo: p.brillo, fluidez: p.fluidez });
      expect(vistos.has(p.id)).toBe(false);
      vistos.add(p.id);
    }
  });

  it("el primero es el tema de fábrica", () => {
    expect(PRESETS[0].acento).toBe(TEMA_DEFECTO.acento);
    expect(esTemaDefecto(PRESETS[0])).toBe(true);
  });
});
