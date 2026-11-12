import { Campo } from "../../../components/common/Campo/Campo";
import { SANCION, TIPOS } from "./llamadosComunes";

/**
 * El nivel aplicado, con su justificación (obligatoria solo si se cambia el
 * propuesto) y el monto (solo en la sanción económica). Lo usan emitir y
 * confirmar, para que las dos pantallas pidan lo mismo.
 */
export function CamposDeNivel({
  prefijo,
  niveles,
  propuestoId,
  nivelId,
  onNivel,
  justificacion,
  onJustificacion,
  monto,
  onMonto,
  errores = {},
  deshabilitado = false,
}) {
  const elegido = niveles.find((n) => String(n.id) === String(nivelId));
  const cambia =
    propuestoId !== null &&
    nivelId !== "" &&
    String(nivelId) !== String(propuestoId);
  return (
    <>
      <Campo
        id={`${prefijo}-nivel`}
        etiqueta="Nivel"
        obligatorio
        error={errores.nivel}
        ayuda={
          propuestoId === null
            ? undefined
            : "El sistema propone el nivel según los llamados anteriores; puede cambiarlo."
        }
      >
        <select
          className="form-select"
          value={nivelId}
          disabled={deshabilitado}
          onChange={(e) => onNivel(e.target.value)}
        >
          <option value="">Elija un nivel</option>
          {niveles.map((n) => (
            <option key={n.id} value={n.id}>
              {n.nombre} ({TIPOS[n.tipo] ?? n.tipo})
              {String(n.id) === String(propuestoId) ? " · propuesto" : ""}
            </option>
          ))}
        </select>
      </Campo>
      {cambia && (
        <Campo
          id={`${prefijo}-justificacion`}
          etiqueta="Justificación del cambio de nivel"
          obligatorio
          error={errores.justificacion_cambio}
        >
          <textarea
            className="form-control"
            rows={2}
            value={justificacion}
            disabled={deshabilitado}
            onChange={(e) => onJustificacion(e.target.value)}
          />
        </Campo>
      )}
      {/* El servidor puede pedirla aunque el campo no esté a la vista (la
          propuesta cambió mientras tanto): el error se dice igual. */}
      {!cambia && errores.justificacion_cambio && (
        <p className="mz-field-error mb-0" role="alert">
          {errores.justificacion_cambio}
        </p>
      )}
      {elegido?.tipo === SANCION && (
        <Campo
          id={`${prefijo}-monto`}
          etiqueta="Monto de la sanción (USD)"
          obligatorio
          error={errores.monto}
          ayuda="Parte del monto sugerido del nivel. Gestión Humana valida los montos con el Código del Trabajo."
        >
          <input
            className="form-control"
            inputMode="decimal"
            value={monto}
            disabled={deshabilitado}
            onChange={(e) => onMonto(e.target.value)}
          />
        </Campo>
      )}
    </>
  );
}
