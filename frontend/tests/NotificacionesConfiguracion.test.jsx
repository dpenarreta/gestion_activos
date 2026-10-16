import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Configuración → Notificaciones: todos los avisos del sistema en un solo
 * sitio. El correo del sistema, las alertas del inventario y los recordatorios
 * de la Matriz, cada apartado con su permiso.
 */

const estado = vi.fn();
const enviarPrueba = vi.fn();
const permisos = new Set();

vi.mock("../src/api/correoService", () => ({
  correoService: {
    estado: (...a) => estado(...a),
    enviarPrueba: (...a) => enviarPrueba(...a),
  },
}));
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codigo) => permisos.has(codigo),
}));

const { CorreoDelSistemaPage } =
  await import("../src/pages/Admin/Configuracion/CorreoDelSistemaPage");
const { seccionesVisibles } =
  await import("../src/components/admin/ConfiguracionMarco/seccionesConfiguracion");

const SMTP = {
  backend: "Servidor SMTP",
  envia_de_verdad: true,
  servidor: "smtp.empresa.com",
  puerto: 2524,
  cifrado: "STARTTLS",
  usuario: "avisos@empresa.com",
  remitente: "avisos@empresa.com",
  espera_segundos: 20,
  enlace_de_los_avisos: "https://activos.empresa.com",
};

function pintar() {
  return render(
    <MemoryRouter>
      <CorreoDelSistemaPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  permisos.add("configuracion.ver");
  permisos.add("configuracion.editar");
  estado.mockResolvedValue(SMTP);
});

describe("Correo del sistema", () => {
  it("dice por dónde sale el correo", async () => {
    pintar();
    expect(
      await screen.findByText("smtp.empresa.com:2524"),
    ).toBeInTheDocument();
    expect(screen.getByText("STARTTLS")).toBeInTheDocument();
    expect(screen.getByText("20 s")).toBeInTheDocument();
    expect(screen.queryByText(/no llegan a ningún buzón/)).toBeNull();
  });

  it("avisa cuando el modo no envía nada de verdad", async () => {
    estado.mockResolvedValue({
      ...SMTP,
      backend: "Consola (no se envía nada)",
      envia_de_verdad: false,
      servidor: null,
    });
    pintar();
    expect(
      await screen.findByText(/no llegan a ningún buzón/),
    ).toBeInTheDocument();
  });

  it("la prueba muestra el resultado, y el motivo si falla", async () => {
    enviarPrueba.mockRejectedValueOnce({
      response: {
        data: {
          detail: "No se pudo enviar el correo de prueba.",
          motivo: "timed out",
        },
      },
    });
    pintar();
    fireEvent.click(
      await screen.findByRole("button", { name: /Enviar una prueba/ }),
    );
    expect(await screen.findByText(/Motivo: timed out/)).toBeInTheDocument();

    enviarPrueba.mockResolvedValueOnce({
      detail: "Se envió un correo de prueba a ana@x.com.",
    });
    fireEvent.click(screen.getByRole("button", { name: /Enviar una prueba/ }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Se envió un correo de prueba",
      ),
    );
  });

  it("sin «editar configuración» no ofrece la prueba", async () => {
    permisos.delete("configuracion.editar");
    pintar();
    await screen.findByText("smtp.empresa.com:2524");
    expect(
      screen.queryByRole("button", { name: /Enviar una prueba/ }),
    ).toBeNull();
  });
});

describe("La sección Notificaciones", () => {
  function apartados(lista) {
    const seccion = seccionesVisibles(lista).find(
      (s) => s.id === "notificaciones",
    );
    return seccion ? seccion.subsecciones.map((sub) => sub.nombre) : null;
  }

  it("reúne los tres apartados para quien puede abrirlos", () => {
    expect(
      apartados(["configuracion.ver", "alertas.configurar", "matriz.crear"]),
    ).toEqual([
      "Correo del sistema",
      "Alertas del inventario",
      "Recordatorios de la Matriz",
    ]);
  });

  it("cada apartado con su permiso, y la sección abre en el primero visible", () => {
    const lista = ["matriz.crear"];
    expect(apartados(lista)).toEqual(["Recordatorios de la Matriz"]);
    const seccion = seccionesVisibles(lista).find(
      (s) => s.id === "notificaciones",
    );
    expect(seccion.path).toBe("/admin/configuracion/recordatorios");
    expect(apartados(["usuarios.ver"])).toBeNull();
  });
});
