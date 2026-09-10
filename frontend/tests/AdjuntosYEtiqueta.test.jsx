import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Los documentos de un activo y su etiqueta.
 *
 * En los adjuntos hay facturas y actas firmadas, así que la descarga pasa por
 * la API con el token y no por una URL directa al archivo: un enlace público
 * bastaría para sacarlas sin pasar por el login. Y borrar uno es definitivo,
 * de modo que la pregunta tiene que decirlo.
 *
 * En la etiqueta lo que se prueba es el aviso de legibilidad: lo que decide si
 * una pistola lee el código no es el formato del archivo sino tres medidas
 * físicas, y saberlo antes de mandar doscientas etiquetas a imprimir es todo
 * el punto de la pantalla.
 */

const listar = vi.fn();
const subir = vi.fn();
const descargarAdjunto = vi.fn();
const eliminar = vi.fn();

vi.mock("../src/api/adjuntosService", () => ({
  adjuntosService: {
    list: (...args) => listar(...args),
    subir: (...args) => subir(...args),
    descargar: (...args) => descargarAdjunto(...args),
    remove: (...args) => eliminar(...args),
  },
}));

const previsualizarPdf = vi.fn();
const medicionEtiqueta = vi.fn();
const etiqueta = vi.fn();
const descargarEtiqueta = vi.fn();

vi.mock("../src/api/activosService", () => ({
  activosService: {
    previsualizarPdf: (...args) => previsualizarPdf(...args),
    medicionEtiqueta: (...args) => medicionEtiqueta(...args),
    etiqueta: (...args) => etiqueta(...args),
    descargarEtiqueta: (...args) => descargarEtiqueta(...args),
  },
}));

const descargarArchivo = vi.fn();
vi.mock("../src/utils/descargas", () => ({
  descargarBlob: (...args) => descargarArchivo(...args),
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { AdjuntosPanel } =
  await import("../src/components/activos/AdjuntosPanel/AdjuntosPanel");
const { EtiquetaDialog } =
  await import("../src/components/activos/EtiquetaDialog/EtiquetaDialog");

const ADJUNTOS = [
  {
    id: 1,
    nombre_original: "factura-4471.pdf",
    tipo: "factura",
    tipo_display: "Factura de compra",
    tamano_bytes: 245_000,
    created_at: "2026-07-01T10:00:00Z",
    subido_por_nombre: "Ana Cevallos",
    generado_por_el_sistema: false,
  },
  {
    id: 2,
    nombre_original: "acta-entrega-7.pdf",
    tipo: "acta_entrega",
    tipo_display: "Acta de entrega",
    tamano_bytes: 51_000,
    created_at: "2026-07-05T10:00:00Z",
    subido_por_nombre: null,
    generado_por_el_sistema: true,
  },
];

const ACTIVO = {
  id: 7,
  codigo_barras: "GA-LAP-000007",
  nombre: "Laptop Jefatura TI",
};

function archivo(nombre, bytes = 1000) {
  const fichero = new File(["x"], nombre, { type: "application/pdf" });
  Object.defineProperty(fichero, "size", { value: bytes });
  return fichero;
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  listar.mockResolvedValue({ results: ADJUNTOS });
  subir.mockResolvedValue({ id: 3 });
  descargarAdjunto.mockResolvedValue(new Blob(["x"]));
  eliminar.mockResolvedValue({});
  previsualizarPdf.mockResolvedValue(new Blob(["pdf"]));
  medicionEtiqueta.mockResolvedValue({
    simbologia: "Code 128",
    ancho_modulo_mm: 0.25,
    quiet_zone_mm: 2.5,
    alto_barras_mm: 10,
    cabe: true,
    cumple_minimo: true,
  });
  etiqueta.mockResolvedValue({ contenido: "^XA^FO50,50^BCN,80^FD..." });
  descargarEtiqueta.mockResolvedValue(new Blob(["zpl"]));
  URL.createObjectURL = vi.fn(() => "blob:etiqueta");
  URL.revokeObjectURL = vi.fn();
});

// --- Adjuntos ---------------------------------------------------------------

describe("Los documentos del activo", () => {
  it("lista lo archivado, con quién lo subió y cuánto pesa", async () => {
    render(<AdjuntosPanel activoId={7} />);

    const fila = (await screen.findByText("factura-4471.pdf")).closest("li");
    expect(fila).toHaveTextContent("Factura de compra");
    expect(fila).toHaveTextContent("239 KB");
    expect(fila).toHaveTextContent("Ana Cevallos");
  });

  it("distingue lo que generó el sistema de lo que subió alguien", async () => {
    /* Un acta de entrega generada por el sistema no tiene autor humano;
       dejarla sin nada haría pensar que falta el dato. */
    render(<AdjuntosPanel activoId={7} />);

    const fila = (await screen.findByText("acta-entrega-7.pdf")).closest("li");
    expect(fila).toHaveTextContent("generado por el sistema");
  });

  it("la descarga pasa por la API, no por una URL al archivo", async () => {
    /* Aquí hay facturas y actas firmadas: un enlace directo bastaría para
       sacarlas sin pasar por el login. */
    render(<AdjuntosPanel activoId={7} />);

    fireEvent.click(await screen.findByText("factura-4471.pdf"));

    await waitFor(() => expect(descargarAdjunto).toHaveBeenCalledWith(1));
    expect(descargarArchivo).toHaveBeenCalledWith(
      expect.any(Blob),
      "factura-4471.pdf",
    );
  });

  it("si la descarga falla, lo dice", async () => {
    descargarAdjunto.mockRejectedValue(new Error("500"));

    render(<AdjuntosPanel activoId={7} />);

    fireEvent.click(await screen.findByText("factura-4471.pdf"));

    expect(
      await screen.findByText("No se pudo descargar el archivo."),
    ).toBeInTheDocument();
  });

  it("sin permiso no se sube ni se borra nada", async () => {
    render(<AdjuntosPanel activoId={7} />);

    await screen.findByText("factura-4471.pdf");
    expect(
      screen.queryByRole("button", { name: "Adjuntar archivo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Eliminar/ }),
    ).not.toBeInTheDocument();
  });

  it("un archivo demasiado grande se rechaza aquí, sin subirlo", async () => {
    /* Subir 20 MB para que el servidor los rechace desperdicia el tiempo de
       quien está esperando. */
    permisos.add("adjuntos.subir");

    const { container } = render(<AdjuntosPanel activoId={7} />);

    await screen.findByText("factura-4471.pdf");
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [archivo("informe.pdf", 20 * 1024 * 1024)] },
    });

    expect(
      await screen.findByText("«informe.pdf» pesa más de 10 MB."),
    ).toBeInTheDocument();
    expect(subir).not.toHaveBeenCalled();
  });

  it("se sube con el tipo elegido y la lista se rehace", async () => {
    permisos.add("adjuntos.subir");

    const { container } = render(<AdjuntosPanel activoId={7} />);

    await screen.findByText("factura-4471.pdf");
    fireEvent.change(screen.getByLabelText("Tipo de documento"), {
      target: { value: "evidencia_dano" },
    });
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [archivo("golpe.jpg")] },
    });

    await waitFor(() => expect(subir).toHaveBeenCalled());
    expect(subir.mock.calls[0][0]).toMatchObject({
      activo: 7,
      tipo: "evidencia_dano",
    });
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
  });

  it("si la subida falla, lo dice con el motivo del servidor", async () => {
    permisos.add("adjuntos.subir");
    subir.mockRejectedValue({
      response: { data: { error: { message: "Formato no admitido." } } },
    });

    const { container } = render(<AdjuntosPanel activoId={7} />);

    await screen.findByText("factura-4471.pdf");
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [archivo("virus.exe")] },
    });

    expect(await screen.findByText("Formato no admitido.")).toBeInTheDocument();
  });

  it("borrar dice que el archivo no se recupera", async () => {
    /* La bitácora conserva constancia de que existió, pero el archivo no
       vuelve: hay que decirlo antes, no después. */
    permisos.add("adjuntos.eliminar");

    render(<AdjuntosPanel activoId={7} />);

    await screen.findByText("factura-4471.pdf");
    fireEvent.click(
      screen.getByRole("button", { name: "Eliminar factura-4471.pdf" }),
    );

    const aviso = await screen.findByText(/Se eliminará «factura-4471.pdf»/);
    expect(aviso).toHaveTextContent("no se podrá recuperar");
  });

  it("confirmado, se elimina y la lista se rehace", async () => {
    permisos.add("adjuntos.eliminar");

    render(<AdjuntosPanel activoId={7} />);

    await screen.findByText("factura-4471.pdf");
    fireEvent.click(
      screen.getByRole("button", { name: "Eliminar factura-4471.pdf" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(eliminar).toHaveBeenCalledWith(1));
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
  });

  it("sin documentos dice qué se admite, a quien pueda subirlos", async () => {
    permisos.add("adjuntos.subir");
    listar.mockResolvedValue({ results: [] });

    render(<AdjuntosPanel activoId={7} />);

    expect(
      await screen.findByText(/Sin documentos adjuntos/),
    ).toHaveTextContent("hasta 10 MB");
  });

  it("los adjuntos de una intervención se piden por ella, no por el activo", async () => {
    render(<AdjuntosPanel activoId={7} mantenimientoId={11} />);

    await waitFor(() =>
      expect(listar).toHaveBeenCalledWith({ mantenimiento: 11 }),
    );
  });

  it("se recarga cuando algo de fuera archiva un documento", async () => {
    /* Archivar un acta desde el historial no pasa por este panel: sin el
       aviso, la lista seguiría diciendo «sin documentos» con el acta ya
       guardada. */
    const { rerender } = render(
      <AdjuntosPanel activoId={7} recargarToken={0} />,
    );

    await screen.findByText("factura-4471.pdf");
    rerender(<AdjuntosPanel activoId={7} recargarToken={1} />);

    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
  });

  it("si no cargan, lo dice", async () => {
    listar.mockRejectedValue(new Error("500"));

    render(<AdjuntosPanel activoId={7} />);

    expect(
      await screen.findByText("No se pudieron cargar los adjuntos."),
    ).toBeInTheDocument();
  });
});

// --- La etiqueta ------------------------------------------------------------

describe("La etiqueta del activo", () => {
  it("previsualiza el PDF real, no una imitación en HTML", async () => {
    /* Una maqueta con CSS podría diferir del documento que sale impreso, que
       es justamente lo que la previsualización debería evitar. */
    render(<EtiquetaDialog activo={ACTIVO} onCerrar={vi.fn()} />);

    expect(
      await screen.findByLabelText("Vista previa de la etiqueta GA-LAP-000007"),
    ).toBeInTheDocument();
    expect(previsualizarPdf).toHaveBeenCalledWith(7);
  });

  it("dice que el PDF se imprime a escala real", async () => {
    /* «Ajustar a página» encoge las barras y el código deja de leerse. */
    render(<EtiquetaDialog activo={ACTIVO} onCerrar={vi.fn()} />);

    expect(await screen.findByText(/a escala 100 %/)).toBeInTheDocument();
  });

  it("con las medidas dentro de lo legible, lo confirma", async () => {
    render(<EtiquetaDialog activo={ACTIVO} onCerrar={vi.fn()} />);

    const aviso = (
      await screen.findByText(/Dentro de lo que lee una pistola láser común/)
    ).closest("div");
    expect(aviso).toHaveTextContent("Code 128");
    // Las tres medidas que deciden la lectura, no solo el veredicto.
    expect(aviso).toHaveTextContent("barra más fina 0.25 mm");
    expect(aviso).toHaveTextContent("zona muda 2.5 mm");
    expect(aviso).toHaveTextContent("alto 10 mm");
  });

  it("si el código no cabe, avisa antes de imprimir el lote", async () => {
    /* Es el punto de medirlo: descubrirlo con el lector en la mano ya cuesta
       doscientas etiquetas. */
    medicionEtiqueta.mockResolvedValue({
      simbologia: "Code 128",
      ancho_modulo_mm: 0.12,
      quiet_zone_mm: 1.0,
      alto_barras_mm: 10,
      cabe: false,
      cumple_minimo: false,
    });

    render(<EtiquetaDialog activo={ACTIVO} onCerrar={vi.fn()} />);

    expect(
      await screen.findByText(/Use una etiqueta más ancha antes de imprimir/),
    ).toBeInTheDocument();
  });

  it("sin medición no se inventa un veredicto", async () => {
    medicionEtiqueta.mockRejectedValue(new Error("500"));

    render(<EtiquetaDialog activo={ACTIVO} onCerrar={vi.fn()} />);

    await screen.findByLabelText("Vista previa de la etiqueta GA-LAP-000007");
    expect(screen.queryByText(/pistola láser/)).not.toBeInTheDocument();
  });

  it("el PDF se descarga con el código en el nombre", async () => {
    render(<EtiquetaDialog activo={ACTIVO} onCerrar={vi.fn()} />);

    await screen.findByLabelText("Vista previa de la etiqueta GA-LAP-000007");
    fireEvent.click(screen.getByRole("button", { name: /Descargar PDF/ }));

    await waitFor(() =>
      expect(descargarEtiqueta).toHaveBeenCalledWith(7, "pdf"),
    );
  });

  it("la impresión térmica está a mano pero no estorba", async () => {
    render(<EtiquetaDialog activo={ACTIVO} onCerrar={vi.fn()} />);

    await screen.findByLabelText("Vista previa de la etiqueta GA-LAP-000007");
    expect(etiqueta).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: /Impresión térmica directa/ }),
    );

    await waitFor(() => expect(etiqueta).toHaveBeenCalledWith(7, "zpl"));
    expect(
      await screen.findByDisplayValue("^XA^FO50,50^BCN,80^FD..."),
    ).toBeInTheDocument();
  });

  it("cambiar de lenguaje pide el trabajo de esa impresora", async () => {
    render(<EtiquetaDialog activo={ACTIVO} onCerrar={vi.fn()} />);

    await screen.findByLabelText("Vista previa de la etiqueta GA-LAP-000007");
    fireEvent.click(
      screen.getByRole("button", { name: /Impresión térmica directa/ }),
    );
    await waitFor(() => expect(etiqueta).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Lenguaje de la impresora"), {
      target: { value: "tspl" },
    });

    await waitFor(() => expect(etiqueta).toHaveBeenLastCalledWith(7, "tspl"));
    // TSPL se descarga como .txt; ZPL, como .zpl.
    expect(
      await screen.findByRole("button", { name: "Descargar .txt" }),
    ).toBeInTheDocument();
  });

  it("copiar al portapapeles confirma que copió", async () => {
    const escribir = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: escribir },
    });

    render(<EtiquetaDialog activo={ACTIVO} onCerrar={vi.fn()} />);

    await screen.findByLabelText("Vista previa de la etiqueta GA-LAP-000007");
    fireEvent.click(
      screen.getByRole("button", { name: /Impresión térmica directa/ }),
    );
    await screen.findByDisplayValue("^XA^FO50,50^BCN,80^FD...");
    fireEvent.click(
      screen.getByRole("button", { name: "Copiar al portapapeles" }),
    );

    await waitFor(() =>
      expect(escribir).toHaveBeenCalledWith("^XA^FO50,50^BCN,80^FD..."),
    );
    expect(await screen.findByText("Copiado")).toBeInTheDocument();
  });

  it("si el navegador bloquea el portapapeles, dice qué hacer", async () => {
    /* Ocurre de verdad: contexto no seguro o permiso denegado. El texto sigue
       visible y seleccionable a mano. */
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.reject(new Error("denegado"))) },
    });

    render(<EtiquetaDialog activo={ACTIVO} onCerrar={vi.fn()} />);

    await screen.findByLabelText("Vista previa de la etiqueta GA-LAP-000007");
    fireEvent.click(
      screen.getByRole("button", { name: /Impresión térmica directa/ }),
    );
    await screen.findByDisplayValue("^XA^FO50,50^BCN,80^FD...");
    fireEvent.click(
      screen.getByRole("button", { name: "Copiar al portapapeles" }),
    );

    expect(
      await screen.findByText(/Copie el texto manualmente/),
    ).toBeInTheDocument();
  });

  it("si la etiqueta no se puede generar, lo dice en vez de un marco vacío", async () => {
    previsualizarPdf.mockRejectedValue(new Error("500"));

    render(<EtiquetaDialog activo={ACTIVO} onCerrar={vi.fn()} />);

    expect(
      await screen.findByText("No se pudo generar la etiqueta."),
    ).toBeInTheDocument();
  });

  it("al cerrar libera el PDF en memoria", async () => {
    /* Sin esto el blob queda retenido mientras viva la pestaña, y aquí se
       abre una etiqueta tras otra. */
    const { unmount } = render(
      <EtiquetaDialog activo={ACTIVO} onCerrar={vi.fn()} />,
    );

    await screen.findByLabelText("Vista previa de la etiqueta GA-LAP-000007");
    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:etiqueta");
  });
});
