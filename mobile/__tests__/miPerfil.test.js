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

/** US-032: las secciones arrancan cerradas; abre la del `testID` dado y
 * devuelve su tarjeta para buscar dentro con `within`. */
async function abrir(testID) {
  await fireEvent.press(await screen.findByTestId(`${testID}-cabecera`));
  return screen.getByTestId(testID);
}

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
    const datos = await abrir("mis-datos");
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
    await abrir("mi-cargo");
    expect(screen.queryByText("Respaldos")).toBeNull();
    await fireEvent.press(screen.getByTestId("mi-cargo-funciones"));
    expect(screen.getByText("Respaldos")).toBeTruthy();
    const linea = await abrir("mi-supervision");
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
    // US-032 (CA-4): también con las tres secciones abiertas.
    await abrir("mis-datos");
    await abrir("mi-cargo");
    await abrir("mi-supervision");
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
    const datos = await abrir("mis-datos");
    expect(within(datos).getByLabelText("¿Tiene línea fija?: Sí")).toBeTruthy();
    expect(within(datos).getByLabelText("Extensión de su línea fija: 1234")).toBeTruthy();
  });

  it("con «No» no muestra la extensión; sin responder dice «Sin registrar»", async () => {
    inicioService.misDatos.mockResolvedValueOnce({ ...DATOS, tiene_linea_fija: false, linea_fija_extension: "" });
    const { unmount } = await render(<MiPerfil />);
    await abrir("mis-datos");
    expect(screen.getByLabelText("¿Tiene línea fija?: No")).toBeTruthy();
    expect(screen.queryByTestId("mi-extension")).toBeNull();
    await unmount();

    inicioService.misDatos.mockResolvedValueOnce({ ...DATOS, tiene_linea_fija: null });
    await render(<MiPerfil />);
    await abrir("mis-datos");
    expect(screen.getByLabelText("¿Tiene línea fija?: sin registrar")).toBeTruthy();
    expect(screen.queryByTestId("mi-extension")).toBeNull();
  });

  it("la cédula de nómina, solo si el servidor la envía", async () => {
    inicioService.misDatos.mockResolvedValueOnce({ ...DATOS, cedula: "0912345678" });
    const { unmount } = await render(<MiPerfil />);
    await abrir("mis-datos");
    const cedula = screen.getByTestId("mi-cedula");
    expect(cedula.props.accessibilityLabel).toBe(
      "Cédula: 0912345678. Viene de nómina. Si no es correcta, avise a Talento Humano.",
    );
    expect(screen.getByText("0912345678")).toBeTruthy();
    await unmount();

    for (const sinCedula of [{ cedula: "" }, {}]) {
      inicioService.misDatos.mockResolvedValueOnce({ ...DATOS, ...sinCedula });
      const vista = await render(<MiPerfil />);
      await abrir("mis-datos");
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
    await abrir("mis-datos");
    expect(screen.getByTestId("mi-cedula")).toBeTruthy();
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
    olvidarApariencia();
  });
});

describe("US-032: las secciones de Mi perfil en acordeón", () => {
  const SECCIONES = [
    {
      id: "mis-datos",
      titulo: "Mis datos",
      descripcion: "Con ellos se cargan sus pedidos de soporte: manténgalos al día.",
      dentro: "Nombres",
    },
    {
      id: "mi-cargo",
      titulo: "Mi cargo: Analista",
      descripcion: "Lo que se espera de su cargo y cómo se mide.",
      dentro: "Objetivo del cargo",
    },
    {
      id: "mi-supervision",
      titulo: "Mi línea de supervisión",
      descripcion:
        "Según el organigrama: a quién reporta y a quiénes supervisa directamente.",
      dentro: "Reporta a",
    },
  ];

  it("arrancan cerradas, con su título y descripción a la vista (CA-1, CA-2, CA-3)", async () => {
    inicioService.misDatos.mockResolvedValueOnce(DATOS);
    await render(<MiPerfil />);
    await screen.findByTestId("mis-datos");
    for (const s of SECCIONES) {
      const tarjeta = screen.getByTestId(s.id);
      expect(within(tarjeta).getByText(s.titulo)).toBeTruthy();
      expect(within(tarjeta).getByText(s.descripcion)).toBeTruthy();
      expect(screen.queryByTestId(`${s.id}-contenido`)).toBeNull();
      expect(screen.queryByText(s.dentro)).toBeNull();
      expect(
        screen.getByTestId(`${s.id}-cabecera`).props.accessibilityState,
      ).toEqual({ expanded: false });
    }
    // CA-3: el encabezado de la pantalla queda fuera del acordeón.
    expect(
      within(screen.getByTestId("encabezado-perfil")).getByText("Ana Pérez"),
    ).toBeTruthy();
    expect(screen.queryByTestId("editar-perfil")).toBeNull();
  });

  it("abre y cierra al tocar el encabezado, sin perder el título (CA-2, CA-3)", async () => {
    inicioService.misDatos.mockResolvedValueOnce(DATOS);
    await render(<MiPerfil />);
    await fireEvent.press(await screen.findByTestId("mis-datos-cabecera"));
    expect(screen.getByTestId("mis-datos-contenido")).toBeTruthy();
    expect(screen.getByLabelText("Nombres: Ana")).toBeTruthy();
    // El aviso y el botón de la web siguen dentro de «Mis datos».
    const datos = screen.getByTestId("mis-datos");
    expect(within(datos).getByTestId("editar-perfil")).toBeTruthy();
    expect(within(datos).getByText(/En la app su perfil solo se consulta/)).toBeTruthy();
    expect(screen.getByText("Mis datos")).toBeTruthy();
    expect(screen.getByTestId("mis-datos-cabecera").props.accessibilityState).toEqual({
      expanded: true,
    });

    await fireEvent.press(screen.getByTestId("mis-datos-cabecera"));
    expect(screen.queryByTestId("mis-datos-contenido")).toBeNull();
    expect(screen.queryByLabelText("Nombres: Ana")).toBeNull();
    expect(screen.getByText("Mis datos")).toBeTruthy();
    expect(
      screen.getByText("Con ellos se cargan sus pedidos de soporte: manténgalos al día."),
    ).toBeTruthy();
  });

  it("B-1: «Le falta completar» se ve con «Mis datos» cerrada", async () => {
    inicioService.misDatos.mockResolvedValueOnce({ ...DATOS, faltan: ["agencia"] });
    await render(<MiPerfil />);
    const aviso = await screen.findByTestId("mis-datos-aviso");
    expect(screen.queryByTestId("mis-datos-contenido")).toBeNull();
    expect(within(aviso).getByText("Le falta completar: agencia.")).toBeTruthy();
    // Es un elemento propio: el nombre del encabezado no cambia.
    expect(
      screen.getByRole("button", {
        name: "Mis datos. Con ellos se cargan sus pedidos de soporte: manténgalos al día.",
        expanded: false,
      }),
    ).toBeTruthy();
  });

  it("B-1: sin nada pendiente no hay aviso", async () => {
    inicioService.misDatos.mockResolvedValueOnce({ ...DATOS, faltan: [] });
    await render(<MiPerfil />);
    await screen.findByTestId("mis-datos");
    expect(screen.queryByTestId("mis-datos-aviso")).toBeNull();
    expect(screen.queryByText(/Le falta completar/)).toBeNull();
  });

  it("las secciones son independientes (CA-2)", async () => {
    inicioService.misDatos.mockResolvedValueOnce(DATOS);
    await render(<MiPerfil />);
    await abrir("mis-datos");
    await abrir("mi-supervision");
    // Abrir una no cierra las otras.
    expect(screen.getByTestId("mis-datos-contenido")).toBeTruthy();
    expect(screen.getByTestId("mi-supervision-contenido")).toBeTruthy();
    expect(screen.queryByTestId("mi-cargo-contenido")).toBeNull();
    // Cerrar una no toca las demás.
    await fireEvent.press(screen.getByTestId("mis-datos-cabecera"));
    expect(screen.queryByTestId("mis-datos-contenido")).toBeNull();
    expect(screen.getByTestId("mi-supervision-contenido")).toBeTruthy();
  });

  it("el encabezado es un botón con nombre, estado y pista de abrir o cerrar (CA-4)", async () => {
    inicioService.misDatos.mockResolvedValueOnce(DATOS);
    await render(<MiPerfil />);
    const nombre = "Mi cargo: Analista. Lo que se espera de su cargo y cómo se mide.";
    const boton = await screen.findByRole("button", { name: nombre, expanded: false });
    expect(boton.props.accessibilityHint).toBe("Toque para abrir la sección.");
    await fireEvent.press(boton);
    const abierto = screen.getByRole("button", { name: nombre, expanded: true });
    expect(abierto.props.accessibilityHint).toBe("Toque para cerrar la sección.");
  });
});
