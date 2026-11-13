import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { AccessibilityInfo, Keyboard, Platform, ScrollView, StyleSheet } from "react-native";

import { bordesOcultos, FilaDeslizable } from "../src/componentes/FilaDeslizable";
import {
  abrirFuncionalidad,
  abrirModulo,
  olvidarPantallas,
  recordarPantalla,
  volverAlModulo,
} from "../src/navegacion/abrir";
import { BarraDeFuncionalidades, navegacionActiva } from "../src/navegacion/BarraDeFuncionalidades";
import { CabeceraDeModulos, nombreDeLaCampana, NOMBRE_DE_CUENTA } from "../src/navegacion/CabeceraDeModulos";
import { ProveedorDeModulos, PublicarEstadoDeModulos, SoloConFoco } from "../src/navegacion/EstadoDeModulos";
import { useAlturaCabecera } from "../src/navegador/alturaCabecera";
import {
  esRutaDeModulo,
  funcionalidadesVisibles,
  MODULOS,
  moduloDePantalla,
  moduloPorId,
  modulosVisibles,
  nombreAccesible,
  nombreAccesibleDelModulo,
  vistaActiva,
  vistasDelEstado,
} from "../src/navegacion/modulos";

const mockRouter = { push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() };
const mockFoco = { valor: true };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, useIsFocused: () => mockFoco.valor }));

/** Lo que capturan las pestañas de `(tabs)/_layout.js`. Pintan la `tabBar`
 * con `propsDeTabBar` (las props reales de expo-router 58). */
const mockTabs = { props: null, pantallas: [], propsDeTabBar: null };
jest.mock("expo-router/js-tabs", () => {
  const React = require("react");
  function Tabs({ children, ...props }) {
    mockTabs.props = props;
    return React.createElement(
      React.Fragment,
      null,
      mockTabs.propsDeTabBar ? props.tabBar(mockTabs.propsDeTabBar) : null,
      children,
    );
  }
  Tabs.Screen = function Pantalla({ name, options }) {
    mockTabs.pantallas.push({ name, options });
    return null;
  };
  return { Tabs };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

const mockSesion = { usuario: { permissions: [] } };
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));
const mockContador = { noLeidas: 0 };
jest.mock("../src/notificaciones/ContadorContext", () => ({ useContador: () => mockContador }));
const mockLicencias = { porAprobar: 0, puedeSolicitar: true, cargado: true };
jest.mock("../src/permisos/ResumenPermisosContext", () => ({ useResumenPermisos: () => mockLicencias }));
const mockChat = { totalNoLeidos: 0 };
jest.mock("../src/chat/ChatContext", () => ({ useTotalNoLeidos: () => mockChat.totalNoLeidos }));
const mockSoporte = { delEquipo: false, noEsDelEquipo: false, misPendientes: 0, asignados: 0, aprobaciones: 0 };
jest.mock("../src/soporte/ResumenSoporteContext", () => ({ useResumenSoporte: () => mockSoporte }));

/** Un `contexto` del catálogo, con lo de una persona sin nada especial. */
function contexto(cambios = {}) {
  return {
    permisos: [],
    licencias: { porAprobar: 0, puedeSolicitar: true, cargado: true },
    chat: { totalNoLeidos: 0 },
    soporte: { delEquipo: false, noEsDelEquipo: false, misPendientes: 0, asignados: 0, aprobaciones: 0 },
    vistas: {},
    ...cambios,
  };
}

const ids = (lista) => lista.map((x) => x.id);

function idsDe(modulo, c) {
  return ids(funcionalidadesVisibles(moduloPorId(modulo), c));
}

beforeEach(() => {
  jest.clearAllMocks();
  olvidarPantallas();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  mockSesion.usuario = { permissions: [] };
  mockContador.noLeidas = 0;
  Object.assign(mockLicencias, { porAprobar: 0, puedeSolicitar: true, cargado: true });
  mockChat.totalNoLeidos = 0;
  Object.assign(mockSoporte, {
    delEquipo: false,
    noEsDelEquipo: false,
    misPendientes: 0,
    asignados: 0,
    aprobaciones: 0,
  });
});

describe("el catálogo de módulos (US-016, estructura de la ronda 1)", () => {
  it("CA-1: Institucional · Chat · Mesa de ayuda; el Inicio es de Institucional", () => {
    expect(MODULOS.map((m) => m.texto)).toEqual(["Institucional", "Chat", "Mesa de ayuda"]);
    expect(MODULOS.map((m) => m.pantallas)).toEqual([["index", "permisos"], ["chat"], ["soporte"]]);
    expect(moduloDePantalla("index").id).toBe("institucional");
    expect(moduloDePantalla("permisos").id).toBe("institucional");
    expect(moduloDePantalla("soporte").id).toBe("mesa");
    expect(moduloDePantalla("otra")).toBeNull();
  });

  it("CA-3: cada módulo trae sus funcionalidades en el orden que pidió el usuario", () => {
    const todo = contexto({
      permisos: ["soporte.crear", "soporte.registrar", "licencias.ver_por_aprobar"],
      soporte: { delEquipo: true, aprobaciones: 1 },
    });
    expect(idsDe("institucional", todo)).toEqual(["inicio", "mias", "por_aprobar", "vacaciones"]);
    expect(idsDe("chat", todo)).toEqual(["conversaciones", "nuevo", "grupos", "mi_estado"]);
    expect(idsDe("mesa", todo)).toEqual(["bandeja", "mis", "aprobaciones", "nuevo", "registrar"]);
    expect(moduloPorId("institucional").funcionalidades.map((f) => f.texto)).toEqual([
      "Inicio",
      "Solicitud de permisos",
      "Por aprobar",
      "Consulta de vacaciones",
    ]);
    const acciones = MODULOS.flatMap((m) => m.funcionalidades.filter((f) => f.tipo === "accion").map((f) => f.ruta));
    expect(acciones).toEqual(["/chat/nuevo", "/chat/mi-estado", "/soporte/nuevo", "/soporte/registrar"]);
  });

  it("CA-6: quien no aprueba ni es del equipo no ve «Por aprobar», «Bandeja», «Aprobaciones» ni «Registrar»", () => {
    const c = contexto();
    expect(idsDe("institucional", c)).toEqual(["inicio", "mias", "vacaciones"]);
    expect(idsDe("mesa", c)).toEqual(["mis"]);
  });

  it("CA-6: «Por aprobar» con algo pendiente, con licencias.ver_por_aprobar o si un aviso lleva a ella", () => {
    expect(idsDe("institucional", contexto({ licencias: { porAprobar: 2, cargado: true } }))).toContain("por_aprobar");
    expect(idsDe("institucional", contexto({ permisos: ["licencias.ver_por_aprobar"] }))).toContain("por_aprobar");
    expect(idsDe("institucional", contexto({ vistas: { institucional: "por_aprobar" } }))).toContain("por_aprobar");
  });

  it("CA-6: la Bandeja según los permisos del equipo y el 403 de bandeja/", () => {
    expect(idsDe("mesa", contexto({ soporte: { delEquipo: true } }))).toContain("bandeja");
    expect(idsDe("mesa", contexto({ soporte: { delEquipo: true, noEsDelEquipo: true } }))).not.toContain("bandeja");
    // Sin el resumen todavía, los permisos de la sesión (esDelEquipo).
    expect(idsDe("mesa", { permisos: ["soporte.atender"] })).toContain("bandeja");
  });

  it("CA-6: «Nuevo ticket» con soporte.crear o soporte.mesa_crear (rutaDeAltaPropia); «Registrar» con soporte.registrar", () => {
    expect(idsDe("mesa", contexto({ permisos: ["soporte.crear"] }))).toContain("nuevo");
    expect(idsDe("mesa", contexto({ permisos: ["soporte.mesa_crear"] }))).toContain("nuevo");
    expect(idsDe("mesa", contexto({ permisos: ["soporte.registrar"], soporte: { delEquipo: true } }))).toContain(
      "registrar",
    );
    expect(
      idsDe("mesa", contexto({ permisos: ["soporte.registrar"], soporte: { delEquipo: true, noEsDelEquipo: true } })),
    ).not.toContain("registrar");
  });

  it("CA-6: «Aprobaciones» si hay alguna pendiente o si un aviso lleva a ella", () => {
    expect(idsDe("mesa", contexto({ soporte: { aprobaciones: 1 } }))).toContain("aprobaciones");
    expect(idsDe("mesa", contexto({ vistas: { mesa: "aprobaciones" } }))).toContain("aprobaciones");
  });

  it("CA-6: un módulo sin funcionalidades visibles no muestra su pestaña; uno nuevo es una entrada más", () => {
    const ficticio = {
      id: "ficticio",
      texto: "Ficticio",
      icono: "file-outline",
      pantallas: ["ficticio"],
      pantalla: "ficticio",
      pathnames: ["/ficticio"],
      funcionalidades: [
        { id: "a", texto: "A", tipo: "vista", params: {}, visible: (c) => c.permisos.includes("x.ver") },
      ],
    };
    const catalogo = [...MODULOS, ficticio];
    expect(ids(modulosVisibles(contexto(), catalogo))).toEqual(["institucional", "chat", "mesa"]);
    expect(ids(modulosVisibles(contexto({ permisos: ["x.ver"] }), catalogo))).toEqual([
      "institucional",
      "chat",
      "mesa",
      "ficticio",
    ]);
    expect(moduloDePantalla("ficticio", catalogo).id).toBe("ficticio");
    expect(vistaActiva(ficticio, { name: "ficticio" }, contexto())).toBe("a");
  });

  it("CA-7: la pestaña de cada módulo suma las insignias de lo que se ve y lo dice", () => {
    const c = contexto({
      licencias: { porAprobar: 2, cargado: true },
      chat: { totalNoLeidos: 3 },
      soporte: { delEquipo: false, misPendientes: 1, asignados: 4, aprobaciones: 2 },
    });
    const modulos = Object.fromEntries(modulosVisibles(c).map((m) => [m.id, m]));
    expect(nombreAccesibleDelModulo(modulos.institucional)).toBe("Institucional, 2 por aprobar");
    expect(nombreAccesibleDelModulo(modulos.chat)).toBe("Chat, 3 sin leer");
    // Los 4 asignados no cuentan: sin ser del equipo, la Bandeja no se ve.
    expect(modulos.mesa.cuenta).toBe(3);
    expect(nombreAccesibleDelModulo(modulos.mesa)).toBe("Mesa de ayuda, 3 pendientes");
  });

  it("las funcionalidades dicen su insignia con el texto de siempre (H-22, N-02)", () => {
    const c = contexto({
      licencias: { porAprobar: 2, cargado: true },
      chat: { totalNoLeidos: 1 },
      soporte: { delEquipo: true, misPendientes: 2, asignados: 3, aprobaciones: 1 },
    });
    const nombres = [
      ...funcionalidadesVisibles(moduloPorId("institucional"), c),
      ...funcionalidadesVisibles(moduloPorId("chat"), c),
      ...funcionalidadesVisibles(moduloPorId("mesa"), c),
    ].map((f) => nombreAccesible(f, f.cuenta));
    expect(nombres).toEqual([
      "Inicio",
      "Solicitud de permisos",
      "Por aprobar, 2 por aprobar",
      "Consulta de vacaciones",
      "Conversaciones, 1 mensaje sin leer",
      "Nuevo mensaje",
      "Mis grupos",
      "Mi estado",
      "Bandeja del equipo, 3 asignados a usted",
      "Mis tickets, 2 necesitan algo de usted",
      "Aprobaciones, 1 pendiente",
    ]);
  });

  it("H-13: «Por aprobar» de permisos con el calendario; el portapapeles, solo para los tickets", () => {
    const icono = (m, f) => moduloPorId(m).funcionalidades.find((x) => x.id === f).icono;
    expect(icono("institucional", "por_aprobar")).toBe("calendar-check-outline");
    expect(icono("mesa", "aprobaciones")).toBe("clipboard-check-outline");
  });
});

describe("la vista marcada en la barra sale de la ruta (CA-8)", () => {
  const institucional = moduloPorId("institucional");
  const mesa = moduloPorId("mesa");
  const chat = moduloPorId("chat");

  it("Institucional: «/» es el Inicio (por defecto); en /permisos, ?seccion=", () => {
    expect(vistaActiva(institucional, { name: "index" }, contexto())).toBe("inicio");
    expect(vistaActiva(institucional, { name: "permisos", params: {} }, contexto())).toBe("mias");
    expect(vistaActiva(institucional, { name: "permisos", params: { seccion: "vacaciones" } }, contexto())).toBe(
      "vacaciones",
    );
    expect(vistaActiva(institucional, { name: "permisos", params: { seccion: ["por_aprobar"] } }, contexto())).toBe(
      "por_aprobar",
    );
    expect(vistaActiva(institucional, { name: "permisos", params: { seccion: "otra" } }, contexto())).toBe("mias");
  });

  it("Mesa de ayuda: ?vista=; sin ella, la Bandeja para quien la ve y «Mis tickets» para los demás", () => {
    const soporte = (params) => ({ name: "soporte", params });
    expect(vistaActiva(mesa, soporte({}), contexto())).toBe("mis");
    expect(vistaActiva(mesa, soporte({}), contexto({ soporte: { delEquipo: true } }))).toBe("bandeja");
    expect(vistaActiva(mesa, soporte({ vista: "bandeja" }), contexto())).toBe("mis");
    expect(vistaActiva(mesa, soporte({ vista: "aprobaciones" }), contexto())).toBe("aprobaciones");
    expect(vistaActiva(mesa, soporte({ vista: "mis" }), contexto({ soporte: { delEquipo: true } }))).toBe("mis");
  });

  it("Chat: /chat son las conversaciones; ?vista=grupos, «Mis grupos»", () => {
    expect(vistaActiva(chat, { name: "chat" }, contexto())).toBe("conversaciones");
    expect(vistaActiva(chat, { name: "chat", params: { vista: "grupos" } }, contexto())).toBe("grupos");
    expect(vistaActiva(chat, { name: "chat", params: { vista: "otra" } }, contexto())).toBe("conversaciones");
  });

  it("vistasDelEstado lee el parámetro de cada módulo del estado de las pestañas", () => {
    const state = {
      index: 0,
      routes: [
        { name: "index" },
        { name: "permisos", params: { seccion: "vacaciones" } },
        { name: "chat" },
        { name: "soporte", params: { vista: ["bandeja"] } },
      ],
    };
    expect(vistasDelEstado(state)).toEqual({ institucional: "vacaciones", chat: undefined, mesa: "bandeja" });
  });

  it.each([
    ["/", true],
    ["/permisos?seccion=vacaciones&n=1", true],
    ["/soporte", true],
    ["/soporte/", true],
    ["/chat", true],
    [{ pathname: "/soporte", params: { vista: "mis" } }, true],
    ["/soporte/nuevo", false],
    ["/chat/conversacion/5", false],
    ["/notificaciones", false],
    ["/cuenta", false],
    [null, false],
  ])("esRutaDeModulo(%p) es %p", (ruta, esperado) => {
    expect(esRutaDeModulo(ruta)).toBe(esperado);
  });
});

describe("abrir lo del catálogo", () => {
  it("un módulo va a su entrada (Institucional, al Inicio) y conserva su vista (merge)", () => {
    const navigation = { navigate: jest.fn() };
    abrirModulo(navigation, moduloPorId("mesa"));
    expect(navigation.navigate).toHaveBeenLastCalledWith({ name: "soporte", merge: true });
    abrirModulo(navigation, moduloPorId("institucional"));
    expect(navigation.navigate).toHaveBeenLastCalledWith({ name: "index", merge: true });
  });

  it("Institucional vuelve a la última de sus pantallas", () => {
    const navigation = { navigate: jest.fn() };
    recordarPantalla(moduloPorId("institucional"), "permisos");
    abrirModulo(navigation, moduloPorId("institucional"));
    expect(navigation.navigate).toHaveBeenLastCalledWith({ name: "permisos", merge: true });
    // Una pantalla que no es del módulo no se anota.
    recordarPantalla(moduloPorId("institucional"), "chat");
    abrirModulo(navigation, moduloPorId("institucional"));
    expect(navigation.navigate).toHaveBeenLastCalledWith({ name: "permisos", merge: true });
  });

  it("una vista va a su pantalla sin apilar; una acción abre su pantalla", () => {
    const navigation = { navigate: jest.fn() };
    const [inicio, , , vacaciones] = funcionalidadesVisibles(
      moduloPorId("institucional"),
      contexto({ vistas: { institucional: "por_aprobar" } }),
    );
    abrirFuncionalidad({ navigation, router: mockRouter, funcionalidad: vacaciones });
    expect(navigation.navigate).toHaveBeenLastCalledWith({
      name: "permisos",
      params: { seccion: "vacaciones" },
      merge: true,
    });
    abrirFuncionalidad({ navigation, router: mockRouter, funcionalidad: inicio });
    expect(navigation.navigate).toHaveBeenLastCalledWith({ name: "index", params: {}, merge: true });
    const [, nuevo] = funcionalidadesVisibles(moduloPorId("chat"), contexto());
    abrirFuncionalidad({ navigation, router: mockRouter, funcionalidad: nuevo });
    expect(mockRouter.push).toHaveBeenCalledWith("/chat/nuevo");
    expect(navigation.navigate).toHaveBeenCalledTimes(2);
  });

  it("volver a un módulo desde el Stack usa dismissTo; sin él, replace", () => {
    volverAlModulo(mockRouter, "/soporte?vista=bandeja");
    expect(mockRouter.dismissTo).toHaveBeenCalledWith("/soporte?vista=bandeja");
    const viejo = { replace: jest.fn() };
    volverAlModulo(viejo, "/chat");
    expect(viejo.replace).toHaveBeenCalledWith("/chat");
  });
});

/** EXACTAMENTE lo que `BottomTabView` de expo-router 58 pasa a `tabBar`:
 * `{ state, descriptors, emitter, navigateToTab, insets }`, sin
 * `navigation`. Cada descriptor lleva la `navigation` de su pantalla. */
function propsDeTabBar(nombre, params, insets = { bottom: 16 }) {
  const state = estadoDePestanas(nombre, params);
  const descriptors = Object.fromEntries(
    state.routes.map((r) => [
      r.key,
      { route: r, navigation: { navigate: jest.fn() }, options: {}, render: () => null },
    ]),
  );
  return {
    state,
    descriptors,
    emitter: { emit: jest.fn() },
    navigateToTab: jest.fn(),
    insets: { top: 0, left: 0, right: 0, ...insets },
  };
}

function navegacionDe(props) {
  return props.descriptors[props.state.routes[props.state.index].key].navigation;
}

function estadoDePestanas(nombre, params) {
  const routes = [
    { key: "i", name: "index" },
    { key: "p", name: "permisos" },
    { key: "c", name: "chat" },
    { key: "s", name: "soporte" },
  ];
  const index = routes.findIndex((r) => r.name === nombre);
  routes[index] = { ...routes[index], params };
  return { index, routes };
}

describe("el contrato con expo-router 58 (P1 de la ronda 1)", () => {
  const fs = require("fs");
  const path = require("path");
  const fuente = fs.readFileSync(
    path.join(__dirname, "../node_modules/expo-router/build/react-navigation/bottom-tabs/views/BottomTabView.js"),
    "utf8",
  );

  it("`tabBar` recibe state, descriptors, emitter, navigateToTab e insets, y NO `navigation`", () => {
    const llamada = /tabBar\(\{([\s\S]*?)insets:/.exec(fuente)?.[1] ?? "";
    const claves = llamada
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    expect(claves).toEqual(["state", "descriptors", "emitter", "navigateToTab"]);
    expect(llamada).not.toMatch(/navigation/);
  });

  it("`header` sí recibe la `navigation` de la pantalla (la del descriptor)", () => {
    expect(fuente).toMatch(/header: header\(\{\s*layout: dimensions,\s*route,\s*navigation: descriptor\.navigation,/);
  });

  it("la barra navega con la del descriptor de la ruta activa", () => {
    const state = estadoDePestanas("chat");
    const navegacion = { navigate: jest.fn() };
    expect(navegacionActiva(state, { c: { navigation: navegacion } })).toBe(navegacion);
    expect(navegacionActiva(undefined, {})).toBeUndefined();
  });
});

describe("la cabecera de los módulos (CA-1 y CA-5)", () => {
  /** La cabecera, una sola y fuera de las pantallas (ronda 2): el estado se
   * lo publica la `tabBar` con las props reales de expo-router 58. */
  function arbol(props) {
    return (
      <ProveedorDeModulos>
        <PublicarEstadoDeModulos state={props.state} descriptors={props.descriptors} />
        <CabeceraDeModulos />
      </ProveedorDeModulos>
    );
  }

  async function cabecera(nombre = "index", params) {
    const props = propsDeTabBar(nombre, params);
    const resultado = await render(arbol(props));
    return { navigation: navegacionDe(props), props, ...resultado };
  }

  /** La fila no es un elemento accesible (lo son sus pestañas): se busca
   * por su `testID` y se mira su rol. */
  function filaDeModulos() {
    const lista = screen.getByTestId("pestanas-de-modulos");
    expect(lista.props.accessibilityRole).toBe("tablist");
    expect(lista.props.accessibilityLabel).toBe("Módulos");
    return lista;
  }

  it("se entra por Institucional: el Inicio («/») marca su pestaña", async () => {
    await cabecera("index");
    expect(screen.getByRole("tab", { name: "Institucional", selected: true })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Inicio" })).toBeNull();
  });

  it("las pestañas de los módulos son un tablist con la activa marcada", async () => {
    await cabecera("permisos");
    const lista = filaDeModulos();
    // Se desliza de lado si no caben (CA-1, CA-10).
    expect(lista.props.horizontal).toBe(true);
    const pestanas = within(lista).getAllByRole("tab");
    expect(pestanas.map((p) => p.props.accessibilityLabel)).toEqual(["Institucional", "Chat", "Mesa de ayuda"]);
    expect(screen.getByRole("tab", { name: "Institucional", selected: true })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Chat", selected: false })).toBeTruthy();
  });

  it("la activa va en amarillo con subrayado grueso; si caben, se reparten el ancho", async () => {
    await cabecera("chat");
    const activa = StyleSheet.flatten(screen.getByTestId("modulo-chat").props.style);
    const otra = StyleSheet.flatten(screen.getByTestId("modulo-institucional").props.style);
    expect(activa.borderBottomColor).toBe("#FCE200");
    expect(activa.borderBottomWidth).toBeGreaterThanOrEqual(3);
    expect(otra.borderBottomColor).toBe("transparent");
    expect(activa.minHeight).toBeGreaterThanOrEqual(44);
    expect(otra.flexGrow).toBe(1);
    expect(StyleSheet.flatten(filaDeModulos().props.contentContainerStyle).flexGrow).toBe(1);
    // Sin `numberOfLines`: con la letra al 200 % el texto no se corta.
    const texto = within(screen.getByTestId("modulo-mesa")).getByText("Mesa de ayuda");
    expect(texto.props.numberOfLines).toBeUndefined();
  });

  it("al tocar un módulo pasa a él (con la navigation de la pantalla activa) conservando su vista", async () => {
    const { navigation } = await cabecera();
    await fireEvent.press(screen.getByRole("tab", { name: "Mesa de ayuda" }));
    expect(navigation.navigate).toHaveBeenCalledWith({ name: "soporte", merge: true });
  });

  it("CA-7: insignias en las pestañas, con el número en el nombre", async () => {
    mockLicencias.porAprobar = 2;
    mockChat.totalNoLeidos = 3;
    mockSoporte.misPendientes = 1;
    await cabecera();
    expect(screen.getByRole("tab", { name: "Institucional, 2 por aprobar" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Chat, 3 sin leer" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Mesa de ayuda, 1 pendiente" })).toBeTruthy();
  });

  it("O-2: calcula con el estado que publica la `tabBar` (el módulo y las vistas de la ruta)", async () => {
    mockSoporte.aprobaciones = 0;
    await cabecera("soporte", { vista: "aprobaciones" });
    expect(screen.getByRole("tab", { name: "Mesa de ayuda", selected: true })).toBeTruthy();
    expect(screen.getByRole("header", { name: "LAARCOURIER · Mesa de ayuda" })).toBeTruthy();
  });

  it("H-05: al cambiar de pantalla, la fila vuelve a mostrar la pestaña activa", async () => {
    const scrollTo = ScrollView.prototype.scrollTo;
    const props = propsDeTabBar("soporte");
    const { rerender } = await render(arbol(props));
    await fireEvent(screen.getByTestId("modulo-mesa"), "layout", { nativeEvent: { layout: { x: 300 } } });
    scrollTo.mockClear();
    // Otra ruta de la Mesa (otra clave): la pestaña vuelve a la vista.
    const otra = {
      ...props,
      state: {
        ...props.state,
        routes: props.state.routes.map((r) => (r.name === "soporte" ? { ...r, key: "s2" } : r)),
      },
    };
    otra.descriptors = { ...props.descriptors, s2: props.descriptors.s };
    await rerender(arbol(otra));
    expect(scrollTo).toHaveBeenCalledWith({ x: 276, animated: true });
  });

  it("mide su alto para las vistas con teclado (useAlturaCabecera)", async () => {
    let altura;
    function Lector() {
      altura = useAlturaCabecera();
      return null;
    }
    const props = propsDeTabBar("soporte");
    await render(
      <ProveedorDeModulos>
        <PublicarEstadoDeModulos state={props.state} descriptors={props.descriptors} />
        <CabeceraDeModulos />
        <Lector />
      </ProveedorDeModulos>,
    );
    expect(altura).toBe(0);
    await fireEvent(screen.getByTestId("cabecera-de-modulos"), "layout", { nativeEvent: { layout: { height: 132 } } });
    expect(altura).toBe(132);
  });

  it("CA-5: la campana con las no leídas (99+ como tope) y la Cuenta abren sus pantallas", async () => {
    mockContador.noLeidas = 120;
    await cabecera("soporte");
    const campana = screen.getByRole("button", { name: "Avisos: notificaciones, 120 sin leer" });
    expect(within(campana).getByText("99+", { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(campana);
    expect(mockRouter.push).toHaveBeenCalledWith("/notificaciones");
    await fireEvent.press(screen.getByRole("button", { name: NOMBRE_DE_CUENTA }));
    expect(mockRouter.push).toHaveBeenCalledWith("/cuenta");
    expect(nombreDeLaCampana(0)).toBe("Avisos: notificaciones");
    expect(NOMBRE_DE_CUENTA).toBe("Cuenta: empresa y cerrar sesión");
  });

  it("CA-5 y H-07: el logotipo LAARCOURIER en negativo, a 192 × 32, es el encabezado", async () => {
    await cabecera("index");
    const logo = screen.getByRole("header", { name: "LAARCOURIER · Institucional" });
    expect(StyleSheet.flatten(logo.props.style)).toMatchObject({ width: 192, height: 32 });
    await cabecera("chat");
    expect(screen.getByRole("header", { name: "LAARCOURIER · Chat" })).toBeTruthy();
  });
});

describe("la fila deslizable (H-01, H-02 y H-16)", () => {
  async function fila() {
    const ref = { current: null };
    await render(
      <FilaDeslizable ref={ref} testID="fila">
        {null}
      </FilaDeslizable>,
    );
    return ref;
  }

  it("bordesOcultos: el desvanecido solo donde queda contenido", () => {
    expect(bordesOcultos({ desplazamiento: 0, ancho: 300, contenido: 300 })).toEqual({ inicio: false, fin: false });
    expect(bordesOcultos({ desplazamiento: 0, ancho: 300, contenido: 600 })).toEqual({ inicio: false, fin: true });
    expect(bordesOcultos({ desplazamiento: 150, ancho: 300, contenido: 600 })).toEqual({ inicio: true, fin: true });
    expect(bordesOcultos({ desplazamiento: 300, ancho: 300, contenido: 600 })).toEqual({ inicio: true, fin: false });
  });

  it("muestra el chevron del lado con contenido oculto y lo quita al llegar al final", async () => {
    await fila();
    const desplazable = screen.getByTestId("fila");
    const oculto = { includeHiddenElements: true };
    expect(screen.queryByTestId("desvanecido-fin", oculto)).toBeNull();
    await fireEvent(desplazable, "layout", { nativeEvent: { layout: { width: 300 } } });
    await fireEvent(desplazable, "contentSizeChange", 600, 48);
    expect(screen.getByTestId("desvanecido-fin", oculto)).toBeTruthy();
    expect(screen.queryByTestId("desvanecido-inicio", oculto)).toBeNull();
    await fireEvent.scroll(desplazable, { nativeEvent: { contentOffset: { x: 300 } } });
    expect(screen.queryByTestId("desvanecido-fin", oculto)).toBeNull();
    expect(screen.getByTestId("desvanecido-inicio", oculto)).toBeTruthy();
  });

  it("H-16: con «Reducir movimiento», se desplaza sin animación", async () => {
    AccessibilityInfo.isReduceMotionEnabled.mockResolvedValue(true);
    const ref = await fila();
    await act(async () => {});
    ScrollView.prototype.scrollTo.mockClear();
    ref.current.mostrar(100);
    expect(ScrollView.prototype.scrollTo).toHaveBeenCalledWith({ x: 76, animated: false });
  });
});

describe("la barra de funcionalidades (CA-2 a CA-4)", () => {
  async function barra(nombre, params, insets) {
    const props = propsDeTabBar(nombre, params, insets);
    const resultado = await render(<BarraDeFuncionalidades {...props} />);
    return { navigation: navegacionDe(props), props, ...resultado };
  }

  it("P1: con las props reales de `tabBar` (sin `navigation`), tocar una vista navega sin error", async () => {
    const { navigation, props } = await barra("permisos", {});
    expect(Object.keys(props).sort()).toEqual(["descriptors", "emitter", "insets", "navigateToTab", "state"]);
    await fireEvent.press(screen.getByRole("tab", { name: "Consulta de vacaciones" }));
    expect(navigation.navigate).toHaveBeenCalledWith({
      name: "permisos",
      params: { seccion: "vacaciones" },
      merge: true,
    });
  });

  it("en el Inicio, la barra trae las funcionalidades de Institucional con «Inicio» marcada", async () => {
    const { navigation } = await barra("index", undefined);
    expect(screen.getByRole("tab", { name: "Inicio", selected: true })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel)).toEqual([
      "Inicio",
      "Solicitud de permisos",
      "Consulta de vacaciones",
    ]);
    // Institucional no tiene acciones en la barra: sin divisor ni toolbar.
    expect(screen.queryByTestId("grupo-acciones")).toBeNull();
    expect(screen.queryByTestId("divisor")).toBeNull();
    await fireEvent.press(screen.getByRole("tab", { name: "Solicitud de permisos" }));
    expect(navigation.navigate).toHaveBeenLastCalledWith({
      name: "permisos",
      params: { seccion: "mias" },
      merge: true,
    });
  });

  it("en /permisos, «Por aprobar» va tras «Solicitud de permisos» y se marca la sección de la ruta", async () => {
    mockLicencias.porAprobar = 2;
    const { navigation } = await barra("permisos", { seccion: "por_aprobar" });
    const vistas = screen.getByTestId("grupo-vistas");
    expect(vistas.props.accessibilityRole).toBe("tablist");
    expect(vistas.props.accessibilityLabel).toBe("Vistas de Institucional");
    expect(
      within(vistas)
        .getAllByRole("tab")
        .map((t) => t.props.accessibilityLabel),
    ).toEqual(["Inicio", "Solicitud de permisos", "Por aprobar, 2 por aprobar", "Consulta de vacaciones"]);
    expect(within(vistas).getByRole("tab", { name: "Por aprobar, 2 por aprobar", selected: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole("tab", { name: "Inicio" }));
    expect(navigation.navigate).toHaveBeenLastCalledWith({ name: "index", params: {}, merge: true });
  });

  it("H-04: en el Chat, vistas en un tablist y acciones al final en un toolbar, tras un divisor", async () => {
    await barra("chat", undefined);
    const vistas = screen.getByTestId("grupo-vistas");
    const acciones = screen.getByTestId("grupo-acciones");
    expect(vistas.props.accessibilityRole).toBe("tablist");
    expect(acciones.props.accessibilityRole).toBe("toolbar");
    expect(acciones.props.accessibilityLabel).toBe("Acciones de Chat");
    expect(screen.getByTestId("divisor")).toBeTruthy();
    expect(within(acciones).getByRole("button", { name: "Nuevo mensaje" }).props.accessibilityHint).toBe(
      "Abre una pantalla nueva",
    );
    // Las acciones van después de las vistas (decisión del usuario).
    const orden = screen.getAllByTestId(/^funcion-/).map((e) => e.props.testID);
    expect(orden).toEqual(["funcion-conversaciones", "funcion-grupos", "funcion-nuevo", "funcion-mi_estado"]);
  });

  it("H-04: las acciones con contorno y sin relleno; la vista activa, rellena en amarillo", async () => {
    await barra("chat", { vista: "grupos" });
    const activa = StyleSheet.flatten(screen.getByTestId("funcion-grupos").props.style);
    const otra = StyleSheet.flatten(screen.getByTestId("funcion-conversaciones").props.style);
    const accion = StyleSheet.flatten(screen.getByTestId("funcion-nuevo").props.style);
    expect(activa.backgroundColor).toBe("#FCE200");
    expect(otra.backgroundColor).toBeUndefined();
    expect(accion.backgroundColor).toBeUndefined();
    expect(accion.borderWidth).toBe(1);
    expect(accion.borderColor).toBe("#C8C8C8");
    expect(otra.borderColor).toBe("transparent");
    expect(activa.minHeight).toBeGreaterThanOrEqual(44);
    const textoActivo = StyleSheet.flatten(
      within(screen.getByTestId("funcion-grupos")).getByText("Mis grupos").props.style,
    );
    const textoOtro = StyleSheet.flatten(
      within(screen.getByTestId("funcion-conversaciones")).getByText("Conversaciones").props.style,
    );
    expect(textoActivo.fontFamily ?? textoActivo.fontWeight).not.toBe(textoOtro.fontFamily ?? textoOtro.fontWeight);
  });

  it("una acción abre su pantalla; «Mis grupos» filtra la lista sin apilar", async () => {
    const { navigation } = await barra("chat", undefined);
    await fireEvent.press(screen.getByRole("button", { name: "Mi estado" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/chat/mi-estado");
    await fireEvent.press(screen.getByRole("button", { name: "Nuevo mensaje" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/chat/nuevo");
    expect(navigation.navigate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("tab", { name: "Mis grupos" }));
    expect(navigation.navigate).toHaveBeenCalledWith({ name: "chat", params: { vista: "grupos" }, merge: true });
  });

  it("en la Mesa, solo lo que la persona puede usar (CA-6), con sus insignias", async () => {
    mockSesion.usuario = { permissions: ["soporte.atender", "soporte.registrar", "soporte.crear"] };
    Object.assign(mockSoporte, { delEquipo: true, asignados: 3, misPendientes: 1 });
    await barra("soporte", {});
    // La Bandeja, la primera y la de entrada para quien la ve.
    expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel)).toEqual([
      "Bandeja del equipo, 3 asignados a usted",
      "Mis tickets, 1 necesita algo de usted",
    ]);
    expect(screen.getByRole("tab", { name: "Bandeja del equipo, 3 asignados a usted", selected: true })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Mis tickets, 1 necesita algo de usted" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Aprobaciones/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Nuevo ticket" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Registrar ticket a nombre de otra persona" })).toBeTruthy();
  });

  it("tras el 403 de bandeja/, la barra quita «Bandeja» y «Registrar»", async () => {
    mockSesion.usuario = { permissions: ["soporte.registrar"] };
    Object.assign(mockSoporte, { delEquipo: true, noEsDelEquipo: true });
    await barra("soporte", { vista: "bandeja" });
    expect(screen.queryByRole("tab", { name: /Bandeja/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar/ })).toBeNull();
    expect(screen.getByRole("tab", { name: "Mis tickets", selected: true })).toBeTruthy();
    // Solo vistas: sin acciones no hay divisor.
    expect(screen.queryByTestId("divisor")).toBeNull();
  });

  it("CA-8: un aviso que lleva a «Aprobaciones» la marca, justo tras «Mis tickets»", async () => {
    mockSesion.usuario = { permissions: ["soporte.crear"] };
    await barra("soporte", { vista: "aprobaciones" });
    expect(screen.getByRole("tab", { name: "Aprobaciones", selected: true })).toBeTruthy();
    const orden = screen.getAllByTestId(/^funcion-/).map((e) => e.props.testID);
    expect(orden).toEqual(["funcion-mis", "funcion-aprobaciones", "funcion-nuevo"]);
  });

  it("en el Chat, la insignia de no leídos en «Conversaciones»", async () => {
    mockChat.totalNoLeidos = 2;
    await barra("chat", undefined);
    expect(screen.getByRole("tab", { name: "Conversaciones, 2 mensajes sin leer", selected: true })).toBeTruthy();
  });

  it("H-08: cada módulo empieza su fila desde el principio (otra fila al cambiar de módulo)", async () => {
    const { rerender } = await render(<BarraDeFuncionalidades {...propsDeTabBar("soporte", {})} />);
    const antes = screen.getByTestId("barra-desplazable");
    await rerender(<BarraDeFuncionalidades {...propsDeTabBar("chat")} />);
    expect(screen.getByTestId("barra-desplazable")).not.toBe(antes);
  });

  it("CA-2 y H-15: respeta el área segura de abajo y se aparta con el teclado", async () => {
    const listeners = {};
    const espia = jest.spyOn(Keyboard, "addListener").mockImplementation((evento, fn) => {
      listeners[evento] = fn;
      return { remove: jest.fn() };
    });
    try {
      await barra("chat", undefined, { bottom: 30 });
      const contenedor = StyleSheet.flatten(screen.getByTestId("barra-de-funcionalidades").props.style);
      expect(contenedor.paddingBottom).toBe(40);
      // En iOS, los eventos «Will» (H-15); en Android solo existen los «Did».
      const ios = Platform.OS === "ios";
      const mostrar = ios ? "keyboardWillShow" : "keyboardDidShow";
      const ocultar = ios ? "keyboardWillHide" : "keyboardDidHide";
      expect(Object.keys(listeners).sort()).toEqual([ocultar, mostrar].sort());
      await act(async () => listeners[mostrar]());
      expect(screen.queryByTestId("barra-de-funcionalidades")).toBeNull();
      await act(async () => listeners[ocultar]());
      expect(screen.getByTestId("barra-de-funcionalidades")).toBeTruthy();
    } finally {
      espia.mockRestore();
    }
  });

  it("CA-10: con la letra al 200 % (la de Jest) los textos siguen en una fila, sin cortarse", async () => {
    await barra("soporte", {});
    const texto = within(screen.getByTestId("funcion-mis")).getByText("Mis tickets");
    expect(texto.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(screen.getByTestId("funcion-mis").props.style).flexDirection).toBe("row");
    expect(screen.getByTestId("barra-desplazable").props.horizontal).toBe(true);
  });
});

describe("el navegador de módulos ((tabs)/_layout.js)", () => {
  afterEach(() => {
    mockTabs.propsDeTabBar = null;
    mockFoco.valor = true;
  });

  it("P1 de la ronda 2: hay UNA sola cabecera de módulos, fuera de las pantallas, y es la que recibe los toques", async () => {
    mockTabs.pantallas = [];
    mockTabs.propsDeTabBar = propsDeTabBar("soporte", {});
    const ModulosLayout = require("../src/app/(app)/(tabs)/_layout").default;
    await render(<ModulosLayout />);
    // Las pantallas no pintan cabecera propia.
    expect(mockTabs.props.screenOptions.headerShown).toBe(false);
    expect(mockTabs.props.screenOptions.header).toBeUndefined();
    expect(mockTabs.pantallas.every((p) => !p.options?.header && p.options?.headerShown !== true)).toBe(true);
    expect(screen.getAllByTestId("cabecera-de-modulos")).toHaveLength(1);
    expect(screen.getAllByTestId("pestanas-de-modulos")).toHaveLength(1);
    // La que se ve es la del módulo activo y sus toques van a la pantalla activa.
    expect(screen.getByRole("tab", { name: "Mesa de ayuda", selected: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole("tab", { name: "Chat" }));
    expect(navegacionDe(mockTabs.propsDeTabBar).navigate).toHaveBeenCalledWith({ name: "chat", merge: true });
    // La barra de abajo, una sola también.
    expect(screen.getAllByTestId("barra-de-funcionalidades")).toHaveLength(1);
  });

  it("las pantallas sin foco no reciben toques ni se leen (SoloConFoco)", async () => {
    mockFoco.valor = false;
    const { rerender } = await render(
      <SoloConFoco>
        <></>
      </SoloConFoco>,
    );
    const sinFoco = screen.getByTestId("pantalla-sin-foco", { includeHiddenElements: true });
    expect(sinFoco.props.pointerEvents).toBe("none");
    expect(sinFoco.props.importantForAccessibility).toBe("no-hide-descendants");
    mockFoco.valor = true;
    await rerender(
      <SoloConFoco>
        <></>
      </SoloConFoco>,
    );
    expect(screen.getByTestId("pantalla-con-foco").props.pointerEvents).toBe("auto");
  });

  it.each(["index", "permisos", "chat", "soporte"])("la pantalla «%s» va dentro de SoloConFoco", (nombre) => {
    const fs = require("fs");
    const path = require("path");
    const fuente = fs.readFileSync(path.join(__dirname, `../src/app/(app)/(tabs)/${nombre}.js`), "utf8");
    expect(fuente).toMatch(/<SoloConFoco>/);
  });

  it("CA-9: Atrás vuelve a Institucional › Inicio; solo los módulos son pestañas (Avisos y Cuenta van al Stack)", async () => {
    mockTabs.pantallas = [];
    const ModulosLayout = require("../src/app/(app)/(tabs)/_layout").default;
    await render(<ModulosLayout />);
    expect(mockTabs.props.backBehavior).toBe("firstRoute");
    expect(typeof mockTabs.props.tabBar).toBe("function");
    expect(mockTabs.pantallas.map((p) => p.name)).toEqual(["index", "permisos", "chat", "soporte"]);
    // La primera es Institucional › Inicio: Atrás vuelve a ella y desde ella
    // sale de la app.
    expect(mockTabs.pantallas.map((p) => p.name)).toEqual(MODULOS.flatMap((m) => m.pantallas));
  });

  it("el anchor del Stack es `(tabs)` (no `initialRouteName`, obsoleto en expo-router 58)", () => {
    const fs = require("fs");
    const path = require("path");
    const fuente = fs.readFileSync(path.join(__dirname, "../src/app/(app)/_layout.js"), "utf8");
    expect(fuente).toMatch(/export const unstable_settings = \{ anchor: "\(tabs\)" \};/);
    expect(fuente).not.toMatch(/initialRouteName:/);
  });
});
