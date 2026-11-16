import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Editar y salir de un grupo desde la web (16/11/2026), igual que la app
 * (US-024): quien administra renombra y cambia miembros; se sale solo de un
 * grupo personalizado; quitar y salir piden confirmación.
 */

const servicio = {
  conversacion: vi.fn(),
  editarGrupo: vi.fn(),
  salir: vi.fn(),
  directorio: vi.fn(async () => []),
};
const confirmar = vi.fn(async () => true);
const chat = { cargarConversaciones: vi.fn(async () => {}), cerrar: vi.fn() };
vi.mock("../src/api/chatService", () => ({ chatService: servicio }));
vi.mock("../src/components/common/Confirmar/confirmar", () => ({ confirmar }));
vi.mock("../src/components/admin/Chat/ChatContext", () => ({
  useChat: () => chat,
}));

const { GestionGrupo } =
  await import("../src/components/admin/Chat/GestionGrupo");

const grupo = (extra = {}) => ({
  id: 5,
  tipo: "grupo",
  nombre: "Cartera",
  administra: true,
  participantes: [
    { id: 1, nombre: "Daniel Peñarreta", administra: true },
    { id: 2, nombre: "Fernanda Marroquín", administra: false },
  ],
  ...extra,
});

beforeEach(() => {
  Object.values(servicio).forEach((f) => f.mockClear());
  confirmar.mockClear();
  chat.cargarConversaciones.mockClear();
  chat.cerrar.mockClear();
});

describe("Gestión de un grupo del chat", () => {
  it("quien administra renombra y quita personas, con confirmación", async () => {
    servicio.conversacion.mockResolvedValue(grupo());
    servicio.editarGrupo.mockResolvedValue({});
    const onCerrar = vi.fn();
    render(<GestionGrupo conversacionId={5} onCerrar={onCerrar} />);

    fireEvent.change(await screen.findByLabelText("Nombre del grupo"), {
      target: { value: "Cartera Quito" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Quitar a Fernanda/ }));
    await waitFor(() => expect(confirmar).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("Fernanda Marroquín")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(servicio.editarGrupo).toHaveBeenCalledWith(5, {
        nombre: "Cartera Quito",
        quitar: [2],
      }),
    );
    await waitFor(() => expect(onCerrar).toHaveBeenCalled());
  });

  it("sin nombre no guarda y lo dice", async () => {
    servicio.conversacion.mockResolvedValue(grupo());
    render(<GestionGrupo conversacionId={5} onCerrar={() => {}} />);
    fireEvent.change(await screen.findByLabelText("Nombre del grupo"), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Póngale un nombre al grupo.",
    );
    expect(servicio.editarGrupo).not.toHaveBeenCalled();
  });

  it("en un grupo por área solo se renombra y no se puede salir", async () => {
    servicio.conversacion.mockResolvedValue(grupo({ tipo: "area" }));
    render(<GestionGrupo conversacionId={5} onCerrar={() => {}} />);
    expect(
      await screen.findByLabelText("Nombre del grupo"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Quitar/ })).toBeNull();
    expect(screen.queryByLabelText("Agregar personas")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Salir del grupo/ }),
    ).toBeNull();
  });

  it("quien no administra ve los participantes y puede salir", async () => {
    servicio.conversacion.mockResolvedValue(grupo({ administra: false }));
    servicio.salir.mockResolvedValue({});
    const onSalio = vi.fn();
    render(
      <GestionGrupo conversacionId={5} onCerrar={() => {}} onSalio={onSalio} />,
    );
    expect(
      await screen.findByText("Solo quien administra el grupo puede editarlo."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre del grupo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Salir del grupo/ }));
    await waitFor(() => expect(servicio.salir).toHaveBeenCalledWith(5));
    expect(chat.cerrar).toHaveBeenCalledWith(5);
    await waitFor(() => expect(onSalio).toHaveBeenCalled());
  });

  it("muestra el error del servidor", async () => {
    servicio.conversacion.mockResolvedValue(grupo());
    servicio.editarGrupo.mockRejectedValue({
      response: {
        status: 403,
        data: { error: { message: "Edita el grupo quien lo administra." } },
      },
    });
    render(<GestionGrupo conversacionId={5} onCerrar={() => {}} />);
    fireEvent.change(await screen.findByLabelText("Nombre del grupo"), {
      target: { value: "Otro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Edita el grupo quien lo administra.",
    );
  });
});
