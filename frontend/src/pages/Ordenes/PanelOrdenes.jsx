import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ordenesService } from "../../api/ordenesService";
import { Icon } from "../../components/common/Icon/Icon";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import {
  CumplimientoOrden,
  EstadoOrden,
  PrioridadOrden,
  moneda,
} from "./comunes";
import "./Ordenes.css";

/** Los ocho indicadores, en el orden del panel. */
const INDICADORES = [
  ["registradas", "Órdenes registradas", "clipboard-data", "info"],
  ["abiertas", "Abiertas", "folder2-open", "info"],
  ["vencidas", "Vencidas", "exclamation-octagon", "bad"],
  ["cerradas", "Cerradas", "check2-circle", "ok"],
  ["costo_total", "Costo total (con IVA)", "cash-coin", "info"],
  ["prioridad_alta", "Prioridad alta o crítica", "lightning-charge", "warn"],
  [
    "pendientes_aprobacion",
    "Pendientes de aprobación",
    "hourglass-split",
    "warn",
  ],
  ["con_observaciones", "Con observaciones", "chat-left-text", "warn"],
];

export function TarjetasDeIndicadores({ kpis }) {
  return (
    <div className="mz-kpi-grid ordenes-kpis">
      {INDICADORES.map(([clave, etiqueta, icono, tono]) => (
        <div
          key={clave}
          className={`mz-kpi mz-kpi--${tono} ordenes-kpi--${clave}`}
        >
          <div className="mz-kpi-top">
            <span className="mz-kpi-label">{etiqueta}</span>
            <span className="mz-kpi-icon">
              <Icon name={icono} />
            </span>
          </div>
          <div className="mz-kpi-value">
            {clave === "costo_total" ? moneda(kpis[clave]) : kpis[clave]}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Panel de Mantenimiento de sedes: cómo está el mantenimiento en el alcance
 * de quien mira, lo que requiere atención y lo último que pasó.
 */
export function PanelOrdenes() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    ordenesService
      .resumen()
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el panel.")),
      );
  }, []);

  return (
    <div className="ordenes-page">
      <div className="mz-view-head">
        <div>
          <h2>Panel de mantenimiento</h2>
          <p className="mz-desc ordenes-alcance">
            <Icon name="geo-alt" />
            {datos
              ? `Alcance: ${datos.alcance}`
              : "Órdenes de trabajo de sedes y agencias."}
          </p>
        </div>
        <div className="mz-view-actions">
          <Link
            className="btn btn-outline-primary btn-sm"
            to="/admin/ordenes/lista"
          >
            Ver órdenes
          </Link>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {!datos && !error && <div className="mz-empty">Cargando…</div>}

      {datos && (
        <>
          <TarjetasDeIndicadores kpis={datos.kpis} />
          <div className="ordenes-panel">
            <section className="mz-card">
              <div className="mz-card-head">
                <h3>Requieren atención</h3>
                <span className="mz-small mz-faint">
                  Críticas, altas y vencidas
                </span>
              </div>
              <div className="mz-table-wrap">
                <table className="mz-table">
                  <thead>
                    <tr>
                      <th>N.º</th>
                      <th>Sede</th>
                      <th>Prioridad</th>
                      <th>Estado</th>
                      <th>Cumplimiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.atencion.map((orden) => (
                      <tr key={orden.id}>
                        <td className="mz-mono">
                          <Link to={`/admin/ordenes/lista/${orden.id}`}>
                            {orden.numero}
                          </Link>
                        </td>
                        <td>{orden.sede.nombre}</td>
                        <td>
                          <PrioridadOrden orden={orden} />
                        </td>
                        <td>
                          <EstadoOrden orden={orden} />
                        </td>
                        <td>
                          <CumplimientoOrden orden={orden} />
                        </td>
                      </tr>
                    ))}
                    {datos.atencion.length === 0 && (
                      <tr className="mz-empty-row">
                        <td colSpan={5}>Nada pendiente en su alcance</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mz-card">
              <div className="mz-card-head">
                <h3>Actividad reciente</h3>
              </div>
              <div className="mz-card-body">
                {datos.actividad.length === 0 ? (
                  <p className="mz-faint mb-0">Todavía no hay movimientos.</p>
                ) : (
                  <ul className="ordenes-actividad">
                    {datos.actividad.map((movimiento) => (
                      <li key={movimiento.id}>
                        <span
                          className={`ordenes-actividad__punto${
                            movimiento.estado_nuevo
                              ? " ordenes-actividad__punto--estado"
                              : ""
                          }`}
                          aria-hidden="true"
                        />
                        <div>
                          <Link
                            to={`/admin/ordenes/lista/${movimiento.orden.id}`}
                          >
                            {movimiento.descripcion}
                          </Link>
                          <div className="mz-small mz-faint">
                            {movimiento.actor} ·{" "}
                            {formatearFecha(movimiento.created_at, true)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
