import { Fragment, useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { solicitudesService } from "../../../api/solicitudesService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
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
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }
  if (!solicitud) {
    return <div className="solicitudes-page text-muted">Cargando…</div>;
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
      <Breadcrumbs
        items={[
          { label: "Administración" },
          { label: "Solicitudes" },
          {
            label: esMia ? "Mis solicitudes" : "Solicitudes recibidas",
            path: esMia
              ? "/admin/solicitudes/mias"
              : "/admin/solicitudes/recibidas",
          },
          { label: `Solicitud #${solicitud.id}` },
        ]}
      />

      <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-3">
        <div>
          <h2 className="mb-1">
            Solicitud #{solicitud.id}{" "}
            <EstadoDeSolicitud solicitud={solicitud} />
          </h2>
          <p className="text-muted mb-0">{solicitud.lo_que_se_pide}</p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-4">
        <div className="col-12 col-lg-7">
          <dl className="row mb-0">
            <dt className="col-5 col-sm-4">Qué se pide</dt>
            <dd className="col-7 col-sm-8">{solicitud.lo_que_se_pide}</dd>
            <dt className="col-5 col-sm-4">Clase</dt>
            <dd className="col-7 col-sm-8">{solicitud.clase_display}</dd>
            <dt className="col-5 col-sm-4">Cantidad</dt>
            <dd className="col-7 col-sm-8">{solicitud.cantidad}</dd>
            <dt className="col-5 col-sm-4">Prioridad</dt>
            <dd className="col-7 col-sm-8">{solicitud.prioridad_display}</dd>
            <dt className="col-5 col-sm-4">Se necesita para</dt>
            <dd className="col-7 col-sm-8">
              {solicitud.fecha_necesaria
                ? formatearFecha(solicitud.fecha_necesaria)
                : "Sin fecha comprometida"}
            </dd>
            <dt className="col-5 col-sm-4">Quién la pidió</dt>
            <dd className="col-7 col-sm-8">{solicitud.solicitante_nombre}</dd>
            <dt className="col-5 col-sm-4">Quién la gestiona</dt>
            <dd className="col-7 col-sm-8">{solicitud.encargado_nombre}</dd>
            <dt className="col-5 col-sm-4">Para qué hace falta</dt>
            <dd className="col-7 col-sm-8">{solicitud.justificacion}</dd>
          </dl>

          {/* Lo pedido con el vocabulario del tipo: es lo que permite comparar
              con lo que se acabó comprando, cosa que una justificación escrita a
              mano no deja hacer. */}
          {Object.keys(solicitud.especificaciones ?? {}).length > 0 && (
            <div className="mt-3">
              <h6>Con qué características</h6>
              <dl className="row mb-0">
                {Object.entries(solicitud.especificaciones).map(
                  ([nombre, contenido]) => (
                    <Fragment key={nombre}>
                      <dt className="col-5 col-sm-4">{nombre}</dt>
                      <dd className="col-7 col-sm-8">
                        {contenido === true
                          ? "Sí"
                          : contenido === false
                            ? "No"
                            : String(contenido)}
                      </dd>
                    </Fragment>
                  ),
                )}
              </dl>
            </div>
          )}

          {(pasos.length > 0 || puedeCancelar) && (
            <div className="mt-4">
              <h6>Qué se puede hacer ahora</h6>
              {(pasos.some((paso) => paso.exigeNota) || puedeCancelar) && (
                <div className="mb-2">
                  <label className="form-label small" htmlFor="sol-nota">
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
              <div className="d-flex flex-wrap gap-2">
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
          )}

          {solicitud.esta_cerrada && (
            <p className="text-muted mt-3 mb-0">
              Su recorrido terminó y no se reabre. Si vuelve a hacer falta, se
              pide de nuevo.
            </p>
          )}
        </div>

        <div className="col-12 col-lg-5">
          <h6>Recorrido</h6>
          <ul className="solicitudes-recorrido">
            {solicitud.movimientos.map((movimiento) => (
              <li key={movimiento.id}>
                <strong>{movimiento.estado_nuevo_display}</strong>
                <small className="d-block text-muted">
                  {formatearFecha(movimiento.created_at)} ·{" "}
                  {movimiento.actor_nombre || "el sistema"}
                </small>
                {movimiento.nota && (
                  <div className="nota small">{movimiento.nota}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
