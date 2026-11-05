/*
 * Mis KPI (`MyKpisModule` de Nexo): los KPI propios de un mes y el informe
 * por rango de meses (de 2 a 24, lo valida el servidor). Para los roles de
 * dirección (Jefe Nacional, Administrador de Gestión Humana) sus
 * indicadores individuales de ejecución no son representativos: se dice y
 * se ofrece ir a los KPI del equipo.
 *
 * Fuera de alcance: el mensaje y los insights de Nova (IA). Los insights por
 * reglas sí van (Motor de Insights). Las descargas a Excel y PDF de Nexo
 * quedan pendientes.
 */
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { errorDeKpi, kpiService } from "../../../api/kpiService";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../../components/common/Pestanas/Pestanas";
import {
  KPI_ACCEDER,
  KPI_EQUIPO,
  RUTA_GESTION_HUMANA,
} from "../../../modulos/permisosGestionHumana";
import { ErrorEnLinea } from "../comunes";
import { Encabezado } from "../Tareas/ContextoTareas";
import { rolLegible } from "../Tareas/tareasComunes";
import { EstadoSeccion, Indicador, Seccion, Semaforo } from "./Componentes";
import { ConAccesoKpi, useCarga, useKpi } from "./ContextoKpi";
import { DetalleKpi } from "./DetalleKpi";
import { LineaDeCumplimiento } from "./Graficos";
import {
  CUMPLIMIENTO_TEXTO,
  colorDeResultado,
  horas,
  mesActual,
  motivoLegible,
  nombreDelMes,
  numero,
  porcentaje,
  sumarMeses,
  tonoDe,
} from "./kpiComunes";
import { Simulador } from "./Simulador";

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export function MisKpi() {
  return (
    <ConAccesoKpi titulo="Mis KPI" permiso={KPI_ACCEDER}>
      <PantallaMisKpi />
    </ConAccesoKpi>
  );
}

function PantallaMisKpi() {
  const { me, esDireccion, can } = useKpi();
  const [parametros, setParametros] = useSearchParams();
  const vista = parametros.get("vista") === "rango" ? "rango" : "mes";
  const rol = rolLegible(me?.role);

  if (esDireccion) {
    return (
      <div className="gh-page">
        <Encabezado titulo="Mis KPI" descripcion={rol} />
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="info-circle" />
          <div>
            <p className="mb-1">
              Este rol tiene funciones principalmente de supervisión y
              dirección: sus indicadores individuales de ejecución no son
              representativos.
            </p>
            {can(KPI_EQUIPO) && (
              <Link to={`${RUTA_GESTION_HUMANA}/kpi`}>
                Ver los KPI del equipo
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Mis KPI"
        descripcion={`Su desempeño del mes calculado por el motor de KPI${rol ? ` · ${rol}` : ""}.`}
      />
      <Pestanas
        etiqueta="Período de Mis KPI"
        idBase="gk-mis"
        valor={vista}
        onCambio={(v) =>
          setParametros(v === "rango" ? { vista: "rango" } : {}, {
            replace: true,
          })
        }
        opciones={[
          { id: "mes", etiqueta: "Mes" },
          { id: "rango", etiqueta: "Rango de meses" },
        ]}
      />
      <PanelDePestana idBase="gk-mis" valor={vista}>
        {vista === "mes" ? <VistaDelMes /> : <VistaPorRango />}
      </PanelDePestana>
    </div>
  );
}

function VistaDelMes() {
  const [mes, setMes] = useState(mesActual());
  const [simulando, setSimulando] = useState(false);
  const carga = useCarga(
    () => kpiService.misKpi(mes),
    [mes],
    "No se pudieron cargar sus KPI.",
  );
  const kpi = carga.datos;
  const enCurso = mes === mesActual();

  return (
    <div className="mz-stack">
      <div className="gk-barra">
        <div className="gk-mes">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setMes((m) => sumarMeses(m, -1))}
            aria-label="Mes anterior"
            title="Mes anterior"
          >
            <Icon name="chevron-left" />
          </button>
          <label className="visually-hidden" htmlFor="gk-mes">
            Mes
          </label>
          <input
            id="gk-mes"
            type="month"
            className="form-control form-control-sm"
            value={mes}
            max={mesActual()}
            onChange={(e) => MES.test(e.target.value) && setMes(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setMes((m) => sumarMeses(m, 1))}
            disabled={mes >= mesActual()}
            aria-label="Mes siguiente"
            title="Mes siguiente"
          >
            <Icon name="chevron-right" />
          </button>
        </div>
        <p className="mb-0" aria-live="polite">
          Período: <strong>{nombreDelMes(mes)}</strong>
        </p>
        {kpi && enCurso && (
          <button
            type="button"
            className="btn btn-outline-primary btn-sm ms-auto"
            onClick={() => setSimulando(true)}
          >
            <Icon name="sliders" /> ¿Qué pasaría si…?
          </button>
        )}
      </div>
      {!kpi ? (
        <EstadoSeccion carga={carga} />
      ) : (
        <DetalleKpi kpi={kpi} propia enCurso={enCurso} />
      )}
      {simulando && kpi && enCurso && (
        <Simulador
          usuarioId={kpi.user.id}
          nombre="Sus propios KPI del mes en curso"
          onCerrar={() => setSimulando(false)}
        />
      )}
    </div>
  );
}

const TENDENCIA_RANGO = {
  mejora: { texto: "En mejora", tono: "ok" },
  deterioro: { texto: "En deterioro", tono: "bad" },
  estancamiento: { texto: "Estable", tono: "neutral" },
};

function VistaPorRango() {
  const [desde, setDesde] = useState(sumarMeses(mesActual(), -5));
  const [hasta, setHasta] = useState(mesActual());
  const [informe, setInforme] = useState(null);
  const [error, setError] = useState(null);
  const [generando, setGenerando] = useState(false);
  const enCurso = useRef(false);

  async function generar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    if (!MES.test(desde) || !MES.test(hasta)) {
      setError("Elija el mes de inicio y el de fin.");
      return;
    }
    if (desde >= hasta) {
      setError("El mes de inicio debe ser anterior al de fin.");
      return;
    }
    enCurso.current = true;
    setGenerando(true);
    setError(null);
    try {
      const datos = await kpiService.misKpiPorRango(desde, hasta);
      setInforme(datos.report);
    } catch (err) {
      setInforme(null);
      setError(errorDeKpi(err, "No se pudo generar el informe.").mensaje);
    } finally {
      enCurso.current = false;
      setGenerando(false);
    }
  }

  const a = informe?.aggregated;
  const t = TENDENCIA_RANGO[informe?.trends?.cumplimiento_trend];

  return (
    <div className="mz-stack">
      <form className="gk-barra" onSubmit={generar}>
        <div>
          <label className="form-label" htmlFor="gk-desde">
            Desde
          </label>
          <input
            id="gk-desde"
            type="month"
            className="form-control"
            value={desde}
            max={mesActual()}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="gk-hasta">
            Hasta
          </label>
          <input
            id="gk-hasta"
            type="month"
            className="form-control"
            value={hasta}
            max={mesActual()}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={generando}>
          {generando ? "Calculando…" : "Generar informe"}
        </button>
      </form>
      <p className="mz-small mz-faint mb-0">Entre 2 y 24 meses.</p>
      <ErrorEnLinea mensaje={error} />
      {!informe && !error && !generando && (
        <p className="mz-empty mb-0">
          Elija un rango de meses y genere el informe.
        </p>
      )}
      {informe && (
        <div className="mz-stack" aria-live="polite">
          {t && (
            <p className="mb-0">
              Tendencia del cumplimiento:{" "}
              <Semaforo tono={t.tono}>{t.texto}</Semaforo> (
              {numero(informe.trends.first_month_cumplimiento)} % al inicio,{" "}
              {numero(informe.trends.last_month_cumplimiento)} % al final).
            </p>
          )}
          <div className="mz-kpi-grid">
            <Indicador
              etiqueta="Cumplimiento promedio"
              valor={porcentaje(a.avg_cumplimiento)}
              tono={tonoDe(colorDeResultado(a.avg_cumplimiento))}
              textoTono={
                CUMPLIMIENTO_TEXTO[colorDeResultado(a.avg_cumplimiento)]
              }
              sub={`${informe.months.length} meses`}
            />
            <Indicador
              etiqueta="Puntaje del mes promedio (método anterior)"
              valor={`${numero(a.avg_score, 0)}/100`}
              sub="sin considerar comentarios"
            />
            <Indicador
              etiqueta="Tareas completadas"
              valor={a.total_completed_tasks}
              sub={`de ${a.total_tasks} en total`}
            />
            <Indicador
              etiqueta="Horas acumuladas"
              valor={horas(a.total_carga_real_hours)}
              sub={`de ${horas(a.total_carga_base_hours)} de base`}
            />
            <Indicador
              etiqueta="Carga promedio"
              valor={porcentaje(a.avg_carga_pct)}
              tono={tonoDe(a.carga_color)}
              textoTono={a.carga_label}
            />
            <Indicador
              etiqueta="Consultas de seguimiento"
              valor={a.total_seguimiento}
              sub="acumuladas en el período"
            />
          </div>
          <Seccion titulo="Evolución mensual del cumplimiento">
            <LineaDeCumplimiento
              titulo={null}
              datos={informe.months.map((m) => ({
                label: m.label,
                completed_pct: m.completed_pct,
              }))}
            />
          </Seccion>
          <Seccion titulo="Detalle mensual">
            <div className="mz-table-wrap">
              <table className="mz-table gt-tabla">
                <caption className="visually-hidden">Detalle por mes</caption>
                <thead>
                  <tr>
                    <th scope="col" className="gt-fija">
                      Mes
                    </th>
                    <th scope="col" className="num">
                      Cumplimiento
                    </th>
                    <th scope="col" className="num">
                      Tareas
                    </th>
                    <th scope="col" className="num">
                      Vencidas
                    </th>
                    <th scope="col">Carga</th>
                    <th scope="col" className="num">
                      Puntaje (método anterior)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {informe.months.map((m) => (
                    <tr key={m.month}>
                      <th scope="row" className="gt-fija">
                        {m.label}
                      </th>
                      <td className="num">{porcentaje(m.completed_pct)}</td>
                      <td className="num">
                        {m.completed_tasks}/{m.total_tasks}
                      </td>
                      <td className="num">{m.overdue_count}</td>
                      <td>
                        {horas(m.carga_real_hours)}{" "}
                        <Semaforo tono={tonoDe(m.carga_color)}>
                          {m.carga_label}
                        </Semaforo>
                      </td>
                      <td className="num">{numero(m.score, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Seccion>
          {a.consultas_by_reason?.length > 0 && (
            <Seccion titulo="Consultas de seguimiento por motivo">
              <ul className="mb-0">
                {a.consultas_by_reason.map((r) => (
                  <li key={r.reason}>
                    {motivoLegible(r.reason)}: <strong>{r.count}</strong>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}
        </div>
      )}
    </div>
  );
}
