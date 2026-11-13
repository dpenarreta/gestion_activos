import { useLocalSearchParams } from "expo-router";

import { DetalleNotificacion } from "../../../pantallas/DetalleNotificacion";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default function PantallaDetalleNotificacion() {
  const parametros = useLocalSearchParams();
  const id = String(primero(parametros.id) ?? "");
  const empresa = String(primero(parametros.empresa) ?? "");
  // Solo IDs numéricos: pueden venir de un push o de un enlace profundo.
  if (!/^\d+$/.test(id)) return null;
  return <DetalleNotificacion id={id} empresa={/^\d+$/.test(empresa) ? empresa : null} />;
}
