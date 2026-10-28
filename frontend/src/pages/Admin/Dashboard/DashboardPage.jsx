import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { dashboardService } from "../../../api/activosService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { mensajeDeError } from "../../../utils/errores";
import { formatearDias, formatearMoneda } from "../../../utils/formato";
import "./Dashboard.css";

const MESES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
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

  const cargar = useCallback(() => {
    setError(null);
    setDatos(null);
    dashboardService
      .indicadores()
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar los indicadores.")),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cabecera = (
    <div className="mz-view-head">
      <div>
        <h2>Panel principal</h2>
        <p className="mz-desc">
          El estado del parque de un vistazo. Cada indicador abre el inventario
          ya filtrado.
        </p>
      </div>
    </div>
  );

  // Mientras carga o si falla, la cabecera se queda: antes el fallo pintaba
  // solo el aviso, sin título ni forma de reintentar, y «Cargando…» no se
  // anunciaba (revisión final UX/UI, 28/10/2026).
  if (error || !datos) {
    return (
      <div className="dashboard-page">
        {cabecera}
        <EstadoDeCarga cargando={!datos} error={error} onReintentar={cargar} />
      </div>
    );
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
      {cabecera}

      <section className="mz-kpi-grid">
        <Indicador
          valor={activos.total}
          etiqueta="Activos registrados"
          detalle="Todo el inventario de la empresa"
          destino="/admin/activos"
          icono="pc-display"
          variante="info"
        />
        <Indicador
          valor={activos.en_uso}
          etiqueta="Asignados"
          detalle="En manos de un custodio"
          destino="/admin/activos?estado=en_uso"
          icono="person-check"
          variante="ok"
        />
        <Indicador
          valor={activos.disponibles + activos.en_bodega}
          etiqueta="En almacén"
          detalle={`${activos.disponibles} disponibles · ${activos.en_bodega} en bodega`}
          destino="/admin/activos?almacenados=true"
          icono="box-seam"
        />
        <Indicador
          valor={activos.en_mantenimiento}
          etiqueta="En reparación"
          detalle="Con una intervención abierta"
          destino="/admin/activos?estado=en_mantenimiento"
          icono="tools"
          variante="info"
        />
        {/* Rojo para lo que ya pide una decisión, naranja para lo que la
            pedirá pronto; en cero, ni uno ni otro: un indicador que siempre
            está en color deja de llamar la atención justo cuando hace falta. */}
        <Indicador
          valor={activos.reemplazo_recomendado}
          etiqueta="Reemplazo recomendado"
          detalle="Según la política de renovación"
          destino="/admin/activos?nivel_renovacion=recomendado"
          icono="exclamation-octagon"
          variante={activos.reemplazo_recomendado > 0 ? "bad" : undefined}
        />
        <Indicador
          valor={activos.evaluar_reemplazo}
          etiqueta="Evaluar reemplazo"
          detalle="Cerca del umbral de renovación"
          destino="/admin/activos?nivel_renovacion=evaluar"
          icono="exclamation-triangle"
          variante={activos.evaluar_reemplazo > 0 ? "warn" : undefined}
        />
        <Indicador
          valor={garantias.vencidas}
          etiqueta="Garantías vencidas"
          detalle="Sin cobertura del proveedor"
          destino="/admin/activos?garantia=vencida"
          icono="shield-x"
          variante={garantias.vencidas > 0 ? "bad" : undefined}
        />
        <Indicador
          valor={garantias.por_vencer}
          etiqueta={`Garantías por vencer (${garantias.dias_de_aviso} d)`}
          detalle="Revisar antes de que venzan"
          destino="/admin/activos?garantia=por_vencer"
          icono="shield-exclamation"
          variante={garantias.por_vencer > 0 ? "warn" : undefined}
        />
        <Indicador
          valor={activos.dados_de_baja}
          etiqueta="Dados de baja"
          detalle="Fuera del parque por decisión"
          destino="/admin/activos?estado=dado_de_baja"
          icono="archive"
          apagado
        />
        {/* Perdidos y robados van juntos y aparte de la baja: los tres equipos
            ya no están, pero una baja es una decisión de la empresa y estas dos
            son pérdidas que alguien tiene que investigar. La tarjeta solo
            aparece si hay alguno; en un parque sano sería un cero permanente. */}
        {activos.perdidos + activos.robados > 0 && (
          <Indicador
            valor={activos.perdidos + activos.robados}
            etiqueta="Perdidos o robados"
            detalle="Pendientes de investigar"
            destino="/admin/activos?operativos=false"
            icono="exclamation-diamond"
            variante="bad"
          />
        )}
      </section>

      {garantias.sin_registrar > 0 && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="info-circle" />
          {/* Se distingue de «vencida» a propósito: mezclarlas haría que un
              inventario a medio capturar pareciera un parque sin cobertura. */}
          <div>
            {garantias.sin_registrar} activo(s) no tienen fecha de garantía
            registrada, así que no entran en los conteos de arriba.{" "}
            <Link to="/admin/activos?garantia=sin_registrar">Completarlos</Link>
            .
          </div>
        </div>
      )}

      <div className="mz-stack">
        <div className="mz-grid-2">
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Mantenimientos</h3>
              <Link
                to="/admin/mantenimientos"
                className="btn btn-outline-secondary btn-sm"
              >
                Ver bitácora
              </Link>
            </div>
            <div className="mz-card-body">
              <div className="panel-cifras">
                <Cifra valor={mantenimientos.del_mes} etiqueta="Este mes" />
                <Cifra
                  valor={mantenimientos.total_historico}
                  etiqueta="Histórico"
                />
                <Cifra
                  valor={formatearMoneda(mantenimientos.costo_del_mes)}
                  etiqueta="Costo del mes"
                />
                <Cifra
                  valor={formatearMoneda(mantenimientos.costo_acumulado)}
                  etiqueta="Costo acumulado"
                />
              </div>

              <p className="mz-faint mz-small panel-fuera">
                {formatearDias(fueraDeOperacion.total_dias)} acumulados fuera de
                operación en {fueraDeOperacion.intervenciones_cerradas}{" "}
                intervención(es) cerradas
                {fueraDeOperacion.intervenciones_abiertas > 0 &&
                  ` · ${fueraDeOperacion.intervenciones_abiertas} equipo(s) aún en reparación`}
                .
              </p>

              <GraficoMensual series={mantenimientos.por_mes} />
            </div>
          </section>

          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Equipos más reparados</h3>
            </div>
            {ranking.length === 0 ? (
              <div className="mz-empty">Sin intervenciones registradas.</div>
            ) : (
              <div className="panel-filas">
                {ranking.map((equipo) => (
                  <Link
                    key={equipo.id}
                    to={`/admin/activos/${equipo.id}`}
                    className="mz-row"
                  >
                    <span className="mz-row-ic">
                      <Icon name="tools" />
                    </span>
                    <span className="mz-row-info">
                      <strong>{equipo.nombre}</strong>
                      <span>
                        {equipo.tipo} · {equipo.departamento}
                      </span>
                    </span>
                    <span className="mz-row-end">
                      <span className="mz-pill mz-pill--neutral">
                        {equipo.total_mantenimientos}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="mz-grid-2 mz-grid-2--even">
          <TablaDistribucion
            titulo="Por tipo de dispositivo"
            filas={datos.por_tipo_dispositivo.map((f) => ({
              nombre: f.nombre_tipo,
              total: f.total,
            }))}
          />
          <TablaDistribucion
            titulo="Por área"
            filas={datos.por_departamento.map((f) => ({
              nombre: f.nombre_departamento,
              total: f.total,
              detalle: `${f.asignados} asignados`,
            }))}
          />
        </div>

        {activos.sin_asignar_mas_de_90_dias > 0 && (
          <div className="mz-alert mz-alert--info" role="status">
            <Icon name="info-circle" />
            <div>
              {activos.sin_asignar_mas_de_90_dias} activo(s) llevan más de 90
              días en bodega sin asignarse.{" "}
              <Link to="/admin/activos?estado=en_bodega">Revisarlos</Link>.
            </div>
          </div>
        )}

        {datos.indicadores_no_disponibles.length > 0 && (
          <p className="mz-note">
            <Icon name="info-circle" />
            {/* Se dice qué falta y por qué, en vez de omitir el indicador en
                silencio o mostrar un cero que se leería como «ninguna». */}
            <span>
              Indicadores del documento funcional aún no disponibles:{" "}
              {datos.indicadores_no_disponibles.map((i) => i.motivo).join(" ")}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Un indicador de la fila de arriba, con el dibujo de los de la Matriz.
 *
 * Es un enlace y no un bloque: lleva al listado que explica la cifra.
 */
function Indicador({
  valor,
  etiqueta,
  detalle,
  destino,
  icono,
  variante,
  apagado = false,
}) {
  const clases = [
    "mz-kpi",
    "panel-kpi",
    variante && `mz-kpi--${variante}`,
    apagado && "panel-kpi--apagado",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link to={destino} className={clases}>
      <span className="mz-kpi-top">
        <span className="mz-kpi-label">{etiqueta}</span>
        <span className="mz-kpi-icon">
          <Icon name={icono} />
        </span>
      </span>
      <span className="mz-kpi-value">{valor}</span>
      {detalle && <span className="mz-kpi-sub">{detalle}</span>}
    </Link>
  );
}

function Cifra({ valor, etiqueta }) {
  return (
    <div className="panel-cifra">
      <div className="panel-cifra__valor">{valor}</div>
      <div className="panel-cifra__etiqueta">{etiqueta}</div>
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
    return (
      <p className="mz-faint mz-small mb-0">
        Sin intervenciones en los últimos meses.
      </p>
    );
  }
  const maximo = Math.max(...series.map((s) => s.total), 1);
  const puntos = series.map((punto) => {
    const fecha = new Date(`${punto.mes}T00:00:00`);
    return {
      ...punto,
      etiqueta: `${MESES[fecha.getMonth()]} ${String(fecha.getFullYear()).slice(2)}`,
      etiquetaLarga: `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`,
    };
  });

  /* Con role="img" el lector de pantalla solo oía «Reparaciones por mes»,
     sin una sola cifra. Ahora el dibujo queda oculto para él y los mismos
     datos van en una tabla que solo él lee (auditoría UX/UI, fase 2,
     28/10/2026). */
  return (
    <>
      <div className="grafico-mensual" aria-hidden="true">
        {puntos.map((punto) => (
          <div className="grafico-mensual__columna" key={punto.mes}>
            <span className="grafico-mensual__valor">{punto.total}</span>
            <div
              className="grafico-mensual__barra"
              style={{ height: `${(punto.total / maximo) * 100}%` }}
              title={`${punto.etiqueta}: ${punto.total}`}
            />
            <span className="grafico-mensual__mes">{punto.etiqueta}</span>
          </div>
        ))}
      </div>
      <table className="visually-hidden">
        <caption>Reparaciones por mes</caption>
        <thead>
          <tr>
            <th scope="col">Mes</th>
            <th scope="col">Reparaciones</th>
          </tr>
        </thead>
        <tbody>
          {puntos.map((punto) => (
            <tr key={punto.mes}>
              <th scope="row">{punto.etiquetaLarga}</th>
              <td>{punto.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * Reparto del parque en barras, con el dibujo de los reportes de la Matriz.
 *
 * Cada barra mide la parte de la fila sobre el total del parque, no sobre la
 * fila más grande: lo que se quiere ver es cuánto pesa cada tipo o cada área.
 */
function TablaDistribucion({ titulo, filas }) {
  const total = filas.reduce((suma, fila) => suma + fila.total, 0);

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>{titulo}</h3>
      </div>
      <div className="mz-card-body">
        {filas.length === 0 ? (
          <div className="mz-empty">Sin datos.</div>
        ) : (
          filas.map((fila) => (
            <div className="mz-bar-row" key={fila.nombre}>
              <span className="mz-bar-label" title={fila.nombre}>
                {fila.nombre}
              </span>
              <div className="mz-bar-track">
                <div
                  className="mz-seg panel-seg"
                  style={{
                    width: `${total ? (fila.total / total) * 100 : 0}%`,
                  }}
                />
              </div>
              {fila.detalle && (
                <small className="panel-bar-detalle">{fila.detalle}</small>
              )}
              <span className="mz-bar-num">{fila.total}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
