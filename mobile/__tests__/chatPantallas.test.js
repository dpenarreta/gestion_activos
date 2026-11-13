import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { AccessibilityInfo, AppState } from "react-native";

import { chatService, directorioService, reemplazoService } from "../src/api/servicios";
import { ChatProvider } from "../src/chat/ChatContext";
import { escucharMiEstado } from "../src/chat/miEstado";
import { iniciales } from "../src/chat/formato";
import { ListaChats, TEXTO_GRUPOS_EN_LA_WEB } from "../src/pantallas/chat/ListaChats";
import { TEXTO_HAY_MAS } from "../src/utils/busqueda";
import { MiEstado, TEXTO_GUARDADO } from "../src/pantallas/chat/MiEstado";
import { ESPERA_BUSCAR_MS, NuevoMensaje } from "../src/pantallas/chat/NuevoMensaje";
import { Participantes, textoGestionEnLaWeb } from "../src/pantallas/chat/Participantes";

/**
 * Las pantallas del chat fuera de la conversación (US-011): la pestaña
 * «Chat» (CA-1, CA-14), «Nuevo mensaje» (CA-5), los participantes de un grupo
 * (CA-6, CA-8) y «Mi estado» (CA-8). La consulta periódica y la insignia
 * están en `chatContexto.test.js`; la conversación, en
 * `chatConversacion.test.js`.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

const mockSesion = { versionEmpresa: 0, empresaActiva: { id: 1 } };
jest.mock("../src/sesion/SesionContext", () => ({
  useSesion: () => mockSesion,
}));

jest.mock("../src/api/servicios", () => ({
  chatService: {
    conversaciones: jest.fn(),
    conversacion: jest.fn(),
    directa: jest.fn(),
    novedades: jest.fn(),
    presencia: jest.fn(),
    miEstado: jest.fn(),
    guardarEstado: jest.fn(),
  },
  directorioService: { buscar: jest.fn() },
  reemplazoService: { obtener: jest.fn(), guardar: jest.fn() },
}));

const CARLA = { id: 9, nombre: "Carla Ruiz", correo: "carla@grupolaar.com", area: "Cartera", cargo: "Analista" };
const LUIS = { id: 12, nombre: "Luis Mora", correo: "luis@grupolaar.com", area: "TI", cargo: "Soporte" };

/** Con la forma real de `views.resumen`. */
const CONVERSACIONES = [
  {
    id: 1,
    tipo: "general",
    nombre: "Canal general",
    otro: null,
    departamento: null,
    miembros: 40,
    administra: false,
    no_leidos: 0,
    ultimo: null,
  },
  {
    id: 5,
    tipo: "directa",
    nombre: "Carla Ruiz",
    otro: CARLA,
    departamento: null,
    miembros: 2,
    administra: false,
    no_leidos: 1,
    ultimo: { texto: "Hola", autor: "Ana Pérez", propio: true, fecha: "2026-11-12T14:00:00Z" },
  },
];

/** Con la forma real de `estados.mio`. */
const MI_ESTADO = {
  estado: "disponible",
  mensaje: "",
  hasta: null,
  vacaciones_desde: null,
  vacaciones_hasta: null,
  mensaje_vacaciones: "",
  almuerzo_inicio: "",
  almuerzo_minutos: 60,
  vigente: null,
  vacaciones_sugeridas: null,
};

function pendiente() {
  let resolver;
  let rechazar;
  const promesa = new Promise((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

function errorDeRed() {
  const error = new Error("red");
  error.esDeRed = true;
  return error;
}

function error400(details, message = "Error en la solicitud.") {
  const error = new Error(message);
  error.response = { status: 400, data: { error: { code: "invalid", message, details } } };
  return error;
}

/**
 * Toques sin esperar a lo que devuelve el manejador: `fireEvent` espera la
 * promesa que devuelve `onPress` (aquí, una petición que se deja pendiente a
 * propósito) y no terminaría. Se llama el `onPress` del componente dentro de
 * un solo `act`; varios elementos, como toques antes de que React vuelva a
 * pintar.
 */
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

let anuncios;

beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: jest.fn() }));
  anuncios = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  chatService.conversaciones.mockResolvedValue(CONVERSACIONES);
  chatService.novedades.mockResolvedValue({ cursor: 100, mensajes: [], no_leidos: { 5: 1 }, total_no_leidos: 1 });
  chatService.presencia.mockResolvedValue({});
  chatService.miEstado.mockResolvedValue(MI_ESTADO);
  chatService.guardarEstado.mockImplementation(async (cambios) => ({ ...MI_ESTADO, ...cambios }));
  directorioService.buscar.mockResolvedValue([CARLA, LUIS]);
  reemplazoService.obtener.mockResolvedValue({ modo: "jefe", persona: null, jefe: { id: 3, nombre: "Pedro León" } });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function textosAnunciados() {
  return anuncios.mock.calls.map(([texto]) => texto);
}

describe("pestaña «Chat» (CA-1, CA-14)", () => {
  it("mientras carga lo dice", async () => {
    chatService.conversaciones.mockReturnValueOnce(new Promise(() => {}));
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    expect(screen.getByText("Cargando conversaciones…")).toBeTruthy();
    expect(screen.queryByText(TEXTO_GRUPOS_EN_LA_WEB)).toBeNull();
  });

  it("sin conversaciones lo dice", async () => {
    chatService.conversaciones.mockResolvedValueOnce([]);
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    expect(await screen.findByText("Todavía no tiene conversaciones.")).toBeTruthy();
    // «Nuevo mensaje» sigue a mano para empezar una.
    expect(screen.getByTestId("nuevo-mensaje")).toBeTruthy();
  });

  it("si falla la carga ofrece «Reintentar» con el mensaje del error", async () => {
    chatService.conversaciones.mockRejectedValueOnce(errorDeRed());
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Canal general")).toBeTruthy();
  });

  it("el último mensaje propio dice «Usted» y el canal general sin mensajes, «Toda la empresa»", async () => {
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    expect(await screen.findByText("Usted: Hola")).toBeTruthy();
    expect(screen.getByText("Toda la empresa")).toBeTruthy();
    expect(screen.getByLabelText("1 mensaje sin leer")).toBeTruthy();
  });

  it("si un refresco falla con la lista ya cargada, la conserva", async () => {
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    await screen.findByText("Canal general");
    chatService.conversaciones.mockRejectedValueOnce(errorDeRed());
    await act(async () => {
      await screen.getByTestId("lista-chats").props.refreshControl.props.onRefresh();
    });
    expect(screen.getByText("Canal general")).toBeTruthy();
  });

  it("crear un grupo se ofrece en el navegador, en la empresa activa (CA-6)", async () => {
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    expect(await screen.findByText(TEXTO_GRUPOS_EN_LA_WEB)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Crear un grupo. Abrir en el navegador" }));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/chat\?empresa=1$/));
  });

  it("si el navegador no abre, lo dice en la pantalla", async () => {
    Linking.openURL.mockRejectedValueOnce(new Error("sin navegador"));
    const WebBrowser = require("expo-web-browser");
    WebBrowser.openBrowserAsync.mockRejectedValueOnce(new Error("sin navegador"));
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    await fireEvent.press(await screen.findByRole("button", { name: "Crear un grupo. Abrir en el navegador" }));
    expect(await screen.findByText("No se pudo abrir el navegador del teléfono. Intente de nuevo.")).toBeTruthy();
  });

  it("filas con avatar: iniciales en un directo, ícono en el canal; «Nuevo mensaje» flotante (H-08)", async () => {
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    await screen.findByText("Usted: Hola");
    expect(screen.getByText("CR")).toBeTruthy();
    expect(iniciales("Carla Ruiz")).toBe("CR");
    expect(iniciales("Soporte")).toBe("SO");
    expect(iniciales("")).toBe("?");
    const flotante = screen.getByTestId("nuevo-mensaje");
    expect(flotante.props.accessibilityLabel).toBe("Nuevo mensaje");
    expect(flotante.props.accessibilityHint).toBe("Busca a una persona para escribirle");
    await fireEvent.press(flotante);
    expect(mockRouter.push).toHaveBeenCalledWith("/chat/nuevo");
  });

  it("muestra «Mi estado» y lo abre (CA-8)", async () => {
    chatService.miEstado.mockResolvedValue({
      ...MI_ESTADO,
      estado: "almuerzo",
      vigente: { clave: "almuerzo", texto: "Almuerzo", detalle: "En almuerzo hasta las 13:30", mensaje: "", reemplazo: null },
    });
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    const resumen = await screen.findByTestId("resumen-mi-estado");
    await waitFor(() =>
      expect(screen.getByTestId("resumen-mi-estado").props.accessibilityLabel).toBe(
        "Mi estado en el chat: Almuerzo. En almuerzo hasta las 13:30",
      ),
    );
    await fireEvent.press(resumen);
    expect(mockRouter.push).toHaveBeenCalledWith("/chat/mi-estado");
  });
});

describe("nuevo mensaje (CA-5)", () => {
  it("lista el directorio, busca con una pausa y anuncia cuántos hay", async () => {
    await render(<NuevoMensaje />);
    expect(await screen.findByText("Carla Ruiz")).toBeTruthy();
    expect(directorioService.buscar).toHaveBeenCalledWith("");
    expect(screen.getByText("Analista · Cartera")).toBeTruthy();

    directorioService.buscar.mockResolvedValueOnce([CARLA]);
    jest.useFakeTimers();
    await fireEvent.changeText(screen.getByTestId("buscar-persona"), "car");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ESPERA_BUSCAR_MS - 50);
    });
    expect(directorioService.buscar).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50);
    });
    expect(directorioService.buscar).toHaveBeenLastCalledWith("car");
    expect(screen.queryByText("Luis Mora")).toBeNull();
    expect(textosAnunciados()).toContain("Una persona encontrada.");
  });

  it("muestra como mucho 8 personas y pide afinar la búsqueda (H-05)", async () => {
    const muchas = Array.from({ length: 11 }, (_, i) => ({ ...LUIS, id: 100 + i, nombre: `Persona ${i + 1}` }));
    directorioService.buscar.mockResolvedValue(muchas);
    await render(<NuevoMensaje />);
    expect(await screen.findByText("Persona 1")).toBeTruthy();
    expect(screen.getByText("Persona 8")).toBeTruthy();
    expect(screen.queryByText("Persona 9")).toBeNull();
    expect(screen.getByTestId("hay-mas")).toHaveTextContent("Hay más coincidencias: escriba más del nombre.");
  });

  it("si nadie coincide lo dice", async () => {
    await render(<NuevoMensaje />);
    await screen.findByText("Carla Ruiz");
    directorioService.buscar.mockResolvedValueOnce([]);
    await fireEvent.changeText(screen.getByTestId("buscar-persona"), "xyz");
    expect(await screen.findByText("Nadie coincide con «xyz».")).toBeTruthy();
  });

  it("si la búsqueda falla ofrece «Reintentar»", async () => {
    directorioService.buscar.mockRejectedValueOnce(errorDeRed());
    await render(<NuevoMensaje />);
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Carla Ruiz")).toBeTruthy();
    expect(directorioService.buscar).toHaveBeenCalledTimes(2);
  });

  it("al elegir a alguien abre (o crea) el directo una sola vez y refresca la lista", async () => {
    const espera = pendiente();
    chatService.directa.mockReturnValueOnce(espera.promesa);
    await render(
      <ChatProvider>
        <NuevoMensaje />
      </ChatProvider>,
    );
    const carla = await screen.findByTestId("persona-9");
    // Dos toques seguidos y otro a otra persona, antes de que React pinte.
    await tocarSinEsperar(carla, carla, screen.getByTestId("persona-12"));
    expect(chatService.directa).toHaveBeenCalledTimes(1);
    expect(chatService.directa).toHaveBeenCalledWith(9);
    expect(screen.getByTestId("persona-9").props.accessibilityState).toMatchObject({ disabled: true, busy: true });

    const listas = chatService.conversaciones.mock.calls.length;
    await act(async () => espera.resolver(CONVERSACIONES[1]));
    expect(mockRouter.replace).toHaveBeenCalledWith("/chat/conversacion/5");
    expect(chatService.conversaciones.mock.calls.length).toBe(listas + 1);
  });

  it("si no se puede abrir el directo lo dice y deja elegir de nuevo", async () => {
    chatService.directa.mockRejectedValueOnce(errorDeRed());
    await render(<NuevoMensaje />);
    await fireEvent.press(await screen.findByTestId("persona-9"));
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId("persona-9").props.accessibilityState).toMatchObject({ disabled: false });
  });

  it("muestra la presencia de cada persona con texto (CA-8)", async () => {
    chatService.presencia.mockResolvedValue({
      9: { en_linea: true, ultima_conexion: null, estado: null },
      12: { en_linea: false, ultima_conexion: null, estado: null },
    });
    await render(<NuevoMensaje />);
    await screen.findByText("Carla Ruiz");
    await waitFor(() => expect(screen.getByTestId("persona-9").props.accessibilityLabel).toBe("Carla Ruiz. En línea. Analista. Cartera"));
    expect(screen.getByTestId("persona-12").props.accessibilityLabel).toBe("Luis Mora. Sin conexiones. Soporte. TI");
  });
});

describe("participantes (CA-6, CA-8)", () => {
  const GRUPO = {
    ...CONVERSACIONES[0],
    id: 7,
    tipo: "grupo",
    nombre: "Equipo TI",
    miembros: 2,
    administra: true,
    participantes: [
      { ...CARLA, administra: true },
      { ...LUIS, administra: false },
    ],
  };

  it("mientras carga lo dice; luego lista a cada uno con su presencia y quién administra", async () => {
    const espera = pendiente();
    chatService.conversacion.mockReturnValueOnce(espera.promesa);
    chatService.presencia.mockResolvedValue({
      9: {
        en_linea: true,
        ultima_conexion: null,
        estado: { clave: "reunion", texto: "En reunión", detalle: "En reunión hasta las 15:00", mensaje: "", reemplazo: null },
      },
    });
    await render(<Participantes id="7" />);
    expect(screen.getByText("Cargando participantes…")).toBeTruthy();
    await act(async () => espera.resolver(GRUPO));

    expect(chatService.conversacion).toHaveBeenCalledWith("7", {});
    expect(screen.getByText("Equipo TI")).toBeTruthy();
    expect(screen.getByText("Grupo · 2 participantes")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("participante-9").props.accessibilityLabel).toBe(
        "Carla Ruiz. Administra el grupo. Analista · Cartera. En reunión hasta las 15:00",
      ),
    );
    expect(chatService.presencia).toHaveBeenCalledWith(["12", "9"]);
    expect(screen.getByTestId("participante-12").props.accessibilityLabel).toBe("Luis Mora. Soporte · TI");
  });

  it("editar o salir del grupo se ofrece en el navegador, en esa conversación y su empresa", async () => {
    chatService.conversacion.mockResolvedValueOnce(GRUPO);
    await render(<Participantes id="7" empresa="2" />);
    expect(await screen.findByText("Para editar el grupo o salir de él, ábralo en el navegador.")).toBeTruthy();
    expect(chatService.conversacion).toHaveBeenCalledWith("7", { empresa: "2" });
    await fireEvent.press(screen.getByTestId("gestionar-en-la-web"));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/chat\?c=7&empresa=2$/));
  });

  it("qué se ofrece en la web según el tipo y si administra", () => {
    expect(textoGestionEnLaWeb({ tipo: "grupo", administra: false })).toBe("Para salir de él, ábralo en el navegador.");
    expect(textoGestionEnLaWeb({ tipo: "area", administra: true })).toBe("Para editar el grupo, ábralo en el navegador.");
    expect(textoGestionEnLaWeb({ tipo: "area", administra: false })).toBeNull();
    expect(textoGestionEnLaWeb({ tipo: "general", administra: false })).toBeNull();
  });

  it("en el canal general no ofrece nada en la web", async () => {
    chatService.conversacion.mockResolvedValueOnce({ ...GRUPO, id: 1, tipo: "general", nombre: "Canal general", administra: false });
    await render(<Participantes id="1" />);
    expect(await screen.findByText("Canal general · 2 participantes")).toBeTruthy();
    expect(screen.queryByTestId("gestionar-en-la-web")).toBeNull();
  });

  it("si falla ofrece «Reintentar»", async () => {
    chatService.conversacion.mockRejectedValueOnce(errorDeRed()).mockResolvedValueOnce(GRUPO);
    await render(<Participantes id="7" />);
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Equipo TI")).toBeTruthy();
  });
});

describe("mi estado (CA-8)", () => {
  it("ofrece las mismas opciones que la web, con la actual marcada", async () => {
    await render(<MiEstado />);
    await screen.findByTestId("mi-estado");
    for (const nombre of ["Disponible", "Almuerzo", "En reunión", "No disponible", "Vacaciones", "Fuera de la oficina"]) {
      expect(screen.getByRole("radio", { name: nombre })).toBeTruthy();
    }
    expect(screen.getByRole("radio", { name: "Disponible" }).props.accessibilityState).toMatchObject({ checked: true });
  });

  it("mientras carga lo dice y, si falla, ofrece «Reintentar»", async () => {
    chatService.miEstado.mockRejectedValueOnce(errorDeRed());
    await render(<MiEstado />);
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeTruthy();
    const espera = pendiente();
    chatService.miEstado.mockReturnValueOnce(espera.promesa);
    await tocarSinEsperar(screen.getByRole("button", { name: "Reintentar" }));
    expect(screen.getByText("Cargando su estado…")).toBeTruthy();
    await act(async () => espera.resolver(MI_ESTADO));
    expect(screen.getByTestId("mi-estado")).toBeTruthy();
  });

  it("«En reunión» con un mensaje se guarda, se anuncia, avisa a quien lo muestra y vuelve", async () => {
    const avisados = [];
    const dejar = escucharMiEstado((d) => avisados.push(d));
    await render(<MiEstado />);
    await fireEvent.press(await screen.findByRole("radio", { name: "En reunión" }));
    expect(screen.getByRole("radio", { name: "En reunión" }).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.changeText(screen.getByTestId("estado-mensaje"), "Vuelvo a las 3");
    await fireEvent.press(screen.getByTestId("guardar-estado"));

    expect(chatService.guardarEstado).toHaveBeenCalledWith({
      estado: "reunion",
      mensaje: "Vuelvo a las 3",
      almuerzo_inicio: null,
      almuerzo_minutos: 60,
      hasta: null,
    });
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(textosAnunciados()).toContain(TEXTO_GUARDADO);
    expect(avisados).toHaveLength(1);
    expect(avisados[0].estado).toBe("reunion");
    // Quién aprueba por usted solo se pide en una ausencia.
    expect(reemplazoService.obtener).not.toHaveBeenCalled();
    dejar();
  });

  it("«Mi horario de almuerzo» viene plegado y se abre con su título (H-10)", async () => {
    await render(<MiEstado />);
    const titulo = await screen.findByTestId("almuerzo-plegable");
    expect(titulo.props.accessibilityRole).toBe("button");
    expect(titulo.props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByTestId("almuerzo-minutos")).toBeNull();
    await fireEvent.press(titulo);
    expect(screen.getByTestId("almuerzo-plegable").props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByTestId("almuerzo-minutos")).toBeTruthy();
  });

  it("al elegir «Almuerzo», o si ya está en almuerzo, el horario se abre", async () => {
    await render(<MiEstado />);
    await fireEvent.press(await screen.findByRole("radio", { name: "Almuerzo" }));
    expect(screen.getByTestId("almuerzo-minutos")).toBeTruthy();
  });

  it("abre en almuerzo con el horario a la vista", async () => {
    chatService.miEstado.mockResolvedValueOnce({ ...MI_ESTADO, estado: "almuerzo", almuerzo_inicio: "13:00" });
    await render(<MiEstado />);
    expect(await screen.findByTestId("almuerzo-minutos")).toBeTruthy();
  });

  it("valida los minutos de almuerzo antes de enviar y, si estaba plegado, lo abre", async () => {
    await render(<MiEstado />);
    await fireEvent.press(await screen.findByTestId("almuerzo-plegable"));
    await fireEvent.changeText(screen.getByTestId("almuerzo-minutos"), "5");
    await fireEvent.press(screen.getByTestId("almuerzo-plegable"));
    expect(screen.queryByTestId("almuerzo-minutos")).toBeNull();
    await fireEvent.press(screen.getByTestId("guardar-estado"));
    expect(await screen.findByText("El almuerzo dura entre 10 y 180 minutos.")).toBeTruthy();
    expect(screen.getByTestId("almuerzo-minutos")).toBeTruthy();
    expect(screen.getByText("Revise los campos marcados.")).toBeTruthy();
    expect(chatService.guardarEstado).not.toHaveBeenCalled();
  });

  it("«Fuera de la oficina» exige el último día y pide quién aprueba por usted", async () => {
    await render(<MiEstado />);
    await fireEvent.press(await screen.findByRole("radio", { name: "Fuera de la oficina" }));
    await waitFor(() => expect(reemplazoService.obtener).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId("guardar-estado"));
    expect(await screen.findByText("Revise los campos marcados.")).toBeTruthy();
    // El error del campo se oye con el propio selector.
    expect(screen.getByTestId("fuera-regreso").props.accessibilityLabel).toBe(
      "Último día fuera de la oficina (obligatorio): sin elegir. Error: Indique hasta cuándo estará fuera de la oficina.",
    );
    expect(chatService.guardarEstado).not.toHaveBeenCalled();
  });

  it("muestra los errores del servidor por campo (abriendo el almuerzo) y no vuelve", async () => {
    chatService.guardarEstado.mockRejectedValueOnce(error400({ almuerzo_minutos: ["Debe estar entre 10 y 180."] }));
    await render(<MiEstado />);
    await fireEvent.press(await screen.findByTestId("guardar-estado"));
    expect(await screen.findByText("Revise los campos marcados.")).toBeTruthy();
    expect(screen.getByText("Debe estar entre 10 y 180.")).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it("con vacaciones guardadas abre en ellas si rigen y permite quitarlas", async () => {
    chatService.miEstado.mockResolvedValueOnce({
      ...MI_ESTADO,
      estado: "vacaciones",
      vacaciones_desde: "2026-11-10",
      vacaciones_hasta: "2026-11-20",
      mensaje_vacaciones: "Escriba a Pedro",
      vigente: {
        clave: "vacaciones",
        texto: "Vacaciones",
        detalle: "De vacaciones hasta el 20/11/2026",
        mensaje: "Escriba a Pedro",
        reemplazo: null,
      },
    });
    await render(<MiEstado />);
    expect(await screen.findByText("Ahora: De vacaciones hasta el 20/11/2026.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Vacaciones" }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("estado-mensaje").props.value).toBe("Escriba a Pedro");
    await fireEvent.press(screen.getByTestId("quitar-vacaciones"));
    expect(chatService.guardarEstado).toHaveBeenCalledWith({ quitar_vacaciones: true });
  });

  it("no repite «Cancelar»: se vuelve con la cabecera (H-16)", async () => {
    await render(<MiEstado />);
    await screen.findByTestId("guardar-estado");
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  });
});

describe("correcciones de la ronda 1 de QA", () => {
  const { Dimensions, ScrollView, StyleSheet } = require("react-native");
  const ventana = Dimensions.get("window");
  const pantalla = Dimensions.get("screen");

  /** El tamaño de letra del sistema (en Jest, por defecto, 2). */
  async function conLetra(escala) {
    await act(async () => {
      Dimensions.set({ window: { ...ventana, fontScale: escala }, screen: { ...pantalla, fontScale: escala } });
    });
  }

  afterEach(async () => {
    await conLetra(ventana.fontScale);
  });

  it("N-01: con la letra al 200 % la hora baja bajo el mensaje; con letra normal va a la derecha", async () => {
    await conLetra(2);
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    await screen.findByText("Usted: Hola");
    // Debajo: la hora está en la misma columna que el último mensaje.
    const columna = screen.getByText("Usted: Hola").parent;
    expect(within(columna).getByTestId("hora-5")).toBeTruthy();
    // Las iniciales no crecen más de 1,3 veces.
    expect(screen.getByText("CR").props.maxFontSizeMultiplier).toBe(1.3);

    await conLetra(1);
    expect(within(screen.getByText("Usted: Hola").parent).queryByTestId("hora-5")).toBeNull();
    expect(screen.getByTestId("hora-5")).toBeTruthy();
  });

  it("N-01: la insignia de no leídos no tiene alto fijo", async () => {
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    const insignia = await screen.findByLabelText("1 mensaje sin leer");
    expect(StyleSheet.flatten(insignia.props.style).height).toBeUndefined();
  });

  it("N-13: el botón flotante va antes de la lista para el lector; B7: dos toques abren una sola pantalla", async () => {
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    await screen.findByText("Usted: Hola");
    expect(screen.getAllByRole("button")[0]).toHaveProp("accessibilityLabel", "Nuevo mensaje");
    await fireEvent.press(screen.getByTestId("nuevo-mensaje"));
    await fireEvent.press(screen.getByTestId("nuevo-mensaje"));
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith("/chat/nuevo");
  });

  it("B7: con exactamente 8 personas no pide afinar", async () => {
    const ocho = Array.from({ length: 8 }, (_, i) => ({ ...LUIS, id: 200 + i, nombre: `Persona ${i + 1}` }));
    directorioService.buscar.mockResolvedValue(ocho);
    await render(<NuevoMensaje />);
    expect(await screen.findByText("Persona 8")).toBeTruthy();
    expect(screen.queryByTestId("hay-mas")).toBeNull();
  });

  it("B7: al buscar con más de 8 anuncia cuántas hay y cuántas se muestran", async () => {
    const muchas = Array.from({ length: 12 }, (_, i) => ({ ...LUIS, id: 300 + i, nombre: `Carla ${i + 1}` }));
    await render(<NuevoMensaje />);
    await screen.findByText("Carla Ruiz");
    directorioService.buscar.mockResolvedValue(muchas);
    await fireEvent.changeText(screen.getByTestId("buscar-persona"), "car");
    await waitFor(() =>
      expect(textosAnunciados()).toContain(`12 personas encontradas; se muestran 8. ${TEXTO_HAY_MAS}`),
    );
    expect(screen.getByTestId("hay-mas")).toBeTruthy();
  });

  it("N-12: el avatar de «Nuevo mensaje» lleva las iniciales, como la lista", async () => {
    await render(<NuevoMensaje />);
    await screen.findByText("Carla Ruiz");
    expect(screen.getByText("CR")).toBeTruthy();
    expect(screen.getByText("LM")).toBeTruthy();
  });

  it("R-02: «Mi horario de almuerzo» es un encabezado visible y, debajo, el botón que lo abre", async () => {
    await render(<MiEstado />);
    expect(await screen.findByRole("header", { name: "Mi horario de almuerzo" })).toBeTruthy();
    const boton = screen.getByRole("button", { name: "Ver o cambiar el horario" });
    expect(boton.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(boton);
    const ocultar = screen.getByRole("button", { name: "Ocultar el horario" });
    expect(ocultar.props.accessibilityState).toMatchObject({ expanded: true });
  });

  it("N-06: con un error en los minutos lleva la pantalla al almuerzo, después de abrirlo", async () => {
    const desplazar = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    await render(<MiEstado />);
    await fireEvent.press(await screen.findByTestId("almuerzo-plegable"));
    await fireEvent.changeText(screen.getByTestId("almuerzo-minutos"), "5");
    const Y = 900;
    await fireEvent(screen.getByTestId("bloque-almuerzo"), "layout", {
      nativeEvent: { layout: { x: 0, y: Y, width: 360, height: 200 } },
    });
    await fireEvent.press(screen.getByTestId("guardar-estado"));
    // Hacia la posición medida del bloque (con un pequeño margen arriba).
    await waitFor(() => expect(desplazar).toHaveBeenCalled());
    const { y } = desplazar.mock.calls.at(-1)[0];
    expect(y).toBeGreaterThan(Y - 50);
    expect(y).toBeLessThanOrEqual(Y);
  });

  it("R-03: con un error en los minutos, el foco del lector va a ese campo", async () => {
    const { AccessibilityInfo } = require("react-native");
    const foco = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
    await render(<MiEstado />);
    await fireEvent.press(await screen.findByTestId("almuerzo-plegable"));
    await fireEvent.changeText(screen.getByTestId("almuerzo-minutos"), "5");
    await fireEvent.press(screen.getByTestId("guardar-estado"));
    await waitFor(() => expect(foco).toHaveBeenCalled(), { timeout: 3000 });
    const [nodo, evento] = foco.mock.calls.at(-1);
    expect(evento).toBe("focus");
    // El campo de los minutos, no el contenedor del bloque.
    expect(nodo.props.testID).toBe("almuerzo-minutos");
  });
});

describe("useIrAlBloque (ronda 2: O1 y R-03)", () => {
  const { AccessibilityInfo } = require("react-native");
  const { renderHook } = require("@testing-library/react-native");
  const { useIrAlBloque } = require("../src/accesibilidad/irAlBloque");

  it("bloque() y refFoco() devuelven lo mismo en cada render", async () => {
    const desplazable = { current: { scrollTo: jest.fn() } };
    const { result, rerender } = await renderHook(() => useIrAlBloque(desplazable));
    const bloque = result.current.bloque("motivo");
    const ref = result.current.refFoco("motivo");
    await rerender();
    expect(result.current.bloque("motivo")).toBe(bloque);
    expect(result.current.refFoco("motivo")).toBe(ref);
    expect(result.current.bloque("otro")).not.toBe(bloque);
  });

  it("sin un control enfocable, solo desplaza", async () => {
    const foco = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
    const desplazable = { current: { scrollTo: jest.fn() } };
    const { result } = await renderHook(() => useIrAlBloque(desplazable));
    result.current.bloque("motivo").onLayout({ nativeEvent: { layout: { y: 400 } } });
    await act(async () => result.current.irA("motivo"));
    await waitFor(() => expect(desplazable.current.scrollTo).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });
    expect(foco).not.toHaveBeenCalled();
  });

  it("con control, el foco llega tras la espera de la plataforma y no antes", async () => {
    jest.useFakeTimers();
    const { Platform } = require("react-native");
    const { ESPERA_FOCO_ANDROID_MS, ESPERA_FOCO_IOS_MS } = require("../src/accesibilidad/irAlBloque");
    const foco = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
    const desplazable = { current: { scrollTo: jest.fn() } };
    const { result } = await renderHook(() => useIrAlBloque(desplazable));
    const campo = { props: { testID: "motivo" } };
    result.current.refFoco("motivo")(campo);
    await act(async () => result.current.irA("motivo"));
    const espera = Platform.OS === "android" ? ESPERA_FOCO_ANDROID_MS : ESPERA_FOCO_IOS_MS;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(espera - 50);
    });
    expect(foco).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(foco).toHaveBeenCalledWith(campo, "focus");
  });

  it("si el lector falla, no pasa nada", async () => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {
      throw new Error("sin lector");
    });
    const desplazable = { current: { scrollTo: jest.fn() } };
    const { result } = await renderHook(() => useIrAlBloque(desplazable));
    result.current.refFoco("motivo")({ props: {} });
    await act(async () => result.current.irA("motivo"));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(desplazable.current.scrollTo).toHaveBeenCalled();
  });
});

describe("useMedianoche (O3)", () => {
  const { renderHook } = require("@testing-library/react-native");
  const { msHastaMedianoche, useMedianoche } = require("../src/utils/useMedianoche");

  it("sube a las 00:00:05, se vuelve a programar y se limpia al desmontar", async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 12, 23, 59, 0) });
    expect(msHastaMedianoche(new Date(2026, 10, 12, 23, 59, 0))).toBe(65_000);
    const { result, unmount } = await renderHook(() => useMedianoche());
    expect(result.current).toBe(0);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(64_000);
    });
    expect(result.current).toBe(0);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current).toBe(1);
    // La noche siguiente, otra vez.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(24 * 3600_000);
    });
    expect(result.current).toBe(2);
    // Al desmontar se cancela justo el temporizador de la próxima medianoche
    // (el entorno de pruebas programa otros, por eso no se cuentan).
    const programar = jest.spyOn(global, "setTimeout");
    const cancelar = jest.spyOn(global, "clearTimeout");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(24 * 3600_000);
    });
    expect(result.current).toBe(3);
    const llamada = programar.mock.calls.findIndex(([, ms]) => ms === 24 * 3600_000);
    expect(llamada).toBeGreaterThanOrEqual(0);
    const suyo = programar.mock.results[llamada].value;
    await unmount();
    expect(cancelar).toHaveBeenCalledWith(suyo);
  });
});
