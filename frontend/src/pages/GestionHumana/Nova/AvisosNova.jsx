/*
 * Las marcas comunes de Nova: el aviso de que un texto lo redactó la IA y el
 * de que se muestra la versión sin IA (con el motivo que dio el servidor).
 * El color nunca va solo: cada marca lleva su texto.
 */
import { Icon } from "../../../components/common/Icon/Icon";

/** Aviso visible de que el texto es generado por IA. */
export function AvisoIa({ className = "" }) {
  return (
    <p className={`mz-small mz-faint mb-0 ${className}`.trim()}>
      <Icon name="stars" /> Texto generado por IA (Nova) a partir de los
      indicadores ya calculados. Revíselo antes de decidir: puede contener
      errores.
    </p>
  );
}

/** La versión sin IA, con el motivo (sin clave, límite diario, fallo…). */
export function AvisoSinIa({ mensaje, className = "" }) {
  return (
    <p
      className={`mz-alert mz-alert--info mb-0 ${className}`.trim()}
      role="note"
    >
      <Icon name="info-circle" />
      <span>
        <strong>Versión sin IA.</strong>{" "}
        {mensaje ?? "Nova no está disponible: se muestra la versión sin IA."}
      </span>
    </p>
  );
}
