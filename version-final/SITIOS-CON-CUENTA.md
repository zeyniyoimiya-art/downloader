# Sitios que piden cuenta (百度网盘 y compañía)

"Hay un sitio chino que no deja descargar, hay que registrarse y desde aquí es
imposible". Esto es lo que se puede hacer y lo que **no** se puede, sin vender
humo.

---

## 1. Por qué 百度网盘 no se puede bajar "normal"

`pan.baidu.com` **no es una web de descargas**: es un disco en la nube. Un enlace
`/s/1AbCdEf` no apunta a un archivo, apunta a un **recurso compartido** que:

1. hay que **转存** (transferir) a la nube de una cuenta, y
2. recién entonces se puede descargar desde esa cuenta.

No existe enlace directo sin sesión. Y el registro pide teléfono chino (+86), así
que registrarse desde Bolivia es, efectivamente, imposible.

**Consecuencia técnica honesta:** sin una cuenta ya iniciada, no hay forma
legítima de bajar ese archivo. Ni yt-dlp, ni gallery-dl, ni curl lo hacen; quien
te diga lo contrario te está vendiendo un proxy de cookies de otra persona (y eso
sí es un problema de seguridad, no una mejora).

## 2. Lo que SÍ hace ahora la app

### Detecta y limpia el enlace solo

Pega **el texto entero** que copia la web china, no hace falta separar nada:

```
链接: https://pan.baidu.com/s/1AbCdEf 提取码: 9z3q 复制这段内容后打开百度网盘手机App
```

La app saca `surl = 1AbCdEf`, el código `提取码 = 9z3q`, quita el `?pwd=` de la
URL (para no ensuciar la deduplicación del historial) y enruta el trabajo al
motor de Baidu. También acepta `?pwd=abcd` y `#pwd=abcd`.

### Dos pasos automáticos con BaiduPCS-Go

```
1. BaiduPCS-Go transfer -p 9z3q -dir /我的资源 https://pan.baidu.com/s/1AbCdEf
2. BaiduPCS-Go download /我的资源/<lo transferido> -saveto <tu carpeta> --ow
```

La ruta que guarda el paso 1 se lee de su propia salida (`转存成功 … 到 /我的资源/x`).
Si esa versión de BaiduPCS-Go cambia el texto, se usa la carpeta de
**Ajustes → Carpeta en Baidu Pan** y se sigue igual.

Después, como BaiduPCS-Go no imprime rutas con un marcador, la app **escanea la
carpeta de salida** buscando los archivos nuevos del trabajo, así que aparecen en
Recientes con miniatura y duración como cualquier otro.

### Tú haces login UNA vez, y solo dentro de BaiduPCS-Go

La app **nunca** ve tu `BDUSS`/`STOKEN` ni los guarda. El login vive donde debe:

```bat
cd vendor
BaiduPCS-Go login
:: o, si prefieres pegar la cookie a mano:
BaiduPCS-Go login -bduss=<BDUSS> -stoken=<STOKEN>
BaiduPCS-Go who        :: comprobar que quedó guardada
```

Esa cookie se queda en `%USERPROFILE%\.config\BaiduPCS-Go\`. No pasa por
`config.json`, ni por el historial, ni por este repo (que es público).

### Instalación (una vez)

1. Descarga `BaiduPCS-Go` de **github.com/qjfoidnh/BaiduPCS-Go/releases**
   (rama activa del proyecto; la original de iikira está sin mantenimiento).
2. Copia el `.exe` a `vendor/` junto a los demás motores.
3. Ajustes → **Re-escanear**: aparece como motor nº 16.
4. `BaiduPCS-Go login` una vez. Listo.

Los enlaces gratuitos y pequeños (modo "sin cuenta" de algunos recursos) también
salen por esta vía: BaiduPCS-Go resuelve el `d.pcs.baidu.com` y baja con rangos.

## 3. 百度文库 (Wenku): no, de verdad

El documento **no existe** como archivo: se pinta en `<canvas>` con el texto
ofuscado y las fuentes troceadas, y la descarga es de pago. Cualquier "Wenku
downloader" funciona convirtiendo páginas a imágenes o adivinando el texto.

La app lo rechaza con un motivo claro en lugar de encolar un trabajo que va a
fallar:

> *Baidu Wenku no ofrece archivo descargable (canvas + VIP). Usa Ctrl+P →
> «Guardar como PDF» en el navegador.*

Eso último, además, suele dar mejor calidad que los trucos.

## 4. 百度贴吧 (Tieba): imágenes de un hilo

Los hilos van a **gallery-dl**, que ya sabe leer las imágenes servidas por el
proxy de Tieba. Si tu versión de gallery-dl no trae el extractor, el log del
trabajo lo dice con el error real.

## 5. Si el sitio que viste era otro

La familia china es grande y varias piden cuenta. Esta es la situación real de
cada una:

| Sitio | ¿Se puede? | Cómo |
|---|---|---|
| **百度网盘** | sí, con tu cuenta | BaiduPCS-Go (implementado) |
| 百度贴吧 | sí, imágenes | gallery-dl (implementado) |
| 百度文库 | **no** | canvas + VIP |
| 夸克网盘 / 123云盘 / 微云 | sí, con tu cuenta | mismo patrón: CLI que acepte cookie de sesión |
| 蓝奏云 (lanzou) | sí, sin cuenta | requiere un POST + leer el iframe; es el siguiente candidato fácil |
| 迅雷 (Xunlei) | con cuenta | `aria2` + cookie, o el cliente oficial |
| 阿里云盘 (Aliyun) | sí | `aliyunpan` CLI, mismo patrón que BaiduPCS-Go |

Si me dices cuál era exactamente, lo añado con el mismo esquema (motor opcional +
login tuyo + detección de enlaces), no con un truco que se rompa en dos semanas.

## 6. La regla que se respeta siempre

> **La app no guarda, no pide y no sube credenciales.**
> El login de cada servicio vive en el programa que lo necesita, en tu PC.
> Lo único que viaja dentro del repo público son detectores de enlaces.
