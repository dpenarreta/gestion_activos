import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * «Mi perfil» → Mi aniversario en el calendario: activarlo pide aceptar que
 * sea público y la fecha de ingreso (al menos día y mes; el año es opcional);
 * desactivarlo lo retira.
 */

const servicio = { guardarAniversario: vi.fn() };
vi.mock("../src/api/misDatosService", () => ({ misDatosService: servicio }));

const { MiAniversario } = await import("../src/pages/MisDatos/MiAniversario");

beforeEach(() => vi.clearAllMocks());

describe("Mi aniversario en el calendario", () => {
  it("activarlo pide aceptar y la fecha de ingreso; el año es opcional", async () => {
    servicio.guardarAniversario.mockResolvedValue({
      mostrar: true,
      dia: 15,
      mes: 10,
      anio: 2019,
    });
    render(<MiAniversario inicial={{ mostrar: false }} />);
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Mostrar mi aniversario en la empresa en el calendario",
      }),
    );
    const ventana = screen.getByRole("dialog", { name: /aniversario/ });
    const aceptar = within(ventana).getByRole("button", {
      name: "Aceptar y mostrar",
    });
    expect(aceptar).toBeDisabled();
    fireEvent.change(within(ventana).getByLabelText("Día"), {
      target: { value: "15" },
    });
    fireEvent.change(within(ventana).getByLabelText("Mes"), {
      target: { value: "10" },
    });
    fireEvent.change(within(ventana).getByLabelText("Año (opcional)"), {
      target: { value: "2019" },
    });
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.click(aceptar);
    await waitFor(() =>
      expect(servicio.guardarAniversario).toHaveBeenCalledWith({
        mostrar: true,
        acepto: true,
        dia: 15,
        mes: 10,
        anio: 2019,
      }),
    );
    expect(
      await screen.findByText(/se muestra cada 15 de octubre/),
    ).toBeInTheDocument();
  });

  it("desactivarlo lo retira", async () => {
    servicio.guardarAniversario.mockResolvedValue({ mostrar: false });
    render(
      <MiAniversario
        inicial={{ mostrar: true, dia: 15, mes: 10, anio: null }}
      />,
    );
    expect(screen.getByText(/ingresó el 15 de octubre\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(servicio.guardarAniversario).toHaveBeenCalledWith({
        mostrar: false,
      }),
    );
  });
});
