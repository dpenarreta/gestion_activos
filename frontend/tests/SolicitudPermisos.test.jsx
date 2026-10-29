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
  evaluar: vi.fn(),
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
    { id: 3, nombre: "Ana Vera" },
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
  servicio.evaluar.mockResolvedValue({ reglas: [], bloquea: false });
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
    // La cuenta va dentro de la pestaña y se lee «1 por aprobar».
    expect(
      screen.getByRole("tab", { name: /Por aprobar\s*1\s*por aprobar/ }),
    ).toBeInTheDocument();
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
    fireEvent.change(within(ventana).getByLabelText(/^Desde/), {
      target: { value: "2026-11-02" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Hasta/), {
      target: { value: "2026-11-06" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Motivo/), {
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

  it("el calendario y los campos Desde y Hasta muestran lo mismo", async () => {
    pintar(<SolicitudPermisosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Nueva solicitud de permiso",
    });
    await within(ventana).findByText("Jefatura");

    // Escribir las fechas las marca en el calendario (y lo lleva a ese mes).
    fireEvent.change(within(ventana).getByLabelText(/^Desde/), {
      target: { value: "2026-12-07" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Hasta/), {
      target: { value: "2026-12-09" },
    });
    const marcados = () =>
      within(ventana)
        .getAllByRole("gridcell")
        .filter((c) => c.getAttribute("aria-selected") === "true")
        .map((c) => c.textContent);
    expect(within(ventana).getByText(/diciembre de 2026/i)).toBeInTheDocument();
    expect(marcados()).toEqual(["7", "8", "9"]);
    expect(within(ventana).getByText("3 días en total")).toBeInTheDocument();

    // Elegir en el calendario llena los campos: primer clic el inicio,
    // segundo el fin.
    fireEvent.click(
      within(ventana).getByRole("gridcell", {
        name: "14 de diciembre de 2026",
      }),
    );
    expect(within(ventana).getByLabelText(/^Desde/)).toHaveValue("2026-12-14");
    expect(within(ventana).getByLabelText(/^Hasta/)).toHaveValue("2026-12-14");
    fireEvent.click(
      within(ventana).getByRole("gridcell", {
        name: "18 de diciembre de 2026",
      }),
    );
    expect(within(ventana).getByLabelText(/^Hasta/)).toHaveValue("2026-12-18");
    expect(marcados()).toEqual(["14", "15", "16", "17", "18"]);
    expect(within(ventana).getByText("5 días en total")).toBeInTheDocument();
  });

  it("debajo de los días muestra las restricciones y no deja enviar si falla una", async () => {
    servicio.evaluar.mockResolvedValue({
      bloquea: true,
      reglas: [
        {
          clave: "minimo",
          estado: "falla",
          texto: "Mínimo 5 días seguidos por solicitud.",
          detalle: "Ha elegido 3 días.",
        },
        {
          clave: "fines-1",
          estado: "aviso",
          texto:
            "De cada período anual deben salir al menos 2 sábados y 2 domingos.",
          detalle: "Período 2024 – 2025, con esta solicitud: 0 de 2 sábados.",
        },
      ],
    });
    pintar(<SolicitudPermisosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Nueva solicitud de permiso",
    });
    await within(ventana).findByText("Jefatura");
    fireEvent.change(within(ventana).getByLabelText(/^Desde/), {
      target: { value: "2026-11-02" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Hasta/), {
      target: { value: "2026-11-04" },
    });
    const restricciones = await within(ventana).findByRole("region", {
      name: "Restricciones de este permiso",
    });
    expect(servicio.evaluar).toHaveBeenLastCalledWith(
      "1",
      "2026-11-02",
      "2026-11-04",
    );
    expect(
      within(restricciones).getByText("Mínimo 5 días seguidos por solicitud."),
    ).toBeInTheDocument();
    expect(
      within(restricciones).getByText("Ha elegido 3 días."),
    ).toBeInTheDocument();
    expect(
      within(restricciones).getByText(/0 de 2 sábados/),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    ).toBeDisabled();
  });

  it("sin rol asignado no deja hacer solicitudes y explica por qué", async () => {
    servicio.resumen.mockResolvedValue({
      por_aprobar: 0,
      puede_solicitar: false,
    });
    pintar(<SolicitudPermisosPage />);
    expect(
      await screen.findByText(/Su cuenta no tiene un rol asignado/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Nueva solicitud/ }),
    ).toBeDisabled();
  });

  it("un tipo que no pide motivo (vacaciones) no muestra el campo", async () => {
    servicio.tipos.mockResolvedValue([{ ...VACACIONES, pide_motivo: false }]);
    pintar(<SolicitudPermisosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Nueva solicitud de permiso",
    });
    await within(ventana).findByText("Jefatura");
    expect(within(ventana).queryByLabelText("Motivo")).toBeNull();
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
      await within(ventana).findByText(/Pasó al paso «Jefatura»/),
    ).toBeInTheDocument();
    // El título dice qué y de quién; arriba, que le toca decidir.
    expect(ventana).toHaveAccessibleName("Vacaciones · Ana Vera");
    expect(
      within(ventana).getByText("Le toca decidir a usted"),
    ).toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText(/Comentario/), {
      target: { value: "De acuerdo" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Aprobar/ }));
    // Aprobar se confirma, con lo que se aprueba y el comentario.
    const pregunta = await screen.findByRole("dialog", { name: /¿Aprobar/ });
    expect(pregunta).toHaveTextContent(/vacaciones de Ana Vera/);
    expect(pregunta).toHaveTextContent(/«De acuerdo»/);
    fireEvent.click(within(pregunta).getByRole("button", { name: "Aprobar" }));
    await waitFor(() =>
      expect(servicio.aprobar).toHaveBeenCalledWith("7", "De acuerdo"),
    );
    expect(
      await within(ventana).findByText(/Aprobada\. Ahora le toca a/),
    ).toBeInTheDocument();
  });

  it("rechazar pide un motivo de al menos 10 caracteres y lo confirma", async () => {
    servicio.rechazar.mockResolvedValue({
      ...DETALLE,
      estado: "rechazada",
      puedo: { resolver: false, escalar: false, cancelar: false },
    });
    pintar(<SolicitudPermisosPage />, "/?solicitud=7");
    const ventana = await screen.findByRole("dialog", {
      name: "Vacaciones · Ana Vera",
    });
    const comentario = within(ventana).getByLabelText(/Comentario/);
    fireEvent.change(comentario, { target: { value: "no" } });
    fireEvent.click(within(ventana).getByRole("button", { name: /Rechazar/ }));
    expect(
      within(ventana).getByText(/explique el motivo \(al menos 10/),
    ).toBeInTheDocument();
    expect(comentario).toHaveFocus();
    expect(servicio.rechazar).not.toHaveBeenCalled();

    fireEvent.change(comentario, {
      target: { value: "Ya hay dos personas fuera esa semana" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Rechazar/ }));
    const pregunta = await screen.findByRole("dialog", { name: /¿Rechazar/ });
    fireEvent.click(within(pregunta).getByRole("button", { name: "Rechazar" }));
    await waitFor(() =>
      expect(servicio.rechazar).toHaveBeenCalledWith(
        "7",
        "Ya hay dos personas fuera esa semana",
      ),
    );
  });

  it("escalar: sin destino no se confirma, se puede volver y oculta aprobar", async () => {
    pintar(<SolicitudPermisosPage />, "/?solicitud=7");
    const ventana = await screen.findByRole("dialog", {
      name: "Vacaciones · Ana Vera",
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /^Escalar/ }));
    expect(
      within(ventana).getByRole("button", { name: /Confirmar escalamiento/ }),
    ).toBeDisabled();
    expect(
      within(ventana).queryByRole("button", { name: /Aprobar/ }),
    ).toBeNull();
    // Ni la solicitante (id 3) aparece como destino.
    const persona = await within(ventana).findByLabelText(
      "Escalar a: una persona",
    );
    await waitFor(() =>
      expect(within(persona).getByText("Tatiana Torres")).toBeInTheDocument(),
    );
    expect(within(persona).queryByText("Ana Vera")).toBeNull();
    fireEvent.click(within(ventana).getByRole("button", { name: "Volver" }));
    expect(
      within(ventana).getByRole("button", { name: /Aprobar/ }),
    ).toBeInTheDocument();
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

/*
 * Cargando, error y pestañas (auditoría UX/UI, fase 2, 28/10/2026): la tabla
 * decía nada mientras cargaba, al cambiar de pestaña pintaba las filas viejas
 * con las columnas corridas y un error viejo quedaba a la vista.
 */
describe("Solicitud de permisos: cargando, error y pestañas", () => {
  it("muestra «Cargando…» en la tabla mientras llega la lista", async () => {
    let entregar;
    servicio.solicitudes.mockReturnValue(
      new Promise((resolver) => {
        entregar = resolver;
      }),
    );
    pintar(<SolicitudPermisosPage />);
    const tabla = screen.getByRole("table");
    expect(within(tabla).getByRole("status")).toHaveTextContent("Cargando…");
    entregar([SOLICITUD]);
    expect(await within(tabla).findByText("Vacaciones")).toBeInTheDocument();
    expect(within(tabla).queryByRole("status")).toBeNull();
  });

  it("un error se muestra en la tabla y «Reintentar» vuelve a pedir y lo borra", async () => {
    servicio.solicitudes.mockRejectedValueOnce({
      response: {
        data: { error: { message: "Sin conexión con el servidor." } },
      },
    });
    pintar(<SolicitudPermisosPage />);
    const tabla = screen.getByRole("table");
    expect(await within(tabla).findByRole("alert")).toHaveTextContent(
      "Sin conexión con el servidor.",
    );
    fireEvent.click(within(tabla).getByRole("button", { name: "Reintentar" }));
    expect(await within(tabla).findByText("Vacaciones")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(servicio.solicitudes).toHaveBeenCalledTimes(2);
  });

  it("al cambiar de pestaña no deja las filas viejas mientras carga", async () => {
    pintar(<SolicitudPermisosPage />);
    const tabla = screen.getByRole("table");
    expect(await within(tabla).findByText("Vacaciones")).toBeInTheDocument();
    servicio.solicitudes.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole("tab", { name: /Por aprobar/ }));
    expect(within(tabla).queryByText("Vacaciones")).toBeNull();
    expect(within(tabla).getByRole("status")).toHaveTextContent("Cargando…");
    expect(servicio.solicitudes).toHaveBeenLastCalledWith("por_aprobar");
  });

  it("las pestañas se recorren con las flechas y controlan su panel", async () => {
    pintar(<SolicitudPermisosPage />);
    await screen.findByText("Vacaciones");
    const mias = screen.getByRole("tab", { name: "Mis solicitudes" });
    expect(mias).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      mias.id,
    );
    fireEvent.keyDown(mias, { key: "ArrowRight" });
    const porAprobar = screen.getByRole("tab", { name: /Por aprobar/ });
    expect(porAprobar).toHaveAttribute("aria-selected", "true");
    expect(porAprobar).toHaveFocus();
  });

  it("el empty de «Por aprobar» lo dice", async () => {
    servicio.solicitudes.mockResolvedValue([]);
    pintar(<SolicitudPermisosPage />);
    fireEvent.click(screen.getByRole("tab", { name: /Por aprobar/ }));
    expect(
      await screen.findByText("No tiene solicitudes por aprobar."),
    ).toBeInTheDocument();
  });

  it("el detalle dice «Cargando…» hasta que llegan los datos", async () => {
    servicio.solicitud.mockReturnValue(new Promise(() => {}));
    pintar(<SolicitudPermisosPage />, "/?solicitud=7");
    const ventana = await screen.findByRole("dialog", {
      name: "Solicitud de permiso",
    });
    expect(within(ventana).getByRole("status")).toHaveTextContent("Cargando…");
  });

  it("si el documento no se puede descargar, lo avisa", async () => {
    servicio.solicitud.mockResolvedValue({
      ...DETALLE,
      tiene_adjunto: true,
      adjunto_nombre: "certificado.pdf",
    });
    servicio.adjunto.mockRejectedValue({
      response: { data: { error: { message: "El archivo ya no existe." } } },
    });
    pintar(<SolicitudPermisosPage />, "/?solicitud=7");
    const ventana = await screen.findByRole("dialog", {
      name: "Solicitud de permiso",
    });
    fireEvent.click(
      await within(ventana).findByRole("button", { name: /certificado.pdf/ }),
    );
    expect(await within(ventana).findByRole("alert")).toHaveTextContent(
      "El archivo ya no existe.",
    );
  });

  it("si no se puede cargar a quién escalar, lo avisa", async () => {
    servicio.opciones.mockRejectedValue({});
    pintar(<SolicitudPermisosPage />, "/?solicitud=7");
    const ventana = await screen.findByRole("dialog", {
      name: "Solicitud de permiso",
    });
    fireEvent.click(
      await within(ventana).findByRole("button", { name: /^Escalar/ }),
    );
    expect(await within(ventana).findByRole("alert")).toHaveTextContent(
      "No se pudo cargar a quién escalar.",
    );
  });

  it("el documento obligatorio que falta se marca en su campo", async () => {
    servicio.tipos.mockResolvedValue([
      { ...VACACIONES, adjunto: "obligatorio" },
    ]);
    pintar(<SolicitudPermisosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Nueva solicitud de permiso",
    });
    await within(ventana).findByText("Jefatura");
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    const campo = within(ventana).getByLabelText(/Documento de respaldo/);
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAccessibleDescription(
      /Este permiso pide un documento de respaldo/,
    );
    expect(servicio.solicitar).not.toHaveBeenCalled();
  });

  it("los errores del servidor van bajo su campo", async () => {
    servicio.solicitar.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            message: "Error en la solicitud.",
            details: { hasta: ["Supera el máximo de días seguidos."] },
          },
        },
      },
    });
    pintar(<SolicitudPermisosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Nueva solicitud de permiso",
    });
    await within(ventana).findByText("Jefatura");
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    const hasta = within(ventana).getByLabelText(/^Hasta/);
    await waitFor(() => expect(hasta).toHaveAttribute("aria-invalid", "true"));
    expect(hasta).toHaveAccessibleDescription(
      "Supera el máximo de días seguidos.",
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
    fireEvent.change(within(ventana).getByLabelText(/^Nombre del permiso/), {
      target: { value: "Permiso médico" },
    });
    fireEvent.change(
      within(ventana).getByLabelText("Máximo de días seguidos"),
      {
        target: { value: "3" },
      },
    );
    // Los fines de semana solo aplican si se descuenta de las vacaciones.
    expect(within(ventana).queryByLabelText("Sábados por período")).toBeNull();
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
          dias_maximos: 3,
          descuenta_vacaciones: false,
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
