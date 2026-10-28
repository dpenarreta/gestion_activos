import { useCallback, useEffect, useState } from "react";

import { misEquiposService } from "../../../api/activosService";
import { EstadoActivo } from "../../../components/activos/EstadoActivo/EstadoActivo";
import { Icon } from "../../../components/common/Icon/Icon";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { formatearDias, formatearFecha } from "../../../utils/formato";
import { mensajeDeError } from "../../../utils/errores";
import "./MisEquipos.css";

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

  const cargar = useCallback(() => {
    setError(null);
    setIsCargando(true);
    misEquiposService
      .consultar()
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar sus equipos.")),
      )
      .finally(() => setIsCargando(false));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="mis-equipos-page">
      <div className="mz-view-head">
        <div>
          <h2>Mis equipos</h2>
          {datos?.empleado && (
            <p className="mz-desc">
              {datos.empleado.nombre} · {datos.empleado.codigo} ·{" "}
              {datos.empleado.departamento}
            </p>
          )}
        </div>
      </div>

      {/* Antes no había indicador mientras cargaba: la pantalla quedaba
          vacía hasta que llegaban los equipos (auditoría UX/UI, fase 2,
          28/10/2026). */}
      <EstadoDeCarga
        cargando={isCargando}
        error={error}
        onReintentar={cargar}
      />

      {/* La cuenta sin ficha de empleado no es una lista vacía: el sistema no
          sabe qué equipos son suyos, y eso lo arregla un administrador. */}
      {datos?.aviso && (
        <div className="mz-alert mz-alert--warn">
          <Icon name="exclamation-triangle" />
          {datos.aviso}
        </div>
      )}

      {!isCargando &&
        !error &&
        !datos?.aviso &&
        datos?.equipos.length === 0 && (
          <div className="mz-alert mz-alert--info" role="status">
            <Icon name="info-circle" />
            No tiene equipos a su cargo. Si acaba de recibir uno, pídale a
            soporte que registre la entrega.
          </div>
        )}

      <div className="mis-equipos">
        {(datos?.equipos ?? []).map((equipo) => (
          <article className="mz-card equipo-card" key={equipo.id}>
            <header className="mz-card-head equipo-card__cabecera">
              <div className="min-w-0">
                <h3>{equipo.nombre}</h3>
                <p className="mz-desc">
                  {equipo.tipo_nombre} · {equipo.marca} {equipo.modelo}
                </p>
              </div>
              <EstadoActivo
                estado={equipo.estado}
                etiqueta={equipo.estado_display}
              />
            </header>

            <div className="mz-card-body">
              <div className="mz-kv-grid">
                <div className="mz-kv">
                  <span className="mz-kv-label">Código</span>
                  <code className="mz-mono equipo-card__codigo">
                    {equipo.codigo_barras}
                  </code>
                </div>
                <div className="mz-kv">
                  <span className="mz-kv-label">Serie</span>
                  <code className="mz-mono equipo-card__codigo">
                    {equipo.numero_serie}
                  </code>
                </div>
                <div className="mz-kv">
                  <span className="mz-kv-label">Desde</span>
                  {equipo.desde ? (
                    <>
                      {formatearFecha(equipo.desde)}
                      {/* La fecha sola obliga a contar: lo que se quiere saber
                          es si el equipo lleva dos meses o cuatro años. */}
                      <span className="mz-faint">
                        {" "}
                        · hace {formatearDias(diasCon(equipo.desde))}
                      </span>
                    </>
                  ) : (
                    <span className="mz-faint">Sin registro de entrega</span>
                  )}
                </div>
                <div className="mz-kv">
                  <span className="mz-kv-label">Ciudad</span>
                  {equipo.ciudad || <span className="mz-faint">—</span>}
                </div>
                {/* Es lo primero que se pregunta cuando algo falla en un aparato
                    de turno: si responde más gente, hay a quién avisar antes de
                    llevárselo. */}
                {equipo.compartido && (
                  <div className="mz-kv mz-kv--full">
                    <span className="mz-kv-label">Responden también</span>
                    {equipo.con_quien_mas?.length ? (
                      equipo.con_quien_mas.join(", ")
                    ) : (
                      <span className="mz-faint">Solo usted, por ahora</span>
                    )}
                  </div>
                )}
              </div>

              {Object.keys(equipo.especificaciones ?? {}).length > 0 && (
                <ul className="equipo-card__especificaciones">
                  {Object.entries(equipo.especificaciones).map(
                    ([clave, valor]) => (
                      <li key={clave}>
                        <span className="mz-faint">{clave}:</span> {valor}
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>
          </article>
        ))}
      </div>

      {(datos?.equipos ?? []).length > 0 && (
        <p className="mz-note">
          <Icon name="info-circle" />
          {/* Lo que hay que hacer con la pantalla, no solo lo que muestra: el
              código es lo que se le pide a quien tiene el equipo cuando llama
              a soporte. */}
          <span>
            Al pedir soporte, indique el código del equipo. Si alguno de estos
            ya no está con usted, avise para que se registre la devolución.
          </span>
        </p>
      )}
    </div>
  );
}
