import { useState } from "react";

import { activosService } from "../../../api/activosService";
import { ModalDialog } from "../../common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../../utils/errores";

// Los nueve estados del §12, agrupados por lo que significan: el equipo está
// en el parque, o salió de él. La separación es visible en el desplegable
// porque los tres de abajo tienen consecuencias que los otros seis no tienen.
const ESTADOS_EN_PARQUE = [
  { valor: "disponible", etiqueta: "Disponible" },
  { valor: "en_uso", etiqueta: "Asignado" },
  { valor: "en_bodega", etiqueta: "En bodega" },
  { valor: "en_mantenimiento", etiqueta: "En reparación" },
  { valor: "en_garantia", etiqueta: "En reclamación de garantía" },
  { valor: "en_transito", etiqueta: "En tránsito" },
];

const ESTADOS_DE_SALIDA = [
  { valor: "dado_de_baja", etiqueta: "Dado de baja" },
  { valor: "perdido", etiqueta: "Perdido" },
  { valor: "robado", etiqueta: "Robado" },
];

const SALIDAS = new Set(ESTADOS_DE_SALIDA.map((opcion) => opcion.valor));

const ADVERTENCIAS = {
  dado_de_baja:
    "La baja no se revierte: el equipo no vuelve al inventario ni desde esta pantalla ni por la API. Su expediente e historial se conservan íntegros.",
  perdido:
    "El equipo queda fuera del inventario y sin custodio. Si aparece, se puede reingresar a bodega desde aquí mismo.",
  robado:
    "El equipo queda fuera del inventario y sin custodio. Conviene anotar el número de denuncia en el motivo: es lo que se consultará meses después.",
};

/**
 * Cambio de estado operativo del activo, incluidas las tres salidas.
 *
 * Las salidas se advierten explícitamente porque son las transiciones con
 * consecuencias que el usuario no ve al pulsar: el equipo deja de admitir
 * mantenimientos, pierde su custodio y desaparece de las sugerencias de
 * renovación y de las alertas. El motivo es obligatorio en las tres —el
 * backend lo exige— y aquí se bloquea el botón antes de enviar, para que la
 * regla no se descubra con un error.
 */
export function CambiarEstadoDialog({ activo, onCerrar, onGuardado }) {
  const [estado, setEstado] = useState(activo.estado);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const esSalida = SALIDAS.has(estado);
  const esBaja = estado === "dado_de_baja";
  const faltaMotivo = esSalida && !motivo.trim();
  // Una baja es definitiva: desde ella no hay ningún estado al que ir, y
  // ofrecer el desplegable haría prometer algo que el backend rechaza.
  const yaEstaDeBaja = activo.estado === "dado_de_baja";

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await activosService.cambiarEstado(activo.id, { estado, motivo });
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo cambiar el estado del activo."));
      setIsSaving(false);
    }
  }

  return (
    <ModalDialog
      titulo="Cambiar estado del activo"
      subtitulo={`${activo.codigo_barras} · ${activo.nombre}`}
      onCerrar={onCerrar}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      puedeConfirmar={!faltaMotivo && estado !== activo.estado && !yaEstaDeBaja}
      textoConfirmar={esBaja ? "Dar de baja" : "Confirmar"}
      variante={esSalida ? "danger" : "primary"}
    >
      {error && <div className="alert alert-danger">{error}</div>}

      {yaEstaDeBaja && (
        <div className="alert alert-secondary">
          Este activo está dado de baja: su estado ya no se modifica. Si el
          equipo volvió a la empresa, regístrelo como uno nuevo.
        </div>
      )}

      <div className="mb-3">
        <label className="form-label" htmlFor="estado">
          Nuevo estado
        </label>
        <select
          id="estado"
          className="form-select"
          value={estado}
          disabled={yaEstaDeBaja}
          onChange={(event) => setEstado(event.target.value)}
        >
          <optgroup label="En el parque">
            {ESTADOS_EN_PARQUE.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>
                {opcion.etiqueta}
              </option>
            ))}
          </optgroup>
          <optgroup label="Fuera del inventario">
            {ESTADOS_DE_SALIDA.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>
                {opcion.etiqueta}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {esSalida && !yaEstaDeBaja && (
        <div className={`alert ${esBaja ? "alert-warning" : "alert-danger"}`}>
          <strong>El equipo sale del inventario.</strong> {ADVERTENCIAS[estado]}
        </div>
      )}

      <div className="mb-0">
        <label className="form-label" htmlFor="motivo-estado">
          Motivo {esSalida && <span className="text-danger">*</span>}
        </label>
        <textarea
          id="motivo-estado"
          className="form-control"
          rows={2}
          required={esSalida}
          disabled={yaEstaDeBaja}
          placeholder={
            esSalida
              ? "Pantalla irreparable, denuncia 2026-114, no apareció en el conteo…"
              : "Opcional"
          }
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
        />
      </div>
    </ModalDialog>
  );
}
