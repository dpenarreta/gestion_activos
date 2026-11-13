import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useAnunciar } from "../accesibilidad/anunciar";
import { AREA_TACTIL, colores } from "../tema/colores";
import { Icono } from "./Icono";
import { crearEstilos } from "../tema/tipografia";

/**
 * Piezas comunes de la app. Ningún texto tiene alto fijo ni
 * `allowFontScaling={false}`: todo escala con el tamaño de letra del sistema
 * (hasta el 200 %) y las cajas crecen con él.
 */

export function Boton({
  titulo,
  onPress,
  variante = "primario",
  deshabilitado = false,
  cargando = false,
  icono,
  etiqueta,
  pista,
  testID,
}) {
  const inactivo = deshabilitado || cargando;
  const esPrimario = variante === "primario";
  // `sobreOscuro`: contorno y texto claros sobre el negro de la marca (el
  // visor de imágenes, N-18): 21:1.
  const sobreOscuro = variante === "sobreOscuro";
  const colorTexto = esPrimario ? colores.sobrePrimario : sobreOscuro ? colores.sobreCabecera : colores.primario;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactivo}
      accessibilityRole="button"
      accessibilityLabel={etiqueta || titulo}
      accessibilityHint={pista}
      accessibilityState={{ disabled: inactivo, busy: cargando }}
      style={({ pressed }) => [
        estilos.boton,
        esPrimario ? estilos.botonPrimario : sobreOscuro ? estilos.botonSobreOscuro : estilos.botonSecundario,
        inactivo && estilos.botonInactivo,
        pressed && !inactivo && estilos.botonPresionado,
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={colorTexto} />
      ) : (
        icono && <Icono nombre={icono} size={20} color={colorTexto} />
      )}
      <Text style={[estilos.botonTexto, { color: colorTexto }]}>{titulo}</Text>
    </Pressable>
  );
}

/**
 * Un botón con solo un ícono (auditoría UX móvil, 12/11/2026): actualizar,
 * participantes, cerrar el visor, marcar todas como leídas. La `etiqueta` es
 * obligatoria (es lo que dice el lector de pantalla) y el área táctil nunca
 * baja de `AREA_TACTIL`. `variante`: `plano` (sin borde, para cabeceras),
 * `contorno` (borde negro sobre blanco) u `oscuro` (sobre la cabecera negra).
 */
export function BotonIcono({
  icono,
  etiqueta,
  onPress,
  variante = "plano",
  color,
  cargando = false,
  deshabilitado = false,
  pista,
  testID,
  tamano = 24,
  expandido,
}) {
  const inactivo = deshabilitado || cargando;
  const colorIcono =
    color ?? (variante === "oscuro" ? colores.sobreCabecera : colores.primario);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactivo}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityHint={pista}
      // `expandido`: para el que abre opciones (el clip del chat, N-12).
      accessibilityState={
        expandido === undefined
          ? { disabled: inactivo, busy: cargando }
          : { disabled: inactivo, busy: cargando, expanded: expandido }
      }
      style={({ pressed }) => [
        estilos.botonIcono,
        variante === "contorno" && estilos.botonIconoContorno,
        inactivo && estilos.botonInactivo,
        pressed && !inactivo && estilos.botonPresionado,
      ]}
    >
      {cargando ? <ActivityIndicator color={colorIcono} /> : <Icono nombre={icono} size={tamano} color={colorIcono} />}
    </Pressable>
  );
}

/**
 * Un bloque que se abre y se cierra con su título («Más información», «Mi
 * horario de almuerzo»). El título es un botón con `expanded`, y el ícono
 * dice lo mismo sin depender del color.
 */
export function Desplegable({ titulo, abierto, onCambiar, children, testID, estiloTitulo }) {
  return (
    <View style={estilos.desplegable}>
      <Pressable
        testID={testID}
        onPress={() => onCambiar(!abierto)}
        accessibilityRole="button"
        accessibilityLabel={titulo}
        accessibilityState={{ expanded: abierto }}
        style={({ pressed }) => [estilos.desplegableTitulo, pressed && estilos.botonPresionado]}
      >
        <Text style={[estilos.desplegableTexto, estiloTitulo]}>{titulo}</Text>
        <Icono nombre={abierto ? "chevron-up" : "chevron-down"} size={22} color={colores.primario} />
      </Pressable>
      {abierto ? children : null}
    </View>
  );
}

export function Cargando({ texto = "Cargando…" }) {
  return (
    <View style={estilos.centro} accessible accessibilityRole="progressbar" accessibilityLabel={texto}>
      <ActivityIndicator size="large" color={colores.primario} />
      <Text style={estilos.textoTenue}>{texto}</Text>
    </View>
  );
}

export function Vacio({ texto, icono = "information-outline" }) {
  return (
    <View style={estilos.centro} accessible accessibilityLabel={texto}>
      <Icono nombre={icono} size={32} color={colores.tintaTenue} />
      <Text style={estilos.textoTenue}>{texto}</Text>
    </View>
  );
}

/** Un error con «Reintentar» (CA-5). Se anuncia al lector de pantalla. */
export function ErrorConReintento({ texto, onReintentar }) {
  useAnunciar(texto);
  return (
    <View style={estilos.alertaMal} accessibilityRole="alert">
      <View style={estilos.fila}>
        <Icono nombre="close-octagon-outline" size={22} color={colores.malTexto} />
        <Text style={estilos.alertaMalTexto}>{texto}</Text>
      </View>
      <Boton titulo="Reintentar" icono="refresh" variante="secundario" onPress={onReintentar} />
    </View>
  );
}

/** Cómo se ve cada tipo de aviso: color, fondo e ícono (el tipo nunca se
 * transmite solo con color). */
const TIPOS_DE_ALERTA = {
  mal: { fondo: colores.malFondo, color: colores.malTexto, icono: "close-octagon-outline" },
  aviso: { fondo: colores.avisoFondo, color: colores.avisoTexto, icono: "alert-outline" },
  info: { fondo: colores.infoFondo, color: colores.infoTexto, icono: "information-outline" },
  bien: { fondo: colores.bienFondo, color: colores.bienTexto, icono: "check-circle-outline" },
};

/**
 * Un aviso en la pantalla. Los de tipo `mal`, `aviso` y `bien` (el resultado
 * de una acción) se anuncian al lector de pantalla cuando cambia el texto.
 * `info` es parte del contenido y se lee al recorrer la pantalla, sin
 * interrumpir.
 */
export function Alerta({ texto, tipo = "aviso", clave, testID }) {
  const esAlerta = tipo !== "info";
  useAnunciar(texto, esAlerta, clave);
  const { fondo, color, icono } = TIPOS_DE_ALERTA[tipo] ?? TIPOS_DE_ALERTA.aviso;
  return (
    <View
      testID={testID}
      style={[estilos.alerta, { backgroundColor: fondo }]}
      accessibilityRole={esAlerta ? "alert" : undefined}
    >
      <Icono nombre={icono} size={22} color={color} />
      <Text style={[estilos.alertaTexto, { color }]}>{texto}</Text>
    </View>
  );
}

export const estilos = crearEstilos({
  boton: {
    minHeight: AREA_TACTIL,
    minWidth: AREA_TACTIL,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  botonPrimario: { backgroundColor: colores.primario },
  botonSecundario: {
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.primario,
  },
  botonSobreOscuro: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colores.sobreCabecera,
  },
  botonInactivo: { opacity: 0.6 },
  botonPresionado: { opacity: 0.85 },
  botonTexto: { fontSize: 16, fontWeight: "600", flexShrink: 1, textAlign: "center" },
  botonIcono: {
    minWidth: AREA_TACTIL,
    minHeight: AREA_TACTIL,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  botonIconoContorno: { borderWidth: 1, borderColor: colores.primario, backgroundColor: colores.superficie },
  desplegable: { gap: 8 },
  desplegableTitulo: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  desplegableTexto: { flex: 1, fontSize: 16, fontWeight: "600", color: colores.enlace },
  centro: { padding: 24, alignItems: "center", justifyContent: "center", gap: 12 },
  textoTenue: { color: colores.tintaTenue, fontSize: 15, textAlign: "center" },
  fila: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  alerta: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 8,
  },
  alertaTexto: { flex: 1, fontSize: 15 },
  alertaMal: {
    backgroundColor: colores.malFondo,
    padding: 12,
    borderRadius: 8,
    gap: 12,
  },
  alertaMalTexto: { flex: 1, color: colores.malTexto, fontSize: 15 },
});
