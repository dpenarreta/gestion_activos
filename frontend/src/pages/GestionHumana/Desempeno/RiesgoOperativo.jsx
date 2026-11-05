/*
 * Índice de Riesgo Operativo (`OperationalRiskCard`,
 * `TeamOperationalRiskCard` y `TeamRecommendationsCard` de Nexo): mide el
 * riesgo que la situación de una persona representa para el equipo, no
 * evalúa a la persona. Exige `inteligencia_preventiva.ver` además del
 * ámbito; las recomendaciones de redistribución son deterministas (sin IA).
 *
 * Al pedir el riesgo del equipo, el servidor avisa (una vez por persona y
 * mes) al jefe inmediato de quien esté en riesgo Alto o Crítico; ese aviso
 * enlaza a esta pantalla.
 */
import { useState } from "react";

import { kpiService } from "../../../api/kpiService";
import {
  Confianza,
  EstadoSeccion,
  ExplicarCalculo,
  Seccion,
  Semaforo,
} from "./Componentes";
import { useCarga } from "./ContextoKpi";
import { HistorialDePuntaje } from "./AnalisisAvanzado";
import { TONO_RIESGO, conSigno, numero, valorNormalizado } from "./kpiComunes";

function PillRiesgo({ clasificacion }) {
  return (
    <Semaforo tono={TONO_RIESGO[clasificacion] ?? "neutral"}>
      Riesgo {String(clasificacion ?? "").toLowerCase()}
    </Semaforo>
  );
}

export function RiesgoOperativo({ usuarioId }) {
  const carga = useCarga(
    () => kpiService.riesgo(usuarioId),
    [usuarioId],
    "No se pudo cargar el Índice de Riesgo Operativo.",
  );
  const [explicar, setExplicar] = useState(false);
  const [historico, setHistorico] = useState(false);
  const d = carga.datos;
  const activos = (d?.factors ?? [])
    .filter((f) => f.points > 0)
    .sort((a, b) => b.points - a.points);

  return (
    <Seccion
      id="gk-riesgo"
      titulo="Índice de Riesgo Operativo"
      ayuda="riesgoOperativo"
      accion={
        d ? (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setExplicar(true)}
          >
            ¿Cómo se obtuvo este resultado?
          </button>
        ) : null
      }
    >
      {!d ? (
        <EstadoSeccion carga={carga} />
      ) : (
        <div className="mz-stack">
          <p className="mz-small mz-faint mb-0">
            Riesgo para el equipo: complementa al Puntaje de desempeño, no lo
            reemplaza.
          </p>
          <div className="gk-puntaje">
            <span className="gk-puntaje__valor">
              {Math.round(d.score)}
              <span className="gk-puntaje__de">/100</span>
            </span>
            <PillRiesgo clasificacion={d.classification} />
          </div>
          <p className="mz-small mb-0">
            {d.trend_vs_prev_month?.available
              ? `${conSigno(d.trend_vs_prev_month.diff)} frente al mes anterior.`
              : "Sin historial suficiente para la tendencia."}
          </p>
          {d.trend_explained?.available &&
            d.trend_explained.bullets?.length > 0 && (
              <ul className="mz-small mb-0">
                {d.trend_explained.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          <div>
            <h4 className="gk-subtitulo">Desglose de la contribución</h4>
            {activos.length === 0 ? (
              <p className="mb-0">
                <Semaforo tono="ok">Sin factores de riesgo activos</Semaforo>
              </p>
            ) : (
              <ul className="gk-lista">
                {activos.map((f) => (
                  <li key={f.name}>
                    <strong>+{numero(f.points, 2)}</strong> {f.name}
                    <span className="mz-small mz-faint d-block">
                      {f.detail}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="gk-subtitulo">Acciones sugeridas</h4>
            <ul className="mb-0">
              {(d.suggested_actions ?? []).map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
          <Confianza
            calidad={d.confidence?.data_quality_pct}
            confiabilidad={d.confidence?.reliability_pct}
            compacta
          />
          <div>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              aria-expanded={historico}
              onClick={() => setHistorico((v) => !v)}
            >
              {historico ? "Ocultar el histórico" : "Ver el histórico"}
            </button>
          </div>
          {historico && (
            <HistorialDePuntaje
              usuarioId={usuarioId}
              tipo="operational_risk"
              titulo="Índice de Riesgo Operativo"
            />
          )}
          {explicar && (
            <ExplicarCalculo
              titulo="Índice de Riesgo Operativo"
              formula={d.explain?.formula}
              pasos={d.explain?.steps}
              factores={d.factors.map((f) => ({
                nombre: f.name,
                original: f.detail,
                normalizado: valorNormalizado(f.points, f.weight),
                peso: f.weight,
                puntos: f.points,
              }))}
              datos={d.factors.map((f) => `${f.name}: ${f.detail}`)}
              resultado={Math.round(d.score)}
              interpretacion={`Riesgo ${String(d.classification).toLowerCase()}`}
              version={d.engine_version}
              fecha={d.last_updated}
              fuente="Capacidad proyectada, tendencias de cumplimiento, consistencia semanal, horas de fin de semana y tareas vencidas del mes en curso"
              referencia="Clasificación por umbrales configurados en los Ajustes de KPI: Bajo, Medio, Alto y Crítico"
              confianza={d.confidence}
              onCerrar={() => setExplicar(false)}
            />
          )}
        </div>
      )}
    </Seccion>
  );
}

/** El riesgo de todo su equipo ejecutor. */
export function RiesgoDelEquipo({ onElegir, carga: externa }) {
  // Si quien lo usa ya lo pidió (`carga`), no se vuelve a pedir.
  const propia = useCarga(
    () => (externa ? Promise.resolve(null) : kpiService.riesgoDelEquipo()),
    [],
    "No se pudo cargar el riesgo operativo del equipo.",
  );
  const carga = externa ?? propia;
  const d = carga.datos;
  return (
    <Seccion
      id="gk-riesgo-equipo"
      titulo="Índice de Riesgo Operativo del equipo"
      ayuda="riesgoOperativo"
    >
      {!d ? (
        <EstadoSeccion carga={carga} />
      ) : d.members.length === 0 ? (
        <p className="mz-empty mb-0">
          No tiene personas a cargo para evaluar (según el organigrama).
        </p>
      ) : (
        <div className="mz-stack">
          <p className="gp-marcas mb-0">
            <Semaforo tono="ok">{d.summary.bajo} en riesgo bajo</Semaforo>
            <Semaforo tono="warn">{d.summary.medio} en riesgo medio</Semaforo>
            <Semaforo tono="warn">{d.summary.alto} en riesgo alto</Semaforo>
            <Semaforo tono="bad">
              {d.summary.critico} en riesgo crítico
            </Semaforo>
          </p>
          {
            <div className="mz-table-wrap">
              <table className="mz-table gt-tabla">
                <caption className="visually-hidden">
                  Riesgo operativo por persona, de mayor a menor
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="gt-fija">
                      Persona
                    </th>
                    <th scope="col">Clasificación</th>
                    <th scope="col" className="num">
                      Puntaje
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.members.map((m) => (
                    <tr key={m.id}>
                      <th scope="row" className="gt-fija">
                        {onElegir ? (
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 text-start"
                            onClick={() => onElegir(m.id)}
                          >
                            {m.name}
                          </button>
                        ) : (
                          m.name
                        )}
                      </th>
                      <td>
                        <PillRiesgo clasificacion={m.classification} />
                      </td>
                      <td className="num">{Math.round(m.score)}/100</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        </div>
      )}
    </Seccion>
  );
}

function Recomendacion({ r }) {
  return (
    <li
      className={`gk-insight gk-insight--${r.priority === "alta" ? "bad" : "warn"}`}
    >
      <p className="mb-1">
        <Semaforo tono={r.priority === "alta" ? "bad" : "warn"}>
          Prioridad {r.priority === "alta" ? "alta" : "media"}
        </Semaforo>
      </p>
      <p className="mb-1">{r.text}</p>
      {r.has_candidate === false ? (
        <p className="mz-small mz-faint mb-0">
          Sin una persona compatible con capacidad disponible (mismo cargo o
          compatible según la Matriz de Compatibilidad Operativa).
        </p>
      ) : (
        <p className="mz-small mb-0">
          Impacto esperado: {conSigno(r.impact_score_pts)} pts de puntaje ·{" "}
          {conSigno(r.impact_risk_pts)} pts de riesgo operativo ·{" "}
          {r.affected_count}{" "}
          {r.affected_count === 1 ? "persona afectada" : "personas afectadas"}
        </p>
      )}
    </li>
  );
}

/** Recomendaciones de redistribución de carga del equipo. */
export function RecomendacionesDelEquipo() {
  const carga = useCarga(
    () => kpiService.recomendacionesDelEquipo(),
    [],
    "No se pudieron cargar las recomendaciones.",
  );
  const [adicionales, setAdicionales] = useState(false);
  const d = carga.datos;
  const top = d?.prioritized?.top ?? d?.recommendations ?? [];
  const extra = d?.prioritized?.additional ?? [];
  return (
    <Seccion titulo="Recomendaciones de redistribución">
      {!d ? (
        <EstadoSeccion carga={carga} />
      ) : top.length + extra.length === 0 ? (
        <p className="mb-0">
          <Semaforo tono="ok">Equipo balanceado</Semaforo> Sin redistribuciones
          sugeridas.
        </p>
      ) : (
        <>
          <p className="mz-small mz-faint">
            Motor por reglas (sin IA): nunca entre niveles jerárquicos
            distintos.
          </p>
          <ul className="gk-lista">
            {top.map((r, i) => (
              <Recomendacion key={`${r.id}-${i}`} r={r} />
            ))}
            {adicionales &&
              extra.map((r, i) => (
                <Recomendacion key={`x-${r.id}-${i}`} r={r} />
              ))}
          </ul>
          {extra.length > 0 && !adicionales && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm mt-2"
              onClick={() => setAdicionales(true)}
            >
              Ver recomendaciones adicionales ({extra.length})
            </button>
          )}
        </>
      )}
    </Seccion>
  );
}
