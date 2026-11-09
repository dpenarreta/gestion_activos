import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Consentimiento del tratamiento de datos (09/11/2026): la pantalla
 * obligatoria al entrar (foco, aceptar, 409 si el aviso cambió, cerrar
 * sesión), el texto en párrafos y listas sin HTML, y la pantalla de quien
 * administra (editar, pedir aceptación de nuevo, restablecer). Los servicios
 * van simulados; los datos son ficticios.
 */

const AVISO =
  "Primer párrafo del aviso.\n\n- Dato uno\n- Dato dos\n\nÚltimo párrafo.";

const servicio = {};
function reiniciarServicio() {
  Object.assign(servicio, {
    aceptarAviso: vi.fn().mockResolvedValue({ version: "1" }),
    aviso: vi.fn().mockResolvedValue({
      existe: true,
      texto: AVISO,
      version: 2,
      version_desde: "2026-11-09T10:00:00-05:00",
      editado_por: "Adela Ibáñez",
      texto_inicial: "Texto inicial.",
      totales: { personas: 3, aceptaron: 1, pendientes: 2 },
      puede_atender: true,
    }),
    guardarAviso: vi.fn(),
    personasConsentimiento: vi.fn().mockResolvedValue({
      count: 2,
      next: null,
      previous: null,
      results: [
        {
          id: 40,
          nombre: "Ana Pérez",
          usuario: "aperez",
          correo: "aperez@example.com",
          estado: "ACEPTADO",
          aceptacion_de_nexo: true,
          ultima_aceptacion: {
            version: "2",
            aceptado_en: "2026-11-09T11:00:00-05:00",
            restablecida_en: null,
          },
        },
        {
          id: 41,
          nombre: "Íñigo Núñez",
          usuario: "inunez",
          correo: "inunez@example.com",
          estado: "PENDIENTE",
          aceptacion_de_nexo: false,
          ultima_aceptacion: null,
        },
      ],
    }),
    historialConsentimiento: vi.fn().mockResolvedValue({
      aceptaciones: [
        {
          id: 1,
          version: "Nexo",
          origen_label: "Nexo (importada)",
          aceptado_en: "2026-08-20T10:00:00-05:00",
          ip: null,
          restablecida_en: null,
        },
      ],
    }),
    restablecerConsentimiento: vi.fn().mockResolvedValue({ aceptaciones: [] }),
    restablecerTodos: vi.fn().mockResolvedValue({ restablecidas: 1 }),
  });
}
reiniciarServicio();

vi.mock("../src/api/privacidadService", async (importOriginal) => ({
  ...(await importOriginal()),
  privacidadService: servicio,
}));

const confirmar = vi.fn().mockResolvedValue(true);
vi.mock("../src/components/common/Confirmar/confirmar", () => ({
  confirmar: (...a) => confirmar(...a),
}));

const auth = {
  user: null,
  refreshUser: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
};
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ ...auth, isAuthenticated: true, isInitializing: false }),
}));

const { ConsentimientoGate } =
  await import("../src/components/admin/ConsentimientoGate/ConsentimientoGate");
const { ConsentimientoPrivacidad } =
  await import("../src/pages/Privacidad/ConsentimientoPrivacidad");
const { bloquesDelAviso } =
  await import("../src/pages/Privacidad/TextoDelAviso");

beforeEach(() => {
  reiniciarServicio();
  confirmar.mockClear().mockResolvedValue(true);
  auth.refreshUser = vi.fn().mockResolvedValue({});
  auth.logout = vi.fn().mockResolvedValue(undefined);
  auth.user = {
    id: 1,
    permissions: [],
    consentimiento: { pendiente: true, version: 3, texto: AVISO },
  };
});

function pintarGate() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route
          path="/admin"
          element={
            <ConsentimientoGate>
              <p>La intranet</p>
            </ConsentimientoGate>
          }
        />
        <Route path="/login" element={<p>Pantalla de acceso</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("El texto del aviso", () => {
  it("separa párrafos y listas", () => {
    expect(bloquesDelAviso(AVISO)).toEqual([
      { tipo: "parrafo", lineas: ["Primer párrafo del aviso."] },
      { tipo: "lista", items: ["Dato uno", "Dato dos"] },
      { tipo: "parrafo", lineas: ["Último párrafo."] },
    ]);
  });

  it("no interpreta HTML", () => {
    auth.user.consentimiento.texto = "<img src=x onerror=alert(1)>";
    pintarGate();
    // Las únicas imágenes son el logotipo, fuera del texto del aviso.
    const texto = screen.getByRole("region", { name: "Texto del aviso" });
    expect(texto.querySelector("img")).toBeNull();
    expect(
      screen.getByText("<img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
  });
});

describe("Pantalla de consentimiento", () => {
  it("sin aceptación pendiente deja pasar", () => {
    auth.user.consentimiento = { pendiente: false };
    pintarGate();
    expect(screen.getByText("La intranet")).toBeInTheDocument();
  });

  it("sin dato de consentimiento (sesión vieja) también deja pasar", () => {
    delete auth.user.consentimiento;
    pintarGate();
    expect(screen.getByText("La intranet")).toBeInTheDocument();
  });

  it("tapa la intranet, muestra el aviso y lleva el foco al título", () => {
    pintarGate();
    expect(screen.queryByText("La intranet")).toBeNull();
    const titulo = screen.getByRole("heading", {
      name: "Tratamiento de datos personales",
    });
    expect(titulo).toHaveFocus();
    expect(screen.getByText("Dato dos")).toBeInTheDocument();
    expect(screen.getByText(/versión 3 del aviso/)).toBeInTheDocument();
  });

  it("sin marcar la casilla explica qué falta y no envía", async () => {
    pintarGate();
    fireEvent.click(
      screen.getByRole("button", { name: "Aceptar y continuar" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Marque la casilla"),
    );
    expect(screen.getByRole("checkbox")).toHaveAttribute(
      "aria-describedby",
      "pv-gate-error",
    );
    expect(servicio.aceptarAviso).not.toHaveBeenCalled();
  });

  it("el error repetido se vuelve a anunciar (la región se vacía antes)", async () => {
    pintarGate();
    const boton = screen.getByRole("button", { name: "Aceptar y continuar" });
    fireEvent.click(boton);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Marque la casilla"),
    );
    fireEvent.click(boton);
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Marque la casilla"),
    );
  });

  it("dice qué pasa si no se acepta y el botón se ve inactivo", () => {
    pintarGate();
    expect(
      screen.getByText(
        "Si no lo acepta, no podrá usar la intranet. Si tiene dudas, consulte a Gestión Humana.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    const boton = screen.getByRole("button", { name: "Aceptar y continuar" });
    expect(boton).toHaveAttribute("aria-disabled", "true");
    expect(boton).toHaveClass("pv-boton-envio");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(boton).toHaveAttribute("aria-disabled", "false");
  });

  it("si solo falla releer la sesión, dice que la aceptación quedó", async () => {
    auth.refreshUser = vi.fn().mockRejectedValue(new Error("red"));
    pintarGate();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Aceptar y continuar" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Su aceptación quedó registrada; recargue la página.",
      ),
    );
    expect(servicio.aceptarAviso).toHaveBeenCalledTimes(1);
  });

  it("acepta la versión leída y relee la sesión", async () => {
    pintarGate();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Aceptar y continuar" }),
    );
    await waitFor(() => expect(auth.refreshUser).toHaveBeenCalled());
    expect(servicio.aceptarAviso).toHaveBeenCalledWith(3);
  });

  it("si el aviso cambió lo dice y trae el nuevo", async () => {
    servicio.aceptarAviso.mockRejectedValue({
      response: {
        status: 409,
        data: {
          error: {
            code: "aviso_cambiado",
            message: "El aviso cambió mientras lo leía.",
          },
        },
      },
    });
    pintarGate();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Aceptar y continuar" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("El aviso cambió"),
    );
    expect(auth.refreshUser).toHaveBeenCalled();
  });

  it("la única otra salida es cerrar sesión", async () => {
    pintarGate();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByText("Pantalla de acceso")).toBeInTheDocument();
    expect(auth.logout).toHaveBeenCalled();
  });
});

describe("Pantalla de consentimiento con texto largo", () => {
  // jsdom no mide: se simula una caja de 100 px con 1000 px de texto.
  let alto;
  let visible;
  beforeEach(() => {
    alto = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(1000);
    visible = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(100);
  });
  afterEach(() => {
    alto.mockRestore();
    visible.mockRestore();
  });

  it("sin llegar al final, «Aceptar» explica y lleva el foco al texto", async () => {
    pintarGate();
    const boton = screen.getByRole("button", { name: "Aceptar y continuar" });
    const pista = screen.getByText(
      "Desplácese hasta el final del texto para poder aceptarlo.",
    );
    expect(boton).toHaveAttribute("aria-describedby", pista.id);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(boton);
    expect(
      screen.getByRole("region", { name: "Texto del aviso" }),
    ).toHaveFocus();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Lea el aviso hasta el final",
      ),
    );
    expect(servicio.aceptarAviso).not.toHaveBeenCalled();
  });

  it("si la caja deja de desbordar (girar, maximizar, zoom) ya se puede aceptar", async () => {
    pintarGate();
    expect(screen.getByText(/Desplácese hasta el final/)).toBeInTheDocument();
    visible.mockReturnValue(1000);
    fireEvent(window, new Event("resize"));
    await waitFor(() =>
      expect(screen.queryByText(/Desplácese hasta el final/)).toBeNull(),
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Aceptar y continuar" }),
    );
    await waitFor(() => expect(servicio.aceptarAviso).toHaveBeenCalledWith(3));
  });
});

function pintarAdministracion() {
  return render(
    <MemoryRouter>
      <ConsentimientoPrivacidad />
    </MemoryRouter>,
  );
}

describe("Administración del consentimiento", () => {
  it("muestra el aviso, los totales y el estado de cada persona", async () => {
    pintarAdministracion();
    expect(
      await screen.findByRole("heading", { name: "Aviso vigente (versión 2)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 de 3 personas lo aceptaron/),
    ).toBeInTheDocument();
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Aceptó antes en Nexo")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
  });

  it("editar sin pedir aceptación de nuevo no confirma ni sube la versión", async () => {
    servicio.guardarAviso.mockResolvedValue({
      existe: true,
      texto: "Corregido.",
      version: 2,
      version_desde: "2026-11-09T10:00:00-05:00",
      totales: { personas: 3, aceptaron: 1, pendientes: 2 },
      puede_atender: true,
    });
    pintarAdministracion();
    fireEvent.click(
      await screen.findByRole("button", { name: /Editar el aviso/ }),
    );
    const campo = screen.getByLabelText("Texto del aviso");
    expect(campo).toHaveFocus();
    fireEvent.change(campo, { target: { value: "Corregido." } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.guardarAviso).toHaveBeenCalledWith({
        texto: "Corregido.",
        pedirDeNuevo: false,
      }),
    );
    expect(confirmar).not.toHaveBeenCalled();
    const anuncio = await screen.findByText(/La versión no cambió/);
    expect(anuncio.closest('[role="status"]')).not.toBeNull();
    expect(anuncio.closest(".mz-alert--ok")).not.toBeNull();
    // El foco vuelve al botón que abrió el editor.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Editar el aviso/ }),
      ).toHaveFocus(),
    );
  });

  it("el editor cuenta caracteres, previsualiza y al cancelar devuelve el foco", async () => {
    pintarAdministracion();
    fireEvent.click(
      await screen.findByRole("button", { name: /Editar el aviso/ }),
    );
    const campo = screen.getByLabelText("Texto del aviso");
    fireEvent.change(campo, { target: { value: "Hola\n\n- Uno" } });
    const contador = screen.getByText("11/20000 caracteres");
    expect(campo.getAttribute("aria-describedby")).toContain(contador.id);
    expect(screen.getByText("Vista previa")).toBeInTheDocument();
    expect(screen.getByText("Uno").closest("li")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Editar el aviso/ }),
      ).toHaveFocus(),
    );
  });

  it("si restablecer falla, el error va en una alerta y no como éxito", async () => {
    servicio.restablecerConsentimiento.mockRejectedValue({
      response: { status: 500, data: { error: { message: "Falló." } } },
    });
    pintarAdministracion();
    fireEvent.click(
      await screen.findByRole("button", { name: "Restablecer a Ana Pérez" }),
    );
    const error = await screen.findByText("Falló.");
    expect(error.closest('[role="alert"]')).not.toBeNull();
    expect(error.closest(".mz-alert--bad")).not.toBeNull();
  });

  it("si el historial no carga, deja reintentar", async () => {
    servicio.historialConsentimiento.mockRejectedValueOnce({
      response: { status: 500, data: {} },
    });
    pintarAdministracion();
    fireEvent.click(
      await screen.findByRole("button", { name: "Historial de Ana Pérez" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByText(/Versión Nexo \(Nexo \(importada\)\)/),
    ).toBeInTheDocument();
  });

  it("pedir aceptación de nuevo pide confirmación", async () => {
    servicio.guardarAviso.mockResolvedValue({
      existe: true,
      texto: AVISO,
      version: 3,
      version_desde: "2026-11-09T12:00:00-05:00",
      totales: { personas: 3, aceptaron: 0, pendientes: 3 },
      puede_atender: true,
    });
    pintarAdministracion();
    fireEvent.click(
      await screen.findByRole("button", { name: /Editar el aviso/ }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /cambio sustancial/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(confirmar).toHaveBeenCalled());
    expect(servicio.guardarAviso).toHaveBeenCalledWith({
      texto: AVISO,
      pedirDeNuevo: true,
    });
    expect(await screen.findByText(/versión 3: todas/)).toBeInTheDocument();
  });

  it("el texto vacío no se envía", async () => {
    pintarAdministracion();
    fireEvent.click(
      await screen.findByRole("button", { name: /Editar el aviso/ }),
    );
    fireEvent.change(screen.getByLabelText("Texto del aviso"), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(
      await screen.findByText("Escriba el texto del aviso."),
    ).toBeInTheDocument();
    expect(servicio.guardarAviso).not.toHaveBeenCalled();
  });

  it("restablece a una persona tras confirmar", async () => {
    pintarAdministracion();
    fireEvent.click(
      await screen.findByRole("button", { name: "Restablecer a Ana Pérez" }),
    );
    await waitFor(() =>
      expect(servicio.restablecerConsentimiento).toHaveBeenCalledWith(40),
    );
    expect(
      await screen.findByText("Consentimiento de Ana Pérez restablecido."),
    ).toBeInTheDocument();
  });

  it("restablecer a todas: si no se confirma, no hace nada", async () => {
    confirmar.mockResolvedValue(false);
    pintarAdministracion();
    fireEvent.click(
      await screen.findByRole("button", { name: /Restablecer a todas/ }),
    );
    await waitFor(() => expect(confirmar).toHaveBeenCalled());
    expect(servicio.restablecerTodos).not.toHaveBeenCalled();
  });

  it("el historial muestra las aceptaciones de Nexo", async () => {
    pintarAdministracion();
    fireEvent.click(
      await screen.findByRole("button", { name: "Historial de Ana Pérez" }),
    );
    expect(
      await screen.findByText(/Versión Nexo \(Nexo \(importada\)\)/),
    ).toBeInTheDocument();
  });

  it("con solo privacidad.ver no ofrece editar ni restablecer", async () => {
    servicio.aviso.mockResolvedValue({
      existe: true,
      texto: AVISO,
      version: 2,
      version_desde: "2026-11-09T10:00:00-05:00",
      totales: { personas: 3, aceptaron: 1, pendientes: 2 },
      puede_atender: false,
    });
    pintarAdministracion();
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Editar el aviso/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Restablecer/ })).toBeNull();
  });
});
