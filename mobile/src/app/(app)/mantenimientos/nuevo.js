import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { TEXTO_NO_DISPONIBLE } from "../../../activos/formato";
import { Alerta } from "../../../componentes/comunes";
import { RegistrarMantenimiento } from "../../../pantallas/activos/RegistrarMantenimiento";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/mantenimientos/nuevo?activo=ID`: «Registrar mantenimiento» (US-022,
 * CA-14 y CA-15), desde la ficha y el escáner con el equipo puesto, o desde
 * la bitácora sin `activo` (se elige con un buscador). El activo puede venir
 * de un enlace profundo: solo dígitos, de hasta 12.
 */
export default function Pantalla() {
  const parametros = useLocalSearchParams();
  const activo = primero(parametros.activo);
  if (activo !== undefined && activo !== "" && !/^\d{1,12}$/.test(String(activo))) {
    return (
      <View style={{ padding: 16 }}>
        <Alerta tipo="mal" texto={TEXTO_NO_DISPONIBLE} />
      </View>
    );
  }
  const activoId = activo ? String(activo) : null;
  return <RegistrarMantenimiento key={activoId ?? "sin-activo"} activoId={activoId} />;
}
