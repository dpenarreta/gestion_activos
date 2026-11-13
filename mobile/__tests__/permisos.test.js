import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { AccessibilityInfo, Alert, Text } from "react-native";

import {
  directorioService,
  licenciasService,
  reemplazoService,
  vacacionesService,
} from "../src/api/servicios";
import {
  MENSAJE_DE_FALLO,
  TEXTO_ELIJA_PERSONA,
  YA_QUEDO_GUARDADO,
} from "../src/permisos/useReemplazoEnAusencia";
import { TEXTO_DEMASIADO_GRANDE } from "../src/permisos/adjunto";
import { TEXTO_HAY_MAS, TEXTO_MINIMO_BUSQUEDA } from "../src/utils/busqueda";
import {
  ResumenPermisosProvider,
  TEXTO_SIN_ROL,
  useResumenPermisos,
} from "../src/permisos/ResumenPermisosContext";
import { TEXTO_TIPO_NO_VISIBLE } from "../src/permisos/documentos";
import {
  DetalleSolicitud,
  TEXTO_AYUDA_COMENTARIO,
  TEXTO_NO_ENCONTRADA,
  TEXTO_RECHAZO_SIN_COMENTARIO,
} from "../src/pantallas/permisos/DetalleSolicitud";
import { MisVacaciones, TEXTO_FINES_DETALLE, TEXTO_SIN_PERIODOS } from "../src/pantallas/permisos/MisVacaciones";
import {
  NuevaSolicitud,
  TEXTO_AVISO_MEDICO,
  TEXTO_BLOQUEA,
  TEXTO_CAMBIO_DE_EMPRESA,
  TEXTO_ELIJA_TIPO,
  TEXTO_PUEDE_HABERSE_ENVIADO,
  TEXTO_REVISANDO,
} from "../src/pantallas/permisos/NuevaSolicitud";
import { Permisos } from "../src/pantallas/permisos/Permisos";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockParametros = {};
const mockNavegacion = { dispatch: jest.fn() };
/** Lo último que la pantalla pidió a `usePreventRemove`: si impide salir y
 * qué hacer cuando se intenta. */
const mockPrevencion = { activa: false, alIntentar: null };
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useNavigation: () => mockNavegacion,
    usePreventRemove: (activa, alIntentar) => {
      mockPrevencion.activa = activa;
      mockPrevencion.alIntentar = alIntentar;
    },
    useLocalSearchParams: () => mockParametros,
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

const mockSesion = {
  usuario: { username: "ana", permissions: [] },
  empresaActiva: { id: 1 },
  versionEmpresa: 0,
};
jest.mock("../src/sesion/SesionContext", () => ({
  useSesion: () => mockSesion,
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});

jest.mock("../src/api/servicios", () => ({
  licenciasService: {
    tipos: jest.fn(),
    evaluar: jest.fn(),
    resumen: jest.fn(),
    solicitudes: jest.fn(),
    solicitud: jest.fn(),
    solicitar: jest.fn(),
    aprobar: jest.fn(),
    rechazar: jest.fn(),
    cancelar: jest.fn(),
    urlAdjunto: (id) => `https://api.prueba/api/v1/licencias/solicitudes/${id}/adjunto/`,
  },
  vacacionesService: { mias: jest.fn() },
  reemplazoService: { obtener: jest.fn(), guardar: jest.fn() },
  directorioService: { buscar: jest.fn() },
}));

jest.mock("../src/api/api", () => ({
  api: {
    conRenovacion: jest.fn(async (hacer) => hacer({ Authorization: "Bearer access" })),
  },
}));

function pendiente() {
  let resolver;
  let rechazar;
  const promesa = new Promise((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

function error400(details, message = "Error en la solicitud.") {
  const error = new Error(message);
  error.response = { status: 400, data: { error: { code: "invalid", message, details } } };
  return error;
}

/** Con la forma real de `FlujoParaSolicitarSerializer`. */
const VACACIONES = {
  id: 1,
  nombre: "Vacaciones",
  descripcion: "",
  adjunto: "no",
  pide_motivo: false,
  descuenta_vacaciones: true,
  descuento: "vacaciones",
  unidad: "dias",
  tipo_ausencia: "VACACIONES",
  es_medico: false,
  pasos: [{ nombre: "Jefe inmediato", aprobadores: ["Su jefe inmediato (organigrama)"] }],
};
const MEDICO = {
  ...VACACIONES,
  id: 2,
  nombre: "Permiso médico",
  adjunto: "obligatorio",
  pide_motivo: true,
  descuenta_vacaciones: false,
  descuento: "ninguno",
  tipo_ausencia: "MEDICO",
  es_medico: true,
};
const POR_HORAS = {
  ...VACACIONES,
  id: 3,
  nombre: "Cita personal",
  descuenta_vacaciones: false,
  descuento: "ninguno",
  unidad: "horas",
  tipo_ausencia: "PERSONAL",
};

/** Con la forma real de `DetalleSolicitudSerializer`. */
function detalle(campos = {}) {
  return {
    id: 12,
    flujo: "Vacaciones",
    solicitante: { id: 5, nombre: "Luis Mora" },
    desde: "2026-11-16",
    hasta: "2026-11-20",
    dias: 5,
    unidad: "dias",
    descuento: "vacaciones",
    tipo_ausencia: "VACACIONES",
    hora_desde: null,
    hora_hasta: null,
    minutos: null,
    motivo: "",
    estado: "pendiente",
    estado_display: "Pendiente",
    paso_actual: "Jefe inmediato",
    pendiente_de: [{ id: 9, nombre: "Ana Pérez", ausencia: null }],
    tiene_adjunto: false,
    adjunto_nombre: "",
    created_at: "2026-11-12T09:05:00-05:00",
    cerrada_en: null,
    acciones: [
      { id: 1, accion: "creada", accion_display: "Creada", actor: "Luis Mora", paso: "", comentario: "", detalle: "", created_at: "2026-11-12T09:05:00-05:00" },
    ],
    puedo: { resolver: true, escalar: true, cancelar: false, cancelar_pide_comentario: false },
    cargo: "Analista",
    area: "Cartera",
    evaluacion: { reglas: [{ clave: "saldo", estado: "ok", texto: "Se descuenta de sus vacaciones pendientes.", detalle: "Tiene 10 días pendientes." }], bloquea: false },
    feriados: [],
    dias_a_devolver: 0,
    ausencias_a_borrar: 0,
    ...campos,
  };
}

/** `Alert.alert` que elige el botón `texto`. */
function responderAlerta(texto) {
  return jest.spyOn(Alert, "alert").mockImplementation((_titulo, _mensaje, botones) => {
    botones.find((b) => b.text === texto)?.onPress?.();
  });
}

function conResumen(nodo) {
  return <ResumenPermisosProvider>{nodo}</ResumenPermisosProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockSesion.versionEmpresa = 0;
  mockSesion.usuario = { username: "ana", permissions: [] };
  Object.keys(mockParametros).forEach((k) => delete mockParametros[k]);
  licenciasService.resumen.mockResolvedValue({ por_aprobar: 0, puede_solicitar: true });
  licenciasService.tipos.mockResolvedValue([VACACIONES, MEDICO, POR_HORAS]);
  licenciasService.evaluar.mockResolvedValue({ reglas: [], bloquea: false });
  licenciasService.solicitudes.mockResolvedValue([]);
  reemplazoService.obtener.mockResolvedValue({ modo: "jefe", persona: null, jefe: { id: 9, nombre: "Ana Pérez" } });
  reemplazoService.guardar.mockReset();
  directorioService.buscar.mockResolvedValue([
    { id: 8, nombre: "Carla Ruiz", correo: "carla@grupolaar.com", area: "Cartera", cargo: "Analista" },
  ]);
  licenciasService.solicitar.mockReset();
});

/** Abre la nueva solicitud y elige el tipo `id` (no viene elegido). */
async function nuevaConTipo(id = 1) {
  await render(conResumen(<NuevaSolicitud />));
  await fireEvent.press(await screen.findByTestId(`tipo-${id}`));
  await waitFor(() => expect(screen.getByTestId("enviar-solicitud").props.accessibilityState.disabled).toBe(false));
}

describe("nueva solicitud (CA-4 a CA-7)", () => {
  it("muestra las reglas del servidor con su estado dicho y, si bloquea, no deja enviar", async () => {
    licenciasService.evaluar.mockResolvedValue({
      reglas: [
        { clave: "minimo", estado: "falla", texto: "Mínimo 5 días seguidos por solicitud.", detalle: "Ha elegido 1 día." },
        { clave: "fines-1", estado: "aviso", texto: "De cada período anual deben salir al menos 2 sábados.", detalle: "Se marcarán por defecto: sábado 21/11/2026." },
        { clave: "nota-0", estado: "info", texto: "Pídalas con una semana de anticipación.", detalle: "" },
      ],
      bloquea: true,
    });
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await render(conResumen(<NuevaSolicitud />));
    await fireEvent.press(await screen.findByTestId("tipo-1"));

    expect(await screen.findByText("Mínimo 5 días seguidos por solicitud.")).toBeTruthy();
    expect(anuncio).toHaveBeenCalledWith("Restricciones revisadas: una no se cumple.");
    expect(licenciasService.evaluar).toHaveBeenCalledWith("1", expect.any(String), expect.any(String));
    expect(screen.getByLabelText("No cumple: Mínimo 5 días seguidos por solicitud. Ha elegido 1 día.")).toBeTruthy();
    expect(screen.getByLabelText(/^Atención: De cada período anual/)).toBeTruthy();
    expect(screen.getByLabelText(/^Para tener en cuenta: Pídalas/)).toBeTruthy();
    expect(screen.getByText(TEXTO_BLOQUEA)).toBeTruthy();
    expect(screen.getByTestId("enviar-solicitud").props.accessibilityState.disabled).toBe(true);
  });

  it("un tipo médico avisa que no se escriban diagnósticos y pide motivo y documento", async () => {
    await render(conResumen(<NuevaSolicitud />));
    await fireEvent.press(await screen.findByTestId("tipo-2"));

    expect(screen.getByText("No escriba diagnósticos.")).toBeTruthy();
    expect(screen.getByLabelText(/^Motivo \(obligatorio\)/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("enviar-solicitud").props.accessibilityState.disabled).toBe(false));

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    expect(screen.getByText("Un permiso médico pide el motivo. No escriba diagnósticos.", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText("Adjunte el certificado médico.")).toBeTruthy();
    expect(licenciasService.solicitar).not.toHaveBeenCalled();
  });

  it("un documento de más de 10 MB se avisa antes de enviar", async () => {
    DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///cache/DocumentPicker/c.pdf", name: "c.pdf", mimeType: "application/pdf", size: 12 * 1024 * 1024 }],
    });
    await render(conResumen(<NuevaSolicitud />));
    await fireEvent.press(await screen.findByTestId("tipo-2"));

    // Un solo botón abre las tres formas de adjuntar (H-14).
    await fireEvent.press(screen.getByTestId("adjuntar"));
    await fireEvent.press(screen.getByTestId("adjunto-pdf"));

    expect(await screen.findByText(TEXTO_DEMASIADO_GRANDE)).toBeTruthy();
    expect(screen.queryByTestId("quitar-adjunto")).toBeNull();
  });

  it("por horas pide un solo día y las dos horas", async () => {
    await render(conResumen(<NuevaSolicitud />));
    await fireEvent.press(await screen.findByTestId("tipo-3"));

    expect(screen.getByLabelText(/^Fecha \(obligatorio\)/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Desde \(obligatorio\)/)).toBeNull();
    await waitFor(() => expect(screen.getByTestId("enviar-solicitud").props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    expect(screen.getByText("Indique la hora de inicio.", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText("Indique la hora de fin.", { includeHiddenElements: true })).toBeTruthy();
    expect(licenciasService.solicitar).not.toHaveBeenCalled();
  });

  it("los errores del servidor van junto a su campo y arriba se dice cuál falla", async () => {
    licenciasService.solicitar.mockRejectedValueOnce(error400({ hasta: ["La fecha de fin no puede ser anterior a la de inicio."] }));
    await nuevaConTipo(1);

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    expect(await screen.findByText("Revise los campos marcados: Hasta.")).toBeTruthy();
    expect(screen.getByText("La fecha de fin no puede ser anterior a la de inicio.", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByLabelText(/^Hasta \(obligatorio\).*Error: La fecha de fin/)).toBeTruthy();
  });

  it("se envía una sola vez aunque se toque dos veces, y va al detalle", async () => {
    const envio = pendiente();
    licenciasService.solicitar.mockReturnValue(envio.promesa);
    await nuevaConTipo(1);

    // El segundo toque llega con el primero en vuelo.
    const boton = screen.getByTestId("enviar-solicitud");
    await fireEvent.press(boton);
    await fireEvent.press(boton);
    expect(screen.getByTestId("enviar-solicitud").props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => envio.resolver(detalle({ id: 33 })));

    expect(licenciasService.solicitar).toHaveBeenCalledTimes(1);
    const [campos, adjunto] = licenciasService.solicitar.mock.calls[0];
    expect(campos).toMatchObject({ flujo: "1", motivo: "" });
    expect(campos.hora_desde).toBeUndefined();
    expect(adjunto).toBeNull();
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: "/permisos/solicitud/[id]",
      params: { id: "33", creada: "1" },
    });
  });

  it("sin rol asignado no pide los tipos y el botón queda desactivado con la explicación (CA-5)", async () => {
    licenciasService.resumen.mockResolvedValue({ por_aprobar: 0, puede_solicitar: false });
    await render(conResumen(<NuevaSolicitud />));

    expect(await screen.findByText(TEXTO_SIN_ROL)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enviar solicitud" }).props.accessibilityState.disabled).toBe(true);
  });

  it("no preselecciona el tipo: al enviar sin elegirlo, lo pide", async () => {
    await render(conResumen(<NuevaSolicitud />));
    await screen.findByTestId("tipo-1");
    expect(screen.getByRole("radio", { name: "Vacaciones" }).props.accessibilityState.checked).toBe(false);

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    expect(screen.getByText("Revise los campos marcados: Tipo de permiso.")).toBeTruthy();
    expect(screen.getByText(TEXTO_ELIJA_TIPO, { includeHiddenElements: true })).toBeTruthy();
    expect(licenciasService.evaluar).not.toHaveBeenCalled();
  });

  it("desde Mis vacaciones viene elegido el tipo de vacaciones", async () => {
    await render(conResumen(<NuevaSolicitud deVacaciones />));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Vacaciones" }).props.accessibilityState.checked).toBe(true),
    );
  });

  it("un documento obligatorio de un tipo no médico se pide antes de enviar (O-5)", async () => {
    licenciasService.tipos.mockResolvedValue([{ ...POR_HORAS, id: 4, nombre: "Calamidad", unidad: "dias", adjunto: "obligatorio" }]);
    await render(conResumen(<NuevaSolicitud />));
    // Con un solo tipo, viene elegido.
    await waitFor(() => expect(screen.getByTestId("enviar-solicitud").props.accessibilityState.disabled).toBe(false));
    expect(screen.getByText(/^Documento de respaldo/)).toBeTruthy();
    expect(screen.queryByText(TEXTO_AVISO_MEDICO)).toBeNull();

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    expect(screen.getByText("Este permiso pide un documento de respaldo.")).toBeTruthy();
    expect(screen.getByText("Revise los campos marcados: Documento de respaldo.")).toBeTruthy();
    expect(licenciasService.solicitar).not.toHaveBeenCalled();
  });

  it("si el envío falla por la red, avisa que puede que ya se haya enviado (O-1)", async () => {
    const red = new Error("red");
    red.esDeRed = true;
    red.porTiempo = true;
    licenciasService.solicitar.mockRejectedValueOnce(red);
    await nuevaConTipo(1);

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    expect(await screen.findByText(new RegExp(TEXTO_PUEDE_HABERSE_ENVIADO))).toBeTruthy();
  });

  it("mientras se reevalúan las restricciones no deja enviar y atenúa las anteriores", async () => {
    licenciasService.evaluar.mockResolvedValueOnce({
      reglas: [{ clave: "saldo", estado: "ok", texto: "Se descuenta de sus vacaciones pendientes.", detalle: "" }],
      bloquea: false,
    });
    await nuevaConTipo(1);
    await screen.findByText("Se descuenta de sus vacaciones pendientes.");

    const segunda = pendiente();
    licenciasService.evaluar.mockReturnValueOnce(segunda.promesa);
    await fireEvent.press(screen.getByTestId("cambiar-tipo"));
    await fireEvent.press(screen.getByTestId("tipo-2"));

    const boton = screen.getByTestId("enviar-solicitud");
    expect(boton.props.accessibilityState.disabled).toBe(true);
    expect(boton.props.accessibilityHint).toBe(TEXTO_REVISANDO);
    expect(screen.getByText("Restricciones de este permiso (revisando…)")).toBeTruthy();
    // Sin opacidad: un borde a la izquierda las marca (M-3).
    const { StyleSheet } = require("react-native");
    const estilo = StyleSheet.flatten(screen.getByTestId("reglas-del-permiso").props.style);
    expect(estilo.opacity).toBeUndefined();
    expect(estilo.borderLeftWidth).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^Anterior\. Cumple/)).toBeTruthy();

    await waitFor(() => expect(licenciasService.evaluar).toHaveBeenCalledTimes(2));
    await act(async () => segunda.resolver({ reglas: [], bloquea: false }));
    await waitFor(() => expect(screen.getByTestId("enviar-solicitud").props.accessibilityState.disabled).toBe(false));
  });

  it("un 400 de la evaluación muestra el mensaje del servidor", async () => {
    licenciasService.evaluar.mockRejectedValueOnce(error400(null, "Introduzca una fecha válida."));
    await render(conResumen(<NuevaSolicitud />));
    await fireEvent.press(await screen.findByTestId("tipo-1"));
    expect(await screen.findByText("Introduzca una fecha válida.")).toBeTruthy();
  });

  it("el conteo local dice que son días de calendario", async () => {
    await nuevaConTipo(1);
    expect(screen.getByText(/^1 día de calendario\. Cuántos cuentan/)).toBeTruthy();
  });

  it("pide confirmación antes de descartar una solicitud a medio llenar", async () => {
    const alerta = responderAlerta("Descartar");
    await nuevaConTipo(1);
    expect(mockPrevencion.activa).toBe(true);

    await act(async () => mockPrevencion.alIntentar({ data: { action: { type: "GO_BACK" } } }));

    expect(alerta).toHaveBeenCalledWith("¿Descartar la solicitud?", expect.any(String), expect.any(Array));
    // Al descartar deja de impedir la salida y repite la navegación.
    expect(mockPrevencion.activa).toBe(false);
    expect(mockNavegacion.dispatch).toHaveBeenCalledWith({ type: "GO_BACK" });
  });

  it("sin haber llenado nada sale sin preguntar", async () => {
    await render(conResumen(<NuevaSolicitud />));
    await screen.findByTestId("tipo-1");
    expect(mockPrevencion.activa).toBe(false);
  });

  it("tras enviar sale al detalle sin preguntar y sin anunciar dos veces", async () => {
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    licenciasService.solicitar.mockResolvedValue(detalle({ id: 36 }));
    await nuevaConTipo(1);
    expect(mockPrevencion.activa).toBe(true);

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(mockPrevencion.activa).toBe(false);
    expect(anuncio).not.toHaveBeenCalledWith(expect.stringMatching(/^Solicitud enviada/));
  });

  it("el error del tipo va en la etiqueta de cada opción", async () => {
    await render(conResumen(<NuevaSolicitud />));
    await screen.findByTestId("tipo-1");
    await fireEvent.press(screen.getByTestId("enviar-solicitud"));
    expect(screen.getByRole("radio", { name: `Vacaciones. Error: ${TEXTO_ELIJA_TIPO}` })).toBeTruthy();
  });

  it("al elegir el tipo se ve solo el elegido, con «Cambiar el tipo de permiso» (H-03)", async () => {
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await render(conResumen(<NuevaSolicitud />));
    await fireEvent.press(await screen.findByTestId("tipo-1"));

    expect(anuncio).toHaveBeenCalledWith("Tipo elegido: Vacaciones.");
    expect(screen.getByTestId("tipo-1")).toBeTruthy();
    expect(screen.queryByTestId("tipo-2")).toBeNull();
    expect(screen.queryByTestId("tipo-3")).toBeNull();

    await fireEvent.press(screen.getByTestId("cambiar-tipo"));
    expect(screen.getByTestId("tipo-2")).toBeTruthy();
    expect(screen.queryByTestId("cambiar-tipo")).toBeNull();
    await fireEvent.press(screen.getByTestId("tipo-3"));
    expect(anuncio).toHaveBeenCalledWith("Tipo elegido: Cita personal.");
    expect(screen.queryByTestId("tipo-1")).toBeNull();
  });

  it("con un solo tipo no ofrece cambiarlo", async () => {
    licenciasService.tipos.mockResolvedValue([VACACIONES]);
    await render(conResumen(<NuevaSolicitud />));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Vacaciones" }).props.accessibilityState.checked).toBe(true));
    expect(screen.queryByTestId("cambiar-tipo")).toBeNull();
  });

  it("un solo botón «Adjuntar el certificado» abre cámara, galería y PDF (H-14)", async () => {
    await render(conResumen(<NuevaSolicitud />));
    await fireEvent.press(await screen.findByTestId("tipo-2"));
    const adjuntar = screen.getByRole("button", { name: "Adjuntar el certificado" });
    expect(adjuntar.props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByTestId("adjunto-camara")).toBeNull();

    await fireEvent.press(adjuntar);
    expect(screen.getByTestId("adjuntar").props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByTestId("adjunto-camara")).toBeTruthy();
    expect(screen.getByTestId("adjunto-galeria")).toBeTruthy();
    expect(screen.getByTestId("adjunto-pdf")).toBeTruthy();
  });

  /** El último desplazamiento: ¿fue hacia la posición medida `y`? */
  function desplazoHacia(desplazar, y) {
    const destino = desplazar.mock.calls.at(-1)?.[0]?.y;
    expect(destino).toBeGreaterThan(y - 50);
    expect(destino).toBeLessThanOrEqual(y);
  }

  function medirBloque(elemento, y) {
    return fireEvent(elemento, "layout", { nativeEvent: { layout: { x: 0, y, width: 360, height: 120 } } });
  }

  it("con un error lleva la pantalla al campo que falla, no siempre arriba (H-15, N-06)", async () => {
    const { ScrollView } = require("react-native");
    const desplazar = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    await render(conResumen(<NuevaSolicitud />));
    await fireEvent.press(await screen.findByTestId("tipo-2"));
    await medirBloque(screen.getByTestId("adjunto"), 640);
    await fireEvent.changeText(screen.getByTestId("motivo"), "Cita de control");
    await waitFor(() => expect(screen.getByTestId("enviar-solicitud").props.accessibilityState.disabled).toBe(false));

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    expect(screen.getByText("Revise los campos marcados: Documento de respaldo.")).toBeTruthy();
    // Después del layout (efecto + requestAnimationFrame).
    await waitFor(() => expect(desplazar).toHaveBeenCalled());
    desplazoHacia(desplazar, 640);
  });

  it("con «Otra persona» sin elegir, lleva al bloque del reemplazo (B7)", async () => {
    const { ScrollView } = require("react-native");
    const desplazar = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    await nuevaConTipo(1);
    await screen.findByText("Su jefe inmediato (Ana Pérez)");
    await medirBloque(screen.getByTestId("reemplazo-en-ausencia").parent, 820);
    await fireEvent.press(screen.getByTestId("reemplazo-persona"));
    await fireEvent.press(screen.getByTestId("enviar-solicitud"));
    await waitFor(() => expect(desplazar).toHaveBeenCalled());
    desplazoHacia(desplazar, 820);
  });

  it("un error del servidor en un campo a la vista lleva a ese campo; uno general, arriba (B7)", async () => {
    const { ScrollView } = require("react-native");
    const desplazar = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    licenciasService.solicitar
      .mockRejectedValueOnce(error400({ hasta: ["La fecha de fin no puede ser anterior a la de inicio."] }))
      .mockRejectedValueOnce(error400(null, "Las fechas se cruzan con otra solicitud suya."));
    await nuevaConTipo(1);
    await medirBloque(screen.getByTestId("bloque-fechas"), 300);

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));
    await screen.findByText("Revise los campos marcados: Hasta.");
    await waitFor(() => desplazoHacia(desplazar, 300));

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));
    await screen.findByText("Las fechas se cruzan con otra solicitud suya.");
    await waitFor(() => expect(desplazar.mock.calls.at(-1)[0].y).toBe(0));
  });

  it("al abrir las formas de adjuntar las lleva a la vista, sin mover el foco (N-07)", async () => {
    const { AccessibilityInfo, ScrollView } = require("react-native");
    const desplazar = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    const foco = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
    await render(conResumen(<NuevaSolicitud />));
    await fireEvent.press(await screen.findByTestId("tipo-2"));
    await medirBloque(screen.getByTestId("adjunto"), 700);
    await fireEvent.press(screen.getByTestId("adjuntar"));
    await waitFor(() => expect(desplazar).toHaveBeenCalled());
    desplazoHacia(desplazar, 700);
    // Pasada la espera de iOS (900 ms), el foco sigue en «Adjuntar».
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });
    expect(foco).not.toHaveBeenCalled();
  });

  describe("R-03: el foco del lector va al control del campo con error", () => {
    async function focoEn() {
      const { AccessibilityInfo } = require("react-native");
      const foco = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
      return async () => {
        await waitFor(() => expect(foco).toHaveBeenCalled(), { timeout: 3000 });
        const [nodo, evento] = foco.mock.calls.at(-1);
        expect(evento).toBe("focus");
        return nodo.props.testID;
      };
    }

    it("sin tipo elegido, al primer tipo", async () => {
      const destino = await focoEn();
      await render(conResumen(<NuevaSolicitud />));
      await screen.findByTestId("tipo-1");
      await fireEvent.press(screen.getByTestId("enviar-solicitud"));
      expect(await destino()).toBe("tipo-1");
    });

    it("sin motivo en un permiso médico, al campo del motivo", async () => {
      const destino = await focoEn();
      await render(conResumen(<NuevaSolicitud />));
      await fireEvent.press(await screen.findByTestId("tipo-2"));
      await waitFor(() => expect(screen.getByTestId("enviar-solicitud").props.accessibilityState.disabled).toBe(false));
      await fireEvent.press(screen.getByTestId("enviar-solicitud"));
      expect(await destino()).toBe("motivo");
    });

    it("sin el documento obligatorio, a «Adjuntar»", async () => {
      const destino = await focoEn();
      await render(conResumen(<NuevaSolicitud />));
      await fireEvent.press(await screen.findByTestId("tipo-2"));
      await fireEvent.changeText(screen.getByTestId("motivo"), "Control");
      await waitFor(() => expect(screen.getByTestId("enviar-solicitud").props.accessibilityState.disabled).toBe(false));
      await fireEvent.press(screen.getByTestId("enviar-solicitud"));
      expect(await destino()).toBe("adjuntar");
    });

    it("con un error del servidor en «Hasta», a ese selector y no a «Desde»", async () => {
      const destino = await focoEn();
      licenciasService.solicitar.mockRejectedValueOnce(error400({ hasta: ["La fecha de fin no puede ser anterior a la de inicio."] }));
      await nuevaConTipo(1);
      await fireEvent.press(screen.getByTestId("enviar-solicitud"));
      expect(await destino()).toBe("fecha-hasta");
    });

    it("con «Otra persona» sin elegir, al buscador", async () => {
      const destino = await focoEn();
      await nuevaConTipo(1);
      await screen.findByText("Su jefe inmediato (Ana Pérez)");
      await fireEvent.press(screen.getByTestId("reemplazo-persona"));
      await fireEvent.press(screen.getByTestId("enviar-solicitud"));
      expect(await destino()).toBe("reemplazo-buscar");
    });
  });

  it("tocar el mismo tipo tras «Cambiar» conserva el certificado (N-02, B3)", async () => {
    DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///cache/DocumentPicker/c.pdf", name: "c.pdf", mimeType: "application/pdf", size: 1000 }],
    });
    await render(conResumen(<NuevaSolicitud />));
    await fireEvent.press(await screen.findByTestId("tipo-2"));
    await fireEvent.changeText(screen.getByTestId("motivo"), "Control");
    await fireEvent.press(screen.getByTestId("adjuntar"));
    await fireEvent.press(screen.getByTestId("adjunto-pdf"));
    expect(await screen.findByTestId("quitar-adjunto")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("cambiar-tipo"));
    await fireEvent.press(screen.getByTestId("tipo-2"));

    expect(screen.getByTestId("quitar-adjunto")).toBeTruthy();
    expect(screen.getByText(/^c\.pdf/)).toBeTruthy();
    expect(screen.getByTestId("motivo").props.value).toBe("Control");
    expect(screen.queryByTestId("tipo-1")).toBeNull();
  });

  it("no repite «Cancelar»: se sale con «Volver» y sigue pidiendo confirmación (H-16)", async () => {
    await nuevaConTipo(1);
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
    expect(mockPrevencion.activa).toBe(true);
  });

  it("si cambia la empresa, vuelve atrás con un aviso (O-4)", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { rerender } = await render(conResumen(<NuevaSolicitud />));
    await screen.findByTestId("tipo-1");

    mockSesion.versionEmpresa = 1;
    await rerender(conResumen(<NuevaSolicitud />));

    expect(alerta).toHaveBeenCalledWith("Cambió la empresa", TEXTO_CAMBIO_DE_EMPRESA, expect.any(Array));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe("nueva solicitud: quién aprueba por usted mientras no está (US-001)", () => {
  async function listoParaEnviar() {
    await nuevaConTipo(1);
    await screen.findByText("Su jefe inmediato (Ana Pérez)");
  }

  async function elegirACarla() {
    await fireEvent.press(screen.getByTestId("reemplazo-persona"));
    await fireEvent.changeText(screen.getByTestId("reemplazo-buscar"), "carla");
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const carla = await screen.findByRole("button", { name: "Carla Ruiz. Analista. Cartera" });
    await waitFor(() => expect(anuncio).toHaveBeenCalledWith("Una persona encontrada."));
    await fireEvent.press(carla);
    expect(screen.getByText("Carla Ruiz")).toBeTruthy();
    expect(anuncio).toHaveBeenCalledWith("Eligió a Carla Ruiz para aprobar por usted.");
  }

  it("en un permiso por días se pregunta, con el jefe inmediato por defecto", async () => {
    await listoParaEnviar();
    expect(screen.getByText("Mientras usted no está")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Su jefe inmediato (Ana Pérez)" }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole("header", { name: "¿Quién aprueba por usted?" })).toBeTruthy();
  });

  it("no se pide en un tipo por horas", async () => {
    licenciasService.tipos.mockResolvedValue([POR_HORAS]);
    await render(conResumen(<NuevaSolicitud />));
    await screen.findByLabelText(/^Desde las/);

    expect(screen.queryByTestId("reemplazo-en-ausencia")).toBeNull();
    expect(reemplazoService.obtener).not.toHaveBeenCalled();
  });

  it("con «Otra persona» es obligatorio elegirla", async () => {
    await listoParaEnviar();
    await fireEvent.press(screen.getByTestId("reemplazo-persona"));

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    expect(screen.getByLabelText(new RegExp(`Error: ${TEXTO_ELIJA_PERSONA}`))).toBeTruthy();
    expect(screen.getByText("Revise los campos marcados: Quién aprueba por usted.")).toBeTruthy();
    expect(reemplazoService.guardar).not.toHaveBeenCalled();
    expect(licenciasService.solicitar).not.toHaveBeenCalled();
  });

  it("busca en el directorio y guarda el reemplazo antes de crear la solicitud", async () => {
    reemplazoService.guardar.mockResolvedValue({ modo: "persona", persona: { id: 8, nombre: "Carla Ruiz" }, jefe: null });
    licenciasService.solicitar.mockResolvedValue(detalle({ id: 34 }));
    await listoParaEnviar();
    await elegirACarla();

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    await waitFor(() => expect(licenciasService.solicitar).toHaveBeenCalledTimes(1));
    expect(directorioService.buscar).toHaveBeenLastCalledWith("carla");
    expect(reemplazoService.guardar).toHaveBeenCalledWith({ modo: "persona", persona_id: 8 });
    expect(reemplazoService.guardar.mock.invocationCallOrder[0]).toBeLessThan(
      licenciasService.solicitar.mock.invocationCallOrder[0],
    );
  });

  it("sin cambios no vuelve a guardar el reemplazo", async () => {
    licenciasService.solicitar.mockResolvedValue(detalle({ id: 35 }));
    await listoParaEnviar();
    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    await waitFor(() => expect(licenciasService.solicitar).toHaveBeenCalledTimes(1));
    expect(reemplazoService.guardar).not.toHaveBeenCalled();
  });

  it("si no se puede guardar el reemplazo, la solicitud no sale y el error va en su campo", async () => {
    reemplazoService.guardar.mockRejectedValue(
      error400({ persona_id: ["Esa persona no es una cuenta activa de la empresa."] }),
    );
    await listoParaEnviar();
    await elegirACarla();

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    expect(await screen.findByText(MENSAJE_DE_FALLO)).toBeTruthy();
    expect(screen.getByText("Esa persona no es una cuenta activa de la empresa.")).toBeTruthy();
    expect(licenciasService.solicitar).not.toHaveBeenCalled();
    expect(screen.getByTestId("enviar-solicitud").props.accessibilityState.disabled).toBe(false);
  });

  it("no busca con menos de 2 letras y muestra como mucho 8 (H-05)", async () => {
    const muchas = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, nombre: `Carla ${i + 1}`, cargo: "", area: "" }));
    directorioService.buscar.mockResolvedValue(muchas);
    await listoParaEnviar();
    await fireEvent.press(screen.getByTestId("reemplazo-persona"));
    // Sin escribir no se busca ni se muestra un indicador sin fin.
    expect(screen.getByText(TEXTO_MINIMO_BUSQUEDA)).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId("reemplazo-buscar"), "c");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(directorioService.buscar).not.toHaveBeenCalled();
    expect(screen.getByText(TEXTO_MINIMO_BUSQUEDA)).toBeTruthy();

    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await fireEvent.changeText(screen.getByTestId("reemplazo-buscar"), "ca");
    expect(await screen.findByTestId("reemplazo-persona-107")).toBeTruthy();
    expect(directorioService.buscar).toHaveBeenLastCalledWith("ca");
    expect(screen.queryByTestId("reemplazo-persona-108")).toBeNull();
    expect(screen.getByText(TEXTO_HAY_MAS)).toBeTruthy();
    expect(anuncio).toHaveBeenCalledWith(`10 personas encontradas; se muestran 8. ${TEXTO_HAY_MAS}`);
  });

  it("si falla la solicitud después de guardar el reemplazo, lo dice", async () => {
    reemplazoService.guardar.mockResolvedValue({ modo: "persona", persona: { id: 8, nombre: "Carla Ruiz" }, jefe: null });
    licenciasService.solicitar.mockRejectedValue(error400(null, "Las fechas se cruzan con otra solicitud suya."));
    await listoParaEnviar();
    await elegirACarla();

    await fireEvent.press(screen.getByTestId("enviar-solicitud"));

    expect(
      await screen.findByText(`Las fechas se cruzan con otra solicitud suya. ${YA_QUEDO_GUARDADO}`),
    ).toBeTruthy();
  });
});

describe("detalle de una solicitud (CA-8 a CA-11)", () => {
  it("muestra los datos, las reglas para decidir y el historial", async () => {
    licenciasService.solicitud.mockResolvedValue(detalle());
    await render(conResumen(<DetalleSolicitud id="12" />));

    expect(await screen.findByText("Le toca decidir a usted (paso «Jefe inmediato»).")).toBeTruthy();
    expect(screen.getByLabelText("Solicitante: Luis Mora. Analista · Cartera")).toBeTruthy();
    expect(screen.getByLabelText("Fechas: 16/11/2026 al 20/11/2026")).toBeTruthy();
    expect(screen.getByText("Pendiente")).toBeTruthy();
    expect(screen.getByText("Luis Mora hizo la solicitud")).toBeTruthy();
    expect(screen.getByText("Para decidir: saldo y restricciones")).toBeTruthy();
    // Escalar se queda en la web.
    expect(screen.getByTestId("solicitud-en-la-web")).toBeTruthy();
  });

  it("la decisión va antes del historial, con [Rechazar | Aprobar] (H-04) y «Días» con unidad (H-18)", async () => {
    licenciasService.solicitud.mockResolvedValue(detalle({ motivo: "Viaje familiar" }));
    await render(conResumen(<DetalleSolicitud id="12" />));
    await screen.findByTestId("acciones");

    expect(screen.getByLabelText("Días: 5 días")).toBeTruthy();
    // En el orden en que se leen: motivo → decisión → historial.
    const secciones = screen.getAllByTestId(/^(acciones|historial)$/);
    expect(secciones.map((e) => e.props.testID)).toEqual(["acciones", "historial"]);
    const motivo = screen.getAllByRole("header", { name: /^(Motivo|Historial)$/ });
    expect(motivo[0]).toHaveTextContent("Motivo");
    expect(motivo[1]).toHaveTextContent("Historial");
    // Dentro de la decisión: el comentario y luego [Rechazar | Aprobar].
    const decision = within(screen.getByTestId("acciones"));
    expect(decision.getByTestId("comentario")).toBeTruthy();
    const botones = decision.getAllByRole("button", { name: /^(Rechazar|Aprobar)$/ });
    expect(botones[0]).toHaveProp("accessibilityLabel", "Rechazar");
    expect(botones[1]).toHaveProp("accessibilityLabel", "Aprobar");
  });

  it("con la letra al 200 % los botones de decisión piden el doble de ancho (N-01)", async () => {
    const { Dimensions, StyleSheet } = require("react-native");
    const ventana = Dimensions.get("window");
    licenciasService.solicitud.mockResolvedValue(detalle());
    try {
      await act(async () => Dimensions.set({ window: { ...ventana, fontScale: 2 }, screen: { ...Dimensions.get("screen"), fontScale: 2 } }));
      await render(conResumen(<DetalleSolicitud id="12" />));
      await screen.findByTestId("acciones");
      expect(StyleSheet.flatten(screen.getByTestId("decision-aprobar").props.style).flexBasis).toBe(280);
      await act(async () => Dimensions.set({ window: { ...ventana, fontScale: 1 }, screen: { ...Dimensions.get("screen"), fontScale: 1 } }));
      expect(StyleSheet.flatten(screen.getByTestId("decision-aprobar").props.style).flexBasis).toBe(140);
    } finally {
      await act(async () => Dimensions.set({ window: ventana, screen: Dimensions.get("screen") }));
    }
  });

  it("aprueba con confirmación y comentario opcional, y actualiza la insignia", async () => {
    licenciasService.solicitud.mockResolvedValue(detalle());
    licenciasService.aprobar.mockResolvedValue(
      detalle({ estado: "aprobada", estado_display: "Aprobada", puedo: { resolver: false, escalar: false, cancelar: false } }),
    );
    const alerta = responderAlerta("Aprobar");
    await render(conResumen(<DetalleSolicitud id="12" />));
    await fireEvent.changeText(await screen.findByTestId("comentario"), "Buen viaje");

    await fireEvent.press(screen.getByTestId("aprobar"));

    expect(alerta).toHaveBeenCalledWith("¿Aprobar la solicitud?", expect.stringContaining("«Buen viaje»"), expect.any(Array), expect.any(Object));
    await waitFor(() => expect(licenciasService.aprobar).toHaveBeenCalledWith("12", "Buen viaje", { empresa: null }));
    expect(await screen.findByText("Aprobada.")).toBeTruthy();
    expect(screen.getByText("Aprobada", { exact: true })).toBeTruthy();
    expect(licenciasService.resumen.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("no deja rechazar sin comentario", async () => {
    licenciasService.solicitud.mockResolvedValue(detalle());
    const alerta = jest.spyOn(Alert, "alert");
    await render(conResumen(<DetalleSolicitud id="12" />));

    await fireEvent.press(await screen.findByTestId("rechazar"));

    expect(screen.getByText(TEXTO_RECHAZO_SIN_COMENTARIO, { includeHiddenElements: true })).toBeTruthy();
    expect(alerta).not.toHaveBeenCalled();
    expect(licenciasService.rechazar).not.toHaveBeenCalled();
  });

  it("rechaza con comentario y confirmación", async () => {
    licenciasService.solicitud.mockResolvedValue(detalle());
    licenciasService.rechazar.mockResolvedValue(detalle({ estado: "rechazada", puedo: {} }));
    responderAlerta("Rechazar");
    await render(conResumen(<DetalleSolicitud id="12" />));
    await fireEvent.changeText(await screen.findByTestId("comentario"), "No hay cobertura esa semana");

    await fireEvent.press(screen.getByTestId("rechazar"));

    await waitFor(() =>
      expect(licenciasService.rechazar).toHaveBeenCalledWith("12", "No hay cobertura esa semana", { empresa: null }),
    );
    expect(await screen.findByText("Rechazada. Se avisó a quien la hizo.")).toBeTruthy();
  });

  it("si los días ya no alcanzan, muestra el mensaje del servidor y sigue pendiente", async () => {
    licenciasService.solicitud.mockResolvedValue(detalle());
    const mensaje =
      "No se puede aprobar: ya no le alcanzan los días de vacaciones para estas fechas (faltan 2). Recházela para que se pida de nuevo.";
    licenciasService.aprobar.mockRejectedValue(error400(null, mensaje));
    responderAlerta("Aprobar");
    await render(conResumen(<DetalleSolicitud id="12" />));

    await fireEvent.press(await screen.findByTestId("aprobar"));

    expect(await screen.findByText(mensaje)).toBeTruthy();
    expect(screen.getByText("Pendiente")).toBeTruthy();
    expect(screen.getByTestId("aprobar")).toBeTruthy();
  });

  it("cancela la propia pendiente con confirmación", async () => {
    licenciasService.solicitud.mockResolvedValue(
      detalle({ puedo: { resolver: false, escalar: false, cancelar: true, cancelar_pide_comentario: false } }),
    );
    licenciasService.cancelar.mockResolvedValue(
      detalle({ estado: "cancelada", estado_display: "Cancelada", puedo: { resolver: false, escalar: false, cancelar: false } }),
    );
    responderAlerta("Cancelar solicitud");
    await render(conResumen(<DetalleSolicitud id="12" empresa="7" />));

    await fireEvent.press(await screen.findByTestId("cancelar-solicitud"));

    await waitFor(() => expect(licenciasService.cancelar).toHaveBeenCalledWith("12", "", { empresa: "7" }));
    expect(licenciasService.solicitud).toHaveBeenCalledWith("12", { empresa: "7" });
    expect(await screen.findByText("Solicitud cancelada.")).toBeTruthy();
    expect(screen.getByText("Cancelada")).toBeTruthy();
    expect(screen.queryByTestId("cancelar-solicitud")).toBeNull();
  });

  it("anular una aprobada no se hace en la app: ofrece el navegador", async () => {
    licenciasService.solicitud.mockResolvedValue(
      detalle({
        estado: "aprobada",
        puedo: { resolver: false, escalar: false, cancelar: true, cancelar_pide_comentario: true },
      }),
    );
    await render(conResumen(<DetalleSolicitud id="12" />));

    expect(await screen.findByTestId("solicitud-en-la-web")).toBeTruthy();
    expect(screen.queryByTestId("cancelar-solicitud")).toBeNull();
  });

  it("si no la puede ver, dice que no se encontró", async () => {
    const error = new Error("404");
    error.response = { status: 404, data: { error: { code: "not_found", message: "No se encontró la solicitud." } } };
    licenciasService.solicitud.mockRejectedValue(error);
    await render(conResumen(<DetalleSolicitud id="99" />));

    expect(await screen.findByText(TEXTO_NO_ENCONTRADA)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Volver" }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("una imagen se ve dentro de la app; un PDF, con el visor del sistema", async () => {
    licenciasService.solicitud.mockResolvedValueOnce(detalle({ tiene_adjunto: true, adjunto_nombre: "foto.jpg" }));
    const { unmount } = await render(conResumen(<DetalleSolicitud id="12" />));
    await fireEvent.press(await screen.findByTestId("ver-documento"));
    expect(await screen.findByLabelText("Documento de respaldo: foto.jpg")).toBeTruthy();
    expect(FileSystem.File.preview).not.toHaveBeenCalled();
    await unmount();

    licenciasService.solicitud.mockResolvedValueOnce(detalle({ tiene_adjunto: true, adjunto_nombre: "certificado.pdf" }));
    await render(conResumen(<DetalleSolicitud id="12" />));
    await fireEvent.press(await screen.findByTestId("ver-documento"));
    await waitFor(() =>
      expect(FileSystem.File.preview).toHaveBeenCalledWith(
        expect.objectContaining({ uri: expect.stringContaining("solicitud-12.pdf") }),
        { mimeType: "application/pdf", title: "certificado.pdf" },
      ),
    );
  });
});

describe("detalle: el documento no se queda en el teléfono (LOPDP)", () => {
  it("al cerrar el visor se borra la imagen descargada", async () => {
    licenciasService.solicitud.mockResolvedValue(detalle({ tiene_adjunto: true, adjunto_nombre: "foto.jpg" }));
    await render(conResumen(<DetalleSolicitud id="12" />));
    await fireEvent.press(await screen.findByTestId("ver-documento"));
    await screen.findByLabelText("Documento de respaldo: foto.jpg");
    expect(FileSystem.__existentes.has("file:///cache/permisos-documentos/solicitud-12.jpg")).toBe(true);

    await fireEvent.press(screen.getByTestId("cerrar-documento"));

    expect(FileSystem.__existentes.has("file:///cache/permisos-documentos/solicitud-12.jpg")).toBe(false);
  });

  it("al salir del detalle se borra el PDF", async () => {
    licenciasService.solicitud.mockResolvedValue(detalle({ tiene_adjunto: true, adjunto_nombre: "c.pdf" }));
    const { unmount } = await render(conResumen(<DetalleSolicitud id="13" />));
    await fireEvent.press(await screen.findByTestId("ver-documento"));
    await waitFor(() => expect(FileSystem.File.preview).toHaveBeenCalled());

    await unmount();

    expect(FileSystem.__existentes.has("file:///cache/permisos-documentos/solicitud-13.pdf")).toBe(false);
  });

  it("un documento que no es imagen ni PDF no se descarga y lo dice", async () => {
    licenciasService.solicitud.mockResolvedValue(detalle({ tiene_adjunto: true, adjunto_nombre: "acta.docx" }));
    await render(conResumen(<DetalleSolicitud id="14" />));
    await fireEvent.press(await screen.findByTestId("ver-documento"));
    expect(screen.getByText(TEXTO_TIPO_NO_VISIBLE)).toBeTruthy();
    expect(FileSystem.File.downloadFileAsync).not.toHaveBeenCalled();
  });

  it("tras aprobar, el resultado se muestra como éxito", async () => {
    licenciasService.solicitud.mockResolvedValue(detalle());
    licenciasService.aprobar.mockResolvedValue(detalle({ estado: "aprobada", puedo: {} }));
    responderAlerta("Aprobar");
    await render(conResumen(<DetalleSolicitud id="12" />));
    // La ayuda dice el mínimo para rechazar desde el principio.
    expect(await screen.findByLabelText(/Opcional para aprobar\. Para rechazar, explique el motivo \(al menos 10/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("aprobar"));
    expect(await screen.findByTestId("resultado")).toBeTruthy();
  });

  it("dos toques en «Aprobar» abren una sola confirmación", async () => {
    licenciasService.solicitud.mockResolvedValue(detalle());
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(conResumen(<DetalleSolicitud id="12" />));
    const boton = await screen.findByTestId("aprobar");
    await fireEvent.press(boton);
    await fireEvent.press(boton);
    expect(alerta).toHaveBeenCalledTimes(1);
  });
});

describe("Mis vacaciones (CA-2)", () => {
  const DATOS = {
    persona: { id: 5, nombre: "Ana" },
    correspondientes: 30,
    gozados: 18,
    pendientes: 12,
    reservados: 5,
    disponibles: 7,
    periodos_con_pendientes: 1,
    regla: { sabados: 2, domingos: 2 },
    en_curso: [{ id: 40, tipo: "Vacaciones", desde: "2026-12-01", hasta: "2026-12-05", dias: 5, paso: "Jefe inmediato" }],
    periodos: [
      { id: 1, nombre: "2024 – 2025", desde: "2024-03-01", hasta: "2025-02-28", correspondientes: 15, gozados: 15, pendientes: 0, reservados: 0, disponibles: 0, sabados: 2, domingos: 2, nota: "", goces: [] },
      {
        id: 2,
        nombre: "2025 – 2026",
        desde: "2025-03-01",
        hasta: "2026-02-28",
        correspondientes: 15,
        gozados: 3,
        pendientes: 12,
        reservados: 5,
        disponibles: 7,
        sabados: 1,
        domingos: 0,
        nota: "",
        goces: [{ id: 9, desde: "2026-08-03", hasta: "2026-08-05", dias: 3, descripcion: "Vacaciones (solicitud n.º 3)", por_defecto: false }],
      },
    ],
  };

  it("muestra lo disponible, los períodos con días y su detalle", async () => {
    vacacionesService.mias.mockResolvedValue(DATOS);
    await render(conResumen(<MisVacaciones />));

    expect(await screen.findByLabelText("Disponibles para pedir: 7 días")).toBeTruthy();
    expect(screen.getByText("Período 2025 – 2026")).toBeTruthy();
    expect(screen.getByLabelText("En aprobación: 5")).toBeTruthy();
    expect(screen.getByText("Vacaciones (solicitud n.º 3)")).toBeTruthy();
    expect(screen.getByText(/Pendientes de gozar: 12 días/)).toBeTruthy();
    expect(screen.getByText("Período ya gozado por completo")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(/^Del 1 de diciembre de 2026/));
    expect(mockRouter.push).toHaveBeenCalledWith("/permisos/solicitud/40");
  });

  it("la cifra grande lleva «días» y la regla de fines de semana se resume con «Más información» (H-18, H-24)", async () => {
    vacacionesService.mias.mockResolvedValue(DATOS);
    await render(conResumen(<MisVacaciones />));
    await screen.findByLabelText("Disponibles para pedir: 7 días");
    expect(screen.getByText("De cada período deben salir al menos 2 sábados y 2 domingos.")).toBeTruthy();
    expect(screen.queryByText(TEXTO_FINES_DETALLE)).toBeNull();

    const mas = screen.getByRole("button", { name: "Más información" });
    expect(mas.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(mas);
    expect(screen.getByText(TEXTO_FINES_DETALLE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Más información" }).props.accessibilityState).toMatchObject({ expanded: true });
  });

  it("«Actualizar» es un ícono con nombre en la fila del título (H-02)", async () => {
    vacacionesService.mias.mockResolvedValue(DATOS);
    await render(conResumen(<MisVacaciones />));
    const actualizar = await screen.findByTestId("actualizar-vacaciones");
    expect(actualizar.props.accessibilityLabel).toBe("Actualizar la lista");
    await fireEvent.press(actualizar);
    await waitFor(() => expect(vacacionesService.mias).toHaveBeenCalledTimes(2));
  });

  it("sin períodos lo dice", async () => {
    vacacionesService.mias.mockResolvedValue({ ...DATOS, periodos: [], en_curso: [] });
    await render(conResumen(<MisVacaciones />));
    expect(await screen.findByText(TEXTO_SIN_PERIODOS)).toBeTruthy();
  });

  it("si falla ofrece «Reintentar»", async () => {
    const error = new Error("red");
    error.esDeRed = true;
    vacacionesService.mias.mockRejectedValueOnce(error).mockResolvedValueOnce(DATOS);
    await render(conResumen(<MisVacaciones />));

    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Período 2025 – 2026")).toBeTruthy();
  });

  it("se recarga al cambiar de empresa (CA-13)", async () => {
    vacacionesService.mias.mockResolvedValue(DATOS);
    const { rerender } = await render(conResumen(<MisVacaciones />));
    await screen.findByText("Período 2025 – 2026");

    mockSesion.versionEmpresa = 1;
    await rerender(conResumen(<MisVacaciones />));

    await waitFor(() => expect(vacacionesService.mias).toHaveBeenCalledTimes(2));
  });
});

describe("pestaña Permisos (CA-1, CA-3, CA-10 y CA-13)", () => {
  function Insignia() {
    const { porAprobar } = useResumenPermisos();
    return <Text>{`por aprobar: ${porAprobar}`}</Text>;
  }

  it("la insignia sale de resumen.por_aprobar y se vuelve a leer al cambiar de empresa", async () => {
    licenciasService.resumen.mockResolvedValue({ por_aprobar: 3, puede_solicitar: true });
    const { rerender } = await render(conResumen(<Insignia />));
    expect(await screen.findByText("por aprobar: 3")).toBeTruthy();

    licenciasService.resumen.mockResolvedValue({ por_aprobar: 0, puede_solicitar: true });
    mockSesion.versionEmpresa = 1;
    await rerender(conResumen(<Insignia />));
    expect(await screen.findByText("por aprobar: 0")).toBeTruthy();
  });

  it("con pendientes ofrece «Por aprobar» con su número, y lista con el solicitante", async () => {
    licenciasService.resumen.mockResolvedValue({ por_aprobar: 2, puede_solicitar: true });
    licenciasService.solicitudes.mockImplementation(async (vista) =>
      vista === "por_aprobar" ? [detalle({ id: 50, solicitante: { id: 8, nombre: "Pedro Gil" } })] : [],
    );
    await render(conResumen(<Permisos />));

    const pestana = await screen.findByLabelText("Por aprobar, 2 por aprobar");
    // Los segmentos dicen el título completo aunque se vea el corto (H-02).
    // Con la letra al 200 % (la de Jest), los segmentos van en columna (N-01).
    const { StyleSheet } = require("react-native");
    expect(StyleSheet.flatten(screen.getByTestId("secciones").props.style).flexDirection).toBe("column");
    // WCAG 2.5.3: el nombre empieza por lo que se ve (N-03).
    expect(screen.getByRole("tab", { name: "Mías: mis solicitudes" })).toBeTruthy();
    expect(screen.getByText("Mías")).toBeTruthy();
    await fireEvent.press(pestana);

    expect(await screen.findByText("Pedro Gil")).toBeTruthy();
    expect(licenciasService.solicitudes).toHaveBeenLastCalledWith("por_aprobar");
    // En «Por aprobar» el título es quién pide; el tipo, debajo (H-17).
    const textos = within(screen.getByTestId("solicitud-50"))
      .getAllByText(/^(Pedro Gil|Vacaciones)$/)
      .map((t) => t.props.children);
    expect(textos).toEqual(["Pedro Gil", "Vacaciones"]);
    await fireEvent.press(screen.getByTestId("solicitud-50"));
    expect(mockRouter.push).toHaveBeenCalledWith("/permisos/solicitud/50");
  });

  it("con letra normal los segmentos van en una fila; desde 1,15 pasan a columna (N-01)", async () => {
    const { Dimensions, StyleSheet } = require("react-native");
    const ventana = Dimensions.get("window");
    const pantalla = Dimensions.get("screen");
    const conLetra = (escala) =>
      act(async () => Dimensions.set({ window: { ...ventana, fontScale: escala }, screen: { ...pantalla, fontScale: escala } }));
    try {
      await conLetra(1);
      await render(conResumen(<Permisos />));
      const direccion = () => StyleSheet.flatten(screen.getByTestId("secciones").props.style).flexDirection;
      expect(direccion()).toBe("row");
      await conLetra(1.15);
      expect(direccion()).toBe("column");
    } finally {
      await act(async () => Dimensions.set({ window: ventana, screen: pantalla }));
    }
  });

  it("sin pendientes, «Por aprobar» sigue a la vista, vacía y sin insignia (D-1)", async () => {
    await render(conResumen(<Permisos />));
    expect(await screen.findByText("No tiene solicitudes.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Por aprobar" })).toBeTruthy();
    expect(screen.getByTestId("seccion-vacaciones")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("seccion-por_aprobar"));
    expect(await screen.findByText("No tiene solicitudes por aprobar.")).toBeTruthy();
  });

  it("«Actualizar» vuelve a pedir la lista, como deslizar hacia abajo", async () => {
    await render(conResumen(<Permisos />));
    await screen.findByText("No tiene solicitudes.");
    await fireEvent.press(screen.getByTestId("actualizar-mias"));
    await waitFor(() => expect(licenciasService.solicitudes).toHaveBeenCalledTimes(2));
  });

  it("mis solicitudes con tipo, fechas, horas, estado con texto y de quién está pendiente", async () => {
    licenciasService.solicitudes.mockResolvedValue([
      detalle({ id: 60, flujo: "Cita personal", unidad: "horas", desde: "2026-11-18", hasta: "2026-11-18", hora_desde: "08:00", hora_hasta: "10:30", minutos: 150 }),
    ]);
    await render(conResumen(<Permisos />));

    expect(await screen.findByText("18/11/2026, 08:00 a 10:30 · 2 h 30 min")).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Cita personal. 18 de noviembre de 2026. de 08:00 a 10:30. 2 h 30 min. Estado: Pendiente. Pendiente de Ana Pérez",
      ),
    ).toBeTruthy();
  });

  it("sin rol, «Nueva solicitud» queda desactivado con la explicación", async () => {
    licenciasService.resumen.mockResolvedValue({ por_aprobar: 0, puede_solicitar: false });
    await render(conResumen(<Permisos />));
    expect(await screen.findByText(TEXTO_SIN_ROL)).toBeTruthy();
    expect(screen.getByTestId("nueva-solicitud").props.accessibilityState.disabled).toBe(true);
  });

  it("se recarga al cambiar de empresa", async () => {
    const { rerender } = await render(conResumen(<Permisos />));
    await screen.findByText("No tiene solicitudes.");

    mockSesion.versionEmpresa = 1;
    await rerender(conResumen(<Permisos />));

    await waitFor(() => expect(licenciasService.solicitudes).toHaveBeenCalledTimes(2));
    expect(licenciasService.resumen).toHaveBeenCalledTimes(2);
  });

  it("?seccion=vacaciones (desde el Inicio o un aviso) abre Mis vacaciones", async () => {
    mockParametros.seccion = "vacaciones";
    vacacionesService.mias.mockResolvedValue({ periodos: [], en_curso: [] });
    await render(conResumen(<Permisos />));
    expect(await screen.findByText(TEXTO_SIN_PERIODOS)).toBeTruthy();
  });

  it("si un refresco falla, conserva la lista y lo dice", async () => {
    licenciasService.solicitudes.mockResolvedValueOnce([detalle({ id: 70 })]);
    await render(conResumen(<Permisos />));
    await screen.findByTestId("solicitud-70");

    const error = new Error("red");
    error.esDeRed = true;
    licenciasService.solicitudes.mockRejectedValueOnce(error);
    await act(async () => {
      await screen.getByTestId("lista-mias").props.refreshControl.props.onRefresh();
    });

    expect(screen.getByTestId("solicitud-70")).toBeTruthy();
    expect(screen.getByText(/Se muestran las anteriores/)).toBeTruthy();
  });
});
