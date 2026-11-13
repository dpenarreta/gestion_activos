import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, useWindowDimensions, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { erroresPorCampo, mensajeDeError } from "../../api/errores";
import { licenciasService } from "../../api/servicios";
import { Alerta, Boton, Cargando, ErrorConReintento } from "../../componentes/comunes";
import { VisorDeImagen } from "../../componentes/VisorDeImagen";
import {
  abrirPdf,
  borrarArchivo,
  descargarDocumento,
  TEXTO_TIPO_NO_VISIBLE,
  tipoDeDocumento,
} from "../../permisos/documentos";
import {
  DESCUENTOS,
  dias,
  duracionDeSolicitud,
  fechaCorta,
  fechaYHora,
  horario,
  muestraComentario,
  pendienteDe,
  rangoDeFechas,
  textoDeAccion,
} from "../../permisos/formato";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { useResumenPermisos } from "../../permisos/ResumenPermisosContext";
import { colores } from "../../tema/colores";
import { AbrirEnLaWeb, CampoTexto, EstadoSolicitud, ReglasDelPermiso } from "./piezas";
import { crearEstilos } from "../../tema/tipografia";

/**
 * El detalle de una solicitud (US-010, CA-8 a CA-11): quién pide, qué, el
 * estado y a quién le toca, lo que hace falta para decidir, el motivo, el
 * documento y el historial; y las acciones que la app replica: cancelar la
 * propia pendiente, aprobar y rechazar. Escalar y anular una aprobada se
 * hacen en la web («Abrir en el navegador»).
 *
 * `empresa`: la del push. Va como `X-Empresa` en el detalle, las acciones y
 * el documento, porque la solicitud puede no ser de la empresa activa (B3).
 */
export const TEXTO_NO_ENCONTRADA = "No se encontró la solicitud.";
/** El comentario de un rechazo tiene que explicar algo a quien pidió (como
 * en la web). */
export const MINIMO_RECHAZO = 10;
export const TEXTO_RECHAZO_SIN_COMENTARIO = `Para rechazar, explique el motivo (al menos ${MINIMO_RECHAZO} caracteres): lo leerá quien la pidió.`;
export const TEXTO_ESCALAR_EN_LA_WEB = "Para escalar la solicitud a otra persona, ábrala en el navegador.";
export const TEXTO_AYUDA_COMENTARIO = `Opcional para aprobar. Para rechazar, explique el motivo (al menos ${MINIMO_RECHAZO} caracteres).`;
/** Neutral a propósito: lo que pasa al anular una aprobada lo está cambiando
 * la US-012, y la web lo explica al hacerlo (revisión de QA, O-6). */
export const TEXTO_ANULAR_EN_LA_WEB =
  "Esta solicitud ya está aprobada. Si hay que anularla, hágalo en la web, donde se explica qué ocurre al anularla.";

/** Una pregunta con «Volver» y la acción; resuelve `true` si se confirma. */
function confirmar({ titulo, mensaje, accion, destructiva = false }) {
  return new Promise((resolver) => {
    Alert.alert(
      titulo,
      mensaje,
      [
        { text: "Volver", style: "cancel", onPress: () => resolver(false) },
        { text: accion, style: destructiva ? "destructive" : "default", onPress: () => resolver(true) },
      ],
      { cancelable: true, onDismiss: () => resolver(false) },
    );
  });
}

/** Un id que no es un número (un enlace profundo mal formado). */
export function SolicitudNoEncontrada() {
  const router = useRouter();
  return (
    <View style={estilos.contenido}>
      <Alerta tipo="mal" texto={TEXTO_NO_ENCONTRADA} />
      <Boton titulo="Volver" icono="arrow-left" variante="secundario" onPress={() => volver(router)} />
    </View>
  );
}

function volver(router) {
  if (router.canGoBack?.() === false) router.replace("/permisos");
  else router.back();
}

export function DetalleSolicitud({ id, empresa = null, creada = false }) {
  const router = useRouter();
  // Antes de cualquier `return` temprano (revisión UX, M-1).
  const alturaCabecera = useAlturaCabecera();
  const { fontScale } = useWindowDimensions();
  const { recargar: recargarResumen } = useResumenPermisos();
  const [estado, setEstado] = useState("cargando");
  const [solicitud, setSolicitud] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [comentario, setComentario] = useState("");
  const [errorComentario, setErrorComentario] = useState(null);
  const [error, setError] = useState(null);
  const [hecho, setHecho] = useState(null);
  const [trabajando, setTrabajando] = useState(null);
  const [documento, setDocumento] = useState({ cargando: false, error: null, imagen: null });
  const [noEncontrada, setNoEncontrada] = useState(false);
  // Candados síncronos: el estado tarda un render en desactivar los botones.
  // `ocupado` se toma ANTES de la confirmación, para que dos toques no abran
  // dos preguntas (revisión técnica).
  const ocupado = useRef(false);
  const descargando = useRef(false);
  const montado = useRef(true);
  const avisoCreada = useRef(creada);
  const desplazable = useRef(null);
  // LOPDP: el documento (a menudo de otra persona) no se queda en el
  // teléfono: se borra al cerrar el visor y al salir del detalle.
  const descargado = useRef(null);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      borrarArchivo(descargado.current);
      descargado.current = null;
    };
  }, []);

  const cargar = useCallback(async () => {
    setEstado("cargando");
    try {
      const datos = await licenciasService.solicitud(id, { empresa });
      if (!montado.current) return;
      setSolicitud(datos);
      setEstado("listo");
      if (avisoCreada.current) {
        avisoCreada.current = false;
        const pendiente = pendienteDe(datos);
        setHecho(pendiente ? `Solicitud enviada: queda pendiente de ${pendiente}.` : "Solicitud enviada.");
      }
    } catch (e) {
      if (!montado.current) return;
      const es404 = e?.response?.status === 404;
      setNoEncontrada(es404);
      setErrorCarga(es404 ? TEXTO_NO_ENCONTRADA : mensajeDeError(e, "No se pudo abrir la solicitud."));
      setEstado("error");
    }
  }, [id, empresa]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Toma el candado, pregunta y, si se confirma, hace la acción. */
  async function conCandado(preguntar, nombre, accion, listo) {
    if (ocupado.current) return;
    ocupado.current = true;
    let si = false;
    try {
      si = await preguntar();
    } finally {
      if (!si) ocupado.current = false;
    }
    if (si) await hacer(nombre, accion, listo);
  }

  /** La acción ya confirmada; el candado lo suelta al terminar. */
  async function hacer(nombre, accion, listo) {
    ocupado.current = true;
    setTrabajando(nombre);
    setError(null);
    setHecho(null);
    try {
      const datos = await accion();
      if (!montado.current) return;
      setSolicitud(datos);
      setComentario("");
      setErrorComentario(null);
      const texto = listo(datos);
      setHecho(texto);
      anunciar(texto);
      // El resultado va arriba, donde está el estado nuevo.
      desplazable.current?.scrollTo?.({ y: 0, animated: true });
      // CA-10: la insignia de «Por aprobar» se actualiza; las listas, al
      // volver a la pestaña.
      recargarResumen();
    } catch (e) {
      if (!montado.current) return;
      const delComentario = erroresPorCampo(e).comentario;
      if (delComentario) {
        setErrorComentario(delComentario);
        anunciar(delComentario);
      } else {
        // CA-10: si los días ya no alcanzan, el servidor lo dice y la
        // solicitud sigue pendiente (no se toca lo que se ve).
        setError(mensajeDeError(e, "No se pudo completar."));
      }
    } finally {
      ocupado.current = false;
      if (montado.current) setTrabajando(null);
    }
  }

  const siguiente = (datos) =>
    datos?.estado === "pendiente" && pendienteDe(datos) ? ` Ahora le toca a ${pendienteDe(datos)}.` : "";

  async function aprobar() {
    const texto = comentario.trim();
    await conCandado(
      () =>
        confirmar({
          titulo: "¿Aprobar la solicitud?",
          mensaje: `${resumenDe(solicitud)}. ${
            texto
              ? `Se enviará su comentario: «${texto}».`
              : "Si es el último paso, la solicitud queda aprobada y se avisa a quien la hizo."
          }`,
          accion: "Aprobar",
        }),
      "aprobar",
      () => licenciasService.aprobar(id, texto, { empresa }),
      (datos) => `Aprobada.${siguiente(datos)}`,
    );
  }

  async function rechazar() {
    const texto = comentario.trim();
    if (texto.length < MINIMO_RECHAZO) {
      setErrorComentario(TEXTO_RECHAZO_SIN_COMENTARIO);
      anunciar(TEXTO_RECHAZO_SIN_COMENTARIO);
      return;
    }
    await conCandado(
      () =>
        confirmar({
          titulo: "¿Rechazar la solicitud?",
          mensaje: `${resumenDe(solicitud)}. La solicitud termina aquí y se avisa a quien la hizo con su comentario: «${texto}».`,
          accion: "Rechazar",
          destructiva: true,
        }),
      "rechazar",
      () => licenciasService.rechazar(id, texto, { empresa }),
      () => "Rechazada. Se avisó a quien la hizo.",
    );
  }

  async function cancelar() {
    await conCandado(
      () =>
        confirmar({
          titulo: "¿Cancelar la solicitud?",
          mensaje: "La solicitud se retira y ya no sigue su aprobación.",
          accion: "Cancelar solicitud",
          destructiva: true,
        }),
      "cancelar",
      () => licenciasService.cancelar(id, comentario.trim(), { empresa }),
      () => "Solicitud cancelada.",
    );
  }

  async function verDocumento() {
    if (descargando.current) return;
    const tipo = tipoDeDocumento(solicitud.adjunto_nombre);
    if (tipo === "otro") {
      // Ni imagen ni PDF: la app no tiene con qué mostrarlo.
      setDocumento({ cargando: false, error: TEXTO_TIPO_NO_VISIBLE, imagen: null });
      return;
    }
    descargando.current = true;
    setDocumento({ cargando: true, error: null, imagen: null });
    try {
      const archivo = await descargarDocumento(id, solicitud.adjunto_nombre, { empresa });
      if (!montado.current) {
        borrarArchivo(archivo);
        return;
      }
      descargado.current = archivo;
      if (tipo === "imagen") {
        setDocumento({ cargando: false, error: null, imagen: archivo.uri, archivo });
        return;
      }
      // El PDF lo abre otra app: se borra al salir del detalle, no antes.
      await abrirPdf(archivo, solicitud.adjunto_nombre);
      if (montado.current) setDocumento({ cargando: false, error: null, imagen: null });
    } catch (e) {
      if (!montado.current) return;
      setDocumento({ cargando: false, error: e?.message || "No se pudo abrir el documento.", imagen: null });
    } finally {
      descargando.current = false;
    }
  }

  function cerrarVisor() {
    borrarArchivo(descargado.current);
    descargado.current = null;
    setDocumento((d) => ({ ...d, imagen: null, archivo: null }));
  }

  if (estado === "cargando" && !solicitud) return <Cargando texto="Cargando la solicitud…" />;
  if (estado === "error") {
    // Un 404 no se arregla reintentando: se ofrece volver.
    if (noEncontrada) return <SolicitudNoEncontrada />;
    return (
      <View style={estilos.contenido}>
        <ErrorConReintento texto={errorCarga} onReintentar={cargar} />
      </View>
    );
  }

  const s = solicitud;
  const puedo = s.puedo ?? {};
  // N-01: con la letra grande, cada botón pide más ancho y la fila baja a
  // dos líneas en vez de cortar «Rechazando…».
  const baseDecision = { flexBasis: 140 * Math.max(1, fontScale) };
  const porHoras = s.unidad === "horas";
  const horas = horario(s.hora_desde, s.hora_hasta);
  const puedeCancelar = Boolean(puedo.cancelar) && !puedo.cancelar_pide_comentario;
  const actua = Boolean(puedo.resolver) || puedeCancelar;
  const enLaWeb = [
    puedo.escalar ? TEXTO_ESCALAR_EN_LA_WEB : null,
    puedo.cancelar_pide_comentario ? TEXTO_ANULAR_EN_LA_WEB : null,
  ].filter(Boolean);

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      // Solo Android: en iOS ya ajusta `automaticallyAdjustKeyboardInsets`.
      behavior="padding"
      enabled={Platform.OS === "android"}
      keyboardVerticalOffset={alturaCabecera}
    >
    <ScrollView
      ref={desplazable}
      testID="detalle-solicitud"
      style={estilos.pantalla}
      contentContainerStyle={estilos.contenido}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      automaticallyAdjustKeyboardInsets
    >
      {hecho ? <Alerta tipo="bien" texto={hecho} testID="resultado" /> : null}

      <View style={estilos.cabecera}>
        <Text style={estilos.titulo} accessibilityRole="header">
          {s.flujo}
        </Text>
        <EstadoSolicitud solicitud={s} />
      </View>

      {s.estado === "pendiente" &&
        (puedo.resolver ? (
          <Alerta tipo="info" texto={`Le toca decidir a usted (paso «${s.paso_actual}»).`} />
        ) : (
          <Text style={estilos.texto}>
            En el paso «{s.paso_actual}», esperando a {pendienteDe(s) || "quien corresponda"}.
          </Text>
        ))}

      <View style={estilos.datos}>
        <Dato nombre="Solicitante" valor={s.solicitante?.nombre} extra={[s.cargo, s.area].filter(Boolean).join(" · ")} />
        <Dato nombre={porHoras ? "Fecha" : "Fechas"} valor={rangoDeFechas(s.desde, s.hasta)} />
        {porHoras ? (
          <>
            {horas ? <Dato nombre="Horario" valor={horas} /> : null}
            <Dato nombre="Duración" valor={duracionDeSolicitud(s)} />
          </>
        ) : (
          // Con su unidad: «5 días» y no «5» (auditoría UX, H-18).
          <Dato nombre="Días" valor={s.dias === null || s.dias === undefined || s.dias === "" ? "" : dias(Number(s.dias))} />
        )}
        {DESCUENTOS[s.descuento] ? <Dato nombre="Descuento" valor={DESCUENTOS[s.descuento]} /> : null}
        <Dato nombre="Solicitada el" valor={fechaYHora(s.created_at)} />
        {s.cerrada_en ? <Dato nombre="Cerrada el" valor={fechaYHora(s.cerrada_en)} /> : null}
      </View>

      {s.evaluacion?.reglas?.length > 0 ? (
        <ReglasDelPermiso evaluacion={s.evaluacion} titulo="Para decidir: saldo y restricciones" />
      ) : null}
      {s.feriados?.length > 0 ? (
        <Text style={estilos.texto}>Feriados en estas fechas: {s.feriados.map(fechaCorta).join(", ")}.</Text>
      ) : null}

      {s.motivo ? (
        <View style={estilos.seccion}>
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Motivo
          </Text>
          <Text style={estilos.texto}>{s.motivo}</Text>
        </View>
      ) : null}

      {s.tiene_adjunto ? (
        <View style={estilos.seccion}>
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Documento de respaldo
          </Text>
          <Boton
            testID="ver-documento"
            titulo={documento.cargando ? "Descargando…" : "Ver documento"}
            icono="paperclip"
            variante="secundario"
            cargando={documento.cargando}
            etiqueta={`Ver documento: ${s.adjunto_nombre || "documento de respaldo"}`}
            pista={
              tipoDeDocumento(s.adjunto_nombre) === "pdf"
                ? "Se abre con el visor de PDF del teléfono"
                : "Se abre dentro de la app"
            }
            onPress={() => {
              verDocumento();
            }}
          />
          {s.adjunto_nombre ? <Text style={estilos.tenue}>{s.adjunto_nombre}</Text> : null}
          {documento.error ? <Alerta tipo="mal" texto={documento.error} /> : null}
        </View>
      ) : null}

      {actua && (
        <View style={estilos.seccion} testID="acciones">
          {error ? <Alerta tipo="mal" texto={error} /> : null}
          <CampoTexto
            testID="comentario"
            etiqueta="Comentario para el solicitante"
            ayuda={puedo.resolver ? TEXTO_AYUDA_COMENTARIO : "Opcional."}
            valor={comentario}
            onCambio={(t) => {
              setComentario(t);
              setErrorComentario(null);
            }}
            error={errorComentario}
            multilinea
            maximo={2000}
          />
          {puedo.resolver && (
            // [Rechazar | Aprobar] en una fila: con la letra grande cada uno
            // baja a su propia línea sin cortarse (auditoría UX, H-04).
            <View style={estilos.decision}>
              <View style={[estilos.decisionBoton, baseDecision]} testID="decision-rechazar">
                <Boton
                  testID="rechazar"
                  titulo={trabajando === "rechazar" ? "Rechazando…" : "Rechazar"}
                  icono="close-circle-outline"
                  variante="secundario"
                  cargando={trabajando === "rechazar"}
                  deshabilitado={Boolean(trabajando)}
                  onPress={() => {
                    rechazar();
                  }}
                />
              </View>
              <View style={[estilos.decisionBoton, baseDecision]} testID="decision-aprobar">
                <Boton
                  testID="aprobar"
                  titulo={trabajando === "aprobar" ? "Aprobando…" : "Aprobar"}
                  icono="check-circle-outline"
                  cargando={trabajando === "aprobar"}
                  deshabilitado={Boolean(trabajando)}
                  onPress={() => {
                    aprobar();
                  }}
                />
              </View>
            </View>
          )}
          {puedeCancelar && (
            <Boton
              testID="cancelar-solicitud"
              titulo={trabajando === "cancelar" ? "Cancelando…" : "Cancelar solicitud"}
              icono="cancel"
              variante="secundario"
              cargando={trabajando === "cancelar"}
              deshabilitado={Boolean(trabajando)}
              onPress={() => {
              cancelar();
            }}
            />
          )}
        </View>
      )}
      {!actua && error ? <Alerta tipo="mal" texto={error} /> : null}

      {enLaWeb.length > 0 && (
        <AbrirEnLaWeb
          testID="solicitud-en-la-web"
          ruta={`/admin/institucional/permisos?solicitud=${s.id}`}
          empresa={empresa}
          texto={enLaWeb.join(" ")}
        />
      )}

      {/* El historial al final: la decisión no espera detrás de él
          (auditoría UX, H-04). */}
      <View style={estilos.seccion} testID="historial">
        <Text style={estilos.subtitulo} accessibilityRole="header">
          Historial
        </Text>
        {(s.acciones ?? []).map((a) => (
          <View key={a.id} style={estilos.accion} accessible>
            <Text style={estilos.tenue}>{fechaYHora(a.created_at)}</Text>
            <Text style={estilos.texto}>{textoDeAccion(a)}</Text>
            {muestraComentario(a) ? <Text style={estilos.comentario}>«{a.comentario}»</Text> : null}
          </View>
        ))}
      </View>

      <VisorDeImagen
        uri={documento.imagen}
        archivo={documento.archivo}
        titulo={s.adjunto_nombre}
        onCerrar={cerrarVisor}
      />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function resumenDe(s) {
  if (!s) return "";
  const horas = s.unidad === "horas" ? horario(s.hora_desde, s.hora_hasta) : "";
  return `${s.flujo} de ${s.solicitante?.nombre ?? ""} (${[rangoDeFechas(s.desde, s.hasta), horas, duracionDeSolicitud(s)]
    .filter(Boolean)
    .join(", ")})`;
}

function Dato({ nombre, valor, extra }) {
  if (!valor) return null;
  return (
    <View style={estilos.dato} accessible accessibilityLabel={`${nombre}: ${valor}${extra ? `. ${extra}` : ""}`}>
      <Text style={estilos.datoNombre}>{nombre}</Text>
      <Text style={estilos.datoValor}>{valor}</Text>
      {extra ? <Text style={estilos.tenue}>{extra}</Text> : null}
    </View>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 14, paddingBottom: 40 },
  cabecera: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  titulo: { flexShrink: 1, fontSize: 22, fontWeight: "700", color: colores.tinta },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.tinta },
  texto: { fontSize: 15, color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  seccion: { gap: 8 },
  decision: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  decisionBoton: { flexGrow: 1, flexBasis: 140 },
  datos: {
    gap: 10,
    padding: 14,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  dato: { gap: 2 },
  datoNombre: { fontSize: 13, color: colores.tintaSuave },
  datoValor: { fontSize: 16, color: colores.tinta, fontWeight: "600" },
  accion: {
    gap: 2,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: colores.acento,
    backgroundColor: colores.superficie,
    borderRadius: 6,
  },
  // Sin cursiva: no se carga Poppins Italic. Las comillas y el color lo
  // distinguen.
  comentario: { fontSize: 15, color: colores.tintaSuave },
});
