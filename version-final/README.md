# Linyue · notas de la app

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind 4 · zod 4 · vitest 3.
Sin base de datos, sin servicios externos, sin telemetría: **todo vive en tu PC**.

---

## Arranque

```bash
npm install
npm run dev                     # desarrollo (http://localhost:3000)
npm run build && npx next start -H 127.0.0.1 -p 4173   # lo que hace iniciar_linyue.bat

LINYUE_MOCK_ENGINES=1 npm run dev   # motores simulados: ni un binario hace falta
LINYUE_DATA=/ruta/alternativa       # carpeta de datos (por defecto ~/.linyue)
```

| Script | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm run build` | compila para producción |
| `npm run lint` | eslint |
| `npm test` | vitest (234 tests) |
| `npm run typecheck` | `tsc --noEmit` |

## Dónde vive cada cosa

```
src/lib/shared/     lógica pura y testeable (sin fs, sin red)
  platforms.ts        detección de enlaces, modos por plataforma, enrutado a motor
  args.ts             construcción de argumentos de cada motor (plantillas, proxy, rangos)
  codecs.ts           qué códec cabe en qué contenedor de verdad
  schedule.ts         ventana silenciosa y horas (cruza medianoche)
  stats.ts            cálculo de estadísticas desde el historial
src/lib/server/     lo que toca el sistema
  jobs.ts             la cola: pump(), blindaje, ventana, Lanzou/Aliyun, post-proceso
  queue-store.ts      persistencia atómica de la cola (~/.linyue/queue.json)
  store.ts            config.json, history.json, archives, espacio libre
  engines.ts          catálogo de los 17 motores + escaneo + actualización
  lanzou.ts           extractor nativo de 蓝奏云 (página → iframe → sign → ajaxm.php)
  guard.ts            CSRF y cabeceras para toda la API
  ratelimit.ts        freno adaptativo por host
src/app/            rutas y API (App Router)
src/components/     Chrome (header, isla, tab bar), ui.tsx (piezas), Ambient (fondo)
tests/              core, fase4, fase5, fase6/baidu, fase7, fase8, ffmpeg-real
```

## Estructura de las descargas

```
<salida>/
└── <Autor>/
    ├── <Título> [<id>].mp4      vídeo
    ├── <Título> [<id>].webp     foto
    └── Audio/
        └── <Título> [<id>].mp3  audio (subcarpeta propia)
```

El audio vive aparte **a propósito**: `yt-dlp` descarga el archivo origen con el
nombre del vídeo y, tras extraer el audio, **lo borra**. Si compartieran carpeta,
bajar el audio de algo que ya tenías en vídeo **eliminaba el vídeo**.

## Sistema visual «Carbón y Carmesí»

Negro `#050506`, un solo acento carmesí `#e1122b`, superficies planas con una
hairlina roja de 1 px, radios de 16 px y grano de film al 3.5 %. Nada de vidrio
ni degradados de arcoíris. Detalle completo en [`DISENO.md`](DISENO.md).

Micro-interacciones que sí quedan (todas respetan `prefers-reduced-motion`):

1. Squish 0.975 al pulsar — `globals.css .btn`
2. Pill de pestañas que se desliza y estira — `components/ui.tsx Segmented`
3. Morph de la isla colapsada ↔ expandida (View Transitions) — `Chrome.tsx Island`
4. Anillo de progreso que acelera con la velocidad real — `ui.tsx Ring`
5. Banners que nacen bajo la isla — `Chrome.tsx`
6. Tilt inercial con brillo que sigue al puntero — `Ambient.tsx` + `[data-tilt]`
7. Arrastrar para reordenar la cola — `page.tsx Queue`
8. Chips de formato con FLIP — `page.tsx FormatChips`
9. Chip de plataforma que aterriza por link — `.land`
10. Odómetro numérico de archivos — `ui.tsx Odometer`
11. Hairlina carmesí que se enciende al pasar el puntero — `.glass::after`
12. Filete de progreso del hero mientras hay descargas — `.lightline`
13. Vibración háptica y pop sincronizado con el squish — `lib/client/sound.ts`
14. Isla ámbar si un motor se cae — `.amber`
15. Confeti carmesí al completar — `Ambient.tsx`
16. Tema que se derrite (View Transitions) — `::view-transition-*`
17. Cursor de anillo fino carmesí — `.lens`
18. Toggle con knob en spring — `ui.tsx Toggle`

## Problemas típicos

| Síntoma | Causa | Arreglo |
| --- | --- | --- |
| Un motor aparece en ámbar | El binario existe pero `--version` no contestó a tiempo | Revisa `./vendor` y pulsa *Re-escanear* |
| Todo aparece «simulado» | `yt-dlp` no detectado | Copia los `.exe` a `./vendor` o fija la ruta en Ajustes |
| «Sign in to confirm» / edad | Falta sesión | `/cookies` → pega `cookies.txt` → **Probar sesión** |
| Instagram devuelve vacío | Falta sesión o modo equivocado | Usa el modo *Perfil completo* |
| Sin carátula embebida | ffmpeg no responde | Comprueba que `ffmpeg.exe` esté sano |
| El turbo no acelera | `aria2c` ausente | Instálalo y activa **Modo turbo** |
| «Ya lo tenías» | Dedup por `archive-<modo>.txt` + historial | Desactiva **No repetir** en Ajustes |
| Nada arranca de noche | Ventana silenciosa activa | Ajustes → Programador, o pon `quietEnabled: false` |
| La isla no actualiza | SSE cortado por un proxy | Abre directo `http://127.0.0.1:4173` |
| Lanzou falla con «cambió el formato» | El sitio cambió el HTML otra vez | Abre un issue con la URL; hay que ajustar los patrones |
| Aliyun Pan pide sesión | Falta el login del CLI | `aliyunpan login` una vez en tu terminal |
