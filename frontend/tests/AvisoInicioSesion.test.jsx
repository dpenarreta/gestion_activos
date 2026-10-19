import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El aviso al iniciar sesión: una ventana destacada con título, imagen y
 * contenido, que sale una vez por sesión al entrar; se configura en
 * Configuración (con vista previa).
 */

vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 7, permissions: [] } }),
}));

const servicio = { obtener: vi.fn(), guardar: vi.fn(), imagen: vi.fn() };
vi.mock("../src/api/avisoInicioService", () => ({
  avisoInicioService: servicio,
}));

const { AvisoInicioSesion } =
  await import("../src/components/admin/AvisoInicioSesion/AvisoInicioSesion");
const { AvisoInicioPage } =
  await import("../src/pages/Admin/Configuracion/AvisoInicioPage");

const AVISO = {
  activo: true,
  titulo: "Mantenimiento del sistema",
  contenido: "El sábado de 08:00 a 12:00.\nGuarde su trabajo.",
  tiene_imagen: true,
  version: 3,
  actualizado: "2026-10-19T20:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:local/aviso");
  globalThis.URL.revokeObjectURL = vi.fn();
  servicio.obtener.mockResolvedValue(AVISO);
  servicio.imagen.mockResolvedValue(new Blob(["x"]));
});

describe("Al entrar al sistema", () => {
  it("muestra el aviso con su título, imagen y contenido; cerrado, no vuelve en la sesión", async () => {
    const terminado = vi.fn();
    const { unmount } = render(<AvisoInicioSesion onTerminado={terminado} />);

    const ventana = await screen.findByRole("dialog", {
      name: "Mantenimiento del sistema",
    });
    expect(within(ventana).getByText(/Guarde su trabajo/)).toBeInTheDocument();
    await waitFor(() =>
      expect(ventana.querySelector("img")).toHaveAttribute(
        "src",
        "blob:local/aviso",
      ),
    );
    expect(terminado).not.toHaveBeenCalled();

    fireEvent.click(within(ventana).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(terminado).toHaveBeenCalledTimes(1);
    unmount();

    // Otra pantalla, la misma sesión: no vuelve a salir.
    render(<AvisoInicioSesion onTerminado={terminado} />);
    await waitFor(() => expect(terminado).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("si el aviso cambió, sale de nuevo aunque ya se haya cerrado", async () => {
    sessionStorage.setItem("aviso_inicio.visto.7", "2");
    render(<AvisoInicioSesion />);
    expect(
      await screen.findByRole("dialog", { name: "Mantenimiento del sistema" }),
    ).toBeInTheDocument();
  });

  it("apagado no sale, y deja pasar al siguiente aviso", async () => {
    servicio.obtener.mockResolvedValue({ ...AVISO, activo: false });
    const terminado = vi.fn();
    render(<AvisoInicioSesion onTerminado={terminado} />);
    await waitFor(() => expect(terminado).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("En Configuración", () => {
  it("se edita, se ve en vista previa tal cual y se guarda", async () => {
    servicio.guardar.mockResolvedValue({ ...AVISO, titulo: "Nuevo horario" });
    render(<AvisoInicioPage />);

    const titulo = await screen.findByLabelText("Título");
    expect(titulo).toHaveValue("Mantenimiento del sistema");
    expect(screen.getByRole("switch", { name: /Encendido/ })).toBeChecked();

    fireEvent.change(titulo, { target: { value: "Nuevo horario" } });
    fireEvent.click(screen.getByRole("button", { name: /Vista previa/ }));
    const previa = screen.getByRole("dialog", { name: "Nuevo horario" });
    fireEvent.click(within(previa).getByRole("button", { name: "Cerrar" }));

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.guardar).toHaveBeenCalledWith(
        expect.objectContaining({
          activo: true,
          titulo: "Nuevo horario",
          quitar_imagen: false,
        }),
        null,
      ),
    );
    expect(await screen.findByText("Guardado")).toBeInTheDocument();
  });

  it("la imagen se puede quitar", async () => {
    servicio.guardar.mockResolvedValue({ ...AVISO, tiene_imagen: false });
    render(<AvisoInicioPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Quitar imagen/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.guardar).toHaveBeenCalledWith(
        expect.objectContaining({ quitar_imagen: true }),
        null,
      ),
    );
  });
});
