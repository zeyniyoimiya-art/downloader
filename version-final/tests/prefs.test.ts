// El fallo que tumbaba la app entera (fase 18.5).
//
// `useSyncExternalStore` compara el snapshot con `Object.is`. Si `getSnapshot`
// devuelve un objeto nuevo en cada llamada, React cree que el store cambió en
// cada render, vuelve a renderizar, y otra vez: «Maximum update depth exceeded»
// (React #185). En producción eso pinta la pantalla de error de Next
// («This page couldn't load / Reload to try again, or go back») y la app queda
// inservible — con el servidor perfectamente arrancado.
//
// Esta prueba es la que impide que vuelva: dos lecturas seguidas tienen que
// devolver LA MISMA referencia mientras `localStorage` no cambie.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizarTema, TEMA_DEFECTO } from "@/lib/shared/tema";
import { CLAVE_TEMA, guardarTema, mutedSnap, olvidarCache, subscribePref, temaSnap, themeSnap } from "@/lib/client/prefs";

// ── Navegador de mentira: sólo lo que usa el módulo ─────────────────────────
const memoria = new Map<string, string>();
let eventos = 0;

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => memoria.get(k) ?? null,
    setItem: (k: string, v: string) => { memoria.set(k, String(v)); },
    removeItem: (k: string) => { memoria.delete(k); },
    clear: () => memoria.clear(),
  };
  g.window = g; // `hayVentana()` mira `typeof window`
  g.matchMedia = () => ({ matches: false });
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.dispatchEvent = () => { eventos++; return true; };
});

beforeEach(() => {
  memoria.clear();
  olvidarCache();
  eventos = 0;
});

describe("temaSnap (el snapshot que hay que cachear)", () => {
  it("devuelve LA MISMA referencia si no cambió nada", () => {
    const a = temaSnap();
    const b = temaSnap();
    const c = temaSnap();
    // Con la versión rota esto era false y la app moría con React #185.
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("la causa del fallo, documentada: normalizarTema SÍ crea objetos nuevos", () => {
    const crudo = JSON.stringify(TEMA_DEFECTO);
    expect(normalizarTema(JSON.parse(crudo))).not.toBe(normalizarTema(JSON.parse(crudo)));
    expect(normalizarTema(JSON.parse(crudo))).toEqual(TEMA_DEFECTO);
  });

  it("al cambiar lo guardado devuelve un objeto nuevo con los valores nuevos, y luego se queda quieto", () => {
    const antes = temaSnap();
    const jade = { acento: "#10b981", acento2: "#34d399", brillo: 54, fluidez: "extrema" as const };
    guardarTema(jade);
    const despues = temaSnap();
    expect(despues).not.toBe(antes);
    expect(despues.acento).toBe("#10b981");
    expect(temaSnap()).toBe(despues); // estable otra vez
    expect(eventos).toBeGreaterThan(0); // avisó a los suscriptores
  });

  it("sin nada guardado usa el tema de fábrica, sin lanzar", () => {
    expect(temaSnap()).toEqual(TEMA_DEFECTO);
  });

  it("un JSON roto en localStorage no rompe la app: cae al tema de fábrica", () => {
    memoria.set(CLAVE_TEMA, "{esto no es json");
    olvidarCache();
    expect(temaSnap()).toEqual(TEMA_DEFECTO);
    expect(temaSnap()).toBe(temaSnap());
  });

  it("un tema con valores absurdos se normaliza (no deja la interfaz sin acento)", () => {
    memoria.set(CLAVE_TEMA, JSON.stringify({ acento: "verde", brillo: 900, fluidez: "teletransporte" }));
    olvidarCache();
    const t = temaSnap();
    expect(t.acento).toBe(TEMA_DEFECTO.acento);
    expect(t.brillo).toBe(100);
    expect(t.fluidez).toBe(TEMA_DEFECTO.fluidez);
  });
});

describe("themeSnap y mutedSnap (valores primitivos: no necesitan caché)", () => {
  it("el modo es estable y por defecto oscuro", () => {
    expect(themeSnap()).toBe("dark");
    expect(themeSnap()).toBe(themeSnap());
  });
  it("respeta lo guardado", () => {
    memoria.set("ly-theme", "light");
    expect(themeSnap()).toBe("light");
  });
  it("el silencio empieza apagado", () => {
    expect(mutedSnap()).toBe(false);
    memoria.set("ly-muted", "1");
    expect(mutedSnap()).toBe(true);
  });
});

describe("subscribePref", () => {
  it("devuelve una función para desuscribirse (React la exige)", () => {
    const soltar = subscribePref(() => {});
    expect(typeof soltar).toBe("function");
    expect(() => soltar()).not.toThrow();
  });
});
