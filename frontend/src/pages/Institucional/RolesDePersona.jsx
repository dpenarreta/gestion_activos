import { useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";

/**
 * Los roles de Configuración de una persona, en Asignación de cargos
 * (18/11/2026, decisión del usuario: un cargo y un rol son lo mismo y se dan
 * desde la ficha del usuario o desde el organigrama). El rol de su cargo va
 * en la columna «Cargo»; aquí, los demás: cada uno con «Quitar» y un
 * desplegable para añadir otro. El servidor no deja dar un rol con permisos
 * que uno no tiene.
 */
export function RolesDePersona({ persona, catalogo, onCambio, onError }) {
  const [roles, setRoles] = useState(persona.roles ?? []);
  const [guardando, setGuardando] = useState(false);
  const [elegido, setElegido] = useState("");
  const disponibles = (catalogo ?? []).filter(
    (rol) => !roles.some((r) => r.id === rol.id),
  );

  async function cambiar(rol, accion) {
    setGuardando(true);
    try {
      const respuesta = await institucionalService.cambiarRol(
        persona.id,
        rol.id,
        accion,
      );
      setRoles(respuesta.roles ?? []);
      setElegido("");
      onCambio?.(
        accion === "dar"
          ? `${persona.nombre} ahora tiene el rol «${rol.nombre}».`
          : `${persona.nombre} ya no tiene el rol «${rol.nombre}».`,
      );
    } catch (err) {
      onError?.(mensajeDeError(err, "No se pudo cambiar el rol."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="asignacion-roles">
      {roles.length > 0 ? (
        <ul
          className="asignacion-roles__lista"
          aria-label={`Roles de ${persona.nombre}`}
        >
          {roles.map((rol) => (
            <li key={rol.id}>
              {rol.nombre}
              <button
                type="button"
                className="btn btn-link btn-sm p-0 ms-1"
                aria-label={`Quitar el rol ${rol.nombre} a ${persona.nombre}`}
                disabled={guardando}
                onClick={() => cambiar(rol, "quitar")}
              >
                <Icon name="x-lg" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="mz-small mz-faint">Solo el de su cargo</span>
      )}
      {/* Desplegable y botón: con el teclado, las flechas cambian el valor
          de un desplegable cerrado, y actuar al cambiar daría roles sin
          querer. */}
      {catalogo !== null && disponibles.length > 0 && (
        <div className="asignacion-roles__anadir">
          <select
            className="form-select form-select-sm"
            aria-label={`Rol para añadir a ${persona.nombre}`}
            value={elegido}
            disabled={guardando}
            onChange={(e) => setElegido(e.target.value)}
          >
            <option value="">Añadir un rol…</option>
            {disponibles.map((rol) => (
              <option key={rol.id} value={rol.id}>
                {rol.nombre}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            disabled={!elegido || guardando}
            onClick={() => {
              const rol = disponibles.find((r) => String(r.id) === elegido);
              if (rol) cambiar(rol, "dar");
            }}
          >
            Añadir
          </button>
        </div>
      )}
    </div>
  );
}
