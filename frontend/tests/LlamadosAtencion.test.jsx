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
 * US-013: la pantalla «Llamados de atención». La lista y sus filtros, emitir
 * (propuesta, cambio con justificación, monto solo en la sanción, revisión
 * antes de emitir), solicitar (jefe), confirmar con la propuesta vigente,
 * rechazar, anular, el correo según su estado, los enlaces de los avisos y el
 * editor de causas con variables y vista previa.
 */

const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: permisos.lista, full_name: "Gestora de GH" },
    isAuthenticated: true,
  }),
}));

const visorAbrir = vi.fn();
vi.mock("../src/pages/Soporte/VisorAdjunto", () => ({
  useVisorDeAdjuntos: () => ({
    abrir: visorAbrir,
    abriendo: null,
    visor: null,
    error: null,
  }),
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
};
vi.mock("../src/api/llamadosService", () => ({ llamadosService: servicio }));

const { LlamadosAtencion } =
  await import("../src/pages/GestionHumana/LlamadosAtencion/LlamadosAtencion");

const NIVELES = [
  {
    id: 11,
    orden: 1,
    nombre: "Primer llamado (verbal)",
    tipo: "verbal",
    envia_correo: false,
    activo: true,
  },
  {
    id: 12,
    orden: 2,
    nombre: "Segundo llamado (escrito)",
    tipo: "escrito",
    envia_correo: true,
    copia_jefe: true,
    asunto: "Llamado a {nombre}",
    cuerpo: "Estimado {nombre}: {descripcion}",
    activo: true,
  },
  {
    id: 13,
    orden: 3,
    nombre: "Sanción económica",
    tipo: "sancion_economica",
    monto_sugerido: "10.00",
    envia_correo: true,
    asunto: "Sanción",
    cuerpo: "Monto {monto}",
    activo: true,
  },
];
const CAUSA = {
  id: 1,
  nombre: "Firma del rol de pagos",
  descripcion: "Rol sin firmar",
  plazo_reincidencia_meses: 12,
  activa: true,
  niveles: NIVELES,
};
const VARIABLES = [
  { clave: "nombre", descripcion: "Nombre de la persona" },
  { clave: "descripcion", descripcion: "Descripción del hecho" },
  { clave: "monto", descripcion: "Monto" },
];
const FILA = {
  id: 70,
  numero: "LA-0070",
  persona: { id: 5, nombre: "Ana Mora" },
  causa: { id: 1, nombre: "Firma del rol de pagos" },
  nivel: { id: 12, nombre: "Segundo llamado (escrito)", tipo: "escrito" },
  nivel_propuesto: { id: 12 },
  estado: "emitido",
  fecha_hecho: "2026-11-05",
  descripcion: "No firmó el rol.",
  monto: null,
  puede: { anular: true },
};
const SOLICITADO = {
  ...FILA,
  id: 71,
  estado: "solicitado",
  solicitado_por: { id: 9, nombre: "Jefe Pérez" },
  puede: { confirmar: true, rechazar: true },
};
const PROPUESTA = {
  nivel_propuesto: 12,
  monto_sugerido: null,
  historial: [
    {
      id: 1,
      fecha_hecho: "2026-09-01",
      nivel: { nombre: "Primer llamado (verbal)" },
      estado: "emitido",
    },
  ],
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
  servicio.variables.mockResolvedValue(VARIABLES);
  servicio.vistaPrevia.mockResolvedValue({
    texto: "Hola María, atención.",
    html: "<p>Hola</p>",
    desconocidas: [],
  });
  servicio.personas.mockResolvedValue([{ id: 5, nombre: "Ana Mora" }]);
  servicio.llamados.mockImplementation((filtros = {}) =>
    Promise.resolve(
      filtros.estado === "solicitado" ? [SOLICITADO] : [FILA, SOLICITADO],
    ),
  );
  servicio.propuesta.mockResolvedValue(PROPUESTA);
  servicio.llamado.mockImplementation((id) =>
    Promise.resolve(Number(id) === 71 ? SOLICITADO : FILA),
  );
  servicio.crear.mockResolvedValue({ id: 99 });
  servicio.confirmar.mockResolvedValue({});
  servicio.rechazar.mockResolvedValue({});
  servicio.anular.mockResolvedValue({});
});

/** Abre «Emitir llamado», elige persona, fecha y causa y espera la propuesta. */
async function abrirFormularioYElegir({ fecha = "2026-11-05" } = {}) {
  fireEvent.click(
    await screen.findByRole("button", { name: /emitir llamado/i }),
  );
  const dialogo = await screen.findByRole("dialog");
  fireEvent.click(
    await within(dialogo).findByRole("radio", { name: /ana mora/i }),
  );
  fireEvent.change(within(dialogo).getByLabelText(/^fecha del hecho/i), {
    target: { value: fecha },
  });
  fireEvent.change(within(dialogo).getByLabelText(/^causa/i), {
    target: { value: "1" },
  });
  await waitFor(() =>
    expect(servicio.propuesta).toHaveBeenCalledWith(5, "1", {
      fechaHecho: fecha,
      modo: "emitir",
    }),
  );
  await waitFor(() =>
    expect(within(dialogo).getByLabelText(/^nivel/i)).toHaveValue("12"),
  );
  return dialogo;
}

const escribirDescripcion = (dialogo, texto = "No firmó.") =>
  fireEvent.change(within(dialogo).getByLabelText(/descripción del hecho/i), {
    target: { value: texto },
  });

describe("Lista de llamados", () => {
  it("muestra los llamados con su número y filtra por estado y fechas", async () => {
    pintar();
    const tabla = await screen.findByRole("table", {
      name: /llamados de atención/i,
    });
    expect(await within(tabla).findAllByText("Ana Mora")).toHaveLength(2);
    expect(within(tabla).getAllByText("LA-0070")).toHaveLength(2);
    expect(within(tabla).getByText("Emitido")).toBeInTheDocument();
    expect(within(tabla).getByText("Solicitado")).toBeInTheDocument();
    // Con «emitir», quién solicitó se ve en las solicitadas.
    expect(
      within(tabla).getByRole("columnheader", { name: "Solicitado por" }),
    ).toBeInTheDocument();
    expect(within(tabla).getByText("Jefe Pérez")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), {
      target: { value: "emitido" },
    });
    await waitFor(() =>
      expect(servicio.llamados).toHaveBeenLastCalledWith(
        expect.objectContaining({ estado: "emitido" }),
      ),
    );
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-11-01" },
    });
    await waitFor(() =>
      expect(servicio.llamados).toHaveBeenLastCalledWith(
        expect.objectContaining({ estado: "emitido", desde: "2026-11-01" }),
      ),
    );
  });

  it("filtra por persona (buscador), causa y nivel", async () => {
    pintar();
    const filtros = await screen.findByRole("search", {
      name: /filtrar llamados/i,
    });
    fireEvent.click(
      await within(filtros).findByRole("radio", { name: /ana mora/i }),
    );
    fireEvent.change(screen.getByLabelText("Filtrar por causa"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Filtrar por nivel"), {
      target: { value: "12" },
    });
    await waitFor(() =>
      expect(servicio.llamados).toHaveBeenLastCalledWith(
        expect.objectContaining({ persona: 5, causa: "1", nivel: "12" }),
      ),
    );
  });

  it("avisa cuántas solicitudes esperan revisión y «Ver» las filtra", async () => {
    pintar();
    expect(
      await screen.findByText("1 solicitud espera su revisión."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /^ver las solicitudes/i }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Filtrar por estado")).toHaveValue(
        "solicitado",
      ),
    );
  });

  it("sin llamados, invita a emitir el primero", async () => {
    servicio.llamados.mockResolvedValue([]);
    pintar();
    expect(
      await screen.findByText(/aún no hay llamados de atención/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /emitir el primero/i }),
    ).toHaveLength(1);
  });

  it("sin causas activas lo explica y lleva a Causas, sin botón deshabilitado", async () => {
    servicio.causas.mockResolvedValue([{ ...CAUSA, activa: false }]);
    pintar();
    expect(
      await screen.findByText(/no hay causas activas/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /configure una causa/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /emitir llamado/i }),
    ).toBeNull();
  });

  it("con filtros sin resultados ofrece limpiarlos", async () => {
    servicio.llamados.mockResolvedValue([]);
    pintar();
    await screen.findByText(/aún no hay llamados/i);
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), {
      target: { value: "anulado" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /limpiar filtros/i }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Filtrar por estado")).toHaveValue(""),
    );
  });

  it("si falla, dice el error y reintenta", async () => {
    servicio.llamados.mockRejectedValueOnce({
      response: { data: { error: { message: "Servidor caído." } } },
    });
    pintar();
    expect(await screen.findByText("Servidor caído.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    const tabla = await screen.findByRole("table", {
      name: /llamados de atención/i,
    });
    expect(await within(tabla).findAllByText("Ana Mora")).toHaveLength(2);
  });

  it("con solo «configurar» abre en Causas", async () => {
    permisos.lista = ["llamados.configurar"];
    pintar();
    expect(
      await screen.findByText("Firma del rol de pagos"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^llamados/i })).toBeNull();
    expect(servicio.llamados).not.toHaveBeenCalled();
  });

  it("?llamado=<id> abre el detalle al cargar", async () => {
    pintar("/?llamado=70");
    const dialogo = await screen.findByRole("dialog");
    expect(
      await within(dialogo).findByText(/llamado de atención n\.º la-0070/i),
    ).toBeInTheDocument();
    expect(servicio.llamado).toHaveBeenCalledWith("70");
  });
});

describe("Emitir", () => {
  it("calcula con la fecha del hecho, revisa y emite con el nivel propuesto", async () => {
    pintar();
    const dialogo = await abrirFormularioYElegir();
    expect(
      within(dialogo).getByRole("heading", {
        name: /historial de la persona en esta causa/i,
      }),
    ).toBeVisible();
    expect(within(dialogo).getByText(/últimos 12 meses/i)).toBeInTheDocument();
    expect(
      within(dialogo).queryByLabelText(/justificación del cambio/i),
    ).toBeNull();
    expect(within(dialogo).queryByLabelText(/monto/i)).toBeNull();
    expect(servicio.personas).toHaveBeenCalledWith("", "emitir");

    escribirDescripcion(dialogo);
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
    );
    // El paso de revisión: nada se envía todavía.
    const revision = await screen.findByRole("dialog", {
      name: /revise antes de emitir/i,
    });
    expect(servicio.crear).not.toHaveBeenCalled();
    expect(within(revision).getAllByText("Ana Mora").length).toBeGreaterThan(0);
    expect(
      within(revision).getByText(/segundo llamado \(escrito\) \(escrito\)/i),
    ).toBeInTheDocument();
    expect(
      within(revision).getByText(/se enviará un correo a/i),
    ).toHaveTextContent(/con copia a su jefe inmediato/i);
    // La vista previa usa los datos reales.
    expect(
      within(revision).getByText(/estimado ana: no firmó\./i),
    ).toBeInTheDocument();
    const emitir = within(revision).getByRole("button", {
      name: "Emitir y enviar correo",
    });
    expect(emitir).toHaveClass("btn-primary");
    fireEvent.click(emitir);

    await waitFor(() => expect(servicio.crear).toHaveBeenCalled());
    const [campos, adjunto] = servicio.crear.mock.calls[0];
    expect(campos).toMatchObject({
      persona: 5,
      causa: "1",
      nivel: "12",
      fecha_hecho: "2026-11-05",
      descripcion: "No firmó.",
    });
    expect(campos).not.toHaveProperty("justificacion_cambio");
    expect(campos).not.toHaveProperty("monto");
    expect(adjunto).toBeNull();
    expect(await screen.findByText(/quedó emitido/i)).toBeInTheDocument();
  });

  it("«Volver» de la revisión conserva lo escrito", async () => {
    pintar();
    const dialogo = await abrirFormularioYElegir();
    escribirDescripcion(dialogo, "Texto conservado.");
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
    );
    const revision = await screen.findByRole("dialog", {
      name: /revise antes de emitir/i,
    });
    fireEvent.click(within(revision).getByRole("button", { name: "Volver" }));
    const de_nuevo = await screen.findByRole("dialog", {
      name: /emitir llamado de atención/i,
    });
    expect(
      within(de_nuevo).getByLabelText(/descripción del hecho/i),
    ).toHaveValue("Texto conservado.");
    expect(servicio.crear).not.toHaveBeenCalled();
  });

  it("un nivel sin correo se emite «sin correo» y dice que solo queda registrado", async () => {
    pintar();
    const dialogo = await abrirFormularioYElegir();
    fireEvent.change(within(dialogo).getByLabelText(/^nivel/i), {
      target: { value: "11" },
    });
    fireEvent.change(
      within(dialogo).getByLabelText(/justificación del cambio/i),
      { target: { value: "Primera falta leve." } },
    );
    escribirDescripcion(dialogo);
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
    );
    const revision = await screen.findByRole("dialog", {
      name: /revise antes de emitir/i,
    });
    expect(
      within(revision).getByText(/no envía correo; solo queda registrado/i),
    ).toBeInTheDocument();
    fireEvent.click(
      within(revision).getByRole("button", { name: "Emitir sin correo" }),
    );
    await waitFor(() => expect(servicio.crear).toHaveBeenCalled());
    expect(servicio.crear.mock.calls[0][0]).toMatchObject({
      nivel: "11",
      justificacion_cambio: "Primera falta leve.",
    });
  });

  it("cambiar el nivel exige justificación", async () => {
    pintar();
    const dialogo = await abrirFormularioYElegir();
    fireEvent.change(within(dialogo).getByLabelText(/^nivel/i), {
      target: { value: "11" },
    });
    escribirDescripcion(dialogo, "Hecho.");
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
    );
    expect(
      await within(dialogo).findByText(/justifique por qué cambia/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /revise antes/i })).toBeNull();
  });

  it("la sanción lleva el monto (parte del sugerido) y el botón final es rojo", async () => {
    pintar();
    const dialogo = await abrirFormularioYElegir();
    expect(within(dialogo).queryByLabelText(/monto/i)).toBeNull();
    fireEvent.change(within(dialogo).getByLabelText(/^nivel/i), {
      target: { value: "13" },
    });
    expect(within(dialogo).getByLabelText(/monto de la sanción/i)).toHaveValue(
      "10.00",
    );
    fireEvent.change(
      within(dialogo).getByLabelText(/justificación del cambio/i),
      { target: { value: "Reincidente." } },
    );
    escribirDescripcion(dialogo, "Hecho.");
    fireEvent.change(within(dialogo).getByLabelText(/monto de la sanción/i), {
      target: { value: "abc" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
    );
    expect(
      await within(dialogo).findByText(/monto válido/i),
    ).toBeInTheDocument();

    fireEvent.change(within(dialogo).getByLabelText(/monto de la sanción/i), {
      target: { value: "12,5" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
    );
    const revision = await screen.findByRole("dialog", {
      name: /revise antes de emitir/i,
    });
    expect(within(revision).getAllByText(/12,50/).length).toBeGreaterThan(0);
    const emitir = within(revision).getByRole("button", {
      name: "Emitir y enviar correo",
    });
    expect(emitir).toHaveClass("btn-danger");
    fireEvent.click(emitir);
    await waitFor(() => expect(servicio.crear).toHaveBeenCalled());
    expect(servicio.crear.mock.calls[0][0]).toMatchObject({
      nivel: "13",
      monto: "12.5",
    });
  });

  it("mientras calcula lo dice, deshabilita el nivel y no deja continuar", async () => {
    let resolver;
    servicio.propuesta.mockReturnValue(
      new Promise((r) => {
        resolver = r;
      }),
    );
    pintar();
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
    expect(
      await within(dialogo).findByText("Calculando el nivel propuesto…"),
    ).toHaveAttribute("role", "status");
    expect(within(dialogo).getByLabelText(/^nivel/i)).toBeDisabled();
    expect(
      within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
    ).toBeDisabled();
    resolver(PROPUESTA);
    await waitFor(() =>
      expect(within(dialogo).getByLabelText(/^nivel/i)).toBeEnabled(),
    );
  });

  it("si el cálculo falla, bloquea emitir hasta que el reintento sale bien", async () => {
    servicio.propuesta.mockRejectedValueOnce({
      response: {
        data: { error: { message: "Sin conexión con el cálculo." } },
      },
    });
    pintar();
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
    expect(
      await within(dialogo).findByText(/sin conexión con el cálculo/i),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
    ).toBeDisabled();
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Reintentar" }),
    );
    await waitFor(() =>
      expect(
        within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
      ).toBeEnabled(),
    );
    expect(within(dialogo).getByLabelText(/^nivel/i)).toHaveValue("12");
  });

  it("recalcula al cambiar la fecha sin pisar el nivel que la persona eligió", async () => {
    pintar();
    const dialogo = await abrirFormularioYElegir();
    fireEvent.change(within(dialogo).getByLabelText(/^nivel/i), {
      target: { value: "11" },
    });
    servicio.propuesta.mockResolvedValue({ ...PROPUESTA, nivel_propuesto: 13 });
    fireEvent.change(within(dialogo).getByLabelText(/^fecha del hecho/i), {
      target: { value: "2026-11-06" },
    });
    await waitFor(() =>
      expect(servicio.propuesta).toHaveBeenLastCalledWith(5, "1", {
        fechaHecho: "2026-11-06",
        modo: "emitir",
      }),
    );
    expect(
      await within(dialogo).findByText(/la propuesta cambió a/i),
    ).toBeInTheDocument();
    expect(within(dialogo).getByLabelText(/^nivel/i)).toHaveValue("11");
  });

  it("sin haber elegido nivel, la propuesta recalculada sí lo reemplaza", async () => {
    pintar();
    const dialogo = await abrirFormularioYElegir();
    servicio.propuesta.mockResolvedValue({ ...PROPUESTA, nivel_propuesto: 13 });
    fireEvent.change(within(dialogo).getByLabelText(/^fecha del hecho/i), {
      target: { value: "2026-11-06" },
    });
    await waitFor(() =>
      expect(within(dialogo).getByLabelText(/^nivel/i)).toHaveValue("13"),
    );
  });

  it("la fecha del hecho empieza vacía y es obligatoria", async () => {
    pintar();
    fireEvent.click(
      await screen.findByRole("button", { name: /emitir llamado/i }),
    );
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByLabelText(/^fecha del hecho/i)).toHaveValue("");
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
    );
    expect(
      await within(dialogo).findByText(/indique la fecha del hecho/i),
    ).toBeInTheDocument();
  });

  it("muestra el error del servidor junto al campo y vuelve al formulario", async () => {
    servicio.crear.mockRejectedValue({
      response: {
        data: {
          error: {
            message: "Error en la solicitud.",
            details: { descripcion: ["Es demasiado corta."] },
          },
        },
      },
    });
    pintar();
    const dialogo = await abrirFormularioYElegir();
    escribirDescripcion(dialogo, "x");
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
    );
    const revision = await screen.findByRole("dialog", {
      name: /revise antes de emitir/i,
    });
    fireEvent.click(
      within(revision).getByRole("button", { name: "Emitir y enviar correo" }),
    );
    expect(await screen.findByText("Es demasiado corta.")).toBeInTheDocument();
    const formulario = screen.getByRole("dialog", {
      name: /emitir llamado de atención/i,
    });
    expect(
      within(formulario).getByLabelText(/descripción del hecho/i),
    ).toHaveAttribute("aria-invalid", "true");
  });
});

describe("Solicitar (jefe)", () => {
  beforeEach(() => {
    permisos.lista = ["llamados.solicitar"];
    servicio.llamados.mockResolvedValue([SOLICITADO]);
    servicio.propuesta.mockResolvedValue({ ...PROPUESTA, historial: [] });
  });

  it("ve «Solicitar llamado de atención», sin «Causas» ni «Emitir», y solo lo suyo", async () => {
    pintar();
    expect(
      await screen.findByRole("button", {
        name: /solicitar llamado de atención/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /emitir llamado/i }),
    ).toBeNull();
    expect(screen.queryByRole("tab", { name: /causas/i })).toBeNull();
    expect(
      screen.getByText(/los llamados que usted solicitó/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/esperan su revisión/i)).toBeNull();
    expect(
      screen.queryByRole("columnheader", { name: "Solicitado por" }),
    ).toBeNull();
    expect(servicio.variables).not.toHaveBeenCalled();
  });

  it("solicita sin nivel, monto ni historial, con el nivel solo como orientativo", async () => {
    pintar();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /solicitar llamado de atención/i,
      }),
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
      expect(servicio.propuesta).toHaveBeenCalledWith(5, "1", {
        fechaHecho: "2026-11-05",
        modo: "solicitar",
      }),
    );
    expect(servicio.personas).toHaveBeenCalledWith("", "solicitar");
    expect(
      await within(dialogo).findByText(
        /gestión humana revisará el historial y decidirá el nivel/i,
      ),
    ).toHaveTextContent(/orientativo/i);
    expect(within(dialogo).queryByText(/historial de la persona/i)).toBeNull();
    expect(within(dialogo).queryByLabelText(/^nivel/i)).toBeNull();

    escribirDescripcion(dialogo);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Solicitar" }));
    await waitFor(() => expect(servicio.crear).toHaveBeenCalled());
    const campos = servicio.crear.mock.calls[0][0];
    expect(campos).toMatchObject({ persona: 5, causa: "1" });
    expect(campos).not.toHaveProperty("nivel");
    expect(campos).not.toHaveProperty("monto");
    expect(
      await screen.findByText(/gestión humana la revisará/i),
    ).toBeInTheDocument();
  });

  it("no ve las acciones de Gestión Humana: dependen de `puede`", async () => {
    servicio.llamados.mockResolvedValue([{ ...SOLICITADO, puede: {} }]);
    servicio.llamado.mockResolvedValue({ ...SOLICITADO, puede: {} });
    pintar();
    fireEvent.click(await screen.findByRole("button", { name: /^ver/i }));
    const dialogo = await screen.findByRole("dialog");
    await within(dialogo).findByText("Jefe Pérez");
    expect(
      within(dialogo).queryByRole("button", { name: /confirmar/i }),
    ).toBeNull();
    expect(
      within(dialogo).queryByRole("button", { name: /rechazar/i }),
    ).toBeNull();
  });
});

describe("Detalle, confirmar, rechazar y anular", () => {
  async function abrirDetalle(nombreFila) {
    await screen.findAllByRole("button", { name: /^ver/i });
    const fila = screen
      .getAllByRole("row")
      .find((f) => within(f).queryByText(nombreFila));
    fireEvent.click(within(fila).getByRole("button", { name: /^ver/i }));
    return screen.findByRole("dialog");
  }
  const ultimoDialogo = async () => {
    const dialogos = await screen.findAllByRole("dialog");
    return dialogos[dialogos.length - 1];
  };

  it("las acciones salen de `puede`, no de los permisos", async () => {
    servicio.llamado.mockResolvedValue({ ...FILA, puede: {} });
    pintar();
    const detalle = await abrirDetalle("Emitido");
    await within(detalle).findByText(/descripción/i);
    expect(
      within(detalle).queryByRole("button", { name: /anular/i }),
    ).toBeNull();
  });

  it("confirma un solicitado con la propuesta vigente: sin cambio no envía el nivel", async () => {
    // Dos solicitudes de la misma persona y causa: al pedirse la segunda se
    // proponía el 12, pero tras confirmar la primera, lo vigente es la sanción.
    servicio.llamado.mockResolvedValue({
      ...SOLICITADO,
      nivel_propuesto: { id: 12 },
      propuesta_vigente: {
        nivel_propuesto: 13,
        historial: [
          {
            id: 1,
            fecha_hecho: "2026-10-01",
            nivel: { nombre: "Segundo llamado (escrito)" },
            estado: "emitido",
          },
        ],
      },
    });
    pintar();
    const detalle = await abrirDetalle("Solicitado");
    fireEvent.click(
      await within(detalle).findByRole("button", { name: /confirmar/i }),
    );
    const confirmar = await ultimoDialogo();
    expect(
      within(confirmar).getByRole("heading", {
        name: "Confirmar llamado a Ana Mora",
      }),
    ).toBeInTheDocument();
    expect(
      within(confirmar).getByText(/historial de la persona/i),
    ).toBeInTheDocument();
    expect(within(confirmar).getByLabelText(/^nivel/i)).toHaveValue("13");
    expect(
      within(confirmar).getByLabelText(/monto de la sanción/i),
    ).toHaveValue("10.00");
    fireEvent.click(
      within(confirmar).getByRole("button", { name: "Revisar y emitir" }),
    );
    const revision = await screen.findByRole("dialog", {
      name: /confirmar llamado a ana mora/i,
    });
    fireEvent.click(
      within(revision).getByRole("button", { name: "Emitir y enviar correo" }),
    );
    await waitFor(() =>
      expect(servicio.confirmar).toHaveBeenCalledWith("71", {
        descripcion: "No firmó el rol.",
        nivel_esperado: 13,
        monto: "10.00",
      }),
    );
    // El detalle se cierra y la lista dice que quedó emitido.
    expect(await screen.findByText(/quedó emitido/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cambiar el nivel vigente exige justificación y sí envía el nivel", async () => {
    servicio.llamado.mockResolvedValue({
      ...SOLICITADO,
      propuesta_vigente: { nivel_propuesto: 13, historial: [] },
    });
    pintar();
    const detalle = await abrirDetalle("Solicitado");
    fireEvent.click(
      await within(detalle).findByRole("button", { name: /confirmar/i }),
    );
    const confirmar = await ultimoDialogo();
    fireEvent.change(within(confirmar).getByLabelText(/^nivel/i), {
      target: { value: "11" },
    });
    fireEvent.click(
      within(confirmar).getByRole("button", { name: "Revisar y emitir" }),
    );
    expect(
      await within(confirmar).findByText(/justifique el cambio/i),
    ).toBeInTheDocument();
    fireEvent.change(
      within(confirmar).getByLabelText(/justificación del cambio/i),
      { target: { value: "Falta leve." } },
    );
    fireEvent.click(
      within(confirmar).getByRole("button", { name: "Revisar y emitir" }),
    );
    const revision = await screen.findByRole("dialog", {
      name: /confirmar llamado a ana mora/i,
    });
    expect(
      within(revision).getByRole("button", { name: "Emitir sin correo" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(revision).getByRole("button", { name: "Emitir sin correo" }),
    );
    await waitFor(() =>
      expect(servicio.confirmar).toHaveBeenCalledWith("71", {
        nivel: "11",
        nivel_esperado: 13,
        descripcion: "No firmó el rol.",
        justificacion_cambio: "Falta leve.",
      }),
    );
  });

  it("pinta el error de la justificación aunque el campo esté oculto", async () => {
    servicio.llamado.mockResolvedValue({
      ...SOLICITADO,
      propuesta_vigente: { nivel_propuesto: 12, historial: [] },
    });
    servicio.confirmar.mockRejectedValue({
      response: {
        data: {
          error: {
            message: "Error en la solicitud.",
            details: {
              justificacion_cambio: ["La propuesta cambió: justifique."],
            },
          },
        },
      },
    });
    pintar();
    const detalle = await abrirDetalle("Solicitado");
    fireEvent.click(
      await within(detalle).findByRole("button", { name: /confirmar/i }),
    );
    const confirmar = await ultimoDialogo();
    fireEvent.click(
      within(confirmar).getByRole("button", { name: "Revisar y emitir" }),
    );
    const revision = await screen.findByRole("dialog", {
      name: /confirmar llamado a ana mora/i,
    });
    fireEvent.click(
      within(revision).getByRole("button", { name: "Emitir y enviar correo" }),
    );
    expect(
      await screen.findByText("La propuesta cambió: justifique."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/justificación del cambio/i)).toBeNull();
  });

  it("rechaza con motivo obligatorio", async () => {
    pintar();
    const detalle = await abrirDetalle("Solicitado");
    fireEvent.click(
      await within(detalle).findByRole("button", { name: /rechazar/i }),
    );
    const motivo = await ultimoDialogo();
    fireEvent.click(within(motivo).getByRole("button", { name: "Rechazar" }));
    expect(
      await within(motivo).findByText(/indique el motivo/i),
    ).toBeInTheDocument();
    expect(servicio.rechazar).not.toHaveBeenCalled();
    fireEvent.change(within(motivo).getByLabelText(/motivo del rechazo/i), {
      target: { value: "No procede." },
    });
    fireEvent.click(within(motivo).getByRole("button", { name: "Rechazar" }));
    await waitFor(() =>
      expect(servicio.rechazar).toHaveBeenCalledWith("71", "No procede."),
    );
    expect(await screen.findByText(/quedó rechazada/i)).toBeInTheDocument();
  });

  it("anula con motivo y avisa si se notificará a la persona", async () => {
    servicio.llamado.mockResolvedValue({
      ...FILA,
      notificado_en: "2026-11-06T10:00:00Z",
    });
    pintar();
    const detalle = await abrirDetalle("Emitido");
    fireEvent.click(
      await within(detalle).findByRole("button", { name: /anular/i }),
    );
    const motivo = await ultimoDialogo();
    expect(
      within(motivo).getByText(/se avisará a la persona de la anulación/i),
    ).toBeInTheDocument();
    fireEvent.change(within(motivo).getByLabelText(/motivo de la anulación/i), {
      target: { value: "Error de captura." },
    });
    fireEvent.click(
      within(motivo).getByRole("button", { name: "Anular llamado" }),
    );
    await waitFor(() =>
      expect(servicio.anular).toHaveBeenCalledWith("70", "Error de captura."),
    );
  });

  it("si nunca se notificó, la anulación lo dice", async () => {
    servicio.llamado.mockResolvedValue({ ...FILA, notificado_en: null });
    pintar();
    const detalle = await abrirDetalle("Emitido");
    fireEvent.click(
      await within(detalle).findByRole("button", { name: /anular/i }),
    );
    const motivo = await ultimoDialogo();
    expect(
      within(motivo).getByText(/no se avisará a la persona/i),
    ).toBeInTheDocument();
  });

  it("el correo enviado muestra fecha, para y copia, y su cuerpo es texto", async () => {
    servicio.llamado.mockResolvedValue({
      ...FILA,
      historial: [
        {
          id: 1,
          accion: "emitido",
          accion_display: "Emitió el llamado",
          detalle: "con correo",
          usuario: "Gestión Humana",
          fecha: "2026-11-06T10:00:00Z",
        },
      ],
      correo: {
        enviado: true,
        estado: "enviado",
        estado_display: "Enviado",
        fecha: "2026-11-06T10:00:00Z",
        asunto: "Llamado a Ana",
        cuerpo: "<b>No</b> se interpreta",
        para: ["Ana Mora"],
        copia: ["Jefe Pérez"],
      },
    });
    pintar();
    const detalle = await abrirDetalle("Emitido");
    expect(
      await within(detalle).findByText("Llamado a Ana"),
    ).toBeInTheDocument();
    expect(within(detalle).getByText(/para:/i).parentElement).toHaveTextContent(
      "Ana Mora",
    );
    expect(
      within(detalle).getByText(/con copia a:/i).parentElement,
    ).toHaveTextContent("Jefe Pérez");
    expect(
      within(detalle).getByText("<b>No</b> se interpreta"),
    ).toBeInTheDocument();
    expect(detalle.querySelector("b")).toBeNull();
    expect(within(detalle).getByText(/emitió el llamado/i)).toHaveTextContent(
      /con correo/,
    );
  });

  it.each([
    ["fallido", "mz-alert--bad", /no se pudo enviar.*otro medio/i],
    ["sin_direccion", "mz-alert--warn", /no tiene un correo registrado/i],
  ])("correo %s: alerta con su tono", async (estado, clase, texto) => {
    servicio.llamado.mockResolvedValue({ ...FILA, correo: { estado } });
    pintar();
    const detalle = await abrirDetalle("Emitido");
    const alerta = (await within(detalle).findByText(texto)).closest(
      ".mz-alert",
    );
    expect(alerta).toHaveClass(clase);
  });

  it("en un solicitado, el correo «se enviará al confirmar»", async () => {
    servicio.llamado.mockResolvedValue({
      ...SOLICITADO,
      correo: { estado: "no_aplica" },
    });
    pintar();
    const detalle = await abrirDetalle("Solicitado");
    expect(
      await within(detalle).findByText(/se enviará al confirmar/i),
    ).toBeInTheDocument();
  });

  it("rotula el motivo del rechazo con quién y cuándo, y abre la evidencia", async () => {
    servicio.llamado.mockResolvedValue({
      ...SOLICITADO,
      estado: "rechazado",
      puede: {},
      motivo: "No procede.",
      rechazado_por: { id: 3, nombre: "Gestora" },
      rechazado_en: "2026-11-07T09:00:00Z",
      adjunto: {
        nombre: "evidencia.pdf",
        tipo: "pdf",
        visor: true,
        url: "/api/v1/llamados/llamados/71/adjunto/",
      },
    });
    pintar();
    const detalle = await abrirDetalle("Solicitado");
    expect(
      await within(detalle).findByText("Motivo del rechazo"),
    ).toBeInTheDocument();
    expect(within(detalle).getByText("No procede.")).toBeInTheDocument();
    expect(within(detalle).getByText(/Gestora · /)).toBeInTheDocument();
    fireEvent.click(
      within(detalle).getByRole("button", { name: /ver evidencia/i }),
    );
    expect(visorAbrir).toHaveBeenCalledWith(
      expect.objectContaining({
        nombre: "evidencia.pdf",
        url: "/api/v1/llamados/llamados/71/adjunto/",
      }),
    );
  });
});

describe("Causas y niveles", () => {
  it("la pestaña solo existe con «configurar» y lista las causas", async () => {
    pintar("/?vista=causas");
    expect(
      await screen.findByText("Firma del rol de pagos"),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /causas/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("12 meses")).toBeInTheDocument();
  });

  it("sin «configurar», ?vista=causas cae en la lista", async () => {
    permisos.lista = ["llamados.emitir"];
    pintar("/?vista=causas");
    expect(
      await screen.findByRole("table", { name: /llamados de atención/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /causas/i })).toBeNull();
  });

  async function abrirNuevaCausaConNivel() {
    pintar("/?vista=causas");
    fireEvent.click(
      await screen.findByRole("button", { name: /nueva causa/i }),
    );
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText(/^nombre/i), {
      target: { value: "Uso del uniforme" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: /agregar nivel/i }),
    );
    fireEvent.change(within(dialogo).getByLabelText(/nombre del nivel/i), {
      target: { value: "Primer aviso" },
    });
    return dialogo;
  }

  it("crea una causa, inserta variables según el conmutador y muestra la vista previa del servidor", async () => {
    servicio.crearCausa.mockResolvedValue({ ...CAUSA, id: 2 });
    pintar("/?vista=causas");
    fireEvent.click(
      await screen.findByRole("button", { name: /nueva causa/i }),
    );
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText(/^nombre/i), {
      target: { value: "Uso del uniforme" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    expect(
      await within(dialogo).findByText(/agregue al menos un nivel/i),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialogo).getByRole("button", { name: /agregar nivel/i }),
    );
    fireEvent.change(within(dialogo).getByLabelText(/nombre del nivel/i), {
      target: { value: "Primer aviso" },
    });
    fireEvent.click(within(dialogo).getByLabelText(/envía correo/i));

    const asunto = within(dialogo).getByLabelText(/asunto del correo/i);
    const cuerpo = within(dialogo).getByLabelText(/cuerpo del correo/i);
    // Las descripciones de las variables están a la vista.
    expect(
      within(dialogo).getByText(/nombre de la persona/i),
    ).toBeInTheDocument();
    fireEvent.change(cuerpo, { target: { value: "Hola , atención." } });
    cuerpo.focus();
    cuerpo.setSelectionRange(5, 5);
    fireEvent.click(within(dialogo).getByRole("button", { name: "{nombre}" }));
    expect(cuerpo).toHaveValue("Hola {nombre}, atención.");

    // El conmutador «Insertar variable en» manda la variable al asunto.
    fireEvent.click(within(dialogo).getByRole("radio", { name: "Asunto" }));
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "{descripcion}" }),
    );
    expect(asunto).toHaveValue("{descripcion}");

    fireEvent.click(
      within(dialogo).getByRole("button", { name: /ver vista previa/i }),
    );
    const previa = await within(dialogo).findByRole("region", {
      name: /vista previa/i,
    });
    await waitFor(() =>
      expect(previa).toHaveTextContent("Hola María, atención."),
    );
    expect(servicio.vistaPrevia).toHaveBeenLastCalledWith(
      "{descripcion}",
      "Hola {nombre}, atención.",
    );

    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(servicio.crearCausa).toHaveBeenCalled());
    const enviado = servicio.crearCausa.mock.calls[0][0];
    expect(enviado).toMatchObject({
      nombre: "Uso del uniforme",
      plazo_reincidencia_meses: 12,
      activa: true,
    });
    expect(enviado.niveles).toEqual([
      expect.objectContaining({
        orden: 1,
        nombre: "Primer aviso",
        tipo: "escrito",
        envia_correo: true,
        monto_sugerido: null,
        asunto: "{descripcion}",
        cuerpo: "Hola {nombre}, atención.",
      }),
    ]);
  });

  it("la vista previa avisa de las variables desconocidas y no interpreta HTML", async () => {
    servicio.vistaPrevia.mockResolvedValue({
      texto: "<img src=x onerror=alert(1)> {foo}",
      html: "<img src=x onerror=alert(1)>",
      desconocidas: ["foo"],
    });
    const dialogo = await abrirNuevaCausaConNivel();
    fireEvent.click(within(dialogo).getByLabelText(/envía correo/i));
    fireEvent.change(within(dialogo).getByLabelText(/cuerpo del correo/i), {
      target: { value: "<img src=x onerror=alert(1)> {foo}" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: /ver vista previa/i }),
    );
    const previa = await within(dialogo).findByRole("region", {
      name: /vista previa/i,
    });
    expect(
      await within(previa).findByText(/variables desconocidas/i),
    ).toHaveTextContent("{foo}");
    expect(previa.querySelector("img")).toBeNull();
    expect(previa).toHaveTextContent("<img src=x onerror=alert(1)>");
  });

  it("si el servidor no calcula la vista previa, usa el cálculo local con las secciones", async () => {
    servicio.vistaPrevia.mockRejectedValue(new Error("sin red"));
    const dialogo = await abrirNuevaCausaConNivel();
    fireEvent.click(within(dialogo).getByLabelText(/envía correo/i));
    fireEvent.change(within(dialogo).getByLabelText(/cuerpo del correo/i), {
      target: { value: "Hola {nombre}.{{#monto}} Monto {monto}.{{/monto}}" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: /ver vista previa/i }),
    );
    const previa = await within(dialogo).findByRole("region", {
      name: /vista previa/i,
    });
    await waitFor(() =>
      expect(previa).toHaveTextContent("Hola María. Monto $ 10,00."),
    );
    expect(previa).toHaveTextContent(/calculada en su equipo/i);
  });

  it("desactivar «envía correo» no borra el asunto ni el cuerpo", async () => {
    servicio.crearCausa.mockResolvedValue({ ...CAUSA, id: 2 });
    const dialogo = await abrirNuevaCausaConNivel();
    const correo = within(dialogo).getByLabelText(/envía correo/i);
    fireEvent.click(correo);
    fireEvent.change(within(dialogo).getByLabelText(/asunto del correo/i), {
      target: { value: "Asunto guardado" },
    });
    fireEvent.change(within(dialogo).getByLabelText(/cuerpo del correo/i), {
      target: { value: "Cuerpo guardado" },
    });
    fireEvent.click(correo);
    fireEvent.click(correo);
    expect(within(dialogo).getByLabelText(/asunto del correo/i)).toHaveValue(
      "Asunto guardado",
    );
    fireEvent.click(correo);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(servicio.crearCausa).toHaveBeenCalled());
    expect(servicio.crearCausa.mock.calls[0][0].niveles[0]).toMatchObject({
      envia_correo: false,
      asunto: "Asunto guardado",
      cuerpo: "Cuerpo guardado",
    });
  });

  it("anuncia el movimiento de un nivel y, al quitar, el foco no se pierde", async () => {
    servicio.causas.mockResolvedValue([CAUSA]);
    pintar("/?vista=causas");
    fireEvent.click(
      await screen.findByRole("button", { name: /editar la causa/i }),
    );
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialogo).getAllByRole("button", { name: /bajar/i })[0],
    );
    expect(
      within(dialogo).getByText(/ahora es el número 2 de 3/i),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialogo).getAllByRole("button", { name: /quitar/i })[0],
    );
    await waitFor(() =>
      expect(
        within(dialogo).getByRole("heading", {
          name: /niveles, en orden de escalamiento/i,
        }),
      ).toHaveFocus(),
    );
  });

  it("con un nivel en uso el orden se congela, el nivel no se quita y el monto sugerido va solo en la sanción", async () => {
    servicio.causas.mockResolvedValue([
      {
        ...CAUSA,
        niveles: NIVELES.map((n) => (n.id === 11 ? { ...n, en_uso: true } : n)),
      },
    ]);
    servicio.editarCausa.mockResolvedValue(CAUSA);
    pintar("/?vista=causas");
    fireEvent.click(
      await screen.findByRole("button", { name: /editar la causa/i }),
    );
    const dialogo = await screen.findByRole("dialog");

    expect(
      within(dialogo).getAllByRole("button", { name: /quitar/i }),
    ).toHaveLength(2);
    expect(within(dialogo).getAllByLabelText(/monto sugerido/i)).toHaveLength(
      1,
    );
    for (const boton of within(dialogo).getAllByRole("button", {
      name: /subir|bajar/i,
    })) {
      expect(boton).toBeDisabled();
    }
    expect(
      within(dialogo).getByText(/el orden no se puede cambiar/i),
    ).toBeInTheDocument();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(servicio.editarCausa).toHaveBeenCalled());
    const [id, cuerpo] = servicio.editarCausa.mock.calls[0];
    expect(id).toBe(1);
    expect(cuerpo.niveles.map((n) => [n.id, n.orden])).toEqual([
      [11, 1],
      [12, 2],
      [13, 3],
    ]);
    expect(cuerpo.niveles[2].monto_sugerido).toBe("10.00");
    expect(await screen.findByText(/quedó actualizada/i)).toBeInTheDocument();
  });

  it("sin niveles en uso, reordena y envía el nuevo orden", async () => {
    servicio.editarCausa.mockResolvedValue(CAUSA);
    pintar("/?vista=causas");
    fireEvent.click(
      await screen.findByRole("button", { name: /editar la causa/i }),
    );
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialogo).getAllByRole("button", { name: /bajar/i })[0],
    );
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(servicio.editarCausa).toHaveBeenCalled());
    expect(
      servicio.editarCausa.mock.calls[0][1].niveles.map((n) => [n.id, n.orden]),
    ).toEqual([
      [12, 1],
      [11, 2],
      [13, 3],
    ]);
  });
});
