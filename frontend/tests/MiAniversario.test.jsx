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
// El texto que se acepta es el vigente del catálogo (US-004, 11/11/2026).
const privacidad = { textoVigente: vi.fn() };
vi.mock("../src/api/privacidadService", async (importOriginal) => ({
  ...(await importOriginal()),
  privacidadService: privacidad,
}));

const { MiAniversario } = await import("../src/pages/MisDatos/MiAniversario");

const VIGENTE = {
  clave: "aniversario_publico",
  version: 1,
  texto:
    "Acepto que mi aniversario en la empresa sea información pública dentro de la empresa.",
  titulo: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  privacidad.textoVigente.mockResolvedValue(VIGENTE);
});

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
    // Llega el texto vigente: la casilla lo lleva como etiqueta.
    const casilla = await within(ventana).findByRole("checkbox", {
      name: VIGENTE.texto,
    });
    expect(casilla).toBeEnabled();
    fireEvent.click(casilla);
    fireEvent.click(aceptar);
    await waitFor(() =>
      expect(servicio.guardarAniversario).toHaveBeenCalledWith({
        mostrar: true,
        acepto: true,
        version: 1,
        dia: 15,
        mes: 10,
        anio: 2019,
      }),
    );
    expect(
      await screen.findByText(/se muestra cada 15 de octubre/),
    ).toBeInTheDocument();
  });

  it("sin el texto del servidor no se puede aceptar", async () => {
    privacidad.textoVigente.mockRejectedValue(new Error("sin red"));
    render(<MiAniversario inicial={{ mostrar: false }} />);
    fireEvent.click(screen.getByRole("switch"));
    const ventana = screen.getByRole("dialog", { name: /aniversario/ });
    expect(
      await within(ventana).findByText(/No se pudo cargar el texto vigente/),
    ).toBeInTheDocument();
    // Se lee el texto de siempre, pero la casilla y el botón no responden.
    expect(
      within(ventana).getByRole("checkbox", {
        name: "Acepto que mi aniversario sea público",
      }),
    ).toBeDisabled();
    expect(
      within(ventana).getByText(/Acepto que mi aniversario en la empresa/),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByRole("button", { name: "Aceptar y mostrar" }),
    ).toBeDisabled();
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
