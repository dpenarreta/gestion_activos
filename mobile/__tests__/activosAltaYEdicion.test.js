import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Alert } from "react-native";

import { activosService, organizacionService } from "../src/api/servicios";
import { camaraDisponible } from "../src/activos/camara";
import {
  cuerpoDeEdicion,
  TEXTO_CONCESIONARIO,
  TEXTO_SIN_CAMBIOS_EN_LA_FICHA,
  valoresDeActivo,
} from "../src/activos/fichaTecnica";
import { fichaEnLaWeb, TEXTO_PUEDE_HABERSE_GUARDADO } from "../src/activos/formato";
import { hoyIso } from "../src/activos/mantenimientos";
import {
  TEXTO_AREA_PROPUESTA,
  TEXTO_BUSQUEDA_SIN_ELEGIR,
  TEXTO_CARACTERISTICA_SIN_AGREGAR,
  TEXTO_CARACTERISTICAS_CARGANDO,
  TEXTO_CARACTERISTICAS_SIN_CARGAR,
  TEXTO_SIN_PERMISO_EDITAR_ACTIVO,
  TEXTO_SIN_PERMISO_REGISTRAR_ACTIVO,
  TITULO_CAMBIO_DE_TIPO,
} from "../src/pantallas/activos/FormularioActivo";
import {
  ETIQUETA_ESCANEAR_SERIE,
  TEXTO_INSTRUCCION_SERIE,
  TEXTO_SIN_PERMISO_CAMARA_SERIE,
  TIPOS_DE_ETIQUETA_DE_FABRICANTE,
} from "../src/pantallas/activos/EscanearSerie";
import { TEXTO_GUARDANDO, TEXTO_REENVIO, TITULO_GUARDANDO, TITULO_REENVIO } from "../src/pantallas/activos/formularios";
import { GestionDeActivos } from "../src/pantallas/activos/GestionDeActivos";
import PantallaFicha from "../src/app/(app)/activos/[id]";
import PantallaEditar from "../src/app/(app)/activos/[id]/editar";
import PantallaNuevo from "../src/app/(app)/activos/nuevo";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };
const mockNavegacion = { setOptions: jest.fn(), dispatch: jest.fn() };
const mockParametros = {};
/** Lo último que la pantalla pidió a `usePreventRemove`. */
const mockPrevenir = { activa: false, alIntentar: null };
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useNavigation: () => mockNavegacion,
    usePreventRemove: (activa, alIntentar) => {
      mockPrevenir.activa = activa;
      mockPrevenir.alIntentar = alIntentar;
    },
    useLocalSearchParams: () => mockParametros,
    useIsFocused: () => true,
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

const mockSesion = { usuario: { id: 10, permissions: [] }, empresaActiva: { id: 2 }, versionEmpresa: 0, empresas: [] };
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));

jest.mock("../src/navegacion/useContextoDeNavegacion", () => ({
  useContextoDeNavegacion: () => ({ permisos: mockSesion.usuario.permissions, vistas: {} }),
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});

// Sin cámara salvo en las pruebas que la ponen (UX H-15).
jest.mock("../src/activos/camara", () => ({ camaraDisponible: jest.fn(() => null) }));

jest.mock("../src/api/servicios", () => ({
  activosService: {
    panel: jest.fn(),
    listar: jest.fn(),
    historial: jest.fn(),
    detalle: jest.fn(),
    crear: jest.fn(),
    actualizar: jest.fn(),
    tipos: jest.fn(),
    caracteristicas: jest.fn(),
  },
  organizacionService: {
    empleados: jest.fn(),
    todosLosEmpleados: jest.fn(),
    departamentos: jest.fn(),
    sedes: jest.fn(),
    proveedores: jest.fn(),
    concesionarios: jest.fn(),
  },
  mantenimientosService: { listar: jest.fn() },
  solicitudesService: { listar: jest.fn() },
}));

const HOY = hoyIso();

function pagina(results) {
  return { count: results.length, next: null, results };
}

function error(status, code, message, details = null) {
  const e = new Error(message);
  e.response = { status, data: { error: { code, message, details } } };
  return e;
}

/** Sin respuesta del servidor: el cliente marca `esDeRed`. */
function errorDeRed() {
  const e = new Error("Network request failed");
  e.esDeRed = true;
  return e;
}

/** `ActivoDetailSerializer`. */
function detalle(campos = {}) {
  return {
    id: 42,
    codigo_barras: "GA-LAP-000042",
    nombre: "Laptop Dell Latitude",
    tipo: 3,
    tipo_nombre: "Laptop",
    marca: "Dell",
    modelo: "Latitude 5440",
    numero_serie: "SN123",
    especificaciones: { RAM: 16 },
    observaciones: "",
    compartido: false,
    responsables: [{ id: 4, nombre_completo: "Ana Pérez" }],
    responsables_resumen: "Ana Pérez",
    solicitado_por: null,
    departamento: 7,
    departamento_nombre: "Cartera",
    sede: 1,
    sede_nombre: "Matriz Quito",
    criticidad: "media",
    uso: "administrativo",
    estado: "en_uso",
    estado_display: "Asignado",
    esta_operativo: true,
    fecha_adquisicion: "2025-01-15",
    fecha_ingreso: null,
    costo_adquisicion: "1250.00",
    condicion: "",
    propiedad: "propia",
    concesionario: null,
    proveedor: null,
    fecha_fin_garantia: null,
    ...campos,
  };
}

function ficha(campos = {}) {
  return { activo: detalle(campos), movimientos: [], mantenimientos: [], costos: {} };
}

const RAM = { id: 11, nombre: "RAM", dato: "entero", unidad: "GB", opciones: [], obligatoria: true, orden: 1 };
const DISCO = { id: 12, nombre: "Disco", dato: "lista", unidad: "", opciones: ["SSD", "HDD"], obligatoria: false, orden: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  for (const k of Object.keys(mockParametros)) delete mockParametros[k];
  mockPrevenir.activa = false;
  mockPrevenir.alIntentar = null;
  mockSesion.usuario = { id: 10, permissions: ["activos.ver", "activos.crear", "activos.editar"] };
  mockSesion.empresaActiva = { id: 2 };
  activosService.panel.mockResolvedValue({});
  activosService.listar.mockResolvedValue(pagina([]));
  activosService.historial.mockResolvedValue(ficha());
  activosService.detalle.mockResolvedValue(detalle());
  activosService.tipos.mockResolvedValue(
    pagina([
      { id: 3, nombre: "Laptop", codigo: "LAP", activo: true },
      { id: 4, nombre: "Router", codigo: "RTR", activo: true },
      { id: 5, nombre: "Fax", codigo: "FAX", activo: false },
    ]),
  );
  activosService.caracteristicas.mockImplementation(async (tipo) => pagina(String(tipo) === "3" ? [DISCO, RAM] : []));
  organizacionService.departamentos.mockResolvedValue(pagina([{ id: 7, nombre: "Cartera" }, { id: 8, nombre: "Sistemas" }]));
  organizacionService.sedes.mockResolvedValue(pagina([{ id: 1, nombre: "Matriz Quito", ciudad: "Quito" }]));
  organizacionService.proveedores.mockResolvedValue(pagina([{ id: 20, nombre: "Tecnomega" }]));
  organizacionService.concesionarios.mockResolvedValue(pagina([{ id: 30, nombre: "Partner SA" }]));
  organizacionService.empleados.mockResolvedValue(
    pagina([{ id: 4, nombre_completo: "Ana Pérez", codigo_empleado: "E-04", departamento: 7, departamento_nombre: "Cartera" }]),
  );
  organizacionService.todosLosEmpleados.mockResolvedValue(pagina([{ id: 9, nombre_completo: "Luis Mora", activo: false }]));
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** El manejador `nombre` del componente que pinta `elemento`. */
function manejadorDe(elemento, nombre) {
  for (let fibra = elemento.unstable_fiber; fibra; fibra = fibra.return) {
    if (typeof fibra.memoizedProps?.[nombre] === "function") return fibra.memoizedProps[nombre];
  }
  throw new Error(`Sin ${nombre}`);
}

/** Elige una opción de un `SelectorDeLista`. */
async function elegir(testID, valor) {
  await fireEvent.press(await screen.findByTestId(testID));
  await fireEvent.press(screen.getByTestId(`${testID}-opcion-${valor}`));
}

/** El alta con lo obligatorio y una Laptop de 16 GB. */
async function llenarAlta() {
  await render(<PantallaNuevo />);
  await elegir("activo-tipo", "3");
  await fireEvent.changeText(await screen.findByTestId("espec-11"), "16");
  await fireEvent.changeText(screen.getByTestId("activo-nombre"), " Laptop Contabilidad 01 ");
  await fireEvent.changeText(screen.getByTestId("activo-marca"), "Dell");
  await fireEvent.changeText(screen.getByTestId("activo-modelo"), "Latitude 5440");
  await fireEvent.changeText(screen.getByTestId("activo-serie"), "SN999");
  await elegir("activo-area", "7");
  await fireEvent.press(screen.getByTestId("activo-fecha-adquisicion"));
  await fireEvent.press(screen.getByTestId("activo-fecha-adquisicion-listo"));
}

/** Como `llenarAlta`, pero sin esperar las características del tipo. */
async function llenarAltaSinCaracteristicas() {
  await render(<PantallaNuevo />);
  await elegir("activo-tipo", "3");
  await fireEvent.changeText(screen.getByTestId("activo-nombre"), "Laptop");
  await fireEvent.changeText(screen.getByTestId("activo-marca"), "Dell");
  await fireEvent.changeText(screen.getByTestId("activo-modelo"), "Latitude");
  await fireEvent.changeText(screen.getByTestId("activo-serie"), "SN1");
  await elegir("activo-area", "7");
  await fireEvent.press(screen.getByTestId("activo-fecha-adquisicion"));
  await fireEvent.press(screen.getByTestId("activo-fecha-adquisicion-listo"));
}

const CUERPO_MINIMO = {
  tipo: 3,
  nombre: "Laptop Contabilidad 01",
  marca: "Dell",
  modelo: "Latitude 5440",
  numero_serie: "SN999",
  especificaciones: { RAM: 16 },
  observaciones: "",
  sede: null,
  criticidad: "media",
  uso: "administrativo",
  fecha_adquisicion: HOY,
  fecha_ingreso: null,
  costo_adquisicion: null,
  condicion: "",
  propiedad: "propia",
  concesionario: null,
  proveedor: null,
  fecha_fin_garantia: null,
  compartido: false,
  responsables: [],
  departamento: 7,
  solicitado_por: null,
};

// --- CA-1 · Visibilidad -------------------------------------------------------------

describe("dónde se ofrece (CA-1)", () => {
  it("«Registrar activo» en el Panel y en el Inventario con `activos.crear`, y abre el alta en la app", async () => {
    const { unmount } = await render(<GestionDeActivos />);
    await fireEvent.press(await screen.findByTestId("registrar-activo-desde-el-panel"));
    expect(mockRouter.push).toHaveBeenCalledWith("/activos/nuevo");
    // Ya no es un botón redondo al navegador.
    expect(screen.queryByRole("link", { name: "Registrar activo. Abrir en el navegador" })).toBeNull();
    await unmount();

    mockParametros.vista = "inventario";
    await render(<GestionDeActivos />);
    await fireEvent.press(await screen.findByTestId("registrar-activo-desde-el-inventario"));
    expect(mockRouter.push).toHaveBeenLastCalledWith("/activos/nuevo");
  });

  it("sin `activos.crear` no está ni en el Panel ni en el Inventario", async () => {
    mockSesion.usuario = { id: 10, permissions: ["activos.ver"] };
    const { unmount } = await render(<GestionDeActivos />);
    await screen.findByTestId("panel-activos");
    await waitFor(() => expect(activosService.panel).toHaveBeenCalled());
    expect(screen.queryByTestId("registrar-activo-desde-el-panel")).toBeNull();
    await unmount();
    mockParametros.vista = "inventario";
    await render(<GestionDeActivos />);
    await screen.findByTestId("inventario");
    expect(screen.queryByTestId("registrar-activo-desde-el-inventario")).toBeNull();
  });

  it("«Editar» en la ficha con `activos.editar`, entre las acciones; ya no va al navegador", async () => {
    mockParametros.id = "42";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("editar-activo"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/activos/[id]/editar", params: { id: "42" } });
    expect(screen.queryByRole("link", { name: "Editar activo. Abrir en el navegador" })).toBeNull();
    expect(fichaEnLaWeb({ id: 42 }, ["activos.ver", "activos.editar"]).map((a) => a.nombre)).not.toContain("Editar activo");
  });

  it("sin `activos.editar`, o desde un aviso de otra empresa, la ficha no ofrece «Editar»", async () => {
    mockParametros.id = "42";
    mockSesion.usuario = { id: 10, permissions: ["activos.ver"] };
    const { unmount } = await render(<PantallaFicha />);
    await screen.findByTestId("ficha-activo");
    expect(screen.queryByTestId("editar-activo")).toBeNull();
    await unmount();

    mockSesion.usuario = { id: 10, permissions: ["activos.ver", "activos.editar"] };
    mockParametros.empresa = "5";
    await render(<PantallaFicha />);
    await screen.findByTestId("ficha-activo");
    expect(screen.queryByTestId("editar-activo")).toBeNull();
    expect(screen.getByText(/Para editarlo, asignarlo o cambiar su estado/)).toBeTruthy();
  });

  it("sin el permiso, las pantallas lo dicen y no piden nada", async () => {
    mockSesion.usuario = { id: 10, permissions: ["activos.ver"] };
    const { unmount } = await render(<PantallaNuevo />);
    expect(screen.getByText(TEXTO_SIN_PERMISO_REGISTRAR_ACTIVO)).toBeTruthy();
    await unmount();
    mockParametros.id = "42";
    await render(<PantallaEditar />);
    expect(screen.getByText(TEXTO_SIN_PERMISO_EDITAR_ACTIVO)).toBeTruthy();
    expect(activosService.tipos).not.toHaveBeenCalled();
    expect(activosService.detalle).not.toHaveBeenCalled();
  });
});

// --- CA-2 · Registrar ---------------------------------------------------------------

describe("registrar un activo (CA-2, CA-3, CA-5, CA-6)", () => {
  it("envía el cuerpo de la web y abre la ficha nueva anunciando su código y a quién no le llegó el aviso", async () => {
    activosService.crear.mockResolvedValueOnce(
      detalle({ id: 50, codigo_barras: "GA-LAP-000050", aviso: { enviados: 0, sin_correo: ["Luis Mora"], a_quien_registro: true } }),
    );
    await render(<PantallaNuevo />);
    // Los tipos inactivos no se ofrecen, como en la web.
    await fireEvent.press(await screen.findByTestId("activo-tipo"));
    expect(screen.queryByTestId("activo-tipo-opcion-5")).toBeNull();
    await fireEvent.press(screen.getByTestId("activo-tipo-opcion-3"));
    expect(activosService.caracteristicas).toHaveBeenCalledWith("3");
    await fireEvent.changeText(await screen.findByTestId("espec-11"), "16");
    await elegir("espec-12", "SSD");
    await fireEvent.changeText(screen.getByTestId("activo-nombre"), " Laptop Contabilidad 01 ");
    await fireEvent.changeText(screen.getByTestId("activo-marca"), "Dell");
    await fireEvent.changeText(screen.getByTestId("activo-modelo"), "Latitude 5440");
    await fireEvent.changeText(screen.getByTestId("activo-serie"), "SN999");
    // El custodio se busca; el área se propone con la suya.
    await fireEvent.changeText(screen.getByTestId("activo-custodio"), "ana");
    await fireEvent.press(await screen.findByTestId("activo-custodio-4", {}, { timeout: 3000 }));
    expect(organizacionService.empleados).toHaveBeenCalledWith("ana");
    expect(screen.getByTestId("activo-area").props.accessibilityLabel).toMatch(/Elegido: Cartera/);
    // «Lo pidió» nombra también a los inactivos.
    await fireEvent.changeText(screen.getByTestId("activo-solicitante"), "luis");
    await fireEvent.press(await screen.findByTestId("activo-solicitante-9", {}, { timeout: 3000 }));
    expect(organizacionService.todosLosEmpleados).toHaveBeenCalledWith("luis");
    await fireEvent.press(screen.getByTestId("activo-fecha-adquisicion"));
    await fireEvent.press(screen.getByTestId("activo-fecha-adquisicion-listo"));
    // Lo opcional está plegado.
    expect(screen.queryByTestId("activo-costo")).toBeNull();
    await fireEvent.press(screen.getByTestId("mas-compra"));
    await fireEvent.changeText(screen.getByTestId("activo-costo"), "1250,50");
    await fireEvent.press(screen.getByTestId("activo-propiedad-concesion"));
    await elegir("activo-concesionario", "30");
    await fireEvent.press(screen.getByTestId("mas-ubicacion"));
    await elegir("activo-sede", "1");
    await fireEvent.press(screen.getByTestId("activo-criticidad-alta"));
    await fireEvent.press(screen.getByTestId("guardar-activo"));

    await waitFor(() => expect(activosService.crear).toHaveBeenCalledTimes(1));
    expect(activosService.crear).toHaveBeenCalledWith({
      ...CUERPO_MINIMO,
      especificaciones: { RAM: 16, Disco: "SSD" },
      sede: 1,
      criticidad: "alta",
      costo_adquisicion: "1250.50",
      propiedad: "concesion",
      concesionario: 30,
      responsables: [4],
      solicitado_por: 9,
    });
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/activos/[id]", params: { id: "50" } }));

    // La ficha nueva lo anuncia.
    mockParametros.id = "50";
    activosService.historial.mockResolvedValueOnce(ficha({ id: 50, codigo_barras: "GA-LAP-000050" }));
    await render(<PantallaFicha />);
    expect(await screen.findByTestId("resultado-accion")).toHaveTextContent(/Activo registrado con el código GA-LAP-000050\.$/);
    expect(screen.getByTestId("aviso-sin-correo")).toHaveTextContent(
      /Luis Mora no tiene correo en su ficha y no recibió el aviso de que el equipo llegó; le llegó a usted\.$/,
    );
  });

  it("pide lo obligatorio, dicho por el lector de pantalla, y no envía sin ello", async () => {
    await render(<PantallaNuevo />);
    expect((await screen.findByLabelText(/^Nombre del activo \(obligatorio\)/)).props.testID).toBe("activo-nombre");
    expect(screen.getByTestId("activo-fecha-adquisicion").props.accessibilityLabel).toMatch(/^Fecha de adquisición \(obligatorio\): /);
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(
      await screen.findByText(
        "Revise los campos: Tipo de dispositivo, Nombre del activo, Marca, Modelo, Número de serie, Área y Fecha de adquisición.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("activo-area").props.accessibilityLabel).toMatch(/Error: Elija el área del equipo\./);
    expect(activosService.crear).not.toHaveBeenCalled();
  });

  it("las características del tipo: obligatorias y con su formato; cambiar el tipo avisa antes de perderlas", async () => {
    await llenarAlta();
    await fireEvent.changeText(screen.getByTestId("espec-11"), "ocho");
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(await screen.findByText("Revise el campo: Características.")).toBeTruthy();
    expect(screen.getByTestId("espec-11").props.accessibilityLabel).toMatch(/Error: «RAM» es un número entero\./);
    expect(activosService.crear).not.toHaveBeenCalled();

    // Cambiar a otro tipo con algo escrito pregunta; «Mantener el tipo» no cambia nada.
    const alerta = jest.spyOn(Alert, "alert").mockImplementationOnce((_t, _m, botones) => botones[0].onPress());
    await elegir("activo-tipo", "4");
    expect(alerta).toHaveBeenCalledWith(TITULO_CAMBIO_DE_TIPO, expect.stringMatching(/«Laptop \(LAP\)»/), expect.any(Array), expect.any(Object));
    expect(screen.getByTestId("espec-11")).toBeTruthy();

    // «Cambiar el tipo»: el Router no declara nada y vuelven los pares libres.
    alerta.mockImplementationOnce((_t, _m, botones) => botones[1].onPress());
    await elegir("activo-tipo", "4");
    expect(await screen.findByTestId("especificaciones-libres")).toBeTruthy();
    expect(screen.queryByTestId("espec-11")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("espec-libre-clave"), "Puertos");
    await fireEvent.changeText(screen.getByTestId("espec-libre-valor"), "8");
    await fireEvent.press(screen.getByTestId("agregar-espec-libre"));
    activosService.crear.mockResolvedValueOnce(detalle({ id: 51 }));
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    await waitFor(() =>
      expect(activosService.crear).toHaveBeenCalledWith({ ...CUERPO_MINIMO, tipo: 4, especificaciones: { Puertos: "8" } }),
    );
  });

  it("un 400 va junto a su campo (también el de una característica), y arriba qué revisar", async () => {
    activosService.crear.mockRejectedValueOnce(
      error(400, "validation_error", "Error en la solicitud.", {
        numero_serie: ["Ya existe un activo con este número de serie."],
        especificaciones: { RAM: "«RAM» espera un número entero." },
      }),
    );
    await llenarAlta();
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(await screen.findByText("Revise los campos: Número de serie y Características.")).toBeTruthy();
    expect(screen.getByTestId("activo-serie").props.accessibilityLabel).toMatch(/Error: Ya existe un activo con este número de serie\./);
    expect(screen.getByTestId("espec-11").props.accessibilityLabel).toMatch(/Error: «RAM» espera un número entero\./);
    // Al corregir el campo, su error se va.
    await fireEvent.changeText(screen.getByTestId("activo-serie"), "SN1000");
    expect(screen.getByTestId("activo-serie").props.accessibilityLabel).not.toMatch(/Error/);
  });

  it("un 400 de un campo que no se ve (o plegado) abre su bloque o se dice arriba", async () => {
    activosService.crear.mockRejectedValueOnce(
      error(400, "validation_error", "Error en la solicitud.", { concesionario: ["Diga de qué partner es el equipo en concesión."] }),
    );
    await llenarAlta();
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(await screen.findByText("Revise el campo: Concesionario.")).toBeTruthy();
    // «Compra y garantía» se abrió sola.
    expect(screen.getByTestId("activo-costo")).toBeTruthy();
  });

  it("tras «puede haberse guardado», el siguiente envío pregunta antes de repetirlo; un doble toque envía una vez", async () => {
    activosService.crear.mockRejectedValueOnce(errorDeRed()).mockResolvedValueOnce(detalle({ id: 52 }));
    await llenarAlta();
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(await screen.findByText(TEXTO_PUEDE_HABERSE_GUARDADO)).toBeTruthy();

    const alerta = jest.spyOn(Alert, "alert").mockImplementationOnce((_t, _m, botones) => botones[0].onPress());
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(alerta).toHaveBeenCalledWith(TITULO_REENVIO, TEXTO_REENVIO, expect.any(Array), expect.any(Object));
    expect(activosService.crear).toHaveBeenCalledTimes(1);

    alerta.mockImplementation((_t, _m, botones) => botones[1].onPress());
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    await waitFor(() => expect(activosService.crear).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/activos/[id]", params: { id: "52" } }));
  });

  it("salir con cambios pregunta, con el gesto y con «Volver»", async () => {
    await render(<PantallaNuevo />);
    await screen.findByTestId("registrar-activo");
    expect(mockPrevenir.activa).toBe(false);
    await fireEvent.changeText(screen.getByTestId("activo-nombre"), "Laptop");
    expect(mockPrevenir.activa).toBe(true);

    const alerta = jest.spyOn(Alert, "alert").mockImplementationOnce((_t, _m, botones) => botones[0].onPress());
    await act(async () => {
      mockPrevenir.alIntentar({ data: { action: { type: "GO_BACK" } } });
    });
    expect(alerta).toHaveBeenCalledWith("¿Descartar lo que escribió?", expect.any(String), expect.any(Array), expect.any(Object));
    expect(mockNavegacion.dispatch).not.toHaveBeenCalled();

    alerta.mockImplementationOnce((_t, _m, botones) => botones[1].onPress());
    await act(async () => {
      mockPrevenir.alIntentar({ data: { action: { type: "GO_BACK" } } });
    });
    await waitFor(() => expect(mockNavegacion.dispatch).toHaveBeenCalledWith({ type: "GO_BACK" }));
  });

  it("CA-6: un catálogo que exige un permiso que no tiene se explica junto a su campo", async () => {
    organizacionService.departamentos.mockRejectedValueOnce(error(403, "permission_denied", "No tiene el permiso requerido: organizacion.ver."));
    await render(<PantallaNuevo />);
    const area = await screen.findByTestId("activo-area");
    expect(area.props.accessibilityLabel).toMatch(/Error: No tiene el permiso «Ver sedes, departamentos y empleados» de Organización/);
    // Los catálogos se piden de a 100 como mucho y con lo activo (en `servicios.js`); se pueden volver a pedir.
    organizacionService.departamentos.mockResolvedValueOnce(pagina([{ id: 7, nombre: "Cartera" }]));
    await fireEvent.press(screen.getByTestId("recargar-catalogos"));
    await waitFor(() => expect(screen.getByTestId("activo-area").props.accessibilityLabel).not.toMatch(/Error/));
  });
});

// --- CA-4 · Editar ------------------------------------------------------------------

describe("editar un activo (CA-4)", () => {
  beforeEach(() => {
    mockParametros.id = "42";
  });

  it("carga la ficha y envía un PATCH solo con lo que cambió, sin responsables, área ni estado; vuelve a la ficha recargada", async () => {
    activosService.actualizar.mockResolvedValueOnce(detalle({ nombre: "Laptop Gerencia" }));
    await render(<PantallaEditar />);
    expect(await screen.findByTestId("editar-ficha-tecnica")).toBeTruthy();
    expect(activosService.detalle).toHaveBeenCalledWith("42");
    // En la edición no se elige el área ni el custodio.
    expect(organizacionService.departamentos).not.toHaveBeenCalled();
    expect(screen.queryByTestId("activo-area")).toBeNull();
    expect(screen.queryByTestId("activo-custodio")).toBeNull();
    expect(screen.queryByTestId("activo-solicitante")).toBeNull();
    expect(screen.getByTestId("custodia-en-la-ficha")).toHaveTextContent(/Responde: Ana Pérez/);
    expect(screen.getByTestId("activo-nombre").props.value).toBe("Laptop Dell Latitude");
    expect(await screen.findByTestId("espec-11")).toHaveProp("value", "16");

    // UX H-09: lo plegado con datos empieza abierto y sin «(opcional)»;
    // UX H-10: sin título repetido, la línea del código.
    expect(screen.getByTestId("mas-compra").props.accessibilityLabel).toBe("Compra y garantía");
    expect(screen.getByTestId("mas-ubicacion").props.accessibilityState).toEqual({ expanded: true });
    expect(screen.getByTestId("codigo-en-edicion")).toHaveTextContent("GA-LAP-000042 · Laptop Dell Latitude");
    expect(screen.queryByText("Editar ficha técnica")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("activo-nombre"), "Laptop Gerencia");
    await fireEvent.changeText(screen.getByTestId("activo-costo"), "1300");
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    await waitFor(() => expect(activosService.actualizar).toHaveBeenCalledTimes(1));
    const [id, cuerpo] = activosService.actualizar.mock.calls[0];
    expect(id).toBe("42");
    expect(cuerpo).toEqual({ nombre: "Laptop Gerencia", costo_adquisicion: "1300" });
    for (const prohibido of ["responsables", "departamento", "solicitado_por", "estado"]) expect(cuerpo).not.toHaveProperty(prohibido);
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());

    // La ficha, al volver, lo dice y se recarga.
    await render(<PantallaFicha />);
    expect(await screen.findByTestId("resultado-accion")).toHaveTextContent(/Ficha actualizada\.$/);
  });

  it("sin cambios no envía y lo dice como información; con varios responsables «compartido» no se puede quitar", async () => {
    activosService.detalle.mockResolvedValueOnce(
      detalle({ compartido: true, responsables: [{ id: 4, nombre_completo: "Ana Pérez" }, { id: 5, nombre_completo: "Luis Mora" }] }),
    );
    await render(<PantallaEditar />);
    await screen.findByTestId("editar-ficha-tecnica");
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    // UX H-07: información, no error.
    expect(await screen.findByTestId("activo-info")).toHaveTextContent(new RegExp(`${TEXTO_SIN_CAMBIOS_EN_LA_FICHA}$`));
    expect(screen.queryByTestId("activo-error")).toBeNull();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(TEXTO_SIN_CAMBIOS_EN_LA_FICHA);

    // UX H-08: deshabilitada, con el porqué.
    const casilla = screen.getByTestId("activo-compartido");
    expect(casilla.props.accessibilityState).toEqual({ checked: true, disabled: true });
    expect(casilla.props.accessibilityLabel).toMatch(/No se puede quitar: responden por él 2 personas/);
    await fireEvent.press(casilla);
    expect(screen.getByTestId("activo-compartido").props.accessibilityState.checked).toBe(true);
    expect(activosService.actualizar).not.toHaveBeenCalled();
  });

  it("las características que el tipo ya no declara se conservan y se pueden quitar", async () => {
    activosService.detalle.mockResolvedValueOnce(detalle({ especificaciones: { RAM: 16, Color: "Negro" } }));
    activosService.actualizar.mockResolvedValueOnce(detalle());
    await render(<PantallaEditar />);
    expect(await screen.findByTestId("caracteristicas-anteriores")).toHaveTextContent(/Color/);
    await fireEvent.press(screen.getByTestId("quitar-espec-anterior-Color"));
    expect(screen.queryByTestId("caracteristicas-anteriores")).toBeNull();
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    await waitFor(() => expect(activosService.actualizar).toHaveBeenCalledWith("42", { especificaciones: { RAM: 16 } }));
  });

  it("un 404 al cargar lo dice, con «Reintentar»", async () => {
    activosService.detalle.mockRejectedValueOnce(error(404, "not_found", "No encontrado."));
    await render(<PantallaEditar />);
    expect(await screen.findByText("Este activo no existe o ya no tiene acceso a él.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("editar-ficha-tecnica")).toBeTruthy();
  });
});

describe("el cuerpo de la edición (CA-4)", () => {
  it("al cambiar el tipo van también las especificaciones; volver a «De la empresa» borra el partner", () => {
    const iniciales = valoresDeActivo(detalle({ propiedad: "concesion", concesionario: 30 }));
    expect(cuerpoDeEdicion(iniciales, { ...iniciales, tipo: "4" }, [])).toEqual({ tipo: 4, especificaciones: { RAM: 16 } });
    expect(cuerpoDeEdicion(iniciales, { ...iniciales, propiedad: "propia" }, [])).toEqual({ propiedad: "propia", concesionario: null });
  });
});

// --- Ronda de correcciones tras QA (16/11/2026) -------------------------------------

describe("ronda 1: teclado, pendientes, foco y orden (UX H-01 a H-05)", () => {
  it("H-03: serie sin autocorrector, en mayúsculas y sin autocompletar; marca y modelo sin autocorrector", async () => {
    await render(<PantallaNuevo />);
    const serie = await screen.findByTestId("activo-serie");
    expect(serie.props).toEqual(expect.objectContaining({ autoCorrect: false, autoCapitalize: "characters", autoComplete: "off" }));
    expect(serie.props.accessibilityLabel).toMatch(/No se repite en el inventario de la empresa\./);
    expect(screen.getByTestId("activo-marca").props.autoCorrect).toBe(false);
    expect(screen.getByTestId("activo-modelo").props.autoCorrect).toBe(false);
    // Los demás, como siempre.
    expect(screen.getByTestId("activo-nombre").props.autoCorrect).toBeUndefined();
  });

  it("H-05: en el alta, Custodio → Área → «Lo pidió» → Compartido", async () => {
    await render(<PantallaNuevo />);
    await screen.findByTestId("registrar-activo");
    const arbol = JSON.stringify(screen.toJSON());
    const donde = (id) => arbol.indexOf(`"testID":"${id}"`);
    expect(donde("activo-custodio")).toBeGreaterThan(-1);
    expect(donde("activo-custodio")).toBeLessThan(donde("activo-area"));
    expect(donde("activo-area")).toBeLessThan(donde("activo-solicitante"));
    expect(donde("activo-solicitante")).toBeLessThan(donde("activo-compartido"));
  });

  it("H-02: una búsqueda sin elegir a nadie cuenta como cambio y no deja guardar", async () => {
    await render(<PantallaNuevo />);
    await screen.findByTestId("registrar-activo");
    expect(mockPrevenir.activa).toBe(false);
    await fireEvent.changeText(screen.getByTestId("activo-custodio"), "ana");
    expect(mockPrevenir.activa).toBe(true);
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(await screen.findByText(/^Revise los campos: .*Número de serie, Custodio, Área y Fecha de adquisición\.$/)).toBeTruthy();
    expect(screen.getByTestId("activo-custodio").props.accessibilityLabel).toContain(`Error: ${TEXTO_BUSQUEDA_SIN_ELEGIR}`);

    await fireEvent.changeText(screen.getByTestId("activo-solicitante"), "luis");
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    await waitFor(() =>
      expect(screen.getByTestId("activo-solicitante").props.accessibilityLabel).toContain(`Error: ${TEXTO_BUSQUEDA_SIN_ELEGIR}`),
    );
    // Borrar la búsqueda deja de bloquear.
    await fireEvent.changeText(screen.getByTestId("activo-custodio"), "");
    await fireEvent.changeText(screen.getByTestId("activo-solicitante"), "");
    expect(mockPrevenir.activa).toBe(false);
    expect(activosService.crear).not.toHaveBeenCalled();
  });

  it("H-01: una característica libre escrita sin «Agregar» no deja guardar y se dice junto a su campo", async () => {
    await llenarAlta();
    const alerta = jest.spyOn(Alert, "alert").mockImplementationOnce((_t, _m, botones) => botones[1].onPress());
    await elegir("activo-tipo", "4");
    expect(alerta).toHaveBeenCalled();
    await fireEvent.changeText(await screen.findByTestId("espec-libre-clave"), "Puertos");
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(await screen.findByText("Revise el campo: Características.")).toBeTruthy();
    expect(screen.getByTestId("espec-libre-clave").props.accessibilityLabel).toContain(`Error: ${TEXTO_CARACTERISTICA_SIN_AGREGAR}`);
    expect(activosService.crear).not.toHaveBeenCalled();
    // Agregada, se guarda.
    await fireEvent.changeText(screen.getByTestId("espec-libre-valor"), "8");
    await fireEvent.press(screen.getByTestId("agregar-espec-libre"));
    activosService.crear.mockResolvedValueOnce(detalle({ id: 60 }));
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    await waitFor(() => expect(activosService.crear).toHaveBeenCalledWith(expect.objectContaining({ tipo: 4, especificaciones: { Puertos: "8" } })));
  });

  it("H-04: elegir o quitar a una persona lleva el foco al control nuevo; el área propuesta se anuncia y se dice", async () => {
    const foco = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
    await render(<PantallaNuevo />);
    await fireEvent.changeText(await screen.findByTestId("activo-custodio"), "ana");
    await fireEvent.press(await screen.findByTestId("activo-custodio-4", {}, { timeout: 3000 }));
    await waitFor(() => expect(foco).toHaveBeenCalledWith(expect.anything(), "focus"), { timeout: 3000 });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Área propuesta: Cartera. Puede cambiarla.");
    expect(screen.getByTestId("activo-area").props.accessibilityLabel).toContain(TEXTO_AREA_PROPUESTA);

    foco.mockClear();
    await fireEvent.press(screen.getByTestId("activo-custodio-quitar"));
    expect(screen.getByTestId("activo-custodio")).toBeTruthy();
    await waitFor(() => expect(foco).toHaveBeenCalledWith(expect.anything(), "focus"), { timeout: 3000 });

    // Elegir el área a mano quita la ayuda de «propuesta».
    await elegir("activo-area", "8");
    expect(screen.getByTestId("activo-area").props.accessibilityLabel).not.toContain(TEXTO_AREA_PROPUESTA);
  });

  it("QA-TECH P3 #3: el área propuesta limpia su error", async () => {
    await render(<PantallaNuevo />);
    await fireEvent.press(await screen.findByTestId("guardar-activo"));
    await waitFor(() => expect(screen.getByTestId("activo-area").props.accessibilityLabel).toMatch(/Error: Elija el área/));
    await fireEvent.changeText(screen.getByTestId("activo-custodio"), "ana");
    await fireEvent.press(await screen.findByTestId("activo-custodio-4", {}, { timeout: 3000 }));
    expect(screen.getByTestId("activo-area").props.accessibilityLabel).not.toMatch(/Error/);
  });
});

describe("ronda 1: las características mientras cargan (QA-TECH P3 #1, UX H-06)", () => {
  it("con el tipo elegido y sus características cargando, no se envía", async () => {
    activosService.caracteristicas.mockImplementationOnce(() => new Promise(() => {}));
    await render(<PantallaNuevo />);
    await elegir("activo-tipo", "3");
    expect(screen.queryByTestId("especificaciones-libres")).toBeNull();
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(await screen.findByText(TEXTO_CARACTERISTICAS_CARGANDO, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("activo-error")).toHaveTextContent(/Características/);
    expect(activosService.crear).not.toHaveBeenCalled();
  });

  it("si no cargaron, tampoco; con «Reintentar» vuelven", async () => {
    activosService.caracteristicas.mockRejectedValueOnce(error(500, "server_error", "Error interno."));
    await llenarAltaSinCaracteristicas();
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(await screen.findByText(TEXTO_CARACTERISTICAS_SIN_CARGAR, { includeHiddenElements: true })).toBeTruthy();
    expect(activosService.crear).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("espec-11")).toBeTruthy();
  });

  it("la edición no hace parpadear los pares libres mientras pide las características", async () => {
    activosService.caracteristicas.mockImplementationOnce(() => new Promise(() => {}));
    mockParametros.id = "42";
    await render(<PantallaEditar />);
    await screen.findByTestId("editar-ficha-tecnica");
    expect(screen.queryByTestId("especificaciones-libres")).toBeNull();
    expect(screen.getByText("Cargando las características del tipo…")).toBeTruthy();
  });

  it("QA-TECH P3 #2: escribir una característica limpia también el error general", async () => {
    await llenarAlta();
    activosService.crear.mockRejectedValueOnce(
      error(400, "validation_error", "Error en la solicitud.", { especificaciones: ["Las especificaciones deben ser un objeto."] }),
    );
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(await screen.findByText("Las especificaciones deben ser un objeto.", { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("espec-11"), "32");
    expect(screen.queryByText("Las especificaciones deben ser un objeto.", { includeHiddenElements: true })).toBeNull();
  });
});

describe("ronda 1: salir mientras se guarda (QA-FUNC B-2, QA-TECH P3 #5)", () => {
  it("con el envío en curso no sale: avisa «Guardando…»", async () => {
    let resolver;
    activosService.crear.mockReturnValueOnce(new Promise((r) => (resolver = r)));
    await llenarAlta();
    // Con la petición en vuelo, el toque va por `act` y no por `fireEvent`
    // (como `activosTandaB.test.js`).
    const guardar = manejadorDe(screen.getByTestId("guardar-activo"), "onPress");
    await act(async () => {
      guardar();
    });
    expect(activosService.crear).toHaveBeenCalled();
    expect(mockPrevenir.activa).toBe(true);
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await act(async () => {
      mockPrevenir.alIntentar({ data: { action: { type: "GO_BACK" } } });
    });
    expect(alerta).toHaveBeenCalledWith(TITULO_GUARDANDO, TEXTO_GUARDANDO);
    expect(mockNavegacion.dispatch).not.toHaveBeenCalled();
    await act(async () => {
      resolver(detalle({ id: 70 }));
    });
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/activos/[id]", params: { id: "70" } }));
    expect(mockPrevenir.activa).toBe(false);
  });
});

describe("ronda 1: comportamiento fijado (QA-FUNC B-3)", () => {
  it("el PATCH con una sede ya cerrada, cambiando solo el nombre, no envía la sede", async () => {
    mockParametros.id = "42";
    activosService.detalle.mockResolvedValueOnce(detalle({ sede: 99, sede_nombre: "Sede cerrada" }));
    activosService.actualizar.mockResolvedValueOnce(detalle());
    await render(<PantallaEditar />);
    expect((await screen.findByTestId("activo-sede")).props.accessibilityLabel).toMatch(/Elegido: Sede cerrada/);
    await fireEvent.changeText(screen.getByTestId("activo-nombre"), "Laptop Gerencia");
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    await waitFor(() => expect(activosService.actualizar).toHaveBeenCalledWith("42", { nombre: "Laptop Gerencia" }));
  });

  it("una adquisición posterior al ingreso guardado da error en el ingreso y no se envía", async () => {
    mockParametros.id = "42";
    activosService.detalle.mockResolvedValueOnce(detalle({ fecha_adquisicion: "2025-01-15", fecha_ingreso: "2025-02-01" }));
    await render(<PantallaEditar />);
    await fireEvent.press(await screen.findByTestId("activo-fecha-adquisicion"));
    // El calendario de iOS: tocar un día lo elige.
    await act(async () => {
      screen.getByTestId("selector-nativo").props.onValueChange(null, new Date(2025, 5, 1));
    });
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(await screen.findByText("Revise el campo: Fecha de ingreso.")).toBeTruthy();
    expect(screen.getByTestId("activo-fecha-ingreso").props.accessibilityLabel).toMatch(
      /Error: El ingreso al inventario no puede ser anterior a la adquisición\./,
    );
    expect(activosService.actualizar).not.toHaveBeenCalled();
  });

  it("cambiar de tipo con características heredadas envía `tipo` y `especificaciones`", async () => {
    mockParametros.id = "42";
    activosService.detalle.mockResolvedValueOnce(detalle({ especificaciones: { RAM: 16, Color: "Negro" } }));
    activosService.actualizar.mockResolvedValueOnce(detalle());
    await render(<PantallaEditar />);
    await screen.findByTestId("caracteristicas-anteriores");
    await elegir("activo-tipo", "4");
    expect(await screen.findByTestId("especificaciones-libres")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    await waitFor(() =>
      expect(activosService.actualizar).toHaveBeenCalledWith("42", { tipo: 4, especificaciones: { RAM: 16, Color: "Negro" } }),
    );
  });

  it("«En concesión» sin partner da error", async () => {
    await llenarAlta();
    await fireEvent.press(screen.getByTestId("mas-compra"));
    await fireEvent.press(screen.getByTestId("activo-propiedad-concesion"));
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(await screen.findByText("Revise el campo: Concesionario.")).toBeTruthy();
    expect(screen.getByTestId("activo-concesionario").props.accessibilityLabel).toContain(`Error: ${TEXTO_CONCESIONARIO}`);
    expect(activosService.crear).not.toHaveBeenCalled();
  });

  it("un costo inválido da error: «-5», «1.250,50» u 11 enteros", async () => {
    await llenarAlta();
    await fireEvent.press(screen.getByTestId("mas-compra"));
    for (const costo of ["-5", "1.250,50", "12345678901"]) {
      await fireEvent.changeText(screen.getByTestId("activo-costo"), costo);
      await fireEvent.press(screen.getByTestId("guardar-activo"));
      await waitFor(() => expect(screen.getByTestId("activo-costo").props.accessibilityLabel).toMatch(/Error: Escriba un monto/));
    }
    expect(activosService.crear).not.toHaveBeenCalled();
  });

  it("un 500 en el alta se dice arriba, no es «puede haberse guardado» y conserva el formulario", async () => {
    activosService.crear
      .mockRejectedValueOnce(error(500, "server_error", "Error interno del servidor."))
      .mockResolvedValueOnce(detalle({ id: 80 }));
    await llenarAlta();
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    expect(await screen.findByTestId("activo-error")).toHaveTextContent(/Error interno del servidor\.$/);
    expect(screen.queryByText(TEXTO_PUEDE_HABERSE_GUARDADO)).toBeNull();
    expect(screen.getByTestId("activo-nombre").props.value).toBe(" Laptop Contabilidad 01 ");
    expect(screen.getByTestId("espec-11").props.value).toBe("16");
    // El siguiente envío no pregunta: no hubo duda.
    const alerta = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByTestId("guardar-activo"));
    await waitFor(() => expect(activosService.crear).toHaveBeenCalledTimes(2));
    expect(alerta).not.toHaveBeenCalledWith(TITULO_REENVIO, expect.anything(), expect.anything(), expect.anything());
  });
});

describe("ronda 1: escanear el número de serie (UX H-15)", () => {
  const camara = require("expo-camera");
  let permisoOriginal;
  beforeEach(() => {
    permisoOriginal = camara.__estado.permiso;
    camaraDisponible.mockReturnValue({ CameraView: camara.CameraView, useCameraPermissions: camara.useCameraPermissions });
  });
  afterEach(() => {
    camara.__estado.permiso = permisoOriginal;
    camaraDisponible.mockReturnValue(null);
  });

  it("el botón está junto a la serie con la cámara, en el alta y en la edición; sin ella no", async () => {
    const { unmount } = await render(<PantallaNuevo />);
    expect((await screen.findByTestId("escanear-serie")).props.accessibilityLabel).toBe(ETIQUETA_ESCANEAR_SERIE);
    await unmount();
    mockParametros.id = "42";
    const segunda = await render(<PantallaEditar />);
    expect(await screen.findByTestId("escanear-serie")).toBeTruthy();
    await segunda.unmount();
    camaraDisponible.mockReturnValue(null);
    await render(<PantallaNuevo />);
    await screen.findByTestId("activo-serie");
    expect(screen.queryByTestId("escanear-serie")).toBeNull();
  });

  it("leer rellena el campo limpio, limpia su error, lo anuncia, cuenta como cambio y cierra la ventana", async () => {
    await render(<PantallaNuevo />);
    await fireEvent.press(await screen.findByTestId("guardar-activo"));
    await waitFor(() => expect(screen.getByTestId("activo-serie").props.accessibilityLabel).toMatch(/Error/));
    expect(mockPrevenir.activa).toBe(false);
    await fireEvent.press(screen.getByTestId("escanear-serie"));
    expect(screen.getByText(TEXTO_INSTRUCCION_SERIE)).toBeTruthy();
    expect(await screen.findByTestId("serie-camara")).toBeTruthy();
    expect(camara.__estado.ajustes).toEqual({ barcodeTypes: TIPOS_DE_ETIQUETA_DE_FABRICANTE });
    await act(async () => {
      camara.__leer("  5CD1234XYZ\n  ", "code128");
      // Un segundo código no hace nada: la ventana ya se cerró.
      camara.__leer("OTRO", "code128");
    });
    expect(screen.queryByTestId("ventana-serie")).toBeNull();
    expect(screen.getByTestId("activo-serie").props.value).toBe("5CD1234XYZ");
    expect(screen.getByTestId("activo-serie").props.accessibilityLabel).not.toMatch(/Error/);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Número de serie leído: 5CD1234XYZ");
    expect(mockPrevenir.activa).toBe(true);
  });

  it("lo leído se recorta al largo del campo (120)", async () => {
    await render(<PantallaNuevo />);
    await fireEvent.press(await screen.findByTestId("escanear-serie"));
    await screen.findByTestId("serie-camara");
    await act(async () => {
      camara.__leer("A".repeat(150));
    });
    expect(screen.getByTestId("activo-serie").props.value).toHaveLength(120);
  });

  it("«Cancelar» cierra sin cambiar el campo", async () => {
    await render(<PantallaNuevo />);
    await fireEvent.changeText(await screen.findByTestId("activo-serie"), "SN1");
    await fireEvent.press(screen.getByTestId("escanear-serie"));
    await screen.findByTestId("serie-camara");
    await fireEvent.press(screen.getByTestId("cancelar-serie"));
    expect(screen.queryByTestId("ventana-serie")).toBeNull();
    expect(screen.getByTestId("activo-serie").props.value).toBe("SN1");
  });

  it("sin permiso de cámara lo explica y ofrece abrir los ajustes; sin decidir, lo pide al abrir", async () => {
    camara.__estado.permiso = { granted: false, canAskAgain: false, status: "denied" };
    const { unmount } = await render(<PantallaNuevo />);
    await fireEvent.press(await screen.findByTestId("escanear-serie"));
    expect(await screen.findByText(TEXTO_SIN_PERMISO_CAMARA_SERIE)).toBeTruthy();
    expect(screen.getByTestId("serie-abrir-ajustes")).toBeTruthy();
    expect(screen.queryByTestId("serie-camara")).toBeNull();
    await unmount();

    camara.__estado.permiso = { granted: false, canAskAgain: true, status: "undetermined" };
    camara.__pedir.mockClear();
    await render(<PantallaNuevo />);
    await fireEvent.press(await screen.findByTestId("escanear-serie"));
    await waitFor(() => expect(camara.__pedir).toHaveBeenCalledTimes(1));
  });
});
