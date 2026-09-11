import { useEffect, useState } from "react";

import { misEquiposService } from "../../../api/activosService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { EstadoActivo } from "../../../components/activos/EstadoActivo/EstadoActivo";
import { formatearDias, formatearFecha } from "../../../utils/formato";
import { mensajeDeError } from "../../../utils/errores";
import "./MisEquipos.css";

const BREADCRUMB_ITEMS = [{ label: "Mis equipos" }];

const MILISEGUNDOS_POR_DIA = 86400000;

/** Cuánto tiempo lleva el equipo con esta persona, en días. */
function diasCon(desde) {
  const entrega = new Date(desde);
  if (Number.isNaN(entrega.getTime())) return null;
  return Math.max(Math.floor((Date.now() - entrega) / MILISEGUNDOS_POR_DIA), 0);
}

/**
 * Los equipos que quien entra tiene a su cargo (§13, rol «Usuario final»).
 *
 * Es deliberadamente corta. No muestra costo, proveedor, sugerencia de
 * renovación ni quién tuvo antes el equipo: son datos del inventario, no del
 * aparato que uno usa. El veredicto de renovación además es una decisión de
 * planificación —«este equipo se reemplaza el año que viene»— que no se
 * comunica por una pantalla.
 *
 * Lo que queda es lo que sirve para dos cosas: saber qué se tiene y poder
 * identificar el aparato al pedir soporte. De ahí que el código de la etiqueta
 * y el número de serie estén en monoespaciada y se puedan leer de un vistazo.
 */
export function MisEquiposPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [isCargando, setIsCargando] = useState(true);

  useEffect(() => {
    misEquiposService
      .consultar()
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar sus equipos.")),
      )
      .finally(() => setIsCargando(false));
  }, []);

  return (
    <div className="mis-equipos-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <h2>Mis equipos</h2>
      {datos?.empleado && (
        <p className="text-muted">
          {datos.empleado.nombre} · {datos.empleado.codigo} ·{" "}
          {datos.empleado.departamento}
        </p>
      )}

      {error && <div className="alert alert-danger">{error}</div>}

      {/* La cuenta sin ficha de empleado no es una lista vacía: el sistema no
          sabe qué equipos son suyos, y eso lo arregla un administrador. */}
      {datos?.aviso && <div className="alert alert-warning">{datos.aviso}</div>}

      {!isCargando &&
        !error &&
        !datos?.aviso &&
        datos?.equipos.length === 0 && (
          <div className="alert alert-info">
            No tiene equipos a su cargo. Si acaba de recibir uno, pídale a
            soporte que registre la entrega.
          </div>
        )}

      <div className="mis-equipos">
        {(datos?.equipos ?? []).map((equipo) => (
          <article className="equipo-card" key={equipo.id}>
            <header className="equipo-card__cabecera">
              <div>
                <h3 className="equipo-card__nombre">{equipo.nombre}</h3>
                <p className="equipo-card__tipo">
                  {equipo.tipo_nombre} · {equipo.marca} {equipo.modelo}
                </p>
              </div>
              <EstadoActivo
                estado={equipo.estado}
                etiqueta={equipo.estado_display}
              />
            </header>

            <dl className="equipo-card__datos">
              <dt>Código</dt>
              <dd>
                <code>{equipo.codigo_barras}</code>
              </dd>
              <dt>Serie</dt>
              <dd>
                <code>{equipo.numero_serie}</code>
              </dd>
              <dt>Desde</dt>
              <dd>
                {equipo.desde ? (
                  <>
                    {formatearFecha(equipo.desde)}
                    {/* La fecha sola obliga a contar: lo que se quiere saber
                        es si el equipo lleva dos meses o cuatro años. */}
                    <span className="text-muted">
                      {" "}
                      · hace {formatearDias(diasCon(equipo.desde))}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">Sin registro de entrega</span>
                )}
              </dd>
              <dt>Ciudad</dt>
              <dd>{equipo.ciudad || <span className="text-muted">—</span>}</dd>
            </dl>

            {Object.keys(equipo.especificaciones ?? {}).length > 0 && (
              <ul className="equipo-card__especificaciones">
                {Object.entries(equipo.especificaciones).map(
                  ([clave, valor]) => (
                    <li key={clave}>
                      <span className="text-muted">{clave}:</span> {valor}
                    </li>
                  ),
                )}
              </ul>
            )}
          </article>
        ))}
      </div>

      {(datos?.equipos ?? []).length > 0 && (
        <p className="text-muted small mt-3">
          {/* Lo que hay que hacer con la pantalla, no solo lo que muestra: el
              código es lo que se le pide a quien tiene el equipo cuando llama
              a soporte. */}
          Al pedir soporte, indique el código del equipo. Si alguno de estos ya
          no está con usted, avise para que se registre la devolución.
        </p>
      )}
    </div>
  );
}
