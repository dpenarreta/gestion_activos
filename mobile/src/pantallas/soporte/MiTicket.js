import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { soporteService } from "../../api/servicios";
import { Alerta, Boton, Cargando, ErrorConReintento } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { VisorDeImagen } from "../../componentes/VisorDeImagen";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { volverAlModulo } from "../../navegacion/abrir";
import { useSesion } from "../../sesion/SesionContext";
import { useAdjuntosPorEnviar, useVisorDeAdjuntos, validarLista } from "../../soporte/adjuntos";
import {
  enLaCola,
  esModuloApagado,
  mensajeDeSoporte,
  rutaDeAltaPropia,
  SATISFACCION,
} from "../../soporte/formato";
import { useRecargarResumenSoporte } from "../../soporte/ResumenSoporteContext";
import { SONDEO_FICHAS_MS, useSondeo } from "../../soporte/useSondeo";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { aHora, fechaCorta, fechaYHora } from "../../utils/fechas";
import { CampoTexto } from "../permisos/piezas";
import { AdjuntosPorEnviar, Dato, EstadoTicket, ListaDeAdjuntos, MensajeDelTicket, Seccion } from "./piezas";

/**
 * La ficha de un ticket propio (US-014, CA-7, CA-18 y CA-22), como
 * `MiTicket.jsx` de la web: el estado en el vocabulario de quien pide, la
 * posición o quién lo atiende, los plazos, «Lo que nos contó» con sus
 * adjuntos y la conversación (el servidor no manda nada interno).
 *
 * - Responder con texto y hasta 3 adjuntos, si `puede_responder`.
 * - «¿Quedó resuelto?»: «Sí» confirma; «No, sigue el problema» lleva a
 *   responder, que lo reabre.
 * - La encuesta, con el ticket cerrado (`puede_encuestar`).
 * - Se actualiza sola cada 10 s (`?sondeo=1`) con la pantalla a la vista; el
 *   sondeo no toca lo que se está escribiendo, y si falla se conserva lo que
 *   se ve.
 */
export const TEXTO_NO_DISPONIBLE = "No encontramos este ticket entre los suyos.";
export const TEXTO_RESPUESTA_VACIA = "Escriba su mensaje o adjunte un archivo.";
export const TEXTO_REFRESCO_FALLIDO =
  "No se pudo actualizar el ticket; se muestra la última información y se volverá a intentar en unos segundos.";
export const TEXTO_CERRADO = "Este ticket está cerrado. Si el problema volvió, cree un ticket nuevo.";
/** G-4: el ticket se cerró mientras se escribía. */
export const TEXTO_BORRADOR_SIN_ENVIAR =
  "El ticket se cerró mientras escribía y ya no se puede responder. Su texto no se envió; puede copiarlo:";
export const TEXTO_CERRADO_SIN_PERMISO =
  "Este ticket está cerrado. Si el problema volvió, pida a su jefe o a Tecnología el permiso para crear tickets.";

const HECHO = {
  responder: "Mensaje enviado. Soporte le responderá aquí.",
  confirmar: "¡Gracias! Cerramos su ticket. Si quiere, cuéntenos abajo cómo le fue.",
  encuesta: "¡Gracias por su opinión!",
};

function Encuesta({ ticket, onResponder, enviando, error }) {
  const [calificacion, setCalificacion] = useState(0);
  const [resuelto, setResuelto] = useState(null);
  const [comentario, setComentario] = useState("");
  const [falta, setFalta] = useState(null);
  // QA-TECH: el foco del lector va a la pregunta que falta.
  const primeraEstrella = useRef(null);
  const primerResuelto = useRef(null);

  if (ticket.encuesta) {
    return (
      <Seccion titulo="¿Cómo lo atendimos?" testID="encuesta">
        <Text style={estilos.texto}>
          ¡Gracias por su respuesta! Calificó la atención con {ticket.encuesta.calificacion} de 5.
        </Text>
      </Seccion>
    );
  }

  function enviar() {
    const motivo = !calificacion
      ? "Elija una calificación de 1 a 5 estrellas."
      : resuelto === null
        ? "Indique si su requerimiento se resolvió."
        : null;
    setFalta(motivo ? { texto: motivo, clave: Date.now() } : null);
    if (motivo) {
      const destino = !calificacion ? primeraEstrella.current : primerResuelto.current;
      try {
        if (destino) AccessibilityInfo.sendAccessibilityEvent(destino, "focus");
      } catch {
        // El error también se anuncia aparte.
      }
      return;
    }
    onResponder({ calificacion, resuelto, comentario: comentario.trim() });
  }

  return (
    <Seccion titulo="¿Cómo lo atendimos?" testID="encuesta">
      <Text style={estilos.etiqueta}>¿Qué tan satisfecho está con la atención recibida?</Text>
      <View style={estilos.estrellas} accessibilityRole="radiogroup" accessibilityLabel="Calificación del servicio, de 1 a 5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            ref={n === 1 ? primeraEstrella : undefined}
            testID={`estrella-${n}`}
            onPress={() => {
              setCalificacion(n);
              setFalta(null);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: calificacion === n }}
            accessibilityLabel={`${n} de 5: ${SATISFACCION[n - 1]}`}
            style={estilos.estrella}
          >
            <Icono nombre={n <= calificacion ? "star" : "star-outline"} size={32} color={colores.primario} />
          </Pressable>
        ))}
      </View>
      <Text style={estilos.tenue}>{calificacion ? SATISFACCION[calificacion - 1] : "1: nada satisfecho · 5: muy satisfecho"}</Text>
      <Text style={estilos.etiqueta}>¿Su requerimiento se resolvió completamente?</Text>
      <View style={estilos.fila} accessibilityRole="radiogroup" accessibilityLabel="¿Se resolvió completamente?">
        {[
          [true, "Sí"],
          [false, "No"],
        ].map(([valor, texto]) => (
          <Pressable
            key={texto}
            ref={valor ? primerResuelto : undefined}
            testID={`resuelto-${valor ? "si" : "no"}`}
            onPress={() => {
              setResuelto(valor);
              setFalta(null);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: resuelto === valor }}
            accessibilityLabel={texto}
            style={[estilos.siNo, resuelto === valor && estilos.siNoActivo]}
          >
            <Text style={[estilos.siNoTexto, resuelto === valor && estilos.siNoTextoActivo]}>{texto}</Text>
          </Pressable>
        ))}
      </View>
      <CampoTexto
        testID="encuesta-comentario"
        etiqueta="Comentario"
        opcional
        valor={comentario}
        onCambio={setComentario}
        multilinea
        maximo={2000}
      />
      {falta ? <Alerta tipo="mal" texto={falta.texto} clave={falta.clave} /> : null}
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} /> : null}
      <Boton
        testID="enviar-encuesta"
        titulo={enviando ? "Enviando…" : "Enviar encuesta"}
        icono="send"
        cargando={enviando}
        onPress={enviar}
      />
    </Seccion>
  );
}

export function MiTicket({ id, empresa = null }) {
  const router = useRouter();
  const navegacion = useNavigation();
  const alturaCabecera = useAlturaCabecera();
  const { usuario } = useSesion();
  const { recargar: recargarResumen } = useRecargarResumenSoporte();
  const puedeCrear = Boolean(rutaDeAltaPropia(usuario?.permissions ?? []));
  const opciones = empresa ? { empresa } : {};
  const [ticket, setTicket] = useState(null);
  const [carga, setCarga] = useState({ estado: "cargando", error: null, noExiste: false });
  const [refrescoFallido, setRefrescoFallido] = useState(false);
  const [novedad, setNovedad] = useState(null);
  const [texto, setTexto] = useState("");
  const [errorTexto, setErrorTexto] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [resultado, setResultado] = useState(null);
  const adjuntos = useAdjuntosPorEnviar();
  const visor = useVisorDeAdjuntos(opciones);
  const montado = useRef(true);
  const candado = useRef(false);
  // Cada acción sube la versión: una respuesta del sondeo que salió antes
  // no pisa lo que devolvió la acción.
  const version = useRef(0);
  const ticketRef = useRef(null);
  ticketRef.current = ticket;
  const refrescoFallidoRef = useRef(false);
  refrescoFallidoRef.current = refrescoFallido;
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    navegacion?.setOptions?.({ title: ticket ? `Ticket ${ticket.numero}` : "Mi ticket" });
  }, [navegacion, ticket?.numero]); // eslint-disable-line react-hooks/exhaustive-deps

  const cargar = useCallback(async () => {
    setCarga({ estado: "cargando", error: null, noExiste: false });
    const numero = ++version.current;
    try {
      const datos = await soporteService.miTicket(id, opciones);
      if (!montado.current || numero !== version.current) return;
      setTicket(datos);
      setCarga({ estado: "listo", error: null, noExiste: false });
    } catch (e) {
      // QA-TECH, ronda 2 (d): un error de una carga ya vieja no se muestra.
      if (!montado.current || numero !== version.current) return;
      const status = e?.response?.status;
      const noExiste = (status === 404 || status === 403) && !esModuloApagado(e);
      setCarga({
        estado: "error",
        noExiste,
        error: noExiste ? TEXTO_NO_DISPONIBLE : mensajeDeSoporte(e, "No se pudo cargar su ticket."),
      });
    }
    // `opciones` depende solo de `empresa`.
  }, [id, empresa]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    cargar();
  }, [cargar]);

  const sondear = useCallback(async () => {
    if (candado.current || !ticketRef.current) return;
    const numero = version.current;
    try {
      const datos = await soporteService.miTicket(id, { ...opciones, sondeo: true });
      if (!montado.current || numero !== version.current || candado.current) return;
      const antes = ticketRef.current;
      const deSoporte = (lista) => (lista ?? []).filter((m) => !m.del_solicitante).length;
      const hora = aHora(new Date());
      // T3 (WCAG 4.1.3): la novedad se ve y se anuncia.
      let texto = null;
      if (antes && deSoporte(datos.mensajes) > deSoporte(antes.mensajes)) {
        texto = `Soporte le respondió (${hora}): lea el mensaje nuevo abajo.`;
      } else if (antes && datos.estado !== antes.estado) {
        texto = `Su ticket pasó a «${datos.estado_display}» (${hora}).`;
      }
      if (texto) {
        setNovedad({ texto, clave: Date.now() });
        anunciar(texto);
      }
      setTicket(datos);
      setRefrescoFallido(false);
    } catch {
      // CA-22: un sondeo fallido no borra lo que se ve. N-11: se anuncia
      // solo la primera vez, no en cada intento.
      if (!montado.current) return;
      if (!refrescoFallidoRef.current) anunciar(TEXTO_REFRESCO_FALLIDO);
      setRefrescoFallido(true);
    }
  }, [id, empresa]); // eslint-disable-line react-hooks/exhaustive-deps

  useSondeo(sondear, SONDEO_FICHAS_MS, carga.estado === "listo" && !ocupado);

  async function ejecutar(donde, accion) {
    if (candado.current) return false;
    candado.current = true;
    version.current += 1;
    setOcupado(donde);
    setResultado(null);
    setNovedad(null);
    try {
      const actualizado = await accion();
      if (!montado.current) return true;
      setTicket(actualizado);
      setResultado({ donde, tipo: "bien", texto: HECHO[donde], clave: Date.now() });
      recargarResumen();
      return true;
    } catch (e) {
      if (montado.current) {
        setResultado({
          donde,
          tipo: "mal",
          texto: mensajeDeSoporte(e, "No se pudo enviar.", { envio: true }),
          clave: Date.now(),
        });
      }
      return false;
    } finally {
      candado.current = false;
      if (montado.current) setOcupado(null);
    }
  }

  function irAResponder() {
    irA("responder");
  }

  async function responder() {
    if (candado.current) return;
    if (!texto.trim() && adjuntos.lista.length === 0) {
      setErrorTexto(TEXTO_RESPUESTA_VACIA);
      anunciar(TEXTO_RESPUESTA_VACIA);
      irA("responder");
      return;
    }
    const errorAdjuntos = validarLista(adjuntos.lista);
    if (errorAdjuntos) {
      setResultado({ donde: "responder", tipo: "mal", texto: errorAdjuntos, clave: Date.now() });
      return;
    }
    setErrorTexto(null);
    const hecho = await ejecutar("responder", () =>
      soporteService.responderMiTicket(id, texto.trim(), adjuntos.lista, opciones),
    );
    // CA-22: si falla, lo escrito y los archivos se quedan.
    if (hecho && montado.current) {
      setTexto("");
      adjuntos.vaciar();
    }
  }

  if (carga.estado === "cargando" && !ticket) return <Cargando texto="Cargando su ticket…" />;
  if (carga.estado === "error" && !ticket) {
    return (
      <View style={estilos.contenido} testID="mi-ticket-error">
        {carga.noExiste ? (
          <>
            <Alerta tipo="mal" texto={TEXTO_NO_DISPONIBLE} />
            <Boton
              titulo="Ver mis tickets"
              icono="arrow-left"
              variante="secundario"
              onPress={() => volverAlModulo(router, { pathname: "/soporte", params: { vista: "mis" } })}
            />
          </>
        ) : (
          <ErrorConReintento texto={carga.error} onReintentar={cargar} />
        )}
      </View>
    );
  }

  const t = ticket;
  const ahora = Date.now();
  const plazos = t.plazos ?? {};
  const respuestaVence = plazos.respuesta ? new Date(plazos.respuesta).getTime() : null;
  const resultadoEn = (donde) =>
    resultado?.donde === donde ? (
      <Alerta tipo={resultado.tipo} texto={resultado.texto} clave={resultado.clave} testID={`resultado-${donde}`} />
    ) : null;

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior="padding"
      enabled={Platform.OS === "android"}
      keyboardVerticalOffset={alturaCabecera}
    >
      <ScrollView
        ref={desplazable}
        testID="mi-ticket"
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        automaticallyAdjustKeyboardInsets
      >
        {/* H-23: el número ya va en la barra de arriba; aquí, lo que se pidió. */}
        <View style={estilos.cabecera}>
          <Text style={estilos.titulo} accessibilityRole="header">
            {t.caso}
          </Text>
          <Text style={estilos.tenue}>{t.categoria}</Text>
        </View>
        {refrescoFallido ? <Text style={estilos.tenue}>{TEXTO_REFRESCO_FALLIDO}</Text> : null}
        {novedad ? <Alerta tipo="info" texto={novedad.texto} clave={novedad.clave} testID="novedad" /> : null}
        {visor.error ? <Alerta tipo="mal" texto={visor.error.texto} clave={visor.error.clave} /> : null}

        <View style={estilos.resumen} testID="resumen">
          <View style={estilos.fila}>
            <EstadoTicket ticket={t} />
            {t.posicion ? (
              <Text style={estilos.texto}>{enLaCola(t.posicion)}</Text>
            ) : t.atiende ? (
              <Text style={estilos.texto}>Lo atiende {t.atiende}</Text>
            ) : null}
          </View>
          {t.estado === "esperando_usuario" ? (
            <View style={estilos.bloque}>
              <Alerta tipo="aviso" texto="Soporte necesita algo de usted: lea su mensaje y respóndalo abajo." />
              <Boton testID="ir-a-responder" titulo="Responder" icono="reply-outline" onPress={irAResponder} />
            </View>
          ) : null}
          {t.estado === "cerrado" && t.puede_encuestar ? (
            <Alerta tipo="info" texto="Su ticket está cerrado. Cuéntenos cómo le fue en la encuesta de abajo: le toma un minuto." />
          ) : null}
          {respuestaVence ? (
            <Text style={estilos.texto}>
              {respuestaVence > ahora
                ? `Le responderemos antes del ${fechaYHora(plazos.respuesta)}.`
                : "Está tardando más de lo previsto; el equipo de soporte ya fue avisado. Si le urge, escríbalo abajo en este ticket."}
            </Text>
          ) : null}
          {plazos.solucion && !(respuestaVence && respuestaVence <= ahora) ? (
            <Text style={estilos.texto}>
              {new Date(plazos.solucion).getTime() > ahora
                ? `Debería quedar resuelto antes del ${fechaYHora(plazos.solucion)}.`
                : "La solución está tardando más de lo previsto; el equipo de soporte ya fue avisado. Si le urge, escríbalo abajo en este ticket."}
            </Text>
          ) : null}
          {t.estado === "esperando_aprobacion" ? (
            <Text style={estilos.texto}>
              Su solicitud necesita la aprobación de{" "}
              {(t.aprobaciones ?? [])
                .filter((a) => a.estado === "pendiente")
                .map((a) => a.rol)
                .join(", ") || "quien corresponda"}
              . En cuanto la aprueben, entra a la cola de soporte.
            </Text>
          ) : null}
          {t.fuera_de_horario && t.posicion && respuestaVence > ahora ? (
            <Text style={estilos.tenue}>
              Llegó fuera del horario de atención: se atenderá a la brevedad el siguiente día hábil.
            </Text>
          ) : null}
          <Dato nombre="Prioridad" valor={t.prioridad_display} />
          <Dato nombre="Creado" valor={fechaYHora(t.creado)} />
          {(t.datos_adicionales ?? []).map((d) => (
            <Dato key={d.clave} nombre={d.etiqueta} valor={d.valor} />
          ))}
        </View>

        {t.puede_confirmar ? (
          <Seccion titulo="¿Quedó resuelto?" testID="confirmar">
            <Text style={estilos.texto}>
              Soporte marcó su ticket como resuelto.
              {t.cierre_automatico ? ` Si no nos responde, se cerrará solo el ${fechaCorta(t.cierre_automatico)}.` : ""}
            </Text>
            <Boton
              testID="si-resuelto"
              titulo={ocupado === "confirmar" ? "Enviando…" : "Sí, quedó resuelto"}
              icono="check-circle-outline"
              cargando={ocupado === "confirmar"}
              deshabilitado={Boolean(ocupado)}
              onPress={() => {
                ejecutar("confirmar", () => soporteService.confirmarMiTicket(id, opciones));
              }}
            />
            <Boton
              testID="no-sigue"
              titulo="No, sigue el problema"
              icono="reply-outline"
              variante="secundario"
              pista="Lleva a escribir qué pasa; al enviarlo, el ticket se reabre"
              onPress={irAResponder}
            />
          </Seccion>
        ) : null}
        {resultadoEn("confirmar")}

        {t.puede_encuestar || t.encuesta ? (
          <>
            {resultado?.donde === "encuesta" && resultado.tipo === "bien" ? resultadoEn("encuesta") : null}
            <Encuesta
              ticket={t}
              enviando={ocupado === "encuesta"}
              error={resultado?.donde === "encuesta" && resultado.tipo === "mal" ? resultado : null}
              onResponder={(datos) => ejecutar("encuesta", () => soporteService.encuestaMiTicket(id, datos, opciones))}
            />
          </>
        ) : null}

        <Seccion titulo="Lo que nos contó" testID="lo-que-nos-conto">
          <Text style={estilos.texto} selectable>
            {t.descripcion}
          </Text>
          <ListaDeAdjuntos lista={t.adjuntos} abriendo={visor.abriendo} onAbrir={visor.abrir} />
        </Seccion>

        <Seccion titulo="Conversación" testID="conversacion">
          {(t.mensajes ?? []).length === 0 ? (
            <Text style={estilos.tenue}>Todavía no hay respuestas.</Text>
          ) : (
            t.mensajes.map((m) => (
              <MensajeDelTicket key={m.id} mensaje={m} modo="propio" abriendo={visor.abriendo} onAbrir={visor.abrir} />
            ))
          )}
          {!t.puede_responder && t.estado === "cerrado" ? (
            <View style={estilos.bloque}>
              <Alerta tipo="info" texto={puedeCrear ? TEXTO_CERRADO : TEXTO_CERRADO_SIN_PERMISO} />
              {puedeCrear ? (
                <Boton
                  testID="crear-uno-nuevo"
                  titulo="Crear un ticket nuevo"
                  icono="plus"
                  variante="secundario"
                  onPress={() => router.push("/soporte/nuevo")}
                />
              ) : null}
            </View>
          ) : null}
        </Seccion>

        {/* H-06: «Responder» es su propia sección, hija directa del
            desplazable: `irA("responder")` cae justo en ella. */}
        {!t.puede_responder && texto.trim() ? (
          <View style={estilos.bloque} testID="borrador-sin-enviar">
            <Alerta tipo="aviso" texto={TEXTO_BORRADOR_SIN_ENVIAR} />
            <Text style={estilos.borrador} selectable>
              {texto}
            </Text>
          </View>
        ) : null}
        {t.puede_responder ? (
          <View {...bloque("responder")} testID="responder">
            <Seccion titulo="Responder">
              <CampoTexto
                testID="texto-respuesta"
                refFoco={refFoco("responder")}
                etiqueta={
                  t.puede_confirmar
                    ? "¿El problema sigue? Cuéntenos (el ticket se reabre)"
                    : (t.mensajes ?? []).length === 0
                      ? "¿Quiere agregar algo?"
                      : "Responder"
                }
                valor={texto}
                onCambio={(v) => {
                  setTexto(v);
                  if (errorTexto) setErrorTexto(null);
                }}
                error={errorTexto}
                multilinea
                maximo={5000}
                deshabilitado={ocupado === "responder"}
              />
              <AdjuntosPorEnviar adjuntos={adjuntos} deshabilitado={ocupado === "responder"} testID="adjuntos-respuesta" />
              {resultadoEn("responder")}
              <Boton
                testID="enviar-respuesta"
                titulo={ocupado === "responder" ? "Enviando…" : "Enviar"}
                icono="send"
                cargando={ocupado === "responder"}
                deshabilitado={Boolean(ocupado) && ocupado !== "responder"}
                onPress={() => {
                  responder();
                }}
              />
            </Seccion>
          </View>
        ) : null}

        <VisorDeImagen {...visor.visor} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 14, paddingBottom: 40 },
  cabecera: { gap: 2 },
  titulo: { fontSize: 22, fontWeight: "700", color: colores.titulo },
  texto: { fontSize: 15, color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  fila: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  bloque: { gap: 10 },
  borrador: {
    fontSize: 15,
    color: colores.tinta,
    padding: 12,
    borderRadius: 8,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.bordeControl,
  },
  resumen: {
    gap: 10,
    padding: 14,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  estrellas: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  estrella: { minWidth: AREA_TACTIL, minHeight: AREA_TACTIL, alignItems: "center", justifyContent: "center" },
  siNo: {
    minWidth: 88,
    minHeight: AREA_TACTIL,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    backgroundColor: colores.superficie,
  },
  siNoActivo: { backgroundColor: colores.primario, borderColor: colores.primario },
  siNoTexto: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  siNoTextoActivo: { color: colores.sobrePrimario },
});
