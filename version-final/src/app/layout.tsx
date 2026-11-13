import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
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
export const viewport: Viewport = { themeColor: "#07060c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        <AppProvider>
          <Ambient />
          <Chrome />
          <main className="mx-auto max-w-6xl px-4 pb-32 pt-10 sm:px-6">{children}</main>
          {/* Service worker: cachea solo la UI, nunca descargas */}
          <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator&&location.hostname.match(/^(localhost|127\\.0\\.0\\.1)$/))addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))` }} />
        </AppProvider>
      </body>
    </html>
  );
}
