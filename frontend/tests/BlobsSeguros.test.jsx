import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Un blob que se muestra o se abre en otra pestaña solo con un tipo de la
 * lista: si dijera `text/html` o `image/svg+xml`, abierto en una pestaña
 * correría como una página del sistema (auditoría de seguridad, 29/10/2026).
 */

const servicio = { adjuntoObservacion: vi.fn() };
vi.mock("../src/api/nominaService", () => ({ nominaService: servicio }));

const { blobDeImagen, blobQueSePuedeAbrir, tipoPorNombre } =
  await import("../src/utils/blobs");
const { AdjuntosObservacion } =
  await import("../src/pages/Institucional/AdjuntosObservacion");

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:local/adjunto");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("blobQueSePuedeAbrir", () => {
  it("con nombre, manda la extensión y no el tipo del blob", () => {
    const html = new Blob(["<script>alert(1)</script>"], { type: "text/html" });
    expect(blobQueSePuedeAbrir(html, "captura.png").type).toBe("image/png");
    expect(blobQueSePuedeAbrir(html, "pagina.html")).toBeNull();
    expect(blobQueSePuedeAbrir(html, "dibujo.svg")).toBeNull();
    expect(blobQueSePuedeAbrir(html, "acta.PDF").type).toBe("application/pdf");
  });

  it("sin nombre, solo acepta el tipo del blob si está en la lista", () => {
    expect(
      blobQueSePuedeAbrir(new Blob(["x"], { type: "image/jpeg" })).type,
    ).toBe("image/jpeg");
    expect(
      blobQueSePuedeAbrir(new Blob(["x"], { type: "text/html" })),
    ).toBeNull();
    expect(
      blobQueSePuedeAbrir(new Blob(["x"], { type: "image/svg+xml" })),
    ).toBeNull();
    expect(blobQueSePuedeAbrir(new Blob(["x"]))).toBeNull();
    expect(blobQueSePuedeAbrir(null)).toBeNull();
  });

  it("blobDeImagen descarta lo que no es imagen", () => {
    expect(blobDeImagen(new Blob(["x"]), "acta.pdf")).toBeNull();
    expect(blobDeImagen(new Blob(["x"]), "foto.webp").type).toBe("image/webp");
    expect(tipoPorNombre("sin_extension")).toBeNull();
  });
});

describe("Los adjuntos de una observación", () => {
  it("la miniatura se abre con el tipo de su extensión", async () => {
    servicio.adjuntoObservacion.mockResolvedValue(
      new Blob(["png"], { type: "text/html" }),
    );
    render(
      <AdjuntosObservacion
        adjuntos={[
          { id: 7, nombre: "captura.png", tamano: 10, es_imagen: true },
        ]}
      />,
    );
    await screen.findByAltText("captura.png");
    const creado = URL.createObjectURL.mock.calls[0][0];
    expect(creado.type).toBe("image/png");
  });

  it("una «imagen» con extensión que no es de imagen no se abre", async () => {
    servicio.adjuntoObservacion.mockResolvedValue(
      new Blob(["<script>"], { type: "text/html" }),
    );
    const { container } = render(
      <AdjuntosObservacion
        adjuntos={[
          { id: 8, nombre: "pagina.html", tamano: 10, es_imagen: true },
        ]}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText(/No se pudo cargar la vista previa/),
      ).toBeInTheDocument(),
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(container.querySelector("a[href]")).toBeNull();
  });
});
