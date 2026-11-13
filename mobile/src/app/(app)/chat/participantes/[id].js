import { useLocalSearchParams } from "expo-router";

import { Participantes } from "../../../../pantallas/chat/Participantes";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default function PantallaParticipantes() {
  const parametros = useLocalSearchParams();
  const id = String(primero(parametros.id) ?? "");
  const empresa = String(primero(parametros.empresa) ?? "");
  if (!/^\d+$/.test(id)) return null;
  return <Participantes id={id} empresa={/^\d+$/.test(empresa) ? empresa : null} />;
}
