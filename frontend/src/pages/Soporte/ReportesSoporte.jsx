import { useEffect, useState } from "react";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import "./Soporte.css";

/* Los indicadores del piloto (§6.8 del flujo ITIL), con su meta. */
const INDICADORES = [
  ["creados", "Tickets creados", "ticket-detailed", "info"],
  ["en_cola", "En cola", "hourglass-split", "warn"],
  ["atendidos", "Atendidos", "check2-circle", "ok"],
  ["canal_oficial", "Por el portal (meta ≥ 80 %)", "globe", "info"],
  ["cumplimiento_respuesta", "SLA de respuesta (meta ≥ 90 %)", "reply", "ok"],
  ["cumplimiento_sla", "SLA de solución", "speedometer", "ok"],
  ["fcr", "Resueltos en primer contacto (meta ≥ 50 %)", "1-circle", "ok"],
  ["csat", "Satisfacción (meta ≥ 4,0 / 5)", "star", "ok"],
  ["reabiertos", "Reabiertos (meta ≤ 5 %)", "arrow-counterclockwise", "warn"],
  [
    "lead_time_promedio",
    "Lead time (llega → 1.ª respuesta)",
    "hourglass",
    "info",
  ],
  ["minutos_promedio", "Cycle time (toma → solución)", "stopwatch", "info"],
  ["escalados_sla", "Escalados por SLA", "exclamation-octagon", "bad"],
  ["horas_fuera_aprobadas", "Horas fuera de horario", "moon", "warn"],
];

const PORCENTAJES = new Set([
  "cumplimiento_sla",
  "cumplimiento_respuesta",
  "fcr",
  "reabiertos",
  "canal_oficial",
]);

function valor(clave, kpis) {
  const dato = kpis[clave];
  if (dato === null || dato === undefined) return "—";
  if (clave === "cumplimiento_sla")
    return `${dato} % (meta ${kpis.meta_sla} %)`;
  if (PORCENTAJES.has(clave)) return `${dato} %`;
  if (clave === "csat")
    return `${dato} / 5${kpis.respuesta_encuesta !== null ? ` · ${kpis.respuesta_encuesta} % respondió` : ""}`;
  if (clave === "minutos_promedio" || clave === "lead_time_promedio")
    return dato >= 60
      ? `${Math.floor(dato / 60)} h ${dato % 60} min`
      : `${dato} min`;
  if (clave === "horas_fuera_aprobadas") return `${Number(dato)} h`;
  return dato;
}

/** Reportes → Mesa de ayuda: indicadores, gráficos y desempeño por técnico. */
export function ReportesSoporte() {
  const [periodo, setPeriodo] = useState("");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    soporteService
      .reportes({ periodo })
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron calcular los reportes.")),
      );
  }, [periodo]);

  const hoy = new Date();
  const meses = Array.from({ length: 12 }, (_, i) => {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    return [
      `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`,
      fecha.toLocaleDateString("es-EC", { month: "long", year: "numeric" }),
    ];
  });

  return (
    <div className="soporte-page mz-stack">
      <div className="mz-filter-bar">
        <div className="mz-inline-field">
          <label htmlFor="rs-periodo">Periodo</label>
          <select
            id="rs-periodo"
            className="form-select form-select-sm"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
          >
            <option value="">Todo</option>
            {meses.map(([v, etiqueta]) => (
              <option key={v} value={v}>
                {etiqueta}
              </option>
            ))}
            <option value={String(hoy.getFullYear())}>
              Año {hoy.getFullYear()}
            </option>
          </select>
        </div>
      </div>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {datos && (
        <>
          <div className="mz-kpi-grid soporte-kpis">
            {INDICADORES.map(([clave, etiqueta, icono, tono]) => (
              <div key={clave} className={`mz-kpi mz-kpi--${tono}`}>
                <div className="mz-kpi-top">
                  <span className="mz-kpi-label">{etiqueta}</span>
                  <span className="mz-kpi-icon">
                    <Icon name={icono} />
                  </span>
                </div>
                <div className="mz-kpi-value">{valor(clave, datos.kpis)}</div>
              </div>
            ))}
          </div>
          <div className="soporte-graficos">
            {datos.graficos.map((g) => {
              const maximo = Math.max(1, ...g.filas.map((f) => f.valor));
              return (
                <section key={g.clave} className="mz-card">
                  <div className="mz-card-head">
                    <h3>{g.titulo}</h3>
                  </div>
                  <div className="mz-card-body">
                    {g.filas.length === 0 && (
                      <p className="mz-faint mb-0">Sin datos.</p>
                    )}
                    {g.filas.map((f) => (
                      <div key={f.etiqueta} className="soporte-barra">
                        <span>{f.etiqueta}</span>
                        <div
                          className="soporte-barra__pista"
                          aria-hidden="true"
                        >
                          <div
                            className="soporte-barra__relleno"
                            style={{
                              width: `${Math.round((f.valor / maximo) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="mz-mono">{f.valor}</span>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Cumplimiento de SLA por prioridad</h3>
            </div>
            <div className="mz-table-wrap">
              <table className="mz-table">
                <thead>
                  <tr>
                    <th>Prioridad</th>
                    <th className="num">Tickets</th>
                    <th className="num">Cumplimiento</th>
                    <th className="num">Meta</th>
                  </tr>
                </thead>
                <tbody>
                  {(datos.prioridades ?? []).map((p) => (
                    <tr key={p.prioridad}>
                      <td>{p.etiqueta}</td>
                      <td className="num">{p.tickets}</td>
                      <td className="num">
                        {p.cumplimiento === null ? (
                          "—"
                        ) : (
                          <span
                            className={
                              p.cumplimiento >= p.meta
                                ? "soporte-meta--ok"
                                : "soporte-meta--bajo"
                            }
                          >
                            {p.cumplimiento} %
                          </span>
                        )}
                      </td>
                      <td className="num">≥ {p.meta} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Desempeño por técnico</h3>
            </div>
            <div className="mz-table-wrap">
              <table className="mz-table">
                <thead>
                  <tr>
                    <th>Técnico</th>
                    <th className="num">Atendidos</th>
                    <th className="num">Cumplimiento de SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.tecnicos.map((t) => (
                    <tr key={t.tecnico}>
                      <td>{t.tecnico}</td>
                      <td className="num">{t.atendidos}</td>
                      <td className="num">
                        {t.cumplimiento_sla === null
                          ? "—"
                          : `${t.cumplimiento_sla} %`}
                      </td>
                    </tr>
                  ))}
                  {datos.tecnicos.length === 0 && (
                    <tr className="mz-empty-row">
                      <td colSpan={3}>Todavía no hay tickets atendidos</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
