import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Institucional → Códigos de conducta: toda persona lee los códigos y
 * reglamentos; un PDF se abre en el visor del sistema y un Word se descarga.
 * Gestionarlos pide los permisos de `codigos.*`, uno por pestaña.
 */

const permisos = { lista: [] };
const GESTION = [
  "codigos.publicar",
  "codigos.acuerdo",
  "codigos.ver_aceptaciones",
];
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: permisos.lista } }),
}));

const servicio = {
  documentos: vi.fn(),
  guardarDocumento: vi.fn(),
  eliminarDocumento: vi.fn(),
  archivoDocumento: vi.fn(),
  confidencialidad: vi.fn(),
  aceptarConfidencialidad: vi.fn(),
  guardarConfidencialidad: vi.fn(),
  aceptacionesConfidencialidad: vi.fn(),
};

const ACUERDO = {
  titulo: "Acuerdo de confidencialidad",
  texto: "Uso interno. No compartir.",
  version: 4,
  aceptado: true,
  aceptado_en: "2026-10-19T15:30:00Z",
  aceptado_antes_en: null,
};
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: servicio,
}));

const { CodigosConductaPage } =
  await import("../src/pages/Institucional/CodigosConductaPage");
const { GestionDocumentosPage } =
  await import("../src/pages/Institucional/GestionDocumentosPage");

const CODIGO = {
  id: 1,
  titulo: "Código de conducta",
  categoria: "conducta",
  version: "V2",
  vigente_desde: "2026-01-15",
  descripcion: "Normas de comportamiento",
  nombre_original: "codigo.pdf",
  tamano_bytes: 250000,
  es_pdf: true,
  activo: true,
};
const REGLAMENTO = {
  ...CODIGO,
  id: 2,
  titulo: "Reglamento interno",
  categoria: "disciplinario",
  version: "",
  vigente_desde: null,
  descripcion: "",
  nombre_original: "reglamento.docx",
  es_pdf: false,
};

function pintar(pagina = <CodigosConductaPage />) {
  return render(<MemoryRouter>{pagina}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = [];
  servicio.documentos.mockResolvedValue([CODIGO, REGLAMENTO]);
  servicio.confidencialidad.mockResolvedValue(ACUERDO);
  globalThis.URL.createObjectURL = vi.fn(() => "blob:local/1");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("Códigos de conducta: una pestaña por documento", () => {
  beforeEach(() => {
    servicio.archivoDocumento.mockResolvedValue(
      new Blob(["%PDF-1.4"], { type: "application/pdf" }),
    );
  });

  it("abre la pestaña del documento marcado y lo muestra ahí mismo", async () => {
    servicio.documentos.mockResolvedValue([
      CODIGO,
      { ...CODIGO, id: 3, titulo: "Política", predeterminado: true },
    ]);
    pintar();

    const pestanas = await screen.findAllByRole("tab");
    expect(pestanas.map((p) => p.textContent.trim())).toEqual([
      "Código de conducta",
      "Política",
    ]);
    expect(screen.getByRole("tab", { name: /Política/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const panel = screen.getByRole("tabpanel");
    expect(
      await within(panel).findByTitle("Documento: Política"),
    ).toHaveAttribute("src", "blob:local/1");
    expect(servicio.archivoDocumento).toHaveBeenCalledWith(3);
  });

  it("sin documento marcado abre el primero; otra pestaña cambia el documento", async () => {
    pintar();
    expect(
      await screen.findByRole("tab", { name: /Código de conducta/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByText(/Versión V2 · vigente desde 15\/01\/2026/),
    ).toBeInTheDocument();

    // El Word no se puede mostrar: se ofrece descargarlo.
    fireEvent.click(screen.getByRole("tab", { name: /Reglamento interno/ }));
    expect(
      await screen.findByText(/no se puede mostrar en el navegador/),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: /Descargar/ }),
    ).toHaveAttribute("download", "reglamento.docx");

    // Volver a una pestaña ya vista no pide el archivo de nuevo.
    fireEvent.click(screen.getByRole("tab", { name: /Código de conducta/ }));
    expect(servicio.archivoDocumento).toHaveBeenCalledTimes(2);
  });

  it("un documento borrado o retirado no tiene pestaña", async () => {
    servicio.documentos.mockResolvedValue([
      CODIGO,
      { ...REGLAMENTO, activo: false },
    ]);
    pintar();
    expect(await screen.findAllByRole("tab")).toHaveLength(1);
    expect(screen.queryByRole("tab", { name: /Reglamento/ })).toBeNull();
  });

  it("la pantalla de lectura no edita: con permiso, lleva a la gestión", async () => {
    permisos.lista = [...GESTION];
    pintar();
    expect(
      await screen.findByRole("link", { name: /Gestionar documentos/ }),
    ).toHaveAttribute("href", "/admin/institucional/codigos/gestionar");
    expect(screen.queryByRole("button", { name: /Publicar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar|Borrar/ })).toBeNull();
  });

  it("sin permiso no ofrece gestionar", async () => {
    pintar();
    await screen.findAllByRole("tab");
    expect(screen.queryByRole("link", { name: /Gestionar/ })).toBeNull();
  });
});

describe("El acuerdo de confidencialidad", () => {
  beforeEach(() => {
    servicio.archivoDocumento.mockResolvedValue(
      new Blob(["%PDF-1.4"], { type: "application/pdf" }),
    );
    servicio.confidencialidad.mockResolvedValue({
      ...ACUERDO,
      aceptado: false,
      aceptado_en: null,
    });
    servicio.aceptarConfidencialidad.mockResolvedValue(ACUERDO);
  });

  it("al entrar se presenta y, sin aceptarlo, no se ve ningún documento", async () => {
    pintar();
    const ventana = await screen.findByRole("dialog", {
      name: /Acuerdo de confidencialidad/,
    });
    expect(within(ventana).getByText(/No compartir/)).toBeInTheDocument();
    expect(servicio.archivoDocumento).not.toHaveBeenCalled();

    // «Ahora no»: se cierra, pero el contenido sigue bloqueado.
    fireEvent.click(within(ventana).getByRole("button", { name: "Ahora no" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText(/acepte el acuerdo de confidencialidad/),
    ).toBeInTheDocument();
    expect(screen.queryByTitle(/Documento:/)).toBeNull();
    expect(servicio.archivoDocumento).not.toHaveBeenCalled();

    // Desde ahí se vuelve a abrir y se acepta.
    fireEvent.click(
      screen.getByRole("button", { name: "Leer y aceptar el acuerdo" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Acepto el acuerdo" }));
    expect(
      await screen.findByTitle("Documento: Código de conducta"),
    ).toBeInTheDocument();
    expect(servicio.aceptarConfidencialidad).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Aceptó el acuerdo de/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("aceptado, no se vuelve a presentar", async () => {
    servicio.confidencialidad.mockResolvedValue(ACUERDO);
    pintar();
    expect(
      await screen.findByTitle("Documento: Código de conducta"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("si los documentos cambiaron, dice por qué se pide de nuevo", async () => {
    servicio.confidencialidad.mockResolvedValue({
      ...ACUERDO,
      aceptado: false,
      aceptado_en: null,
      aceptado_antes_en: "2026-10-01T10:00:00Z",
    });
    pintar();
    expect(
      await screen.findByText(/Los documentos cambiaron desde que aceptó/),
    ).toBeInTheDocument();
  });
});

describe("Gestionar documentos", () => {
  beforeEach(() => {
    permisos.lista = [...GESTION];
    servicio.documentos.mockResolvedValue([
      CODIGO,
      { ...REGLAMENTO, activo: false },
    ]);
  });

  it("lista todos los cargados, también los retirados", async () => {
    pintar(<GestionDocumentosPage />);
    const fila = (await screen.findByText("Reglamento interno")).closest("tr");
    expect(within(fila).getByText("Retirado")).toBeInTheDocument();
    expect(within(fila).getByText(/reglamento\.docx/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Volver a los documentos/ }),
    ).toHaveAttribute("href", "/admin/institucional/codigos");
  });

  it("retira y borra", async () => {
    servicio.guardarDocumento.mockResolvedValue({});
    servicio.eliminarDocumento.mockResolvedValue({});
    pintar(<GestionDocumentosPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Retirar Código de conducta" }),
    );
    await waitFor(() =>
      expect(servicio.guardarDocumento).toHaveBeenCalledWith(1, {
        activo: false,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Borrar Reglamento interno" }),
    );
    await waitFor(() =>
      expect(servicio.eliminarDocumento).toHaveBeenCalledWith(2),
    );
    expect(
      await screen.findByText("«Reglamento interno» se borró."),
    ).toBeInTheDocument();
  });

  it("marca el documento que se abre primero", async () => {
    servicio.guardarDocumento.mockResolvedValue({});
    pintar(<GestionDocumentosPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Abrir primero Código de conducta",
      }),
    );
    await waitFor(() =>
      expect(servicio.guardarDocumento).toHaveBeenCalledWith(1, {
        predeterminado: true,
      }),
    );
    expect(
      await screen.findByText("«Código de conducta» se abrirá primero."),
    ).toBeInTheDocument();
  });

  it("configura el título y el texto del acuerdo", async () => {
    servicio.guardarConfidencialidad.mockResolvedValue({
      ...ACUERDO,
      titulo: "Compromiso de reserva",
    });
    pintar(<GestionDocumentosPage />);
    fireEvent.click(
      await screen.findByRole("tab", { name: "Acuerdo de confidencialidad" }),
    );
    fireEvent.change(await screen.findByLabelText("Título"), {
      target: { value: "Compromiso de reserva" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar acuerdo" }));
    await waitFor(() =>
      expect(servicio.guardarConfidencialidad).toHaveBeenCalledWith({
        titulo: "Compromiso de reserva",
        texto: ACUERDO.texto,
      }),
    );
    expect(await screen.findByText("Acuerdo guardado.")).toBeInTheDocument();
  });

  it("muestra quién aceptó y cuándo", async () => {
    servicio.aceptacionesConfidencialidad.mockResolvedValue([
      {
        id: 1,
        persona: "Rosa Vera",
        correo: "rosa@grupolaar.com",
        aceptado_en: "2026-10-19T15:30:00Z",
        version: 4,
        vigente: true,
      },
    ]);
    pintar(<GestionDocumentosPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Aceptaciones" }));
    const fila = (await screen.findByText("Rosa Vera")).closest("tr");
    expect(within(fila).getByText("Vigente")).toBeInTheDocument();
    expect(within(fila).getByText(/19\/10\/2026/)).toBeInTheDocument();
  });

  it("cada pestaña se ve con su permiso", async () => {
    // Solo consulta quién aceptó: entra, y ve solo esa pestaña.
    permisos.lista = ["codigos.ver_aceptaciones"];
    servicio.aceptacionesConfidencialidad.mockResolvedValue([]);
    pintar(<GestionDocumentosPage />);
    const pestanas = await screen.findAllByRole("tab");
    expect(pestanas.map((p) => p.textContent)).toEqual(["Aceptaciones"]);
    expect(pestanas[0]).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByText("Nadie ha aceptado el acuerdo todavía"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publicar/ })).toBeNull();
    expect(servicio.documentos).not.toHaveBeenCalled();
  });

  it("con cualquiera de los permisos se ofrece «Gestionar documentos»", async () => {
    permisos.lista = ["codigos.acuerdo"];
    pintar();
    expect(
      await screen.findByRole("link", { name: /Gestionar documentos/ }),
    ).toBeInTheDocument();
  });

  it("publica un documento", async () => {
    servicio.guardarDocumento.mockResolvedValue({});
    pintar(<GestionDocumentosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Publicar documento/ }),
    );
    const ventana = screen.getByRole("dialog", { name: "Publicar documento" });
    fireEvent.change(within(ventana).getByLabelText("Título"), {
      target: { value: "Política anticorrupción" },
    });
    fireEvent.change(within(ventana).getByLabelText("Tipo"), {
      target: { value: "otro" },
    });
    const archivo = new File(["%PDF-1.4"], "politica.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(within(ventana).getByLabelText("Archivo"), {
      target: { files: [archivo] },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: "Publicar" }));

    await waitFor(() =>
      expect(servicio.guardarDocumento).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          titulo: "Política anticorrupción",
          categoria: "otro",
          activo: true,
        }),
        archivo,
      ),
    );
    expect(await screen.findByText("Documento publicado.")).toBeInTheDocument();
  });
});
