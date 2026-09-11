import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { activosService } from "../../../api/activosService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
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
  const [dialogoAbierto, setDialogoAbierto] = useState(null);
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
    return <div className="alert alert-danger">{error}</div>;
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
      <Breadcrumbs
        items={[
          { label: "Administración" },
          { label: "Activos", path: "/admin/activos" },
          { label: activo.codigo_barras },
        ]}
      />

      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <h2 className="mb-1">{activo.nombre}</h2>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <code className="codigo-barras fs-6">{activo.codigo_barras}</code>
            <EstadoActivo
              estado={activo.estado}
              etiqueta={activo.estado_display}
            />
          </div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          {puedeImprimir && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setDialogoAbierto("etiqueta")}
            >
              <i className="bi bi-printer me-1" aria-hidden="true" />
              Etiqueta
            </button>
          )}
          {puedeAsignar && !salioDelParque && (
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={() => setDialogoAbierto("asignar")}
            >
              Asignar / trasladar
            </button>
          )}
          {puedeDarBaja && (
            <button
              type="button"
              className="btn btn-outline-warning btn-sm"
              onClick={() => setDialogoAbierto("estado")}
            >
              Cambiar estado
            </button>
          )}
          {puedeEditar && !salioDelParque && (
            <Link
              to={`/admin/activos/${activo.id}/editar`}
              className="btn btn-outline-secondary btn-sm"
            >
              Editar ficha
            </Link>
          )}
        </div>
      </div>

      <AlertaRenovacion renovacion={activo.renovacion} />

      <div className="activo-paneles">
        <div className="activo-paneles__columna">
          <section className="card activo-card">
            <div className="card-body">
              <h3 className="h6 text-uppercase text-muted mb-3">
                Ficha técnica
              </h3>
              <dl className="activo-datos">
                <Dato etiqueta="Tipo" valor={activo.tipo_nombre} />
                <Dato etiqueta="Marca" valor={activo.marca} />
                <Dato etiqueta="Modelo" valor={activo.modelo} />
                <Dato
                  etiqueta="Número de serie"
                  valor={<code>{activo.numero_serie}</code>}
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
                      <span className="text-muted">Sin especificar</span>
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
                <>
                  <h3 className="h6 text-uppercase text-muted mt-4 mb-3">
                    Especificaciones
                  </h3>
                  <dl className="activo-datos">
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
                </>
              )}

              {activo.observaciones && (
                <>
                  <h3 className="h6 text-uppercase text-muted mt-4 mb-2">
                    Observaciones
                  </h3>
                  <p className="mb-0">{activo.observaciones}</p>
                </>
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
          <section className="card activo-card">
            <div className="card-body">
              <h3 className="h6 text-uppercase text-muted mb-3">Custodia</h3>
              <dl className="activo-datos">
                {/* Todos los nombres, sin destacar a ninguno: de un
                    equipo compartido responden varias personas en igualdad, y
                    poner a una primera inventaría un titular donde se decidió
                    que no lo hubiera. */}
                <Dato
                  etiqueta={activo.compartido ? "Responsables" : "Responsable"}
                  valor={
                    activo.responsables?.length ? (
                      <ul className="activo-responsables">
                        {activo.responsables.map((persona) => (
                          <li key={persona.id}>
                            {persona.nombre_completo}
                            <span className="text-muted">
                              {" "}
                              · {persona.codigo_empleado}
                            </span>
                            {!persona.activo && (
                              <span className="badge text-bg-warning ms-2">
                                Dado de baja
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted">Sin asignar</span>
                    )
                  }
                />
                <Dato
                  etiqueta="Departamento"
                  valor={activo.departamento_nombre}
                />
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

          <section className="card activo-card">
            <div className="card-body">
              <h3 className="h6 text-uppercase text-muted mb-3">Indicadores</h3>
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
                <div className="small text-muted mt-3">
                  Mano de obra {formatearMoneda(costos.costo_mano_obra)} ·
                  repuestos {formatearMoneda(costos.costo_repuestos)}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {puedeVerMantenimientos && (
        <section className="mt-4">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h3 className="h5 mb-0">Bitácora de mantenimientos</h3>
            {puedeRegistrarMantenimiento && !salioDelParque && (
              <Link
                to={`/admin/mantenimientos/new?activo=${activo.id}`}
                className="btn btn-primary btn-sm"
              >
                Registrar mantenimiento
              </Link>
            )}
          </div>
          <TablaMantenimientos mantenimientos={mantenimientos} />
        </section>
      )}

      {puedeVerAdjuntos && (
        <section className="mt-4">
          <AdjuntosPanel
            activoId={activo.id}
            recargarToken={adjuntosRecargados}
          />
        </section>
      )}

      <section className="mt-4">
        <h3 className="h5 mb-2">Historial de movimientos</h3>
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
    <section className="card activo-card">
      <div className="card-body">
        <h3 className="h6 text-uppercase text-muted mb-3">Tiempos</h3>
        <dl className="activo-datos">
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
          <div className="alert alert-info py-2 small mt-3 mb-0">
            Lleva {formatearDias(tiempos.en_reparacion_ahora_dias)} en
            reparación sin cerrar.
          </div>
        )}

        <p className="form-text mb-0 mt-3">
          <strong>
            Tiempo activo real: {formatearDias(tiempos.activo_real_dias)}
          </strong>{" "}
          — lo que estuvo trabajando, descontando lo que pasó guardado y en el
          taller. Medido desde{" "}
          {tiempos.medido_desde === "ingreso"
            ? "el ingreso al inventario"
            : "la compra"}
          .
        </p>
      </div>
    </section>
  );
}

/**
 * Una fila «etiqueta: valor» de la ficha.
 *
 * El ancho de la etiqueta lo fija la rejilla `.activo-datos`, no una clase de
 * columna: con `col-sm-5` el valor quedaba a media pantalla de su etiqueta en
 * monitores anchos, y leer la ficha obligaba a recorrer el ojo por un hueco
 * vacío.
 */
function Dato({ etiqueta, valor }) {
  return (
    <>
      <dt>{etiqueta}</dt>
      <dd>{valor || "—"}</dd>
    </>
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
      <small className="d-block text-muted">
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
      <p className="text-muted">Este activo no registra intervenciones.</p>
    );
  }
  return (
    <div className="table-responsive">
      <table className="table table-sm table-striped align-middle">
        <thead>
          <tr>
            <th>Ingreso</th>
            {/* Ya no son solo días: la columna lleva «1 mes y 15 días». */}
            <th>Fuera de operación</th>
            <th>Tipo</th>
            <th>Responsable</th>
            <th>Trabajo</th>
            <th>Componentes</th>
            <th className="text-end">Costo</th>
          </tr>
        </thead>
        <tbody>
          {mantenimientos.map((mantenimiento) => (
            <tr key={mantenimiento.id}>
              <td>{formatearFecha(mantenimiento.fecha_intervencion)}</td>
              <td>
                {mantenimiento.sigue_fuera_de_operacion ? (
                  <span className="badge text-bg-warning">En reparación</span>
                ) : (
                  formatearDias(mantenimiento.dias_fuera_de_operacion)
                )}
              </td>
              <td>
                <span
                  className={`badge ${
                    mantenimiento.tipo === "correctivo"
                      ? "text-bg-warning"
                      : "text-bg-info"
                  }`}
                >
                  {mantenimiento.tipo_display}
                </span>
              </td>
              <td>
                {mantenimiento.responsable}
                <br />
                <small className="text-muted">
                  {mantenimiento.tipo_responsable_display}
                </small>
              </td>
              <td>
                {mantenimiento.causa && (
                  <div className="small text-muted">
                    Causa: {mantenimiento.causa}
                  </div>
                )}
                {mantenimiento.descripcion}
                {mantenimiento.garantia_usada && (
                  <span className="badge text-bg-success ms-1">garantía</span>
                )}
              </td>
              <td>
                {mantenimiento.componentes.length === 0 ? (
                  <span className="text-muted">—</span>
                ) : (
                  <ul className="list-unstyled mb-0 small">
                    {mantenimiento.componentes.map((componente) => (
                      <li key={componente.id}>
                        {componente.componente_nombre} ×{componente.cantidad}
                        {componente.era_critico && (
                          <span className="badge text-bg-danger ms-1">
                            crítica
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="text-end">
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
    return <p className="text-muted">Sin movimientos registrados.</p>;
  }
  return (
    <div className="table-responsive">
      <table className="table table-sm table-striped align-middle">
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
              <td>{formatearFecha(movimiento.created_at, true)}</td>
              <td>{movimiento.tipo_display}</td>
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
    return <span className="text-muted">—</span>;
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
        <i className="bi bi-file-earmark-pdf" aria-hidden="true" />
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
          <i className="bi bi-paperclip" aria-hidden="true" />
          <span className="visually-hidden">Archivar acta</span>
        </button>
      )}
    </div>
  );
}

/** Muestra "antes → después" solo cuando hubo un cambio real. */
function Transicion({ anterior, nuevo }) {
  if (!anterior && !nuevo) {
    return <span className="text-muted">—</span>;
  }
  if (anterior && nuevo && anterior !== nuevo) {
    return (
      <span>
        <span className="text-muted text-decoration-line-through">
          {anterior}
        </span>{" "}
        <i className="bi bi-arrow-right" aria-hidden="true" /> {nuevo}
      </span>
    );
  }
  return <span>{nuevo || anterior}</span>;
}
