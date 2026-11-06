/*
 * El detalle de una reunión (página: los avisos de la campana enlazan a
 * `reuniones/<id>`). Fecha, duración, anfitrión, descripción, «Unirse» (en
 * otra pestaña), la clave con «Copiar», los invitados y su asistencia, el
 * estado y lo de Otter (el resumen y el enlace a la transcripción, que el
 * anfitrión llena a mano al terminar).
 *
 * Quien puede editarla (el anfitrión o quien administra: `can_edit`) marca la
 * asistencia, cambia el estado, completa lo de Otter, la edita y la elimina
 * (con confirmación). Los demás la ven sin controles. El servidor vuelve a
 * autorizar cada cambio.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import {
  errorDeReuniones,
  reunionesService,
} from "../../../api/reunionesService";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { fijarTituloPropio } from "../../../utils/tituloDocumento";
import { Aviso, ErrorEnLinea } from "../comunes";
import { Encabezado } from "../Tareas/ContextoTareas";
import { ConAccesoReuniones, useReuniones } from "./ContextoReuniones";
import { FormularioReunion } from "./FormularioReunion";
import {
  BotonUnirse,
  EnlaceExterno,
  PildoraEstado,
  PildoraMomento,
  PildoraSinCerrar,
} from "./Piezas";
import {
  RUTA_REUNIONES,
  dominioDe,
  duracionEnTexto,
  esEnlaceSeguro,
  horario,
  nombreDe,
  problemaDelEnlace,
} from "./reunionesComunes";

export function DetalleReunion() {
  return (
    <ConAccesoReuniones titulo="Reunión">
      <PantallaDetalle />
    </ConAccesoReuniones>
  );
}

/** Como Mejora continua: un enlace sobre el título que vuelve al listado con
 * la pestaña y los filtros que tenía y le dice de qué reunión se viene, para
 * devolverle el foco. */
function Volver({ id }) {
  const location = useLocation();
  const volverA = location.state?.volverA ?? "";
  return (
    <div>
      <Link
        to={`${RUTA_REUNIONES}${volverA}`}
        state={id ? { desde: id } : undefined}
        className="btn btn-link px-0"
      >
        <Icon name="arrow-left" /> Volver a Reuniones
      </Link>
    </div>
  );
}

function PantallaDetalle() {
  const { reunionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [reunion, setReunion] = useState(null);
  const [carga, setCarga] = useState({ error: null, noEncontrada: false });
  const [aviso, setAviso] = useState(null);
  const [editando, setEditando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  const cargar = useCallback(() => {
    setCarga({ error: null, noEncontrada: false });
    return reunionesService
      .obtener(reunionId)
      .then((datos) => setReunion(datos))
      .catch((err) => {
        const e = errorDeReuniones(err, "No se pudo abrir la reunión.");
        setReunion(null);
        setCarga({ error: e.mensaje, noEncontrada: e.estado === 404 });
      });
  }, [reunionId]);

  useEffect(() => {
    setReunion(null);
    cargar();
  }, [cargar]);

  const titulo = reunion?.title ? `Reunión: ${reunion.title}` : null;
  useEffect(() => {
    if (!titulo) return undefined;
    fijarTituloPropio(titulo);
    return () => fijarTituloPropio(null);
  }, [titulo]);

  async function eliminar() {
    const si = await confirmar({
      titulo: `¿Eliminar la reunión «${reunion.title}»?`,
      mensaje:
        "Deja de verse para todos y a los invitados les llega el aviso de la cancelación.",
      accion: "Eliminar reunión",
    });
    if (!si) return;
    setEliminando(true);
    try {
      await reunionesService.eliminar(reunion.id);
      navigate(`${RUTA_REUNIONES}${location.state?.volverA ?? ""}`, {
        state: {
          aviso: {
            texto: `Reunión «${reunion.title}» eliminada. Se avisó a los invitados.`,
          },
        },
      });
    } catch (err) {
      setAviso({
        tono: "bad",
        texto: errorDeReuniones(err, "No se pudo eliminar la reunión.").mensaje,
      });
      setEliminando(false);
    }
  }

  if (!reunion) {
    return (
      <div className="gh-page">
        <Volver />
        <Encabezado titulo="Reunión" />
        {carga.noEncontrada ? (
          <div className="mz-alert mz-alert--warn" role="alert">
            <Icon name="search" />
            <span>
              No se encontró la reunión: es posible que la hayan eliminado o que
              no esté invitado.
            </span>
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

  const actualizar = (nueva, texto) => {
    setReunion(nueva);
    if (texto) setAviso({ texto });
  };

  return (
    <div className="gh-page">
      <Volver id={reunion.id} />
      <Encabezado titulo={reunion.title} descripcion={horario(reunion)}>
        <BotonUnirse reunion={reunion} />
        {reunion.can_edit && (
          <>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setEditando(true)}
              disabled={eliminando}
            >
              <Icon name="pencil" /> Editar
            </button>
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={eliminar}
              disabled={eliminando}
            >
              <Icon name="trash" /> {eliminando ? "Eliminando…" : "Eliminar"}
            </button>
          </>
        )}
      </Encabezado>

      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      <div className="re-detalle">
        <div className="re-detalle__principal">
          <Resumen reunion={reunion} />
          <Invitados
            reunion={reunion}
            onActualizada={(nueva) => actualizar(nueva, "Asistencia guardada.")}
          />
        </div>
        <div className="re-detalle__lateral">
          <Acceso reunion={reunion} />
          <Estado
            reunion={reunion}
            onActualizada={(nueva) =>
              actualizar(
                nueva,
                `La reunión quedó «${nueva.status_label || nueva.status}».`,
              )
            }
          />
          <Otter
            reunion={reunion}
            onActualizada={(nueva) =>
              actualizar(nueva, "Resumen de la reunión guardado.")
            }
          />
        </div>
      </div>

      {editando && (
        <FormularioReunion
          reunion={reunion}
          onCerrar={() => setEditando(false)}
          onGuardada={(nueva) => {
            setEditando(false);
            actualizar(nueva, "Cambios guardados.");
          }}
        />
      )}
    </div>
  );
}

function Resumen({ reunion }) {
  return (
    <section className="mz-card" aria-labelledby="re-resumen">
      <div className="mz-card-head">
        <h3 id="re-resumen">Resumen</h3>
      </div>
      <div className="mz-card-body mz-stack">
        <dl className="re-datos">
          <div>
            <dt>Fecha y hora</dt>
            <dd>{horario(reunion)}</dd>
          </div>
          <div>
            <dt>Duración</dt>
            <dd>{duracionEnTexto(reunion.duration)}</dd>
          </div>
          <div>
            <dt>Organiza</dt>
            <dd>
              {nombreDe(reunion.host)}
              {reunion.host?.role_label && (
                <span className="mz-faint"> · {reunion.host.role_label}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd className="mz-pill-row">
              <PildoraEstado
                status={reunion.status}
                texto={reunion.status_label}
              />
              <PildoraMomento timing={reunion.timing} siempre />
              <PildoraSinCerrar reunion={reunion} />
            </dd>
          </div>
        </dl>
        <div>
          <h4 className="re-subtitulo">Descripción</h4>
          {reunion.description ? (
            <p className="re-texto">{reunion.description}</p>
          ) : (
            <p className="mz-small mz-faint mb-0">Sin descripción.</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** El enlace y la clave. La clave se copia con un botón; el resultado se
 * anuncia en una región viva siempre montada. */
function Acceso({ reunion }) {
  const [copiado, setCopiado] = useState("");
  const dominio = dominioDe(reunion.join_url);

  async function copiar(valor, que) {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(que === "Clave" ? "Clave copiada." : "Enlace copiado.");
    } catch {
      setCopiado(`No se pudo copiar: selecciónelo y cópielo a mano (Ctrl+C).`);
    }
  }

  return (
    <section className="mz-card" aria-labelledby="re-acceso">
      <div className="mz-card-head">
        <h3 id="re-acceso">Cómo entrar</h3>
      </div>
      <div className="mz-card-body mz-stack">
        {/* «Unirse» está en el encabezado: aquí, adónde lleva y cómo
            copiarlo (para pegarlo en la aplicación de escritorio). */}
        {dominio ? (
          <div>
            <h4 className="re-subtitulo">Enlace</h4>
            <p className="mb-1 re-dominio">
              <Icon name="lock-fill" /> {dominio}
            </p>
            <p className="mz-small mz-faint mb-2 re-enlace">
              {reunion.join_url}
            </p>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => copiar(reunion.join_url, "Enlace")}
            >
              <Icon name="link-45deg" /> Copiar enlace
            </button>
          </div>
        ) : (
          <p className="mz-small mz-faint mb-0">
            Quien organiza todavía no ha puesto el enlace.
          </p>
        )}
        {reunion.join_password && (
          <div>
            <h4 className="re-subtitulo">Clave de acceso</h4>
            <div className="re-clave">
              <code className="re-clave__valor">{reunion.join_password}</code>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => copiar(reunion.join_password, "Clave")}
              >
                <Icon name="clipboard" /> Copiar clave
              </button>
            </div>
          </div>
        )}
        {/* Siempre montado: el resultado de copiar se anuncia. */}
        <p className="mz-small mb-0" role="status">
          {copiado}
        </p>
      </div>
    </section>
  );
}

/** Los invitados y su asistencia. Quien puede editar la marca con una
 * casilla por persona y la guarda de una vez; los demás la ven en texto. */
function Invitados({ reunion, onActualizada }) {
  const invitados = reunion.invitees ?? [];
  const [marcas, setMarcas] = useState(() =>
    Object.fromEntries(invitados.map((i) => [i.user?.id, i.attended])),
  );
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const enCurso = useRef(false);

  // Si la reunión cambia (otra edición), las casillas parten del servidor.
  useEffect(() => {
    setMarcas(
      Object.fromEntries(
        (reunion.invitees ?? []).map((i) => [i.user?.id, i.attended]),
      ),
    );
  }, [reunion.invitees]);

  const cambios = invitados.filter(
    (i) => Boolean(marcas[i.user?.id]) !== Boolean(i.attended),
  );
  const asistieron = invitados.filter((i) => i.attended).length;

  async function guardar(evento) {
    evento.preventDefault();
    if (enCurso.current || cambios.length === 0) return;
    enCurso.current = true;
    setEnviando(true);
    setError(null);
    try {
      const nueva = await reunionesService.marcarAsistencia(
        reunion.id,
        cambios.map((i) => ({
          user_id: i.user.id,
          attended: Boolean(marcas[i.user.id]),
        })),
      );
      onActualizada(nueva);
    } catch (err) {
      setError(
        errorDeReuniones(err, "No se pudo guardar la asistencia.").mensaje,
      );
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <section className="mz-card" aria-labelledby="re-invitados">
      <div className="mz-card-head">
        <h3 id="re-invitados">Invitados</h3>
        <span className="mz-small mz-faint">
          {invitados.length === 0
            ? ""
            : `${asistieron} de ${invitados.length} asistieron`}
        </span>
      </div>
      <div className="mz-card-body mz-stack">
        <ErrorEnLinea mensaje={error} />
        {invitados.length === 0 ? (
          <p className="mz-small mz-faint mb-0">
            La reunión no tiene invitados.
          </p>
        ) : reunion.can_edit ? (
          <form onSubmit={guardar} noValidate className="mz-stack">
            <fieldset className="re-asistencia">
              <legend className="re-grupo__titulo">Marque quién asistió</legend>
              <ul className="re-personas">
                {invitados.map((i) => (
                  <li key={i.id}>
                    <label className="re-resultado">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={Boolean(marcas[i.user?.id])}
                        disabled={enviando}
                        onChange={(e) =>
                          setMarcas((m) => ({
                            ...m,
                            [i.user?.id]: e.target.checked,
                          }))
                        }
                      />
                      <span className="re-resultado__nombre">
                        {nombreDe(i.user)}
                        {i.user?.role_label && (
                          <span className="mz-faint">
                            {" "}
                            · {i.user.role_label}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <div className="re-acciones">
              <button
                type="submit"
                className="btn btn-outline-primary btn-sm"
                disabled={enviando || cambios.length === 0}
                aria-describedby={
                  cambios.length === 0 ? "re-asistencia-ayuda" : undefined
                }
              >
                {enviando ? "Guardando…" : "Guardar asistencia"}
              </button>
            </div>
            {/* Dice por qué el botón está deshabilitado. */}
            {cambios.length === 0 && (
              <p id="re-asistencia-ayuda" className="form-text mb-0">
                Marque o desmarque a alguien para guardar.
              </p>
            )}
          </form>
        ) : (
          <ul className="re-personas">
            {invitados.map((i) => (
              <li key={i.id} className="re-persona">
                <span className="re-resultado__nombre">{nombreDe(i.user)}</span>
                <span className="mz-small">
                  <Icon name={i.attended ? "check2-circle" : "dash-circle"} />{" "}
                  {i.attended ? "Asistió" : "Sin marcar"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** El estado lo cambia a mano quien puede editar (como en Nexo: no se mueve
 * solo por la hora). Tres botones; el actual va marcado (`aria-pressed`). */
function Estado({ reunion, onActualizada }) {
  const { estados } = useReuniones();
  const [enviando, setEnviando] = useState(null);
  const [error, setError] = useState(null);
  const enCurso = useRef(false);
  if (!reunion.can_edit) return null;

  async function cambiar(status) {
    if (enCurso.current || status === reunion.status) return;
    enCurso.current = true;
    setEnviando(status);
    setError(null);
    try {
      onActualizada(await reunionesService.editar(reunion.id, { status }));
    } catch (err) {
      setError(errorDeReuniones(err, "No se pudo cambiar el estado.").mensaje);
    } finally {
      enCurso.current = false;
      setEnviando(null);
    }
  }

  return (
    <section className="mz-card" aria-labelledby="re-estado">
      <div className="mz-card-head">
        <h3 id="re-estado">Estado</h3>
      </div>
      <div className="mz-card-body mz-stack">
        <ErrorEnLinea mensaje={error} />
        <div className="re-acciones" role="group" aria-labelledby="re-estado">
          {estados.map((e) => (
            <button
              key={e.id}
              type="button"
              className="btn btn-sm re-alternar"
              aria-pressed={reunion.status === e.id}
              disabled={enviando !== null}
              onClick={() => cambiar(e.id)}
            >
              <Icon name={reunion.status === e.id ? "check2" : e.icono} />{" "}
              {enviando === e.id ? "Guardando…" : e.texto}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Lo de Otter: si se invitó al asistente, el resumen y el enlace a la
 * transcripción. Quien puede editar lo llena; los demás lo leen. */
function Otter({ reunion, onActualizada }) {
  const { limites } = useReuniones();
  const base = useId();
  const ids = {
    invitado: `${base}-otter`,
    resumen: `${base}-resumen`,
    enlace: `${base}-transcripcion`,
  };
  const inicial = useCallback(
    () => ({
      otter_invited: Boolean(reunion.otter_invited),
      otter_summary: reunion.otter_summary ?? "",
      otter_transcript_url: reunion.otter_transcript_url ?? "",
    }),
    [
      reunion.otter_invited,
      reunion.otter_summary,
      reunion.otter_transcript_url,
    ],
  );
  const [valores, setValores] = useState(inicial);
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);

  useEffect(() => {
    setValores(inicial());
  }, [inicial]);

  if (!reunion.can_edit) {
    const transcripcion = esEnlaceSeguro(reunion.otter_transcript_url);
    if (!reunion.otter_summary && !transcripcion) return null;
    return (
      <section className="mz-card" aria-labelledby="re-otter">
        <div className="mz-card-head">
          <h3 id="re-otter">Resumen de la reunión</h3>
        </div>
        <div className="mz-card-body mz-stack">
          {reunion.otter_summary && (
            <p className="re-texto">{reunion.otter_summary}</p>
          )}
          {transcripcion && (
            <EnlaceExterno
              href={reunion.otter_transcript_url}
              icono="file-earmark-text"
              texto="Ver la transcripción"
            />
          )}
        </div>
      </section>
    );
  }

  const cambiados = Object.entries(valores).filter(
    ([campo, valor]) => valor !== inicial()[campo],
  );

  async function guardar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const problema = problemaDelEnlace(valores.otter_transcript_url);
    if (problema) {
      setErrores({ otter_transcript_url: problema });
      document.getElementById(ids.enlace)?.focus();
      return;
    }
    if (cambiados.length === 0) return;
    enCurso.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    try {
      const cuerpo = Object.fromEntries(
        cambiados.map(([campo, valor]) => [
          campo,
          typeof valor === "string" ? valor.trim() || null : valor,
        ]),
      );
      onActualizada(await reunionesService.editar(reunion.id, cuerpo));
      setErrores({});
    } catch (err) {
      const e = errorDeReuniones(err, "No se pudo guardar el resumen.");
      setErrores(e.campos);
      if (e.campos.otter_transcript_url)
        document.getElementById(ids.enlace)?.focus();
      else if (e.campos.otter_summary)
        document.getElementById(ids.resumen)?.focus();
      else setErrorGeneral(e.mensaje);
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <section className="mz-card" aria-labelledby="re-otter">
      <div className="mz-card-head">
        <h3 id="re-otter">Resumen de la reunión (Otter)</h3>
      </div>
      <div className="mz-card-body">
        <form className="mz-stack" onSubmit={guardar} noValidate>
          <ErrorEnLinea mensaje={errorGeneral} />
          <label className="re-casilla" htmlFor={ids.invitado}>
            <input
              id={ids.invitado}
              type="checkbox"
              className="form-check-input"
              checked={valores.otter_invited}
              onChange={(e) =>
                setValores((v) => ({ ...v, otter_invited: e.target.checked }))
              }
            />
            Se invitó a Otter a la reunión
          </label>
          <div className="mz-campo">
            <label className="form-label" htmlFor={ids.resumen}>
              Resumen
            </label>
            <textarea
              id={ids.resumen}
              className={`form-control${errores.otter_summary ? " is-invalid" : ""}`}
              rows={5}
              maxLength={limites.summary}
              value={valores.otter_summary}
              aria-invalid={errores.otter_summary ? true : undefined}
              aria-describedby={`${ids.resumen}-cuenta${errores.otter_summary ? ` ${ids.resumen}-error` : ""}`}
              onChange={(e) => {
                setValores((v) => ({ ...v, otter_summary: e.target.value }));
                setErrores((x) => ({ ...x, otter_summary: undefined }));
              }}
            />
            <div id={`${ids.resumen}-cuenta`} className="form-text">
              {valores.otter_summary.length} de {limites.summary} caracteres.
            </div>
            {errores.otter_summary && (
              <div id={`${ids.resumen}-error`} className="mz-field-error">
                {errores.otter_summary}
              </div>
            )}
          </div>
          <div className="mz-campo">
            <label className="form-label" htmlFor={ids.enlace}>
              Enlace a la transcripción
            </label>
            <input
              id={ids.enlace}
              type="url"
              inputMode="url"
              className={`form-control${errores.otter_transcript_url ? " is-invalid" : ""}`}
              maxLength={limites.url}
              placeholder="https://"
              value={valores.otter_transcript_url}
              aria-invalid={errores.otter_transcript_url ? true : undefined}
              aria-describedby={
                errores.otter_transcript_url
                  ? `${ids.enlace}-error`
                  : `${ids.enlace}-ayuda`
              }
              onChange={(e) => {
                setValores((v) => ({
                  ...v,
                  otter_transcript_url: e.target.value,
                }));
                setErrores((x) => ({ ...x, otter_transcript_url: undefined }));
              }}
            />
            {errores.otter_transcript_url ? (
              <div id={`${ids.enlace}-error`} className="mz-field-error">
                {errores.otter_transcript_url}
              </div>
            ) : (
              <div id={`${ids.enlace}-ayuda`} className="form-text">
                Tiene que empezar con https://.
              </div>
            )}
          </div>
          {esEnlaceSeguro(reunion.otter_transcript_url) && (
            <EnlaceExterno
              href={reunion.otter_transcript_url}
              icono="file-earmark-text"
              texto="Ver la transcripción guardada"
            />
          )}
          <div className="re-acciones">
            <button
              type="submit"
              className="btn btn-outline-primary btn-sm"
              disabled={enviando || cambiados.length === 0}
            >
              {enviando ? "Guardando…" : "Guardar resumen"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
