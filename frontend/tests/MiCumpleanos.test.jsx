import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * «Mi perfil» → Mi cumpleaños en el calendario: activarlo pide aceptar que
 * sea público y la fecha (solo día y mes); desactivarlo lo retira.
 */

const servicio = { guardarCumpleanos: vi.fn() };
vi.mock("../src/api/misDatosService", () => ({ misDatosService: servicio }));

const { MiCumpleanos } = await import("../src/pages/MisDatos/MiCumpleanos");

beforeEach(() => vi.clearAllMocks());

describe("Mi cumpleaños en el calendario", () => {
  it("activarlo pide aceptar que sea público y la fecha", async () => {
    servicio.guardarCumpleanos.mockResolvedValue({
      mostrar: true,
      dia: 25,
      mes: 10,
      aceptado_en: "2026-10-20T15:00:00Z",
    });
    render(<MiCumpleanos inicial={{ mostrar: false }} />);
    const interruptor = screen.getByRole("switch", {
      name: "Mostrar mi cumpleaños en el calendario",
    });
    expect(interruptor).not.toBeChecked();

    fireEvent.click(interruptor);
    const ventana = screen.getByRole("dialog", {
      name: /Mostrar mi cumpleaños/,
    });
    expect(within(ventana).getByText(/toda la empresa/)).toBeInTheDocument();
    const aceptar = within(ventana).getByRole("button", {
      name: "Aceptar y mostrar",
    });
    // Sin aceptar no se puede.
    expect(aceptar).toBeDisabled();

    fireEvent.change(within(ventana).getByLabelText("Fecha de su cumpleaños"), {
      target: { value: "1990-10-25" },
    });
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.click(aceptar);

    await waitFor(() =>
      expect(servicio.guardarCumpleanos).toHaveBeenCalledWith({
        mostrar: true,
        acepto: true,
        dia: 25,
        mes: 10,
      }),
    );
    expect(
      await screen.findByText(
        "Listo: su cumpleaños se muestra el 25 de octubre.",
      ),
    ).toBeInTheDocument();
    expect(interruptor).toBeChecked();
  });

  it("desactivarlo lo retira cuando quiera", async () => {
    servicio.guardarCumpleanos.mockResolvedValue({
      mostrar: false,
      dia: null,
      mes: null,
    });
    render(<MiCumpleanos inicial={{ mostrar: true, dia: 25, mes: 10 }} />);
    expect(screen.getByText(/Se muestra el 25 de octubre/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(servicio.guardarCumpleanos).toHaveBeenCalledWith({
        mostrar: false,
      }),
    );
    expect(
      await screen.findByText(/ya no se muestra en el calendario/),
    ).toBeInTheDocument();
  });

  it("cerrar la ventana sin aceptar no lo activa", () => {
    render(<MiCumpleanos inicial={{ mostrar: false }} />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(servicio.guardarCumpleanos).not.toHaveBeenCalled();
  });
});
