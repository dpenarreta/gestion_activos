import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import { Icono } from "../../componentes/Icono";
import {
  cumplimientoDeLaOrden,
  estadoDeLaOrden,
  muestraCumplimiento,
  nombreDeFila,
  prioridadDeLaOrden,
  sedeDe,
  textoDeProgramada,
} from "../../ordenes/formato";
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { fechaCorta } from "../../utils/fechas";
import { Pildora } from "../soporte/piezas";

/**
 * Piezas de Órdenes de trabajo (US-025) que comparten el panel, «Mis
 * órdenes» y la ficha. El estado, la prioridad y el cumplimiento siempre
 * llevan texto e ícono, no solo color.
 */

/** La ruta de la ficha de una orden. `empresa`: la de un aviso. */
export function rutaDeLaOrden(orden, empresa) {
  const params = { id: String(orden?.id ?? orden) };
  if (empresa) params.empresa = String(empresa);
  return { pathname: "/ordenes/[id]", params };
}

export function EstadoOrden({ orden, testID }) {
  const estado = estadoDeLaOrden(orden);
  return <Pildora texto={estado.texto} tono={estado} testID={testID} />;
}

export function PrioridadOrden({ orden, testID }) {
  const prioridad = prioridadDeLaOrden(orden);
  return <Pildora texto={prioridad.texto} tono={prioridad} testID={testID} />;
}

/** Sin píldora si la orden está cerrada: ya lo dice la del estado. */
export function CumplimientoOrden({ orden, testID }) {
  if (!muestraCumplimiento(orden)) return null;
  const cumplimiento = cumplimientoDeLaOrden(orden);
  return <Pildora texto={cumplimiento.texto} tono={cumplimiento} testID={testID} />;
}

/**
 * Una orden en una lista (CA-8): el número, el estado, el título, la sede,
 * la prioridad, el cumplimiento, la fecha programada y el responsable. Toda
 * la fila es un botón con un nombre que lo dice todo. La usan también
 * «Requieren atención» del panel (UX H-01), con su `testID`.
 */
export const FilaOrden = memo(function FilaOrden({ orden, onAbrir, testID }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  return (
    <Pressable
      testID={testID ?? `orden-${orden.id}`}
      onPress={() => onAbrir(orden)}
      accessibilityRole="button"
      accessibilityLabel={nombreDeFila(orden, fechaCorta)}
      accessibilityHint="Abre la ficha de la orden"
      style={({ pressed }) => [estilos.fila, pressed && estilos.presionada]}
    >
      <View style={estilos.filaCabecera}>
        <Text style={estilos.numero}>{orden.numero}</Text>
        <EstadoOrden orden={orden} />
      </View>
      <Text style={estilos.titulo}>{orden.titulo}</Text>
      {sedeDe(orden) ? (
        <View style={estilos.linea}>
          <Icono nombre="map-marker-outline" size={18} color={colores.tintaSuave} />
          <Text style={estilos.dato}>{sedeDe(orden)}</Text>
        </View>
      ) : null}
      <View style={estilos.pildoras}>
        <PrioridadOrden orden={orden} />
        <CumplimientoOrden orden={orden} />
      </View>
      <View style={estilos.linea}>
        <Icono nombre="calendar-clock" size={18} color={colores.tintaSuave} />
        <Text style={estilos.dato}>{textoDeProgramada(orden.fecha_programada, fechaCorta)}</Text>
      </View>
      <View style={estilos.linea}>
        <Icono nombre="account-hard-hat-outline" size={18} color={colores.tintaSuave} />
        <Text style={estilos.dato}>{orden.responsable || "Sin asignar"}</Text>
      </View>
    </Pressable>
  );
});

export const fabricaDeEstilos = (colores) => crearEstilos({
  fila: {
    minHeight: AREA_TACTIL,
    padding: 14,
    gap: 6,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  presionada: { backgroundColor: colores.realce },
  filaCabecera: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  numero: { flexShrink: 1, fontSize: 14, fontWeight: "600", color: colores.tintaSuave },
  titulo: { fontSize: 16, fontWeight: "700", color: colores.titulo },
  linea: { flexDirection: "row", alignItems: "center", gap: 6 },
  dato: { flexShrink: 1, fontSize: 15, color: colores.tinta },
  pildoras: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
