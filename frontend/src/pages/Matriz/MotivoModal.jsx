import { useState } from "react";

import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../utils/errores";

export const MINIMO_MOTIVO = 10;

/**
 * Pide un motivo antes de una acción que lo exige: devolver un período o
 * rechazar una evidencia (§15.5). Al menos 10 caracteres —«ok» no explica nada
 * el día que alguien pregunta por qué—; lo comprueba también el servidor.
 */
export function MotivoModal({
  titulo,
  subtitulo,
  etiqueta = "Motivo",
  textoConfirmar,
  variante = "primary",
  onConfirmar,
  onCerrar,
}) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const largo = motivo.trim().length;

  async function confirmar(evento) {
    evento.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await onConfirmar(motivo.trim());
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo completar la acción."));
      setIsSaving(false);
    }
  }

  return (
    <ModalDialog
      titulo={titulo}
      subtitulo={subtitulo}
      onCerrar={onCerrar}
      onSubmit={confirmar}
      textoConfirmar={textoConfirmar}
      variante={variante}
      isSaving={isSaving}
      puedeConfirmar={largo >= MINIMO_MOTIVO}
    >
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      <div className="mz-field">
        <label htmlFor="motivo">{etiqueta}</label>
        <textarea
          id="motivo"
          className="form-control"
          rows={3}
          required
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          aria-describedby="motivo-ayuda"
        />
        <div id="motivo-ayuda" className="form-text">
          {largo < MINIMO_MOTIVO
            ? `Al menos ${MINIMO_MOTIVO} caracteres (faltan ${MINIMO_MOTIVO - largo}).`
            : "Queda registrado en el historial del período."}
        </div>
      </div>
    </ModalDialog>
  );
}
