import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { licenciasService } from "../../api/licenciasService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { useAuth } from "../../hooks/useAuth";
import { useModalA11y } from "../../hooks/useModalA11y";
import { usePermission } from "../../hooks/usePermission";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import { CalendarioDeRango } from "./CalendarioDeRango";
import { CalendarioSolicitado } from "./CalendarioSolicitado";
import {
  DESCUENTOS,
  DESTINOS_ESCALAR,
  ESTADOS,
  SelectorDestino,
  duracion,
  duracionDeSolicitud,
  fechas,
  horario,
  minutosEntre,
} from "./licenciasComunes";
import "./Institucional.css";
import { descargarBlob } from "../../utils/descargas";
import { confirmar } from "../../components/common/Confirmar/confirmar";

/** Una ventana del módulo. `pie` va fijo abajo (las acciones quedan a la
 * vista aunque el contenido se desplace) y el diálogo se nombra con su
 * título visible. */
function Ventana({ titulo, onCerrar, children, ancha = false, clase, pie }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const tituloId = useId();
  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={`mz-modal${ancha ? " mz-modal--wide" : ""}${clase ? ` ${clase}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id={tituloId}>{titulo}</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body">{children}</div>
        {pie && <div className="mz-panel-foot solicitud-pie-fijo">{pie}</div>}
      </div>
    </div>
  );
}

function hoyIso() {
  const ahora = new Date();
  return new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

const ESTADO_REGLA = {
  ok: { icono: "check-circle-fill", nombre: "Cumple" },
  falla: { icono: "x-circle-fill", nombre: "No cumple" },
  aviso: { icono: "exclamation-triangle-fill", nombre: "Atención" },
  info: { icono: "info-circle-fill", nombre: "Para tener en cuenta" },
};

/** Las restricciones del tipo de permiso para las fechas elegidas, cada una
 * con si se cumple. Las que no se cumplen no dejan enviar. */
function RestriccionesDelPermiso({
  evaluacion,
  titulo = "Restricciones de este permiso",
}) {
  if (!evaluacion?.reglas.length) return null;
  return (
    <section className="solicitud-reglas" aria-labelledby="sp-reglas">
      <strong id="sp-reglas" className="solicitud-reglas__titulo">
        {titulo}
      </strong>
      <ul>
        {evaluacion.reglas.map((regla) => {
          const estado = ESTADO_REGLA[regla.estado] ?? ESTADO_REGLA.info;
          return (
            <li
              key={regla.clave}
              className={`solicitud-regla solicitud-regla--${regla.estado}`}
            >
              <Icon name={estado.icono} />
              <div>
                <span className="visually-hidden">{estado.nombre}: </span>
                <span className="solicitud-regla__texto">{regla.texto}</span>
                {regla.detalle && <small>{regla.detalle}</small>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Las horas de un permiso por horas, antes de enviarlo: las dos, y el fin
 * después del inicio (las mismas reglas que el servidor). */
function validarHoras({ hora_desde: inicio, hora_hasta: fin }) {
  // Las dos a la vez: si faltan ambas, se marcan ambas.
  const errores = {};
  if (!inicio) errores.hora_desde = "Indique la hora de inicio.";
  if (!fin) errores.hora_hasta = "Indique la hora de fin.";
  if (inicio && fin && minutosEntre(inicio, fin) <= 0)
    errores.hora_hasta = "La hora de fin debe ser posterior a la de inicio.";
  return errores;
}

/** Si un tipo de permiso genera ausencias médicas. `tipo_ausencia` o
 * `es_medico`, según lo que exponga `/licencias/tipos/`. */
const esMedico = (tipo) =>
  tipo?.tipo_ausencia === "MEDICO" || tipo?.es_medico === true;

/** Pedir un permiso: el tipo (con sus pasos a la vista), las fechas (o, si
 * es por horas, el día y el horario), el motivo y, si lo pide, el
 * documento. */
function NuevaSolicitud({ onCreada, onCerrar, deVacaciones = false }) {
  const [tipos, setTipos] = useState(null);
  const [valores, setValores] = useState({
    flujo: "",
    desde: hoyIso(),
    hasta: hoyIso(),
    hora_desde: "",
    hora_hasta: "",
    motivo: "",
  });
  const [adjunto, setAdjunto] = useState(null);
  const [error, setError] = useState(null);
  const [errorTipos, setErrorTipos] = useState(null);
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [evaluacion, setEvaluacion] = useState(null);
  const formulario = useRef(null);
  // Contra el doble envío: el estado tarda un render en desactivar el botón.
  const enCurso = useRef(false);

  // Las restricciones se recalculan al cambiar el tipo o las fechas (con una
  // pausa corta, para no consultar en cada tecla).
  useEffect(() => {
    const { flujo, desde, hasta } = valores;
    if (!flujo || !desde || !hasta || hasta < desde) {
      setEvaluacion(null);
      return undefined;
    }
    let vigente = true;
    const espera = setTimeout(() => {
      licenciasService
        .evaluar(flujo, desde, hasta)
        .then((resultado) => vigente && setEvaluacion(resultado))
        .catch(() => vigente && setEvaluacion(null));
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(espera);
    };
  }, [valores]);

  const cargarTipos = useCallback(() => {
    setTipos(null);
    setErrorTipos(null);
    licenciasService
      .tipos()
      .then((lista) => {
        setTipos(lista);
        // Desde Mis vacaciones («Solicitar vacaciones»): el tipo que se
        // descuenta de las vacaciones, ya elegido.
        const inicial =
          (deVacaciones &&
            lista.find(
              (t) => t.descuento === "vacaciones" || t.descuenta_vacaciones,
            )) ||
          lista[0];
        if (inicial)
          setValores((v) => ({
            ...v,
            flujo: String(inicial.id),
            hasta: inicial.unidad === "horas" ? v.desde : v.hasta,
          }));
      })
      .catch((err) => {
        // Antes un fallo se veía como «no hay tipos de permiso» (auditoría
        // UX/UI, fase 2, 28/10/2026): ahora se dice que no se pudo cargar,
        // con «Reintentar».
        setErrorTipos(
          mensajeDeError(err, "No se pudieron cargar los tipos de permiso."),
        );
        setTipos([]);
      });
  }, [deVacaciones]);

  useEffect(() => {
    cargarTipos();
  }, [cargarTipos]);

  const elegido = tipos?.find((t) => String(t.id) === valores.flujo);
  // Un permiso médico pide siempre el motivo y el documento (el servidor
  // responde 400 si faltan).
  const medico = esMedico(elegido);
  const pideMotivo = medico || elegido?.pide_motivo !== false;
  const adjuntoObligatorio = medico || elegido?.adjunto === "obligatorio";
  const pideAdjunto =
    Boolean(elegido) && (adjuntoObligatorio || elegido.adjunto !== "no");
  // Por horas (05/11/2026): un solo día, con hora de inicio y de fin.
  const porHoras = elegido?.unidad === "horas";
  const fijar = (campo) => (e) =>
    setValores((v) => ({ ...v, [campo]: e.target.value }));
  const fijarTipo = (e) => {
    const flujo = e.target.value;
    const tipo = tipos.find((t) => String(t.id) === flujo);
    setErrores({});
    // El documento elegido era para el otro tipo: no se envía con este.
    setAdjunto(null);
    setValores((v) => ({
      ...v,
      flujo,
      hasta: tipo?.unidad === "horas" ? v.desde : v.hasta,
    }));
  };
  // El día de un permiso por horas: «desde» y «hasta» van juntos.
  const fijarDia = (dia) =>
    setValores((v) => ({ ...v, desde: dia, hasta: dia }));
  const minutos = porHoras
    ? minutosEntre(valores.hora_desde, valores.hora_hasta)
    : null;
  // Desde y Hasta, escritos o elegidos en el calendario. Si «desde» pasa a
  // ser posterior a «hasta», «hasta» lo acompaña.
  const fijarDesde = (e) => {
    const desde = e.target.value;
    setValores((v) => ({
      ...v,
      desde,
      hasta: desde && v.hasta && v.hasta < desde ? desde : v.hasta,
    }));
  };
  const dias =
    valores.desde && valores.hasta && valores.desde <= valores.hasta
      ? Math.round(
          (new Date(`${valores.hasta}T00:00:00`) -
            new Date(`${valores.desde}T00:00:00`)) /
            86400000,
        ) + 1
      : null;

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    // Lo que se puede saber sin ir al servidor: el error va junto a su
    // campo y el foco al primero (auditoría UX/UI, fase 2).
    const propios = porHoras ? validarHoras(valores) : {};
    if (medico && !valores.motivo.trim())
      propios.motivo =
        "Un permiso médico pide el motivo. No escriba diagnósticos.";
    if (adjuntoObligatorio && !adjunto)
      propios.adjunto = medico
        ? "Adjunte el certificado médico."
        : "Este permiso pide un documento de respaldo.";
    if (Object.keys(propios).length) {
      setError(null);
      setErrores(propios);
      enfocarPrimerError(formulario.current);
      return;
    }
    const { hora_desde: horaDesde, hora_hasta: horaHasta, ...base } = valores;
    // Por días no se mandan horas (el servidor las rechaza); por horas,
    // «hasta» es el mismo día.
    const campos = porHoras
      ? {
          ...base,
          hasta: base.desde,
          hora_desde: horaDesde,
          hora_hasta: horaHasta,
        }
      : base;
    enCurso.current = true;
    setEnviando(true);
    setError(null);
    setErrores({});
    try {
      onCreada(
        await licenciasService.solicitar(
          pideMotivo ? campos : { ...campos, motivo: "" },
          // Solo si el tipo lo pide (y se ve el campo).
          pideAdjunto ? adjunto : null,
        ),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar la solicitud."));
      setErrores(erroresPorCampo(err));
      setEnviando(false);
      enfocarPrimerError(formulario.current);
    } finally {
      enCurso.current = false;
    }
  }

  return (
    <Ventana titulo="Nueva solicitud de permiso" onCerrar={onCerrar} ancha>
      {tipos === null ? (
        <EstadoDeCarga cargando />
      ) : tipos.length === 0 ? (
        errorTipos ? (
          <EstadoDeCarga error={errorTipos} onReintentar={cargarTipos} />
        ) : (
          <p className="mz-faint mb-0">
            Todavía no hay tipos de permiso para solicitar.
          </p>
        )
      ) : (
        // noValidate: lo obligatorio se revisa aquí y en el servidor, y el
        // error se muestra junto a cada campo.
        <form ref={formulario} className="row g-2" onSubmit={enviar} noValidate>
          {error && (
            <div className="col-12">
              <div className="mz-alert mz-alert--bad" role="alert">
                <Icon name="x-octagon" />
                {error}
              </div>
            </div>
          )}
          <div className="col-12">
            <LeyendaObligatorios />
          </div>
          <div className="col-12">
            <Campo
              id="sp-tipo"
              etiqueta="Tipo de permiso"
              obligatorio
              error={errores.flujo}
            >
              <select
                className="form-select form-select-sm"
                value={valores.flujo}
                onChange={fijarTipo}
              >
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            {elegido && (
              <div className="solicitud-ruta mt-2">
                {elegido.descripcion && (
                  <p className="mz-small mb-1">{elegido.descripcion}</p>
                )}
                {DESCUENTOS[elegido.descuento] && (
                  <p className="solicitud-descuento mb-1">
                    <Icon name="wallet2" /> {DESCUENTOS[elegido.descuento]}
                    {porHoras ? " · se pide por horas" : ""}
                  </p>
                )}
                <span className="mz-faint mz-small">
                  Lo aprueban, en orden:
                </span>
                <ol>
                  {elegido.pasos.map((p) => (
                    <li key={p.nombre}>
                      <strong>{p.nombre}</strong>{" "}
                      <span className="mz-faint">
                        · {p.aprobadores.join(" o ")}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
          <div className="col-12 col-md-7">
            <CalendarioDeRango
              desde={valores.desde}
              hasta={valores.hasta}
              // Por horas, un solo día: cada toque fija «desde = hasta».
              unDia={porHoras}
              onCambio={(rango) => setValores((v) => ({ ...v, ...rango }))}
            />
          </div>
          {porHoras ? (
            <div className="col-12 col-md-5 d-flex flex-column gap-2">
              <Campo
                id="sp-dia"
                etiqueta="Fecha"
                obligatorio
                // «hasta» llega si el servidor no ve un solo día.
                error={errores.desde ?? errores.hasta}
              >
                <input
                  type="date"
                  className="form-control form-control-sm"
                  value={valores.desde}
                  onChange={(e) => fijarDia(e.target.value)}
                />
              </Campo>
              <div className="solicitud-horas">
                <Campo
                  id="sp-hora-desde"
                  etiqueta="Desde las"
                  obligatorio
                  error={errores.hora_desde}
                >
                  <input
                    type="time"
                    className="form-control form-control-sm"
                    value={valores.hora_desde}
                    onChange={fijar("hora_desde")}
                  />
                </Campo>
                <Campo
                  id="sp-hora-hasta"
                  etiqueta="Hasta las"
                  obligatorio
                  error={errores.hora_hasta}
                >
                  <input
                    type="time"
                    min={valores.hora_desde || undefined}
                    className="form-control form-control-sm"
                    value={valores.hora_hasta}
                    onChange={fijar("hora_hasta")}
                  />
                </Campo>
              </div>
              <p className="solicitud-dias mb-0" role="status">
                {minutos === null
                  ? "Indique la hora de inicio y la de fin."
                  : minutos > 0
                    ? `Duración: ${duracion(minutos)}`
                    : "Revise las horas: «Hasta las» debe ser después de «Desde las»."}
              </p>
            </div>
          ) : (
            <div className="col-12 col-md-5 d-flex flex-column gap-2">
              <Campo
                id="sp-desde"
                etiqueta="Desde"
                obligatorio
                error={errores.desde}
              >
                <input
                  type="date"
                  className="form-control form-control-sm"
                  value={valores.desde}
                  onChange={fijarDesde}
                />
              </Campo>
              <Campo
                id="sp-hasta"
                etiqueta="Hasta"
                obligatorio
                error={errores.hasta}
              >
                <input
                  type="date"
                  min={valores.desde}
                  className="form-control form-control-sm"
                  value={valores.hasta}
                  onChange={fijar("hasta")}
                />
              </Campo>
              <p className="solicitud-dias mb-0" aria-live="polite">
                {dias
                  ? `${dias} ${dias === 1 ? "día" : "días"} en total`
                  : "Revise las fechas: «Hasta» no puede ser antes de «Desde»."}
              </p>
            </div>
          )}
          {/* Las indicaciones del permiso van a todo el ancho; el motivo, solo
              si el tipo lo pide (vacaciones no). */}
          {evaluacion?.reglas.length > 0 && (
            <div className="col-12">
              <RestriccionesDelPermiso evaluacion={evaluacion} />
            </div>
          )}
          {pideMotivo && (
            <Campo
              id="sp-motivo"
              etiqueta="Motivo"
              obligatorio={medico}
              // LOPDP: el motivo lo leen quienes aprueban.
              ayuda={
                medico ? (
                  <span className="solicitud-ayuda-medica">
                    Indique el motivo sin escribir diagnósticos. Adjunte el
                    certificado médico.
                  </span>
                ) : undefined
              }
              error={errores.motivo}
              className="col-12"
            >
              <textarea
                rows={3}
                className="form-control form-control-sm"
                value={valores.motivo}
                onChange={fijar("motivo")}
              />
            </Campo>
          )}
          {pideAdjunto && (
            <Campo
              id="sp-adjunto"
              etiqueta={
                medico
                  ? "Certificado médico"
                  : adjuntoObligatorio
                    ? "Documento de respaldo"
                    : "Documento de respaldo (opcional)"
              }
              obligatorio={adjuntoObligatorio}
              ayuda="PDF o imagen, hasta 10 MB."
              error={errores.adjunto}
              className="col-12"
            >
              <input
                // Al cambiar de tipo se vacía: el archivo no queda oculto.
                key={valores.flujo}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="form-control form-control-sm"
                onChange={(e) => setAdjunto(e.target.files?.[0] ?? null)}
              />
            </Campo>
          )}
          <div className="col-12 mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={enviando || !elegido || evaluacion?.bloquea}
            >
              {enviando ? "Enviando…" : "Enviar solicitud"}
            </button>
          </div>
        </form>
      )}
    </Ventana>
  );
}

/** El texto de cada acción del historial, en una frase que se entienda
 * (auditoría UX/UI de la revisión, 29/10/2026). */
function textoDeAccion(a) {
  const paso = a.paso ? ` en el paso «${a.paso}»` : "";
  switch (a.accion) {
    case "creada":
      return <>{a.actor && <strong>{a.actor}</strong>} hizo la solicitud</>;
    case "asignada":
      return (
        <>
          Pasó al paso «{a.paso}»
          {a.detalle && (
            <>
              {" "}
              · le toca a <strong>{a.detalle}</strong>
            </>
          )}
        </>
      );
    case "aprobada":
      return (
        <>
          {a.actor && <strong>{a.actor}</strong>} aprobó{paso}
        </>
      );
    case "rechazada":
      return (
        <>
          {a.actor && <strong>{a.actor}</strong>} rechazó{paso}
        </>
      );
    case "escalada":
      return (
        <>
          {a.actor && <strong>{a.actor}</strong>} escaló{paso}
          {a.detalle && (
            <>
              {" "}
              a <strong>{a.detalle}</strong>
            </>
          )}
        </>
      );
    case "cancelada":
      return <>{a.actor && <strong>{a.actor}</strong>} canceló la solicitud</>;
    case "terminada":
      return (
        <>
          Resultado: <strong>{a.detalle || a.accion_display}</strong>
        </>
      );
    default:
      return (
        <>
          {a.actor && <strong>{a.actor} </strong>}
          {a.accion_display.toLowerCase()}
          {a.detalle ? `: ${a.detalle}` : ""}
        </>
      );
  }
}

/** Lo que pasa al cancelar una aprobada, nombrando a la persona. Los días
 * de vacaciones se dicen solo si `dias_a_devolver > 0`; si el servidor aún
 * no manda ese dato, se dice sin número y solo si se descontó de las
 * vacaciones. */
function consecuenciaDeCancelar(solicitud) {
  const nombre = solicitud.solicitante?.nombre || "la persona";
  const n = solicitud.dias_a_devolver;
  const dias = (x) => `${x} ${x === 1 ? "día" : "días"}`;
  let devolver = "";
  let devuelto = "";
  if (typeof n === "number") {
    if (n > 0) {
      devolver = ` y se le devolverán ${dias(n)} de vacaciones`;
      devuelto = ` y se le devolvieron ${dias(n)} de vacaciones`;
    }
  } else if (solicitud.descuento === "vacaciones") {
    devolver = " y se le devolverán los días de vacaciones descontados";
    devuelto = " y se le devolvieron los días de vacaciones descontados";
  }
  return {
    futuro: `Se quitarán las ausencias de ${nombre} en Gestión Humana${devolver}.`,
    hecho: `se quitaron las ausencias de ${nombre} en Gestión Humana${devuelto}.`,
  };
}

/** El motivo de rechazo tiene que explicar algo a quien pidió. */
const MINIMO_RECHAZO = 10;

/** El detalle de una solicitud, pensado para quien la revisa (auditoría
 * UX/UI de la revisión, 29/10/2026): arriba, quién pide, qué y a quién le
 * toca decidir; luego lo que hace falta para decidir (saldo y restricciones,
 * feriados en el calendario), el motivo, el documento y el historial; las
 * acciones, con su comentario y sus errores, en el pie fijo de la ventana. */
function DetalleSolicitud({ id, onCambio, onCerrar }) {
  const { user } = useAuth();
  const [solicitud, setSolicitud] = useState(null);
  const [comentario, setComentario] = useState("");
  const [errorComentario, setErrorComentario] = useState(null);
  const [escalando, setEscalando] = useState(false);
  const [destino, setDestino] = useState(DESTINO_VACIO);
  const [opciones, setOpciones] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [error, setError] = useState(null);
  const [hecho, setHecho] = useState(null);
  const [trabajando, setTrabajando] = useState(null);
  const [descargando, setDescargando] = useState(false);
  const campoComentario = useRef(null);
  const avisoHecho = useRef(null);
  const ocupado = useRef(false);
  // A dónde va el foco cuando el botón pulsado desaparece del pie.
  const enfocarLuego = (selector) =>
    requestAnimationFrame(() => document.querySelector(selector)?.focus());

  const cargar = useCallback(() => {
    setErrorCarga(null);
    licenciasService
      .solicitud(id)
      .then(setSolicitud)
      .catch((err) =>
        setErrorCarga(mensajeDeError(err, "No se pudo abrir la solicitud.")),
      );
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (escalando && !opciones) {
      licenciasService
        .opciones()
        .then(setOpciones)
        // Sin las opciones no hay a quién escalar: se avisa en vez de dejar
        // el selector vacío (auditoría UX/UI, fase 2, 28/10/2026).
        .catch((err) =>
          setError(mensajeDeError(err, "No se pudo cargar a quién escalar.")),
        );
    }
  }, [escalando, opciones]);

  // A quién escalar: ni a quien pidió ni a uno mismo.
  const opcionesDeEscalar = opciones && {
    ...opciones,
    personas: (opciones.personas ?? []).filter(
      (p) => p.id !== solicitud?.solicitante.id && p.id !== user?.id,
    ),
  };
  const destinoElegido =
    destino.tipo === "persona"
      ? Boolean(destino.usuario)
      : destino.tipo === "rol"
        ? Boolean(destino.rol)
        : destino.tipo === "cargo"
          ? Boolean(destino.cargo)
          : true;

  async function hacer(accion, enCurso, listo) {
    // Contra el doble envío: `trabajando` tarda un render en desactivar.
    if (ocupado.current) return;
    ocupado.current = true;
    setTrabajando(enCurso);
    setError(null);
    setHecho(null);
    try {
      const datos = await accion();
      setSolicitud(datos);
      setComentario("");
      setEscalando(false);
      setDestino(DESTINO_VACIO);
      setHecho(listo(datos));
      // El pie puede desaparecer con el botón pulsado: el foco va al aviso.
      requestAnimationFrame(() => avisoHecho.current?.focus());
      onCambio();
    } catch (err) {
      // El error del comentario (cancelar una aprobada sin decir por qué)
      // va bajo su campo, con el foco en él.
      const delComentario = erroresPorCampo(err).comentario;
      if (delComentario) {
        setErrorComentario(delComentario);
        requestAnimationFrame(() => campoComentario.current?.focus());
      } else {
        setError(mensajeDeError(err, "No se pudo completar."));
      }
    } finally {
      ocupado.current = false;
      setTrabajando(null);
    }
  }

  async function verAdjunto() {
    setError(null);
    setDescargando(true);
    try {
      const blob = await licenciasService.adjunto(id);
      descargarBlob(blob, solicitud.adjunto_nombre);
    } catch (err) {
      // Antes fallaba sin avisar (auditoría UX/UI, fase 2, 28/10/2026).
      setError(mensajeDeError(err, "No se pudo descargar el documento."));
    } finally {
      setDescargando(false);
    }
  }

  const [estado, clase] = ESTADOS[solicitud?.estado] ?? ["", ""];
  // Unidad, descuento y horario son de la solicitud (se copian del tipo al
  // crearla): si el tipo cambia después, la solicitud no cambia.
  const porHoras = solicitud?.unidad === "horas";
  const horas = solicitud
    ? horario(solicitud.hora_desde, solicitud.hora_hasta)
    : "";
  const resumen =
    solicitud &&
    `${solicitud.flujo.toLowerCase()} de ${solicitud.solicitante.nombre} (${[
      fechas(solicitud.desde, solicitud.hasta, formatearFecha),
      horas,
      duracionDeSolicitud(solicitud),
    ]
      .filter(Boolean)
      .join(", ")})`;
  // Una aprobada la cancela Gestión Humana, diciendo por qué.
  const cancelaAprobada =
    solicitud?.estado === "aprobada" &&
    Boolean(solicitud?.puedo?.cancelar_pide_comentario);

  async function cancelar() {
    const motivo = comentario.trim();
    if (cancelaAprobada && !motivo) {
      setErrorComentario(
        "Para cancelar una solicitud aprobada, explique por qué: queda en el historial y se avisa a quien la pidió.",
      );
      campoComentario.current?.focus();
      return;
    }
    const consecuencia = consecuenciaDeCancelar(solicitud);
    const si = await confirmar(
      cancelaAprobada
        ? {
            titulo: `¿Cancelar ${resumen}, ya aprobada?`,
            mensaje: `${consecuencia.futuro} Se avisará a quien la pidió con su comentario: «${motivo}».`,
            accion: "Cancelar solicitud aprobada",
            cancelar: "Volver",
          }
        : {
            titulo: "¿Cancelar la solicitud?",
            mensaje: "La solicitud se retira y ya no sigue su aprobación.",
            accion: "Cancelar solicitud",
            cancelar: "Volver",
          },
    );
    if (!si) return;
    hacer(
      () => licenciasService.cancelar(id, comentario),
      "cancelar",
      () =>
        cancelaAprobada
          ? `Solicitud cancelada: ${consecuencia.hecho}`
          : "Solicitud cancelada.",
    );
  }
  const siguiente = (datos) =>
    datos.estado === "pendiente"
      ? ` Ahora le toca a ${datos.pendiente_de.map((p) => p.nombre).join(", ")}.`
      : "";

  async function aprobar() {
    if (
      !(await confirmar({
        titulo: `¿Aprobar ${resumen}?`,
        mensaje: comentario.trim()
          ? `Se enviará su comentario: «${comentario.trim()}».`
          : "Si es el último paso, la solicitud queda aprobada y se avisa a quien la hizo.",
        accion: "Aprobar",
        peligro: false,
      }))
    )
      return;
    hacer(
      () => licenciasService.aprobar(id, comentario),
      "aprobar",
      (datos) => `Aprobada.${siguiente(datos)}`,
    );
  }

  async function rechazar() {
    const motivo = comentario.trim();
    if (motivo.length < MINIMO_RECHAZO) {
      setErrorComentario(
        `Para rechazar, explique el motivo (al menos ${MINIMO_RECHAZO} caracteres): lo leerá quien la pidió.`,
      );
      campoComentario.current?.focus();
      return;
    }
    if (
      !(await confirmar({
        titulo: `¿Rechazar ${resumen}?`,
        mensaje: `La solicitud termina aquí y se avisa a quien la hizo con su comentario: «${motivo}».`,
        accion: "Rechazar",
      }))
    )
      return;
    hacer(
      () => licenciasService.rechazar(id, comentario),
      "rechazar",
      () => "Rechazada. Se avisó a quien la hizo.",
    );
  }

  const puedeActuar =
    solicitud &&
    (solicitud.puedo.resolver ||
      solicitud.puedo.escalar ||
      solicitud.puedo.cancelar);

  const pie = puedeActuar ? (
    <div className="solicitud-pie">
      {error && (
        <div className="mz-alert mz-alert--bad mb-2" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      <label className="form-label mz-small mb-1" htmlFor="sp-comentario">
        Comentario para el solicitante{" "}
        {cancelaAprobada && !escalando ? (
          <span className="mz-faint">(obligatorio para cancelar)</span>
        ) : (
          solicitud.puedo.resolver &&
          !escalando && (
            <span className="mz-faint">(obligatorio para rechazar)</span>
          )
        )}
      </label>
      <textarea
        id="sp-comentario"
        ref={campoComentario}
        rows={2}
        className={`form-control form-control-sm${errorComentario ? " is-invalid" : ""}`}
        value={comentario}
        onChange={(e) => {
          setComentario(e.target.value);
          setErrorComentario(null);
        }}
        aria-required={cancelaAprobada && !escalando ? true : undefined}
        aria-invalid={errorComentario ? true : undefined}
        aria-describedby={errorComentario ? "sp-comentario-error" : undefined}
      />
      {errorComentario && (
        <div id="sp-comentario-error" className="mz-field-error">
          {errorComentario}
        </div>
      )}
      {escalando && (
        <div className="mt-2">
          <label className="form-label mz-small mb-1" htmlFor="sp-escalar">
            Escalar a
          </label>
          <SelectorDestino
            id="sp-escalar"
            etiqueta="Escalar a"
            valor={destino}
            onCambio={setDestino}
            opciones={opcionesDeEscalar}
            tipos={DESTINOS_ESCALAR}
          />
        </div>
      )}
      <div className="mz-actions justify-content-end mt-2">
        {solicitud.puedo.cancelar && !escalando && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm me-auto"
            disabled={Boolean(trabajando)}
            onClick={cancelar}
          >
            {trabajando === "cancelar" ? "Cancelando…" : "Cancelar solicitud"}
          </button>
        )}
        {escalando ? (
          <>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={Boolean(trabajando)}
              onClick={() => {
                setEscalando(false);
                setDestino(DESTINO_VACIO);
                setError(null);
                enfocarLuego("#sp-boton-escalar");
              }}
            >
              Volver
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={Boolean(trabajando) || !destinoElegido}
              onClick={() =>
                hacer(
                  () => licenciasService.escalar(id, destino, comentario),
                  "escalar",
                  (datos) => `Escalada.${siguiente(datos)}`,
                )
              }
            >
              <Icon name="send" />{" "}
              {trabajando === "escalar"
                ? "Escalando…"
                : "Confirmar escalamiento"}
            </button>
          </>
        ) : (
          <>
            {solicitud.puedo.escalar && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={Boolean(trabajando)}
                id="sp-boton-escalar"
                onClick={() => {
                  setHecho(null);
                  setEscalando(true);
                  enfocarLuego("#sp-escalar");
                }}
              >
                <Icon name="arrow-up-right" /> Escalar
              </button>
            )}
            {solicitud.puedo.resolver && (
              <>
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  disabled={Boolean(trabajando)}
                  onClick={rechazar}
                >
                  <Icon name="x-circle" />{" "}
                  {trabajando === "rechazar" ? "Rechazando…" : "Rechazar"}
                </button>
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  disabled={Boolean(trabajando)}
                  onClick={aprobar}
                >
                  <Icon name="check-circle" />{" "}
                  {trabajando === "aprobar" ? "Aprobando…" : "Aprobar"}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <Ventana
      titulo={
        solicitud
          ? `${solicitud.flujo} · ${solicitud.solicitante.nombre}`
          : "Solicitud de permiso"
      }
      onCerrar={onCerrar}
      ancha
      clase="solicitud-ventana"
      pie={pie}
    >
      {/* Mientras llegan los datos, la ventana no queda en blanco; si no
          llegan, se puede reintentar. */}
      {!solicitud && (
        <EstadoDeCarga
          cargando={!errorCarga}
          error={errorCarga}
          onReintentar={cargar}
        />
      )}
      {solicitud && (
        <div className="mz-stack">
          {hecho && (
            <div
              className="mz-alert mz-alert--ok"
              role="status"
              ref={avisoHecho}
              tabIndex={-1}
            >
              <Icon name="check-circle" />
              {hecho}
            </div>
          )}
          {!puedeActuar && error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {cancelaAprobada && (
            <div className="mz-alert mz-alert--warn" role="note">
              <Icon name="exclamation-triangle" />
              <span>
                Esta solicitud ya está aprobada. Si la cancela:{" "}
                {consecuenciaDeCancelar(solicitud).futuro} Debe explicar por qué
                en el comentario.
              </span>
            </div>
          )}
          {solicitud.estado === "pendiente" &&
            (solicitud.puedo.resolver ? (
              <div className="mz-alert mz-alert--info" role="note">
                <Icon name="hand-index-thumb" />
                <span>
                  <strong>Le toca decidir a usted</strong> (paso «
                  {solicitud.paso_actual}»).
                </span>
              </div>
            ) : (
              <p className="solicitud-espera mb-0">
                <Icon name="hourglass-split" /> En el paso «
                {solicitud.paso_actual}», esperando a{" "}
                <strong>
                  {solicitud.pendiente_de.map((p) => p.nombre).join(", ")}
                </strong>
                .
              </p>
            ))}

          <div className="solicitud-cabecera">
            <dl className="solicitud-datos">
              <div>
                <dt>Solicitante</dt>
                <dd>
                  <strong>{solicitud.solicitante.nombre}</strong>
                  {(solicitud.cargo || solicitud.area) && (
                    <small>
                      {[solicitud.cargo, solicitud.area]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  )}
                </dd>
              </div>
              <div>
                <dt>{porHoras ? "Fecha" : "Fechas"}</dt>
                <dd>
                  {fechas(solicitud.desde, solicitud.hasta, formatearFecha)}
                </dd>
              </div>
              {porHoras ? (
                <>
                  {/* Sin horario (datos incompletos), no se muestra « a ». */}
                  {horas && (
                    <div>
                      <dt>Horario</dt>
                      <dd>{horas}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Duración</dt>
                    <dd>{duracionDeSolicitud(solicitud)}</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt>Días</dt>
                  <dd>{solicitud.dias}</dd>
                </div>
              )}
              {DESCUENTOS[solicitud.descuento] && (
                <div>
                  <dt>Descuento</dt>
                  <dd>{DESCUENTOS[solicitud.descuento]}</dd>
                </div>
              )}
              <div>
                <dt>Solicitada el</dt>
                <dd>{formatearFecha(solicitud.created_at, true)}</dd>
              </div>
              {solicitud.cerrada_en && (
                <div>
                  <dt>Cerrada el</dt>
                  <dd>{formatearFecha(solicitud.cerrada_en, true)}</dd>
                </div>
              )}
            </dl>
            <span className={`mz-pill ${clase}`}>{estado}</span>
          </div>

          {solicitud.evaluacion?.reglas?.length > 0 && (
            <RestriccionesDelPermiso
              evaluacion={solicitud.evaluacion}
              titulo="Para decidir: saldo y restricciones"
            />
          )}

          <CalendarioSolicitado
            desde={solicitud.desde}
            hasta={solicitud.hasta}
            feriados={solicitud.feriados}
          />

          {solicitud.motivo && (
            <section aria-labelledby="sp-detalle-motivo">
              <h4 id="sp-detalle-motivo" className="solicitud-seccion">
                Motivo
              </h4>
              <p className="mb-0">{solicitud.motivo}</p>
            </section>
          )}
          {solicitud.tiene_adjunto && (
            <section aria-labelledby="sp-detalle-adjunto">
              <h4 id="sp-detalle-adjunto" className="solicitud-seccion">
                Documento de respaldo
              </h4>
              <button
                type="button"
                className="btn btn-link btn-sm px-0"
                onClick={verAdjunto}
                disabled={descargando}
              >
                <Icon name="paperclip" />{" "}
                {descargando ? "Descargando…" : solicitud.adjunto_nombre}
              </button>
            </section>
          )}

          <section aria-labelledby="sp-historial">
            <h4 id="sp-historial" className="solicitud-seccion">
              Historial
            </h4>
            <ol className="solicitud-historial" aria-labelledby="sp-historial">
              {solicitud.acciones.map((a) => (
                <li key={a.id} className={`solicitud-historial__${a.accion}`}>
                  <span className="mz-faint mz-small">
                    {formatearFecha(a.created_at, true)}
                  </span>
                  <span>{textoDeAccion(a)}</span>
                  {a.comentario && (
                    <blockquote className="solicitud-historial__comentario">
                      «{a.comentario}»
                    </blockquote>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Ventana>
  );
}

const DESTINO_VACIO = {
  tipo: "persona",
  usuario: null,
  rol: null,
  cargo: null,
};

/** El nombre accesible de una solicitud en la lista. */
function nombreDeSolicitud(s) {
  const horas = s.unidad === "horas" ? horario(s.hora_desde, s.hora_hasta) : "";
  return `${s.flujo} de ${s.solicitante.nombre}, ${fechas(
    s.desde,
    s.hasta,
    formatearFecha,
  )}${horas ? `, de ${horas}` : ""}`;
}

const PESTANAS = [
  { id: "mias", etiqueta: "Mis solicitudes" },
  { id: "por_aprobar", etiqueta: "Por aprobar", unidad: "por aprobar" },
  { id: "todas", etiqueta: "Todas" },
];

/**
 * Institucional → Solicitud de permisos: pedir un permiso (vacaciones,
 * permiso médico…) y seguirlo; aprobar, rechazar o escalar lo que a uno le
 * toca. Con `licencias.ver_todas`, todas las solicitudes de la empresa; con
 * `licencias.configurar`, el botón para configurar los tipos de permiso.
 */
export function SolicitudPermisosPage() {
  const verTodas = usePermission("licencias.ver_todas");
  const configura = usePermission("licencias.configurar");
  const [parametros, setParametros] = useSearchParams();
  const [pestana, setPestana] = useState("mias");
  const [lista, setLista] = useState(null);
  const [porAprobar, setPorAprobar] = useState(0);
  // `?nueva=vacaciones` (desde Mis vacaciones) abre la solicitud de una vez.
  const [nueva, setNueva] = useState(() => parametros.get("nueva") || false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [puedeSolicitar, setPuedeSolicitar] = useState(true);
  const abierta = parametros.get("solicitud");

  const cargar = useCallback(() => {
    // Se vacía antes de pedir: así se ve «Cargando…» y no las filas de la
    // pestaña anterior con sus columnas corridas, ni el error viejo
    // (auditoría UX/UI, fase 2, 28/10/2026).
    setLista(null);
    setError(null);
    licenciasService
      .solicitudes(pestana)
      .then(setLista)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar las solicitudes.")),
      );
    licenciasService
      .resumen()
      .then((r) => {
        setPorAprobar(r.por_aprobar);
        setPuedeSolicitar(r.puede_solicitar !== false);
      })
      .catch(() => null);
  }, [pestana]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const pestanas = PESTANAS.filter((p) => p.id !== "todas" || verTodas).map(
    (p) => (p.id === "por_aprobar" ? { ...p, cuenta: porAprobar } : p),
  );

  function abrir(id) {
    setParametros(id ? { solicitud: String(id) } : {});
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Solicitud de permisos</h2>
          <p className="mz-desc">
            Pida un permiso y siga su aprobación; apruebe, rechace o escale los
            que le toquen.
          </p>
        </div>
        <div className="mz-actions">
          {configura && (
            <Link
              to="/admin/institucional/permisos/flujos"
              className="btn btn-outline-secondary btn-sm"
            >
              <Icon name="diagram-2" /> Tipos de permiso
            </Link>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setNueva(true)}
            disabled={!puedeSolicitar}
          >
            <Icon name="plus-lg" /> Nueva solicitud
          </button>
        </div>
      </div>
      {!puedeSolicitar && (
        <div className="mz-alert mz-alert--warn" role="note">
          <Icon name="person-lock" />
          Su cuenta no tiene un rol asignado, así que no puede solicitar
          permisos. Pida a quien administra los usuarios que le asigne uno.
        </div>
      )}

      <Pestanas
        etiqueta="Solicitudes de permiso"
        idBase="sp"
        valor={pestana}
        onCambio={setPestana}
        opciones={pestanas}
      />

      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check-circle" />
          {aviso}
        </div>
      )}

      <PanelDePestana idBase="sp" valor={pestana}>
        <div className="mz-table-wrap mz-table-wrap--con-tarjetas">
          <table className="mz-table solicitudes-tabla">
            <thead>
              <tr>
                <th>Permiso</th>
                {pestana !== "mias" && <th>Solicitante</th>}
                <th>Fechas</th>
                <th className="num">Duración</th>
                <th>Estado</th>
                <th>Paso / pendiente de</th>
                <th>Solicitada</th>
              </tr>
            </thead>
            <tbody>
              {(lista ?? []).map((s) => {
                const [estado, clase] = ESTADOS[s.estado] ?? ["", ""];
                const horas =
                  s.unidad === "horas"
                    ? horario(s.hora_desde, s.hora_hasta)
                    : "";
                return (
                  <tr key={s.id}>
                    <td>
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0"
                        onClick={() => abrir(s.id)}
                        aria-label={nombreDeSolicitud(s)}
                      >
                        {s.flujo}
                      </button>
                      {DESCUENTOS[s.descuento] && (
                        <small className="solicitudes-tabla__descuento">
                          {DESCUENTOS[s.descuento]}
                        </small>
                      )}
                    </td>
                    {pestana !== "mias" && <td>{s.solicitante.nombre}</td>}
                    <td>
                      {fechas(s.desde, s.hasta, formatearFecha)}
                      {horas && (
                        <small className="solicitudes-tabla__horario">
                          {horas}
                        </small>
                      )}
                    </td>
                    <td className="num">{duracionDeSolicitud(s)}</td>
                    <td>
                      <span className={`mz-pill ${clase}`}>{estado}</span>
                    </td>
                    <td className="mz-small">
                      {s.estado === "pendiente"
                        ? `${s.paso_actual} · ${s.pendiente_de.map((p) => p.nombre).join(", ")}`
                        : "—"}
                    </td>
                    <td className="mz-small">
                      {formatearFecha(s.created_at, true)}
                    </td>
                  </tr>
                );
              })}
              <FilaDeEstado
                columnas={pestana === "mias" ? 6 : 7}
                cargando={lista === null}
                error={error}
                onReintentar={cargar}
                vacio={lista?.length === 0}
                textoVacio={
                  pestana === "por_aprobar"
                    ? "No tiene solicitudes por aprobar."
                    : "No hay solicitudes."
                }
              />
            </tbody>
          </table>
        </div>
        {/* En el teléfono, la misma lista en tarjetas. */}
        <div className="mz-cards">
          <EstadoDeCarga
            cargando={lista === null}
            error={error}
            onReintentar={cargar}
            vacio={lista?.length === 0}
            textoVacio={
              pestana === "por_aprobar"
                ? "No tiene solicitudes por aprobar."
                : "No hay solicitudes."
            }
          />
          {!error && lista?.length > 0 && (
            <ul className="mz-cards-lista" aria-label="Solicitudes de permiso">
              {lista.map((s) => {
                const [estado, clase] = ESTADOS[s.estado] ?? ["", ""];
                const horas =
                  s.unidad === "horas"
                    ? horario(s.hora_desde, s.hora_hasta)
                    : "";
                return (
                  <li key={s.id} className="mz-card-row">
                    <div className="mz-row-between">
                      <button
                        type="button"
                        className="btn btn-link p-0 mz-card-row__titulo solicitud-tarjeta__abrir"
                        onClick={() => abrir(s.id)}
                        aria-label={nombreDeSolicitud(s)}
                      >
                        {s.flujo}
                      </button>
                      <span className={`mz-pill ${clase}`}>{estado}</span>
                    </div>
                    <div className="mz-card-meta">
                      {pestana !== "mias" && (
                        <span>{s.solicitante.nombre}</span>
                      )}
                      <span>
                        {fechas(s.desde, s.hasta, formatearFecha)}
                        {horas ? `, ${horas}` : ""}
                      </span>
                      <span>{duracionDeSolicitud(s)}</span>
                      {DESCUENTOS[s.descuento] && (
                        <span>{DESCUENTOS[s.descuento]}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PanelDePestana>

      {/* `?nueva=` solo abre la solicitud si la cuenta puede solicitar. */}
      {nueva && puedeSolicitar && (
        <NuevaSolicitud
          deVacaciones={nueva === "vacaciones"}
          onCerrar={() => {
            setNueva(false);
            // Sin el parámetro: al recargar no se vuelve a abrir.
            if (parametros.get("nueva")) setParametros({});
          }}
          onCreada={(s) => {
            setNueva(false);
            if (parametros.get("nueva")) setParametros({});
            setAviso(
              `Solicitud enviada: queda pendiente de ${s.pendiente_de
                .map((p) => p.nombre)
                .join(", ")}.`,
            );
            setPestana("mias");
            cargar();
          }}
        />
      )}
      {abierta && (
        <DetalleSolicitud
          id={abierta}
          onCambio={cargar}
          onCerrar={() => abrir(null)}
        />
      )}
    </div>
  );
}
