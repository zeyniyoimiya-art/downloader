// Vistas previas: el volcado de gallery-dl y los argumentos de la miniatura.
//
// Son las dos piezas que hacían que las fotos no se vieran: (1) la URL de la
// imagen se descartaba al leer el JSON de gallery-dl y (2) la miniatura se
// recortaba a 16:9 con `object-cover` en la rejilla.
import { describe, expect, it } from "vitest";
import { autorDeGallerydl, portadaDeGallerydl, textoDeGallerydl, totalDeGallerydl } from "@/lib/server/galeria";
import { argsMiniatura } from "@/app/api/thumb/route";

// Forma REAL del `-j` de gallery-dl: lista de [número, objeto] con sangría.
const VOLCADO_IG = [
  [3, "https://www.instagram.com/p/ABC123/"],
  [1, {
    category: "instagram", subcategory: "image", post_id: "ABC123",
    count: 2, url: "https://scontent.cdninstagram.com/v/t51/photo1.jpg?_nc_cat=1",
    filename: "photo1.jpg", extension: "jpg",
    content: "Un atardecer en La Paz", username: "alguien",
  }],
];

describe("portadaDeGallerydl", () => {
  it("saca la URL de la imagen del post", () => {
    expect(portadaDeGallerydl(VOLCADO_IG)).toBe("https://scontent.cdninstagram.com/v/t51/photo1.jpg?_nc_cat=1");
  });

  it("acepta URL sin extensión si es del CDN (Instagram las firma así)", () => {
    expect(portadaDeGallerydl([[1, { url: "https://x/y.png?x=1" }]])).toBe("https://x/y.png?x=1");
  });

  it("NO devuelve una URL de vídeo (un <img> con mp4 es un cuadro roto)", () => {
    expect(portadaDeGallerydl([[1, { url: "https://x/y.mp4" }]])).toBe("");
  });

  it("tolera basura sin lanzar", () => {
    for (const basura of [null, undefined, {}, [], "texto", [1, 2, 3]]) {
      expect(() => portadaDeGallerydl(basura)).not.toThrow();
      expect(portadaDeGallerydl(basura)).toBe("");
    }
  });
});

describe("textoDeGallerydl / autorDeGallerydl / totalDeGallerydl", () => {
  it("lee el texto, el autor y el número de elementos", () => {
    expect(textoDeGallerydl(VOLCADO_IG)).toBe("Un atardecer en La Paz");
    expect(autorDeGallerydl(VOLCADO_IG)).toBe("alguien");
    expect(totalDeGallerydl(VOLCADO_IG)).toBe(2);
  });

  it("entiende el autor cuando viene como objeto (Twitter/X)", () => {
    expect(autorDeGallerydl([[1, { author: { nick: "Nick", name: "Nombre" } }]])).toBe("Nick");
    expect(autorDeGallerydl([[1, { user: { name: "Usuario" } }]])).toBe("Usuario");
  });

  it("recorta el texto a 300 caracteres y quita saltos de línea", () => {
    const t = textoDeGallerydl([[1, { content: "a\n\n b" + "x".repeat(500) }]]);
    expect(t.startsWith("a b")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(300);
  });
});

describe("argsMiniatura", () => {
  it("nunca recorta ni amplía: usa min(iw,W) y -2 (proporción intacta)", () => {
    const a = argsMiniatura("imagen", "/x/foto.png", 480, "/tmp/out.jpg");
    const vf = a[a.indexOf("-vf") + 1];
    expect(vf).toBe("scale='min(iw,480)':-2");
    // Ni crop, ni pad, ni force_original_aspect_ratio: nada que cambie la forma.
    expect(vf).not.toMatch(/crop|pad|force_original/);
  });

  it("el vídeo salta antes de abrir el archivo (-ss delante de -i)", () => {
    const a = argsMiniatura("video", "/x/v.mp4", 640, "/tmp/o.jpg", 12.5);
    expect(a.indexOf("-ss")).toBeLessThan(a.indexOf("-i"));
    expect(a[a.indexOf("-ss") + 1]).toBe("12.5");
  });

  it("el audio busca la pista de carátula (v:0) y sale en JPG", () => {
    const a = argsMiniatura("audio", "/x/a.mp3", 480, "/tmp/o.jpg");
    expect(a).toContain("-map");
    expect(a).toContain("0:v:0");
    expect(a).toContain("mjpeg");
  });

  it("nunca sobrescribe el archivo original: la salida es la ruta que se le pasa", () => {
    expect(argsMiniatura("imagen", "/x/foto.png", 480, "/tmp/o.jpg").pop()).toBe("/tmp/o.jpg");
  });
});
