import { createPortal } from "react-dom";

import { useModalA11y } from "../../../hooks/useModalA11y";
import { descargarBlob } from "../../../utils/descargas";
import { Icon } from "../../common/Icon/Icon";

/**
 * Una foto del chat a pantalla completa (17/11/2026, pedido del usuario).
 *
 * Al pulsar la miniatura se abre sobre todo —también desde la ventana
 * flotante del chat, por eso va en un portal al `body`— con la imagen
 * ajustada a la pantalla, su nombre, «Descargar» y «Cerrar». Se cierra con
 * Escape, con la X o tocando fuera de la imagen: no hay nada que perder.
 *
 * Recibe la URL del blob que ya pinta la miniatura (con un tipo de imagen de
 * la lista, `blobDeImagen`), así que no se vuelve a descargar.
 */
export function VisorImagenChat({ url, blob, nombre, onCerrar }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
    closeOnBackdrop: true,
    confirmarAlDescartar: false,
  });

  return createPortal(
    <div
      className="chat-visor"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="chat-visor__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-visor-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="chat-visor__barra">
          <span id="chat-visor-titulo" className="chat-visor__nombre">
            {nombre}
          </span>
          {blob && (
            <button
              type="button"
              className="chat-visor__boton"
              onClick={() => descargarBlob(blob, nombre)}
            >
              <Icon name="download" /> Descargar
            </button>
          )}
          <button
            type="button"
            className="chat-visor__boton chat-visor__cerrar"
            onClick={onCerrar}
            aria-label="Cerrar la imagen"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div
          className="chat-visor__cuerpo"
          onClick={handleBackdropClick}
          role="presentation"
        >
          <img className="chat-visor__imagen" src={url} alt={nombre} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
