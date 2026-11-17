// Spotify sin spotdl: elegir bien el resultado de YouTube es todo el trabajo.
//
// Si se elige mal, el usuario pide «Espresso» de Sabrina Carpenter y recibe un
// cover de karaoke o una versión sped-up. Estas pruebas fijan el criterio.
import { describe, expect, it } from "vitest";
import { consultaDe, elegirCandidato, idTrackSpotify, pistaDelEmbedHtml, puntuarCandidato, UMBRAL_CANDIDATO } from "@/lib/server/spotify";

const pista = { title: "Espresso", artist: "Sabrina Carpenter" };

describe("puntuarCandidato", () => {
  it("prefiere el audio oficial del canal del artista", () => {
    const oficial = { title: "Sabrina Carpenter - Espresso (Official Audio)", uploader: "Sabrina Carpenter", channel: "Sabrina Carpenter - Topic", duration: 175 };
    const otro = { title: "Espresso", uploader: "Random Uploads", duration: 175 };
    expect(puntuarCandidato(oficial, pista)).toBeGreaterThan(puntuarCandidato(otro, pista));
    expect(puntuarCandidato(oficial, pista)).toBeGreaterThanOrEqual(UMBRAL_CANDIDATO);
  });

  it("castiga covers, remixes y versiones aceleradas", () => {
    const bueno = { title: "Sabrina Carpenter - Espresso", uploader: "Sabrina Carpenter", duration: 175 };
    const cover = { title: "Espresso - Sabrina Carpenter (Cover)", uploader: "Alguien", duration: 175 };
    const sped = { title: "Espresso (sped up)", uploader: "x", duration: 120 };
    expect(puntuarCandidato(bueno, pista)).toBeGreaterThan(puntuarCandidato(cover, pista));
    expect(puntuarCandidato(bueno, pista)).toBeGreaterThan(puntuarCandidato(sped, pista));
  });

  it("descarta los clips cortos", () => {
    const short = { title: "Espresso Sabrina Carpenter", uploader: "Sabrina Carpenter", duration: 30 };
    expect(puntuarCandidato(short, pista)).toBeLessThan(puntuarCandidato({ ...short, duration: 175 }, pista));
  });

  it("una canción sin relación no pasa el umbral", () => {
    const nada = { title: "Bohemian Rhapsody", uploader: "Queen", duration: 355 };
    expect(puntuarCandidato(nada, pista)).toBeLessThan(UMBRAL_CANDIDATO);
  });

  it("acepta «Artista - Canción» y «Canción» por igual", () => {
    const a = { title: "Sabrina Carpenter - Espresso", uploader: "Sabrina Carpenter" };
    const b = { title: "Espresso", uploader: "Sabrina Carpenter" };
    expect(puntuarCandidato(a, pista)).toBeGreaterThanOrEqual(UMBRAL_CANDIDATO);
    expect(puntuarCandidato(b, pista)).toBeGreaterThanOrEqual(UMBRAL_CANDIDATO);
  });
});

describe("elegirCandidato / consultaDe", () => {
  it("elige el mejor de la lista y no el primero", () => {
    const lista = [
      { id: "1", title: "Espresso (Karaoke Version)", uploader: "Karaoke Hits", duration: 175 },
      { id: "2", title: "Sabrina Carpenter - Espresso (Official Video)", uploader: "Sabrina Carpenter", duration: 175 },
      { id: "3", title: "Espresso 10 hours", uploader: "Loops", duration: 36000 },
    ];
    expect(elegirCandidato(lista, pista)?.id).toBe("2");
  });

  it("si nada se parece, devuelve null (mejor decir la verdad que bajar otra cosa)", () => {
    expect(elegirCandidato([{ id: "9", title: "Unboxing de una freidora", uploader: "Cocina" }], pista)).toBeNull();
  });

  it("la consulta es «artista canción» y sin comillas", () => {
    expect(consultaDe({ title: 'Don"t Start', artist: "Dua Lipa" })).toBe("Dua Lipa Don t Start");
  });
});

// Caso real que falló en la batería: «bad guy» de Billie Eilish eligió la
// versión de otro grupo porque el título coincidía palabra por palabra.
describe("casos reales de la batería", () => {
  it("no confunde «bad guy» de Billie Eilish con la de otro grupo", () => {
    const billie = { title: "bad guy", artist: "Billie Eilish" };
    const otro = { id: "x", title: 'Falling In Reverse - "Bad Guy (feat. Saraya)" (Full Album Stream)', uploader: "Epitaph Records" };
    const correcto = { id: "y", title: "Billie Eilish - bad guy (Official Music Video)", uploader: "Billie Eilish" };
    expect(elegirCandidato([otro, correcto], billie)?.id).toBe("y");
    expect(puntuarCandidato(otro, billie)).toBeLessThan(UMBRAL_CANDIDATO);
  });

  it("sin artista en los metadatos (oEmbed sin author) se guía por el título", () => {
    // El track chino real: oEmbed devuelve sólo «刀群舞 - Dj炫酷版», sin autor.
    const pista2 = { title: "刀群舞 - Dj炫酷版", artist: "" };
    const cand = { id: "z", title: "刀群舞 (Dj炫酷版)", uploader: "DJ铁柱 - Topic" };
    expect(elegirCandidato([cand], pista2)?.id).toBe("z");
  });
});

describe("artista del reproductor de Spotify", () => {
  it("con el artista principal se acierta el tema chino que antes se rechazaba", () => {
    const pista = { title: "刀群舞 - Dj炫酷版", artist: "DJ铁柱" };
    const cand = { id: "1", title: "刀群舞 (Dj炫酷版)", uploader: "DJ铁柱 - Topic" };
    expect(puntuarCandidato(cand, pista)).toBeGreaterThanOrEqual(UMBRAL_CANDIDATO);
  });

  it("saca artista y motivo del HTML del reproductor", () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify({ props: { pageProps: { state: { data: { entity: {
        name: "风可懂我的思念",
        artists: [{ name: "顾北笙" }, { name: "阮斯羽" }],
        duration: 352677, isPlayable: false, playabilityReason: "COUNTRY_RESTRICTED",
      } } } } } }) + "</script>";
    const r = pistaDelEmbedHtml(html);
    expect(r?.artist).toBe("顾北笙");
    expect(r?.duracionS).toBe(353);
    expect(r?.motivo).toBe("COUNTRY_RESTRICTED");
  });

  it("el id sale de cualquier forma del link", () => {
    expect(idTrackSpotify("https://open.spotify.com/intl-es/track/3kr20Qo8Pdz7wGTmuQy4IA?si=x")).toBe("3kr20Qo8Pdz7wGTmuQy4IA");
    expect(idTrackSpotify("https://open.spotify.com/track/7utPQvBz96trFogWCeXi1I")).toBe("7utPQvBz96trFogWCeXi1I");
    expect(idTrackSpotify("https://example.com/track/abc")).toBeNull();
  });
});
