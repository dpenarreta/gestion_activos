import { useEffect, useState } from "react";

import { misDatosService } from "../../../api/misDatosService";
import { useAuth } from "../../../hooks/useAuth";
import { useModalA11y } from "../../../hooks/useModalA11y";
import {
  FormularioMisDatos,
  queFalta,
} from "../../../pages/MisDatos/MisDatosPage";
import { Icon } from "../../common/Icon/Icon";

const CLAVE = "perfil.aviso_visto";

function yaVisto(usuario) {
  try {
    return sessionStorage.getItem(`${CLAVE}.${usuario}`) === "1";
  } catch {
    return false;
  }
}

function marcarVisto(usuario) {
  try {
    sessionStorage.setItem(`${CLAVE}.${usuario}`, "1");
  } catch {
    /* Sin almacenamiento, el aviso puede volver a salir: no es grave. */
  }
}

function Ventana({ datos, onCerrar, onGuardado }) {
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
        className="mz-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aviso-perfil-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <div>
            <h3 id="aviso-perfil-titulo">Complete su información</h3>
            <p className="mz-desc">
              Le falta: {queFalta(datos.faltan)}. Con estos datos se cargan sus
              pedidos de soporte; luego puede cambiarlos desde su usuario, abajo
              en el menú, en «Mi perfil».
            </p>
          </div>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Completar después"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body">
          <FormularioMisDatos datos={datos} onGuardado={onGuardado} />
          <button
            type="button"
            className="btn btn-link btn-sm px-0"
            onClick={onCerrar}
          >
            Completar después
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Al iniciar sesión, si a la persona le faltan datos de su perfil (nombre,
 * teléfono, área o agencia), se lo pide en una ventana para que los complete
 * desde el principio. Si la cierra, no vuelve a salir hasta su próximo inicio
 * de sesión; los cambios después se hacen en «Mi perfil», desde su usuario.
 */
export function AvisoPerfil() {
  const { user } = useAuth();
  const [datos, setDatos] = useState(null);
  const usuario = user?.id;

  useEffect(() => {
    if (!usuario || yaVisto(usuario)) return undefined;
    let vigente = true;
    Promise.resolve(misDatosService.obtener?.())
      .then((respuesta) => {
        if (vigente && respuesta?.faltan?.length > 0) setDatos(respuesta);
      })
      .catch(() => null);
    return () => {
      vigente = false;
    };
  }, [usuario]);

  if (!datos) return null;

  function cerrar() {
    marcarVisto(usuario);
    setDatos(null);
  }

  return (
    <Ventana
      datos={datos}
      onCerrar={cerrar}
      onGuardado={(nuevos) => {
        if (nuevos?.faltan?.length) setDatos(nuevos);
        else cerrar();
      }}
    />
  );
}
