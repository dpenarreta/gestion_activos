import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { erroresPorCampo, mensajeDeError, mensajeDeFormulario } from "../../api/errores";
import { licenciasService } from "../../api/servicios";
import { Alerta, Boton, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { SelectorFecha } from "../../componentes/SelectorFecha";
import {
  descartarTemporal,
  elegirImagen,
  elegirPdf,
  tamanoLegible,
  tomarFoto,
} from "../../permisos/adjunto";
import { aIso, DESCUENTOS, dias as textoDias, duracion, minutosEntre, requisitosDe } from "../../permisos/formato";
import { TEXTO_SIN_ROL, useResumenPermisos } from "../../permisos/ResumenPermisosContext";
import { useReemplazoEnAusencia, YA_QUEDO_GUARDADO } from "../../permisos/useReemplazoEnAusencia";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { useSesion } from "../../sesion/SesionContext";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { CampoTexto, ReglasDelPermiso } from "./piezas";
import { ReemplazoEnAusencia } from "./ReemplazoEnAusencia";
import { crearEstilos } from "../../tema/tipografia";

/**
 * Pedir un permiso (US-010, CA-4 a CA-7), con el comportamiento y los textos
 * de la web (`NuevaSolicitud` de `SolicitudPermisosPage.jsx`):
 *
 * - Al cambiar el tipo o las fechas, el servidor evalúa las reglas
 *   (`/tipos/{id}/evaluar/`), tras una pausa corta para no consultar en cada
 *   toque. La app las muestra tal cual; si alguna bloquea, «Enviar» queda
 *   desactivado con la explicación.
 * - Por horas: un solo día y las horas «desde» y «hasta».
 * - Motivo si el tipo lo pide; en uno médico, obligatorio y con el aviso de
 *   no escribir diagnósticos (LOPDP).
 * - Documento: foto, imagen o PDF, validado antes de enviar.
 * - Un solo envío aunque se toque dos veces (candado en un `ref`: el estado
 *   tarda un render en desactivar el botón).
 *
 * - En un permiso por días, «Mientras usted no está»: quién aprueba por
 *   usted (US-001 de la web; en la app por decisión del Tech Lead,
 *   12/11/2026). Se guarda con «Enviar» y ANTES de la solicitud, como en la
 *   web: cuando el permiso se apruebe, la elección ya está hecha. Si no se
 *   pudo guardar, la solicitud no sale; si se guardó y luego falla la
 *   solicitud, se dice que el reemplazo sí quedó.
 */
export const ESPERA_EVALUAR_MS = 400;

export const TEXTO_BLOQUEA =
  "No se puede enviar: hay restricciones que no se cumplen (marcadas «No cumple»). Cambie las fechas o el tipo de permiso.";
export const TEXTO_FECHAS_AL_REVES = "Revise las fechas: «Hasta» no puede ser antes de «Desde».";
export const TEXTO_AVISO_MEDICO = "No escriba diagnósticos.";
export const TEXTO_ELIJA_TIPO = "Elija el tipo de permiso.";
export const TEXTO_REVISANDO = "Espere: se están revisando las restricciones.";
/** Tras un fallo de red o un tiempo agotado no se sabe si el servidor la
 * recibió (revisión de QA, O-1). */
export const TEXTO_PUEDE_HABERSE_ENVIADO = "Revise «Mis solicitudes»: puede que ya se haya enviado.";
export const TEXTO_CAMBIO_DE_EMPRESA =
  "Cambió la empresa activa y se descartó la solicitud que estaba llenando. Ábrala de nuevo para pedirla en esta empresa.";

/** Los bloques del formulario, de arriba abajo, con sus campos: con un error
 * se lleva la pantalla al primero que falla (H-15). */
const BLOQUES_EN_ORDEN = [
  ["tipo", ["flujo"]],
  ["fechas", ["desde", "hasta", "hora_desde", "hora_hasta"]],
  ["motivo", ["motivo"]],
  ["adjunto", ["adjunto"]],
  ["reemplazo", ["reemplazo"]],
];

/** Los campos, de arriba abajo: el foco va al primero que falla. */
const CAMPOS_EN_ORDEN = BLOQUES_EN_ORDEN.flatMap(([, campos]) => campos);

/** Cómo se llama cada campo en la pantalla, para decir arriba cuáles fallan. */
export const NOMBRES_DE_CAMPO = {
  flujo: "Tipo de permiso",
  desde: "Desde",
  hasta: "Hasta",
  hora_desde: "Desde las",
  hora_hasta: "Hasta las",
  motivo: "Motivo",
  adjunto: "Documento de respaldo",
  reemplazo: "Quién aprueba por usted",
};

/** «Revise los campos marcados: Motivo y Documento de respaldo.» */
export function textoCamposConError(campos) {
  const nombres = [...new Set(campos.map((c) => NOMBRES_DE_CAMPO[c]).filter(Boolean))];
  if (nombres.length === 0) return "Revise los campos marcados.";
  const lista = nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  return `Revise los campos marcados: ${lista}.`;
}

/** Lo que dice el lector de pantalla al terminar una evaluación. */
function textoDeEvaluacion(datos) {
  const fallan = (datos?.reglas ?? []).filter((r) => r.estado === "falla").length;
  if (fallan === 0) return "Restricciones revisadas: se puede enviar.";
  return fallan === 1
    ? "Restricciones revisadas: una no se cumple."
    : `Restricciones revisadas: ${fallan} no se cumplen.`;
}

/** Una hora después de «HH:MM» (sin pasar de las 23:55). */
function unaHoraDespues(hora) {
  const partes = /^(\d{1,2}):(\d{2})/.exec(hora ?? "");
  if (!partes) return undefined;
  const h = Math.min(Number(partes[1]) + 1, 23);
  const m = Number(partes[1]) + 1 > 23 ? 55 : Number(partes[2]);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Las horas de un permiso por horas, con las mismas reglas que el servidor. */
function validarHoras({ hora_desde: inicio, hora_hasta: fin }) {
  const errores = {};
  if (!inicio) errores.hora_desde = "Indique la hora de inicio.";
  if (!fin) errores.hora_hasta = "Indique la hora de fin.";
  if (inicio && fin && minutosEntre(inicio, fin) <= 0) {
    errores.hora_hasta = "La hora de fin debe ser posterior a la de inicio.";
  }
  return errores;
}

export function NuevaSolicitud({ deVacaciones = false }) {
  const router = useRouter();
  const navegacion = useNavigation();
  // Antes de cualquier `return` temprano (revisión UX, M-1).
  const alturaCabecera = useAlturaCabecera();
  const { versionEmpresa } = useSesion();
  const { puedeSolicitar, cargado, recargar: recargarResumen } = useResumenPermisos();
  const hoy = aIso(new Date());
  const [tipos, setTipos] = useState({ estado: "cargando", lista: [], error: null, sinRol: false });
  const [valores, setValores] = useState({
    flujo: "",
    desde: hoy,
    hasta: hoy,
    hora_desde: "",
    hora_hasta: "",
    motivo: "",
  });
  const [adjunto, setAdjunto] = useState(null);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const claveError = useRef(0);
  const [evaluacion, setEvaluacion] = useState({ estado: "inactiva", datos: null });
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const montado = useRef(true);
  const adjuntoRef = useRef(adjunto);
  adjuntoRef.current = adjunto;
  const desplazable = useRef(null);
  // Si la persona ya llenó algo, salir pide confirmación; tras enviar o al
  // cambiar de empresa se sale sin preguntar.
  const [tocado, setTocado] = useState(false);
  // `salida`: una navegación que no pregunta (tras enviar o al cambiar de
  // empresa). Se fija el estado y la navegación va en el efecto de abajo,
  // cuando `usePreventRemove` ya dejó de impedirla (revisión UX, M-2).
  const [salida, setSalida] = useState(false);
  const navegacionPendiente = useRef(null);
  // Lleva al primer bloque con error (H-15), después del layout y con el
  // foco del lector (N-06, B6, N-16). El resumen del error se sigue
  // anunciando con la `Alerta` de arriba.
  // R-03: el foco va al control del campo que falla (`refFoco`), no al
  // contenedor del bloque.
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const arriba = () => irA(null);
  const irAlCampo = (campos) => {
    const campo = CAMPOS_EN_ORDEN.find((c) => campos.includes(c));
    const suyo = campo ? BLOQUES_EN_ORDEN.find(([, suyos]) => suyos.includes(campo))?.[0] : null;
    if (!suyo) {
      arriba();
      return;
    }
    // Por horas, «Desde» y «Hasta» son el mismo selector de fecha.
    irA(suyo, { control: porHoras && campo === "hasta" ? "desde" : campo });
  };
  // El tipo se elige con la lista abierta; luego se ve solo el elegido, con
  // «Cambiar el tipo de permiso» (auditoría UX, H-03).
  const [eligiendoTipo, setEligiendoTipo] = useState(true);
  // Las tres formas de adjuntar se abren con un solo botón, como el clip del
  // chat (auditoría UX, H-14).
  const [opcionesAdjunto, setOpcionesAdjunto] = useState(false);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      // Lo que se eligió y no se envió no queda en la caché.
      descartarTemporal(adjuntoRef.current?.uri);
    };
  }, []);

  const mostrarError = useCallback((texto) => {
    claveError.current += 1;
    setError(texto ? { texto, clave: claveError.current } : null);
  }, []);

  const sinRol = (cargado && !puedeSolicitar) || tipos.sinRol;

  const cargarTipos = useCallback(async () => {
    setTipos({ estado: "cargando", lista: [], error: null, sinRol: false });
    try {
      const respuesta = await licenciasService.tipos();
      if (!montado.current) return;
      const lista = Array.isArray(respuesta) ? respuesta : [];
      setTipos({ estado: "listo", lista, error: null, sinRol: false });
      // No se elige el tipo por la persona (revisión de QA-UX): solo desde
      // «Mis vacaciones» (el que se descuenta de las vacaciones) o si hay uno.
      const inicial =
        (deVacaciones && lista.find((t) => t.descuento === "vacaciones" || t.descuenta_vacaciones)) ||
        (lista.length === 1 ? lista[0] : null);
      if (inicial) {
        setEligiendoTipo(false);
        setValores((v) => ({
          ...v,
          flujo: String(inicial.id),
          hasta: inicial.unidad === "horas" ? v.desde : v.hasta,
        }));
      }
    } catch (e) {
      if (!montado.current) return;
      // Sin `licencias.solicitar` la API responde 403: es la misma
      // situación que «sin rol» (`restricciones.tiene_rol`).
      const sinPermiso = e?.response?.status === 403;
      setTipos({
        estado: "error",
        lista: [],
        error: mensajeDeError(e, "No se pudieron cargar los tipos de permiso."),
        sinRol: sinPermiso,
      });
    }
  }, [deVacaciones]);

  // Sin rol no se piden los tipos (la API respondería 403). Que el resumen
  // termine de cargar con permiso no vuelve a pedirlos.
  const bloqueadaPorRol = cargado && !puedeSolicitar;
  useEffect(() => {
    if (bloqueadaPorRol) return;
    cargarTipos();
  }, [cargarTipos, bloqueadaPorRol]);

  // O-4: la solicitud es de la empresa con la que se abrió. Si cambia, se
  // vuelve atrás con un aviso: los tipos, el reemplazo y las reglas son otros.
  const empresaInicial = useRef(versionEmpresa);
  useEffect(() => {
    if (versionEmpresa === empresaInicial.current) return;
    Alert.alert("Cambió la empresa", TEXTO_CAMBIO_DE_EMPRESA, [{ text: "Entendido" }]);
    salirSinPreguntarA(() => {
      if (router.canGoBack?.() === false) router.replace("/permisos");
      else router.back();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionEmpresa, router]);

  /** Navega sin la pregunta de descartar. */
  function salirSinPreguntarA(navegar) {
    navegacionPendiente.current = navegar;
    setSalida(true);
  }

  useEffect(() => {
    if (!salida || !navegacionPendiente.current) return;
    const navegar = navegacionPendiente.current;
    navegacionPendiente.current = null;
    navegar();
  }, [salida]);

  // Descartar una solicitud a medio llenar pide confirmación.
  usePreventRemove(tocado && !salida && !enviando, ({ data }) => {
    Alert.alert("¿Descartar la solicitud?", "Se perderá lo que llenó.", [
      { text: "Seguir llenando", style: "cancel" },
      {
        text: "Descartar",
        style: "destructive",
        onPress: () => salirSinPreguntarA(() => navegacion.dispatch(data.action)),
      },
    ]);
  });

  const elegido = tipos.lista.find((t) => String(t.id) === valores.flujo) ?? null;
  const { medico, porHoras, pideMotivo, adjuntoObligatorio, pideAdjunto } = requisitosDe(elegido);
  // Un permiso por horas no reasigna: la persona vuelve ese mismo día.
  const pideReemplazo = Boolean(elegido) && !porHoras;
  const reemplazo = useReemplazoEnAusencia({ activo: pideReemplazo });
  const fechasAlReves = Boolean(valores.desde && valores.hasta && valores.hasta < valores.desde);

  // CA-4: la evaluación del servidor, con una pausa corta.
  useEffect(() => {
    const { flujo, desde, hasta } = valores;
    if (!flujo || !desde || !hasta || hasta < desde || sinRol) {
      setEvaluacion({ estado: "inactiva", datos: null });
      return undefined;
    }
    let vigente = true;
    setEvaluacion((e) => ({ estado: "cargando", datos: e.datos }));
    const espera = setTimeout(() => {
      licenciasService
        .evaluar(flujo, desde, hasta)
        .then((datos) => {
          if (!vigente || !montado.current) return;
          setEvaluacion({ estado: "lista", datos });
          anunciar(textoDeEvaluacion(datos));
        })
        .catch((e) => {
          if (!vigente || !montado.current) return;
          // Un 400 trae lo que el servidor no aceptó (unas fechas): se dice.
          const mensaje = e?.response?.status === 400 ? mensajeDeError(e, null) : null;
          setEvaluacion({ estado: "error", datos: null, mensaje });
        });
    }, ESPERA_EVALUAR_MS);
    return () => {
      vigente = false;
      clearTimeout(espera);
    };
    // Solo el tipo y las fechas cambian la evaluación (no el motivo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valores.flujo, valores.desde, valores.hasta, sinRol]);

  const bloquea = evaluacion.estado === "lista" && evaluacion.datos?.bloquea === true;
  // Mientras se reevalúa no se envía: las reglas a la vista son las de antes.
  const revisando = evaluacion.estado === "cargando";

  function fijar(campo, valor) {
    setTocado(true);
    setValores((v) => ({ ...v, [campo]: valor }));
    setErrores((e) => (e[campo] ? { ...e, [campo]: undefined } : e));
  }

  function fijarTipo(tipo) {
    // N-02/B3: el mismo tipo tras «Cambiar» solo cierra la lista; el
    // documento, los errores y lo llenado se quedan.
    if (String(tipo.id) === valores.flujo) {
      setEligiendoTipo(false);
      anunciar(`Tipo elegido: ${tipo.nombre}.`);
      return;
    }
    setTocado(true);
    setErrores({});
    mostrarError(null);
    setEligiendoTipo(false);
    setOpcionesAdjunto(false);
    anunciar(`Tipo elegido: ${tipo.nombre}.`);
    // El documento elegido era para el otro tipo: no se envía con este.
    descartarTemporal(adjunto?.uri);
    setAdjunto(null);
    setValores((v) => ({
      ...v,
      flujo: String(tipo.id),
      hasta: tipo.unidad === "horas" ? v.desde : v.hasta,
    }));
  }

  function fijarDesde(desde) {
    setTocado(true);
    setValores((v) => ({
      ...v,
      desde,
      hasta: porHoras ? desde : v.hasta && v.hasta < desde ? desde : v.hasta,
    }));
    setErrores((e) => ({ ...e, desde: undefined, hasta: undefined }));
  }

  async function elegirAdjunto(como) {
    setOpcionesAdjunto(false);
    setErrores((e) => ({ ...e, adjunto: undefined }));
    let resultado;
    try {
      resultado = await como();
    } catch {
      resultado = { error: "No se pudo abrir el selector. Intente de nuevo." };
    }
    if (!montado.current || !resultado) return;
    if (resultado.error) {
      setErrores((e) => ({ ...e, adjunto: resultado.error }));
      anunciar(resultado.error);
      return;
    }
    descartarTemporal(adjunto?.uri);
    setTocado(true);
    setAdjunto(resultado.archivo);
    anunciar(`Documento elegido: ${resultado.archivo.name}.`);
  }

  function quitarAdjunto() {
    descartarTemporal(adjunto?.uri);
    setAdjunto(null);
    anunciar("Se quitó el documento.");
  }

  async function enviar() {
    if (enCurso.current || bloquea || revisando || sinRol || fechasAlReves) return;
    if (!elegido) {
      setErrores({ flujo: TEXTO_ELIJA_TIPO });
      mostrarError(textoCamposConError(["flujo"]));
      setEligiendoTipo(true);
      irAlCampo(["flujo"]);
      return;
    }
    const propios = porHoras ? validarHoras(valores) : {};
    if (medico && !valores.motivo.trim()) {
      propios.motivo = "Un permiso médico pide el motivo. No escriba diagnósticos.";
    }
    if (adjuntoObligatorio && !adjunto) {
      propios.adjunto = medico ? "Adjunte el certificado médico." : "Este permiso pide un documento de respaldo.";
    }
    const errorDeReemplazo = pideReemplazo && reemplazo.validar();
    if (Object.keys(propios).length > 0 || errorDeReemplazo) {
      const conError = [...Object.keys(propios), ...(errorDeReemplazo ? ["reemplazo"] : [])];
      setErrores(propios);
      mostrarError(textoCamposConError(conError));
      irAlCampo(conError);
      return;
    }
    const { hora_desde: horaDesde, hora_hasta: horaHasta, motivo, ...base } = valores;
    // Por días no se mandan horas (el servidor las rechaza); por horas,
    // «hasta» es el mismo día.
    const campos = porHoras
      ? { ...base, hasta: base.desde, hora_desde: horaDesde, hora_hasta: horaHasta }
      : { ...base };
    campos.motivo = pideMotivo ? motivo : "";
    enCurso.current = true;
    setEnviando(true);
    mostrarError(null);
    setErrores({});
    let reemplazoGuardado = false;
    try {
      // El reemplazo va antes que la solicitud y dentro del mismo `try`: el
      // candado se suelta en el `finally` pase lo que pase.
      if (pideReemplazo) {
        const resultado = await reemplazo.guardar();
        if (!resultado.ok) {
          if (montado.current) {
            mostrarError(resultado.mensaje);
            irAlCampo(["reemplazo"]);
          }
          return;
        }
        reemplazoGuardado = resultado.guardado;
      }
      const creada = await licenciasService.solicitar(campos, pideAdjunto ? adjunto : null);
      descartarTemporal(adjunto?.uri);
      adjuntoRef.current = null;
      recargarResumen();
      // El éxito lo anuncia una sola vez el detalle, con su `Alerta`.
      salirSinPreguntarA(() =>
        router.replace({ pathname: "/permisos/solicitud/[id]", params: { id: String(creada.id), creada: "1" } }),
      );
    } catch (e) {
      if (!montado.current) return;
      const porCampo = erroresPorCampo(e);
      const visibles = new Set(["flujo", "desde", "hasta", "motivo", "adjunto"]);
      if (porHoras) ["hora_desde", "hora_hasta"].forEach((c) => visibles.add(c));
      // Un error de un campo que no está en la pantalla se dice arriba.
      const ocultos = Object.entries(porCampo)
        .filter(([campo]) => !visibles.has(campo))
        .map(([, texto]) => texto);
      const conCampos = Object.keys(porCampo).filter((c) => visibles.has(c));
      const general =
        conCampos.length > 0 && Object.keys(porCampo).length === conCampos.length
          ? textoCamposConError(conCampos)
          : mensajeDeFormulario(e, "No se pudo enviar la solicitud.");
      mostrarError(
        [
          general,
          ...ocultos,
          e?.esDeRed ? TEXTO_PUEDE_HABERSE_ENVIADO : null,
          // Si el reemplazo ya se guardó, se dice: no hace falta volver a elegir.
          reemplazoGuardado ? YA_QUEDO_GUARDADO : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
      setErrores(porCampo);
      // Un error que no es de un campo a la vista se lee en el mensaje de
      // arriba; si no, se va al primer campo que falla.
      if (ocultos.length > 0 || conCampos.length === 0) arriba();
      else irAlCampo(conCampos);
    } finally {
      enCurso.current = false;
      if (montado.current) setEnviando(false);
    }
  }

  if (sinRol) {
    return (
      <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
        <Alerta tipo="aviso" texto={TEXTO_SIN_ROL} />
        <Boton titulo="Enviar solicitud" icono="send" deshabilitado pista={TEXTO_SIN_ROL} onPress={() => {}} />
      </ScrollView>
    );
  }
  if (tipos.estado === "cargando") return <Cargando texto="Cargando los tipos de permiso…" />;
  if (tipos.estado === "error") {
    return (
      <View style={estilos.contenido}>
        <ErrorConReintento texto={tipos.error} onReintentar={cargarTipos} />
      </View>
    );
  }
  if (tipos.lista.length === 0) {
    return <Vacio texto="Todavía no hay tipos de permiso para solicitar." icono="calendar-remove-outline" />;
  }

  const minutos = porHoras ? minutosEntre(valores.hora_desde, valores.hora_hasta) : null;
  const totalDias =
    !fechasAlReves && valores.desde && valores.hasta
      ? Math.round((new Date(`${valores.hasta}T00:00:00`) - new Date(`${valores.desde}T00:00:00`)) / 86400000) + 1
      : null;
  const desactivado = enviando || bloquea || revisando || fechasAlReves;

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
      testID="nueva-solicitud-formulario"
      style={estilos.pantalla}
      contentContainerStyle={estilos.contenido}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      automaticallyAdjustKeyboardInsets
    >
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} /> : null}
      <Text style={estilos.leyenda}>Los campos con * son obligatorios.</Text>

      <View style={estilos.grupo} {...bloque("tipo")}>
        {/* La pregunta se ve y se lee como encabezado; cada opción la repite
            en su pista (revisión de QA-UX). */}
        <Text style={estilos.etiqueta} accessibilityRole="header" accessibilityLabel="Tipo de permiso (obligatorio)">
          Tipo de permiso<Text style={estilos.obligatorio}> *</Text>
        </Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Tipo de permiso (obligatorio)">
        {(eligiendoTipo || !elegido ? tipos.lista : [elegido]).map((t, i) => {
          const activo = String(t.id) === valores.flujo;
          return (
            <Pressable
              key={t.id}
              ref={i === 0 ? refFoco("flujo") : undefined}
              testID={`tipo-${t.id}`}
              onPress={() => fijarTipo(t)}
              accessibilityRole="radio"
              accessibilityState={{ checked: activo }}
              accessibilityLabel={errores.flujo ? `${t.nombre}. Error: ${errores.flujo}` : t.nombre}
              accessibilityHint="Tipo de permiso"
              style={[estilos.opcion, activo && estilos.opcionActiva]}
            >
              <Icono
                nombre={activo ? "radiobox-marked" : "radiobox-blank"}
                size={22}
                color={activo ? colores.primario : colores.bordeControl}
              />
              <Text style={estilos.opcionTexto}>{t.nombre}</Text>
            </Pressable>
          );
        })}
        </View>
        {errores.flujo ? (
          <Text style={estilos.error} importantForAccessibility="no" accessibilityElementsHidden>
            {errores.flujo}
          </Text>
        ) : null}
        {!eligiendoTipo && elegido && tipos.lista.length > 1 ? (
          <Boton
            testID="cambiar-tipo"
            titulo="Cambiar el tipo de permiso"
            icono="swap-horizontal"
            variante="secundario"
            deshabilitado={enviando}
            onPress={() => setEligiendoTipo(true)}
          />
        ) : null}
        {elegido && (
          <View style={estilos.ruta}>
            {elegido.descripcion ? <Text style={estilos.texto}>{elegido.descripcion}</Text> : null}
            {DESCUENTOS[elegido.descuento] ? (
              <Text style={estilos.texto}>
                {DESCUENTOS[elegido.descuento]}
                {porHoras ? " · se pide por horas" : ""}
              </Text>
            ) : null}
            {elegido.pasos?.length > 0 && (
              <>
                <Text style={estilos.tenue}>Lo aprueban, en orden:</Text>
                {elegido.pasos.map((p, i) => (
                  <Text key={`${p.nombre}-${i}`} style={estilos.texto}>
                    {i + 1}. {p.nombre} · {(p.aprobadores ?? []).join(" o ")}
                  </Text>
                ))}
              </>
            )}
          </View>
        )}
      </View>

      {porHoras ? (
        <View style={estilos.grupo} testID="bloque-fechas" {...bloque("fechas")}>
          <SelectorFecha
            testID="fecha-dia"
            refFoco={refFoco("desde")}
            etiqueta="Fecha"
            obligatorio
            valor={valores.desde}
            onCambio={fijarDesde}
            error={errores.desde ?? errores.hasta}
          />
          <View style={estilos.fila}>
            <SelectorFecha
              testID="hora-desde"
              refFoco={refFoco("hora_desde")}
              etiqueta="Desde las"
              modo="time"
              obligatorio
              valor={valores.hora_desde}
              onCambio={(h) => fijar("hora_desde", h)}
              error={errores.hora_desde}
            />
            <SelectorFecha
              testID="hora-hasta"
              refFoco={refFoco("hora_hasta")}
              etiqueta="Hasta las"
              modo="time"
              obligatorio
              valor={valores.hora_hasta}
              porDefecto={unaHoraDespues(valores.hora_desde)}
              onCambio={(h) => fijar("hora_hasta", h)}
              error={errores.hora_hasta}
            />
          </View>
          <Text style={estilos.resumen} accessibilityLiveRegion="polite">
            {minutos === null
              ? "Indique la hora de inicio y la de fin."
              : minutos > 0
                ? `Duración: ${duracion(minutos)}`
                : "Revise las horas: «Hasta las» debe ser después de «Desde las»."}
          </Text>
        </View>
      ) : (
        <View style={estilos.grupo} testID="bloque-fechas" {...bloque("fechas")}>
          <View style={estilos.fila}>
            <SelectorFecha
              testID="fecha-desde"
              refFoco={refFoco("desde")}
              etiqueta="Desde"
              obligatorio
              valor={valores.desde}
              onCambio={fijarDesde}
              error={errores.desde}
            />
            <SelectorFecha
              testID="fecha-hasta"
              refFoco={refFoco("hasta")}
              etiqueta="Hasta"
              obligatorio
              valor={valores.hasta}
              minimo={valores.desde}
              onCambio={(d) => fijar("hasta", d)}
              error={errores.hasta}
            />
          </View>
          <Text style={estilos.resumen} accessibilityLiveRegion="polite">
            {/* Los días que cuentan (laborables, feriados, fines de semana)
                los dice el servidor en las restricciones de abajo. */}
            {totalDias
              ? `${textoDias(totalDias)} de calendario. Cuántos cuentan lo dicen las restricciones de abajo.`
              : TEXTO_FECHAS_AL_REVES}
          </Text>
        </View>
      )}

      {revisando ? (
        <Text style={estilos.tenue} accessibilityLiveRegion="polite" testID="revisando">
          Revisando las restricciones…
        </Text>
      ) : null}
      {evaluacion.estado === "error" ? (
        evaluacion.mensaje ? (
          <Alerta tipo="mal" texto={evaluacion.mensaje} />
        ) : (
          <Alerta
            tipo="aviso"
            texto="No se pudieron revisar las restricciones ahora. Puede enviar igual: el servidor las comprueba al recibir la solicitud."
          />
        )
      ) : null}
      {evaluacion.datos ? <ReglasDelPermiso evaluacion={evaluacion.datos} atenuadas={revisando} /> : null}

      {pideMotivo && (
        <View style={estilos.grupo} {...bloque("motivo")}>
          {medico ? <Alerta tipo="aviso" texto={TEXTO_AVISO_MEDICO} /> : null}
          <CampoTexto
            testID="motivo"
            refFoco={refFoco("motivo")}
            etiqueta="Motivo"
            obligatorio={medico}
            ayuda={medico ? "Indique el motivo sin escribir diagnósticos. Adjunte el certificado médico." : undefined}
            valor={valores.motivo}
            onCambio={(t) => fijar("motivo", t)}
            error={errores.motivo}
            multilinea
            maximo={2000}
          />
        </View>
      )}

      {pideAdjunto && (
        <View style={estilos.grupo} testID="adjunto" {...bloque("adjunto")}>
          <Text style={estilos.etiqueta}>
            {medico
              ? "Certificado médico"
              : adjuntoObligatorio
                ? "Documento de respaldo"
                : "Documento de respaldo (opcional)"}
            {adjuntoObligatorio ? <Text style={estilos.obligatorio}> *</Text> : null}
          </Text>
          <Text style={estilos.tenue}>PDF o imagen (JPG o PNG), hasta 10 MB.</Text>
          {adjunto ? (
            <View style={estilos.archivo}>
              <Icono
                nombre={adjunto.type === "application/pdf" ? "file-pdf-box" : "file-image-outline"}
                size={24}
                color={colores.primario}
              />
              <Text style={estilos.archivoNombre}>
                {adjunto.name}
                {adjunto.size ? ` · ${tamanoLegible(adjunto.size)}` : ""}
              </Text>
              <Boton
                testID="quitar-adjunto"
                titulo="Quitar"
                variante="secundario"
                icono="close"
                etiqueta={`Quitar el documento ${adjunto.name}`}
                onPress={quitarAdjunto}
              />
            </View>
          ) : (
            <View style={estilos.grupo}>
              {/* Un solo botón que abre las tres formas en la pantalla (no un
                  `Alert`: en Android admite tres botones como mucho y no se
                  lee como lista). Igual que el clip del chat (H-14). */}
              <Pressable
                ref={refFoco("adjunto")}
                testID="adjuntar"
                onPress={() => {
                  // N-07: las opciones se abren debajo; se llevan a la vista
                  // (sin mover el foco, que sigue en el botón).
                  if (!opcionesAdjunto) irA("adjunto", { foco: false });
                  setOpcionesAdjunto((v) => !v);
                }}
                disabled={enviando}
                accessibilityRole="button"
                accessibilityLabel={medico ? "Adjuntar el certificado" : "Adjuntar documento"}
                accessibilityHint="Ofrece tomar una foto, elegir una imagen o elegir un PDF"
                accessibilityState={{ expanded: opcionesAdjunto, disabled: enviando }}
                style={({ pressed }) => [estilos.adjuntar, pressed && estilos.presionado]}
              >
                <Icono nombre="paperclip" size={20} color={colores.primario} />
                <Text style={estilos.adjuntarTexto}>{medico ? "Adjuntar el certificado" : "Adjuntar documento"}</Text>
                <Icono nombre={opcionesAdjunto ? "chevron-up" : "chevron-down"} size={22} color={colores.primario} />
              </Pressable>
              {opcionesAdjunto ? (
                <View style={estilos.fila} testID="opciones-adjunto">
                  <Boton testID="adjunto-camara" titulo="Tomar foto" icono="camera-outline" variante="secundario" onPress={() => elegirAdjunto(tomarFoto)} />
                  <Boton testID="adjunto-galeria" titulo="Elegir imagen" icono="image-outline" variante="secundario" onPress={() => elegirAdjunto(elegirImagen)} />
                  <Boton testID="adjunto-pdf" titulo="Elegir PDF" icono="file-pdf-box" variante="secundario" onPress={() => elegirAdjunto(elegirPdf)} />
                </View>
              ) : null}
            </View>
          )}
          {errores.adjunto ? (
            <View style={estilos.filaError}>
              <Icono nombre="alert-circle-outline" size={16} color={colores.malTexto} />
              <Text style={estilos.error}>{errores.adjunto}</Text>
            </View>
          ) : null}
        </View>
      )}

      {pideReemplazo ? (
        <View {...bloque("reemplazo")}>
          <ReemplazoEnAusencia reemplazo={reemplazo} deshabilitado={enviando} refFoco={refFoco("reemplazo")} />
        </View>
      ) : null}

      {bloquea ? <Alerta tipo="mal" texto={TEXTO_BLOQUEA} /> : null}
      <View style={estilos.acciones}>
        <Boton
          testID="enviar-solicitud"
          titulo={enviando ? "Enviando…" : "Enviar solicitud"}
          icono="send"
          cargando={enviando}
          deshabilitado={desactivado}
          pista={revisando ? TEXTO_REVISANDO : bloquea ? TEXTO_BLOQUEA : undefined}
          onPress={() => {
            enviar();
          }}
        />
        {/* Sin «Cancelar»: repetía «Volver» de la cabecera. Salir con algo
            llenado sigue pidiendo confirmación (auditoría UX, H-16). */}
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 16, paddingBottom: 40 },
  leyenda: { fontSize: 14, color: colores.tintaSuave },
  grupo: { gap: 8 },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  obligatorio: { color: colores.malTexto },
  opcion: CONTROLES.opcion,
  opcionActiva: CONTROLES.opcionActiva,
  opcionTexto: { ...CONTROLES.opcionTexto, flex: 1 },
  adjuntar: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colores.primario,
    backgroundColor: colores.superficie,
  },
  adjuntarTexto: { flex: 1, fontSize: 16, fontWeight: "600", color: colores.primario },
  presionado: { opacity: 0.85 },
  ruta: { gap: 4, padding: 12, borderRadius: 8, backgroundColor: colores.superficie },
  texto: { fontSize: 15, color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  resumen: { fontSize: 15, fontWeight: "600", color: colores.tintaSuave },
  error: { flex: 1, fontSize: 14, color: colores.malTexto },
  filaError: { flexDirection: "row", alignItems: "center", gap: 6 },
  archivo: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  archivoNombre: { flex: 1, minWidth: 120, fontSize: 15, color: colores.tinta },
  acciones: { gap: 10 },
});
