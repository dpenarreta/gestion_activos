import { memo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { BotonRedondo } from "../../componentes/BotonRedondo";
import { Alerta } from "../../componentes/comunes";
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
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";

/**
 * Piezas de Solicitud de permisos (US-010) que comparten la lista, el detalle
 * y la nueva solicitud.
 */

/** El estado con ícono y texto, además del color (CA-14). */
export function EstadoSolicitud({ solicitud }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const estado = estadoDe(solicitud);
  return (
    <View style={[estilos.estado, { backgroundColor: estado.fondo }]}>
      <Icono nombre={estado.icono} size={16} color={estado.color} />
      <Text style={[estilos.estadoTexto, { color: estado.color }]}>{estado.texto}</Text>
    </View>
  );
}

/** Una regla de la evaluación, con su ícono, su estado dicho («No cumple:
 * …») y su detalle, como en la web. */
function ReglaDelPermiso({ regla, atenuadas, estilos }) {
  const estado = estadoDeRegla(regla);
  const etiqueta = [atenuadas ? "Anterior." : null, `${estado.nombre}: ${regla.texto}`, regla.detalle]
    .filter(Boolean)
    .join(" ");
  return (
    <View
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
}

export const TEXTO_SUGERENCIAS_NO_IMPIDEN =
  "Son sugerencias, no restricciones: no impiden enviar la solicitud, y la decisión es de Talento Humano.";
export const TEXTO_SUGERENCIAS_EN_DETALLE =
  "Son sugerencias del tipo de permiso: no se cumplieron todas, pero la decisión es de Talento Humano.";
export const TITULO_DEBE_CORREGIR = "Debe corregir para poder enviar";

/** Las reglas de la evaluación (CA-4). Las del tipo de permiso son
 * sugerencias, no restricciones: no bloquean, se puede enviar igual y decide
 * Talento Humano (pedido del usuario, 18/11/2026, igual que la web). Solo las
 * validaciones de datos («falla»: fechas cruzadas, días ya pedidos o
 * gozados…) impiden enviar, y van aparte, como error, no bajo «Sugerencias». */
export function ReglasDelPermiso({
  evaluacion,
  titulo = "Sugerencias de este permiso",
  atenuadas = false,
  enDetalle = false,
}) {
  const estilos = useEstilos(fabricaDeEstilos);
  const reglas = Array.isArray(evaluacion?.reglas) ? evaluacion.reglas : [];
  if (reglas.length === 0) return null;
  const fallas = reglas.filter((r) => r.estado === "falla");
  const sugerencias = reglas.filter((r) => r.estado !== "falla");
  const sinCumplir = sugerencias.some((r) => r.estado === "aviso");
  const conRevision = (texto) => (atenuadas ? `${texto} (revisando…)` : texto);
  // `atenuadas`: mientras se reevalúan, las de antes se ven atenuadas y se
  // dicen como anteriores, para no tomarlas por las de las fechas nuevas.
  return (
    <View style={[estilos.reglas, atenuadas && estilos.atenuadas]} testID="reglas-del-permiso">
      {fallas.length > 0 ? (
        <View style={estilos.reglasCorregir} accessibilityRole="alert" testID="reglas-por-corregir">
          <Text style={estilos.reglasCorregirTitulo} accessibilityRole="header">
            {conRevision(TITULO_DEBE_CORREGIR)}
          </Text>
          {fallas.map((regla) => (
            <ReglaDelPermiso key={regla.clave} regla={regla} atenuadas={atenuadas} estilos={estilos} />
          ))}
        </View>
      ) : null}
      {sugerencias.length > 0 ? (
        <View style={estilos.reglas} testID="reglas-sugerencias">
          <Text style={estilos.subtitulo} accessibilityRole="header">
            {conRevision(titulo)}
          </Text>
          {sinCumplir ? (
            <Text style={estilos.reglasNota}>
              {enDetalle ? TEXTO_SUGERENCIAS_EN_DETALLE : TEXTO_SUGERENCIAS_NO_IMPIDEN}
            </Text>
          ) : null}
          {sugerencias.map((regla) => (
            <ReglaDelPermiso key={regla.clave} regla={regla} atenuadas={atenuadas} estilos={estilos} />
          ))}
        </View>
      ) : null}
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
  // US-014: el teclado del campo («phone-pad», «email-address»…), un
  // ejemplo dentro del campo y si se marca «(opcional)».
  teclado,
  placeholder,
  opcional = false,
  // US-023 (UX H-03): aditivas, para campos como el número de serie (sin
  // autocorrector, en mayúsculas). Sin ellas, lo de siempre.
  autoCorrect,
  autoCapitalize,
  autoComplete,
  returnKeyType,
  onSubmitEditing,
}) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
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
        {opcional ? <Text style={estilos.opcional}> (opcional)</Text> : null}
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
        keyboardType={teclado}
        placeholder={placeholder}
        autoCorrect={autoCorrect}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
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
  const estilos = useEstilos(fabricaDeEstilos);
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
 * error junto al botón si el teléfono no lo abre. Desde el 16/11/2026 (a
 * pedido del usuario) es un botón redondo con la marca de «sale de la app»:
 * `nombre` es lo que se lee debajo del círculo (corto) y `titulo`, lo que
 * dice el lector de pantalla. */
export function AbrirEnLaWeb({
  ruta,
  empresa,
  titulo = "Abrir en el navegador",
  nombre,
  icono = "web",
  familia,
  texto,
  testID,
}) {
  const estilos = useEstilos(fabricaDeEstilos);
  const [error, setError] = useState(null);
  const url = urlWeb(ruta, { empresa });
  if (!url) return null;
  async function abrir() {
    setError(null);
    const abierta = await abrirEnNavegador(url, { avisarSiFalla: false });
    if (abierta === false) setError(TEXTO_NAVEGADOR_FALLO);
  }
  return (
    <View style={estilos.web}>
      {texto ? <Alerta tipo="info" texto={texto} /> : null}
      <BotonRedondo
        testID={testID}
        icono={icono}
        nombre={nombre ?? titulo}
        familia={familia}
        navegador
        etiqueta={titulo}
        pista="Se abre en el navegador del teléfono"
        onPress={abrir}
      />
      {error ? <Alerta tipo="mal" texto={error} /> : null}
    </View>
  );
}

export const fabricaDeEstilos = (colores, CONTROLES) => crearEstilos({
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
  // Lo que impide enviar, como error y aparte de las sugerencias (18/11/2026).
  reglasCorregir: { gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colores.malTexto, backgroundColor: colores.malFondo },
  reglasCorregirTitulo: { fontSize: 17, fontWeight: "700", color: colores.malTexto },
  reglasNota: { fontSize: 14, color: colores.tinta },
  reglaEstado: { fontSize: 13, fontWeight: "700" },
  reglaTexto: { fontSize: 15, color: colores.tinta },
  reglaDetalle: { fontSize: 14, color: colores.tintaSuave },
  campo: { gap: 4 },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  obligatorio: { color: colores.malTexto },
  opcional: { fontSize: 14, fontWeight: "400", color: colores.tintaSuave },
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
