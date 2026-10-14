import { Link, useLocation } from "react-router-dom";

import { useUnsavedChanges } from "../../../context/UnsavedChangesContext";
import { useAuth } from "../../../hooks/useAuth";
import {
  seccionDeRuta,
  seccionesVisibles,
  subseccionDeRuta,
} from "./seccionesConfiguracion";
import "./ConfiguracionMarco.css";

/**
 * Lo que rodea a toda pantalla de Configuración: título, qué abarca y las
 * pestañas de sus secciones, con el dibujo de la Matriz (`mz-config-tabs`).
 *
 * Las pestañas son enlaces y no un `tablist`: cada sección es una pantalla
 * con su propia dirección, que se puede guardar o abrir en otra pestaña del
 * navegador. Al pulsarlas se pasa por `guardedNavigate`, como en el menú, para
 * preguntar antes de dejar un formulario a medio llenar.
 *
 * Solo se ofrecen las secciones que el usuario puede abrir: una pestaña que
 * termina en un 403 hace parecer roto el sistema en vez de restringido.
 */
export function ConfiguracionMarco({ empresa, children }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { guardedNavigate } = useUnsavedChanges();
  const visibles = seccionesVisibles(user?.permissions || []);
  const actual = seccionDeRuta(pathname);
  const subActual = subseccionDeRuta(actual, pathname);

  function navegar(evento, path) {
    // Un clic con modificador abre en otra pestaña: se deja pasar.
    if (
      evento.button !== 0 ||
      evento.metaKey ||
      evento.ctrlKey ||
      evento.shiftKey ||
      evento.altKey
    ) {
      return;
    }
    evento.preventDefault();
    guardedNavigate(path);
  }

  const abarca = visibles.map((seccion) => seccion.nombre.toLowerCase());
  const descripcion =
    abarca.length > 1
      ? `${abarca.slice(0, -1).join(", ")} y ${abarca.at(-1)}`
      : abarca[0];

  return (
    <div className="configuracion-marco">
      <div className="mz-view-head">
        <div>
          <h2>Configuración</h2>
          {descripcion && (
            <p className="mz-desc">
              {empresa ? `${empresa}: ` : ""}
              {descripcion}.
            </p>
          )}
        </div>
      </div>

      <nav
        className="mz-tabs mz-config-tabs"
        aria-label="Secciones de configuración"
      >
        {visibles.map((seccion) => {
          const activa = seccion.id === actual?.id;
          return (
            <Link
              key={seccion.id}
              to={seccion.path}
              className={activa ? "is-active" : undefined}
              aria-current={activa ? "page" : undefined}
              onClick={(evento) => navegar(evento, seccion.path)}
            >
              {seccion.nombre}
            </Link>
          );
        })}
      </nav>

      {actual?.subsecciones && (
        <nav
          className="mz-chips configuracion-marco__sub"
          aria-label={`Apartados de ${actual.nombre.toLowerCase()}`}
        >
          {actual.subsecciones.map((sub) => {
            const activa = sub.path === subActual?.path;
            return (
              <Link
                key={sub.path}
                to={sub.path}
                className={activa ? "is-on" : undefined}
                aria-current={activa ? "page" : undefined}
                onClick={(evento) => navegar(evento, sub.path)}
              >
                {sub.nombre}
              </Link>
            );
          })}
        </nav>
      )}

      <div className="mz-config-body">{children}</div>
    </div>
  );
}
