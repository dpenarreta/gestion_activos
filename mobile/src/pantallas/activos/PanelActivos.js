import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { activosService } from "../../api/servicios";
import { activosEnLaWeb, alertasDelPanel, dinero, kpisDelPanel, mensajeDeActivos, textoDeAlerta } from "../../activos/formato";
import { Alerta, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { TONOS } from "../../soporte/formato";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { Separador } from "../soporte/piezas";
import { ActivosEnElNavegador, useMontado } from "./piezas";

/** Una tarjeta destacada (CA-3): ícono, título y cifra, con el borde y el
 * ícono del tono. Abre el inventario filtrado. */
function Tarjeta({ kpi, onAbrir }) {
  const tono = TONOS[kpi.tono];
  return (
    <Pressable
      testID={`kpi-${kpi.clave}`}
      onPress={() => onAbrir(kpi.filtro)}
      accessibilityRole="button"
      accessibilityLabel={`${kpi.titulo}: ${kpi.cifra}${kpi.detalle ? `. ${kpi.detalle}` : ""}`}
      accessibilityHint="Abre el inventario con este filtro"
      style={({ pressed }) => [estilos.tarjeta, { borderLeftColor: tono.color }, pressed && estilos.presionada]}
    >
      <View style={estilos.tarjetaCabecera}>
        <View style={[estilos.tarjetaIcono, { backgroundColor: tono.fondo }]}>
          <Icono nombre={kpi.icono} size={22} color={tono.color} />
        </View>
        <Text style={estilos.tarjetaTitulo}>{kpi.titulo}</Text>
      </View>
      <Text style={estilos.cifra}>{kpi.cifra}</Text>
      {kpi.detalle ? <Text style={estilos.tenue}>{kpi.detalle}</Text> : null}
    </Pressable>
  );
}

/** Un par nombre-cifra de la sección de mantenimientos, leído junto. */
function Cifra({ nombre, valor, testID }) {
  return (
    <View style={estilos.cifraChica} accessible accessibilityLabel={`${nombre}: ${valor}`} testID={testID}>
      <Text style={estilos.tenue}>{nombre}</Text>
      <Text style={estilos.valor}>{valor}</Text>
    </View>
  );
}

/**
 * El panel de Gestión de Activos (US-022, CA-3 a CA-5), con
 * `GET activos/dashboard/`: las cuatro tarjetas que abren el inventario
 * filtrado, las alertas con su número, los mantenimientos (del mes,
 * histórico, costos y fuera de operación) y los cinco equipos más reparados,
 * que abren su ficha. Abajo, lo que se hace en la web (CA-10).
 *
 * Se actualiza al volver a él y al tirar hacia abajo; un refresco fallido no
 * borra lo que se ve. Al cambiar de empresa se vuelve a pedir (CA-22).
 */
export function PanelActivos({ permisos, empresa, versionEmpresa, onAbrirInventario, onAbrirActivo }) {
  const [carga, setCarga] = useState({ estado: "cargando", datos: null, error: null, aviso: null });
  const [refrescando, setRefrescando] = useState(false);
  const montado = useMontado();
  const consulta = useRef(0);
  const cargaRef = useRef(carga);
  cargaRef.current = carga;

  const cargar = useCallback(
    async ({ silenciosa = false } = {}) => {
      const numero = ++consulta.current;
      if (!silenciosa) setCarga({ estado: "cargando", datos: null, error: null, aviso: null });
      try {
        const datos = await activosService.panel();
        if (!montado.current || numero !== consulta.current) return;
        setCarga({ estado: "listo", datos, error: null, aviso: null });
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        if (silenciosa && cargaRef.current.estado === "listo") {
          setCarga((c) => ({ ...c, aviso: `${mensajeDeActivos(e, "No se pudo actualizar el panel.")} Se muestra el anterior.` }));
        } else {
          setCarga({ estado: "error", datos: null, error: mensajeDeActivos(e, "No se pudo cargar el panel."), aviso: null });
        }
      }
    },
    [montado],
  );

  useEffect(() => {
    cargar();
  }, [cargar, empresa, versionEmpresa]);

  // Al volver de la ficha (tras asignar o cambiar un estado), las cifras al día.
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
    const alertas = alertasDelPanel(datos);
    const m = datos.mantenimientos ?? {};
    const fuera = datos.fuera_de_operacion ?? {};
    const reparados = Array.isArray(datos.equipos_mas_reparados) ? datos.equipos_mas_reparados : [];
    contenido = (
      <>
        {carga.aviso ? <Alerta tipo="aviso" texto={carga.aviso} /> : null}
        <View style={estilos.tarjetas} testID="kpis-activos">
          {kpisDelPanel(datos).map((k) => (
            <Tarjeta key={k.clave} kpi={k} onAbrir={onAbrirInventario} />
          ))}
        </View>

        <View style={estilos.bloque} testID="alertas-activos">
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Alertas
          </Text>
          {alertas.length === 0 ? (
            <Vacio icono="check-circle-outline" texto="Sin alertas: nada pide atención ahora." />
          ) : (
            alertas.map((a) => {
              const tono = TONOS[a.tono];
              const contenido = (
                <>
                  <Icono nombre={a.icono} size={22} color={tono.color} />
                  <Text style={[estilos.alertaCifra, { color: tono.color }]}>{a.cifra}</Text>
                  <Text style={[estilos.alertaTexto, { color: tono.color }]}>{a.texto}</Text>
                  {a.filtro ? <Icono nombre="chevron-right" size={22} color={tono.color} /> : null}
                </>
              );
              if (!a.filtro) {
                return (
                  <View
                    key={a.clave}
                    testID={`alerta-${a.clave}`}
                    style={[estilos.alerta, { backgroundColor: tono.fondo }]}
                    accessible
                    accessibilityLabel={textoDeAlerta(a)}
                  >
                    {contenido}
                  </View>
                );
              }
              return (
                <Pressable
                  key={a.clave}
                  testID={`alerta-${a.clave}`}
                  onPress={() => onAbrirInventario(a.filtro)}
                  accessibilityRole="button"
                  accessibilityLabel={textoDeAlerta(a)}
                  accessibilityHint="Abre el inventario con ese filtro"
                  style={({ pressed }) => [estilos.alerta, { backgroundColor: tono.fondo }, pressed && estilos.presionada]}
                >
                  {contenido}
                </Pressable>
              );
            })
          )}
        </View>

        <View style={estilos.bloque} testID="mantenimientos-del-panel">
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Mantenimientos
          </Text>
          <View style={estilos.cifras}>
            <Cifra nombre="Este mes" valor={Number(m.del_mes) || 0} testID="mant-del-mes" />
            <Cifra nombre="Histórico" valor={Number(m.total_historico) || 0} />
            <Cifra nombre="Costo del mes" valor={dinero(m.costo_del_mes ?? 0)} testID="costo-del-mes" />
            <Cifra nombre="Costo acumulado" valor={dinero(m.costo_acumulado ?? 0)} />
          </View>
          <Text style={estilos.subtituloChico} accessibilityRole="header">
            Fuera de operación
          </Text>
          <View style={estilos.cifras}>
            <Cifra nombre="Días fuera de operación" valor={Number(fuera.total_dias) || 0} />
            <Cifra nombre="Intervenciones abiertas" valor={Number(fuera.intervenciones_abiertas) || 0} testID="abiertas" />
            <Cifra nombre="Intervenciones cerradas" valor={Number(fuera.intervenciones_cerradas) || 0} />
          </View>
        </View>

        <View style={estilos.bloque} testID="mas-reparados">
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Equipos más reparados
          </Text>
          {reparados.length === 0 ? (
            <Vacio icono="tools" texto="Todavía no hay equipos con mantenimientos." />
          ) : (
            reparados.map((r, i) => (
              <View key={r.id}>
                {i > 0 ? <Separador /> : null}
                <Pressable
                  testID={`reparado-${r.id}`}
                  onPress={() => onAbrirActivo(r.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${i + 1}. ${r.codigo_barras}, ${r.nombre}. ${r.total_mantenimientos} ${
                    r.total_mantenimientos === 1 ? "mantenimiento" : "mantenimientos"
                  }`}
                  accessibilityHint="Abre la ficha del activo"
                  style={({ pressed }) => [estilos.reparado, pressed && estilos.presionada]}
                >
                  <Text style={estilos.puesto}>{i + 1}</Text>
                  <View style={estilos.reparadoTextos}>
                    <Text style={estilos.reparadoNombre}>{r.nombre}</Text>
                    <Text style={estilos.tenue}>{[r.codigo_barras, r.tipo, r.departamento].filter(Boolean).join(" · ")}</Text>
                  </View>
                  <View style={estilos.reparadoCuenta}>
                    <Icono nombre="wrench-outline" size={16} color={colores.tintaSuave} />
                    <Text style={estilos.valor}>{r.total_mantenimientos}</Text>
                  </View>
                </Pressable>
              </View>
            ))
          )}
        </View>
      </>
    );
  }

  return (
    <ScrollView
      testID="panel-activos"
      style={estilos.lista}
      contentContainerStyle={estilos.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    >
      {contenido}
      <View style={estilos.pie}>
        <ActivosEnElNavegador accesos={activosEnLaWeb(permisos)} empresa={empresa} />
      </View>
    </ScrollView>
  );
}

const estilos = crearEstilos({
  lista: { flex: 1 },
  contenido: { padding: 16, paddingTop: 8, paddingBottom: 32, gap: 16 },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  tarjetas: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tarjeta: {
    // UX H-21: dos por fila también en 320 dp (150 de base no entraba con
    // los márgenes y quedaba una sola columna).
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 0,
    minHeight: AREA_TACTIL,
    padding: 12,
    gap: 4,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
    borderLeftWidth: 6,
  },
  presionada: { backgroundColor: colores.realce },
  tarjetaCabecera: { flexDirection: "row", alignItems: "center", gap: 8 },
  tarjetaIcono: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tarjetaTitulo: { flex: 1, fontSize: 15, fontWeight: "700", color: colores.tinta },
  cifra: { fontSize: 30, fontWeight: "700", color: colores.titulo },
  bloque: { gap: 10 },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.titulo },
  subtituloChico: { fontSize: 15, fontWeight: "700", color: colores.tinta },
  alerta: { minHeight: AREA_TACTIL, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 8 },
  alertaCifra: { fontSize: 20, fontWeight: "700" },
  alertaTexto: { flex: 1, fontSize: 15 },
  cifras: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cifraChica: {
    flexGrow: 1,
    flexBasis: 140,
    padding: 12,
    gap: 2,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  valor: { fontSize: 18, fontWeight: "700", color: colores.titulo },
  reparado: {
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
  puesto: { minWidth: 24, fontSize: 18, fontWeight: "700", color: colores.tintaSuave, textAlign: "center" },
  reparadoTextos: { flex: 1, gap: 2 },
  reparadoNombre: { fontSize: 16, fontWeight: "700", color: colores.titulo },
  reparadoCuenta: { flexDirection: "row", alignItems: "center", gap: 4 },
  pie: { marginTop: 4 },
});
