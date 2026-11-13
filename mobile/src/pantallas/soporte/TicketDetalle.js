import * as Linking from "expo-linking";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { soporteService } from "../../api/servicios";
import { Alerta, Boton, BotonIcono, Cargando, Desplegable, ErrorConReintento } from "../../componentes/comunes";
import { confirmarDescarte as confirmarDescarteComun } from "../../componentes/confirmarDescarte";
import { Icono } from "../../componentes/Icono";
import { Ventana } from "../../componentes/Ventana";
import { OpcionesEnLinea, SelectorDeLista } from "../../componentes/Selectores";
import { VisorDeImagen } from "../../componentes/VisorDeImagen";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { useSesion } from "../../sesion/SesionContext";
import { useAdjuntosPorEnviar, useVisorDeAdjuntos, validarLista } from "../../soporte/adjuntos";
import { dejarAviso } from "../../soporte/avisoPendiente";
import {
  aplicarPlantilla,
  dialogoDe,
  esModuloApagado,
  ESTADOS,
  IMPACTOS,
  mensajeDeAccion,
  mensajeDeSoporte,
  nombreDe,
  prioridadPorMatriz,
  PRIORIDADES,
  queToca,
  respuestasSugeridas,
  textoDelPaso,
  textoDeRespuesta,
  textoDeSolucion,
  textoDeTecnico,
  TONOS,
  URGENCIAS,
} from "../../soporte/formato";
import { useRecargarResumenSoporte } from "../../soporte/ResumenSoporteContext";
import { SONDEO_FICHAS_MS, useSondeo } from "../../soporte/useSondeo";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";
import { aHora, fechaYHora } from "../../utils/fechas";
import { AbrirEnLaWeb, CampoTexto } from "../permisos/piezas";
import {
  AdjuntosPorEnviar,
  Dato,
  EstadoTicket,
  ListaDeAdjuntos,
  MensajeDelTicket,
  Pildora,
  PrioridadTicket,
  Seccion,
  VenceTicket,
} from "./piezas";

/**
 * La ficha de un ticket para el equipo (US-014, CA-9 a CA-15, CA-18, CA-21 y
 * CA-22), como `TicketDetalle.jsx` de la web, en una columna y con lo que se
 * usa primero (ronda 1 de QA-UX, H-01 y H-02):
 *
 * - el resumen: estado, prioridad, plazo, quién pide (con «Llamar» y
 *   «Correo») y quién atiende, qué toca, la acción principal según el estado
 *   (Tomar, Poner en curso o Marcar como atendido) y «Responder», que lleva a
 *   la caja;
 * - «Más acciones», plegado: esperar al usuario, escalar, ajustar la
 *   prioridad, asignar y, al final y en tono de peligro, cerrar;
 * - la solicitud, la conversación y la caja de respuesta (su propia sección);
 * - los datos, las aprobaciones, la encuesta y el historial (plegados).
 *
 * Solo se muestran las acciones que trae `permisos`. Cada paso abre su
 * ventana con lo que va a pasar y su nota (obligatoria para «Esperar al
 * usuario» y para escalar). Si tras escalar o reasignar deja de verlo
 * (`visible: false`), vuelve a la bandeja y lo anuncia.
 *
 * Se actualiza sola cada 10 s (`?sondeo=1`) con la pantalla a la vista: lo
 * nuevo se anuncia (T3), un fallo se dice sin borrar nada (H-24), un 404 o
 * `visible: false` dice que ya no está (G-3), y si se cierra con un borrador
 * escrito, el borrador queda a la vista para copiarlo (G-4).
 */
export const TEXTO_NO_DISPONIBLE =
  "Este ticket no existe o ya no tiene acceso a él (pudo pasar a otro nivel o a otro técnico).";
export const TEXTO_FUERA_DE_HORARIO = "Está fuera de su horario: registre las horas en el navegador.";
export const TEXTO_JUSTIFICACION = "Diga por qué cambia la prioridad.";
export const TEXTO_RESPUESTA_VACIA = "Escriba el mensaje.";
export const TEXTO_REFRESCO_FALLIDO =
  "No se pudo actualizar el ticket; se muestra la última información y se volverá a intentar en unos segundos.";
export const TEXTO_SOLO_EQUIPO = "Solo lo ve el equipo: el usuario no recibe nada.";
/** N-08: la pausa antes de anunciar las respuestas sugeridas. */
export const ESPERA_ANUNCIO_RESPUESTAS_MS = 400;
/** N-07: si el teléfono no puede llamar o escribir el correo. */
export const TEXTO_SIN_LLAMADA = "No se pudo abrir la app de llamadas. Marque el número a mano:";
export const TEXTO_SIN_CORREO = "No se pudo abrir la app de correo. Escriba a:";
export const TEXTO_BORRADOR_SIN_ENVIAR =
  "Ya no se puede responder este ticket (se cerró o cambió de manos). Su texto no se envió; puede copiarlo:";

/** H-17: cerrar con algo escrito pide confirmación (desde la US-019, la
 * pregunta es común: `componentes/confirmarDescarte.js`). */
function confirmarDescarte() {
  return confirmarDescarteComun({ mensaje: "La nota no se guardó." });
}

/** CA-12, CA-14 y CA-15: la ventana de un paso, con su nota. */
function DialogoDeAccion({ dialogo, ocupado, error, onCerrar, onConfirmar }) {
  const [nota, setNota] = useState("");
  const [errorNota, setErrorNota] = useState(null);
  const notaRef = useRef(null);

  // QA-TECH: al abrir, el foco (y el teclado) en la nota.
  useEffect(() => {
    if (dialogo) notaRef.current?.focus?.();
  }, [dialogo]);

  if (!dialogo) return null;

  function confirmar() {
    if (dialogo.obligatorio && !nota.trim()) {
      setErrorNota(dialogo.obligatorio);
      anunciar(dialogo.obligatorio);
      notaRef.current?.focus?.();
      return;
    }
    setErrorNota(null);
    onConfirmar(nota.trim());
  }

  async function cerrar() {
    if (ocupado) return;
    if (nota.trim() && !(await confirmarDescarte())) return;
    onCerrar();
  }

  return (
    <Ventana titulo={dialogo.titulo} onCerrar={cerrar} ocupada={Boolean(ocupado)} testID="dialogo">
      <Text style={estilos.texto}>{dialogo.explicacion}</Text>
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="dialogo-error" /> : null}
      <CampoTexto
        testID="dialogo-nota"
        refFoco={notaRef}
        etiqueta={dialogo.campo}
        obligatorio={Boolean(dialogo.obligatorio)}
        ayuda={dialogo.ayuda}
        valor={nota}
        onCambio={(v) => {
          setNota(v);
          if (errorNota && v.trim()) setErrorNota(null);
        }}
        error={errorNota}
        multilinea
        maximo={dialogo.maximo ?? 2000}
        deshabilitado={ocupado}
      />
      <Boton
        testID="dialogo-confirmar"
        titulo={ocupado ? "Guardando…" : dialogo.boton}
        icono={dialogo.peligro ? "alert-outline" : "check"}
        cargando={ocupado}
        onPress={confirmar}
      />
      <Boton testID="dialogo-cancelar" titulo="Cancelar" variante="secundario" deshabilitado={ocupado} onPress={cerrar} />
    </Ventana>
  );
}

/** CA-13: elegir la prioridad o calcularla por impacto y urgencia, siempre
 * con justificación (hasta 1000). Dice en qué quedará antes de guardar. */
function DialogoDePrioridad({ ticket, prioridades, ocupado, error, onCerrar, onCambiar }) {
  const [modo, setModo] = useState("matriz");
  const [valores, setValores] = useState({
    prioridad: ticket.prioridad,
    impacto: ticket.impacto || "",
    urgencia: ticket.urgencia || "",
    justificacion: "",
  });
  const [errorJustificacion, setErrorJustificacion] = useState(null);
  const justificacionRef = useRef(null);
  const fijar = (campo) => (v) => setValores((a) => ({ ...a, [campo]: v }));
  const nueva = modo === "matriz" ? prioridadPorMatriz(valores.impacto, valores.urgencia) : valores.prioridad;
  const sinCambio =
    modo === "directa"
      ? valores.prioridad === ticket.prioridad
      : !nueva || (valores.impacto === (ticket.impacto || "") && valores.urgencia === (ticket.urgencia || ""));
  const quedara = !nueva
    ? "Elija impacto y urgencia para ver la prioridad."
    : nueva === ticket.prioridad
      ? `Quedará en: ${nombreDe(prioridades, nueva)} (la misma de ahora).`
      : `Quedará en: ${nombreDe(prioridades, nueva)} (antes ${nombreDe(prioridades, ticket.prioridad)}).`;

  // H-16: en iOS la región viva no se anuncia; se dice al cambiar.
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    if (Platform.OS === "ios") anunciar(quedara);
  }, [quedara]);

  function guardar() {
    if (!valores.justificacion.trim()) {
      setErrorJustificacion(TEXTO_JUSTIFICACION);
      anunciar(TEXTO_JUSTIFICACION);
      justificacionRef.current?.focus?.();
      return;
    }
    setErrorJustificacion(null);
    const datos =
      modo === "matriz"
        ? { impacto: valores.impacto, urgencia: valores.urgencia, justificacion: valores.justificacion.trim() }
        : { prioridad: valores.prioridad, justificacion: valores.justificacion.trim() };
    onCambiar(datos);
  }

  async function cerrar() {
    if (ocupado) return;
    if (valores.justificacion.trim() && !(await confirmarDescarte())) return;
    onCerrar();
  }

  return (
    <Ventana titulo="Ajustar prioridad" onCerrar={cerrar} ocupada={Boolean(ocupado)} testID="dialogo-prioridad">
      <OpcionesEnLinea
        testID="prioridad-modo"
        etiqueta="Cómo se calcula"
        opciones={[
          { valor: "matriz", texto: "Por impacto y urgencia" },
          { valor: "directa", texto: "Elegir la prioridad" },
        ]}
        valor={modo}
        onCambio={setModo}
      />
      {modo === "matriz" ? (
        <>
          <OpcionesEnLinea
            testID="prioridad-impacto"
            etiqueta="Impacto"
            opciones={IMPACTOS.map(([valor, texto]) => ({ valor, texto }))}
            valor={valores.impacto}
            onCambio={fijar("impacto")}
          />
          <OpcionesEnLinea
            testID="prioridad-urgencia"
            etiqueta="Urgencia"
            opciones={URGENCIAS.map(([valor, texto]) => ({ valor, texto }))}
            valor={valores.urgencia}
            onCambio={fijar("urgencia")}
          />
        </>
      ) : (
        <OpcionesEnLinea
          testID="prioridad-directa"
          etiqueta="Prioridad"
          opciones={prioridades.map(([valor, texto]) => ({ valor, texto }))}
          valor={valores.prioridad}
          onCambio={fijar("prioridad")}
        />
      )}
      <Text style={estilos.quedara} accessibilityLiveRegion="polite" testID="prioridad-quedara">
        {quedara}
      </Text>
      <CampoTexto
        testID="prioridad-justificacion"
        refFoco={justificacionRef}
        etiqueta="Justificación"
        obligatorio
        ayuda="Queda en el historial. El plazo se recalcula conservando el tiempo ya consumido."
        valor={valores.justificacion}
        onCambio={(v) => {
          fijar("justificacion")(v);
          if (v.trim()) setErrorJustificacion(null);
        }}
        error={errorJustificacion}
        multilinea
        maximo={1000}
        deshabilitado={ocupado}
      />
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="prioridad-error" /> : null}
      {sinCambio ? <Text style={estilos.tenue}>Cambie algo para poder guardarlo.</Text> : null}
      <Boton
        testID="prioridad-guardar"
        titulo={ocupado ? "Guardando…" : "Cambiar prioridad"}
        icono="check"
        cargando={ocupado}
        deshabilitado={sinCambio}
        pista={sinCambio ? "Cambie algo para poder guardarlo" : undefined}
        onPress={guardar}
      />
      <Boton titulo="Cancelar" variante="secundario" deshabilitado={ocupado} onPress={cerrar} />
    </Ventana>
  );
}

/**
 * CA-11: la caja de respuesta. «Al usuario» o «Nota interna» se elige antes
 * de escribir (por defecto, al usuario); «/» al inicio sugiere las respuestas
 * predefinidas por atajo y título, y elegir una inserta su texto con los
 * datos del ticket. El texto vive en la ficha (G-4): si el ticket se cierra
 * mientras se escribe, no se pierde.
 */
function Responder({
  ticket,
  respuestas,
  ocupado,
  resultado,
  onEnviar,
  texto,
  setTexto,
  interno,
  setInterno,
  refCaja,
  registrarFoco,
}) {
  const [verTodas, setVerTodas] = useState(false);
  // La caja es a la vez el destino del foco de «Responder» (`irA`).
  const refDeLaCaja = useCallback(
    (nodo) => {
      refCaja.current = nodo;
      registrarFoco?.(nodo);
    },
    [refCaja, registrarFoco],
  );
  const [errorTexto, setErrorTexto] = useState(null);
  const adjuntos = useAdjuntosPorEnviar();
  const sugeridas = respuestasSugeridas(respuestas, texto, { verTodas });
  const hayRespuestas = respuestas.length > 0;

  // N-08: se anuncia cuando se deja de escribir, no en cada tecla.
  const resumenSugeridas =
    sugeridas === null
      ? ""
      : sugeridas.length
        ? `${sugeridas.length} ${sugeridas.length === 1 ? "respuesta sugerida" : "respuestas sugeridas"}.`
        : "Ninguna respuesta predefinida coincide.";
  useEffect(() => {
    if (!resumenSugeridas) return undefined;
    const espera = setTimeout(() => anunciar(resumenSugeridas), ESPERA_ANUNCIO_RESPUESTAS_MS);
    return () => clearTimeout(espera);
  }, [resumenSugeridas, texto]);

  function usar(respuesta) {
    setTexto(aplicarPlantilla(respuesta.texto, ticket));
    setVerTodas(false);
    anunciar(`Se insertó la respuesta «${respuesta.titulo}». Revísela antes de enviar.`);
    refCaja.current?.focus?.();
  }

  async function enviar() {
    if (!texto.trim()) {
      setErrorTexto(TEXTO_RESPUESTA_VACIA);
      anunciar(TEXTO_RESPUESTA_VACIA);
      refCaja.current?.focus?.();
      return;
    }
    const errorAdjuntos = validarLista(adjuntos.lista);
    if (errorAdjuntos) {
      setErrorTexto(errorAdjuntos);
      return;
    }
    setErrorTexto(null);
    // CA-22: si falla, lo escrito y los archivos se quedan.
    if (await onEnviar({ texto: texto.trim(), interno }, adjuntos.lista)) {
      setTexto("");
      adjuntos.vaciar();
    }
  }

  return (
    <View style={estilos.bloque}>
      <View style={estilos.segmentos} accessibilityRole="radiogroup" accessibilityLabel="A quién va el mensaje">
        {[
          [false, "Al usuario", "account-outline"],
          [true, "Nota interna", "lock"],
        ].map(([valor, etiqueta, icono]) => {
          const activo = interno === valor;
          return (
            <Pressable
              key={etiqueta}
              testID={valor ? "modo-interno" : "modo-usuario"}
              onPress={() => setInterno(valor)}
              accessibilityRole="radio"
              accessibilityState={{ checked: activo }}
              accessibilityLabel={valor ? "Nota interna: el usuario no la ve" : "Al usuario: la ve en su ticket"}
              style={[estilos.segmento, activo && (valor ? estilos.segmentoInterno : estilos.segmentoActivo)]}
            >
              <Icono nombre={icono} size={18} color={activo ? (valor ? colores.avisoTexto : colores.sobrePrimario) : colores.tinta} />
              <Text style={[estilos.segmentoTexto, activo && (valor ? estilos.segmentoTextoInterno : estilos.segmentoTextoActivo)]}>
                {etiqueta}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hayRespuestas ? (
        <Boton
          testID="ver-respuestas"
          titulo={verTodas ? "Ocultar respuestas predefinidas" : "Respuestas predefinidas"}
          icono="message-text-outline"
          variante="secundario"
          expandido={verTodas}
          onPress={() => setVerTodas((v) => !v)}
        />
      ) : null}
      <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
        {interno ? "Nota interna (el usuario no la ve)" : "Respuesta al usuario"}
        <Text style={estilos.obligatorio}> *</Text>
      </Text>
      <TextInput
        ref={refDeLaCaja}
        testID="texto-respuesta"
        value={texto}
        onChangeText={(v) => {
          setTexto(v);
          if (errorTexto) setErrorTexto(null);
        }}
        multiline
        maxLength={10000}
        textAlignVertical="top"
        placeholder={hayRespuestas ? "Escriba, o «/» para usar una respuesta predefinida" : "Escriba su mensaje"}
        placeholderTextColor={colores.tintaTenue}
        accessibilityLabel={[
          `${interno ? "Nota interna (el usuario no la ve)" : "Respuesta al usuario"} (obligatorio)`,
          hayRespuestas ? "Escriba «/» para usar una respuesta predefinida" : null,
          errorTexto ? `Error: ${errorTexto}` : null,
        ]
          .filter(Boolean)
          .join(". ")}
        editable={!ocupado}
        style={[estilos.entrada, interno && estilos.entradaInterna, errorTexto && estilos.entradaConError]}
      />
      {/* H-09: qué pasa con lo que se envía, dicho en los dos modos. */}
      <Text style={interno ? estilos.avisoInterno : estilos.tenue}>
        {interno ? TEXTO_SOLO_EQUIPO : "El usuario la ve en su ticket y recibe un aviso."}
      </Text>
      {errorTexto ? <Alerta tipo="mal" texto={errorTexto} /> : null}
      {sugeridas !== null ? (
        sugeridas.length === 0 ? (
          <Text style={estilos.tenue} testID="sin-respuestas">
            {`Ninguna respuesta predefinida coincide con «${texto}».`}
          </Text>
        ) : (
          <View style={estilos.sugeridas} testID="respuestas-sugeridas" accessibilityLabel="Respuestas predefinidas">
            {sugeridas.map((r) => (
              <Pressable
                key={r.id}
                testID={`respuesta-${r.id}`}
                onPress={() => usar(r)}
                accessibilityRole="button"
                accessibilityLabel={`/${r.atajo}: ${r.titulo}`}
                accessibilityHint="Inserta el texto de la respuesta"
                style={({ pressed }) => [estilos.sugerida, pressed && estilos.presionada]}
              >
                <Text style={estilos.texto}>
                  <Text style={estilos.negrita}>/{r.atajo}</Text> · {r.titulo}
                </Text>
              </Pressable>
            ))}
          </View>
        )
      ) : null}
      <AdjuntosPorEnviar adjuntos={adjuntos} deshabilitado={ocupado} testID="adjuntos-respuesta" />
      {resultado}
      <Boton
        testID="enviar-respuesta"
        titulo={ocupado ? "Enviando…" : interno ? "Guardar nota interna" : "Responder"}
        icono={interno ? "lock" : "send"}
        variante={interno ? "aviso" : "primario"}
        cargando={ocupado}
        onPress={() => {
          enviar();
        }}
      />
    </View>
  );
}

/** El icono de cada paso. */
function iconoDelPaso(destino) {
  if (destino === "cerrado") return "lock-outline";
  if (destino === "atendido") return "check-circle-outline";
  if (destino === "esperando_usuario") return "account-clock-outline";
  return "progress-wrench";
}

export function TicketDetalle({ id, empresa = null }) {
  const router = useRouter();
  const navegacion = useNavigation();
  const alturaCabecera = useAlturaCabecera();
  const { recargar: recargarResumen } = useRecargarResumenSoporte();
  const { versionEmpresa } = useSesion();
  const opciones = empresa ? { empresa } : {};
  const [ticket, setTicket] = useState(null);
  const [carga, setCarga] = useState({ estado: "cargando", error: null, noExiste: false });
  const [respuestas, setRespuestas] = useState([]);
  const [tecnicos, setTecnicos] = useState({ estado: "inactiva", lista: [], error: null });
  const [etiquetas, setEtiquetas] = useState({ estados: ESTADOS, prioridades: PRIORIDADES });
  const [tecnicoElegido, setTecnicoElegido] = useState("");
  const [dialogo, setDialogo] = useState(null);
  const [verPrioridad, setVerPrioridad] = useState(false);
  const [ocupado, setOcupado] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [novedad, setNovedad] = useState(null);
  const [refrescoFallido, setRefrescoFallido] = useState(false);
  const [perdido, setPerdido] = useState(false);
  const [verMas, setVerMas] = useState(false);
  const [verDatos, setVerDatos] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  // G-4: el borrador vive aquí, no en la caja.
  const [texto, setTexto] = useState("");
  const [interno, setInterno] = useState(false);
  const visor = useVisorDeAdjuntos(opciones);
  const montado = useRef(true);
  const candado = useRef(false);
  const version = useRef(0);
  const ticketRef = useRef(null);
  ticketRef.current = ticket;
  const refrescoFallidoRef = useRef(false);
  refrescoFallidoRef.current = refrescoFallido;
  const [errorContacto, setErrorContacto] = useState(null);
  const desplazable = useRef(null);
  const caja = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // H-23: el número va en la barra; dentro, el caso.
  useEffect(() => {
    navegacion?.setOptions?.({ title: ticket?.numero ?? "Ticket" });
  }, [navegacion, ticket?.numero]); // eslint-disable-line react-hooks/exhaustive-deps

  const cargar = useCallback(async () => {
    setCarga({ estado: "cargando", error: null, noExiste: false });
    setPerdido(false);
    const numero = ++version.current;
    try {
      const datos = await soporteService.ticket(id, opciones);
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
        error: noExiste ? TEXTO_NO_DISPONIBLE : mensajeDeSoporte(e, "No se pudo cargar el ticket."),
      });
    }
  }, [id, empresa]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  // Las respuestas predefinidas y los nombres de la empresa, una vez.
  useEffect(() => {
    Promise.resolve(soporteService.respuestas(opciones))
      .then((lista) => montado.current && setRespuestas(Array.isArray(lista) ? lista : []))
      .catch(() => {});
    Promise.resolve(soporteService.etiquetas())
      .then((e) => {
        if (montado.current && Array.isArray(e?.estados) && Array.isArray(e?.prioridades)) setEtiquetas(e);
      })
      .catch(() => {});
  }, [empresa]); // eslint-disable-line react-hooks/exhaustive-deps

  // CA-14: a quién se puede asignar, solo si puede. Si falla, «Reintentar».
  const cargarTecnicos = useCallback(async () => {
    setTecnicos({ estado: "cargando", lista: [], error: null });
    try {
      const lista = await soporteService.tecnicos(opciones);
      if (montado.current) setTecnicos({ estado: "listo", lista: Array.isArray(lista) ? lista : [], error: null });
    } catch (e) {
      if (montado.current) {
        setTecnicos({ estado: "error", lista: [], error: mensajeDeSoporte(e, "No se pudo cargar la lista de técnicos.") });
      }
    }
  }, [empresa]); // eslint-disable-line react-hooks/exhaustive-deps
  const puedeAsignar = Boolean(ticket?.permisos?.asignar);
  useEffect(() => {
    if (puedeAsignar && tecnicos.estado === "inactiva") cargarTecnicos();
  }, [puedeAsignar, tecnicos.estado, cargarTecnicos]);

  const sondear = useCallback(async () => {
    if (candado.current || !ticketRef.current) return;
    const numero = version.current;
    try {
      const nuevo = await soporteService.ticket(id, { ...opciones, sondeo: true });
      if (!montado.current || numero !== version.current || candado.current) return;
      setRefrescoFallido(false);
      // G-3: ya no lo puede ver.
      if (nuevo?.visible === false) {
        setPerdido(true);
        anunciar(TEXTO_NO_DISPONIBLE);
        return;
      }
      const antes = ticketRef.current;
      const previos = antes?.mensajes?.length ?? 0;
      const ahora = nuevo?.mensajes?.length ?? 0;
      const hora = aHora(new Date());
      let aviso = null;
      if (ahora > previos) {
        aviso =
          ahora - previos === 1
            ? `Llegó un mensaje nuevo a la conversación (${hora}).`
            : `Llegaron ${ahora - previos} mensajes nuevos a la conversación (${hora}).`;
      } else if (antes && nuevo.estado !== antes.estado) {
        aviso = `El ticket pasó a «${nuevo.estado_display}» (${hora}).`;
      }
      // T3 (WCAG 4.1.3): la novedad se ve y se anuncia.
      if (aviso) {
        setNovedad({ texto: aviso, clave: Date.now() });
        anunciar(aviso);
      }
      setTicket(nuevo);
    } catch (e) {
      if (!montado.current || numero !== version.current) return;
      const status = e?.response?.status;
      if ((status === 404 || status === 403) && !esModuloApagado(e)) {
        setPerdido(true);
        anunciar(TEXTO_NO_DISPONIBLE);
        return;
      }
      // CA-22 y H-24: un sondeo fallido no borra lo que se ve, y se dice.
      // N-11: se anuncia solo al empezar a fallar.
      if (!refrescoFallidoRef.current) anunciar(TEXTO_REFRESCO_FALLIDO);
      setRefrescoFallido(true);
    }
  }, [id, empresa]); // eslint-disable-line react-hooks/exhaustive-deps

  useSondeo(sondear, SONDEO_FICHAS_MS, carga.estado === "listo" && !perdido && !ocupado && !dialogo && !verPrioridad);

  function volverALaBandeja() {
    if (router.canGoBack?.() === false) router.replace({ pathname: "/soporte", params: { vista: "bandeja" } });
    else router.back();
  }

  /**
   * Hace una acción con candado. `donde`: qué está ocupado y dónde se dice el
   * resultado (`tomar` y lo de las ventanas se dicen en el resumen). Devuelve
   * si salió bien.
   */
  async function hacer(donde, accion, mensaje, { alNoVerlo } = {}) {
    if (candado.current) return false;
    candado.current = true;
    version.current += 1;
    setOcupado(donde);
    setResultado(null);
    setNovedad(null);
    try {
      const respuesta = await accion();
      if (!montado.current) return true;
      if (respuesta?.visible === false) {
        // CA-15: ya no está en su bandeja; se vuelve y se dice.
        const texto = alNoVerlo ?? `${mensaje} Ya no está a su cargo.`;
        dejarAviso(texto);
        anunciar(texto);
        recargarResumen();
        volverALaBandeja();
        return true;
      }
      setTicket(respuesta);
      const lugar = donde === "respuesta" ? "respuesta" : "acciones";
      setResultado({ donde: lugar, tipo: "bien", texto: mensaje, clave: Date.now() });
      recargarResumen();
      return true;
    } catch (e) {
      if (montado.current) {
        setResultado({
          donde: donde === "tomar" ? "acciones" : donde,
          tipo: "mal",
          texto: mensajeDeAccion(e, "No se pudo completar la acción."),
          clave: Date.now(),
        });
      }
      return false;
    } finally {
      candado.current = false;
      if (montado.current) setOcupado(null);
    }
  }

  async function confirmarDialogo(nota) {
    const t = ticketRef.current;
    const actual = dialogo;
    if (!actual) return;
    let hecho;
    if (actual.accion === "escalar") {
      hecho = await hacer("dialogo", () => soporteService.escalar(t.id, nota, opciones), "Ticket escalado al siguiente nivel.", {
        alNoVerlo: `Ticket ${t.numero} escalado; ya no está en su bandeja.`,
      });
    } else if (actual.accion === "asignar") {
      hecho = await hacer(
        "dialogo",
        () => soporteService.asignar(t.id, actual.tecnico.id, nota, opciones),
        `Ticket asignado a ${actual.tecnico.nombre}.`,
        { alNoVerlo: `Ticket ${t.numero} asignado a ${actual.tecnico.nombre}; ya no está en su bandeja.` },
      );
      if (hecho && montado.current) setTecnicoElegido("");
    } else {
      hecho = await hacer(
        "dialogo",
        () => soporteService.cambiarEstado(t.id, actual.accion, nota, opciones),
        `Estado actualizado: ${textoDelPaso(actual.accion, t).toLowerCase()}.`,
      );
    }
    if (hecho && montado.current) setDialogo(null);
  }

  if (carga.estado === "cargando" && !ticket) return <Cargando texto="Cargando el ticket…" />;
  if ((carga.estado === "error" && !ticket) || perdido) {
    return (
      <View style={estilos.contenido} testID="ticket-error">
        {carga.noExiste || perdido ? (
          <>
            <Alerta tipo="mal" texto={TEXTO_NO_DISPONIBLE} />
            <Boton titulo="Volver a la bandeja" icono="arrow-left" variante="secundario" onPress={volverALaBandeja} />
          </>
        ) : (
          <ErrorConReintento texto={carga.error} onReintentar={cargar} />
        )}
      </View>
    );
  }

  const t = ticket;
  const permisos = t.permisos ?? { acciones: [] };
  const acciones = Array.isArray(permisos.acciones) ? permisos.acciones : [];
  // H-01: la acción principal según el estado; lo demás, en «Más acciones».
  const principal = permisos.tomar
    ? "tomar"
    : acciones.includes("en_curso") && t.estado !== "atendido"
      ? "en_curso"
      : acciones.includes("atendido")
        ? "atendido"
        : null;
  const pasosSecundarios = acciones.filter((a) => a !== principal && a !== "cerrado");
  const puedeCerrar = acciones.includes("cerrado");
  const hayMas = pasosSecundarios.length > 0 || puedeCerrar || permisos.escalar || permisos.prioridad || permisos.asignar;
  const puedeResponder = Boolean(permisos.responder) && t.estado !== "cerrado";
  const resultadoEn = (donde) =>
    resultado?.donde === donde ? (
      <Alerta tipo={resultado.tipo} texto={resultado.texto} clave={resultado.clave} testID={`resultado-${donde}`} />
    ) : null;
  const elegido = tecnicos.lista.find((x) => String(x.id) === String(tecnicoElegido));
  const adicionales = Array.isArray(t.datos_adicionales) ? t.datos_adicionales : [];
  const respuesta = textoDeRespuesta(t.sla);
  const solucion = textoDeSolucion(t.sla);
  const telefono = (t.solicitante_telefono ?? "").replace(/\s/g, "");
  const toca = queToca(t, permisos);
  const mostrarAtiende = !(t.tecnico?.nombre && toca.includes(t.tecnico.nombre));

  function abrirDialogo(accion) {
    const base = dialogoDe(accion, t);
    if (base) setDialogo({ ...base, accion });
  }

  function abrirAsignar() {
    if (!elegido) return;
    setDialogo({
      accion: "asignar",
      tecnico: elegido,
      titulo: `Asignar a ${elegido.nombre}`,
      explicacion: `${t.tecnico && t.tecnico.nombre !== elegido.nombre ? `Deja de estar a cargo de ${t.tecnico.nombre}. ` : ""}Se le avisa a ${elegido.nombre}.${t.estado === "nuevo" ? " Empieza a correr el plazo de solución." : ""}`,
      campo: "Nota para quien lo recibe (opcional)",
      ayuda: "Queda en el historial del ticket.",
      boton: "Asignar",
      maximo: 2000,
    });
  }

  function irAResponder() {
    irA("responder");
    // N-09: también abre el teclado (sin lector de pantalla no hay foco).
    caja.current?.focus?.();
  }

  /** N-07: si el teléfono no lo abre, se dice con el dato a la vista. */
  async function contactar(url, texto, dato) {
    setErrorContacto(null);
    try {
      await Linking.openURL(url);
    } catch {
      if (montado.current) setErrorContacto({ texto: `${texto} ${dato}`, clave: Date.now() });
    }
  }

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior="padding"
      enabled={Platform.OS === "android"}
      keyboardVerticalOffset={alturaCabecera}
    >
      <ScrollView
        ref={desplazable}
        testID="ticket-detalle"
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        automaticallyAdjustKeyboardInsets
      >
        {/* El resumen: qué pasa, quién pide y qué toca, de un vistazo. */}
        <View style={estilos.resumen} testID="resumen">
          <Text style={estilos.titulo} accessibilityRole="header">
            {t.caso}
          </Text>
          <Text style={estilos.tenue}>{[t.tipo_display, t.categoria, t.codigo].filter(Boolean).join(" · ")}</Text>
          <View style={estilos.fila}>
            <EstadoTicket ticket={t} />
            <PrioridadTicket ticket={t} />
            {t.escalado_por_sla ? <Pildora texto="Escalado por SLA" tono={{ ...TONOS.mal, icono: "stairs-up" }} /> : null}
          </View>
          <VenceTicket sla={t.sla} />
          {/* H-02: quién pide, con «Llamar» y «Correo» a mano. */}
          <View style={estilos.filaPersona}>
            <Text style={estilos.persona} testID="quien-pide">
              {[t.solicitante_nombre, t.agencia].filter(Boolean).join(" · ")}
            </Text>
            {telefono ? (
              <BotonIcono
                testID="llamar-solicitante"
                icono="phone-outline"
                variante="contorno"
                etiqueta={`Llamar a ${t.solicitante_nombre}: ${t.solicitante_telefono}`}
                onPress={() => contactar(`tel:${telefono}`, TEXTO_SIN_LLAMADA, t.solicitante_telefono)}
              />
            ) : null}
            {t.solicitante_correo ? (
              <BotonIcono
                testID="correo-solicitante"
                icono="email-outline"
                variante="contorno"
                etiqueta={`Escribir un correo a ${t.solicitante_nombre}: ${t.solicitante_correo}`}
                onPress={() => contactar(`mailto:${t.solicitante_correo}`, TEXTO_SIN_CORREO, t.solicitante_correo)}
              />
            ) : null}
          </View>
          {errorContacto ? (
            <Alerta tipo="mal" texto={errorContacto.texto} clave={errorContacto.clave} testID="error-contacto" />
          ) : null}
          {/* N-03: «Atiende» solo si lo que toca no lo dice ya. */}
          {mostrarAtiende ? (
            <Text style={estilos.texto} testID="atiende">
              <Text style={estilos.tenue}>Atiende: </Text>
              <Text style={estilos.negrita}>{t.tecnico?.nombre || "Sin asignar"}</Text>
            </Text>
          ) : null}
          <Text style={estilos.texto} testID="que-toca">
            {toca}
          </Text>
          {resultadoEn("acciones")}
          {!permisos.tomar && permisos.motivo_no_tomar ? (
            <Alerta tipo="info" texto={permisos.motivo_no_tomar} testID="motivo-no-tomar" />
          ) : null}
          <View style={estilos.botones} testID="acciones">
            {principal === "tomar" ? (
              <Boton
                testID="tomar-este"
                titulo={ocupado === "tomar" ? "Tomando…" : "Tomar este ticket"}
                icono="account-check-outline"
                cargando={ocupado === "tomar"}
                deshabilitado={Boolean(ocupado) && ocupado !== "tomar"}
                pista="Pasa a estar a su cargo y empieza a correr el plazo de solución"
                onPress={() => {
                  hacer("tomar", () => soporteService.tomar(t.id, opciones), "El ticket es suyo: ya puede trabajarlo.");
                }}
              />
            ) : principal ? (
              <Boton
                testID={`accion-${principal}`}
                titulo={textoDelPaso(principal, t)}
                icono={iconoDelPaso(principal)}
                deshabilitado={Boolean(ocupado)}
                onPress={() => abrirDialogo(principal)}
              />
            ) : null}
            {puedeResponder ? (
              <Boton
                testID="ir-a-responder"
                titulo="Responder"
                icono="reply-outline"
                variante="secundario"
                pista="Lleva a la caja de respuesta"
                onPress={irAResponder}
              />
            ) : null}
          </View>
        </View>

        {novedad ? <Alerta tipo="info" texto={novedad.texto} clave={novedad.clave} testID="novedad" /> : null}
        {refrescoFallido ? <Text style={estilos.tenue}>{TEXTO_REFRESCO_FALLIDO}</Text> : null}
        {visor.error ? <Alerta tipo="mal" texto={visor.error.texto} clave={visor.error.clave} /> : null}

        {t.registrar_horas ? (
          <View style={estilos.bloque} testID="fuera-de-horario">
            <Alerta tipo="aviso" texto={TEXTO_FUERA_DE_HORARIO} />
            <AbrirEnLaWeb
              testID="registrar-horas-web"
              ruta={`/admin/soporte/tickets/${t.id}`}
              empresa={empresa}
              titulo="Registrar las horas en el navegador"
            />
          </View>
        ) : null}

        {hayMas ? (
          <View style={estilos.plegable}>
            <Desplegable titulo="Más acciones" abierto={verMas} onCambiar={setVerMas} testID="mas-acciones">
              <View style={estilos.bloque} testID="otras-acciones">
                {pasosSecundarios.map((destino) => (
                  <Boton
                    key={destino}
                    testID={`accion-${destino}`}
                    titulo={textoDelPaso(destino, t)}
                    icono={iconoDelPaso(destino)}
                    variante="secundario"
                    deshabilitado={Boolean(ocupado)}
                    onPress={() => abrirDialogo(destino)}
                  />
                ))}
                {permisos.escalar ? (
                  <Boton
                    testID="accion-escalar"
                    titulo="Escalar al siguiente nivel"
                    icono="stairs-up"
                    variante="secundario"
                    deshabilitado={Boolean(ocupado)}
                    onPress={() => abrirDialogo("escalar")}
                  />
                ) : null}
                {permisos.prioridad ? (
                  <Boton
                    testID="ajustar-prioridad"
                    titulo="Ajustar prioridad"
                    icono="flag-outline"
                    variante="secundario"
                    deshabilitado={Boolean(ocupado)}
                    onPress={() => setVerPrioridad(true)}
                  />
                ) : null}
                {permisos.asignar ? (
                  <View style={estilos.bloque}>
                    {tecnicos.estado === "error" ? (
                      <ErrorConReintento texto={tecnicos.error} onReintentar={cargarTecnicos} />
                    ) : (
                      <SelectorDeLista
                        testID="asignar-a"
                        etiqueta="Asignar a"
                        vacio={tecnicos.estado === "listo" ? "Elija un técnico" : "Cargando técnicos…"}
                        opciones={tecnicos.lista.map((x) => ({ valor: String(x.id), texto: textoDeTecnico(x) }))}
                        valor={tecnicoElegido}
                        onCambio={setTecnicoElegido}
                        deshabilitado={!tecnicos.lista.length || Boolean(ocupado)}
                      />
                    )}
                    <Boton
                      testID="asignar"
                      titulo="Asignar"
                      icono="account-switch-outline"
                      variante="secundario"
                      deshabilitado={!elegido || Boolean(ocupado)}
                      pista={elegido ? undefined : "Elija primero un técnico"}
                      onPress={abrirAsignar}
                    />
                  </View>
                ) : null}
                {puedeCerrar ? (
                  // Al final y en tono de peligro: no tiene vuelta atrás.
                  <View style={estilos.peligro}>
                    <Boton
                      testID="accion-cerrado"
                      titulo={textoDelPaso("cerrado", t)}
                      icono={iconoDelPaso("cerrado")}
                      variante="peligro"
                      deshabilitado={Boolean(ocupado)}
                      pista="Un ticket cerrado ya no se puede reabrir ni responder"
                      onPress={() => abrirDialogo("cerrado")}
                    />
                  </View>
                ) : null}
              </View>
            </Desplegable>
          </View>
        ) : null}

        {/* H-02: lo que se pidió, antes de la conversación. */}
        <Seccion titulo="Solicitud" testID="solicitud">
          <Text style={estilos.texto} selectable>
            {t.descripcion}
          </Text>
          {adicionales.map((d) => (
            <Dato key={d.clave} nombre={d.etiqueta} valor={d.valor} />
          ))}
          <ListaDeAdjuntos lista={t.adjuntos} abriendo={visor.abriendo} onAbrir={visor.abrir} />
        </Seccion>

        <Seccion titulo="Conversación" testID="conversacion">
          {(t.mensajes ?? []).length === 0 ? (
            <Text style={estilos.tenue}>Todavía no hay mensajes.</Text>
          ) : (
            t.mensajes.map((m) => (
              <MensajeDelTicket key={m.id} mensaje={m} modo="equipo" abriendo={visor.abriendo} onAbrir={visor.abrir} />
            ))
          )}
          {t.estado === "cerrado" ? (
            <Alerta tipo="info" texto={`Ticket cerrado${t.cerrado_en ? ` el ${fechaYHora(t.cerrado_en)}` : ""}: ya no se puede responder.`} />
          ) : null}
        </Seccion>

        {/* G-4: si ya no se puede responder, lo escrito queda para copiarlo. */}
        {!puedeResponder && texto.trim() ? (
          <View style={estilos.bloque} testID="borrador-sin-enviar">
            <Alerta tipo="aviso" texto={TEXTO_BORRADOR_SIN_ENVIAR} />
            <Text style={estilos.borrador} selectable>
              {texto}
            </Text>
          </View>
        ) : null}

        {/* H-01: «Responder» es su propia sección, hija directa del
            desplazable: el atajo del resumen cae justo en ella. */}
        {puedeResponder ? (
          <View {...bloque("responder")} testID="responder">
            <Seccion titulo="Responder">
              <Responder
                ticket={t}
                respuestas={respuestas}
                ocupado={ocupado === "respuesta"}
                resultado={resultadoEn("respuesta")}
                texto={texto}
                setTexto={setTexto}
                interno={interno}
                setInterno={setInterno}
                refCaja={caja}
                registrarFoco={refFoco("responder")}
                onEnviar={(datos, archivos) =>
                  hacer(
                    "respuesta",
                    () => soporteService.responder(t.id, datos, archivos, opciones),
                    datos.interno ? "Nota interna guardada." : "Respuesta enviada al usuario.",
                  )
                }
              />
            </Seccion>
          </View>
        ) : null}

        <View style={estilos.plegable}>
          <Desplegable titulo="Datos: plazos, quién pide y clasificación" abierto={verDatos} onCambiar={setVerDatos} testID="ver-datos">
            <View style={estilos.bloque} testID="datos">
              <Text style={estilos.subtitulo} accessibilityRole="header">
                Plazos
              </Text>
              <Dato nombre="Primera respuesta" valor={[respuesta.texto, respuesta.fecha].filter(Boolean).join(" · ")} />
              <Dato nombre="Solución" valor={[solucion.texto, solucion.fecha].filter(Boolean).join(" · ")} />
              <Text style={estilos.subtitulo} accessibilityRole="header">
                Quién pide
              </Text>
              <Dato nombre="Nombre" valor={t.solicitante_nombre} />
              <Dato nombre="Teléfono" valor={t.solicitante_telefono} />
              <Dato nombre="Correo" valor={t.solicitante_correo} />
              <Dato nombre="Agencia" valor={t.agencia} />
              <Dato nombre="Área" valor={t.area} />
              <Text style={estilos.subtitulo} accessibilityRole="header">
                Clasificación
              </Text>
              <Dato
                nombre="Prioridad"
                valor={`${t.prioridad_display}${
                  t.prioridad_base && t.prioridad_base !== t.prioridad
                    ? ` (por defecto del caso: ${nombreDe(etiquetas.prioridades, t.prioridad_base)})`
                    : ""
                }`}
              />
              <Dato nombre="Impacto" valor={t.impacto ? t.impacto_display : ""} />
              <Dato nombre="Urgencia" valor={t.urgencia ? t.urgencia_display : ""} />
              <Dato nombre="Nivel de soporte" valor={t.nivel} />
              <Dato
                nombre="Canal"
                valor={`${t.canal_display ?? ""}${t.registrado_por ? ` · registrado por ${t.registrado_por}` : ""}`}
              />
              <Dato nombre="Reaperturas" valor={t.reaperturas > 0 ? String(t.reaperturas) : ""} />
              <Dato nombre="Creado" valor={fechaYHora(t.created_at)} />
            </View>
          </Desplegable>
        </View>

        {t.aprobaciones?.length > 0 ? (
          <Seccion titulo="Aprobaciones" testID="aprobaciones">
            {t.aprobaciones.map((a) => {
              const tono =
                a.estado === "aprobada"
                  ? { ...TONOS.bien, icono: "check-circle-outline" }
                  : a.estado === "rechazada"
                    ? { ...TONOS.mal, icono: "close-circle-outline" }
                    : { ...TONOS.aviso, icono: "clock-outline" };
              return (
                <View key={a.id} style={estilos.bloque}>
                  <View style={estilos.fila}>
                    <Text style={estilos.negrita}>{a.rol}</Text>
                    <Pildora texto={a.estado_display} tono={tono} />
                  </View>
                  <Text style={estilos.tenue}>
                    {a.decidido_por
                      ? `${a.decidido_por} · ${fechaYHora(a.decidido_en)}`
                      : a.aprobador
                        ? `Le toca a ${a.aprobador}`
                        : "Sin responsable con cuenta: decide quien coordina"}
                  </Text>
                  {a.nota ? <Text style={estilos.texto}>«{a.nota}»</Text> : null}
                </View>
              );
            })}
          </Seccion>
        ) : null}

        {t.encuesta ? (
          <Seccion titulo="Encuesta del usuario" testID="encuesta">
            <Dato nombre="Calificación" valor={`${t.encuesta.calificacion} de 5`} />
            <Dato nombre="¿Quedó resuelto?" valor={t.encuesta.resuelto ? "Sí" : "No"} />
            {t.encuesta.comentario ? <Dato nombre="Comentario" valor={`«${t.encuesta.comentario}»`} /> : null}
          </Seccion>
        ) : null}

        <View style={estilos.plegable}>
          <Desplegable titulo="Historial" abierto={verHistorial} onCambiar={setVerHistorial} testID="ver-historial">
            <View style={estilos.bloque} testID="historial">
              {(t.movimientos ?? []).length === 0 ? (
                <Text style={estilos.tenue}>Sin movimientos.</Text>
              ) : (
                t.movimientos.map((m) => (
                  <View key={m.id} style={estilos.movimiento} accessible>
                    <Text style={estilos.negrita}>{m.descripcion}</Text>
                    <Text style={estilos.tenue}>
                      {fechaYHora(m.created_at)} · {m.actor}
                    </Text>
                    {m.nota ? <Text style={estilos.texto}>«{m.nota}»</Text> : null}
                  </View>
                ))
              )}
            </View>
          </Desplegable>
        </View>

        <DialogoDeAccion
          key={dialogo ? `${dialogo.accion}-${dialogo.tecnico?.id ?? ""}` : "sin-dialogo"}
          dialogo={dialogo}
          ocupado={ocupado === "dialogo"}
          error={resultado?.donde === "dialogo" ? resultado : null}
          onCerrar={() => {
            if (ocupado !== "dialogo") setDialogo(null);
          }}
          onConfirmar={confirmarDialogo}
        />
        {verPrioridad ? (
          <DialogoDePrioridad
            ticket={t}
            prioridades={etiquetas.prioridades}
            ocupado={ocupado === "prioridad"}
            error={resultado?.donde === "prioridad" ? resultado : null}
            onCerrar={() => {
              if (ocupado !== "prioridad") setVerPrioridad(false);
            }}
            onCambiar={async (datos) => {
              const hecho = await hacer(
                "prioridad",
                () => soporteService.cambiarPrioridad(t.id, datos, opciones),
                "Prioridad actualizada; el plazo se recalculó.",
              );
              if (hecho && montado.current) setVerPrioridad(false);
            }}
          />
        ) : null}
        <VisorDeImagen {...visor.visor} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 14, paddingBottom: 40 },
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
  titulo: { fontSize: 20, fontWeight: "700", color: colores.titulo },
  subtitulo: { fontSize: 16, fontWeight: "700", color: colores.titulo },
  texto: { fontSize: 15, color: colores.tinta },
  negrita: { fontSize: 15, fontWeight: "700", color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  obligatorio: { color: colores.malTexto },
  avisoInterno: { fontSize: 14, fontWeight: "600", color: colores.avisoTexto },
  fila: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  filaPersona: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  persona: { flexGrow: 1, flexShrink: 1, fontSize: 16, fontWeight: "600", color: colores.tinta },
  botones: { gap: 8 },
  bloque: { gap: 8 },
  peligro: { marginTop: 8 },
  plegable: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  segmentos: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  segmento: {
    ...CONTROLES.pildora,
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 8,
  },
  segmentoActivo: { backgroundColor: colores.primario, borderColor: colores.primario },
  // La nota interna: fondo y borde de aviso, nunca solo color (el candado y
  // el texto lo dicen).
  segmentoInterno: { backgroundColor: colores.avisoFondo, borderColor: colores.avisoTexto, borderWidth: 2 },
  segmentoTexto: CONTROLES.pildoraTexto,
  segmentoTextoActivo: { color: colores.sobrePrimario },
  segmentoTextoInterno: { color: colores.avisoTexto },
  entrada: { ...CONTROLES.entrada, minHeight: 120, paddingVertical: 8 },
  entradaInterna: { backgroundColor: colores.avisoFondo, borderColor: colores.avisoTexto, borderWidth: 2 },
  entradaConError: CONTROLES.entradaConError,
  borrador: {
    fontSize: 15,
    color: colores.tinta,
    padding: 12,
    borderRadius: 8,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.bordeControl,
  },
  sugeridas: { gap: 6 },
  sugerida: {
    minHeight: AREA_TACTIL,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    backgroundColor: colores.superficie,
  },
  presionada: { backgroundColor: colores.realce },
  quedara: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  movimiento: {
    gap: 2,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: colores.acento,
    backgroundColor: colores.fondo,
    borderRadius: 6,
  },
});
