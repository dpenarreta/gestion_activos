import { useCallback, useEffect, useState } from "react";

import { ModalDialog } from "../ModalDialog/ModalDialog";

const MINIMO = 5;

function DialogoMotivo({ titulo, detalle, textoConfirmar, onListo }) {
  const [motivo, setMotivo] = useState("");
  const valido = motivo.trim().length >= MINIMO;

  // Se abre encima de otra ventana (el formulario del cambio): Escape cierra
  // solo esta, sin perder lo escrito en la de abajo.
  useEffect(() => {
    function alEscape(evento) {
      if (evento.key !== "Escape") return;
      evento.stopImmediatePropagation();
      onListo(null);
    }
    window.addEventListener("keydown", alEscape, true);
    return () => window.removeEventListener("keydown", alEscape, true);
  }, [onListo]);

  return (
    <ModalDialog
      titulo={titulo}
      subtitulo="Queda en la bitácora del organigrama, con quién lo hizo, cuándo y desde dónde."
      onCerrar={() => onListo(null)}
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) onListo(motivo.trim());
      }}
      textoConfirmar={textoConfirmar}
      puedeConfirmar={valido}
    >
      {detalle && <p className="mb-2">{detalle}</p>}
      <label className="form-label" htmlFor="pedir-motivo">
        Motivo del cambio
      </label>
      <textarea
        id="pedir-motivo"
        className="form-control"
        rows={3}
        maxLength={1000}
        // Se escribe enseguida: el diálogo se abrió para eso.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        placeholder="Por qué se hace este cambio"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
      />
      {!valido && (
        <small className="mz-faint">
          Escriba al menos {MINIMO} caracteres.
        </small>
      )}
    </ModalDialog>
  );
}

/**
 * Pide el motivo de un cambio al organigrama antes de guardarlo
 * (26/10/2026, bitácora del organigrama). Devuelve `[pedir, dialogo]`:
 * `pedir(detalle)` abre el diálogo y se resuelve con el motivo escrito, o con
 * `null` si se cancela; `dialogo` se pinta donde se use.
 */
export function usePedirMotivo() {
  const [pedido, setPedido] = useState(null);

  const pedir = useCallback(
    (detalle = "", opciones = {}) =>
      new Promise((resolver) => setPedido({ detalle, opciones, resolver })),
    [],
  );

  const dialogo = pedido ? (
    <DialogoMotivo
      titulo={pedido.opciones.titulo ?? "¿Por qué se hace este cambio?"}
      textoConfirmar={pedido.opciones.textoConfirmar ?? "Guardar el cambio"}
      detalle={pedido.detalle}
      onListo={(motivo) => {
        pedido.resolver(motivo);
        setPedido(null);
      }}
    />
  ) : null;

  return [pedir, dialogo];
}
