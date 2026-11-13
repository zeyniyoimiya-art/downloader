
## Micro-interacciones

1. Squish 0.96 + rebote en botones — `globals.css .btn`
2. Pill de tabs que se desliza y estira — `components/ui.tsx Segmented`
3. Morph de isla colapsada↔expandida (View Transitions + spring) — `Chrome.tsx Island`
4. Anillos que respiran según velocidad real — `ui.tsx Ring`
5. Banners que nacen de la isla — `Chrome.tsx`
6. Tilt inercial con especular que sigue al puntero — `Ambient.tsx` + `[data-tilt]`
7. Drag de cola con snap — `page.tsx Queue`
8. Chips de formato con FLIP — `page.tsx FormatChips`
9. Icono de plataforma que aterriza por link — `.land`
10. Odómetro numérico — `ui.tsx Odometer`
11. Hover de ficha que eleva — `/recientes`
12. Menú contextual de vidrio — `/recientes`
13. Focus ring luminoso — `:focus-visible`
14. Parallax de carátulas al scroll — `/recientes`
15. Tema que se derrite — `::view-transition-*`
16. Línea de luz en el hero mientras se descarga — `.lightline`
17. Vibración háptica — `lib/client/sound.ts haptic`
18. Pop sincronizado con el squish — `sfx.pop`
19. Isla ámbar si un motor cae — `.amber`
20. Confeti de vidrio al completar — `Ambient.tsx`
21. Cursor-lente de vidrio — `.lens`
22. Logo "L" que respira — `.breathe`
23. Iconos con micro-rotación — `.ico`
24. Toggle con knob en spring — `ui.tsx Toggle`

Todas se desactivan o pasan a opacidad con `prefers-reduced-motion`; la aurora se apaga también con `prefers-reduced-data`.

## Troubleshooting

| Síntoma | Causa | Arreglo |
| --- | --- | --- |
| Un motor aparece en ámbar | El binario existe pero `--version` no contestó a tiempo (suele bastar con pulsar *Re-escanear*) | Revisa `./vendor` y pulsa *Re-escanear* |
| El audio va a una subcarpeta `Audio/` | Es intencional: al extraer audio, yt-dlp descarga y luego **borra** el archivo original, así que compartir carpeta con el vídeo destruía el vídeo | Nada que hacer; así nunca se pisan |
| Todo aparece "simulado" | `yt-dlp` no detectado | Copia los `.exe` a `./vendor` o fija la ruta en Ajustes |
| "Sign in to confirm"/edad | Falta sesión | `/cookies` → pega `cookies.txt` → **Probar sesión** |
| Instagram devuelve vacío | Falta sesión o link de perfil sin modo correcto | Usa el modo *Perfil completo* |
| Sin carátula embebida | ffmpeg no responde | Comprueba que `ffmpeg.exe` esté sano |
| El turbo no acelera | `aria2c` ausente | Instálalo y activa **Modo turbo** |
| "Ya lo tenías" | Dedup por `archive-<modo>.txt` + historial | Desactiva **No repetir** en Ajustes |
| Pausa no continúa | — | Al reanudar, yt-dlp sigue desde el `.part` |
| La isla no actualiza | SSE cortado por un proxy | Abre directo `http://127.0.0.1:4173` |

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

## Nota de stack

Este sandbox exige Next.js (App Router), por lo que la UI está en React/Next en lugar de SvelteKit; la arquitectura (Node local que hace spawn, SSE, Zod, JSON en disco) es la misma que se especificó. No hay base de datos externa: `pg`/`drizzle` se eliminaron en la fusión.
