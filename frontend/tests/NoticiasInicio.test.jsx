import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El carrusel de noticias de Inicio: cambia solo cada N segundos, con
 * anterior/siguiente y un punto por imagen; se gestiona (subir, fechas,
 * borrar, velocidad) con `noticias.gestionar`.
 */

const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { first_name: "Ana", permissions: permisos.lista } }),
}));
vi.mock("../src/api/misDatosService", () => ({
  misDatosService: { obtener: vi.fn(() => Promise.resolve({ cargo: null })) },
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

const { CarruselNoticias } =
  await import("../src/pages/Institucional/CarruselNoticias");
const { InicioInstitucional } =
  await import("../src/pages/Institucional/InicioInstitucional");
const { GestionNoticiasPage } =
  await import("../src/pages/Institucional/GestionNoticiasPage");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");

const NOTICIAS = [
  {
    id: 1,
    titulo: "Aniversario",
    descripcion: "20 años",
    texto_alternativo: "Afiche del aniversario: 27 de octubre",
    orden: 0,
  },
  { id: 2, titulo: "Vacunación", descripcion: "", orden: 1 },
  { id: 3, titulo: "Fiesta de fin de año", descripcion: "", orden: 2 },
];

function pintar(elemento) {
  return render(
    <MemoryRouter>
      <UnsavedChangesProvider>{elemento}</UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

function diapositiva() {
  return screen.getByRole("group", { name: /de 3/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = [];
  let n = 0;
  globalThis.URL.createObjectURL = vi.fn(() => `blob:local/${(n += 1)}`);
  globalThis.URL.revokeObjectURL = vi.fn();
  servicio.imagenNoticia.mockResolvedValue(
    new Blob(["x"], { type: "image/jpeg" }),
  );
  servicio.noticias.mockResolvedValue(NOTICIAS);
  servicio.carrusel.mockResolvedValue({ segundos: 5 });
});

afterEach(() => vi.useRealTimers());

describe("El carrusel", () => {
  it("cambia solo cada N segundos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pintar(<CarruselNoticias noticias={NOTICIAS} segundos={5} />);
    expect(diapositiva()).toHaveAccessibleName("1 de 3: Aniversario");
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(diapositiva()).toHaveAccessibleName("2 de 3: Vacunación");
  });

  it("anterior, siguiente y un punto por imagen", () => {
    pintar(<CarruselNoticias noticias={NOTICIAS} segundos={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Noticia anterior" }));
    expect(diapositiva()).toHaveAccessibleName("3 de 3: Fiesta de fin de año");
    fireEvent.click(screen.getByRole("button", { name: "Noticia siguiente" }));
    expect(diapositiva()).toHaveAccessibleName("1 de 3: Aniversario");

    const puntos = screen.getAllByRole("button", { name: /Ir a la noticia/ });
    expect(puntos).toHaveLength(3);
    fireEvent.click(puntos[1]);
    expect(diapositiva()).toHaveAccessibleName("2 de 3: Vacunación");
    expect(puntos[1]).toHaveAttribute("aria-current", "true");
  });

  it("con el mouse encima no cambia, para poder leer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pintar(<CarruselNoticias noticias={NOTICIAS} segundos={5} />);
    fireEvent.mouseEnter(screen.getByRole("region", { name: "Noticias" }));
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(diapositiva()).toHaveAccessibleName("1 de 3: Aniversario");
  });

  it("se pausa con su botón y se reanuda (auditoría UX/UI)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pintar(<CarruselNoticias noticias={NOTICIAS} segundos={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Pausar noticias" }));
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(diapositiva()).toHaveAccessibleName("1 de 3: Aniversario");
    fireEvent.click(screen.getByRole("button", { name: "Reanudar noticias" }));
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(diapositiva()).toHaveAccessibleName("2 de 3: Vacunación");
  });

  it("no cambia más rápido que cada 5 segundos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pintar(<CarruselNoticias noticias={NOTICIAS} segundos={2} />);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(diapositiva()).toHaveAccessibleName("1 de 3: Aniversario");
  });

  it("con «reducir movimiento» no avanza solo", async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pintar(<CarruselNoticias noticias={NOTICIAS} segundos={5} />);
    expect(
      screen.getByRole("button", { name: "Reanudar noticias" }),
    ).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(diapositiva()).toHaveAccessibleName("1 de 3: Aniversario");
    window.matchMedia = original;
  });

  it("si la imagen no carga lo dice, y sin texto alternativo es decorativa", async () => {
    servicio.imagenNoticia.mockRejectedValueOnce(new Error("404"));
    pintar(
      <CarruselNoticias
        noticias={[{ ...NOTICIAS[0] }, { ...NOTICIAS[1] }]}
        segundos={5}
      />,
    );
    expect(await screen.findByText("Imagen no disponible")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Noticia siguiente" }));
    // Sin texto alternativo: alt="" (el título ya se lee en el texto).
    await waitFor(() =>
      expect(document.querySelector(".carrusel img")).toHaveAttribute(
        "alt",
        "",
      ),
    );
  });
});

describe("En el Inicio", () => {
  it("va entre el saludo y «Para todos»", async () => {
    pintar(<InicioInstitucional />);
    const carrusel = await screen.findByRole("region", { name: "Noticias" });
    const saludo = screen.getByRole("heading", { name: "Hola, Ana" });
    const paraTodos = screen.getByRole("heading", { name: "Para todos" });
    expect(
      saludo.compareDocumentPosition(carrusel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      carrusel.compareDocumentPosition(paraTodos) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      await within(carrusel).findByRole("img", {
        name: "Afiche del aniversario: 27 de octubre",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Gestionar noticias/ }),
    ).toBeNull();
  });

  it("sin noticias vigentes no ocupa lugar; con permiso se ofrece gestionar", async () => {
    servicio.noticias.mockResolvedValue([]);
    permisos.lista = ["noticias.gestionar"];
    pintar(<InicioInstitucional />);
    expect(
      await screen.findByRole("link", { name: /Gestionar noticias/ }),
    ).toHaveAttribute("href", "/admin/institucional/noticias");
    expect(screen.queryByRole("region", { name: "Noticias" })).toBeNull();
    // El vacío ofrece publicar a quien gestiona.
    expect(
      screen.getByRole("link", { name: /Publicar una noticia/ }),
    ).toHaveAttribute("href", "/admin/institucional/noticias");
  });

  it("si las noticias no cargan lo dice y se puede reintentar", async () => {
    servicio.noticias.mockRejectedValueOnce(new Error("caída"));
    pintar(<InicioInstitucional />);
    expect(
      await screen.findByText("No pudimos cargar las noticias."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No hay noticias publicadas/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(
      await screen.findByRole("region", { name: "Noticias" }),
    ).toBeInTheDocument();
  });
});

describe("Gestionar noticias", () => {
  beforeEach(() => {
    permisos.lista = ["noticias.gestionar"];
    servicio.noticias.mockResolvedValue([
      {
        ...NOTICIAS[0],
        nombre_original: "aniversario.png",
        publicar_desde: "2026-10-01",
        publicar_hasta: "2026-10-31",
        estado: "publicada",
      },
      {
        ...NOTICIAS[1],
        nombre_original: "vacuna.png",
        publicar_desde: "2026-11-01",
        publicar_hasta: "2026-11-05",
        estado: "programada",
      },
    ]);
  });

  it("indica las medidas exactas, debajo del ajuste de segundos", async () => {
    pintar(<GestionNoticiasPage />);
    const medidas = await screen.findByRole("region", {
      name: /Medidas de las imágenes/,
    });
    expect(within(medidas).getByText("1600 × 1000 px")).toBeInTheDocument();
    expect(
      within(medidas).getByText(/16:10 \(horizontal\)/),
    ).toBeInTheDocument();
    expect(
      within(medidas).getByRole("img", { name: /Guía de 1600 por 1000/ }),
    ).toBeInTheDocument();
    const segundos = screen.getByLabelText(/Cambiar de imagen cada/);
    expect(
      segundos.compareDocumentPosition(medidas) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lista todas con su estado y sus fechas", async () => {
    pintar(<GestionNoticiasPage />);
    const fila = (await screen.findByText("Vacunación")).closest("tr");
    expect(within(fila).getByText("Programada")).toBeInTheDocument();
    expect(within(fila).getByText("01/11/2026")).toBeInTheDocument();
    expect(servicio.noticias).toHaveBeenCalledWith(true);
  });

  it("agrega una imagen con sus fechas de publicación", async () => {
    servicio.guardarNoticia.mockResolvedValue({});
    pintar(<GestionNoticiasPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Agregar imagen/ }),
    );
    const ventana = screen.getByRole("dialog", { name: "Agregar imagen" });
    const archivo = new File(["x"], "evento.png", { type: "image/png" });
    fireEvent.change(within(ventana).getByLabelText(/^Imagen/), {
      target: { files: [archivo] },
    });
    fireEvent.change(within(ventana).getByLabelText("Título (opcional)"), {
      target: { value: "Torneo" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Publicar desde/), {
      target: { value: "2026-10-20" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Publicar hasta/), {
      target: { value: "2026-10-25" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: "Agregar" }));

    await waitFor(() =>
      expect(servicio.guardarNoticia).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          titulo: "Torneo",
          publicar_desde: "2026-10-20",
          publicar_hasta: "2026-10-25",
        }),
        archivo,
      ),
    );
    expect(await screen.findByText("Imagen agregada.")).toBeInTheDocument();
  });

  it("borra y ajusta los segundos", async () => {
    servicio.eliminarNoticia.mockResolvedValue({});
    servicio.guardarCarrusel.mockResolvedValue({ segundos: 8 });
    pintar(<GestionNoticiasPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Borrar Aniversario" }),
    );
    // Borrar pide confirmación (auditoría UX/UI, 28/10/2026).
    const pregunta = await screen.findByRole("dialog", {
      name: /Borrar «Aniversario»/,
    });
    fireEvent.click(within(pregunta).getByRole("button", { name: "Borrar" }));
    await waitFor(() =>
      expect(servicio.eliminarNoticia).toHaveBeenCalledWith(1),
    );

    const campo = await screen.findByLabelText(/Cambiar de imagen cada/);
    await waitFor(() => expect(campo).toHaveValue(5));
    fireEvent.change(campo, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.guardarCarrusel).toHaveBeenCalledWith(8),
    );
  });
});
