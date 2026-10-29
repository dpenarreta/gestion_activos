import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El aviso del rol de pagos al iniciar sesión (aviso del rol de pagos,
 * 29/10/2026): desde el primer día hábil del mes, a quien no aceptó su rol del
 * mes anterior le sale, con la misma ventana del aviso al iniciar sesión, una
 * invitación a verlo; pasado el plazo, la advertencia de sanción. «Ver mi rol
 * de pagos» lo lleva al rol con el período elegido; «Recordarme después» lo
 * cierra hasta el próximo inicio de sesión. Va entre el aviso importante y el
 * de «Mi perfil», uno a la vez.
 */

const permisos = { lista: [] };

vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 7, permissions: permisos.lista, first_name: "Ana" },
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}));

const servicio = { aviso: vi.fn() };
vi.mock("../src/api/nominaService", () => ({ nominaService: servicio }));

// Para la cadena en el layout: lo que rodea al contenido no se prueba aquí.
vi.mock("../src/hooks/useTheme", () => ({
  useTheme: () => ({ theme: { site_name: "Gestión de Activos" } }),
}));
vi.mock("../src/context/AppearanceContext", () => ({
  useAppearance: () => ({ resolvedTheme: "light", setMode: vi.fn() }),
}));
vi.mock("../src/api/empresasService", () => ({
  empresasService: {
    mias: vi.fn(() => Promise.resolve({ empresas: [], activa: null })),
  },
}));
vi.mock("../src/modulos/EstadoModulos", () => ({
  EstadoModulosProvider: ({ children }) => children,
  useEstadoModulos: () => ({ apagados: new Set(), veApagados: false }),
}));
vi.mock("../src/components/admin/Chat/ChatContext", () => ({
  ChatProvider: ({ children }) => children,
}));
vi.mock("../src/components/admin/Chat/ChatDock", () => ({
  ChatDock: () => null,
}));
vi.mock("../src/components/admin/Notificaciones/CampanaNotificaciones", () => ({
  CampanaNotificaciones: () => null,
}));
vi.mock("../src/components/admin/AvisoOnboarding/AvisoOnboarding", () => ({
  AvisoOnboarding: () => null,
}));
vi.mock("../src/components/admin/ModuloApagado/ModuloApagado", () => ({
  ModuloApagado: ({ children }) => children,
}));
// El aviso importante se cierra con un botón; su ventana es la real.
vi.mock(
  "../src/components/admin/AvisoInicioSesion/AvisoInicioSesion",
  async (original) => ({
    ...(await original()),
    AvisoInicioSesion: ({ onTerminado }) => (
      <button type="button" onClick={onTerminado}>
        Cerrar el aviso importante
      </button>
    ),
  }),
);
vi.mock("../src/components/admin/AvisoPerfil/AvisoPerfil", () => ({
  AvisoPerfil: () => <p>Aviso de Mi perfil</p>,
}));

const { AvisoRolPagos } =
  await import("../src/components/admin/AvisoRolPagos/AvisoRolPagos");
const { AdminLayout } =
  await import("../src/components/admin/AdminLayout/AdminLayout");
const { RecordatorioRolPagos } =
  await import("../src/components/admin/AvisoRolPagos/RecordatorioRolPagos");

const NORMAL = {
  mostrar: true,
  anio: 2026,
  mes: 9,
  vencido: false,
  titulo: "Su rol de pagos ya está disponible",
  mensaje: "Su rol de pagos de septiembre de 2026 ya está disponible.",
  dias_habiles: 3,
  enlace: "/admin/institucional/rol-pagos?anio=2026&mes=9",
  recordatorio:
    "Recuerde: tiene hasta el lunes 5 de octubre para aceptar su rol de pagos de septiembre de 2026.",
};
const VENCIDO = {
  ...NORMAL,
  vencido: true,
  titulo: "Plazo vencido para aceptar su rol de pagos",
  mensaje: "Superó los 3 días hábiles permitidos. Puede ser sancionado.",
  recordatorio: "El plazo venció el lunes 5 de octubre.",
};

function Direccion() {
  const location = useLocation();
  return <p data-testid="direccion">{location.pathname + location.search}</p>;
}

function pintar(onTerminado) {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <AvisoRolPagos onTerminado={onTerminado} />
      <Direccion />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  servicio.aviso.mockResolvedValue(NORMAL);
});

describe("El aviso del rol de pagos", () => {
  it("dentro del plazo invita a ver el rol, con la etiqueta «Rol de pagos»", async () => {
    pintar();
    const ventana = await screen.findByRole("dialog", {
      name: "Su rol de pagos ya está disponible",
    });
    expect(ventana).toHaveTextContent(/septiembre de 2026/);
    expect(within(ventana).getByText("Rol de pagos")).toBeInTheDocument();
    expect(ventana.querySelector(".bi-file-earmark-text")).not.toBeNull();
    expect(ventana).not.toHaveClass("aviso-inicio--advertencia");
    expect(
      within(ventana).getByRole("button", { name: "Ver mi rol de pagos" }),
    ).toHaveClass("btn-primary");
  });

  it("pasado el plazo advierte, con la etiqueta «Plazo vencido»", async () => {
    servicio.aviso.mockResolvedValue(VENCIDO);
    pintar();
    const ventana = await screen.findByRole("dialog", {
      name: "Plazo vencido para aceptar su rol de pagos",
    });
    expect(ventana).toHaveTextContent(/Puede ser sancionado/);
    expect(within(ventana).getByText("Plazo vencido")).toBeInTheDocument();
    expect(
      ventana.querySelector(".bi-exclamation-triangle-fill"),
    ).not.toBeNull();
    expect(ventana).toHaveClass("aviso-inicio--advertencia");
  });

  it("«Ver mi rol de pagos» lleva al rol con el año y el mes elegidos", async () => {
    const terminado = vi.fn();
    pintar(terminado);
    fireEvent.click(
      await screen.findByRole("button", { name: "Ver mi rol de pagos" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("direccion")).toHaveTextContent(
      "/admin/institucional/rol-pagos?anio=2026&mes=9",
    );
    // «Mi perfil» no se abre encima del rol recién pedido: saldrá en el
    // próximo inicio de sesión (auditoría UX/UI).
    expect(terminado).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("aviso_rol.visto.7.2026-9")).toBe("1");
  });

  it("el foco empieza en «Ver mi rol de pagos», no en cerrar", async () => {
    pintar();
    expect(
      await screen.findByRole("button", { name: "Ver mi rol de pagos" }),
    ).toHaveFocus();
  });

  it("«Recordarme después» lo cierra y no vuelve a salir en la misma sesión", async () => {
    const terminado = vi.fn();
    const { unmount } = pintar(terminado);
    fireEvent.click(
      await screen.findByRole("button", { name: "Recordarme después" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("direccion")).toHaveTextContent(/^\/admin$/);
    expect(terminado).toHaveBeenCalledTimes(1);
    unmount();

    pintar(terminado);
    await waitFor(() => expect(terminado).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();

    // En el próximo inicio de sesión (el cierre limpia la sesión), sí.
    sessionStorage.clear();
    pintar(terminado);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("la X y Escape equivalen a «Recordarme después»", async () => {
    pintar();
    const ventana = await screen.findByRole("dialog");
    fireEvent.click(
      within(ventana).getByRole("button", {
        name: "Cerrar y recordarme después",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sessionStorage.getItem("aviso_rol.visto.7.2026-9")).toBe("1");

    sessionStorage.clear();
    pintar();
    await screen.findAllByRole("dialog");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("no sale si el servidor dice que no, ni si la consulta falla", async () => {
    servicio.aviso.mockResolvedValue({ mostrar: false });
    const terminado = vi.fn();
    const { unmount } = pintar(terminado);
    await waitFor(() => expect(terminado).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    servicio.aviso.mockRejectedValue(new Error("sin red"));
    pintar(terminado);
    await waitFor(() => expect(terminado).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("En el layout, uno a la vez", () => {
  function pintarLayout() {
    return render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin/*" element={<AdminLayout />}>
            <Route path="*" element={<p>Contenido</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it("aviso importante → aviso del rol de pagos → «Mi perfil»", async () => {
    pintarLayout();
    // Mientras está el aviso importante, el del rol ni se pide.
    expect(servicio.aviso).not.toHaveBeenCalled();
    expect(screen.queryByText("Aviso de Mi perfil")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Cerrar el aviso importante" }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Su rol de pagos ya está disponible",
    });
    expect(screen.queryByText("Aviso de Mi perfil")).toBeNull();

    fireEvent.click(
      within(ventana).getByRole("button", { name: "Recordarme después" }),
    );
    expect(await screen.findByText("Aviso de Mi perfil")).toBeInTheDocument();
  });

  it("sin aviso del rol, «Mi perfil» sigue saliendo", async () => {
    servicio.aviso.mockResolvedValue({ mostrar: false });
    pintarLayout();
    fireEvent.click(
      screen.getByRole("button", { name: "Cerrar el aviso importante" }),
    );
    expect(await screen.findByText("Aviso de Mi perfil")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("El recordatorio tras «Recordarme después» (29/10/2026)", () => {
  function conFranja(ruta = "/admin") {
    return render(
      <MemoryRouter initialEntries={[ruta]}>
        <RecordatorioRolPagos />
        <AvisoRolPagos />
        <Direccion />
      </MemoryRouter>,
    );
  }

  it("al posponer el aviso queda la franja con la fecha máxima", async () => {
    conFranja();
    await screen.findByRole("dialog");
    expect(screen.queryByText(/tiene hasta el lunes 5 de octubre/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recordarme después" }));
    const franja = await screen.findByText(
      /Recuerde: tiene hasta el lunes 5 de octubre/,
    );
    expect(franja.closest(".recordatorio-rol")).not.toHaveClass(
      "recordatorio-rol--vencido",
    );
    fireEvent.click(screen.getByRole("link", { name: "Ver mi rol de pagos" }));
    expect(screen.getByTestId("direccion")).toHaveTextContent(
      "/admin/institucional/rol-pagos?anio=2026&mes=9",
    );
    // En la pantalla del rol no se repite.
    await waitFor(() =>
      expect(screen.queryByText(/tiene hasta el lunes 5/)).toBeNull(),
    );
  });

  it("con el plazo vencido la franja lo dice, en rojo", async () => {
    servicio.aviso.mockResolvedValue(VENCIDO);
    sessionStorage.setItem("aviso_rol.visto.7.2026-9", "1");
    sessionStorage.setItem("aviso_rol.pospuesto.7.2026-9", "1");
    conFranja();
    const franja = await screen.findByText(
      "El plazo venció el lunes 5 de octubre.",
    );
    expect(franja.closest(".recordatorio-rol")).toHaveClass(
      "recordatorio-rol--vencido",
    );
  });

  it("si fue directo a su rol (no pospuso) no hay franja; aceptado, tampoco", async () => {
    sessionStorage.setItem("aviso_rol.visto.7.2026-9", "1");
    conFranja();
    await waitFor(() => expect(servicio.aviso).toHaveBeenCalled());
    expect(screen.queryByText(/Recuerde/)).toBeNull();

    servicio.aviso.mockResolvedValue({ mostrar: false });
    sessionStorage.setItem("aviso_rol.pospuesto.7.2026-9", "1");
    conFranja();
    await waitFor(() => expect(servicio.aviso).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(/Recuerde/)).toBeNull();
  });
});
