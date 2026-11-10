import { useCallback, useState } from "react";
import { createPortal } from "react-dom";

import { ModalDialog } from "../ModalDialog/ModalDialog";

const MINIMO = 5;

function DialogoMotivo({ titulo, detalle, textoConfirmar, onListo }) {
  const [motivo, setMotivo] = useState("");
  const valido = motivo.trim().length >= MINIMO;

  // Escape lo resuelve la pila de useModalA11y: cierra solo esta ventana,
  // sin perder lo escrito en la de abajo, y pregunta antes de descartar el
  // motivo como la X y «Cancelar». El manejador propio que había se saltaba la
  // pila y dejaba abierto el aviso de descarte (auditoría UX/UI, 10/11/2026).
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
        // Se escribe enseguida: el diálogo se abrió para eso. Con
        // `data-autofocus` lo enfoca useModalA11y, que así recuerda el botón
        // que lo abrió y le devuelve el foco al cerrar (con `autoFocus` el
        // foco caía en la X y, al cerrar, en <body>).
        data-autofocus
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

  // Va al final de <body> con un portal: se pide desde dentro de otra ventana
  // (el formulario del cambio), y si se pintaba donde se usaba el hook quedaba
  // debajo de ella, con el mismo z-index (10/11/2026: al editar una unidad,
  // «Guardar cambios» parecía no hacer nada y el motivo solo se veía al
  // cancelar el formulario).
  const dialogo = pedido
    ? createPortal(
        <DialogoMotivo
          titulo={pedido.opciones.titulo ?? "¿Por qué se hace este cambio?"}
          textoConfirmar={pedido.opciones.textoConfirmar ?? "Guardar el cambio"}
          detalle={pedido.detalle}
          onListo={(motivo) => {
            pedido.resolver(motivo);
            setPedido(null);
          }}
        />,
        document.body,
      )
    : null;

  return [pedir, dialogo];
}
