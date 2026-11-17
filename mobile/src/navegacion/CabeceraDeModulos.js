import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icono } from "../componentes/Icono";
import { useContador } from "../notificaciones/ContadorContext";
import { AREA_TACTIL } from "../tema/colores";
import { useColores, useControles, useEstilos } from "../tema/apariencia";
import { crearEstilos } from "../tema/tipografia";
import { abrirModulo } from "./abrir";
import { BotonDeApariencia } from "./BotonDeApariencia";
import { navegacionActiva } from "./BarraDeFuncionalidades";
import { useEstadoDeModulos, useFijarAlturaCabecera } from "./EstadoDeModulos";
import { moduloDePantalla, modulosVisibles, vistasDelEstado } from "./modulos";
import { PestanasDeModulos } from "./PestanasDeModulos";
import { useContextoDeNavegacion } from "./useContextoDeNavegacion";

const LOGOTIPO_NEGATIVO = require("../../assets/marca/laarcourier-negativo.png");

export function textoDeInsignia(n) {
  return n > 99 ? "99+" : String(n);
}

/** CA-5: «Avisos: notificaciones, N sin leer». */
export function nombreDeLaCampana(noLeidas) {
  return noLeidas > 0 ? `Avisos: notificaciones, ${noLeidas} sin leer` : "Avisos: notificaciones";
}

export const NOMBRE_DE_CUENTA = "Mi perfil: sus datos, empresa y cerrar sesión";

/**
 * Un botón de la cabecera negra (Avisos y Cuenta): 48 × 48 dp como mínimo,
 * ícono blanco (16,7:1) y, si hay, la insignia roja con el número (el número
 * va también en el nombre accesible).
 */
function BotonDeCabecera({ icono, etiqueta, cuenta = 0, onPress, testID }) {
  const colores = useColores();
  const CONTROLES = useControles();
  const estilos = useEstilos(fabricaDeEstilos);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [estilos.boton, pressed && estilos.presionado]}
    >
      <Icono nombre={icono} size={26} color={colores.sobreCabecera} />
      {cuenta > 0 ? (
        <View
          style={[CONTROLES.insignia, estilos.insignia]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <Text style={estilos.insigniaTexto}>{textoDeInsignia(cuenta)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * La cabecera de los módulos (US-016, CA-1 y CA-5): a la izquierda, el
 * logotipo LAARCOURIER en negativo; a la derecha, la apariencia (US-026), la
 * campana con las no leídas y la Cuenta, en cualquier módulo. Es negra en los
 * dos modos (en oscuro, el negro del menú de la web). Debajo, las pestañas de los
 * módulos.
 *
 * El logotipo va a 192 × 32 dp (H-07): el Brand Book pide al menos 3 cm de
 * ancho, que son ~189 dp (1 dp = 1/160 de pulgada; 3 cm = 1,18 pulgadas). Sin
 * deformar (709 × 118) y con el aire de la cabecera como área de protección.
 * Es una imagen: con la letra al 200 % no se corta en 360 dp.
 *
 * Hay UNA sola, en el layout de `(tabs)` y fuera de las pantallas (P1 de la
 * ronda 2: con una por pantalla, los toques caían en la de una pantalla sin
 * foco; véase `EstadoDeModulos.js`). El estado de las pestañas y la
 * navegación los publica la `tabBar` (`useEstadoDeModulos`): con ellos pasa a
 * otra pestaña, lee las vistas de cada módulo (O-2) y vuelve a mostrar la
 * pestaña activa al cambiar de pantalla (H-05). Mide su alto para
 * `useAlturaCabecera` (las vistas con teclado).
 */
export function CabeceraDeModulos() {
  const estilos = useEstilos(fabricaDeEstilos);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { noLeidas } = useContador();
  const estado = useEstadoDeModulos();
  const fijarAltura = useFijarAlturaCabecera();
  const state = estado?.state;
  const navigation = navegacionActiva(state, estado?.descriptors);
  const route = state?.routes?.[state.index];
  const contexto = useContextoDeNavegacion(vistasDelEstado(state));
  const modulos = useMemo(() => modulosVisibles(contexto), [contexto]);
  const actual = moduloDePantalla(route?.name) ?? modulos[0];
  const onElegir = useCallback((m) => navigation && abrirModulo(navigation, m), [navigation]);

  return (
    <View
      style={[estilos.cabecera, { paddingTop: insets.top }]}
      onLayout={(e) => fijarAltura(e.nativeEvent.layout.height)}
      testID="cabecera-de-modulos"
    >
      <View style={estilos.fila}>
        <View style={estilos.marca}>
          <Image
            source={LOGOTIPO_NEGATIVO}
            style={estilos.logotipo}
            resizeMode="contain"
            accessible
            accessibilityRole="header"
            accessibilityLabel={`LAARCOURIER · ${actual?.texto ?? "Inicio"}`}
          />
        </View>
        {/* US-026: Claro, Oscuro o Sistema, junto a la campana. */}
        <BotonDeApariencia estiloBoton={estilos.boton} estiloPresionado={estilos.presionado} />
        <BotonDeCabecera
          testID="abrir-avisos"
          icono={noLeidas > 0 ? "bell-badge-outline" : "bell-outline"}
          etiqueta={nombreDeLaCampana(noLeidas)}
          cuenta={noLeidas}
          onPress={() => router.push("/notificaciones")}
        />
        <BotonDeCabecera
          testID="abrir-cuenta"
          icono="account-circle-outline"
          etiqueta={NOMBRE_DE_CUENTA}
          onPress={() => router.push("/cuenta")}
        />
      </View>
      <PestanasDeModulos modulos={modulos} activo={actual?.id} onElegir={onElegir} foco={route?.key} />
    </View>
  );
}

const fabricaDeEstilos = (colores, CONTROLES) => crearEstilos({
  cabecera: { backgroundColor: colores.cabecera },
  // US-026: con el botón de apariencia son tres botones de 48 dp; sin
  // espacio entre ellos, el logotipo sigue en 192 dp en un teléfono de 360 dp
  // (16 + 192 + 4 + 3 × 48 + 4). En uno más angosto se achica sin cortarse.
  fila: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 4,
    minHeight: 56,
  },
  marca: { flex: 1, justifyContent: "center", marginRight: 4 },
  logotipo: { width: 192, maxWidth: "100%", height: 32 },
  boton: {
    minWidth: AREA_TACTIL,
    minHeight: AREA_TACTIL,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: AREA_TACTIL / 2,
  },
  presionado: { backgroundColor: colores.presionadoOscuro },
  insignia: { position: "absolute", top: 2, right: 0 },
  insigniaTexto: { ...CONTROLES.insigniaTexto },
});
