import { adminUsersService } from "../../api/adminUsersService";

/** Los usuarios del sistema (para elegir el dueño de un dashboard). El
 * listado del sistema pagina de a 100 como máximo. */
export function list(params = {}) {
  const { page_size: pedido = 100, ...resto } = params;
  return adminUsersService.list({ ...resto, page_size: Math.min(pedido, 100) });
}
