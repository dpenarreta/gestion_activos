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
 * US-033: la sanción en porcentaje del sueldo o monto fijo, la razón dentro
 * del reglamento (documento + artículo), el tope de la empresa y cómo se ven
 * en el detalle, la lista y «Mis llamados».
 */

const permisos = { lista: ["llamados.emitir", "llamados.configurar"] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: permisos.lista, full_name: "Gestora de GH" },
    isAuthenticated: true,
  }),
}));
vi.mock("../src/pages/Soporte/VisorAdjunto", () => ({
  useVisorDeAdjuntos: () => ({
    abrir: vi.fn(),
    abriendo: null,
    visor: null,
    error: null,
  }),
}));

const abrirDocumento = vi.fn();
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: { archivoDocumento: (id) => abrirDocumento(id) },
}));

const servicio = {
  causas: vi.fn(),
  crearCausa: vi.fn(),
  editarCausa: vi.fn(),
  variables: vi.fn(),
  vistaPrevia: vi.fn(),
  personas: vi.fn(),
  propuesta: vi.fn(),
  llamados: vi.fn(),
  llamado: vi.fn(),
  crear: vi.fn(),
  confirmar: vi.fn(),
  rechazar: vi.fn(),
  anular: vi.fn(),
  documentos: vi.fn(),
  configuracion: vi.fn(),
  guardarConfiguracion: vi.fn(),
  mios: vi.fn(),
};
vi.mock("../src/api/llamadosService", () => ({ llamadosService: servicio }));

const { LlamadosAtencion } =
  await import("../src/pages/GestionHumana/LlamadosAtencion/LlamadosAtencion");
const { MisLlamados } = await import("../src/pages/MisDatos/MisLlamados");

const NIVELES = [
  {
    id: 12,
    orden: 1,
    nombre: "Segundo llamado (escrito)",
    tipo: "escrito",
    envia_correo: false,
    activo: true,
  },
  {
    id: 13,
    orden: 2,
    nombre: "Sanción económica",
    tipo: "sancion_economica",
    monto_sugerido: null,
    porcentaje_sugerido: "5.00",
    forma_sugerida: "porcentaje",
    envia_correo: false,
    activo: true,
  },
];
const CAUSA = {
  id: 1,
  nombre: "Firma del rol de pagos",
  plazo_reincidencia_meses: 12,
  activa: true,
  niveles: NIVELES,
};
const DOCUMENTOS = [
  {
    id: 7,
    titulo: "Reglamento interno",
    categoria: "reglamento",
    categoria_display: "Reglamento",
    version: "2",
    es_pdf: true,
  },
];
const PROPUESTA = {
  nivel_propuesto: 13,
  forma_sugerida: "porcentaje",
  porcentaje_sugerido: "5.00",
  monto_sugerido: null,
  tope_porcentaje: "10.00",
  historial: [],
};
const FILA = {
  id: 70,
  numero: "LA-0070",
  persona: { id: 5, nombre: "Ana Mora" },
  causa: { id: 1, nombre: "Firma del rol de pagos" },
  nivel: { id: 13, nombre: "Sanción económica", tipo: "sancion_economica" },
  estado: "emitido",
  fecha_hecho: "2026-11-05",
  descripcion: "No firmó el rol.",
  monto: null,
  forma_sancion: "porcentaje",
  porcentaje: "5.00",
  monto_por_calcular: true,
  sancion_texto: "5 % del sueldo",
  documento: {
    id: 7,
    titulo: "Reglamento interno",
    es_pdf: true,
    disponible: true,
    url: "/organizacion/documentos/7/archivo/",
  },
  articulo: "Art. 45, lit. c",
  razon: "Reglamento interno, Art. 45, lit. c",
  puede: {},
};

function pintar(ruta = "/") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <LlamadosAtencion />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = ["llamados.emitir", "llamados.configurar"];
  servicio.causas.mockResolvedValue([CAUSA]);
  servicio.variables.mockResolvedValue([]);
  servicio.personas.mockResolvedValue([{ id: 5, nombre: "Ana Mora" }]);
  servicio.llamados.mockResolvedValue([FILA]);
  servicio.llamado.mockResolvedValue(FILA);
  servicio.propuesta.mockResolvedValue(PROPUESTA);
  servicio.documentos.mockResolvedValue(DOCUMENTOS);
  servicio.configuracion.mockResolvedValue({
    tope_porcentaje: "10.00",
    actualizado_por: { id: 1, nombre: "Talento Humano" },
    actualizado_en: "2026-11-18T10:00:00Z",
  });
  servicio.crear.mockResolvedValue({ id: 99 });
});

async function abrirEmitir() {
  fireEvent.click(
    await screen.findByRole("button", { name: /emitir llamado/i }),
  );
  const dialogo = await screen.findByRole("dialog");
  fireEvent.click(
    await within(dialogo).findByRole("radio", { name: /ana mora/i }),
  );
  fireEvent.change(within(dialogo).getByLabelText(/^fecha del hecho/i), {
    target: { value: "2026-11-05" },
  });
  fireEvent.change(within(dialogo).getByLabelText(/^causa/i), {
    target: { value: "1" },
  });
  await waitFor(() =>
    expect(within(dialogo).getByLabelText(/^nivel/i)).toHaveValue("13"),
  );
  fireEvent.change(within(dialogo).getByLabelText(/descripción del hecho/i), {
    target: { value: "Hecho." },
  });
  return dialogo;
}

const revisar = (d) =>
  fireEvent.click(within(d).getByRole("button", { name: "Revisar y emitir" }));

const emitirSinCorreo = async (nombre = /revise antes de emitir/i) => {
  const revision = await screen.findByRole("dialog", { name: nombre });
  fireEvent.click(
    within(revision).getByRole("button", { name: /emitir sin correo/i }),
  );
  return revision;
};

describe("Emitir con porcentaje y razón del reglamento", () => {
  it("parte del porcentaje sugerido, muestra el tope y manda forma, porcentaje, documento y artículo", async () => {
    pintar();
    const dialogo = await abrirEmitir();
    expect(
      within(dialogo).getByRole("radio", { name: /porcentaje del sueldo/i }),
    ).toBeChecked();
    const porcentaje = within(dialogo).getByLabelText(
      /porcentaje de la sanción \(%\)/i,
    );
    expect(porcentaje).toHaveValue("5.00");
    expect(
      within(dialogo).getByText(/tope de la empresa: 10 %/i),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText(/sueldo esté disponible en el sistema/i),
    ).toBeInTheDocument();
    expect(within(dialogo).queryByLabelText(/monto de la sanción/i)).toBeNull();

    fireEvent.change(
      await within(dialogo).findByLabelText(/documento del reglamento/i),
      { target: { value: "7" } },
    );
    fireEvent.change(within(dialogo).getByLabelText(/artículo o numeral/i), {
      target: { value: " Art. 45, lit. c " },
    });
    fireEvent.change(porcentaje, { target: { value: "7,5 %" } });
    revisar(dialogo);
    const revision = await screen.findByRole("dialog", {
      name: /revise antes de emitir/i,
    });
    expect(within(revision).getByText(/7,5 % del sueldo/)).toBeInTheDocument();
    expect(
      within(revision).getByText("Reglamento interno, Art. 45, lit. c"),
    ).toBeInTheDocument();
    await emitirSinCorreo();
    await waitFor(() => expect(servicio.crear).toHaveBeenCalled());
    const campos = servicio.crear.mock.calls[0][0];
    expect(campos).toMatchObject({
      nivel: "13",
      forma_sancion: "porcentaje",
      porcentaje: "7.5",
      documento: "7",
      articulo: "Art. 45, lit. c",
    });
    expect(campos).not.toHaveProperty("monto");
  });

  it("avisa antes de enviar si el porcentaje supera el tope y no deja continuar", async () => {
    pintar();
    const dialogo = await abrirEmitir();
    fireEvent.change(
      within(dialogo).getByLabelText(/porcentaje de la sanción \(%\)/i),
      { target: { value: "12" } },
    );
    expect(
      within(dialogo).getByText(
        /supera el tope de la empresa: 10 % del sueldo/i,
      ),
    ).toBeInTheDocument();
    revisar(dialogo);
    expect(
      await within(dialogo).findByText(/supera el tope de la empresa/i, {
        selector: ".mz-field-error",
      }),
    ).toBeInTheDocument();
    expect(servicio.crear).not.toHaveBeenCalled();
  });

  it("rechaza un porcentaje inválido junto al campo", async () => {
    pintar();
    const dialogo = await abrirEmitir();
    fireEvent.change(
      within(dialogo).getByLabelText(/porcentaje de la sanción \(%\)/i),
      { target: { value: "abc" } },
    );
    revisar(dialogo);
    expect(
      await within(dialogo).findByText(/mayor que 0 y hasta 100/i),
    ).toBeInTheDocument();
  });

  it("permite cambiar a monto fijo y manda solo el monto", async () => {
    pintar();
    const dialogo = await abrirEmitir();
    fireEvent.click(
      within(dialogo).getByRole("radio", { name: /monto fijo/i }),
    );
    fireEvent.change(within(dialogo).getByLabelText(/monto de la sanción/i), {
      target: { value: "25,5" },
    });
    revisar(dialogo);
    await emitirSinCorreo();
    await waitFor(() => expect(servicio.crear).toHaveBeenCalled());
    const campos = servicio.crear.mock.calls[0][0];
    expect(campos).toMatchObject({ forma_sancion: "monto", monto: "25.5" });
    expect(campos).not.toHaveProperty("porcentaje");
    expect(campos).not.toHaveProperty("documento");
  });

  it("el documento exige artículo y el artículo exige documento", async () => {
    pintar();
    const dialogo = await abrirEmitir();
    fireEvent.change(
      await within(dialogo).findByLabelText(/documento del reglamento/i),
      { target: { value: "7" } },
    );
    revisar(dialogo);
    expect(
      await within(dialogo).findByText(/indique el artículo o numeral/i),
    ).toBeInTheDocument();
    fireEvent.change(
      within(dialogo).getByLabelText(/documento del reglamento/i),
      { target: { value: "" } },
    );
    fireEvent.change(within(dialogo).getByLabelText(/artículo o numeral/i), {
      target: { value: "Art. 1" },
    });
    revisar(dialogo);
    expect(
      await within(dialogo).findByText(/elija el documento/i),
    ).toBeInTheDocument();
    expect(servicio.crear).not.toHaveBeenCalled();
  });

  it("pinta el error del servidor del porcentaje junto al campo", async () => {
    servicio.crear.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            code: "validation_error",
            message: "Datos inválidos",
            details: {
              porcentaje: [
                "El porcentaje supera el tope de la empresa: 4 % del sueldo.",
              ],
            },
          },
        },
      },
    });
    pintar();
    const dialogo = await abrirEmitir();
    revisar(dialogo);
    await emitirSinCorreo();
    expect(
      await screen.findByText(/tope de la empresa: 4 % del sueldo/i, {
        selector: ".mz-field-error",
      }),
    ).toBeInTheDocument();
  });
});

describe("Detalle y lista", () => {
  it("la lista dice monto por calcular y el detalle abre el documento en el visor", async () => {
    abrirDocumento.mockResolvedValue(
      new Blob(["x"], { type: "application/pdf" }),
    );
    pintar();
    const fila = (
      await screen.findByRole("button", { name: /ver el llamado a ana mora/i })
    ).closest("tr");
    expect(within(fila).getByText(/5 % del sueldo/)).toBeInTheDocument();
    expect(within(fila).getByText("por calcular")).toBeInTheDocument();
    fireEvent.click(
      within(fila).getByRole("button", { name: /ver el llamado a ana mora/i }),
    );
    const detalle = await screen.findByRole("dialog");
    expect(
      await within(detalle).findByText(/5 % del sueldo/),
    ).toBeInTheDocument();
    expect(
      within(detalle).getByText(/sueldo esté disponible en el sistema/i),
    ).toBeInTheDocument();
    const enlace = within(detalle).getByRole("button", {
      name: /reglamento interno/i,
    });
    expect(detalle).toHaveTextContent("Art. 45, lit. c");
    fireEvent.click(enlace);
    await waitFor(() => expect(abrirDocumento).toHaveBeenCalledWith(7));
  });

  it("si el documento ya no está disponible, solo el título y el artículo", async () => {
    servicio.llamado.mockResolvedValue({
      ...FILA,
      documento: { ...FILA.documento, disponible: false, url: null },
    });
    pintar();
    const fila = (
      await screen.findByRole("button", { name: /ver el llamado a ana mora/i })
    ).closest("tr");
    fireEvent.click(
      within(fila).getByRole("button", { name: /ver el llamado a ana mora/i }),
    );
    const detalle = await screen.findByRole("dialog");
    expect(
      await within(detalle).findByText(
        /Reglamento interno \(documento retirado\)/,
      ),
    ).toBeInTheDocument();
    expect(detalle).toHaveTextContent("Art. 45, lit. c");
    expect(
      within(detalle).queryByRole("button", { name: /reglamento interno/i }),
    ).toBeNull();
  });

  it("confirmar precarga la razón del jefe y la reenvía junto con la sanción", async () => {
    const solicitado = {
      ...FILA,
      id: 71,
      estado: "solicitado",
      forma_sancion: null,
      porcentaje: null,
      sancion_texto: "",
      puede: { confirmar: true },
      propuesta_vigente: { ...PROPUESTA, historial: [] },
    };
    servicio.llamados.mockResolvedValue([solicitado]);
    servicio.llamado.mockResolvedValue(solicitado);
    servicio.confirmar.mockResolvedValue({});
    pintar();
    const fila = (
      await screen.findByRole("button", { name: /ver el llamado a ana mora/i })
    ).closest("tr");
    fireEvent.click(
      within(fila).getByRole("button", { name: /ver el llamado a ana mora/i }),
    );
    const detalle = await screen.findByRole("dialog");
    fireEvent.click(
      await within(detalle).findByRole("button", { name: /confirmar/i }),
    );
    const dialogos = await screen.findAllByRole("dialog");
    const confirmar = dialogos[dialogos.length - 1];
    await waitFor(() =>
      expect(
        within(confirmar).getByLabelText(/documento del reglamento/i),
      ).toHaveValue("7"),
    );
    expect(within(confirmar).getByLabelText(/artículo o numeral/i)).toHaveValue(
      "Art. 45, lit. c",
    );
    expect(
      within(confirmar).getByLabelText(/porcentaje de la sanción \(%\)/i),
    ).toHaveValue("5.00");
    revisar(confirmar);
    await emitirSinCorreo(/confirmar llamado a/i);
    await waitFor(() =>
      expect(servicio.confirmar).toHaveBeenCalledWith("71", {
        descripcion: "No firmó el rol.",
        nivel_esperado: 13,
        forma_sancion: "porcentaje",
        porcentaje: "5.00",
        documento: "7",
        articulo: "Art. 45, lit. c",
      }),
    );
  });
});

describe("Causas y tope", () => {
  it("el nivel de sanción sugiere porcentaje o monto, no los dos", async () => {
    servicio.editarCausa.mockResolvedValue(CAUSA);
    pintar("/?vista=causas");
    fireEvent.click(
      await screen.findByRole("button", { name: /editar la causa/i }),
    );
    const dialogo = await screen.findByRole("dialog");
    expect(
      within(dialogo).getByRole("radio", { name: /porcentaje del sueldo/i }),
    ).toBeChecked();
    fireEvent.change(within(dialogo).getByLabelText(/porcentaje sugerido/i), {
      target: { value: "8,5" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(servicio.editarCausa).toHaveBeenCalled());
    const nivel = servicio.editarCausa.mock.calls[0][1].niveles[1];
    expect(nivel.porcentaje_sugerido).toBe("8.5");
    expect(nivel.monto_sugerido).toBeNull();
  });

  it("lee el tope y lo guarda; vacío significa sin tope", async () => {
    servicio.guardarConfiguracion.mockResolvedValue({
      tope_porcentaje: null,
      actualizado_por: null,
      actualizado_en: null,
    });
    pintar("/?vista=causas");
    const campo = await screen.findByLabelText(
      /tope de sanción en % del sueldo/i,
    );
    await waitFor(() => expect(campo).toHaveValue("10,00"));
    expect(screen.getByText(/la define gestión humana/i)).toBeInTheDocument();
    fireEvent.change(campo, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar tope/i }));
    await waitFor(() =>
      expect(servicio.guardarConfiguracion).toHaveBeenCalledWith(null),
    );
    expect(await screen.findByText(/quedó sin tope/i)).toBeInTheDocument();
  });

  it("muestra el error del servidor del tope junto al campo", async () => {
    servicio.guardarConfiguracion.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            code: "validation_error",
            message: "Datos inválidos",
            details: { tope_porcentaje: ["No puede pasar de 100."] },
          },
        },
      },
    });
    pintar("/?vista=causas");
    const campo = await screen.findByLabelText(
      /tope de sanción en % del sueldo/i,
    );
    await waitFor(() => expect(campo).toHaveValue("10,00"));
    fireEvent.click(screen.getByRole("button", { name: /guardar tope/i }));
    expect(
      await screen.findByText(/no puede pasar de 100/i),
    ).toBeInTheDocument();
  });

  it("si el tope no carga ofrece reintentar", async () => {
    servicio.configuracion.mockRejectedValue(new Error("falla"));
    pintar("/?vista=causas");
    expect(
      await screen.findByRole("button", { name: /reintentar/i }),
    ).toBeInTheDocument();
  });
});

describe("Mis llamados", () => {
  it("muestra el texto de la sanción y la razón con el documento", async () => {
    servicio.mios.mockResolvedValue([FILA]);
    render(
      <MemoryRouter>
        <MisLlamados />
      </MemoryRouter>,
    );
    expect(
      (await screen.findAllByText(/5 % del sueldo/)).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /reglamento interno/i }).length,
    ).toBeGreaterThan(0);
    expect(document.body).toHaveTextContent("Art. 45, lit. c");
  });
});

async function abrirDetalleDeAna() {
  const fila = (
    await screen.findByRole("button", { name: /ver el llamado a ana mora/i })
  ).closest("tr");
  fireEvent.click(
    within(fila).getByRole("button", { name: /ver el llamado a ana mora/i }),
  );
  return screen.findByRole("dialog");
}

describe("US-033, correcciones de auditoría", () => {
  it("al volver de la revisión conserva documento y artículo, y el artículo es obligatorio", async () => {
    pintar();
    const dialogo = await abrirEmitir();
    fireEvent.change(
      await within(dialogo).findByLabelText(/documento del reglamento/i),
      { target: { value: "7" } },
    );
    expect(
      within(dialogo).getByLabelText(/artículo o numeral/i),
    ).toHaveAttribute("aria-required", "true");
    fireEvent.change(within(dialogo).getByLabelText(/artículo o numeral/i), {
      target: { value: "Art. 45" },
    });
    revisar(dialogo);
    const revision = await screen.findByRole("dialog", {
      name: /revise antes de emitir/i,
    });
    fireEvent.click(within(revision).getByRole("button", { name: /volver/i }));
    const vuelto = await screen.findByRole("dialog", {
      name: /emitir llamado de atención/i,
    });
    expect(
      await within(vuelto).findByLabelText(/documento del reglamento/i),
    ).toHaveValue("7");
    expect(within(vuelto).getByLabelText(/artículo o numeral/i)).toHaveValue(
      "Art. 45",
    );
    expect(
      within(vuelto).getByLabelText(/artículo o numeral/i),
    ).toHaveAttribute("aria-required", "true");
  });

  it("el aviso del tope se asocia al porcentaje y no usa role status", async () => {
    pintar();
    const dialogo = await abrirEmitir();
    const campo = within(dialogo).getByLabelText(
      /porcentaje de la sanción \(%\)/i,
    );
    fireEvent.change(campo, { target: { value: "12" } });
    const aviso = within(dialogo)
      .getByText(/supera el tope de la empresa/i)
      .closest("[aria-live]");
    expect(aviso).toHaveAttribute("aria-live", "polite");
    expect(campo.getAttribute("aria-describedby")).toContain(aviso.id);
  });

  it("rechaza un porcentaje de cero", async () => {
    pintar();
    const dialogo = await abrirEmitir();
    fireEvent.change(
      within(dialogo).getByLabelText(/porcentaje de la sanción \(%\)/i),
      { target: { value: "0" } },
    );
    revisar(dialogo);
    expect(
      await within(dialogo).findByText(/mayor que 0 y hasta 100/i),
    ).toBeInTheDocument();
  });

  it("la vista previa del correo rellena sancion, porcentaje, documento y artículo", async () => {
    servicio.causas.mockResolvedValue([
      {
        ...CAUSA,
        niveles: NIVELES.map((n) =>
          n.id === 13
            ? {
                ...n,
                envia_correo: true,
                asunto: "Sanción",
                cuerpo: "S={sancion} P={porcentaje} D={documento} A={articulo}",
              }
            : n,
        ),
      },
    ]);
    pintar();
    const dialogo = await abrirEmitir();
    fireEvent.change(
      await within(dialogo).findByLabelText(/documento del reglamento/i),
      { target: { value: "7" } },
    );
    fireEvent.change(within(dialogo).getByLabelText(/artículo o numeral/i), {
      target: { value: "Art. 45" },
    });
    fireEvent.change(
      within(dialogo).getByLabelText(/porcentaje de la sanción \(%\)/i),
      { target: { value: "7,5" } },
    );
    revisar(dialogo);
    const revision = await screen.findByRole("dialog", {
      name: /revise antes de emitir/i,
    });
    expect(revision).toHaveTextContent(
      "S=7,5 % del sueldo P=7,5 D=Reglamento interno A=Art. 45",
    );
  });

  it("un documento que no es PDF se muestra sin enlace", async () => {
    servicio.llamado.mockResolvedValue({
      ...FILA,
      documento: { ...FILA.documento, es_pdf: false },
    });
    pintar();
    const detalle = await abrirDetalleDeAna();
    await within(detalle).findByText(/5 % del sueldo/);
    expect(detalle).toHaveTextContent("Reglamento interno, Art. 45, lit. c");
    expect(
      within(detalle).queryByRole("button", { name: /reglamento interno/i }),
    ).toBeNull();
  });

  it("un 403 por el acuerdo pendiente lo explica; otro 403 es genérico", async () => {
    abrirDocumento.mockRejectedValueOnce({
      response: {
        status: 403,
        data: { error: { code: "acuerdo_pendiente" } },
      },
    });
    pintar();
    const detalle = await abrirDetalleDeAna();
    fireEvent.click(
      await within(detalle).findByRole("button", {
        name: /reglamento interno/i,
      }),
    );
    expect(
      await within(detalle).findByText(/acuerdo de confidencialidad/i),
    ).toBeInTheDocument();
    abrirDocumento.mockRejectedValueOnce({
      response: { status: 403, data: { error: { code: "otra" } } },
    });
    fireEvent.click(
      within(detalle).getByRole("button", { name: /reglamento interno/i }),
    );
    expect(
      await within(detalle).findByText(/no puede abrir este documento/i),
    ).toBeInTheDocument();
  });

  it("en Causas avisa si el porcentaje sugerido supera el tope", async () => {
    pintar("/?vista=causas");
    fireEvent.click(
      await screen.findByRole("button", { name: /editar la causa/i }),
    );
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText(/porcentaje sugerido/i), {
      target: { value: "15" },
    });
    expect(
      within(dialogo).getByText(
        /supera el tope de la empresa: 10 % del sueldo/i,
      ),
    ).toBeInTheDocument();
  });
});
