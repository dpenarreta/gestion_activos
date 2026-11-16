import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";

import { inicioService } from "../src/api/servicios";
import {
  MiPerfil,
  queFalta,
  telefonoAMostrar,
} from "../src/pantallas/MiPerfil";

jest.mock("../src/sesion/SesionContext", () => ({
  useSesion: () => ({ empresaActiva: { id: 1 }, versionEmpresa: 0 }),
}));
jest.mock("../src/api/servicios", () => ({
  inicioService: { misDatos: jest.fn() },
}));
jest.mock("../src/navegador/enlaceWeb", () => ({
  urlWeb: (ruta) => `https://intranet/${ruta}`,
  abrirEnNavegador: jest.fn(async () => true),
  TEXTO_NAVEGADOR_FALLO: "No se pudo abrir",
}));

const DATOS = {
  nombres: "Ana",
  apellidos: "Pérez",
  correo: "ana@grupolaar.com",
  codigo_empleado: "",
  telefono: "0999999999",
  tiene_telefono_corporativo: true,
  telefono_corporativo: "022222222",
  cargo: { id: 3, nombre: "Analista · TI" },
  area: { id: 1, nombre: "TI" },
  agencia: null,
  faltan: ["agencia"],
  cargo_perfil: {
    cargo: { id: 3, nombre: "Analista" },
    objetivo: "Mantener los sistemas",
    funciones: ["Soporte", "Respaldos"],
    competencias: [],
    kpis: ["Tickets a tiempo"],
  },
  supervision: {
    jefes: [
      {
        id: 2,
        nombre: "Jefe de TI",
        unidad: "TI",
        personas: [{ id: 9, nombre: "Luis Mora" }],
        vacantes: 0,
      },
    ],
    companeros: [{ id: 10, nombre: "Eva Ruiz", sin_cuenta: true }],
    supervisa: [],
  },
};

describe("lo puro de Mi perfil", () => {
  it("el teléfono sigue la regla corporativo o personal", () => {
    expect(telefonoAMostrar(DATOS)).toEqual({
      etiqueta: "Teléfono corporativo",
      valor: "022222222",
    });
    expect(
      telefonoAMostrar({ ...DATOS, tiene_telefono_corporativo: false }),
    ).toEqual({
      etiqueta: "Teléfono personal",
      valor: "0999999999",
    });
  });
  it("lo que falta, en castellano", () => {
    expect(queFalta(["area", "agencia", "cargo"])).toBe(
      "área, agencia y cargo",
    );
  });
});

describe("<MiPerfil />", () => {
  it("muestra los datos sin poder editarlos y ofrece el navegador", async () => {
    inicioService.misDatos.mockResolvedValueOnce(DATOS);
    await render(<MiPerfil />);
    const datos = await screen.findByTestId("mis-datos");
    expect(within(datos).getByLabelText("Nombres: Ana")).toBeTruthy();
    expect(
      within(datos).getByLabelText("Teléfono corporativo: 022222222"),
    ).toBeTruthy();
    expect(
      within(datos).getByLabelText("Código de empleado: sin registrar"),
    ).toBeTruthy();
    expect(
      within(datos).getByText("Le falta completar: agencia."),
    ).toBeTruthy();
    expect(screen.getByTestId("editar-perfil")).toBeTruthy();
    // Nada se edita en la app.
    expect(screen.queryByText(/Guardar/)).toBeNull();
  });

  it("Mi cargo con sus listas plegadas y la línea de supervisión", async () => {
    inicioService.misDatos.mockResolvedValueOnce(DATOS);
    await render(<MiPerfil />);
    expect(await screen.findByText("Mi cargo: Analista")).toBeTruthy();
    expect(screen.queryByText("Respaldos")).toBeNull();
    await fireEvent.press(screen.getByTestId("mi-cargo-funciones"));
    expect(screen.getByText("Respaldos")).toBeTruthy();
    const linea = screen.getByTestId("mi-supervision");
    expect(within(linea).getByText("Luis Mora")).toBeTruthy();
    expect(
      within(linea).getByText("Ningún cargo le reporta directamente."),
    ).toBeTruthy();
    expect(within(linea).getByText(/sin cuenta/)).toBeTruthy();
  });

  it("si falla lo dice y deja reintentar", async () => {
    inicioService.misDatos
      .mockRejectedValueOnce(new Error("red"))
      .mockResolvedValueOnce(DATOS);
    await render(<MiPerfil />);
    expect(
      await screen.findByText("No se pudo cargar su perfil."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText("Reintentar"));
    expect(await screen.findByTestId("mis-datos")).toBeTruthy();
  });
});
