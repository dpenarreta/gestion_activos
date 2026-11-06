/*
 * El detalle de una idea (`IdeaDetailModal` de Nexo, aquí como página: los
 * avisos de la campana enlazan a `mejora-continua/<id>`). Descripción,
 * adjunto (PDF e imagen en el visor interno; Word y Excel se descargan), voto
 * e historial de etapas. Quien gestiona mueve la idea con los botones que el
 * servidor acepta desde la etapa actual (`allowed_actions`) y fija su avance.
 *
 * Cada cambio de etapa manda la etapa que se está viendo (`expected_status`):
 * si otra persona ya la movió, el servidor responde 409; se avisa y se
 * recarga la idea, sin moverla dos veces.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import {
  errorDeMejora,
  mejoraContinuaService,
} from "../../../api/mejoraContinuaService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { fijarTituloPropio } from "../../../utils/tituloDocumento";
import { useVisorDeAdjuntos } from "../../Soporte/VisorAdjunto";
import { Aviso, ErrorEnLinea, fechaHora } from "../comunes";
import { Encabezado } from "../Tareas/ContextoTareas";
import { ConAccesoMejora, useMejoraContinua } from "./ContextoMejoraContinua";
import {
  COMENTARIO_MAX,
  RUTA_MEJORA,
  etapaAnterior,
  etapaSiguiente,
  tamano,
  textoDeEtapa,
} from "./mejoraComunes";
import {
  Autor,
  BarraDeAvance,
  BotonVoto,
  PildoraEtapa,
  PildoraImpacto,
} from "./Piezas";

export function DetalleIdea() {
  return (
    <ConAccesoMejora titulo="Idea de mejora">
      <PantallaDetalle />
    </ConAccesoMejora>
  );
}

/** Como Proyectos e Informes: un enlace sobre el título. Vuelve al tablero
 * con la pestaña y los filtros que tenía (`volverA`, la query del tablero) y
 * le dice de qué idea se viene, para devolverle el foco. */
function Volver({ id }) {
  const location = useLocation();
  const volverA = location.state?.volverA ?? "";
  return (
    <div>
      <Link
        to={`${RUTA_MEJORA}${volverA}`}
        state={id ? { desde: id } : undefined}
        className="btn btn-link px-0"
      >
        <Icon name="arrow-left" /> Volver a Mejora continua
      </Link>
    </div>
  );
}

function PantallaDetalle() {
  const { ideaId } = useParams();
  const { puedeVotar } = useMejoraContinua();
  const [idea, setIdea] = useState(null);
  const [carga, setCarga] = useState({ error: null, noEncontrada: false });
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(() => {
    setCarga({ error: null, noEncontrada: false });
    return mejoraContinuaService
      .obtener(ideaId)
      .then((datos) => setIdea(datos))
      .catch((err) => {
        const e = errorDeMejora(err, "No se pudo abrir la idea.");
        setIdea(null);
        setCarga({ error: e.mensaje, noEncontrada: e.estado === 404 });
      });
  }, [ideaId]);

  useEffect(() => {
    setIdea(null);
    cargar();
  }, [cargar]);

  const titulo = idea?.title ? `Idea: ${idea.title}` : null;
  useEffect(() => {
    if (!titulo) return undefined;
    fijarTituloPropio(titulo);
    return () => fijarTituloPropio(null);
  }, [titulo]);

  if (!idea) {
    return (
      <div className="gh-page">
        <Volver />
        <Encabezado titulo="Idea de mejora" />
        {carga.noEncontrada ? (
          <div className="mz-alert mz-alert--warn" role="alert">
            <Icon name="search" />
            <span>No se encontró la idea o no tiene acceso a ella.</span>
          </div>
        ) : (
          <EstadoDeCarga
            cargando={!carga.error}
            error={carga.error}
            onReintentar={cargar}
          />
        )}
      </div>
    );
  }

  const conAvance =
    idea.status === "EN_DESARROLLO" ||
    idea.status === "EN_PRUEBAS" ||
    idea.progress > 0;

  return (
    <div className="gh-page">
      <Volver id={idea.id} />
      <Encabezado
        titulo={idea.title}
        descripcion={`Propuesta el ${fechaHora(idea.created_at)}`}
      />

      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      {/* Resumen, gestión e historial en ese orden: en el teléfono (una
          columna) la gestión queda antes del historial; en escritorio va a
          la derecha (`grid-template-areas`). */}
      <div
        className={`mc-detalle${idea.can_manage ? "" : " mc-detalle--sin-gestion"}`}
      >
        <section
          className="mz-card mc-detalle__resumen"
          aria-labelledby="mc-idea-resumen"
        >
          <div className="mz-card-head">
            <h3 id="mc-idea-resumen">Resumen</h3>
            <BotonVoto
              idea={idea}
              puedeVotar={idea.can_vote ?? puedeVotar}
              onCambio={(voto) => setIdea((i) => ({ ...i, ...voto }))}
              onError={(texto) => setAviso({ tono: "bad", texto })}
            />
          </div>
          <div className="mz-card-body mz-stack">
            <dl className="mc-datos">
              <div>
                <dt>Etapa</dt>
                <dd>
                  <PildoraEtapa
                    status={idea.status}
                    texto={idea.status_label}
                  />
                </dd>
              </div>
              <div>
                <dt>Impacto</dt>
                <dd>
                  <PildoraImpacto
                    impact={idea.impact}
                    texto={idea.impact_label}
                  />
                </dd>
              </div>
              <div>
                <dt>Autor</dt>
                <dd>
                  <Autor autor={idea.author} conRol />
                </dd>
              </div>
            </dl>
            {conAvance && <BarraDeAvance valor={idea.progress} />}
            {idea.status === "RECHAZADA" && idea.latest_rejection_comment && (
              <div className="mz-alert mz-alert--bad mb-0">
                <Icon name="x-octagon" />
                <span>
                  <span className="mz-strong">Motivo del rechazo:</span>{" "}
                  {idea.latest_rejection_comment}
                </span>
              </div>
            )}
            <div>
              <h4 className="mc-subtitulo">Descripción</h4>
              <p className="mc-descripcion">{idea.description}</p>
            </div>
            {idea.attachment && <Adjunto adjunto={idea.attachment} />}
          </div>
        </section>

        {idea.can_manage && (
          <aside className="mc-detalle__lateral">
            <Gestion
              idea={idea}
              onActualizada={(nueva, texto) => {
                setIdea(nueva);
                setAviso({ texto });
              }}
              onConflicto={(texto) => {
                setAviso({ tono: "warn", texto });
                cargar();
              }}
            />
          </aside>
        )}

        <Historial historial={idea.history ?? []} />
      </div>
    </div>
  );
}

/** El adjunto: PDF e imagen se ven dentro del sistema; Word y Excel, que el
 * navegador no dibuja, se descargan (`?download=1`). */
function Adjunto({ adjunto }) {
  const { abrir, abriendo, visor, error } = useVisorDeAdjuntos();
  const adentro = Boolean(adjunto.viewer);
  const url = adentro ? adjunto.url : `${adjunto.url}?download=1`;
  return (
    <div>
      <h4 className="mc-subtitulo">Adjunto</h4>
      <div className="mc-archivo">
        <Icon name={adentro ? "file-earmark-richtext" : "file-earmark"} />
        <span className="mc-archivo__nombre">
          {adjunto.name}
          {adjunto.size ? (
            <span className="mz-faint"> ({tamano(adjunto.size)})</span>
          ) : null}
        </span>
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          disabled={abriendo === "adjunto"}
          onClick={() => abrir({ id: "adjunto", url, nombre: adjunto.name })}
        >
          <Icon name={adentro ? "eye" : "download"} />{" "}
          {abriendo === "adjunto" ? "Abriendo…" : adentro ? "Ver" : "Descargar"}
          <span className="visually-hidden"> {adjunto.name}</span>
        </button>
      </div>
      <ErrorEnLinea mensaje={error} className="mt-2" />
      {visor}
    </div>
  );
}

function Historial({ historial }) {
  return (
    <section
      className="mz-card mc-detalle__historial"
      aria-labelledby="mc-idea-historial"
    >
      <div className="mz-card-head">
        <h3 id="mc-idea-historial">Historial de etapas</h3>
      </div>
      <div className="mz-card-body">
        {historial.length === 0 ? (
          <p className="mz-small mz-faint mb-0">
            Todavía no ha cambiado de etapa.
          </p>
        ) : (
          <ol className="mc-historial">
            {historial.map((h) => (
              <li key={h.id ?? h.created_at}>
                <p className="mb-1">
                  <span className="mz-strong">
                    {h.from_status_label || textoDeEtapa(h.from_status)}
                  </span>{" "}
                  <Icon name="arrow-right" />
                  <span className="visually-hidden"> a </span>{" "}
                  <span className="mz-strong">
                    {h.to_status_label || textoDeEtapa(h.to_status)}
                  </span>
                </p>
                <p className="mz-small mz-faint mb-0">
                  {fechaHora(h.created_at)}
                  {h.changer
                    ? ` · ${h.changer.full_name || h.changer.name}`
                    : ""}
                </p>
                {h.comment && <p className="mz-small mb-0 mt-1">{h.comment}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

const TEXTO_ACCION = {
  ADVANCE: (idea) => `Avanzar a «${textoDeEtapa(etapaSiguiente(idea.status))}»`,
  RETREAT: (idea) =>
    `Retroceder a «${textoDeEtapa(etapaAnterior(idea.status))}»`,
  REJECT: () => "Rechazar",
  REOPEN: () => "Reabrir (vuelve a «En revisión»)",
};

const ICONO_ACCION = {
  ADVANCE: "arrow-right-circle",
  RETREAT: "arrow-left-circle",
  REJECT: "x-octagon",
  REOPEN: "arrow-counterclockwise",
};

/** Lo de quien gestiona: mover de etapa y fijar el avance. */
function Gestion({ idea, onActualizada, onConflicto }) {
  const base = useId();
  const idMotivo = `${base}-motivo`;
  const idAvance = `${base}-avance`;
  const [enviando, setEnviando] = useState(null);
  const enCurso = useRef(false);
  const [error, setError] = useState(null);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [errorMotivo, setErrorMotivo] = useState(null);
  const [avance, setAvance] = useState(String(idea.progress ?? 0));
  const [errorAvance, setErrorAvance] = useState(null);
  const campoMotivo = useRef(null);
  const botonRechazar = useRef(null);
  const campoAvance = useRef(null);
  // El avance solo tiene sentido mientras se construye y se prueba.
  const avanceEditable =
    idea.status === "EN_DESARROLLO" || idea.status === "EN_PRUEBAS";

  // Si la idea cambia (otra acción o la recarga tras un 409), el control de
  // avance parte del valor del servidor.
  useEffect(() => {
    setAvance(String(idea.progress ?? 0));
  }, [idea.progress]);

  useEffect(() => {
    if (rechazando) campoMotivo.current?.focus();
  }, [rechazando]);

  /** Cierra el motivo sin rechazar; el foco vuelve a «Rechazar» (si no,
   * caía en <main> al desaparecer el formulario). */
  function cancelarRechazo() {
    setRechazando(false);
    setMotivo("");
    setErrorMotivo(null);
    requestAnimationFrame(() => botonRechazar.current?.focus());
  }

  async function mover(action, comment) {
    if (enCurso.current) return;
    enCurso.current = true;
    setEnviando(action);
    setError(null);
    try {
      const nueva = await mejoraContinuaService.cambiarEtapa(idea.id, {
        action,
        comment,
        expectedStatus: idea.status,
      });
      setRechazando(false);
      setMotivo("");
      onActualizada(
        nueva,
        `La idea pasó a «${nueva.status_label || textoDeEtapa(nueva.status)}».`,
      );
    } catch (err) {
      const e = errorDeMejora(err, "No se pudo cambiar la etapa.");
      if (e.estado === 409 || e.codigo === "conflict") {
        setRechazando(false);
        onConflicto(
          `${e.mensaje} Se recargó la idea con su etapa actual: revise antes de volver a moverla.`,
        );
      } else if (e.campos.comment) {
        setErrorMotivo(e.campos.comment);
        campoMotivo.current?.focus();
      } else {
        setError(e.mensaje);
      }
    } finally {
      enCurso.current = false;
      setEnviando(null);
    }
  }

  function confirmarRechazo(evento) {
    evento.preventDefault();
    if (!motivo.trim()) {
      setErrorMotivo("El motivo del rechazo es obligatorio.");
      campoMotivo.current?.focus();
      return;
    }
    mover("REJECT", motivo.trim());
  }

  async function guardarAvance(evento) {
    evento.preventDefault();
    const n = Number(avance);
    if (avance === "" || !Number.isInteger(n) || n < 0 || n > 100) {
      setErrorAvance("El avance debe ser un número entero entre 0 y 100.");
      campoAvance.current?.focus();
      return;
    }
    if (enCurso.current) return;
    enCurso.current = true;
    setEnviando("PROGRESS");
    setErrorAvance(null);
    try {
      const nueva = await mejoraContinuaService.actualizarAvance(idea.id, n);
      onActualizada(nueva, `Avance actualizado a ${nueva.progress}%.`);
    } catch (err) {
      const e = errorDeMejora(err, "No se pudo guardar el avance.");
      setErrorAvance(e.campos.progress || e.mensaje);
      campoAvance.current?.focus();
    } finally {
      enCurso.current = false;
      setEnviando(null);
    }
  }

  const acciones = idea.allowed_actions ?? [];
  const ocupado = enviando !== null;

  return (
    <section className="mz-card" aria-labelledby="mc-idea-gestion">
      <div className="mz-card-head">
        <h3 id="mc-idea-gestion">Gestionar la idea</h3>
      </div>
      <div className="mz-card-body mz-stack">
        <ErrorEnLinea mensaje={error} />
        <div>
          <h4 className="mc-subtitulo">Etapa</h4>
          {acciones.length === 0 ? (
            <p className="mz-small mz-faint mb-0">
              {idea.status === "IMPLEMENTADA"
                ? "Implementada: es la etapa final y ya no se mueve."
                : "Desde esta etapa no hay movimientos posibles."}
            </p>
          ) : (
            <div className="mc-acciones">
              {acciones
                .filter((a) => TEXTO_ACCION[a])
                .map((a) => (
                  <button
                    key={a}
                    ref={a === "REJECT" ? botonRechazar : undefined}
                    type="button"
                    className={`btn btn-sm ${
                      a === "REJECT"
                        ? "btn-outline-danger"
                        : a === "ADVANCE"
                          ? "btn-primary"
                          : "btn-outline-secondary"
                    }`}
                    // Con el motivo abierto, la única salida es confirmar o
                    // cancelar el rechazo.
                    disabled={ocupado || (rechazando && a !== "REJECT")}
                    aria-expanded={a === "REJECT" ? rechazando : undefined}
                    aria-controls={a === "REJECT" ? idMotivo : undefined}
                    onClick={() =>
                      a === "REJECT" ? setRechazando(true) : mover(a, null)
                    }
                  >
                    <Icon name={ICONO_ACCION[a]} />{" "}
                    {enviando === a ? "Guardando…" : TEXTO_ACCION[a](idea)}
                  </button>
                ))}
            </div>
          )}
          {rechazando && (
            // Escape dentro del motivo cancela el rechazo (y no cierra nada
            // más: no hay ventana).
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
            <form
              className="mc-rechazo"
              onSubmit={confirmarRechazo}
              noValidate
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelarRechazo();
                }
              }}
            >
              <label htmlFor={idMotivo} className="form-label">
                Motivo del rechazo{" "}
                <span className="visually-hidden">(obligatorio)</span>
                <span aria-hidden="true">*</span>
              </label>
              <textarea
                ref={campoMotivo}
                id={idMotivo}
                className={`form-control${errorMotivo ? " is-invalid" : ""}`}
                rows={3}
                maxLength={COMENTARIO_MAX}
                value={motivo}
                aria-required="true"
                aria-invalid={errorMotivo ? true : undefined}
                aria-describedby={`${idMotivo}-cuenta ${
                  errorMotivo ? `${idMotivo}-error` : `${idMotivo}-ayuda`
                }`}
                onChange={(e) => {
                  setMotivo(e.target.value);
                  setErrorMotivo(null);
                }}
              />
              <p id={`${idMotivo}-cuenta`} className="form-text mb-0">
                {motivo.length} de {COMENTARIO_MAX} caracteres.
              </p>
              {errorMotivo ? (
                <p id={`${idMotivo}-error`} className="mz-field-error mb-0">
                  {errorMotivo}
                </p>
              ) : (
                <p id={`${idMotivo}-ayuda`} className="form-text mb-0">
                  Quien propuso la idea lo verá en su aviso.
                </p>
              )}
              <div className="mc-acciones">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={ocupado}
                  onClick={cancelarRechazo}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-danger btn-sm"
                  disabled={ocupado}
                >
                  {enviando === "REJECT" ? "Rechazando…" : "Confirmar rechazo"}
                </button>
              </div>
            </form>
          )}
        </div>

        {avanceEditable ? (
          <form className="mc-avance-form" onSubmit={guardarAvance} noValidate>
            <label htmlFor={idAvance} className="form-label mc-subtitulo">
              Avance (%)
            </label>
            <div className="mc-avance-form__fila">
              <input
                ref={campoAvance}
                id={idAvance}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                className={`form-control${errorAvance ? " is-invalid" : ""}`}
                value={avance}
                aria-invalid={errorAvance ? true : undefined}
                aria-describedby={errorAvance ? `${idAvance}-error` : undefined}
                onChange={(e) => {
                  setAvance(e.target.value);
                  setErrorAvance(null);
                }}
              />
              <button
                type="submit"
                className="btn btn-outline-primary btn-sm"
                disabled={ocupado || Number(avance) === idea.progress}
              >
                {enviando === "PROGRESS" ? "Guardando…" : "Guardar avance"}
              </button>
            </div>
            {errorAvance && (
              <p id={`${idAvance}-error`} className="mz-field-error mb-0">
                {errorAvance}
              </p>
            )}
          </form>
        ) : (
          <p className="mz-small mz-faint mb-0">
            El avance se registra mientras la idea está en desarrollo o en
            pruebas.
          </p>
        )}
      </div>
    </section>
  );
}
