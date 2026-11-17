import { useRef, useState } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icono } from "../componentes/Icono";
import { OPCIONES_DE_APARIENCIA, opcionDeApariencia, useApariencia, useEstilos } from "../tema/apariencia";
import { AREA_TACTIL } from "../tema/colores";
import { crearEstilos } from "../tema/tipografia";

/** «Apariencia: Oscuro» (CA-1): el nombre accesible dice el modo elegido. */
export function nombreDelBotonDeApariencia(preferencia) {
  return `Apariencia: ${opcionDeApariencia(preferencia).texto}`;
}

/**
 * Dónde va el menú: justo debajo del botón y alineado a su borde derecho,
 * medido con `measureInWindow` (ronda QA, P3-4). Si no hay medida (o no es
 * válida), debajo de la cabecera a la derecha. Exportada para probarla.
 */
export function posicionDelMenu(medida, anchoVentana, respaldoTop) {
  const respaldo = { top: respaldoTop, right: 8 };
  if (!medida) return respaldo;
  const { x, y, ancho, alto } = medida;
  if (![x, y, ancho, alto].every(Number.isFinite) || ancho <= 0 || alto <= 0 || !(anchoVentana > 0)) return respaldo;
  return { top: Math.round(y + alto + 4), right: Math.max(8, Math.round(anchoVentana - (x + ancho))) };
}

/** Lo que se ve debajo de cada opción: qué hace «Sistema». */
const DETALLE = { sistema: "Igual que el teléfono" };

/**
 * El botón de apariencia de la cabecera (US-026, CA-1), junto a la campana:
 * el ícono dice el modo elegido (sol, luna o automático) y al tocarlo se abre
 * un menú pequeño con Claro, Oscuro y Sistema, la opción actual con ✓ y el
 * estado accesible `selected` (no solo el color). Con tres opciones no se
 * alterna: «Sistema» siempre está a la vista.
 *
 * `estiloBoton` y `estiloPresionado` son los de los otros botones de la
 * cabecera (48 × 48 dp en Android y 44 × 44 pt en iOS como mínimo).
 */
export function BotonDeApariencia({ estiloBoton, estiloPresionado, colorIcono }) {
  const { preferencia, elegir, colores } = useApariencia();
  const estilos = useEstilos(fabricaDeEstilos);
  const insets = useSafeAreaInsets();
  const { width: anchoVentana } = useWindowDimensions();
  const boton = useRef(null);
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState(null);
  const respaldoTop = insets.top + 52;

  // Se abre enseguida en la posición de respaldo y se acomoda en cuanto
  // llega la medida (si la plataforma no la da, se queda ahí).
  const abrir = () => {
    setPosicion(posicionDelMenu(null, anchoVentana, respaldoTop));
    setAbierto(true);
    const medir = boton.current?.measureInWindow;
    if (typeof medir !== "function") return;
    medir.call(boton.current, (x, y, ancho, alto) => {
      setPosicion(posicionDelMenu({ x, y, ancho, alto }, anchoVentana, respaldoTop));
    });
  };
  const actual = opcionDeApariencia(preferencia);

  const elegirYCerrar = (id) => {
    elegir(id);
    setAbierto(false);
  };

  return (
    <>
      <Pressable
        ref={boton}
        testID="abrir-apariencia"
        onPress={abrir}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={nombreDelBotonDeApariencia(preferencia)}
        accessibilityHint="Abre las opciones Claro, Oscuro y Sistema"
        accessibilityState={{ expanded: abierto }}
        style={({ pressed }) => [estiloBoton, pressed && estiloPresionado]}
      >
        <Icono nombre={actual.icono} size={26} color={colorIcono ?? colores.sobreCabecera} />
      </Pressable>
      <Modal
        visible={abierto}
        transparent
        animationType="fade"
        onRequestClose={() => setAbierto(false)}
        statusBarTranslucent
      >
        {/* Tocar fuera cierra el menú; el lector de pantalla tiene además
            «Cerrar» dentro del menú. */}
        <Pressable
          testID="fondo-apariencia"
          style={estilos.fondo}
          onPress={() => setAbierto(false)}
          accessible={false}
          importantForAccessibility="no"
        />
        <View
          style={[estilos.menu, posicion ?? { top: respaldoTop, right: 8 }]}
          accessibilityRole="menu"
          accessibilityLabel="Apariencia"
          testID="menu-apariencia"
        >
          <Text style={estilos.titulo} accessibilityRole="header">
            Apariencia
          </Text>
          {OPCIONES_DE_APARIENCIA.map((opcion) => {
            const elegida = opcion.id === preferencia;
            const detalle = DETALLE[opcion.id];
            return (
              <Pressable
                key={opcion.id}
                testID={`apariencia-${opcion.id}`}
                onPress={() => elegirYCerrar(opcion.id)}
                accessibilityRole="menuitem"
                accessibilityLabel={detalle ? `${opcion.texto}: ${detalle.toLowerCase()}` : opcion.texto}
                accessibilityState={{ selected: elegida }}
                style={({ pressed }) => [estilos.opcion, elegida && estilos.opcionElegida, pressed && estilos.presionada]}
              >
                <Icono nombre={opcion.icono} size={22} color={colores.tinta} />
                <View style={estilos.textos}>
                  <Text style={[estilos.texto, elegida && estilos.textoElegido]}>{opcion.texto}</Text>
                  {detalle ? <Text style={estilos.detalle}>{detalle}</Text> : null}
                </View>
                {/* ✓ en la elegida: el estado no depende solo del color. */}
                <View style={estilos.marca}>
                  {elegida ? <Icono nombre="check" size={22} color={colores.tinta} /> : null}
                </View>
              </Pressable>
            );
          })}
          <Pressable
            testID="cerrar-apariencia"
            onPress={() => setAbierto(false)}
            accessibilityRole="button"
            accessibilityLabel="Cerrar el menú de apariencia"
            style={({ pressed }) => [estilos.cerrar, pressed && estilos.presionada]}
          >
            <Text style={estilos.cerrarTexto}>Cerrar</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const fabricaDeEstilos = (colores) =>
  crearEstilos({
    fondo: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
    menu: {
      position: "absolute",
      minWidth: 240,
      maxWidth: "92%",
      paddingVertical: 6,
      borderRadius: 12,
      backgroundColor: colores.superficie,
      borderWidth: 1,
      borderColor: colores.bordeFuerte,
      shadowColor: colores.sombra,
      shadowOpacity: 0.25,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    titulo: { paddingHorizontal: 16, paddingVertical: 6, fontSize: 13, fontWeight: "700", color: colores.tintaSuave },
    opcion: {
      minHeight: AREA_TACTIL,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
    opcionElegida: { backgroundColor: colores.realce },
    presionada: { backgroundColor: colores.hundido },
    textos: { flexShrink: 1, flexGrow: 1 },
    texto: { fontSize: 16, color: colores.tinta },
    textoElegido: { fontWeight: "700" },
    detalle: { fontSize: 13, color: colores.tintaTenue },
    marca: { width: 22, alignItems: "center" },
    cerrar: {
      minHeight: AREA_TACTIL,
      justifyContent: "center",
      paddingHorizontal: 16,
      borderTopWidth: 1,
      borderTopColor: colores.borde,
      marginTop: 4,
    },
    cerrarTexto: { fontSize: 15, fontWeight: "600", color: colores.enlace },
  });
