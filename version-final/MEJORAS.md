# Revisión de código · Linyue Studio

**Fecha:** 12 de noviembre de 2026
**Base revisada:** commit `74ea30c` (`zeyniyoimiya-art/downloader`, rama `main`)
**Alcance:** 2 786 líneas de TypeScript en 30 archivos + configuración + tests

---

## 0. Estado de partida (lo que encontré)

Antes de tocar nada corrí el proyecto entero:

| Comprobación | Resultado |
|---|---|
| `npm install` | 404 paquetes, sin errores |
| `tsc --noEmit` | **0 errores** |
| `vitest run` | **95/95 tests en verde** |
| `eslint .` | 0 errores, 2 avisos (`<img>`) |
| `next build` | **compila** (16 rutas) |
| Secretos en el repo | ✅ ninguno (revisé cookies Netscape, `.env`, sesiones) |

O sea: **el proyecto no está roto**. La sensación de "propenso a errores" viene de
una docena de fallos concretos de lógica y de concurrencia, no de que esté mal
escrito. La arquitectura (whitelist de motores, `spawn` sin shell, args en array,
archive por modo, SSE sin dependencias) es sólida y los comentarios explican
decisiones reales. Eso se respeta: no reescribí nada que funcionara.

---

## 1. Bugs reales encontrados y corregidos

### 🔴 Críticos (rompen la función principal)

**1. `instaloader` ignoraba tus cookies de Instagram**
`src/lib/shared/args.ts`
Se pasaba `--load-cookies chrome`, que le dice a instaloader *"saca las cookies
del Chrome instalado en el sistema"*. Resultado: tu `cookies.txt` de `/cookies`
**nunca se usaba**, y si no tenías Chrome instalado, instaloader abortaba.
Verificado contra el binario real: existe `-B, --cookiefile COOKIE-FILE`.
→ Ahora se pasa `--cookiefile <ruta>`.

**2. `spotdl` no encontraba ffmpeg**
`src/lib/shared/args.ts` + `src/lib/server/jobs.ts`
Se le pasaba la **carpeta** (`--ffmpeg C:\vendor`). spotdl exige **la ruta al
ejecutable** (`--ffmpeg C:\vendor\ffmpeg.exe`); con una carpeta responde
"FFmpeg not found" y aborta toda la descarga de Spotify.
→ Nuevo campo `ffmpegPath` (binario) para spotdl; yt-dlp sigue recibiendo la
carpeta con `--ffmpeg-location`, que es lo que él espera.

**3. Éxito falso: "Descarga lista" sin haber descargado nada**
`src/lib/server/jobs.ts`
El comando lleva `--ignore-errors`, y con esa bandera yt-dlp **sale con código 0
aunque todo haya fallado**. El trabajo se marcaba `done`, salía el toast verde y
el archivo no existía.
→ Si el proceso sale con 0, hay una línea `ERROR:` en el log y no hay ni un
archivo, el trabajo se marca como error **con el mensaje real del extractor**.

**4. Entrada fantasma en Recientes**
`src/lib/server/jobs.ts`
Cuando no se detectaba ningún archivo se guardaba una entrada de historial con
`path: cfg.outputDir`, es decir **una carpeta**. Eso rompía la vista previa (404),
el botón "abrir" y envenenaba la deduplicación (`isLiveFile` siempre false).
→ Ya no se inventa la entrada; se marca `warning` y se anota en el log.

### 🟠 Importantes (causan fallos intermitentes difíciles de reproducir)

**5. Carrera al reescribir el archive**
`jobs.ts` · `reconcileArchiveFor()` reescribía `archive-<modo>.txt` al arrancar
**cada** trabajo, mientras otro trabajo del mismo modo podía estar añadiéndole
líneas desde yt-dlp. Con concurrencia ≥2 se perdían entradas → descargas
duplicadas o saltadas. Ahora solo reconcilia si no hay otro trabajo vivo del
mismo modo.

**6. Proceso huérfano al pausar durante la vista previa**
`jobs.ts` · El sondeo previo (`--dump-single-json`) no se registraba en
`mgr.procs`, así que pausar/cancelar en ese momento **no mataba nada**: el
trabajo quedaba "pausado" con un yt-dlp de 40 MB corriendo de fondo.
→ `runCapture()` acepta un callback `onSpawn` y el sondeo se registra.

**7. Dos re-escaneos en paralelo**
`engines.ts` · Si dos pestañas pulsaban "Re-escanear" a la vez se lanzaban 24
binarios de 40–95 MB simultáneos: el disco se saturaba, los `--version` agotaban
timeout y **motores sanos aparecían en ámbar**. Ahora hay un único escaneo en
vuelo (promesa compartida).

**8. `p.kill()` no mataba el árbol**
`engines.ts` · Los binarios son PyInstaller y dejan hijos. En el timeout se
mataba solo al padre. Ahora se usa el mismo `killProc`/`taskkill /T /F` que ya
existía en `jobs.ts`.

**9. Timers de SSE sin protección**
`src/app/api/events/route.ts` · El latido cada 15 s hacía `ctrl.enqueue()` sin
`try/catch`: si el cliente cerraba entre el abort y el `clearInterval`, eso era
una excepción **no capturada** dentro de un timer.

### 🟡 Rendimiento y consistencia

**10. `getConfig()` leía el disco en cada llamada**
`store.ts` · Se llama en cada `pump()`, en cada job y en casi todas las rutas:
`readFileSync` + `JSON.parse` + validación Zod decenas de veces por segundo
durante una descarga. → Caché invalidada por **mtime** (barata y correcta si
editas `config.json` a mano).

**11. `addHistory()` hacía hasta 5 000 `statSync` por archivo**
`store.ts` · `h.filter(x => … !isLiveFile(x))` tocaba el disco para **todas** las
entradas del historial. → Primero se descarta por URL (en memoria) y solo se
hace `statSync` de las entradas de esa misma URL.

**12. `getHistory()` releía y parseaba 5 000 entradas por consulta**
`/api/history`, cada `enqueue` y cada guardado. → Caché con invalidación por
mtime, igual que la config.

**13. La conversión de fotos era invisible**
`jobs.ts` · Magick generaba el `.webp` pero el historial seguía apuntando al
`.png` original (y los dos quedaban en disco). Ahora `job.files` pasa a los
archivos convertidos, así que Recientes y la vista previa muestran el formato
final.

**14. "Perfil completo" en mp3 se degradaba a mp4**
`jobs.ts` · El pool de formatos del modo `profile` era solo de vídeo, así que
elegir mp3 caía en silencio al formato por defecto (mp4), contradiciendo lo que
promete el README.

**15. Ids de trabajo colisionables**
`store.ts` · `Math.random().toString(36).slice(2,10)` puede devolver **menos de
8 caracteres**; dos trabajos podían compartir id y `/api/jobs/[id]` actuar sobre
el equivocado. → `newId()` con `randomUUID`, siempre 10 caracteres `[a-f0-9]`.

**16. Reintentos sin backoff**
`jobs.ts` · Los 3 intentos iban a 3 s fijos: contra un CDN que te limita
(HTTP 5xx/429) se gastaban seguidos. → 3 s → 8 s → 20 s.

**17. SSRF parcial**
`platforms.ts` · `isSafeUrl` bloqueaba `127.`, `10.`, `192.168.` y `[::1]`, pero
dejaba pasar **`172.16/12`, `169.254.169.254`** (metadatos de nube), `0.0.0.0`,
`[::]` y `algo.localhost`. → `isPrivateHost()` completo.

---

## 2. Tests nuevos

`tests/mejoras.test.ts` — **12 tests** que blindan cada corrección (cookies de
instaloader, ruta de ffmpeg en spotdl, pools de formato, SSRF, ids).

```
tests/core.test.ts     95 tests  ✅
tests/mejoras.test.ts  12 tests  ✅
────────────────────────────────
Total                 107 tests
```

También arranqué el servidor real (`next start`) y ejecuté el flujo completo por
API: `enqueue → simulacro → done → /api/history`, con ids válidos y entrada de
historial correcta. Todo responde.

---

## 3. Lo que **no** toqué (y por qué)

- **Los 2 avisos de `<img>`**: pasar a `next/image` exige configurar dominios
  remotos de miniaturas (YouTube, TikTok, X…) y **puede romper** las carátulas en
  tiempo de ejecución. Es un aviso de LCP, no un bug. Si quieres, lo hacemos con
  un `loader` propio y lo probamos plataforma por plataforma.
- **La UI/UX**: no cambié ni un pixel (pediste "menos propenso a errores"; lo
  estético lo dejo para una segunda pasada a tu gusto).
- **385 MB de `.exe` en el repo**: están en el historial de git (GitHub avisó).
  Añadí las reglas a `.gitignore` para que **no vuelvan a entrar**, pero sacarlos
  del historial requiere reescribirlo. Comandos, si te animas:

  ```bash
  git rm --cached version-final/vendor/*.exe
  git commit -m "vendor: los binarios no van al repo"
  # y para limpiar el historial (reescribe commits):
  # git filter-repo --path version-final/vendor --invert-paths
  ```

  Alternativa recomendada: **Git LFS** (`git lfs track "vendor/*.exe"`).

---

## 4. Seguridad — pendiente de tu lado

1. **Borra el archivo de GoFile** (`FgvjTRcw`). En el repo **no** hay cookies
   (lo verifiqué), pero ese link sigue siendo público.
2. Si compartiste cookies reales en algún sitio, **cierra sesión en todos los
   dispositivos** y vuelve a entrar. 2 minutos, y te ahorra un dolor de cabeza.
3. `cookies/route.ts` ya escribe con permisos `0600` y valida formato Netscape:
   eso está bien hecho. Solo cambiaría una cosa: hoy **no hay autenticación** en
   la API. Como `iniciar_linyue.bat` fija `127.0.0.1`, es aceptable; si algún día
   lo expones en red (`-H 0.0.0.0`), cualquiera en tu LAN podría lanzar binarios
   en tu máquina.

---

## 5. Cómo verificarlo tú mismo

```bash
cd version-final
npm install
npx tsc --noEmit     # 0 errores
npx vitest run       # 107 tests
npx next build       # compila
```

Y para jugar sin motores reales:

```bash
LINYUE_MOCK_ENGINES=1 npm run dev     # motores simulados, cero binarios
```

---

## 6. Archivos modificados

```
src/lib/shared/args.ts        cookies de instaloader + ruta de ffmpeg en spotdl
src/lib/shared/platforms.ts   isPrivateHost() / SSRF
src/lib/server/jobs.ts        éxito falso, carrera del archive, huérfanos,
                              conversión de fotos, pools de formato, backoff, ids
src/lib/server/store.ts       newId(), caché de config e historial, addHistory
src/lib/server/engines.ts     escaneo único, kill del árbol, timeout
src/app/api/events/route.ts   latido SSE protegido
src/lib/client/types.ts       campo warning en JobView
.gitignore                    vendor/*.exe, logs y salidas de test
tests/mejoras.test.ts         12 tests nuevos
```

**+232 / −30 líneas.** Nada eliminado que funcionara; solo fallos cerrados.

---

## 7. Registro de fases posteriores (4 → 8)

Lo de arriba es la revisión inicial (fase 1, 107 tests). Después vinieron cinco
entregas más, todas sobre `mejoras/revision-codigo` y con la misma regla: **cero
humo**. Si algo no se puede, se dice y se explica por qué.

| Fase | Qué entró | Verificación |
|---|---|---|
| 4 | Descargador universal, cookies, paralelismo con techo, auditoría CSRF/rutas, detección de FLAC falso | `tsc` 0 · 145 tests |
| 5 | Catálogo de audio/vídeo/imagen, resolución/fps/bitrate/calidad, **códecs reales** | `tsc` 0 · 176 tests |
| 6 | Familia Baidu: 网盘 con cuenta propia y 贴吧 sí; Wenku **no** (y se explica) | 193 tests |
| 7 | Cola persistente, rangos de lista, nombres, proxy, control de disco, auto-actualización de motores | 208 tests · `next build` ✓ |
| 8 | Programador (ventana + retraso), panel de estadísticas, 蓝奏云 nativo y 阿里云盘 | **233 tests** · `tsc` 0 · `eslint` 0 · `next build` ✓ |

Detalle de cada una en `MOTORES.md` (§11–19). Lo que la fase 8 **no** promete:

- **Lanzou** cambia de dominio y de HTML cada pocos meses; hay varios patrones y
  un error explícito *«Lanzou cambió el formato»*. No es un soporte eterno.
- **阿里云盘** exige `aliyunpan login` una vez en tu terminal. La app no pide ni
  guarda credenciales de nadie, ni siquiera las tuyas.
- Las **estadísticas** se calculan en tu PC desde `history.json`: no hay tabla
  nueva, ni telemetría, ni salida a internet.

---

## 8. Fase 10–11 · probar con la red de verdad

Todo lo anterior se verificó con motores simulados (`LINYUE_MOCK_ENGINES=1`), que
es rápido y reproducible pero **no puede** encontrar los fallos que solo aparecen
cuando hay un `yt-dlp` real, una red real y un navegador real. Así que la fase 10
se hizo con YouTube de verdad (vídeo `jNQXAC9IVRw`) en un Chromium automatizado,
y la 11 con el ZIP tal como lo descarga el usuario.

### Los ocho fallos que aparecieron

| # | Qué se vio | Dónde estaba | Cómo se arregló |
| --- | --- | --- | --- |
| 1 | La ficha de vista previa nunca se rellenaba: quedaba «Inspeccionando…» | `src/app/api/probe/route.ts` — doble `Response.json` sobre un `Response` → `{}` de 2 bytes | la promesa resuelve al objeto y se envuelve una vez |
| 2 | Sondeo de 30 s en frío | `--retries` por defecto de yt-dlp | 1 reintento, `--socket-timeout 15`, timeout 20 s, caché de 10 min |
| 3 | Quitar una suscripción: `404` y la fila seguía | `app/page.tsx` mandaba el id en el cuerpo | `?id=` en la query |
| 4 | Suscripciones muertas: `spawn …/vendor/yt-dlp ENOENT` | `lib/server/subs.ts` con ruta fija al binario | `resolveEngine("yt-dlp")` |
| 5 | Playlists con la ruta como título en Recientes | `lib/server/jobs.ts` | `tituloDeArchivo()` |
| 6 | «Re-bajar» decía «Re-bajando» aunque fallara | `app/recientes/page.tsx` | se mira `r.ok` y el mensaje del servidor |
| 7 | *Abrir carpeta* no abría nada (o abría **Documentos**), sobre todo con nombres con espacios | dos trampas de Windows: `["/select,", ruta]` son dos argumentos, y `["/select,"+ruta]` con espacios tampoco funciona porque Node entrecomilla el argumento completo | `abrir-sistema.ts`: comillas **dentro** del argumento (`/select,"C:\…\a b.mp4"`) + `windowsVerbatimArguments: true`, plan B por `cmd /c start`, y el comando ejecutado viaja en la respuesta para diagnosticar |
| 8 | Ajustes se salía de la pantalla en móvil (390 px) y la consola soltaba avisos de `navigator.vibrate` | `max-w-[42%]` sin `min-w-0`; vibración sin interacción | `basis-[38%]` + `min-w-0`; `userActivation` antes de vibrar |

Extra: todos los `spawn` de «lanzar y olvidarse» (`shutdown`, `taskkill`,
`explorer`) podían tumbar el proceso de Node con un `error` no escuchado. Ahora
pasan por `lib/server/proc.ts`, que siempre lo escucha.

### Verificación

```
tsc    0 errores
eslint 0 errores
vitest 366 tests en 14 archivos  (antes 351: +15 de regresión)
build  ✓  (Next 16.2.6, Turbopack)

Sonda real:      1,27 s en frío · 0,01 s con caché
Suscripciones:   {ok:true, nuevos:1} · etiqueta «jawed»
Playwright:      6 rutas · 0 errores de consola · 0 respuestas ≥ 400
Móvil 390 px:    6 rutas · sin scroll horizontal
Taller real:     mp3 de 19 s → mp3 320 kbps, 66× tiempo real, salida válida (ffprobe)
```

Los únicos códigos 400 que quedan son los deliberados: `POST /api/cookies` con
texto basura y `PUT /api/config` con la carpeta de salida vacía. Un `404` existe
también a propósito: abrir un archivo que ya no está en el disco, que ahora se
explica con «Ese archivo ya no está en el disco».


---

## 9. Fase 12 · «el archivo está, pero dice que no»

El usuario reportó dos cosas que resultaron ser la misma: *Abrir carpeta* no
hacía nada y varias tarjetas decían «El archivo ya no está en esa ruta» con el
archivo delante, dentro de su carpeta de Linyue.

### La causa

`/api/history` comprobaba la existencia con `fs.statSync(h.path)`. Si la ruta
guardada estaba desfasada —otra carpeta de salida, el nombre saneado de otra
forma por el motor, `.m4a` convertido a `.mp3`, el archivo movido a la carpeta
del autor—, la respuesta era «no existe», la tarjeta avisaba en falso y *Abrir
carpeta* recibía una ruta muerta.

### Lo que se hizo

| Pieza | Qué hace |
| --- | --- |
| `lib/shared/parecido.ts` | Normaliza nombres (tildes, emoji, `「」`, `｜`) y puntúa si un archivo del disco es el del historial: 100 nombre exacto · 96 `[videoId]` · 90 mismo título · 72 nombre recortado; penaliza cambio de extensión |
| `lib/server/rutas.ts` | `resolverRutaReal`: ruta exacta → su carpeta → índice de la carpeta de salida (recursivo, 4 niveles, 20 000 archivos, caché 20 s, ignora `.part`/`.ytdl`). `primerAncestroExistente` para abrir «lo más cercano que existe» |
| `/api/history` | Devuelve la ruta REAL en `path`, más `rutaGuardada`, `existe`, `motivo` (`exacta`/`id`/`titulo`/`parecido`) y `corregida`. Deduplica por ruta real |
| `POST /api/history` | Botón **Reconectar** de Recientes: repara las rutas malas y dice cuántas |
| `/api/open` | Resuelve el archivo antes de abrir; corrige el historial al vuelo; si no aparece, abre la carpeta más cercana con aviso (antes: 404 seco) |
| `lib/server/abrir-sistema.ts` | TRES métodos en Windows (`explorer.exe` verbatim → `cmd /c start` → PowerShell `Start-Process`), y la respuesta dice cuál funcionó (`metodo`) |
| `/api/diagnostico` | Versión, plataforma, carpetas, archivos vistos, comando de apertura y resolución de las últimas 12 entradas |
| Ajustes | Sello `v1.3.0 · 2026-11-14` para poder descartar que se está ejecutando el ZIP anterior |

### Verificación

```
tsc 0 · eslint 0 · vitest 381 en 15 archivos · next build ✓

Historial con rutas rotas a propósito (C:\Users\Zenith\… que no existe aquí):
  aaaa1111  exacta   → /tmp/real2/out/Madonna/Audio/Madonna Vs Sickick - Frozen […].m4a   ✔
  bbbb2222  titulo   → /tmp/real2/out/张杰/Audio/他不懂 (抖音DJ版) ….mp3  (emoji + otra extensión) ✔
  cccc3333  no aparece → se avisa y se abre la carpeta de salida ✔

POST /api/history → {revisadas:3, corregidas:2, perdidas:1} y history.json reescrito.
Playwright: 3 tarjetas, abrir carpeta, Reconectar · 0 errores de consola · 0 respuestas ≥ 400.
```

---

## Fase 13 · enlaces universales: lo que falla, falla por algo

La petición era «que soporte cualquier link». Lo que había no era falta de
motores: yt-dlp + gallery-dl + spotdl ya cubren miles de sitios. Lo que había era
**mensajes que culpaban al sitio equivocado** y **un trabajo que se rendía (o se
colgaba) sin decirlo**. Se probó con 20 links reales contra la app levantada en
`127.0.0.1`, sin mocks, y salieron siete fallos propios:

| Síntoma | Causa de verdad | Arreglo |
| --- | --- | --- |
| Un MP3 404 y un pin de Pinterest borrado decían «falta un motor en `vendor`» | `causaDeError` tenía `/not ?found/` → cualquier 404 era «motor» | causas `noexiste` · `sesion` · `bloqueo` · `proveedor`; `motor` sólo para `ENOENT`/`WinError 2` |
| Un `.ogv` ya descargado se perdía con «Conversion failed!» | el pase a mp4 falló y se descartó la descarga entera | si hay archivos vivos → `done` + aviso «se guardó el original (OGV)» |
| Spotify moría con traceback de PyInstaller y dejaba la cola colgada 17 min | spotdl saca el audio de YouTube; YouTube lo rechazaba | plan B propio con oEmbed + `ytsearch5` + puntuación de candidatos; `--ffmpeg` absoluto, Deno y `PATH` con `vendor` |
| YouTube con «not a bot» reintentaba 4 veces (30→300 s) y congelaba el host | backoff para un error que no mejora esperando | bloqueos de bot: 1 intento, penalización de 8 s |
| Spotify «listo» con 0 archivos | spotdl sale con 0 sin bajar nada | sin archivos → plan B; si también falla → error con la causa real |
| Trabajo «en curso» eternamente | no había vigilante | 8 min sin salida → se mata y se explica |
| gallery-dl escribía nombres inválidos para Windows | el nombre lo pone el sitio | `--windows-filenames` |

### El plan B de Spotify, con números

```
oEmbed (sin claves) → «Billie Eilish - bad guy»
yt-dlp --flat-playlist --dump-single-json "ytsearch5:Billie Eilish bad guy"
puntuación: 55·(palabras del título) + 30·(palabras del artista) + 12 título exacto
            + 8 canal del artista + 5 sello/topic/VEVO − 40 ruido − 40 álbum completo
            − 25 duración < 45 s; si el artista no está ni en título ni en canal: −45
umbral 55 → elegido → descarga con yt-dlp + metadatos + carátula
```

Verificado con el caso que falló: «bad guy» ya no elige la versión de *Falling In
Reverse* (nota 18) y sí la de Billie Eilish (nota 100). 10 tests en
`tests/spotify.test.ts`, dos de ellos con los datos reales de la batería.

### Verificación

```
tsc 0 · eslint 0 · vitest 392 en 16 archivos · next build ✓
batería real (15 links, sandbox Linux): 6 done · 7 error · 1 en curso
  OK  YouTube vídeo · TikTok · SoundCloud · MP4 · MP3 · .ogv (con aviso)
  ⛔  YouTube Music/playlist/Shorts y Spotify: «no eres un robot» (límite de IP del sandbox:
      probados los 5 player clients de yt-dlp, con y sin Deno, todos igual)
  ⛔  Instagram · Vimeo: «pide una cuenta (sesión)»   ⛔ Bilibili: «bloqueando» (412)
  ⛔  Dailymotion/Pinterest/X: «ya no existe» (contenido retirado)
```

En un PC doméstico, con cookies del navegador, los dos primeros grupos bajan.
Lo que **no** se puede prometer: que un sitio con login funcione sin tu sesión.

---

## Fase 14 · Apple Music: decir la verdad y hacer lo que sí se puede

`https://music.apple.com/bo/song/…/1742176281` fallaba con «Ese formato no
existe en este contenido». El motor decía `Unsupported URL`: el audio de Apple
va con FairPlay, así que no hay nada que extraer. Ni el motor ni la app podían
bajarlo, pero el mensaje culpaba al formato y no ofrecía salida.

| Pieza | Qué hace |
| --- | --- |
| `lib/server/apple.ts` | `esUrlApple` · `idApple` (canción, álbum, `?i=`, playlist) · `pistasApple` (API pública de iTunes, sin claves) · `artworkGrande` (100 px → 1400 px) · `aPista` |
| `jobs.ts` → `rescatarApple` | iTunes → búsqueda en YouTube → puntuación → yt-dlp (misma pieza que Spotify: `bajarPista`) |
| `jobs.ts` → `bajarVistaPreviaApple` | descarga la vista previa de 30 s, la monta con ffmpeg (carátula `attached_pic`, `title`, `artist`, `album`, `genre`, `date`), en mp3 o m4a, y deja el aviso en la tarjeta |
| `platforms.ts` | plataforma `apple` (etiqueta **Apple Music**), modo sólo `audio`, motor `yt-dlp` |
| `errores.ts` | causa `sinSoporte`: «Ningún motor sabe leer ese link» (antes: «ese formato no existe») |

Verificación real (mismo sandbox, IP marcada por YouTube):

```
estado done · 1 archivo · aviso «Apple Music entrega la canción con DRM…»
ffprobe: 30.01 s · mp3 + mjpeg attached_pic · title/artist/album/genre/date ✔
```

En una IP doméstica el mismo código baja la **canción completa** desde YouTube;
aquí el paso 2 se corta por el bloqueo de bot y entra el paso 3. Comprobado con
la misma app en el mismo sandbox, con un tema cuyo vídeo YouTube sí entrega:

```
Apple: /album/never-gonna-give-you-up/1559885420?i=1559885421  (213 s)
  → [apple] elegido: Rick Astley - Never Gonna Give You Up (Official Video)
  → 213,1 s · 8,2 MB · sin aviso de vista previa
Apple: /song/fake-love-orchestral-version-remix/1742176281  (YouTube: «not a bot»)
  → 30,0 s · 776 KB · aviso de vista previa
```

También se separó «iTunes no conoce ese id» de «no está en YouTube»: antes un
`?i=` inventado decía que la canción no estaba en YouTube, que era falso.

```
tsc 0 · eslint 0 · vitest 401 en 17 archivos · next build ✓ · v1.5.0
```

---

## Fase 15 · «el formato no existe» y «no sé leer ese link»: dos mensajes que sobraban

| Síntoma real | Causa | Arreglo |
| --- | --- | --- |
| El mismo post de Facebook baja en MP4 y falla en **ORIGINAL** con «Ese formato no existe» | `ORIGINAL` sólo vive en modo Fotos; sobre un vídeo, yt-dlp recibe una lista de formatos que el sitio no confirma y contesta `Requested format is not available` | reintento automático con `-f b/bv*+ba/best` + `--no-check-formats`; si aun así falla, el error lista **qué formatos ofrece el sitio** (`listaDeFormatos`) |
| Facebook/Instagram devolvían «Ningún motor sabe leer ese link» | el sitio redirige al **login** y yt-dlp lo reporta como `Unsupported URL: https://www.facebook.com/login/?next=…` | nueva detección: URL con `/login`, `login?next`, `/accounts/login`, `consent.`… → causa `sesion` («El sitio pide una cuenta») |

Verificado: YouTube sigue bajando igual tras el refactor del lanzamiento
(`-f` + reintento comparten el mismo `lanzar(argv)`); Facebook desde el sandbox
ahora dice **«El sitio pide una cuenta (sesión)»** en vez de «ningún motor sabe
leer ese link».

```
tsc 0 · eslint 0 · vitest 407 en 17 archivos · next build ✓ · v1.5.1
```

---

## Fase 16 · Spotify: artista real, diagnóstico por pasos y vista previa como último recurso

| Síntoma | Causa | Arreglo |
| --- | --- | --- |
| Un track de Spotify fallaba con el traceback de PyInstaller | spotdl murió y el plan B tampoco acertó, pero el motivo real se perdía | `rescatarSpotify` **lanza** con el motivo exacto: búsqueda, sin coincidencias, descarga o país restringido |
| La búsqueda traía **otras canciones** | oEmbed devuelve `author_name: null` en muchos tracks (chinos, sobre todo) y se buscaba sólo por título | `datosDelEmbed()` lee `__NEXT_DATA__` del reproductor: artistas, duración y `playabilityReason`; se usa el primer artista y dos consultas |
| Un fallo de descarga se anunciaba como «YouTube no tiene esa canción» | el plan B devolvía `false` sin distinguir | `bajarPista` devuelve `{ok}|{tipo: busqueda|sinCoincidencia|descarga, motivo}` y cada tipo tiene su mensaje |
| Los candidatos rechazados no dejaban rastro | sólo se apuntaba el primero | log con **nota + título + canal** de los dos primeros |
| «DJ铁柱, 酷炫» no aparecía nunca en un título | se comparaba la lista entera de artistas, con coma | palabras sin puntuación + primer artista + penalización sólo si no hay **ninguna** coincidencia |
| Nada que ofrecer cuando YouTube no tiene el tema | — | `buscarEnITunes()`: vista previa de 30 s de Apple con carátula, con aviso en la tarjeta |

Verificación real (sandbox con red y ffmpeg, sin simulaciones):

```
刀群舞 (Dj炫酷版)  → flac 154,9 s · 35,4 MB · title/artist + carátula ✔
风可懂我的思念      → no está en YouTube ni en iTunes; COUNTRY_RESTRICTED
                     → error honesto, sin descargar otra canción
```

```
tsc 0 · eslint 0 · vitest 410 en 17 archivos · next build ✓ · v1.6.0
```

---

## Fase 17 · El color es tuyo, y la interfaz respira (v1.7.0)

Hasta ahora el carmesí estaba escrito en 40 sitios del CSS y en cinco `rgba()`
sueltos dentro de los componentes. Bonito, pero era *nuestro* color. Ahora es
una variable que elige el usuario en **Ajustes → Color y movimiento**.

### Un solo acento, en todas partes

`src/lib/shared/tema.ts` es el modelo: `{ acento, acento2, brillo, fluidez }`,
nueve paletas listas (Carmesí, Hielo, Jade, Ámbar, Violeta, Rosa, Oro, Menta,
Grafito) y una normalización que no perdona: un hex mal escrito, un brillo de
900 o un JSON viejo en `localStorage` caen al tema de fábrica en vez de dejar la
interfaz sin acento.

El CSS ya no sabe de rojos: de `--acento` / `--acento-2` / `--brillo` se derivan
con `color-mix` los siete tokens que usaba todo el diseño (`--red`,
`--red-bright`, `--red-deep`, `--red-wash`, `--red-line`, `--accent-ink`,
`--shadow-red`), también en el tema claro, donde mezclan **hacia negro** en vez
de hacia blanco (sobre papel un acento al 38 % con blanco no se lee).

La aurora WebGL dejó de tener el rojo `vec3(0.62,0.05,0.10)` incrustado: ahora
recibe `uA` / `uB` como uniforms y se recolorea en vivo cuando se cambia el
color. El confeti también: sus partículas nacen del tono y la saturación reales
del acento.

### Detalle que evitaba un botón ilegible

`--acento-tinta` sale de `contrasteSobre()` (luminancia relativa WCAG, umbral
0.179, el punto donde negro y blanco empatan). Con ámbar u oro el texto del
botón primario pasa a tinta oscura; con carmesí o violeta, a blanco. Antes era
`color: #fff` fijo: elegir Oro dejaba un botón casi invisible.

### Fluidez

`extrema` (620 ms de muelle) · `suave` (380 ms) · `ninguna` (1 ms, y además
apaga animaciones y congela la aurora). La aurora sube a **60 fps** en «extrema»
y se queda en 30 en «suave» — el resto del tiempo hay un degradado de fondo, no
un vídeo, y no merece la batería. `prefers-reduced-motion` sigue ganando sobre
todo.

Las tarjetas de la cola entran escalonadas 34 ms (`transform` + `opacity`, sin
tocar layout; `backwards` para que la animación suelte el `transform` al terminar
y no pelee con el arrastre), y la barra de progreso lleva un brillo que corre
dentro de la barra ya pintada, sin JS.

```
tsc 0 · eslint 0 · vitest 425 en 18 archivos · next build ✓ · v1.7.0
```

> El guardado es por navegador (`localStorage`), a propósito: cambiar de color
> no debe esperar a un POST ni recargar la página. Lo que se ve es lo que hay.

---

## Fase 18 · Metadatos completos, carátula entera y letras (v1.8.0)

Esta fase no añade funciones: cierra cuatro cosas que estaban a medias y que se
notaban al mirar el archivo bajado, no la interfaz.

### 1. Las fotos no tenían vista previa

Había tres fallos sumados, y por eso «no funcionaba» de ninguna manera:

| Sitio | Qué pasaba |
|---|---|
| `api/probe` | Al leer el JSON de gallery-dl se descartaba `url`, que es la URL real de la imagen. La ficha salía sin miniatura. |
| Recientes | La rejilla usaba `aspect-video` + `object-cover`: una foto cuadrada se recortaba a 16:9. |
| Recientes | La miniatura era `it.thumbnail`, la URL del CDN original: firma que caduca, CORS, o el archivo ya no está. |

Ahora `/api/thumb?id=…&w=480` genera la miniatura **a partir del archivo local**
(`-vf scale='min(iw,W)':-2`: nunca amplía, nunca recorta, mantiene la
proporción) y la cachea con la fecha de modificación en la clave, de modo que si
reetiquetas el archivo la miniatura se regenera sola. Para un audio extrae la
carátula incrustada; para un vídeo, un fotograma al 10 % (el primero suele ser
negro). Ya no depende de la red ni de que el CDN siga vivo.

Comprobado en vivo con cuatro archivos reales:

```
mp3 con carátula 1400×1400 → 480×480     png cuadrado   → 480×480
png vertical 800×1000      → 480×600     mp4 1280×720   → 480×270
```

### 2. «Metadatos» era sólo `--embed-metadata`

yt-dlp escribía el bloque básico y ahí se acababa. Ahora, después de la
recodificación (nunca antes: el archivo final es el que se etiqueta), una pasada
con ffmpeg **`-c copy`** escribe título, artista, álbum, artista del álbum,
género, fecha, pista, disco, compositor, comentario con la URL de origen, ISRC y
la letra. Para ello `src/lib/shared/etiquetas.ts` sabe qué admite cada
contenedor:

| Contenedor | Etiquetas | Carátula |
|---|---|---|
| mp3 · m4a · flac | todas | incrustada, tamaño original |
| opus · ogg | todas | **no** (el muxer rechaza `attached_pic`) |
| mkv | `TITLE/ARTIST/DATE_RELEASED/GENRE/COMMENT` | adjunto, no pista de vídeo |
| wav | chunk INFO (sin pista/disco) | no |
| aac · ac3 | ninguna | no |

Y cuando algo no se puede, se dice en el registro del trabajo (`[etiquetas] …:
Opus no guarda carátula incrustada`) en vez de fingir. Un `.opus` con etiquetas y
sin carátula es honesto; un `.opus` «con carátula» que no se puede abrir, no.

El álbum, el género y el año, cuando la sonda no los trae (YouTube no los trae),
se completan por la cadena iTunes de la fase 16, aceptando el resultado **sólo si
el título normalizado coincide y el artista empieza igual**.

### 3. Las letras no existían

`src/lib/server/letras.ts` consulta LRCLIB (abierta, sin clave, con letra
sincronizada). Lo importante no es buscar, es no equivocarse: la búsqueda de
«Never Gonna Give You Up» devuelve veinte resultados y el primero es una versión
japonesa de otro artista. Se puntúa título (60) + artista (40) + duración (±20)
y por debajo de 60 no se escribe nada. Dentro del archivo va **texto plano
siempre**: la etiqueta `lyrics` no entiende LRC, y si se guardaba la sincronizada
tal cual, el reproductor enseñaba `<00:18.89>we're <00:19.25>no…`.

Tope de 20 búsquedas por trabajo: una lista de 200 canciones avisa y no dispara
200 peticiones.

### 4. La carátula se recortaba al incrustarla

La portada se pedía a `maxresdefault` (1280×720) y se veía como un cuadrado
estirado, además de que la copia que quedaba para la interfaz no era la original.
Ahora se elige la de **mayor área** entre las que publica el sitio (no la primera
de la lista, cuyo orden no es estable; se descartan los sprites de storyboard,
que son rejillas) y se incrusta **sin escalar**: 1400×1400 entra 1400×1400. En la
vista previa se usa `object-contain`, nunca `object-cover`.

### Un extra que salió al probar: `.exe` en Linux

Al correr las pruebas en un clon limpio, el etiquetado fallaba con los binarios
del repo delante. La causa: `resolveEngine` devolvía `vendor/ffmpeg.exe` también
en Linux/macOS, donde ese archivo no se puede ejecutar (`ENOEXEC`) — y el
inventario lo daba por «ok». Ahora los nombres `.exe` sólo valen en Windows; en
el resto se resuelve por el PATH. En tu equipo (Windows) nada cambia.

### Red de seguridad

Todo el etiquetado se hace sobre una copia temporal: se escribe, se verifica con
ffprobe (que el archivo siga teniendo audio y la misma duración) y sólo entonces
se sustituye el original. Si algo falla, el archivo que ya estaba bajado queda
intacto — hay una prueba que pasa un `.mp3` que en realidad es texto y comprueba
que sigue byte a byte igual.

### Ajustes

Nueva sección **Metadatos, carátulas y letras**: etiquetas completas, letras,
carátula original y «no convertir las fotos» (una foto de Instagram ya está en
JPEG; pasarla a PNG la engorda sin ganar nada). Calidad de vídeo por defecto
pasa a **la mejor disponible**.

```
tsc 0 · eslint 0 · vitest 495 en 22 archivos · next build ✓ · v1.8.0
```

Pruebas nuevas: `tests/etiquetas.test.ts` (29), `tests/letras.test.ts` (17),
`tests/preview.test.ts` (11) y `tests/etiquetado-real.test.ts` (11, con ffmpeg
de verdad: etiquetas, carátula 1200×1200 intacta, opus sin carátula, aac
rechazado, webp convertido sin escalar, archivo corrupto preservado).
