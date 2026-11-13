import { memo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Alerta, Boton } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { abrirEnNavegador, TEXTO_NAVEGADOR_FALLO, urlWeb } from "../../navegador/enlaceWeb";
import {
  DESCUENTOS,
  duracionDeSolicitud,
  estadoDe,
  estadoDeRegla,
  horario,
  nombreDeSolicitud,
  pendienteDe,
  rangoDeFechas,
} from "../../permisos/formato";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";

/**
 * Piezas de Solicitud de permisos (US-010) que comparten la lista, el detalle
 * y la nueva solicitud.
 */

/** El estado con ícono y texto, además del color (CA-14). */
export function EstadoSolicitud({ solicitud }) {
  const estado = estadoDe(solicitud);
  return (
    <View style={[estilos.estado, { backgroundColor: estado.fondo }]}>
      <Icono nombre={estado.icono} size={16} color={estado.color} />
      <Text style={[estilos.estadoTexto, { color: estado.color }]}>{estado.texto}</Text>
    </View>
  );
}

/** Las reglas de la evaluación (CA-4): cada una con su ícono, su estado
 * dicho («No cumple: …») y su detalle, como en la web. */
export function ReglasDelPermiso({ evaluacion, titulo = "Restricciones de este permiso", atenuadas = false }) {
  const reglas = Array.isArray(evaluacion?.reglas) ? evaluacion.reglas : [];
  if (reglas.length === 0) return null;
  // `atenuadas`: mientras se reevalúan, las de antes se ven atenuadas y se
  // dicen como anteriores, para no tomarlas por las de las fechas nuevas.
  return (
    <View style={[estilos.reglas, atenuadas && estilos.atenuadas]} testID="reglas-del-permiso">
      <Text style={estilos.subtitulo} accessibilityRole="header">
        {atenuadas ? `${titulo} (revisando…)` : titulo}
      </Text>
      {reglas.map((regla) => {
        const estado = estadoDeRegla(regla);
        const etiqueta = [atenuadas ? "Anterior." : null, `${estado.nombre}: ${regla.texto}`, regla.detalle]
          .filter(Boolean)
          .join(" ");
        return (
          <View
            key={regla.clave}
            testID={`regla-${regla.clave}`}
            style={[estilos.regla, { backgroundColor: estado.fondo }]}
            accessible
            accessibilityLabel={etiqueta}
          >
            <Icono nombre={estado.icono} size={20} color={estado.color} />
            <View style={estilos.reglaTextos}>
              <Text style={[estilos.reglaEstado, { color: estado.color }]}>{estado.nombre}</Text>
              <Text style={estilos.reglaTexto}>{regla.texto}</Text>
              {regla.detalle ? <Text style={estilos.reglaDetalle}>{regla.detalle}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Un campo de texto con su etiqueta visible, «(obligatorio)» dicho, la
 * ayuda y el error debajo. */
export function CampoTexto({
  etiqueta,
  valor,
  onCambio,
  obligatorio = false,
  ayuda,
  error,
  multilinea = false,
  maximo,
  testID,
  deshabilitado = false,
  refFoco,
}) {
  const etiquetaAccesible = [
    `${etiqueta}${obligatorio ? " (obligatorio)" : ""}`,
    ayuda,
    error ? `Error: ${error}` : null,
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <View style={estilos.campo}>
      <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
        {etiqueta}
        {obligatorio ? <Text style={estilos.obligatorio}> *</Text> : null}
      </Text>
      {ayuda ? (
        <Text style={estilos.ayuda} importantForAccessibility="no" accessibilityElementsHidden>
          {ayuda}
        </Text>
      ) : null}
      <TextInput
        ref={refFoco}
        testID={testID}
        value={valor}
        onChangeText={onCambio}
        editable={!deshabilitado}
        multiline={multilinea}
        maxLength={maximo}
        textAlignVertical={multilinea ? "top" : "center"}
        accessibilityLabel={etiquetaAccesible}
        style={[estilos.entrada, multilinea && estilos.entradaMultilinea, error && estilos.entradaConError]}
        placeholderTextColor={colores.tintaTenue}
      />
      {error ? (
        <View style={estilos.filaError} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Icono nombre="alert-circle-outline" size={16} color={colores.malTexto} />
          <Text style={estilos.error}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Una solicitud en una lista: tipo, fechas, horas, duración, estado y de
 * quién está pendiente (CA-3 y CA-10). Toda la tarjeta es un botón con un
 * nombre que lo dice todo. */
export const TarjetaSolicitud = memo(function TarjetaSolicitud({ solicitud: s, conSolicitante = false, onAbrir }) {
  const horas = s.unidad === "horas" ? horario(s.hora_desde, s.hora_hasta) : "";
  const pendiente = s.estado === "pendiente" ? pendienteDe(s) : "";
  const porPersona = conSolicitante && Boolean(s.solicitante?.nombre);
  return (
    <Pressable
      testID={`solicitud-${s.id}`}
      onPress={() => onAbrir(s)}
      accessibilityRole="button"
      accessibilityLabel={nombreDeSolicitud(s, { conSolicitante })}
      accessibilityHint="Abre el detalle de la solicitud"
      style={({ pressed }) => [estilos.tarjeta, pressed && estilos.presionada]}
    >
      {/* En «Por aprobar» lo primero es quién pide; el tipo, debajo
          (auditoría UX, H-17). */}
      <View style={estilos.tarjetaCabecera}>
        <Text style={estilos.tarjetaTitulo}>{porPersona ? s.solicitante.nombre : s.flujo}</Text>
        <EstadoSolicitud solicitud={s} />
      </View>
      {porPersona ? <Text style={estilos.tarjetaSolicitante}>{s.flujo}</Text> : null}
      <Text style={estilos.tarjetaDato}>
        {rangoDeFechas(s.desde, s.hasta)}
        {horas ? `, ${horas}` : ""} · {duracionDeSolicitud(s)}
      </Text>
      {DESCUENTOS[s.descuento] ? <Text style={estilos.tarjetaTenue}>{DESCUENTOS[s.descuento]}</Text> : null}
      {pendiente ? (
        <Text style={estilos.tarjetaTenue}>
          {s.paso_actual ? `${s.paso_actual} · ` : ""}Pendiente de: {pendiente}
        </Text>
      ) : null}
    </Pressable>
  );
});

/** «Abrir en el navegador» para lo que se queda en la web (CA-11), con el
 * error junto al botón si el teléfono no lo abre. */
export function AbrirEnLaWeb({ ruta, empresa, titulo = "Abrir en el navegador", texto, testID }) {
  const [error, setError] = useState(null);
  const url = urlWeb(ruta, { empresa });
  if (!url) return null;
  async function abrir() {
    setError(null);
    const abierta = await abrirEnNavegador(url, { avisarSiFalla: false });
    if (!abierta) setError(TEXTO_NAVEGADOR_FALLO);
  }
  return (
    <View style={estilos.web}>
      {texto ? <Alerta tipo="info" texto={texto} /> : null}
      <Boton
        testID={testID}
        titulo={titulo}
        icono="open-in-new"
        variante="secundario"
        pista="Se abre en el navegador del teléfono"
        onPress={abrir}
      />
      {error ? <Alerta tipo="mal" texto={error} /> : null}
    </View>
  );
}

export const estilos = crearEstilos({
  estado: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  estadoTexto: { fontSize: 13, fontWeight: "700", flexShrink: 1 },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.tinta },
  reglas: { gap: 8 },
  // Sin opacidad (bajaba el contraste): un borde a la izquierda y el texto
  // «(revisando…)» / «Anterior.» las distinguen (revisión UX, M-3).
  atenuadas: { borderLeftWidth: 4, borderLeftColor: colores.bordeControl, paddingLeft: 8 },
  regla: { flexDirection: "row", gap: 8, padding: 10, borderRadius: 8, alignItems: "flex-start" },
  reglaTextos: { flex: 1, gap: 2 },
  reglaEstado: { fontSize: 13, fontWeight: "700" },
  reglaTexto: { fontSize: 15, color: colores.tinta },
  reglaDetalle: { fontSize: 14, color: colores.tintaSuave },
  campo: { gap: 4 },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  obligatorio: { color: colores.malTexto },
  ayuda: { fontSize: 13, color: colores.tintaSuave },
  entrada: { ...CONTROLES.entrada, paddingVertical: 8 },
  entradaMultilinea: { minHeight: 96 },
  entradaConError: CONTROLES.entradaConError,
  filaError: { flexDirection: "row", alignItems: "center", gap: 6 },
  error: { flex: 1, fontSize: 14, color: colores.malTexto },
  tarjeta: {
    minHeight: AREA_TACTIL,
    padding: 14,
    gap: 4,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  presionada: { backgroundColor: colores.realce },
  tarjetaCabecera: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  tarjetaTitulo: { flexShrink: 1, flexGrow: 1, fontSize: 16, fontWeight: "700", color: colores.tinta },
  tarjetaSolicitante: { fontSize: 15, color: colores.tinta },
  tarjetaDato: { fontSize: 15, color: colores.tintaSuave },
  tarjetaTenue: { fontSize: 14, color: colores.tintaTenue },
  web: { gap: 8 },
});
