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
| `npm test` | vitest (312 tests) |
| `npm run typecheck` | `tsc --noEmit` |

## Dónde vive cada cosa

```
src/lib/shared/     lógica pura y testeable (sin fs, sin red)
  platforms.ts        detección de enlaces, modos por plataforma, enrutado a motor
  args.ts             construcción de argumentos de cada motor (plantillas, proxy, rangos)
  codecs.ts           qué códec cabe en qué contenedor de verdad
  schedule.ts         ventana silenciosa y horas (cruza medianoche)
  recortes.ts         SponsorBlock, «1:00-2:30» → --download-sections, plantilla de capítulos
  subs.ts             suscripciones: qué IDs son nuevos, poda, reconstrucción de URL
  taller.ts           argumentos de ffmpeg para convertir/recortar/comprimir archivos locales
  stats.ts            cálculo de estadísticas desde el historial
src/lib/server/     lo que toca el sistema
  jobs.ts             la cola: pump(), blindaje, ventana, Lanzou/Aliyun, post-proceso
  queue-store.ts      persistencia atómica de la cola (~/.linyue/queue.json)
  store.ts            config.json, history.json, archives, espacio libre
  engines.ts          catálogo de los 17 motores + escaneo + actualización
  lanzou.ts           extractor nativo de 蓝奏云 (página → iframe → sign → ajaxm.php)
  guard.ts            CSRF y cabeceras para toda la API
  ratelimit.ts        freno adaptativo por host
  subs.ts             subs.json + revisión real (--flat-playlist) y encolado de lo nuevo
  taller.ts           cola del conversor local (ffmpeg, progreso por -progress pipe:1)
  power.ts            apagar el equipo al terminar, con cuenta atrás y cancelación
  probe-cache.ts      fichas de la vista previa en memoria (10 min, 60 entradas, 24 MB)
  abrir-sistema.ts    el ÚNICO sitio que decide cómo se abre una carpeta en cada SO
  proc.ts             procesos «y olvidarse» (shutdown, taskkill) que no pueden tumbar el servidor
  src/lib/shared/     nombres.ts (títulos legibles), abrir.ts (¿archivo, carpeta o nada?)
src/app/            rutas y API (App Router)
src/components/     Chrome (header, isla, tab bar), ui.tsx (piezas), Ambient (fondo)
tests/              core, fase4…fase9, taller, ffmpeg-real, auditoria, regresion-rutas, abrir-sistema
```

## Cuatro cosas nuevas (fase 9)

### 1 · Suscripciones
En la portada, panel **Suscripciones**: pega la URL de un canal, una playlist o un
perfil y Linyue lo mira cada 3/6/12/24 h. Lo nuevo entra en la cola como cualquier
descarga (con sus reintentos, su ventana silenciosa y su archivo de descargados).

- Se pregunta con `--flat-playlist`, que trae **la lista, no los vídeos**: un canal
  de 5000 elementos se consulta en segundos.
- Cada revisión encola **como mucho 5** elementos nuevos: si algo va mal, no se
  llena el disco de golpe.
- Se guardan los IDs ya vistos (los últimos 3000). 5 fallos seguidos y esa
  suscripción deja de reintentar sola hasta que pulses «Revisar ahora».

### 2 · Recortes y SponsorBlock
Fila **Recortar** en la portada (solo para esa descarga) y panel en Ajustes
(para todas):

| Ajuste | Qué hace |
|---|---|
| Recortar `1:00-2:30` | `--download-sections`; varias con comas: `0:10-0:20, 1:00-1:30` |
| SponsorBlock **marcar** | `--sponsorblock-mark sponsor,selfpromo,interaction,intro,outro` |
| SponsorBlock **quitar** | lo mismo con `--sponsorblock-remove` (corta el patrocinio) |
| Un archivo por capítulo | `--split-chapters` + plantilla `%(section_number)02d — %(section_title)` |

Un recorte mal escrito **no se le pasa al motor**: se valida y se ignora, porque el
mensaje de error de yt-dlp ante un `--download-sections` inválido no explica nada.

### 3 · Taller (conversor local)
Pestaña **Taller** (Alt+3). Arrastra un archivo del disco: se convierte, se recorta
o se comprime con ffmpeg, con cola y progreso real.

- Sale un archivo nuevo con « (taller)» en el nombre: **el original no se toca**.
- La subida va por streaming al disco (nunca se carga el archivo en memoria): un
  MKV de 8 GB no tumba el proceso.
- Compresión con CRF 18–32; «sin recodificar» solo cambia el contenedor o recorta.
- Se usa la misma tabla de códecs que las descargas: si dice AC-3, es AC-3.

### 4 · Sistema: avisos, apagado y arranque
En **Ajustes → Sistema**:

- **Avisar al terminar**: notificación nativa del sistema (permiso pedido con un
  clic, nunca al cargar la página).
- **Apagar el equipo al terminar**: 60 s de cuenta atrás con banner y botón para
  cancelar. Solo se activa si hubo al menos una descarga terminada: arrancar la app
  con la cola vacía **no** apaga nada.
- **Arrancar con Windows**: crea un `.cmd` en tu carpeta Inicio. Sin admin, sin
  servicios, sin tareas programadas: se borra a mano cuando quieras.

`.github/workflows/ci.yml` ejecuta tipos, lint, los 312 tests (con ffmpeg de verdad)
y el build en cada push a `main`.

## Fase 10–11: la prueba con red de verdad

Hasta la fase 9 todo estaba probado con motores simulados. En la 10 se probó con
**yt-dlp real contra YouTube real** en el navegador, y aparecieron cosas que los
tests con mocks no podían ver. Las siete, arregladas y con test de regresión:

| # | Síntoma que veía el usuario | Causa de verdad | Arreglo |
| --- | --- | --- | --- |
| 1 | «La vista previa tarda muchísimo»: la ficha se quedaba en *Inspeccionando…* para siempre | `POST /api/probe` devolvía `Response.json(await tarea)` sobre una promesa que **ya** era un `Response` → se serializaba a `{}` (2 bytes) | la promesa interna resuelve al objeto; la ruta envuelve una sola vez |
| 2 | La misma vista previa, con red lenta, tardaba 30-90 s | `--retries` por defecto de yt-dlp (10, con backoff) + sondeo repetido del mismo link | `--retries 1 --fragment-retries 1 --socket-timeout 15`, timeout 20 s y **caché de fichas** de 10 min |
| 3 | Quitar una suscripción no hacía nada | el cliente mandaba el id en el cuerpo y la ruta lo leía de la query → `404 /api/subs` | `DELETE /api/subs?id=…` |
| 4 | Las suscripciones fallaban siempre con `spawn …vendor/yt-dlp ENOENT` | buscaba el binario con la ruta fija `vendor/yt-dlp(.exe)`; el del ZIP se llama `ytdlp.exe` | usa `resolveEngine("yt-dlp")` y, si no hay motor, lo dice en español |
| 5 | En playlists, Recientes mostraba la ruta completa como título | se guardaba `basename(dirname)` | `tituloDeArchivo()` |
| 6 | *Abrir carpeta* en el Taller mandaba a **Documentos** en vez de al archivo | `spawn("explorer", ["/select,", ruta])`: dos argumentos, Explorer recibía `/select,` suelto | `abrir-sistema.ts`: `"/select,<ruta>"` como **un** argumento, `open -R` en macOS, `xdg-open` en Linux, y nunca se lanza una ruta que no existe |
| 7 | La consola del navegador soltaba avisos y la página de Ajustes se salía de la pantalla en un móvil de 390 px | `navigator.vibrate` sin interacción previa; `max-w-[42%]` en la tarjeta de motor (su min-content no encogía) | se comprueba `userActivation` antes de vibrar; ancho **definido** (`basis-[38%]`) + `min-w-0` en la rejilla |

Y un octavo, silencioso pero grave: cualquier `spawn` que fallaba (un `taskkill`
bloqueado por el antivirus, un `shutdown` ausente, `explorer.exe` con una ruta
rara) emitía `error` en el hijo y **tumbaba el servidor entero**, porque nadie
escuchaba ese evento. Ahora todos esos lanzamientos pasan por `proc.ts` /
`abrir-sistema.ts`, que siempre escuchan.

### Qué se midió (no es una opinión)

- Sonda de la vista previa con YouTube real: **1,27 s en frío** y **0,01 s con caché**
  (antes: 30 s y `{}`).
- `POST /api/subs {action:"checkAll"}` con motor real: `{ok:true, nuevos:1}` y la
  etiqueta pasa de la URL a **`jawed`** (el nombre del canal).
- 6 rutas recorridas con Playwright: **0 errores de consola, 0 respuestas ≥ 400**.
- Las 6 rutas también a 390 px de ancho: **sin scroll horizontal** en ninguna.

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
| Todos los motores en rojo tras cambiar de carpeta | `config.json` guarda la carpeta `vendor` de la instalación anterior | Ajustes → *Motor vivo* → **Usar esta carpeta** (o borra la ruta) |
| «Could not copy Chrome cookie database» | Chrome abierto, o Chrome 127+ cifra las cookies de un modo que yt-dlp no lee | Se reintenta **sin cookies** solo; si insiste, cierra el navegador del todo o exporta `cookies.txt` |
| Todo aparece «simulado» | `yt-dlp` no detectado | Copia los `.exe` a `./vendor` o fija la ruta en Ajustes |
| «Sign in to confirm» / edad | Falta sesión | `/cookies` → pega `cookies.txt` → **Probar sesión** |
| Instagram devuelve vacío | Falta sesión o modo equivocado | Usa el modo *Perfil completo* |
| Sin carátula embebida | ffmpeg no responde | Comprueba que `ffmpeg.exe` esté sano |
| El turbo no acelera | `aria2c` ausente | Instálalo y activa **Modo turbo** |
| «Ya lo tenías» | Dedup por `archive-<modo>.txt` + historial | Desactiva **No repetir** en Ajustes |
| Nada arranca de noche | Ventana silenciosa activa | Ajustes → Programador, o pon `quietEnabled: false` |
| La isla no actualiza | SSE cortado por un proxy | Abre directo `http://127.0.0.1:4173` |
| Lanzou falla con «cambió el formato» | El sitio cambió el HTML otra vez | Abre un issue con la URL; hay que ajustar los patrones |
| La ficha se queda en «Inspeccionando…» | El sitio no contesta o bloquea el sondeo | Mira el aviso de la ficha: dice el motivo exacto (cookies, privado, red) |
| «Abrir carpeta» abre Documentos | La ruta guardada ya no existe | Linyue comprueba antes y te dice «Ese archivo ya no está en el disco» |
| La isla dice «faltan 3 motores» | Hay binarios obligatorios sin encontrar | Ajustes → *Motor vivo*: el que falta aparece en rojo con su nombre |
| Aliyun Pan pide sesión | Falta el login del CLI | `aliyunpan login` una vez en tu terminal |
