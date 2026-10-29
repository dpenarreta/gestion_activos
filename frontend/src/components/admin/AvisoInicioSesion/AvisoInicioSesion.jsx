import { useEffect, useState } from "react";

import { avisoInicioService } from "../../../api/avisoInicioService";
import { useAuth } from "../../../hooks/useAuth";
import { useModalA11y } from "../../../hooks/useModalA11y";
import { blobDeImagen } from "../../../utils/blobs";
import { Icon } from "../../common/Icon/Icon";
import "./AvisoInicioSesion.css";

const CLAVE = "aviso_inicio.visto";

function versionVista(usuario) {
  try {
    return sessionStorage.getItem(`${CLAVE}.${usuario}`);
  } catch {
    return null;
  }
}

function marcarVisto(usuario, version) {
  try {
    sessionStorage.setItem(`${CLAVE}.${usuario}`, String(version));
  } catch {
    /* Sin almacenamiento puede volver a salir en esta sesión: no es grave. */
  }
}

/**
 * La ventana del aviso: título, imagen (si tiene), contenido y «Cerrar». La
 * usan el aviso al entrar y la vista previa de Configuración, para que se vea
 * exactamente igual.
 */
export function VentanaAviso({ titulo, contenido, imagenUrl, onCerrar }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  return (
    <div
      className="mz-overlay mz-overlay--center aviso-inicio__fondo"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="aviso-inicio"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aviso-inicio-titulo"
        aria-describedby="aviso-inicio-contenido"
        ref={panelRef}
        tabIndex={-1}
      >
        <button
          type="button"
          className="aviso-inicio__cerrar-x"
          onClick={onCerrar}
          aria-label="Cerrar aviso"
        >
          <Icon name="x-lg" />
        </button>
        {imagenUrl && (
          <img className="aviso-inicio__imagen" src={imagenUrl} alt="" />
        )}
        <div className="aviso-inicio__cuerpo">
          <span className="aviso-inicio__etiqueta">
            <Icon name="megaphone-fill" /> Aviso importante
          </span>
          <h2 id="aviso-inicio-titulo">{titulo}</h2>
          {contenido && (
            <div
              id="aviso-inicio-contenido"
              className="aviso-inicio__contenido"
            >
              {contenido}
            </div>
          )}
          <div className="aviso-inicio__acciones">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onCerrar}
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Al entrar al sistema tras iniciar sesión: si la empresa tiene un aviso
 * encendido y la persona no lo cerró ya en esta sesión, se le muestra. Cerrado,
 * no vuelve a salir hasta el próximo inicio de sesión, salvo que el aviso
 * cambie. `onTerminado` avisa cuando ya no hay aviso que mostrar (para que el
 * de «Mi perfil» salga después, y no encima).
 */
export function AvisoInicioSesion({ onTerminado }) {
  const { user } = useAuth();
  const usuario = user?.id;
  const [aviso, setAviso] = useState(null);
  const [imagenUrl, setImagenUrl] = useState(null);

  useEffect(() => {
    if (!usuario) return undefined;
    let vigente = true;
    Promise.resolve(avisoInicioService.obtener?.())
      .then((datos) => {
        if (!vigente) return;
        if (
          datos?.activo &&
          datos.titulo &&
          versionVista(usuario) !== String(datos.version)
        ) {
          setAviso(datos);
        } else {
          onTerminado?.();
        }
      })
      .catch(() => vigente && onTerminado?.());
    return () => {
      vigente = false;
    };
    // `onTerminado` cambia en cada render del layout; basta con el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  useEffect(() => {
    if (!aviso?.tiene_imagen) return undefined;
    let url = null;
    avisoInicioService
      .imagen()
      .then((blob) => {
        // Solo con un tipo de imagen de la lista (auditoría de seguridad,
        // 29/10/2026); si no, el aviso sale sin imagen.
        const imagen = blobDeImagen(blob);
        if (!imagen) return;
        url = URL.createObjectURL(imagen);
        setImagenUrl(url);
      })
      .catch(() => null);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [aviso]);

  if (!aviso) return null;

  function cerrar() {
    marcarVisto(usuario, aviso.version);
    setAviso(null);
    onTerminado?.();
  }

  return (
    <VentanaAviso
      titulo={aviso.titulo}
      contenido={aviso.contenido}
      imagenUrl={imagenUrl}
      onCerrar={cerrar}
    />
  );
}
