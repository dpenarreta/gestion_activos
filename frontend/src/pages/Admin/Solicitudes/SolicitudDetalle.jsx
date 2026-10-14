import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { solicitudesService } from "../../../api/solicitudesService";
import { Icon } from "../../../components/common/Icon/Icon";
import { useAuth } from "../../../hooks/useAuth";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import { formatearFecha } from "../../../utils/formato";
import { EstadoDeSolicitud } from "./ListadoDeSolicitudes";
import "./Solicitudes.css";

/**
 * Qué se puede hacer desde cada estado, y con qué palabras.
 *
 * Las mismas transiciones que valida el servidor. Se repiten aquí para no
 * ofrecer botones que van a ser rechazados —lo que enseña a desconfiar de la
 * pantalla—, pero quien manda sigue siendo el backend: esto decide qué se
 * muestra, no qué se permite.
 */
const PASOS = {
  pendiente: [
    { estado: "en_gestion", texto: "Tomarla", clase: "btn-primary" },
    {
      estado: "rechazada",
      texto: "Rechazar",
      clase: "btn-outline-danger",
      exigeNota: true,
    },
  ],
  en_gestion: [
    { estado: "comprada", texto: "Marcar como comprada", clase: "btn-primary" },
    {
      estado: "rechazada",
      texto: "Rechazar",
      clase: "btn-outline-danger",
      exigeNota: true,
    },
  ],
  comprada: [
    {
      estado: "entregada",
      texto: "Marcar como entregada",
      clase: "btn-success",
    },
  ],
};

export function SolicitudDetalle() {
  const { id } = useParams();
  const { user } = useAuth();
  const administra = usePermission("solicitudes.administrar");
  const gestiona = usePermission("solicitudes.gestionar");

  const [solicitud, setSolicitud] = useState(null);
  const [nota, setNota] = useState("");
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const cargar = useCallback(() => {
    solicitudesService
      .get(id)
      .then(setSolicitud)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar la solicitud.")),
      );
  }, [id]);

  useEffect(cargar, [cargar]);

  async function mover(paso) {
    if (paso.exigeNota && !nota.trim()) {
      setError(
        "Un rechazo lleva motivo: es lo único que le llega a quien pidió como explicación.",
      );
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const actualizada = await solicitudesService.cambiarEstado(
        solicitud.id,
        paso.estado,
        nota.trim(),
      );
      setSolicitud(actualizada);
      setNota("");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo cambiar el estado."));
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !solicitud) {
    return (
      <div className="solicitudes-page">
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      </div>
    );
  }
  if (!solicitud) {
    return <div className="solicitudes-page mz-empty">Cargando…</div>;
  }

  const esMia = solicitud.solicitante === user?.id;
  const laGestiono =
    administra || (gestiona && solicitud.encargado === user?.id);
  const pasos =
    laGestiono && !solicitud.esta_cerrada
      ? (PASOS[solicitud.estado] ?? [])
      : [];
  // Quien pidió puede retirar lo que ya no hace falta sin pedirle permiso a
  // nadie: dejarlo abierto le hace perder el tiempo a quien compra.
  const puedeCancelar = (esMia || administra) && !solicitud.esta_cerrada;

  return (
    <div className="solicitudes-page">
      <div className="mz-view-head">
        <div>
          <h2>
            Solicitud #{solicitud.id}{" "}
            <EstadoDeSolicitud solicitud={solicitud} />
          </h2>
          <p className="mz-desc">{solicitud.lo_que_se_pide}</p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="mz-grid-2">
        <div className="mz-stack">
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Datos de la solicitud</h3>
            </div>
            <div className="mz-card-body">
              <div className="mz-kv-grid">
                <div className="mz-kv mz-kv--full">
                  <span className="mz-kv-label">Qué se pide</span>
                  {solicitud.lo_que_se_pide}
                </div>
                <div className="mz-kv">
                  <span className="mz-kv-label">Clase</span>
                  {solicitud.clase_display}
                </div>
                <div className="mz-kv">
                  <span className="mz-kv-label">Cantidad</span>
                  {solicitud.cantidad}
                </div>
                <div className="mz-kv">
                  <span className="mz-kv-label">Prioridad</span>
                  <span className={`mz-prio--${solicitud.prioridad}`}>
                    {solicitud.prioridad_display}
                  </span>
                </div>
                <div className="mz-kv">
                  <span className="mz-kv-label">Se necesita para</span>
                  {solicitud.fecha_necesaria
                    ? formatearFecha(solicitud.fecha_necesaria)
                    : "Sin fecha comprometida"}
                </div>
                <div className="mz-kv">
                  <span className="mz-kv-label">Quién la pidió</span>
                  {solicitud.solicitante_nombre}
                </div>
                <div className="mz-kv">
                  <span className="mz-kv-label">Quién la gestiona</span>
                  {solicitud.encargado_nombre}
                </div>
                <div className="mz-kv mz-kv--full">
                  <span className="mz-kv-label">Para qué hace falta</span>
                  {solicitud.justificacion}
                </div>
              </div>

              {/* Lo pedido con el vocabulario del tipo: es lo que permite comparar
                  con lo que se acabó comprando, cosa que una justificación escrita a
                  mano no deja hacer. */}
              {Object.keys(solicitud.especificaciones ?? {}).length > 0 && (
                <div className="mz-section mt-3 mb-0">
                  <h4>Con qué características</h4>
                  <div className="mz-kv-grid">
                    {Object.entries(solicitud.especificaciones).map(
                      ([nombre, contenido]) => (
                        <div className="mz-kv" key={nombre}>
                          <span className="mz-kv-label">{nombre}</span>
                          {contenido === true
                            ? "Sí"
                            : contenido === false
                              ? "No"
                              : String(contenido)}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}

              {solicitud.esta_cerrada && (
                <p className="mz-note mt-3 mb-0">
                  Su recorrido terminó y no se reabre. Si vuelve a hacer falta,
                  se pide de nuevo.
                </p>
              )}
            </div>
          </section>

          {(pasos.length > 0 || puedeCancelar) && (
            <section className="mz-card">
              <div className="mz-card-head">
                <h3>Qué se puede hacer ahora</h3>
              </div>
              <div className="mz-card-body">
                {(pasos.some((paso) => paso.exigeNota) || puedeCancelar) && (
                  <div className="mz-field">
                    <label htmlFor="sol-nota">
                      Nota (obligatoria al rechazar)
                    </label>
                    <textarea
                      id="sol-nota"
                      className="form-control form-control-sm"
                      rows={2}
                      value={nota}
                      onChange={(evento) => setNota(evento.target.value)}
                    />
                  </div>
                )}
                <div className="mz-actions">
                  {pasos.map((paso) => (
                    <button
                      key={paso.estado}
                      type="button"
                      className={`btn btn-sm ${paso.clase}`}
                      disabled={isSaving}
                      onClick={() => mover(paso)}
                    >
                      {paso.texto}
                    </button>
                  ))}
                  {puedeCancelar && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      disabled={isSaving}
                      onClick={() => mover({ estado: "cancelada" })}
                    >
                      Cancelar la solicitud
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>

        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Recorrido</h3>
          </div>
          <div className="mz-card-body">
            <ul className="mz-timeline solicitudes-recorrido">
              {solicitud.movimientos.map((movimiento) => (
                <li key={movimiento.id} className="mz-tl-item">
                  <strong className="mz-tl-what">
                    {movimiento.estado_nuevo_display}
                  </strong>
                  <div className="mz-tl-when">
                    {formatearFecha(movimiento.created_at)} ·{" "}
                    {movimiento.actor_nombre || "el sistema"}
                  </div>
                  {movimiento.nota && (
                    <div className="mz-tl-why nota">{movimiento.nota}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
