import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

import { mensajeDeError } from "../../api/errores";
import { chatService } from "../../api/servicios";
import { extrasDePresencia, NOMBRE_DE_TIPO, textoPresencia } from "../../chat/formato";
import { usePresencia } from "../../chat/usePresencia";
import { Alerta, Cargando, ErrorConReintento } from "../../componentes/comunes";
import { BotonRedondo } from "../../componentes/BotonRedondo";
import { Icono } from "../../componentes/Icono";
import { abrirEnNavegador, urlWeb } from "../../navegador/enlaceWeb";
import { useSesion } from "../../sesion/SesionContext";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { Presencia } from "./piezas";

/**
 * Los participantes de un grupo o del canal general (US-011, CA-6), con su
 * presencia (CA-8). En la app se participa: editar el grupo (quien lo
 * administra) o salir de él (solo de un grupo personalizado:
 * `chat.services.salir`) se hace en la web, en la misma conversación
 * (`/admin/chat?c=ID`, `chat.services.enlace`).
 */
export function textoGestionEnLaWeb(conversacion) {
  const acciones = [];
  if (conversacion?.administra && (conversacion.tipo === "grupo" || conversacion.tipo === "area")) {
    acciones.push("editar el grupo");
  }
  if (conversacion?.tipo === "grupo") acciones.push("salir de él");
  if (acciones.length === 0) return null;
  const lista = acciones.join(" o ");
  return `Para ${lista}, ábralo en el navegador.`;
}

export function Participantes({ id, empresa = null }) {
  const router = useRouter();
  const { empresaActiva } = useSesion();
  const [estado, setEstado] = useState("cargando");
  const [conversacion, setConversacion] = useState(null);
  const [error, setError] = useState(null);
  const [errorNavegador, setErrorNavegador] = useState(null);
  const montado = useRef(true);
  const participantes = Array.isArray(conversacion?.participantes) ? conversacion.participantes : [];
  const presencia = usePresencia(participantes.map((p) => p.id));

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async () => {
    setEstado("cargando");
    setError(null);
    try {
      const datos = await chatService.conversacion(id, empresa ? { empresa } : {});
      if (!montado.current) return;
      setConversacion(datos);
      setEstado("listo");
    } catch (e) {
      if (!montado.current) return;
      setError(mensajeDeError(e, "No se pudieron cargar los participantes."));
      setEstado("error");
    }
  }, [id, empresa]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function abrirEnLaWeb() {
    setErrorNavegador(null);
    const url = urlWeb(`/admin/chat?c=${id}`, { empresa: empresa ?? empresaActiva?.id });
    const abierta = await abrirEnNavegador(url, { avisarSiFalla: false });
    if (abierta === false) setErrorNavegador("No se pudo abrir el navegador del teléfono. Intente de nuevo.");
  }

  if (estado === "cargando") return <Cargando texto="Cargando participantes…" />;
  if (estado === "error") {
    return (
      <View style={estilos.contenido}>
        <ErrorConReintento texto={error} onReintentar={cargar} />
      </View>
    );
  }

  const gestion = textoGestionEnLaWeb(conversacion);
  return (
    <FlatList
      testID="participantes"
      style={estilos.pantalla}
      contentContainerStyle={estilos.contenido}
      data={participantes}
      keyExtractor={(p) => String(p.id)}
      ListHeaderComponent={
        <View style={estilos.cabecera}>
          <Text style={estilos.titulo} accessibilityRole="header">
            {conversacion?.nombre}
          </Text>
          <Text style={estilos.tenue}>
            {NOMBRE_DE_TIPO[conversacion?.tipo] ?? ""}
            {` · ${participantes.length} ${participantes.length === 1 ? "participante" : "participantes"}`}
          </Text>
          {gestion ? (
            <>
              <Text style={estilos.tenue}>{gestion}</Text>
              <BotonRedondo
                testID="gestionar-en-la-web"
                icono="account-cog-outline"
                nombre="Gestionar el grupo"
                familia="chat"
                navegador
                etiqueta={`${gestion} Abrir en el navegador`}
                onPress={abrirEnLaWeb}
              />
              {errorNavegador ? <Alerta tipo="mal" texto={errorNavegador} /> : null}
            </>
          ) : null}
        </View>
      }
      renderItem={({ item: p }) => {
        const suya = presencia[String(p.id)];
        const detalle = [p.cargo, p.area].filter(Boolean).join(" · ");
        return (
          // Tocar a alguien abre su ficha de contacto (16/11/2026).
          <Pressable
            testID={`participante-${p.id}`}
            onPress={() =>
              router.push({
                pathname: "/chat/contacto/[id]",
                params: empresa ? { id: String(p.id), empresa } : { id: String(p.id) },
              })
            }
            style={({ pressed }) => [estilos.persona, pressed && estilos.presionado]}
            accessibilityRole="button"
            accessibilityHint="Abre su correo, teléfono, extensión y área."
            accessibilityLabel={[p.nombre, p.administra ? "Administra el grupo" : null, detalle, suya ? [textoPresencia(suya), ...extrasDePresencia(suya)].join(" · ") : null]
              .filter(Boolean)
              .join(". ")}
          >
            <Icono nombre={p.administra ? "account-star-outline" : "account-outline"} size={22} color={colores.primario} />
            <View style={estilos.personaTexto}>
              <Text style={estilos.nombre}>
                {p.nombre}
                {p.administra ? <Text style={estilos.tenue}> · Administra</Text> : null}
              </Text>
              {suya ? <Presencia presencia={suya} /> : null}
              {detalle ? <Text style={estilos.tenue}>{detalle}</Text> : null}
            </View>
            <Icono nombre="chevron-right" size={22} color={colores.tintaTenue} />
          </Pressable>
        );
      }}
    />
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 6 },
  cabecera: { gap: 8, marginBottom: 8 },
  titulo: { fontSize: 20, fontWeight: "700", color: colores.tinta },
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
  personaTexto: { flex: 1, gap: 2 },
  nombre: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  presionado: { opacity: 0.7 },
});
