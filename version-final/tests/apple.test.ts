import { describe, expect, it } from "vitest";
import { aPista, artworkGrande, consultaApple, esUrlApple, idApple } from "../src/lib/server/apple";

describe("esUrlApple", () => {
  it("reconoce los links de Apple Music y de iTunes", () => {
    expect(esUrlApple("https://music.apple.com/bo/song/x/1742176281")).toBe(true);
    expect(esUrlApple("http://itunes.apple.com/us/album/x/123")).toBe(true);
    expect(esUrlApple("https://open.spotify.com/track/abc")).toBe(false);
    expect(esUrlApple("https://music.apple.com.evil.io/x")).toBe(false);
  });
});

describe("idApple", () => {
  it("saca la canción del link real que falló en la app", () => {
    const r = idApple("https://music.apple.com/bo/song/fake-love-orchestral-version-remix/1742176281");
    expect(r).toEqual({ tipo: "song", id: "1742176281", pais: "bo" });
  });
  it("el «?i=» manda sobre el álbum", () => {
    const r = idApple("https://music.apple.com/bo/album/fake-love/1742176034?i=1742176281");
    expect(r?.tipo).toBe("song");
    expect(r?.id).toBe("1742176281");
  });
  it("un álbum sin «?i=» es un álbum", () => {
    const r = idApple("https://music.apple.com/us/album/fake-love-orchestral-version-remix/1742176034");
    expect(r).toEqual({ tipo: "album", id: "1742176034", pais: "us" });
  });
  it("playlist y país raro", () => {
    expect(idApple("https://music.apple.com/es/playlist/lo-mejor/pl.a1b2c3")?.tipo).toBe("playlist");
    // sin país en la ruta se asume «us»
    expect(idApple("https://music.apple.com/song/x/999")).toEqual({ tipo: "song", id: "999", pais: "us" });
  });
  it("lo que no es Apple devuelve null", () => {
    expect(idApple("https://youtube.com/watch?v=abc")).toBeNull();
    expect(idApple("no es una url")).toBeNull();
  });
});

describe("aPista / artworkGrande", () => {
  it("sube la carátula de 100 px a 1400 px", () => {
    const u = "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/91/86/68/x/085365534896.jpg/100x100bb.jpg";
    expect(artworkGrande(u)).toContain("/1400x1400bb.jpg");
    expect(artworkGrande(undefined)).toBeUndefined();
  });
  it("traduce el resultado real de iTunes", () => {
    const p = aPista({
      kind: "song",
      trackName: "Fake Love (Orchestral Version) [Remix]",
      artistName: "Japandee",
      collectionName: "Fake Love (Orchestral Version) [Remix] - Single",
      previewUrl: "https://audio-ssl.itunes.apple.com/x.m4a",
      artworkUrl100: "https://is1-ssl.mzstatic.com/a/100x100bb.jpg",
      trackTimeMillis: 368268,
      primaryGenreName: "Electrónica",
      releaseDate: "2024-04-17T12:00:00Z",
    });
    expect(p).toMatchObject({ title: "Fake Love (Orchestral Version) [Remix]", artist: "Japandee", genero: "Electrónica", anio: 2024 });
    expect(p?.artwork).toContain("1400x1400bb");
    expect(consultaApple(p!)).toBe("Japandee Fake Love (Orchestral Version) [Remix]");
  });
  it("una colección sin canción no es una pista", () => {
    expect(aPista({ kind: "song" })).toBeNull();
  });
});
