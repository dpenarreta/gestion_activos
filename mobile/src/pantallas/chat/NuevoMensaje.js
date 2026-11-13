import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { mensajeDeError } from "../../api/errores";
import { chatService, directorioService } from "../../api/servicios";
import { useChat, useChatVisible } from "../../chat/ChatContext";
import { iniciales, textoPresencia } from "../../chat/formato";
import { usePresencia } from "../../chat/usePresencia";
import { ESPERA_BUSCAR_MS, MAXIMO_RESULTADOS, TEXTO_HAY_MAS, textoDeResultados } from "../../utils/busqueda";
import { Alerta, ErrorConReintento } from "../../componentes/comunes";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";
import { Presencia } from "./piezas";

/**
 * «Nuevo mensaje» (US-011, CA-5): se busca a la persona en el directorio de
 * la empresa (`/chat/directorio/?q=`, que ya deja fuera a quien pregunta) y
 * se abre o se crea el directo con ella (`POST /chat/conversaciones/directa/`).
 * Mismo patrón accesible que el buscador del reemplazo (US-010): una pausa al
 * escribir, el número de resultados anunciado y «Reintentar» si falla.
 * Elegir dos veces no crea ni abre dos veces.
 */
// Una sola pausa para todos los buscadores (US-014, QA-TECH).
export { ESPERA_BUSCAR_MS };

export function NuevoMensaje() {
  useChatVisible();
  const router = useRouter();
  const { cargarConversaciones } = useChat();
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState(null);
  const [vez, setVez] = useState(0);
  const [abriendo, setAbriendo] = useState(null);
  const [error, setError] = useState(null);
  const enCurso = useRef(false);
  const montado = useRef(true);
  const encontradas = resultados ?? [];
  // Aquí la lista inicial (sin escribir) sí sirve; solo se limita lo que se
  // ve a 8 y se pide afinar (auditoría UX, H-05).
  const personas = encontradas.slice(0, MAXIMO_RESULTADOS);
  const hayMas = encontradas.length > MAXIMO_RESULTADOS;
  const presencia = usePresencia(personas.map((p) => p.id));

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    let vigente = true;
    setErrorBusqueda(null);
    setBuscando(true);
    const pausa = setTimeout(
      () => {
        directorioService
          .buscar(texto)
          .then((lista) => {
            if (!vigente || !montado.current) return;
            const encontradas = Array.isArray(lista) ? lista : [];
            setResultados(encontradas);
            // B7: con más de 8, se dice cuántas se muestran y que hay más.
            if (texto.trim()) anunciar(textoDeResultados(encontradas.length, texto.trim()));
          })
          .catch((e) => {
            if (vigente && montado.current) {
              setResultados([]);
              setErrorBusqueda(mensajeDeError(e, "No se pudo buscar a las personas."));
            }
          })
          .finally(() => {
            if (vigente && montado.current) setBuscando(false);
          });
      },
      texto ? ESPERA_BUSCAR_MS : 0,
    );
    return () => {
      vigente = false;
      clearTimeout(pausa);
    };
  }, [texto, vez]);

  async function escribirA(persona) {
    if (enCurso.current) return;
    enCurso.current = true;
    setAbriendo(persona.id);
    setError(null);
    try {
      const conversacion = await chatService.directa(persona.id);
      if (!montado.current) return;
      cargarConversaciones({ silenciosa: true });
      router.replace(`/chat/conversacion/${conversacion.id}`);
    } catch (e) {
      if (montado.current) setError({ texto: mensajeDeError(e, "No se pudo abrir la conversación."), clave: Date.now() });
    } finally {
      enCurso.current = false;
      if (montado.current) setAbriendo(null);
    }
  }

  const cabecera = (
    <View style={estilos.cabecera}>
      <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
        ¿A quién le escribe?
      </Text>
      <TextInput
        testID="buscar-persona"
        value={texto}
        onChangeText={setTexto}
        placeholder="Buscar por nombre o correo"
        placeholderTextColor={colores.tintaTenue}
        accessibilityLabel="¿A quién le escribe? Buscar por nombre o correo"
        autoCorrect={false}
        autoFocus
        style={estilos.entrada}
      />
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} /> : null}
      {buscando && resultados !== null ? (
        <View style={estilos.buscando} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colores.primario} />
          <Text style={estilos.tenue}>Buscando…</Text>
        </View>
      ) : null}
      {errorBusqueda ? <ErrorConReintento texto={errorBusqueda} onReintentar={() => setVez((v) => v + 1)} /> : null}
    </View>
  );

  return (
    <FlatList
      testID="directorio"
      style={estilos.pantalla}
      contentContainerStyle={estilos.contenido}
      keyboardShouldPersistTaps="handled"
      data={errorBusqueda ? [] : personas}
      keyExtractor={(p) => String(p.id)}
      ListHeaderComponent={cabecera}
      ListFooterComponent={
        hayMas && !errorBusqueda ? (
          <Text style={estilos.tenue} testID="hay-mas">
            {TEXTO_HAY_MAS}
          </Text>
        ) : null
      }
      ListEmptyComponent={
        errorBusqueda ? null : resultados === null ? (
          <ActivityIndicator color={colores.primario} accessibilityLabel="Buscando personas…" />
        ) : (
          <Text style={estilos.tenue} accessibilityLiveRegion="polite">
            {texto.trim() ? `Nadie coincide con «${texto.trim()}».` : "No hay personas para elegir."}
          </Text>
        )
      }
      renderItem={({ item: p }) => {
        const suya = presencia[String(p.id)];
        const detalle = [suya ? textoPresencia(suya) : null, p.cargo, p.area].filter(Boolean).join(". ");
        return (
          <Pressable
            testID={`persona-${p.id}`}
            onPress={() => escribirA(p)}
            disabled={Boolean(abriendo)}
            accessibilityRole="button"
            accessibilityState={{ disabled: Boolean(abriendo), busy: abriendo === p.id }}
            accessibilityLabel={[p.nombre, detalle].filter(Boolean).join(". ")}
            accessibilityHint="Abre el mensaje directo con esta persona"
            style={({ pressed }) => [estilos.persona, pressed && estilos.presionada]}
          >
            {/* El mismo avatar que la lista de chats: iniciales amarillas
                sobre negro (12,7:1) (N-12). */}
            <View style={estilos.avatar}>
              {abriendo === p.id ? (
                <ActivityIndicator color={colores.acento} />
              ) : (
                <Text style={estilos.iniciales} maxFontSizeMultiplier={1.3}>
                  {iniciales(p.nombre)}
                </Text>
              )}
            </View>
            <View style={estilos.personaTexto}>
              <Text style={estilos.nombre}>{p.nombre}</Text>
              {suya ? <Presencia presencia={suya} compacta /> : null}
              {p.cargo || p.area ? <Text style={estilos.tenue}>{[p.cargo, p.area].filter(Boolean).join(" · ")}</Text> : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 6, flexGrow: 1 },
  cabecera: { gap: 8, marginBottom: 8 },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  entrada: CONTROLES.entrada,
  buscando: { flexDirection: "row", alignItems: "center", gap: 8 },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  persona: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: AREA_TACTIL,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  presionada: { backgroundColor: colores.realce },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colores.primario,
    alignItems: "center",
    justifyContent: "center",
  },
  iniciales: { fontSize: 16, fontWeight: "700", color: colores.acento },
  personaTexto: { flex: 1, gap: 2 },
  nombre: { fontSize: 16, fontWeight: "600", color: colores.tinta },
});
