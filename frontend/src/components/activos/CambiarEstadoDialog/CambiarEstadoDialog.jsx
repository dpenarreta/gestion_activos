import { useState } from "react";

import { activosService } from "../../../api/activosService";
import { ModalDialog } from "../../common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../../utils/errores";

const ESTADOS = [
  { valor: "en_uso", etiqueta: "En uso" },
  { valor: "en_bodega", etiqueta: "En bodega" },
  { valor: "en_mantenimiento", etiqueta: "En mantenimiento" },
  { valor: "dado_de_baja", etiqueta: "Dado de baja" },
];

/**
 * Cambio de estado operativo del activo, incluida la baja.
 *
 * La baja se advierte explícitamente porque es la única transición con
 * consecuencias que el usuario no ve al pulsar: el equipo deja de admitir
 * mantenimientos y desaparece de las sugerencias de renovación. El motivo es
 * obligatorio en ese caso —el backend lo exige— y aquí se bloquea el botón
 * antes de enviar, para que el usuario no descubra la regla con un error.
 */
export function CambiarEstadoDialog({ activo, onCerrar, onGuardado }) {
  const [estado, setEstado] = useState(activo.estado);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const esBaja = estado === "dado_de_baja";
  const faltaMotivo = esBaja && !motivo.trim();

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
      puedeConfirmar={!faltaMotivo && estado !== activo.estado}
      textoConfirmar={esBaja ? "Dar de baja" : "Confirmar"}
      variante={esBaja ? "danger" : "primary"}
    >
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="mb-3">
        <label className="form-label" htmlFor="estado">
          Nuevo estado
        </label>
        <select
          id="estado"
          className="form-select"
          value={estado}
          onChange={(event) => setEstado(event.target.value)}
        >
          {ESTADOS.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </select>
      </div>

      {esBaja && (
        <div className="alert alert-warning">
          <strong>La baja no se revierte desde la interfaz.</strong> El activo dejará de admitir
          mantenimientos y no volverá a aparecer entre las sugerencias de renovación. Su expediente
          e historial se conservan íntegros.
        </div>
      )}

      <div className="mb-0">
        <label className="form-label" htmlFor="motivo-estado">
          Motivo {esBaja && <span className="text-danger">*</span>}
        </label>
        <textarea
          id="motivo-estado"
          className="form-control"
          rows={2}
          required={esBaja}
          placeholder={esBaja ? "Pantalla irreparable, robo, obsolescencia…" : "Opcional"}
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
        />
      </div>
    </ModalDialog>
  );
}
