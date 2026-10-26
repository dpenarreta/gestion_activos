import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { licenciasService } from "../../api/licenciasService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { usePermission } from "../../hooks/usePermission";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import { CalendarioDeRango } from "./CalendarioDeRango";
import { CalendarioSolicitado } from "./CalendarioSolicitado";
import {
  DESTINOS_ESCALAR,
  ESTADOS,
  SelectorDestino,
  fechas,
} from "./licenciasComunes";
import "./Institucional.css";
import { descargarBlob } from "../../utils/descargas";

function Ventana({ titulo, onCerrar, children, ancha = false }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={`mz-modal${ancha ? " mz-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>{titulo}</h3>
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
function RestriccionesDelPermiso({ evaluacion }) {
  if (!evaluacion?.reglas.length) return null;
  return (
    <section className="solicitud-reglas" aria-labelledby="sp-reglas">
      <strong id="sp-reglas" className="solicitud-reglas__titulo">
        Restricciones de este permiso
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

/** Pedir un permiso: el tipo (con sus pasos a la vista), las fechas, el
 * motivo y, si lo pide, el documento. */
function NuevaSolicitud({ onCreada, onCerrar }) {
  const [tipos, setTipos] = useState(null);
  const [valores, setValores] = useState({
    flujo: "",
    desde: hoyIso(),
    hasta: hoyIso(),
    motivo: "",
  });
  const [adjunto, setAdjunto] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [evaluacion, setEvaluacion] = useState(null);

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

  useEffect(() => {
    licenciasService
      .tipos()
      .then((lista) => {
        setTipos(lista);
        if (lista.length)
          setValores((v) => ({ ...v, flujo: String(lista[0].id) }));
      })
      .catch(() => setTipos([]));
  }, []);

  const elegido = tipos?.find((t) => String(t.id) === valores.flujo);
  const pideMotivo = elegido?.pide_motivo !== false;
  const fijar = (campo) => (e) =>
    setValores((v) => ({ ...v, [campo]: e.target.value }));
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
    if (elegido?.adjunto === "obligatorio" && !adjunto) {
      setError("Este permiso pide un documento de respaldo.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      onCreada(
        await licenciasService.solicitar(
          pideMotivo ? valores : { ...valores, motivo: "" },
          adjunto,
        ),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar la solicitud."));
      setEnviando(false);
    }
  }

  return (
    <Ventana titulo="Nueva solicitud de permiso" onCerrar={onCerrar} ancha>
      {tipos?.length === 0 ? (
        <p className="mz-faint mb-0">
          Todavía no hay tipos de permiso para solicitar.
        </p>
      ) : (
        <form className="row g-2" onSubmit={enviar}>
          {error && (
            <div className="col-12">
              <div className="mz-alert mz-alert--bad" role="alert">
                <Icon name="x-octagon" />
                {error}
              </div>
            </div>
          )}
          <div className="col-12">
            <label className="form-label mz-small" htmlFor="sp-tipo">
              Tipo de permiso
            </label>
            <select
              id="sp-tipo"
              className="form-select form-select-sm"
              value={valores.flujo}
              onChange={fijar("flujo")}
            >
              {(tipos ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
            {elegido && (
              <div className="solicitud-ruta mt-2">
                {elegido.descripcion && (
                  <p className="mz-small mb-1">{elegido.descripcion}</p>
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
              onCambio={(rango) => setValores((v) => ({ ...v, ...rango }))}
            />
          </div>
          <div className="col-12 col-md-5 d-flex flex-column gap-2">
            <div>
              <label className="form-label mz-small" htmlFor="sp-desde">
                Desde
              </label>
              <input
                id="sp-desde"
                type="date"
                required
                className="form-control form-control-sm"
                value={valores.desde}
                onChange={fijarDesde}
              />
            </div>
            <div>
              <label className="form-label mz-small" htmlFor="sp-hasta">
                Hasta
              </label>
              <input
                id="sp-hasta"
                type="date"
                required
                min={valores.desde}
                className="form-control form-control-sm"
                value={valores.hasta}
                onChange={fijar("hasta")}
              />
            </div>
            <p className="solicitud-dias mb-0" aria-live="polite">
              {dias
                ? `${dias} ${dias === 1 ? "día" : "días"} en total`
                : "Revise las fechas: «Hasta» no puede ser antes de «Desde»."}
            </p>
          </div>
          {/* Las indicaciones del permiso van a todo el ancho; el motivo, solo
              si el tipo lo pide (vacaciones no). */}
          {evaluacion?.reglas.length > 0 && (
            <div className="col-12">
              <RestriccionesDelPermiso evaluacion={evaluacion} />
            </div>
          )}
          {pideMotivo && (
            <div className="col-12">
              <label className="form-label mz-small" htmlFor="sp-motivo">
                Motivo
              </label>
              <textarea
                id="sp-motivo"
                rows={3}
                className="form-control form-control-sm"
                value={valores.motivo}
                onChange={fijar("motivo")}
              />
            </div>
          )}
          {elegido && elegido.adjunto !== "no" && (
            <div className="col-12">
              <label className="form-label mz-small" htmlFor="sp-adjunto">
                Documento de respaldo{" "}
                {elegido.adjunto === "obligatorio"
                  ? "(obligatorio)"
                  : "(opcional)"}
              </label>
              <input
                id="sp-adjunto"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="form-control form-control-sm"
                onChange={(e) => setAdjunto(e.target.files?.[0] ?? null)}
              />
              <small className="mz-faint">PDF o imagen, hasta 10 MB.</small>
            </div>
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

/** El detalle de una solicitud: sus datos, su historial y, a quien le toca,
 * aprobar, rechazar o escalar. */
function DetalleSolicitud({ id, onCambio, onCerrar }) {
  const [solicitud, setSolicitud] = useState(null);
  const [comentario, setComentario] = useState("");
  const [escalando, setEscalando] = useState(false);
  const [destino, setDestino] = useState({
    tipo: "persona",
    usuario: null,
    rol: null,
    cargo: null,
  });
  const [opciones, setOpciones] = useState(null);
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    licenciasService
      .solicitud(id)
      .then(setSolicitud)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo abrir la solicitud.")),
      );
  }, [id]);

  useEffect(() => {
    if (escalando && !opciones) {
      licenciasService
        .opciones()
        .then(setOpciones)
        .catch(() => null);
    }
  }, [escalando, opciones]);

  async function hacer(accion) {
    setTrabajando(true);
    setError(null);
    try {
      const datos = await accion();
      setSolicitud(datos);
      setComentario("");
      setEscalando(false);
      onCambio();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo completar."));
    } finally {
      setTrabajando(false);
    }
  }

  async function verAdjunto() {
    const blob = await licenciasService.adjunto(id);
    descargarBlob(blob, solicitud.adjunto_nombre);
  }

  const [estado, clase] = ESTADOS[solicitud?.estado] ?? ["", ""];

  return (
    <Ventana titulo="Solicitud de permiso" onCerrar={onCerrar} ancha>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {solicitud && (
        <div className="mz-stack">
          <div className="solicitud-cabecera">
            <div>
              <strong>{solicitud.flujo}</strong>
              <small>
                {solicitud.solicitante.nombre} ·{" "}
                {fechas(solicitud.desde, solicitud.hasta, formatearFecha)} (
                {solicitud.dias} {solicitud.dias === 1 ? "día" : "días"})
              </small>
            </div>
            <span className={`mz-pill ${clase}`}>{estado}</span>
          </div>
          <CalendarioSolicitado
            desde={solicitud.desde}
            hasta={solicitud.hasta}
          />
          {solicitud.motivo && <p className="mb-0">{solicitud.motivo}</p>}
          {solicitud.tiene_adjunto && (
            <button
              type="button"
              className="btn btn-link btn-sm px-0 align-self-start"
              onClick={verAdjunto}
            >
              <Icon name="paperclip" /> {solicitud.adjunto_nombre}
            </button>
          )}
          {solicitud.estado === "pendiente" && (
            <p className="mz-small mb-0">
              <strong>En el paso «{solicitud.paso_actual}»</strong>, pendiente
              de: {solicitud.pendiente_de.map((p) => p.nombre).join(", ")}
            </p>
          )}

          <ol className="solicitud-historial" aria-label="Historial">
            {solicitud.acciones.map((a) => (
              <li key={a.id} className={`solicitud-historial__${a.accion}`}>
                <span className="mz-faint mz-small">
                  {formatearFecha(a.created_at, true)}
                </span>
                <span>
                  {a.actor && <strong>{a.actor} </strong>}
                  {a.accion_display.toLowerCase()}
                  {a.paso && a.accion !== "terminada" ? ` (${a.paso})` : ""}
                  {a.detalle ? `: ${a.detalle}` : ""}
                </span>
                {a.comentario && <em className="mz-small">«{a.comentario}»</em>}
              </li>
            ))}
          </ol>

          {(solicitud.puedo.resolver ||
            solicitud.puedo.escalar ||
            solicitud.puedo.cancelar) && (
            <div className="solicitud-acciones">
              <label className="form-label mz-small" htmlFor="sp-comentario">
                Comentario{" "}
                {solicitud.puedo.resolver && "(obligatorio para rechazar)"}
              </label>
              <textarea
                id="sp-comentario"
                rows={2}
                className="form-control form-control-sm"
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
              />
              {escalando && (
                <div className="mt-2">
                  <span className="mz-small mz-faint">Escalar a:</span>
                  <SelectorDestino
                    id="sp-escalar"
                    etiqueta="Escalar a"
                    valor={destino}
                    onCambio={setDestino}
                    opciones={opciones}
                    tipos={DESTINOS_ESCALAR}
                  />
                </div>
              )}
              <div className="mz-actions justify-content-end mt-2">
                {solicitud.puedo.cancelar && (
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm me-auto"
                    disabled={trabajando}
                    onClick={() =>
                      hacer(() => licenciasService.cancelar(id, comentario))
                    }
                  >
                    Cancelar solicitud
                  </button>
                )}
                {solicitud.puedo.escalar &&
                  (escalando ? (
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      disabled={trabajando}
                      onClick={() =>
                        hacer(() =>
                          licenciasService.escalar(id, destino, comentario),
                        )
                      }
                    >
                      <Icon name="send" /> Confirmar escalamiento
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => setEscalando(true)}
                    >
                      <Icon name="arrow-up-right" /> Escalar
                    </button>
                  ))}
                {solicitud.puedo.resolver && (
                  <>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      disabled={trabajando}
                      onClick={() =>
                        hacer(() => licenciasService.rechazar(id, comentario))
                      }
                    >
                      <Icon name="x-circle" /> Rechazar
                    </button>
                    <button
                      type="button"
                      className="btn btn-success btn-sm"
                      disabled={trabajando}
                      onClick={() =>
                        hacer(() => licenciasService.aprobar(id, comentario))
                      }
                    >
                      <Icon name="check-circle" /> Aprobar
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Ventana>
  );
}

const PESTANAS = [
  ["mias", "Mis solicitudes"],
  ["por_aprobar", "Por aprobar"],
  ["todas", "Todas"],
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
  const [nueva, setNueva] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [puedeSolicitar, setPuedeSolicitar] = useState(true);
  const abierta = parametros.get("solicitud");

  const cargar = useCallback(() => {
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

  const pestanas = PESTANAS.filter(([id]) => id !== "todas" || verTodas);

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
              <Icon name="diagram-2" /> Configurar flujos
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

      <div className="mz-tabs" role="tablist">
        {pestanas.map(([id, texto]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pestana === id}
            className={pestana === id ? "is-active" : undefined}
            onClick={() => setPestana(id)}
          >
            {texto}
            {id === "por_aprobar" && porAprobar > 0 && (
              <span
                className="solicitud-contador"
                aria-label={`${porAprobar} por aprobar`}
              >
                {porAprobar}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check-circle" />
          {aviso}
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table solicitudes-tabla">
          <thead>
            <tr>
              <th>Permiso</th>
              {pestana !== "mias" && <th>Solicitante</th>}
              <th>Fechas</th>
              <th className="num">Días</th>
              <th>Estado</th>
              <th>Paso / pendiente de</th>
              <th>Solicitada</th>
            </tr>
          </thead>
          <tbody>
            {(lista ?? []).map((s) => {
              const [estado, clase] = ESTADOS[s.estado] ?? ["", ""];
              return (
                <tr key={s.id}>
                  <td>
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0"
                      onClick={() => abrir(s.id)}
                    >
                      {s.flujo}
                    </button>
                  </td>
                  {pestana !== "mias" && <td>{s.solicitante.nombre}</td>}
                  <td>{fechas(s.desde, s.hasta, formatearFecha)}</td>
                  <td className="num">{s.dias}</td>
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
            {lista?.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={7}>
                  {pestana === "por_aprobar"
                    ? "No tiene solicitudes por aprobar"
                    : "No hay solicitudes"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {nueva && (
        <NuevaSolicitud
          onCerrar={() => setNueva(false)}
          onCreada={(s) => {
            setNueva(false);
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
