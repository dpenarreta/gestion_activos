import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * «Mi perfil» → Mis datos: los dos teléfonos (10/11/2026).
 *
 * La pregunta «¿Tiene teléfono o línea corporativa asignada?» es obligatoria y no se
 * preselecciona; con «Sí» el número es obligatorio y no pide autorización de
 * datos personales (es de la empresa). Uno u otro (11/11/2026): con «Sí» solo
 * el corporativo; con «No» solo el personal, que sigue opcional y es el
 * único con la casilla de autorización.
 */

const misDatos = {
  obtener: vi.fn(),
  guardar: vi.fn(),
  herramientas: vi.fn(),
};
vi.mock("../src/api/misDatosService", () => ({ misDatosService: misDatos }));
// Lo que cuelga del formulario no se prueba aquí.
vi.mock("../src/pages/MisDatos/MiCargo", () => ({ MiCargo: () => null }));
vi.mock("../src/pages/MisDatos/MiSupervision", () => ({
  MiSupervision: () => null,
}));
vi.mock("../src/pages/MisDatos/MisHerramientas", () => ({
  MisHerramientas: () => null,
}));
vi.mock("../src/pages/MisDatos/MiCumpleanos", () => ({
  MiCumpleanos: () => null,
}));
vi.mock("../src/pages/MisDatos/MiAniversario", () => ({
  MiAniversario: () => null,
}));

const { MisDatosPage } = await import("../src/pages/MisDatos/MisDatosPage");

const DATOS = {
  nombre: "Carla Ordóñez",
  nombres: "Carla",
  apellidos: "Ordóñez",
  correo: "carla@grupolaar.com",
  correo_institucional: true,
  telefono: "",
  tiene_telefono_corporativo: null,
  telefono_corporativo: "",
  telefono_autorizacion: {
    texto: "Autorizo a la empresa a guardar mi número de teléfono personal.",
    aceptado: false,
    aceptado_en: null,
  },
  area: { id: 2, nombre: "Cobranzas" },
  agencia: { id: 1, nombre: "Loja · Agencia" },
  cargo: { id: 5, nombre: "Analista · Cobranzas" },
  areas: [{ id: 2, nombre: "Cobranzas" }],
  agencias: [{ id: 1, nombre: "Loja · Agencia" }],
  cargos: [{ id: 5, nombre: "Analista · Cobranzas" }],
  faltan: ["telefono_corporativo"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

async function pintar(datos = DATOS) {
  misDatos.obtener.mockResolvedValue(datos);
  render(
    <MemoryRouter>
      <MisDatosPage />
    </MemoryRouter>,
  );
  return screen.findByRole("radiogroup", {
    name: /^¿Tiene teléfono o línea corporativa asignada?/,
  });
}

describe("Mi perfil: teléfono corporativo y personal", () => {
  it("avisa que falta, no preselecciona y no deja guardar sin responder", async () => {
    const grupo = await pintar();
    expect(
      screen.getByText(
        /Le falta completar: si tiene teléfono o línea corporativa/,
      ),
    ).toBeInTheDocument();
    expect(within(grupo).getByLabelText("Sí")).not.toBeChecked();
    expect(within(grupo).getByLabelText("No")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    fireEvent.submit(grupo.closest("form"));
    expect(
      await screen.findByText(
        "Indique si tiene teléfono o línea corporativa asignada.",
      ),
    ).toBeInTheDocument();
    expect(misDatos.guardar).not.toHaveBeenCalled();
  });

  it("con «Sí» exige el número y lo envía sin autorización", async () => {
    misDatos.guardar.mockResolvedValue({
      ...DATOS,
      tiene_telefono_corporativo: true,
      telefono_corporativo: "0987654321",
      faltan: [],
    });
    const grupo = await pintar();
    fireEvent.click(within(grupo).getByLabelText("Sí"));
    const corporativo = screen.getByLabelText(/^Teléfono corporativo/);
    expect(corporativo).toBeRequired();
    fireEvent.submit(corporativo.closest("form"));
    expect(
      await screen.findByText("Escriba su teléfono corporativo."),
    ).toBeInTheDocument();
    expect(misDatos.guardar).not.toHaveBeenCalled();

    fireEvent.change(corporativo, { target: { value: "0987654321" } });
    expect(screen.queryByLabelText(/Autorizo a la empresa/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(
      await screen.findByText("Sus datos quedaron guardados."),
    ).toBeInTheDocument();
    expect(misDatos.guardar).toHaveBeenCalledWith(
      expect.objectContaining({
        tiene_telefono_corporativo: true,
        telefono_corporativo: "0987654321",
        acepta_telefono: false,
      }),
    );
  });

  it("con «No» no envía el número", async () => {
    misDatos.guardar.mockResolvedValue({
      ...DATOS,
      tiene_telefono_corporativo: false,
      faltan: [],
    });
    const grupo = await pintar({
      ...DATOS,
      tiene_telefono_corporativo: true,
      telefono_corporativo: "0987654321",
      faltan: [],
    });
    fireEvent.click(within(grupo).getByLabelText("No"));
    expect(screen.queryByLabelText(/^Teléfono corporativo/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(misDatos.guardar).toHaveBeenCalled());
    expect(misDatos.guardar.mock.calls[0][0]).toMatchObject({
      tiene_telefono_corporativo: false,
      telefono_corporativo: "",
    });
  });

  it("sin responder no aparece ningún teléfono", async () => {
    await pintar();
    expect(screen.queryByLabelText(/^Teléfono corporativo/)).toBeNull();
    expect(screen.queryByLabelText(/^Teléfono personal/)).toBeNull();
    expect(screen.queryByLabelText(/Autorizo a la empresa/)).toBeNull();
  });

  it("con «Sí» solo el corporativo, obligatorio y sin autorización", async () => {
    const grupo = await pintar();
    expect(grupo).toHaveAccessibleName(
      "¿Tiene teléfono o línea corporativa asignada? (obligatorio)",
    );
    fireEvent.click(within(grupo).getByLabelText("Sí"));
    const corporativo = screen.getByRole("textbox", {
      name: "Teléfono corporativo (obligatorio)",
    });
    expect(corporativo).toBeRequired();
    fireEvent.change(corporativo, { target: { value: "0987654321" } });
    expect(screen.queryByLabelText(/^Teléfono personal/)).toBeNull();
    expect(screen.queryByLabelText(/Autorizo a la empresa/)).toBeNull();
  });

  it("con «No» solo el personal, opcional, y su autorización", async () => {
    const grupo = await pintar();
    fireEvent.click(within(grupo).getByLabelText("No"));
    expect(screen.queryByLabelText(/^Teléfono corporativo/)).toBeNull();
    const personal = screen.getByLabelText(/^Teléfono personal/);
    expect(personal).not.toBeRequired();
    fireEvent.change(personal, { target: { value: "0991112222" } });
    expect(screen.getByLabelText(/Autorizo a la empresa/)).toBeRequired();
  });

  it("con «Sí» no envía el personal que tenía guardado y lo avisa", async () => {
    misDatos.guardar.mockResolvedValue({ ...DATOS, faltan: [] });
    const grupo = await pintar({
      ...DATOS,
      telefono: "0991112222",
      telefono_autorizacion: { ...DATOS.telefono_autorizacion, aceptado: true },
    });
    fireEvent.click(within(grupo).getByLabelText("Sí"));
    expect(
      screen.getByText(/se quitará el teléfono personal 0991112222/),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Teléfono corporativo (obligatorio)",
      }),
      { target: { value: "0987654321" } },
    );
    fireEvent.submit(grupo.closest("form"));
    await waitFor(() => expect(misDatos.guardar).toHaveBeenCalled());
    expect(misDatos.guardar.mock.calls[0][0]).toMatchObject({
      tiene_telefono_corporativo: true,
      telefono_corporativo: "0987654321",
      telefono: "",
      acepta_telefono: false,
    });
  });
});

describe("Mi perfil: los errores de los teléfonos (auditoría 11/11/2026)", () => {
  it("la pregunta sin responder queda inválida y su motivo se anuncia", async () => {
    const grupo = await pintar();
    fireEvent.submit(grupo.closest("form"));
    const motivo = await screen.findByRole("alert");
    expect(motivo).toHaveTextContent(
      "Indique si tiene teléfono o línea corporativa asignada.",
    );
    expect(grupo).toHaveAttribute("aria-invalid", "true");
    expect(within(grupo).getByLabelText("Sí")).toHaveAccessibleDescription(
      /Indique si tiene teléfono o línea corporativa/,
    );
    expect(within(grupo).getByLabelText("Sí")).toHaveFocus();
  });

  it("el error del servidor del personal sale junto a su campo", async () => {
    misDatos.guardar.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            code: "validation_error",
            message: "Error en la solicitud.",
            details: { telefono: ["Escriba un teléfono de 7 a 15 dígitos."] },
          },
        },
      },
    });
    const grupo = await pintar();
    fireEvent.click(within(grupo).getByLabelText("No"));
    const personal = screen.getByLabelText(/^Teléfono personal/);
    fireEvent.change(personal, { target: { value: "12" } });
    fireEvent.click(screen.getByLabelText(/Autorizo a la empresa/));
    fireEvent.submit(grupo.closest("form"));
    await waitFor(() =>
      expect(personal).toHaveAttribute("aria-invalid", "true"),
    );
    expect(personal).toHaveAccessibleDescription(/7 a 15 dígitos/);
  });

  it("avisa que al responder «No» se quitará el número guardado", async () => {
    const grupo = await pintar({
      ...DATOS,
      tiene_telefono_corporativo: true,
      telefono_corporativo: "0987654321",
      faltan: [],
    });
    expect(screen.queryByText(/se quitará el número/)).toBeNull();
    fireEvent.click(within(grupo).getByLabelText("No"));
    expect(
      screen.getByText(
        /Al guardar se quitará el número corporativo 0987654321/,
      ),
    ).toBeInTheDocument();
  });
});

describe("Mi perfil: autorización y avisos (auditoría 11/11/2026)", () => {
  it("sin marcar la autorización no guarda y lo dice junto a la casilla", async () => {
    const grupo = await pintar();
    fireEvent.click(within(grupo).getByLabelText("No"));
    fireEvent.change(screen.getByLabelText(/^Teléfono personal/), {
      target: { value: "0991112222" },
    });
    fireEvent.submit(grupo.closest("form"));
    const casilla = screen.getByLabelText(/Autorizo a la empresa/);
    await waitFor(() =>
      expect(casilla).toHaveAttribute("aria-invalid", "true"),
    );
    expect(casilla).toHaveAccessibleDescription(/marque la autorización/);
    expect(misDatos.guardar).not.toHaveBeenCalled();
  });

  it("el aviso de quitar un número guardado va en una región que se anuncia", async () => {
    const grupo = await pintar({
      ...DATOS,
      tiene_telefono_corporativo: true,
      telefono_corporativo: "0987654321",
      faltan: [],
    });
    fireEvent.click(within(grupo).getByLabelText("No"));
    expect(
      screen
        .getAllByRole("status")
        .some((r) =>
          /se quitará el número corporativo 0987654321/.test(r.textContent),
        ),
    ).toBe(true);
  });
});
