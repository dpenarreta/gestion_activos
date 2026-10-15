import { useCallback, useEffect, useState } from "react";

import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import {
  ESTADO_DE_NOTIFICACION,
  SITUACION_PROGRAMADA,
  textoDeAnticipacion,
} from "./avisosMatriz";
import { diaCorto, fechaHora } from "./formatoMatriz";
import { VistaPreviaCorreoModal } from "./VistaPreviaCorreoModal";

/**
 * La pestaña Recordatorios del período (§15.4): qué avisos tiene programados
 * y en qué quedó cada uno, el historial de notificaciones —con «Reintentar»
 * en las fallidas— y la vista previa del correo. «Reenviar recordatorio» está
 * en la barra de acciones del panel.
 */
export function RecordatoriosDelPeriodo({ periodo, version }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [viendo, setViendo] = useState(false);
  const [reintentando, setReintentando] = useState(null);
  const zona = periodo.empresa?.zona_horaria;

  const cargar = useCallback(() => {
    matrizService
      .recordatorios(periodo.id)
      .then(setDatos)
      .catch((err) =>
        setError(
          mensajeDeError(err, "No se pudieron cargar los recordatorios."),
        ),
      );
  }, [periodo.id]);

  useEffect(() => {
    cargar();
  }, [cargar, version]);

  async function reintentar(notificacion) {
    setReintentando(notificacion.id);
    setError(null);
    try {
      await matrizService.reintentarNotificacion(notificacion.id);
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo reintentar el aviso."));
    } finally {
      setReintentando(null);
    }
  }

  if (!datos && !error) return <div className="mz-empty">Cargando…</div>;

  return (
    <div>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {datos?.suspended && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="bell-slash" />
          Los recordatorios de este período están suspendidos.
        </div>
      )}

      <div className="mz-actions mb-3">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => setViendo(true)}
        >
          <Icon name="envelope-open" /> Vista previa del correo
        </button>
      </div>

      {datos && (
        <>
          <div className="mz-section">
            <h4>Programación</h4>
            <ul className="matriz-programacion">
              {datos.schedule.map((fila) => {
                const situacion = SITUACION_PROGRAMADA[fila.status];
                return (
                  <li key={fila.offset_days}>
                    <span className="mz-strong">
                      {textoDeAnticipacion(fila.offset_days)}
                    </span>
                    <span className="mz-faint">
                      {diaCorto(fila.date)} · {fila.time}
                    </span>
                    <span className={`mz-pill ${situacion.clase}`}>
                      {situacion.texto}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mz-small mz-faint mt-2">
              Hora de {zona}. Van al responsable
              {periodo.suplente ? " y, si la empresa lo pide, al suplente" : ""}
              ; con atraso, al supervisor o al aprobador.
            </div>
          </div>

          <div className="mz-section">
            <h4>Notificaciones</h4>
            {datos.notifications.length === 0 ? (
              <div className="mz-empty">
                <Icon name="envelope" />
                <div>Todavía no se ha enviado ningún aviso.</div>
              </div>
            ) : (
              <div className="mz-table-wrap">
                <table className="mz-table">
                  <thead>
                    <tr>
                      <th>Cuándo</th>
                      <th>Aviso</th>
                      <th>Para</th>
                      <th>Estado</th>
                      <th aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {datos.notifications.map((n) => {
                      const estado = ESTADO_DE_NOTIFICACION[n.estado];
                      return (
                        <tr key={n.id}>
                          <td>{fechaHora(n.created_at, zona)}</td>
                          <td>
                            {n.tipo_nombre}
                            <div className="mz-small mz-faint">
                              {n.disparado_por}
                              {n.intentos > 1 && ` · intento ${n.intentos}`}
                            </div>
                          </td>
                          <td>{n.correo}</td>
                          <td>
                            <span className={`mz-pill ${estado.clase}`}>
                              {estado.texto}
                            </span>
                            {n.estado === "fallido" && n.ultimo_error && (
                              <div className="mz-small mz-faint matriz-error">
                                {n.ultimo_error}
                              </div>
                            )}
                          </td>
                          <td>
                            {n.estado === "fallido" && datos.can_send && (
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm"
                                disabled={reintentando === n.id}
                                onClick={() => reintentar(n)}
                              >
                                <Icon name="arrow-repeat" /> Reintentar
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {viendo && (
        <VistaPreviaCorreoModal
          periodo={periodo}
          onCerrar={() => setViendo(false)}
        />
      )}
    </div>
  );
}
