import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { matrizService } from "../../api/servicios";
import { Alerta, Boton, Cargando, Desplegable, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { tamanoLegible } from "../../adjuntos/seleccion";
import { useVisorDeEvidencias } from "../../matriz/documentos";
import {
  accionesEnLaApp,
  diaCorto,
  fechaHoraEnZona,
  hayAccionesEnLaWeb,
  mensajeDeMatriz,
  PERIODICIDADES,
  PRIORIDADES,
  rutaWebDelPeriodo,
  textoAccionesEnLaWeb,
  TEXTO_NO_DISPONIBLE,
  TEXTO_YA_NO_ES_SUYO,
  textoDeDias,
  TIPOS,
} from "../../matriz/formato";
import { abrirEnNavegador, TEXTO_NAVEGADOR_FALLO } from "../../navegador/enlaceWeb";
import { useSesion } from "../../sesion/SesionContext";
import { TONOS } from "../../soporte/formato";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { AbrirEnLaWeb } from "../permisos/piezas";
import { Dato, Pildora, Seccion } from "../soporte/piezas";
import { ConfirmarRecordatorio, FormularioFecha, FormularioSeguimiento } from "./AccionesDelPeriodo";
import { EstadoDelPeriodo } from "./piezas";

/** Lo que se avisa al terminar cada acción (los textos de la web). */
export const AVISOS = {
  seguimiento: "Seguimiento actualizado.",
  fecha: "Fecha de vencimiento cambiada.",
  recordar: "Recordatorio enviado.",
};

/** Una persona con su correo, como en la web. */
function Persona({ nombre, persona }) {
  const valor = persona ? [persona.nombre, persona.email].filter(Boolean).join(" · ") : "—";
  return <Dato nombre={nombre} valor={valor} />;
}

/** El avance en número y en barra; la barra es un `progressbar` con su
 * valor. */
function Avance({ valor }) {
  const n = Math.max(0, Math.min(100, Number(valor) || 0));
  return (
    <View style={estilos.dato}>
      <Text style={estilos.datoNombre}>Avance</Text>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Avance: ${n} %`}
        accessibilityValue={{ min: 0, max: 100, now: n }}
        style={estilos.avance}
        testID="avance"
      >
        <Text style={estilos.datoValor}>{`${n} %`}</Text>
        <View style={estilos.barra}>
          <View style={[estilos.barraLlena, { width: `${n}%` }]} />
        </View>
      </View>
    </View>
  );
}

/** Una evidencia válida: un botón que la abre en el visor. */
function Evidencia({ documento, zona, abriendo, onAbrir }) {
  const cargando = abriendo === documento.id;
  const detalle = [
    `v${documento.version}`,
    tamanoLegible(documento.tamano),
    fechaHoraEnZona(documento.created_at, zona),
    documento.subido_por?.nombre,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      testID={`evidencia-${documento.id}`}
      onPress={() => onAbrir(documento)}
      disabled={Boolean(abriendo)}
      accessibilityRole="button"
      accessibilityLabel={
        cargando ? `Abriendo ${documento.nombre_original}…` : `${documento.nombre_original}, ${detalle}. Abrir el PDF`
      }
      accessibilityState={{ busy: cargando, disabled: Boolean(abriendo) }}
      style={({ pressed }) => [estilos.evidencia, pressed && estilos.presionada]}
    >
      {cargando ? (
        <ActivityIndicator color={colores.primario} />
      ) : (
        <Icono nombre="file-pdf-box" size={24} color={colores.primario} />
      )}
      <View style={estilos.evidenciaTextos}>
        <Text style={estilos.evidenciaNombre}>
          {cargando ? `Abriendo ${documento.nombre_original}…` : documento.nombre_original}
        </Text>
        <Text style={estilos.tenue}>{detalle}</Text>
      </View>
    </Pressable>
  );
}

/**
 * El detalle de una obligación (un período) de la Matriz (US-019, CA-4 a
 * CA-6), como el panel del período de la web (`PeriodoPanel.jsx`): los datos,
 * las fechas, los responsables, el seguimiento, el estado, las evidencias
 * (solo para ver) y el historial.
 *
 * Los botones son solo los que el servidor ofrece en `acciones` y que la app
 * hace (Editar seguimiento, Cambiar fecha y Reenviar recordatorio). Si
 * ofrece otros (enviar a validación, cargar evidencia, validar, devolver),
 * se dice que se hacen en la web, con «Abrir en el navegador».
 *
 * `empresa`: la de un aviso, que va como `X-Empresa` en cada petición (B3 de
 * la US-009).
 */
export function DetallePeriodo({ id, empresa = null }) {
  const router = useRouter();
  const navegacion = useNavigation();
  const { empresaActiva, versionEmpresa } = useSesion();
  const [carga, setCarga] = useState({ estado: "cargando", periodo: null, error: null });
  const [historial, setHistorial] = useState({ estado: "cargando", lista: [], error: null });
  const [documentos, setDocumentos] = useState({ estado: "cargando", lista: [], error: null });
  const [ventana, setVentana] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [cedido, setCedido] = useState(false);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [errorFuente, setErrorFuente] = useState(null);
  const montado = useRef(true);
  const consulta = useRef(0);
  const cargaRef = useRef(carga);
  cargaRef.current = carga;
  const visor = useVisorDeEvidencias({ empresa });

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const periodo = carga.periodo;
  useEffect(() => {
    navegacion?.setOptions?.({ title: periodo?.codigo || "Obligación" });
  }, [navegacion, periodo?.codigo]);

  const cargarAnexos = useCallback(
    async (numero) => {
      const [h, d] = await Promise.allSettled([
        matrizService.historial(id, { empresa }),
        matrizService.documentos(id, { empresa }),
      ]);
      if (!montado.current || numero !== consulta.current) return;
      setHistorial(
        h.status === "fulfilled"
          ? { estado: "listo", lista: Array.isArray(h.value) ? h.value : [], error: null }
          : { estado: "error", lista: [], error: mensajeDeMatriz(h.reason, "No se pudo cargar el historial.") },
      );
      setDocumentos(
        d.status === "fulfilled"
          ? { estado: "listo", lista: Array.isArray(d.value) ? d.value : [], error: null }
          : { estado: "error", lista: [], error: mensajeDeMatriz(d.reason, "No se pudieron cargar los documentos.") },
      );
    },
    [id, empresa],
  );

  /** `silenciosa`: tras una acción o al tirar hacia abajo, sin «Cargando» y
   * sin borrar lo que se ve si falla. */
  const cargar = useCallback(
    async ({ silenciosa = false } = {}) => {
      const numero = ++consulta.current;
      if (!silenciosa) {
        setCarga({ estado: "cargando", periodo: null, error: null });
        setHistorial({ estado: "cargando", lista: [], error: null });
        setDocumentos({ estado: "cargando", lista: [], error: null });
      }
      const anexos = cargarAnexos(numero);
      try {
        const datos = await matrizService.periodo(id, { empresa });
        if (!montado.current || numero !== consulta.current) return;
        setCarga({ estado: "listo", periodo: datos, error: null });
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        if (e?.response?.status === 404) {
          setCarga({ estado: "no_existe", periodo: null, error: TEXTO_NO_DISPONIBLE });
        } else if (!(silenciosa && cargaRef.current.estado === "listo")) {
          setCarga({ estado: "error", periodo: null, error: mensajeDeMatriz(e, "No se pudo abrir la obligación.") });
        } else {
          setAviso({
            tipo: "mal",
            texto: `${mensajeDeMatriz(e, "No se pudo actualizar la obligación.")} Se muestra la última información.`,
            clave: Date.now(),
          });
        }
      }
      await anexos;
    },
    [id, empresa, cargarAnexos],
  );

  // Al cambiar de empresa se vuelve a pedir (QA-TECH, ronda 1).
  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  async function refrescar() {
    setRefrescando(true);
    await cargar({ silenciosa: cargaRef.current.estado === "listo" });
    if (montado.current) setRefrescando(false);
  }

  /** CA-5: al terminar, el detalle al día y el resultado anunciado (la
   * `Alerta` de tipo «bien» lo dice al lector de pantalla). La Bandeja y las
   * listas se releen al volver a ellas. */
  function despuesDe(accion) {
    setVentana(null);
    setAviso({ tipo: "bien", texto: AVISOS[accion], clave: Date.now() });
    cargar({ silenciosa: true });
  }

  function alGuardarSeguimiento(actualizado) {
    if (actualizado?.visible === false) {
      // Se cedió a otra persona: ya no es suyo y releerlo daría un 404 que
      // parecería un fallo del guardado (como la web).
      setVentana(null);
      setCedido(true);
      setAviso({ tipo: "bien", texto: TEXTO_YA_NO_ES_SUYO, clave: Date.now() });
      return;
    }
    if (actualizado && typeof actualizado === "object" && actualizado.id) {
      setCarga({ estado: "listo", periodo: actualizado, error: null });
    }
    despuesDe("seguimiento");
  }

  /** B-1 (ronda 1): llegó una respuesta de error (también sin respuesta
   * clara): la ventana ya lo anunció; el detalle se relee por si cambió. */
  const alResponder = useCallback(() => cargar({ silenciosa: true }), [cargar]);

  /** H-20 (ronda 1): la salida de «no existe» y de «ya no es suyo». */
  function volver() {
    if (typeof router.canGoBack !== "function" || router.canGoBack()) router.back();
    else router.replace("/matriz");
  }
  const empresaWeb = empresa ?? periodo?.empresa?.id ?? empresaActiva?.id;

  if (cedido) {
    return (
      <View style={estilos.centrado} testID="periodo-cedido">
        <Alerta tipo="bien" texto={aviso?.texto ?? TEXTO_YA_NO_ES_SUYO} clave={aviso?.clave} />
        <Boton titulo="Volver" icono="arrow-left" variante="secundario" onPress={volver} />
      </View>
    );
  }
  if (carga.estado === "cargando") return <Cargando texto="Cargando la obligación…" />;
  if (carga.estado === "no_existe") {
    return (
      <View style={estilos.centrado}>
        <Alerta tipo="mal" texto={carga.error} testID="periodo-no-existe" />
        <Boton testID="volver" titulo="Volver" icono="arrow-left" variante="secundario" onPress={volver} />
      </View>
    );
  }
  if (carga.estado === "error") {
    return (
      <View style={estilos.centrado}>
        <ErrorConReintento texto={carga.error} onReintentar={() => cargar()} />
      </View>
    );
  }

  const zona = periodo.empresa?.zona_horaria;
  const obligacion = periodo.obligacion ?? {};
  const botones = accionesEnLaApp(periodo.acciones);
  const enLaWeb = hayAccionesEnLaWeb(periodo.acciones);
  const dias = textoDeDias(periodo.estado);
  const validos = documentos.lista.filter((d) => d.estado === "valido");
  const rechazados = documentos.lista.filter((d) => d.estado === "rechazado");
  const fuente =
    typeof obligacion.fundamento_url === "string" && /^https?:\/\//i.test(obligacion.fundamento_url)
      ? obligacion.fundamento_url
      : null;

  async function abrirFuente() {
    setErrorFuente(null);
    const abierta = await abrirEnNavegador(fuente, { avisarSiFalla: false });
    if (!abierta) setErrorFuente(TEXTO_NAVEGADOR_FALLO);
  }

  return (
    <View style={estilos.pantalla}>
      <ScrollView
        testID="detalle-periodo"
        contentContainerStyle={estilos.contenido}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
      >
        <View style={estilos.resumen}>
          <Text style={estilos.codigo}>{[periodo.codigo, periodo.etiqueta].filter(Boolean).join(" · ")}</Text>
          <Text style={estilos.titulo} accessibilityRole="header">
            {obligacion.nombre}
          </Text>
          <View style={estilos.fila}>
            <EstadoDelPeriodo estado={periodo.estado} testID="estado-del-periodo" />
            {TIPOS[obligacion.tipo] ? <Pildora texto={TIPOS[obligacion.tipo]} tono={TONOS.neutro} /> : null}
            {periodo.empresa?.nombre ? <Pildora texto={periodo.empresa.nombre} tono={TONOS.neutro} /> : null}
          </View>
          <Dato nombre="Vence" valor={`${fechaHoraEnZona(periodo.vence_en, zona)}${dias ? ` · ${dias}` : ""}`} />
        </View>

        {aviso ? <Alerta tipo={aviso.tipo} texto={aviso.texto} clave={aviso.clave} testID="aviso-periodo" /> : null}

        {botones.length > 0 ? (
          <View style={estilos.botones} testID="acciones-del-periodo">
            {botones.map((b) => (
              <Boton
                key={b.accion}
                testID={`accion-${b.accion}`}
                titulo={b.texto}
                icono={b.icono}
                variante="secundario"
                onPress={() => {
                  setAviso(null);
                  setVentana(b.accion);
                }}
              />
            ))}
          </View>
        ) : null}

        {enLaWeb ? (
          <View testID="acciones-en-la-web">
            <AbrirEnLaWeb
              ruta={rutaWebDelPeriodo(periodo.id)}
              empresa={empresaWeb}
              texto={textoAccionesEnLaWeb(periodo.acciones)}
              testID="abrir-periodo-en-la-web"
            />
          </View>
        ) : null}

        {periodo.recordatorios_suspendidos ? (
          <Alerta tipo="info" texto="Los recordatorios de este período están suspendidos." />
        ) : null}

        <Seccion titulo="Seguimiento" testID="seccion-seguimiento">
          <Dato nombre="Prioridad" valor={PRIORIDADES[periodo.prioridad] ?? periodo.prioridad} />
          <Avance valor={periodo.avance} />
          <Dato nombre="Observaciones" valor={periodo.observaciones || "—"} />
        </Seccion>

        <Seccion titulo="Identificación">
          <Dato nombre="Sucursal" valor={periodo.sede?.nombre ?? "—"} />
          <Dato nombre="Tema" valor={obligacion.area_nombre ?? periodo.area} />
          <Dato nombre="Entidad de control" valor={obligacion.entidad_nombre ?? periodo.entidad} />
          <Dato nombre="Periodicidad" valor={PERIODICIDADES[obligacion.periodicidad] ?? obligacion.periodicidad} />
          <Dato nombre="Evidencia esperada" valor={obligacion.evidencia_esperada} />
          <Dato nombre="Descripción" valor={obligacion.descripcion} />
          {obligacion.fundamento_legal || fuente ? (
            <Dato nombre="Fundamento legal">
              {obligacion.fundamento_legal ? (
                <Text style={estilos.datoValor}>{obligacion.fundamento_legal}</Text>
              ) : null}
              {fuente ? (
                <Pressable
                  onPress={abrirFuente}
                  accessibilityRole="link"
                  accessibilityLabel="Ver la fuente del fundamento legal. Abre el navegador"
                  style={({ pressed }) => [estilos.enlace, pressed && estilos.presionada]}
                  testID="ver-fuente"
                >
                  <Text style={estilos.enlaceTexto}>Ver fuente</Text>
                  <Icono nombre="open-in-new" size={18} color={colores.enlace} />
                </Pressable>
              ) : null}
              {errorFuente ? <Alerta tipo="mal" texto={errorFuente} /> : null}
            </Dato>
          ) : null}
        </Seccion>

        <Seccion titulo="Fechas">
          <Dato nombre="Inicio" valor={diaCorto(periodo.fecha_inicio)} />
          <Dato nombre="Preparación" valor={diaCorto(periodo.fecha_preparacion)} />
          {periodo.cerrado ? (
            <>
              <Dato nombre="Cumplimiento" valor={fechaHoraEnZona(periodo.cumplido_en, zona)} />
              <Dato
                nombre="Validación"
                valor={`${fechaHoraEnZona(periodo.validado_en, zona)}${periodo.validado_por ? ` · ${periodo.validado_por.nombre}` : ""}`}
              />
            </>
          ) : null}
        </Seccion>

        <Seccion titulo="Responsables">
          <Persona nombre="Responsable" persona={periodo.responsable} />
          <Persona nombre="Suplente" persona={periodo.suplente} />
          <Persona nombre="Supervisor" persona={periodo.supervisor} />
          <Persona nombre="Aprobador" persona={periodo.aprobador} />
        </Seccion>

        <Seccion titulo="Documentos" testID="documentos-del-periodo">
          {periodo.cerrado ? (
            <Text style={estilos.tenue}>El período está cerrado: sus documentos son de solo lectura.</Text>
          ) : null}
          {documentos.estado === "cargando" ? <Cargando texto="Cargando los documentos…" /> : null}
          {documentos.estado === "error" ? (
            <ErrorConReintento texto={documentos.error} onReintentar={() => cargar({ silenciosa: true })} />
          ) : null}
          {documentos.estado === "listo" && validos.length === 0 && rechazados.length === 0 ? (
            <Vacio
              icono="folder-open-outline"
              texto="Sin documentos: aún no se ha cargado evidencia para este período."
            />
          ) : null}
          {validos.map((d) => (
            <Evidencia key={d.id} documento={d} zona={zona} abriendo={visor.abriendo} onAbrir={visor.abrir} />
          ))}
          {visor.error ? (
            <Alerta tipo="mal" texto={visor.error.texto} clave={visor.error.clave} testID="evidencia-error" />
          ) : null}
          {rechazados.length > 0 ? (
            <View style={estilos.rechazados}>
              <Text style={estilos.subtitulo}>Rechazados</Text>
              {rechazados.map((d) => (
                <View
                  key={d.id}
                  style={estilos.rechazado}
                  accessible
                  accessibilityLabel={`Rechazado: ${d.nombre_original}, versión ${d.version}. Rechazado por ${d.rechazado_por?.nombre ?? "—"}: ${d.motivo_rechazo ?? ""}`}
                >
                  <Icono nombre="file-remove-outline" size={22} color={colores.malTexto} />
                  <View style={estilos.evidenciaTextos}>
                    <Text style={estilos.evidenciaNombre}>{`${d.nombre_original} · v${d.version}`}</Text>
                    <Text style={estilos.rechazoTexto}>
                      {`Rechazado por ${d.rechazado_por?.nombre ?? "—"}: ${d.motivo_rechazo ?? ""}`}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </Seccion>

        <View style={estilos.plegable}>
          <Desplegable
            testID="historial"
            titulo={historial.estado === "listo" ? `Historial (${historial.lista.length})` : "Historial"}
            abierto={historialAbierto}
            onCambiar={setHistorialAbierto}
          >
            <View style={estilos.historial}>
              {historial.estado === "cargando" ? <Cargando texto="Cargando el historial…" /> : null}
              {historial.estado === "error" ? (
                <ErrorConReintento texto={historial.error} onReintentar={() => cargar({ silenciosa: true })} />
              ) : null}
              {historial.estado === "listo" && historial.lista.length === 0 ? <Vacio texto="Sin movimientos." /> : null}
              {historial.lista.map((ev) => (
                <View key={ev.id} style={estilos.evento} testID={`evento-${ev.id}`}>
                  <Text style={estilos.tenue}>{`${fechaHoraEnZona(ev.created_at, zona)} · ${ev.actor}`}</Text>
                  <Text style={estilos.texto}>{ev.descripcion}</Text>
                  {ev.valor_anterior || ev.valor_nuevo ? (
                    <Text style={estilos.tenue}>{`${ev.valor_anterior || "—"} → ${ev.valor_nuevo || "—"}`}</Text>
                  ) : null}
                  {ev.motivo ? <Text style={estilos.tenue}>{ev.motivo}</Text> : null}
                </View>
              ))}
            </View>
          </Desplegable>
        </View>
      </ScrollView>

      {ventana === "edit" ? (
        <FormularioSeguimiento
          periodo={periodo}
          empresa={empresa}
          onCerrar={() => setVentana(null)}
          onGuardado={alGuardarSeguimiento}
          onRespuesta={alResponder}
        />
      ) : null}
      {ventana === "change_due_date" ? (
        <FormularioFecha
          periodo={periodo}
          empresa={empresa}
          onCerrar={() => setVentana(null)}
          onGuardado={() => despuesDe("fecha")}
          onRespuesta={alResponder}
        />
      ) : null}
      {ventana === "remind" ? (
        <ConfirmarRecordatorio
          periodo={periodo}
          empresa={empresa}
          onCerrar={() => setVentana(null)}
          onEnviado={() => despuesDe("recordar")}
          onRespuesta={alResponder}
        />
      ) : null}
    </View>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 14, paddingBottom: 40 },
  centrado: { flex: 1, padding: 16, gap: 12, backgroundColor: colores.fondo },
  resumen: {
    gap: 8,
    padding: 14,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
    borderLeftWidth: 5,
    borderLeftColor: colores.acento,
  },
  codigo: { fontSize: 14, color: colores.tintaSuave },
  titulo: { fontSize: 20, fontWeight: "700", color: colores.titulo },
  subtitulo: { fontSize: 15, fontWeight: "700", color: colores.titulo },
  fila: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  // H-12: las acciones en una fila que se ajusta al ancho.
  botones: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  texto: { fontSize: 15, color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  dato: { gap: 2 },
  datoNombre: { fontSize: 13, color: colores.tintaSuave },
  datoValor: { fontSize: 16, color: colores.tinta, fontWeight: "600" },
  avance: { gap: 6 },
  barra: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colores.hundido,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colores.bordeControl,
  },
  barraLlena: { height: "100%", backgroundColor: colores.primario },
  enlace: { minHeight: AREA_TACTIL, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  enlaceTexto: { fontSize: 15, fontWeight: "600", color: colores.enlace, textDecorationLine: "underline" },
  presionada: { backgroundColor: colores.realce },
  evidencia: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    backgroundColor: colores.superficie,
  },
  evidenciaTextos: { flex: 1, gap: 2 },
  evidenciaNombre: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  rechazados: { gap: 8 },
  rechazado: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colores.malFondo,
  },
  rechazoTexto: { fontSize: 14, color: colores.malTexto },
  plegable: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  historial: { gap: 10, paddingBottom: 10 },
  evento: {
    gap: 2,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: colores.acento,
    backgroundColor: colores.fondo,
    borderRadius: 6,
  },
});
