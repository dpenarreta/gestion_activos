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
 * Solicitud de permisos: pedir un permiso viendo por qué pasos va a pasar,
 * aprobar / rechazar / escalar lo que a uno le toca, y configurar los flujos
 * (pasos, aprobadores y a quién se avisa el resultado).
 */

const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: permisos.lista } }),
}));

const servicio = {
  tipos: vi.fn(),
  solicitudes: vi.fn(),
  solicitud: vi.fn(),
  resumen: vi.fn(),
  solicitar: vi.fn(),
  aprobar: vi.fn(),
  rechazar: vi.fn(),
  cancelar: vi.fn(),
  escalar: vi.fn(),
  adjunto: vi.fn(),
  opciones: vi.fn(),
  flujos: vi.fn(),
  guardarFlujo: vi.fn(),
  eliminarFlujo: vi.fn(),
};
vi.mock("../src/api/licenciasService", () => ({ licenciasService: servicio }));

const { SolicitudPermisosPage } =
  await import("../src/pages/Institucional/SolicitudPermisosPage");
const { FlujosPermisoPage } =
  await import("../src/pages/Institucional/FlujosPermisoPage");

const VACACIONES = {
  id: 1,
  nombre: "Vacaciones",
  descripcion: "Días de descanso",
  adjunto: "no",
  pasos: [
    { nombre: "Jefatura", aprobadores: ["Su jefe inmediato (organigrama)"] },
    { nombre: "Talento Humano", aprobadores: ["Tatiana Torres"] },
  ],
};

const SOLICITUD = {
  id: 7,
  flujo: "Vacaciones",
  solicitante: { id: 3, nombre: "Ana Vera" },
  desde: "2026-11-02",
  hasta: "2026-11-06",
  dias: 5,
  motivo: "Viaje familiar",
  estado: "pendiente",
  estado_display: "Pendiente",
  paso_actual: "Jefatura",
  pendiente_de: [{ id: 4, nombre: "Julia Paz" }],
  tiene_adjunto: false,
  adjunto_nombre: "",
  created_at: "2026-10-19T15:00:00Z",
  cerrada_en: null,
};

const DETALLE = {
  ...SOLICITUD,
  acciones: [
    {
      id: 1,
      accion: "creada",
      accion_display: "Solicitó",
      actor: "Ana Vera",
      paso: "",
      comentario: "",
      detalle: "",
      created_at: "2026-10-19T15:00:00Z",
    },
    {
      id: 2,
      accion: "asignada",
      accion_display: "Pasó a",
      actor: "",
      paso: "Jefatura",
      comentario: "",
      detalle: "Julia Paz",
      created_at: "2026-10-19T15:00:00Z",
    },
  ],
  puedo: { resolver: true, escalar: true, cancelar: false },
};

const OPCIONES = {
  personas: [
    { id: 4, nombre: "Julia Paz" },
    { id: 9, nombre: "Tatiana Torres" },
  ],
  roles: [{ id: 2, nombre: "Talento Humano" }],
  cargos: [{ id: 5, nombre: "Gerente General · Gerencia General" }],
};

function pintar(elemento, ruta = "/") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>{elemento}</MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = [];
  servicio.solicitudes.mockResolvedValue([SOLICITUD]);
  servicio.resumen.mockResolvedValue({ por_aprobar: 1 });
  servicio.tipos.mockResolvedValue([VACACIONES]);
  servicio.solicitud.mockResolvedValue(DETALLE);
  servicio.opciones.mockResolvedValue(OPCIONES);
});

describe("Solicitud de permisos", () => {
  it("lista mis solicitudes y cuántas tengo por aprobar", async () => {
    pintar(<SolicitudPermisosPage />);
    expect(await screen.findByText("Vacaciones")).toBeInTheDocument();
    expect(screen.getByText("Jefatura · Julia Paz")).toBeInTheDocument();
    expect(screen.getByLabelText("1 por aprobar")).toBeInTheDocument();
    // Sin permisos: ni «Todas» ni configurar.
    expect(screen.queryByRole("tab", { name: "Todas" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Configurar flujos/ }),
    ).toBeNull();
  });

  it("pide un permiso viendo por qué pasos va a pasar", async () => {
    servicio.solicitar.mockResolvedValue(DETALLE);
    pintar(<SolicitudPermisosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Nueva solicitud de permiso",
    });
    expect(await within(ventana).findByText("Jefatura")).toBeInTheDocument();
    expect(within(ventana).getByText("Talento Humano")).toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText("Desde"), {
      target: { value: "2026-11-02" },
    });
    fireEvent.change(within(ventana).getByLabelText("Hasta"), {
      target: { value: "2026-11-06" },
    });
    fireEvent.change(within(ventana).getByLabelText("Motivo"), {
      target: { value: "Viaje familiar" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    await waitFor(() =>
      expect(servicio.solicitar).toHaveBeenCalledWith(
        {
          flujo: "1",
          desde: "2026-11-02",
          hasta: "2026-11-06",
          motivo: "Viaje familiar",
        },
        null,
      ),
    );
    expect(
      await screen.findByText(/queda pendiente de Julia Paz/),
    ).toBeInTheDocument();
  });

  it("el detalle (desde el aviso de la campana) muestra el historial y deja aprobar", async () => {
    servicio.aprobar.mockResolvedValue({
      ...DETALLE,
      paso_actual: "Talento Humano",
      puedo: { resolver: false, escalar: false, cancelar: false },
    });
    pintar(<SolicitudPermisosPage />, "/?solicitud=7");
    const ventana = await screen.findByRole("dialog", {
      name: "Solicitud de permiso",
    });
    expect(
      await within(ventana).findByText(/pasó a \(Jefatura\): Julia Paz/),
    ).toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText(/Comentario/), {
      target: { value: "De acuerdo" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Aprobar/ }));
    await waitFor(() =>
      expect(servicio.aprobar).toHaveBeenCalledWith("7", "De acuerdo"),
    );
  });

  it("escala a otra persona", async () => {
    servicio.escalar.mockResolvedValue(DETALLE);
    pintar(<SolicitudPermisosPage />, "/?solicitud=7");
    const ventana = await screen.findByRole("dialog", {
      name: "Solicitud de permiso",
    });
    fireEvent.click(
      await within(ventana).findByRole("button", { name: /^Escalar/ }),
    );
    const persona = await within(ventana).findByLabelText(
      "Escalar a: una persona",
    );
    await waitFor(() =>
      expect(within(persona).getByText("Tatiana Torres")).toBeInTheDocument(),
    );
    fireEvent.change(persona, { target: { value: "9" } });
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Confirmar escalamiento/ }),
    );
    await waitFor(() =>
      expect(servicio.escalar).toHaveBeenCalledWith(
        "7",
        { tipo: "persona", usuario: 9, rol: null, cargo: null },
        "",
      ),
    );
  });
});

describe("Configurar flujos", () => {
  it("crea un flujo con sus pasos y a quién se avisa", async () => {
    permisos.lista = ["licencias.configurar"];
    servicio.flujos.mockResolvedValue([]);
    servicio.guardarFlujo.mockResolvedValue({});
    pintar(<FlujosPermisoPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Nuevo tipo de permiso/ }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Nuevo tipo de permiso",
    });
    fireEvent.change(within(ventana).getByLabelText("Nombre del permiso"), {
      target: { value: "Permiso médico" },
    });
    // El primer paso trae al jefe inmediato; se suma Talento Humano como
    // alternativa (cualquiera de los dos aprueba).
    fireEvent.click(
      within(ventana).getAllByRole("button", { name: /Agregar$/ })[0],
    );
    await waitFor(() =>
      expect(
        within(ventana).getByLabelText("Aprobador del paso 1 2"),
      ).toBeInTheDocument(),
    );
    fireEvent.change(within(ventana).getByLabelText("Aprobador del paso 1 2"), {
      target: { value: "persona" },
    });
    await waitFor(() =>
      expect(
        within(ventana).getByLabelText("Aprobador del paso 1 2: una persona"),
      ).toBeInTheDocument(),
    );
    fireEvent.change(
      within(ventana).getByLabelText("Aprobador del paso 1 2: una persona"),
      { target: { value: "9" } },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar flujo" }),
    );

    await waitFor(() =>
      expect(servicio.guardarFlujo).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          nombre: "Permiso médico",
          pasos: [
            {
              nombre: "Jefatura",
              aprobadores: [
                {
                  tipo: "jefe_inmediato",
                  usuario: null,
                  rol: null,
                  cargo: null,
                },
                { tipo: "persona", usuario: 9, rol: null, cargo: null },
              ],
            },
          ],
          avisos_aprobada: [
            { tipo: "solicitante", usuario: null, rol: null, cargo: null },
          ],
        }),
      ),
    );
  });
});
