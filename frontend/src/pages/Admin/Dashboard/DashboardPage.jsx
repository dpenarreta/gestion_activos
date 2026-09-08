import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { dashboardService } from "../../../api/activosService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { formatearMoneda } from "../../../utils/formato";
import "./Dashboard.css";

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Panel principal" }];

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/**
 * Panel principal (§15 del documento funcional).
 *
 * Cada indicador enlaza al listado ya filtrado: un número suelto solo informa,
 * y lo que el usuario quiere hacer al ver «4 en mantenimiento» es justamente
 * ver cuáles son.
 */
export function DashboardPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    dashboardService
      .indicadores()
      .then(setDatos)
      .catch(() => setError("No se pudieron cargar los indicadores."));
  }, []);

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }
  if (!datos) {
    return <p className="text-muted">Cargando…</p>;
  }

  const {
    activos,
    mantenimientos,
    garantias,
    fuera_de_operacion: fueraDeOperacion,
    equipos_mas_reparados: ranking,
  } = datos;

  return (
    <div className="dashboard-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <h2>Panel principal</h2>

      <section className="indicadores-grid mb-4">
        <Indicador
          valor={activos.total}
          etiqueta="Activos registrados"
          destino="/admin/activos"
          icono="pc-display"
        />
        <Indicador
          valor={activos.en_uso}
          etiqueta="Asignados"
          destino="/admin/activos?estado=en_uso"
          icono="person-check"
          variante="ok"
        />
        <Indicador
          valor={activos.en_bodega}
          etiqueta="Disponibles"
          destino="/admin/activos?estado=en_bodega"
          icono="box-seam"
        />
        <Indicador
          valor={activos.en_mantenimiento}
          etiqueta="En reparación"
          destino="/admin/activos?estado=en_mantenimiento"
          icono="tools"
          variante="info"
        />
        <Indicador
          valor={activos.requieren_renovacion}
          etiqueta="Por renovar"
          destino="/admin/renovacion/sugerencias"
          icono="exclamation-triangle"
          variante={activos.requieren_renovacion > 0 ? "alerta" : undefined}
        />
        <Indicador
          valor={garantias.vencidas}
          etiqueta="Garantías vencidas"
          destino="/admin/activos?garantia=vencida"
          icono="shield-x"
          variante={garantias.vencidas > 0 ? "alerta" : undefined}
        />
        <Indicador
          valor={garantias.por_vencer}
          etiqueta={`Garantías por vencer (${garantias.dias_de_aviso} d)`}
          destino="/admin/activos?garantia=por_vencer"
          icono="shield-exclamation"
          variante={garantias.por_vencer > 0 ? "alerta" : undefined}
        />
        <Indicador
          valor={activos.dados_de_baja}
          etiqueta="Dados de baja"
          destino="/admin/activos?estado=dado_de_baja"
          icono="archive"
          variante="apagado"
        />
      </section>

      {garantias.sin_registrar > 0 && (
        <div className="alert alert-secondary py-2 small">
          {/* Se distingue de «vencida» a propósito: mezclarlas haría que un
              inventario a medio capturar pareciera un parque sin cobertura. */}
          {garantias.sin_registrar} activo(s) no tienen fecha de garantía registrada, así que no
          entran en los conteos de arriba.{" "}
          <Link to="/admin/activos?garantia=sin_registrar">Completarlos</Link>.
        </div>
      )}

      <div className="row g-3">
        <div className="col-lg-7">
          <section className="card tarjeta-panel">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-baseline mb-3">
                <h3 className="h6 text-uppercase text-muted mb-0">Mantenimientos</h3>
                <Link to="/admin/mantenimientos" className="small">
                  Ver bitácora
                </Link>
              </div>

              <div className="row text-center g-2 mb-3">
                <Cifra valor={mantenimientos.del_mes} etiqueta="Este mes" />
                <Cifra valor={mantenimientos.total_historico} etiqueta="Histórico" />
                <Cifra
                  valor={formatearMoneda(mantenimientos.costo_del_mes)}
                  etiqueta="Costo del mes"
                />
                <Cifra
                  valor={formatearMoneda(mantenimientos.costo_acumulado)}
                  etiqueta="Costo acumulado"
                />
              </div>

              <p className="text-muted small mb-3">
                {fueraDeOperacion.total_dias} día(s) acumulados fuera de operación en{" "}
                {fueraDeOperacion.intervenciones_cerradas} intervención(es) cerradas
                {fueraDeOperacion.intervenciones_abiertas > 0 &&
                  ` · ${fueraDeOperacion.intervenciones_abiertas} equipo(s) aún en reparación`}
                .
              </p>

              <GraficoMensual series={mantenimientos.por_mes} />
            </div>
          </section>
        </div>

        <div className="col-lg-5">
          <section className="card tarjeta-panel">
            <div className="card-body">
              <h3 className="h6 text-uppercase text-muted mb-3">Equipos más reparados</h3>
              {ranking.length === 0 ? (
                <p className="text-muted mb-0">Sin intervenciones registradas.</p>
              ) : (
                <ul className="list-unstyled mb-0 ranking">
                  {ranking.map((equipo) => (
                    <li key={equipo.id}>
                      <Link to={`/admin/activos/${equipo.id}`} className="ranking__enlace">
                        <span className="ranking__nombre">
                          {equipo.nombre}
                          <small className="d-block text-muted">
                            {equipo.tipo} · {equipo.departamento}
                          </small>
                        </span>
                        <span className="ranking__valor">{equipo.total_mantenimientos}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        <div className="col-lg-6">
          <TablaDistribucion
            titulo="Por tipo de dispositivo"
            filas={datos.por_tipo_dispositivo.map((f) => ({
              nombre: f.nombre_tipo,
              total: f.total,
            }))}
          />
        </div>

        <div className="col-lg-6">
          <TablaDistribucion
            titulo="Por área"
            filas={datos.por_departamento.map((f) => ({
              nombre: f.nombre_departamento,
              total: f.total,
              detalle: `${f.asignados} asignados`,
            }))}
          />
        </div>
      </div>

      {activos.sin_asignar_mas_de_90_dias > 0 && (
        <div className="alert alert-info mt-3">
          <i className="bi bi-info-circle me-1" aria-hidden="true" />
          {activos.sin_asignar_mas_de_90_dias} activo(s) llevan más de 90 días en bodega sin
          asignarse.{" "}
          <Link to="/admin/activos?estado=en_bodega">Revisarlos</Link>.
        </div>
      )}

      {datos.indicadores_no_disponibles.length > 0 && (
        <p className="text-muted small mt-3 mb-0">
          {/* Se dice qué falta y por qué, en vez de omitir el indicador en
              silencio o mostrar un cero que se leería como «ninguna». */}
          Indicadores del documento funcional aún no disponibles:{" "}
          {datos.indicadores_no_disponibles.map((i) => i.motivo).join(" ")}
        </p>
      )}
    </div>
  );
}

function Indicador({ valor, etiqueta, destino, icono, variante }) {
  return (
    <Link to={destino} className={`indicador-panel ${variante ? `indicador-panel--${variante}` : ""}`}>
      <i className={`bi bi-${icono} indicador-panel__icono`} aria-hidden="true" />
      <span className="indicador-panel__valor">{valor}</span>
      <span className="indicador-panel__etiqueta">{etiqueta}</span>
    </Link>
  );
}

function Cifra({ valor, etiqueta }) {
  return (
    <div className="col-6 col-md-3">
      <div className="cifra">
        <div className="cifra__valor">{valor}</div>
        <div className="cifra__etiqueta">{etiqueta}</div>
      </div>
    </div>
  );
}

/**
 * Barras de los últimos meses.
 *
 * Se dibuja con divs y no con una librería de gráficos: son seis barras y una
 * escala, y sumar una dependencia de gráficos al bundle por esto costaría más
 * de lo que aporta.
 */
function GraficoMensual({ series }) {
  if (!series || series.length === 0) {
    return <p className="text-muted small mb-0">Sin intervenciones en los últimos meses.</p>;
  }
  const maximo = Math.max(...series.map((s) => s.total), 1);

  return (
    <div className="grafico-mensual" role="img" aria-label="Reparaciones por mes">
      {series.map((punto) => {
        const fecha = new Date(`${punto.mes}T00:00:00`);
        const etiqueta = `${MESES[fecha.getMonth()]} ${String(fecha.getFullYear()).slice(2)}`;
        return (
          <div className="grafico-mensual__columna" key={punto.mes}>
            <span className="grafico-mensual__valor">{punto.total}</span>
            <div
              className="grafico-mensual__barra"
              style={{ height: `${(punto.total / maximo) * 100}%` }}
              title={`${etiqueta}: ${punto.total}`}
            />
            <span className="grafico-mensual__mes">{etiqueta}</span>
          </div>
        );
      })}
    </div>
  );
}

function TablaDistribucion({ titulo, filas }) {
  const total = filas.reduce((suma, fila) => suma + fila.total, 0);

  return (
    <section className="card tarjeta-panel">
      <div className="card-body">
        <h3 className="h6 text-uppercase text-muted mb-3">{titulo}</h3>
        {filas.length === 0 ? (
          <p className="text-muted mb-0">Sin datos.</p>
        ) : (
          <ul className="list-unstyled mb-0 distribucion">
            {filas.map((fila) => (
              <li key={fila.nombre}>
                <div className="distribucion__fila">
                  <span>{fila.nombre}</span>
                  <span className="distribucion__total">
                    {fila.detalle && <small className="text-muted me-2">{fila.detalle}</small>}
                    {fila.total}
                  </span>
                </div>
                <div className="distribucion__barra">
                  <div style={{ width: `${total ? (fila.total / total) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
