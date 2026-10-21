import { Link, useLocation } from "react-router-dom";

import { useAuth } from "../../../hooks/useAuth";
import { useEstadoModulos } from "../../../modulos/EstadoModulos";
import { MODULOS, moduloDeRuta, moduloPorId } from "../../../modulos/modulos";
import { Icon } from "../../common/Icon/Icon";
import { modulosConAcceso } from "../AdminSidebar/staticAdminMenu";

/**
 * Lo que se ve en una pantalla de un módulo apagado en la empresa.
 *
 * Quien no puede ver los apagados recibe un aviso en lugar de la pantalla
 * (el backend igual le niega la API) y los módulos a los que sí puede ir. El
 * superusuario y el administrador ven la pantalla con una franja que recuerda
 * que nadie más la ve.
 */
export function ModuloApagado({ children }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { apagados, veApagados } = useEstadoModulos();
  const clave = moduloDeRuta(pathname);

  if (!clave || !apagados.has(clave)) return children;
  const modulo = moduloPorId(clave);

  if (veApagados) {
    return (
      <>
        <div className="mz-alert mz-alert--warn mb-3" role="status">
          <Icon name="toggle-off" />
          <span>
            El módulo <strong>{modulo.nombre}</strong> está apagado: solo lo ven
            el superusuario y el administrador.
          </span>
        </div>
        {children}
      </>
    );
  }

  const disponibles = modulosConAcceso(user?.permissions || []);
  const otros = MODULOS.filter(
    (m) => disponibles.includes(m.id) && !apagados.has(m.id),
  );
  return (
    <section className="mz-card" aria-label="Módulo apagado">
      <div className="mz-card-body mz-empty">
        <Icon name="toggle-off" />
        <h2 className="h5 mt-2">El módulo {modulo.nombre} está apagado</h2>
        <p className="mb-3">
          La empresa lo desactivó por ahora. Si lo necesita, consulte con el
          administrador del sistema.
        </p>
        {otros.length > 0 && (
          <div className="d-flex flex-wrap gap-2 justify-content-center">
            {otros.map((m) => (
              <Link
                key={m.id}
                to={m.inicio}
                className="btn btn-outline-primary btn-sm"
              >
                <Icon name={m.icono} /> {m.nombre}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
