import { NuevaOrden } from "../../../pantallas/ordenes/NuevaOrden";

/** `/ordenes/nueva`: «Nueva orden» (US-025, CA-14), desde la barra del
 * módulo con `ordenes.crear`. En la pila: al registrarla se reemplaza por su
 * ficha. */
export default function Pantalla() {
  return <NuevaOrden />;
}
