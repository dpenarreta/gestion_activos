import { NuevoGrupo } from "../../../pantallas/chat/NuevoGrupo";

/** `/chat/grupo-nuevo`: «Crear un grupo» (US-024, CA-1 y CA-2), desde la
 * lista de chats, «Mis grupos» y la barra del Chat. En la pila: al crear se
 * reemplaza por la conversación nueva. */
export default function Pantalla() {
  return <NuevoGrupo />;
}
