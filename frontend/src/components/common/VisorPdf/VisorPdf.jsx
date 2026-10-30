import { useEffect, useState } from "react";

import { useModalA11y } from "../../../hooks/useModalA11y";
import { Icon } from "../Icon/Icon";
import { LectorPdf, olvidarPdf, registrarPdf } from "./LectorPdf";
import "./VisorPdf.css";
import { descargarBlob } from "../../../utils/descargas";

/**
 * El visor de PDF del sistema: abre el documento dentro de la herramienta, en
 * una ventana casi a pantalla completa, sin descargarlo ni salir a otra
 * pestaña.
 *
 * Recibe el PDF ya traído con la sesión (`blob`): el archivo no tiene una URL
 * pública, así que se muestra desde una dirección `blob:` local, que se libera
 * al cerrar. Lo dibuja `LectorPdf` (pdf.js), con páginas y zoom propios, igual
 * en cualquier equipo (30/10/2026; antes el lector del navegador en un marco).
 */
export function VisorPdf({ titulo, blob, nombreArchivo, onCerrar }) {
  const url = useUrlDePdf(blob);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="visor-pdf"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visor-pdf-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="visor-pdf__cabecera">
          <Icon name="file-earmark-pdf" className="visor-pdf__icono" />
          <h3 id="visor-pdf-titulo">{titulo}</h3>
          {url && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => descargarBlob(blob, nombreArchivo)}
            >
              <Icon name="download" /> Descargar
            </button>
          )}
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar visor"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="visor-pdf__cuerpo">
          <MarcoPdf titulo={titulo} url={url} />
        </div>
      </div>
    </div>
  );
}

/** La dirección `blob:` local de un PDF ya traído; se libera al cambiar o
 * desmontar. */
export function useUrlDePdf(blob) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return undefined;
    }
    const pdf =
      blob.type === "application/pdf"
        ? blob
        : new Blob([blob], { type: "application/pdf" });
    const direccion = URL.createObjectURL(pdf);
    registrarPdf(direccion, pdf);
    setUrl(direccion);
    return () => {
      olvidarPdf(direccion);
      URL.revokeObjectURL(direccion);
    };
  }, [blob]);
  return url;
}

/** El PDF dentro de la página (sin ventana): lo usan el visor, los códigos
 * de conducta y el rol de pagos. */
export function MarcoPdf({ titulo, url }) {
  return <LectorPdf titulo={titulo} url={url} />;
}
