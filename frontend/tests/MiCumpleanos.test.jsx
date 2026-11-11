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
 *
 * Desde US-004 (11/11/2026) el texto que se acepta es el vigente del
 * catálogo de protección de datos: mientras llega o si falla se lee el de
 * respaldo, pero no se puede aceptar.
 */

const servicio = { guardarCumpleanos: vi.fn() };
vi.mock("../src/api/misDatosService", () => ({ misDatosService: servicio }));
const privacidad = { textoVigente: vi.fn() };
vi.mock("../src/api/privacidadService", async (importOriginal) => ({
  ...(await importOriginal()),
  privacidadService: privacidad,
}));

const { MiCumpleanos } = await import("../src/pages/MisDatos/MiCumpleanos");

const VIGENTE = {
  clave: "cumpleanos_publico",
  version: 2,
  texto: "Acepto que mi cumpleaños se vea en el calendario de la empresa.",
  titulo: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  privacidad.textoVigente.mockResolvedValue(VIGENTE);
});

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
    // El texto del servidor, no el fijo.
    const casilla = await within(ventana).findByRole("checkbox", {
      name: VIGENTE.texto,
    });
    expect(privacidad.textoVigente).toHaveBeenCalledWith("cumpleanos_publico");
    await waitFor(() => expect(casilla).toBeEnabled());
    fireEvent.click(casilla);
    fireEvent.click(aceptar);

    await waitFor(() =>
      expect(servicio.guardarCumpleanos).toHaveBeenCalledWith({
        mostrar: true,
        acepto: true,
        // La versión que leyó (QA-TECH): si cambió, el servidor lo rechaza.
        version: 2,
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

  it("si el texto vigente no llega, muestra el de respaldo y no deja aceptar", async () => {
    privacidad.textoVigente
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce(VIGENTE);
    render(<MiCumpleanos inicial={{ mostrar: false }} />);
    fireEvent.click(screen.getByRole("switch"));
    const ventana = screen.getByRole("dialog", {
      name: /Mostrar mi cumpleaños/,
    });
    const alerta = await within(ventana).findByText(
      /No se pudo cargar el texto vigente/,
    );
    // El respaldo se lee en un párrafo aparte (contraste normal), y la
    // casilla deshabilitada lleva una etiqueta neutra.
    const casilla = within(ventana).getByRole("checkbox", {
      name: "Acepto que mi cumpleaños sea público",
    });
    expect(casilla).toBeDisabled();
    expect(casilla).toHaveAccessibleDescription(
      /Acepto que mi día de cumpleaños sea información pública/,
    );
    fireEvent.change(within(ventana).getByLabelText("Fecha de su cumpleaños"), {
      target: { value: "1990-10-25" },
    });
    expect(
      within(ventana).getByRole("button", { name: "Aceptar y mostrar" }),
    ).toBeDisabled();
    expect(alerta).toBeInTheDocument();

    // «Reintentar» lo vuelve a pedir y, con el texto del servidor, se puede.
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Reintentar" }),
    );
    const nueva = await within(ventana).findByRole("checkbox", {
      name: VIGENTE.texto,
    });
    await waitFor(() => expect(nueva).toBeEnabled());
    expect(servicio.guardarCumpleanos).not.toHaveBeenCalled();
  });

  it("mientras carga, un esqueleto y no el texto de respaldo", async () => {
    privacidad.textoVigente.mockReturnValue(new Promise(() => {}));
    render(<MiCumpleanos inicial={{ mostrar: false }} />);
    fireEvent.click(screen.getByRole("switch"));
    const ventana = screen.getByRole("dialog", {
      name: /Mostrar mi cumpleaños/,
    });
    expect(
      within(ventana).getByText("Cargando el texto vigente…"),
    ).toBeInTheDocument();
    expect(
      within(ventana).queryByText(/información pública dentro de la empresa/),
    ).toBeNull();
    expect(within(ventana).getByRole("checkbox")).toBeDisabled();
  });

  it("si el texto cambió mientras lo leía, trae el nuevo y pide aceptarlo", async () => {
    servicio.guardarCumpleanos.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            code: "validation_error",
            message: "Revise los datos.",
            details: {
              acepto: [
                "El texto cambió mientras lo leía. Léalo de nuevo y acéptelo.",
              ],
            },
          },
        },
      },
    });
    const NUEVO = {
      ...VIGENTE,
      version: 3,
      texto: "Acepto el texto nuevo del cumpleaños público.",
    };
    privacidad.textoVigente
      .mockResolvedValueOnce(VIGENTE)
      .mockResolvedValueOnce(NUEVO);
    render(<MiCumpleanos inicial={{ mostrar: false }} />);
    fireEvent.click(screen.getByRole("switch"));
    const ventana = screen.getByRole("dialog", {
      name: /Mostrar mi cumpleaños/,
    });
    fireEvent.change(within(ventana).getByLabelText("Fecha de su cumpleaños"), {
      target: { value: "1990-10-25" },
    });
    fireEvent.click(
      await within(ventana).findByRole("checkbox", { name: VIGENTE.texto }),
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Aceptar y mostrar" }),
    );
    // El mensaje va junto a la casilla, que ahora lleva el texto nuevo.
    const nueva = await within(ventana).findByRole("checkbox", {
      name: NUEVO.texto,
    });
    expect(nueva).not.toBeChecked();
    expect(nueva).toHaveAccessibleDescription(
      "El texto cambió mientras lo leía. Léalo de nuevo y acéptelo.",
    );
    expect(privacidad.textoVigente).toHaveBeenCalledTimes(2);
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
