import { useLocalSearchParams } from "expo-router";

import { SoloConFoco } from "../../../navegacion/EstadoDeModulos";
import { ListaChats } from "../../../pantallas/chat/ListaChats";

/** `/chat?vista=grupos`: «Mis grupos» (US-016); sin `vista`, todas las
 * conversaciones. Sin el foco no recibe toques (ronda 2). */
export default function PantallaChat() {
  const { vista } = useLocalSearchParams();
  const pedida = Array.isArray(vista) ? vista[0] : vista;
  return (
    <SoloConFoco>
      <ListaChats soloGrupos={pedida === "grupos"} />
    </SoloConFoco>
  );
}
