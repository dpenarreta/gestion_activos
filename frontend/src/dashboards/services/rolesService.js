import { rolesService } from "../../api/rolesService";

/** Los roles del sistema, con la forma paginada que espera el módulo. */
export function list() {
  return rolesService
    .list()
    .then((datos) => (Array.isArray(datos) ? { results: datos } : datos));
}
