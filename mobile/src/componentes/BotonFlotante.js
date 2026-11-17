import { Pressable, StyleSheet } from "react-native";

import { useColores, useEstilos } from "../tema/apariencia";
import { Icono } from "./Icono";

/**
 * Un botón flotante redondo, abajo a la derecha de su pantalla (16/11/2026,
 * a pedido del usuario: la burbuja de «Escanear» de Gestión de Activos). Va
 * sobre el contenido, justo encima de la barra de funcionalidades: la pantalla
 * que lo pone deja ese espacio libre al final de sus listas
 * (`ESPACIO_BOTON_FLOTANTE`).
 *
 * Amarillo de la marca con el ícono negro (16,0:1) y la sombra de la barra.
 * 60 dp, por encima del área táctil mínima. La `etiqueta` es obligatoria: es
 * lo único que dice el lector de pantalla.
 */
export function BotonFlotante({ icono, etiqueta, pista, onPress, testID }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityHint={pista}
      hitSlop={6}
      style={({ pressed }) => [estilos.boton, pressed && estilos.presionado]}
    >
      <Icono nombre={icono} size={30} color={colores.marcaNegro} />
    </Pressable>
  );
}

/** Lo que una lista deja libre al final para que el botón flotante no tape
 * su última fila: el botón (60) más su margen (16) y un respiro. */
export const ESPACIO_BOTON_FLOTANTE = 96;

const fabricaDeEstilos = (colores) => StyleSheet.create({
  boton: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colores.acento,
    // Un borde negro fino: sobre el fondo claro el amarillo solo no llega a
    // 3:1 (WCAG 1.4.11, contraste de los componentes).
    borderWidth: 2,
    borderColor: colores.marcaNegro,
    elevation: 8,
    shadowColor: colores.marcaNegro,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  presionado: { opacity: 0.85, transform: [{ scale: 0.96 }] },
});
