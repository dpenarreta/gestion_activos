import { useState } from "react";

import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../utils/errores";
import { fechaHora } from "./formatoMatriz";
import { MINIMO_MOTIVO } from "./MotivoModal";

/**
 * Cambiar la fecha de vencimiento (§15.5): fecha y hora nuevas, con
 * justificación. El aviso va primero porque es lo que más importa saber antes
 * de confirmar: el cambio no se puede borrar.
 */
export function CambiarFechaModal({ periodo, onCerrar, onGuardado }) {
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("17:00");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const zona = periodo.empresa?.zona_horaria;

  async function guardar(evento) {
    evento.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const actualizado = await matrizService.cambiarVencimiento(periodo.id, {
        due_date: fecha,
        due_time: hora || null,
        reason: motivo.trim(),
      });
      onGuardado(actualizado);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo cambiar la fecha."));
      setIsSaving(false);
    }
  }

  return (
    <ModalDialog
      titulo="Cambiar fecha de vencimiento"
      subtitulo={`${periodo.codigo} · ${periodo.obligacion.nombre}`}
      onCerrar={onCerrar}
      onSubmit={guardar}
      textoConfirmar="Cambiar fecha"
      isSaving={isSaving}
      puedeConfirmar={Boolean(fecha) && motivo.trim().length >= MINIMO_MOTIVO}
    >
      <div className="mz-alert mz-alert--warn" role="note">
        <Icon name="exclamation-triangle" />
        Este cambio queda registrado en el historial junto con la fecha anterior
        y no puede eliminarse.
      </div>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      <div className="mz-kv mb-3">
        <span className="mz-kv-label">Vencimiento actual</span>
        {fechaHora(periodo.vence_en, zona)}
      </div>
      <div className="mz-field-grid">
        <div className="mz-field">
          <label htmlFor="nueva-fecha">Nueva fecha</label>
          <input
            id="nueva-fecha"
            type="date"
            className="form-control"
            required
            min={periodo.fecha_inicio}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>
        <div className="mz-field">
          <label htmlFor="nueva-hora">Hora</label>
          <input
            id="nueva-hora"
            type="time"
            className="form-control"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
          />
        </div>
        <div className="mz-field mz-field--full">
          <label htmlFor="justificacion">Justificación</label>
          <textarea
            id="justificacion"
            className="form-control"
            rows={3}
            required
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <div className="form-text">Al menos {MINIMO_MOTIVO} caracteres.</div>
        </div>
      </div>
    </ModalDialog>
  );
}
