/**
 * US-029: la burbuja para crear un ticket de soporte desde cualquier pantalla
 * (CA-1 a CA-6).
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Keyboard, Platform, StyleSheet, Text, View } from "react-native";

import {
  BurbujaDeSoporte,
  CANDADO_BURBUJA_MS,
  ProveedorDeLaBurbuja,
  useApoyoDeLaBurbuja,
  useInformarAlturaDeLaBarra,
  useRellenoDeLaBurbuja,
} from "../src/navegacion/BurbujaDeSoporte";
import {
  ALTURA_BARRA_SUPUESTA,
  distanciaAlBorde,
  MARGEN_BURBUJA,
  muestraLaBurbuja,
  puedePedirSoporte,
  RUTA_DEL_TICKET_PROPIO,
  rutaSinBurbuja,
  SEPARACION_BURBUJA,
  TAMANO_BURBUJA,
} from "../src/navegacion/reglasDeLaBurbuja";
import { ESPACIO_BOTON_FLOTANTE } from "../src/componentes/BotonFlotante";
import { BarraDeFuncionalidades } from "../src/navegacion/BarraDeFuncionalidades";
import { TAMANO_FLOTANTE_CHAT } from "../src/pantallas/chat/ListaChats";
import { AREA_TACTIL } from "../src/tema/colores";
import { coloresClarosEn, olvidarApariencia, renderEnOscuro } from "./utilidades/modoOscuro";

const mockRouter = { push: jest.fn() };
const mockRuta = { valor: "/" };
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    usePathname: () => mockRuta.valor,
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

const mockSesion = { usuario: { permissions: ["soporte.crear"] } };
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));
const mockSoporte = { moduloApagado: false };
jest.mock("../src/soporte/ResumenSoporteContext", () => ({ useResumenSoporte: () => mockSoporte }));

// ListaChats solo se importa por su constante; sus dependencias no se usan.
jest.mock("../src/chat/ChatContext", () => ({ useChat: () => ({}), useChatVisible: () => {}, useTotalNoLeidos: () => 0 }));
jest.mock("../src/permisos/ResumenPermisosContext", () => ({
  useResumenPermisos: () => ({ porAprobar: 0, puedeSolicitar: true, cargado: true }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRuta.valor = "/";
  mockSesion.usuario = { permissions: ["soporte.crear"] };
  mockSoporte.moduloApagado = false;
});

/** La burbuja con su proveedor, como en `app/(app)/_layout.js`. */
function Montaje({ children = null }) {
  return (
    <ProveedorDeLaBurbuja>
      <View style={{ flex: 1 }}>{children}</View>
      <BurbujaDeSoporte />
    </ProveedorDeLaBurbuja>
  );
}

function estiloDeLaBurbuja() {
  const boton = screen.getByTestId("burbuja-soporte");
  const estilo = typeof boton.props.style === "function" ? boton.props.style({ pressed: false }) : boton.props.style;
  return StyleSheet.flatten(estilo);
}

/** Una barra de funcionalidades de prueba: publica su alto al medirse. */
function BarraDePrueba({ alto }) {
  const { alMedir } = useInformarAlturaDeLaBarra();
  return <View testID="barra" onLayout={alMedir} style={{ height: alto }} />;
}

async function medir(testID, height) {
  await fireEvent(screen.getByTestId(testID), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 360, height } } });
}

describe("las reglas (función pura)", () => {
  it("CA-2: no va en ninguna pantalla de Gestión de Activos", () => {
    for (const ruta of [
      "/activos",
      "/activos?vista=inventario",
      "/activos/12",
      "/activos/12/editar",
      "/activos/escanear",
      "/activos/nuevo",
      "/mantenimientos/3",
      "/mantenimientos/nuevo",
      "/solicitudes/4",
      "/solicitudes/nueva",
    ]) {
      expect([ruta, rutaSinBurbuja(ruta)]).toEqual([ruta, true]);
    }
  });

  it("CA-2: ni en los formularios del ticket ni en el inicio de sesión", () => {
    for (const ruta of ["/soporte/nuevo", "/soporte/nuevo/", "/soporte/nuevo?x=1", "/soporte/registrar", "/login", "", null]) {
      expect([ruta, rutaSinBurbuja(ruta)]).toEqual([ruta, true]);
    }
  });

  it("CA-2: sí en módulos, fichas, listas, conversaciones, formularios y Cuenta", () => {
    for (const ruta of [
      "/",
      "/permisos",
      "/chat",
      "/chat/conversacion/5",
      "/chat/nuevo",
      "/chat/grupo-nuevo",
      "/soporte",
      "/soporte/mi-ticket/9",
      "/soporte/ticket/9",
      "/matriz",
      "/matriz/periodo/2",
      "/ordenes",
      "/ordenes/nueva",
      "/ordenes/7",
      "/permisos/nueva",
      "/permisos/solicitud/3",
      "/notificaciones",
      "/notificacion/1",
      "/cuenta",
      // Un camino que solo empieza igual no es de Activos.
      "/activosx",
    ]) {
      expect([ruta, rutaSinBurbuja(ruta)]).toEqual([ruta, false]);
    }
  });

  it("CA-1: con el permiso de «Nuevo ticket» (el de la barra de la Mesa) y la Mesa encendida", () => {
    expect(puedePedirSoporte({ permisos: ["soporte.crear"], moduloApagado: false })).toBe(true);
    expect(puedePedirSoporte({ permisos: ["soporte.mesa_crear"], moduloApagado: false })).toBe(true);
    expect(puedePedirSoporte({ permisos: ["soporte.atender", "soporte.registrar"] })).toBe(false);
    expect(puedePedirSoporte({ permisos: [] })).toBe(false);
    expect(puedePedirSoporte({})).toBe(false);
    expect(puedePedirSoporte({ permisos: ["soporte.crear"], moduloApagado: true })).toBe(false);
    // QA-TECH: mientras no se sabe si la Mesa está encendida, no se pinta.
    expect(puedePedirSoporte({ permisos: ["soporte.crear"], moduloApagado: null })).toBe(false);
    expect(puedePedirSoporte({ permisos: ["soporte.crear"] })).toBe(false);
  });

  it("CA-3: con el teclado abierto no se muestra", () => {
    const base = { ruta: "/", permisos: ["soporte.crear"], moduloApagado: false };
    expect(muestraLaBurbuja(base)).toBe(true);
    expect(muestraLaBurbuja({ ...base, teclado: true })).toBe(false);
  });

  it("CA-3: en un módulo va sobre la barra; fuera de él, sobre el margen del sistema", () => {
    expect(distanciaAlBorde({ ruta: "/", alturaBarra: 90, margenSistema: 24 })).toBe(90 + MARGEN_BURBUJA);
    expect(distanciaAlBorde({ ruta: "/soporte/ticket/3", alturaBarra: 90, margenSistema: 24 })).toBe(24 + MARGEN_BURBUJA);
    // Antes de medir la barra, lo que se supone que mide (no la pisa).
    expect(distanciaAlBorde({ ruta: "/chat", alturaBarra: null, margenSistema: 24 })).toBe(
      ALTURA_BARRA_SUPUESTA + 24 + MARGEN_BURBUJA,
    );
    // Sin barra (un módulo sin funcionalidades), abajo, sobre el margen del
    // sistema (QA-TECH).
    expect(distanciaAlBorde({ ruta: "/chat", alturaBarra: 0, margenSistema: 24 })).toBe(24 + MARGEN_BURBUJA);
    expect(distanciaAlBorde({ ruta: "/chat", alturaBarra: 0, margenSistema: 0 })).toBe(MARGEN_BURBUJA);
  });

  it("CA-3: con algo fijo debajo (otra burbuja, la fila de escribir) se apila encima", () => {
    expect(distanciaAlBorde({ ruta: "/chat", alturaBarra: 90, apoyo: 72 })).toBe(90 + 72 + SEPARACION_BURBUJA);
    expect(distanciaAlBorde({ ruta: "/chat/conversacion/5", alturaBarra: 90, apoyo: 70, margenSistema: 24 })).toBe(
      70 + SEPARACION_BURBUJA,
    );
  });
});

describe("la burbuja (CA-1 a CA-5)", () => {
  it("CA-1: con permiso aparece, con la etiqueta, la pista y el área táctil", async () => {
    await render(<Montaje />);
    const boton = screen.getByTestId("burbuja-soporte");
    expect(boton.props.accessibilityLabel).toBe("Crear un ticket de soporte");
    expect(boton.props.accessibilityHint).toMatch(/formulario/);
    expect(boton.props.accessibilityRole).toBe("button");
    const estilo = estiloDeLaBurbuja();
    expect(estilo.width).toBe(TAMANO_BURBUJA);
    expect(estilo.width).toBeGreaterThanOrEqual(AREA_TACTIL);
    expect(estilo.height).toBeGreaterThanOrEqual(AREA_TACTIL);
    // El aspecto de la de «Escanear»: abajo a la derecha, redonda.
    expect(estilo.position).toBe("absolute");
    expect(estilo.right).toBe(16);
    expect(estilo.borderRadius).toBe(TAMANO_BURBUJA / 2);
  });

  it("CA-1: también con «Crear tickets en la Mesa de ayuda» (`soporte.mesa_crear`)", async () => {
    mockSesion.usuario = { permissions: ["soporte.mesa_crear"] };
    await render(<Montaje />);
    expect(screen.getByTestId("burbuja-soporte")).toBeTruthy();
  });

  it("CA-1: sin el permiso no aparece", async () => {
    mockSesion.usuario = { permissions: ["soporte.atender"] };
    await render(<Montaje />);
    expect(screen.queryByTestId("burbuja-soporte")).toBeNull();
  });

  it("CA-1: con la Mesa apagada en la empresa no aparece", async () => {
    mockSoporte.moduloApagado = true;
    await render(<Montaje />);
    expect(screen.queryByTestId("burbuja-soporte")).toBeNull();
  });

  it("CA-1 (QA-TECH): mientras no se sabe si la Mesa está encendida no aparece; al saberlo, sí", async () => {
    mockSoporte.moduloApagado = null;
    const { rerender } = await render(<Montaje />);
    expect(screen.queryByTestId("burbuja-soporte")).toBeNull();
    mockSoporte.moduloApagado = false;
    await rerender(<Montaje />);
    expect(screen.getByTestId("burbuja-soporte")).toBeTruthy();
  });

  it("CA-2: oculta en Activos y en los formularios del ticket; vuelve al salir", async () => {
    const { rerender } = await render(<Montaje />);
    for (const ruta of ["/activos", "/activos/3", "/mantenimientos/nuevo", RUTA_DEL_TICKET_PROPIO, "/soporte/registrar"]) {
      mockRuta.valor = ruta;
      await rerender(<Montaje />);
      expect([ruta, screen.queryByTestId("burbuja-soporte")]).toEqual([ruta, null]);
    }
    mockRuta.valor = "/soporte/mi-ticket/3";
    await rerender(<Montaje />);
    expect(screen.getByTestId("burbuja-soporte")).toBeTruthy();
  });

  it("CA-4: al tocarla abre el formulario del ticket propio en la pila, una sola vez", async () => {
    await render(<Montaje />);
    await fireEvent.press(screen.getByTestId("burbuja-soporte"));
    await fireEvent.press(screen.getByTestId("burbuja-soporte"));
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith("/soporte/nuevo");
    // Pasado el candado (si la navegación no llegó a ocultarla), otra vez.
    await act(() => new Promise((listo) => setTimeout(listo, CANDADO_BURBUJA_MS + 50)));
    await fireEvent.press(screen.getByTestId("burbuja-soporte"));
    expect(mockRouter.push).toHaveBeenCalledTimes(2);

  });

  it("CA-3: se oculta con el teclado abierto y vuelve al cerrarlo", async () => {
    const listeners = {};
    const espia = jest.spyOn(Keyboard, "addListener").mockImplementation((evento, fn) => {
      listeners[evento] = fn;
      return { remove: jest.fn() };
    });
    try {
      await render(<Montaje />);
      const ios = Platform.OS === "ios";
      const mostrar = ios ? "keyboardWillShow" : "keyboardDidShow";
      const ocultar = ios ? "keyboardWillHide" : "keyboardDidHide";
      expect(screen.getByTestId("burbuja-soporte")).toBeTruthy();
      await act(async () => listeners[mostrar]());
      expect(screen.queryByTestId("burbuja-soporte")).toBeNull();
      await act(async () => listeners[ocultar]());
      expect(screen.getByTestId("burbuja-soporte")).toBeTruthy();
    } finally {
      espia.mockRestore();
    }
  });

  it("CA-3: en un módulo va justo sobre la barra de funcionalidades medida", async () => {
    mockRuta.valor = "/soporte";
    await render(
      <Montaje>
        <BarraDePrueba alto={88} />
      </Montaje>,
    );
    await medir("barra", 88);
    expect(estiloDeLaBurbuja().bottom).toBe(88 + MARGEN_BURBUJA);
  });

  it("CA-3: la barra de funcionalidades real publica su alto", async () => {
    mockRuta.valor = "/soporte";
    const state = { index: 0, routes: [{ key: "soporte-1", name: "soporte", params: { vista: "mis" } }] };
    await render(
      <Montaje>
        <BarraDeFuncionalidades state={state} descriptors={{}} insets={{ bottom: 0 }} />
      </Montaje>,
    );
    await medir("barra-de-funcionalidades", 92);
    expect(estiloDeLaBurbuja().bottom).toBe(92 + MARGEN_BURBUJA);
  });

  it("QA-TECH: con el teclado la barra no publica nada; al cerrarlo la burbuja vuelve a su sitio sin medir otra vez", async () => {
    // La barra y la burbuja escuchan el teclado: se avisa a todos.
    const oyentes = {};
    const espia = jest.spyOn(Keyboard, "addListener").mockImplementation((evento, fn) => {
      (oyentes[evento] ??= []).push(fn);
      return { remove: jest.fn() };
    });
    const listeners = new Proxy({}, { get: (_, evento) => () => (oyentes[evento] ?? []).forEach((fn) => fn()) });
    try {
      mockRuta.valor = "/soporte";
      const state = { index: 0, routes: [{ key: "soporte-1", name: "soporte", params: { vista: "mis" } }] };
      await render(
        <Montaje>
          <BarraDeFuncionalidades state={state} descriptors={{}} insets={{ bottom: 0 }} />
        </Montaje>,
      );
      await medir("barra-de-funcionalidades", 92);
      const ios = Platform.OS === "ios";
      await act(async () => listeners[ios ? "keyboardWillShow" : "keyboardDidShow"]());
      expect(screen.queryByTestId("barra-de-funcionalidades")).toBeNull();
      expect(screen.queryByTestId("burbuja-soporte")).toBeNull();
      await act(async () => listeners[ios ? "keyboardWillHide" : "keyboardDidHide"]());
      // Sin un `onLayout` nuevo: el alto guardado sigue siendo el de la barra.
      expect(estiloDeLaBurbuja().bottom).toBe(92 + MARGEN_BURBUJA);
    } finally {
      espia.mockRestore();
    }
  });

  it("QA-TECH (P2): medir la barra o la fila de escribir no vuelve a pintar las pantallas con relleno", async () => {
    mockRuta.valor = "/chat/conversacion/5";
    let pintadas = 0;
    function PantallaConRelleno() {
      pintadas += 1;
      useRellenoDeLaBurbuja();
      return null;
    }
    function Redactar() {
      const medirRedactar = useApoyoDeLaBurbuja();
      return <View testID="redactar" onLayout={medirRedactar} />;
    }
    // El mismo elemento entre pintadas del proveedor, como en el layout.
    const pantalla = <PantallaConRelleno />;
    await render(
      <Montaje>
        {pantalla}
        <BarraDePrueba alto={88} />
        <Redactar />
      </Montaje>,
    );
    const antes = pintadas;
    await medir("barra", 88);
    await medir("redactar", 70);
    await medir("redactar", 90);
    expect(estiloDeLaBurbuja().bottom).toBe(90 + SEPARACION_BURBUJA);
    expect(pintadas).toBe(antes);
  });

  it("CA-3: en el chat se apila sobre la burbuja de «Nuevo mensaje» y no se superponen", async () => {
    mockRuta.valor = "/chat";
    function ListaDelChat() {
      // Lo mismo que hace `ListaChats`.
      useApoyoDeLaBurbuja({ altoFijo: MARGEN_BURBUJA + TAMANO_FLOTANTE_CHAT });
      return <Text>Conversaciones</Text>;
    }
    await render(
      <Montaje>
        <ListaDelChat />
        <BarraDePrueba alto={88} />
      </Montaje>,
    );
    await medir("barra", 88);
    const bottom = estiloDeLaBurbuja().bottom;
    // La del chat ocupa de 16 a 72 sobre la barra; la de soporte empieza más
    // arriba, con aire.
    const techoDelChat = 88 + MARGEN_BURBUJA + TAMANO_FLOTANTE_CHAT;
    expect(bottom).toBe(techoDelChat + SEPARACION_BURBUJA);
    expect(bottom).toBeGreaterThan(techoDelChat);
  });

  it("CA-3: en una conversación va sobre la fila de escribir (y sobre «Ir al último»); al salir, el apoyo se retira", async () => {
    mockRuta.valor = "/chat/conversacion/5";
    function Conversacion({ lejos }) {
      const medirRedactar = useApoyoDeLaBurbuja({ extra: lejos ? 60 : 0 });
      return <View testID="redactar" onLayout={medirRedactar} />;
    }
    const arbol = (lejos, abierta = true) => <Montaje>{abierta ? <Conversacion lejos={lejos} /> : null}</Montaje>;
    const { rerender } = await render(arbol(false));
    await medir("redactar", 70);
    expect(estiloDeLaBurbuja().bottom).toBe(70 + SEPARACION_BURBUJA);
    await rerender(arbol(true));
    expect(estiloDeLaBurbuja().bottom).toBe(70 + 60 + SEPARACION_BURBUJA);
    // Al cerrar la conversación, la burbuja vuelve a su sitio.
    mockRuta.valor = "/chat/contacto/5";
    await rerender(arbol(false, false));
    expect(estiloDeLaBurbuja().bottom).toBe(MARGEN_BURBUJA);
  });

  it("CA-3: las pantallas dejan espacio al final solo mientras la burbuja se ve", async () => {
    let relleno;
    function Lista() {
      relleno = useRellenoDeLaBurbuja({ margenDelSistema: false });
      return null;
    }
    const { rerender } = await render(
      <Montaje>
        <Lista />
      </Montaje>,
    );
    expect(relleno).toEqual({ paddingBottom: ESPACIO_BOTON_FLOTANTE });
    mockRuta.valor = "/activos";
    await rerender(
      <Montaje>
        <Lista />
      </Montaje>,
    );
    expect(relleno).toBeNull();
  });

  it("CA-5: va después del contenido en el árbol (el lector la encuentra al final)", async () => {
    await render(
      <Montaje>
        <Text>Contenido principal</Text>
      </Montaje>,
    );
    const textos = JSON.stringify(screen.toJSON());
    expect(textos.indexOf("Contenido principal")).toBeLessThan(textos.indexOf("burbuja-soporte"));
  });
});

describe("CA-2: todas las rutas de Gestión de Activos quedan sin burbuja", () => {
  const fs = require("fs");
  const path = require("path");
  const raiz = path.join(__dirname, "..", "src", "app", "(app)");

  function archivosDe(carpeta) {
    return fs.readdirSync(carpeta, { withFileTypes: true }).flatMap((e) => {
      const ruta = path.join(carpeta, e.name);
      return e.isDirectory() ? archivosDe(ruta) : ruta.endsWith(".js") ? [ruta] : [];
    });
  }

  /** El camino de expo-router de un archivo de `src/app/(app)`: sin grupos
   * («(tabs)»), sin «index» y con un valor en cada segmento dinámico. */
  function caminoDe(relativo) {
    const partes = relativo
      .replace(/\.js$/, "")
      .split(/[\\/]/)
      .filter((p) => !/^\(.*\)$/.test(p))
      .map((p) => (/^\[.*\]$/.test(p) ? "1" : p));
    if (partes[partes.length - 1] === "index") partes.pop();
    return `/${partes.join("/")}`;
  }

  /** Es de Activos si está bajo sus prefijos o si su pantalla es de
   * `pantallas/activos/`: así una ruta nueva con otro prefijo también cuenta. */
  function esDeActivos(camino, fuente) {
    return /^\/(activos|mantenimientos|solicitudes)(\/|$)/.test(camino) || /pantallas\/activos\//.test(fuente);
  }

  function rutas(archivos) {
    return archivos
      .filter(({ relativo }) => !/(^|[\\/])_layout\.js$/.test(relativo))
      .map(({ relativo, fuente }) => {
        const camino = caminoDe(relativo);
        return { camino, activos: esDeActivos(camino, fuente) };
      });
  }

  /** Las rutas de Activos que mostrarían la burbuja (debe ser `[]`). */
  function incumplen(lista) {
    return lista.filter((r) => r.activos && !rutaSinBurbuja(r.camino)).map((r) => r.camino);
  }

  const delArbol = () =>
    rutas(archivosDe(raiz).map((f) => ({ relativo: path.relative(raiz, f), fuente: fs.readFileSync(f, "utf8") })));

  it("recorre el árbol: cada ruta de Activos cumple rutaSinBurbuja", () => {
    const lista = delArbol();
    const deActivos = lista.filter((r) => r.activos).map((r) => r.camino);
    // Las de hoy (US-022 y US-023); una que se agregue entra sola.
    expect(deActivos).toEqual(
      expect.arrayContaining([
        "/activos",
        "/activos/1",
        "/activos/1/editar",
        "/activos/escanear",
        "/activos/nuevo",
        "/mantenimientos/1",
        "/mantenimientos/nuevo",
        "/solicitudes/1",
        "/solicitudes/nueva",
      ]),
    );
    expect(incumplen(lista)).toEqual([]);
  });

  it("y las demás sí la llevan, salvo los formularios del ticket", () => {
    const sinBurbuja = delArbol()
      .filter((r) => !r.activos && rutaSinBurbuja(r.camino))
      .map((r) => r.camino)
      .sort();
    expect(sinBurbuja).toEqual(["/soporte/nuevo", "/soporte/registrar"]);
  });

  it("una ruta nueva de Activos fuera de esos prefijos haría fallar la prueba", () => {
    const nueva = rutas([
      {
        relativo: path.join("inventario", "[id].js"),
        fuente: 'import { FichaActivo } from "../../../pantallas/activos/FichaActivo";',
      },
    ]);
    expect(nueva).toEqual([{ camino: "/inventario/1", activos: true }]);
    expect(incumplen(nueva)).toEqual(["/inventario/1"]);
  });
});

describe("montaje único (alcance)", () => {
  const fs = require("fs");
  const path = require("path");

  function archivosDe(carpeta) {
    return fs.readdirSync(carpeta, { withFileTypes: true }).flatMap((e) => {
      const ruta = path.join(carpeta, e.name);
      return e.isDirectory() ? archivosDe(ruta) : ruta.endsWith(".js") ? [ruta] : [];
    });
  }

  it("la burbuja se pinta una sola vez, en el layout autenticado, con su proveedor", () => {
    const src = path.join(__dirname, "..", "src");
    const conBurbuja = archivosDe(src).filter((f) => /<BurbujaDeSoporte[\s/>]/.test(fs.readFileSync(f, "utf8")));
    expect(conBurbuja.map((f) => path.relative(src, f).split(path.sep).join("/"))).toEqual(["app/(app)/_layout.js"]);
    const layout = fs.readFileSync(conBurbuja[0], "utf8");
    expect(layout.match(/<BurbujaDeSoporte \/>/g)).toHaveLength(1);
    expect(layout).toMatch(/<ProveedorDeLaBurbuja>/);
    // Después de la pila: encima de las pantallas y al final para el lector.
    expect(layout.indexOf("<BurbujaDeSoporte />")).toBeGreaterThan(layout.indexOf("</Stack>"));
  });
});

describe("CA-3 (US-026): modo oscuro", () => {
  afterEach(() => olvidarApariencia());

  it("se ve en oscuro, con el amarillo de la marca y sin colores claros fijos", async () => {
    await renderEnOscuro(<Montaje />);
    expect(screen.getByTestId("burbuja-soporte")).toBeTruthy();
    expect(estiloDeLaBurbuja().backgroundColor).toBe("#FCE200");
    expect(coloresClarosEn(screen.toJSON())).toEqual([]);
  });
});
