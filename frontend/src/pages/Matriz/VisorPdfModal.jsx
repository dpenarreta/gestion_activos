import { useEffect, useState } from "react";

import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";

/** Descarga un documento con el cliente autenticado (el endpoint exige la
 * sesión y audita el acceso). */
export async function descargarDocumento(documento) {
  const blob = await matrizService.archivo(documento.id, { descarga: true });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = documento.nombre_original;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * El visor de evidencias (§15.5): la lista de documentos válidos a un lado y
 * el PDF real con el visor del navegador —páginas, zoom, imprimir—.
 *
 * El PDF se pide con la sesión y se muestra desde un `blob:`: el endpoint no
 * acepta el token en la dirección, y no debería, porque quedaría en el
 * historial del navegador.
 */
export function VisorPdfModal({ documentos, inicial, onCerrar }) {
  const [actual, setActual] = useState(inicial ?? documentos[0]);
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });

  useEffect(() => {
    if (!actual) return undefined;
    let vigente = true;
    let creada = null;
    setUrl(null);
    setError(null);
    matrizService
      .archivo(actual.id)
      .then((blob) => {
        if (!vigente) return;
        creada = URL.createObjectURL(blob);
        setUrl(creada);
      })
      .catch(
        (err) =>
          vigente && setError(mensajeDeError(err, "No se pudo abrir el PDF.")),
      );
    return () => {
      vigente = false;
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [actual]);

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visor-titulo"
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="visor-titulo">Evidencias</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body">
          <div className="mz-viewer">
            <nav className="mz-viewer-side" aria-label="Documentos">
              {documentos.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  className={`mz-vdoc ${doc.id === actual?.id ? "is-active" : ""}`}
                  aria-current={doc.id === actual?.id ? "true" : undefined}
                  onClick={() => setActual(doc)}
                >
                  <Icon name="file-earmark-pdf" /> {doc.nombre_original}
                  <span className="mz-small mz-faint d-block">
                    v{doc.version}
                  </span>
                </button>
              ))}
            </nav>
            <div className="mz-viewer-stage">
              <div className="mz-viewer-toolbar">
                <span className="mz-strong mz-ellipsis">
                  {actual?.nombre_original}
                </span>
                <span className="mz-spacer" />
                {actual && (
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => descargarDocumento(actual)}
                  >
                    <Icon name="download" /> Descargar
                  </button>
                )}
              </div>
              {error && (
                <div className="mz-alert mz-alert--bad m-3" role="alert">
                  <Icon name="x-octagon" />
                  {error}
                </div>
              )}
              {!url && !error && (
                <div className="mz-empty">Cargando el PDF…</div>
              )}
              {url && (
                <iframe
                  className="mz-viewer-frame"
                  src={url}
                  title={actual?.nombre_original}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
