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
  exportarAceptaciones: vi.fn(),
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
// El lector dibuja con pdf.js (no corre en jsdom): basta saber qué abre.
vi.mock("../src/components/common/VisorPdf/LectorPdf", () => ({
  registrarPdf: vi.fn(),
  olvidarPdf: vi.fn(),
  LectorPdf: ({ titulo, url }) => (
    <div title={`Documento: ${titulo}`} data-url={url} />
  ),
}));
const descargas = vi.hoisted(() => ({ descargarBlob: vi.fn() }));
vi.mock("../src/utils/descargas", async (original) => ({
  ...(await original()),
  descargarBlob: descargas.descargarBlob,
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
    await waitFor(() =>
      expect(within(panel).getByTitle("Documento: Política")).toHaveAttribute(
        "data-url",
        "blob:local/1",
      ),
    );
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
    // Descargarlo pasa por `descargarBlob`, que lo registra (26/10/2026).
    expect(
      await screen.findByRole("button", { name: /Descargar/ }),
    ).toBeInTheDocument();

    // Volver a una pestaña ya vista no pide el archivo de nuevo.
    fireEvent.click(screen.getByRole("tab", { name: /Código de conducta/ }));
    expect(servicio.archivoDocumento).toHaveBeenCalledTimes(2);
  });

  it("las pestañas se recorren con las flechas (revisión final UX/UI)", async () => {
    pintar();
    const primera = await screen.findByRole("tab", {
      name: /Código de conducta/,
    });
    expect(primera).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(primera, { key: "ArrowRight" });
    const segunda = screen.getByRole("tab", { name: /Reglamento interno/ });
    expect(segunda).toHaveAttribute("aria-selected", "true");
    expect(segunda).toHaveFocus();
    expect(primera).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      segunda.id,
    );
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
    const fila = (await screen.findAllByText("Reglamento interno"))[0].closest(
      "tr",
    );
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
      (
        await screen.findAllByRole("button", {
          name: "Retirar Código de conducta",
        })
      )[0],
    );
    // Retirar se confirma, sin pedir aceptar de nuevo.
    expect(servicio.guardarDocumento).not.toHaveBeenCalled();
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: /Retirar/ })).getByRole(
        "button",
        { name: "Retirar" },
      ),
    );
    await waitFor(() =>
      expect(servicio.guardarDocumento).toHaveBeenCalledWith(1, {
        activo: false,
      }),
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Borrar Reglamento interno" })[0],
    );
    // Borrar pide confirmación (auditoría UX/UI).
    expect(servicio.eliminarDocumento).not.toHaveBeenCalled();
    fireEvent.click(
      within(
        await screen.findByRole("dialog", { name: /Borrar el documento/ }),
      ).getByRole("button", { name: "Borrar" }),
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
      (
        await screen.findAllByRole("button", {
          name: "Abrir primero Código de conducta",
        })
      )[0],
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
    fireEvent.change(await screen.findByLabelText(/^Título/), {
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

  it("muestra quién falta, quién aceptó y cuándo", async () => {
    servicio.aceptacionesConfidencialidad.mockResolvedValue({
      total: 3,
      aceptaron: 1,
      pendientes: 2,
      personas: [
        {
          id: 1,
          persona: "Rosa Vera",
          correo: "rosa@grupolaar.com",
          aceptado_en: "2026-10-19T15:30:00Z",
          estado: "vigente",
          vigente: true,
        },
        {
          id: 2,
          persona: "Luis Mora",
          correo: "luis@grupolaar.com",
          aceptado_en: "2026-09-01T15:30:00Z",
          estado: "antes",
          vigente: false,
        },
        {
          id: 3,
          persona: "Ana Paz",
          correo: "ana@grupolaar.com",
          aceptado_en: null,
          estado: "nunca",
          vigente: false,
        },
      ],
    });
    pintar(<GestionDocumentosPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Aceptaciones" }));
    expect(await screen.findByText("1 de 3")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Pendientes (2)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("2 pendientes")).toBeInTheDocument();

    // Primero, quién falta.
    const pendiente = screen.getAllByText("Luis Mora")[0].closest("tr");
    expect(
      within(pendiente).getByText("Aceptó antes de un cambio"),
    ).toBeInTheDocument();
    expect(
      within(screen.getAllByText("Ana Paz")[0].closest("tr")).getByText(
        "No ha aceptado",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Rosa Vera")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Aceptaron/ }));
    const fila = screen.getAllByText("Rosa Vera")[0].closest("tr");
    expect(within(fila).getByText("Aceptó")).toBeInTheDocument();
    expect(within(fila).getByText(/19\/10\/2026/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Todas/ }));
    fireEvent.change(screen.getByLabelText("Buscar persona"), {
      target: { value: "ana@" },
    });
    expect(screen.getAllByText("Ana Paz")[0]).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 persona");
    expect(screen.queryByText("Luis Mora")).toBeNull();
  });

  it("exporta las aceptaciones a Excel", async () => {
    servicio.aceptacionesConfidencialidad.mockResolvedValue({
      total: 0,
      aceptaron: 0,
      pendientes: 0,
      personas: [],
    });
    const blob = new Blob(["PK"]);
    servicio.exportarAceptaciones.mockResolvedValue(blob);
    pintar(<GestionDocumentosPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Aceptaciones" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Exportar a Excel/ }),
    );
    await waitFor(() =>
      expect(descargas.descargarBlob).toHaveBeenCalledWith(
        blob,
        "aceptaciones-confidencialidad.xlsx",
      ),
    );
  });

  it("cada pestaña se ve con su permiso", async () => {
    // Solo consulta quién aceptó: entra, y ve solo esa pestaña.
    permisos.lista = ["codigos.ver_aceptaciones"];
    servicio.aceptacionesConfidencialidad.mockResolvedValue({
      total: 0,
      aceptaron: 0,
      pendientes: 0,
      personas: [],
    });
    pintar(<GestionDocumentosPage />);
    const pestanas = await screen.findAllByRole("tab");
    expect(pestanas.map((p) => p.textContent.trim())).toEqual(["Aceptaciones"]);
    expect(pestanas[0]).toHaveAttribute("aria-selected", "true");
    expect(
      (
        await screen.findAllByText("Nadie tiene pendiente aceptar el acuerdo.")
      )[0],
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
    fireEvent.change(within(ventana).getByLabelText(/^Título/), {
      target: { value: "Política anticorrupción" },
    });
    fireEvent.change(within(ventana).getByLabelText("Tipo"), {
      target: { value: "otro" },
    });
    const archivo = new File(["%PDF-1.4"], "politica.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(within(ventana).getByLabelText(/^Archivo/), {
      target: { files: [archivo] },
    });
    expect(
      within(ventana).getByText(/deberán aceptar de nuevo/),
    ).toBeInTheDocument();
    fireEvent.click(within(ventana).getByRole("button", { name: "Publicar" }));
    expect(servicio.guardarDocumento).not.toHaveBeenCalled();
    fireEvent.click(
      within(
        await screen.findByRole("dialog", { name: "¿Publicar el documento?" }),
      ).getByRole("button", { name: "Publicar" }),
    );

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

  it("solo acepta documentos en PDF", async () => {
    pintar(<GestionDocumentosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Publicar documento/ }),
    );
    const ventana = screen.getByRole("dialog", { name: "Publicar documento" });
    fireEvent.change(within(ventana).getByLabelText(/^Título/), {
      target: { value: "Reglamento" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Archivo/), {
      target: { files: [new File(["x"], "reglamento.docx")] },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: "Publicar" }));
    expect(
      await within(ventana).findByText(/Suba el documento en PDF/),
    ).toBeInTheDocument();
    expect(servicio.guardarDocumento).not.toHaveBeenCalled();
  });

  it("editar el título no pide aceptar de nuevo", async () => {
    servicio.guardarDocumento.mockResolvedValue({});
    pintar(<GestionDocumentosPage />);
    fireEvent.click(
      (
        await screen.findAllByRole("button", {
          name: "Editar Código de conducta",
        })
      )[0],
    );
    const ventana = screen.getByRole("dialog", { name: /Editar/ });
    expect(within(ventana).queryByText(/aceptar de nuevo/)).toBeNull();
    fireEvent.change(within(ventana).getByLabelText(/^Título/), {
      target: { value: "Código de ética" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar cambios" }),
    );
    await waitFor(() =>
      expect(servicio.guardarDocumento).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ titulo: "Código de ética" }),
        null,
      ),
    );
  });

  it("volver a publicarlo desde «Editar» lo confirma con ese nombre", async () => {
    servicio.guardarDocumento.mockResolvedValue({});
    pintar(<GestionDocumentosPage />);
    fireEvent.click(
      (
        await screen.findAllByRole("button", {
          name: "Editar Reglamento interno",
        })
      )[0],
    );
    const ventana = screen.getByRole("dialog", { name: /Editar/ });
    fireEvent.click(within(ventana).getByLabelText(/^Vigente \(visible/));
    expect(
      within(ventana).getByText(/Al volver a publicarlo/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar cambios" }),
    );
    fireEvent.click(
      within(
        await screen.findByRole("dialog", {
          name: "¿Volver a publicar el documento?",
        }),
      ).getByRole("button", { name: "Volver a publicar" }),
    );
    await waitFor(() =>
      expect(servicio.guardarDocumento).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ activo: true }),
        null,
      ),
    );
  });
});
