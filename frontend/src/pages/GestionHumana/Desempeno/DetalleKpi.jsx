/*
 * Los KPI de una persona en un mes (lo que comparten `MyKpisModule` y el
 * panel derecho de `KpisModule` de Nexo): carga laboral, cumplimiento, score,
 * tareas, cumplimiento por prioridad, el análisis avanzado, el riesgo
 * operativo (solo con `inteligencia_preventiva.ver`, en la vista de equipo),
 * el Motor de Insights, la evolución, las consultas de seguimiento y la
 * tabla de tareas, y el «Análisis de Nova» (IA, con `nova.analisis_kpi`).
 */
import { useState } from "react";

import { NOVA_ANALISIS_KPI } from "../../../api/novaService";
import { Icon } from "../../../components/common/Icon/Icon";
import { useAuth } from "../../../hooks/useAuth";

import { AnalisisAvanzado, HistorialDePuntaje } from "./AnalisisAvanzado";
import { CargaLaboral } from "./CargaLaboral";
import {
  AdvertenciasDeValidacion,
  Ayuda,
  Estrellas,
  ExplicarCalculo,
  FrenteAlAnterior,
  Indicador,
  Seccion,
  Semaforo,
} from "./Componentes";
import { LineaDeCumplimiento } from "./Graficos";
import { PanelInsights } from "./PanelInsights";
import { PanelNova } from "./PanelNova";
import { RiesgoOperativo } from "./RiesgoOperativo";
import {
  CUMPLIMIENTO_CORTO,
  CUMPLIMIENTO_TEXTO,
  ESTADO_TAREA,
  PRIORIDAD_CUMPLIMIENTO,
  TIPO_TAREA,
  colorDeResultado,
  duracionDeMinutos,
  horas,
  NOMBRE_DESEMPENO,
  madurezPorCantidad,
  mensajeDelPeriodo,
  motivoLegible,
  nombreDelMes,
  numero,
  porcentaje,
  tonoDe,
} from "./kpiComunes";
import { fechaCorta } from "../Tareas/tareasComunes";

function Navegacion({ conRiesgo, enCurso }) {
  const enlaces = [
    enCurso && ["gk-carga", "Carga"],
    ["gk-cumplimiento", "Cumplimiento"],
    enCurso && ["gk-score", "Desempeño"],
    enCurso && conRiesgo && ["gk-riesgo", "Riesgo"],
    enCurso && ["gk-alertas", "Alertas"],
    enCurso && ["gk-prediccion", "Predicción"],
    enCurso && ["gk-tiempo-objetivo", "Tiempo objetivo"],
    ["gk-tareas", "Tareas"],
  ].filter(Boolean);
  return (
    <nav className="gk-nav" aria-label="Secciones de los KPI">
      <ul>
        {enlaces.map(([id, texto]) => (
          <li key={id}>
            <a href={`#${id}`}>{texto}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function PorPrioridad({ datos = [] }) {
  const alta = datos.find((d) => d.priority === "ALTA");
  return (
    <Seccion titulo="Cumplimiento por prioridad">
      <ul className="gk-barras">
        {datos.map((d) => {
          const color = colorDeResultado(d.pct);
          return (
            <li key={d.priority}>
              <span className="gk-barras__etiqueta">
                {PRIORIDAD_CUMPLIMIENTO[d.priority] ?? d.priority}{" "}
                <span className="mz-faint">
                  ({d.total} {d.total === 1 ? "tarea" : "tareas"})
                </span>
              </span>
              {d.total === 0 ? (
                <span className="mz-small mz-faint">
                  Sin tareas de esta prioridad
                </span>
              ) : (
                <>
                  <span
                    className="gh-avance gk-barras__barra"
                    aria-hidden="true"
                  >
                    <span
                      className={`gk-relleno--${tonoDe(color)}`}
                      style={{ width: `${Math.min(100, d.pct)}%` }}
                    />
                  </span>
                  <Semaforo tono={tonoDe(color)}>
                    {porcentaje(d.pct)} · {CUMPLIMIENTO_CORTO[color]}
                  </Semaforo>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {alta && alta.total > 0 && alta.pct < 70 && (
        <p className="mz-alert mz-alert--bad mt-2 mb-0" role="note">
          El cumplimiento de las tareas de prioridad Alta está por debajo del
          mínimo aceptable ({porcentaje(alta.pct)}): requiere atención
          inmediata.
        </p>
      )}
    </Seccion>
  );
}

function Seguimiento({ seguimiento }) {
  const motivos = [...(seguimiento?.by_reason ?? [])].sort(
    (a, b) => b.count - a.count,
  );
  if (!motivos.length) return null;
  const maximo = Math.max(...motivos.map((m) => m.count));
  return (
    <Seccion titulo="Consultas de seguimiento por motivo">
      <ul className="gk-barras">
        {motivos.map((m) => (
          <li key={m.reason}>
            <span className="gk-barras__etiqueta">
              {motivoLegible(m.reason)}
            </span>
            <span className="gh-avance gk-barras__barra" aria-hidden="true">
              <span
                style={{ width: `${Math.round((m.count / maximo) * 100)}%` }}
              />
            </span>
            <span className="mz-small">
              <strong>{m.count}</strong>{" "}
              {m.count === 1 ? "consulta" : "consultas"} ·{" "}
              {duracionDeMinutos(m.total_minutes)}
            </span>
          </li>
        ))}
      </ul>
    </Seccion>
  );
}

const ORDEN_COLOR = { red: 0, yellow: 1, green: 2 };

function Tareas({ tareas, mes }) {
  const filas = [...(tareas ?? [])].sort(
    (a, b) => (ORDEN_COLOR[a.color] ?? 3) - (ORDEN_COLOR[b.color] ?? 3),
  );
  return (
    <Seccion
      id="gk-tareas"
      titulo={`Tareas de ${nombreDelMes(mes).toLowerCase()}`}
    >
      {filas.length === 0 ? (
        <p className="mz-empty mb-0">Sin tareas asignadas en este período.</p>
      ) : (
        <div className="mz-table-wrap">
          <table className="mz-table gt-tabla">
            <caption className="visually-hidden">Tareas del período</caption>
            <thead>
              <tr>
                <th scope="col" className="gt-fija">
                  Tarea
                </th>
                <th scope="col">Tipo</th>
                <th scope="col">Estado</th>
                <th scope="col">Vence</th>
                <th scope="col" className="num">
                  Retraso
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((t) => (
                <tr key={t.id}>
                  <th scope="row" className="gt-fija">
                    <span className="gt-fija__titulo">{t.title}</span>
                  </th>
                  <td>{TIPO_TAREA[t.type] ?? t.type}</td>
                  <td>{ESTADO_TAREA[t.status] ?? t.status}</td>
                  <td>{fechaCorta(t.end_date)}</td>
                  <td className="num">
                    {t.delay_days > 0 ? (
                      <Semaforo tono="bad">
                        {t.delay_days} {t.delay_days === 1 ? "día" : "días"}
                      </Semaforo>
                    ) : (
                      <span className="mz-faint">Sin retraso</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Seccion>
  );
}

/**
 * @param {object} props
 * @param {object} props.kpi el payload de `kpis/me/` o `kpis/<id>/`
 * @param {boolean} [props.propia] Mis KPI (mensaje del período)
 * @param {boolean} [props.conRiesgo] mostrar el Índice de Riesgo Operativo
 * @param {boolean} [props.enCurso] el mes elegido es el mes en curso
 *
 * Solo el cumplimiento, las tareas, el seguimiento y la actividad se piden
 * por mes (`kpis/…?month=`). La carga laboral, el análisis avanzado, el
 * riesgo, el Motor de Insights y la referencia los calcula el servidor
 * siempre con el día de hoy: fuera del mes en curso no se muestran (se dice
 * por qué), para no mezclar datos de hoy con un mes pasado.
 */
export function DetalleKpi({
  kpi,
  propia = false,
  conRiesgo = false,
  enCurso = true,
}) {
  const [explicar, setExplicar] = useState(false);
  const { user } = useAuth();
  const conNova = (user?.permissions ?? []).includes(NOVA_ANALISIS_KPI);
  const c = kpi.cumplimiento;
  const carga = kpi.carga_laboral;
  const mensual = kpi.carga_tiempo?.mensual;
  const anterior = kpi.prev_month;
  const mensaje = propia ? mensajeDelPeriodo(c.completed_pct, c.total) : null;
  const usuarioId = kpi.user.id;

  return (
    <div className="mz-stack">
      <AdvertenciasDeValidacion advertencias={kpi.validation_warnings} />
      <Navegacion conRiesgo={conRiesgo} enCurso={enCurso} />

      {enCurso ? (
        <Seccion
          id="gk-carga"
          titulo="Carga laboral (horas reales)"
          ayuda="cargaLaboral"
        >
          <CargaLaboral cargaTiempo={kpi.carga_tiempo} />
        </Seccion>
      ) : (
        <div className="mz-alert mz-alert--info" role="note">
          <Icon name="info-circle" />
          <span>
            Está viendo {nombreDelMes(kpi.period?.month)}: el cumplimiento, las
            tareas y las consultas son de ese mes. La carga laboral, el{" "}
            {NOMBRE_DESEMPENO}, el Equilibrio Operativo, el riesgo operativo y
            el Motor de Insights son del mes en curso; para verlos, vuelva al
            mes en curso.
          </span>
        </div>
      )}

      <div id="gk-cumplimiento" className="mz-kpi-grid">
        <Indicador
          etiqueta="Puntaje del mes (método anterior)"
          valor={`${numero(kpi.score, 0)}/100`}
          extra={<Ayuda clave="puntajeAnterior" />}
          sub="Cumplimiento, horas frente al tiempo objetivo, avance y comentarios. No es el Puntaje de desempeño."
        />
        <Indicador
          etiqueta="Cumplimiento"
          valor={porcentaje(c.completed_pct)}
          tono={tonoDe(c.color)}
          textoTono={CUMPLIMIENTO_TEXTO[c.color]}
          extra={
            <Estrellas
              nivel={madurezPorCantidad(c.total)}
              titulo={`Madurez del dato: ${c.total} tareas en el período`}
            />
          }
          sub={
            <>
              {c.completed_on_time} de {c.total} a tiempo
              <br />
              <FrenteAlAnterior
                actual={c.completed_pct}
                anterior={anterior?.completed_pct}
              />
            </>
          }
        />
        {enCurso && (
          <Indicador
            etiqueta="Carga laboral del mes en curso"
            valor={porcentaje(carga.ratio)}
            tono={mensual?.label ? tonoDe(mensual.color) : undefined}
            textoTono={mensual?.label}
            sub={
              <>
                {horas(carga.real_hours)} de {horas(carga.estimated_hours)} de
                base
                <br />
                <FrenteAlAnterior
                  actual={carga.ratio}
                  anterior={anterior?.carga_ratio}
                />
              </>
            }
          />
        )}
        <Indicador
          etiqueta="Total de tareas"
          valor={c.total}
          sub={`${c.completed} completadas · ${c.in_progress} en progreso · ${c.pending} pendientes`}
        />
        <Indicador
          etiqueta="Vencidas"
          valor={c.overdue}
          tono={c.overdue > 0 ? "bad" : undefined}
          textoTono={c.overdue > 0 ? "Con retraso" : undefined}
          sub={
            c.overdue > 0
              ? `${numero(c.avg_delay_days, 0)} días de retraso en promedio`
              : "Sin retrasos"
          }
        />
        <Indicador
          etiqueta="Consultas de seguimiento"
          valor={kpi.seguimiento?.total ?? 0}
          sub={`${kpi.seguimiento?.by_reason?.length ?? 0} motivos distintos`}
        />
      </div>
      <div>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => setExplicar(true)}
        >
          ¿Cómo se obtuvo el cumplimiento?
        </button>
      </div>

      {mensaje && (
        <div className={`mz-alert mz-alert--${mensaje.tono}`} role="note">
          <span>{mensaje.texto}</span>
        </div>
      )}

      <PorPrioridad datos={kpi.cumplimiento_por_prioridad} />
      {enCurso && (
        <>
          <AnalisisAvanzado usuarioId={usuarioId} propia={propia} />
          {conRiesgo && <RiesgoOperativo usuarioId={usuarioId} />}
          <PanelInsights usuarioId={usuarioId} propia={propia} />
          {conNova && <PanelNova key={usuarioId} usuarioId={usuarioId} />}
        </>
      )}
      <HistorialDePuntaje
        usuarioId={usuarioId}
        tipo="performance_score"
        titulo={NOMBRE_DESEMPENO}
      />

      {kpi.cumplimiento_history?.length > 0 && (
        <Seccion titulo="Evolución del cumplimiento (6 meses)">
          <LineaDeCumplimiento datos={kpi.cumplimiento_history} titulo={null} />
        </Seccion>
      )}

      <Seguimiento seguimiento={kpi.seguimiento} />

      <div className="mz-kpi-grid">
        <Indicador
          etiqueta="Tareas recurrentes"
          valor={porcentaje(kpi.calidad.recurring_pct)}
          sub={`${kpi.calidad.recurring_completed} de ${kpi.calidad.recurring_total} completadas`}
        />
        <Indicador
          etiqueta="Asignadas por otros"
          valor={kpi.actividad.assigned_by_others}
          sub={`${kpi.actividad.own_tasks} propias, de ${c.total} tareas`}
        />
        <Indicador
          etiqueta="Comentarios"
          valor={kpi.actividad.total_comments}
          sub="registrados en el período"
        />
        <Indicador
          etiqueta="Avance de las tareas en progreso"
          valor={porcentaje(kpi.calidad.avg_progress)}
        />
      </div>

      <Tareas tareas={kpi.tasks} mes={kpi.period?.month} />

      {explicar && (
        <ExplicarCalculo
          titulo="Cumplimiento"
          formula={c.explain?.formula}
          pasos={c.explain?.steps}
          onCerrar={() => setExplicar(false)}
        />
      )}
    </div>
  );
}
