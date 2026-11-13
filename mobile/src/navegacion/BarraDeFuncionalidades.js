import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, Text, View } from "react-native";

import { FilaDeslizable } from "../componentes/FilaDeslizable";
import { Icono } from "../componentes/Icono";
import { AREA_TACTIL, colores } from "../tema/colores";
import { CONTROLES } from "../tema/controles";
import { crearEstilos } from "../tema/tipografia";
import { abrirFuncionalidad, recordarPantalla } from "./abrir";
import { funcionalidadesVisibles, moduloDePantalla, nombreAccesible, vistaActiva, vistasDelEstado } from "./modulos";
import { useContextoDeNavegacion } from "./useContextoDeNavegacion";

export { vistasDelEstado };

/**
 * Con el teclado abierto la barra se aparta: no tapa el campo ni le quita
 * alto a la pantalla. En iOS, con los eventos «Will» (H-15), para que se
 * aparte a la vez que sube el teclado; Android solo tiene los «Did».
 */
function useTecladoAbierto() {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const mostrar = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setAbierto(true));
    const ocultar = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setAbierto(false));
    return () => {
      mostrar.remove();
      ocultar.remove();
    };
  }, []);
  return abierto;
}

/**
 * La navegación de la pantalla activa dentro de las pestañas. En
 * expo-router 58 `tabBar` NO recibe `navigation` (`BottomTabView` le pasa
 * `{ state, descriptors, emitter, navigateToTab, insets }`): se toma la del
 * descriptor de la ruta activa, que sabe ir a otra pestaña (P1 de la ronda 1).
 */
export function navegacionActiva(state, descriptors) {
  const clave = state?.routes?.[state.index]?.key;
  return clave ? descriptors?.[clave]?.navigation : undefined;
}

/** Un botón de la barra: vista (pestaña) o acción (botón con contorno). */
function Elemento({ f, seleccionada, comoPestana, onPress, onLayout }) {
  const accion = f.tipo !== "vista";
  const color = seleccionada ? colores.marcaNegro : accion ? colores.sobreCabecera : colores.tintaInactivaOscuro;
  return (
    <Pressable
      testID={`funcion-${f.id}`}
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole={comoPestana ? "tab" : "button"}
      accessibilityState={comoPestana ? { selected: seleccionada } : undefined}
      accessibilityLabel={nombreAccesible(f, f.cuenta)}
      accessibilityHint={accion ? "Abre una pantalla nueva" : undefined}
      style={({ pressed }) => [
        estilos.elemento,
        accion && estilos.elementoAccion,
        seleccionada && estilos.elementoActivo,
        pressed && !seleccionada && estilos.presionado,
      ]}
    >
      <Icono nombre={f.icono} size={22} color={color} />
      <Text style={[estilos.texto, accion && estilos.textoAccion, seleccionada && estilos.textoActivo]}>{f.texto}</Text>
      {f.cuenta > 0 ? (
        <View style={CONTROLES.insignia} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text style={estilos.insigniaTexto}>{f.cuenta > 99 ? "99+" : f.cuenta}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Las funcionalidades de UN módulo. Va con `key` por módulo (H-08): al
 * cambiar de módulo la fila empieza desde el principio, y las posiciones
 * llevan el id del módulo en su clave.
 */
function FilaDelModulo({ modulo, elementos, activa, onElegir }) {
  const fila = useRef(null);
  const posiciones = useRef({});
  const clave = (id) => `${modulo.id}:${id}`;

  useEffect(() => {
    if (activa) fila.current?.mostrar(posiciones.current[clave(activa)]);
  }, [activa]); // eslint-disable-line react-hooks/exhaustive-deps

  // H-04: las vistas, en un grupo de pestañas; las acciones, al final (como
  // pidió el usuario), en una barra de herramientas aparte, tras un divisor.
  // Cada grupo conserva el orden del catálogo.
  const vistas = elementos.filter((f) => f.tipo === "vista");
  const acciones = elementos.filter((f) => f.tipo !== "vista");

  function pintar(f, comoPestana) {
    const seleccionada = comoPestana && f.id === activa;
    return (
      <Elemento
        key={f.id}
        f={f}
        seleccionada={seleccionada}
        comoPestana={comoPestana}
        onPress={() => onElegir(f)}
        onLayout={(e) => {
          posiciones.current[clave(f.id)] = e.nativeEvent.layout.x;
          if (seleccionada) fila.current?.mostrar(e.nativeEvent.layout.x);
        }}
      />
    );
  }

  return (
    <FilaDeslizable ref={fila} fondo={colores.cabecera} contentContainerStyle={estilos.fila} testID="barra-desplazable">
      {vistas.length > 0 ? (
        <View
          style={estilos.grupo}
          accessibilityRole="tablist"
          accessibilityLabel={`Vistas de ${modulo.texto}`}
          testID="grupo-vistas"
        >
          {vistas.map((f) => pintar(f, true))}
        </View>
      ) : null}
      {vistas.length > 0 && acciones.length > 0 ? <View style={estilos.divisor} testID="divisor" /> : null}
      {acciones.length > 0 ? (
        <View
          style={estilos.grupo}
          accessibilityRole="toolbar"
          accessibilityLabel={`Acciones de ${modulo.texto}`}
          testID="grupo-acciones"
        >
          {acciones.map((f) => pintar(f, false))}
        </View>
      ) : null}
    </FilaDeslizable>
  );
}

/**
 * La barra flotante de abajo (US-016, CA-2 a CA-4): redondeada, oscura como
 * la de Uber y la cabecera de la marca, con sombra y separada de los bordes y
 * del área segura. Trae siempre las funcionalidades del módulo activo (el
 * Inicio es una de Institucional). Se desliza de lado si no caben, con el desvanecido y
 * el chevron de `FilaDeslizable` en el borde con contenido oculto (H-02).
 *
 * - La vista activa va sobre amarillo #FCE200 con el texto negro en negrita
 *   (16,0:1): cambia la forma y el peso, no solo el color. Las demás vistas,
 *   texto #C8C8C8 sobre #1E1E1E (10,0:1).
 * - Las acciones llevan contorno y texto blanco, sin relleno (H-04).
 * - Va en el flujo, debajo de la pantalla (es la `tabBar` de `(tabs)`): el
 *   último elemento de una lista nunca queda tapado.
 * - Con la letra al 200 % cada botón sigue en una fila (ícono y texto lado a
 *   lado) y la barra no pasa de ~80 dp (CA-10).
 *
 * Recibe las props REALES de `tabBar` en expo-router 58: `state`,
 * `descriptors`, `emitter`, `navigateToTab` e `insets` (sin `navigation`).
 */
export function BarraDeFuncionalidades({ state, descriptors, insets }) {
  const router = useRouter();
  const teclado = useTecladoAbierto();
  const ruta = state?.routes?.[state.index];
  const modulo = moduloDePantalla(ruta?.name);
  const contexto = useContextoDeNavegacion(vistasDelEstado(state));
  const elementos = funcionalidadesVisibles(modulo, contexto);
  const activa = vistaActiva(modulo, ruta, contexto);

  // Institucional tiene dos pantallas: al volver a él, a la última.
  useEffect(() => {
    recordarPantalla(modulo, ruta?.name);
  }, [modulo, ruta?.name]);

  if (teclado || elementos.length === 0) return null;

  function elegir(f) {
    const navigation = navegacionActiva(state, descriptors);
    abrirFuncionalidad({ navigation, router, funcionalidad: f });
  }

  return (
    <View
      style={[estilos.contenedor, { paddingBottom: Math.max(insets?.bottom ?? 0, 0) + 10 }]}
      testID="barra-de-funcionalidades"
    >
      <View style={estilos.barra}>
        <View style={estilos.recorte}>
          <FilaDelModulo key={modulo.id} modulo={modulo} elementos={elementos} activa={activa} onElegir={elegir} />
        </View>
      </View>
    </View>
  );
}

const estilos = crearEstilos({
  // El fondo de las pantallas de los módulos: la barra parece flotar sobre él.
  contenedor: { backgroundColor: colores.fondo, paddingHorizontal: 12, paddingTop: 6 },
  barra: {
    backgroundColor: colores.cabecera,
    borderRadius: 28,
    // La sombra de las tarjetas de la marca, más marcada: la barra flota.
    elevation: 8,
    shadowColor: colores.marcaNegro,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  // El recorte va aparte: con `overflow` en la misma vista, iOS no pinta la
  // sombra.
  recorte: { borderRadius: 28, overflow: "hidden" },
  fila: { padding: 6, gap: 6, alignItems: "center" },
  grupo: { flexDirection: "row", alignItems: "center", gap: 4 },
  // Entre las vistas y las acciones: #767676 sobre #1E1E1E (3,9:1).
  divisor: { width: 1, alignSelf: "stretch", marginVertical: 8, backgroundColor: colores.bordeControl },
  elemento: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 24,
    // El borde ocupa siempre su sitio: vistas y acciones miden lo mismo.
    borderWidth: 1,
    borderColor: "transparent",
  },
  // Contorno #C8C8C8 sobre #1E1E1E (10,0:1), sin relleno.
  elementoAccion: { borderColor: colores.tintaInactivaOscuro },
  elementoActivo: { backgroundColor: colores.acento, borderColor: colores.acento },
  presionado: { backgroundColor: colores.presionadoOscuro },
  texto: { fontSize: 14, fontWeight: "500", color: colores.tintaInactivaOscuro },
  // Blanco sobre #1E1E1E: 16,7:1.
  textoAccion: { color: colores.sobreCabecera },
  textoActivo: { fontWeight: "700", color: colores.marcaNegro },
  insigniaTexto: { ...CONTROLES.insigniaTexto },
});
