import { useLocalSearchParams } from "expo-router";

import { Contacto } from "../../../../pantallas/chat/Contacto";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/** `/chat/contacto/ID?empresa=ID`: la ficha de contacto de una persona.
 * Solo IDs numéricos. */
export default function PantallaContacto() {
  const parametros = useLocalSearchParams();
  const id = String(primero(parametros.id) ?? "");
  const empresa = String(primero(parametros.empresa) ?? "");
  if (!/^\d+$/.test(id)) return null;
  return <Contacto id={id} empresa={/^\d+$/.test(empresa) ? empresa : null} />;
}
