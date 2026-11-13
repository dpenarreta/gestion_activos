import { matrizService } from "../api/servicios";

/**
 * La respuesta de `matriz/empresas/mias/` guardada en memoria (US-019): la
 * Bandeja, el calendario y las listas la piden y no se repite la consulta.
 * La clave lleva la cuenta, la empresa activa y su versión (P2-1 de QA-TECH,
 * ronda 1: `versionEmpresa` no vuelve a 0 al cerrar sesión y otra cuenta
 * podía recibir los roles de la anterior). Al cerrar sesión se borra
 * (`SesionContext`). Un fallo no se guarda.
 *
 * Va aparte del hook para que `SesionContext` la borre sin importar el hook
 * (que a su vez usa la sesión).
 */
let guardada = { clave: null, promesa: null };

export function olvidarEmpresaDeLaMatriz() {
  guardada = { clave: null, promesa: null };
}

export function pedirEmpresasDeLaMatriz(clave) {
  if (guardada.clave !== clave || !guardada.promesa) {
    const promesa = matrizService.misEmpresas();
    guardada = { clave, promesa };
    promesa.catch(() => {
      if (guardada.promesa === promesa) guardada = { clave: null, promesa: null };
    });
  }
  return guardada.promesa;
}
