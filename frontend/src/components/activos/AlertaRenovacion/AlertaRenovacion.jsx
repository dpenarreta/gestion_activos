import { Icon } from "../../common/Icon/Icon";
import { NivelRenovacion } from "../NivelRenovacion/NivelRenovacion";
import "./AlertaRenovacion.css";

const ETIQUETAS_CRITERIO = {
  mantenimientos: "Intervenciones acumuladas",
  componentes_criticos: "Piezas críticas sustituidas",
  longevidad: "Antigüedad del equipo",
};

/**
 * Alerta de sugerencia de cambio o renovación (RF-07).
 *
 * Enumera cada criterio superado con su valor y su umbral, en vez de mostrar
 * un simple "conviene reemplazarlo": el propósito declarado del requerimiento
 * es dar al área financiera un respaldo cuantitativo para justificar una
 * compra, y "excede el límite" sin cifras no sirve para eso.
 */
export function AlertaRenovacion({ renovacion }) {
  if (!renovacion?.requiere_renovacion) {
    return null;
  }

  // El nivel tiñe la alerta entera: un «reemplazo recomendado» y un «evaluar»
  // con el mismo amarillo se leerían como el mismo grado de urgencia.
  const esRecomendado = renovacion.nivel_renovacion === "recomendado";

  return (
    <div
      className={`mz-alert ${esRecomendado ? "mz-alert--bad" : "mz-alert--warn"} alerta-renovacion`}
      role="status"
    >
      <Icon
        name={
          esRecomendado
            ? "exclamation-octagon-fill"
            : "exclamation-triangle-fill"
        }
        className="alerta-renovacion__icono"
      />
      <div className="alerta-renovacion__cuerpo">
        <div className="alerta-renovacion__titulo">
          <h3>Sugerencia de cambio o renovación</h3>
          <NivelRenovacion
            nivel={renovacion.nivel_renovacion}
            etiqueta={renovacion.nivel_renovacion_display}
          />
        </div>
        <p className="mb-2">
          Este equipo excede los umbrales definidos
          {renovacion.politica_aplicada && (
            <>
              {" "}
              por la política <strong>{renovacion.politica_aplicada}</strong>
            </>
          )}
          .
        </p>
        <ul className="alerta-renovacion__motivos">
          {renovacion.motivos.map((motivo) => (
            <li key={motivo.criterio}>
              <span className="alerta-renovacion__criterio">
                {ETIQUETAS_CRITERIO[motivo.criterio] || motivo.criterio}
              </span>
              <span className="alerta-renovacion__cifras">
                {motivo.valor_actual} <span aria-hidden="true">/</span>
                <span className="visually-hidden">de un umbral de</span>{" "}
                {motivo.umbral}
              </span>
              <span className="alerta-renovacion__detalle">
                {motivo.detalle}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
