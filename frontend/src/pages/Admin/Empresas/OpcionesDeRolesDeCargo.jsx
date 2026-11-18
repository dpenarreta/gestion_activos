import { TEXTO_ROL_DE_CARGO } from "./rolesElegibles";

/**
 * Los roles de los cargos del organigrama dentro de un desplegable de roles,
 * en su propio grupo (18/11/2026). Un cargo y su rol son lo mismo (decisión
 * del usuario): elegir uno ubica a la persona en ese cargo al guardar, y
 * quitárselo la saca (`organizacion.roles_de_cargo.cargo_desde_roles`).
 */
export function OpcionesDeRolesDeCargo({ roles }) {
  if (!roles?.length) return null;
  return (
    <optgroup label={`Cargos del organigrama (${TEXTO_ROL_DE_CARGO})`}>
      {roles.map((rol) => (
        <option key={rol.id} value={rol.id}>
          {rol.name}
        </option>
      ))}
    </optgroup>
  );
}
