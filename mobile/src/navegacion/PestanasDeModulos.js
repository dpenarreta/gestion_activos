import { memo, useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";

import { FilaDeslizable } from "../componentes/FilaDeslizable";
import { Icono } from "../componentes/Icono";
import { AREA_TACTIL, colores } from "../tema/colores";
import { CONTROLES } from "../tema/controles";
import { crearEstilos } from "../tema/tipografia";
import { nombreAccesibleDelModulo } from "./modulos";

/**
 * Las pestañas de los módulos, bajo la cabecera negra (US-016, CA-1): ícono
 * y texto, la activa en amarillo #FCE200 (12,7:1 sobre #1E1E1E) con un
 * subrayado de 4 dp; las demás en #C8C8C8 (10,0:1).
 *
 * - Si caben, se reparten el ancho (`flexGrow`); si no, la fila se desliza
 *   de lado con el desvanecido y el chevron de `FilaDeslizable` (H-01).
 * - La activa se desplaza hasta quedar a la vista al elegirla y cada vez que
 *   cambia `foco` (la cabecera lo sube al volver al módulo, H-05).
 * - Los textos no se cortan ni pasan a dos líneas: con la letra al 200 % la
 *   fila solo se hace más larga (CA-10).
 *
 * `modulos`: los de `modulosVisibles` (con `cuenta`); `activo`: el `id`.
 */
export const PestanasDeModulos = memo(function PestanasDeModulos({ modulos, activo, onElegir, foco = 0 }) {
  const fila = useRef(null);
  const posiciones = useRef({});

  useEffect(() => {
    fila.current?.mostrar(posiciones.current[activo]);
  }, [activo, foco]);

  return (
    <FilaDeslizable
      ref={fila}
      fondo={colores.cabecera}
      style={estilos.fila}
      contentContainerStyle={estilos.contenido}
      accessibilityRole="tablist"
      accessibilityLabel="Módulos"
      testID="pestanas-de-modulos"
    >
      {modulos.map((m) => {
        const seleccionada = m.id === activo;
        const color = seleccionada ? colores.acento : colores.tintaInactivaOscuro;
        return (
          <Pressable
            key={m.id}
            testID={`modulo-${m.id}`}
            onPress={() => onElegir(m)}
            onLayout={(e) => {
              posiciones.current[m.id] = e.nativeEvent.layout.x;
              if (seleccionada) fila.current?.mostrar(e.nativeEvent.layout.x);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: seleccionada }}
            accessibilityLabel={nombreAccesibleDelModulo(m)}
            style={({ pressed }) => [
              estilos.pestana,
              seleccionada && estilos.pestanaActiva,
              pressed && estilos.presionada,
            ]}
          >
            <Icono nombre={m.icono} size={20} color={color} />
            <Text style={[estilos.texto, seleccionada && estilos.textoActivo]}>{m.texto}</Text>
            {m.cuenta > 0 ? (
              <View
                style={CONTROLES.insignia}
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
              >
                <Text style={estilos.insigniaTexto}>{m.cuenta > 99 ? "99+" : m.cuenta}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </FilaDeslizable>
  );
});

const estilos = crearEstilos({
  fila: { backgroundColor: colores.cabecera },
  // `flexGrow`: si caben, ocupan todo el ancho y se lo reparten.
  contenido: { flexGrow: 1, paddingHorizontal: 8 },
  pestana: {
    flexGrow: 1,
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 6,
    // El subrayado ocupa siempre su sitio: la fila no salta al cambiar.
    borderBottomWidth: 4,
    borderBottomColor: "transparent",
  },
  pestanaActiva: { borderBottomColor: colores.acento },
  presionada: { backgroundColor: colores.presionadoOscuro },
  texto: { fontSize: 15, fontWeight: "500", color: colores.tintaInactivaOscuro },
  textoActivo: { fontWeight: "700", color: colores.acento },
  insigniaTexto: { ...CONTROLES.insigniaTexto },
});
