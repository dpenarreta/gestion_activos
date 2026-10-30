import { useEffect, useState } from "react";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { VisorPdf } from "../../components/common/VisorPdf/VisorPdf";
import { useModalA11y } from "../../hooks/useModalA11y";
import { descargarBlob } from "../../utils/descargas";

const IMAGEN = /\.(png|jpe?g|webp|gif)$/i;
const PDF = /\.pdf$/i;

/** ¿Se puede ver dentro del sistema? (PDF e imágenes; Word y Excel se
 * descargan). */
export function seVeAdentro(nombre) {
  return PDF.test(nombre ?? "") || IMAGEN.test(nombre ?? "");
}

/**
 * Abrir un adjunto de la mesa de ayuda: el PDF en el visor del sistema y la
 * imagen en una ventana, sin pasar por la carpeta de descargas (auditoría
 * UX/UI, 30/10/2026: una captura obligaba a descargarla). Lo demás se
 * descarga. Devuelve `abrir(adjunto)`, el visor a pintar y el error.
 */
export function useVisorDeAdjuntos() {
  const [abierto, setAbierto] = useState(null);
  const [error, setError] = useState(null);

  async function abrir(adjunto) {
    setError(null);
    try {
      const respuesta = await soporteService.descargar(adjunto.url);
      if (seVeAdentro(adjunto.nombre)) {
        setAbierto({ nombre: adjunto.nombre, blob: respuesta.data });
      } else {
        descargarBlob(respuesta.data, adjunto.nombre);
      }
    } catch {
      setError(`No se pudo abrir «${adjunto.nombre}».`);
    }
  }

  const visor = !abierto ? null : PDF.test(abierto.nombre) ? (
    <VisorPdf
      titulo={abierto.nombre}
      blob={abierto.blob}
      nombreArchivo={abierto.nombre}
      onCerrar={() => setAbierto(null)}
    />
  ) : (
    <VisorImagen
      nombre={abierto.nombre}
      blob={abierto.blob}
      onCerrar={() => setAbierto(null)}
    />
  );
  return { abrir, visor, error };
}

function VisorImagen({ nombre, blob, onCerrar }) {
  const [url, setUrl] = useState(null);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  useEffect(() => {
    const direccion = URL.createObjectURL(blob);
    setUrl(direccion);
    return () => URL.revokeObjectURL(direccion);
  }, [blob]);

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal mz-modal--wide soporte-visor-imagen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visor-imagen-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="visor-imagen-titulo">{nombre}</h3>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => descargarBlob(blob, nombre)}
          >
            <Icon name="download" /> Descargar
          </button>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body soporte-visor-imagen__cuerpo">
          {url && <img src={url} alt={nombre} />}
        </div>
      </div>
    </div>
  );
}
