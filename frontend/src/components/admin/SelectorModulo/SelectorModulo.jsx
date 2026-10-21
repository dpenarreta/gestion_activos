import { useEffect, useId, useRef, useState } from "react";

import { useUnsavedChanges } from "../../../context/UnsavedChangesContext";
import { useAuth } from "../../../hooks/useAuth";
import { useEstadoModulos } from "../../../modulos/EstadoModulos";
import { MODULOS, moduloPorId, recordarModulo } from "../../../modulos/modulos";
import { useModuloActivo } from "../../../modulos/useModuloActivo";
import { Icon } from "../../common/Icon/Icon";
import { useConMouse } from "../AdminSidebar/AdminMenuGroup";
import { modulosConAcceso } from "../AdminSidebar/staticAdminMenu";
import "./SelectorModulo.css";

/** Como en los grupos del menú: da tiempo a cruzar hasta el panel. */
const RETARDO_CIERRE_MS = 180;

/**
 * «Módulo activo», arriba en el menú lateral: dice en qué módulo se trabaja y
 * deja cambiarlo. La empresa y el usuario ya se ven en la barra superior.
 *
 * Pasar el mouse despliega los módulos en un panel al costado, como los grupos
 * del menú; pulsarla los deja abiertos (en el teléfono, debajo de la tarjeta).
 * No reemplaza al menú: decide qué menú se ve.
 *
 * Solo ofrece los módulos en los que la persona tiene algo que abrir **en la
 * empresa activa**: la Matriz depende del rol de la membresía. Con un solo
 * módulo la tarjeta solo lo nombra: un selector de una opción no elige nada.
 *
 * Los módulos apagados en la empresa no se ofrecen; el superusuario y el
 * administrador los ven marcados «Apagado».
 */
export function SelectorModulo({ isCollapsed = false, onElegido }) {
  const { user } = useAuth();
  const { guardedNavigate } = useUnsavedChanges();
  const activo = moduloPorId(useModuloActivo());
  const conMouse = useConMouse();
  // null: cerrado; "mouse": abierto al pasar por encima; "clic": fijo.
  const [abierto, setAbierto] = useState(null);
  const [posicion, setPosicion] = useState(null);
  const contenedor = useRef(null);
  const boton = useRef(null);
  const cierre = useRef(null);
  const idMenu = useId();

  const { apagados, veApagados } = useEstadoModulos();
  const disponibles = modulosConAcceso(user?.permissions || []);
  const modulos = MODULOS.filter(
    (modulo) =>
      disponibles.includes(modulo.id) &&
      (veApagados || !apagados.has(modulo.id)),
  );
  // Con mouse (o contraído, donde no hay sitio debajo) flota al costado.
  const flotante = conMouse || isCollapsed;

  useEffect(() => () => clearTimeout(cierre.current), []);

  useEffect(() => {
    if (!abierto) return undefined;
    function alHacerClicFuera(evento) {
      if (contenedor.current && !contenedor.current.contains(evento.target)) {
        setAbierto(null);
      }
    }
    function alPulsarTecla(evento) {
      if (evento.key === "Escape") {
        setAbierto(null);
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

  function medir() {
    if (!boton.current) return;
    const tarjeta = boton.current.getBoundingClientRect();
    const menu = boton.current.closest(".mz-sidebar")?.getBoundingClientRect();
    setPosicion({ top: tarjeta.top, left: (menu?.right ?? tarjeta.right) + 6 });
  }

  function alEntrar() {
    clearTimeout(cierre.current);
    if (!conMouse || abierto) return;
    medir();
    setAbierto("mouse");
  }

  function alSalir() {
    clearTimeout(cierre.current);
    if (abierto !== "mouse") return;
    cierre.current = setTimeout(() => setAbierto(null), RETARDO_CIERRE_MS);
  }

  function alPulsar() {
    clearTimeout(cierre.current);
    if (abierto === "clic") {
      setAbierto(null);
      return;
    }
    medir();
    setAbierto("clic");
  }

  function elegir(modulo) {
    setAbierto(null);
    if (modulo.id === activo.id) return;
    recordarModulo(modulo.id);
    onElegido?.();
    guardedNavigate(modulo.inicio);
  }

  const contenido = isCollapsed ? (
    <>
      <Icon name={activo.icono} />
      <span className="visually-hidden">Módulo activo: {activo.nombre}</span>
    </>
  ) : (
    <>
      <span className="selector-modulo__textos">
        <small>Módulo activo</small>
        <strong>
          <Icon name={activo.icono} className="selector-modulo__icono" />
          <span className="selector-modulo__nombre">{activo.nombre}</span>
        </strong>
      </span>
      {modulos.length > 1 && (
        <Icon name="chevron-right" className="selector-modulo__flecha" />
      )}
    </>
  );
  const clases = `mz-active-company selector-modulo__tarjeta${
    isCollapsed ? " selector-modulo__tarjeta--contraida" : ""
  }`;

  if (modulos.length < 2) {
    return (
      <div className="selector-modulo">
        <div className={clases} title={isCollapsed ? activo.nombre : undefined}>
          {contenido}
        </div>
      </div>
    );
  }

  return (
    <div
      className="selector-modulo"
      ref={contenedor}
      onMouseEnter={alEntrar}
      onMouseLeave={alSalir}
    >
      <button
        type="button"
        ref={boton}
        className={clases}
        onClick={alPulsar}
        aria-haspopup="menu"
        aria-expanded={Boolean(abierto)}
        aria-controls={idMenu}
        aria-label={`Módulo activo: ${activo.nombre}. Cambiar de módulo`}
        title={isCollapsed ? activo.nombre : undefined}
      >
        {contenido}
      </button>
      {abierto && (
        <div
          className={
            flotante
              ? "mz-flyout selector-modulo__panel"
              : "selector-modulo__lista"
          }
          style={flotante && posicion ? posicion : undefined}
          role="menu"
          id={idMenu}
          aria-label="Módulos"
        >
          {flotante && (
            <div className="mz-flyout-titulo">Cambiar de módulo</div>
          )}
          {modulos.map((modulo) => (
            <button
              key={modulo.id}
              type="button"
              role="menuitemradio"
              aria-checked={modulo.id === activo.id}
              className={`mz-flyout-item selector-modulo__opcion${
                modulo.id === activo.id ? " is-active" : ""
              }`}
              onClick={() => elegir(modulo)}
            >
              <span className="selector-modulo__glifo" aria-hidden="true">
                <Icon name={modulo.icono} />
              </span>
              <span className="selector-modulo__textos">
                {modulo.nombre}
                <small>{modulo.descripcion}</small>
              </span>
              {apagados.has(modulo.id) && (
                <span className="selector-modulo__apagado">Apagado</span>
              )}
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
