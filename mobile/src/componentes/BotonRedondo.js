import { Pressable, Text, View, useWindowDimensions } from "react-native";

import { coloresDeFamilia } from "../notificaciones/coloresDeModulo";
import { AREA_TACTIL, colores } from "../tema/colores";
import { crearEstilos } from "../tema/tipografia";
import { Icono } from "./Icono";

/**
 * Un botón redondo: el ícono en un círculo con el color de su módulo y el
 * nombre debajo (los accesos de Inicio, 16/11/2026). Lo que sale de la app
 * (`navegador`) lleva la marca negra de «se abre en el navegador» en el
 * círculo y se anuncia como enlace (16/11/2026, a pedido del usuario: «todas
 * estas opciones que saquen de la aplicación se van a realizar de esa
 * forma»). `familia`: la del color (`soporte`, `matriz`…; ver
 * `coloresDeModulo`), o `color` ya resuelto (`{icono, fondo}`). `ancho`: el de su columna en una `CuadriculaRedonda`.
 */
export function BotonRedondo({
  icono,
  nombre,
  familia,
  color: colorPropio,
  navegador = false,
  onPress,
  etiqueta,
  pista,
  testID,
  ancho,
}) {
  const color = colorPropio ?? coloresDeFamilia(familia);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole={navegador ? "link" : "button"}
      accessibilityLabel={etiqueta ?? (navegador ? `${nombre}. Abrir en el navegador` : nombre)}
      accessibilityHint={pista}
      style={({ pressed }) => [estilos.boton, ancho ? { width: ancho } : estilos.suelto, pressed && estilos.presionado]}
    >
      <View style={[estilos.circulo, { backgroundColor: color.fondo }]}>
        <Icono nombre={icono} size={28} color={color.icono} />
        {navegador ? (
          <View style={estilos.marcaNavegador}>
            <Icono nombre="open-in-new" size={12} color={colores.sobrePrimario} />
          </View>
        ) : null}
      </View>
      <Text style={estilos.nombre}>{nombre}</Text>
    </Pressable>
  );
}

/** Las columnas de una cuadrícula de botones redondos: 4, o 3 con la letra
 * grande (más del 130 %), cuando los nombres ya no entran. */
export function useColumnasRedondas(maximo = 4) {
  const { fontScale } = useWindowDimensions();
  return fontScale > 1.3 ? Math.min(3, maximo) : maximo;
}

/** Varios botones redondos en cuadrícula. `children` es una función que
 * recibe el ancho de cada columna. `columnas`: 3 donde los nombres son largos
 * («Configuración de la mesa» no entra en una de cuatro sin partir la
 * palabra). */
export function CuadriculaRedonda({ children, testID, columnas: maximo = 4 }) {
  const columnas = useColumnasRedondas(maximo);
  return (
    <View style={estilos.cuadricula} testID={testID}>
      {children(`${100 / columnas}%`)}
    </View>
  );
}

const estilos = crearEstilos({
  cuadricula: { flexDirection: "row", flexWrap: "wrap", rowGap: 12 },
  boton: {
    minHeight: AREA_TACTIL,
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderRadius: 12,
  },
  // Uno solo, sin cuadrícula: del ancho de una columna de cuatro, a la izquierda.
  suelto: { alignSelf: "flex-start", minWidth: 96, maxWidth: 140 },
  presionado: { backgroundColor: colores.realce },
  // El fondo lo pone el color del módulo.
  circulo: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  marcaNavegador: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colores.primario,
    borderWidth: 2,
    borderColor: colores.fondo,
    alignItems: "center",
    justifyContent: "center",
  },
  nombre: {
    fontSize: 13,
    fontWeight: "600",
    color: colores.tinta,
    textAlign: "center",
  },
});
