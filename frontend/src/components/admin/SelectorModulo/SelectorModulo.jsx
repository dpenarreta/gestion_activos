import { useEffect, useId, useRef, useState } from "react";

import { useUnsavedChanges } from "../../../context/UnsavedChangesContext";
import { useAuth } from "../../../hooks/useAuth";
import { MODULOS, moduloPorId, recordarModulo } from "../../../modulos/modulos";
import { useModuloActivo } from "../../../modulos/useModuloActivo";
import { Icon } from "../../common/Icon/Icon";
import { modulosConAcceso } from "../AdminSidebar/staticAdminMenu";
import "./SelectorModulo.css";

/**
 * Elegir el módulo en el que se trabaja, en la barra superior, junto al
 * selector de empresa: los dos dicen *dónde* se está. No reemplaza al menú
 * lateral; decide qué menú se ve.
 *
 * Solo ofrece los módulos en los que la persona tiene algo que abrir **en la
 * empresa activa**: la Matriz depende del rol de la membresía, así que puede
 * aparecer en una empresa y no en la otra. Con un solo módulo no se dibuja: un
 * selector de una opción no elige nada.
 */
export function SelectorModulo() {
  const { user } = useAuth();
  const { guardedNavigate } = useUnsavedChanges();
  const activo = moduloPorId(useModuloActivo());
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef(null);
  const boton = useRef(null);
  const idMenu = useId();

  const disponibles = modulosConAcceso(user?.permissions || []);
  const modulos = MODULOS.filter((modulo) => disponibles.includes(modulo.id));

  useEffect(() => {
    if (!abierto) return undefined;
    function alHacerClicFuera(evento) {
      if (contenedor.current && !contenedor.current.contains(evento.target)) {
        setAbierto(false);
      }
    }
    function alPulsarTecla(evento) {
      if (evento.key === "Escape") {
        setAbierto(false);
        boton.current?.focus();
      }
    }
    document.addEventListener("mousedown", alHacerClicFuera);
    document.addEventListener("keydown", alPulsarTecla);
    return () => {
      document.removeEventListener("mousedown", alHacerClicFuera);
      document.removeEventListener("keydown", alPulsarTecla);
    };
  }, [abierto]);

  if (modulos.length < 2) return null;

  function elegir(modulo) {
    setAbierto(false);
    if (modulo.id === activo.id) return;
    recordarModulo(modulo.id);
    guardedNavigate(modulo.inicio);
  }

  return (
    <div className="mz-switcher selector-modulo" ref={contenedor}>
      <button
        type="button"
        ref={boton}
        onClick={() => setAbierto((valor) => !valor)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={idMenu}
        aria-label={`Módulo: ${activo.nombre}. Cambiar de módulo`}
        title="Cambiar de módulo"
      >
        <Icon name={activo.icono} className="selector-modulo__icono" />
        <span className="selector-modulo__nombre">{activo.nombre}</span>
        <Icon name="chevron-down" />
      </button>
      {abierto && (
        <div
          className="mz-dropdown"
          role="menu"
          id={idMenu}
          aria-label="Módulos"
        >
          {modulos.map((modulo) => (
            <button
              key={modulo.id}
              type="button"
              role="menuitemradio"
              aria-checked={modulo.id === activo.id}
              className="mz-dropdown-item"
              onClick={() => elegir(modulo)}
            >
              <span className="selector-modulo__glifo" aria-hidden="true">
                <Icon name={modulo.icono} />
              </span>
              <span>
                {modulo.nombre}
                <small>{modulo.descripcion}</small>
              </span>
              {modulo.id === activo.id && (
                <Icon name="check2" className="ms-auto" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
