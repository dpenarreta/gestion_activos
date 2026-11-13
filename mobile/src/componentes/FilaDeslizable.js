import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import { useMenosMovimiento } from "../accesibilidad/useMenosMovimiento";
import { colores } from "../tema/colores";
import { crearEstilos } from "../tema/tipografia";
import { Icono } from "./Icono";

/** Las capas del desvanecido, del borde hacia dentro (sin dependencias de
 * degradados: cuatro franjas del color del fondo cada vez más transparentes). */
const CAPAS = [1, 0.8, 0.5, 0.2];
const ANCHO_CAPA = 9;
/** Lo que se deja a la izquierda de un elemento al desplazarlo hasta él. */
export const MARGEN_AL_DESPLAZAR = 24;
/** Tolerancia para decir que se llegó a un extremo. */
const HOLGURA = 2;

/** Qué bordes tienen contenido oculto. Exportada para probarla sola. */
export function bordesOcultos({ desplazamiento = 0, ancho = 0, contenido = 0 }) {
  return {
    inicio: desplazamiento > HOLGURA,
    fin: ancho > 0 && desplazamiento + ancho < contenido - HOLGURA,
  };
}

function Desvanecido({ lado, fondo, colorChevron }) {
  // Del borde hacia dentro: en la derecha, las capas van al revés.
  const capas = lado === "inicio" ? CAPAS : [...CAPAS].reverse();
  return (
    <View
      testID={`desvanecido-${lado}`}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[estilos.desvanecido, lado === "inicio" ? estilos.izquierda : estilos.derecha]}
    >
      {capas.map((opacidad, i) => (
        <View key={i} style={[estilos.capa, { backgroundColor: fondo, opacity: opacidad }]} />
      ))}
      <View style={[estilos.chevron, lado === "inicio" ? estilos.chevronIzquierda : estilos.chevronDerecha]}>
        <Icono nombre={lado === "inicio" ? "chevron-left" : "chevron-right"} size={20} color={colorChevron} />
      </View>
    </View>
  );
}

/**
 * Una fila que se desliza de lado (US-016, H-01 y H-02): las pestañas de los
 * módulos y la barra de funcionalidades. En el borde que tiene contenido
 * oculto se ve un desvanecido con un chevron, que desaparece al llegar al
 * final: así se sabe que hay más sin tener que probar.
 *
 * - `fondo`: el color sobre el que va la fila (el desvanecido lo imita).
 * - `ref.mostrar(x)`: desplaza hasta `x` (menos un margen), sin animación si
 *   el sistema pide menos movimiento (H-16).
 * - El resto (`accessibilityRole`, `testID`…) va al `ScrollView`.
 */
export const FilaDeslizable = forwardRef(function FilaDeslizable(
  {
    children,
    fondo = colores.cabecera,
    colorChevron = colores.tintaInactivaOscuro,
    style,
    contentContainerStyle,
    ...resto
  },
  ref,
) {
  const desplazable = useRef(null);
  const menosMovimiento = useMenosMovimiento();
  const [medidas, setMedidas] = useState({ desplazamiento: 0, ancho: 0, contenido: 0 });

  useImperativeHandle(
    ref,
    () => ({
      mostrar(x) {
        if (typeof x !== "number") return;
        desplazable.current?.scrollTo?.({ x: Math.max(0, x - MARGEN_AL_DESPLAZAR), animated: !menosMovimiento });
      },
    }),
    [menosMovimiento],
  );

  const fijar = useCallback((cambios) => {
    setMedidas((m) => {
      const nuevas = { ...m, ...cambios };
      return nuevas.desplazamiento === m.desplazamiento && nuevas.ancho === m.ancho && nuevas.contenido === m.contenido
        ? m
        : nuevas;
    });
  }, []);

  const bordes = bordesOcultos(medidas);
  return (
    <View style={[estilos.marco, style]}>
      <ScrollView
        ref={desplazable}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(e) => fijar({ desplazamiento: e.nativeEvent.contentOffset.x })}
        onLayout={(e) => fijar({ ancho: e.nativeEvent.layout.width })}
        onContentSizeChange={(ancho) => fijar({ contenido: ancho })}
        contentContainerStyle={contentContainerStyle}
        {...resto}
      >
        {children}
      </ScrollView>
      {bordes.inicio ? <Desvanecido lado="inicio" fondo={fondo} colorChevron={colorChevron} /> : null}
      {bordes.fin ? <Desvanecido lado="fin" fondo={fondo} colorChevron={colorChevron} /> : null}
    </View>
  );
});

const estilos = crearEstilos({
  marco: { flexGrow: 0 },
  desvanecido: { position: "absolute", top: 0, bottom: 0, flexDirection: "row", width: CAPAS.length * ANCHO_CAPA },
  izquierda: { left: 0 },
  derecha: { right: 0 },
  capa: { width: ANCHO_CAPA },
  chevron: { position: "absolute", top: 0, bottom: 0, justifyContent: "center" },
  chevronIzquierda: { left: 0 },
  chevronDerecha: { right: 0 },
});
