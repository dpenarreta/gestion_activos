import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { anunciar } from "../accesibilidad/anunciar";
import { AREA_TACTIL } from "../tema/colores";
import { useColores, useEstilos } from "../tema/apariencia";
import { crearEstilos } from "../tema/tipografia";
import { Icono } from "./Icono";

/**
 * Una sección en tarjeta que se abre y se cierra como un acordeón (US-032,
 * «Mi perfil»). El encabezado (ícono, título, descripción y chevron) se ve
 * siempre y es todo él un botón: tocarlo abre o cierra el contenido.
 *
 * - Arranca cerrada (`inicialAbierta`, por defecto `false`); el estado no se
 *   guarda. Solo la controla quien la usa si pasa `abierta` Y `onCambiar`
 *   (una función); si falta cualquiera de los dos, funciona sola.
 * - `aviso`: lo que debe verse aunque esté cerrada (B-1 de QA: «Le falta
 *   completar: …» en «Mis datos»). Va debajo de la descripción, fuera del
 *   botón y del contenido plegable, como un elemento propio: no cambia el
 *   nombre accesible del encabezado.
 * - Accesibilidad (CA-4): rol `button`, `expanded`, nombre con el título y la
 *   descripción, una pista para abrir y otra para cerrar, y al menos
 *   `AREA_TACTIL` de alto. El chevron (en `primario`, como `Desplegable`)
 *   dice lo mismo sin depender del color. En iOS se anuncia «Sección
 *   abierta» o «Sección cerrada» al tocarla, como `CalendarioDeRango`.
 * - El título NO lleva `accessibilityRole="header"`: va dentro del botón del
 *   CA-4, que es un solo elemento accesible con su propio rol y nombre; un
 *   encabezado anidado en un botón no se puede navegar por separado y solo
 *   confundiría el rol que se lee.
 * - `testID` va en la tarjeta (para buscar dentro con `within`); el encabezado
 *   lleva `${testID}-cabecera`, el aviso `${testID}-aviso` y el contenido
 *   `${testID}-contenido`.
 */
export function SeccionPlegable({
  icono,
  titulo,
  descripcion,
  aviso,
  children,
  testID,
  inicialAbierta = false,
  abierta: abiertaControlada,
  onCambiar,
}) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const [abiertaPropia, setAbiertaPropia] = useState(inicialAbierta);
  const controlada =
    abiertaControlada !== undefined && typeof onCambiar === "function";
  const abierta = controlada ? Boolean(abiertaControlada) : abiertaPropia;

  const alternar = () => {
    const siguiente = !abierta;
    if (!controlada) setAbiertaPropia(siguiente);
    if (typeof onCambiar === "function") onCambiar(siguiente);
    // Android ya lee el cambio de `expanded`; iOS no siempre lo dice.
    if (Platform.OS === "ios")
      anunciar(siguiente ? "Sección abierta" : "Sección cerrada");
  };

  const id = (sufijo) => (testID ? `${testID}-${sufijo}` : undefined);

  return (
    <View style={estilos.tarjeta} testID={testID}>
      <Pressable
        testID={id("cabecera")}
        onPress={alternar}
        accessibilityRole="button"
        accessibilityLabel={descripcion ? `${titulo}. ${descripcion}` : titulo}
        accessibilityHint={
          abierta ? "Toque para cerrar la sección." : "Toque para abrir la sección."
        }
        accessibilityState={{ expanded: abierta }}
        style={({ pressed }) => [estilos.cabecera, pressed && estilos.presionado]}
      >
        <View style={estilos.fila}>
          {icono ? <Icono nombre={icono} size={22} color={colores.primario} /> : null}
          <Text style={estilos.titulo}>{titulo}</Text>
          <Icono
            nombre={abierta ? "chevron-up" : "chevron-down"}
            size={24}
            color={colores.primario}
          />
        </View>
        {descripcion ? <Text style={estilos.descripcion}>{descripcion}</Text> : null}
      </Pressable>
      {aviso ? (
        <View style={estilos.aviso} testID={id("aviso")}>
          {aviso}
        </View>
      ) : null}
      {abierta ? (
        <View style={estilos.contenido} testID={id("contenido")}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

const fabricaDeEstilos = (colores) =>
  crearEstilos({
    tarjeta: {
      padding: 14,
      borderRadius: 10,
      backgroundColor: colores.superficie,
      borderWidth: 1,
      borderColor: colores.borde,
    },
    cabecera: { minHeight: AREA_TACTIL, justifyContent: "center", gap: 4 },
    presionado: { opacity: 0.85 },
    fila: { flexDirection: "row", alignItems: "center", gap: 8 },
    titulo: { flex: 1, fontSize: 17, fontWeight: "700", color: colores.tinta },
    descripcion: { fontSize: 14, color: colores.tintaTenue, flexShrink: 1 },
    aviso: { marginTop: 10 },
    contenido: { gap: 10, marginTop: 10 },
  });
