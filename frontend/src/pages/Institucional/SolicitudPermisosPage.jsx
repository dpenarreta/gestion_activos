import { useCallback, useEffect, useRef, useState } from "react";
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
import { useModalA11y } from "../../hooks/useModalA11y";
import { usePermission } from "../../hooks/usePermission";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
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
import { confirmar } from "../../components/common/Confirmar/confirmar";

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
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [evaluacion, setEvaluacion] = useState(null);
  const formulario = useRef(null);

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
      .catch((err) => {
        // Antes un fallo se veía como «no hay tipos de permiso» (auditoría
        // UX/UI, fase 2, 28/10/2026): ahora se dice que no se pudo cargar.
        setError(
          mensajeDeError(err, "No se pudieron cargar los tipos de permiso."),
        );
        setTipos([]);
      });
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
      // El error va junto al campo y el foco a él (auditoría UX/UI, fase 2).
      setError(null);
      setErrores({ adjunto: "Este permiso pide un documento de respaldo." });
      enfocarPrimerError(formulario.current);
      return;
    }
    setEnviando(true);
    setError(null);
    setErrores({});
    try {
      onCreada(
        await licenciasService.solicitar(
          pideMotivo ? valores : { ...valores, motivo: "" },
          adjunto,
        ),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar la solicitud."));
      setErrores(erroresPorCampo(err));
      setEnviando(false);
      enfocarPrimerError(formulario.current);
    }
  }

  return (
    <Ventana titulo="Nueva solicitud de permiso" onCerrar={onCerrar} ancha>
      {tipos === null ? (
        <EstadoDeCarga cargando />
      ) : tipos.length === 0 ? (
        error ? (
          <EstadoDeCarga error={error} />
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
                onChange={fijar("flujo")}
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
          {elegido && elegido.adjunto !== "no" && (
            <Campo
              id="sp-adjunto"
              etiqueta={
                elegido.adjunto === "obligatorio"
                  ? "Documento de respaldo"
                  : "Documento de respaldo (opcional)"
              }
              obligatorio={elegido.adjunto === "obligatorio"}
              ayuda="PDF o imagen, hasta 10 MB."
              error={errores.adjunto}
              className="col-12"
            >
              <input
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
        // Sin las opciones no hay a quién escalar: se avisa en vez de dejar
        // el selector vacío (auditoría UX/UI, fase 2, 28/10/2026).
        .catch((err) =>
          setError(mensajeDeError(err, "No se pudo cargar a quién escalar.")),
        );
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
    setError(null);
    try {
      const blob = await licenciasService.adjunto(id);
      descargarBlob(blob, solicitud.adjunto_nombre);
    } catch (err) {
      // Antes fallaba sin avisar (auditoría UX/UI, fase 2, 28/10/2026).
      setError(mensajeDeError(err, "No se pudo descargar el documento."));
    }
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
      {/* Mientras llegan los datos, la ventana no queda en blanco. */}
      {!solicitud && !error && <EstadoDeCarga cargando />}
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
                aria-describedby={
                  solicitud.puedo.resolver && !comentario.trim()
                    ? "sp-comentario-ayuda"
                    : undefined
                }
              />
              {solicitud.puedo.resolver && !comentario.trim() && (
                <small id="sp-comentario-ayuda" className="mz-faint d-block">
                  Para rechazar, escriba el motivo.
                </small>
              )}
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
                    onClick={async () => {
                      const si = await confirmar({
                        titulo: "¿Cancelar la solicitud?",
                        mensaje:
                          "La solicitud se retira y ya no sigue su aprobación.",
                        accion: "Cancelar solicitud",
                        cancelar: "Volver",
                      });
                      if (si)
                        hacer(() => licenciasService.cancelar(id, comentario));
                    }}
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
                      disabled={trabajando || !comentario.trim()}
                      onClick={async () => {
                        // Rechazar termina la solicitud: se confirma.
                        const si = await confirmar({
                          titulo: "¿Rechazar la solicitud?",
                          mensaje:
                            "La solicitud termina aquí y se avisa a quien la hizo con su comentario.",
                          accion: "Rechazar",
                        });
                        if (si)
                          hacer(() =>
                            licenciasService.rechazar(id, comentario),
                          );
                      }}
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
  const [nueva, setNueva] = useState(false);
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

      <PanelDePestana idBase="sp" valor={pestana} className="mz-table-wrap">
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
      </PanelDePestana>

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
