/*
 * Resumen ejecutivo del equipo (`ExecutiveDashboard` de Nexo, `kpi.ejecutivo`):
 * el bloque ejecutivo por reglas (estado, cambios y qué atender hoy; sin IA),
 * los indicadores del mes, la tendencia de 6 meses, las alertas críticas, el
 * ranking del equipo y la carga del mes. «Modo ejecutivo» resume además el
 * riesgo operativo (con `inteligencia_preventiva.ver`) y la capacidad.
 *
 * Las «ideas pendientes» de Nexo no existen en la intranet: el servidor las
 * envía vacías y no se muestran.
 */
import { useState } from "react";

import { kpiService } from "../../../api/kpiService";
import {
  KPI_EJECUTIVO,
  RIESGO_VER,
} from "../../../modulos/permisosGestionHumana";
import { Encabezado } from "../Tareas/ContextoTareas";
import { rolLegible } from "../Tareas/tareasComunes";
import { EstadoSeccion, Indicador, Seccion, Semaforo } from "./Componentes";
import { ConAccesoKpi, useCarga, useKpi } from "./ContextoKpi";
import { BarrasDeCargaDelEquipo, LineaDeCumplimiento } from "./Graficos";
import {
  CUMPLIMIENTO_TEXTO,
  TONO_RIESGO,
  conSigno,
  horas,
  nombreDelMes,
  NOMBRE_DESEMPENO,
  numero,
  porcentaje,
  puntos,
  tonoDe,
} from "./kpiComunes";

export function ResumenEjecutivo() {
  return (
    <ConAccesoKpi titulo="Resumen ejecutivo" permiso={KPI_EJECUTIVO}>
      <PantallaEjecutiva />
    </ConAccesoKpi>
  );
}

function Tendencia({ delta, sufijo = " puntos porcentuales" }) {
  const tono = delta > 0 ? "ok" : delta < 0 ? "bad" : "neutral";
  const texto = delta > 0 ? "Sube" : delta < 0 ? "Baja" : "Sin cambio";
  return (
    <Semaforo tono={tono}>
      {texto}
      {delta !== 0 && ` ${numero(Math.abs(delta))}${sufijo}`}
    </Semaforo>
  );
}

function PantallaEjecutiva() {
  const { can } = useKpi();
  const carga = useCarga(
    () => kpiService.ejecutivo(),
    [],
    "No se pudo cargar el resumen ejecutivo.",
  );
  const [modo, setModo] = useState(false);
  const d = carga.datos;

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Resumen ejecutivo"
        descripcion="El estado de su equipo ejecutor en el mes, calculado por reglas fijas."
      >
        {d?.ranking?.length > 0 && (
          <button
            type="button"
            className={`btn ${modo ? "btn-primary" : "btn-outline-secondary"}`}
            aria-pressed={modo}
            onClick={() => setModo((v) => !v)}
          >
            Modo ejecutivo
          </button>
        )}
      </Encabezado>
      {!d ? (
        <EstadoSeccion carga={carga} />
      ) : d.ranking.length === 0 ? (
        <p className="mz-empty mb-0">
          No hay personas para mostrar en el resumen ejecutivo: no tiene un
          equipo ejecutor a cargo según el organigrama.
        </p>
      ) : (
        <div className="mz-stack">
          <BloqueEjecutivo ceo={d.ceo} mes={d.month} />
          {modo ? (
            <VistaModoEjecutivo datos={d} veRiesgo={can(RIESGO_VER)} />
          ) : (
            <Detalle datos={d} />
          )}
        </div>
      )}
    </div>
  );
}

function BloqueEjecutivo({ ceo, mes }) {
  return (
    <Seccion
      titulo={`Estado del equipo${mes ? ` · ${nombreDelMes(mes)}` : ""}`}
    >
      <div className="mz-stack">
        <p className="mb-0">
          <Semaforo tono={tonoDe(ceo.estado)}>{ceo.estado_label}</Semaforo>
        </p>
        <div className="mz-kpi-grid">
          <Indicador
            etiqueta={`${NOMBRE_DESEMPENO} del equipo`}
            valor={puntos(ceo.performance.avg)}
            tono={tonoDe(ceo.performance.color)}
            textoTono={ceo.performance.classification}
          />
          <Indicador
            etiqueta="Riesgo operativo del equipo"
            valor={numero(ceo.operational_risk.avg)}
            tono={
              TONO_RIESGO[ceo.operational_risk.classification] ??
              tonoDe(ceo.operational_risk.color)
            }
            sub={
              <Semaforo
                tono={
                  TONO_RIESGO[ceo.operational_risk.classification] ??
                  tonoDe(ceo.operational_risk.color)
                }
              >
                Riesgo{" "}
                {String(ceo.operational_risk.classification).toLowerCase()}
              </Semaforo>
            }
          />
        </div>
        {ceo.cambios?.length > 0 && (
          <div>
            <h4 className="gk-subtitulo">Cambios desde el último cálculo</h4>
            <ul className="gk-lista">
              {ceo.cambios.map((c) => (
                <li key={c.text}>
                  <Semaforo tono={c.positive ? "ok" : "warn"}>
                    {c.positive ? "A favor" : "Atención"}
                  </Semaforo>{" "}
                  {c.text}
                </li>
              ))}
            </ul>
          </div>
        )}
        {ceo.atender?.length ? (
          <div>
            <h4 className="gk-subtitulo">Hoy debe atender</h4>
            <ol className="mb-0">
              {ceo.atender.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="mb-0">Sin puntos críticos que atender hoy.</p>
        )}
      </div>
    </Seccion>
  );
}

function Detalle({ datos: d }) {
  const alertas = d.alerts.low_cumplimiento.length + d.alerts.sobrecarga.length;
  const etiquetas = Object.fromEntries(
    d.ranking.map((m) => [m.id, m.carga_label]),
  );
  return (
    <>
      <div className="mz-kpi-grid">
        <Indicador
          etiqueta="Cumplimiento del equipo"
          valor={porcentaje(d.overview.avg_cumplimiento)}
          tono={tonoDe(d.overview.avg_cumplimiento_color)}
          textoTono={CUMPLIMIENTO_TEXTO[d.overview.avg_cumplimiento_color]}
        />
        <Indicador
          etiqueta="En sobrecarga"
          valor={d.overview.sobrecarga_count}
          tono={d.overview.sobrecarga_count > 0 ? "bad" : "ok"}
          textoTono={
            d.overview.sobrecarga_count > 0 ? "Requiere atención" : "Nadie"
          }
        />
        <Indicador
          etiqueta="En subutilización"
          valor={d.overview.subutilizacion_count}
          tono={d.overview.subutilizacion_count > 0 ? "bad" : "ok"}
          textoTono={
            d.overview.subutilizacion_count > 0 ? "Requiere atención" : "Nadie"
          }
        />
        <Indicador
          etiqueta="Horas del equipo este mes"
          valor={horas(d.overview.total_horas)}
        />
        <Indicador
          etiqueta="Consultas de seguimiento"
          valor={d.overview.total_consultas}
        />
      </div>

      <div className="mz-grid-2">
        <Seccion
          titulo="Cumplimiento del equipo: últimos 6 meses"
          accion={<Tendencia delta={d.trend_delta} />}
        >
          <LineaDeCumplimiento
            titulo={null}
            datos={d.trend.map((t) => ({
              label: t.label,
              completed_pct: t.avg_cumplimiento,
            }))}
          />
          {d.trend.length === 0 && (
            <p className="mz-faint mb-0">Sin historial de meses anteriores.</p>
          )}
        </Seccion>
        <Seccion titulo={`Alertas críticas (${alertas})`}>
          {alertas === 0 ? (
            <Semaforo tono="ok">Sin alertas este mes</Semaforo>
          ) : (
            <div className="mz-stack">
              {d.alerts.low_cumplimiento.length > 0 && (
                <div>
                  <h4 className="gk-subtitulo">Cumplimiento menor a 60 %</h4>
                  <ul className="gk-lista">
                    {d.alerts.low_cumplimiento.map((a) => (
                      <li key={a.user_id}>
                        {a.name}:{" "}
                        <Semaforo tono="bad">{porcentaje(a.value)}</Semaforo>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.alerts.sobrecarga.length > 0 && (
                <div>
                  <h4 className="gk-subtitulo">Sobrecarga</h4>
                  <ul className="gk-lista">
                    {d.alerts.sobrecarga.map((a) => (
                      <li key={a.user_id}>
                        {a.name}:{" "}
                        <Semaforo tono="bad">{porcentaje(a.value)}</Semaforo>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Seccion>
      </div>

      <Seccion titulo={`Ranking del equipo (${d.ranking.length})`}>
        <div className="mz-table-wrap">
          <table className="mz-table gt-tabla">
            <caption className="visually-hidden">
              Ranking del equipo por puntaje
            </caption>
            <thead>
              <tr>
                <th scope="col" className="num">
                  #
                </th>
                <th scope="col" className="gt-fija">
                  Persona
                </th>
                <th scope="col" className="num">
                  Cumplimiento
                </th>
                <th scope="col">Carga</th>
                <th scope="col" className="num">
                  Variación
                </th>
                <th scope="col" className="num">
                  Puntaje del mes (método anterior)
                </th>
              </tr>
            </thead>
            <tbody>
              {d.ranking.map((m, i) => (
                <tr key={m.id}>
                  <td className="num">{i + 1}</td>
                  <th scope="row" className="gt-fija">
                    {m.name}
                    <span className="mz-small mz-faint d-block">
                      {rolLegible(m.role)}
                    </span>
                  </th>
                  <td className="num">{porcentaje(m.completed_pct)}</td>
                  <td>
                    <Semaforo tono={tonoDe(m.carga_color)}>
                      {m.carga_label}
                    </Semaforo>
                  </td>
                  <td className="num">
                    {m.score_trend === 0
                      ? "Sin cambio"
                      : conSigno(m.score_trend)}
                  </td>
                  <td className="num">{numero(m.score, 0)}/100</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Seccion>

      <Seccion titulo="Carga laboral del equipo este mes">
        <BarrasDeCargaDelEquipo
          datos={d.workload.map((w) => ({ ...w, label: etiquetas[w.id] }))}
        />
        <p className="mz-small mz-faint mb-0">
          Base esperada según las horas efectivas configuradas; las horas reales
          van con el semáforo de cada persona.
        </p>
      </Seccion>
    </>
  );
}

function VistaModoEjecutivo({ datos: d, veRiesgo }) {
  const riesgo = useCarga(
    () => (veRiesgo ? kpiService.riesgoDelEquipo() : Promise.resolve(null)),
    [veRiesgo],
    "No se pudo cargar el riesgo operativo del equipo.",
  );
  const capacidad = useCarga(
    () => kpiService.capacidadDelEquipo(),
    [],
    "No se pudo cargar la capacidad del equipo.",
  );
  const promedio = Math.round(
    d.ranking.reduce((s, m) => s + m.score, 0) / d.ranking.length,
  );
  const sobrecargadas = d.ranking.filter(
    (m) => m.carga_color === "red" || m.carga_color === "orange",
  );
  const disponibles = (capacidad.datos?.members ?? []).filter(
    (m) => m.estado === "alta",
  );
  const miembrosRiesgo = riesgo.datos?.members ?? [];
  const promedioRiesgo = miembrosRiesgo.length
    ? Math.round(
        miembrosRiesgo.reduce((s, m) => s + m.score, 0) / miembrosRiesgo.length,
      )
    : null;
  const acciones = [...miembrosRiesgo]
    .filter(
      (m) => m.classification === "Alto" || m.classification === "Crítico",
    )
    .sort((a, b) => b.score - a.score)
    .flatMap((m) =>
      (m.suggested_actions ?? [])
        .filter((a) => !a.startsWith("Sin acciones"))
        .map((a) => `${m.name}: ${a}`),
    )
    .slice(0, 3);

  return (
    <div className="mz-stack">
      <div className="mz-kpi-grid">
        <Indicador
          etiqueta="Puntaje del mes promedio (método anterior)"
          valor={`${promedio}/100`}
        />
        {veRiesgo && (
          <Indicador
            etiqueta="Riesgo operativo del equipo"
            valor={
              riesgo.cargando
                ? "…"
                : promedioRiesgo !== null
                  ? `${promedioRiesgo}/100`
                  : "Sin datos"
            }
            sub={
              riesgo.datos && (
                <span className="gp-marcas">
                  <Semaforo tono="ok">
                    {riesgo.datos.summary.bajo} bajo
                  </Semaforo>
                  <Semaforo tono="warn">
                    {riesgo.datos.summary.medio} medio
                  </Semaforo>
                  <Semaforo tono="warn">
                    {riesgo.datos.summary.alto} alto
                  </Semaforo>
                  <Semaforo tono="bad">
                    {riesgo.datos.summary.critico} crítico
                  </Semaforo>
                </span>
              )
            }
          />
        )}
        <Indicador
          etiqueta="Tendencia del cumplimiento"
          valor={<Tendencia delta={d.trend_delta} />}
          sub="frente al mes anterior"
        />
      </div>
      {veRiesgo && riesgo.error && <EstadoSeccion carga={riesgo} />}
      <div className="mz-grid-2 mz-grid-2--even">
        <Seccion titulo="Personas sobrecargadas">
          {sobrecargadas.length === 0 ? (
            <Semaforo tono="ok">Nadie en sobrecarga</Semaforo>
          ) : (
            <ul className="mb-0">
              {sobrecargadas.map((m) => (
                <li key={m.id}>
                  {m.name}{" "}
                  <Semaforo tono={tonoDe(m.carga_color)}>
                    {m.carga_label}
                  </Semaforo>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
        <Seccion titulo="Con capacidad disponible">
          {!capacidad.datos ? (
            <EstadoSeccion carga={capacidad} />
          ) : disponibles.length === 0 ? (
            <p className="mz-faint mb-0">Nadie con capacidad alta este mes.</p>
          ) : (
            <ul className="mb-0">
              {disponibles.map((m) => (
                <li key={m.id}>
                  {m.name} <Semaforo tono="ok">{m.estado_label}</Semaforo>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      </div>
      {veRiesgo && (
        <Seccion titulo="Recomendaciones prioritarias">
          {acciones.length === 0 ? (
            <p className="mb-0">Sin riesgos altos o críticos este mes.</p>
          ) : (
            <ul className="mb-0">
              {acciones.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </Seccion>
      )}
    </div>
  );
}
