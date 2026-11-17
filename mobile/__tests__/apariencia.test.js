/**
 * US-026: modo claro y modo oscuro. El contexto (persistencia, Sistema y el
 * cambio en vivo), el botón de la cabecera con su menú, y las piezas comunes
 * y el inicio de sesión en oscuro sin colores claros fijos.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { Appearance, StyleSheet, Text } from "react-native";

import { Alerta, Boton, Cargando, ErrorConReintento, Vacio } from "../src/componentes/comunes";
import { Refresco } from "../src/componentes/Refresco";
import { Ventana } from "../src/componentes/Ventana";
import * as SystemUI from "expo-system-ui";

import { BotonRedondo } from "../src/componentes/BotonRedondo";
import { almacen } from "../src/api/almacen";
import { BarrasDelSistema } from "../src/navegacion/BarrasDelSistema";
import { BotonDeApariencia, nombreDelBotonDeApariencia, posicionDelMenu } from "../src/navegacion/BotonDeApariencia";
import { COLORES_DE_MODULO, COLORES_DE_MODULO_OSCURO, coloresDe } from "../src/notificaciones/coloresDeModulo";
import { Login } from "../src/pantallas/Login";
import { ElementoNotificacion } from "../src/pantallas/ListaNotificaciones";
import { TONOS } from "../src/soporte/formato";
import { estadoDe } from "../src/permisos/formato";
import { tipoDe } from "../src/inicio/calendario";
import {
  esquemaDe,
  OPCIONES_DE_APARIENCIA,
  ProveedorDeApariencia,
  useApariencia,
  useColores,
  useEstilos,
} from "../src/tema/apariencia";
import { colores, paletaActiva, paletaClara, paletaOscura } from "../src/tema/colores";
import { crearEstilos } from "../src/tema/tipografia";
import { coloresClarosEn, COLORES_SOLO_CLAROS, olvidarApariencia, renderEnOscuro } from "./utilidades/modoOscuro";

// Los íconos con su nombre y su color, para leerlos (O-4 de QA).
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return function IconoConNombre({ name, color }) {
    return React.createElement(Text, { testID: `icono-${name}`, style: { color } }, name);
  };
});

// El modo del teléfono, que la prueba cambia en vivo (como `Appearance`).
const mockEsquema = { valor: "light", oyentes: new Set() };
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  const { useSyncExternalStore } = require("react");
  return {
    __esModule: true,
    default: () =>
      useSyncExternalStore(
        (avisar) => {
          mockEsquema.oyentes.add(avisar);
          return () => mockEsquema.oyentes.delete(avisar);
        },
        () => mockEsquema.valor,
      ),
  };
});

async function cambiarElTelefono(valor) {
  await act(async () => {
    mockEsquema.valor = valor;
    mockEsquema.oyentes.forEach((avisar) => avisar());
  });
}

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children, ...props }) => require("react").createElement(require("react-native").View, props, children),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useIsFocused: () => true,
  useFocusEffect: () => {},
}));

const mockSesion = { iniciarSesion: jest.fn(), aviso: null };
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));

/** Muestra el modo con texto, para leerlo en las pruebas. */
function Espia() {
  const { preferencia, esquema } = useApariencia();
  const c = useColores();
  return <Text testID="espia">{`${preferencia}|${esquema}|${c.fondo}`}</Text>;
}

const espia = () => screen.getByTestId("espia").props.children;

let fijarNativo;
beforeEach(() => {
  olvidarApariencia();
  mockEsquema.valor = "light";
  SecureStore.setItemAsync.mockClear();
  fijarNativo = jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => {});
});

afterEach(() => {
  fijarNativo.mockRestore();
});

describe("paletas (CA-4)", () => {
  it("la oscura tiene todos los tokens de la clara y `colores` sigue siendo la clara", () => {
    expect(Object.keys(paletaOscura).sort()).toEqual(Object.keys(paletaClara).sort());
    expect(colores).toBe(paletaClara);
    // La cabecera y la barra siguen oscuras con el acento amarillo; los
    // botones primarios, el amarillo de la marca con letra negra.
    expect(paletaOscura.cabecera).toBe("#000000");
    expect(paletaOscura.acento).toBe("#FCE200");
    expect(paletaOscura.primario).toBe("#FCE200");
    expect(paletaOscura.sobrePrimario).toBe("#000000");
  });

  it("los colores de módulo tienen su versión oscura con la letra de la etiqueta", () => {
    expect(Object.keys(COLORES_DE_MODULO_OSCURO).sort()).toEqual(Object.keys(COLORES_DE_MODULO).sort());
    expect(coloresDe({ modulo: "soporte" })).toBe(COLORES_DE_MODULO.soporte);
    expect(coloresDe({ modulo: "soporte" }, true)).toBe(COLORES_DE_MODULO_OSCURO.soporte);
    expect(COLORES_DE_MODULO.soporte.sobreEtiqueta).toBe("#FFFFFF");
    expect(COLORES_DE_MODULO_OSCURO.soporte.sobreEtiqueta).toBe("#000000");
  });

  it("el modo que se ve: el elegido o, con Sistema, el del teléfono", () => {
    expect(esquemaDe("claro", "dark")).toBe("claro");
    expect(esquemaDe("oscuro", "light")).toBe("oscuro");
    expect(esquemaDe("sistema", "dark")).toBe("oscuro");
    expect(esquemaDe("sistema", null)).toBe("claro");
  });
});

describe("contexto de apariencia (CA-2 y CA-3)", () => {
  it("sin proveedor (las pantallas en sus pruebas), la paleta clara", async () => {
    await render(<Espia />);
    expect(espia()).toBe(`sistema|claro|${paletaClara.fondo}`);
  });

  it("si nunca se eligió nada, Sistema: sigue al teléfono", async () => {
    mockEsquema.valor = "dark";
    await render(
      <ProveedorDeApariencia>
        <Espia />
      </ProveedorDeApariencia>,
    );
    await act(async () => {});
    expect(espia()).toBe(`sistema|oscuro|${paletaOscura.fondo}`);
    expect(fijarNativo).toHaveBeenLastCalledWith("unspecified");
  });

  it("con Sistema cambia en vivo cuando el teléfono cambia, sin reiniciar", async () => {
    await render(
      <ProveedorDeApariencia>
        <Espia />
      </ProveedorDeApariencia>,
    );
    await act(async () => {});
    expect(espia()).toBe(`sistema|claro|${paletaClara.fondo}`);

    await cambiarElTelefono("dark");
    expect(espia()).toBe(`sistema|oscuro|${paletaOscura.fondo}`);
    // Los tonos de estado salen del modo que se ve.
    expect(TONOS.mal.color).toBe(paletaOscura.malTexto);

    await cambiarElTelefono("light");
    expect(espia()).toBe(`sistema|claro|${paletaClara.fondo}`);
    expect(TONOS.mal.color).toBe(paletaClara.malTexto);
  });

  it("lo elegido se guarda en el teléfono y se respeta al volver a abrir la app", async () => {
    const primera = await render(
      <ProveedorDeApariencia>
        <BotonDeApariencia />
        <Espia />
      </ProveedorDeApariencia>,
    );
    await act(async () => {});
    await fireEvent.press(screen.getByTestId("abrir-apariencia"));
    await fireEvent.press(screen.getByTestId("apariencia-oscuro"));

    expect(espia()).toBe(`oscuro|oscuro|${paletaOscura.fondo}`);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("ilce_apariencia", "oscuro");
    expect(fijarNativo).toHaveBeenLastCalledWith("dark");
    await primera.unmount();
    // Al desmontar, lo que no depende del render vuelve a la clara.
    expect(paletaActiva()).toBe(paletaClara);

    // «Cerrar y volver a abrir»: un proveedor nuevo lee lo guardado, aunque
    // el teléfono esté en claro.
    await render(
      <ProveedorDeApariencia>
        <Espia />
      </ProveedorDeApariencia>,
    );
    await act(async () => {});
    expect(espia()).toBe(`oscuro|oscuro|${paletaOscura.fondo}`);
    await cambiarElTelefono("dark");
    await cambiarElTelefono("light");
    // Con «Oscuro» elegido, el teléfono no lo cambia.
    expect(espia()).toBe(`oscuro|oscuro|${paletaOscura.fondo}`);
  });

  it("un valor guardado que no es válido se ignora (Sistema)", async () => {
    SecureStore.__datos.set("ilce_apariencia", "morado");
    await render(
      <ProveedorDeApariencia>
        <Espia />
      </ProveedorDeApariencia>,
    );
    await act(async () => {});
    expect(espia()).toBe(`sistema|claro|${paletaClara.fondo}`);
  });

  it("si el teléfono no puede leer lo guardado, sigue con Sistema", async () => {
    SecureStore.getItemAsync.mockRejectedValueOnce(new Error("keystore"));
    mockEsquema.valor = "dark";
    await render(
      <ProveedorDeApariencia>
        <Espia />
      </ProveedorDeApariencia>,
    );
    await act(async () => {});
    expect(espia()).toBe(`sistema|oscuro|${paletaOscura.fondo}`);
  });

  it("los estilos de una fábrica se crean una vez por modo", async () => {
    const fabrica = jest.fn((c) => crearEstilos({ caja: { backgroundColor: c.fondo } }));
    function Caja() {
      const estilos = useEstilos(fabrica);
      return <Text testID="caja" style={estilos.caja} />;
    }
    await render(
      <ProveedorDeApariencia>
        <Caja />
        <Caja />
      </ProveedorDeApariencia>,
    );
    await act(async () => {});
    await cambiarElTelefono("dark");
    await cambiarElTelefono("light");
    await cambiarElTelefono("dark");
    expect(fabrica).toHaveBeenCalledTimes(2);
    expect(StyleSheet.flatten(screen.getAllByTestId("caja")[0].props.style).backgroundColor).toBe(paletaOscura.fondo);
  });
});

describe("botón de apariencia y su menú (CA-1)", () => {
  async function montar() {
    await render(
      <ProveedorDeApariencia>
        <BotonDeApariencia />
        <Espia />
      </ProveedorDeApariencia>,
    );
    await act(async () => {});
  }

  it("el nombre accesible dice el modo y el menú marca la opción actual", async () => {
    await montar();
    const boton = screen.getByTestId("abrir-apariencia");
    expect(boton.props.accessibilityLabel).toBe("Apariencia: Sistema");
    expect(boton.props.accessibilityRole).toBe("button");
    expect(screen.queryByTestId("menu-apariencia")).toBeNull();

    await fireEvent.press(boton);
    expect(screen.getByTestId("menu-apariencia")).toBeTruthy();
    expect(OPCIONES_DE_APARIENCIA.map((o) => o.texto)).toEqual(["Claro", "Oscuro", "Sistema"]);
    expect(screen.getByTestId("apariencia-sistema").props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId("apariencia-claro").props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByTestId("apariencia-oscuro").props.accessibilityState).toEqual({ selected: false });

    await fireEvent.press(screen.getByTestId("apariencia-oscuro"));
    expect(screen.queryByTestId("menu-apariencia")).toBeNull();
    expect(screen.getByTestId("abrir-apariencia").props.accessibilityLabel).toBe("Apariencia: Oscuro");

    await fireEvent.press(screen.getByTestId("abrir-apariencia"));
    expect(screen.getByTestId("apariencia-oscuro").props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByTestId("apariencia-claro"));
    expect(espia()).toBe(`claro|claro|${paletaClara.fondo}`);
    expect(nombreDelBotonDeApariencia("claro")).toBe("Apariencia: Claro");
  });

  it("«Cerrar» y Atrás cierran el menú sin cambiar el modo", async () => {
    await montar();
    await fireEvent.press(screen.getByTestId("abrir-apariencia"));
    await fireEvent.press(screen.getByTestId("cerrar-apariencia"));
    expect(screen.queryByTestId("menu-apariencia")).toBeNull();
    expect(espia()).toBe(`sistema|claro|${paletaClara.fondo}`);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("el ícono del botón es el de cada modo: sol, luna o automático (O-4)", async () => {
    await montar();
    const icono = () => within(screen.getByTestId("abrir-apariencia")).getByText(/./, { includeHiddenElements: true });
    expect(icono().props.children).toBe("brightness-auto");
    for (const [id, nombre] of [
      ["claro", "white-balance-sunny"],
      ["oscuro", "weather-night"],
      ["sistema", "brightness-auto"],
    ]) {
      await fireEvent.press(screen.getByTestId("abrir-apariencia"));
      await fireEvent.press(screen.getByTestId(`apariencia-${id}`));
      expect(icono().props.children).toBe(nombre);
    }
  });

  it("las opciones tienen el área táctil mínima", async () => {
    const { AREA_TACTIL } = require("../src/tema/colores");
    await montar();
    await fireEvent.press(screen.getByTestId("abrir-apariencia"));
    for (const id of ["claro", "oscuro", "sistema"]) {
      const opcion = screen.getByTestId(`apariencia-${id}`);
      const estilo = StyleSheet.flatten(
        typeof opcion.props.style === "function" ? opcion.props.style({ pressed: false }) : opcion.props.style,
      );
      expect(estilo.minHeight).toBeGreaterThanOrEqual(AREA_TACTIL);
    }
  });

  it("el menú va debajo del botón medido; sin medida, debajo de la cabecera (P3-4)", () => {
    expect(posicionDelMenu({ x: 260, y: 30, ancho: 48, alto: 48 }, 360, 76)).toEqual({ top: 82, right: 52 });
    expect(posicionDelMenu({ x: 320, y: 30, ancho: 48, alto: 48 }, 360, 76)).toEqual({ top: 82, right: 8 });
    expect(posicionDelMenu(null, 360, 76)).toEqual({ top: 76, right: 8 });
    expect(posicionDelMenu({ x: 0, y: 0, ancho: 0, alto: 0 }, 360, 76)).toEqual({ top: 76, right: 8 });
    expect(posicionDelMenu({ x: NaN, y: 0, ancho: 48, alto: 48 }, 360, 76)).toEqual({ top: 76, right: 8 });
  });
});

describe("lo nativo (CA-6, ronda QA)", () => {
  it("el fondo raíz y la barra de navegación de Android siguen el modo", async () => {
    await renderEnOscuro(<BarrasDelSistema />);
    expect(SystemUI.setBackgroundColorAsync).toHaveBeenLastCalledWith(paletaOscura.fondo);
    expect(screen.getByTestId("barra-de-navegacion").props.style).toBe("light");
    await screen.unmount();
    olvidarApariencia();

    await render(
      <ProveedorDeApariencia>
        <BarrasDelSistema />
      </ProveedorDeApariencia>,
    );
    await act(async () => {});
    expect(SystemUI.setBackgroundColorAsync).toHaveBeenLastCalledWith(paletaClara.fondo);
    expect(screen.getByTestId("barra-de-navegacion").props.style).toBe("dark");
  });

  it("cerrar sesión conserva la apariencia elegida (O-3)", async () => {
    await almacen.guardarApariencia("oscuro");
    await almacen.guardarTokens("a", "r");
    await almacen.borrarSesion();
    expect(SecureStore.__datos.get("ilce_apariencia")).toBe("oscuro");
    expect(SecureStore.__datos.has("ilce_access")).toBe(false);
    expect(await almacen.leerApariencia()).toBe("oscuro");
  });
});

describe("pantallas en oscuro, sin colores claros fijos (CA-5)", () => {
  it("la lista de colores solo claros no incluye los que comparten las dos paletas", () => {
    expect(COLORES_SOLO_CLAROS.has("#F4F4F4")).toBe(true);
    expect(COLORES_SOLO_CLAROS.has("#1E1E1E")).toBe(true);
    expect(COLORES_SOLO_CLAROS.has("#FCE200")).toBe(false);
  });

  it("el detector sí encuentra los colores claros cuando la pantalla está en claro", async () => {
    const vista = await render(
      <>
        <Boton titulo="Guardar" onPress={() => {}} />
        <Vacio texto="Nada por aquí" />
      </>,
    );
    const claros = coloresClarosEn(vista.toJSON()).map((c) => c.valor.toUpperCase());
    expect(claros).toEqual(expect.arrayContaining([paletaClara.primario.toUpperCase(), paletaClara.tintaTenue.toUpperCase()]));
  });

  it("botones, avisos, vacíos, errores y la carga", async () => {
    const vista = await renderEnOscuro(
      <>
        <Boton titulo="Guardar" onPress={() => {}} />
        <Boton titulo="Cancelar" variante="secundario" onPress={() => {}} />
        <Boton titulo="Cerrar" variante="peligro" onPress={() => {}} />
        <Alerta texto="Se guardó" tipo="bien" />
        <Alerta texto="Ojo" tipo="aviso" />
        <Alerta texto="Dato" tipo="info" />
        <Vacio texto="Nada por aquí" />
        <ErrorConReintento texto="Sin conexión" onReintentar={() => {}} />
        <Cargando />
      </>,
    );
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
    const guardar = screen.getByText("Guardar");
    expect(StyleSheet.flatten(guardar.props.style).color).toBe(paletaOscura.sobrePrimario);
  });

  it("los botones redondos: ícono -200 sobre su -950 con el anillo -300 (ronda QA)", async () => {
    const { COLORES_DE_MODULO_OSCURO: oscuros } = require("../src/tema/familias");
    const vista = await renderEnOscuro(<BotonRedondo icono="headset" nombre="Mesa" familia="soporte" onPress={() => {}} />);
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
    expect(StyleSheet.flatten(screen.getByTestId("icono-headset").props.style).color).toBe(oscuros.soporte.icono);
    // El círculo: el primer contenedor con fondo por encima del ícono.
    let circulo = screen.getByTestId("icono-headset").parent;
    while (circulo && !StyleSheet.flatten(circulo.props.style)?.backgroundColor) circulo = circulo.parent;
    const estilo = StyleSheet.flatten(circulo.props.style);
    expect(estilo.backgroundColor).toBe(oscuros.soporte.fondo);
    expect(estilo.borderColor).toBe(oscuros.soporte.borde);
  });

  it("la ventana de un formulario", async () => {
    const vista = await renderEnOscuro(
      <Ventana titulo="Registrar" subtitulo="Paso 1" onCerrar={() => {}}>
        <Text>Contenido</Text>
      </Ventana>,
    );
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
  });

  it("el inicio de sesión respeta lo elegido y usa el logotipo en negativo (CA-2 y CA-7)", async () => {
    const vista = await renderEnOscuro(<Login />);
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
    expect(screen.getByTestId("logotipo-laarcourier").props.source).toBe(
      require("../assets/marca/laarcourier-negativo.png"),
    );
  });

  it("en claro, el inicio de sesión sigue con el logotipo en positivo (CA-8)", async () => {
    await render(
      <ProveedorDeApariencia>
        <Login />
      </ProveedorDeApariencia>,
    );
    await act(async () => {});
    expect(screen.getByTestId("logotipo-laarcourier").props.source).toBe(
      require("../assets/marca/laarcourier-positivo.png"),
    );
  });

  it("una notificación sin leer: su módulo en oscuro y el contador sin blanco fijo", async () => {
    const vista = await renderEnOscuro(
      <ElementoNotificacion
        notificacion={{
          id: 3,
          modulo: "soporte",
          modulo_nombre: "Mesa de ayuda",
          icono: "headset",
          titulo: "Le asignaron un ticket",
          resumen: "Ticket #55",
          leida: false,
          created_at: new Date().toISOString(),
        }}
        onAbrir={() => {}}
      />,
    );
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
    expect(StyleSheet.flatten(screen.getByTestId("icono-3").props.style).backgroundColor).toBe(
      COLORES_DE_MODULO_OSCURO.soporte.fondo,
    );
    expect(StyleSheet.flatten(screen.getByText("Mesa de ayuda").props.style).color).toBe("#000000");
  });

  it("los tonos, estados y tipos de los módulos salen del modo que se ve", async () => {
    await renderEnOscuro(<Espia />);
    expect(TONOS.neutro).toEqual({ fondo: paletaOscura.hundido, color: paletaOscura.tintaSuave });
    expect(estadoDe({ estado: "aprobada" }).fondo).toBe(paletaOscura.bienFondo);
    expect(estadoDe({ estado: "otro" }).color).toBe(paletaOscura.tintaSuave);
    expect(tipoDe({ tipo: "feriado" }).color).toBe(paletaOscura.malTexto);
  });

  it("el «tirar para actualizar» en oscuro usa el amarillo sobre la superficie; en claro, el negro sobre blanco (CA-6)", async () => {
    // El doble de `RefreshControl` guarda la última instancia con sus props.
    const { RefreshControl } = require("react-native");
    const vista = await renderEnOscuro(<Refresco refreshing={false} onRefresh={() => {}} />);
    expect(RefreshControl.latestRef.props.colors).toEqual([paletaOscura.acento]);
    expect(RefreshControl.latestRef.props.progressBackgroundColor).toBe(paletaOscura.superficie);
    expect(RefreshControl.latestRef.props.tintColor).toBe(paletaOscura.tinta);
    await vista.unmount();
    olvidarApariencia();

    await render(<Refresco refreshing={false} onRefresh={() => {}} />);
    // Nunca sin colores: quitarlos al cambiar de modo cerraba la app en Android.
    expect(RefreshControl.latestRef.props.colors).toEqual([paletaClara.primario]);
    expect(RefreshControl.latestRef.props.progressBackgroundColor).toBe(paletaClara.superficie);
    expect(RefreshControl.latestRef.props.refreshing).toBe(false);
  });
});

describe("selector de fecha (CA-6)", () => {
  it("la rueda de iOS sigue el modo", async () => {
    const { Platform } = require("react-native");
    const original = Platform.OS;
    Platform.OS = "ios";
    try {
      const { SelectorFecha } = require("../src/componentes/SelectorFecha");
      await renderEnOscuro(<SelectorFecha etiqueta="Desde" modo="date" valor="2026-11-17" onCambio={() => {}} testID="desde" />);
      await fireEvent.press(screen.getByTestId("desde"));
      await waitFor(() => expect(screen.getByTestId("selector-nativo").props.themeVariant).toBe("dark"));
    } finally {
      Platform.OS = original;
    }
  });
});
