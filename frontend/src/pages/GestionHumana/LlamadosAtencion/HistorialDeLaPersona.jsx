import { fecha } from "../comunes";
import { nombreDe } from "./llamadosComunes";
import { PildoraEstado } from "./Piezas";

/**
 * El historial de la persona en la causa que sirve para proponer el nivel:
 * los llamados emitidos y no anulados dentro del plazo de reincidencia.
 */
export function HistorialDeLaPersona({ historial, plazoMeses, propuesto }) {
  return (
    <section aria-labelledby="llamado-historial-titulo">
      <h4 id="llamado-historial-titulo" className="h6">
        Historial de la persona en esta causa
      </h4>
      {plazoMeses && (
        <p className="mz-small mz-faint mb-1">
          Cuentan los llamados de los últimos {plazoMeses} meses (plazo de
          reincidencia).
        </p>
      )}
      {historial.length === 0 ? (
        <p className="mz-faint mz-small mb-0">
          Sin llamados vigentes dentro del plazo de reincidencia.
        </p>
      ) : (
        <ul className="mz-small mb-0">
          {historial.map((h, i) => (
            <li key={h.id ?? i}>
              {fecha(h.fecha_hecho ?? h.fecha)} · {nombreDe(h.nivel)}
              {h.estado && (
                <>
                  {" "}
                  <PildoraEstado estado={h.estado} />
                </>
              )}
              {h.cuenta !== undefined && (
                <span className="mz-faint">
                  {" "}
                  · {h.cuenta ? "cuenta" : "no cuenta"} para la reincidencia
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {propuesto && (
        <p className="mz-small mt-2 mb-0">
          Nivel propuesto: <strong>{propuesto}</strong>
        </p>
      )}
    </section>
  );
}
