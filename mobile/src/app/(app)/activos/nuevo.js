import { FormularioActivo } from "../../../pantallas/activos/FormularioActivo";

/** `/activos/nuevo`: «Registrar activo» (US-023, CA-2), desde el Panel y el
 * Inventario con `activos.crear`. En la pila: al guardar se reemplaza por la
 * ficha nueva. */
export default function Pantalla() {
  return <FormularioActivo />;
}
