import { memo, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { estadoDelActivo, lugarDe, nombreDeFila } from "../../activos/formato";
import { Alerta } from "../../componentes/comunes";
import { BotonRedondo, CuadriculaRedonda } from "../../componentes/BotonRedondo";
import { Icono } from "../../componentes/Icono";
import { abrirEnNavegador, TEXTO_NAVEGADOR_FALLO, urlWeb } from "../../navegador/enlaceWeb";
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { Pildora } from "../soporte/piezas";

/**
 * Piezas de Gestión de Activos (US-022) que comparten el panel, el
 * inventario, la ficha y el escáner. El estado siempre lleva texto e ícono,
 * no solo color (CA-23).
 */

/** Si la pantalla sigue montada tras un `await`. */
export function useMontado() {
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  return montado;
}

/** El estado del activo: «Asignado», «En reparación», «Robado»… */
export function EstadoDelActivo({ activo, testID }) {
  if (!activo) return null;
  const estado = estadoDelActivo(activo.estado, activo.estado_display);
  return <Pildora texto={estado.texto} tono={estado} testID={testID} />;
}

/**
 * Un activo en una lista (CA-6): el código de barras, el nombre, el tipo, el
 * estado, el responsable, el área y la sede. Toda la fila es un botón con un
 * nombre que lo dice todo.
 */
export const FilaActivo = memo(function FilaActivo({ activo, onAbrir }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const lugar = lugarDe(activo);
  return (
    <Pressable
      testID={`activo-${activo.id}`}
      onPress={() => onAbrir(activo)}
      accessibilityRole="button"
      accessibilityLabel={nombreDeFila(activo)}
      accessibilityHint="Abre la ficha del activo"
      style={({ pressed }) => [estilos.fila, pressed && estilos.presionada]}
    >
      <View style={estilos.filaCabecera}>
        <Text style={estilos.codigo}>{activo.codigo_barras}</Text>
        <EstadoDelActivo activo={activo} />
      </View>
      <Text style={estilos.nombre}>{activo.nombre}</Text>
      {activo.tipo_nombre ? <Text style={estilos.tenue}>{activo.tipo_nombre}</Text> : null}
      <View style={estilos.linea}>
        <Icono nombre="account-outline" size={18} color={colores.tintaSuave} />
        <Text style={estilos.dato}>{activo.responsables_resumen || "Sin asignar"}</Text>
      </View>
      {lugar ? (
        <View style={estilos.linea}>
          <Icono nombre="map-marker-outline" size={18} color={colores.tintaSuave} />
          <Text style={estilos.dato}>{lugar}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

/**
 * Lo del módulo que se hace en la web (CA-10), en botones redondos con la
 * marca de «sale de la app» (regla del usuario, 16/11/2026: nunca un botón
 * rectangular ni un enlace). `abrirEnNavegador` pregunta antes de salir.
 * `accesos`: `[{ruta, nombre, icono}]`. `familia`: el color de los botones
 * (las órdenes de trabajo usan el suyo, US-025).
 */
export function ActivosEnElNavegador({ accesos, empresa, titulo = "Más opciones en el navegador", testID, familia = "activos" }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const [error, setError] = useState(null);
  if (!accesos?.length) return null;
  async function abrir(ruta) {
    setError(null);
    const abierta = await abrirEnNavegador(urlWeb(ruta, { empresa }), { avisarSiFalla: false });
    if (abierta === false) setError(TEXTO_NAVEGADOR_FALLO);
  }
  return (
    <View style={estilos.navegador} testID={testID ?? "activos-en-el-navegador"}>
      <View style={estilos.linea}>
        <Text style={estilos.subtitulo} accessibilityRole="header">
          {titulo}
        </Text>
        <Icono nombre="open-in-new" size={18} color={colores.tintaSuave} />
      </View>
      <Text style={estilos.tenue}>Se abren en el navegador del teléfono.</Text>
      <CuadriculaRedonda columnas={3}>
        {(ancho) =>
          accesos.map((a) => (
            <BotonRedondo
              key={a.ruta}
              testID={`web-${a.ruta}`}
              icono={a.icono}
              nombre={a.nombre}
              familia={familia}
              navegador
              ancho={ancho}
              onPress={() => abrir(a.ruta)}
            />
          ))
        }
      </CuadriculaRedonda>
      {error ? <Alerta tipo="mal" texto={error} /> : null}
    </View>
  );
}

export const fabricaDeEstilos = (colores) => crearEstilos({
  fila: {
    minHeight: AREA_TACTIL,
    padding: 14,
    gap: 4,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  presionada: { backgroundColor: colores.realce },
  filaCabecera: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  codigo: { flexShrink: 1, fontSize: 14, fontWeight: "600", color: colores.tintaSuave },
  nombre: { fontSize: 16, fontWeight: "700", color: colores.titulo },
  linea: { flexDirection: "row", alignItems: "center", gap: 6 },
  dato: { flexShrink: 1, fontSize: 15, color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.titulo },
  navegador: { gap: 8 },
});
