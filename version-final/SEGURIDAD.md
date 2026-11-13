# Auditoría de seguridad de la fase 4

"Busca cómo romper la app y parchea esas fugas". Esto es lo que se encontró
intentando romperla de verdad, y lo que se cambió. Todo son pruebas reproducibles
contra el servidor local, no teoría.

---

## 1. La API local no era privada (CSRF / DNS rebinding) — **crítico**

La app escucha en `127.0.0.1:3000` sin autenticación, que es lo correcto para una
app local. El problema es que **cualquier página web que visites puede hablar con
127.0.0.1 desde tu propio navegador**:

```js
// ejecutado desde https://cualquier-sitio.example
fetch("http://127.0.0.1:3000/api/jobs", {
  method: "POST",
  mode: "no-cors",                       // sin preflight CORS
  body: '{"urls":["https://evil/x"],"mode":"video","format":"mp4","quality":"1080"}'
});
```

Con eso, y sin que te enteraras, la app encolaba descargas. Peores variantes:

| Endpoint | Qué conseguía un sitio malicioso |
|----------|----------------------------------|
| `PUT /api/config` con `outputDir` | apuntar la carpeta de salida a `C:\Windows\Temp` o al Escritorio y llenarla |
| `POST /api/jobs` en bucle | llenar el disco y saturar la conexión |
| `POST /api/open` | abrir el explorador de Windows (popups) |
| `DELETE /api/history` | borrar tu historial |
| `POST /api/probe` ×1000 | lanzar 1000 yt-dlp a la vez (ver §3) |

Detalle clave: `await req.json()` **no mira el `Content-Type`**, así que el
"escudo" del preflight no aplicaba; un body `text/plain` se parseaba igual.

Y con **DNS rebinding** (un dominio que resuelve a 127.0.0.1) ni siquiera hacía
falta el truco de `no-cors`: el navegador cree que es el mismo origen.

### Parche: `src/lib/server/guard.ts`

Cada ruta que muta estado (`POST`, `PUT`, `PATCH`, `DELETE`) empieza con:

```ts
{ const g = guard(req); if (!g.ok) return blocked(g); }
```

`guard()` aplica cuatro capas:

1. **Cabecera obligatoria `x-linyue: 1`.** Una cabecera personalizada no se puede
   enviar cross-origin sin un preflight CORS que este servidor nunca aprueba. Es
   el patrón estándar anti-CSRF y no requiere sesiones ni tokens.
2. **`Sec-Fetch-Site`**: si dice `cross-site`, 403 (lo mandan todos los
   navegadores modernos).
3. **`Origin` debe coincidir con `Host`** cuando llega `Origin`.
4. **Modo loopback** (`{loopback:true}`): exige `Host` = `127.0.0.1` / `localhost`.
   Eso corta el DNS rebinding, porque el navegador manda el dominio del atacante
   en `Host`.

Rutas protegidas: `config`, `cookies`, `engines`, `history`, `jobs`,
`jobs/[id]`, `open`, `probe`. Verificado en `tests/fase4.test.ts` (6 casos).

---

## 2. `outputDir` aceptaba carpetas del sistema — **alto**

`PUT /api/config` aceptaba cualquier cadena en `outputDir`. Combinado con §1, un
sitio podía escribir en `C:\Windows\System32`. Y sin atacante, un dedo torpe
también basta para llenar `Program Files` de `.mkv`.

### Parche: `ConfigSchema.outputDir`

- Debe ser **ruta absoluta** (`C:\…`, `\\server\…`, `/home/…`).
- Se rechazan `Windows`, `System32`, `SysWOW64`, `Program Files`, `ProgramData`,
  `$Recycle.Bin`, `winre` → `400` con mensaje claro: *"Esa es una carpeta del
  sistema: elige otra"*.
- La UI ya mostraba el error del `400` en el toast, así que el mensaje se ve tal
  cual.

---

## 3. Inundación de sondas de vista previa — **alto (disponibilidad)**

`POST /api/probe` lanzaba un `yt-dlp` **por cada llamada**, sin límite y sin
deduplicar. Pegar 40 links en el campo de URLs (o 40 llamadas desde un script)
abría 40 procesos yt-dlp, más 40 procesos de Node si tienes bgutil/PO tokens.
En Windows eso agota handles (**EMFILE**) y **todas** las vistas previas acaban en
timeout, no solo las sobrantes. Efecto secundario: la sesión entera parecía rota.

### Parche: `src/app/api/probe/route.ts`

- Contador `activas` + `cfg.probeConcurrency` (3 por defecto, ajustable 1–12):
  por encima, se responde con un aviso ("demasiadas vistas previas a la vez")
  en vez de abrir otro proceso.
- `Map<string, Promise>` `enVuelo`: dos peticiones del **mismo** link comparten
  la misma sonda. El `finally` decrementa y limpia siempre (sin fugas si falla).

---

## 4. Reintentar un 429 en caliente empeoraba el bloqueo — **medio**

Antes: backoff plano de 3 s → 8 s → 20 s, **por trabajo y en paralelo**. Con 20
trabajos del mismo sitio, cada uno reintentaba 20 veces: el CDN veía 400
peticiones más y alargaba el castigo a minutos. La app se auto-bloqueaba.

### Parche: `src/lib/server/ratelimit.ts`

- Bucket por host (`hostKey` normaliza `www.` / `m.`) → ráfaga configurable,
  `ratePerMinute` opcional.
- Backoff **compartido** por host: 30 s → 60 → 120 → 240 → 300 s (tope), o el
  `Retry-After` si el sitio lo manda.
- Detección de texto real: `429`, `too many requests`, `rate.?limit`,
  `sign in to confirm`, `not a bot`, `403 forbidden`…
- El trabajo se **reprograma** (`state: "queued"`, `retryAt`), no se reintenta en
  caliente; el `pump` salta los hosts en enfriamiento y los demás siguen. Tras 4
  intentos se rinde y sugiere activar cookies del navegador.

---

## 5. Fugas menores corregidas de paso

| Fuga | Parche |
|------|--------|
| `job.files` sin tope: una galería de 20 000 fotos llenaba memoria y el payload SSE | tope de 500 archivos por trabajo |
| `streamlink` recibía `--http-cookie ""` (cabecera rota, cookies ignoradas) | pares `nombre=valor` parseados en memoria, nunca logueados |
| Bucket de tokens con una línea muerta (`if (tokens > 3) tokens = 1`) que reiniciaba el crédito | bucket arranca lleno y recarga proporcional al tiempo |
| `you-get` se adelantaba a `lux` aunque el interruptor estuviera activo | el interruptor manda |
| Bilibili Live se enrutaba como bilibili normal | plataforma propia → `streamlink` |
| `curl` sin `--fail` guardaba la página de error 404 como si fuera el archivo | `--fail --continue-at - --retry 3` (ya estaba; ahora con test) |

---

## 6. Lo que se comprobó y NO era un fallo

- **Path traversal en `/api/media`**: solo sirve rutas que están en el historial,
  que la app genera. No hay parámetro de ruta libre.
- **Inyección de argumentos**: todas las rutas que llegan a un proceso pasan por
  `sanitizeArg` / `safeUrlArg`, y `--` corta el parseo de opciones de yt-dlp. Un
  archivo llamado `--exec=calc.exe` no ejecuta nada.
- **Secretos en el repo**: barrido completo, cero tokens. Las cookies se pasan al
  proceso por archivo de usuario o por lectura del navegador; **nada** se sube.
- **`.part` falsos**: el `after_move:LYF|` de yt-dlp solo imprime la ruta cuando
  el archivo ya está movido a destino, así que un `.part` no puede pasar por
  "descarga terminada".

---

## 7. Qué queda fuera de alcance (y por qué)

- **Autenticación en la API**: no hace falta. La app es de un solo usuario en un
  solo equipo; el guard de §1 resuelve el vector real (el navegador) sin pedirte
  contraseña para abrir tu propio descargador.
- **TLS**: es HTTP en loopback; no hay tráfico que se pueda interceptar en la red.
- **Sitios con DRM (Netflix, Spotify audio real)**: no se descargan. spotDL baja
  el audio de YouTube, no rompe el DRM.
