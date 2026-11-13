# Pasada de diseño · Linyue Studio

**Qué se tocó:** solo el sistema visual. Cero cambios en lógica de descarga
(los 107 tests siguen pasando y el `next build` compila).

---

## El diagnóstico, en una línea

> El diseño estaba afinado para la tipografía **Inter**, pero Inter **nunca se
> cargaba**. Y el **modo claro** tenía los bordes en blanco sobre fondo claro.

Lo demás eran detalles de contraste y accesibilidad. La estética (vidrio, aurora,
la isla, los 24 micro-detalles) se respetó entera: no quité ninguna animación.

---

## 1. La tipografía no existía 🔴

`globals.css` declaraba:

```css
--font-sans: "Inter var", "Inter", -apple-system, …;
--font-mono: "JetBrains Mono", ui-monospace, …;
```

Pero no había `next/font`, ni `@font-face`, ni un `<link>`. Resultado real:

| Sistema | Lo que se veía |
|---|---|
| Windows | **Segoe UI** |
| macOS | SF Pro (aquí sí acertaba, por casualidad) |
| Linux | DejaVu / Noto |

Y todo el tracking negativo del CSS está calculado **para Inter**:
`letter-spacing: -0.011em` global, `-0.035em` en el hero, `text-wrap: balance`.
Con Segoe UI eso se ve apretado y desparejo. El mismo archivo se veía distinto
en cada máquina, que es exactamente la definición de "no me gusta cómo quedó".

**Arreglado** con `next/font/google` en `layout.tsx`:

```tsx
const sans = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans-loaded" });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono-loaded" });
```

Las fuentes se descargan **en la compilación** y se sirven desde tu propio
servidor (verificado: los `.woff2` responden 200 desde `/_next/static/media/`).
No hay peticiones a Google en tiempo de ejecución, así que sigue siendo una app
100 % local.

> ⚠️ **Único requisito nuevo:** compilar con internet la primera vez (Next las
> cachea en `.next/cache`). Si compilas offline justo la primera vez, comenta las
> dos líneas y el fallback a Segoe UI sigue funcionando igual que antes.

---

## 2. El modo claro estaba roto 🔴

En `:root.light`:

```css
--stroke: rgba(255, 255, 255, 0.75);   /* ¡borde blanco! */
--spec:   rgba(255, 255, 255, 0.7);
```

Bordes blancos sobre `#f3f1fb` ≈ invisibles. Todas las tarjetas de vidrio se
veían "sin definir", como si les faltara el contorno.

Y los componentes no ayudaban: había **19 usos de `border-white/10`,
`bg-white/5`, `bg-white/10`, `bg-white/20`** incrustados en el JSX. En oscuro
quedan bien; en claro desaparecen.

**Arreglado** con tres tokens nuevos que sí cambian con el tema:

```css
:root      { --line: rgba(255,255,255,.10); --fill: rgba(255,255,255,.05); --fill-2: rgba(255,255,255,.11); }
:root.light{ --line: rgba(28,20,48,.12);    --fill: rgba(28,20,48,.05);    --fill-2: rgba(28,20,48,.10); }
```

Y `--stroke` del tema claro pasó a `rgba(28, 20, 48, 0.10)`: gris violáceo, se
ve el contorno. Todos los `border-white/10` y `bg-white/x` de superficies ahora
usan `var(--line)` / `var(--fill)` / `var(--fill-2)`.

Los blancos que **quedan** son a propósito: la isla negra (que en iOS también es
negra en los dos temas) y el botón ▶ encima de las miniaturas.

---

## 3. Contraste y tamaño de texto 🟠

| Antes | Ahora | Por qué |
|---|---|---|
| Blanco sobre `#ec4899` (≈3.4:1) | Degradado `#7c3aed → #c026d3 → #db2777` (≈4.6:1) | El texto del botón "Descargar" no llegaba al mínimo AA |
| `text-[9px]` y `text-[10px]` | Suelo de **11 px** | La insignia "TOP" a 9 px era ilegible |
| `text-fuchsia-300/90` en el kicker | `var(--accent-ink)` | Sobre fondo claro, el fucsia 300 se lava |
| `from-violet-300 via-fuchsia-300 to-pink-300` en el hero | clase `.grad-text` con dos versiones | En claro el degradado quedaba casi blanco |
| `text-emerald-200` / `text-rose-300` | `var(--ok-ink)` / `var(--danger-ink)` | Estados ilegibles en claro |
| `--muted` a 0.62 | a 0.68 (y 0.70 en claro) | Texto secundario de 11-12 px |

---

## 4. Accesibilidad 🟠

- **Tab bar con teclado.** El `Segmented` (las 4 pestañas del header) declaraba
  `role="tablist"`/`role="tab"` pero **solo se podía usar con Tab + Enter**, y
  ninguna flecha movía la selección: el patrón WAI-ARIA quedaba a medias.
  Ahora: ←/→/↑/↓ mueven, Home/End van a los extremos, el foco sigue a la pill y
  hay `tabIndex` rotativo (solo la activa entra en el orden de tabulación).
- **`prefers-contrast: more`**: nuevo bloque que refuerza `--muted`, `--stroke`
  y `--line`, y quita el `backdrop-filter` (el vidrio borroso resta legibilidad
  cuando alguien pide más contraste).
- **Imágenes**: `loading="lazy"` + `decoding="async"` en las carátulas. Se
  mantiene `<img>` (no `<Image>`) con el motivo documentado en el archivo: las
  carátulas vienen de decenas de dominios, y `remotePatterns: "**"` es justo lo
  que esa regla intenta evitar. Los 2 avisos de ESLint quedan silenciados **con
  justificación**, no a la brava.

---

## 5. Dos bugs de UI que no eran estéticos 🟡

**1. El arrastre de la cola contaba mal las filas.**
Había un `const ROW = 76` fijo para calcular a qué posición caía un job al
arrastrarlo. En móvil el título ocupa dos líneas, la fila mide ~96 px, y
arrastrar una posición **saltaba dos**. Ahora se mide el alto real de la fila en
el `pointerdown` y se suma el `gap` de 8 px.

**2. `will-change: transform` en TODOS los botones.**
Eso crea una capa de composición por botón (decenas en la home) para una
animación que dura 90 ms al pulsar. Quitado: mismo efecto, muchas menos capas.

---

## Cómo verlo

Está corriendo en el preview de esta sesión con motores simulados
(`LINYUE_MOCK_ENGINES=1`). Para probarlo en tu máquina:

```bash
cd version-final
npm install
npm run dev
```

Y pulsa el botón de **sol/luna** del header para ver el modo claro: es donde más
se nota el cambio.

---

## Lo que NO toqué

- Ninguna animación ni micro-interacción (las 24 del README siguen ahí).
- La estructura de la home, el orden de los bloques, los textos.
- La isla: sigue siendo negra en ambos temas, como el Dynamic Island de iOS.
- Nada de lógica de descarga.

Si algo de esto te chirría, dime qué y lo ajusto — ahora es fácil, todo el color
y el espaciado sale de tokens.

---

# Ronda 2 · lo que se vio en la captura de Ajustes

Revisando tu pantalla encontré cuatro cosas más, tres de ellas reales:

## 6. Los bordes derechos en zigzag 🔴 (lo que llamaste "líneas sin cuadrar")

`Row` era un `flex justify-between` **sin ancho definido para la columna de
controles**, y cada control traía el suyo:

| Fila | Ancho del control | Borde derecho |
|---|---|---|
| Carpeta de salida | `w-64` (256 px) | x≈340 |
| Audio por defecto | `auto` (~90 px) | x≈310 |
| Vídeo por defecto | `auto` + `auto` | x≈280 |
| Descargas en paralelo | slider + `w-4` | x≈690 |
| Límite de perfil | `w-24` | x≈310 |

Cinco verticales distintas en la misma tarjeta. Eso es exactamente el "no está
cuadrado" que se ve a simple vista aunque no se sepa nombrar.

**Arreglado:** la columna de controles mide **siempre 300 px** en escritorio
(`sm:w-[300px]` con `justify-end`) y los hijos se ajustan dentro:

- campos de texto (rutas) → `w-full`, que es lo que quieres para una ruta larga
- selects → `w-[148px]`, pegados a la derecha
- el par formato+calidad → rejilla de 2 columnas iguales
- número → `w-24` con `tabular-nums`
- slider → `flex-1` y el número en `w-5` alineado a la derecha
- toggles → ya estaban a la derecha

Resultado: **una sola vertical** para todos los controles.

## 7. La barra de pestañas móvil tapaba la última fila 🟠

`<main>` tenía `pb-32` (128 px) fijos. La barra flotante mide ~64 px + 12 de
margen, pero la fila "Límite de perfil" quedaba justo debajo. Ahora `pb-40`
(160 px) por debajo de `xl`, y `xl:pb-32` cuando ya no hay barra inferior.

Además la barra usaba el vidrio normal (68 % de opacidad): **se leía el texto de
detrás** al hacer scroll. Nueva clase `.tabbar` que mezcla el vidrio con el color
de fondo.

## 8. El pill de estado tapaba una pestaña 🔴 (nuevo, salió al mirar de cerca)

La isla flota **fija y centrada arriba** (`fixed top-3`), y las pestañas del
header también estaban centradas: a 1280 px el pill **se comía "Descargador"**.

Medido: la isla ocupa 576–704 px de ancho; el grupo de pestañas + botones
empezaba en ~688. Solape de 16 px.

**Arreglado en dos movimientos:**
1. Las pestañas pasan al **bloque derecho** del header (junto a los iconos) y
   solo aparecen desde `xl`; por debajo manda la barra inferior.
2. La isla se va **al centro-abajo en escritorio** (`xl:bottom-5`), donde no hay
   nada. En móvil sigue arriba, porque ahí no hay pestañas en el header.

Los avisos (toasts) pasaron a su propio contenedor fijo para que no se muevan
cuando la isla cambia de sitio.

## 9. El cursor-lente parecía una mancha 🟡

`.lens` es un círculo de vidrio que sigue al puntero. En reposo se quedaba
**quieto y visible**, y en la captura parece una mancha sobre la primera tarjeta.
Ahora arranca en `opacity: 0` y solo se muestra mientras hay movimiento (se
apaga 1,4 s después del último `pointermove`).

## 10. El slider nativo se veía como una barra negra 🟡

El `<input type="range">` usaba el control del sistema con `accent-color`: en
modo claro salía una barra gruesa oscura que no pegaba con nada. Ahora track y
thumb usan los tokens (`--fill-2`) y el degradado del tema, en los dos motores
(`-webkit-slider-thumb` y `-moz-range-thumb`).

---

## Cómo comprobarlo

Capturas generadas con Chromium real (Playwright, 2× de densidad) en
`/capturas`: `v4-ajustes-dark.png`, `v4-ajustes-light.png`, `v4-header-1280.png`,
`v4-movil.png`, `v4-home-dark.png`.

Medido en 1280 px y 390 px: sin solapes, todos los controles en la misma
vertical, y `tsc` + `eslint` + `next build` limpios.
