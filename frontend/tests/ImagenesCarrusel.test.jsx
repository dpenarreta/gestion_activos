import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Imágenes del carrusel (US-007, 11/11/2026): se optimizan al elegirlas en
 * «Agregar imagen», el mensaje de peso dice la verdad y el carrusel muestra
 * completas las horizontales y las verticales, sobre un fondo desenfocado.
 */

vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: ["noticias.gestionar"] } }),
}));

const servicio = {
  noticias: vi.fn(),
  carrusel: vi.fn(),
  imagenNoticia: vi.fn(),
  guardarNoticia: vi.fn(),
  eliminarNoticia: vi.fn(),
  guardarCarrusel: vi.fn(),
};
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: servicio,
}));

const optimizarImagen = vi.fn();
vi.mock("../src/utils/imagenes", async (importOriginal) => ({
  ...(await importOriginal()),
  optimizarImagen: (...args) => optimizarImagen(...args),
}));

const { CarruselNoticias, ImagenConFondo } =
  await import("../src/pages/Institucional/CarruselNoticias");
const { GestionNoticiasPage } =
  await import("../src/pages/Institucional/GestionNoticiasPage");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");

const AYUDA =
  "JPG, PNG o WebP, hasta 5 MB. Horizontales o verticales; recomendado " +
  "1600 × 1000 px (horizontal) o 1000 × 1600 px (vertical). Las imágenes " +
  "grandes se optimizan solas.";

function pintar(elemento) {
  return render(
    <MemoryRouter>
      <UnsavedChangesProvider>{elemento}</UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

function archivo(nombre, tipo, bytes) {
  const f = new File(["x"], nombre, { type: tipo });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  globalThis.URL.createObjectURL = vi.fn(() => `blob:local/${(n += 1)}`);
  globalThis.URL.revokeObjectURL = vi.fn();
  servicio.imagenNoticia.mockResolvedValue(
    new Blob(["x"], { type: "image/jpeg" }),
  );
  servicio.noticias.mockResolvedValue([]);
  servicio.carrusel.mockResolvedValue({ segundos: 6 });
});

async function abrirFormulario() {
  pintar(<GestionNoticiasPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Agregar imagen/ }),
  );
  return screen.getByRole("dialog", { name: "Agregar imagen" });
}

describe("Agregar imagen", () => {
  it("optimiza la imagen elegida, lo dice y sube la versión optimizada", async () => {
    const original = archivo("afiche.jpg", "image/jpeg", 5_284_823);
    const optimizada = archivo("afiche.jpg", "image/jpeg", 1_258_291);
    optimizarImagen.mockResolvedValue({
      archivo: optimizada,
      optimizada: true,
      antes: original.size,
      despues: optimizada.size,
    });
    servicio.guardarNoticia.mockResolvedValue({});
    const ventana = await abrirFormulario();

    fireEvent.change(within(ventana).getByLabelText(/^Imagen/), {
      target: { files: [original] },
    });
    const aviso = await within(ventana).findByText(
      "Se optimizó la imagen: de 5,04 MB a 1,20 MB.",
    );
    // Con el color de éxito del tema (4,5:1 también en oscuro), no
    // `text-success`.
    expect(aviso).toHaveClass("noticias-aviso-ok");
    expect(aviso).not.toHaveClass("text-success");
    expect(optimizarImagen).toHaveBeenCalledWith(original);

    fireEvent.click(within(ventana).getByRole("button", { name: "Agregar" }));
    await waitFor(() =>
      expect(servicio.guardarNoticia).toHaveBeenCalledWith(
        undefined,
        expect.any(Object),
        optimizada,
      ),
    );
  });

  it("si aun optimizada excede 5 MB, dice el peso real junto al campo, lo anuncia y no sube", async () => {
    const original = archivo("foto.png", "image/png", 9_000_000);
    const pesada = archivo("foto.webp", "image/webp", 6_300_000);
    optimizarImagen.mockResolvedValue({
      archivo: pesada,
      optimizada: true,
      antes: original.size,
      despues: pesada.size,
    });
    const ventana = await abrirFormulario();
    const campo = within(ventana).getByLabelText(/^Imagen/);

    fireEvent.change(campo, { target: { files: [original] } });
    const texto =
      "Aun optimizada, la imagen pesa 6,01 MB y el máximo es 5 MB. " +
      "Redúzcala a 2400 px por el lado mayor o guárdela como JPG.";
    // Bajo el campo, asociado a él…
    const error = await within(ventana).findByText(texto, {
      selector: ".mz-field-error",
    });
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo.getAttribute("aria-describedby")).toContain(error.id);
    // …y en una región viva, para que el lector de pantalla lo diga.
    expect(within(ventana).getByRole("alert")).toHaveTextContent(texto);

    fireEvent.click(within(ventana).getByRole("button", { name: "Agregar" }));
    expect(servicio.guardarNoticia).not.toHaveBeenCalled();
  });

  it("sin optimizar (el navegador no pudo), el error no dice «aun optimizada»", async () => {
    const pesada = archivo("foto.png", "image/png", 6_300_000);
    optimizarImagen.mockResolvedValue({
      archivo: pesada,
      optimizada: false,
      antes: pesada.size,
      despues: pesada.size,
    });
    const ventana = await abrirFormulario();
    fireEvent.change(within(ventana).getByLabelText(/^Imagen/), {
      target: { files: [pesada] },
    });
    expect(
      await within(ventana).findByText(
        /^La imagen pesa 6,01 MB y el máximo es 5 MB\./,
        { selector: ".mz-field-error" },
      ),
    ).toBeInTheDocument();
  });

  it("si la optimización falla, sigue con la imagen original", async () => {
    optimizarImagen.mockRejectedValue(new Error("inesperado"));
    servicio.guardarNoticia.mockResolvedValue({});
    const original = archivo("foto.jpg", "image/jpeg", 900_000);
    const ventana = await abrirFormulario();
    fireEvent.change(within(ventana).getByLabelText(/^Imagen/), {
      target: { files: [original] },
    });
    fireEvent.click(
      await within(ventana).findByRole("button", { name: "Agregar" }),
    );
    await waitFor(() =>
      expect(servicio.guardarNoticia).toHaveBeenCalledWith(
        undefined,
        expect.any(Object),
        original,
      ),
    );
  });

  it("mientras optimiza, lo dice y no deja enviar", async () => {
    let terminar;
    optimizarImagen.mockReturnValue(
      new Promise((resolver) => {
        terminar = resolver;
      }),
    );
    const original = archivo("foto.jpg", "image/jpeg", 7_000_000);
    const ventana = await abrirFormulario();

    fireEvent.change(within(ventana).getByLabelText(/^Imagen/), {
      target: { files: [original] },
    });
    const boton = await within(ventana).findByRole("button", {
      name: "Optimizando…",
    });
    expect(boton).toBeDisabled();
    expect(within(ventana).getByRole("status")).toHaveTextContent(
      "Optimizando la imagen…",
    );

    await act(async () =>
      terminar({
        archivo: original,
        optimizada: false,
        antes: original.size,
        despues: original.size,
      }),
    );
    expect(
      await within(ventana).findByRole("button", { name: "Agregar" }),
    ).toBeEnabled();
  });

  it("la vista previa muestra el marco del carrusel con la franja del título en vivo", async () => {
    const original = archivo("afiche.jpg", "image/jpeg", 900_000);
    optimizarImagen.mockResolvedValue({
      archivo: original,
      optimizada: false,
      antes: original.size,
      despues: original.size,
    });
    const ventana = await abrirFormulario();
    fireEvent.change(within(ventana).getByLabelText(/^Imagen/), {
      target: { files: [original] },
    });
    const pie = await within(ventana).findByText(
      "Vista previa: así se verá en el carrusel de Inicio.",
    );
    const marco = pie.closest("figure").querySelector(".noticias-vista-previa");
    expect(marco).toHaveClass("carrusel__diapositiva");
    expect(marco.querySelector(".carrusel__fondo")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // Decorativa: el pie visible ya dice qué es.
    expect(marco.querySelector("img")).toHaveAttribute("alt", "");

    fireEvent.change(within(ventana).getByLabelText("Título (opcional)"), {
      target: { value: "Feria de salud" },
    });
    const franja = within(marco)
      .getByText("Feria de salud")
      .closest(".carrusel__texto");
    expect(franja).not.toBeNull();
    // Misma estructura que el carrusel: la franja es hermana del marco de la
    // imagen, no está dentro (en el teléfono sale debajo).
    const medio = marco.querySelector(".carrusel__medio");
    expect(medio.querySelector(".carrusel__imagen")).not.toBeNull();
    expect(franja.parentElement).toBe(medio.parentElement);
    expect(medio.contains(franja)).toBe(false);
  });

  it("la ayuda del campo y «Medidas de las imágenes» admiten horizontales y verticales", async () => {
    const ventana = await abrirFormulario();
    expect(
      within(ventana).getByLabelText(/^Imagen/),
    ).toHaveAccessibleDescription(AYUDA);
    const medidas = screen.getByRole("region", {
      name: /Medidas de las imágenes/,
    });
    expect(within(medidas).getByText(AYUDA)).toBeInTheDocument();
    expect(within(medidas).getByText("1000 × 1600 px")).toBeInTheDocument();
    // La misma cifra para horizontales y verticales, y en la guía dibujada.
    expect(
      within(medidas).getByText(/fuera del 40 % inferior, 400 px/),
    ).toBeInTheDocument();
    expect(
      within(medidas).getByText(
        /En verticales, deje libre el mismo 40 % inferior \(640 px de 1600\)/,
      ),
    ).toBeInTheDocument();
    expect(medidas.querySelector(".medidas-guia__franja")).toHaveStyle({
      height: "40%",
    });
    expect(medidas.querySelector(".medidas-guia__segura")).toHaveStyle({
      bottom: "40%",
    });
    expect(
      within(medidas).getByText(/750 × 1200 px \(vertical\)/),
    ).toBeInTheDocument();
  });
});

describe("Editar una imagen", () => {
  const NOTICIA = {
    id: 4,
    titulo: "Aniversario",
    descripcion: "",
    texto_alternativo: "",
    nombre_original: "aniversario.jpg",
    publicar_desde: "2026-11-01",
    publicar_hasta: "2026-11-30",
    estado: "publicada",
    orden: 0,
  };

  async function abrirEdicion() {
    servicio.noticias.mockResolvedValue([NOTICIA]);
    pintar(<GestionNoticiasPage />);
    // Espera la miniatura: su dirección es la de la vista previa.
    await waitFor(() =>
      expect(document.querySelector("img.noticias-miniatura")).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar Aniversario" }));
    return screen.getByRole("dialog", { name: "Editar imagen del carrusel" });
  }

  it("la vista previa parte de la imagen guardada", async () => {
    const ventana = await abrirEdicion();
    const miniatura = document.querySelector("img.noticias-miniatura");
    const pie = within(ventana).getByText(
      "Imagen actual. Así se ve en el carrusel de Inicio.",
    );
    const imagen = pie.closest("figure").querySelector(".carrusel__imagen");
    expect(imagen).toHaveAttribute("src", miniatura.getAttribute("src"));
    expect(
      within(pie.closest("figure")).getByText("Aniversario"),
    ).toBeVisible();
  });

  it("«Quitar imagen» descarta la que excede y deja guardar los cambios de texto", async () => {
    const pesada = archivo("enorme.png", "image/png", 6_300_000);
    optimizarImagen.mockResolvedValue({
      archivo: pesada,
      optimizada: false,
      antes: pesada.size,
      despues: pesada.size,
    });
    servicio.guardarNoticia.mockResolvedValue({});
    const ventana = await abrirEdicion();
    const campo = within(ventana).getByLabelText(/^Reemplazar imagen/);
    fireEvent.change(campo, { target: { files: [pesada] } });
    await within(ventana).findByText(/La imagen pesa 6,01 MB/, {
      selector: ".mz-field-error",
    });
    // Con la nueva descartada, la vista previa sigue en la imagen actual.
    expect(
      within(ventana).getByText(
        "Imagen actual. Así se ve en el carrusel de Inicio.",
      ),
    ).toBeInTheDocument();

    const quitar = within(ventana).getByRole("button", {
      name: /Quitar imagen/,
    });
    // Clase propia: 44 px de alto al tocar con el dedo (`any-pointer: coarse`).
    expect(quitar).toHaveClass("noticias-quitar-imagen");
    fireEvent.click(quitar);
    expect(
      within(ventana).queryByText(/La imagen pesa/, {
        selector: ".mz-field-error",
      }),
    ).toBeNull();
    expect(campo).not.toHaveAttribute("aria-invalid");
    expect(campo).toHaveValue("");
    expect(campo).toHaveFocus();

    fireEvent.change(within(ventana).getByLabelText("Título (opcional)"), {
      target: { value: "Aniversario 20" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar cambios" }),
    );
    await waitFor(() =>
      expect(servicio.guardarNoticia).toHaveBeenCalledWith(
        4,
        expect.objectContaining({ titulo: "Aniversario 20" }),
        null,
      ),
    );
  });
});

describe("El carrusel", () => {
  it("muestra la imagen entera con su alt sobre un fondo decorativo de ella misma", async () => {
    pintar(
      <CarruselNoticias
        noticias={[
          {
            id: 7,
            titulo: "Afiche",
            descripcion: "",
            texto_alternativo: "Afiche vertical de la feria",
          },
        ]}
      />,
    );
    const imagen = await screen.findByRole("img", {
      name: "Afiche vertical de la feria",
    });
    expect(imagen).toHaveClass("carrusel__imagen");
    const fondo = document.querySelector(".carrusel__fondo");
    expect(fondo).toHaveAttribute("aria-hidden", "true");
    expect(fondo.style.backgroundImage).toContain(imagen.getAttribute("src"));
    // El fondo no es una segunda imagen que se anuncie.
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("la franja del título es hermana del marco de la imagen, no está encima dentro de él", async () => {
    pintar(
      <CarruselNoticias
        noticias={[
          { id: 8, titulo: "Feria", descripcion: "Sábado 9:00", orden: 0 },
          { id: 9, titulo: "Torneo", descripcion: "", orden: 1 },
        ]}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".carrusel__imagen")).not.toBeNull(),
    );
    const diapositiva = screen.getByRole("group", { name: /1 de 2/ });
    const medio = diapositiva.querySelector(":scope > .carrusel__medio");
    const franja = diapositiva.querySelector(":scope > .carrusel__texto");
    expect(medio.querySelector(".carrusel__imagen")).not.toBeNull();
    expect(medio.querySelector(".carrusel__fondo")).not.toBeNull();
    expect(franja).toHaveTextContent("FeriaSábado 9:00");
    expect(medio.contains(franja)).toBe(false);
    // Flechas y puntos van fuera de la diapositiva: en el teléfono forman su
    // propia fila bajo la franja.
    const carrusel = screen.getByRole("region", { name: "Noticias" });
    expect(
      diapositiva.contains(
        within(carrusel).getByRole("button", { name: "Noticia siguiente" }),
      ),
    ).toBe(false);
  });

  it("en el fondo solo interpola direcciones blob:", () => {
    const { container } = render(
      <ImagenConFondo src={'blob:x");background:url(evil'} alt="" />,
    );
    expect(
      container.querySelector(".carrusel__fondo").style.backgroundImage,
    ).toBe("");
    render(<ImagenConFondo src="https://otro.sitio/a.png" alt="" />);
    expect(
      document.querySelectorAll(".carrusel__fondo")[1].style.backgroundImage,
    ).toBe("");
  });
});
