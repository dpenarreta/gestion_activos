import { useLocalSearchParams } from "expo-router";

import { NuevaSolicitud } from "../../../pantallas/permisos/NuevaSolicitud";

/** `?tipo=vacaciones` (desde «Mis vacaciones») elige ese tipo de una vez. */
export default function PantallaNuevaSolicitud() {
  const { tipo } = useLocalSearchParams();
  const valor = Array.isArray(tipo) ? tipo[0] : tipo;
  return <NuevaSolicitud deVacaciones={valor === "vacaciones"} />;
}
