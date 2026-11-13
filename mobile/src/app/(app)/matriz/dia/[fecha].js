import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Alerta } from "../../../../componentes/comunes";
import { diaConSemana, esDiaValido } from "../../../../matriz/formato";
import { ListaDePeriodos } from "../../../../pantallas/matriz/ListaDePeriodos";

function primeraMayuscula(texto) {
  return texto ? `${texto.charAt(0).toUpperCase()}${texto.slice(1)}` : texto;
}

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/matriz/dia/AAAA-MM-DD`: lo que vence ese día (US-019, CA-7), con
 * `due_from` y `due_to` de `matriz/periodos/` (el servidor cuenta el día en la
 * hora de la empresa, como el calendario). Desde aquí se entra al detalle.
 */
export default function Pantalla() {
  const parametros = useLocalSearchParams();
  const fecha = String(primero(parametros.fecha) ?? "");
  if (!esDiaValido(fecha)) {
    return (
      <View style={{ padding: 16 }}>
        <Alerta tipo="mal" texto="Esa fecha no es válida." />
      </View>
    );
  }
  return (
    <ListaDePeriodos
      key={fecha}
      testID="lista-del-dia"
      params={{ due_from: fecha, due_to: fecha, sort: "due" }}
      // El título («Vencimientos del día») va en la cabecera; aquí, la fecha.
      detalle={primeraMayuscula(diaConSemana(fecha))}
      textoVacio="Ese día no vence ninguna obligación."
    />
  );
}
