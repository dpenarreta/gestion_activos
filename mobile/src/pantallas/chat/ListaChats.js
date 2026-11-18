import { useFocusEffect, useRouter } from "expo-router";
import { memo, useCallback, useRef, useState } from "react";
import { FlatList, Pressable, Text, useWindowDimensions, View } from "react-native";

import { useChat, useChatVisible } from "../../chat/ChatContext";
import { PISTA_CONTACTO, useAbrirContacto } from "../../chat/contacto";
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
import { Alerta, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { Refresco } from "../../componentes/Refresco";
import { BotonRedondo } from "../../componentes/BotonRedondo";
import { Icono } from "../../componentes/Icono";
import { useApoyoDeLaBurbuja, useRellenoDeLaBurbuja } from "../../navegacion/BurbujaDeSoporte";
import { MARGEN_BURBUJA, SEPARACION_BURBUJA } from "../../navegacion/reglasDeLaBurbuja";
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { InsigniaSinLeer, Presencia, ResumenMiEstado } from "./piezas";

/**
 * La pestaña «Chat» (US-011, CA-1): el canal general arriba y luego las
 * conversaciones por actividad, como las ordena el servidor. Cada una con su
 * nombre (en un directo, el de la otra persona y su presencia), el último
 * mensaje, la hora y los no leídos. Desde aquí se escribe a alguien nuevo
 * (CA-5) y se cambia «Mi estado» (CA-8). Desde la US-024 (16/11/2026) los
 * grupos también se crean aquí («Crear un grupo», en la pila).
 */
/** Con la letra del sistema a partir de este tamaño, la hora de cada fila
 * baja bajo el último mensaje (N-01, N-14). */
export const ESCALA_HORA_ABAJO = 1.3;
/** Cuánto dura el candado de «Nuevo mensaje» si la pantalla no llega a
 * perder el foco (B7). */
export const CANDADO_NUEVO_MS = 1000;
/** US-024: «Nuevo grupo» en la lista, en «Mis grupos» y en la barra. */
export const PISTA_NUEVO_GRUPO = "Abre el formulario para crear un grupo";
/** El botón flotante de «Nuevo mensaje» o «Nuevo grupo». */
export const TAMANO_FLOTANTE_CHAT = 56;

/**
 * `soloGrupos` (US-016): la vista «Mis grupos» del módulo Chat, la misma
 * lista filtrada en el teléfono a los grupos (sin API nueva).
 */
export function ListaChats({ soloGrupos = false }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  useChatVisible();
  const router = useRouter();
  const abrirContacto = useAbrirContacto();
  const { conversaciones, estado, error, noLeidos, cargarConversaciones } = useChat();
  const [refrescando, setRefrescando] = useState(false);
  const { fontScale } = useWindowDimensions();
  const horaAbajo = fontScale >= ESCALA_HORA_ABAJO;
  // B7: dos toques seguidos en «Nuevo mensaje» (o en «Crear un grupo») abren
  // una sola pantalla.
  const abriendoNuevo = useRef(false);
  const presencia = usePresencia(conversaciones.filter((c) => c.tipo === "directa").map((c) => c.otro?.id));
  // US-029 (CA-3): la burbuja de soporte se apila encima de la de «Nuevo
  // mensaje», no la tapa.
  useApoyoDeLaBurbuja({ altoFijo: MARGEN_BURBUJA + TAMANO_FLOTANTE_CHAT });
  // Y la lista deja libre el alto de las dos al final.
  const relleno = useRellenoDeLaBurbuja({ margenDelSistema: false, extra: MARGEN_BURBUJA + TAMANO_FLOTANTE_CHAT + SEPARACION_BURBUJA });

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

  function abrirUnaVez(ruta) {
    if (abriendoNuevo.current) return;
    abriendoNuevo.current = true;
    router.push(ruta);
    // Por si la navegación no llega a quitar el foco (o falla).
    setTimeout(() => {
      abriendoNuevo.current = false;
    }, CANDADO_NUEVO_MS);
  }

  // Callbacks estables y la fila en `memo` (QA US-031, P3): el sondeo del
  // chat no vuelve a pintar las filas que no cambiaron.
  const abrirConversacion = useCallback((conversacion) => router.push(`/chat/conversacion/${conversacion.id}`), [router]);
  // US-031 (CA-3): en un directo, el avatar abre la tarjeta de la otra
  // persona (`otro`, de `views.resumen`), en la empresa activa.
  const verContacto = useCallback((conversacion) => abrirContacto(conversacion.otro.id), [abrirContacto]);
  const renderItem = useCallback(
    ({ item }) => (
      <FilaConversacion
        conversacion={item}
        sinLeer={noLeidos[String(item.id)] ?? 0}
        presencia={item.tipo === "directa" ? presencia[String(item.otro?.id)] : null}
        horaAbajo={horaAbajo}
        onAbrir={abrirConversacion}
        onVerContacto={item.tipo === "directa" && item.otro?.id ? verContacto : undefined}
      />
    ),
    [noLeidos, presencia, horaAbajo, abrirConversacion, verContacto],
  );

  async function refrescar() {
    setRefrescando(true);
    await cargarConversaciones({ silenciosa: true });
    setRefrescando(false);
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
      {/* US-024 (UX H-14): en «Mis grupos» el botón flotante crea un grupo. */}
      {soloGrupos ? (
        <Pressable
          testID="nuevo-grupo"
          onPress={() => abrirUnaVez("/chat/grupo-nuevo")}
          accessibilityRole="button"
          accessibilityLabel="Nuevo grupo"
          accessibilityHint={PISTA_NUEVO_GRUPO}
          hitSlop={4}
          style={({ pressed }) => [estilos.flotante, pressed && estilos.presionado]}
        >
          <Icono nombre="account-multiple-plus-outline" size={26} color={colores.marcaNegro} />
        </Pressable>
      ) : (
        <Pressable
          testID="nuevo-mensaje"
          onPress={() => abrirUnaVez("/chat/nuevo")}
          accessibilityRole="button"
          accessibilityLabel="Nuevo mensaje"
          accessibilityHint="Busca a una persona para escribirle"
          hitSlop={4}
          style={({ pressed }) => [estilos.flotante, pressed && estilos.presionado]}
        >
          <Icono nombre="message-plus-outline" size={26} color={colores.marcaNegro} />
        </Pressable>
      )}
      <FlatList
        testID="lista-chats"
        style={estilos.pantalla}
        contentContainerStyle={[estilos.contenido, relleno]}
        data={estado === "listo" ? visibles : []}
        keyExtractor={(c) => String(c.id)}
        ListHeaderComponent={cabecera}
        ListEmptyComponent={<View style={estilos.vacio}>{vacio}</View>}
        ListFooterComponent={
          // US-024: en la app, ya no en el navegador. En «Mis grupos» ya
          // está el botón flotante.
          estado === "listo" && !soloGrupos ? (
            <View style={estilos.pie}>
              <BotonRedondo
                testID="crear-grupo"
                icono="account-multiple-plus-outline"
                nombre="Nuevo grupo"
                familia="chat"
                pista={PISTA_NUEVO_GRUPO}
                onPress={() => abrirUnaVez("/chat/grupo-nuevo")}
              />
            </View>
          ) : null
        }
        renderItem={renderItem}
        ItemSeparatorComponent={SeparadorDeFila}
        refreshControl={<Refresco refreshing={refrescando} onRefresh={refrescar} />}
      />
    </View>
  );
}

/** Una línea fina entre filas, desde el texto (no bajo el avatar). */
function SeparadorDeFila() {
  const estilos = useEstilos(fabricaDeEstilos);
  return <View style={estilos.separador} />;
}

/**
 * Una fila de la lista. Con `onVerContacto` (un directo, US-031 CA-3) el
 * avatar es un botón aparte, hermano del de la fila y no anidado en él: así
 * cada uno tiene su nombre para el lector de pantalla y la fila conserva el
 * suyo. Sin él (canal general, grupos, áreas) todo es un solo botón, como
 * antes, y el avatar abre la conversación.
 */
/* `onAbrir` y `onVerContacto` reciben la conversación: así los de la lista
 * son los mismos en cada render y `memo` sirve. */
export const FilaConversacion = memo(function FilaConversacion({
  conversacion,
  sinLeer,
  presencia,
  onAbrir,
  onVerContacto,
  horaAbajo = false,
}) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
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
  // Avatar de 44: en un directo, las iniciales; en el canal general y los
  // grupos, su ícono. Amarillo sobre negro (12,7:1).
  const avatar = (
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
  );
  const cuerpo = (
    <>
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
    </>
  );

  if (!onVerContacto) {
    return (
      <Pressable
        testID={`conversacion-${conversacion.id}`}
        onPress={() => onAbrir(conversacion)}
        accessibilityRole="button"
        accessibilityLabel={etiqueta}
        accessibilityHint="Abre la conversación"
        style={({ pressed }) => [estilos.item, sinLeer > 0 && estilos.itemNuevo, pressed && estilos.presionado]}
      >
        {avatar}
        {cuerpo}
      </Pressable>
    );
  }

  // El mismo dibujo que la fila de un solo botón: 16 a la izquierda del
  // avatar y 12 entre el avatar y el texto (6 de cada botón).
  return (
    <View style={[estilos.itemDividido, sinLeer > 0 && estilos.itemNuevo]}>
      <Pressable
        testID={`avatar-${conversacion.id}`}
        onPress={() => onVerContacto(conversacion)}
        accessibilityRole="button"
        accessibilityLabel={`Ver la tarjeta de ${conversacion.nombre}`}
        accessibilityHint={PISTA_CONTACTO}
        style={({ pressed }) => [estilos.avatarBoton, pressed && estilos.presionado]}
      >
        {avatar}
      </Pressable>
      <Pressable
        testID={`conversacion-${conversacion.id}`}
        onPress={() => onAbrir(conversacion)}
        accessibilityRole="button"
        accessibilityLabel={etiqueta}
        accessibilityHint="Abre la conversación"
        style={({ pressed }) => [estilos.cuerpoBoton, pressed && estilos.presionado]}
      >
        {cuerpo}
      </Pressable>
    </View>
  );
});

const fabricaDeEstilos = (colores) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  // Abajo deja sitio al botón flotante.
  contenido: { paddingTop: 8, paddingBottom: 96, flexGrow: 1 },
  cabecera: { gap: 12, marginBottom: 8, paddingHorizontal: 16 },
  pie: { gap: 10, marginTop: 16, paddingHorizontal: 16 },
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
  // US-031 (CA-3): la fila de un directo, con el avatar y el resto como dos
  // botones; cada uno ocupa todo el alto de la fila.
  itemDividido: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: Math.max(72, AREA_TACTIL),
    backgroundColor: colores.superficie,
  },
  avatarBoton: {
    justifyContent: "center",
    paddingLeft: 16,
    paddingRight: 6,
    minWidth: AREA_TACTIL,
    minHeight: AREA_TACTIL,
  },
  cuerpoBoton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 6,
    paddingRight: 16,
    paddingVertical: 10,
  },
  presionado: { opacity: 0.85 },
  separador: { height: 1, marginLeft: 72, backgroundColor: colores.borde },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colores.avatar,
    alignItems: "center",
    justifyContent: "center",
  },
  iniciales: { fontSize: 16, fontWeight: "700", color: colores.acento },
  flotante: {
    position: "absolute",
    zIndex: 1,
    right: 16,
    bottom: MARGEN_BURBUJA,
    width: TAMANO_FLOTANTE_CHAT,
    height: TAMANO_FLOTANTE_CHAT,
    borderRadius: TAMANO_FLOTANTE_CHAT / 2,
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
