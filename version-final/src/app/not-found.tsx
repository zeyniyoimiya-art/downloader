// "/404": vidrio roto con refracción exagerada
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="relative">
        <div className="glass sq p-12 text-center" style={{ filter: "url(#ly-shatter)" }}>
          <div className="text-8xl font-bold tracking-tighter bg-gradient-to-br from-violet-300 to-pink-300 bg-clip-text text-transparent">404</div>
        </div>
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <path d="M52 0 L46 38 L60 52 L40 100 M46 38 L0 30 M60 52 L100 62 M46 38 L80 0" stroke="rgba(255,255,255,.55)" strokeWidth=".4" fill="none" />
        </svg>
      </div>
      <div className="-mt-10 text-center">
        <p className="text-lg font-semibold">Este cristal se rompió.</p>
        <p className="muted text-sm">La página que buscas no existe.</p>
        <Link href="/" className="btn btn-primary mt-5 h-11 px-6 sq-pill">Volver al descargador</Link>
      </div>
    </div>
  );
}
