import { useEffect, useState } from "react";

import { nominaService } from "../../api/nominaService";
import { Icon } from "../../components/common/Icon/Icon";
import { descargarBlob } from "../../utils/descargas";
import { mensajeDeError } from "../../utils/errores";

/** Lo que acepta una respuesta (las reglas de los adjuntos del servidor). */
export const ACEPTA_ADJUNTOS = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx";
export const MAXIMO_ADJUNTOS = 5;
export const TAMANO_MAXIMO = 10 * 1024 * 1024;

export function pesoLegible(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Una imagen adjunta: se pide por la API (lleva la sesión) y se muestra en
 * miniatura; al pulsarla se abre en grande en otra pestaña. */
function Miniatura({ adjunto }) {
  const [url, setUrl] = useState(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    let vigente = true;
    let creada = null;
    nominaService
      .adjuntoObservacion(adjunto.id)
      .then((blob) => {
        if (!vigente) return;
        creada = URL.createObjectURL(blob);
        setUrl(creada);
      })
      // Antes un fallo dejaba el ícono como si siguiera cargando (auditoría
      // UX/UI, fase 2, 28/10/2026): ahora lo dice.
      .catch(() => vigente && setFallo(true));
    return () => {
      vigente = false;
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [adjunto.id]);
  return (
    <a
      className="obs-adjunto obs-adjunto--imagen"
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      title={adjunto.nombre}
    >
      {url ? (
        <img src={url} alt={adjunto.nombre} />
      ) : fallo ? (
        <Icon
          name="exclamation-triangle"
          label={`No se pudo cargar la vista previa de ${adjunto.nombre}`}
        />
      ) : (
        <Icon name="image" label={adjunto.nombre} />
      )}
    </a>
  );
}

/**
 * Las imágenes y los archivos de una respuesta a una observación del rol de
 * pagos (22/10/2026): miniaturas para las imágenes y un botón para descargar
 * el resto.
 */
export function AdjuntosObservacion({ adjuntos }) {
  const [error, setError] = useState(null);
  if (!adjuntos?.length) return null;

  async function descargar(adjunto) {
    setError(null);
    try {
      descargarBlob(
        await nominaService.adjuntoObservacion(adjunto.id),
        adjunto.nombre,
      );
    } catch (err) {
      setError(
        mensajeDeError(err, `No se pudo descargar «${adjunto.nombre}».`),
      );
    }
  }

  return (
    <div className="obs-adjuntos" aria-label="Adjuntos">
      {adjuntos
        .filter((a) => a.es_imagen)
        .map((a) => (
          <Miniatura key={a.id} adjunto={a} />
        ))}
      {adjuntos.map((a) => (
        <button
          key={a.id}
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => descargar(a)}
        >
          <Icon name={a.es_imagen ? "image" : "paperclip"} /> {a.nombre}{" "}
          <small className="mz-faint">({pesoLegible(a.tamano)})</small>
        </button>
      ))}
      {error && (
        <small className="mz-field-error d-block" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
