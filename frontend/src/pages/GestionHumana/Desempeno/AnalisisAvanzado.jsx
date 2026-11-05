/*
 * El análisis avanzado de una persona (`AdvancedAnalyticsPanel`,
 * `EquilibrioOperativoCard`, `SmartBenchmarkPanel`,
 * `TargetTimePrecisionCard` y `ScoreHistoryChart` de Nexo): Performance
 * Score, Equilibrio Operativo, referencia utilizada, alertas automáticas,
 * consistencia, anomalías, predicción, tendencias, calidad del dato,
 * precisión del Tiempo Objetivo y el histórico de puntajes. Todo lo calcula
 * el servidor (sin IA); cada bloque carga por su cuenta y, si falla, lo dice
 * con «Reintentar».
 */
import { useState } from "react";

import { kpiService } from "../../../api/kpiService";
import { fechaHora } from "../comunes";
import {
  AdvertenciasDeValidacion,
  BarraDeZonas,
  Confianza,
  EstadoSeccion,
  Estrellas,
  ExplicarCalculo,
  Seccion,
  Semaforo,
} from "./Componentes";
import { useCarga } from "./ContextoKpi";
import { LineaDePuntaje } from "./Graficos";
import {
  CONSISTENCIA_TONO,
  NOTA_CONSISTENCIA_NEUTRA,
  REFERENCIA_CLASIFICACION,
  SEVERIDAD_ALERTA,
  TENDENCIA,
  TONO_CLASIFICACION,
  confiabilidadPorEstrellas,
  conSigno,
  NOMBRE_DESEMPENO,
  TRAMOS_DESEMPENO,
  numero,
  segunVista,
  tramosDeEscala,
  porcentaje,
  tonoDe,
  valorNormalizado,
} from "./kpiComunes";

function Puntaje({ valor, clasificacion, tono }) {
  return (
    <div className="gk-puntaje">
      <span className="gk-puntaje__valor">
        {Math.round(valor ?? 0)}
        <span className="gk-puntaje__de">/100</span>
      </span>
      <Semaforo tono={tono}>{clasificacion}</Semaforo>
    </div>
  );
}

function BotonExplicar({ onClick, texto = "¿Cómo se obtuvo este resultado?" }) {
  return (
    <button
      type="button"
      className="btn btn-outline-secondary btn-sm"
      onClick={onClick}
    >
      {texto}
    </button>
  );
}

/** «Sin datos suficientes» en tono neutro, con el motivo del servidor. */
export function SinDatos({ motivo }) {
  return (
    <p className="mb-0">
      <Semaforo tono="neutral">Sin datos suficientes</Semaforo>{" "}
      {motivo && <span className="mz-small mz-faint">{motivo}</span>}
    </p>
  );
}

/** Lo que se apoya en un dato neutro («Sin historial suficiente») no es una
 * fortaleza ni una conclusión: se descarta. */
export function sinRelleno(lista = []) {
  return lista.filter(
    (i) =>
      !JSON.stringify([i.hallazgo, i.explicacion, i.evidencia]).includes(
        "Sin historial",
      ),
  );
}

// --- Bundle -----------------------------------------------------------------------

export function AnalisisAvanzado({ usuarioId, propia = false }) {
  const carga = useCarga(
    () => kpiService.analisis(usuarioId),
    [usuarioId],
    "No se pudo cargar el análisis avanzado.",
  );
  const [explicar, setExplicar] = useState(false);
  const d = carga.datos;

  if (!d) {
    return (
      <Seccion id="gk-score" titulo="Análisis avanzado">
        <EstadoSeccion carga={carga} />
      </Seccion>
    );
  }

  const confianza = {
    data_quality_pct: d.data_quality?.pct,
    reliability_pct: d.consistency?.available
      ? confiabilidadPorEstrellas(d.consistency.reliability?.stars)
      : 50,
  };
  const ps = d.performance_score;
  const factores = (ps?.factors ?? []).map((f) => ({
    nombre: f.name,
    original: f.raw_label,
    normalizado: f.normalized_value ?? valorNormalizado(f.points, f.weight),
    peso: f.weight,
    puntos: f.points,
    nota:
      f.name === "Consistencia" && f.raw_label === "Sin historial suficiente"
        ? NOTA_CONSISTENCIA_NEUTRA
        : null,
  }));

  return (
    <div className="mz-stack">
      <p className="mz-small mz-faint mb-0">
        Calculado el {fechaHora(d.last_updated)} · Calidad del dato:{" "}
        {porcentaje(d.data_quality?.pct)}
      </p>
      <AdvertenciasDeValidacion advertencias={d.validation_warnings} />

      <Seccion
        id="gk-score"
        titulo={NOMBRE_DESEMPENO}
        ayuda="performanceScore"
        accion={<BotonExplicar onClick={() => setExplicar(true)} />}
      >
        <Puntaje
          valor={ps.score}
          clasificacion={ps.classification}
          tono={
            TONO_CLASIFICACION[ps.classification] ??
            tonoDe(ps.classification_color)
          }
        />
        <BarraDeZonas
          puntaje={ps.score}
          tramos={TRAMOS_DESEMPENO}
          clasificacion={ps.classification}
        />
        <dl className="gh-tarjeta-kv gh-tarjeta-kv--estrecha mt-2 mb-2">
          {ps.factors.map((f) => (
            <div key={f.name} className="gk-contents">
              <dt>
                {f.name} <span className="mz-faint">({f.raw_label})</span>
              </dt>
              <dd>{numero(f.points, 2)} pts</dd>
            </div>
          ))}
        </dl>
        <Confianza
          calidad={confianza.data_quality_pct}
          confiabilidad={confianza.reliability_pct}
          compacta
        />
      </Seccion>

      <Equilibrio usuarioId={usuarioId} propia={propia} />
      <Referencia usuarioId={usuarioId} />
      <Alertas alertas={d.alerts} historial={d.alerts_history} />

      <div className="gk-rejilla-3">
        <Consistencia resultado={d.consistency} calidad={d.data_quality?.pct} />
        <Anomalias resultado={d.anomalies} />
        <Prediccion resultado={d.prediction} calidad={d.data_quality?.pct} />
      </div>
      <div className="mz-grid-2 mz-grid-2--even">
        <Tendencias tendencias={d.trends} />
        <CalidadDelDato resultado={d.data_quality} />
      </div>
      <PrecisionTiempoObjetivo usuarioId={usuarioId} />

      {explicar && (
        <ExplicarCalculo
          titulo={NOMBRE_DESEMPENO}
          formula={ps.explain?.formula}
          pasos={ps.explain?.steps}
          factores={factores}
          datos={ps.factors.map((f) => `${f.name}: ${f.raw_label}`)}
          resultado={Math.round(ps.score)}
          interpretacion={ps.classification}
          version={d.engine_version}
          versionFormulas={d.formula_set_version}
          fecha={d.last_updated}
          fuente="Tareas del mes en curso, historial semanal de registros y actividades o comentarios documentados"
          referencia={REFERENCIA_CLASIFICACION}
          confianza={confianza}
          onCerrar={() => setExplicar(false)}
        />
      )}
    </div>
  );
}

function Alertas({ alertas = [], historial = [] }) {
  return (
    <Seccion id="gk-alertas" titulo="Alertas automáticas">
      {alertas.length === 0 ? (
        <>
          <p className="mb-1">
            <Semaforo tono="ok">Sin alertas críticas activas</Semaforo>
          </p>
          {historial.map((h) => (
            <p key={h.rule} className="mz-small mz-faint mb-0">
              Última alerta resuelta hace {h.days_ago}{" "}
              {h.days_ago === 1 ? "día" : "días"}: «{h.message}».{" "}
              <Semaforo tono="ok">Resuelta</Semaforo>
            </p>
          ))}
        </>
      ) : (
        <ul className="gk-lista">
          {alertas.map((a, i) => {
            const s = SEVERIDAD_ALERTA[a.severity] ?? SEVERIDAD_ALERTA.yellow;
            return (
              <li
                key={`${a.rule}-${i}`}
                className={`gk-alerta gk-alerta--${s.tono}`}
              >
                <p className="mb-1">
                  <Semaforo tono={s.tono}>{s.texto}</Semaforo>{" "}
                  {a.detected_at && (
                    <span className="mz-small mz-faint">
                      {fechaHora(a.detected_at)}
                    </span>
                  )}
                </p>
                <p className="mb-1">{a.message}</p>
                {a.suggested_action && (
                  <p className="mz-small mb-0">
                    Qué hacer: {a.suggested_action}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Seccion>
  );
}

function Consistencia({ resultado, calidad }) {
  const [explicar, setExplicar] = useState(false);
  if (!resultado) return null;
  return (
    <Seccion
      titulo="Consistencia"
      ayuda="consistencia"
      accion={
        resultado.available ? (
          <BotonExplicar
            texto="¿Cómo se obtuvo?"
            onClick={() => setExplicar(true)}
          />
        ) : null
      }
    >
      {!resultado.available ? (
        <SinDatos motivo={resultado.reason} />
      ) : (
        <>
          <p className="mb-1">
            <strong className="gk-grande">
              {porcentaje(resultado.consistency_pct)}
            </strong>{" "}
            <Semaforo tono={CONSISTENCIA_TONO[resultado.level] ?? "neutral"}>
              {resultado.label}
            </Semaforo>
          </p>
          <p className="mz-small mb-1">
            Variabilidad (cuánto cambia semana a semana):{" "}
            {numero(resultado.coefficient_of_variation)} %.{" "}
            {resultado.interpretation}
          </p>
          <p className="mz-small mz-faint mb-0">
            <Estrellas
              nivel={resultado.reliability?.stars ?? 1}
              titulo={resultado.reliability?.label ?? "Confiabilidad"}
            />{" "}
            {resultado.reliability?.label} ·{" "}
            {resultado.weeks_analyzed >= 1
              ? `${resultado.weeks_analyzed} ${resultado.weeks_analyzed === 1 ? "semana" : "semanas"} con datos válidos`
              : `${resultado.days_analyzed} ${resultado.days_analyzed === 1 ? "día" : "días"} con datos`}
          </p>
        </>
      )}
      {explicar && resultado.available && (
        <ExplicarCalculo
          titulo="Consistencia"
          pasos={resultado.explain?.steps ?? []}
          datos={[
            `${resultado.weeks_analyzed} semanas evaluadas`,
            `${resultado.days_analyzed} días con actividad`,
            ...(resultado.explain?.periods_used ?? []).map(
              (p) => `Semana usada: ${p}`,
            ),
            ...(resultado.explain?.periods_excluded ?? []).map(
              (p) => `Semana excluida: ${p.period} (${p.reason})`,
            ),
          ]}
          confianza={{
            data_quality_pct: calidad,
            reliability_pct: confiabilidadPorEstrellas(
              resultado.reliability?.stars,
            ),
          }}
          onCerrar={() => setExplicar(false)}
        />
      )}
    </Seccion>
  );
}

function Anomalias({ resultado }) {
  if (!resultado) return null;
  return (
    <Seccion titulo="Anomalías">
      {!resultado.available ? (
        <SinDatos motivo={resultado.reason} />
      ) : resultado.anomalies.length === 0 ? (
        <Semaforo tono="ok">Sin anomalías en este período</Semaforo>
      ) : (
        <ul className="gk-lista">
          {resultado.anomalies.map((a, i) => (
            <li key={`${a.message}-${i}`}>
              <Semaforo tono="warn">
                {a.severity === "orange" ? "Revisar" : "Monitorear"}
              </Semaforo>{" "}
              {a.message}
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}

const CONFIANZA_PREDICCION = {
  alta: "Confianza alta",
  media: "Confianza media",
  baja: "Confianza baja",
};

function Prediccion({ resultado, calidad }) {
  if (!resultado) return null;
  return (
    <Seccion id="gk-prediccion" titulo="Predicción">
      {!resultado.available ? (
        <SinDatos motivo={resultado.reason} />
      ) : (
        <>
          <dl className="gh-tarjeta-kv gh-tarjeta-kv--estrecha mb-2">
            <dt>Carga de la próxima semana</dt>
            <dd>{numero(resultado.carga_proxima_semana_horas)} h</dd>
            <dt>Cumplimiento proyectado</dt>
            <dd>
              {porcentaje(resultado.cumplimiento_estimado_cierre_mes)}
              {resultado.cumplimiento_estimado_rango && (
                <span className="mz-faint">
                  {" "}
                  (entre {porcentaje(
                    resultado.cumplimiento_estimado_rango.min,
                  )}{" "}
                  y {porcentaje(resultado.cumplimiento_estimado_rango.max)})
                </span>
              )}
            </dd>
            {resultado.horas_para_rango_optimo > 0 && (
              <>
                <dt>Horas para el rango óptimo</dt>
                <dd>{numero(resultado.horas_para_rango_optimo)} h</dd>
              </>
            )}
          </dl>
          {/* Una sola etiqueta de confianza: la del servidor. */}
          <p className="mz-small mz-faint mb-2">
            {CONFIANZA_PREDICCION[resultado.confidence] ?? resultado.confidence}{" "}
            ({porcentaje(resultado.confidence_pct)}) · {resultado.weeks_of_data}{" "}
            {resultado.weeks_of_data === 1 ? "semana" : "semanas"} de datos ·
            proyección máxima de {resultado.max_projection_days} días
          </p>
          <Confianza calidad={calidad} compacta />
        </>
      )}
    </Seccion>
  );
}

const FILAS_TENDENCIA = [
  ["semana_anterior", "Frente a la semana anterior"],
  ["mes_anterior", "Frente al mes anterior"],
  ["promedio_6_meses", "Frente al promedio de 6 meses"],
];

function FilaTendencia({ etiqueta, t }) {
  if (!t) return null;
  if (!t.available) {
    return (
      <tr>
        <th scope="row">{etiqueta}</th>
        <td colSpan={2}>
          <SinDatos motivo={t.reason} />
        </td>
      </tr>
    );
  }
  const s = TENDENCIA[t.direction] ?? TENDENCIA.estable;
  return (
    <tr>
      <th scope="row">{etiqueta}</th>
      <td>
        <Semaforo tono={s.tono}>
          {s.flecha} {s.texto}
        </Semaforo>
      </td>
      <td className="num">
        {conSigno(t.absolute_diff)} % ({numero(t.current)} % frente a{" "}
        {numero(t.compared)} %)
      </td>
    </tr>
  );
}

function Tendencias({ tendencias }) {
  if (!tendencias) return null;
  return (
    <Seccion titulo="Tendencias">
      {[
        ["cumplimiento", "Cumplimiento"],
        ["carga", "Carga laboral"],
      ].map(([clave, titulo]) => (
        <div key={clave} className="mz-table-wrap gk-tabla-chica">
          <table className="mz-table">
            <caption className="gk-caption">{titulo}</caption>
            <tbody>
              {FILAS_TENDENCIA.map(([k, e]) => (
                <FilaTendencia
                  key={k}
                  etiqueta={e}
                  t={tendencias[clave]?.[k]}
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </Seccion>
  );
}

function CalidadDelDato({ resultado }) {
  if (!resultado) return null;
  const tono =
    resultado.pct >= 90 ? "ok" : resultado.pct >= 70 ? "warn" : "bad";
  return (
    <Seccion titulo="Calidad de los datos">
      <p className="mb-1">
        <strong className="gk-grande">{porcentaje(resultado.pct)}</strong>{" "}
        <Semaforo tono={tono}>
          {tono === "ok" ? "Buena" : tono === "warn" ? "Mejorable" : "Baja"}
        </Semaforo>
      </p>
      {resultado.issues?.length ? (
        <ul className="mz-small mb-0">
          {resultado.issues.map((i) => (
            <li key={i.key}>
              {i.label}: <strong>{numero(i.count, 0)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mz-small mb-0">Sin problemas de calidad detectados.</p>
      )}
    </Seccion>
  );
}

// --- Equilibrio Operativo -----------------------------------------------------------

function Equilibrio({ usuarioId, propia }) {
  const carga = useCarga(
    () => kpiService.equilibrio(usuarioId),
    [usuarioId],
    "No se pudo cargar el Equilibrio Operativo.",
  );
  const [explicar, setExplicar] = useState(false);
  const d = carga.datos;
  return (
    <Seccion
      titulo="Equilibrio Operativo"
      ayuda="equilibrioOperativo"
      accion={
        d ? (
          <BotonExplicar
            texto="Ver detalle del cálculo"
            onClick={() => setExplicar(true)}
          />
        ) : null
      }
    >
      {!d ? (
        <EstadoSeccion carga={carga} />
      ) : (
        <div className="mz-stack">
          <Puntaje
            valor={d.health_score.score}
            clasificacion={d.estado.estado}
            tono={tonoDe(d.estado.color)}
          />
          <p className="mz-small mb-0">
            {d.trend.available
              ? `${TENDENCIA[d.trend.direction]?.verbo ?? ""} ${d.trend.score_delta ? `${conSigno(d.trend.score_delta)} pts ` : ""}frente a hace 30 días.`
              : (d.trend.reason ??
                "Sin historial suficiente para mostrar tendencia.")}
          </p>
          <BarraDeZonas
            puntaje={d.health_score.score}
            tramos={tramosDeEscala(d.escala)}
            clasificacion={d.estado.estado}
          />
          <div>
            <h4 className="gk-subtitulo">¿Qué significa este resultado?</h4>
            <p className="mb-0">{segunVista(d.meaning, propia)}</p>
          </div>
          <div>
            <h4 className="gk-subtitulo">Dimensiones</h4>
            <ul className="gk-dimensiones">
              {d.dimensiones.map((dim) => (
                <li key={dim.name} className="gh-recuadro">
                  <p className="mz-strong mb-1 d-flex justify-content-between gap-2">
                    <span>{dim.name}</span>
                    <span>{numero(dim.points, 2)} pts</span>
                  </p>
                  <p className="mz-small mb-1">
                    Valor: {dim.raw_label} · Peso: {numero(dim.weight)} %
                  </p>
                  <p className="mz-small mz-faint mb-0">{dim.explicacion}</p>
                </li>
              ))}
            </ul>
          </div>
          {sinRelleno(d.strengths).length > 0 && (
            <div>
              <h4 className="gk-subtitulo">¿Qué fortalece este resultado?</h4>
              <ul className="mb-0">
                {sinRelleno(d.strengths).map((s) => (
                  <li key={s.id}>{s.hallazgo}</li>
                ))}
              </ul>
            </div>
          )}
          {d.weaknesses?.length > 0 && (
            <div>
              <h4 className="gk-subtitulo">¿Qué reduce este resultado?</h4>
              <ul className="mb-0">
                {d.weaknesses.map((w) => (
                  <li key={w.id}>
                    <strong>{w.hallazgo}</strong> {w.explicacion}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h4 className="gk-subtitulo">¿Qué impacto tiene?</h4>
            <p className="mb-0">{segunVista(d.impact, propia)}</p>
          </div>
          {d.recommendations?.length > 0 && (
            <div>
              <h4 className="gk-subtitulo">
                ¿Qué se puede hacer para mejorar?
              </h4>
              {d.recommendations.map((r, i) => (
                <Accion key={`${r.what}-${i}`} accion={r} propia={propia} />
              ))}
            </div>
          )}
          <div className="mz-table-wrap gk-tabla-chica">
            <table className="mz-table">
              <caption className="gk-caption">Escala de interpretación</caption>
              <tbody>
                {d.escala.map((t) => (
                  <tr
                    key={t.estado}
                    className={
                      t.estado === d.estado.estado
                        ? "gk-fila-actual"
                        : undefined
                    }
                    aria-current={
                      t.estado === d.estado.estado ? "true" : undefined
                    }
                  >
                    <th scope="row">{t.rango}</th>
                    <td>
                      <Semaforo tono={tonoDe(t.color)}>{t.estado}</Semaforo>
                    </td>
                    <td>{t.explicacion_ejecutiva}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mz-small mz-faint">
            <p className="mb-1">Calculado el {fechaHora(d.calidad.fecha)}</p>
            {d.calidad.advertencias?.map((a) => (
              <p key={a} className="gt-texto--warn mb-1">
                {a}
              </p>
            ))}
          </div>
          <Confianza
            calidad={d.confidence?.data_quality_pct}
            confiabilidad={d.confidence?.reliability_pct}
            compacta
          />
          {explicar && (
            <ExplicarCalculo
              titulo="Equilibrio Operativo"
              formula={d.health_score.explain?.formula}
              pasos={d.health_score.explain?.steps}
              factores={d.dimensiones.map((dim) => ({
                nombre: dim.name,
                original: dim.raw_label,
                normalizado: dim.normalized_value,
                peso: dim.weight,
                puntos: dim.points,
              }))}
              datos={[
                `${d.calidad.registros_utilizados.semanas_consistencia} semanas de historial de consistencia`,
                `${d.calidad.registros_utilizados.dias_consistencia} días con registro analizados`,
              ]}
              resultado={Math.round(d.health_score.score)}
              interpretacion={d.estado.estado}
              version={d.calidad.engine_version}
              versionFormulas={d.calidad.formula_set_version}
              fecha={d.calidad.fecha}
              fuente={d.calidad.origen}
              referencia={REFERENCIA_CLASIFICACION}
              confianza={d.confidence}
              onCerrar={() => setExplicar(false)}
            />
          )}
        </div>
      )}
    </Seccion>
  );
}

/** Una acción sugerida: qué, a quién, cuánto, cuándo e impacto esperado. */
export function Accion({ accion, propia = false }) {
  if (!accion) return null;
  return (
    <dl className="gk-accion">
      <dt>Qué</dt>
      <dd>{accion.what}</dd>
      <dt>A quién</dt>
      <dd>{segunVista(accion.who, propia)}</dd>
      <dt>Cuánto</dt>
      <dd>{accion.how_much}</dd>
      <dt>Cuándo</dt>
      <dd>{accion.when}</dd>
      <dt>Impacto esperado</dt>
      <dd>
        {accion.impact?.length
          ? accion.impact
              .map((i) => `${conSigno(i.delta)} ${i.unit} en ${i.metric}`)
              .join(" · ")
          : accion.impact_note ||
            "Impacto no estimable con los datos actuales."}
      </dd>
    </dl>
  );
}

// --- Referencia utilizada (Benchmark Inteligente) ---------------------------------------

const METRICAS = [
  ["performance", NOMBRE_DESEMPENO, " pts"],
  ["operational_risk", "Índice de Riesgo Operativo", " pts"],
  ["cumplimiento", "Cumplimiento", " %"],
  ["carga_laboral", "Carga laboral", " %"],
  ["capacidad_futura", "Capacidad futura", " %"],
];

const MODO = {
  cargo: "Comparando contra el promedio del cargo",
  "cargo-limitado":
    "Comparando contra el promedio del cargo (muestra limitada)",
  personal: "Comparando contra su propio historial",
};

const valorCon = (v, u) =>
  v === null || v === undefined ? "Sin dato" : `${numero(v)}${u}`;
const diferencia = (v, u) =>
  v === null || v === undefined
    ? ""
    : ` (${conSigno(v)}${u.trim() === "pts" ? " pts" : u})`;

function Referencia({ usuarioId }) {
  const carga = useCarga(
    () => kpiService.referencia(usuarioId),
    [usuarioId],
    "No se pudo cargar la referencia utilizada.",
  );
  const d = carga.datos;
  return (
    <Seccion titulo="Referencia utilizada">
      {!d ? (
        <EstadoSeccion carga={carga} />
      ) : (
        <div className="mz-stack">
          <p className="mb-0">
            <Semaforo tono="info">
              {MODO[d.benchmark.mode] ?? d.benchmark.mode}
            </Semaforo>
          </p>
          <p className="mz-small mb-0">{d.benchmark.explain?.reason}</p>
          <div className="mz-table-wrap">
            <table className="mz-table gt-tabla">
              <caption className="visually-hidden">
                Comparación por indicador
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="gt-fija">
                    Indicador
                  </th>
                  <th scope="col" className="num">
                    Actual
                  </th>
                  {d.benchmark.mode === "personal" ? (
                    <>
                      <th scope="col" className="num">
                        Mejor histórico
                      </th>
                      <th scope="col" className="num">
                        Promedio 90 días
                      </th>
                      <th scope="col" className="num">
                        Mes anterior
                      </th>
                    </>
                  ) : (
                    <>
                      <th scope="col" className="num">
                        Promedio del cargo
                      </th>
                      <th scope="col" className="num">
                        Diferencia
                      </th>
                      <th scope="col" className="num">
                        Percentil
                        <span className="visually-hidden">
                          {" "}
                          (de cada 100 personas del cargo, cuántas quedan por
                          debajo)
                        </span>
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {METRICAS.map(([clave, nombre, u]) => {
                  const m = d.benchmark[clave];
                  if (!m) return null;
                  return (
                    <tr key={clave}>
                      <th scope="row" className="gt-fija">
                        {nombre}
                        {m.note && (
                          <span className="mz-small mz-faint d-block">
                            {m.note}
                          </span>
                        )}
                      </th>
                      <td className="num">{valorCon(m.value, u)}</td>
                      {d.benchmark.mode === "personal" ? (
                        <>
                          <td className="num">
                            {valorCon(m.best_ever, u)}
                            {diferencia(m.best_ever_diff, u)}
                          </td>
                          <td className="num">
                            {valorCon(m.avg_last_90_days, u)}
                            {diferencia(m.avg_last_90_days_diff, u)}
                          </td>
                          <td className="num">
                            {valorCon(m.mes_anterior, u)}
                            {diferencia(m.mes_anterior_diff, u)}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="num">{valorCon(m.peer_average, u)}</td>
                          <td className="num">
                            {m.diff_from_average != null
                              ? `${conSigno(m.diff_from_average)}${u}`
                              : "—"}
                          </td>
                          <td className="num">
                            {m.percentile != null
                              ? numero(m.percentile, 0)
                              : "—"}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {d.evolution?.available && (
            <p className="mz-small mb-0">
              Evolución personal: actual {numero(d.evolution.current)}, mejor{" "}
              {numero(d.evolution.best_ever)}, promedio{" "}
              {numero(d.evolution.average)}, peor{" "}
              {numero(d.evolution.worst_ever)} · {d.evolution.observations}{" "}
              observaciones en {d.evolution.span_weeks} semanas.
            </p>
          )}
          <p className="mz-small mz-faint mb-0">
            Período: {d.benchmark.explain?.period_analyzed}
          </p>
          <Confianza
            calidad={d.confidence?.data_quality_pct}
            confiabilidad={d.confidence?.reliability_pct}
            compacta
          />
        </div>
      )}
    </Seccion>
  );
}

// --- Precisión del Tiempo Objetivo -----------------------------------------------------

function PrecisionTiempoObjetivo({ usuarioId }) {
  const carga = useCarga(
    () => kpiService.precisionTiempoObjetivo(usuarioId),
    [usuarioId],
    "No se pudo cargar la precisión del Tiempo Objetivo.",
  );
  const d = carga.datos;
  return (
    <Seccion
      id="gk-tiempo-objetivo"
      titulo="Precisión del Tiempo Objetivo"
      ayuda="tiempoObjetivo"
    >
      {!d ? (
        <EstadoSeccion carga={carga} />
      ) : !d.available ? (
        <SinDatos motivo={d.reason} />
      ) : (
        <>
          <p className="mb-1">
            <strong className="gk-grande">
              {porcentaje(d.avg_precision_pct)}
            </strong>{" "}
            <Semaforo tono="info">{d.classification}</Semaforo>
          </p>
          <p className="mz-small mb-1">
            {d.sample_size}{" "}
            {d.sample_size === 1 ? "tarea completada" : "tareas completadas"}{" "}
            este mes con horas reales registradas.
          </p>
          <p className="mz-small mz-faint mb-0">
            El {porcentaje(d.validated_pct)} de la muestra usó el Tiempo
            Objetivo validado como referencia; el resto, el inicial. No
            reemplaza al Puntaje de desempeño.
          </p>
        </>
      )}
    </Seccion>
  );
}

// --- Histórico de un puntaje ------------------------------------------------------------

const PERIODOS = [
  [1, "Último mes"],
  [3, "Últimos 3 meses"],
  [6, "Últimos 6 meses"],
  [12, "Último año"],
];

export function HistorialDePuntaje({ usuarioId, tipo, titulo }) {
  const [meses, setMeses] = useState(3);
  const carga = useCarga(
    () => kpiService.historial(usuarioId, tipo, meses),
    [usuarioId, tipo, meses],
    "No se pudo cargar el histórico.",
  );
  const puntos = (carga.datos?.points ?? []).map((p) => ({
    // Día y hora: puede haber varios cálculos el mismo día.
    etiqueta: new Date(p.date).toLocaleString("es-EC", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Guayaquil",
    }),
    valor: tipo === "performance_score" ? Math.round(p.score) : p.score,
  }));
  const id = `gk-hist-${tipo}`;
  return (
    <Seccion
      titulo={`${titulo}: evolución`}
      accion={
        <div className="gk-periodo">
          <label className="visually-hidden" htmlFor={id}>
            Período del histórico de {titulo}
          </label>
          <select
            id={id}
            className="form-select form-select-sm"
            value={meses}
            onChange={(e) => setMeses(Number(e.target.value))}
          >
            {PERIODOS.map(([m, t]) => (
              <option key={m} value={m}>
                {t}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <EstadoSeccion
        carga={carga}
        vacio={puntos.length === 0}
        textoVacio="Sin historial suficiente en este período."
      />
      {puntos.length > 0 && <LineaDePuntaje datos={puntos} nombre={titulo} />}
      <p className="mz-small mz-faint mb-0">
        Un punto por cada cálculo registrado: no se interpola ni se recalcula el
        historial.
      </p>
    </Seccion>
  );
}
