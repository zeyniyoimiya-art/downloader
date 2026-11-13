# Motores, formatos y fidelidad (fase 4)

Todo lo que hay debajo de la interfaz para "descargar cualquier cosa, en cualquier
calidad, sin descargar basura".

## 1. Motores

| # | id | Binario | Para qué | Obligatorio |
|---|----|---------|----------|-------------|
| 1 | `yt-dlp` | `yt-dlp.exe` | YouTube y ~1800 sitios | sí |
| 2 | `ffmpeg` | `ffmpeg.exe` | conversión, mezcla, HLS | sí |
| 3 | `ffprobe` | `ffprobe.exe` | códec real del archivo | sí |
| 4 | `ffplay` | `ffplay.exe` | vista previa sin abrir reproductor | opcional |
| 5 | `gallerydl` | `gallery-dl.exe` | fotos, galerías, perfiles (X, Pixiv, Reddit) | sí |
| 6 | `instaloader` | `instaloader.exe` | perfiles de Instagram | opcional |
| 7 | `spotdl` | `spotdl.exe` | Spotify (metadatos + audio de YouTube) | opcional |
| 8 | `lux` | `lux.exe` | sitios CN (Bilibili, Douyin, iQiyi) | opcional |
| 9 | `aria2c` | `aria2c.exe` | 16 conexiones por archivo (modo turbo) | opcional |
| 10 | `magick` | `magick.exe` | conversión de fotos | opcional |
| 11 | `exiftool` | `exiftool.exe` | metadatos de imagen | opcional |
| 12 | `deno` | `deno.exe` | PO Tokens (bgutil) de YouTube | opcional |
| 13 | **`streamlink`** | `streamlink.exe` | **directos** Twitch / Kick / Bilibili Live | opcional |
| 14 | **`youget`** | `you-get.exe` | **segundo motor CN** (bilibili, youku, niconico) | opcional |
| 15 | **`curl`** | `curl.exe` | **archivos directos** (.mp4, .zip, .pdf, mirrors) | sí (viene con Windows) |

Reglas del router (`routeEngine`), en orden:

1. Spotify → `spotdl`.
2. Instagram perfil → `instaloader`; reel/post → `yt-dlp`.
3. Galería, o foto en X/Pinterest/ArtStation/Reddit → `gallery-dl`.
4. Twitch / Kick / Bilibili Live → `streamlink` si está instalado.
5. Sitios CN (o Bilibili) en vídeo/foto → `lux` **si el interruptor lux está
   activo y lux responde**; si no, `you-get`; si no, `yt-dlp`.
   En **audio** siempre `yt-dlp`: you-get no sabe sacar solo el audio.
6. Archivo directo (`SourceForge`, `.zip`, `.pdf`, mirrors) → `curl`.
7. Resto → `yt-dlp`.

> Nota histórica: `you-get` se colaba por delante de `lux` aunque el interruptor
> estuviera activo, así que ese ajuste no hacía nada. Ahora el interruptor manda.

## 2. Formatos

- **Audio**: `best` · `m4a` · `mp3` · `flac` · `wav` · `opus` · `aac` · `vorbis` · `alac` · `aiff`
- **Vídeo**: `mp4` · `mkv` · `webm` · `mov` · `avi`
- **Foto**: `original` · `webp` · `jpg` · `png` · `avif`
- **Calidad de vídeo**: `máx` · 8K · 4K · 1440p · 1080p · 720p · 480p
- **Calidad de conversión de audio**: `máx (320K)` · 320K · 256K · 192K · 128K

`best` en audio significa "no recodifiques": se guarda el stream tal cual lo
sirve el sitio (`--audio-format best`). Es la mejor calidad **real** disponible.

## 3. El FLAC que no es FLAC

`yt-dlp -x --audio-format flac` descarga AAC 128k de YouTube y lo **recodifica**
a FLAC. El archivo es válido, suena igual y pesa 5 veces más: información no se
recupera. Eso es lo que pediste evitar y es lo que hace `src/lib/shared/fidelity.ts`.

Antes de descargar, `probeMeta()` pregunta el códec **real** del mejor stream de
audio (`acodec`: `mp4a.40.2`, `opus`, `flac`…) y `planAudio()` decide:

| Fuente | Pediste | Modo `estricto` (por defecto) | Modo `avisar` | Modo `libre` |
|--------|---------|-------------------------------|---------------|--------------|
| AAC | flac | **m4a sin recodificar** + aviso | flac, marcado `transcode` | flac |
| Opus | flac | **opus sin recodificar** | flac marcado | flac |
| FLAC | flac | flac (copia, sin recodificar) | flac | flac |
| AAC | mp3 | mp3 (lossy→lossy es legítimo) | mp3 | mp3 |
| cualquiera | best | el original, intacto | igual | igual |

En el historial, un archivo convertido desde origen lossy aparece como
`FLAC (transcode)`; uno real, como `FLAC`. Nunca más un FLAC de 30 MB que era un
AAC de 4 MB.

## 4. Paralelismo y límite de tasa

- `concurrency: 0` = **sin límite práctico**: la cola no frena por número de
  trabajos, solo por el techo de seguridad `maxConcurrency` (24 por defecto).
  Lanzar 200 procesos en Windows agota los handles (EMFILE) y los CDN responden
  429 a todos: el resultado es *más lento* que ir de 8 en 8.
- `probeConcurrency` (3) limita las vistas previas simultáneas; dos links
  idénticos comparten la misma sonda en vuelo.
- `HostLimiter` (`src/lib/server/ratelimit.ts`) lleva un bucket por host y un
  backoff **compartido**: si un trabajo de `youtube.com` recibe 429, todos los de
  ese host esperan 30 s → 60 → 120 → 240 → 300 (tope), con `Retry-After` si el
  sitio lo manda. Los demás hosts siguen a toda velocidad. El trabajo se
  reprograma, no se reintenta en caliente (reintentar en caliente alarga el
  castigo).
- Si aparece el muro anti-bot (403 / "Sign in to confirm you're not a bot"),
  Ajustes → **Cookies del navegador** (`--cookies-from-browser`) o
  **Impersonar navegador** (`--impersonate`, necesita `curl_cffi`).

## 5. Cookies

Tres vías, ninguna sube nada a internet:

1. `cookies.txt` propio por sitio (pestaña Cookies) → `--cookies`.
2. Lectura directa del navegador → `--cookies-from-browser chrome|edge|firefox…`.
   yt-dlp lee el perfil; la app no copia ni guarda los valores.
3. streamlink no entiende `cookies.txt`: `jobs.ts` traduce las líneas a pares
   `nombre=valor` en memoria y los pasa como `--http-cookie`. **Nunca se escriben
   en el log, en el historial ni en config.json.**

---

# Fase 5 — códecs, contenedores y pistas

## 6. La diferencia entre contenedor y códec

`MP4`, `MKV`, `WebM` son **cajas**. Lo que va dentro es el **códec**, y es lo que
decide si el archivo se abre en tu tele, en tu móvil o en tu editor:

| Códec | Se llama en yt-dlp | Cuándo usarlo |
|---|---|---|
| **H.264 / AVC** | `avc1`, `avc3` | lo abre absolutamente todo |
| **H.265 / HEVC** | `hev1`, `hvc1` | ~40 % menos peso, misma calidad |
| **AV1** | `av01` | el más eficiente; lento de codificar |
| **VP9** | `vp09` | el estándar de YouTube |
| **VP8** | `vp8` | viejo, solo compatibilidad |
| **MPEG-4 Part 2** | `mp4v` | reproductores antiguos, AVI |
| **ProRes** | `apcn`… | edición profesional (solo recodificando) |
| **Theora** | `theora` | histórico (solo recodificando) |

El descargador tiene chips de códec al lado de la calidad: **Auto · H.264 · H.265 ·
AV1 · VP9**. El códec elegido se traduce a un filtro `-f` con **cadena de
fallback**: `bv*[vcodec^=hev1][height<=2160]+ba/bv*[height<=2160]+ba/…`. O sea:
si el sitio tiene HEVC, HEVC; si no, lo mejor disponible **sin fallar**. (Sin esa
cola, un Short vertical o un DASH de bilibili muere con *"Requested format is not
available"*.)

Dos cosas más que se corrigen solas:

- **Contenedor incompatible** → `resolveContainer()`. WebM + H.264 no existe:
  se muxea a MP4/MKV y se anota en el log del trabajo.
- **Códec que el sitio no tiene** → tras descargar se comprueba con `ffprobe` qué
  llegó de verdad. Si no coincide, se te dice con nombre y apellido (`el sitio no
  ofrece H265; llegó VP9`) y, si activas **"Recodificar si falta el códec"**, se
  hace una segunda pasada con ffmpeg.

## 7. Audio: los 9 de yt-dlp y los 7 que hacemos nosotros

yt-dlp solo sabe extraer **9** formatos: `best, aac, alac, flac, m4a, mp3, opus,
vorbis, wav`. Pedirle `--audio-format ac3` es un error duro, así que:

- esos 9 → los hace yt-dlp directamente (copia/remux, sin pérdida añadida);
- **AC-3, E-AC-3, DTS, AIFF, PCM 24 bits, MP2** → se extrae el stream original y
  `jobs.ts` lo convierte con **ffmpeg** (o se conserva el original si activas
  "Conservar el original").

| Formato | Códec real que sale | Quién lo hace |
|---|---|---|
| M4A / AAC | `aac` | yt-dlp |
| MP3 | `libmp3lame` 320k | yt-dlp |
| Opus / OGG | `opus` / `vorbis` | yt-dlp |
| FLAC / ALAC | `flac` / `alac` | yt-dlp (ver §3, fidelidad) |
| WAV 16 · WAV 24 | `pcm_s16le` · `pcm_s24le` | yt-dlp · ffmpeg |
| **AC-3 · E-AC-3** | `ac3` · `eac3` 640k | ffmpeg |
| **DTS** | `dca` (`-strict -2`) | ffmpeg |
| **AIFF** | `pcm_s16be` | ffmpeg |
| **MP2** | `mp2` 320k | ffmpeg |

Verificado **de verdad** en `tests/ffmpeg-real.test.ts`: por cada destino se genera
un tono, se convierte con los argumentos reales de la app y se comprueba con
`ffprobe` que el `codec_name` resultante es el esperado. 11 audios + 8 vídeos.

## 8. Pistas (subtitle / chapters / cover)

| Ajuste | Qué hace | Flag |
|---|---|---|
| Subtítulos: no / aparte / incrustados | `.srt` suelto o dentro del archivo | `--write-subs` / `--embed-subs --convert-subs srt` |
| Idiomas | `es,en` o `all` | `--sub-langs` |
| Subtítulos automáticos | los que genera YouTube | `--write-auto-subs` |
| Capítulos | marcas de tiempo dentro | `--embed-chapters` |
| Miniatura como carátula | portada empotrada | `--embed-thumbnail --convert-thumbnails jpg` |

## 9. Matriz de contenedores

| Contenedor | Vídeo | Audio |
|---|---|---|
| MP4 | H.264 · H.265 · AV1 · MPEG-4 · VP9 | AAC · MP3 · AC-3 · E-AC-3 · ALAC · Opus |
| MKV | **todos** | **todos** |
| WebM | VP8 · VP9 · AV1 | Opus · Vorbis |
| MOV | H.264 · H.265 · ProRes · MPEG-4 | AAC · ALAC · PCM · MP3 · AC-3 |
| M4V | H.264 · H.265 | AAC · AC-3 · E-AC-3 · ALAC |
| TS | H.264 · H.265 · MPEG-4 | AAC · AC-3 · E-AC-3 · MP3 · MP2 |
| AVI | MPEG-4 · H.264 | MP3 · PCM · AC-3 · MP2 |
| FLV | H.264 | AAC · MP3 |
| OGV | Theora · VP8 | Vorbis · Opus |

Resoluciones: `máx · 8K · 4K · 1440p · 1080p · 720p · 480p · 360p · 240p · 144p`.
Fotos: `original · webp · jpg · png · avif · bmp · tiff · gif`.

## 10. Tres trampas que costaron un bug cada una

1. **Salida = entrada.** Convertir `tono.wav` → "WAV 24 bits" produce el mismo
   nombre de archivo, y ffmpeg se niega (`Output ... same as Input`). Ahora la
   salida lleva sufijo ` (conv)` cuando la extensión no cambia.
2. **DTS es experimental.** `-c:a dca` falla en seco con
   *"experimental codecs are not enabled"*. Necesita `-strict -2`, y así está.
3. Y el audio del contenedor: OGV/WebM no admiten AAC → `libvorbis`/`libopus`
   automáticamente, si no ffmpeg aborta con *"Could not find tag for codec aac"*.

---

# Fase 7 — que no se pierda nada (y que se pueda arreglar)

## 11. La cola sobrevive a cerrar la app

Antes la cola vivía solo en memoria: cerrar la ventana, reiniciar Windows o un
build en caliente borraba lo que estaba a medias, dejaba un `.part` huérfano y
ningún rastro de qué falló. Con un MKV de 20 GB eso es perder la noche.

Ahora hay un **`queue.json`** en la carpeta de datos (junto a `config.json` e
`history.json`):

- **Escritura atómica** (`tmp` + `rename`): un corte de luz no deja un JSON
  truncado; o está el viejo o está el nuevo.
- **Debounced a 1 s**: el progreso emite ~10 veces/s y no se reescribe el disco a
  ese ritmo.
- **Al arrancar**, los estados `probing`/`running`/`post` vuelven como `queued`
  con una línea honesta en el log (*"reanudado tras reiniciar la app"*): se
  reanudan solos, sin fingir que seguían corriendo.
- Se guardan los últimos **200 terminados**: la cola no es el historial.

Verificado de verdad: se cortó el servidor con un trabajo en `running`, se
arrancó de nuevo y el trabajo volvió como `queued`, se ejecutó y terminó `done`.

## 12. Rangos de lista y nombres a tu gusto

| Ajuste | Qué hace | Ejemplo |
|---|---|---|
| **Rango de la lista** | qué elementos de una playlist/perfil bajar | `1-20` · `-10` (los últimos 10) · `5` · `1,3,7-9` |
| **Nombres** | carpetas y nombre de archivo | ver tabla |

| Estilo | Plantilla | Para qué |
|---|---|---|
| `ordenado` | `Canal/Título [id].ext` | el de siempre; agrupa por canal y no pisa duplicados |
| `fecha` | `Canal/2026-11-13 — Título [id].ext` | ordena cronológicamente solo |
| `compacto` | `Título [id].ext` | todo suelto: móvil, USB, Plex sin carpetas |
| `plano` | `Título.ext` | solo el nombre (dos iguales chocan: para eso está `[id]`) |

El rango se **valida en el servidor** (`-?\d+(-\d+)?`), porque termina como
argumento de un proceso: `--playlist-items 1-20` sí, `--playlist-items $(whoami)`
jamás. Igual con el proxy: se rechaza `usuario:clave@host` para que una
credencial no acabe en el log de un trabajo.

## 13. Proxy de verdad

Un campo en Ajustes (`http://127.0.0.1:7890`, `socks5://10.0.0.2:1080`) que llega
a cada motor con **su** bandera:

| Motor | Bandera |
|---|---|
| yt-dlp | `--proxy` |
| curl | `--proxy` |
| streamlink | `--http-proxy` |

Sirve para los dos casos reales: sitios CN que solo responden desde dentro y
salir de un 429 que ya te marcó la IP.

## 14. No quedarse sin disco a mitad

- La vista previa ahora devuelve **tamaño aproximado** y la ficha lo pinta
  (`1.4 GB`).
- El hero muestra **espacio libre** y avisa en rojo por debajo de 5 GB.
- Antes de lanzar, si el tamaño estimado × 1,15 no cabe, el trabajo **falla al
  instante** con el motivo exacto en vez de dejar un `.part` inservible:
  *"No hay espacio: el archivo ocupa ~18.4 GB y quedan 4.1 GB"*.

## 15. Actualizar los motores desde la app

yt-dlp se rompe cada pocas semanas cuando un sitio cambia, y el usuario acaba con
*"Unsupported URL"* sin saber que su binario tiene seis meses. El botón
**Actualizar** del panel «Motor vivo» ejecuta los comandos oficiales, **uno
detrás de otro** (nunca a la vez: tres descargas simultáneas en el mismo disco se
estorban) y solo desde una lista blanca:

| Motor | Comando |
|---|---|
| yt-dlp | `-U` |
| gallery-dl | `--update` |
| BaiduPCS-Go | `update` |
| deno | `upgrade` |

Al terminar re-escanea y refresca las versiones del panel. Nada de ejecutar texto
del usuario: los argumentos están escritos en el código.

## 16. Programador: «bájalo a las 3 de la mañana»

Dos piezas independientes que comparten el mismo mecanismo de cola:

**a) Ventana silenciosa** (Ajustes → Programador). Se activa con un interruptor
y dos horas (`01:00 → 07:00`). Fuera de la ventana `pump()` **no arranca nada
nuevo**; lo que ya está bajando sigue hasta el final (matar una descarga al 90 %
porque se hizo de día sería peor que dejarla terminar). Al cerrar la ventana no
se hace *polling*: se calcula `msHastaApertura()` y se pone un `setTimeout`, así
que la app puede estar horas sin despertar. Al cambiar la ventana en Ajustes se
llama a `despertarCola()`: sin eso, la cola seguiría dormida hasta la hora
calculada con la configuración anterior.

**b) Retraso por trabajo** (home → chips `Ahora · 15 min · 1 h · 3 h`). Cada
trabajo guarda `startAt` y `pump()` lo salta (`puedeArrancar`) hasta que llega su
hora. Los programados también fijan el próximo `setTimeout`, así que no hay
sondeo; y como van a `queue.json`, **sobreviven a cerrar la app**.

El caso que rompe las implementaciones ingenuas es la ventana que **cruza la
medianoche** (22:00 → 07:00): comparar `hora >= ini && hora < fin` falla ahí.
Aquí se comparan minutos desde medianoche con los dos casos separados (`a < b ?
t >= a && t < b : t >= a || t < b`) y la hora es **local del equipo**, no UTC.

## 17. Estadísticas sin telemetría

`/estadisticas` (pestaña **Datos**) responde a preguntas que el historial crudo
no contesta: GB totales, tiempo acumulado de vídeo/audio, plataformas distintas,
racha de días, récord de archivo más grande, y el reparto por plataforma,
formato, motor y canal.

- Todo se calcula **en el cliente** desde `history.json` (`calcularEstadisticas`
  es una función pura, testeable sin fs ni red). No hay tabla nueva en disco, no
  se manda nada a ningún sitio.
- La serie de días **incluye los cubos vacíos**: si se omiten, el gráfico
  comprime los huecos y miente sobre la actividad.
- Los días se calculan en hora **local** (`diaLocal`) y restando días de
  calendario (`setDate`), no múltiplos de 24 h: en el cambio de horario de verano
  un cubo se duplicaría o se saltaría.
- La racha no se rompe por no haber bajado nada **hoy** todavía (se ancla en ayer).
- El gráfico es CSS/SVG puro: cero librerías nuevas, cero `npm install`.

## 18. 蓝奏云 (Lanzou) sin binario

Lanzou no tiene CLI ni extractor en yt-dlp, así que la app lo resuelve **ella
misma** (`src/lib/server/lanzou.ts`), en tres saltos:

1. De la página del recurso se saca el `<iframe class="n_downlink">`.
2. Del iframe salen `sign`, `file` y (si el enlace tiene contraseña) `p`.
3. `POST ajaxm.php?file=…` con esos datos devuelve `{zt, dom, url, inf}`. `zt`
   tiene que ser `"1"`; `dom` viene **sin esquema** y `url` con `\/` escapado,
   que hay que recomponer.

La descarga final exige el `Referer` del iframe (sin él: 403) y se escribe a
disco con progreso real por stream. Notas honestas:

- Los dominios rotan (`lanzoui`, `lanzoux`, `lanzoub`, `lanzn`…) y el HTML cambia
  cada pocos meses. Por eso hay varios patrones y un error explícito:
  *«Lanzou cambió el formato»*, en vez de un fallo mudo.
- No hay cuentas ni cookies: el `?pwd=` (o el `密码: xxxx` pegado al enlace) se
  usa como contraseña del recurso y no se guarda en ningún sitio.
- El nombre del archivo pasa por `nombreSeguro()` (quita `\ / : * ? " < > |`,
  limita a 150 caracteres): Windows no admite esos caracteres y el trabajo se
  quedaba sin escribir nada.

## 19. 阿里云盘 (Aliyun Pan)

Motor 17, binario `aliyunpan` (`aliyunpan.exe` en Windows). Flujo en dos pasos,
igual que Baidu 网盘:

1. `share <url> -save` — transfiere el recurso compartido a **tu** cuenta.
2. `download <ruta-remota> -saveto <carpeta> --retry` — baja de verdad.

El login se hace **una vez** en tu terminal (`aliyunpan login`): el token lo
guarda el propio CLI en su config y la app nunca ve ni pide credenciales. Si no
hay sesión, el motor falla con su propio mensaje y el trabajo lo muestra tal cual.
