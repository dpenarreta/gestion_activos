import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Configuración → Textos legales (26/10/2026): el texto de tratamiento de
 * datos personales que aceptan las personas es parametrizable, con versión.
 */

const servicio = { listar: vi.fn(), guardar: vi.fn() };
vi.mock("../src/api/textosLegalesService", () => ({
  textosLegalesService: servicio,
}));

const { TextosLegalesPage } =
  await import("../src/pages/Admin/Configuracion/TextosLegalesPage");

const TELEFONO = {
  clave: "autorizacion_telefono",
  nombre: "Autorización para guardar el teléfono",
  descripcion: "Lo acepta quien escribe su teléfono.",
  texto:
    "Autorizo a la empresa a guardar mi número de teléfono de contacto, sea personal o empresarial.",
  version: 1,
  actualizado: "2026-10-26T14:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  servicio.listar.mockResolvedValue([TELEFONO]);
});

describe("Textos legales", () => {
  it("muestra el texto con su versión y no deja guardar sin cambios", async () => {
    render(<TextosLegalesPage />);
    const campo = await screen.findByLabelText("Texto que acepta la persona");
    expect(campo).toHaveValue(TELEFONO.texto);
    expect(screen.getByText(/Versión 1/)).toBeInTheDocument();
    expect(
      screen.getByText(/la IP, el texto exacto y su versión/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guardar texto" }),
    ).toBeDisabled();
  });

  it("al cambiarlo avisa que hay que volver a aceptarlo y guarda la versión nueva", async () => {
    const nuevo = `${TELEFONO.texto} Versión revisada.`;
    servicio.guardar.mockResolvedValue({
      ...TELEFONO,
      texto: nuevo,
      version: 2,
    });
    render(<TextosLegalesPage />);
    const campo = await screen.findByLabelText("Texto que acepta la persona");
    fireEvent.change(campo, { target: { value: nuevo } });
    expect(screen.getByRole("note")).toHaveTextContent("pasa a la versión 2");
    expect(screen.getByRole("note")).toHaveTextContent(
      "deberá aceptarlo de nuevo",
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar texto" }));
    await waitFor(() =>
      expect(servicio.guardar).toHaveBeenCalledWith(
        "autorizacion_telefono",
        nuevo,
      ),
    );
    expect(
      await screen.findByText("Guardado como versión 2."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Versión 2/)).toBeInTheDocument();
  });
});
