import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";

import { useChat, useChatVisible } from "../../chat/ChatContext";
import {
  esDeMisGrupos,
  esGrupal,
  horaDeLista,
  ICONO_DE_TIPO,
  iniciales,
  textoPresencia,
  textoSinLeer,
  textoUltimo,
} from "../../chat/formato";
import { usePresencia } from "../../chat/usePresencia";
import { Alerta, Boton, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { abrirEnNavegador, urlWeb } from "../../navegador/enlaceWeb";
import { useSesion } from "../../sesion/SesionContext";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { InsigniaSinLeer, Presencia, ResumenMiEstado } from "./piezas";

/**
 * La pestaña «Chat» (US-011, CA-1): el canal general arriba y luego las
 * conversaciones por actividad, como las ordena el servidor. Cada una con su
 * nombre (en un directo, el de la otra persona y su presencia), el último
 * mensaje, la hora y los no leídos. Desde aquí se escribe a alguien nuevo
 * (CA-5) y se cambia «Mi estado» (CA-8). Crear un grupo se hace en la web.
 */
/** Con la letra del sistema a partir de este tamaño, la hora de cada fila
 * baja bajo el último mensaje (N-01, N-14). */
export const ESCALA_HORA_ABAJO = 1.3;
/** Cuánto dura el candado de «Nuevo mensaje» si la pantalla no llega a
 * perder el foco (B7). */
export const CANDADO_NUEVO_MS = 1000;

export const TEXTO_GRUPOS_EN_LA_WEB =
  "Crear, editar o salir de un grupo se hace en la web. En la app puede leer y escribir en sus grupos.";

/**
 * `soloGrupos` (US-016): la vista «Mis grupos» del módulo Chat, la misma
 * lista filtrada en el teléfono a los grupos (sin API nueva).
 */
export function ListaChats({ soloGrupos = false }) {
  useChatVisible();
  const router = useRouter();
  const { empresaActiva } = useSesion();
  const { conversaciones, estado, error, noLeidos, cargarConversaciones } = useChat();
  const [refrescando, setRefrescando] = useState(false);
  const [errorNavegador, setErrorNavegador] = useState(null);
  const { fontScale } = useWindowDimensions();
  const horaAbajo = fontScale >= ESCALA_HORA_ABAJO;
  // B7: dos toques seguidos en «Nuevo mensaje» abren una sola pantalla.
  const abriendoNuevo = useRef(false);
  const presencia = usePresencia(conversaciones.filter((c) => c.tipo === "directa").map((c) => c.otro?.id));

  // Al volver a la pestaña (de una conversación), la lista se refresca sin
  // «Cargando»: el último mensaje propio no llega por las novedades.
  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      abriendoNuevo.current = false;
      cargarConversaciones({ silenciosa: true });
    }, [cargarConversaciones]),
  );

  function nuevoMensaje() {
    if (abriendoNuevo.current) return;
    abriendoNuevo.current = true;
    router.push("/chat/nuevo");
    // Por si la navegación no llega a quitar el foco (o falla).
    setTimeout(() => {
      abriendoNuevo.current = false;
    }, CANDADO_NUEVO_MS);
  }

  async function refrescar() {
    setRefrescando(true);
    await cargarConversaciones({ silenciosa: true });
    setRefrescando(false);
  }

  async function crearGrupoEnLaWeb() {
    setErrorNavegador(null);
    const abierta = await abrirEnNavegador(urlWeb("/admin/chat", { empresa: empresaActiva?.id }), {
      avisarSiFalla: false,
    });
    if (!abierta) setErrorNavegador("No se pudo abrir el navegador del teléfono. Intente de nuevo.");
  }

  // «Nuevo mensaje» pasa a un botón flotante (auditoría UX, H-08): la
  // cabecera queda con «Mi estado» en una fila compacta.
  const cabecera = (
    <View style={estilos.cabecera}>
      <ResumenMiEstado compacta onAbrir={() => router.push("/chat/mi-estado")} />
      {error && estado === "listo" ? <Alerta tipo="aviso" texto="No se pudo actualizar la lista. Se muestra la anterior." /> : null}
    </View>
  );

  let vacio;
  if (estado === "cargando") vacio = <Cargando texto="Cargando conversaciones…" />;
  else if (estado === "error")
    vacio = <ErrorConReintento texto={error || "No se pudieron cargar las conversaciones."} onReintentar={() => cargarConversaciones()} />;
  else if (soloGrupos) vacio = <Vacio texto="No pertenece a ningún grupo." icono="account-group-outline" />;
  else vacio = <Vacio texto="Todavía no tiene conversaciones." icono="chat-outline" />;
  const visibles = soloGrupos ? conversaciones.filter(esDeMisGrupos) : conversaciones;

  return (
    <View style={estilos.pantalla}>
      {/* El botón flotante va antes de la lista en el árbol (N-13): el lector
          lo encuentra enseguida sin recorrer todas las conversaciones; el
          `zIndex` lo mantiene encima al pintar. Amarillo de la marca con el
          ícono negro (16,0:1). */}
      <Pressable
        testID="nuevo-mensaje"
        onPress={nuevoMensaje}
        accessibilityRole="button"
        accessibilityLabel="Nuevo mensaje"
        accessibilityHint="Busca a una persona para escribirle"
        hitSlop={4}
        style={({ pressed }) => [estilos.flotante, pressed && estilos.presionado]}
      >
        <Icono nombre="message-plus-outline" size={26} color={colores.marcaNegro} />
      </Pressable>
      <FlatList
        testID="lista-chats"
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        data={estado === "listo" ? visibles : []}
        keyExtractor={(c) => String(c.id)}
        ListHeaderComponent={cabecera}
        ListEmptyComponent={<View style={estilos.vacio}>{vacio}</View>}
        ListFooterComponent={
          estado === "listo" ? (
            <View style={estilos.pie}>
              <Text style={estilos.tenue}>{TEXTO_GRUPOS_EN_LA_WEB}</Text>
              <Boton
                titulo="Crear un grupo en el navegador"
                icono="open-in-new"
                variante="secundario"
                etiqueta="Crear un grupo. Abrir en el navegador"
                onPress={crearGrupoEnLaWeb}
              />
              {errorNavegador ? <Alerta tipo="mal" texto={errorNavegador} /> : null}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <FilaConversacion
            conversacion={item}
            sinLeer={noLeidos[String(item.id)] ?? 0}
            presencia={item.tipo === "directa" ? presencia[String(item.otro?.id)] : null}
            horaAbajo={horaAbajo}
            onAbrir={() => router.push(`/chat/conversacion/${item.id}`)}
          />
        )}
        ItemSeparatorComponent={SeparadorDeFila}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
      />
    </View>
  );
}

/** Una línea fina entre filas, desde el texto (no bajo el avatar). */
function SeparadorDeFila() {
  return <View style={estilos.separador} />;
}

export function FilaConversacion({ conversacion, sinLeer, presencia, onAbrir, horaAbajo = false }) {
  const ultimo = textoUltimo(conversacion);
  const hora = conversacion.ultimo ? horaDeLista(conversacion.ultimo.fecha) : "";
  const etiqueta = [
    conversacion.nombre,
    presencia ? textoPresencia(presencia) : null,
    sinLeer > 0 ? textoSinLeer(sinLeer) : null,
    ultimo,
    hora,
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <Pressable
      testID={`conversacion-${conversacion.id}`}
      onPress={onAbrir}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityHint="Abre la conversación"
      style={({ pressed }) => [estilos.item, sinLeer > 0 && estilos.itemNuevo, pressed && estilos.presionado]}
    >
      {/* Avatar de 44: en un directo, las iniciales; en el canal general y
          los grupos, su ícono. Amarillo sobre negro (12,7:1). */}
      <View style={estilos.avatar}>
        {esGrupal(conversacion) ? (
          <Icono nombre={ICONO_DE_TIPO[conversacion.tipo] ?? "chat-outline"} size={22} color={colores.acento} />
        ) : (
          // Con la letra grande, las iniciales crecen hasta 1,3 veces: más no
          // caben en el círculo de 44 (N-01).
          <Text style={estilos.iniciales} maxFontSizeMultiplier={1.3}>
            {iniciales(conversacion.nombre)}
          </Text>
        )}
      </View>
      <View style={estilos.texto}>
        <Text style={[estilos.nombre, sinLeer > 0 && estilos.nombreNuevo]}>{conversacion.nombre}</Text>
        {presencia ? <Presencia presencia={presencia} compacta /> : null}
        <Text style={estilos.ultimo} numberOfLines={2}>
          {ultimo}
        </Text>
        {horaAbajo && hora ? (
          <Text style={estilos.hora} testID={`hora-${conversacion.id}`}>
            {hora}
          </Text>
        ) : null}
      </View>
      <View style={estilos.meta}>
        {!horaAbajo && hora ? (
          <Text style={estilos.hora} testID={`hora-${conversacion.id}`}>
            {hora}
          </Text>
        ) : null}
        <InsigniaSinLeer cantidad={sinLeer} />
      </View>
    </Pressable>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  // Abajo deja sitio al botón flotante.
  contenido: { paddingTop: 8, paddingBottom: 96, flexGrow: 1 },
  cabecera: { gap: 12, marginBottom: 8, paddingHorizontal: 16 },
  pie: { gap: 10, marginTop: 16, paddingHorizontal: 16 },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  vacio: { paddingHorizontal: 16 },
  // Filas de lista con una línea fina entre ellas, en vez de tarjetas.
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: Math.max(72, AREA_TACTIL),
    backgroundColor: colores.superficie,
  },
  itemNuevo: { backgroundColor: colores.realce },
  presionado: { opacity: 0.85 },
  separador: { height: 1, marginLeft: 72, backgroundColor: colores.borde },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colores.primario,
    alignItems: "center",
    justifyContent: "center",
  },
  iniciales: { fontSize: 16, fontWeight: "700", color: colores.acento },
  flotante: {
    position: "absolute",
    zIndex: 1,
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colores.acento,
    elevation: 4,
    shadowColor: colores.marcaNegro,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  texto: { flex: 1, gap: 2 },
  nombre: { fontSize: 16, color: colores.tinta, fontWeight: "500" },
  nombreNuevo: { fontWeight: "700" },
  ultimo: { fontSize: 14, color: colores.tintaSuave },
  meta: { alignItems: "flex-end", gap: 6 },
  hora: { fontSize: 13, color: colores.tintaTenue },
});
