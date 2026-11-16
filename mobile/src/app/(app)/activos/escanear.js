import { useLocalSearchParams } from "expo-router";

import { Escaner } from "../../../pantallas/activos/Escaner";

/** `/activos/escanear`: leer la etiqueta de un activo con la cámara o
 * escribir su código (US-022, CA-11 y CA-12). En la pila, para que la
 * cámara se apague al volver. `?auto=1`: desde la burbuja de «Escanear» del
 * módulo, la cámara arranca sola (16/11/2026). */
export default function Pantalla() {
  const { auto } = useLocalSearchParams();
  return <Escaner auto={(Array.isArray(auto) ? auto[0] : auto) === "1"} />;
}
