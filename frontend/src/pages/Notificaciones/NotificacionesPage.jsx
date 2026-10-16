import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { notificacionesService } from "../../api/notificacionesService";
import { ElementoNotificacion } from "../../components/admin/Notificaciones/CampanaNotificaciones";
import "../../components/admin/Notificaciones/CampanaNotificaciones.css";
import { Icon } from "../../components/common/Icon/Icon";
import { useListadoPaginado } from "../../hooks/useListadoPaginado";

/**
 * Todas las notificaciones de quien entra, en la empresa activa: filtrar por
 * módulo o solo las sin leer, y abrir cada una en lo que la originó.
 */
export function NotificacionesPage() {
  const navigate = useNavigate();
  const [modulos, setModulos] = useState([]);
  const cargar = useCallback(
    (params) => notificacionesService.listar(params),
    [],
  );
  const listado = useListadoPaginado(
    cargar,
    { modulo: "", estado: "" },
    "No se pudieron cargar las notificaciones.",
  );

  useEffect(() => {
    notificacionesService
      .modulos()
      .then(setModulos)
      .catch(() => setModulos([]));
  }, []);

  async function abrir(notificacion) {
    if (!notificacion.leida) {
      await notificacionesService.leer(notificacion.id).catch(() => null);
    }
    if (notificacion.enlace) navigate(notificacion.enlace);
    else listado.refresh();
  }

  async function leerTodas() {
    await notificacionesService.leerTodas().catch(() => null);
    listado.refresh();
  }

  const { resultados, total, hasNext, hasPrevious } = listado;

  return (
    <div className="mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Notificaciones</h2>
          <p className="mz-desc">
            Todo lo que el sistema le avisó en esta empresa. Se guardan 90 días
            después de leídas.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={leerTodas}
        >
          <Icon name="check2-all" /> Marcar todas como leídas
        </button>
      </div>

      <div className="mz-filter-bar">
        <div className="mz-inline-field">
          <label htmlFor="nt-modulo">Módulo</label>
          <select
            id="nt-modulo"
            className="form-select form-select-sm"
            value={listado.filtros.modulo}
            onChange={(e) =>
              listado.actualizarFiltros({ modulo: e.target.value })
            }
          >
            <option value="">Todos</option>
            {modulos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="form-check">
          <input
            id="nt-no-leidas"
            type="checkbox"
            className="form-check-input"
            checked={listado.filtros.estado === "no_leidas"}
            onChange={(e) =>
              listado.actualizarFiltros({
                estado: e.target.checked ? "no_leidas" : "",
              })
            }
          />
          <label className="form-check-label" htmlFor="nt-no-leidas">
            Solo sin leer
          </label>
        </div>
      </div>

      {listado.error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {listado.error}
        </div>
      )}

      <section className="mz-card">
        {resultados.length === 0 && !listado.isLoading ? (
          <p className="campana__vacio">
            <Icon name="bell-slash" />
            No hay notificaciones con estos filtros.
          </p>
        ) : (
          resultados.map((n) => (
            <ElementoNotificacion key={n.id} notificacion={n} onAbrir={abrir} />
          ))
        )}
      </section>

      {(hasNext || hasPrevious) && (
        <div className="mz-actions justify-content-between">
          <span className="mz-small mz-faint">{total} notificaciones</span>
          <div className="mz-actions">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={!hasPrevious}
              onClick={() => listado.setPagina(listado.pagina - 1)}
            >
              Anterior
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={!hasNext}
              onClick={() => listado.setPagina(listado.pagina + 1)}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
