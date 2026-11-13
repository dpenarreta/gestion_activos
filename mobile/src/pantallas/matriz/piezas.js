import { useRouter } from "expo-router";
import { memo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Alerta, Boton } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import {
  fechaHoraEnZona,
  matrizEnElNavegador,
  nombreDeFila,
  TEXTO_SIN_ROL,
  textoDeDias,
  tonoDeGrupo,
} from "../../matriz/formato";
import { abrirEnNavegador, TEXTO_NAVEGADOR_FALLO, urlWeb } from "../../navegador/enlaceWeb";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { Pildora } from "../soporte/piezas";

/**
 * Piezas de la Matriz de obligaciones (US-019) que comparten la Bandeja, las
 * listas, el calendario y el detalle. El estado siempre lleva texto e ícono,
 * no solo color (CA-2 y CA-9).
 */

/** El estado del período (`estado.label`: «Incumplido», «Vence hoy»,
 * «Pendiente de validación»…), con el tono de su grupo. */
export function EstadoDelPeriodo({ estado, testID }) {
  if (!estado) return null;
  return <Pildora texto={estado.label} tono={tonoDeGrupo(estado.group)} testID={testID} />;
}

/**
 * Una obligación en una lista (CA-3): el nombre, la entidad o el área, el
 * responsable, el vencimiento y el estado. Toda la fila es un botón con un
 * nombre que lo dice todo.
 */
export const FilaPeriodo = memo(function FilaPeriodo({ periodo, zona, onAbrir }) {
  const dias = textoDeDias(periodo.estado);
  const lugar = [periodo.entidad, periodo.area].filter(Boolean).join(" · ");
  return (
    <Pressable
      testID={`periodo-${periodo.id}`}
      onPress={() => onAbrir(periodo)}
      accessibilityRole="button"
      accessibilityLabel={nombreDeFila(periodo, zona)}
      accessibilityHint="Abre el detalle de la obligación"
      style={({ pressed }) => [estilos.fila, pressed && estilos.presionada]}
    >
      <View style={estilos.filaCabecera}>
        <Text style={estilos.nombre}>{periodo.obligacion?.nombre}</Text>
        <EstadoDelPeriodo estado={periodo.estado} />
      </View>
      {periodo.etiqueta || periodo.codigo ? (
        <Text style={estilos.tenue}>{[periodo.codigo, periodo.etiqueta].filter(Boolean).join(" · ")}</Text>
      ) : null}
      {lugar ? <Text style={estilos.dato}>{lugar}</Text> : null}
      <View style={estilos.linea}>
        <Icono nombre="account-outline" size={18} color={colores.tintaSuave} />
        <Text style={estilos.dato}>{periodo.responsable?.nombre ?? "Sin responsable"}</Text>
      </View>
      <View style={estilos.linea}>
        <Icono nombre="calendar-blank-outline" size={18} color={colores.tintaSuave} />
        <Text style={estilos.dato}>
          Vence el {fechaHoraEnZona(periodo.vence_en, zona)}
          {dias ? <Text style={estilos.dias}>{` · ${dias}`}</Text> : null}
        </Text>
      </View>
    </Pressable>
  );
});

/** Sin rol de la Matriz en la empresa activa (H-20, ronda 1): el aviso y la
 * salida, «Cambiar de empresa» en «Cuenta». */
export function SinRolMatriz({ texto = TEXTO_SIN_ROL }) {
  const router = useRouter();
  return (
    <View style={estilos.sinRol} testID="sin-rol-matriz">
      <Alerta tipo="info" texto={texto} />
      <Boton
        testID="ir-a-cuenta"
        titulo="Cambiar de empresa"
        icono="swap-horizontal"
        variante="secundario"
        onPress={() => router.push("/cuenta")}
      />
    </View>
  );
}

/** Lo de la Matriz que se hace en la web, abierto en el navegador del
 * teléfono con la empresa activa (decisión del usuario, 13/11/2026). */
export function MatrizEnElNavegador({ permisos, empresa }) {
  const [error, setError] = useState(null);
  const accesos = matrizEnElNavegador(permisos);
  if (accesos.length === 0) return null;
  async function abrir(ruta) {
    setError(null);
    const abierta = await abrirEnNavegador(urlWeb(ruta, { empresa }), { avisarSiFalla: false });
    if (!abierta) setError(TEXTO_NAVEGADOR_FALLO);
  }
  return (
    <View style={estilos.navegador} testID="matriz-en-el-navegador">
      <View style={estilos.linea}>
        <Text style={estilos.subtitulo} accessibilityRole="header">
          Más opciones en el navegador
        </Text>
        <Icono nombre="open-in-new" size={18} color={colores.tintaSuave} />
      </View>
      <Text style={estilos.tenue}>Se abren en el navegador del teléfono.</Text>
      {accesos.map((a) => (
        <Pressable
          key={a.ruta}
          testID={`web-${a.ruta}`}
          onPress={() => abrir(a.ruta)}
          accessibilityRole="link"
          accessibilityLabel={`${a.nombre}. Abrir en el navegador`}
          style={({ pressed }) => [estilos.acceso, pressed && estilos.presionada]}
        >
          <Icono nombre={a.icono} size={22} color={colores.primario} />
          <Text style={estilos.accesoTexto}>{a.nombre}</Text>
          <Icono nombre="open-in-new" size={20} color={colores.tintaTenue} />
        </Pressable>
      ))}
      {error ? <Alerta tipo="mal" texto={error} /> : null}
    </View>
  );
}

export const estilos = crearEstilos({
  fila: {
    minHeight: AREA_TACTIL,
    padding: 14,
    gap: 4,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  presionada: { backgroundColor: colores.realce },
  filaCabecera: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  nombre: { flexGrow: 1, flexShrink: 1, fontSize: 16, fontWeight: "700", color: colores.titulo },
  linea: { flexDirection: "row", alignItems: "center", gap: 6 },
  dato: { flexShrink: 1, fontSize: 15, color: colores.tinta },
  dias: { fontSize: 15, fontWeight: "600", color: colores.tintaSuave },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.titulo },
  navegador: { gap: 8 },
  sinRol: { gap: 10 },
  acceso: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  accesoTexto: { flex: 1, fontSize: 16, fontWeight: "600", color: colores.tinta },
});
