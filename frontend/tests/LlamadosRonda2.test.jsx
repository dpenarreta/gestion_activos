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
 * US-013, ronda 2: correo pendiente y reenvío, revisión (jefe, persona sin
 * correo, descripción), avisos de éxito con el correo fallido, `nivel_esperado`
 * y su 409, adjunto como texto, foco y microajustes.
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

const servicio = {
  causas: vi.fn(),
  editarCausa: vi.fn(),
  crearCausa: vi.fn(),
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
  reenviarCorreo: vi.fn(),
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
  plazo_reincidencia_meses: 12,
  activa: true,
  niveles: NIVELES,
};
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
  puede: {},
};
const SOLICITADO = {
  ...FILA,
  id: 71,
  estado: "solicitado",
  solicitado_por: { id: 9, nombre: "Jefe Pérez" },
  puede: { confirmar: true, rechazar: true },
};
const PROPUESTA = { nivel_propuesto: 12, monto_sugerido: null, historial: [] };

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
  servicio.variables.mockResolvedValue([{ clave: "nombre" }]);
  servicio.vistaPrevia.mockResolvedValue({ texto: "Hola", desconocidas: [] });
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
});

async function abrirDetalle(nombreFila) {
  await screen.findAllByRole("button", { name: /^ver el/i });
  const fila = screen
    .getAllByRole("row")
    .find((f) => within(f).queryByText(nombreFila));
  fireEvent.click(within(fila).getByRole("button", { name: /^ver el/i }));
  return screen.findByRole("dialog");
}
const ultimoDialogo = async () => {
  const dialogos = await screen.findAllByRole("dialog");
  return dialogos[dialogos.length - 1];
};

async function abrirFormularioYElegir() {
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
    expect(within(dialogo).getByLabelText(/^nivel/i)).toHaveValue("12"),
  );
  return dialogo;
}
const escribir = (dialogo, texto = "Hecho de prueba.") =>
  fireEvent.change(within(dialogo).getByLabelText(/descripción del hecho/i), {
    target: { value: texto },
  });

async function llegarALaRevision(propuesta = {}) {
  servicio.propuesta.mockResolvedValue({ ...PROPUESTA, ...propuesta });
  pintar();
  const dialogo = await abrirFormularioYElegir();
  escribir(dialogo);
  fireEvent.click(
    within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
  );
  return screen.findByRole("dialog", { name: /revise antes de emitir/i });
}

describe("Correo del detalle", () => {
  it("pendiente: «está por enviarse» en alerta warn, no «no envía correo»", async () => {
    servicio.llamado.mockResolvedValue({
      ...FILA,
      correo: { estado: "pendiente" },
    });
    pintar();
    const detalle = await abrirDetalle("Emitido");
    const alerta = (
      await within(detalle).findByText(/el correo está por enviarse/i)
    ).closest(".mz-alert");
    expect(alerta).toHaveClass("mz-alert--warn");
    expect(within(detalle).queryByText(/no envía correo/i)).toBeNull();
  });

  it("reenvía con confirmación y dice cómo salió", async () => {
    servicio.llamado.mockResolvedValue({
      ...FILA,
      correo: { estado: "fallido" },
      puede: { reenviar: true },
    });
    servicio.reenviarCorreo.mockResolvedValue({
      ...FILA,
      correo: { estado: "enviado" },
    });
    pintar();
    const detalle = await abrirDetalle("Emitido");
    fireEvent.click(
      await within(detalle).findByRole("button", { name: "Reenviar correo" }),
    );
    const confirmacion = await ultimoDialogo();
    expect(servicio.reenviarCorreo).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirmacion).getByRole("button", { name: "Reenviar correo" }),
    );
    await waitFor(() =>
      expect(servicio.reenviarCorreo).toHaveBeenCalledWith("70"),
    );
    expect(await screen.findByText("El correo se reenvió.")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("sin `puede.reenviar` no hay botón", async () => {
    servicio.llamado.mockResolvedValue({
      ...FILA,
      correo: { estado: "fallido" },
    });
    pintar();
    const detalle = await abrirDetalle("Emitido");
    await within(detalle).findByText(/no se pudo enviar/i);
    expect(
      within(detalle).queryByRole("button", { name: /reenviar correo/i }),
    ).toBeNull();
  });
});

describe("Revisión", () => {
  it("copia al jefe por su nombre y nunca dice «con copia a —»", async () => {
    const revision = await llegarALaRevision({ jefe: { nombre: "Luis Vera" } });
    expect(
      within(revision).getByText(/se enviará un correo a/i),
    ).toHaveTextContent(/con copia a Luis Vera/);
    expect(within(revision).getByText("Hecho de prueba.")).toBeInTheDocument();
    expect(revision).not.toHaveTextContent("con copia a —");
  });

  it("sin jefe registrado lo dice en vez de inventar un nombre", async () => {
    const revision = await llegarALaRevision({ jefe: null });
    expect(
      within(revision).getByText(/se enviará un correo a/i),
    ).toHaveTextContent(/sin copia: no tiene un jefe registrado/i);
    expect(revision).not.toHaveTextContent("con copia a —");
  });

  it("persona sin correo: alerta warn y botón «Emitir sin correo»", async () => {
    const revision = await llegarALaRevision({ persona_tiene_correo: false });
    const alerta = within(revision)
      .getByText(/esta persona no tiene correo registrado/i)
      .closest(".mz-alert");
    expect(alerta).toHaveClass("mz-alert--warn");
    expect(alerta).toHaveTextContent(/notifíquela por otro medio/i);
    expect(
      within(revision).getByRole("button", { name: "Emitir sin correo" }),
    ).toBeInTheDocument();
    expect(within(revision).queryByText(/vista previa del correo/i)).toBeNull();
  });

  it.each([
    ["fallido", /el correo no se pudo enviar/i],
    ["sin_direccion", /no tiene correo registrado/i],
  ])(
    "tras emitir con el correo %s, el aviso es de advertencia",
    async (estado, texto) => {
      servicio.crear.mockResolvedValue({ id: 99, correo: { estado } });
      const revision = await llegarALaRevision();
      fireEvent.click(
        within(revision).getByRole("button", {
          name: "Emitir y enviar correo",
        }),
      );
      const aviso = (await screen.findByText(texto)).closest(".mz-alert");
      expect(aviso).toHaveClass("mz-alert--warn");
      expect(aviso).toHaveTextContent(/quedó emitido/i);
    },
  );

  it("un error de campo durante la revisión enfoca ese campo al volver", async () => {
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
    const revision = await llegarALaRevision();
    fireEvent.click(
      within(revision).getByRole("button", { name: "Emitir y enviar correo" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/descripción del hecho/i)).toHaveFocus(),
    );
  });
});

describe("Formulario", () => {
  it("el adjunto elegido se ve como texto con «Quitar», también al volver de la revisión", async () => {
    pintar();
    const dialogo = await abrirFormularioYElegir();
    const archivo = new File(["x"], "prueba.pdf", { type: "application/pdf" });
    fireEvent.change(within(dialogo).getByLabelText(/evidencia/i), {
      target: { files: [archivo] },
    });
    expect(within(dialogo).getAllByText(/prueba.pdf/).length).toBeGreaterThan(
      0,
    );
    escribir(dialogo);
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Revisar y emitir" }),
    );
    const revision = await screen.findByRole("dialog", {
      name: /revise antes de emitir/i,
    });
    fireEvent.click(within(revision).getByRole("button", { name: "Volver" }));
    const deNuevo = await screen.findByRole("dialog", {
      name: /emitir llamado de atención/i,
    });
    expect(within(deNuevo).getAllByText(/prueba.pdf/).length).toBeGreaterThan(
      0,
    );
    fireEvent.click(
      within(deNuevo).getByRole("button", { name: /quitar la evidencia/i }),
    );
    expect(within(deNuevo).getByLabelText(/evidencia/i)).toHaveAttribute(
      "type",
      "file",
    );
  });
});

describe("Lista", () => {
  it("con `ver` y sin `emitir`, el filtro de persona pide el modo «ver»", async () => {
    permisos.lista = ["llamados.ver"];
    pintar();
    await screen.findByRole("search", { name: /filtrar llamados/i });
    await waitFor(() =>
      expect(servicio.personas).toHaveBeenCalledWith("", "ver"),
    );
  });

  it("tras rechazar, el foco va al aviso de éxito", async () => {
    pintar();
    const detalle = await abrirDetalle("Solicitado");
    fireEvent.click(
      await within(detalle).findByRole("button", { name: /rechazar/i }),
    );
    const motivo = await ultimoDialogo();
    fireEvent.change(within(motivo).getByLabelText(/motivo del rechazo/i), {
      target: { value: "No procede." },
    });
    fireEvent.click(within(motivo).getByRole("button", { name: "Rechazar" }));
    const aviso = await screen.findByText(/quedó rechazada/i);
    await waitFor(() => expect(aviso.closest("[tabindex='-1']")).toHaveFocus());
  });
});

describe("Confirmar con `nivel_esperado`", () => {
  const VIGENTE = {
    ...SOLICITADO,
    propuesta_vigente: { nivel_propuesto: 12, historial: [] },
  };

  async function confirmarHastaLaRevision() {
    servicio.llamado.mockResolvedValue(VIGENTE);
    pintar();
    const detalle = await abrirDetalle("Solicitado");
    fireEvent.click(
      await within(detalle).findByRole("button", { name: /confirmar/i }),
    );
    const confirmar = await ultimoDialogo();
    fireEvent.click(
      within(confirmar).getByRole("button", { name: "Revisar y emitir" }),
    );
    return screen.findByRole("dialog", {
      name: /confirmar llamado a ana mora/i,
    });
  }

  it("ante un 409 vuelve a la revisión con el nivel nuevo y un aviso", async () => {
    servicio.confirmar.mockRejectedValueOnce({
      response: {
        status: 409,
        data: { error: { code: "propuesta_cambio", message: "Cambió." } },
      },
    });
    const revision = await confirmarHastaLaRevision();
    servicio.propuesta.mockResolvedValue({
      nivel_propuesto: 13,
      historial: [],
    });
    fireEvent.click(
      within(revision).getByRole("button", { name: "Emitir y enviar correo" }),
    );
    await waitFor(() =>
      expect(servicio.confirmar).toHaveBeenCalledWith(
        "71",
        expect.objectContaining({ nivel_esperado: 12 }),
      ),
    );
    const aviso = await screen.findByText(/el nivel vigente cambió/i);
    expect(aviso).toHaveTextContent(/sanción económica/i);
    const dialogo = screen.getByRole("dialog", {
      name: /confirmar llamado a ana mora/i,
    });
    const emitir = within(dialogo).getByRole("button", {
      name: "Emitir y enviar correo",
    });
    expect(emitir).toHaveClass("btn-danger");
    fireEvent.click(emitir);
    await waitFor(() =>
      expect(servicio.confirmar).toHaveBeenLastCalledWith(
        "71",
        expect.objectContaining({ nivel_esperado: 13, monto: "10.00" }),
      ),
    );
  });

  it("tras confirmar, un correo fallido da un aviso de advertencia", async () => {
    servicio.confirmar.mockResolvedValue({ correo: { estado: "fallido" } });
    const revision = await confirmarHastaLaRevision();
    fireEvent.click(
      within(revision).getByRole("button", { name: "Emitir y enviar correo" }),
    );
    const aviso = (
      await screen.findByText(/el correo no se pudo enviar/i)
    ).closest(".mz-alert");
    expect(aviso).toHaveClass("mz-alert--warn");
  });

  it("mientras carga el historial vigente lo dice y no deja confirmar", async () => {
    let resolver;
    servicio.propuesta.mockReturnValue(
      new Promise((r) => {
        resolver = r;
      }),
    );
    pintar();
    const detalle = await abrirDetalle("Solicitado");
    fireEvent.click(
      await within(detalle).findByRole("button", { name: /confirmar/i }),
    );
    const confirmar = await ultimoDialogo();
    expect(
      within(confirmar).getByText("Cargando el historial vigente…"),
    ).toHaveAttribute("role", "status");
    expect(
      within(confirmar).getByRole("button", { name: "Revisar y emitir" }),
    ).toBeDisabled();
    resolver({ ...PROPUESTA });
    await waitFor(() =>
      expect(
        within(confirmar).getByRole("button", { name: "Revisar y emitir" }),
      ).toBeEnabled(),
    );
  });
});

describe("Editor de causas", () => {
  it("al mover un nivel al extremo, el foco pasa al botón contrario", async () => {
    pintar("/?vista=causas");
    fireEvent.click(
      await screen.findByRole("button", { name: /editar la causa/i }),
    );
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialogo).getAllByRole("button", { name: /subir/i })[1],
    );
    // El nivel 12 quedó primero: su «Subir» está deshabilitado y el foco
    // pasó a su «Bajar», que sigue activo.
    const bajarDelPrimero = within(dialogo).getAllByRole("button", {
      name: /bajar/i,
    })[0];
    await waitFor(() => expect(bajarDelPrimero).toHaveFocus());
  });

  it("no avisa de variables desconocidas si no hay lista de variables", async () => {
    servicio.variables.mockResolvedValue([]);
    servicio.vistaPrevia.mockResolvedValue({
      texto: "Hola {foo}",
      desconocidas: ["foo"],
    });
    pintar("/?vista=causas");
    fireEvent.click(
      await screen.findByRole("button", { name: /nueva causa/i }),
    );
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialogo).getByRole("button", { name: /agregar nivel/i }),
    );
    fireEvent.click(within(dialogo).getByLabelText(/envía correo/i));
    fireEvent.change(within(dialogo).getByLabelText(/cuerpo del correo/i), {
      target: { value: "Hola {foo}" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: /ver vista previa/i }),
    );
    const previa = await within(dialogo).findByRole("region", {
      name: /vista previa/i,
    });
    await waitFor(() => expect(previa).toHaveTextContent("Hola {foo}"));
    expect(within(previa).queryByText(/variables desconocidas/i)).toBeNull();
  });
});
