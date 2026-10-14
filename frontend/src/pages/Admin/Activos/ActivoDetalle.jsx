import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { activosService } from "../../../api/activosService";
import { Icon } from "../../../components/common/Icon/Icon";
import { EstadoActivo } from "../../../components/activos/EstadoActivo/EstadoActivo";
import { EstadoGarantia } from "../../../components/activos/EstadoGarantia/EstadoGarantia";
import { AsignarCustodioDialog } from "../../../components/activos/AsignarCustodioDialog/AsignarCustodioDialog";
import { CambiarEstadoDialog } from "../../../components/activos/CambiarEstadoDialog/CambiarEstadoDialog";
import { EtiquetaDialog } from "../../../components/activos/EtiquetaDialog/EtiquetaDialog";
import { AlertaRenovacion } from "../../../components/activos/AlertaRenovacion/AlertaRenovacion";
import { AdjuntosPanel } from "../../../components/activos/AdjuntosPanel/AdjuntosPanel";
import { adjuntosService } from "../../../api/adjuntosService";
import { descargarBlob } from "../../../utils/descargas";
import { usePermission } from "../../../hooks/usePermission";
import {
  formatearDias,
  formatearFecha,
  formatearMeses,
  formatearMoneda,
} from "../../../utils/formato";
import "./Activos.css";

export function ActivoDetalle() {
  const { id } = useParams();
  const puedeAsignar = usePermission("activos.asignar");
  const puedeDarBaja = usePermission("activos.dar_baja");
  const puedeEditar = usePermission("activos.editar");
  const puedeImprimir = usePermission("activos.imprimir_etiqueta");
  const puedeVerMantenimientos = usePermission("mantenimientos.ver");
  const puedeRegistrarMantenimiento = usePermission("mantenimientos.registrar");
  const puedeVerAdjuntos = usePermission("adjuntos.ver");
  const puedeSubirAdjuntos = usePermission("adjuntos.subir");

  const [ficha, setFicha] = useState(null);
  const [error, setError] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  /* El listado enlaza aquí con la acción ya elegida (`?accion=asignar`), así
     que asignar desde el inventario es un clic en vez de tres. Se lee una
     sola vez al montar y se limpia de la URL: si se quedara, cerrar el
     diálogo lo reabriría al primer refresco, y recargar la página meses
     después volvería a abrirlo sin que nadie lo haya pedido. */
  const [dialogoAbierto, setDialogoAbierto] = useState(() => {
    const pedida = searchParams.get("accion");
    return ["asignar", "estado", "etiqueta"].includes(pedida) ? pedida : null;
  });

  useEffect(() => {
    if (!searchParams.get("accion")) return;
    const limpios = new URLSearchParams(searchParams);
    limpios.delete("accion");
    setSearchParams(limpios, { replace: true });
  }, [searchParams, setSearchParams]);
  const [adjuntosRecargados, setAdjuntosRecargados] = useState(0);

  const cargar = useCallback(() => {
    activosService
      .historial(id)
      .then(setFicha)
      .catch(() => setError("No se pudo cargar la ficha del activo."));
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) {
    return (
      <div className="mz-alert mz-alert--bad" role="alert">
        <Icon name="x-octagon" />
        {error}
      </div>
    );
  }
  if (!ficha) {
    return null;
  }

  const { activo, movimientos, mantenimientos, costos } = ficha;
  /* «Salió del parque», no «está dado de baja»: son tres estados —baja,
     perdido y robado— y el backend los trata igual. Preguntando solo por la
     baja, la pantalla ofrecía asignar y registrar mantenimientos sobre un
     equipo robado, y el servidor los rechazaba después de llenar el
     formulario. Lo trae calculado la propia ficha, así que la regla vive en
     un solo sitio. */
  const salioDelParque = !activo.esta_operativo;

  return (
    <div className="activos-page activo-detalle">
      <div className="mz-view-head">
        <div>
          <h2>{activo.nombre}</h2>
          {/* La descripción de una ficha es su identidad: el código que se
              coteja con la etiqueta pegada al equipo y el estado en que está. */}
          <div className="mz-desc activo-detalle__identidad">
            <code className="codigo-barras">{activo.codigo_barras}</code>
            <EstadoActivo
              estado={activo.estado}
              etiqueta={activo.estado_display}
            />
          </div>
        </div>
        <div className="mz-view-actions">
          {puedeImprimir && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setDialogoAbierto("etiqueta")}
            >
              <Icon name="printer" /> Etiqueta
            </button>
          )}
          {puedeAsignar && !salioDelParque && (
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={() => setDialogoAbierto("asignar")}
            >
              <Icon name="person-check" /> Asignar / trasladar
            </button>
          )}
          {puedeDarBaja && (
            <button
              type="button"
              className="btn btn-outline-warning btn-sm"
              onClick={() => setDialogoAbierto("estado")}
            >
              <Icon name="arrow-repeat" /> Cambiar estado
            </button>
          )}
          {puedeEditar && !salioDelParque && (
            <Link
              to={`/admin/activos/${activo.id}/editar`}
              className="btn btn-outline-secondary btn-sm"
            >
              <Icon name="pencil" /> Editar ficha
            </Link>
          )}
        </div>
      </div>

      <AlertaRenovacion renovacion={activo.renovacion} />

      <div className="mz-grid-2 activo-paneles">
        <div className="activo-paneles__columna">
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Ficha técnica</h3>
            </div>
            <div className="mz-card-body">
              <dl className="mz-kv-grid activo-datos">
                <Dato etiqueta="Tipo" valor={activo.tipo_nombre} />
                <Dato etiqueta="Marca" valor={activo.marca} />
                <Dato etiqueta="Modelo" valor={activo.modelo} />
                <Dato
                  etiqueta="Número de serie"
                  valor={<code className="mz-mono">{activo.numero_serie}</code>}
                />
                <Dato
                  etiqueta="Adquirido"
                  valor={formatearFecha(activo.fecha_adquisicion)}
                />
                <Dato
                  etiqueta="Ingresó al inventario"
                  valor={
                    activo.fecha_ingreso
                      ? formatearFecha(activo.fecha_ingreso)
                      : "—"
                  }
                />
                <Dato
                  etiqueta="Antigüedad"
                  valor={formatearMeses(activo.antiguedad_meses)}
                />
                <Dato
                  etiqueta="Costo de compra"
                  valor={formatearMoneda(activo.costo_adquisicion)}
                />
                {activo.depreciacion?.disponible && (
                  <Dato
                    etiqueta="Valor en libros"
                    valor={<ValorEnLibros depreciacion={activo.depreciacion} />}
                  />
                )}
                <Dato
                  etiqueta="Condición al adquirirlo"
                  valor={
                    activo.condicion_display || (
                      // Vacío no es «nuevo»: es que nadie lo anotó, y se dice
                      // con esas palabras para que se pueda completar.
                      <span className="mz-faint">Sin especificar</span>
                    )
                  }
                />
                {/* El nombre, no el identificador: la ficha se lee, y «14»
                    no dice a quién llamar. */}
                <Dato etiqueta="Proveedor" valor={activo.proveedor_nombre} />
                {/* A quién se le compró y de quién es son dos preguntas
                    distintas, y en un equipo en concesión las respuestas son
                    distintas: la compra fue del partner. */}
                <Dato etiqueta="Propiedad" valor={activo.propiedad_display} />
                {!activo.es_de_la_empresa && (
                  <Dato
                    etiqueta="Concesionario"
                    valor={activo.concesionario_nombre}
                  />
                )}
                <Dato
                  etiqueta="Garantía"
                  completo
                  valor={
                    <EstadoGarantia
                      estado={activo.estado_garantia}
                      etiqueta={activo.estado_garantia_display}
                      fecha={activo.fecha_fin_garantia}
                      dias={activo.dias_para_fin_de_garantia}
                    />
                  }
                />
                {/* El sistema guarda cuándo y por qué salió en los tres
                    casos, pero la ficha solo lo enseñaba en la baja: de un
                    equipo robado no decía ni la fecha ni el motivo, que es lo
                    único que queda de él. Las etiquetas no dicen «baja»
                    porque el estado ya está arriba, y «Fecha de baja» sobre un
                    equipo robado nombra mal lo que pasó. */}
                {salioDelParque && (
                  <>
                    <Dato
                      etiqueta="Salió del inventario"
                      valor={formatearFecha(activo.fecha_baja)}
                    />
                    <Dato
                      etiqueta="Motivo de la salida"
                      valor={activo.motivo_baja}
                    />
                  </>
                )}
              </dl>

              {Object.keys(activo.especificaciones || {}).length > 0 && (
                <div className="mz-section mt-4 mb-0">
                  <h4>Especificaciones</h4>
                  <dl className="mz-kv-grid activo-datos">
                    {Object.entries(activo.especificaciones).map(
                      ([clave, valor]) => (
                        <Dato
                          key={clave}
                          etiqueta={clave}
                          valor={String(valor)}
                        />
                      ),
                    )}
                  </dl>
                </div>
              )}

              {activo.observaciones && (
                <div className="mz-section mt-4 mb-0">
                  <h4>Observaciones</h4>
                  <p className="mb-0">{activo.observaciones}</p>
                </div>
              )}
            </div>
          </section>

          {/* Los tiempos van bajo la ficha técnica —son datos del propio
              equipo— y de paso equilibran las dos columnas: con las cuatro
              tarjetas repartidas 1 y 3, la izquierda quedaba con medio metro
              de hueco debajo. */}
          {activo.tiempos && <TiemposDelActivo tiempos={activo.tiempos} />}
        </div>

        <div className="activo-paneles__columna">
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Custodia</h3>
            </div>
            <div className="mz-card-body">
              <dl className="mz-kv-grid activo-datos">
                {/* Todos los nombres, sin destacar a ninguno: de un
                    equipo compartido responden varias personas en igualdad, y
                    poner a una primera inventaría un titular donde se decidió
                    que no lo hubiera. */}
                <Dato
                  etiqueta={activo.compartido ? "Responsables" : "Responsable"}
                  completo
                  valor={
                    activo.responsables?.length ? (
                      <ul className="activo-responsables">
                        {activo.responsables.map((persona) => (
                          <li key={persona.id}>
                            {persona.nombre_completo}
                            <span className="mz-faint">
                              {" "}
                              · {persona.codigo_empleado}
                            </span>
                            {!persona.activo && (
                              <span className="mz-pill mz-pill--warn ms-2">
                                Dado de baja
                              </span>
                            )}
                            {/* Sin correo en su ficha no le llegan los avisos
                                de entrada y salida del taller. Se dice aquí
                                porque es donde se puede ir a corregirlo. */}
                            {persona.recibe_avisos === false && (
                              <span
                                className="mz-pill mz-pill--neutral ms-2"
                                title="Sin correo en su ficha: no recibirá los avisos de mantenimiento"
                              >
                                Sin avisos
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="mz-faint">Sin asignar</span>
                    )
                  }
                />
                <Dato
                  etiqueta="Departamento"
                  valor={activo.departamento_nombre}
                />
                {/* Solo si alguien lo pidió: la mayoría de las altas son
                    reposición y no las pide nadie en particular. */}
                {activo.solicitado_por_nombre && (
                  <Dato
                    etiqueta="Lo pidió"
                    valor={activo.solicitado_por_nombre}
                  />
                )}
                {/* El área dice de quién es el presupuesto del equipo; la
                    sede, dónde ir a buscarlo. La ciudad va aparte porque es la
                    respuesta a «¿dónde está?»: el nombre interno de la sede no
                    le dice nada a quien tiene que viajar. */}
                <Dato etiqueta="Sede" valor={activo.sede_nombre || "—"} />
                <Dato etiqueta="Ciudad" valor={activo.ciudad || "—"} />
                <Dato etiqueta="Criticidad" valor={activo.criticidad_display} />
                <Dato etiqueta="Uso" valor={activo.uso_display} />
              </dl>
            </div>
          </section>

          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Indicadores</h3>
            </div>
            <div className="mz-card-body">
              <div className="activo-indicadores">
                <Indicador
                  valor={activo.total_mantenimientos}
                  etiqueta="Mantenimientos"
                />
                <Indicador
                  valor={activo.total_componentes_criticos}
                  etiqueta="Piezas críticas"
                />
                <Indicador
                  valor={formatearDias(activo.dias_en_reparacion)}
                  etiqueta="Fuera de operación"
                />
                <Indicador
                  valor={formatearMoneda(costos.costo_total)}
                  etiqueta="Invertido"
                  anchoCompleto
                />
              </div>
              {puedeVerMantenimientos && (
                <div className="mz-small mz-faint mt-3">
                  Mano de obra {formatearMoneda(costos.costo_mano_obra)} ·
                  repuestos {formatearMoneda(costos.costo_repuestos)}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {puedeVerMantenimientos && (
        <section className="mz-card mt-4">
          <div className="mz-card-head">
            <h3>Bitácora de mantenimientos</h3>
            {puedeRegistrarMantenimiento && !salioDelParque && (
              <Link
                to={`/admin/mantenimientos/new?activo=${activo.id}`}
                className="btn btn-primary btn-sm"
              >
                <Icon name="tools" /> Registrar mantenimiento
              </Link>
            )}
          </div>
          <TablaMantenimientos mantenimientos={mantenimientos} />
        </section>
      )}

      {puedeVerAdjuntos && (
        <div className="mt-4">
          <AdjuntosPanel
            activoId={activo.id}
            recargarToken={adjuntosRecargados}
          />
        </div>
      )}

      {/* Tabla y no línea de tiempo: cada movimiento se lee por columnas
          —quién, qué área, qué ciudad, antes y después— y lleva su acta al
          final de la fila; en una línea de tiempo esas comparaciones se
          perderían en párrafos. */}
      <section className="mz-card mt-4">
        <div className="mz-card-head">
          <h3>Historial de movimientos</h3>
        </div>
        <TablaMovimientos
          movimientos={movimientos}
          puedeArchivar={puedeSubirAdjuntos}
          onArchivada={() => setAdjuntosRecargados((n) => n + 1)}
        />
      </section>

      {dialogoAbierto === "asignar" && (
        <AsignarCustodioDialog
          activo={activo}
          onCerrar={() => setDialogoAbierto(null)}
          onGuardado={() => {
            setDialogoAbierto(null);
            cargar();
          }}
        />
      )}
      {dialogoAbierto === "estado" && (
        <CambiarEstadoDialog
          activo={activo}
          onCerrar={() => setDialogoAbierto(null)}
          onGuardado={() => {
            setDialogoAbierto(null);
            cargar();
          }}
        />
      )}
      {dialogoAbierto === "etiqueta" && (
        <EtiquetaDialog
          activo={activo}
          onCerrar={() => setDialogoAbierto(null)}
        />
      )}
    </div>
  );
}

/**
 * Los siete tiempos del §10 del documento funcional.
 *
 * En días mientras son pocos —cuatro de ellos se consultan para decidir algo
 * esta semana— y en meses o años cuando pasan de ahí, sin perder el resto:
 * «1 año, 1 mes y 22 días». Redondear a «11 meses» borraría justo la
 * diferencia que se busca al comparar dos equipos; dejar «412 días» obliga a
 * dividir mentalmente para saber si es mucho o poco.
 */
export function TiemposDelActivo({ tiempos }) {
  const filas = [
    ["Desde la compra", tiempos.desde_compra_dias],
    ["Desde el ingreso", tiempos.desde_ingreso_dias],
    ["Desde la primera asignación", tiempos.desde_primera_asignacion_dias],
    ["Con quien responde por él", tiempos.con_custodio_actual_dias],
    ["Acumulado en reparación", tiempos.en_reparacion_dias],
    ["Guardado sin uso", tiempos.sin_uso_dias],
  ];

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Tiempos</h3>
      </div>
      <div className="mz-card-body">
        <dl className="mz-kv-grid activo-datos">
          {filas.map(([etiqueta, valor]) => (
            <Dato
              key={etiqueta}
              etiqueta={etiqueta}
              valor={formatearDias(valor)}
            />
          ))}
        </dl>

        {tiempos.en_reparacion_ahora_dias > 0 && (
          /* Se informa aparte del acumulado: sumarlos escondería que el equipo
             sigue fuera de operación ahora mismo. */
          <div className="mz-alert mz-alert--info mb-0" role="status">
            <Icon name="hourglass-split" />
            Lleva {formatearDias(tiempos.en_reparacion_ahora_dias)} en
            reparación sin cerrar.
          </div>
        )}

        <p className="mz-note mb-0">
          <span>
            <strong>
              Tiempo activo real: {formatearDias(tiempos.activo_real_dias)}
            </strong>{" "}
            — lo que estuvo trabajando, descontando lo que pasó guardado y en el
            taller. Medido desde{" "}
            {tiempos.medido_desde === "ingreso"
              ? "el ingreso al inventario"
              : "la compra"}
            .
          </span>
        </p>
      </div>
    </section>
  );
}

/**
 * Un par «etiqueta: valor» de la ficha.
 *
 * Va como `<dt>`/`<dd>` dentro de un `mz-kv`, y no con el `<span>` de rótulo
 * de la identidad: es una lista de definiciones de verdad, y los lectores de
 * pantalla la anuncian como tal —«Marca: Dell»— en vez de leer dos textos
 * sueltos. La rejilla `mz-kv-grid` pone la etiqueta encima del valor, que
 * así no queda a media pantalla de ella en un monitor ancho.
 */
function Dato({ etiqueta, valor, completo = false }) {
  return (
    <div className={`mz-kv${completo ? " mz-kv--full" : ""}`}>
      <dt className="mz-kv-label">{etiqueta}</dt>
      <dd>{valor || "—"}</dd>
    </div>
  );
}

/**
 * Lo que el equipo vale hoy en libros (§22.3).
 *
 * Al lado del costo y no en un bloque aparte: la pregunta es «costó tanto, ¿y
 * ahora?», y separarlos obligaría a buscar la respuesta en otra parte de la
 * pantalla.
 *
 * Un equipo totalmente depreciado se marca, porque es el dato que respalda una
 * solicitud de compra —no un problema: depreciarse en tres años y reemplazarse
 * a los cuatro o cinco es lo normal, y por eso el aviso es neutro y no una
 * alerta—.
 */
function ValorEnLibros({ depreciacion }) {
  return (
    <>
      {formatearMoneda(depreciacion.valor_en_libros)}
      <small className="d-block mz-faint mz-small">
        {depreciacion.totalmente_depreciado
          ? `Totalmente depreciado desde el ${formatearFecha(depreciacion.fin)}`
          : `${depreciacion.porcentaje_depreciado} % depreciado · termina el ${formatearFecha(
              depreciacion.fin,
            )}`}
      </small>
    </>
  );
}

function Indicador({ valor, etiqueta, anchoCompleto = false }) {
  return (
    <div className={`indicador${anchoCompleto ? " indicador--ancho" : ""}`}>
      <div className="indicador-valor">{valor}</div>
      <div className="indicador-etiqueta">{etiqueta}</div>
    </div>
  );
}

function TablaMantenimientos({ mantenimientos }) {
  if (mantenimientos.length === 0) {
    return (
      <div className="mz-empty">Este activo no registra intervenciones.</div>
    );
  }
  return (
    <div className="mz-table-wrap">
      <table className="mz-table mz-table--ancha">
        <thead>
          <tr>
            <th>Ingreso</th>
            {/* Ya no son solo días: la columna lleva «1 mes y 15 días». */}
            <th>Fuera de operación</th>
            <th>Tipo</th>
            <th>Responsable</th>
            <th>Trabajo</th>
            <th>Componentes</th>
            <th className="num">Costo</th>
          </tr>
        </thead>
        <tbody>
          {mantenimientos.map((mantenimiento) => (
            <tr key={mantenimiento.id}>
              <td>{formatearFecha(mantenimiento.fecha_intervencion)}</td>
              <td>
                {mantenimiento.sigue_fuera_de_operacion ? (
                  <span className="mz-pill mz-pill--warn">En reparación</span>
                ) : (
                  formatearDias(mantenimiento.dias_fuera_de_operacion)
                )}
              </td>
              <td>
                <span
                  className={`mz-pill ${
                    mantenimiento.tipo === "correctivo"
                      ? "mz-pill--warn"
                      : "mz-pill--neutral"
                  }`}
                >
                  {mantenimiento.tipo_display}
                </span>
              </td>
              <td>
                {mantenimiento.responsable}
                <br />
                <small className="mz-faint mz-small">
                  {mantenimiento.tipo_responsable_display}
                </small>
              </td>
              <td>
                {mantenimiento.causa && (
                  <div className="mz-small mz-faint">
                    Causa: {mantenimiento.causa}
                  </div>
                )}
                {mantenimiento.descripcion}
                {mantenimiento.garantia_usada && (
                  <span className="mz-pill mz-pill--ok ms-1">garantía</span>
                )}
              </td>
              <td>
                {mantenimiento.componentes.length === 0 ? (
                  <span className="mz-faint">—</span>
                ) : (
                  <ul className="list-unstyled mb-0 mz-small">
                    {mantenimiento.componentes.map((componente) => (
                      <li key={componente.id}>
                        {componente.componente_nombre} ×{componente.cantidad}
                        {componente.era_critico && (
                          <span className="mz-pill mz-pill--bad ms-1">
                            crítica
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="num">
                {formatearMoneda(mantenimiento.costo_total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablaMovimientos({ movimientos, puedeArchivar, onArchivada }) {
  if (movimientos.length === 0) {
    return <div className="mz-empty">Sin movimientos registrados.</div>;
  }
  return (
    <div className="mz-table-wrap">
      <table className="mz-table mz-table--ancha">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Movimiento</th>
            <th>Custodio</th>
            <th>Área</th>
            <th>Ciudad</th>
            <th>Motivo</th>
            <th>Registró</th>
            <th>Acta</th>
          </tr>
        </thead>
        <tbody>
          {movimientos.map((movimiento) => (
            <tr key={movimiento.id}>
              <td className="text-nowrap">
                {formatearFecha(movimiento.created_at, true)}
              </td>
              <td className="mz-strong">{movimiento.tipo_display}</td>
              <td>
                <Transicion
                  anterior={movimiento.custodio_anterior_nombre}
                  nuevo={movimiento.custodio_nuevo_nombre}
                />
              </td>
              <td>
                <Transicion
                  anterior={movimiento.departamento_anterior_nombre}
                  nuevo={movimiento.departamento_nuevo_nombre}
                />
              </td>
              <td>
                {/* El traslado físico también queda en el historial: antes se
                    veía dónde está el equipo, pero no cuándo se movió. */}
                <Transicion
                  anterior={movimiento.sede_anterior_nombre}
                  nuevo={movimiento.sede_nueva_nombre}
                />
              </td>
              <td>{movimiento.motivo || "—"}</td>
              <td>{movimiento.registrado_por_nombre || "—"}</td>
              <td>
                <AccionesActa
                  movimiento={movimiento}
                  puedeArchivar={puedeArchivar}
                  onArchivada={onArchivada}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Acta de entrega o devolución de un movimiento (§6, §18).
 *
 * Solo las asignaciones y devoluciones tienen acta: un alta o un cambio de
 * estado no son un traspaso de responsabilidad, y ofrecer el botón en todas
 * las filas haría creer que sí.
 */
function AccionesActa({ movimiento, puedeArchivar, onArchivada }) {
  const [ocupado, setOcupado] = useState(false);
  const generaActa =
    movimiento.tipo === "asignacion" || movimiento.tipo === "devolucion";

  if (!generaActa) {
    return <span className="mz-faint">—</span>;
  }

  async function descargar() {
    setOcupado(true);
    try {
      const blob = await adjuntosService.acta(movimiento.id);
      descargarBlob(blob, `acta-${movimiento.id}.pdf`);
    } finally {
      setOcupado(false);
    }
  }

  async function archivar() {
    setOcupado(true);
    try {
      await adjuntosService.archivarActa(movimiento.id);
      onArchivada?.();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="d-flex gap-1">
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        disabled={ocupado}
        onClick={descargar}
        title="Descargar el acta en PDF para firmarla"
      >
        <Icon name="file-earmark-pdf" />
        <span className="visually-hidden">Descargar acta</span>
      </button>
      {puedeArchivar && (
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={ocupado}
          onClick={archivar}
          title="Guardar el acta entre los documentos del equipo"
        >
          <Icon name="paperclip" />
          <span className="visually-hidden">Archivar acta</span>
        </button>
      )}
    </div>
  );
}

/** Muestra "antes → después" solo cuando hubo un cambio real. */
function Transicion({ anterior, nuevo }) {
  if (!anterior && !nuevo) {
    return <span className="mz-faint">—</span>;
  }
  if (anterior && nuevo && anterior !== nuevo) {
    return (
      <span>
        <span className="mz-faint text-decoration-line-through">
          {anterior}
        </span>{" "}
        <Icon name="arrow-right" /> {nuevo}
      </span>
    );
  }
  return <span>{nuevo || anterior}</span>;
}
