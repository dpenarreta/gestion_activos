import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * La campana: cuántas hay sin leer, de qué módulo viene cada una, su resumen
 * y el clic que lleva directo a lo que la originó.
 */

const servicio = {
  resumen: vi.fn(),
  listar: vi.fn(),
  modulos: vi.fn(),
  leer: vi.fn(),
  leerTodas: vi.fn(),
};
vi.mock("../src/api/notificacionesService", () => ({
  notificacionesService: servicio,
}));

const sonido = { activado: true };
const sonar = vi.fn();
vi.mock("../src/utils/sonidoNotificacion", () => ({
  prepararSonido: () => () => {},
  sonarNotificacion: (...args) => sonar(...args),
  sonidoActivado: () => sonido.activado,
  fijarSonido: (valor) => {
    sonido.activado = valor;
  },
}));

const { CampanaNotificaciones, haceCuanto } =
  await import("../src/components/admin/Notificaciones/CampanaNotificaciones");
const { NotificacionesPage } =
  await import("../src/pages/Notificaciones/NotificacionesPage");

const TICKET = {
  id: 1,
  modulo: "soporte",
  modulo_nombre: "Mesa de ayuda",
  icono: "headset",
  tipo: "soporte.ticket_asignado",
  titulo: "Ticket asignado",
  resumen: "TCK-2026-000042 · No enciende (Alta)",
  enlace: "/admin/soporte/tickets/42",
  leida: false,
  created_at: new Date().toISOString(),
};
const MATRIZ = {
  ...TICKET,
  id: 2,
  modulo: "matriz",
  modulo_nombre: "Matriz de obligaciones",
  icono: "journal-check",
  titulo: "Recordatorio de obligación",
  resumen: "Declaración del IVA vence el 28/10",
  enlace: "/admin/matriz/obligaciones?periodo=9",
  leida: true,
};

function Destino() {
  return <p>Destino abierto</p>;
}

function pintar(elemento = <CampanaNotificaciones />) {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route path="/admin" element={elemento} />
        <Route path="/admin/notificaciones" element={<p>Historial</p>} />
        <Route path="/admin/soporte/tickets/42" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  servicio.leer.mockResolvedValue({});
  servicio.leerTodas.mockResolvedValue({ marcadas: 1 });
});

describe("La campana", () => {
  it("dice cuántas hay sin leer y cada una muestra su módulo y su resumen", async () => {
    servicio.resumen.mockResolvedValue({
      no_leidas: 1,
      recientes: [TICKET, MATRIZ],
    });
    pintar();
    const boton = await screen.findByRole("button", {
      name: "Notificaciones: 1 sin leer",
    });
    expect(boton).toHaveTextContent("1");
    fireEvent.click(boton);
    const panel = screen.getByRole("dialog", { name: "Notificaciones" });
    expect(panel).toHaveTextContent("Mesa de ayuda");
    expect(panel).toHaveTextContent("Matriz de obligaciones");
    expect(panel).toHaveTextContent("TCK-2026-000042 · No enciende (Alta)");
    expect(screen.getAllByText("Sin leer")).toHaveLength(1);
  });

  it("al hacer clic la marca como leída y lleva directo a su origen", async () => {
    servicio.resumen.mockResolvedValue({ no_leidas: 1, recientes: [TICKET] });
    pintar();
    fireEvent.click(
      await screen.findByRole("button", { name: /Notificaciones: 1 sin leer/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Ticket asignado/ }));
    expect(await screen.findByText("Destino abierto")).toBeInTheDocument();
    expect(servicio.leer).toHaveBeenCalledWith(1);
  });

  it("marcar todas como leídas vuelve a contar", async () => {
    servicio.resumen
      .mockResolvedValueOnce({ no_leidas: 1, recientes: [TICKET] })
      .mockResolvedValue({
        no_leidas: 0,
        recientes: [{ ...TICKET, leida: true }],
      });
    pintar();
    fireEvent.click(
      await screen.findByRole("button", { name: /Notificaciones: 1 sin leer/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Marcar todas como leídas" }),
    );
    await waitFor(() => expect(servicio.leerTodas).toHaveBeenCalled());
    expect(
      await screen.findByRole("button", { name: "Notificaciones" }),
    ).toBeInTheDocument();
  });

  it("sin notificaciones lo dice, y Escape la cierra", async () => {
    servicio.resumen.mockResolvedValue({ no_leidas: 0, recientes: [] });
    pintar();
    fireEvent.click(
      await screen.findByRole("button", { name: "Notificaciones" }),
    );
    expect(screen.getByText("No tiene notificaciones.")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("el tiempo se dice en palabras", () => {
    const ahora = new Date("2026-10-16T12:00:00Z");
    expect(haceCuanto("2026-10-16T11:55:00Z", ahora)).toBe("hace 5 min");
    expect(haceCuanto("2026-10-16T09:00:00Z", ahora)).toBe("hace 3 h");
    expect(haceCuanto("2026-10-15T09:00:00Z", ahora)).toBe("ayer");
  });
});

describe("El historial", () => {
  it("filtra por módulo y por sin leer", async () => {
    servicio.modulos.mockResolvedValue([
      { id: "soporte", nombre: "Mesa de ayuda" },
      { id: "matriz", nombre: "Matriz de obligaciones" },
    ]);
    servicio.listar.mockResolvedValue({
      results: [TICKET],
      count: 1,
      next: null,
      previous: null,
    });
    pintar(<NotificacionesPage />);
    expect(await screen.findByText("Ticket asignado")).toBeInTheDocument();
    await screen.findByRole("option", { name: "Mesa de ayuda" });
    fireEvent.change(screen.getByLabelText("Módulo"), {
      target: { value: "soporte" },
    });
    await waitFor(() =>
      expect(servicio.listar).toHaveBeenLastCalledWith(
        expect.objectContaining({ modulo: "soporte" }),
      ),
    );
    fireEvent.click(screen.getByLabelText("Solo sin leer"));
    await waitFor(() =>
      expect(servicio.listar).toHaveBeenLastCalledWith(
        expect.objectContaining({ estado: "no_leidas" }),
      ),
    );
  });
});

describe("El sonido de las notificaciones", () => {
  function revisarDeNuevo() {
    // Al volver a la pestaña se consulta enseguida, sin esperar el intervalo.
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("lo pendiente al entrar no suena; lo que llega después, sí", async () => {
    sonido.activado = true;
    servicio.resumen.mockResolvedValue({ no_leidas: 1, recientes: [TICKET] });
    pintar();
    await screen.findByRole("button", { name: /1 sin leer/ });
    expect(sonar).not.toHaveBeenCalled();

    // La misma: no vuelve a sonar.
    revisarDeNuevo();
    await waitFor(() => expect(servicio.resumen).toHaveBeenCalledTimes(2));
    expect(sonar).not.toHaveBeenCalled();

    // Llega una nueva.
    servicio.resumen.mockResolvedValue({
      no_leidas: 2,
      recientes: [{ ...TICKET, id: 7, titulo: "Otro ticket" }, TICKET],
    });
    revisarDeNuevo();
    await waitFor(() => expect(sonar).toHaveBeenCalledTimes(1));
  });

  it("se silencia desde la campana", async () => {
    sonido.activado = true;
    servicio.resumen.mockResolvedValue({ no_leidas: 0, recientes: [] });
    pintar();
    fireEvent.click(
      await screen.findByRole("button", { name: /Notificaciones/ }),
    );
    const boton = screen.getByRole("button", {
      name: "Silenciar el sonido de las notificaciones",
    });
    fireEvent.click(boton);
    expect(sonido.activado).toBe(false);
    expect(
      screen.getByRole("button", {
        name: "Activar el sonido de las notificaciones",
      }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
