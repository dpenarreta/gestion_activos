/*
 * Historial de registros: cada alta, cambio, eliminación, cierre,
 * importación y corrección del módulo, con quién, cuándo, el valor anterior
 * y el nuevo. Lo consultan el Administrador y el Asistente de Operaciones; el
 * Supervisor ve el Repositorio mensual (restricción del servidor).
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { errorDeNovedades, novedadesService } from "../../api/novedadesService";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useVistaDeTarjetas } from "../../hooks/useMediaQuery";
import { RUTA_GESTION_HUMANA } from "../../modulos/permisosGestionHumana";
import { ROL_OPERATIVO, fechaHora } from "./comunes";
import {
  BarraDeAlcance,
  ConAcceso,
  Encabezado,
  useNovedades,
} from "./ContextoNovedades";

export const OPERACION = {
  "collaborator.created": "Alta de colaborador",
  "collaborator.updated": "Modificación de colaborador",
  "collaborator.status_changed": "Cambio de estado",
  "collaborator.reassigned": "Reasignación",
  "collaborator.assignment_conflict": "Intento de registro (asignado a otro)",
  "collaborator.deleted": "Eliminación de colaborador",
  "collaborator.cedula_changed": "Corrección de cédula",
  "collaborator.removed_from_worked_days": "Retiro de Días laborados",
  "collaborator.restored_to_worked_days": "Restauración en Días laborados",
  "entry_notification.registered": "Nuevo ingreso en espera",
  "entry_notification.triggered": "Notificación de ingreso",
  "entry_notification.sent": "Correo de ingreso enviado",
  "exit_notification.sent": "Correo de salida enviado",
  "worked_day.created": "Días laborados (nuevo)",
  "worked_day.updated": "Días laborados (cambio)",
  "overtime.created": "Horas extras (nuevo)",
  "overtime.updated": "Horas extras (cambio)",
  "overtime.deleted": "Horas extras (eliminación)",
  "overtime_month.closed": "Cierre del mes de horas extras",
  "overtime_month.grace_changed": "Plazo de cierre de horas extras",
  "deadline.changed": "Plazo de registro",
  "period.closed": "Cierre de período",
  "import.confirmed": "Importación de Excel",
  "export.overtime": "Exportación a Excel",
  "export.depuration": "Exportación de horas depuradas",
  "correction.worked_day": "Corrección (días laborados)",
  "correction.overtime": "Corrección (horas extras)",
  "depuration.created": "Base de horas depuradas",
  "permission.role_changed": "Permiso de rol",
  "permission.override_created": "Excepción individual",
  "permission.override_revoked": "Excepción revocada",
};

const PAGINA = 100;

export function HistorialRegistros() {
  return (
    <ConAcceso titulo="Historial de registros">
      <PantallaHistorial />
    </ConAcceso>
  );
}

function PantallaHistorial() {
  const { me, periodo, supervisorId } = useNovedades();
  const [eventos, setEventos] = useState(null);
  const [cuenta, setCuenta] = useState(0);
  const [desde, setDesde] = useState(0);
  const [operacion, setOperacion] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [todosLosPeriodos, setTodosLosPeriodos] = useState(false);
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [error, setError] = useState(null);
  const enTarjetas = useVistaDeTarjetas();
  const puedeVer = me.can_view_history;

  const cargar = useCallback(async () => {
    if (!puedeVer) return;
    setError(null);
    setEventos(null);
    try {
      const datos = await novedadesService.historial({
        period: todosLosPeriodos ? undefined : periodo,
        supervisor: supervisorId ?? undefined,
        action: operacion,
        q: busqueda.trim(),
        date_from: fechaDesde,
        date_to: fechaHasta,
        offset: desde,
        limit: PAGINA,
      });
      setEventos(datos.results);
      setCuenta(datos.count);
    } catch (err) {
      setEventos([]);
      setError(
        errorDeNovedades(err, "No se pudo cargar el historial.").mensaje,
      );
    }
  }, [
    puedeVer,
    todosLosPeriodos,
    periodo,
    supervisorId,
    operacion,
    busqueda,
    fechaDesde,
    fechaHasta,
    desde,
  ]);

  useEffect(() => {
    const reloj = setTimeout(cargar, 300);
    return () => clearTimeout(reloj);
  }, [cargar]);

  if (!puedeVer) {
    return (
      <div className="gh-page">
        <Encabezado titulo="Historial de registros" />
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="info-circle" />
          <span>
            El historial de registros lo consultan el Administrador y el
            Asistente de Operaciones. Usted puede ver los cierres de su equipo
            en el{" "}
            <Link to={`${RUTA_GESTION_HUMANA}/repositorio`}>
              Repositorio mensual
            </Link>
            .
          </span>
        </div>
      </div>
    );
  }

  const conFiltro = (accion) => (valor) => {
    accion(valor);
    setDesde(0);
  };
  const hayFiltros = Boolean(
    operacion || busqueda.trim() || fechaDesde || fechaHasta,
  );
  const estadoDeCarga = {
    cargando: eventos === null && !error,
    error,
    onReintentar: cargar,
    vacio: eventos !== null && eventos.length === 0,
    textoVacio: "Sin eventos registrados en este período.",
    hayFiltros,
    onLimpiarFiltros: () => {
      setOperacion("");
      setBusqueda("");
      setFechaDesde("");
      setFechaHasta("");
      setDesde(0);
    },
  };

  /** El valor nuevo, con la etiqueta del evento además del color. */
  function nuevo(e) {
    if (e.highlight === "danger")
      return <span className="mz-pill mz-pill--bad">{e.new_value}</span>;
    if (e.highlight === "info")
      return (
        <span className="mz-pill mz-pill--info">
          {e.action === "collaborator.created"
            ? "Nuevo ingreso"
            : `${e.new_value} · reactivado`}
        </span>
      );
    return e.new_value;
  }

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Historial de registros"
        descripcion="Quién hizo cada cambio, cuándo, el valor anterior y el nuevo. Rojo: pasó a Inactivo o Suspendido; azul: nuevo ingreso o reactivación."
      />
      <BarraDeAlcance tipo="periodo" idBase="gh-hist" />
      <div className="mz-filter-bar">
        <div className="mz-fb-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Buscar colaborador"
            placeholder="Buscar colaborador"
            value={busqueda}
            onChange={(e) => conFiltro(setBusqueda)(e.target.value)}
          />
        </div>
        <div className="mz-inline-field">
          <label htmlFor="gh-hist-operacion">Operación</label>
          <select
            id="gh-hist-operacion"
            className="form-select form-select-sm"
            value={operacion}
            onChange={(e) => conFiltro(setOperacion)(e.target.value)}
          >
            <option value="">Todas</option>
            <option value="collaborator.">Colaboradores</option>
            <option value="worked_day.">Días laborados</option>
            <option value="overtime.">Horas extras</option>
            <option value="period.">Cierres</option>
            <option value="import.">Importaciones</option>
            <option value="correction.">Correcciones</option>
          </select>
        </div>
        <div className="form-check">
          <input
            id="gh-hist-todos"
            className="form-check-input"
            type="checkbox"
            checked={todosLosPeriodos}
            onChange={(e) => conFiltro(setTodosLosPeriodos)(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="gh-hist-todos">
            Todos los períodos
          </label>
        </div>
        <div className="mz-inline-field">
          <label htmlFor="gh-hist-desde">Desde</label>
          <input
            id="gh-hist-desde"
            type="date"
            className="form-control form-control-sm"
            value={fechaDesde}
            onChange={(e) => conFiltro(setFechaDesde)(e.target.value)}
          />
        </div>
        <div className="mz-inline-field">
          <label htmlFor="gh-hist-hasta">Hasta</label>
          <input
            id="gh-hist-hasta"
            type="date"
            className="form-control form-control-sm"
            value={fechaHasta}
            onChange={(e) => conFiltro(setFechaHasta)(e.target.value)}
          />
        </div>
      </div>

      {!enTarjetas && (
        <div className="mz-table-wrap">
          <table className="mz-table mz-table--ancha">
            <caption className="visually-hidden">
              Historial de registros
            </caption>
            <thead>
              <tr>
                <th scope="col">Fecha y hora</th>
                <th scope="col">Operación</th>
                <th scope="col">Usuario</th>
                <th scope="col">Rol</th>
                <th scope="col">Supervisor</th>
                <th scope="col">Período</th>
                <th scope="col">Registro</th>
                <th scope="col">Campo</th>
                <th scope="col">Anterior</th>
                <th scope="col">Nuevo</th>
                <th scope="col">Motivo</th>
                <th scope="col">Archivo</th>
              </tr>
            </thead>
            <tbody>
              {(eventos ?? []).map((e) => (
                <tr
                  key={e.id}
                  className={
                    e.highlight
                      ? `gh-historial-fila--${e.highlight}`
                      : undefined
                  }
                >
                  <td>{fechaHora(e.created_at)}</td>
                  <td>{OPERACION[e.action] ?? e.action}</td>
                  <td>{e.actor_name}</td>
                  <td className="mz-faint">
                    {ROL_OPERATIVO[e.actor_role] ?? e.actor_role}
                  </td>
                  <td>{e.supervisor_name}</td>
                  <td>{e.period ?? "—"}</td>
                  <td>{e.target_label}</td>
                  <td>{e.field}</td>
                  <td className="mz-faint">{e.old_value}</td>
                  <td>{nuevo(e)}</td>
                  <td>{e.reason}</td>
                  <td className="mz-faint">{e.source_file}</td>
                </tr>
              ))}
              <FilaDeEstado columnas={12} {...estadoDeCarga} />
            </tbody>
          </table>
        </div>
      )}
      {enTarjetas && (
        <div className="mz-cards">
          <EstadoDeCarga {...estadoDeCarga} />
          {eventos?.length > 0 && (
            <ul className="mz-cards-lista" aria-label="Historial de registros">
              {eventos.map((e) => (
                <li
                  key={e.id}
                  className={`mz-card-row ${e.highlight ? `gh-historial-fila--${e.highlight}` : ""}`}
                >
                  <div className="mz-row-between">
                    <strong>{OPERACION[e.action] ?? e.action}</strong>
                    <span className="mz-small">{fechaHora(e.created_at)}</span>
                  </div>
                  <div className="mz-card-row__titulo">{e.target_label}</div>
                  <div className="mz-card-meta">
                    <span>{e.actor_name}</span>
                    {e.field && <span>{e.field}</span>}
                    <span>
                      {e.old_value ? `${e.old_value} → ` : ""}
                      {nuevo(e)}
                    </span>
                  </div>
                  {e.reason && (
                    <div className="mz-small">Motivo: {e.reason}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {cuenta > PAGINA && (
        <div className="mz-pager">
          <span className="mz-small mz-faint me-auto">
            {desde + 1}–{Math.min(desde + PAGINA, cuenta)} de {cuenta}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={desde === 0}
            onClick={() => setDesde(Math.max(desde - PAGINA, 0))}
          >
            Anterior
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={desde + PAGINA >= cuenta}
            onClick={() => setDesde(desde + PAGINA)}
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
