import { apiClient } from "./client";

/** «Mi perfil»: el teléfono, el área y la agencia de quien entra (y su nombre). */
export const misDatosService = {
  obtener() {
    return apiClient.get("/organizacion/mis-datos/").then((r) => r.data);
  },
  guardar(datos) {
    return apiClient.put("/organizacion/mis-datos/", datos).then((r) => r.data);
  },
  /** Mis herramientas: `{ mias, catalogo }`. */
  herramientas() {
    return apiClient
      .get("/organizacion/mis-datos/herramientas/")
      .then((r) => r.data);
  },
  /** `lista`: `[{ herramienta, cuenta }]`; reemplaza las que tenía. */
  guardarHerramientas(lista) {
    return apiClient
      .put("/organizacion/mis-datos/herramientas/", { herramientas: lista })
      .then((r) => r.data);
  },
  /** Mostrar (`mostrar`, `acepto`, `dia`, `mes`, `anio` opcional) o retirar
   * el aniversario en la empresa del calendario. */
  guardarAniversario(datos) {
    return apiClient
      .put("/organizacion/mis-datos/aniversario/", datos)
      .then((r) => r.data);
  },
  /** Mostrar (`mostrar`, `acepto`, `dia`, `mes`) o retirar el cumpleaños
   * del calendario. */
  guardarCumpleanos(datos) {
    return apiClient
      .put("/organizacion/mis-datos/cumpleanos/", datos)
      .then((r) => r.data);
  },
};
