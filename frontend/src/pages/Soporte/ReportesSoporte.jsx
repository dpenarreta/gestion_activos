import { useEffect, useState } from "react";

import { soporteService } from "../../api/soporteService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { enHoras } from "./comunes";
import "./Soporte.css";

/* Los indicadores del piloto (§6.8 del flujo ITIL), con su meta. El color
 * sale del valor frente a la meta, y lo dice también con texto («Bajo la
 * meta»); antes era fijo y el SLA salía verde aunque estuviera bajo la meta
 * (auditoría UX/UI, 30/10/2026). `meta` recibe los indicadores: la del SLA
 * la fija cada empresa. */
const INDICADORES = [
  { clave: "creados", etiqueta: "Tickets creados", icono: "ticket-detailed" },
  { clave: "en_cola", etiqueta: "En cola", icono: "hourglass-split" },
  { clave: "en_atencion", etiqueta: "En atención", icono: "person-workspace" },
  { clave: "atendidos", etiqueta: "Atendidos", icono: "check2-circle" },
  {
    clave: "cumplimiento_respuesta",
    etiqueta: "Respondidos a tiempo",
    icono: "reply",
    meta: () => 90,
    nota: (k) =>
      k.respuestas_vencidas
        ? `${k.respuestas_vencidas} sin responder con el plazo vencido`
        : medidos(k.medidos_respuesta),
  },
  {
    clave: "cumplimiento_sla",
    etiqueta: "Solucionados a tiempo",
    icono: "speedometer",
    meta: (k) => k.meta_sla,
    nota: (k) =>
      k.vencidos_abiertos
        ? `${k.vencidos_abiertos} abierto${k.vencidos_abiertos === 1 ? "" : "s"} con el plazo vencido`
        : medidos(k.medidos_sla),
  },
  {
    clave: "fcr",
    etiqueta: "Resueltos en el primer contacto",
    icono: "1-circle",
    meta: () => 50,
  },
  {
    clave: "csat",
    etiqueta: "Satisfacción",
    icono: "star",
    meta: () => 4,
    nota: (k) =>
      k.respuesta_encuesta === null || k.respuesta_encuesta === undefined
        ? null
        : `${k.respuesta_encuesta} % respondió la encuesta`,
  },
  {
    clave: "reabiertos",
    etiqueta: "Reabiertos",
    icono: "arrow-counterclockwise",
    meta: () => 5,
    menorEsMejor: true,
  },
  {
    clave: "canal_oficial",
    etiqueta: "Pedidos por el sistema",
    icono: "globe",
    meta: () => 80,
  },
  {
    clave: "lead_time_promedio",
    etiqueta: "Tiempo hasta la 1.ª respuesta (lead time)",
    icono: "hourglass",
    nota: (k) =>
      `Desde que entra a la cola hasta la primera respuesta, en horas corridas; solo los ya respondidos (${k.medidos_lead ?? 0}). Los plazos, en la tabla.`,
  },
  {
    clave: "minutos_promedio",
    etiqueta: "Tiempo de trabajo (cycle time)",
    icono: "stopwatch",
    nota: (k) =>
      `Desde que se toma hasta solucionarlo, en horas corridas; solo los ya atendidos (${k.medidos_cycle ?? 0}).${k.en_cola ? ` ${k.en_cola} en cola aún sin plazo de solución.` : ""}`,
  },
  {
    clave: "escalados_sla",
    etiqueta: "Escalados por vencer el plazo",
    icono: "exclamation-octagon",
  },
  {
    clave: "horas_fuera_aprobadas",
    etiqueta: "Horas fuera de horario aprobadas",
    icono: "moon",
  },
];

const PORCENTAJES = new Set([
  "cumplimiento_sla",
  "cumplimiento_respuesta",
  "fcr",
  "reabiertos",
  "canal_oficial",
]);

function medidos(n) {
  if (n === undefined || n === null) return null;
  return n === 0
    ? "Aún no hay tickets para medir"
    : `${n} ticket${n === 1 ? "" : "s"} medido${n === 1 ? "" : "s"}`;
}

function duracion(minutos) {
  if (minutos < 48 * 60) return enHoras(minutos);
  return `${Math.floor(minutos / (24 * 60))} d ${Math.floor((minutos % (24 * 60)) / 60)} h`;
}

function valor(clave, kpis) {
  const dato = kpis[clave];
  if (dato === null || dato === undefined) return "—";
  if (PORCENTAJES.has(clave)) return `${dato} %`;
  if (clave === "csat") return `${dato} / 5`;
  if (clave === "minutos_promedio" || clave === "lead_time_promedio")
    return duracion(dato);
  if (clave === "horas_fuera_aprobadas") return `${Number(dato)} h`;
  return dato;
}

/** Frente a la meta: el tono y un texto que lo dice sin depender del color. */
function frenteALaMeta(indicador, kpis) {
  if (!indicador.meta) return { tono: "info", texto: null };
  const dato = kpis[indicador.clave];
  const meta = indicador.meta(kpis);
  const unidad = indicador.clave === "csat" ? " / 5" : " %";
  const signo = indicador.menorEsMejor ? "≤" : "≥";
  if (dato === null || dato === undefined)
    return { tono: "info", texto: `Meta ${signo} ${meta}${unidad}` };
  const cumple = indicador.menorEsMejor ? dato <= meta : dato >= meta;
  return {
    tono: cumple ? "ok" : "bad",
    // «No cumple», no «Bajo la meta»: en «Reabiertos» (menos es mejor)
    // «bajo» se leía como algo bueno.
    texto: `${cumple ? "Cumple la meta" : "No cumple la meta"} (${signo} ${meta}${unidad})`,
  };
}

function mesDe(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
}

/** Reportes → Mesa de ayuda: indicadores, gráficos y desempeño por técnico. */
export function ReportesSoporte() {
  // Por defecto, el mes en curso (antes «Todo», que mezclaba los meses).
  const [periodo, setPeriodo] = useState(() => mesDe(new Date()));
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [intento, setIntento] = useState(0);

  /* Auditoría UX/UI, fase 2 (28/10/2026): no decía «Cargando» y el error de
   * un período seguía a la vista al elegir otro. Cada consulta limpia el
   * error y una respuesta vieja no pisa la del período vigente. */
  useEffect(() => {
    let vigente = true;
    setError(null);
    setCargando(true);
    soporteService
      .reportes({ periodo })
      .then((respuesta) => {
        if (vigente) setDatos(respuesta);
      })
      .catch((err) => {
        if (!vigente) return;
        setDatos(null);
        setError(mensajeDeError(err, "No se pudieron calcular los reportes."));
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [periodo, intento]);

  const hoy = new Date();
  const meses = Array.from({ length: 12 }, (_, i) => {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    return [
      mesDe(fecha),
      fecha.toLocaleDateString("es-EC", { month: "long", year: "numeric" }),
    ];
  });

  return (
    <div className="soporte-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Reportes de la mesa de ayuda</h2>
          <p className="mz-desc">
            Indicadores del período, con su meta, y desempeño por técnico.
          </p>
        </div>
      </div>
      <div className="mz-filter-bar">
        <div className="mz-inline-field">
          <label htmlFor="rs-periodo">Periodo</label>
          <select
            id="rs-periodo"
            className="form-select form-select-sm"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
          >
            {meses.map(([v, etiqueta]) => (
              <option key={v} value={v}>
                {etiqueta}
              </option>
            ))}
            <option value={String(hoy.getFullYear())}>
              Año {hoy.getFullYear()}
            </option>
            <option value="">Todo</option>
          </select>
        </div>
      </div>
      <EstadoDeCarga
        cargando={cargando}
        error={error}
        onReintentar={() => setIntento((n) => n + 1)}
      />
      {datos && (
        <>
          <div className="mz-kpi-grid soporte-kpis">
            {INDICADORES.map((indicador) => {
              const { tono, texto } = frenteALaMeta(indicador, datos.kpis);
              const nota = indicador.nota?.(datos.kpis);
              return (
                <div key={indicador.clave} className={`mz-kpi mz-kpi--${tono}`}>
                  <div className="mz-kpi-top">
                    <span className="mz-kpi-label">{indicador.etiqueta}</span>
                    <span className="mz-kpi-icon">
                      <Icon name={indicador.icono} />
                    </span>
                  </div>
                  <div className="mz-kpi-value">
                    {valor(indicador.clave, datos.kpis)}
                  </div>
                  {texto && (
                    <div
                      className={`soporte-kpi-meta soporte-kpi-meta--${tono}`}
                    >
                      {tono === "bad" && <Icon name="exclamation-triangle" />}{" "}
                      {texto}
                    </div>
                  )}
                  {nota && <div className="soporte-kpi-nota">{nota}</div>}
                </div>
              );
            })}
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
              <h3>Cumplimiento de plazos por prioridad</h3>
            </div>
            <p className="mz-faint mz-small px-3 pt-2 mb-0">
              Cuentan los solucionados y los abiertos cuyo plazo ya venció. Los
              plazos son los de cada prioridad; una regla o un caso pueden
              cambiarlos.
            </p>
            <div className="mz-table-wrap">
              <table className="mz-table">
                <thead>
                  <tr>
                    <th>Prioridad</th>
                    <th className="num">Tickets</th>
                    <th className="num">Responder en</th>
                    <th className="num">Solucionar en</th>
                    <th className="num">A tiempo</th>
                    <th className="num">Meta</th>
                  </tr>
                </thead>
                <tbody>
                  {(datos.prioridades ?? []).map((p) => (
                    <tr key={p.prioridad}>
                      <td>{p.etiqueta}</td>
                      <td className="num">{p.tickets}</td>
                      <td className="num">
                        {p.plazo_respuesta ? duracion(p.plazo_respuesta) : "—"}
                      </td>
                      <td className="num">
                        {p.plazo_solucion ? duracion(p.plazo_solucion) : "—"}
                      </td>
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
                            {p.cumplimiento < p.meta && " · no cumple la meta"}
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
                    <th className="num">Solucionados a tiempo</th>
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
