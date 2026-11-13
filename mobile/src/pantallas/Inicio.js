import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { inicioService } from "../api/servicios";
import { useChat } from "../chat/ChatContext";
import { textoSinLeer } from "../chat/formato";
import { Alerta, Cargando, ErrorConReintento, Vacio } from "../componentes/comunes";
import { Icono, nombreDeIcono } from "../componentes/Icono";
import { abrirEnNavegador, urlWeb } from "../navegador/enlaceWeb";
import { useContador } from "../notificaciones/ContadorContext";
import { useResumenPermisos } from "../permisos/ResumenPermisosContext";
import { useSesion } from "../sesion/SesionContext";
import { esDelEquipo, rutaDeAltaPropia } from "../soporte/formato";
import { useResumenSoporte } from "../soporte/ResumenSoporteContext";
import { AREA_TACTIL, colores } from "../tema/colores";
import { CarruselNoticias } from "./CarruselNoticias";
import { crearEstilos } from "../tema/tipografia";

export const TEXTO_SIN_CARGO = "Todavía no tiene un cargo asignado en el organigrama.";

/**
 * Los accesos «Para todos» de la web (`InicioInstitucional.jsx`, ACCESOS), con
 * sus rutas web. Los que ya están en la app llevan `rutaApp` y se abren
 * dentro de ella; los demás, en el navegador (CA-5 de US-009). Desde la
 * US-010 (12/11/2026): «Solicitud de permisos» y «Mis vacaciones». Desde la
 * US-011 (12/11/2026): «Chat» abre la pestaña. Desde la US-014 (13/11/2026):
 * «Soporte TI» pasa a «Mesa de ayuda», dentro de la app.
 */
export const ACCESOS = [
  {
    to: "/admin/ayuda",
    icono: "headset",
    nombre: "Mesa de ayuda",
    texto: "Pedir ayuda a TI y seguir sus tickets",
    rutaApp: { pathname: "/soporte", params: {} },
  },
  {
    to: "/admin/chat",
    icono: "chat-dots",
    nombre: "Chat",
    texto: "Canal general, mensajes directos y grupos",
    rutaApp: { pathname: "/chat", params: {} },
  },
  {
    to: "/admin/institucional/codigos",
    icono: "journal-text",
    nombre: "Códigos de conducta",
    texto: "Las normas de conducta y disciplinarias de la empresa",
  },
  {
    to: "/admin/institucional/permisos",
    icono: "calendar-check",
    nombre: "Solicitud de permisos",
    texto: "Pedir permisos y aprobar los que le toquen",
    rutaApp: { pathname: "/permisos", params: { seccion: "mias" } },
  },
  {
    to: "/admin/institucional/vacaciones",
    icono: "sun",
    nombre: "Mis vacaciones",
    texto: "Días pendientes de gozar, por período",
    rutaApp: { pathname: "/permisos", params: { seccion: "vacaciones" } },
  },
  { to: "/admin/perfil", icono: "person-vcard", nombre: "Mi perfil", texto: "Su información personal y su cargo" },
];

/**
 * «Para hoy» (auditoría UX, H-09): lo que espera a la persona, con su número y
 * el plural correcto. Solo lo que tiene algo; vacío, el bloque no se muestra.
 */
/**
 * N-15: el chat deja en la campana un aviso sin leer por conversación
 * (`chat.services.avisar`) y `/notificaciones/resumen/` solo da el total.
 * Para no contarlos dos veces, a los avisos se les restan las conversaciones
 * con algo sin leer. Es una aproximación: si la persona marcó leídos los
 * avisos en la campana pero no abrió el chat, el resultado puede quedar por
 * debajo (nunca negativo).
 */
export function avisosDeOtrosModulos(noLeidas, noLeidosChat = {}) {
  const conversaciones = Object.values(noLeidosChat).filter((n) => Number(n) > 0).length;
  return Math.max(0, (Number(noLeidas) || 0) - conversaciones);
}

export function pendientesDeHoy({
  porAprobar = 0,
  mensajes = 0,
  avisos = 0,
  ticketsAsignados = 0,
  ticketsMios = 0,
  ticketsPorAprobar = 0,
} = {}) {
  const lista = [];
  // US-014 (CA-2): la Mesa de ayuda, cada uno a su vista.
  if (ticketsAsignados > 0) {
    lista.push({
      clave: "soporte-asignados",
      icono: "headset",
      texto:
        ticketsAsignados === 1 ? "1 ticket asignado a usted" : `${ticketsAsignados} tickets asignados a usted`,
      ruta: { pathname: "/soporte", params: { vista: "bandeja" } },
    });
  }
  if (ticketsMios > 0) {
    lista.push({
      clave: "soporte-mios",
      icono: "ticket-outline",
      texto: ticketsMios === 1 ? "1 ticket suyo necesita algo de usted" : `${ticketsMios} tickets suyos necesitan algo de usted`,
      ruta: { pathname: "/soporte", params: { vista: "mis" } },
    });
  }
  if (ticketsPorAprobar > 0) {
    lista.push({
      clave: "soporte-aprobaciones",
      icono: "clipboard-check-outline",
      texto: ticketsPorAprobar === 1 ? "1 ticket por aprobar" : `${ticketsPorAprobar} tickets por aprobar`,
      ruta: { pathname: "/soporte", params: { vista: "aprobaciones" } },
    });
  }
  if (porAprobar > 0) {
    lista.push({
      clave: "por-aprobar",
      icono: "calendar-check-outline",
      texto: porAprobar === 1 ? "1 solicitud por aprobar" : `${porAprobar} solicitudes por aprobar`,
      ruta: { pathname: "/permisos", params: { seccion: "por_aprobar" } },
    });
  }
  if (mensajes > 0) {
    lista.push({
      clave: "mensajes",
      icono: "chat-processing-outline",
      texto: textoSinLeer(mensajes),
      ruta: { pathname: "/chat", params: {} },
    });
  }
  if (avisos > 0) {
    lista.push({
      clave: "avisos",
      icono: "bell-badge-outline",
      texto: avisos === 1 ? "1 aviso de otros módulos" : `${avisos} avisos de otros módulos`,
      ruta: { pathname: "/notificaciones", params: {} },
    });
  }
  return lista;
}

/** Sin permiso para crear tickets, la Mesa de ayuda sirve para seguir los
 * propios (decisión de la web, 09/11/2026); al equipo se le dice que ahí
 * atiende (US-014). */
export function accesosPara(permisos = []) {
  return ACCESOS.map((a) => {
    if (a.to !== "/admin/ayuda") return a;
    if (esDelEquipo(permisos)) return { ...a, texto: "Su bandeja, sus tickets y pedir ayuda a TI" };
    return rutaDeAltaPropia(permisos) ? a : { ...a, texto: "Seguir sus tickets" };
  });
}

export function Inicio() {
  const router = useRouter();
  const { usuario, empresaActiva, versionEmpresa } = useSesion();
  // El perfil solo adorna el saludo: mientras carga o si falla no se dice
  // «no tiene cargo», que sería falso (CA-5; auditoría UX web, 28/10/2026).
  const [perfil, setPerfil] = useState({ estado: "cargando", datos: null });
  const [noticias, setNoticias] = useState({ estado: "cargando", lista: [], segundos: 6 });
  const [avisoRefresco, setAvisoRefresco] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const montado = useRef(true);
  // Cada carga lleva un número: al cambiar de empresa, la respuesta de la
  // anterior ya no se pinta.
  const consulta = useRef(0);
  const estadoNoticias = useRef(noticias.estado);
  estadoNoticias.current = noticias.estado;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargarPerfil = useCallback(async (numero) => {
    try {
      const datos = await inicioService.misDatos();
      if (montado.current && numero === consulta.current) setPerfil({ estado: "listo", datos: datos ?? null });
    } catch {
      // Si falla se calla: el perfil solo adorna. Se conserva lo que hubiera.
      if (montado.current && numero === consulta.current) {
        setPerfil((p) => (p.estado === "listo" ? p : { estado: "error", datos: null }));
      }
    }
  }, []);

  /**
   * `silenciosa`: la del pull-to-refresh. No vuelve al «Cargando», para no
   * desmontar el carrusel (perdía la posición y la pausa), y si falla con
   * noticias ya cargadas las conserva y lo dice arriba.
   */
  const cargarNoticias = useCallback(async (numero, { silenciosa = false } = {}) => {
    if (!silenciosa) setNoticias((n) => ({ ...n, estado: "cargando" }));
    try {
      const [lista, ajustes] = await Promise.all([
        inicioService.noticias(),
        inicioService.carrusel().catch(() => null),
      ]);
      if (!montado.current || numero !== consulta.current) return;
      setNoticias({ estado: "listo", lista, segundos: Number(ajustes?.segundos) || 6 });
      setAvisoRefresco(null);
    } catch {
      if (!montado.current || numero !== consulta.current) return;
      if (silenciosa && estadoNoticias.current === "listo") {
        setAvisoRefresco("No se pudieron actualizar las noticias. Se muestran las anteriores.");
      } else {
        setNoticias((n) => ({ ...n, estado: "error" }));
      }
    }
  }, []);

  useEffect(() => {
    const numero = ++consulta.current;
    cargarPerfil(numero);
    cargarNoticias(numero);
  }, [cargarPerfil, cargarNoticias, versionEmpresa]);

  async function refrescar() {
    const numero = ++consulta.current;
    setRefrescando(true);
    await Promise.all([cargarPerfil(numero), cargarNoticias(numero, { silenciosa: true })]);
    if (montado.current) setRefrescando(false);
  }

  const nombre = usuario?.first_name || perfil.datos?.nombres || usuario?.username || "";
  const cargo = perfil.datos?.cargo?.nombre;
  const empresa = empresaActiva?.id;
  const { porAprobar } = useResumenPermisos();
  const { totalNoLeidos, noLeidos: noLeidosChat } = useChat();
  const { noLeidas } = useContador();
  const soporte = useResumenSoporte();
  const paraHoy = pendientesDeHoy({
    porAprobar,
    mensajes: totalNoLeidos,
    avisos: avisosDeOtrosModulos(noLeidas, noLeidosChat),
    ticketsAsignados: soporte.asignados,
    ticketsMios: soporte.misPendientes,
    ticketsPorAprobar: soporte.aprobaciones,
  });
  const accesos = accesosPara(usuario?.permissions);
  const enLaApp = accesos.filter((a) => a.rutaApp);
  const enElNavegador = accesos.filter((a) => !a.rutaApp);

  /** `n` cambia en cada toque: el mismo acceso vuelve a llevar a su sección
   * aunque se haya cambiado entretanto. */
  function irA(ruta) {
    router.push({ ...ruta, params: { ...ruta.params, n: String(Date.now()) } });
  }

  function abrirAcceso(a) {
    if (a.rutaApp) irA(a.rutaApp);
    else abrirEnNavegador(urlWeb(a.to, { empresa }));
  }

  return (
    <ScrollView
      testID="inicio"
      style={estilos.pantalla}
      contentContainerStyle={estilos.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    >
      <View style={estilos.saludo}>
        <Text style={estilos.titulo} accessibilityRole="header">
          {nombre ? `Hola, ${nombre}` : "Le damos la bienvenida"}
        </Text>
        {perfil.estado === "listo" &&
          (cargo ? (
            <Text style={estilos.cargo}>{`${cargo}.`}</Text>
          ) : (
            <Pressable
              onPress={() => abrirEnNavegador(urlWeb("/admin/perfil", { empresa }))}
              accessibilityRole="link"
              accessibilityHint="Se abre en el navegador"
              style={estilos.enlaceCargo}
            >
              <Text style={estilos.cargo}>
                {TEXTO_SIN_CARGO} <Text style={estilos.enlace}>Elegirlo en Mi perfil</Text>{" "}
                <Icono nombre="open-in-new" size={16} color={colores.primario} />
              </Text>
            </Pressable>
          ))}
      </View>

      {paraHoy.length > 0 ? (
        <View style={estilos.paraHoy} testID="para-hoy">
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Para hoy
          </Text>
          {paraHoy.map((p) => (
            <Pressable
              key={p.clave}
              testID={`para-hoy-${p.clave}`}
              onPress={() => irA(p.ruta)}
              accessibilityRole="button"
              accessibilityLabel={p.texto}
              style={({ pressed }) => [estilos.pendiente, pressed && estilos.presionada]}
            >
              <Icono nombre={p.icono} size={22} color={colores.primario} />
              <Text style={estilos.pendienteTexto}>{p.texto}</Text>
              <Icono nombre="chevron-right" size={22} color={colores.tintaTenue} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={estilos.seccion}>
        <Text style={estilos.subtitulo} accessibilityRole="header">
          Noticias y eventos
        </Text>
        {avisoRefresco && <Alerta tipo="aviso" texto={avisoRefresco} />}
        {noticias.estado === "cargando" ? (
          <Cargando texto="Cargando noticias…" />
        ) : noticias.estado === "error" ? (
          <ErrorConReintento
            texto="No se pudieron cargar las noticias."
            onReintentar={() => cargarNoticias(++consulta.current)}
          />
        ) : noticias.lista.length === 0 ? (
          <Vacio texto="No hay noticias publicadas por ahora." icono="newspaper-variant-outline" />
        ) : (
          <CarruselNoticias noticias={noticias.lista} segundos={noticias.segundos} />
        )}
      </View>

      {/* Los accesos, separados por dónde se abren (auditoría UX, H-09). */}
      {/* Un encabezado sin nada debajo no se pinta. */}
      {enLaApp.length > 0 ? (
        <View style={estilos.seccion}>
          <Text style={estilos.subtitulo} accessibilityRole="header">
            En la app
          </Text>
          {enLaApp.map((a) => (
            <Acceso key={a.to} a={a} onAbrir={abrirAcceso} />
          ))}
        </View>
      ) : null}

      {enElNavegador.length > 0 ? (
        <View style={estilos.seccion}>
          <View style={estilos.tituloNavegador}>
            <Text style={estilos.subtitulo} accessibilityRole="header">
              En el navegador
            </Text>
            <Icono nombre="open-in-new" size={18} color={colores.tintaSuave} />
          </View>
          <Text style={estilos.navegadorTexto}>Se abren en el navegador del teléfono.</Text>
          {enElNavegador.map((a) => (
            <Acceso key={a.to} a={a} onAbrir={abrirAcceso} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** Un acceso: dentro de la app (flecha) o en el navegador (ícono de salida). */
function Acceso({ a, onAbrir }) {
  return (
    <Pressable
      testID={`acceso-${a.to}`}
      onPress={() => onAbrir(a)}
      accessibilityRole={a.rutaApp ? "button" : "link"}
      accessibilityLabel={a.rutaApp ? `${a.nombre}. ${a.texto}` : `${a.nombre}. ${a.texto}. Abrir en el navegador`}
      style={({ pressed }) => [estilos.tarjeta, pressed && estilos.presionada]}
    >
      <View style={estilos.tarjetaIcono}>
        <Icono nombre={nombreDeIcono(a.icono)} size={24} color={colores.primario} />
      </View>
      <View style={estilos.tarjetaTexto}>
        <Text style={estilos.tarjetaNombre}>{a.nombre}</Text>
        <Text style={estilos.tarjetaDescripcion}>{a.texto}</Text>
      </View>
      <View style={estilos.flecha}>
        <Icono
          nombre={a.rutaApp ? "chevron-right" : "open-in-new"}
          size={a.rutaApp ? 24 : 20}
          color={colores.tintaTenue}
        />
      </View>
    </Pressable>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 20, paddingBottom: 32 },
  saludo: { gap: 4 },
  titulo: { fontSize: 24, fontWeight: "700", color: colores.tinta },
  cargo: { fontSize: 16, color: colores.tintaSuave },
  enlaceCargo: { minHeight: AREA_TACTIL, justifyContent: "center" },
  enlace: { color: colores.enlace, textDecorationLine: "underline" },
  seccion: { gap: 10 },
  subtitulo: { fontSize: 18, fontWeight: "700", color: colores.tinta },
  tarjeta: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    minHeight: AREA_TACTIL,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  presionada: { backgroundColor: colores.realce },
  tarjetaIcono: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colores.acento,
    alignItems: "center",
    justifyContent: "center",
  },
  tarjetaTexto: { flex: 1, gap: 2 },
  tarjetaNombre: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  tarjetaDescripcion: { fontSize: 14, color: colores.tintaSuave },
  navegadorTexto: { fontSize: 13, color: colores.tintaTenue, flexShrink: 1 },
  flecha: { justifyContent: "center" },
  tituloNavegador: { flexDirection: "row", alignItems: "center", gap: 8 },
  paraHoy: {
    gap: 6,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderLeftWidth: 4,
    borderLeftColor: colores.acento,
  },
  pendiente: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  pendienteTexto: { flex: 1, fontSize: 16, fontWeight: "600", color: colores.tinta },
});
