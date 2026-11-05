/*
 * El Motor de Insights de una persona (`InsightsPanel` de Nexo): hallazgos
 * y recomendaciones por reglas (sin IA), fortalezas, oportunidades,
 * relaciones entre indicadores, la referencia contra su propio historial y
 * la reevaluación de recomendaciones anteriores. Todo viene del servidor.
 */
import { kpiService } from "../../../api/kpiService";
import { fechaHora } from "../comunes";
import { Accion, sinRelleno } from "./AnalisisAvanzado";
import { EstadoSeccion, Estrellas, Seccion, Semaforo } from "./Componentes";
import { useCarga } from "./ContextoKpi";
import { TENDENCIA, conSigno, numero, puntos, segunVista } from "./kpiComunes";

const TONO = {
  risk: { texto: "Atención", tono: "warn" },
  positive: { texto: "Positivo", tono: "ok" },
  neutral: { texto: "Informativo", tono: "neutral" },
};

const REEVALUACION = {
  mejorada: { texto: "Mejorada", tono: "ok" },
  valida: { texto: "Sigue vigente", tono: "warn" },
  prioritaria: { texto: "Prioritaria", tono: "bad" },
  "sin-datos": { texto: "Sin datos", tono: "neutral" },
};

const CONFIANZA_RELACION = { alta: "ok", media: "warn", baja: "neutral" };

function Evidencia({ evidencia }) {
  if (!evidencia?.length) return null;
  return (
    <dl className="gh-tarjeta-kv mz-small mb-2">
      {evidencia.map((e, i) => (
        <div key={`${e.label}-${i}`} className="gk-contents">
          <dt>{e.label}</dt>
          <dd>
            {e.before && e.before !== "—" ? `${e.before} → ` : ""}
            <strong>{e.after}</strong>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function TarjetaInsight({ insight, propia = false }) {
  const t = TONO[insight.tone] ?? TONO.neutral;
  return (
    <li className={`gk-insight gk-insight--${t.tono}`}>
      <p className="d-flex flex-wrap gap-2 align-items-center mb-1">
        <Semaforo tono={t.tono}>{t.texto}</Semaforo>
        {insight.confidence && (
          <Estrellas
            nivel={insight.confidence.stars}
            titulo={`Confianza: ${insight.confidence.label}`}
          />
        )}
      </p>
      <p className="mz-strong mb-1">{segunVista(insight.hallazgo, propia)}</p>
      <p className="mz-small mb-2">{segunVista(insight.explicacion, propia)}</p>
      <Evidencia evidencia={insight.evidencia} />
      {insight.accion && <Accion accion={insight.accion} propia={propia} />}
    </li>
  );
}

const GRUPOS = [
  ["risk", "Requiere atención"],
  ["positive", "A favor"],
  ["neutral", "Informativo"],
];

export function PanelInsights({ usuarioId, propia = false }) {
  const carga = useCarga(
    () => kpiService.insights(usuarioId),
    [usuarioId],
    "No se pudo cargar el Motor de Insights.",
  );
  const d = carga.datos;
  if (!d) {
    return (
      <Seccion titulo="Motor de Insights">
        <EstadoSeccion carga={carga} />
      </Seccion>
    );
  }
  // Sin repetir: solo las tarjetas, agrupadas por tono, en el orden de
  // prioridad del servidor; sin lo que se apoya en un dato neutro.
  const orden = [
    ...(d.prioritized?.top ?? []),
    ...(d.prioritized?.additional ?? []),
  ].map((i) => i.id);
  const insights = sinRelleno(d.insights).sort(
    (a, b) =>
      (orden.indexOf(a.id) + 1 || 999) - (orden.indexOf(b.id) + 1 || 999),
  );
  const tendencia = d.performance_trend_explained;
  const ref = d.personal_benchmark;

  return (
    <Seccion titulo="Motor de Insights">
      <div className="mz-stack">
        {tendencia?.available && (
          <div className="gh-recuadro">
            <p className="mb-1">
              <Semaforo
                tono={TENDENCIA[tendencia.direction]?.tono ?? "neutral"}
              >
                {TENDENCIA[tendencia.direction]?.texto ?? "Estable"}
              </Semaforo>{" "}
              El Puntaje de desempeño {TENDENCIA[tendencia.direction]?.verbo}
              {tendencia.score_delta
                ? ` ${conSigno(tendencia.score_delta)} pts`
                : ""}{" "}
              frente al mes anterior.
            </p>
            {tendencia.bullets?.length ? (
              <ul className="mz-small mb-0">
                {tendencia.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : (
              tendencia.reason && (
                <p className="mz-small mb-0">{tendencia.reason}</p>
              )
            )}
          </div>
        )}
        {insights.length === 0 ? (
          <p className="mb-0">
            <Semaforo tono="neutral">Sin hallazgos relevantes</Semaforo> en este
            período.
          </p>
        ) : (
          GRUPOS.map(([tono, titulo]) => {
            const grupo = insights.filter((i) => i.tone === tono);
            if (!grupo.length) return null;
            return (
              <div key={tono}>
                <h4 className="gk-subtitulo">
                  {titulo} ({grupo.length})
                </h4>
                <ul className="gk-lista">
                  {grupo.map((i) => (
                    <TarjetaInsight key={i.id} insight={i} propia={propia} />
                  ))}
                </ul>
              </div>
            );
          })
        )}
        {d.relations?.length > 0 && (
          <div>
            <h4 className="gk-subtitulo">Relaciones entre indicadores</h4>
            <p className="mz-small mz-faint">
              Reglas fijas: muestran una relación observada, nunca una causa
              segura.
            </p>
            <ul className="gk-lista">
              {d.relations.map((r) => (
                <li key={r.id} className="gh-recuadro">
                  <p className="mb-1">
                    {r.statement}{" "}
                    <Semaforo
                      tono={CONFIANZA_RELACION[r.confidence] ?? "neutral"}
                    >
                      Confianza {r.confidence}
                    </Semaforo>
                  </p>
                  <Evidencia evidencia={r.evidencia} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {ref && (
          <div>
            <h4 className="gk-subtitulo">
              Referencia: solo contra su propio historial{" "}
              {ref.confidence && (
                <Estrellas
                  nivel={ref.confidence.stars}
                  titulo={`Confianza: ${ref.confidence.label}`}
                />
              )}
            </h4>
            {ref.observations === 0 ? (
              <p className="mb-0">{ref.narrative}</p>
            ) : (
              <>
                <dl className="gk-cifras">
                  {[
                    ["Puntaje de desempeño actual", puntos(ref.current)],
                    ["Promedio histórico", puntos(ref.average)],
                    [
                      "Mejor histórico",
                      ref.best_ever ? puntos(ref.best_ever.score) : "—",
                    ],
                    [
                      "Percentil personal (de sus registros, cuántos quedan por debajo)",
                      `${numero(ref.percentile, 0)} %`,
                    ],
                    [
                      "Últimas 4 semanas",
                      ref.last_4_weeks != null ? numero(ref.last_4_weeks) : "—",
                    ],
                    [
                      "Últimos 3 meses",
                      ref.last_3_months != null
                        ? numero(ref.last_3_months)
                        : "—",
                    ],
                    [
                      "Mejor semana",
                      ref.best_week ? numero(ref.best_week.score) : "—",
                    ],
                    ["Observaciones", numero(ref.observations, 0)],
                  ].map(([e, v]) => (
                    <div key={e}>
                      <dt>{e}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mz-small mb-0">{ref.narrative}</p>
              </>
            )}
          </div>
        )}
        {d.reevaluations?.length > 0 && (
          <div>
            <h4 className="gk-subtitulo">
              Reevaluación de recomendaciones anteriores
            </h4>
            <ul className="gk-lista">
              {d.reevaluations.map((r, i) => {
                const s = REEVALUACION[r.status] ?? REEVALUACION["sin-datos"];
                return (
                  <li key={`${r.rule}-${i}`}>
                    <Semaforo tono={s.tono}>{s.texto}</Semaforo> {r.message}{" "}
                    <span className="mz-small mz-faint">
                      hace {r.reference_days_ago}{" "}
                      {r.reference_days_ago === 1 ? "día" : "días"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <p className="mz-small mz-faint mb-0">
          Calculado el {fechaHora(d.last_updated)}
        </p>
      </div>
    </Seccion>
  );
}
