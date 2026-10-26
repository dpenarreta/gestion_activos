import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { guardarArchivo, proyectosService } from "../../api/proyectosService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { usePermission } from "../../hooks/usePermission";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import { ControlPropio } from "../Soporte/Publico/CamposFormulario";
import { DESTINOS_ESCALAR, SelectorDestino } from "./licenciasComunes";
import "./Institucional.css";

export const ESTADOS_PROYECTO = {
  pendiente: ["En aprobación", "mz-pill--warn"],
  aprobada: ["Aprobada: se inicia", "mz-pill--ok"],
  rechazada: ["Rechazada: no se inicia", "mz-pill--bad"],
  cancelada: ["Cancelada", "mz-pill--neutral"],
};

const ICONO_PASO = {
  aprobado: "check-circle-fill",
  en_curso: "hourglass-split",
  pendiente: "circle",
};

function Ventana({ titulo, onCerrar, children }) {
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
        className="mz-modal mz-modal--wide"
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

/** Los errores por campo que devuelve el servidor (clave → mensajes). */
function erroresDeCampos(err) {
  const detalles = err?.response?.data?.error?.details?.respuestas;
  if (!detalles || typeof detalles !== "object") return {};
  return Object.fromEntries(
    Object.entries(detalles).map(([clave, v]) => [
      clave,
      Array.isArray(v) ? v.join(" ") : String(v),
    ]),
  );
}

/** Pedir un proyecto: el tipo (con su plantilla y sus pasos a la vista), el
 * nombre, los campos del formulario y la plantilla llena. */
function NuevaSolicitud({ onCreada, onCerrar }) {
  const [tipos, setTipos] = useState(null);
  const [tipoId, setTipoId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [respuestas, setRespuestas] = useState({});
  const [archivo, setArchivo] = useState(null);
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    proyectosService
      .tipos()
      .then((lista) => {
        setTipos(lista);
        if (lista.length) setTipoId(String(lista[0].id));
      })
      .catch(() => setTipos([]));
  }, []);

  const elegido = tipos?.find((t) => String(t.id) === tipoId);

  async function descargarPlantilla() {
    try {
      guardarArchivo(
        await proyectosService.plantilla(elegido.id),
        elegido.plantilla_nombre,
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar la plantilla."));
    }
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (!archivo) {
      setError(
        "Cargue la plantilla llena: descárguela, complétela y súbala aquí.",
      );
      return;
    }
    setEnviando(true);
    setError(null);
    setErrores({});
    try {
      onCreada(
        await proyectosService.solicitar(
          { tipo_proyecto: elegido.id, titulo, respuestas },
          archivo,
        ),
      );
    } catch (err) {
      setErrores(erroresDeCampos(err));
      setError(mensajeDeError(err, "No se pudo enviar la solicitud."));
      setEnviando(false);
    }
  }

  return (
    <Ventana titulo="Nueva solicitud de proyecto" onCerrar={onCerrar}>
      {tipos?.length === 0 ? (
        <p className="mz-faint mb-0">
          Todavía no hay tipos de proyecto para solicitar.
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
            <label className="form-label mz-small" htmlFor="pr-tipo">
              Tipo de proyecto
            </label>
            <select
              id="pr-tipo"
              className="form-select form-select-sm"
              value={tipoId}
              onChange={(e) => {
                setTipoId(e.target.value);
                setRespuestas({});
                setErrores({});
              }}
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
                  Para iniciarse pasa, en orden, por:
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

          {elegido && (
            <div className="col-12">
              <div className="proyecto-plantilla">
                <span className="proyecto-plantilla__numero">1</span>
                <div>
                  <strong>Descargue la plantilla y llénela</strong>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm mt-1"
                    onClick={descargarPlantilla}
                  >
                    <Icon name="file-earmark-arrow-down" /> Descargar{" "}
                    {elegido.plantilla_nombre}
                  </button>
                </div>
              </div>
              <div className="proyecto-plantilla">
                <span className="proyecto-plantilla__numero">2</span>
                <div className="flex-grow-1">
                  <label className="form-label mb-1" htmlFor="pr-archivo">
                    <strong>Cargue la plantilla llena</strong> (obligatorio)
                  </label>
                  <input
                    id="pr-archivo"
                    type="file"
                    accept=".docx,.xlsx,.pdf"
                    className="form-control form-control-sm"
                    onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                  />
                  <small className="mz-faint">
                    Word, Excel o PDF, hasta 10 MB.
                  </small>
                </div>
              </div>
              <div className="proyecto-plantilla">
                <span className="proyecto-plantilla__numero">3</span>
                <strong>Complete los datos del proyecto</strong>
              </div>
            </div>
          )}

          <div className="col-12">
            <label className="form-label mz-small" htmlFor="pr-titulo">
              Nombre del proyecto <span className="text-danger">*</span>
            </label>
            <input
              id="pr-titulo"
              className="form-control form-control-sm"
              required
              maxLength={200}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>
          {elegido?.campos.map((campo) => {
            const id = `pr-${campo.clave}`;
            const mensaje = errores[campo.clave];
            const cambiar = (valor) =>
              setRespuestas((r) => ({ ...r, [campo.clave]: valor }));
            if (campo.tipo === "casilla") {
              return (
                <div key={campo.clave} className="col-12">
                  <div className="form-check">
                    <ControlPropio
                      campo={campo}
                      id={id}
                      valor={respuestas[campo.clave]}
                      onCambiar={cambiar}
                    />
                    <label className="form-check-label" htmlFor={id}>
                      {campo.etiqueta}
                      {campo.obligatorio && (
                        <span className="text-danger"> *</span>
                      )}
                    </label>
                  </div>
                  {mensaje && <small className="text-danger">{mensaje}</small>}
                </div>
              );
            }
            return (
              <div
                key={campo.clave}
                className={
                  campo.tipo === "parrafo" ? "col-12" : "col-12 col-md-6"
                }
              >
                <label className="form-label mz-small" htmlFor={id}>
                  {campo.etiqueta}{" "}
                  {campo.obligatorio ? (
                    <span className="text-danger">*</span>
                  ) : (
                    <span className="mz-faint">(opcional)</span>
                  )}
                </label>
                <ControlPropio
                  campo={campo}
                  id={id}
                  valor={respuestas[campo.clave]}
                  onCambiar={cambiar}
                />
                {campo.ayuda && (
                  <small className="mz-faint d-block">{campo.ayuda}</small>
                )}
                {mensaje && <small className="text-danger">{mensaje}</small>}
              </div>
            );
          })}
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
              disabled={enviando || !elegido}
            >
              {enviando ? "Enviando…" : "Enviar solicitud"}
            </button>
          </div>
        </form>
      )}
    </Ventana>
  );
}

function tamano(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** El detalle: lo que se cargó (respuestas y plantilla llena), en qué paso
 * va, su historial y, a quien le toca, aprobar, rechazar o escalar. */
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
    proyectosService
      .solicitud(id)
      .then(setSolicitud)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo abrir la solicitud.")),
      );
  }, [id]);

  useEffect(() => {
    if (escalando && !opciones) {
      proyectosService
        .opciones()
        .then(setOpciones)
        .catch(() => null);
    }
  }, [escalando, opciones]);

  async function hacer(accion) {
    setTrabajando(true);
    setError(null);
    try {
      setSolicitud(await accion());
      setComentario("");
      setEscalando(false);
      onCambio();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo completar."));
    } finally {
      setTrabajando(false);
    }
  }

  async function descargar() {
    try {
      guardarArchivo(
        await proyectosService.archivo(id),
        solicitud.archivo_nombre,
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar el archivo."));
    }
  }

  const [estado, clase] = ESTADOS_PROYECTO[solicitud?.estado] ?? ["", ""];

  return (
    <Ventana
      titulo={
        solicitud ? `Solicitud ${solicitud.numero}` : "Solicitud de proyecto"
      }
      onCerrar={onCerrar}
    >
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
              <strong>{solicitud.titulo}</strong>
              <small>
                {solicitud.tipo_proyecto} · {solicitud.solicitante.nombre} ·{" "}
                {formatearFecha(solicitud.created_at, true)}
              </small>
            </div>
            <span className={`mz-pill ${clase}`}>{estado}</span>
          </div>

          <ol className="proyecto-pasos" aria-label="Pasos">
            {solicitud.pasos.map((p) => (
              <li
                key={p.nombre}
                className={`proyecto-pasos__paso proyecto-pasos__paso--${p.estado}`}
              >
                <Icon name={ICONO_PASO[p.estado]} />
                {p.nombre}
                <span className="visually-hidden">
                  {p.estado === "aprobado"
                    ? ": aprobado"
                    : p.estado === "en_curso"
                      ? ": en curso"
                      : ": pendiente"}
                </span>
              </li>
            ))}
          </ol>

          <section aria-labelledby="pr-cargado">
            <h4 id="pr-cargado" className="inicio-titulo">
              Lo que cargó quien solicita
            </h4>
            <button
              type="button"
              className="proyecto-adjunto"
              onClick={descargar}
            >
              <Icon name="file-earmark-text" />
              <span>
                <strong>{solicitud.archivo_nombre}</strong>
                <small>
                  Plantilla llena · {tamano(solicitud.archivo_tamano)}
                </small>
              </span>
              <Icon name="download" />
            </button>
            {solicitud.respuestas.length > 0 && (
              <dl className="proyecto-respuestas">
                {solicitud.respuestas.map((r) => (
                  <div key={r.etiqueta}>
                    <dt>{r.etiqueta}</dt>
                    <dd>
                      {r.tipo === "fecha" ? formatearFecha(r.valor) : r.valor}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

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
              <label className="form-label mz-small" htmlFor="pr-comentario">
                Comentario{" "}
                {solicitud.puedo.resolver && "(obligatorio para rechazar)"}
              </label>
              <textarea
                id="pr-comentario"
                rows={2}
                className="form-control form-control-sm"
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
              />
              {escalando && (
                <div className="mt-2">
                  <span className="mz-small mz-faint">Escalar a:</span>
                  <SelectorDestino
                    id="pr-escalar"
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
                      hacer(() => proyectosService.cancelar(id, comentario))
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
                          proyectosService.escalar(id, destino, comentario),
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
                        hacer(() => proyectosService.rechazar(id, comentario))
                      }
                    >
                      <Icon name="x-circle" /> Rechazar
                    </button>
                    <button
                      type="button"
                      className="btn btn-success btn-sm"
                      disabled={trabajando}
                      onClick={() =>
                        hacer(() => proyectosService.aprobar(id, comentario))
                      }
                    >
                      <Icon name="check-circle" /> Aprobar «
                      {solicitud.paso_actual}»
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
  ["por_atender", "Por atender"],
  ["todas", "Todas"],
];

/**
 * Institucional → Solicitud de proyectos: pedir un proyecto con su plantilla
 * llena y seguir su aprobación; atender (aprobar, rechazar o escalar) lo que
 * a uno le toca. Con `proyectos.ver_todas`, todas las de la empresa; con
 * `proyectos.configurar`, el botón para configurar los tipos de proyecto.
 */
export function SolicitudProyectosPage() {
  const verTodas = usePermission("proyectos.ver_todas");
  const configura = usePermission("proyectos.configurar");
  const [parametros, setParametros] = useSearchParams();
  const [pestana, setPestana] = useState("mias");
  const [lista, setLista] = useState(null);
  const [porAtender, setPorAtender] = useState(0);
  const [nueva, setNueva] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const abierta = parametros.get("solicitud");

  const cargar = useCallback(() => {
    proyectosService
      .solicitudes(pestana)
      .then(setLista)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar las solicitudes.")),
      );
    proyectosService
      .resumen()
      .then((r) => setPorAtender(r.por_atender))
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
          <h2>Solicitud de proyectos</h2>
          <p className="mz-desc">
            Pida un proyecto con su plantilla llena y siga su aprobación;
            atienda los que le toquen.
          </p>
        </div>
        <div className="mz-actions">
          {configura && (
            <Link
              to="/admin/institucional/proyectos/tipos"
              className="btn btn-outline-secondary btn-sm"
            >
              <Icon name="gear" /> Tipos de proyecto
            </Link>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setNueva(true)}
          >
            <Icon name="plus-lg" /> Nueva solicitud
          </button>
        </div>
      </div>

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
            {id === "por_atender" && porAtender > 0 && (
              <span
                className="solicitud-contador"
                aria-label={`${porAtender} por atender`}
              >
                {porAtender}
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
              <th>Número</th>
              <th>Proyecto</th>
              <th>Tipo</th>
              {pestana !== "mias" && <th>Solicitante</th>}
              <th>Estado</th>
              <th>Paso / pendiente de</th>
              <th>Solicitada</th>
            </tr>
          </thead>
          <tbody>
            {(lista ?? []).map((s) => {
              const [estado, clase] = ESTADOS_PROYECTO[s.estado] ?? ["", ""];
              return (
                <tr key={s.id}>
                  <td className="text-nowrap">{s.numero}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 text-start"
                      onClick={() => abrir(s.id)}
                    >
                      {s.titulo}
                    </button>
                  </td>
                  <td className="mz-small">{s.tipo_proyecto}</td>
                  {pestana !== "mias" && <td>{s.solicitante.nombre}</td>}
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
                  {pestana === "por_atender"
                    ? "No tiene solicitudes por atender"
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
              `Solicitud ${s.numero} enviada: queda pendiente de ${s.pendiente_de
                .map((p) => p.nombre)
                .join(", ")} («${s.paso_actual}»).`,
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
