import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Alerta } from "../../../../componentes/comunes";
import { MiTicket } from "../../../../pantallas/soporte/MiTicket";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/soporte/mi-ticket/ID?empresa=ID`: la ficha de un ticket propio (US-014, CA-7), desde la
 * lista, una notificación o un push. Solo IDs numéricos: pueden venir de un
 * enlace profundo; como mucho 12 dígitos (QA-TECH).
 */
export default function Pantalla() {
  const parametros = useLocalSearchParams();
  const id = String(primero(parametros.id) ?? "");
  const empresa = String(primero(parametros.empresa) ?? "");
  if (!/^\d{1,12}$/.test(id)) {
    return (
      <View style={{ padding: 16 }}>
        <Alerta tipo="mal" texto="Este ticket no existe." />
      </View>
    );
  }
  return <MiTicket key={`${id}-${empresa}`} id={id} empresa={/^\d{1,12}$/.test(empresa) ? empresa : null} />;
}
