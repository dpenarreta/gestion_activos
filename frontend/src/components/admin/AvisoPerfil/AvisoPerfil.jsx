import { useEffect, useState } from "react";

import { misDatosService } from "../../../api/misDatosService";
import { useAuth } from "../../../hooks/useAuth";
import { useModalA11y } from "../../../hooks/useModalA11y";
import {
  DATOS_OBLIGATORIOS,
  FormularioMisDatos,
} from "../../../pages/MisDatos/MisDatosPage";
import { Icon } from "../../common/Icon/Icon";
import "./AvisoPerfil.css";

/** Se ignora: la ventana no se cierra con Escape ni haciendo clic fuera. */
const NO_SE_CIERRA = () => {};

function Ventana({ datos, onGuardado, onSalir }) {
  const { panelRef } = useModalA11y({
    isOpen: true,
    onRequestClose: NO_SE_CIERRA,
  });
  const faltan = new Set(datos.faltan);
  return (
    <div className="mz-overlay mz-overlay--center" role="presentation">
      <div
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aviso-perfil-titulo"
        aria-describedby="aviso-perfil-desc"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <div>
            <h3 id="aviso-perfil-titulo">
              Complete su información para continuar
            </h3>
            <p id="aviso-perfil-desc" className="mz-desc">
              Antes de usar el sistema, su perfil debe tener todos estos datos.
              Es obligatorio: no podrá continuar hasta completarlos.
            </p>
          </div>
        </div>
        <div className="mz-panel-body mz-stack">
          <ul className="perfil-obligatorio" aria-label="Datos obligatorios">
            {DATOS_OBLIGATORIOS.map(([clave, nombre]) => (
              <li
                key={clave}
                className={
                  faltan.has(clave)
                    ? "perfil-obligatorio__falta"
                    : "perfil-obligatorio__listo"
                }
              >
                <Icon
                  name={
                    faltan.has(clave)
                      ? "exclamation-circle-fill"
                      : "check-circle-fill"
                  }
                />
                {nombre}
                <span className="visually-hidden">
                  {faltan.has(clave) ? ": falta" : ": completo"}
                </span>
              </li>
            ))}
          </ul>
          <FormularioMisDatos
            datos={datos}
            onGuardado={onGuardado}
            textoBoton="Guardar y continuar"
            accionExtra={
              <button
                type="button"
                className="btn btn-danger"
                onClick={onSalir}
              >
                <Icon name="box-arrow-right" /> Cerrar sesión
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Al entrar al sistema (y en cada carga, mientras falte algo) se revisa el
 * perfil de la persona: nombres, apellidos, correo institucional, teléfono,
 * área, agencia y cargo. Si falta cualquiera, el sistema queda bloqueado con
 * esta ventana, que no se cierra: solo se sale completándolos o cerrando la
 * sesión. El correo no lo cambia la persona; si no es institucional, lo
 * corrige la administración.
 */
export function AvisoPerfil() {
  const { user, logout } = useAuth();
  const [datos, setDatos] = useState(null);
  const usuario = user?.id;

  useEffect(() => {
    if (!usuario) return undefined;
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

  return (
    <Ventana
      datos={datos}
      onSalir={() => logout?.()}
      onGuardado={(nuevos) => {
        if (nuevos?.faltan?.length) setDatos(nuevos);
        else setDatos(null);
      }}
    />
  );
}
