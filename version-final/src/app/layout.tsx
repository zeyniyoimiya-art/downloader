import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/components/AppProvider";
import { Ambient } from "@/components/Ambient";
import { Chrome } from "@/components/Chrome";

export const metadata: Metadata = {
  title: "Linyue · Descargador Universal Local",
  description: "Audio, video, fotos y perfiles enteros con ficha completa. Todo se procesa en esta máquina.",
  manifest: "/manifest.webmanifest",
  // Sin esto el navegador pide /favicon.ico, no existe y deja un 404 en consola.
  icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
  authors: [{ name: "Lin Yue 林玥" }],
};
export const viewport: Viewport = { themeColor: "#050506", width: "device-width", initialScale: 1 };

/**
 * TIPOGRAFÍA REAL.
 *
 * `globals.css` declaraba `--font-sans: "Inter var", "Inter", …` pero Inter
 * NUNCA se cargaba (ni `next/font`, ni `@font-face`, ni un <link>): en Windows
 * todo se veía en Segoe UI y en Linux en DejaVu. El tracking negativo del CSS
 * (-0.011em, y -0.035em en el hero) está afinado para Inter, así que el diseño
 * se veía distinto en cada máquina.
 *
 * `next/font` descarga las fuentes UNA vez en la compilación, las sirve desde
 * el propio dominio (sin peticiones a Google en tiempo de ejecución) y evita el
 * cambio de fuente al cargar. Si compilas sin internet, Next lo cachea en
 * `.next/cache` después de la primera vez.
 */
const sans = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans-loaded" });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono-loaded" });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body>
        <AppProvider>
          <Ambient />
          <Chrome />
          {/* pb-40 en móvil: la barra flotante mide ~64 px y se comía la última fila de Ajustes */}
          <main className="mx-auto max-w-6xl px-4 pb-40 pt-10 sm:px-6 xl:pb-32">{children}</main>
          {/* ── Sin service worker, y se desinstala el que hubiera ──────────
              Antes se registraba /sw.js para cachear el icono y el manifiesto.
              El beneficio era nulo (esta app es local y siempre hay red) y el
              riesgo, enorme: un service worker atascado en el origen
              `127.0.0.1:4173` intercepta la navegación y el navegador enseña
              «This page couldn't load» aunque el servidor esté perfectamente
              arrancado — y recargar no lo arregla, porque el que falla es el
              propio SW. Aquí se da de baja y se borran sus cachés. */}
          <script dangerouslySetInnerHTML={{ __html: `try{if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister()})}).catch(function(){});if(window.caches)caches.keys().then(function(k){k.forEach(function(n){caches.delete(n)})}).catch(function(){})}}catch(e){}` }} />
        </AppProvider>
      </body>
    </html>
  );
}
