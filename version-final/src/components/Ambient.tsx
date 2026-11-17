"use client";
// Fondo vivo: shader aurora WebGL (lazy, 30 fps cap en batería, off con reduced-motion/data) + partículas parallax,
// cursor-lente de vidrio, especular que sigue al puntero, tilt inercial y confeti de vidrio.
import { useEffect, useRef } from "react";
import { useApp } from "./AppProvider";
import { hslDeHex, rgbDeHex, normalizarTema, TEMA_DEFECTO, type Tema } from "@/lib/shared/tema";

const FRAG = `precision mediump float;
uniform float t; uniform vec2 r; uniform vec2 m; uniform float light;
uniform vec3 uA; uniform vec3 uB;
float n(vec2 p){return sin(p.x)*sin(p.y);}
void main(){
  vec2 uv = gl_FragCoord.xy / r; vec2 p = uv*3.0 + m*0.18;
  float a = n(p + vec2(t*0.05, t*0.04)) + 0.5*n(p*1.7 - vec2(t*0.03, -t*0.04)) + 0.25*n(p*3.1 + t*0.02);
  // Brasa: el acento elegido por el usuario, apagado hacia el negro. Un solo
  // color; sin arcoíris. uA = acento, uB = segundo color (sólo un toque).
  vec3 ember = uA * 0.70 + uB * 0.06;
  vec3 coal = ember * 0.26;
  vec3 ash = vec3(0.03,0.03,0.035);
  vec3 c = mix(coal, ember, smoothstep(-0.4, 1.0, a + uv.x - 0.35));
  c = mix(c, ash, smoothstep(0.2, 1.1, uv.y*0.8 + a*0.4));
  float glow = smoothstep(1.5, -0.4, length(uv - vec2(0.34 + 0.16*sin(t*0.04), 0.86)));
  vec3 base = light > 0.5 ? vec3(0.95,0.94,0.93) : vec3(0.02,0.02,0.024);
  vec3 col = mix(base, c, (light > 0.5 ? 0.16 : 0.5) * glow + 0.02);
  gl_FragColor = vec4(col, 1.0);
}`;

export function Ambient() {
  const cv = useRef<HTMLCanvasElement>(null);
  const lens = useRef<HTMLDivElement>(null);
  const confettiCv = useRef<HTMLCanvasElement>(null);
  const { theme, confetti, tema } = useApp();
  const themeRef = useRef(theme);
  // Sincronizar el ref en un effect (no durante el render): el loop WebGL lo lee
  // sin necesidad de re-suscribir el efecto de la aurora en cada cambio de tema.
  useEffect(() => { themeRef.current = theme; }, [theme]);
  const temaRef = useRef<Tema>(tema);
  useEffect(() => { temaRef.current = tema; }, [tema]);

  // Aurora WebGL
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || matchMedia("(prefers-reduced-data: reduce)").matches;
    const c = cv.current; if (!c || reduced) return;
    const gl = c.getContext("webgl", { antialias: false, powerPreference: "low-power" }); if (!gl) return;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}"));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uT = gl.getUniformLocation(prog, "t"), uR = gl.getUniformLocation(prog, "r"), uM = gl.getUniformLocation(prog, "m"), uL = gl.getUniformLocation(prog, "light");
    const uA = gl.getUniformLocation(prog, "uA"), uB = gl.getUniformLocation(prog, "uB");
    let mx = 0, my = 0, tx = 0, ty = 0, raf = 0, last = 0;
    // Resolución a la mitad (el blur de 30 px lo disimula) y tope de fps según
    // el ajuste de fluidez: «extrema» sube a 60, el resto se queda en 30 para
    // no gastar batería moviendo un degradado.
    let fps = 30;
    const aplicarTema = (t: Tema) => {
      const [r1, g1, b1] = rgbDeHex(t.acento), [r2, g2, b2] = rgbDeHex(t.acento2);
      gl.uniform3f(uA, r1, g1, b1); gl.uniform3f(uB, r2, g2, b2);
      // «ninguna» congela la aurora: se queda el último fotograma pintado.
      fps = t.fluidez === "extrema" ? 60 : t.fluidez === "suave" ? 30 : 0;
    };
    aplicarTema(temaRef.current);
    // El provider avisa cuando el usuario cambia el color: se recolorea en vivo.
    const onTema = (e: Event) => aplicarTema(normalizarTema((e as CustomEvent).detail));
    addEventListener("ly-tema", onTema);
    const resize = () => { c.width = innerWidth / 2; c.height = innerHeight / 2; gl.viewport(0, 0, c.width, c.height); };
    resize(); addEventListener("resize", resize);
    const onMove = (e: PointerEvent) => { tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; };
    addEventListener("pointermove", onMove);
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || !fps || now - last < 1000 / fps) return;
      last = now; mx += (tx - mx) * 0.05; my += (ty - my) * 0.05;
      gl.uniform1f(uT, now / 1000); gl.uniform2f(uR, c.width, c.height); gl.uniform2f(uM, mx, -my); gl.uniform1f(uL, themeRef.current === "light" ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); removeEventListener("pointermove", onMove); removeEventListener("ly-tema", onTema); };
  }, []);

  // Cursor-lente + especular del panel bajo el puntero + tilt inercial en [data-tilt]
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let x = -100, y = -100, lx = -100, ly = -100, raf = 0;
    let tiltEl: HTMLElement | null = null, rx = 0, ry = 0, trx = 0, try_ = 0;
    let lensTimer: ReturnType<typeof setTimeout> | undefined;
    const onMove = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY;
      // La lente solo se muestra mientras hay movimiento (ver .lens en globals.css)
      lens.current?.classList.add("active");
      clearTimeout(lensTimer);
      lensTimer = setTimeout(() => lens.current?.classList.remove("active"), 1400);
      const t = e.target as HTMLElement;
      const g = t.closest?.(".glass") as HTMLElement | null;
      if (g) { const b = g.getBoundingClientRect(); g.style.setProperty("--mx", `${x - b.left}px`); g.style.setProperty("--my", `${y - b.top}px`); }
      lens.current?.classList.toggle("big", !!t.closest?.("button,a,[role=button],input,textarea,select"));
      const te = t.closest?.("[data-tilt]") as HTMLElement | null;
      if (te !== tiltEl) { if (tiltEl) { trx = 0; try_ = 0; } tiltEl = te ?? tiltEl; if (!te) { trx = 0; try_ = 0; } }
      if (te) { const b = te.getBoundingClientRect(); trx = ((y - b.top) / b.height - 0.5) * -6; try_ = ((x - b.left) / b.width - 0.5) * 8; }
    };
    let idle = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      // Con la pestaña en segundo plano no hay nada que pintar.
      if (document.hidden) return;
      const dl = x - lx, dy2 = y - ly, dtx = trx - rx, dty = try_ - ry;
      // Si el cursor y la inercia ya están quietos, NO tocamos el DOM.
      // Antes se reescribía el transform 60 veces por segundo para siempre,
      // aunque no hubiera nada que mover: eso mantenía la GPU/CPU despiertas
      // y era buena parte del "lag".
      if (Math.abs(dl) < 0.1 && Math.abs(dy2) < 0.1 && Math.abs(dtx) < 0.01 && Math.abs(dty) < 0.01) {
        if (idle++ > 4) return;
      } else idle = 0;
      lx += dl * 0.25; ly += dy2 * 0.25; // muelle simple del cursor
      if (lens.current) lens.current.style.transform = `translate3d(${lx}px,${ly}px,0) translate(-50%,-50%)`;
      rx += dtx * 0.12; ry += dty * 0.12; // inercia del tilt
      if (tiltEl) { tiltEl.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`; if (Math.abs(rx) + Math.abs(ry) < 0.01 && trx === 0) { tiltEl.style.transform = ""; tiltEl = null; } }
    };
    addEventListener("pointermove", onMove); raf = requestAnimationFrame(loop);
    return () => { removeEventListener("pointermove", onMove); clearTimeout(lensTimer); cancelAnimationFrame(raf); };
  }, []);

  // Confeti de partículas de vidrio al completar una descarga
  useEffect(() => {
    if (!confetti || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = confettiCv.current; if (!c) return;
    const ctx = c.getContext("2d")!; c.width = innerWidth; c.height = innerHeight;
    // Confeti en la familia del acento elegido: tono base ±20° y saturación real.
    const { h: h0, s: s0 } = hslDeHex(tema.acento);
    const hh = [h0, (h0 + 340) % 360, (h0 + 18) % 360];
    const P = Array.from({ length: 70 }, () => ({ x: innerWidth / 2, y: 40, vx: (Math.random() - 0.5) * 14, vy: Math.random() * 6 + 2, s: Math.random() * 8 + 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, h: hh[Math.floor(Math.random() * 3)], sat: s0 }));
    let raf = 0, f = 0;
    const loop = () => {
      ctx.clearRect(0, 0, c.width, c.height); f++;
      for (const p of P) {
        p.vy += 0.25; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - f / 110);
        ctx.fillStyle = `hsla(${p.h},${p.sat}%,62%,.78)`; ctx.strokeStyle = "rgba(255,255,255,.35)";
        ctx.beginPath(); ctx.roundRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6, 2); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      if (f < 110) raf = requestAnimationFrame(loop); else ctx.clearRect(0, 0, c.width, c.height);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [confetti, tema.acento]);

  return (
    <>
      <div aria-hidden className="fixed inset-0 -z-10" style={{
          background: theme === "light"
            // En claro el acento se apaga (7 %) para no teñir el papel.
            ? "radial-gradient(1100px 620px at 78% -10%, color-mix(in oklab, var(--acento) 7%, transparent), transparent 60%), radial-gradient(900px 520px at 0% 105%, rgba(16,15,16,.06), transparent 60%), #f2f0ec"
            : "radial-gradient(1100px 640px at 76% -12%, color-mix(in oklab, var(--acento) calc(var(--brillo) * 26%), transparent), transparent 62%), radial-gradient(820px 520px at -8% 108%, color-mix(in oklab, var(--acento) 6%, transparent), transparent 60%), #050506",
        }} />
      <canvas ref={cv} aria-hidden className="fixed inset-0 -z-10 h-full w-full" style={{ filter: "blur(30px) saturate(130%)", transform: "scale(1.1)" }} />
      {/* Retícula técnica: 1 px cada 96 px, desvanecida hacia los bordes.
          Sustituye a las partículas flotantes: da escala sin hacer ruido. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{ zIndex: -9,
          backgroundImage: "linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
          backgroundSize: "96px 96px",
          maskImage: "radial-gradient(circle at 50% 0%, black 0%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(circle at 50% 0%, black 0%, transparent 78%)",
          opacity: 0.5,
        }}
      />
      <canvas ref={confettiCv} aria-hidden className="pointer-events-none fixed inset-0 z-[90]" />
      <div ref={lens} aria-hidden className="lens" />
      {/* Filtro SVG de refracción de borde */}
      <svg width="0" height="0" className="absolute" aria-hidden>
        <filter id="ly-refract"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="7" /><feDisplacementMap in="SourceGraphic" scale="6" xChannelSelector="R" yChannelSelector="G" /></filter>
        <filter id="ly-shatter"><feTurbulence type="turbulence" baseFrequency="0.04" numOctaves="3" seed="3" /><feDisplacementMap in="SourceGraphic" scale="40" xChannelSelector="R" yChannelSelector="B" /></filter>
      </svg>
    </>
  );
}
