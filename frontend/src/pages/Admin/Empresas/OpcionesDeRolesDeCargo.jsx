import { TEXTO_ROL_DE_CARGO } from "./rolesElegibles";

/**
 * Los roles de cargo dentro de un desplegable de roles (18/11/2026): a la
 * vista pero deshabilitados, en su propio grupo, con la indicación de que se
 * asignan con el cargo. El servidor descarta un rol de cargo enviado a mano
 * (`organizacion.roles_de_cargo.ajustar_membresia`), así que no se pueden
 * elegir aquí.
 */
export function OpcionesDeRolesDeCargo({ roles }) {
  if (!roles?.length) return null;
  return (
    <optgroup label={`Roles de cargo (${TEXTO_ROL_DE_CARGO})`}>
      {roles.map((rol) => (
        <option key={rol.id} value={rol.id} disabled>
          {rol.name} — {TEXTO_ROL_DE_CARGO}
        </option>
      ))}
    </optgroup>
  );
}
