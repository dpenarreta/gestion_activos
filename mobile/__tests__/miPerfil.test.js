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
import { coloresClarosEn, olvidarApariencia, renderEnOscuro } from "./utilidades/modoOscuro";

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

  it("nombra la línea fija como la pregunta de la web", () => {
    expect(queFalta(["linea_fija"])).toBe("si tiene línea fija");
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

describe("encabezado de Mi perfil (16/11/2026)", () => {
  const { nombreCorto } = require("../src/pantallas/MiPerfil");
  it("un nombre y un apellido", () => {
    expect(nombreCorto("Daniel Alejandro", "Peñarreta Torres")).toBe(
      "Daniel Peñarreta",
    );
    expect(nombreCorto("Ana", "")).toBe("Ana");
  });

  it("nombre, código si lo hay y el cargo en lugar del correo", async () => {
    inicioService.misDatos.mockResolvedValueOnce({
      ...DATOS,
      codigo_empleado: "E-123",
    });
    await render(
      <MiPerfil usuario={{ username: "ana", email: "ana@grupolaar.com" }} />,
    );
    const encabezado = await screen.findByTestId("encabezado-perfil");
    expect(within(encabezado).getByText("Ana Pérez")).toBeTruthy();
    expect(
      within(encabezado).getByLabelText("Código de empleado E-123"),
    ).toBeTruthy();
    expect(within(encabezado).getByText("Analista · TI")).toBeTruthy();
    expect(within(encabezado).queryByText("ana@grupolaar.com")).toBeNull();
  });

  it("sin código registrado no se muestra esa parte", async () => {
    inicioService.misDatos.mockResolvedValueOnce(DATOS);
    await render(<MiPerfil />);
    await screen.findByTestId("encabezado-perfil");
    expect(screen.queryByTestId("codigo-empleado")).toBeNull();
  });
});

describe("US-026: modo oscuro", () => {
  afterEach(olvidarApariencia);

  it("Mi perfil en oscuro (CA-5)", async () => {
    inicioService.misDatos.mockResolvedValueOnce(DATOS);
    const vista = await renderEnOscuro(<MiPerfil />);
    expect(await screen.findByTestId("mis-datos")).toBeTruthy();
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
  });
});

describe("US-028 · CA-1 y CA-2: línea fija, extensión y cédula", () => {
  const { lineaFijaAMostrar } = require("../src/pantallas/MiPerfil");

  it("la respuesta y la extensión con la regla de la web", () => {
    expect(lineaFijaAMostrar({ tiene_linea_fija: true, linea_fija_extension: " 1234 " })).toEqual({
      respuesta: "Sí",
      extension: "1234",
    });
    // Con «No» la extensión no se muestra (la web no muestra el campo).
    expect(lineaFijaAMostrar({ tiene_linea_fija: false, linea_fija_extension: "99" })).toEqual({
      respuesta: "No",
      extension: null,
    });
    // Sin responder: «Sin registrar».
    expect(lineaFijaAMostrar({ tiene_linea_fija: null })).toEqual({ respuesta: "", extension: null });
    expect(lineaFijaAMostrar(undefined)).toEqual({ respuesta: "", extension: null });
  });

  it("con línea fija muestra «Sí» y la extensión", async () => {
    inicioService.misDatos.mockResolvedValueOnce({
      ...DATOS,
      tiene_linea_fija: true,
      linea_fija_extension: "1234",
    });
    await render(<MiPerfil />);
    const datos = await screen.findByTestId("mis-datos");
    expect(within(datos).getByLabelText("¿Tiene línea fija?: Sí")).toBeTruthy();
    expect(within(datos).getByLabelText("Extensión de su línea fija: 1234")).toBeTruthy();
  });

  it("con «No» no muestra la extensión; sin responder dice «Sin registrar»", async () => {
    inicioService.misDatos.mockResolvedValueOnce({ ...DATOS, tiene_linea_fija: false, linea_fija_extension: "" });
    const { unmount } = await render(<MiPerfil />);
    await screen.findByTestId("mis-datos");
    expect(screen.getByLabelText("¿Tiene línea fija?: No")).toBeTruthy();
    expect(screen.queryByTestId("mi-extension")).toBeNull();
    await unmount();

    inicioService.misDatos.mockResolvedValueOnce({ ...DATOS, tiene_linea_fija: null });
    await render(<MiPerfil />);
    await screen.findByTestId("mis-datos");
    expect(screen.getByLabelText("¿Tiene línea fija?: sin registrar")).toBeTruthy();
    expect(screen.queryByTestId("mi-extension")).toBeNull();
  });

  it("la cédula de nómina, solo si el servidor la envía", async () => {
    inicioService.misDatos.mockResolvedValueOnce({ ...DATOS, cedula: "0912345678" });
    const { unmount } = await render(<MiPerfil />);
    const cedula = await screen.findByTestId("mi-cedula");
    expect(cedula.props.accessibilityLabel).toBe(
      "Cédula: 0912345678. Viene de nómina. Si no es correcta, avise a Talento Humano.",
    );
    expect(screen.getByText("0912345678")).toBeTruthy();
    await unmount();

    for (const sinCedula of [{ cedula: "" }, {}]) {
      inicioService.misDatos.mockResolvedValueOnce({ ...DATOS, ...sinCedula });
      const vista = await render(<MiPerfil />);
      await screen.findByTestId("mis-datos");
      expect(screen.queryByTestId("mi-cedula")).toBeNull();
      expect(screen.queryByText("Cédula")).toBeNull();
      await vista.unmount();
    }
  });

  it("en oscuro, con cédula y extensión, sin colores claros (CA-8)", async () => {
    inicioService.misDatos.mockResolvedValueOnce({
      ...DATOS,
      cedula: "0912345678",
      tiene_linea_fija: true,
      linea_fija_extension: "1234",
    });
    const vista = await renderEnOscuro(<MiPerfil />);
    expect(await screen.findByTestId("mi-cedula")).toBeTruthy();
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
    olvidarApariencia();
  });
});
