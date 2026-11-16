import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Alert, AppState } from "react-native";

import { chatService, directorioService } from "../src/api/servicios";
import {
  cuerpoDelGrupo,
  errorDelGrupo,
  hayCambiosEnElGrupo,
  listaDeNombres,
  puedeCambiarMiembros,
  puedeRenombrar,
  puedeSalir,
  TEXTO_EDICION_PUEDE_HABERSE_GUARDADO,
  TEXTO_GRUPO_PUEDE_HABERSE_CREADO,
  TEXTO_PUEDE_HABER_SALIDO,
  TEXTO_SIN_AREA,
  TEXTO_SIN_NOMBRE,
  TEXTO_SIN_PERMISO_AREA,
  TEXTO_SIN_PERSONAS,
  TEXTO_SOLO_QUIEN_ADMINISTRA,
  TEXTO_TRASPASO,
  TEXTO_YA_NO_ESTA,
  validarGrupo,
} from "../src/chat/grupos";
import { TEXTO_REENVIO, TITULO_REENVIO } from "../src/pantallas/activos/formularios";
import { AYUDA_PERSONAS, NuevoGrupo, TEXTO_SIN_AREAS, textoDelBotonCrear } from "../src/pantallas/chat/NuevoGrupo";
import { ESPERA_OLVIDAR_MS, Participantes, TEXTO_SALIR, TITULO_SALIR } from "../src/pantallas/chat/Participantes";
import PantallaNuevoGrupo from "../src/app/(app)/chat/grupo-nuevo";

/**
 * US-024: crear, editar y salir de un grupo del chat en la app (antes, en la
 * web). Los servicios están en `chatServicios.test.js`; la lista de chats y
 * los participantes sin edición, en `chatPantallas.test.js`.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn() };
const mockNavegacion = { setOptions: jest.fn(), dispatch: jest.fn() };
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
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const mockSesion = { usuario: { id: 9, permissions: [] }, empresaActiva: { id: 1 }, versionEmpresa: 0 };
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));

const mockChat = { cargarConversaciones: jest.fn(async () => null), olvidarConversacion: jest.fn() };
jest.mock("../src/chat/ChatContext", () => ({
  useChat: () => mockChat,
  useChatVisible: () => {},
}));

jest.mock("../src/api/servicios", () => ({
  chatService: {
    conversacion: jest.fn(),
    crearGrupo: jest.fn(),
    editarGrupo: jest.fn(),
    salir: jest.fn(),
    areas: jest.fn(),
    presencia: jest.fn(),
  },
  directorioService: { buscar: jest.fn() },
}));

const CARLA = { id: 9, nombre: "Carla Ruiz", correo: "carla@grupolaar.com", area: "Cartera", cargo: "Analista" };
const LUIS = { id: 12, nombre: "Luis Mora", correo: "luis@grupolaar.com", area: "TI", cargo: "Soporte" };
const ANA = { id: 15, nombre: "Ana Pérez", correo: "ana@grupolaar.com", area: "TI", cargo: "Jefa" };

/** Con la forma real de `ConversacionView.get`. Carla (la sesión) lo
 * administra. */
const GRUPO = {
  id: 7,
  tipo: "grupo",
  nombre: "Equipo TI",
  otro: null,
  departamento: null,
  miembros: 2,
  administra: true,
  no_leidos: 0,
  ultimo: null,
  participantes: [
    { ...CARLA, administra: true },
    { ...LUIS, administra: false },
  ],
};

/** Los errores de campo no los lee el lector aparte (ya van en la etiqueta
 * del campo): se buscan también entre lo oculto. */
const OCULTOS = { includeHiddenElements: true };

function errorDeRed() {
  const error = new Error("red");
  error.esDeRed = true;
  return error;
}

function errorHttp(status, details, message = "Error en la solicitud.") {
  const error = new Error(message);
  error.response = { status, data: { error: { code: "x", message, details } } };
  return error;
}

function pendiente() {
  let resolver;
  let rechazar;
  const promesa = new Promise((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

/** Toques sin esperar a lo que devuelve el manejador (la petición se deja
 * pendiente a propósito), todos antes de que React vuelva a pintar. */
async function tocarSinEsperar(...elementos) {
  const manejadores = elementos.map((elemento) => {
    for (let fibra = elemento.unstable_fiber; fibra; fibra = fibra.return) {
      if (typeof fibra.memoizedProps?.onPress === "function") return fibra.memoizedProps.onPress;
    }
    throw new Error("Sin onPress");
  });
  await act(async () => {
    for (const alTocar of manejadores) alTocar();
  });
}

/** El `Alert.alert` responde tocando el botón con ese texto. */
function responderAlerta(texto) {
  return jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => {
    botones.find((b) => b.text === texto)?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Sin respuestas «Once» que sobren de otra prueba.
  for (const fn of [...Object.values(chatService), ...Object.values(directorioService)]) fn.mockReset();
  mockSesion.usuario = { id: 9, permissions: [] };
  mockPrevenir.activa = false;
  mockPrevenir.alIntentar = null;
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: jest.fn() }));
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  chatService.presencia.mockResolvedValue({});
  chatService.areas.mockResolvedValue([
    { id: 4, nombre: "Cartera" },
    { id: 5, nombre: "TI" },
  ]);
  directorioService.buscar.mockResolvedValue([LUIS, ANA]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reglas de los grupos (chat/grupos.js)", () => {
  it("quién renombra, quién cambia los miembros y de qué se sale", () => {
    expect(puedeRenombrar({ tipo: "grupo", administra: true })).toBe(true);
    expect(puedeRenombrar({ tipo: "area", administra: true })).toBe(true);
    expect(puedeRenombrar({ tipo: "grupo", administra: false })).toBe(false);
    expect(puedeRenombrar({ tipo: "general", administra: true })).toBe(false);
    expect(puedeCambiarMiembros({ tipo: "grupo", administra: true })).toBe(true);
    expect(puedeCambiarMiembros({ tipo: "area", administra: true })).toBe(false);
    expect(puedeSalir({ tipo: "grupo", administra: false })).toBe(true);
    expect(puedeSalir({ tipo: "area", administra: false })).toBe(false);
    expect(puedeSalir({ tipo: "general" })).toBe(false);
  });

  it("valida y arma el cuerpo como la web: personas o área, nunca las dos", () => {
    expect(validarGrupo({ nombre: "  ", modo: "personas", elegidas: [] })).toEqual({
      nombre: TEXTO_SIN_NOMBRE,
      participantes: TEXTO_SIN_PERSONAS,
    });
    expect(validarGrupo({ nombre: "TI", modo: "area", elegidas: [CARLA], area: "" })).toEqual({ departamento: TEXTO_SIN_AREA });
    expect(cuerpoDelGrupo({ nombre: " Equipo TI ", modo: "personas", elegidas: [LUIS, ANA], area: "4" })).toEqual({
      nombre: "Equipo TI",
      participantes: [12, 15],
    });
    expect(cuerpoDelGrupo({ nombre: "Cartera", modo: "area", elegidas: [LUIS], area: "4" })).toEqual({
      nombre: "Cartera",
      departamento: 4,
    });
    expect(hayCambiosEnElGrupo({ nombre: " ", elegidas: [], area: "" })).toBe(false);
    expect(hayCambiosEnElGrupo({ nombre: "", elegidas: [LUIS], area: "" })).toBe(true);
    expect(listaDeNombres([LUIS, ANA, CARLA])).toBe("Luis Mora, Ana Pérez y Carla Ruiz");
  });

  it("los errores: por campo, 403 explicado, 404 y sin respuesta clara", () => {
    const nombres = { nombre: "Nombre del grupo", participantes: "Personas" };
    const de400 = errorDelGrupo(errorHttp(400, { nombre: ["Póngale un nombre al grupo."] }), "x", { nombres });
    expect(de400).toMatchObject({ texto: "Revise el campo: Nombre del grupo.", campos: { nombre: "Póngale un nombre al grupo." } });
    const oculto = errorDelGrupo(errorHttp(400, { otro: ["Algo raro."] }), "x", { nombres });
    expect(oculto).toMatchObject({ texto: "Algo raro.", campos: {} });
    expect(errorDelGrupo(errorHttp(403, undefined, "You do not have permission to perform this action."), "x").texto).toMatch(/No tiene permiso/);
    expect(errorDelGrupo(errorHttp(403), "x", { sinPermiso: TEXTO_SIN_PERMISO_AREA }).texto).toBe(TEXTO_SIN_PERMISO_AREA);
    expect(errorDelGrupo(errorHttp(404), "x").texto).toBe(TEXTO_YA_NO_ESTA);
    expect(errorDelGrupo(errorDeRed(), "x")).toMatchObject({ texto: TEXTO_GRUPO_PUEDE_HABERSE_CREADO, dudoso: true });
  });
});

describe("crear un grupo (CA-1, CA-2, CA-5)", () => {
  async function abrir() {
    await render(<PantallaNuevoGrupo />);
    await screen.findByText("Luis Mora");
  }

  it("personalizado: elige, ve y quita personas, y envía el cuerpo exacto; luego abre la conversación", async () => {
    chatService.crearGrupo.mockResolvedValueOnce({ id: 30, tipo: "grupo", nombre: "Equipo TI" });
    await abrir();
    // Sin el permiso no hay «Por área» ni se piden las áreas.
    expect(screen.queryByText("Por área")).toBeNull();
    expect(chatService.areas).not.toHaveBeenCalled();
    expect(directorioService.buscar).toHaveBeenCalledWith("", {});

    await fireEvent.changeText(screen.getByTestId("nombre-del-grupo"), "Equipo TI");
    await fireEvent.press(screen.getByRole("button", { name: /^Agregar a Luis Mora/ }));
    await fireEvent.press(screen.getByRole("button", { name: /^Agregar a Ana Pérez/ }));
    expect(screen.getByText("2 personas elegidas")).toBeTruthy();
    // Lo elegido ya no se ofrece en la búsqueda.
    expect(screen.queryByRole("button", { name: /^Agregar a Luis Mora/ })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Quitar a Ana Pérez" }));
    expect(screen.getByText("1 persona elegida")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("crear-grupo"));
    expect(chatService.crearGrupo).toHaveBeenCalledTimes(1);
    expect(chatService.crearGrupo).toHaveBeenCalledWith({ nombre: "Equipo TI", participantes: [12] });
    expect(mockChat.cargarConversaciones).toHaveBeenCalledWith({ silenciosa: true });
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/chat/conversacion/30"));
  });

  it("sin nombre ni personas no envía: lo dice junto a cada campo", async () => {
    await abrir();
    await fireEvent.press(screen.getByTestId("crear-grupo"));
    expect(chatService.crearGrupo).not.toHaveBeenCalled();
    expect(screen.getByTestId("nuevo-grupo-error")).toHaveTextContent(/Revise los campos: Nombre del grupo y Personas\./);
    expect(screen.getByText(TEXTO_SIN_NOMBRE, OCULTOS)).toBeTruthy();
    expect(screen.getByText(TEXTO_SIN_PERSONAS, OCULTOS)).toBeTruthy();
  });

  it("un 400 del servidor en el nombre y en los participantes va junto a su campo", async () => {
    chatService.crearGrupo.mockRejectedValueOnce(
      errorHttp(400, { nombre: ["Asegúrese de que este campo no tenga más de 120 caracteres."] }),
    );
    await abrir();
    await fireEvent.changeText(screen.getByTestId("nombre-del-grupo"), "Equipo TI");
    await fireEvent.press(screen.getByRole("button", { name: /^Agregar a Luis Mora/ }));
    await fireEvent.press(screen.getByTestId("crear-grupo"));
    expect(await screen.findByText("Asegúrese de que este campo no tenga más de 120 caracteres.", OCULTOS)).toBeTruthy();
    expect(screen.getByTestId("nuevo-grupo-error")).toHaveTextContent(/Revise el campo: Nombre del grupo\./);
    expect(screen.getByTestId("nombre-del-grupo").props.accessibilityLabel).toMatch(/Error: Asegúrese/);

    chatService.crearGrupo.mockRejectedValueOnce(errorHttp(400, { participantes: ["Elija al menos a una persona."] }));
    await fireEvent.press(screen.getByTestId("crear-grupo"));
    expect(await screen.findByText(TEXTO_SIN_PERSONAS, OCULTOS)).toBeTruthy();
    expect(screen.getByTestId("nuevo-grupo-error")).toHaveTextContent(/Revise el campo: Personas\./);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("por área: solo con el permiso; elige el área y envía {nombre, departamento}", async () => {
    mockSesion.usuario = { id: 9, permissions: ["chat.grupos_por_area"] };
    chatService.crearGrupo.mockResolvedValueOnce({ id: 31, tipo: "area", nombre: "Cartera" });
    await abrir();
    expect(chatService.areas).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("radio", { name: "Por área" }));
    await fireEvent.changeText(screen.getByTestId("nombre-del-grupo"), "Cartera");
    await fireEvent.press(await screen.findByTestId("area-del-grupo"));
    await fireEvent.press(screen.getByTestId("area-del-grupo-opcion-4"));
    await fireEvent.press(screen.getByTestId("crear-grupo"));
    expect(chatService.crearGrupo).toHaveBeenCalledWith({ nombre: "Cartera", departamento: 4 });
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/chat/conversacion/31"));
  });

  it("por área sin área elegida no envía; un 403 del servidor se explica", async () => {
    mockSesion.usuario = { id: 9, permissions: ["chat.grupos_por_area"] };
    chatService.crearGrupo.mockRejectedValueOnce(errorHttp(403, undefined, "You do not have permission to perform this action."));
    await abrir();
    await fireEvent.press(screen.getByRole("radio", { name: "Por área" }));
    await fireEvent.changeText(screen.getByTestId("nombre-del-grupo"), "Cartera");
    await screen.findByTestId("area-del-grupo");
    await fireEvent.press(screen.getByTestId("crear-grupo"));
    expect(chatService.crearGrupo).not.toHaveBeenCalled();
    expect(screen.getByText(TEXTO_SIN_AREA, OCULTOS)).toBeTruthy();

    await fireEvent.press(screen.getByTestId("area-del-grupo"));
    await fireEvent.press(screen.getByTestId("area-del-grupo-opcion-5"));
    await fireEvent.press(screen.getByTestId("crear-grupo"));
    expect(await screen.findByText(TEXTO_SIN_PERMISO_AREA)).toBeTruthy();
  });

  it("si las áreas no cargan, ofrece «Reintentar»", async () => {
    mockSesion.usuario = { id: 9, permissions: ["chat.grupos_por_area"] };
    chatService.areas.mockRejectedValueOnce(errorHttp(500, undefined, "Falló el servidor."));
    await abrir();
    await fireEvent.press(screen.getByRole("radio", { name: "Por área" }));
    expect(await screen.findByText("Falló el servidor.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("area-del-grupo")).toBeTruthy();
  });

  it("un doble toque crea un solo grupo", async () => {
    const espera = pendiente();
    chatService.crearGrupo.mockReturnValueOnce(espera.promesa);
    await abrir();
    await fireEvent.changeText(screen.getByTestId("nombre-del-grupo"), "Equipo TI");
    await fireEvent.press(screen.getByRole("button", { name: /^Agregar a Luis Mora/ }));
    const boton = screen.getByTestId("crear-grupo");
    await tocarSinEsperar(boton, boton);
    expect(chatService.crearGrupo).toHaveBeenCalledTimes(1);
    // Mientras se crea no se sale de la pantalla.
    expect(mockPrevenir.activa).toBe(true);
    await act(async () => espera.resolver({ id: 30 }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/chat/conversacion/30"));
  });

  it("sin respuesta del servidor dice que pudo crearse y pregunta antes de reenviar", async () => {
    chatService.crearGrupo.mockRejectedValueOnce(errorDeRed()).mockResolvedValueOnce({ id: 30 });
    await abrir();
    await fireEvent.changeText(screen.getByTestId("nombre-del-grupo"), "Equipo TI");
    await fireEvent.press(screen.getByRole("button", { name: /^Agregar a Luis Mora/ }));
    await fireEvent.press(screen.getByTestId("crear-grupo"));
    expect(await screen.findByText(TEXTO_GRUPO_PUEDE_HABERSE_CREADO)).toBeTruthy();

    let alerta = responderAlerta("No, revisar primero");
    await fireEvent.press(screen.getByTestId("crear-grupo"));
    expect(alerta).toHaveBeenCalledWith(TITULO_REENVIO, TEXTO_REENVIO, expect.any(Array), expect.any(Object));
    expect(chatService.crearGrupo).toHaveBeenCalledTimes(1);
    alerta.mockRestore();

    alerta = responderAlerta("Enviar de nuevo");
    await fireEvent.press(screen.getByTestId("crear-grupo"));
    expect(chatService.crearGrupo).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/chat/conversacion/30"));
  });

  it("salir con algo empezado pregunta; «Descartar» sale y «Seguir escribiendo» se queda", async () => {
    await abrir();
    expect(mockPrevenir.activa).toBe(false);
    await fireEvent.changeText(screen.getByTestId("nombre-del-grupo"), "Equipo TI");
    expect(mockPrevenir.activa).toBe(true);

    let alerta = responderAlerta("Seguir escribiendo");
    await act(async () => {
      mockPrevenir.alIntentar({ data: { action: { type: "GO_BACK" } } });
    });
    expect(alerta).toHaveBeenCalledWith("¿Descartar lo que escribió?", expect.any(String), expect.any(Array), expect.any(Object));
    expect(mockNavegacion.dispatch).not.toHaveBeenCalled();
    alerta.mockRestore();

    alerta = responderAlerta("Descartar");
    await act(async () => {
      mockPrevenir.alIntentar({ data: { action: { type: "GO_BACK" } } });
    });
    await waitFor(() => expect(mockNavegacion.dispatch).toHaveBeenCalledWith({ type: "GO_BACK" }));
  });

  it("la pantalla de la ruta es «Nuevo grupo»", async () => {
    await render(<NuevoGrupo />);
    expect(await screen.findByTestId("nuevo-grupo")).toBeTruthy();
  });
});

describe("editar y salir en «Participantes» (CA-3, CA-4, CA-6)", () => {
  async function abrir(conversacion = GRUPO, empresa = "2") {
    chatService.conversacion.mockResolvedValueOnce(conversacion);
    await render(<Participantes id="7" empresa={empresa} />);
    await screen.findByText(conversacion.nombre);
  }

  it("quien administra renombra el grupo, en la empresa de la conversación", async () => {
    chatService.editarGrupo.mockResolvedValueOnce({ ...GRUPO, nombre: "Soporte TI" });
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Cambiar el nombre" }));
    expect(screen.getByTestId("nuevo-nombre").props.value).toBe("Equipo TI");
    await fireEvent.changeText(screen.getByTestId("nuevo-nombre"), "  Soporte TI ");
    expect(mockPrevenir.activa).toBe(true);
    await fireEvent.press(screen.getByTestId("guardar-nombre"));
    expect(chatService.editarGrupo).toHaveBeenCalledWith("7", { nombre: "Soporte TI" }, { empresa: "2" });
    expect(await screen.findByText("El grupo ahora se llama «Soporte TI».")).toBeTruthy();
    expect(screen.getAllByRole("header")[0]).toHaveTextContent(/Soporte TI/);
    expect(screen.queryByTestId("nuevo-nombre")).toBeNull();
    expect(mockChat.cargarConversaciones).toHaveBeenCalledWith({ silenciosa: true });
    expect(mockPrevenir.activa).toBe(false);
  });

  it("renombrar sin nombre no envía; un 400 del servidor va junto al campo", async () => {
    chatService.editarGrupo.mockRejectedValueOnce(errorHttp(400, { nombre: ["Póngale un nombre al grupo."] }));
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Cambiar el nombre" }));
    await fireEvent.changeText(screen.getByTestId("nuevo-nombre"), "   ");
    await fireEvent.press(screen.getByTestId("guardar-nombre"));
    expect(chatService.editarGrupo).not.toHaveBeenCalled();
    expect(screen.getByText(TEXTO_SIN_NOMBRE, OCULTOS)).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId("nuevo-nombre"), "Otro");
    expect(screen.queryByText(TEXTO_SIN_NOMBRE)).toBeNull();
    await fireEvent.press(screen.getByTestId("guardar-nombre"));
    expect(await screen.findByText(TEXTO_SIN_NOMBRE, OCULTOS)).toBeTruthy();
    expect(screen.getByTestId("aviso-del-grupo")).toHaveTextContent(/Revise el campo: Nombre del grupo\./);
    expect(screen.getByTestId("nuevo-nombre")).toBeTruthy();
  });

  it("agrega personas buscadas en el directorio de esa empresa, sin ofrecer a quien ya está", async () => {
    directorioService.buscar.mockResolvedValue([CARLA, LUIS, ANA]);
    chatService.editarGrupo.mockResolvedValueOnce({ ...GRUPO, participantes: [...GRUPO.participantes, { ...ANA, administra: false }] });
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Agregar personas" }));
    await screen.findByRole("button", { name: /^Agregar a Ana Pérez/ });
    expect(directorioService.buscar).toHaveBeenCalledWith("", { empresa: "2" });
    expect(screen.queryByRole("button", { name: /^Agregar a Luis Mora/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Agregar a Carla Ruiz/ })).toBeNull();

    // Sin nadie elegido no envía.
    await fireEvent.press(screen.getByTestId("confirmar-agregar"));
    expect(chatService.editarGrupo).not.toHaveBeenCalled();
    expect(screen.getByText(TEXTO_SIN_PERSONAS, OCULTOS)).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: /^Agregar a Ana Pérez/ }));
    expect(mockPrevenir.activa).toBe(true);
    await fireEvent.press(screen.getByTestId("confirmar-agregar"));
    expect(chatService.editarGrupo).toHaveBeenCalledWith("7", { agregar: [15] }, { empresa: "2" });
    expect(await screen.findByText("Se agregó a Ana Pérez al grupo.")).toBeTruthy();
    expect(screen.getByText("Participantes (3)")).toBeTruthy();
    expect(screen.queryByTestId("agregar-personas")).toBeNull();
  });

  it("quitar a alguien pide confirmación; a sí mismo no se ofrece", async () => {
    chatService.editarGrupo.mockResolvedValueOnce({ ...GRUPO, participantes: [GRUPO.participantes[0]] });
    await abrir();
    expect(screen.queryByTestId("quitar-9")).toBeNull();
    expect(screen.getByTestId("participante-9").props.accessibilityLabel).toMatch(/^Carla Ruiz\. Usted\. Administra el grupo/);

    let alerta = responderAlerta("Cancelar");
    await fireEvent.press(screen.getByRole("button", { name: "Quitar a Luis Mora del grupo" }));
    expect(alerta).toHaveBeenCalledWith("¿Quitar a Luis Mora del grupo?", expect.any(String), expect.any(Array), expect.any(Object));
    expect(chatService.editarGrupo).not.toHaveBeenCalled();
    alerta.mockRestore();

    alerta = responderAlerta("Quitar");
    await fireEvent.press(screen.getByRole("button", { name: "Quitar a Luis Mora del grupo" }));
    expect(chatService.editarGrupo).toHaveBeenCalledWith("7", { quitar: [12] }, { empresa: "2" });
    expect(await screen.findByText("Se quitó a Luis Mora del grupo.")).toBeTruthy();
    expect(screen.queryByTestId("participante-12")).toBeNull();
  });

  it("un 403 al editar se explica; sin respuesta, dice que pudo guardarse y pregunta antes de reenviar", async () => {
    chatService.editarGrupo
      .mockRejectedValueOnce(errorHttp(403, undefined, "You do not have permission to perform this action."))
      .mockRejectedValueOnce(errorDeRed());
    await abrir();
    let alerta = responderAlerta("Quitar");
    await fireEvent.press(screen.getByRole("button", { name: "Quitar a Luis Mora del grupo" }));
    expect(await screen.findByText(TEXTO_SOLO_QUIEN_ADMINISTRA)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Quitar a Luis Mora del grupo" }));
    expect(await screen.findByText(TEXTO_EDICION_PUEDE_HABERSE_GUARDADO)).toBeTruthy();
    alerta.mockRestore();

    // Confirma «Quitar» y luego no reenvía a ciegas.
    alerta = jest.spyOn(Alert, "alert").mockImplementation((titulo, _m, botones) => {
      const texto = titulo === TITULO_REENVIO ? "No, revisar primero" : "Quitar";
      botones.find((b) => b.text === texto).onPress();
    });
    await fireEvent.press(screen.getByRole("button", { name: "Quitar a Luis Mora del grupo" }));
    expect(alerta).toHaveBeenCalledWith(TITULO_REENVIO, TEXTO_REENVIO, expect.any(Array), expect.any(Object));
    expect(chatService.editarGrupo).toHaveBeenCalledTimes(2);
  });

  it("un doble toque en «Quitar» hace una sola pregunta", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await abrir();
    const boton = screen.getByRole("button", { name: "Quitar a Luis Mora del grupo" });
    await tocarSinEsperar(boton, boton);
    expect(alerta).toHaveBeenCalledTimes(1);
  });

  it("en un grupo por área quien administra solo cambia el nombre, y no se sale", async () => {
    await abrir({ ...GRUPO, tipo: "area", nombre: "Cartera" });
    expect(screen.getByRole("button", { name: "Cambiar el nombre" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agregar personas" })).toBeNull();
    expect(screen.queryByTestId("quitar-12")).toBeNull();
    expect(screen.queryByTestId("salir-del-grupo")).toBeNull();
    expect(screen.getByText(/los da el área/)).toBeTruthy();
  });

  it("quien no administra no edita, pero sale de un grupo personalizado", async () => {
    await abrir({ ...GRUPO, administra: false });
    expect(screen.queryByTestId("renombrar-grupo")).toBeNull();
    expect(screen.queryByTestId("abrir-agregar")).toBeNull();
    expect(screen.queryByTestId("quitar-12")).toBeNull();
    expect(screen.getByRole("button", { name: "Salir del grupo" })).toBeTruthy();
  });

  it("salir pide confirmación y vuelve a la lista de chats, ya sin el grupo", async () => {
    chatService.salir.mockResolvedValueOnce(null);
    await abrir();
    let alerta = responderAlerta("Cancelar");
    await fireEvent.press(screen.getByRole("button", { name: "Salir del grupo" }));
    // UX H-06: es la única que administra, y se le avisa del traspaso.
    expect(alerta).toHaveBeenCalledWith(TITULO_SALIR, `${TEXTO_TRASPASO} ${TEXTO_SALIR}`, expect.any(Array), expect.any(Object));
    expect(chatService.salir).not.toHaveBeenCalled();
    alerta.mockRestore();

    alerta = responderAlerta("Salir del grupo");
    await fireEvent.press(screen.getByRole("button", { name: "Salir del grupo" }));
    expect(chatService.salir).toHaveBeenCalledWith("7", { empresa: "2" });
    await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith("/chat"));
    // QA-TECH P3: primero se navega y, pasada la transición, se olvida.
    expect(mockChat.olvidarConversacion).not.toHaveBeenCalled();
    await waitFor(() => expect(mockChat.olvidarConversacion).toHaveBeenCalledWith("7"), { timeout: ESPERA_OLVIDAR_MS + 1000 });
    expect(mockChat.cargarConversaciones).toHaveBeenCalledWith({ silenciosa: true });
    expect(mockRouter.dismissTo.mock.invocationCallOrder[0]).toBeLessThan(mockChat.olvidarConversacion.mock.invocationCallOrder[0]);
  });

  it("si no puede salir lo dice y se queda", async () => {
    chatService.salir.mockRejectedValueOnce(errorHttp(403, undefined, "You do not have permission to perform this action."));
    await abrir();
    responderAlerta("Salir del grupo");
    await fireEvent.press(screen.getByRole("button", { name: "Salir del grupo" }));
    expect(await screen.findByText(TEXTO_YA_NO_ESTA)).toBeTruthy();
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
    expect(mockChat.olvidarConversacion).not.toHaveBeenCalled();
  });

  it("salir con personas elegidas sin agregar pregunta antes de descartarlas", async () => {
    await abrir();
    await fireEvent.press(screen.getByRole("button", { name: "Agregar personas" }));
    await fireEvent.press(await screen.findByRole("button", { name: /^Agregar a Ana Pérez/ }));
    expect(mockPrevenir.activa).toBe(true);
    const alerta = responderAlerta("Descartar");
    await act(async () => {
      mockPrevenir.alIntentar({ data: { action: { type: "GO_BACK" } } });
    });
    expect(alerta).toHaveBeenCalledWith("¿Descartar lo que escribió?", expect.any(String), expect.any(Array), expect.any(Object));
    await waitFor(() => expect(mockNavegacion.dispatch).toHaveBeenCalledWith({ type: "GO_BACK" }));
  });
});

describe("ronda de correcciones de QA (US-024)", () => {
  async function abrirGrupo(conversacion = GRUPO, empresa = "2") {
    chatService.conversacion.mockResolvedValueOnce(conversacion);
    await render(<Participantes id="7" empresa={empresa} />);
    await screen.findByText(conversacion.nombre);
  }

  it("QA-FUNC O-1: un 400 técnico al quitar se dice arriba, con palabras", async () => {
    chatService.editarGrupo.mockRejectedValueOnce(errorHttp(400, { quitar: ['Clave primaria "12" inválida - objeto no existe.'] }));
    await abrirGrupo();
    responderAlerta("Quitar");
    await fireEvent.press(screen.getByRole("button", { name: "Quitar a Luis Mora del grupo" }));
    expect(await screen.findByText("No se pudo quitar a Luis Mora: su cuenta ya no está activa.")).toBeTruthy();
    expect(screen.queryByText(/Clave primaria/, OCULTOS)).toBeNull();
  });

  it("QA-FUNC O-2: salir sin respuesta refresca la lista; al reintentar, un 403 es que ya salió", async () => {
    chatService.salir.mockRejectedValueOnce(errorDeRed()).mockRejectedValueOnce(errorHttp(403));
    await abrirGrupo({ ...GRUPO, administra: false });
    responderAlerta("Salir del grupo");
    await fireEvent.press(screen.getByRole("button", { name: "Salir del grupo" }));
    expect(await screen.findByText(TEXTO_PUEDE_HABER_SALIDO)).toBeTruthy();
    expect(mockChat.cargarConversaciones).toHaveBeenCalledWith({ silenciosa: true });
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Salir del grupo" }));
    await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith("/chat"));
    await waitFor(() => expect(mockChat.olvidarConversacion).toHaveBeenCalledWith("7"), { timeout: ESPERA_OLVIDAR_MS + 1000 });
  });

  it("QA-FUNC O-4: con un 403 al editar recarga en silencio y quien ya no administra deja de ver los controles", async () => {
    chatService.editarGrupo.mockRejectedValueOnce(errorHttp(403));
    chatService.conversacion.mockResolvedValueOnce(GRUPO).mockResolvedValueOnce({ ...GRUPO, administra: false });
    await render(<Participantes id="7" empresa="2" />);
    await screen.findByText("Equipo TI");
    await fireEvent.press(screen.getByRole("button", { name: "Cambiar el nombre" }));
    await fireEvent.changeText(screen.getByTestId("nuevo-nombre"), "Otro");
    await fireEvent.press(screen.getByTestId("guardar-nombre"));
    expect(await screen.findByText(TEXTO_SOLO_QUIEN_ADMINISTRA)).toBeTruthy();
    await waitFor(() => expect(chatService.conversacion).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("nuevo-nombre")).toBeNull());
    expect(screen.queryByTestId("abrir-agregar")).toBeNull();
    // Sin «Cargando»: la pantalla no se vació.
    expect(screen.getByText("Equipo TI")).toBeTruthy();
  });

  it("QA-TECH P3: la confirmación de reenvío es de cada acción; tras una duda recarga para revisar", async () => {
    chatService.editarGrupo.mockRejectedValueOnce(errorDeRed()).mockResolvedValueOnce({ ...GRUPO, nombre: "Otro" });
    chatService.conversacion.mockResolvedValue(GRUPO);
    await render(<Participantes id="7" empresa="2" />);
    await screen.findByText("Equipo TI");
    responderAlerta("Quitar");
    await fireEvent.press(screen.getByRole("button", { name: "Quitar a Luis Mora del grupo" }));
    expect(await screen.findByText(TEXTO_EDICION_PUEDE_HABERSE_GUARDADO)).toBeTruthy();
    await waitFor(() => expect(chatService.conversacion).toHaveBeenCalledTimes(2));

    const alerta = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByRole("button", { name: "Cambiar el nombre" }));
    await fireEvent.changeText(screen.getByTestId("nuevo-nombre"), "Otro");
    await fireEvent.press(screen.getByTestId("guardar-nombre"));
    expect(alerta.mock.calls.some(([titulo]) => titulo === TITULO_REENVIO)).toBe(false);
    expect(chatService.editarGrupo).toHaveBeenLastCalledWith("7", { nombre: "Otro" }, { empresa: "2" });
  });

  it("QA-TECH P3: «Se agregó» solo para quien quedó; de los demás dice que no se pudo", async () => {
    directorioService.buscar.mockResolvedValue([ANA, { id: 20, nombre: "Pedro León" }]);
    chatService.editarGrupo.mockResolvedValueOnce({ ...GRUPO, participantes: [...GRUPO.participantes, { ...ANA, administra: false }] });
    await abrirGrupo();
    await fireEvent.press(screen.getByRole("button", { name: "Agregar personas" }));
    await fireEvent.press(await screen.findByRole("button", { name: /^Agregar a Ana Pérez/ }));
    await fireEvent.press(screen.getByRole("button", { name: /^Agregar a Pedro León/ }));
    expect(screen.getByTestId("confirmar-agregar")).toHaveTextContent(/Agregar 2 personas/);
    await fireEvent.press(screen.getByTestId("confirmar-agregar"));
    expect(chatService.editarGrupo).toHaveBeenCalledWith("7", { agregar: [15, 20] }, { empresa: "2" });
    expect(
      await screen.findByText("Se agregó a Ana Pérez al grupo. No se pudo agregar a Pedro León al grupo."),
    ).toBeTruthy();
  });

  it("UX H-03: «Listo» en el teclado guarda el nombre", async () => {
    chatService.editarGrupo.mockResolvedValueOnce({ ...GRUPO, nombre: "Soporte" });
    await abrirGrupo();
    await fireEvent.press(screen.getByRole("button", { name: "Cambiar el nombre" }));
    const campo = screen.getByTestId("nuevo-nombre");
    expect(campo.props.returnKeyType).toBe("done");
    await fireEvent.changeText(campo, "Soporte");
    await fireEvent(campo, "submitEditing");
    expect(chatService.editarGrupo).toHaveBeenCalledWith("7", { nombre: "Soporte" }, { empresa: "2" });
  });

  it("UX H-16: un solo editor a la vez; cancelar limpia el error", async () => {
    await abrirGrupo();
    await fireEvent.press(screen.getByRole("button", { name: "Cambiar el nombre" }));
    await fireEvent.changeText(screen.getByTestId("nuevo-nombre"), " ");
    await fireEvent.press(screen.getByTestId("guardar-nombre"));
    expect(screen.getByTestId("aviso-del-grupo")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Agregar personas" }));
    expect(screen.queryByTestId("nuevo-nombre")).toBeNull();
    expect(screen.getByTestId("agregar-personas")).toBeTruthy();
    expect(screen.queryByTestId("aviso-del-grupo")).toBeNull();
    await fireEvent.press(screen.getByTestId("cancelar-agregar"));
    expect(screen.queryByTestId("agregar-personas")).toBeNull();
  });

  it("UX H-12 y H-13: «Quitar» en rojo y «Participantes (N)»", async () => {
    await abrirGrupo();
    expect(screen.getByText("Participantes (2)")).toBeTruthy();
    expect(screen.getByTestId("encabezado-participantes").props.accessibilityRole).toBe("header");
    expect(screen.getByTestId("quitar-12")).toBeTruthy();
  });

  it("UX H-01: un grupo se titula «Información del grupo»; el canal general, «Participantes»", async () => {
    await abrirGrupo();
    expect(mockNavegacion.setOptions).toHaveBeenLastCalledWith({ title: "Información del grupo" });
    chatService.conversacion.mockResolvedValueOnce({ ...GRUPO, tipo: "general", nombre: "Canal general", administra: false });
    await render(<Participantes id="1" />);
    await screen.findByText("Canal general");
    expect(mockNavegacion.setOptions).toHaveBeenLastCalledWith({ title: "Participantes" });
  });

  it("nuevo grupo: el botón dice cuántas personas lleva; en «Por área», «del área»", () => {
    expect(textoDelBotonCrear({ modo: "personas", elegidas: [] })).toBe("Crear grupo");
    expect(textoDelBotonCrear({ modo: "personas", elegidas: [LUIS] })).toBe("Crear grupo con 1 persona");
    expect(textoDelBotonCrear({ modo: "personas", elegidas: [LUIS, ANA] })).toBe("Crear grupo con 2 personas");
    expect(textoDelBotonCrear({ modo: "area", elegidas: [LUIS] })).toBe("Crear grupo del área");
  });

  it("nuevo grupo: ayuda de «Personas», borrar la búsqueda y aviso cerca del límite (H-09, H-10)", async () => {
    await render(<NuevoGrupo />);
    await screen.findByText("Luis Mora");
    expect(screen.getByTestId("buscar-personas").props.accessibilityLabel).toContain(AYUDA_PERSONAS);
    await fireEvent.changeText(screen.getByTestId("buscar-personas"), "lu");
    await fireEvent.press(screen.getByRole("button", { name: "Borrar la búsqueda" }));
    expect(screen.getByTestId("buscar-personas").props.value).toBe("");
    await fireEvent.changeText(screen.getByTestId("nombre-del-grupo"), "x".repeat(110));
    expect(screen.getByTestId("nombre-del-grupo").props.accessibilityLabel).toContain("Quedan 10 caracteres.");
    await fireEvent.press(await screen.findByRole("button", { name: /^Agregar a Luis Mora/ }));
    expect(screen.getByTestId("crear-grupo")).toHaveTextContent(/Crear grupo con 1 persona/);
  });

  it("nuevo grupo «Por área»: avisa de las elegidas que no se usan y, sin áreas, no envía (H-07, H-08)", async () => {
    mockSesion.usuario = { id: 9, permissions: ["chat.grupos_por_area"] };
    chatService.areas.mockResolvedValue([]);
    await render(<NuevoGrupo />);
    await screen.findByText("Luis Mora");
    await fireEvent.press(screen.getByRole("button", { name: /^Agregar a Luis Mora/ }));
    await fireEvent.changeText(screen.getByTestId("nombre-del-grupo"), "Cartera");
    await fireEvent.press(screen.getByRole("radio", { name: "Por área" }));
    expect(await screen.findByText(TEXTO_SIN_AREAS)).toBeTruthy();
    expect(screen.getByText("La persona elegida no se usará: en un grupo por área los miembros los da el área.")).toBeTruthy();
    const boton = screen.getByTestId("crear-grupo");
    expect(boton).toHaveTextContent(/Crear grupo del área/);
    expect(boton.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(boton);
    expect(chatService.crearGrupo).not.toHaveBeenCalled();
  });

  it("nuevo grupo: al crear lo anuncia (H-11)", async () => {
    chatService.crearGrupo.mockResolvedValueOnce({ id: 30, nombre: "Equipo TI" });
    await render(<NuevoGrupo />);
    await screen.findByText("Luis Mora");
    await fireEvent.changeText(screen.getByTestId("nombre-del-grupo"), "Equipo TI");
    await fireEvent.press(screen.getByRole("button", { name: /^Agregar a Luis Mora/ }));
    await fireEvent.press(screen.getByTestId("crear-grupo"));
    await waitFor(() => expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Se creó el grupo Equipo TI."));
  });
});
