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
| 7 | *Abrir carpeta* del Taller abría **Documentos** | `lib/server/taller.ts` lanzaba `["/select,", ruta]` como dos argumentos | `abrir-sistema.ts` con la sintaxis correcta por SO |
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
