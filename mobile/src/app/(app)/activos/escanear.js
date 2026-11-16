import { Escaner } from "../../../pantallas/activos/Escaner";

/** `/activos/escanear`: leer la etiqueta de un activo con la cámara o
 * escribir su código (US-022, CA-11 y CA-12). En la pila, para que la
 * cámara se apague al volver. */
export default function Pantalla() {
  return <Escaner />;
}
