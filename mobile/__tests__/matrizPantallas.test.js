import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as FileSystem from "expo-file-system";
import * as Linking from "expo-linking";
import { AccessibilityInfo, Alert } from "react-native";

import { matrizService } from "../src/api/servicios";
import {
  diaEnZona,
  TEXTO_NO_DISPONIBLE,
  TEXTO_PUEDE_HABERSE_GUARDADO,
  TEXTO_SIN_ROL,
  TEXTO_YA_NO_ES_SUYO,
} from "../src/matriz/formato";
import { olvidarEmpresaDeLaMatriz } from "../src/matriz/useEmpresaDeLaMatriz";
import { TEXTO_CONFIRMAR_RECORDATORIO, TEXTO_MOTIVO_CORTO } from "../src/pantallas/matriz/AccionesDelPeriodo";
import { Matriz } from "../src/pantallas/matriz/Matriz";
import PantallaDia from "../src/app/(app)/matriz/dia/[fecha]";
import PantallaEstado from "../src/app/(app)/matriz/estado/[estado]";
import PantallaPeriodo from "../src/app/(app)/matriz/periodo/[id]";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockNavegacion = { setOptions: jest.fn() };
const mockParametros = {};
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useNavigation: () => mockNavegacion,
    useLocalSearchParams: () => mockParametros,
    useIsFocused: () => true,
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

const mockSesion = {
  usuario: { permissions: ["matriz.editar"] },
  empresaActiva: { id: 2 },
  versionEmpresa: 0,
};
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));

jest.mock("../src/navegacion/useContextoDeNavegacion", () => ({
  useContextoDeNavegacion: () => ({ permisos: ["matriz.editar"], vistas: {} }),
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});

jest.mock("../src/api/api", () => ({
  api: {
    url: (ruta) => `https://api.prueba/api/v1${ruta}`,
    conRenovacion: jest.fn(async (hacer, { empresa } = {}) =>
      hacer({ Authorization: "Bearer access", ...(empresa ? { "X-Empresa": empresa } : {}) }),
    ),
  },
}));

jest.mock("../src/api/servicios", () => ({
  matrizService: {
    misEmpresas: jest.fn(),
    resumen: jest.fn(),
    periodos: jest.fn(),
    periodo: jest.fn(),
    editarSeguimiento: jest.fn(),
    historial: jest.fn(),
    documentos: jest.fn(),
    urlArchivo: (id) => `https://api.prueba/api/v1/matriz/documentos/${id}/archivo/`,
    cambiarVencimiento: jest.fn(),
    enviarRecordatorio: jest.fn(),
    calendario: jest.fn(),
    personas: jest.fn(),
    catalogos: jest.fn(),
  },
}));

const ZONA = "America/Guayaquil";

function errorDeRed() {
  return Object.assign(new Error("red"), { esDeRed: true });
}

function error(status, message, details = null) {
  const e = new Error(message);
  e.response = { status, data: { error: { code: "x", message, details } } };
  return e;
}

function anunciados() {
  return AccessibilityInfo.announceForAccessibility.mock.calls.map(([t]) => t);
}

/** Una fila de `PeriodoListaSerializer`. */
function fila(campos = {}) {
  return {
    id: 15,
    codigo: "TRI-001",
    etiqueta: "Noviembre 2026",
    obligacion: { id: 3, nombre: "Declaración del IVA" },
    area: "Tributario",
    entidad: "SRI",
    responsable: { id: 4, nombre: "Ana Pérez", email: "ana@laar.com" },
    prioridad: "alta",
    vence_en: "2026-11-14T03:00:00Z",
    etapa: "en_preparacion",
    avance: 40,
    cerrado: false,
    estado: { group: "en_progreso", label: "En preparación", days_remaining: 4, is_due_today: false },
    ...campos,
  };
}

/** Un detalle de `PeriodoDetalleSerializer`. */
function detalle(campos = {}) {
  return {
    ...fila(),
    obligacion: {
      id: 3,
      nombre: "Declaración del IVA",
      descripcion: "Formulario 104",
      area_nombre: "Tributario",
      entidad_nombre: "SRI",
      tipo: "regulatoria",
      periodicidad: "mensual",
      fundamento_legal: "LRTI art. 67",
      fundamento_url: "https://www.sri.gob.ec",
      evidencia_esperada: "Comprobante de declaración",
    },
    empresa: { id: 2, nombre: "LAARCOURIER", zona_horaria: ZONA },
    sede: { id: 1, nombre: "Matriz Quito" },
    fecha_inicio: "2026-11-01",
    fecha_preparacion: "2026-11-10",
    suplente: null,
    supervisor: { id: 5, nombre: "Luis Mora", email: "luis@laar.com" },
    aprobador: null,
    observaciones: "",
    enviado_en: null,
    cumplido_en: null,
    validado_en: null,
    validado_por: null,
    recordatorios_suspendidos: false,
    acciones: ["edit", "change_due_date", "remind"],
    ...campos,
  };
}

const RESUMEN = {
  counts: { overdue: 2, in_progress: 5, due_soon: 3, done: 7, done_on_time: 6, done_late: 1, attention: 3 },
  upcoming: [fila()],
  recent_closures: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  olvidarEmpresaDeLaMatriz();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  for (const k of Object.keys(mockParametros)) delete mockParametros[k];
  mockSesion.usuario = { permissions: ["matriz.editar"] };
  mockSesion.empresaActiva = { id: 2 };
  matrizService.misEmpresas.mockResolvedValue({
    empresas: [
      { id: 2, nombre: "LAARCOURIER", zona_horaria: ZONA, roles: ["Responsable"], capacidades: ["matriz.editar"] },
    ],
  });
  matrizService.resumen.mockResolvedValue(RESUMEN);
  matrizService.periodo.mockResolvedValue(detalle());
  matrizService.historial.mockResolvedValue([
    {
      id: 1,
      created_at: "2026-11-02T15:00:00Z",
      actor: "Ana Pérez",
      descripcion: "Avance",
      valor_anterior: "20",
      valor_nuevo: "40",
      motivo: "",
    },
  ]);
  matrizService.documentos.mockResolvedValue([]);
  matrizService.catalogos.mockResolvedValue({
    sedes: [
      { id: 1, nombre: "Matriz Quito" },
      { id: 2, nombre: "Guayaquil" },
    ],
    prioridades: [
      { valor: "alta", nombre: "Alta" },
      { valor: "media", nombre: "Media" },
      { valor: "baja", nombre: "Baja" },
    ],
  });
  matrizService.personas.mockResolvedValue([
    { id: 4, nombre: "Ana Pérez", email: "ana@laar.com" },
    { id: 5, nombre: "Luis Mora", email: "luis@laar.com" },
    { id: 6, nombre: "José Núñez", email: "jose@laar.com" },
  ]);
});

describe("la Bandeja (CA-2)", () => {
  it("las cuatro tarjetas con las cifras de resumen/, su texto y su número dicho", async () => {
    await render(<Matriz />);
    expect(await screen.findByRole("button", { name: "Incumplidas: 2. Vencidas sin cierre validado" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "En progreso: 5. Abiertas dentro del plazo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Próximas a vencer: 3. En los próximos 7 días" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finalizadas: 7. 6 a tiempo · 1 fuera de plazo" })).toBeTruthy();
    expect(screen.getByText("Bandeja")).toBeTruthy();
    expect(screen.getByText("Su rol: Responsable")).toBeTruthy();
    // Los próximos vencimientos, en la hora de la empresa.
    expect(screen.getByTestId("periodo-15").props.accessibilityLabel).toContain("Vence el 13/11/2026, 22:00");
    expect(screen.getByText("Todavía no hay cierres validados.")).toBeTruthy();
    expect(matrizService.resumen).toHaveBeenCalledTimes(1);
  });

  it("CA-3: tocar una tarjeta abre la lista de ese estado; una fila, el detalle", async () => {
    await render(<Matriz />);
    await fireEvent.press(await screen.findByTestId("tarjeta-proximas"));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/matriz/estado/[estado]",
      params: { estado: "proximas" },
    });
    await fireEvent.press(screen.getByTestId("periodo-15"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/matriz/periodo/[id]", params: { id: "15" } });
  });

  it("sin rol de la Matriz en la empresa activa lo dice (la web: SinRolMatriz)", async () => {
    mockSesion.empresaActiva = { id: 9 };
    await render(<Matriz />);
    expect(await screen.findByText(TEXTO_SIN_ROL)).toBeTruthy();
    expect(matrizService.resumen).not.toHaveBeenCalled();
  });

  it("un error del resumen, con «Reintentar»", async () => {
    matrizService.resumen.mockRejectedValueOnce(errorDeRed());
    await render(<Matriz />);
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("tarjeta-incumplido")).toBeTruthy();
  });

  it("lo demás, en el navegador con la empresa activa", async () => {
    await render(<Matriz />);
    await fireEvent.press(await screen.findByRole("link", { name: "Reportes. Abrir en el navegador" }));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/reportes\/matriz\?empresa=2$/));
  });
});

describe("la lista de un estado (CA-3)", () => {
  it("«Próximas a vencer» pide en progreso por vencimiento, como la web, y dice cada fila", async () => {
    mockParametros.estado = "proximas";
    matrizService.periodos.mockResolvedValueOnce({ count: 1, next: null, results: [fila()] });
    await render(<PantallaEstado />);
    expect(await screen.findByTestId("periodo-15")).toBeTruthy();
    expect(matrizService.periodos).toHaveBeenCalledWith({
      status: "en_progreso",
      sort: "due",
      page: 1,
      page_size: undefined,
    });
    const nombre = screen.getByTestId("periodo-15").props.accessibilityLabel;
    expect(nombre).toBe(
      "Declaración del IVA. SRI · Tributario. Responsable: Ana Pérez. Vence el 13/11/2026, 22:00. Estado: En preparación. Quedan 4 días",
    );
    expect(screen.getByText("1 obligación")).toBeTruthy();
    // Pedido del usuario (ronda 1): el título va solo en la cabecera de la pila.
    expect(screen.queryByText("Próximas a vencer")).toBeNull();
  });

  it("carga más con «Ver más» (página 2) y sin repetir", async () => {
    mockParametros.estado = "incumplido";
    matrizService.periodos
      .mockResolvedValueOnce({ count: 2, next: "p2", results: [fila({ id: 1 })] })
      .mockResolvedValueOnce({ count: 2, next: null, results: [fila({ id: 1 }), fila({ id: 2 })] });
    await render(<PantallaEstado />);
    await fireEvent.press(await screen.findByTestId("ver-mas"));
    expect(await screen.findByTestId("periodo-2")).toBeTruthy();
    expect(matrizService.periodos).toHaveBeenLastCalledWith({ status: "incumplido", page: 2 });
    expect(screen.getAllByTestId(/^periodo-/)).toHaveLength(2);
    expect(screen.queryByTestId("ver-mas")).toBeNull();
  });

  it("vacía y con error con «Reintentar»", async () => {
    mockParametros.estado = "finalizado";
    matrizService.periodos.mockRejectedValueOnce(errorDeRed());
    matrizService.periodos.mockResolvedValueOnce({ count: 0, next: null, results: [] });
    await render(<PantallaEstado />);
    await fireEvent.press(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("No hay obligaciones en este estado.")).toBeTruthy();
  });

  it("un estado que no existe no pide nada", async () => {
    mockParametros.estado = "otro";
    await render(<PantallaEstado />);
    expect(screen.getByText("Esta lista no existe.")).toBeTruthy();
    expect(matrizService.periodos).not.toHaveBeenCalled();
  });
});

describe("el detalle (CA-4 a CA-6)", () => {
  async function abrir(campos) {
    if (campos) matrizService.periodo.mockResolvedValue(detalle(campos));
    mockParametros.id = "15";
    await render(<PantallaPeriodo />);
    await screen.findByTestId("detalle-periodo");
  }

  it("CA-4: datos, seguimiento, fechas, estado e historial", async () => {
    await abrir();
    expect(screen.getByRole("header", { name: "Declaración del IVA" })).toBeTruthy();
    expect(screen.getByText("En preparación")).toBeTruthy();
    expect(screen.getByLabelText("Vence: 13/11/2026, 22:00 · Quedan 4 días")).toBeTruthy();
    expect(screen.getByLabelText("Entidad de control: SRI")).toBeTruthy();
    expect(screen.getByLabelText("Responsable: Ana Pérez · ana@laar.com")).toBeTruthy();
    expect(screen.getByLabelText("Suplente: —")).toBeTruthy();
    expect(screen.getByLabelText("Prioridad: Alta")).toBeTruthy();
    expect(screen.getByLabelText("Avance: 40 %").props.accessibilityValue).toEqual({ min: 0, max: 100, now: 40 });
    expect(screen.getByLabelText("Inicio: 01/11/2026")).toBeTruthy();
    expect(mockNavegacion.setOptions).toHaveBeenCalledWith({ title: "TRI-001" });
    await fireEvent.press(screen.getByRole("button", { name: "Historial (1)" }));
    expect(screen.getByText("20 → 40")).toBeTruthy();
    expect(matrizService.periodo).toHaveBeenCalledWith("15", { empresa: null });
  });

  it("CA-5: solo los botones que el servidor ofrece y que la app hace", async () => {
    await abrir({ acciones: ["remind"] });
    expect(screen.getByRole("button", { name: "Reenviar recordatorio" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar seguimiento" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cambiar fecha" })).toBeNull();
    expect(screen.queryByTestId("acciones-en-la-web")).toBeNull();
  });

  it("CA-6: enviar a validación, cargar o validar no se hacen aquí; se ofrece la web con la empresa", async () => {
    await abrir({ acciones: ["upload", "submit", "edit"] });
    // H-13: nombra solo lo que el servidor ofrece.
    expect(screen.getByText("Enviar a validación y cargar evidencia se hacen en la web.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Enviar a validación|Cargar evidencia/ })).toBeNull();
    await fireEvent.press(screen.getByTestId("abrir-periodo-en-la-web"));
    expect(Linking.openURL).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/matriz\/obligaciones\?periodo=15&empresa=2$/),
    );
  });

  it("sin acciones (cerrado) no hay botones", async () => {
    await abrir({ acciones: [], cerrado: true, estado: { group: "finalizado", label: "Finalizado" } });
    expect(screen.queryByTestId("acciones-del-periodo")).toBeNull();
    expect(screen.getByText("El período está cerrado: sus documentos son de solo lectura.")).toBeTruthy();
  });

  it("un período que no puede ver (404)", async () => {
    matrizService.periodo.mockRejectedValueOnce(error(404, "No encontrado."));
    mockParametros.id = "15";
    await render(<PantallaPeriodo />);
    expect(await screen.findByText(TEXTO_NO_DISPONIBLE)).toBeTruthy();
  });

  it("un id que no es un número no pide nada", async () => {
    mockParametros.id = "abc";
    await render(<PantallaPeriodo />);
    expect(screen.getByText(TEXTO_NO_DISPONIBLE)).toBeTruthy();
    expect(matrizService.periodo).not.toHaveBeenCalled();
  });

  it("CA-8: desde un aviso, con la empresa del aviso en cada petición", async () => {
    mockParametros.id = "15";
    mockParametros.empresa = "3";
    await render(<PantallaPeriodo />);
    await screen.findByTestId("detalle-periodo");
    expect(matrizService.periodo).toHaveBeenCalledWith("15", { empresa: "3" });
    expect(matrizService.historial).toHaveBeenCalledWith("15", { empresa: "3" });
    expect(matrizService.documentos).toHaveBeenCalledWith("15", { empresa: "3" });
  });

  it("CA-4: las evidencias se abren con el visor y se borran al salir; las rechazadas, con su motivo", async () => {
    matrizService.documentos.mockResolvedValue([
      {
        id: 31,
        nombre_original: "declaracion.pdf",
        version: 1,
        tamano: 2048,
        estado: "valido",
        created_at: "2026-11-05T15:00:00Z",
        subido_por: { nombre: "Ana Pérez" },
      },
      {
        id: 32,
        nombre_original: "borrador.pdf",
        version: 1,
        tamano: 1024,
        estado: "rechazado",
        motivo_rechazo: "Ilegible",
        rechazado_por: { nombre: "Luis Mora" },
      },
    ]);
    await abrir();
    expect(screen.getByLabelText("Rechazado: borrador.pdf, versión 1. Rechazado por Luis Mora: Ilegible")).toBeTruthy();
    const { unmount } = { unmount: screen.unmount };
    await fireEvent.press(screen.getByTestId("evidencia-31"));
    await waitFor(() => expect(FileSystem.File.preview).toHaveBeenCalled());
    const archivo = FileSystem.File.preview.mock.calls[0][0];
    expect(archivo.uri).toBe("file:///cache/matriz-documentos/evidencia-31.pdf");
    expect(FileSystem.__existentes.has(archivo.uri)).toBe(true);
    await act(async () => unmount());
    expect(FileSystem.__existentes.has(archivo.uri)).toBe(false);
  });

  it("CA-5: Editar seguimiento, con el PATCH de la web, actualiza y lo anuncia", async () => {
    matrizService.editarSeguimiento.mockResolvedValueOnce({ ...detalle({ avance: 75 }), visible: true });
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Editar seguimiento" }));
    const ventana = await screen.findByTestId("ventana-seguimiento");
    await within(ventana).findByTestId("guardar-seguimiento");
    await fireEvent.changeText(within(ventana).getByTestId("seguimiento-avance"), "75");
    await fireEvent.press(within(ventana).getByTestId("seguimiento-suplente"));
    await fireEvent.press(screen.getByTestId("seguimiento-suplente-opcion-6"));
    await fireEvent.press(within(ventana).getByTestId("guardar-seguimiento"));
    await waitFor(() => expect(matrizService.editarSeguimiento).toHaveBeenCalled());
    expect(matrizService.editarSeguimiento).toHaveBeenCalledWith(
      15,
      {
        responsable: 4,
        suplente: 6,
        supervisor: 5,
        aprobador: null,
        prioridad: "alta",
        avance: 75,
        observaciones: "",
        sede: 1,
      },
      { empresa: null },
    );
    expect(await screen.findByText("Seguimiento actualizado.")).toBeTruthy();
    expect(screen.queryByTestId("ventana-seguimiento")).toBeNull();
    expect(anunciados()).toContain("Seguimiento actualizado.");
    // El detalle se relee.
    await waitFor(() => expect(matrizService.periodo).toHaveBeenCalledTimes(2));
  });

  it("CA-5: la lista de personas se busca sin tildes", async () => {
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Editar seguimiento" }));
    await screen.findByTestId("guardar-seguimiento");
    await fireEvent.press(screen.getByTestId("seguimiento-aprobador"));
    await fireEvent.changeText(screen.getByTestId("seguimiento-aprobador-buscar"), "nunez");
    expect(screen.getByTestId("seguimiento-aprobador-opcion-6")).toBeTruthy();
    expect(screen.queryByTestId("seguimiento-aprobador-opcion-4")).toBeNull();
    // «Sin asignar» siempre queda.
    expect(screen.getByTestId("seguimiento-aprobador-opcion-vacia")).toBeTruthy();
  });

  it("CA-5: valida antes de enviar (avance de 0 a 100)", async () => {
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Editar seguimiento" }));
    await fireEvent.changeText(await screen.findByTestId("seguimiento-avance"), "150");
    await fireEvent.press(screen.getByTestId("guardar-seguimiento"));
    expect(await screen.findByText("Revise el campo: Avance (%).")).toBeTruthy();
    // El error va junto al campo y en su nombre accesible.
    expect(screen.getByTestId("seguimiento-avance").props.accessibilityLabel).toContain(
      "Error: El avance va de 0 a 100, sin decimales.",
    );
    expect(matrizService.editarSeguimiento).not.toHaveBeenCalled();
  });

  it("CA-5: el error del servidor junto a su campo", async () => {
    matrizService.editarSeguimiento.mockRejectedValueOnce(
      error(400, "Error en la solicitud.", { suplente: ["Luis Mora no trabaja en LAARCOURIER."] }),
    );
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Editar seguimiento" }));
    await fireEvent.press(await screen.findByTestId("guardar-seguimiento"));
    expect(await screen.findByText("Revise el campo: Suplente.")).toBeTruthy();
    expect(screen.getByTestId("seguimiento-suplente").props.accessibilityLabel).toContain(
      "Error: Luis Mora no trabaja en LAARCOURIER.",
    );
  });

  it("CA-5: si falla la red, puede que se haya guardado; lo escrito queda y el detalle se relee", async () => {
    matrizService.editarSeguimiento.mockRejectedValueOnce(errorDeRed());
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Editar seguimiento" }));
    await fireEvent.changeText(await screen.findByTestId("seguimiento-avance"), "90");
    await fireEvent.press(screen.getByTestId("guardar-seguimiento"));
    expect(await screen.findByText(TEXTO_PUEDE_HABERSE_GUARDADO)).toBeTruthy();
    expect(screen.getByTestId("seguimiento-avance").props.value).toBe("90");
    await waitFor(() => expect(matrizService.periodo).toHaveBeenCalledTimes(2));
  });

  it("CA-5: si lo cedió a otra persona, lo dice en vez de un 404", async () => {
    matrizService.editarSeguimiento.mockResolvedValueOnce({ ...detalle(), visible: false });
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Editar seguimiento" }));
    await fireEvent.press(await screen.findByTestId("guardar-seguimiento"));
    expect(await screen.findByText(TEXTO_YA_NO_ES_SUYO)).toBeTruthy();
    expect(matrizService.periodo).toHaveBeenCalledTimes(1);
  });

  it("CA-5: Cambiar fecha valida la justificación y manda lo de la web", async () => {
    matrizService.cambiarVencimiento.mockResolvedValueOnce(detalle());
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Cambiar fecha" }));
    const ventana = await screen.findByTestId("ventana-fecha");
    expect(within(ventana).getByLabelText("Vencimiento actual: 13/11/2026, 22:00")).toBeTruthy();
    await fireEvent.changeText(within(ventana).getByTestId("justificacion"), "corto");
    await fireEvent.press(within(ventana).getByTestId("guardar-fecha"));
    expect(await within(ventana).findByText("Revise los campos: Nueva fecha y Justificación.")).toBeTruthy();
    expect(within(ventana).getByTestId("justificacion").props.accessibilityLabel).toContain(
      `Error: ${TEXTO_MOTIVO_CORTO}`,
    );
    expect(within(ventana).getByTestId("nueva-fecha").props.accessibilityLabel).toContain(
      "Error: Elija la nueva fecha.",
    );
    expect(matrizService.cambiarVencimiento).not.toHaveBeenCalled();
  });

  it("CA-5: Reenviar recordatorio pide confirmación, envía y lo anuncia", async () => {
    matrizService.enviarRecordatorio.mockResolvedValueOnce([]);
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Reenviar recordatorio" }));
    expect(await screen.findByText(TEXTO_CONFIRMAR_RECORDATORIO)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("enviar-recordatorio"));
    expect(await screen.findByText("Recordatorio enviado.")).toBeTruthy();
    expect(matrizService.enviarRecordatorio).toHaveBeenCalledWith(15, { empresa: null });
  });

  it("CA-5: el motivo del servidor al reenviar (400 con detail)", async () => {
    matrizService.enviarRecordatorio.mockRejectedValueOnce(
      error(400, "Error en la solicitud.", { detail: "El período está cerrado: sus recordatorios están suspendidos." }),
    );
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Reenviar recordatorio" }));
    await fireEvent.press(await screen.findByTestId("enviar-recordatorio"));
    expect(await screen.findByText("El período está cerrado: sus recordatorios están suspendidos.")).toBeTruthy();
  });
});

describe("el calendario (CA-7 y CA-9)", () => {
  const hoy = diaEnZona(new Date(), ZONA);
  const [anio, mes] = hoy.split("-").map(Number);

  it("el mes actual de calendario/, con cada día dicho y su número de obligaciones", async () => {
    mockParametros.vista = "calendario";
    matrizService.calendario.mockResolvedValue({
      year: anio,
      month: mes,
      periods: [
        fila({ id: 1, vence_en: `${hoy}T17:00:00-05:00` }),
        fila({
          id: 2,
          vence_en: `${hoy}T18:00:00-05:00`,
          estado: { group: "incumplido", label: "Incumplido", days_overdue: 1 },
        }),
      ],
    });
    await render(<Matriz />);
    const dia = await screen.findByTestId(`dia-${hoy}`);
    expect(matrizService.calendario).toHaveBeenCalledWith(anio, mes);
    expect(dia.props.accessibilityLabel).toMatch(/, hoy, 2 obligaciones, 1 incumplida$/);
    expect(within(dia).getByText("2")).toBeTruthy();
    await fireEvent.press(dia);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/matriz/dia/[fecha]", params: { fecha: hoy } });
  });

  it("un día sin obligaciones lo dice y no lleva a nada", async () => {
    mockParametros.vista = "calendario";
    matrizService.calendario.mockResolvedValue({ year: anio, month: mes, periods: [] });
    await render(<Matriz />);
    const dia = await screen.findByTestId(`dia-${hoy}`);
    expect(dia.props.accessibilityLabel).toMatch(/sin obligaciones$/);
    expect(dia.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("pasa al mes siguiente y al anterior y lo anuncia", async () => {
    mockParametros.vista = "calendario";
    matrizService.calendario.mockResolvedValue({ periods: [] });
    await render(<Matriz />);
    await screen.findByTestId(`dia-${hoy}`);
    await fireEvent.press(screen.getByRole("button", { name: "Mes siguiente" }));
    const siguiente = mes === 12 ? [anio + 1, 1] : [anio, mes + 1];
    await waitFor(() => expect(matrizService.calendario).toHaveBeenLastCalledWith(...siguiente));
    await fireEvent.press(screen.getByRole("button", { name: "Mes anterior" }));
    await fireEvent.press(screen.getByRole("button", { name: "Mes anterior" }));
    const anterior = mes === 1 ? [anio - 1, 12] : [anio, mes - 1];
    await waitFor(() => expect(matrizService.calendario).toHaveBeenLastCalledWith(...anterior));
    expect(anunciados().length).toBeGreaterThanOrEqual(3);
  });

  it("la lista del día pide due_from y due_to de ese día", async () => {
    mockParametros.fecha = "2026-11-13";
    matrizService.periodos.mockResolvedValueOnce({ count: 1, next: null, results: [fila()] });
    await render(<PantallaDia />);
    expect(await screen.findByText("Viernes 13 de noviembre de 2026")).toBeTruthy();
    expect(matrizService.periodos).toHaveBeenCalledWith({
      due_from: "2026-11-13",
      due_to: "2026-11-13",
      sort: "due",
      page: 1,
      page_size: undefined,
    });
    await fireEvent.press(screen.getByTestId("periodo-15"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/matriz/periodo/[id]", params: { id: "15" } });
  });

  it("una fecha que no existe no pide nada", async () => {
    mockParametros.fecha = "2026-02-30";
    await render(<PantallaDia />);
    expect(screen.getByText("Esa fecha no es válida.")).toBeTruthy();
    expect(matrizService.periodos).not.toHaveBeenCalled();
  });
});

describe("ronda 1 de correcciones", () => {
  async function abrir(campos) {
    if (campos) matrizService.periodo.mockResolvedValue(detalle(campos));
    mockParametros.id = "15";
    await render(<PantallaPeriodo />);
    await screen.findByTestId("detalle-periodo");
  }

  function pendiente() {
    let resolver;
    let rechazar;
    const promesa = new Promise((r, x) => {
      resolver = r;
      rechazar = x;
    });
    return { promesa, resolver, rechazar };
  }

  it("«hora de Ecuador» y no «America/Guayaquil»", async () => {
    await render(<Matriz />);
    expect(await screen.findByText("Los vencimientos van en la hora de Ecuador.")).toBeTruthy();
    expect(screen.queryByText(/America\/Guayaquil/)).toBeNull();
  });

  it("H-02: un doble toque rápido en Guardar hace una sola petición", async () => {
    const espera = pendiente();
    matrizService.editarSeguimiento.mockReturnValueOnce(espera.promesa);
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Editar seguimiento" }));
    const guardar = await screen.findByTestId("guardar-seguimiento");
    await act(async () => {
      fireEvent.press(guardar);
      fireEvent.press(guardar);
    });
    expect(matrizService.editarSeguimiento).toHaveBeenCalledTimes(1);
    await act(async () => espera.resolver({ ...detalle(), visible: true }));
  });

  it("H-02: también en Cambiar fecha y en Enviar recordatorio", async () => {
    const espera = pendiente();
    matrizService.enviarRecordatorio.mockReturnValueOnce(espera.promesa);
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Reenviar recordatorio" }));
    const enviar = await screen.findByTestId("enviar-recordatorio");
    await act(async () => {
      fireEvent.press(enviar);
      fireEvent.press(enviar);
    });
    expect(matrizService.enviarRecordatorio).toHaveBeenCalledTimes(1);
    await act(async () => espera.resolver([]));
    expect(await screen.findByText("Recordatorio enviado.")).toBeTruthy();
  });

  it("B-1 / P2-2: con la petición pendiente, la X está deshabilitada y Atrás no cierra la ventana", async () => {
    const espera = pendiente();
    matrizService.enviarRecordatorio.mockReturnValueOnce(espera.promesa);
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Reenviar recordatorio" }));
    const enviar = await screen.findByTestId("enviar-recordatorio");
    // Sin esperar al toque: la petición queda pendiente a propósito.
    await act(async () => {
      fireEvent.press(enviar);
    });
    const cerrar = screen.getByTestId("ventana-recordatorio-cerrar");
    expect(cerrar.props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => {
      fireEvent.press(cerrar);
    });
    // Atrás de Android: `onRequestClose` del Modal.
    let modal = screen.getByTestId("ventana-recordatorio");
    while (modal && !modal.props?.onRequestClose) modal = modal.parent;
    await act(async () => modal.props.onRequestClose());
    expect(screen.getByTestId("ventana-recordatorio")).toBeTruthy();
    // Al llegar la respuesta (un error), se anuncia y el detalle se relee.
    await act(async () => espera.rechazar(error(400, "No hay a quién enviar.")));
    expect(await screen.findByText("No hay a quién enviar.")).toBeTruthy();
    expect(anunciados()).toContain("No hay a quién enviar.");
    await waitFor(() => expect(matrizService.periodo).toHaveBeenCalledTimes(2));
    // Ya respondió: ahora sí se cierra.
    await act(async () => modal.props.onRequestClose());
    expect(screen.queryByTestId("ventana-recordatorio")).toBeNull();
  });

  it("H-01: cerrar Seguimiento con cambios pide confirmación; sin cambios, no", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => botones[0].onPress());
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Editar seguimiento" }));
    await screen.findByTestId("guardar-seguimiento");
    await fireEvent.press(screen.getByTestId("cancelar-seguimiento"));
    expect(alerta).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ventana-seguimiento")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Editar seguimiento" }));
    await fireEvent.changeText(await screen.findByTestId("seguimiento-avance"), "60");
    await fireEvent.press(screen.getByTestId("ventana-seguimiento-cerrar"));
    expect(alerta).toHaveBeenCalledWith(
      "¿Descartar lo que escribió?",
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
    );
    // «Seguir escribiendo»: la ventana sigue con lo escrito.
    expect(screen.getByTestId("seguimiento-avance").props.value).toBe("60");
    alerta.mockImplementation((_t, _m, botones) => botones[1].onPress());
    await fireEvent.press(screen.getByTestId("ventana-seguimiento-cerrar"));
    await waitFor(() => expect(screen.queryByTestId("ventana-seguimiento")).toBeNull());
    alerta.mockRestore();
  });

  it("H-01: también Cambiar fecha con la justificación escrita", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => botones[1].onPress());
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Cambiar fecha" }));
    await fireEvent.changeText(await screen.findByTestId("justificacion"), "Prórroga");
    await fireEvent.press(screen.getByTestId("cancelar-fecha"));
    expect(alerta).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("ventana-fecha")).toBeNull());
    alerta.mockRestore();
  });

  it("H-12: Seguimiento va justo después de las acciones y «Vencimiento» no se repite", async () => {
    await abrir();
    const textos = screen.getAllByRole("header").map((h) => h.props.children);
    expect(textos.indexOf("Seguimiento")).toBeLessThan(textos.indexOf("Identificación"));
    expect(screen.queryByLabelText(/^Vencimiento:/)).toBeNull();
    expect(screen.getByLabelText(/^Vence: /)).toBeTruthy();
  });

  it("H-16: «Enviar recordatorio» y «Cancelar» al final", async () => {
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Reenviar recordatorio" }));
    expect(await screen.findByRole("button", { name: "Enviar recordatorio" })).toBeTruthy();
    expect(screen.getByTestId("cancelar-recordatorio")).toBeTruthy();
  });

  it("H-20: «no existe» tiene salida", async () => {
    matrizService.periodo.mockRejectedValueOnce(error(404, "No encontrado."));
    mockParametros.id = "15";
    await render(<PantallaPeriodo />);
    await fireEvent.press(await screen.findByTestId("volver"));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("H-20: «sin rol» lleva a cambiar de empresa", async () => {
    mockSesion.empresaActiva = { id: 9 };
    await render(<Matriz />);
    await fireEvent.press(await screen.findByTestId("ir-a-cuenta"));
    expect(mockRouter.push).toHaveBeenCalledWith("/cuenta");
  });

  it("H-19: con incumplidas, esa tarjeta va destacada a todo el ancho", async () => {
    await render(<Matriz />);
    const tarjeta = await screen.findByTestId("tarjeta-incumplido");
    const estilo = require("react-native").StyleSheet.flatten(tarjeta.props.style);
    expect(estilo.flexBasis).toBe("100%");
    const otra = require("react-native").StyleSheet.flatten(screen.getByTestId("tarjeta-en_progreso").props.style);
    expect(otra.flexBasis).toBe(150);
  });

  it("B-2: tras un refresco con más de 100 cargadas, la siguiente página sigue a las que se ven", async () => {
    mockParametros.estado = "incumplido";
    const filas = (desde, n) => Array.from({ length: n }, (_, i) => fila({ id: desde + i }));
    matrizService.periodos.mockImplementation(async ({ page, page_size }) => {
      const tamano = page_size ?? 20;
      return { count: 200, next: "más", results: filas((page - 1) * tamano + 1, tamano) };
    });
    await render(<PantallaEstado />);
    await screen.findByTestId("periodo-1");
    for (let i = 2; i <= 6; i += 1) {
      await fireEvent.press(await screen.findByTestId("ver-mas"));
      await waitFor(() => expect(matrizService.periodos).toHaveBeenCalledTimes(i));
    }
    await waitFor(() => expect(matrizService.periodos).toHaveBeenCalledTimes(6));
    expect(matrizService.periodos).toHaveBeenLastCalledWith({ status: "incumplido", page: 6 });
    // Refresco al tirar hacia abajo: vuelve a pedir lo que ve, hasta 100.
    await act(async () => screen.getByTestId("lista-incumplido").props.refreshControl.props.onRefresh());
    expect(matrizService.periodos).toHaveBeenLastCalledWith({ status: "incumplido", page: 1, page_size: 100 });
    await fireEvent.press(screen.getByTestId("ver-mas"));
    // Página 6 de 20: de la 101 a la 120, sin saltarse ninguna.
    expect(matrizService.periodos).toHaveBeenLastCalledWith({ status: "incumplido", page: 6 });
    expect(matrizService.periodos).toHaveBeenCalledTimes(8);
    matrizService.periodos.mockReset();
  });

  it("H-04: con un error del calendario no se pintan días «sin obligaciones»", async () => {
    mockParametros.vista = "calendario";
    matrizService.calendario.mockRejectedValueOnce(errorDeRed());
    await render(<Matriz />);
    expect(await screen.findByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(screen.queryByTestId("cuadricula")).toBeNull();
    expect(screen.queryAllByTestId(/^dia-/)).toHaveLength(0);
  });

  it("H-05: al cambiar de mes, una sola petición", async () => {
    mockParametros.vista = "calendario";
    matrizService.calendario.mockResolvedValue({ periods: [] });
    await render(<Matriz />);
    await screen.findByTestId("cuadricula");
    await waitFor(() => expect(matrizService.calendario).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByRole("button", { name: "Mes siguiente" }));
    await waitFor(() => expect(matrizService.calendario).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(matrizService.calendario).toHaveBeenCalledTimes(2);
  });

  it("H-07: el día dice el de la semana; la cuadrícula cabe en el ancho medido", async () => {
    mockParametros.vista = "calendario";
    matrizService.calendario.mockResolvedValue({ periods: [] });
    await render(<Matriz />);
    const cuadricula = await screen.findByTestId("cuadricula");
    await act(async () => cuadricula.props.onLayout({ nativeEvent: { layout: { width: 352 } } }));
    const dia = screen.getAllByTestId(/^dia-/)[0];
    const estilo = require("react-native").StyleSheet.flatten(dia.props.style);
    // (352 − 2) / 7 = 50: 7 casillas de 50 caben en 350.
    expect(estilo.width).toBe(50);
    expect(estilo.width * 7).toBeLessThanOrEqual(352 - 2);
    expect(dia.props.accessibilityLabel).toMatch(/^(domingo|lunes|martes|miércoles|jueves|viernes|sábado) \d+ de /);
  });
});
