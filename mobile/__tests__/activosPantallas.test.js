import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { AccessibilityInfo, Alert, AppState } from "react-native";

import { activosService, organizacionService, solicitudesService } from "../src/api/servicios";
import { camaraDisponible } from "../src/activos/camara";
import {
  TEXTO_CODIGO_NO_ENCONTRADO,
  TEXTO_MODULO_APAGADO,
  TEXTO_MOTIVO_OBLIGATORIO,
  TEXTO_NO_DISPONIBLE,
  TEXTO_PUEDE_HABERSE_GUARDADO,
} from "../src/activos/formato";
import { confirmarSalida } from "../src/navegador/confirmarSalida";
import { TEXTO_SIN_CAMBIOS } from "../src/pantallas/activos/AccionesDelActivo";
import { Escaner, TEXTO_SIN_CAMARA, TEXTO_SIN_PERMISO_CAMARA } from "../src/pantallas/activos/Escaner";
import { GestionDeActivos, TEXTO_AVISO_SIN_ACCESO } from "../src/pantallas/activos/GestionDeActivos";
import { TEXTO_REENVIO, TITULO_REENVIO } from "../src/pantallas/activos/formularios";
import PantallaFicha from "../src/app/(app)/activos/[id]";
import PantallaRegistrar from "../src/app/(app)/mantenimientos/nuevo";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };
const mockParametros = {};
/** Si la pantalla está enfocada (QA-TECH P2: la cámara se apaga sin foco). */
const mockEnfocada = { valor: true };
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useNavigation: () => ({ setOptions: jest.fn(), dispatch: jest.fn() }),
    usePreventRemove: () => {},
    useLocalSearchParams: () => mockParametros,
    useIsFocused: () => mockEnfocada.valor,
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

const mockSesion = {
  usuario: { permissions: [] },
  empresaActiva: { id: 2 },
  versionEmpresa: 0,
  empresas: [],
  cambiarEmpresaSiEsSuya: jest.fn(async () => true),
};
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));

jest.mock("../src/navegacion/useContextoDeNavegacion", () => ({
  useContextoDeNavegacion: () => ({ permisos: mockSesion.usuario.permissions, vistas: {} }),
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});

jest.mock("../src/activos/camara", () => ({ camaraDisponible: jest.fn(() => null) }));

jest.mock("../src/api/servicios", () => ({
  activosService: {
    panel: jest.fn(),
    listar: jest.fn(),
    historial: jest.fn(),
    porCodigo: jest.fn(),
    asignar: jest.fn(),
    cambiarEstado: jest.fn(),
  },
  organizacionService: {
    empleados: jest.fn(),
    departamentos: jest.fn(),
    sedes: jest.fn(),
  },
  mantenimientosService: { listar: jest.fn() },
  solicitudesService: { listar: jest.fn() },
}));

const TODOS = ["activos.ver", "activos.asignar", "activos.dar_baja", "activos.editar", "mantenimientos.registrar"];

function error(status, code, message, details = null) {
  const e = new Error(message);
  e.response = { status, data: { error: { code, message, details } } };
  return e;
}

/** Una fila de `ActivoListSerializer`. */
function fila(campos = {}) {
  return {
    id: 42,
    codigo_barras: "GA-LAP-000042",
    nombre: "Laptop Dell Latitude",
    tipo_nombre: "Laptop",
    marca: "Dell",
    modelo: "Latitude 5440",
    numero_serie: "SN123",
    compartido: false,
    responsables: [{ id: 4, nombre_completo: "Ana Pérez", codigo_empleado: "E-04", activo: true, recibe_avisos: true }],
    responsables_resumen: "Ana Pérez",
    departamento: 7,
    departamento_nombre: "Cartera",
    sede: 1,
    sede_nombre: "Matriz Quito",
    ciudad: "Quito",
    estado: "en_uso",
    estado_display: "Asignado",
    esta_operativo: true,
    ...campos,
  };
}

/** La respuesta de `historial/` y `por-codigo/`. */
function ficha(campos = {}) {
  return {
    activo: {
      ...fila(),
      criticidad_display: "Media",
      uso_display: "Administrativo",
      propiedad_display: "De la empresa",
      condicion_display: "",
      fecha_adquisicion: "2025-01-15",
      costo_adquisicion: "1250.00",
      estado_garantia: "por_vencer",
      estado_garantia_display: "Garantía por vencer",
      fecha_fin_garantia: "2026-12-01",
      dias_para_fin_de_garantia: 15,
      ...campos,
    },
    movimientos: [
      {
        id: 5,
        tipo: "asignacion",
        tipo_display: "Asignación de custodio",
        custodio_anterior_nombre: null,
        custodio_nuevo_nombre: "Ana Pérez",
        estado_anterior: "en_bodega",
        estado_nuevo: "en_uso",
        motivo: "Ingreso",
        registrado_por_nombre: "tecnico1",
        created_at: "2026-10-02T15:00:00Z",
      },
    ],
    mantenimientos: [
      {
        id: 1,
        tipo: "preventivo",
        tipo_display: "Preventivo",
        fecha_intervencion: "2026-09-01",
        fecha_salida: "2026-09-02",
        dias_fuera_de_operacion: 1,
        estado_final_display: "Reparado",
        descripcion: "Limpieza",
        costo_total: "20.00",
        registrado_por_nombre: "tecnico1",
      },
      {
        id: 2,
        tipo: "correctivo",
        tipo_display: "Correctivo",
        fecha_intervencion: "2026-11-10",
        fecha_salida: null,
        descripcion: "No enciende",
        costo_total: "0.00",
      },
    ],
    costos: { costo_mano_obra: "20.00", costo_repuestos: "0.00", costo_total: "20.00", mantenimientos_por_tipo: { preventivo: 1 } },
  };
}

const PANEL = {
  activos: { total: 120, en_uso: 80, disponibles: 10, en_bodega: 5, en_mantenimiento: 3, perdidos: 1, robados: 0 },
  mantenimientos: { del_mes: 4, total_historico: 50, costo_del_mes: "150.50", costo_acumulado: "2300.00" },
  garantias: { vencidas: 2, por_vencer: 0, dias_de_aviso: 30 },
  fuera_de_operacion: { total_dias: 40, intervenciones_abiertas: 3, intervenciones_cerradas: 47 },
  equipos_mas_reparados: [
    { id: 42, codigo_barras: "GA-LAP-000042", nombre: "Laptop Dell", tipo: "Laptop", departamento: "Cartera", total_mantenimientos: 6 },
  ],
};

function pagina(results, next = null) {
  return { count: results.length + (next ? 20 : 0), next, results };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  for (const k of Object.keys(mockParametros)) delete mockParametros[k];
  mockSesion.usuario = { permissions: TODOS };
  mockSesion.empresaActiva = { id: 2 };
  mockSesion.versionEmpresa = 0;
  mockSesion.empresas = [{ id: 2, nombre: "Laar Ecuador" }];
  mockEnfocada.valor = true;
  camaraDisponible.mockReturnValue(null);
  activosService.panel.mockResolvedValue(PANEL);
  activosService.listar.mockResolvedValue(pagina([fila()]));
  activosService.historial.mockResolvedValue(ficha());
  organizacionService.departamentos.mockResolvedValue({
    results: [
      { id: 7, nombre: "Cartera" },
      { id: 8, nombre: "Sistemas" },
    ],
  });
  organizacionService.sedes.mockResolvedValue({
    results: [
      { id: 1, nombre: "Matriz Quito", ciudad: "Quito" },
      { id: 3, nombre: "Guayaquil", ciudad: "Guayaquil" },
    ],
  });
  organizacionService.empleados.mockResolvedValue({
    results: [
      { id: 9, nombre_completo: "Luis Mora", codigo_empleado: "E-09", cargo: "Analista", departamento: 8, departamento_nombre: "Sistemas" },
    ],
  });
});

describe("el módulo (CA-1)", () => {
  it("abre el Panel por defecto, con su título", async () => {
    await render(<GestionDeActivos />);
    expect(await screen.findByTestId("activos-panel")).toBeTruthy();
    expect(screen.getByRole("header", { name: "Panel" })).toBeTruthy();
  });

  it("Recibidas (Tanda B) es la lista de `ambito=recibidas`, sin pedir el panel", async () => {
    mockSesion.usuario = { permissions: ["mantenimientos.ver", "solicitudes.ver", "solicitudes.gestionar"] };
    mockParametros.vista = "recibidas";
    solicitudesService.listar.mockResolvedValue({ count: 0, next: null, results: [] });
    await render(<GestionDeActivos />);
    expect(await screen.findByTestId("solicitudes-recibidas")).toBeTruthy();
    expect(solicitudesService.listar).toHaveBeenCalledWith(expect.objectContaining({ ambito: "recibidas", abiertas: "true" }));
    expect(activosService.panel).not.toHaveBeenCalled();
  });

  it("«Registrar mantenimiento» sin el activo empieza por elegir el equipo (Tanda B)", async () => {
    await render(<PantallaRegistrar />);
    expect(screen.getByTestId("buscar-equipo")).toBeTruthy();
    expect(activosService.historial).not.toHaveBeenCalled();
  });
});

describe("el Panel (CA-3 a CA-5)", () => {
  it("las cuatro tarjetas con su cifra y su nombre accesible; cada una abre el inventario filtrado", async () => {
    await render(<GestionDeActivos />);
    const tarjetas = await screen.findByTestId("kpis-activos");
    expect(within(tarjetas).getByRole("button", { name: "Registrados: 120" })).toBeTruthy();
    expect(within(tarjetas).getByRole("button", { name: "Asignados: 80" })).toBeTruthy();
    expect(within(tarjetas).getByRole("button", { name: "En almacén: 15. 10 disponibles y 5 en bodega" })).toBeTruthy();
    await fireEvent.press(within(tarjetas).getByRole("button", { name: "En reparación: 3" }));
    expect(mockRouter.setParams).toHaveBeenCalledWith(expect.objectContaining({ vista: "inventario", filtro: "reparacion" }));
    await fireEvent.press(screen.getByTestId("kpi-registrados"));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ vista: "inventario", filtro: "todos" }));
  });

  it("mantenimientos, fuera de operación, alertas con número y el top que abre la ficha", async () => {
    await render(<GestionDeActivos />);
    await screen.findByTestId("kpis-activos");
    expect(screen.getByLabelText("Este mes: 4")).toBeTruthy();
    expect(screen.getByLabelText("Costo del mes: $150,50")).toBeTruthy();
    expect(screen.getByLabelText("Costo acumulado: $2.300,00")).toBeTruthy();
    expect(screen.getByLabelText("Intervenciones abiertas: 3")).toBeTruthy();
    expect(screen.getByLabelText("Garantía vencida: 2 equipos")).toBeTruthy();
    expect(screen.getByLabelText("Perdidos o robados: 1 equipo")).toBeTruthy();
    expect(screen.queryByTestId("alerta-reemplazo")).toBeNull();
    await fireEvent.press(screen.getByTestId("reparado-42"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/activos/[id]", params: { id: "42" } });
  });

  it("CA-2: el módulo apagado se dice claro, con «Reintentar»", async () => {
    activosService.panel.mockRejectedValueOnce(error(403, "modulo_apagado", "Este módulo está apagado en la empresa."));
    await render(<GestionDeActivos />);
    expect(await screen.findByText(TEXTO_MODULO_APAGADO)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("kpis-activos")).toBeTruthy();
  });

  it("lo de la web en botones redondos que preguntan antes de salir (CA-10)", async () => {
    mockSesion.usuario = { permissions: ["activos.ver", "activos.crear"] };
    await render(<GestionDeActivos />);
    await screen.findByTestId("kpis-activos");
    await fireEvent.press(screen.getByRole("link", { name: "Registrar activo. Abrir en el navegador" }));
    expect(confirmarSalida).toHaveBeenCalled();
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/activos\/new\?empresa=2$/)));
  });
});

describe("el Inventario (CA-6)", () => {
  beforeEach(() => {
    mockParametros.vista = "inventario";
  });

  it("la fila con código, nombre, tipo, estado (texto), responsable y lugar; abre la ficha", async () => {
    await render(<GestionDeActivos />);
    const filaActivo = await screen.findByTestId("activo-42");
    expect(within(filaActivo).getByText("GA-LAP-000042")).toBeTruthy();
    expect(within(filaActivo).getByText("Asignado")).toBeTruthy();
    expect(within(filaActivo).getByText("Cartera · Matriz Quito")).toBeTruthy();
    expect(screen.getByTestId("total-de-activos")).toHaveTextContent("1 activo");
    expect(activosService.listar).toHaveBeenCalledWith({ page: 1 });
    await fireEvent.press(filaActivo);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/activos/[id]", params: { id: "42" } });
  });

  it("el filtro de la tarjeta del panel y los chips", async () => {
    mockParametros.filtro = "almacen";
    await render(<GestionDeActivos />);
    await screen.findByTestId("activo-42");
    expect(activosService.listar).toHaveBeenLastCalledWith({ almacenados: "true", page: 1 });
    expect(screen.getByRole("tab", { name: "En almacén" }).props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByRole("tab", { name: "Fuera de inventario" }));
    await waitFor(() => expect(activosService.listar).toHaveBeenLastCalledWith({ operativos: "false", page: 1 }));
  });

  it("la búsqueda espera 400 ms y va en `q`", async () => {
    await render(<GestionDeActivos />);
    await screen.findByTestId("activo-42");
    jest.useFakeTimers();
    try {
      await fireEvent.changeText(screen.getByTestId("buscar-activo"), "dell");
      await act(async () => {
        jest.advanceTimersByTime(399);
      });
      expect(activosService.listar).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
    } finally {
      jest.useRealTimers();
    }
    await waitFor(() => expect(activosService.listar).toHaveBeenLastCalledWith({ q: "dell", page: 1 }));
  });

  it("«Ver más» pide la página siguiente y no repite filas", async () => {
    activosService.listar
      .mockResolvedValueOnce(pagina([fila()], "https://api/activos/?page=2"))
      .mockResolvedValueOnce(pagina([fila(), fila({ id: 43, codigo_barras: "GA-LAP-000043" })]));
    await render(<GestionDeActivos />);
    await screen.findByTestId("activo-42");
    await fireEvent.press(screen.getByTestId("ver-mas"));
    expect(await screen.findByTestId("activo-43")).toBeTruthy();
    expect(activosService.listar).toHaveBeenLastCalledWith({ page: 2 });
    expect(screen.getAllByTestId("activo-42")).toHaveLength(1);
  });

  it("vacío y error con «Reintentar»", async () => {
    activosService.listar.mockResolvedValueOnce(pagina([]));
    const { unmount } = await render(<GestionDeActivos />);
    expect(await screen.findByText("No hay activos con este filtro.")).toBeTruthy();
    await unmount();
    activosService.listar.mockRejectedValueOnce(Object.assign(new Error("red"), { esDeRed: true }));
    await render(<GestionDeActivos />);
    expect(await screen.findByText(/No se pudo conectar/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("activo-42")).toBeTruthy();
  });
});

describe("la ficha (CA-7)", () => {
  it("datos, garantía, responsables, bitácora (abiertos primero) y costos", async () => {
    mockParametros.id = "42";
    await render(<PantallaFicha />);
    expect(await screen.findByRole("header", { name: "Laptop Dell Latitude" })).toBeTruthy();
    expect(activosService.historial).toHaveBeenCalledWith("42", { empresa: undefined });
    expect(screen.getByLabelText("Número de serie: SN123")).toBeTruthy();
    expect(screen.getByText("Garantía por vencer")).toBeTruthy();
    expect(screen.getByText("Quedan 15 días")).toBeTruthy();
    expect(screen.getByLabelText("Ana Pérez, código E-04")).toBeTruthy();
    const bitacora = screen.getByTestId("bitacora-mantenimientos");
    const filas = within(bitacora).getAllByTestId(/^mantenimiento-/);
    expect(filas.map((f) => f.props.testID)).toEqual(["mantenimiento-2", "mantenimiento-1"]);
    expect(within(filas[0]).getByText("Abierto")).toBeTruthy();
    expect(within(screen.getByTestId("bitacora-movimientos")).getByText("Responsable: ninguno → Ana Pérez")).toBeTruthy();
    expect(screen.getByLabelText("Total invertido: $20,00")).toBeTruthy();
  });

  it("las acciones según los permisos; fuera de inventario no se asigna", async () => {
    mockParametros.id = "42";
    mockSesion.usuario = { permissions: ["activos.ver"] };
    const { unmount } = await render(<PantallaFicha />);
    await screen.findByTestId("ficha-activo");
    expect(screen.queryByTestId("asignar")).toBeNull();
    expect(screen.queryByTestId("cambiar-estado")).toBeNull();
    await unmount();
    mockSesion.usuario = { permissions: TODOS };
    activosService.historial.mockResolvedValueOnce(ficha({ estado: "perdido", esta_operativo: false }));
    await render(<PantallaFicha />);
    await screen.findByTestId("ficha-activo");
    expect(screen.queryByTestId("asignar")).toBeNull();
    expect(screen.queryByTestId("registrar-mantenimiento")).toBeNull();
    expect(screen.getByTestId("cambiar-estado")).toBeTruthy();
  });

  it("de un aviso de otra empresa: la pide con su X-Empresa y no ofrece acciones", async () => {
    mockParametros.id = "42";
    mockParametros.empresa = "5";
    await render(<PantallaFicha />);
    await screen.findByTestId("ficha-activo");
    expect(activosService.historial).toHaveBeenCalledWith("42", { empresa: "5" });
    expect(screen.queryByTestId("asignar")).toBeNull();
    expect(screen.getByText(/es de otra empresa/)).toBeTruthy();
  });

  it("un 404 dice que no existe; un ID raro no consulta", async () => {
    mockParametros.id = "42";
    activosService.historial.mockRejectedValueOnce(error(404, "not_found", "No encontrado."));
    const { unmount } = await render(<PantallaFicha />);
    expect(await screen.findByText(TEXTO_NO_DISPONIBLE)).toBeTruthy();
    await unmount();
    mockParametros.id = "abc";
    activosService.historial.mockClear();
    await render(<PantallaFicha />);
    expect(screen.getByText(TEXTO_NO_DISPONIBLE)).toBeTruthy();
    expect(activosService.historial).not.toHaveBeenCalled();
  });

  it("«Registrar mantenimiento» va a su ruta con el activo", async () => {
    mockParametros.id = "42";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("registrar-mantenimiento"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/mantenimientos/nuevo", params: { activo: "42" } });
  });
});

describe("asignar (CA-8)", () => {
  async function abrirAsignar() {
    mockParametros.id = "42";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("asignar"));
    await screen.findByTestId("ventana-asignar");
    await waitFor(() => expect(organizacionService.sedes).toHaveBeenCalled());
  }

  it("elige a otra persona con el buscador, propone su área, envía y recarga la ficha anunciándolo", async () => {
    activosService.asignar.mockResolvedValueOnce(fila());
    await abrirAsignar();
    await fireEvent.changeText(screen.getByTestId("buscar-empleado"), "luis");
    await fireEvent.press(await screen.findByTestId("empleado-9", {}, { timeout: 3000 }));
    expect(organizacionService.empleados).toHaveBeenCalledWith("luis");
    expect(screen.getByTestId("responsable-9")).toBeTruthy();
    expect(screen.queryByTestId("responsable-4")).toBeNull();
    expect(screen.getByTestId("asignar-resumen")).toHaveTextContent(/quién responde/);
    await fireEvent.changeText(screen.getByTestId("asignar-motivo"), "Rotación");
    await fireEvent.press(screen.getByTestId("guardar-asignacion"));
    await waitFor(() =>
      expect(activosService.asignar).toHaveBeenCalledWith(42, { responsables: [9], departamento: 8, sede: 1, motivo: "Rotación" }),
    );
    expect(await screen.findByTestId("resultado-accion")).toHaveTextContent(/Movimiento registrado/);
    expect(screen.queryByTestId("ventana-asignar")).toBeNull();
    expect(activosService.historial).toHaveBeenCalledTimes(2);
  });

  it("sin cambios no envía; quitar a todos es devolver a bodega", async () => {
    activosService.asignar.mockResolvedValueOnce(fila());
    await abrirAsignar();
    await fireEvent.press(screen.getByTestId("guardar-asignacion"));
    expect(await screen.findByText(TEXTO_SIN_CAMBIOS)).toBeTruthy();
    expect(activosService.asignar).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Quitar a Ana Pérez" }));
    expect(screen.getByTestId("asignar-resumen")).toHaveTextContent(/Devolución a bodega/);
    await fireEvent.press(screen.getByTestId("guardar-asignacion"));
    await waitFor(() => expect(activosService.asignar).toHaveBeenCalledWith(42, expect.objectContaining({ responsables: [] })));
  });

  it("los errores 400 van junto a su campo", async () => {
    activosService.asignar.mockRejectedValueOnce(
      error(400, "validation_error", "Error en la solicitud.", { sede: ["La sede no está activa."] }),
    );
    await abrirAsignar();
    await fireEvent.press(screen.getByTestId("asignar-sede"));
    await fireEvent.press(screen.getByTestId("asignar-sede-opcion-3"));
    await fireEvent.press(screen.getByTestId("guardar-asignacion"));
    expect(await screen.findByText("Revise el campo: Sede.")).toBeTruthy();
    // El texto del campo está oculto al lector (se dice en el campo).
    expect(screen.getByText("La sede no está activa.", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("asignar-sede").props.accessibilityLabel).toMatch(/Error: La sede no está activa\./);
    expect(screen.getByTestId("ventana-asignar")).toBeTruthy();
  });

  it("al cerrar con cambios pregunta antes de descartar", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => botones[0].onPress());
    await abrirAsignar();
    await fireEvent.changeText(screen.getByTestId("asignar-motivo"), "algo");
    await fireEvent.press(screen.getByTestId("cancelar-asignacion"));
    expect(alerta).toHaveBeenCalledWith("¿Descartar lo que escribió?", expect.any(String), expect.any(Array), expect.any(Object));
    expect(screen.getByTestId("ventana-asignar")).toBeTruthy();
    alerta.mockRestore();
  });
});

describe("cambiar estado (CA-9)", () => {
  async function abrirEstado() {
    mockParametros.id = "42";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("cambiar-estado"));
    await screen.findByTestId("ventana-estado");
  }

  it("perdido sin motivo no se envía; con motivo pregunta y envía", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => botones.find((b) => b.style === "destructive").onPress());
    activosService.cambiarEstado.mockResolvedValueOnce({ ...fila(), estado: "perdido", estado_display: "Perdido" });
    await abrirEstado();
    await fireEvent.press(screen.getByTestId("nuevo-estado-perdido"));
    expect(screen.getByTestId("advertencia-salida")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("guardar-estado"));
    expect(await screen.findByText(TEXTO_MOTIVO_OBLIGATORIO, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("estado-motivo").props.accessibilityLabel).toMatch(/Error: Escriba el motivo/);
    expect(activosService.cambiarEstado).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId("estado-motivo"), "Se extravió en el andén");
    await fireEvent.press(screen.getByTestId("guardar-estado"));
    await waitFor(() =>
      expect(activosService.cambiarEstado).toHaveBeenCalledWith(42, { estado: "perdido", motivo: "Se extravió en el andén" }),
    );
    expect(alerta).toHaveBeenCalledWith("¿Marcar como «Perdido»?", expect.stringMatching(/fuera del inventario/), expect.any(Array), expect.any(Object));
    expect(await screen.findByTestId("resultado-accion")).toHaveTextContent(/Estado cambiado a «Perdido»./);
    alerta.mockRestore();
  });

  it("si no confirma, no envía nada", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => botones[0].onPress());
    await abrirEstado();
    await fireEvent.press(screen.getByTestId("nuevo-estado-robado"));
    await fireEvent.changeText(screen.getByTestId("estado-motivo"), "Denuncia 123");
    await fireEvent.press(screen.getByTestId("guardar-estado"));
    await waitFor(() => expect(alerta).toHaveBeenCalled());
    expect(activosService.cambiarEstado).not.toHaveBeenCalled();
    alerta.mockRestore();
  });

  it("un estado del parque va sin confirmación; el actual no se ofrece", async () => {
    activosService.cambiarEstado.mockResolvedValueOnce({ ...fila(), estado: "en_bodega", estado_display: "En bodega" });
    await abrirEstado();
    expect(screen.queryByTestId("nuevo-estado-en_uso")).toBeNull();
    await fireEvent.press(screen.getByTestId("nuevo-estado-en_bodega"));
    await fireEvent.press(screen.getByTestId("guardar-estado"));
    await waitFor(() => expect(activosService.cambiarEstado).toHaveBeenCalledWith(42, { estado: "en_bodega", motivo: "" }));
  });
});

describe("el escáner (CA-11, CA-12)", () => {
  it("sin el módulo nativo de la cámara, queda solo el ingreso a mano y funciona", async () => {
    activosService.porCodigo.mockResolvedValueOnce({ ...ficha(), advertencia_lector: "El lector envía otra distribución de teclado." });
    await render(<Escaner />);
    expect(screen.getByText(TEXTO_SIN_CAMARA)).toBeTruthy();
    expect(screen.queryByTestId("camara")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("codigo-a-mano"), " GA-LAP-000042 ");
    await fireEvent.press(screen.getByTestId("buscar-codigo"));
    expect(await screen.findByTestId("resultado-escaneo")).toBeTruthy();
    expect(activosService.porCodigo).toHaveBeenCalledWith("GA-LAP-000042");
    expect(screen.getByTestId("advertencia-lector")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("ver-ficha"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/activos/[id]", params: { id: "42" } });
    await fireEvent.press(screen.getByTestId("registrar-desde-escaner"));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: "/mantenimientos/nuevo", params: { activo: "42" } });
  });

  it("«Registrar mantenimiento» solo con su permiso y si el activo está operativo", async () => {
    mockSesion.usuario = { permissions: ["activos.ver"] };
    activosService.porCodigo.mockResolvedValueOnce(ficha());
    await render(<Escaner />);
    await fireEvent.changeText(screen.getByTestId("codigo-a-mano"), "GA-LAP-000042");
    await fireEvent.press(screen.getByTestId("buscar-codigo"));
    await screen.findByTestId("resultado-escaneo");
    expect(screen.queryByTestId("registrar-desde-escaner")).toBeNull();
  });

  it("un 404 muestra el mensaje del servidor y deja intentar otra vez", async () => {
    activosService.porCodigo.mockRejectedValueOnce(error(404, "activo_no_encontrado", "Ningún activo corresponde a 'XYZ'."));
    await render(<Escaner />);
    await fireEvent.changeText(screen.getByTestId("codigo-a-mano"), "XYZ");
    await fireEvent.press(screen.getByTestId("buscar-codigo"));
    expect(await screen.findByText("Ningún activo corresponde a 'XYZ'.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("escanear-otra-vez"));
    expect(screen.getByTestId("codigo-a-mano")).toBeTruthy();
  });

  it("con cámara: QR y Code 128, un código a la vez", async () => {
    const camara = require("expo-camera");
    camaraDisponible.mockReturnValue({ CameraView: camara.CameraView, useCameraPermissions: camara.useCameraPermissions });
    let resolver;
    activosService.porCodigo.mockReturnValueOnce(new Promise((r) => (resolver = r)));
    await render(<Escaner />);
    expect(screen.getByTestId("camara")).toBeTruthy();
    expect(camara.__estado.ajustes).toEqual({ barcodeTypes: ["qr", "code128"] });
    await act(async () => {
      camara.__leer("GA-LAP-000042");
      camara.__leer("GA-LAP-000042");
      camara.__leer("GA-LAP-000099");
    });
    expect(activosService.porCodigo).toHaveBeenCalledTimes(1);
    await act(async () => resolver(ficha()));
    expect(await screen.findByTestId("resultado-escaneo")).toBeTruthy();
    // Con el resultado a la vista, la cámara se apaga.
    expect(screen.queryByTestId("camara")).toBeNull();
    await fireEvent.press(screen.getByTestId("escanear-otro"));
    expect(screen.getByTestId("camara")).toBeTruthy();
    // Siempre se puede escribir a mano.
    await fireEvent.press(screen.getByTestId("escribir-a-mano"));
    expect(screen.getByTestId("codigo-a-mano")).toBeTruthy();
  });

  it("sin permiso de cámara lo explica y ofrece abrir los ajustes", async () => {
    const camara = require("expo-camera");
    camara.__estado.permiso = { granted: false, canAskAgain: false, status: "denied" };
    camaraDisponible.mockReturnValue({ CameraView: camara.CameraView, useCameraPermissions: camara.useCameraPermissions });
    try {
      await render(<Escaner />);
      expect(screen.getByText(TEXTO_SIN_PERMISO_CAMARA)).toBeTruthy();
      await fireEvent.press(screen.getByTestId("abrir-ajustes"));
      expect(Linking.openSettings).toHaveBeenCalled();
      expect(screen.getByTestId("escribir-a-mano")).toBeTruthy();
    } finally {
      camara.__estado.permiso = { granted: true, canAskAgain: true, status: "granted" };
    }
  });
});

// --- Ronda 1 de correcciones tras QA (16/11/2026) -----------------------------------

describe("ronda 1: el escáner", () => {
  function conCamara() {
    const camara = require("expo-camera");
    camaraDisponible.mockReturnValue({ CameraView: camara.CameraView, useCameraPermissions: camara.useCameraPermissions });
    return camara;
  }

  it("QA-TECH P2: sin foco no hay cámara montada; al volver el foco, sí", async () => {
    conCamara();
    mockEnfocada.valor = false;
    const { rerender } = await render(<Escaner />);
    expect(screen.queryByTestId("camara")).toBeNull();
    expect(screen.queryByTestId("camara-nativa")).toBeNull();
    mockEnfocada.valor = true;
    await rerender(<Escaner />);
    expect(screen.getByTestId("camara")).toBeTruthy();
  });

  it("mientras busca, la cámara queda montada pero inactiva; con el resultado, se desmonta", async () => {
    const camara = conCamara();
    let resolver;
    activosService.porCodigo.mockReturnValueOnce(new Promise((r) => (resolver = r)));
    await render(<Escaner />);
    expect(camara.__estado.activa).toBe(true);
    await act(async () => {
      camara.__leer("GA-LAP-000042");
    });
    expect(screen.getByTestId("camara")).toBeTruthy();
    expect(camara.__estado.activa).toBe(false);
    await act(async () => resolver(ficha()));
    expect(screen.queryByTestId("camara")).toBeNull();
  });

  it("UX H-06: al volver de los ajustes relee el permiso y muestra la cámara", async () => {
    const camara = conCamara();
    let alCambiar = null;
    const suscripcion = jest.spyOn(AppState, "addEventListener").mockImplementation((_evento, fn) => {
      alCambiar = fn;
      return { remove: jest.fn() };
    });
    camara.__estado.permiso = { granted: false, canAskAgain: false, status: "denied" };
    try {
      await render(<Escaner />);
      expect(screen.getByTestId("sin-permiso-camara")).toBeTruthy();
      Linking.openSettings.mockRejectedValueOnce(new Error("sin ajustes"));
      await fireEvent.press(screen.getByTestId("abrir-ajustes"));
      camara.__estado.permiso = { granted: true, canAskAgain: true, status: "granted" };
      await act(async () => {
        alCambiar("active");
      });
      expect(camara.__obtener).toHaveBeenCalled();
      expect(await screen.findByTestId("camara")).toBeTruthy();
    } finally {
      camara.__estado.permiso = { granted: true, canAskAgain: true, status: "granted" };
      suscripcion.mockRestore();
    }
  });

  it("UX H-05: el resumen dice estado, responsable y lugar", async () => {
    activosService.porCodigo.mockResolvedValueOnce(ficha());
    await render(<Escaner />);
    await fireEvent.changeText(screen.getByTestId("codigo-a-mano"), "GA-LAP-000042");
    await fireEvent.press(screen.getByTestId("buscar-codigo"));
    expect((await screen.findByTestId("resumen-escaneo")).props.accessibilityLabel).toBe(
      "Activo encontrado: GA-LAP-000042, Laptop Dell Latitude. Estado: Asignado. Responsable: Ana Pérez. Lugar: Cartera · Matriz Quito",
    );
  });

  it("QA-FUNC B5: «.» no se busca; con «.» o «/» se busca en el inventario y muestra el resumen si hay uno exacto", async () => {
    await render(<Escaner />);
    await fireEvent.changeText(screen.getByTestId("codigo-a-mano"), "..");
    expect(screen.getByTestId("buscar-codigo").props.accessibilityState.disabled).toBe(true);

    activosService.listar.mockResolvedValueOnce(pagina([fila({ id: 77, numero_serie: "SN.1/A" })]));
    await fireEvent.changeText(screen.getByTestId("codigo-a-mano"), "SN.1/A");
    await fireEvent.press(screen.getByTestId("buscar-codigo"));
    // Como cualquier código: el resumen con «Ver ficha», sin apilar la ficha
    // (una segunda lectura no abre otra; QA-TECH, revalidación).
    expect(await screen.findByTestId("resumen-escaneo")).toBeTruthy();
    expect(activosService.historial).toHaveBeenCalledWith(77);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(activosService.listar).toHaveBeenCalledWith({ q: "SN.1/A" });
    expect(activosService.porCodigo).not.toHaveBeenCalled();

    // Una coincidencia que no es exacta no abre otro activo.
    await fireEvent.press(screen.getByTestId("escanear-otro"));
    activosService.listar.mockResolvedValueOnce(pagina([fila({ id: 78, numero_serie: "SN.1/AB" })]));
    await fireEvent.changeText(screen.getByTestId("codigo-a-mano"), "SN.1/A");
    await fireEvent.press(screen.getByTestId("buscar-codigo"));
    expect(await screen.findByText(TEXTO_CODIGO_NO_ENCONTRADO)).toBeTruthy();

    await fireEvent.press(screen.getByTestId("escanear-otra-vez"));
    activosService.listar.mockResolvedValueOnce(pagina([]));
    await fireEvent.press(screen.getByTestId("buscar-codigo"));
    expect(await screen.findByText(TEXTO_CODIGO_NO_ENCONTRADO)).toBeTruthy();
  });

  it("UX H-08: «Intentar con otro código» conserva lo escrito", async () => {
    activosService.porCodigo.mockRejectedValueOnce(error(404, "activo_no_encontrado", "Ningún activo corresponde a 'GA-LAP-00004'."));
    await render(<Escaner />);
    await fireEvent.changeText(screen.getByTestId("codigo-a-mano"), "GA-LAP-00004");
    await fireEvent.press(screen.getByTestId("buscar-codigo"));
    await fireEvent.press(await screen.findByTestId("escanear-otra-vez"));
    expect(screen.getByTestId("codigo-a-mano").props.value).toBe("GA-LAP-00004");
  });

  it("UX H-10: al volver al escáner con un resultado, lo consulta otra vez en silencio", async () => {
    activosService.porCodigo.mockResolvedValueOnce(ficha());
    const { rerender } = await render(<Escaner />);
    await fireEvent.changeText(screen.getByTestId("codigo-a-mano"), "GA-LAP-000042");
    await fireEvent.press(screen.getByTestId("buscar-codigo"));
    await screen.findByTestId("resultado-escaneo");
    activosService.historial.mockResolvedValueOnce(ficha({ estado: "en_mantenimiento", estado_display: "En reparación" }));
    mockEnfocada.valor = false;
    await rerender(<Escaner />);
    mockEnfocada.valor = true;
    await rerender(<Escaner />);
    await waitFor(() => expect(activosService.historial).toHaveBeenCalledWith(42));
    await waitFor(() => expect(screen.getByTestId("resumen-escaneo").props.accessibilityLabel).toMatch(/Estado: En reparación/));
  });
});

describe("ronda 1: permisos de solicitudes en la barra (QA-FUNC B1)", () => {
  it("Dado que solo tengo `solicitudes.crear`, Cuando abro «Mis solicitudes», Entonces no se abre ni se consulta", async () => {
    mockSesion.usuario = { permissions: ["activos.ver", "solicitudes.crear"] };
    mockParametros.vista = "mis_solicitudes";
    await render(<GestionDeActivos />);
    expect(await screen.findByTestId("activos-panel")).toBeTruthy();
    expect(solicitudesService.listar).not.toHaveBeenCalled();
  });

  it("Dado que gestiono sin `solicitudes.ver`, Cuando abro «Recibidas», Entonces no se abre", async () => {
    mockSesion.usuario = { permissions: ["activos.ver", "solicitudes.gestionar"] };
    mockParametros.vista = "recibidas";
    await render(<GestionDeActivos />);
    expect(await screen.findByTestId("activos-panel")).toBeTruthy();
    expect(solicitudesService.listar).not.toHaveBeenCalled();
  });
});

describe("ronda 1: la ficha (UX H-02)", () => {
  it("«¿De quién es?» y la garantía primero; lo demás de los datos, plegado; los 5 últimos movimientos", async () => {
    const movimientos = Array.from({ length: 7 }, (_, i) => ({
      id: 100 + i,
      tipo: "traslado",
      tipo_display: "Traslado",
      created_at: "2026-10-02T15:00:00Z",
    }));
    activosService.historial.mockResolvedValueOnce({ ...ficha(), movimientos });
    mockParametros.id = "42";
    await render(<PantallaFicha />);
    const encabezados = (await screen.findAllByRole("header")).map((h) => h.props.children);
    expect(encabezados.indexOf("¿De quién es?")).toBeLessThan(encabezados.indexOf("Datos"));
    expect(encabezados.indexOf("Garantía")).toBeLessThan(encabezados.indexOf("Datos"));
    expect(screen.getByLabelText("Número de serie: SN123")).toBeTruthy();
    expect(screen.queryByLabelText("Criticidad: Media")).toBeNull();
    await fireEvent.press(screen.getByTestId("mas-datos"));
    expect(screen.getByLabelText("Criticidad: Media")).toBeTruthy();
    expect(screen.queryByTestId("movimiento-105")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Ver todos (7)" }));
    expect(screen.getByTestId("movimiento-106")).toBeTruthy();
  });
});

describe("ronda 1: asignar con errores del servidor", () => {
  async function abrirAsignar() {
    mockParametros.id = "42";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("asignar"));
    await screen.findByTestId("ventana-asignar");
    await waitFor(() => expect(organizacionService.sedes).toHaveBeenCalled());
  }

  it("QA-FUNC B2: el activo pasó a «Perdido» mientras tanto: se dice el mensaje del servidor, sin el nombre del campo", async () => {
    const texto = "El activo está perdido: no se puede asignar ni trasladar. Reingréselo al inventario primero.";
    activosService.asignar.mockRejectedValueOnce(error(400, "validation_error", "Error en la solicitud.", { estado: [texto] }));
    await abrirAsignar();
    await fireEvent.press(screen.getByRole("button", { name: "Quitar a Ana Pérez" }));
    await fireEvent.press(screen.getByTestId("guardar-asignacion"));
    expect(await screen.findByTestId("asignar-error")).toHaveTextContent(new RegExp(`^.?${texto.replace(/\./g, "\\.")}$`));
    expect(screen.queryByText(/estado:/)).toBeNull();
  });

  it("QA-FUNC B4: tras «puede haberse guardado», el siguiente envío pregunta antes de repetirlo", async () => {
    activosService.asignar
      .mockRejectedValueOnce(Object.assign(new Error("tiempo"), { esDeRed: true, porTiempo: true }))
      .mockResolvedValueOnce(fila());
    await abrirAsignar();
    await fireEvent.press(screen.getByRole("button", { name: "Quitar a Ana Pérez" }));
    await fireEvent.press(screen.getByTestId("guardar-asignacion"));
    expect(await screen.findByText(TEXTO_PUEDE_HABERSE_GUARDADO)).toBeTruthy();

    let alerta = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => botones[0].onPress());
    await fireEvent.press(screen.getByTestId("guardar-asignacion"));
    expect(alerta).toHaveBeenCalledWith(TITULO_REENVIO, TEXTO_REENVIO, expect.any(Array), expect.any(Object));
    expect(activosService.asignar).toHaveBeenCalledTimes(1);
    alerta.mockRestore();

    alerta = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => botones[1].onPress());
    await fireEvent.press(screen.getByTestId("guardar-asignacion"));
    await waitFor(() => expect(activosService.asignar).toHaveBeenCalledTimes(2));
    alerta.mockRestore();
  });
});

describe("ronda 1: inventario, panel y empresa", () => {
  it("UX H-01: el escáner a un toque junto al buscador del inventario", async () => {
    mockParametros.vista = "inventario";
    await render(<GestionDeActivos />);
    await screen.findByTestId("activo-42");
    await fireEvent.press(screen.getByRole("button", { name: "Escanear la etiqueta" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/activos/escanear");
  });

  it("UX H-19: al buscar, lo anterior se queda a la vista con «Actualizando…»", async () => {
    mockParametros.vista = "inventario";
    await render(<GestionDeActivos />);
    await screen.findByTestId("activo-42");
    let resolver;
    activosService.listar.mockReturnValueOnce(new Promise((r) => (resolver = r)));
    await fireEvent(screen.getByTestId("buscar-activo"), "submitEditing");
    await fireEvent.changeText(screen.getByTestId("buscar-activo"), "dell");
    await fireEvent(screen.getByTestId("buscar-activo"), "submitEditing");
    expect(await screen.findByLabelText("Actualizando…")).toBeTruthy();
    expect(screen.getByTestId("activo-42")).toBeTruthy();
    await act(async () => resolver(pagina([fila({ id: 43 })])));
    expect(await screen.findByTestId("activo-43")).toBeTruthy();
    expect(screen.queryByLabelText("Actualizando…")).toBeNull();
  });

  it("CA-22: al cambiar de empresa, el panel se vuelve a pedir", async () => {
    const { rerender } = await render(<GestionDeActivos />);
    await screen.findByTestId("kpis-activos");
    expect(activosService.panel).toHaveBeenCalledTimes(1);
    mockSesion.empresaActiva = { id: 3 };
    mockSesion.versionEmpresa = 1;
    await rerender(<GestionDeActivos />);
    await waitFor(() => expect(activosService.panel).toHaveBeenCalledTimes(2));
  });

  it("CA-22: al cambiar de empresa, el inventario empieza de cero (nada de la anterior a la vista)", async () => {
    mockParametros.vista = "inventario";
    const { rerender } = await render(<GestionDeActivos />);
    await screen.findByTestId("activo-42");
    let resolver;
    activosService.listar.mockReturnValueOnce(new Promise((r) => (resolver = r)));
    mockSesion.empresaActiva = { id: 3 };
    mockSesion.versionEmpresa = 1;
    await rerender(<GestionDeActivos />);
    expect(screen.queryByTestId("activo-42")).toBeNull();
    expect(screen.getByLabelText("Cargando el inventario…")).toBeTruthy();
    await act(async () => resolver(pagina([fila({ id: 50 })])));
    expect(await screen.findByTestId("activo-50")).toBeTruthy();
  });

  it("UX H-20: una alerta con filtro equivalente abre el inventario filtrado", async () => {
    await render(<GestionDeActivos />);
    await fireEvent.press(await screen.findByTestId("alerta-perdidos"));
    expect(mockRouter.setParams).toHaveBeenCalledWith(expect.objectContaining({ vista: "inventario", filtro: "fuera" }));
  });

  it("QA-FUNC B3: un aviso de otra empresa de la persona pasa a ella y lo dice", async () => {
    mockSesion.empresas = [
      { id: 2, nombre: "Laar Ecuador" },
      { id: 5, nombre: "Laar Perú" },
    ];
    Object.assign(mockParametros, { vista: "inventario", filtro: "almacen", n: "1", empresa: "5" });
    await render(<GestionDeActivos />);
    expect(await screen.findByTestId("aviso-de-empresa")).toHaveTextContent(/Este aviso es de Laar Perú: la app pasó a esa empresa\./);
    expect(mockSesion.cambiarEmpresaSiEsSuya).toHaveBeenCalledWith("5");
  });

  it("QA-FUNC B3: un aviso de una empresa que ya no es suya lo avisa y no cambia de empresa", async () => {
    Object.assign(mockParametros, { vista: "inventario", n: "1", empresa: "9" });
    await render(<GestionDeActivos />);
    expect(await screen.findByTestId("aviso-de-empresa")).toHaveTextContent(new RegExp(TEXTO_AVISO_SIN_ACCESO.slice(0, 40)));
    expect(mockSesion.cambiarEmpresaSiEsSuya).not.toHaveBeenCalled();
  });
});
