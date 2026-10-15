import { useCallback, useEffect, useMemo, useState } from "react";

import { getEmpresaActiva } from "../../api/client";
import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { BotonesExportar } from "./BotonesExportar";
import "./Matriz.css";

function Indicador({ variante, etiqueta, valor, detalle, icono }) {
  return (
    <div className={`mz-kpi mz-kpi--${variante}`}>
      <span className="mz-kpi-top">
        <span className="mz-kpi-label">{etiqueta}</span>
        <span className="mz-kpi-icon">
          <Icon name={icono} />
        </span>
      </span>
      <span className="mz-kpi-value">{valor}</span>
      <span className="mz-kpi-sub">{detalle}</span>
    </div>
  );
}

/** Barras apiladas: finalizado, en progreso e incumplido, con el total. */
function Barras({ titulo, filas }) {
  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>{titulo}</h3>
      </div>
      <div className="mz-card-body">
        {filas.length === 0 && (
          <div className="mz-empty">Sin períodos en el rango.</div>
        )}
        {filas.map((fila) => (
          <div
            key={fila.name}
            className="mz-bar-row"
            aria-label={`${fila.name}: ${fila.finalizado} finalizados, ${fila.en_progreso} en progreso, ${fila.incumplido} incumplidos`}
          >
            <span className="mz-bar-label" title={fila.name}>
              {fila.name}
            </span>
            <span className="mz-bar-track">
              {[
                ["finalizado", "ok"],
                ["en_progreso", "warn"],
                ["incumplido", "bad"],
              ].map(([clave, color]) =>
                fila[clave] ? (
                  <span
                    key={clave}
                    className={`mz-seg mz-seg--${color}`}
                    style={{ width: `${(fila[clave] * 100) / fila.total}%` }}
                  />
                ) : null,
              )}
            </span>
            <span className="mz-bar-num">{fila.total}</span>
          </div>
        ))}
        {filas.length > 0 && (
          <div className="mz-legend">
            <span>
              <i className="mz-legend-ok" /> Finalizado
            </span>
            <span>
              <i className="mz-legend-warn" /> En progreso
            </span>
            <span>
              <i className="mz-legend-bad" /> Incumplido
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Reportes (§15.8, §16): cumplimiento a tiempo y tardío, lo incumplido y lo
 * que corre, y las barras por área y por entidad, en un rango de fechas de
 * vencimiento. Sin `ver_todas`, solo lo propio. Exportar exige `exportar`.
 */
export function ReportesMatriz() {
  const [empresa, setEmpresa] = useState(undefined);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    matrizService
      .misEmpresas()
      .then(({ empresas }) => {
        const activa = String(getEmpresaActiva() ?? "");
        setEmpresa(
          empresas.find((e) => String(e.id) === activa) ?? empresas[0] ?? null,
        );
      })
      .catch(() => setEmpresa(null));
  }, []);

  const params = useMemo(() => {
    const p = {};
    if (desde) p.due_from = desde;
    if (hasta) p.due_to = hasta;
    return p;
  }, [desde, hasta]);

  const cargar = useCallback(() => {
    matrizService
      .reportes(params)
      .then((respuesta) => {
        setDatos(respuesta);
        setError(null);
      })
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el reporte.")),
      );
  }, [params]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const k = datos?.kpis;
  const puedeExportar = empresa?.capacidades.includes("matriz.exportar");

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Reportes</h2>
          <p className="mz-desc">
            Cumplimiento de las obligaciones por fecha de vencimiento.
          </p>
        </div>
        {puedeExportar && (
          <div className="mz-view-actions">
            <BotonesExportar
              recurso="reportes"
              params={params}
              nombre="reporte-matriz"
            />
          </div>
        )}
      </div>

      <form
        className="mz-filter-bar"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Rango de vencimientos"
      >
        <div className="mz-inline-field">
          <label htmlFor="rep-desde">Desde</label>
          <input
            id="rep-desde"
            type="date"
            className="form-control form-control-sm"
            value={desde}
            max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>
        <div className="mz-inline-field">
          <label htmlFor="rep-hasta">Hasta</label>
          <input
            id="rep-hasta"
            type="date"
            className="form-control form-control-sm"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>
        {(desde || hasta) && (
          <button
            type="button"
            className="btn btn-link btn-sm"
            onClick={() => {
              setDesde("");
              setHasta("");
            }}
          >
            Quitar el rango
          </button>
        )}
      </form>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {!datos && !error && <div className="mz-empty">Cargando…</div>}

      {k && (
        <>
          <div className="mz-kpi-grid">
            <Indicador
              variante="ok"
              etiqueta="Cumplimiento a tiempo"
              valor={`${k.on_time_pct} %`}
              detalle={`${k.closed_on_time} de ${k.closed} cerradas`}
              icono="check2-circle"
            />
            <Indicador
              variante="warn"
              etiqueta="Cumplimiento tardío"
              valor={`${k.late_pct} %`}
              detalle={`${k.closed_late} fuera de plazo`}
              icono="clock-history"
            />
            <Indicador
              variante="bad"
              etiqueta="Incumplidas"
              valor={k.overdue}
              detalle="Vencidas sin cierre validado"
              icono="exclamation-triangle"
            />
            <Indicador
              variante="info"
              etiqueta="En progreso"
              valor={k.in_progress}
              detalle="Abiertas dentro del plazo"
              icono="hourglass-split"
            />
          </div>
          <div className="mz-grid-2">
            <Barras titulo="Por área" filas={datos.by_area} />
            <Barras titulo="Por entidad de control" filas={datos.by_entity} />
          </div>
        </>
      )}
    </div>
  );
}
