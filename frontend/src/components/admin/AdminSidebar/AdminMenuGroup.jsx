import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Icon } from "../../common/Icon/Icon";
import { AdminMenuItem } from "./AdminMenuItem";
import { hasActiveDescendant } from "./adminMenuTree";

/** Pantalla con mouse y menú de escritorio: donde tiene sentido desplegar al
 * pasar por encima. En el teléfono (menú en cajón) no hay «pasar por
 * encima», y el panel flotante se quedaría abierto tras cada toque. */
const CON_MOUSE = "(hover: hover) and (pointer: fine) and (min-width: 881px)";

/** Lo que tarda en cerrarse el panel al salir del grupo: da tiempo a cruzar
 * el margen entre el ítem y el panel sin que desaparezca a mitad de camino. */
const RETARDO_CIERRE_MS = 180;

export function useConMouse() {
  const [conMouse, setConMouse] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.(CON_MOUSE).matches),
  );
  useEffect(() => {
    const consulta = window.matchMedia?.(CON_MOUSE);
    if (!consulta?.addEventListener) return undefined;
    const alCambiar = () => setConMouse(consulta.matches);
    consulta.addEventListener("change", alCambiar);
    return () => consulta.removeEventListener("change", alCambiar);
  }, []);
  return conMouse;
}

/**
 * Grupo colapsable del Menú Administrativo — recursivo: un hijo con hijos se
 * dibuja como otro grupo, al nivel que haga falta.
 *
 * Dos maneras de llegar a lo de dentro:
 * - **Pulsar** el grupo lo abre en acordeón, debajo (y cierra sus hermanos).
 * - **Pasar el mouse** por un grupo cerrado despliega sus entradas en un panel
 *   al costado del menú, sin moverlo. Con el menú contraído a íconos es la
 *   única forma de verlas: ahí el acordeón no se dibuja.
 *
 * El panel va con `position: fixed` y coordenadas medidas: dentro de la lista
 * del menú —que tiene su propio scroll— un panel absoluto quedaría recortado.
 */
export function AdminMenuGroup({
  item,
  isCollapsed,
  currentPath,
  onNavigate,
  accordion,
  siblingIds = [],
  nivel = 1,
}) {
  const sublistId = useId();
  const flyoutId = useId();
  const botonRef = useRef(null);
  const flyoutRef = useRef(null);
  const cierreRef = useRef(null);
  const conMouse = useConMouse();
  const [flyout, setFlyout] = useState(null);

  // Los subgrupos hermanos, para que abrir uno cierre al otro sin tocar al
  // padre: pasarle los ids de todos los hijos cerraría el grupo que los
  // contiene en cuanto alguien abriera el de dentro.
  const subgruposHermanos = item.children
    .filter((hijo) => (hijo.children || []).length > 0)
    .map((hijo) => hijo.id);
  const isActive = hasActiveDescendant(item, currentPath);
  const isExpanded = accordion.isExpanded(item.id);
  // Solo el primer nivel flota: los de dentro ya se ven en el panel del padre.
  // Abierto en acordeón no hace falta, salvo con el menú contraído.
  const puedeFlotar = conMouse && nivel === 1 && (isCollapsed || !isExpanded);

  useEffect(() => () => clearTimeout(cierreRef.current), []);
  useEffect(() => {
    if (!puedeFlotar) setFlyout(null);
  }, [puedeFlotar]);

  // Que el panel no se salga por abajo: se mide ya dibujado y se sube lo justo.
  useLayoutEffect(() => {
    if (!flyout || !flyoutRef.current) return;
    const alto = flyoutRef.current.offsetHeight;
    const limite = window.innerHeight - 8;
    if (flyout.top + alto > limite) {
      const top = Math.max(8, limite - alto);
      if (top !== flyout.top)
        setFlyout((actual) => actual && { ...actual, top });
    }
  }, [flyout]);

  function abrirFlyout() {
    clearTimeout(cierreRef.current);
    if (!puedeFlotar || !botonRef.current) return;
    const boton = botonRef.current.getBoundingClientRect();
    const menu = botonRef.current
      .closest(".mz-sidebar")
      ?.getBoundingClientRect();
    setFlyout({ top: boton.top, left: (menu?.right ?? boton.right) + 6 });
  }

  function cerrarFlyout() {
    clearTimeout(cierreRef.current);
    cierreRef.current = setTimeout(() => setFlyout(null), RETARDO_CIERRE_MS);
  }

  function navegarDesdeFlyout(evento, path) {
    setFlyout(null);
    onNavigate(evento, path);
  }

  const headerClassName = [
    "mz-nav-item",
    "mz-nav-group",
    isActive && "is-active",
    isExpanded && "is-expanded",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      className={nivel > 1 ? "mz-nav-anidado" : undefined}
      onMouseEnter={abrirFlyout}
      onMouseLeave={cerrarFlyout}
    >
      <button
        ref={botonRef}
        type="button"
        className={headerClassName}
        onClick={() => {
          setFlyout(null);
          accordion.toggle(item.id, siblingIds);
        }}
        aria-expanded={isExpanded}
        aria-controls={sublistId}
        title={isCollapsed ? item.name : undefined}
      >
        <Icon name={item.icon} />
        {!isCollapsed && <span className="mz-nav-label">{item.name}</span>}
        {!isCollapsed && (
          <Icon name="chevron-right" className="mz-nav-chevron" />
        )}
      </button>

      <div
        className={`mz-subnav-wrap ${isExpanded ? "mz-subnav-wrap--open" : ""}`}
      >
        <ul
          id={sublistId}
          className="mz-subnav"
          {...(isExpanded ? {} : { inert: "" })}
        >
          {item.children.map((child) =>
            (child.children || []).length > 0 ? (
              <AdminMenuGroup
                key={child.id}
                item={child}
                isCollapsed={isCollapsed}
                currentPath={currentPath}
                onNavigate={onNavigate}
                accordion={accordion}
                siblingIds={subgruposHermanos}
                nivel={nivel + 1}
              />
            ) : (
              <AdminMenuItem
                key={child.id}
                item={child}
                isCollapsed={isCollapsed}
                currentPath={currentPath}
                onNavigate={onNavigate}
              />
            ),
          )}
        </ul>
      </div>

      {flyout && (
        <div
          id={flyoutId}
          ref={flyoutRef}
          className="mz-flyout"
          style={{ top: flyout.top, left: flyout.left }}
          aria-label={item.name}
          role="group"
        >
          <div className="mz-flyout-titulo">{item.name}</div>
          <EntradasDelFlyout
            hijos={item.children}
            currentPath={currentPath}
            onNavigate={navegarDesdeFlyout}
          />
        </div>
      )}
    </li>
  );
}

/** Las entradas del panel: las hojas como enlaces y los subgrupos como un
 * rótulo con sus hojas debajo, a cualquier profundidad. */
function EntradasDelFlyout({ hijos, currentPath, onNavigate }) {
  return (
    <ul className="mz-flyout-lista">
      {hijos.map((hijo) =>
        (hijo.children || []).length > 0 ? (
          <li key={hijo.id} className="mz-flyout-seccion">
            <span className="mz-flyout-rotulo">{hijo.name}</span>
            <EntradasDelFlyout
              hijos={hijo.children}
              currentPath={currentPath}
              onNavigate={onNavigate}
            />
          </li>
        ) : (
          <li key={hijo.id}>
            <Link
              to={hijo.path || "#"}
              className={`mz-flyout-item${
                hasActiveDescendant(hijo, currentPath) ? " is-active" : ""
              }`}
              aria-current={
                hasActiveDescendant(hijo, currentPath) ? "page" : undefined
              }
              onClick={(evento) => onNavigate(evento, hijo.path)}
            >
              <Icon name={hijo.icon} />
              <span>{hijo.name}</span>
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}
