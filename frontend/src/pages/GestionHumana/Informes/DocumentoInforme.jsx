/* eslint-disable jsx-a11y/no-redundant-roles, jsx-a11y/no-interactive-element-to-noninteractive-role --
 * Roles de tabla explícitos a propósito: en teléfono las tablas se apilan con
 * `display: block` (`.ie-apilable`) y Chrome y Safari dejan entonces de
 * exponerlas como tabla al lector de pantalla. Repetir table/rowgroup/row/
 * columnheader/rowheader/cell conserva la semántica (auditoría UX/UI). */
/*
 * Las once páginas del informe ejecutivo (`renderReportHtml.ts` de Nexo),
 * pintadas dentro de la intranet y listas para imprimir. Se alimentan solo de
 * `pages`, que el servidor ya arma (`apps.informes.documento`) con las
 * etiquetas formateadas en la hora de Ecuador: aquí no se recalcula nada, así
 * que la pantalla, el PDF y el Excel nunca difieren.
 *
 * En Nexo el documento era una cadena HTML que se escapaba a mano; aquí es
 * JSX, que escapa todo texto: nada del informe se interpreta como HTML.
 *
 * Los títulos van en español; los nombres de Nexo («Executive Summary»…) se
 * conservan entre paréntesis donde la gente ya los conoce. Cada página es una
 * hoja al imprimir (`Informes.css`, `@media print`).
 */
import { useId } from "react";

import { rolLegible } from "../Tareas/tareasComunes";
import { Semaforo } from "../Desempeno/Componentes";
import { TONO_NIVEL, tonoDe } from "../Desempeno/kpiComunes";
import { CUADRANTE } from "./informesComunes";

const GUION = "—";

/** Las versiones llegan sin prefijo; el guion (sin dato) se deja tal cual. */
const version = (v) => (v && v !== GUION ? `v${v}` : GUION);

/** La marca de que la narrativa no viene de un modelo de IA. */
export function MarcaSinIa() {
  return (
    <Semaforo tono="info" className="ie-sin-ia">
      Narrativa sin IA (texto determinista)
    </Semaforo>
  );
}

function Pagina({
  numero,
  total,
  reportId,
  titulo,
  antetitulo,
  extra,
  children,
}) {
  const id = `${useId()}-titulo`;
  return (
    <section className="ie-pagina" aria-labelledby={id}>
      <p className="ie-antetitulo">
        {antetitulo ?? `Página ${numero} de ${total}`}
      </p>
      <div className="ie-pagina__cabecera">
        <h3 id={id} className="ie-h3">
          {titulo}
        </h3>
        {extra}
      </div>
      {children}
      <footer className="ie-pie">
        Gestión Humana · Informe ejecutivo · {reportId} · Página {numero} de{" "}
        {total}
      </footer>
    </section>
  );
}

function Bloque({ titulo, children }) {
  return (
    <div className="ie-bloque">
      <h4 className="ie-h4">{titulo}</h4>
      {children}
    </div>
  );
}

function Parrafo({ children }) {
  return <p className="ie-p">{children}</p>;
}

function Lista({ elementos }) {
  if (!elementos?.length)
    return <p className="ie-tenue">Sin elementos para este período.</p>;
  return (
    <ul className="ie-lista">
      {elementos.map((e, i) => (
        // Los textos pueden repetirse: el índice desempata.
        <li key={`${i}-${e}`}>{e}</li>
      ))}
    </ul>
  );
}

function Tarjeta({ etiqueta, valor, detalle }) {
  return (
    <div className="ie-tarjeta">
      <p className="ie-tarjeta__etiqueta">{etiqueta}</p>
      <p className="ie-tarjeta__valor">{valor}</p>
      {detalle && <p className="ie-tarjeta__detalle">{detalle}</p>}
    </div>
  );
}

/** Pares «dato: valor» con la semántica de una lista de definiciones. */
function Datos({ filas }) {
  return (
    <dl className="ie-datos">
      {filas
        .filter(([, valor]) => valor !== null && valor !== undefined)
        .map(([dato, valor]) => (
          <div key={dato}>
            <dt>{dato}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
    </dl>
  );
}

/**
 * Lo que el lector del PDF debe saber antes de leer: la ficha de estado del
 * visor no se imprime, así que la integridad parcial y el origen migrado van
 * también en la portada.
 */
function AvisosDeConfianza({ integridad, origen }) {
  const parcial = integridad === "PARTIAL";
  const migrado = origen === "LEGACY_MIGRATION";
  if (!parcial && !migrado) return null;
  return (
    <div className="ie-portada__avisos">
      {parcial && (
        <p className="ie-p mb-0">
          <Semaforo tono="warn">Integridad parcial</Semaforo> El motor detectó
          diferencias entre los cálculos al generar este informe: léalo con
          cautela.
        </p>
      )}
      {migrado && (
        <p className="ie-p mb-0">
          <Semaforo tono="warn">Migrado de Nexo</Semaforo> Informe traído del
          sistema anterior: algunos datos pueden faltar.
        </p>
      )}
    </div>
  );
}

const TEXTO_INTEGRIDAD = {
  FULL: "Completa",
  PARTIAL: "Parcial (con incidentes detectados al generar)",
};
const TEXTO_ORIGEN = {
  GENERATED: "Generado en la intranet",
  LEGACY_MIGRATION: "Migrado de Nexo",
};

function Portada({ p, integridad, origen, ...marco }) {
  return (
    <Pagina
      {...marco}
      titulo={p.tipoReporteLabel}
      antetitulo="Gestión Humana · Informe ejecutivo"
    >
      <div className="ie-portada">
        <AvisosDeConfianza integridad={integridad} origen={origen} />
        <p className="ie-portada__periodo">{p.periodLabel}</p>
        <div className="ie-portada__estado">
          <p className="ie-tarjeta__etiqueta">Estado general</p>
          <p className="ie-portada__nivel">{p.estadoGeneralLabel}</p>
          {p.scoreGeneral !== null && p.scoreGeneral !== undefined && (
            <Semaforo tono={tonoDe(p.estadoGeneralColor)}>
              {p.scoreGeneral}/100
            </Semaforo>
          )}
          {p.semaforoLabel && (
            <p className="ie-p ie-portada__explicacion">{p.semaforoLabel}</p>
          )}
        </div>
        <Datos
          filas={[
            ["Fecha de corte", p.fechaCorteLabel],
            ["Generado", p.generatedAtLabel],
            ["Generado por", p.generatedByName],
            [
              "Report ID",
              <span key="id" className="ie-mono">
                {p.reportId}
              </span>,
            ],
            ["Motor de analítica", version(p.analyticsEngineVersion)],
            ["Conjunto de fórmulas", version(p.formulaSetVersion)],
          ]}
        />
        {p.closureStatusLabel && (
          <div className="ie-portada__cierre">
            <Datos
              filas={[
                ["Estado del período", p.closureStatusLabel],
                ["Cobertura", p.coverageLabel],
                ["Días hábiles considerados", p.workingDaysConsideredLabel],
                ["Horas base consideradas", p.workingHoursConsideredLabel],
              ]}
            />
          </div>
        )}
        {p.metodologicalNoteLabel && (
          <p className="ie-p ie-nota">{p.metodologicalNoteLabel}</p>
        )}
      </div>
    </Pagina>
  );
}

function ResumenEjecutivo({ p, sinIa, ...marco }) {
  return (
    <Pagina
      {...marco}
      titulo="Resumen ejecutivo (Executive Summary)"
      extra={sinIa && <MarcaSinIa />}
    >
      <Bloque titulo="Situación general">
        <Parrafo>{p.situacionGeneral}</Parrafo>
      </Bloque>
      <Bloque titulo="Fortalezas">
        <Parrafo>{p.fortalezas}</Parrafo>
      </Bloque>
      <Bloque titulo="Aspectos de atención">
        <Parrafo>{p.aspectosAtencion}</Parrafo>
      </Bloque>
      <Bloque titulo="Conclusión">
        <Parrafo>{p.conclusion}</Parrafo>
      </Bloque>
    </Pagina>
  );
}

function EstadoDelEquipo({ p, ...marco }) {
  return (
    <Pagina {...marco} titulo="Estado general del equipo">
      {p.indicators.map((i) => (
        <div key={i.nombre} className="ie-indicador">
          <div className="ie-indicador__cabecera">
            <h4 className="ie-h4 mb-0">{i.nombre}</h4>
            <span className="ie-indicador__valor">{i.valor}</span>
          </div>
          <p className="ie-indicador__meta">
            Meta: {i.meta} · Estado: {i.estado}
          </p>
          <p className="ie-kv">
            <b>Interpretación:</b> {i.interpretacion || GUION}
          </p>
          <p className="ie-kv">
            <b>Impacto:</b> {i.impacto || GUION}
          </p>
          <p className="ie-kv">
            <b>Recomendación:</b> {i.recomendacion || GUION}
          </p>
        </div>
      ))}
    </Pagina>
  );
}

const MAX_RANKING = 15;

function IndicadoresEstrategicos({ p, ...marco }) {
  const ranking = p.ranking.slice(0, MAX_RANKING);
  return (
    <Pagina {...marco} titulo="Indicadores estratégicos">
      <div className="ie-rejilla">
        {p.kpis.map((k) => (
          <Tarjeta
            key={k.label}
            etiqueta={k.label}
            valor={k.valor}
            detalle={k.sublabel}
          />
        ))}
      </div>
      <h4 className="ie-h4">Ranking</h4>
      {ranking.length === 0 ? (
        <p className="ie-tenue">Sin colaboradores en el ranking.</p>
      ) : (
        <>
          <div className="ie-tabla-marco">
            <table className="ie-tabla ie-apilable" role="table">
              <caption className="visually-hidden">
                Ranking del equipo por puntaje
              </caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">
                    <abbr title="Posición">#</abbr>
                  </th>
                  <th scope="col" role="columnheader">
                    Nombre
                  </th>
                  <th scope="col" role="columnheader">
                    Rol
                  </th>
                  <th scope="col" role="columnheader">
                    Puntaje
                  </th>
                  <th scope="col" role="columnheader">
                    Cumplimiento
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {ranking.map((r, i) => (
                  <tr role="row" key={`${r.id ?? r.name}-${i}`}>
                    <td role="cell" data-etiqueta="Posición">
                      {i + 1}
                    </td>
                    <th scope="row" role="rowheader" data-etiqueta="Nombre">
                      {r.name}
                    </th>
                    <td role="cell" data-etiqueta="Rol">
                      {rolLegible(r.role) || GUION}
                    </td>
                    <td role="cell" data-etiqueta="Puntaje">
                      {r.score}
                    </td>
                    <td role="cell" data-etiqueta="Cumplimiento">
                      {r.completedPct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.ranking.length > MAX_RANKING && (
            <p className="ie-tenue">
              Se muestran los {MAX_RANKING} primeros de {p.ranking.length}. El
              Excel trae el ranking completo.
            </p>
          )}
        </>
      )}
    </Pagina>
  );
}

function DetallePorColaborador({ p, ...marco }) {
  return (
    <Pagina {...marco} titulo="Detalle por colaborador">
      {p.members.length === 0 ? (
        <p className="ie-tenue">Sin colaboradores en este informe.</p>
      ) : (
        <div className="ie-tabla-marco">
          <table className="ie-tabla ie-apilable" role="table">
            <caption className="visually-hidden">
              Indicadores de cada colaborador del informe
            </caption>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">
                  Nombre
                </th>
                <th scope="col" role="columnheader">
                  Rol
                </th>
                <th scope="col" role="columnheader">
                  Cumplimiento
                </th>
                <th scope="col" role="columnheader">
                  Carga
                </th>
                <th scope="col" role="columnheader">
                  Vencidas
                </th>
                <th scope="col" role="columnheader">
                  Equilibrio operativo
                </th>
                <th scope="col" role="columnheader">
                  Acción sugerida
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {p.members.map((m, i) => (
                <tr role="row" key={`${m.id ?? m.name}-${i}`}>
                  <th scope="row" role="rowheader" data-etiqueta="Nombre">
                    {m.name}
                  </th>
                  <td role="cell" data-etiqueta="Rol">
                    {rolLegible(m.role) || GUION}
                  </td>
                  <td role="cell" data-etiqueta="Cumplimiento">
                    {m.completedPct}%
                  </td>
                  <td role="cell" data-etiqueta="Carga">
                    {m.cargaLabel ? (
                      <Semaforo tono={tonoDe(m.cargaColor)}>
                        {m.cargaLabel}
                      </Semaforo>
                    ) : (
                      GUION
                    )}
                  </td>
                  <td role="cell" data-etiqueta="Vencidas">
                    {m.overdueCount ?? 0}
                  </td>
                  <td role="cell" data-etiqueta="Equilibrio operativo">
                    {m.estadoOperativo?.estado || GUION}
                  </td>
                  <td role="cell" data-etiqueta="Acción sugerida">
                    {m.principalHallazgo || GUION}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Pagina>
  );
}

const MAX_MOTIVOS = 8;

function DistribucionOperativa({ p, ...marco }) {
  const motivos = p.consultasByReason.slice(0, MAX_MOTIVOS);
  const cuadrantes = {};
  for (const q of p.riskQuadrant)
    cuadrantes[q.quadrant] = (cuadrantes[q.quadrant] ?? 0) + 1;
  return (
    <Pagina {...marco} titulo="Distribución operativa">
      <h4 className="ie-h4">Distribución por motivo</h4>
      {motivos.length === 0 ? (
        <p className="ie-tenue">Sin consultas registradas en este período.</p>
      ) : (
        <>
          {/* Barras sin librería de gráficos (como Nexo). El dato va también
              en texto: la barra es solo apoyo visual. */}
          <ul className="ie-barras">
            {motivos.map((m) => {
              const pct = Math.max(0, Math.min(100, Number(m.pct) || 0));
              return (
                <li key={m.reason} className="ie-barras__fila">
                  <span className="ie-barras__etiqueta">{m.reason}</span>
                  <span className="ie-barras__pista" aria-hidden="true">
                    <span
                      className="ie-barras__relleno"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="ie-barras__valor">{m.pct ?? 0}%</span>
                </li>
              );
            })}
          </ul>
          {motivos.map((m) => (
            <div key={m.reason} className="ie-indicador">
              <div className="ie-indicador__cabecera">
                <span className="ie-indicador__nombre">{m.reason}</span>
                <span className="ie-indicador__valor">{m.pct ?? 0}%</span>
              </div>
              <p className="ie-indicador__meta">
                {m.count} {m.count === 1 ? "consulta" : "consultas"} ·{" "}
                {m.totalMinutes} min en total
                {m.trendPct !== null && m.trendPct !== undefined
                  ? ` · tendencia ${m.trendPct > 0 ? "+" : ""}${m.trendPct}%`
                  : ""}
              </p>
              {m.interpretation && <p className="ie-kv">{m.interpretation}</p>}
            </div>
          ))}
        </>
      )}
      <h4 className="ie-h4 ie-separado">
        Matriz de riesgo (cumplimiento × carga)
      </h4>
      {Object.keys(cuadrantes).length === 0 ? (
        <p className="ie-tenue">Sin datos para la matriz de riesgo.</p>
      ) : (
        <div className="ie-rejilla">
          {Object.entries(cuadrantes).map(([q, n]) => (
            <Tarjeta
              key={q}
              etiqueta={CUADRANTE[q] ?? q}
              valor={n}
              detalle={n === 1 ? "colaborador" : "colaboradores"}
            />
          ))}
        </div>
      )}
    </Pagina>
  );
}

function Hallazgos({ p, sinIa, ...marco }) {
  return (
    <Pagina
      {...marco}
      titulo="Hallazgos ejecutivos (Executive Insights)"
      extra={sinIa && <MarcaSinIa />}
    >
      <Bloque titulo="Patrones">
        <Lista elementos={p.patrones} />
      </Bloque>
      <Bloque titulo="Cambios">
        <Lista elementos={p.cambios} />
      </Bloque>
      <Bloque titulo="Anomalías">
        <Lista elementos={p.anomalias} />
      </Bloque>
      <Bloque titulo="Relaciones cruzadas">
        <Lista elementos={p.relacionesCruzadas} />
      </Bloque>
      {p.hallazgosBase?.length > 0 && (
        <Bloque titulo="Hallazgos del motor">
          <Lista elementos={p.hallazgosBase} />
        </Bloque>
      )}
      {p.insightsBase?.length > 0 && (
        <Bloque titulo="Lecturas del equipo">
          <Lista elementos={p.insightsBase} />
        </Bloque>
      )}
    </Pagina>
  );
}

function Evaluacion({ p, sinIa, ...marco }) {
  return (
    <Pagina
      {...marco}
      titulo={
        sinIa
          ? "Evaluación ejecutiva (Executive Assessment)"
          : "Evaluación ejecutiva (Executive Assessment by NOVA)"
      }
      extra={sinIa && <MarcaSinIa />}
    >
      <Bloque titulo="Diagnóstico general">
        <Parrafo>{p.diagnosticoGeneral}</Parrafo>
      </Bloque>
      <Bloque titulo="Fortalezas estratégicas">
        <Lista elementos={p.fortalezasEstrategicas} />
      </Bloque>
      <Bloque titulo="Riesgos detectados">
        <Lista elementos={p.riesgosDetectados} />
      </Bloque>
      <Bloque titulo="Oportunidades">
        <Lista elementos={p.oportunidades} />
      </Bloque>
      <Bloque titulo="Prioridades">
        <Lista elementos={p.prioridades} />
      </Bloque>
      <Bloque titulo="Perspectiva estratégica">
        <Parrafo>{p.perspectivaEstrategica}</Parrafo>
      </Bloque>
      <Bloque titulo="Opinión ejecutiva">
        <Parrafo>
          <em>{p.opinionEjecutiva}</em>
        </Parrafo>
      </Bloque>
    </Pagina>
  );
}

const DETALLE_RECOMENDACION = [
  ["justificacion", "Justificación"],
  ["impactoEsperado", "Impacto esperado"],
  ["areaAfectada", "Área afectada"],
  ["beneficio", "Beneficio"],
  ["complejidadEstimada", "Complejidad estimada"],
  ["tiempoEstimado", "Tiempo estimado"],
  ["responsableSugerido", "Responsable sugerido"],
];

function GrupoDeRecomendaciones({ titulo, tono, filas }) {
  if (!filas.length) return null;
  return (
    <Bloque titulo={`Prioridad ${titulo.toLowerCase()}`}>
      {filas.map((r) => (
        <div key={r.id} className="ie-indicador">
          <div className="ie-indicador__cabecera">
            <span className="ie-indicador__nombre">{r.text}</span>
            <Semaforo tono={tono}>{titulo}</Semaforo>
          </div>
          {r.enrichment &&
            DETALLE_RECOMENDACION.map(
              ([campo, etiqueta]) =>
                r.enrichment[campo] && (
                  <p key={campo} className="ie-kv">
                    <b>{etiqueta}:</b> {r.enrichment[campo]}
                  </p>
                ),
            )}
        </div>
      ))}
    </Bloque>
  );
}

function Recomendaciones({ p, ...marco }) {
  return (
    <Pagina {...marco} titulo="Recomendaciones">
      <GrupoDeRecomendaciones titulo="Alta" tono="bad" filas={p.alta} />
      <GrupoDeRecomendaciones titulo="Media" tono="warn" filas={p.media} />
      {p.alta.length === 0 && p.media.length === 0 && (
        <p className="ie-tenue">Sin recomendaciones para este período.</p>
      )}
    </Pagina>
  );
}

function Predictiva({ p, ...marco }) {
  const titulo = "Analítica predictiva";
  if (!p.available) {
    return (
      <Pagina {...marco} titulo={titulo}>
        <Parrafo>{p.message}</Parrafo>
      </Pagina>
    );
  }
  const esperado = p.avgCumplimientoEsperadoCierrePct;
  return (
    <Pagina
      {...marco}
      titulo={titulo}
      antetitulo={`Página ${marco.numero} de ${marco.total} · Proyección al ${p.asOfLabel}`}
    >
      <div className="ie-rejilla">
        <Tarjeta
          etiqueta="Horizonte de proyección"
          valor={`${p.horizonDays} días`}
        />
        <Tarjeta
          etiqueta="Cumplimiento esperado al cierre"
          valor={
            esperado === null || esperado === undefined ? GUION : `${esperado}%`
          }
        />
        <Tarjeta
          etiqueta="Colaboradores en riesgo de sobrecarga"
          valor={p.membersAtRiskSobrecarga}
        />
      </div>
      <h4 className="ie-h4">Por colaborador</h4>
      {p.members.length === 0 ? (
        <p className="ie-tenue">Sin colaboradores para proyectar.</p>
      ) : (
        p.members.map((m, i) => (
          <div key={`${m.id ?? m.name}-${i}`} className="ie-indicador">
            <div className="ie-indicador__cabecera">
              <span className="ie-indicador__nombre">{m.name}</span>
              {m.sobrecargaNivel && m.sobrecargaNivel !== GUION && (
                <Semaforo tono={TONO_NIVEL[m.sobrecargaNivel] ?? "neutral"}>
                  Sobrecarga: {m.sobrecargaNivel}
                </Semaforo>
              )}
            </div>
            <p className="ie-kv">
              <b>Cumplimiento:</b> {m.cumplimientoLabel}
            </p>
            <p className="ie-kv">
              <b>Carga:</b> {m.sobrecargaLabel}
            </p>
            <p className="ie-kv">
              <b>Subutilización:</b> {m.subutilizacionLabel}
            </p>
            {m.queHacer?.length > 0 && (
              <p className="ie-kv">
                <b>Qué hacer:</b> {m.queHacer[0]}
              </p>
            )}
          </div>
        ))
      )}
    </Pagina>
  );
}

function Metadatos({ p, integridad, origen, ...marco }) {
  const filas = [
    [
      "Report ID",
      <span key="id" className="ie-mono">
        {p.reportId}
      </span>,
    ],
    ["Generado por", p.generatedByName],
    ["Fecha de generación", p.generatedAtLabel],
    ["Fecha de corte", p.fechaCorteLabel],
    ["Período", p.periodLabel],
    ["Tipo de informe", p.tipoReporteLabel],
    ["Estado del período", p.periodStatusLabel],
    ["Colaboradores incluidos", String(p.collaboratorCount ?? GUION)],
    ["Narrativa", p.narrativaLabel ?? GUION],
    ["Integridad", TEXTO_INTEGRIDAD[integridad] ?? GUION],
    ["Origen", TEXTO_ORIGEN[origen] ?? GUION],
    ["Versión del motor de analítica", version(p.analyticsEngineVersion)],
    ["Versión del conjunto de fórmulas", version(p.formulaSetVersion)],
    ["Versión del motor de informes", version(p.reportingEngineVersion)],
    ["Versión de Nexo", version(p.nexoVersion)],
    ["Calidad del dato", `${p.dataQualityPct ?? 0}%`],
    ["Tiempo de generación", p.generationMsLabel],
  ];
  return (
    <Pagina {...marco} titulo="Metadatos" antetitulo="Última página">
      <div className="ie-tabla-marco">
        <table className="ie-tabla ie-tabla--metadatos" role="table">
          <caption className="visually-hidden">Metadatos del informe</caption>
          <tbody role="rowgroup">
            {filas.map(([dato, valor]) => (
              <tr role="row" key={dato}>
                <th scope="row" role="rowheader">
                  {dato}
                </th>
                <td role="cell">{valor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.metodologicalNoteLabel && (
        <p className="ie-p ie-nota">{p.metodologicalNoteLabel}</p>
      )}
    </Pagina>
  );
}

const PAGINA = {
  cover: Portada,
  executiveSummary: ResumenEjecutivo,
  teamStatus: EstadoDelEquipo,
  strategicIndicators: IndicadoresEstrategicos,
  memberDetail: DetallePorColaborador,
  operationalDistribution: DistribucionOperativa,
  insights: Hallazgos,
  assessment: Evaluacion,
  recommendations: Recomendaciones,
  predictive: Predictiva,
  metadata: Metadatos,
};

/**
 * El documento completo. `sinIa`: la narrativa (resumen, hallazgos y
 * evaluación) es el texto determinista y no de un modelo de IA.
 */
export function DocumentoInforme({
  pages,
  reportId,
  sinIa = false,
  integridad,
  origen,
}) {
  const paginas = (pages ?? []).filter((p) => PAGINA[p?.kind]);
  return (
    <article className="ie-doc" aria-label={`Informe ${reportId}`}>
      {paginas.map((p, i) => {
        const Componente = PAGINA[p.kind];
        return (
          <Componente
            key={p.kind}
            p={p}
            sinIa={sinIa}
            integridad={integridad}
            origen={origen}
            numero={i + 1}
            total={paginas.length}
            reportId={reportId}
          />
        );
      })}
    </article>
  );
}
