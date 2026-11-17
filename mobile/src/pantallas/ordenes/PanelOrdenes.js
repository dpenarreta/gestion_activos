import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";

import { ordenesService } from "../../api/servicios";
import { Alerta, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { Refresco } from "../../componentes/Refresco";
import { Icono } from "../../componentes/Icono";
import { kpisDelPanel, mensajeDeOrdenes, ordenesEnLaWeb, TEXTO_NADA_PENDIENTE, TEXTO_SIN_ACTIVIDAD } from "../../ordenes/formato";
import { TONOS } from "../../soporte/formato";
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { fechaYHora } from "../../utils/fechas";
import { ActivosEnElNavegador, useMontado } from "../activos/piezas";
import { Separador } from "../soporte/piezas";
import { FilaOrden } from "./piezas";

/** Un indicador (CA-3): ícono, nombre y cifra, con el borde y el ícono del
 * tono. Abiertas y vencidas destacan con un borde completo y la cifra más
 * grande; el nombre siempre dice qué es, sin depender del color.
 *
 * UX H-05: el costo (una cifra larga, «$12.345,67») va a todo el ancho, y
 * con la letra grande (más del 130 %) todas van una por fila. El orden es el
 * de la web. */
function Tarjeta({ kpi, ancha }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const tono = TONOS[kpi.tono];
  return (
    <View
      testID={`kpi-${kpi.clave}`}
      accessible
      accessibilityLabel={`${kpi.titulo}: ${kpi.cifra}`}
      style={[
        estilos.tarjeta,
        ancha && estilos.tarjetaAncha,
        { borderLeftColor: tono.color },
        kpi.destacada && [estilos.tarjetaDestacada, { borderColor: tono.color }],
      ]}
    >
      <View style={estilos.tarjetaCabecera}>
        <View style={[estilos.tarjetaIcono, { backgroundColor: tono.fondo }]}>
          <Icono nombre={kpi.icono} size={22} color={tono.color} />
        </View>
        <Text style={estilos.tarjetaTitulo}>{kpi.titulo}</Text>
      </View>
      <Text style={[estilos.cifra, kpi.destacada && estilos.cifraDestacada]}>{kpi.cifra}</Text>
    </View>
  );
}

/** Un movimiento de «Actividad reciente» (CA-5): el número de la orden
 * (UX H-06), qué pasó, quién y cuándo. Abre la ficha de su orden. */
function FilaDeActividad({ movimiento, onAbrir }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const cuando = fechaYHora(movimiento.created_at);
  const conOrden = Boolean(movimiento.orden?.id);
  const contenido = (
    <>
      <Icono
        nombre={movimiento.estado_nuevo ? "swap-horizontal-circle-outline" : "circle-small"}
        size={22}
        color={movimiento.estado_nuevo ? colores.infoTexto : colores.tintaSuave}
      />
      <View style={estilos.actividadTextos}>
        {movimiento.orden?.numero ? <Text style={estilos.actividadNumero}>{movimiento.orden.numero}</Text> : null}
        <Text style={estilos.actividadTexto}>{movimiento.descripcion}</Text>
        <Text style={estilos.tenue}>{`${movimiento.actor} · ${cuando}`}</Text>
      </View>
      {conOrden ? <Icono nombre="chevron-right" size={22} color={colores.tintaSuave} /> : null}
    </>
  );
  const etiqueta = [movimiento.orden?.numero, movimiento.descripcion, `${movimiento.actor}, ${cuando}`].filter(Boolean).join(". ");
  if (!conOrden) {
    return (
      <View style={estilos.actividad} accessible accessibilityLabel={etiqueta} testID={`actividad-${movimiento.id}`}>
        {contenido}
      </View>
    );
  }
  return (
    <Pressable
      testID={`actividad-${movimiento.id}`}
      onPress={() => onAbrir(movimiento.orden)}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityHint={`Abre la ficha de ${movimiento.orden.numero ?? "la orden"}`}
      style={({ pressed }) => [estilos.actividad, pressed && estilos.presionada]}
    >
      {contenido}
    </Pressable>
  );
}

/**
 * El «Panel de mantenimiento» de la web (US-025, CA-3 a CA-6), con `GET
 * ordenes/resumen/`: el alcance, los ocho indicadores, «Requieren atención»
 * (críticas, altas y vencidas) y «Actividad reciente». Abajo, lo que se hace
 * en la web (CA-17).
 *
 * Se actualiza al volver a él y al tirar hacia abajo; un refresco fallido no
 * borra lo que se ve. Al cambiar de empresa se vuelve a pedir.
 */
export function PanelOrdenes({ permisos, empresa, versionEmpresa, onAbrirOrden }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const [carga, setCarga] = useState({ estado: "cargando", datos: null, error: null, aviso: null });
  const [refrescando, setRefrescando] = useState(false);
  const { fontScale } = useWindowDimensions();
  const letraGrande = fontScale > 1.3;
  const montado = useMontado();
  const consulta = useRef(0);
  const cargaRef = useRef(carga);
  cargaRef.current = carga;

  const cargar = useCallback(
    async ({ silenciosa = false } = {}) => {
      const numero = ++consulta.current;
      if (!silenciosa) setCarga({ estado: "cargando", datos: null, error: null, aviso: null });
      try {
        const datos = await ordenesService.resumen();
        if (!montado.current || numero !== consulta.current) return;
        setCarga({ estado: "listo", datos, error: null, aviso: null });
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        if (silenciosa && cargaRef.current.estado === "listo") {
          setCarga((c) => ({ ...c, aviso: `${mensajeDeOrdenes(e, "No se pudo actualizar el panel.")} Se muestra el anterior.` }));
        } else {
          setCarga({ estado: "error", datos: null, error: mensajeDeOrdenes(e, "No se pudo cargar el panel."), aviso: null });
        }
      }
    },
    [montado],
  );

  useEffect(() => {
    cargar();
  }, [cargar, empresa, versionEmpresa]);

  // Al volver de la ficha (tras mover una orden), las cifras al día.
  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      if (cargaRef.current.estado === "listo") cargar({ silenciosa: true });
    }, [cargar]),
  );

  async function refrescar() {
    setRefrescando(true);
    await cargar({ silenciosa: cargaRef.current.estado === "listo" });
    if (montado.current) setRefrescando(false);
  }

  let contenido;
  if (carga.estado === "cargando") contenido = <Cargando texto="Cargando el panel…" />;
  else if (carga.estado === "error") contenido = <ErrorConReintento texto={carga.error} onReintentar={() => cargar()} />;
  else {
    const datos = carga.datos ?? {};
    const atencion = Array.isArray(datos.atencion) ? datos.atencion : [];
    const actividad = Array.isArray(datos.actividad) ? datos.actividad : [];
    contenido = (
      <>
        {carga.aviso ? <Alerta tipo="aviso" texto={carga.aviso} /> : null}
        {datos.alcance ? (
          <View style={estilos.alcance} accessible accessibilityLabel={`Alcance: ${datos.alcance}`} testID="alcance">
            <Icono nombre="map-marker-radius-outline" size={20} color={colores.tintaSuave} />
            <Text style={estilos.alcanceTexto}>{`Alcance: ${datos.alcance}`}</Text>
          </View>
        ) : null}
        <View style={estilos.tarjetas} testID="kpis-ordenes">
          {kpisDelPanel(datos.kpis).map((k) => (
            <Tarjeta key={k.clave} kpi={k} ancha={letraGrande || k.clave === "costo_total"} />
          ))}
        </View>

        <View style={estilos.bloque} testID="requieren-atencion">
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Requieren atención
          </Text>
          <Text style={estilos.tenue}>Críticas, altas y vencidas</Text>
          {atencion.length === 0 ? (
            <Vacio icono="check-circle-outline" texto={TEXTO_NADA_PENDIENTE} />
          ) : (
            atencion.map((o, i) => (
              <View key={o.id}>
                {i > 0 ? <Separador /> : null}
                <FilaOrden orden={o} onAbrir={onAbrirOrden} testID={`atencion-${o.id}`} />
              </View>
            ))
          )}
        </View>

        <View style={estilos.bloque} testID="actividad-reciente">
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Actividad reciente
          </Text>
          {actividad.length === 0 ? (
            <Vacio icono="history" texto={TEXTO_SIN_ACTIVIDAD} />
          ) : (
            actividad.map((m) => <FilaDeActividad key={m.id} movimiento={m} onAbrir={onAbrirOrden} />)
          )}
        </View>
      </>
    );
  }

  return (
    <ScrollView
      testID="panel-ordenes"
      style={estilos.lista}
      contentContainerStyle={estilos.contenido}
      refreshControl={<Refresco refreshing={refrescando} onRefresh={refrescar} />}
    >
      {contenido}
      <View style={estilos.pie}>
        <ActivosEnElNavegador
          accesos={ordenesEnLaWeb(permisos)}
          empresa={empresa}
          familia="ordenes"
          testID="ordenes-en-el-navegador"
        />
      </View>
    </ScrollView>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  lista: { flex: 1 },
  contenido: { padding: 16, paddingTop: 8, paddingBottom: 32, gap: 16 },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  alcance: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  alcanceTexto: { flex: 1, fontSize: 15, color: colores.tinta },
  tarjetas: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tarjeta: {
    // Dos por fila también en 320 dp (UX H-21 de la US-022).
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 0,
    padding: 12,
    gap: 4,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
    borderLeftWidth: 6,
  },
  tarjetaAncha: { flexBasis: "100%" },
  tarjetaDestacada: { borderWidth: 2, borderLeftWidth: 8 },
  presionada: { backgroundColor: colores.realce },
  tarjetaCabecera: { flexDirection: "row", alignItems: "center", gap: 8 },
  tarjetaIcono: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tarjetaTitulo: { flex: 1, fontSize: 15, fontWeight: "700", color: colores.tinta },
  cifra: { fontSize: 26, fontWeight: "700", color: colores.titulo },
  // Con su peso: un estilo de texto sin `fontWeight` toma Poppins regular
  // (`conFuente`) y le quitaba la negrita a la cifra (prueba en el teléfono,
  // 17/11/2026).
  cifraDestacada: { fontSize: 32, fontWeight: "700" },
  bloque: { gap: 10 },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.titulo },
  actividad: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  actividadTextos: { flex: 1, gap: 2 },
  actividadNumero: { fontSize: 14, fontWeight: "700", color: colores.tintaSuave },
  actividadTexto: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  pie: { marginTop: 4 },
});
