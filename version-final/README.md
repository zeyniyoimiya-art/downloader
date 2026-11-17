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
| 6 | *Abrir carpeta* no abría nada (o abría **Documentos**), sobre todo con nombres que llevan espacios | dos trampas de Windows: `["/select,", ruta]` son **dos** argumentos; y `["/select," + ruta]` con espacios tampoco vale, porque Node entrecomilla el argumento entero y Explorer solo acepta comillas alrededor de la **ruta** | `abrir-sistema.ts`: `/select,"C:\…\a b.mp4"` + `windowsVerbatimArguments: true`, plan B por `cmd /c start`, `open -R` en macOS, `xdg-open` en Linux; nunca se lanza una ruta que no existe |
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

## Cuando dice «el archivo ya no está» y el archivo está

La ruta del historial es una promesa, no un hecho. Puede dejar de coincidir por
motivos normales: cambiaste la carpeta de salida, el motor sanéó el nombre a su
manera (emoji, `｜`, `「」`), el post-proceso cambió `.m4a` por `.mp3`, o el
archivo acabó en la carpeta del autor. Antes se comprobaba con un `existsSync`
y la tarjeta mentía.

Ahora se **busca** (`src/lib/server/rutas.ts` + `src/lib/shared/parecido.ts`):

1. la ruta guardada, tal cual;
2. la carpeta de ese archivo, comparando nombres normalizados;
3. toda la carpeta de salida (con índice cacheado 20 s), por `[videoId]`, por
   título o por nombre parecido con la extensión cambiada.

Encontrar y ordenar: `[videoId]` manda; luego el título sin tildes/emoji; luego
el nombre recortado. Si dos coinciden, gana el más reciente.

- En **Recientes**, el botón **Reconectar** repasa el historial entero y corrige
  las rutas desfasadas (`POST /api/history`), diciendo cuántas arregló y cuántas
  de verdad no aparecen.
- **Abrir carpeta** resuelve igual, y si el archivo no aparece abre la carpeta
  más cercana que sí existe (nunca «no pasa nada»).
- `GET /api/diagnostico` enseña versión, plataforma, carpetas, cuántos archivos
  ve en la salida, el comando exacto que se usaría para abrir una carpeta y cómo
  resuelve las últimas 12 entradas del historial.

## Fase 13: links universales y la verdad por delante

«Que acepte cualquier link» no se arregla con una lista de sitios: eso es lo que
ya hacía (yt-dlp + gallery-dl + spotdl + 20 motores). Se arregla con **mensajes
que digan la causa real** y con no rendirse al primer fallo. Para comprobarlo se
lanzó una batería de **20 links reales** contra la app (no mocks), y esto es lo
que salió, sin maquillar:

### Lo que se arregló (fallos nuestros, no del sitio)

| # | Lo que decía la app | Lo que pasaba de verdad | Arreglo |
| --- | --- | --- | --- |
| 1 | «Falta un motor en `vendor`» ante un MP3 o un pin de Pinterest que **no existían** | la regex `not ?found` de `causaDeError` atrapaba cualquier 404 y lo llamaba «motor» | causas nuevas: `noexiste` · `sesion` · `bloqueo` · `proveedor`, con la regex de `motor` solo para `ENOENT`/`WinError 2` de verdad |
| 2 | Un `.ogv` descargado se perdía con «Conversion failed!» | yt-dlp ya había bajado el archivo; sólo falló el pase a mp4 y se descartaba todo | si «Conversion failed» y hay archivos vivos → **listo** + aviso «se guardó el original (OGV)» |
| 3 | Spotify: error opaco de PyInstaller y trabajo colgado | spotdl baja el audio de YouTube; si YouTube lo rechaza, muere con un traceback | **plan B propio** (ver abajo) + `--ffmpeg <ruta>` completa + Deno como runtime JS + `PATH` con `vendor` |
| 4 | Un trabajo de YouTube con «not a bot» reintentaba 4 veces (30 s → 300 s) y **congelaba el host** | backoff aplicado a un error que no se arregla esperando | los bloqueos de bot van a **1 intento** y sólo penalizan 8 s |
| 5 | Spotify podía terminar «listo» con 0 archivos | spotdl sale con código 0 sin bajar nada | si no hay archivos → plan B; si el plan B tampoco → **error** con la causa real |
| 6 | Un motor colgado dejaba el trabajo «en curso» para siempre (visto: 17 min en *Processing query*) | no había vigilante | si el motor no imprime **nada en 8 min**, se mata y se explica |
| 7 | gallery-dl podía crear nombres inválidos en Windows (`" onmouseover="…`, `:` en un título) | el nombre lo pone el sitio | `--windows-filenames` en gallery-dl |

### Plan B de Spotify (por qué existe)

```
spotdl  →  metadatos Spotify  →  audio de YouTube  ← aquí muere si YouTube dice «no eres un bot»
Linyue  →  oEmbed de Spotify (título + artista, sin claves)
        →  yt-dlp "ytsearch5:<artista> <canción>"
        →  puntúa cada resultado (título 55 · artista 30 · canal oficial 5 · ruido −40…)
        →  si la nota ≥ 55, la baja con yt-dlp y escribe los metadatos y la carátula
```

La puntuación no es decorativa: en la batería, «bad guy» de Billie Eilish eligió
primero la versión de **otro grupo** porque el título coincidía palabra por
palabra. Ahora, si el artista no aparece ni en el título ni en el canal, el
candidato se hunde 45 puntos y no se elige. Hay 10 tests para esto
(`tests/spotify.test.ts`), incluidos los dos casos reales.

### La batería, tal cual salió

Ejecutada en el sandbox de pruebas (Linux, IP de datacenter). **La IP del sandbox
está marcada por YouTube**: eso explica la mitad de los fallos y no se puede
arreglar desde el código.

| Link | Resultado | Por qué |
| --- | --- | --- |
| YouTube vídeo normal | ✅ baja | — |
| YouTube (Shorts, Music, playlist, otros) | ⛔ «confirma que no eres un robot» | límite **por IP** del sandbox. Probados 5 *player clients* (`tv`, `ios`, `mweb`, `android_vr`, `web_safari`) con y sin Deno: todos igual. En tu PC con cookies del navegador funciona |
| Spotify (canción) | ⚠️ canción localizada, audio no | el plan B encuentra el tema correcto y luego YouTube rechaza la descarga por lo mismo (IP) |
| TikTok · SoundCloud · Dailymotion · YouTube Music (cuando pasa) | ✅ bajan | — |
| MP4 / MP3 / JPG directos | ✅ bajan | — |
| Wikimedia `.ogv` | ✅ baja el `.ogv` + aviso | ffmpeg del sistema no convierte ese contenedor; el original queda guardado |
| Wikimedia (galería) | ✅ bajan fotos | gallery-dl; con 429 del CDN reintenta solo |
| Vimeo (vídeo con login) · Instagram · Reddit | ⛔ «pide una cuenta (sesión)» | correcto y explicado; se resuelve con cookies |
| Bilibili · Bandcamp | ⛔ «el sitio está bloqueando» (412/406) | cortafuegos del sitio contra IPs de datacenter |
| Pinterest (pin borrado) · X (tweet sin vídeo) · Dailymotion (vídeo retirado) | ⛔ «ya no existe» | el contenido no está; antes culpaba a `vendor` |
| Twitch (clip borrado) | ⛔ «ya no existe» | ídem |

**Conclusión honesta:** de 20 links, 5 bajan y 5 fallan por el entorno; los otros
10 fallan *en el sitio* (sesión, WAF, contenido borrado) y ahora lo dicen con
esas palabras. Ningún fallo dice ya «falta un motor» cuando el motor está.

### Si te sale «confirma que no eres un robot»

1. Ajustes → **Cookies** → navegador (con el navegador **cerrado**), o pega tu
   `cookies.txt` de YouTube. Es la solución de verdad en un PC normal.
2. Si acabas de descargar mucho, espera unos minutos: es un límite temporal.
3. Proxy/VPN en Ajustes → Red, si tu IP está marcada.

## Fase 14: Apple Music (el sitio que ningún motor sabe leer)

Un link de `music.apple.com` fallaba con **«Ese formato no existe en este
contenido»**. La mitad era mentira y la otra mitad no ayudaba: yt-dlp contesta
literalmente `Unsupported URL`, porque el audio de Apple va cifrado con FairPlay.
No hay nada que extraer de ahí, y no es un problema de configuración.

Lo que sí se puede hacer, y ahora hace la app:

1. **Metadatos por la API pública de iTunes** (`itunes.apple.com/lookup`, sin
   claves ni sesión): título, artista, álbum, género, año y carátula **1400 px**
   (la de 100 px se pide al mismo CDN en grande).
2. **La canción de verdad desde YouTube**: busca `artista + título`, puntúa los
   resultados y baja el que coincide (mismo motor que el plan B de Spotify). En
   un PC normal esto entrega el archivo completo con carátula y etiquetas.
3. **Si YouTube no la tiene**, baja la **vista previa de 30 s** que Apple
   publica sin DRM y la monta con ffmpeg: carátula incrustada (mjpeg
   `attached_pic`), `title`, `artist`, `album`, `genre` y `date`. En mp3 o en
   m4a, según lo que pidas. La tarjeta lo avisa con todas las letras: *«Apple
   Music entrega la canción con DRM… se guardó la vista previa de 30 s»*.

También se aceptan links de **álbum** (`/album/…/1742176034`): iTunes devuelve
las pistas y se intenta cada una (hasta 30), con la vista previa como red.

### Lo mismo, con una canción que YouTube sí entrega en este sandbox

```
https://music.apple.com/bo/album/never-gonna-give-you-up/1559885420?i=1559885421
  [apple] iTunes: 213 s, «Rick Astley - Never Gonna Give You Up»
  [apple] elegido: Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)
  [apple] rescatado: 1 archivo(s)        ← sin aviso, sin vista previa
  Rick Astley/Audio/… [dQw4w9WgXcQ].mp3 → 213,1 s · 8,2 MB · title/artist ✔
```

Es decir: el 30 s no es una limitación del código, es lo que queda cuando
YouTube se niega a servir **ese** vídeo. Con la misma versión de la app, el mismo
botón, la canción completa se baja cuando YouTube la entrega.

### Verificado con el link que falló

```
https://music.apple.com/bo/song/fake-love-orchestral-version-remix/1742176281
  plataforma: Apple Music · motor: yt-dlp (falla al instante y dispara el plan B)
  [apple] iTunes: 1 pista(s), «Japandee - Fake Love (Orchestral Version) [Remix]»
  [apple] elegido: Fake Love (Orchestral Version) [Remix] - Japandee (WOW MUSIC)
  [apple] la descarga del resultado falló: … Sign in to confirm you're not a bot
  [apple] guardada la vista previa de 30 s (con carátula y metadatos)
  estado: done · 1 archivo

Japandee/Audio/Japandee - Fake Love (Orchestral Version) [Remix] [vista previa Apple].mp3
  ffprobe → duration 30.01 s · mp3 + stream mjpeg (attached_pic=1)
  tags    → title, artist, album, genre «Electrónica», date 2024
```

Dos fallos propios más que salieron de esta prueba: el texto «ese formato no
existe» para `Unsupported URL` (ahora es **«Ningún motor sabe leer ese link»**) y
el plan B de Spotify ejecutándose *también* cuando el plan B de Apple ya había
funcionado (dejaba el trabajo en error con el archivo ya en disco).

## Fase 15: cuando el sitio no tiene el formato pedido

Dos cosas que salieron de probar links reales:

**1. «Facebook baja en MP4 pero en ORIGINAL dice que el formato no existe».**
`ORIGINAL` sólo existe en modo **Fotos** (`PHOTO_FORMATS`), y ese modo sobre un
post de vídeo acaba pidiendo a yt-dlp un formato que Facebook no lista. Ahora,
cuando el motor responde `Requested format is not available` o
`No video formats found`:

- se **reintenta una vez** con el mejor formato disponible
  (`-f b/bv*+ba/best`) y `--no-check-formats` (la comprobación previa es justo
  la que falla cuando el sitio responde a medias);
- si el reintento tampoco puede, el error **dice qué ofrece el sitio**
  (`— Ese sitio ofrece: mp4 1920, mp4 1280, mp4 640, m4a audio`), en vez de
  dejar al usuario adivinando.

**2. `Unsupported URL` con una URL de login dentro** ya no se anuncia como «ningún
motor sabe leer ese link». Facebook, Instagram y Google devuelven su página de
acceso y yt-dlp lo reporta literalmente así:

```
ERROR: Unsupported URL: https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Fpermalink.php…
```

Eso es **falta de sesión** y ahora se explica como tal (Cookies → navegador).

## Fase 16: Spotify — el artista que faltaba y el fallo contado por pasos

Un link de Spotify fallaba con un traceback de PyInstaller y nada más. Al
abrirlo salieron tres cosas distintas, y sólo una era de Spotify:

**1. oEmbed no da el artista en muchos tracks.** Para `风可懂我的思念` devuelve
`author_name: null`, así que la búsqueda en YouTube iba sólo con el título y
traía **otras canciones**. Ahora, si oEmbed no trae artista, se lee la página del
**reproductor embebido** (`/embed/track/<id>`), cuyo `__NEXT_DATA__` sí trae los
artistas, la duración y `playabilityReason`. Se usa el **primer** artista (el que
YouTube acredita) y se buscan dos consultas: «artista título» y sólo el título.

**2. Cada fallo se cuenta como es.** Antes, cualquier problema acababa en «YouTube
no tiene esa canción» — incluso cuando el problema era otro. Ahora:

| Lo que pasó | Lo que dice la app |
| --- | --- |
| La búsqueda falló | «la búsqueda de … en YouTube falló → *(motivo del motor)*» |
| Se encontró pero la descarga falló | «se encontró … en YouTube, pero la descarga falló → *(motivo real)*» |
| No hay nada parecido | «YouTube no tiene …: los resultados eran otros temas («…»). No se bajó nada para no darte una canción equivocada» |
| Spotify la bloquea | «… (Spotify además la marca como no disponible en tu país y no publica vista previa)» |

El log de la tarjeta ahora muestra la **nota de cada candidato** con su canal
(`0 «風的思念» (周子琰 - Topic)`), que es lo que permite ver por qué se rechazó.

**3. Último recurso: el catálogo de Apple.** Si YouTube no tiene la canción, se
busca en iTunes y, si aparece, se guarda su vista previa de 30 s con carátula y
metadatos, avisando en la tarjeta. Es poco, pero es mejor que un error.

### Verificado de punta a punta (sin mocks)

```
Spotify → spotdl no está → plan B
  [spotify] plan B: buscando «DJ铁柱 刀群舞 - Dj炫酷版» en YouTube
  [spotify] elegido: 刀群舞 (Dj炫酷版) (DJ铁柱 - Topic)
  [spotify] rescatado: 1 archivo(s)
  → DJ铁柱 - Topic/Audio/刀群舞 (Dj炫酷版) [UYmi6Q4fk-M].flac
    ffprobe: flac 154,9 s · 35,4 MB · title/artist + carátula mjpeg ✔

El track que falló (风可懂我的思念, 顾北笙):
  [spotify] Spotify la marca como restringida por país; se intenta YouTube igual
  [spotify] ningún resultado se parece … → 0 «風的思念» · 0 «…黄梅戏…»
  → error: «YouTube no tiene «顾北笙 - 风可懂我的思念»: los resultados eran otros
     temas («…»)... No se bajó nada para no darte una canción equivocada»
```

Ese tema no está en YouTube, no está en iTunes y Spotify no publica ni vista
previa: **no hay nada que descargar**, y ahora lo dice con esas palabras.

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
| Apple Music: «vista previa de 30 s» | Apple cifra el audio con DRM (yt-dlp: `Unsupported URL`) | Es lo máximo legal desde Apple; pega el tema desde YouTube/Spotify para la canción completa |
| «Ningún motor sabe leer ese link» | El sitio no lo entiende yt-dlp/gallery-dl/spotdl, o el link es de una página | Usa el link directo del vídeo/audio |
| «El motor se quedó colgado y se detuvo solo» | El motor no imprimió nada en 8 minutos | Reintenta; si se repite, otro motor o revisa proxy/red |
| Spotify: «la canción se encontró, pero YouTube no entregó el audio» | YouTube rechazó la descarga (bot/cookies) | Ajustes → Cookies del navegador (cerrado) y reintenta: el plan B volverá a intentarlo |
| La ficha se queda en «Inspeccionando…» | El sitio no contesta o bloquea el sondeo | Mira el aviso de la ficha: dice el motivo exacto (cookies, privado, red) |
| «Abrir carpeta» abre Documentos | La ruta guardada ya no existe | Linyue comprueba antes y te dice «Ese archivo ya no está en el disco» |
| La isla dice «faltan 3 motores» | Hay binarios obligatorios sin encontrar | Ajustes → *Motor vivo*: el que falta aparece en rojo con su nombre |
| Aliyun Pan pide sesión | Falta el login del CLI | `aliyunpan login` una vez en tu terminal |
