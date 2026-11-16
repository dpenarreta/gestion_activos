import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { AccessibilityInfo, Alert } from "react-native";

import { activosService, adjuntosService, mantenimientosService, solicitudesService } from "../src/api/servicios";
import { TEXTO_ARCHIVO_GRANDE } from "../src/activos/adjuntos";
import { TEXTO_MODULO_APAGADO, TEXTO_PUEDE_HABERSE_GUARDADO } from "../src/activos/formato";
import { hoyIso, TEXTO_SIN_VUELTA } from "../src/activos/mantenimientos";
import { TEXTO_NOTA_OBLIGATORIA } from "../src/activos/solicitudes";
import { GestionDeActivos } from "../src/pantallas/activos/GestionDeActivos";
import { TEXTO_NO_OPERATIVO, TEXTO_SIN_PERMISO_REGISTRAR } from "../src/pantallas/activos/RegistrarMantenimiento";
import PantallaMantenimiento from "../src/app/(app)/mantenimientos/[id]";
import PantallaRegistrar from "../src/app/(app)/mantenimientos/nuevo";
import PantallaSolicitud from "../src/app/(app)/solicitudes/[id]";
import PantallaNuevaSolicitud from "../src/app/(app)/solicitudes/nueva";

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

const mockSesion = { usuario: { id: 10, permissions: [] }, empresaActiva: { id: 2 }, versionEmpresa: 0 };
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));

jest.mock("../src/navegacion/useContextoDeNavegacion", () => ({
  useContextoDeNavegacion: () => ({ permisos: mockSesion.usuario.permissions, vistas: {} }),
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});

jest.mock("../src/api/servicios", () => ({
  activosService: { historial: jest.fn(), buscarOperativos: jest.fn(), panel: jest.fn(), listar: jest.fn() },
  organizacionService: {},
  mantenimientosService: {
    listar: jest.fn(),
    detalle: jest.fn(),
    registrar: jest.fn(),
    cerrar: jest.fn(),
    componentes: jest.fn(),
    crearComponente: jest.fn(),
  },
  adjuntosService: {
    listar: jest.fn(),
    subir: jest.fn(),
    urlDescarga: (id) => `https://api.prueba/api/v1/adjuntos/${id}/descargar/`,
  },
  solicitudesService: {
    listar: jest.fn(),
    detalle: jest.fn(),
    crear: jest.fn(),
    cambiarEstado: jest.fn(),
    catalogo: jest.fn(),
    encargados: jest.fn(),
  },
}));

jest.mock("../src/api/api", () => ({
  api: {
    conRenovacion: jest.fn(async (hacer) => hacer({ Authorization: "Bearer access" })),
  },
  escucharSesion: () => () => {},
}));

function error(status, code, message, details = null) {
  const e = new Error(message);
  e.response = { status, data: { error: { code, message, details } } };
  return e;
}

function pagina(results, next = null) {
  return { count: results.length, next, results };
}

/**
 * El manejador `nombre` del componente que pinta `elemento`, para llamarlo
 * dos veces en el mismo `act` (dos toques antes de que React vuelva a
 * pintar), como `chatConversacion.test.js`: dos `fireEvent` superponen dos
 * `act` y React lo avisa en la consola.
 */
function manejadorDe(elemento, nombre) {
  for (let fibra = elemento.unstable_fiber; fibra; fibra = fibra.return) {
    if (typeof fibra.memoizedProps?.[nombre] === "function") return fibra.memoizedProps[nombre];
  }
  throw new Error(`Sin ${nombre}`);
}

/** Una promesa que se resuelve a mano (para probar el doble toque). */
function enEspera() {
  let resolver;
  const promesa = new Promise((r) => {
    resolver = r;
  });
  return { promesa, resolver };
}

const HOY = hoyIso();

function mantenimiento(campos = {}) {
  return {
    id: 9,
    activo: 42,
    activo_codigo: "GA-LAP-000042",
    activo_nombre: "Laptop Dell",
    tipo: "correctivo",
    tipo_display: "Correctivo",
    fecha_intervencion: "2026-11-10",
    fecha_salida: null,
    dias_fuera_de_operacion: null,
    sigue_fuera_de_operacion: true,
    tipo_responsable: "tecnico_interno",
    tipo_responsable_display: "Técnico interno",
    responsable: "Luis Mora",
    causa: "Disco fallando",
    descripcion: "Cambio de disco",
    diagnostico: "Sectores dañados",
    solucion: "",
    estado_final: "reparado",
    estado_final_display: "Reparado",
    garantia_usada: false,
    costo_mano_obra: "20.00",
    costo_total: "100.00",
    componentes: [
      {
        id: 1,
        componente: 3,
        componente_nombre: "Disco SSD",
        cantidad: 2,
        costo_unitario: "40.00",
        costo_total: "80.00",
        numero_serie_nuevo: "S1",
        era_critico: true,
        observaciones: "",
      },
    ],
    registrado_por_nombre: "tecnico1",
    ...campos,
  };
}

/** La respuesta de `historial/` para «Registrar». */
function ficha(campos = {}) {
  return {
    activo: {
      id: 42,
      codigo_barras: "GA-LAP-000042",
      nombre: "Laptop Dell",
      estado: "en_uso",
      estado_display: "Asignado",
      esta_operativo: true,
      fecha_adquisicion: "2025-01-15",
      responsables: [{ id: 4, nombre_completo: "Ana Pérez", recibe_avisos: false }],
      ...campos,
    },
    movimientos: [],
    mantenimientos: [],
    costos: {},
  };
}

function solicitud(campos = {}) {
  return {
    id: 4,
    solicitante: 10,
    solicitante_nombre: "Ana Pérez",
    encargado: 20,
    encargado_nombre: "Rosa Díaz",
    clase: "dispositivo",
    clase_display: "Dispositivo",
    lo_que_se_pide: "Laptop — con 32 GB",
    especificaciones: { RAM: 32 },
    cantidad: 1,
    justificacion: "Entra un analista",
    prioridad: "alta",
    prioridad_display: "Alta",
    fecha_necesaria: "2026-12-01",
    estado: "pendiente",
    estado_display: "Pendiente",
    esta_cerrada: false,
    movimientos: [
      {
        id: 1,
        estado_anterior: "",
        estado_nuevo: "pendiente",
        estado_nuevo_display: "Pendiente",
        actor_nombre: "Ana Pérez",
        nota: "Solicitud registrada.",
        created_at: "2026-11-15T15:00:00Z",
      },
    ],
    created_at: "2026-11-15T15:00:00Z",
    ...campos,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  for (const k of Object.keys(mockParametros)) delete mockParametros[k];
  mockPrevenir.activa = false;
  mockPrevenir.alIntentar = null;
  mockSesion.usuario = { id: 10, permissions: [] };
  mockSesion.empresaActiva = { id: 2 };
  mockSesion.versionEmpresa = 0;
  mantenimientosService.listar.mockResolvedValue(pagina([mantenimiento()]));
  mantenimientosService.detalle.mockResolvedValue(mantenimiento());
  mantenimientosService.componentes.mockResolvedValue(
    pagina([
      { id: 3, nombre: "Disco SSD", codigo: "DISCO-SSD", es_critico: true, activo: true },
      { id: 4, nombre: "Teclado viejo", codigo: "TEC", es_critico: false, activo: false },
    ]),
  );
  adjuntosService.listar.mockResolvedValue(pagina([]));
  activosService.historial.mockResolvedValue(ficha());
  solicitudesService.listar.mockResolvedValue(pagina([solicitud()]));
  solicitudesService.detalle.mockResolvedValue(solicitud());
  solicitudesService.catalogo.mockResolvedValue({
    tipos_dispositivo: [
      {
        id: 1,
        nombre: "Laptop",
        caracteristicas: [{ id: 11, nombre: "RAM", dato: "entero", unidad: "GB", opciones: [], obligatoria: true, orden: 1 }],
      },
    ],
    componentes: [{ id: 5, nombre: "Disco SSD" }],
  });
  solicitudesService.encargados.mockResolvedValue([{ id: 20, nombre: "Rosa Díaz" }]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// --- La bitácora --------------------------------------------------------------------

describe("la bitácora de mantenimientos (CA-13)", () => {
  beforeEach(() => {
    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.ver", "mantenimientos.registrar"] };
    mockParametros.vista = "mantenimientos";
  });

  it("cada fila dice activo, tipo, estado (texto), fechas y costo, y abre su detalle", async () => {
    await render(<GestionDeActivos />);
    const fila = await screen.findByTestId("mantenimiento-9");
    expect(fila.props.accessibilityLabel).toBe(
      "GA-LAP-000042, Laptop Dell. Correctivo. Estado: Abierto. Desde el 10/11/2026 · sigue fuera de operación. Costo: $100,00",
    );
    expect(screen.getByRole("header", { name: "Mantenimientos" })).toBeTruthy();
    expect(screen.getByTestId("mantenimientos-total")).toHaveTextContent(/1 mantenimiento/);
    await fireEvent.press(fila);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/mantenimientos/[id]", params: { id: "9" } });
  });

  it("abiertos o cerrados con `pendientes`, el tipo y «Registrar mantenimiento»", async () => {
    await render(<GestionDeActivos />);
    await screen.findByTestId("mantenimiento-9");
    expect(mantenimientosService.listar).toHaveBeenLastCalledWith({ page: 1 });
    await fireEvent.press(screen.getByRole("tab", { name: "Abiertos" }));
    await waitFor(() => expect(mantenimientosService.listar).toHaveBeenLastCalledWith({ pendientes: "true", page: 1 }));
    await fireEvent.press(screen.getByRole("tab", { name: "Preventivo" }));
    await waitFor(() =>
      expect(mantenimientosService.listar).toHaveBeenLastCalledWith({ pendientes: "true", tipo: "preventivo", page: 1 }),
    );
    await fireEvent.press(screen.getByTestId("registrar-desde-la-lista"));
    expect(mockRouter.push).toHaveBeenCalledWith("/mantenimientos/nuevo");
  });

  it("el aviso de reparaciones sin cerrar la abre con «Abiertos»; sin permiso de registrar no hay botón", async () => {
    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.ver"] };
    mockParametros.filtro = "abiertos";
    mockParametros.n = "1";
    await render(<GestionDeActivos />);
    await screen.findByTestId("mantenimiento-9");
    expect(mantenimientosService.listar).toHaveBeenLastCalledWith({ pendientes: "true", page: 1 });
    expect(screen.getByRole("tab", { name: "Abiertos" }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.queryByTestId("registrar-desde-la-lista")).toBeNull();
  });

  it("CA-2: el módulo apagado se dice claro, con «Reintentar»", async () => {
    mantenimientosService.listar.mockRejectedValueOnce(error(403, "modulo_apagado", "Módulo apagado"));
    await render(<GestionDeActivos />);
    expect(await screen.findByText(TEXTO_MODULO_APAGADO)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("mantenimiento-9")).toBeTruthy();
  });
});

// --- El detalle del mantenimiento ---------------------------------------------------

describe("el detalle del mantenimiento (CA-13, CA-16)", () => {
  beforeEach(() => {
    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.ver", "mantenimientos.editar"] };
    mockParametros.id = "9";
  });

  it("los datos, los repuestos (la pieza crítica dicha) y los costos; abre la ficha del activo", async () => {
    await render(<PantallaMantenimiento />);
    expect(await screen.findByRole("header", { name: "Correctivo · Laptop Dell" })).toBeTruthy();
    expect(screen.getByTestId("estado-del-mantenimiento")).toHaveTextContent(/Abierto/);
    expect(screen.getByTestId("repuesto-1").props.accessibilityLabel).toMatch(/^Disco SSD\. Pieza crítica\. Cantidad: 2/);
    expect(screen.getByLabelText("Total: $100,00")).toBeTruthy();
    expect(screen.getByLabelText("Repuestos: $80,00")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("ver-ficha-del-activo"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/activos/[id]", params: { id: "42" } });
  });

  it("«Registrar salida» envía la fecha, la solución y el estado final, y recarga anunciándolo", async () => {
    mantenimientosService.cerrar.mockResolvedValueOnce(mantenimiento({ fecha_salida: HOY }));
    await render(<PantallaMantenimiento />);
    await fireEvent.press(await screen.findByTestId("registrar-salida"));
    expect(screen.getByTestId("salida-fecha").props.accessibilityLabel).toMatch(/^Fecha de salida \(obligatorio\): /);
    await fireEvent.changeText(screen.getByTestId("salida-solucion"), "Se cambió el disco");
    await fireEvent.press(screen.getByTestId("salida-estado-no_reparable"));
    expect(screen.getByTestId("salida-sin-vuelta")).toHaveTextContent(/Con este estado final el equipo no vuelve a operar/);
    await fireEvent.press(screen.getByTestId("salida-estado-reparado"));
    await fireEvent.press(screen.getByTestId("guardar-salida"));
    await waitFor(() =>
      expect(mantenimientosService.cerrar).toHaveBeenCalledWith(9, {
        fecha_salida: HOY,
        solucion: "Se cambió el disco",
        estado_final: "reparado",
      }),
    );
    expect(await screen.findByTestId("resultado-mantenimiento")).toHaveTextContent(/Salida registrada/);
    expect(screen.queryByTestId("ventana-salida")).toBeNull();
    expect(mantenimientosService.detalle).toHaveBeenCalledTimes(2);
  });

  it("un doble toque hace una sola petición; un 400 va junto a su campo", async () => {
    const espera = enEspera();
    mantenimientosService.cerrar.mockReturnValueOnce(espera.promesa);
    await render(<PantallaMantenimiento />);
    await fireEvent.press(await screen.findByTestId("registrar-salida"));
    const guardar = manejadorDe(screen.getByTestId("guardar-salida"), "onPress");
    await act(async () => {
      guardar();
      guardar();
    });
    expect(mantenimientosService.cerrar).toHaveBeenCalledTimes(1);
    await act(async () => {
      espera.resolver(mantenimiento({ fecha_salida: HOY }));
    });

    mantenimientosService.cerrar.mockRejectedValueOnce(
      error(400, "validation_error", "Error en la solicitud.", { fecha_salida: ["La salida no puede ser anterior al ingreso."] }),
    );
    mantenimientosService.detalle.mockResolvedValue(mantenimiento());
    await fireEvent.press(await screen.findByTestId("registrar-salida"));
    await fireEvent.press(screen.getByTestId("guardar-salida"));
    expect(await screen.findByText("Revise el campo: Fecha de salida.")).toBeTruthy();
    expect(screen.getByTestId("salida-fecha").props.accessibilityLabel).toMatch(/Error: La salida no puede ser anterior al ingreso\./);
  });

  it("sin respuesta clara dice que pudo haberse guardado; cerrado o sin permiso no ofrece la salida", async () => {
    mantenimientosService.cerrar.mockRejectedValueOnce(Object.assign(new Error("tiempo"), { esDeRed: true, porTiempo: true }));
    const { unmount } = await render(<PantallaMantenimiento />);
    await fireEvent.press(await screen.findByTestId("registrar-salida"));
    await fireEvent.press(screen.getByTestId("guardar-salida"));
    expect(await screen.findByText(TEXTO_PUEDE_HABERSE_GUARDADO)).toBeTruthy();
    await unmount();

    mantenimientosService.detalle.mockResolvedValueOnce(mantenimiento({ fecha_salida: "2026-11-12", dias_fuera_de_operacion: 2 }));
    const otra = await render(<PantallaMantenimiento />);
    expect(await screen.findByTestId("estado-del-mantenimiento")).toHaveTextContent(/Reparado/);
    expect(screen.queryByTestId("registrar-salida")).toBeNull();
    await otra.unmount();

    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.ver"] };
    await render(<PantallaMantenimiento />);
    await screen.findByTestId("detalle-mantenimiento");
    expect(screen.queryByTestId("registrar-salida")).toBeNull();
  });

  it("de un aviso de otra empresa: lo pide con su X-Empresa y no ofrece acciones; un 404 lo dice", async () => {
    mockParametros.empresa = "5";
    const { unmount } = await render(<PantallaMantenimiento />);
    await screen.findByTestId("detalle-mantenimiento");
    expect(mantenimientosService.detalle).toHaveBeenCalledWith("9", { empresa: "5" });
    expect(screen.queryByTestId("registrar-salida")).toBeNull();
    await unmount();

    delete mockParametros.empresa;
    mantenimientosService.detalle.mockRejectedValueOnce(error(404, "not_found", "No encontrado."));
    await render(<PantallaMantenimiento />);
    expect(await screen.findByText("Este mantenimiento no existe o ya no tiene acceso a él.")).toBeTruthy();
  });
});

// --- Adjuntos -----------------------------------------------------------------------

describe("los adjuntos del mantenimiento (CA-17)", () => {
  const FOTO = { id: 31, tipo_display: "Foto del equipo", nombre_original: "pantalla.jpg", tamano_bytes: 2048, created_at: "2026-11-12T10:00:00Z" };
  const INFORME = { id: 32, tipo_display: "Informe técnico", nombre_original: "informe.pdf", tamano_bytes: 4096, created_at: "2026-11-12T10:00:00Z" };

  beforeEach(() => {
    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.ver", "adjuntos.ver", "adjuntos.subir"] };
    mockParametros.id = "9";
    adjuntosService.listar.mockResolvedValue(pagina([FOTO, INFORME]));
  });

  it("se listan con el filtro del mantenimiento; la imagen se ve en el visor y lo demás con el sistema; todo se borra", async () => {
    const { unmount } = await render(<PantallaMantenimiento />);
    await screen.findByTestId("adjunto-31");
    expect(adjuntosService.listar).toHaveBeenCalledWith({ mantenimiento: "9" }, { empresa: undefined });
    expect(screen.getByTestId("adjunto-31").props.accessibilityLabel).toMatch(/^pantalla\.jpg\. Foto del equipo · 2 KB/);

    await fireEvent.press(screen.getByTestId("adjunto-31"));
    expect(await screen.findByTestId("imagen-adjunto")).toBeTruthy();
    expect(FileSystem.__existentes.has("file:///cache/activos-adjuntos/adjunto-31.jpg")).toBe(true);
    await fireEvent.press(screen.getByTestId("cerrar-adjunto"));
    expect(FileSystem.__existentes.has("file:///cache/activos-adjuntos/adjunto-31.jpg")).toBe(false);

    await fireEvent.press(screen.getByTestId("adjunto-32"));
    await waitFor(() => expect(FileSystem.File.preview).toHaveBeenCalled());
    expect(FileSystem.__existentes.has("file:///cache/activos-adjuntos/adjunto-32.pdf")).toBe(true);
    await unmount();
    expect(FileSystem.__existentes.has("file:///cache/activos-adjuntos/adjunto-32.pdf")).toBe(false);
  });

  it("«Adjuntar» valida el archivo, lo envía con el activo y el mantenimiento, y recarga la lista", async () => {
    adjuntosService.subir.mockResolvedValueOnce({ id: 33, nombre_original: "a.jpg" });
    ImagePicker.launchImageLibraryAsync
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: "file:///cache/ImagePicker/grande.jpg", fileName: "grande.jpg", mimeType: "image/jpeg", fileSize: 11 * 1024 * 1024 }],
      })
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: "file:///cache/ImagePicker/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", fileSize: 2048 }],
      });
    await render(<PantallaMantenimiento />);
    await fireEvent.press(await screen.findByTestId("adjuntar"));
    await fireEvent.press(screen.getByTestId("guardar-adjunto"));
    expect(await screen.findByText("Revise el campo: Archivo.")).toBeTruthy();
    expect(adjuntosService.subir).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("adjunto-galeria"));
    expect(await screen.findByText(TEXTO_ARCHIVO_GRANDE)).toBeTruthy();
    expect(screen.queryByTestId("adjunto-elegido")).toBeNull();

    await fireEvent.press(screen.getByTestId("adjunto-galeria"));
    expect(await screen.findByTestId("adjunto-elegido")).toHaveTextContent(/a\.jpg · 2 KB/);
    await fireEvent.press(screen.getByTestId("adjunto-tipo"));
    await fireEvent.press(screen.getByTestId("adjunto-tipo-opcion-informe_tecnico"));
    await fireEvent.press(screen.getByTestId("guardar-adjunto"));
    await waitFor(() =>
      expect(adjuntosService.subir).toHaveBeenCalledWith({
        activo: 42,
        mantenimiento: 9,
        tipo: "informe_tecnico",
        descripcion: "",
        archivo: { uri: "file:///cache/ImagePicker/a.jpg", name: "a.jpg", type: "image/jpeg", size: 2048 },
      }),
    );
    expect(await screen.findByTestId("resultado-mantenimiento")).toHaveTextContent(/Archivo adjuntado: a\.jpg\./);
    expect(adjuntosService.listar).toHaveBeenCalledTimes(2);
  });

  it("sin `adjuntos.ver` no se piden; sin `adjuntos.subir` no se ofrece «Adjuntar»", async () => {
    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.ver", "adjuntos.subir"] };
    const { unmount } = await render(<PantallaMantenimiento />);
    await screen.findByTestId("adjuntar");
    expect(adjuntosService.listar).not.toHaveBeenCalled();
    await unmount();
    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.ver", "adjuntos.ver"] };
    await render(<PantallaMantenimiento />);
    await screen.findByTestId("adjunto-31");
    expect(screen.queryByTestId("adjuntar")).toBeNull();
  });
});

// --- Registrar ----------------------------------------------------------------------

describe("registrar mantenimiento (CA-14, CA-15)", () => {
  beforeEach(() => {
    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.ver", "mantenimientos.registrar"] };
    mockParametros.activo = "42";
  });

  async function abrir() {
    await render(<PantallaRegistrar />);
    await screen.findByTestId("equipo-elegido");
  }

  it("con el equipo de la ficha: dice a quién no le llegará el aviso, pide lo obligatorio y no envía sin ello", async () => {
    await abrir();
    expect(activosService.historial).toHaveBeenCalledWith("42");
    expect(screen.getByText(/Ana Pérez no tiene correo en su ficha y no recibirá el aviso; le llegará a usted\./)).toBeTruthy();
    expect(screen.getByTestId("mantenimiento-fecha").props.accessibilityLabel).toMatch(/^Fecha de ingreso \(obligatorio\): /);
    await fireEvent.press(screen.getByTestId("guardar-mantenimiento"));
    expect(await screen.findByText("Revise los campos: Técnico o proveedor y Trabajo realizado.")).toBeTruthy();
    expect(mantenimientosService.registrar).not.toHaveBeenCalled();
  });

  it("con un repuesto del catálogo envía el cuerpo de la web y abre el detalle", async () => {
    mantenimientosService.registrar.mockResolvedValueOnce(mantenimiento({ id: 77, aviso: { enviados: 0, sin_correo: ["Ana Pérez"] } }));
    await abrir();
    await fireEvent.changeText(screen.getByTestId("mantenimiento-responsable"), "Luis Mora");
    await fireEvent.changeText(screen.getByTestId("mantenimiento-descripcion"), "Cambio de disco");
    // UX H-03: la causa está en «Más detalles (opcional)».
    expect(screen.queryByTestId("mantenimiento-causa")).toBeNull();
    await fireEvent.press(screen.getByTestId("mas-detalles"));
    await fireEvent.press(screen.getByTestId("causa-Disco fallando"));
    await fireEvent.press(screen.getByTestId("agregar-repuesto"));
    // Solo los activos del catálogo.
    expect(await screen.findByTestId("componente-3")).toBeTruthy();
    expect(screen.queryByTestId("componente-4")).toBeNull();
    await fireEvent.press(screen.getByTestId("componente-3"));
    expect(screen.queryByTestId("ventana-componente")).toBeNull();
    expect(screen.getByText("Pieza crítica: cuenta para la renovación")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("linea-0-cantidad"), "2");
    await fireEvent.changeText(screen.getByTestId("linea-0-costo"), "40,50");
    await fireEvent.press(screen.getByTestId("guardar-mantenimiento"));
    await waitFor(() =>
      expect(mantenimientosService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          activo: 42,
          tipo: "correctivo",
          fecha_intervencion: HOY,
          fecha_salida: null,
          responsable: "Luis Mora",
          causa: "Disco fallando",
          descripcion: "Cambio de disco",
          componentes: [{ componente: 3, cantidad: 2, costo_unitario: "40.50", numero_serie_nuevo: "", observaciones: "" }],
        }),
      ),
    );
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/mantenimientos/[id]", params: { id: "77" } }));

    // El detalle dice que quedó registrado y a quién no le llegó el aviso.
    mockParametros.id = "77";
    mantenimientosService.detalle.mockResolvedValueOnce(mantenimiento({ id: 77 }));
    await render(<PantallaMantenimiento />);
    expect(await screen.findByTestId("resultado-mantenimiento")).toHaveTextContent(/Mantenimiento registrado/);
    expect(screen.getByTestId("aviso-sin-correo")).toHaveTextContent(/Ana Pérez no tiene correo en su ficha y no recibió el aviso\./);
  });

  it("los 400 del servidor van a su campo y a su repuesto", async () => {
    mantenimientosService.registrar.mockRejectedValueOnce(
      error(400, "validation_error", "Error en la solicitud.", {
        responsable: ["Este campo no puede estar en blanco."],
        componentes: [{ costo_unitario: ["Asegúrese de que no haya más de 10 dígitos."] }],
      }),
    );
    await abrir();
    await fireEvent.changeText(screen.getByTestId("mantenimiento-responsable"), "L");
    await fireEvent.changeText(screen.getByTestId("mantenimiento-descripcion"), "Algo");
    await fireEvent.press(screen.getByTestId("agregar-repuesto"));
    await fireEvent.press(await screen.findByTestId("componente-3"));
    await fireEvent.press(screen.getByTestId("guardar-mantenimiento"));
    expect(await screen.findByText("Revise el campo: Técnico o proveedor.")).toBeTruthy();
    expect(screen.getByTestId("mantenimiento-responsable").props.accessibilityLabel).toMatch(/Error: Este campo no puede estar en blanco\./);
    expect(screen.getByTestId("linea-0-costo").props.accessibilityLabel).toMatch(/Error: Asegúrese de que no haya más de 10 dígitos\./);
  });

  it("con `mantenimientos.componentes`, «Crear componente» lo crea en mayúsculas y lo deja elegido", async () => {
    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.registrar", "mantenimientos.componentes"] };
    mantenimientosService.crearComponente.mockResolvedValueOnce({ id: 8, nombre: "Pasta térmica", codigo: "PASTA", es_critico: false });
    await abrir();
    await fireEvent.press(screen.getByTestId("agregar-repuesto"));
    await fireEvent.press(await screen.findByTestId("crear-componente"));
    await fireEvent.press(screen.getByTestId("guardar-componente"));
    expect(await screen.findByText("Revise los campos: Nombre y Código.")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("componente-nombre"), "Pasta térmica");
    await fireEvent.changeText(screen.getByTestId("componente-codigo"), "pasta");
    await fireEvent.press(screen.getByTestId("guardar-componente"));
    await waitFor(() =>
      expect(mantenimientosService.crearComponente).toHaveBeenCalledWith({
        nombre: "Pasta térmica",
        codigo: "PASTA",
        descripcion: "",
        es_critico: false,
      }),
    );
    expect(await screen.findByTestId("linea-0")).toHaveTextContent(/Pasta térmica \(PASTA\)/);
    expect(screen.getByTestId("registrar-resultado")).toHaveTextContent(/Componente creado: Pasta térmica\./);
  });

  it("sin `mantenimientos.componentes` no se ofrece crear", async () => {
    await abrir();
    await fireEvent.press(screen.getByTestId("agregar-repuesto"));
    await screen.findByTestId("componente-3");
    expect(screen.queryByTestId("crear-componente")).toBeNull();
  });

  it("sin el activo se elige con un buscador de operativos; salir con cambios pregunta", async () => {
    delete mockParametros.activo;
    activosService.buscarOperativos.mockResolvedValue(pagina([ficha().activo]));
    await render(<PantallaRegistrar />);
    expect(mockPrevenir.activa).toBe(false);
    await fireEvent.changeText(screen.getByTestId("buscar-equipo"), "dell");
    await fireEvent.press(await screen.findByTestId("equipo-42", {}, { timeout: 3000 }));
    expect(activosService.buscarOperativos).toHaveBeenCalledWith("dell");
    expect(screen.getByTestId("equipo-elegido")).toHaveTextContent(/GA-LAP-000042 · Laptop Dell/);
    expect(mockPrevenir.activa).toBe(true);

    const alerta = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => botones[1].onPress());
    await act(async () => {
      mockPrevenir.alIntentar({ data: { action: { type: "GO_BACK" } } });
    });
    expect(alerta).toHaveBeenCalledWith("¿Descartar lo que escribió?", expect.any(String), expect.any(Array), expect.any(Object));
    await waitFor(() => expect(mockNavegacion.dispatch).toHaveBeenCalledWith({ type: "GO_BACK" }));
  });

  it("sin permiso, o con un activo fuera de inventario, no hay formulario", async () => {
    activosService.historial.mockResolvedValueOnce(ficha({ estado: "robado", esta_operativo: false }));
    const { unmount } = await render(<PantallaRegistrar />);
    expect(await screen.findByText(TEXTO_NO_OPERATIVO)).toBeTruthy();
    await unmount();
    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.ver"] };
    await render(<PantallaRegistrar />);
    expect(screen.getByText(TEXTO_SIN_PERMISO_REGISTRAR)).toBeTruthy();
    expect(activosService.historial).toHaveBeenCalledTimes(1);
  });
});

// --- Solicitudes --------------------------------------------------------------------

describe("mis solicitudes y recibidas (CA-18, CA-20)", () => {
  it("la fila dice qué se pidió, el estado, la prioridad y el encargado; «Todas» quita el filtro", async () => {
    mockSesion.usuario = { id: 10, permissions: ["solicitudes.ver", "solicitudes.crear"] };
    mockParametros.vista = "mis_solicitudes";
    await render(<GestionDeActivos />);
    const fila = await screen.findByTestId("solicitud-4");
    expect(fila.props.accessibilityLabel).toBe(
      "Solicitud 4. Laptop — con 32 GB. Estado: Pendiente. Prioridad: Alta. Encargado: Rosa Díaz. Se necesita para el 01/12/2026",
    );
    expect(solicitudesService.listar).toHaveBeenLastCalledWith({ ambito: "mias", abiertas: "true", page: 1 });
    await fireEvent.press(screen.getByRole("tab", { name: "Todas" }));
    await waitFor(() => expect(solicitudesService.listar).toHaveBeenLastCalledWith({ ambito: "mias", page: 1 }));
    await fireEvent.press(screen.getByTestId("nueva-solicitud"));
    expect(mockRouter.push).toHaveBeenCalledWith("/solicitudes/nueva");
    await fireEvent.press(await screen.findByTestId("solicitud-4"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/solicitudes/[id]", params: { id: "4" } });
  });

  it("en «Recibidas» importa quién la pidió y no se ofrece «Nueva solicitud»", async () => {
    mockSesion.usuario = { id: 20, permissions: ["solicitudes.ver", "solicitudes.crear", "solicitudes.gestionar"] };
    mockParametros.vista = "recibidas";
    await render(<GestionDeActivos />);
    expect((await screen.findByTestId("solicitud-4")).props.accessibilityLabel).toMatch(/Pidió: Ana Pérez/);
    expect(screen.queryByTestId("nueva-solicitud")).toBeNull();
  });
});

describe("el detalle de la solicitud (CA-18, CA-20)", () => {
  beforeEach(() => {
    mockParametros.id = "4";
  });

  it("quien la pidió ve el recorrido y la cancela tras confirmar", async () => {
    mockSesion.usuario = { id: 10, permissions: ["solicitudes.ver", "solicitudes.crear"] };
    solicitudesService.cambiarEstado.mockResolvedValueOnce(solicitud({ estado: "cancelada", estado_display: "Cancelada", esta_cerrada: true }));
    await render(<PantallaSolicitud />);
    expect(await screen.findByTestId("movimiento-1")).toHaveTextContent(/Solicitud registrada\./);
    expect(screen.getByLabelText("RAM: 32")).toBeTruthy();
    expect(screen.queryByTestId("paso-en_gestion")).toBeNull();
    await fireEvent.press(screen.getByTestId("paso-cancelada"));
    expect(screen.getByRole("header", { name: "¿Cancelar la solicitud?" })).toBeTruthy();
    await fireEvent.press(screen.getByTestId("volver-paso"));
    expect(solicitudesService.cambiarEstado).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("paso-cancelada"));
    await fireEvent.press(screen.getByTestId("confirmar-paso"));
    await waitFor(() => expect(solicitudesService.cambiarEstado).toHaveBeenCalledWith(4, { estado: "cancelada", nota: "" }, { empresa: undefined }));
    expect(await screen.findByTestId("resultado-solicitud")).toHaveTextContent(/Solicitud cancelada\./);
    expect(screen.getByTestId("estado-de-la-solicitud")).toHaveTextContent(/Cancelada/);
    expect(screen.queryByTestId("paso-cancelada")).toBeNull();
  });

  it("el encargado ve solo las transiciones válidas; rechazar exige nota", async () => {
    mockSesion.usuario = { id: 20, permissions: ["solicitudes.ver", "solicitudes.gestionar"] };
    solicitudesService.cambiarEstado.mockResolvedValueOnce(
      solicitud({ estado: "rechazada", estado_display: "Rechazada", esta_cerrada: true, aviso: { enviado_a: 0, sin_correo: ["Ana Pérez"] } }),
    );
    await render(<PantallaSolicitud />);
    expect(await screen.findByTestId("paso-en_gestion")).toHaveTextContent(/Tomarla/);
    expect(screen.getByTestId("paso-rechazada")).toBeTruthy();
    expect(screen.queryByTestId("paso-comprada")).toBeNull();
    expect(screen.queryByTestId("paso-cancelada")).toBeNull();
    await fireEvent.press(screen.getByTestId("paso-rechazada"));
    await fireEvent.press(screen.getByTestId("confirmar-paso"));
    expect(await screen.findByText("Revise el campo: Nota.")).toBeTruthy();
    expect(screen.getByTestId("paso-nota").props.accessibilityLabel).toContain(`Error: ${TEXTO_NOTA_OBLIGATORIA}`);
    expect(solicitudesService.cambiarEstado).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId("paso-nota"), "Sin presupuesto");
    await fireEvent.press(screen.getByTestId("confirmar-paso"));
    await waitFor(() =>
      expect(solicitudesService.cambiarEstado).toHaveBeenCalledWith(4, { estado: "rechazada", nota: "Sin presupuesto" }, { empresa: undefined }),
    );
    expect(await screen.findByTestId("aviso-sin-correo")).toHaveTextContent(/No se pudo avisar por correo a Ana Pérez/);
  });

  it("un 403 por no ser el encargado se explica con el mensaje del servidor", async () => {
    mockSesion.usuario = { id: 20, permissions: ["solicitudes.ver", "solicitudes.gestionar"] };
    solicitudesService.cambiarEstado.mockRejectedValueOnce(
      error(403, "permission_denied", "Esta solicitud la gestiona quien la tiene asignada, o quien administra compras."),
    );
    await render(<PantallaSolicitud />);
    await fireEvent.press(await screen.findByTestId("paso-en_gestion"));
    await fireEvent.press(screen.getByTestId("confirmar-paso"));
    expect(await screen.findByText("Esta solicitud la gestiona quien la tiene asignada, o quien administra compras.")).toBeTruthy();
  });

  it("de un aviso de otra empresa: la pide con su X-Empresa y no ofrece acciones", async () => {
    mockSesion.usuario = { id: 10, permissions: ["solicitudes.ver", "solicitudes.crear"] };
    mockParametros.empresa = "5";
    await render(<PantallaSolicitud />);
    await screen.findByTestId("detalle-solicitud-equipo");
    expect(solicitudesService.detalle).toHaveBeenCalledWith("4", { empresa: "5" });
    expect(screen.queryByTestId("acciones-de-la-solicitud")).toBeNull();
  });
});

describe("nueva solicitud (CA-19)", () => {
  beforeEach(() => {
    mockSesion.usuario = { id: 10, permissions: ["solicitudes.ver", "solicitudes.crear"] };
  });

  it("con un tipo del catálogo pide sus características obligatorias y envía", async () => {
    solicitudesService.crear.mockResolvedValueOnce(solicitud({ id: 50, aviso: { enviado_a: 1, sin_correo: [] } }));
    await render(<PantallaNuevaSolicitud />);
    await fireEvent.press(await screen.findByTestId("solicitud-catalogo"));
    await fireEvent.press(screen.getByTestId("solicitud-catalogo-opcion-1"));
    expect(await screen.findByTestId("caracteristicas")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("solicitud-encargado"));
    await fireEvent.press(screen.getByTestId("solicitud-encargado-opcion-20"));
    await fireEvent.changeText(screen.getByTestId("solicitud-justificacion"), "Entra un analista");
    await fireEvent.press(screen.getByTestId("enviar-solicitud"));
    expect(await screen.findByText("Revise el campo: Características.")).toBeTruthy();
    expect(screen.getByTestId("espec-11").props.accessibilityLabel).toMatch(/Error: «RAM» es obligatoria/);
    expect(solicitudesService.crear).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId("espec-11"), "32");
    await fireEvent.press(screen.getByTestId("enviar-solicitud"));
    await waitFor(() =>
      expect(solicitudesService.crear).toHaveBeenCalledWith({
        clase: "dispositivo",
        tipo_dispositivo: 1,
        componente: null,
        detalle: "",
        especificaciones: { RAM: 32 },
        cantidad: 1,
        prioridad: "media",
        fecha_necesaria: null,
        encargado: 20,
        justificacion: "Entra un analista",
      }),
    );
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/solicitudes/[id]", params: { id: "50" } }));
  });

  it("sin catálogo exige el detalle; los 400 van a su campo y un doble toque envía una vez", async () => {
    const espera = enEspera();
    solicitudesService.crear
      .mockRejectedValueOnce(error(400, "validation_error", "Error en la solicitud.", { encargado: ["Clave primaria inválida."] }))
      .mockReturnValueOnce(espera.promesa);
    await render(<PantallaNuevaSolicitud />);
    await fireEvent.press(await screen.findByTestId("solicitud-clase-componente"));
    await fireEvent.press(screen.getByTestId("solicitud-encargado"));
    await fireEvent.press(screen.getByTestId("solicitud-encargado-opcion-20"));
    await fireEvent.changeText(screen.getByTestId("solicitud-justificacion"), "Sala de reuniones");
    await fireEvent.press(screen.getByTestId("enviar-solicitud"));
    expect(await screen.findByText("Revise los campos: Componente y Detalle.")).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId("solicitud-detalle"), "Cable HDMI de 5 m");
    await fireEvent.press(screen.getByTestId("enviar-solicitud"));
    expect(await screen.findByText("Revise el campo: Quién realizará la compra.")).toBeTruthy();
    expect(screen.getByTestId("solicitud-encargado").props.accessibilityLabel).toMatch(/Error: Clave primaria inválida\./);

    const enviar = manejadorDe(screen.getByTestId("enviar-solicitud"), "onPress");
    await act(async () => {
      enviar();
      enviar();
    });
    expect(solicitudesService.crear).toHaveBeenCalledTimes(2);
    expect(solicitudesService.crear).toHaveBeenLastCalledWith(
      expect.objectContaining({ clase: "componente", componente: null, tipo_dispositivo: null, detalle: "Cable HDMI de 5 m" }),
    );
    await act(async () => {
      espera.resolver(solicitud({ id: 51 }));
    });
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  });

  it("sin `solicitudes.crear` no hay formulario", async () => {
    mockSesion.usuario = { id: 10, permissions: ["solicitudes.ver"] };
    await render(<PantallaNuevaSolicitud />);
    expect(screen.getByTestId("sin-permiso-pedir")).toBeTruthy();
    expect(solicitudesService.catalogo).not.toHaveBeenCalled();
  });
});

// --- Ronda 1 de correcciones tras QA (16/11/2026) -----------------------------------

describe("ronda 1: registrar mantenimiento (UX H-03, H-04)", () => {
  beforeEach(() => {
    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.ver", "mantenimientos.registrar"] };
    mockParametros.activo = "42";
  });

  it("lo de la salida solo aparece con «Sí, ya salió» y entonces se envía; con «No», no", async () => {
    mantenimientosService.registrar.mockResolvedValue(mantenimiento({ id: 78 }));
    await render(<PantallaRegistrar />);
    await screen.findByTestId("equipo-elegido");
    expect(screen.queryByTestId("mantenimiento-salida")).toBeNull();
    expect(screen.queryByTestId("mantenimiento-estado-final-reparado")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("mantenimiento-responsable"), "Luis Mora");
    await fireEvent.changeText(screen.getByTestId("mantenimiento-descripcion"), "Limpieza");
    await fireEvent.press(screen.getByTestId("mantenimiento-salio-si"));
    expect(screen.getByTestId("mantenimiento-salida").props.accessibilityLabel).toMatch(/^Fecha de salida \(obligatorio\): /);
    await fireEvent.changeText(screen.getByTestId("mantenimiento-solucion"), "Se limpió");
    await fireEvent.press(screen.getByTestId("mantenimiento-salio-no"));
    await fireEvent.press(screen.getByTestId("guardar-mantenimiento"));
    await waitFor(() =>
      expect(mantenimientosService.registrar).toHaveBeenLastCalledWith(
        expect.objectContaining({ fecha_salida: null, solucion: "", estado_final: "reparado" }),
      ),
    );
  });

  it("un error en lo plegado abre «Más detalles» solo", async () => {
    mantenimientosService.registrar.mockRejectedValueOnce(
      error(400, "validation_error", "Error en la solicitud.", { costo_mano_obra: ["Asegúrese de que no haya más de 12 dígitos."] }),
    );
    await render(<PantallaRegistrar />);
    await screen.findByTestId("equipo-elegido");
    await fireEvent.changeText(screen.getByTestId("mantenimiento-responsable"), "Luis Mora");
    await fireEvent.changeText(screen.getByTestId("mantenimiento-descripcion"), "Limpieza");
    expect(screen.queryByTestId("mantenimiento-costo")).toBeNull();
    await fireEvent.press(screen.getByTestId("guardar-mantenimiento"));
    expect(await screen.findByText("Revise el campo: Costo de mano de obra.")).toBeTruthy();
    expect(screen.getByTestId("mantenimiento-costo").props.accessibilityLabel).toMatch(/Error: Asegúrese/);
    expect(screen.getByTestId("mas-detalles").props.accessibilityState).toEqual({ expanded: true });
  });

  it("con «Sí» se propone la fecha de hoy y se envía", async () => {
    await render(<PantallaRegistrar />);
    await screen.findByTestId("equipo-elegido");
    await fireEvent.changeText(screen.getByTestId("mantenimiento-responsable"), "Luis Mora");
    await fireEvent.changeText(screen.getByTestId("mantenimiento-descripcion"), "Limpieza");
    await fireEvent.press(screen.getByTestId("mantenimiento-salio-si"));
    await fireEvent.press(screen.getByTestId("guardar-mantenimiento"));
    await waitFor(() => expect(mantenimientosService.registrar).toHaveBeenCalledWith(expect.objectContaining({ fecha_salida: HOY })));
  });
});

describe("ronda 1: CA-22 en una lista", () => {
  it("la bitácora vuelve a pedirse desde cero al cambiar de empresa", async () => {
    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.ver"] };
    mockParametros.vista = "mantenimientos";
    const { rerender } = await render(<GestionDeActivos />);
    await screen.findByTestId("mantenimiento-9");
    let resolver;
    mantenimientosService.listar.mockReturnValueOnce(new Promise((r) => (resolver = r)));
    mockSesion.empresaActiva = { id: 3 };
    mockSesion.versionEmpresa = 1;
    await rerender(<GestionDeActivos />);
    expect(screen.queryByTestId("mantenimiento-9")).toBeNull();
    await act(async () => resolver(pagina([mantenimiento({ id: 12 })])));
    expect(await screen.findByTestId("mantenimiento-12")).toBeTruthy();
  });

  it("«Escanear la etiqueta» junto a «Registrar mantenimiento» (UX H-01)", async () => {
    mockSesion.usuario = { id: 10, permissions: ["mantenimientos.ver", "mantenimientos.registrar"] };
    mockParametros.vista = "mantenimientos";
    await render(<GestionDeActivos />);
    await fireEvent.press(await screen.findByTestId("escanear-desde-la-lista"));
    expect(mockRouter.push).toHaveBeenCalledWith("/activos/escanear");
  });
});
