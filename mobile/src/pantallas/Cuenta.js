import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from "react-native";

import { anunciar } from "../accesibilidad/anunciar";
import { mensajeDeError } from "../api/errores";
import { Alerta, Boton } from "../componentes/comunes";
import { Icono } from "../componentes/Icono";
import { estadoDelPermiso, registrarDispositivo } from "../notificaciones/push";
import { useSesion } from "../sesion/SesionContext";
import { useCerrarSesion } from "../sesion/useCerrarSesion";
import { ResumenMiEstado } from "./chat/piezas";
import { colores } from "../tema/colores";
import { CONTROLES } from "../tema/controles";
import { crearEstilos } from "../tema/tipografia";

/** El nombre con el rol que se ejerce en ella, como el selector web. */
function conRol(empresa) {
  return empresa.roles?.length ? `${empresa.nombre} — ${empresa.roles.join(", ")}` : empresa.nombre;
}

const TEXTOS_AVISOS = {
  activado: "El permiso de avisos está concedido en este teléfono.",
  denegado: "Los avisos están desactivados. Puede activarlos en los ajustes del teléfono.",
  sin_decidir: "Todavía no ha decidido si quiere recibir avisos en este teléfono.",
  no_disponible: "Este dispositivo no recibe avisos.",
};

/**
 * Los avisos push de este teléfono: su estado y cómo cambiarlo. El permiso
 * es del sistema operativo; la app solo puede pedirlo una vez, después se
 * cambia en los ajustes (revisión de QA-UX, 12/11/2026).
 */
function BloqueAvisos() {
  const [estado, setEstado] = useState(null);
  const [pidiendo, setPidiendo] = useState(false);
  const montado = useRef(true);

  const leer = useCallback(async () => {
    const valor = await estadoDelPermiso();
    if (montado.current) setEstado(valor);
  }, []);

  useEffect(() => {
    montado.current = true;
    leer();
    // Al volver de los ajustes del teléfono, el estado pudo cambiar.
    const suscripcion = AppState.addEventListener("change", (s) => {
      if (s === "active") leer();
    });
    return () => {
      montado.current = false;
      suscripcion.remove();
    };
  }, [leer]);

  async function activar() {
    setPidiendo(true);
    // La persona ya pidió activarlos: directo a la pregunta del sistema.
    await registrarDispositivo({ pedirPermiso: true, explicar: false });
    await leer();
    if (montado.current) setPidiendo(false);
  }

  return (
    <View style={estilos.bloque}>
      <Text style={estilos.subtitulo} accessibilityRole="header">
        Avisos en este teléfono
      </Text>
      {!estado && (
        // Mientras se consulta el permiso, el bloque ya ocupa su lugar y no
        // empuja «Cerrar sesión» al aparecer.
        <View
          style={estilos.fila}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Consultando el estado de los avisos…"
        >
          <ActivityIndicator color={colores.primario} />
          <Text style={estilos.texto}>Consultando el estado de los avisos…</Text>
        </View>
      )}
      {estado && <Text style={estilos.texto}>{TEXTOS_AVISOS[estado] ?? TEXTOS_AVISOS.sin_decidir}</Text>}
      {estado === "sin_decidir" && (
        <Boton titulo="Activar los avisos" icono="bell-ring-outline" cargando={pidiendo} onPress={activar} />
      )}
      {(estado === "activado" || estado === "denegado") && (
        <Boton
          titulo="Abrir los ajustes del teléfono"
          icono="cog-outline"
          variante="secundario"
          onPress={() => Linking.openSettings?.()}
        />
      )}
    </View>
  );
}

/**
 * La cuenta: quién está dentro, en qué empresa (con selector si tiene más de
 * una, CA-13), los avisos y «Cerrar sesión» (CA-4). La lista de empresas sale
 * de `/empresas/mias/`, lo mismo que el selector de la web: `/auth/me/` no la
 * trae.
 */
export function Cuenta() {
  const router = useRouter();
  const { usuario, empresas, empresaActiva, cambiarEmpresa } = useSesion();
  const { cerrando, confirmarCierre } = useCerrarSesion();
  const [cambiando, setCambiando] = useState(null);
  const [error, setError] = useState(null);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  async function elegir(empresa) {
    if (cambiando || String(empresa.id) === String(empresaActiva?.id)) return;
    setCambiando(empresa.id);
    setError(null);
    try {
      await cambiarEmpresa(empresa.id);
      anunciar(`Ahora trabaja en ${empresa.nombre}.`);
    } catch (e) {
      if (montado.current) setError(mensajeDeError(e, "No se pudo cambiar de empresa."));
    } finally {
      if (montado.current) setCambiando(null);
    }
  }

  const nombre = [usuario?.first_name, usuario?.last_name].filter(Boolean).join(" ") || usuario?.username;
  const unica = empresas[0] || empresaActiva;

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <View style={estilos.bloque}>
        <Text style={estilos.titulo} accessibilityRole="header">
          {nombre}
        </Text>
        {usuario?.email ? <Text style={estilos.texto}>{usuario.email}</Text> : null}
      </View>

      <View style={estilos.bloque}>
        <Text style={estilos.subtitulo} accessibilityRole="header">
          Empresa
        </Text>
        {empresas.length > 1 ? (
          <View accessibilityRole="radiogroup" accessibilityLabel="Empresa en la que trabaja" style={estilos.lista}>
            {empresas.map((empresa) => {
              const activa = String(empresa.id) === String(empresaActiva?.id);
              const esta = cambiando === empresa.id;
              return (
                <Pressable
                  key={empresa.id}
                  testID={`empresa-${empresa.id}`}
                  onPress={() => elegir(empresa)}
                  disabled={Boolean(cambiando)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: activa, busy: esta, disabled: Boolean(cambiando) }}
                  accessibilityLabel={conRol(empresa)}
                  style={[estilos.opcion, activa && estilos.opcionActiva, cambiando && !esta && estilos.opcionInactiva]}
                >
                  {esta ? (
                    <ActivityIndicator color={colores.primario} />
                  ) : (
                    <Icono
                      nombre={activa ? "radiobox-marked" : "radiobox-blank"}
                      size={22}
                      color={activa ? colores.primario : colores.tintaTenue}
                    />
                  )}
                  <Text style={estilos.opcionTexto}>{conRol(empresa)}</Text>
                </Pressable>
              );
            })}
            <Text style={estilos.ayuda}>
              El Inicio y las notificaciones muestran lo de la empresa elegida.
            </Text>
          </View>
        ) : (
          <Text style={estilos.texto}>{unica ? conRol(unica) : "—"}</Text>
        )}
        {error && <Alerta tipo="mal" texto={error} />}
      </View>

      {/* US-011: mi estado en el chat, el mismo de la web. */}
      <View style={estilos.bloque}>
        <Text style={estilos.subtitulo} accessibilityRole="header">
          Chat
        </Text>
        <ResumenMiEstado onAbrir={() => router.push("/chat/mi-estado")} />
      </View>

      <BloqueAvisos />

      <Boton
        titulo="Cerrar sesión"
        icono="logout"
        variante="secundario"
        cargando={cerrando}
        onPress={confirmarCierre}
      />
    </ScrollView>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 24 },
  bloque: { gap: 8 },
  titulo: { fontSize: 22, fontWeight: "700", color: colores.tinta },
  subtitulo: { fontSize: 18, fontWeight: "700", color: colores.tinta },
  texto: { fontSize: 16, color: colores.tintaSuave, flexShrink: 1 },
  ayuda: { fontSize: 14, color: colores.tintaTenue },
  lista: { gap: 8 },
  fila: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  opcion: { ...CONTROLES.opcion, padding: 12, borderRadius: 10 },
  opcionActiva: CONTROLES.opcionActiva,
  opcionInactiva: { opacity: 0.6 },
  opcionTexto: { ...CONTROLES.opcionTexto, flex: 1 },
});
