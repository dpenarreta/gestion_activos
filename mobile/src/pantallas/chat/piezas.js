import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";

import { chatService } from "../../api/servicios";
import { escucharMiEstado } from "../../chat/miEstado";
import {
  extrasDePresencia,
  ICONO_DE_ESTADO,
  iconoDePresencia,
  textoAvisoDeEstado,
  textoPresencia,
  textoSinLeer,
} from "../../chat/formato";
import { Icono } from "../../componentes/Icono";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";

/**
 * Piezas del chat (US-011): la presencia de una persona, el aviso de su
 * estado, la insignia de no leídos y el resumen de mi estado.
 */

/** El color del ícono de presencia; el texto siempre lo acompaña. */
function colorDePresencia(presencia) {
  const clave = presencia?.estado?.clave;
  if (clave && clave !== "vacaciones_proximas") return colores.avisoTexto;
  return presencia?.en_linea ? colores.bienTexto : colores.tintaTenue;
}

/** La presencia con ícono y texto (CA-8: nunca solo el color). `compacta`
 * muestra solo el texto principal; lo demás va en la etiqueta accesible. */
export function Presencia({ presencia, compacta = false, testID }) {
  if (!presencia) return null;
  const texto = textoPresencia(presencia);
  const extras = extrasDePresencia(presencia);
  const completo = [texto, ...extras].join(" · ");
  return (
    <View style={estilos.presencia} testID={testID} accessible accessibilityLabel={completo}>
      <Icono nombre={iconoDePresencia(presencia)} size={14} color={colorDePresencia(presencia)} />
      <Text style={estilos.presenciaTexto}>{compacta ? texto : completo}</Text>
    </View>
  );
}

/** «Carla está en almuerzo hasta las 13:30: verá su mensaje al volver.» */
export function AvisoDeEstado({ nombre, estado, testID }) {
  const texto = textoAvisoDeEstado(nombre, estado);
  if (!texto) return null;
  const icono = ICONO_DE_ESTADO[estado.clave] ?? "calendar-clock";
  return (
    <View style={estilos.aviso} testID={testID} accessible accessibilityLabel={texto}>
      <Icono nombre={icono} size={18} color={colores.avisoTexto} />
      <Text style={estilos.avisoTexto}>{texto}</Text>
    </View>
  );
}

/** El número de no leídos: se ve el número y se oye «3 mensajes sin leer». */
export function InsigniaSinLeer({ cantidad }) {
  if (!cantidad) return null;
  return (
    <View style={estilos.insignia} accessible accessibilityLabel={textoSinLeer(cantidad)}>
      <Text style={estilos.insigniaTexto}>{cantidad > 99 ? "99+" : cantidad}</Text>
    </View>
  );
}

/** El nombre y el ícono de un estado, como el botón de la web. */
export const NOMBRES_DE_ESTADO = {
  disponible: "Disponible",
  almuerzo: "Almuerzo",
  reunion: "En reunión",
  no_disponible: "No disponible",
  vacaciones: "Vacaciones",
  fuera_oficina: "Fuera de la oficina",
};

/** La clave del estado que se ve («disponible» si no rige ninguno). */
export function claveVigente(datos) {
  const vigente = datos?.vigente;
  return vigente && vigente.clave !== "vacaciones_proximas" && NOMBRES_DE_ESTADO[vigente.clave]
    ? vigente.clave
    : "disponible";
}

/**
 * «Mi estado: Disponible ›»: lo que ven los demás, con el detalle (hasta
 * cuándo). Se lee al aparecer, al volver la app al frente y cuando se guarda
 * en «Mi estado». Lo usan la pestaña «Chat» y «Cuenta».
 */
export function ResumenMiEstado({ onAbrir, testID = "resumen-mi-estado", compacta = false }) {
  const [datos, setDatos] = useState(null);
  const montado = useRef(true);

  const cargar = useCallback(() => {
    Promise.resolve()
      .then(() => chatService.miEstado())
      .then((d) => {
        if (montado.current && d) setDatos(d);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    montado.current = true;
    cargar();
    const suscripcion = AppState.addEventListener("change", (estado) => {
      if (estado === "active") cargar();
    });
    const dejar = escucharMiEstado((nuevo) => {
      if (montado.current && nuevo) setDatos(nuevo);
    });
    return () => {
      montado.current = false;
      suscripcion.remove();
      dejar();
    };
  }, [cargar]);

  const clave = claveVigente(datos);
  const nombre = datos ? NOMBRES_DE_ESTADO[clave] : "Cargando…";
  const detalle = datos?.vigente?.detalle;
  return (
    <Pressable
      testID={testID}
      onPress={onAbrir}
      accessibilityRole="button"
      accessibilityLabel={`Mi estado en el chat: ${nombre}${detalle && detalle !== nombre ? `. ${detalle}` : ""}`}
      accessibilityHint="Abre la pantalla para cambiar su estado"
      style={({ pressed }) => [estilos.miEstado, compacta && estilos.miEstadoCompacto, pressed && estilos.presionado]}
    >
      <Icono nombre={ICONO_DE_ESTADO[clave]} size={20} color={colores.primario} />
      {compacta ? (
        // Una sola fila en la pestaña «Chat» (auditoría UX, H-08).
        <View style={estilos.miEstadoTexto}>
          <Text style={estilos.miEstadoNombre}>
            <Text style={estilos.miEstadoEtiqueta}>Mi estado: </Text>
            {nombre}
          </Text>
          {detalle && detalle !== nombre ? <Text style={estilos.miEstadoDetalle}>{detalle}</Text> : null}
        </View>
      ) : (
        <View style={estilos.miEstadoTexto}>
          <Text style={estilos.miEstadoEtiqueta}>Mi estado</Text>
          <Text style={estilos.miEstadoNombre}>{nombre}</Text>
          {detalle && detalle !== nombre ? <Text style={estilos.miEstadoDetalle}>{detalle}</Text> : null}
        </View>
      )}
      <Icono nombre="chevron-right" size={22} color={colores.tintaTenue} />
    </Pressable>
  );
}

const estilos = crearEstilos({
  presencia: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  presenciaTexto: { fontSize: 13, color: colores.tintaSuave, flexShrink: 1 },
  aviso: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colores.avisoFondo,
  },
  avisoTexto: { flex: 1, fontSize: 14, color: colores.avisoTexto },
  // Sin alto fijo: con la letra al 200 % el número crece y la insignia con
  // él (N-01).
  insignia: { ...CONTROLES.insignia, minWidth: 24, borderRadius: 12, justifyContent: "center" },
  insigniaTexto: CONTROLES.insigniaTexto,
  miEstado: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: AREA_TACTIL,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    backgroundColor: colores.superficie,
  },
  miEstadoCompacto: { paddingVertical: 4, borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0 },
  presionado: { backgroundColor: colores.realce },
  miEstadoTexto: { flex: 1 },
  miEstadoEtiqueta: { fontSize: 13, color: colores.tintaTenue },
  miEstadoNombre: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  miEstadoDetalle: { fontSize: 13, color: colores.tintaSuave },
});
