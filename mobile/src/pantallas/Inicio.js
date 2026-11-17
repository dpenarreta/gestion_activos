import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { inicioService } from "../api/servicios";
import {
  Alerta,
  Cargando,
  ErrorConReintento,
  Vacio,
} from "../componentes/comunes";
import { Refresco } from "../componentes/Refresco";
import { BotonRedondo } from "../componentes/BotonRedondo";
import { Icono, nombreDeIcono } from "../componentes/Icono";
import { abrirEnNavegador, urlWeb } from "../navegador/enlaceWeb";
import { useContador } from "../notificaciones/ContadorContext";
import { useSesion } from "../sesion/SesionContext";
import { esDelEquipo, rutaDeAltaPropia } from "../soporte/formato";
import { AREA_TACTIL } from "../tema/colores";
import { useApariencia, useEstilos } from "../tema/apariencia";
import { CalendarioInicio } from "./CalendarioInicio";
import { CarruselNoticias } from "./CarruselNoticias";
import { ParaHoy } from "./ParaHoy";
import { crearEstilos } from "../tema/tipografia";
import { diaEnZona } from "../matriz/formato";

/** Las pestañas del bloque de noticias de Inicio. */
export const PESTANAS_DE_INICIO = [
  {
    id: "noticias",
    nombre: "Noticias y eventos",
    icono: "newspaper-variant-outline",
  },
  {
    id: "calendario",
    nombre: "Calendario de eventos",
    icono: "calendar-month-outline",
  },
];

export const TEXTO_SIN_CARGO =
  "Todavía no tiene un cargo asignado en el organigrama.";

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
    familia: "soporte",
    icono: "headset",
    nombre: "Mesa de ayuda",
    texto: "Pedir ayuda a TI y seguir sus tickets",
    rutaApp: { pathname: "/soporte", params: {} },
  },
  {
    to: "/admin/chat",
    familia: "chat",
    icono: "chat-dots",
    nombre: "Chat",
    texto: "Canal general, mensajes directos y grupos",
    rutaApp: { pathname: "/chat", params: {} },
  },
  {
    to: "/admin/institucional/codigos",
    familia: "institucional",
    icono: "journal-text",
    nombre: "Códigos de conducta",
    texto: "Las normas de conducta y disciplinarias de la empresa",
  },
  {
    to: "/admin/institucional/permisos",
    familia: "permisos",
    icono: "calendar-check",
    nombre: "Solicitud de permisos",
    texto: "Pedir permisos y aprobar los que le toquen",
    rutaApp: { pathname: "/permisos", params: { seccion: "mias" } },
  },
  {
    to: "/admin/institucional/vacaciones",
    familia: "vacaciones",
    icono: "sun",
    nombre: "Mis vacaciones",
    texto: "Días pendientes de gozar, por período",
    rutaApp: { pathname: "/permisos", params: { seccion: "vacaciones" } },
  },
  {
    to: "/admin/perfil",
    familia: "perfil",
    icono: "person-vcard",
    nombre: "Mi perfil",
    texto: "Su información personal y su cargo",
    rutaApp: { pathname: "/cuenta", params: {} },
  },
];

/** Sin permiso para crear tickets, la Mesa de ayuda sirve para seguir los
 * propios (decisión de la web, 09/11/2026); al equipo se le dice que ahí
 * atiende (US-014). */
export function accesosPara(permisos = []) {
  return ACCESOS.map((a) => {
    if (a.to !== "/admin/ayuda") return a;
    if (esDelEquipo(permisos))
      return { ...a, texto: "Su bandeja, sus tickets y pedir ayuda a TI" };
    return rutaDeAltaPropia(permisos)
      ? a
      : { ...a, texto: "Seguir sus tickets" };
  });
}

export function Inicio() {
  const { colores } = useApariencia();
  const estilos = useEstilos(fabricaDeEstilos);
  const router = useRouter();
  const { usuario, empresaActiva, versionEmpresa } = useSesion();
  const { recargar: recargarContador } = useContador();
  // El perfil solo adorna el saludo: mientras carga o si falla no se dice
  // «no tiene cargo», que sería falso (CA-5; auditoría UX web, 28/10/2026).
  const [perfil, setPerfil] = useState({ estado: "cargando", datos: null });
  const [noticias, setNoticias] = useState({
    estado: "cargando",
    lista: [],
    segundos: 6,
  });
  const [avisoRefresco, setAvisoRefresco] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  // Sube con cada pull-to-refresh: el calendario se vuelve a pedir.
  const [recarga, setRecarga] = useState(0);
  const [pestana, setPestana] = useState("noticias");
  const [hayHoy, setHayHoy] = useState(false);
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
      if (montado.current && numero === consulta.current)
        setPerfil({ estado: "listo", datos: datos ?? null });
    } catch {
      // Si falla se calla: el perfil solo adorna. Se conserva lo que hubiera.
      if (montado.current && numero === consulta.current) {
        setPerfil((p) =>
          p.estado === "listo" ? p : { estado: "error", datos: null },
        );
      }
    }
  }, []);

  /**
   * `silenciosa`: la del pull-to-refresh. No vuelve al «Cargando», para no
   * desmontar el carrusel (perdía la posición y la pausa), y si falla con
   * noticias ya cargadas las conserva y lo dice arriba.
   */
  const cargarNoticias = useCallback(
    async (numero, { silenciosa = false } = {}) => {
      if (!silenciosa) setNoticias((n) => ({ ...n, estado: "cargando" }));
      try {
        const [lista, ajustes] = await Promise.all([
          inicioService.noticias(),
          inicioService.carrusel().catch(() => null),
        ]);
        if (!montado.current || numero !== consulta.current) return;
        setNoticias({
          estado: "listo",
          lista,
          segundos: Number(ajustes?.segundos) || 6,
        });
        setAvisoRefresco(null);
      } catch {
        if (!montado.current || numero !== consulta.current) return;
        if (silenciosa && estadoNoticias.current === "listo") {
          setAvisoRefresco(
            "No se pudieron actualizar las noticias. Se muestran las anteriores.",
          );
        } else {
          setNoticias((n) => ({ ...n, estado: "error" }));
        }
      }
    },
    [],
  );

  /** El punto amarillo de la pestaña «Calendario de eventos» (16/11/2026,
   * a pedido del usuario): si hoy (en hora de Ecuador) hay alguna fecha en
   * el calendario. Si falla, simplemente no se muestra. */
  const cargarHoy = useCallback(async (numero) => {
    try {
      const hoy = diaEnZona(new Date(), "America/Guayaquil");
      const lista = await inicioService.calendario(hoy, hoy);
      if (montado.current && numero === consulta.current)
        setHayHoy(lista.length > 0);
    } catch {
      // Se conserva lo que hubiera.
    }
  }, []);

  useEffect(() => {
    const numero = ++consulta.current;
    cargarPerfil(numero);
    cargarNoticias(numero);
    cargarHoy(numero);
  }, [cargarPerfil, cargarNoticias, cargarHoy, versionEmpresa]);

  async function refrescar() {
    const numero = ++consulta.current;
    setRefrescando(true);
    setRecarga((r) => r + 1);
    // QA (17/11/2026): también el contador de la campana, que «Para hoy»
    // usa mientras carga.
    await Promise.all([
      cargarPerfil(numero),
      cargarNoticias(numero, { silenciosa: true }),
      cargarHoy(numero),
      Promise.resolve(recargarContador?.()).catch(() => {}),
    ]);
    if (montado.current) setRefrescando(false);
  }

  const nombre =
    usuario?.first_name || perfil.datos?.nombres || usuario?.username || "";
  const cargo = perfil.datos?.cargo?.nombre;
  const empresa = empresaActiva?.id;
  // Con letra grande (más del 130 %) los nombres no entran en 4 columnas.
  const { fontScale } = useWindowDimensions();
  const columnas = fontScale > 1.3 ? 3 : 4;
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
      refreshControl={
        <Refresco refreshing={refrescando} onRefresh={refrescar} />
      }
    >
      <View style={estilos.saludo}>
        <Text style={estilos.titulo} accessibilityRole="header">
          {nombre ? `Hola, ${nombre}` : "Le damos la bienvenida"}
        </Text>
        {perfil.estado === "listo" &&
          (cargo ? (
            <Text style={estilos.cargo}>{`${cargo}.`}</Text>
          ) : (
            // Sale de la app: botón redondo con su marca (16/11/2026).
            <>
              <Text style={estilos.cargo}>{TEXTO_SIN_CARGO}</Text>
              <BotonRedondo
                testID="elegir-cargo"
                icono="account-edit-outline"
                nombre="Elegir mi cargo"
                familia="perfil"
                navegador
                etiqueta="Elegir mi cargo en Mi perfil. Abrir en el navegador"
                onPress={() =>
                  abrirEnNavegador(urlWeb("/admin/perfil", { empresa }))
                }
              />
            </>
          ))}
      </View>

      {/* US-027 (17/11/2026): contraído, con los avisos sin leer de la
          campana; reemplaza las líneas agrupadas de antes. */}
      <ParaHoy recarga={recarga} version={versionEmpresa} />

      {/* Noticias y calendario como pestañas (16/11/2026, a pedido del
          usuario): se ve uno a la vez para ahorrar espacio. Al cambiar, el
          carrusel se desmonta y no sigue pasando noticias sin verse. */}
      <View style={estilos.seccion}>
        <View style={estilos.pestanas} accessibilityRole="tablist">
          {PESTANAS_DE_INICIO.map((p) => {
            const activa = pestana === p.id;
            const conPunto = p.id === "calendario" && hayHoy;
            return (
              <Pressable
                key={p.id}
                testID={`inicio-pestana-${p.id}`}
                onPress={() => setPestana(p.id)}
                accessibilityRole="tab"
                accessibilityLabel={
                  conPunto ? `${p.nombre}, hay fechas hoy` : p.nombre
                }
                accessibilityState={{ selected: activa }}
                style={({ pressed }) => [
                  estilos.pestana,
                  activa && estilos.pestanaActiva,
                  pressed && estilos.presionada,
                ]}
              >
                <View>
                  <Icono
                    nombre={p.icono}
                    size={20}
                    color={activa ? colores.tinta : colores.tintaTenue}
                  />
                  {conPunto ? (
                    <View
                      style={estilos.punto}
                      testID="inicio-punto-calendario"
                    />
                  ) : null}
                </View>
                <Text
                  style={[
                    estilos.pestanaTexto,
                    activa && estilos.pestanaTextoActiva,
                  ]}
                >
                  {p.nombre}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {pestana === "noticias" ? (
          <>
            {avisoRefresco && <Alerta tipo="aviso" texto={avisoRefresco} />}
            {noticias.estado === "cargando" ? (
              <Cargando texto="Cargando noticias…" />
            ) : noticias.estado === "error" ? (
              <ErrorConReintento
                texto="No se pudieron cargar las noticias."
                onReintentar={() => cargarNoticias(++consulta.current)}
              />
            ) : noticias.lista.length === 0 ? (
              <Vacio
                texto="No hay noticias publicadas por ahora."
                icono="newspaper-variant-outline"
              />
            ) : (
              <CarruselNoticias
                noticias={noticias.lista}
                segundos={noticias.segundos}
              />
            )}
          </>
        ) : (
          <CalendarioInicio recarga={recarga} version={versionEmpresa} />
        )}
      </View>

      {/* Los accesos, separados por dónde se abren (auditoría UX, H-09). */}
      {/* Un encabezado sin nada debajo no se pinta. */}
      {/* Los accesos, separados por dónde se abren (auditoría UX, H-09), y
          desde el 16/11/2026, a pedido del usuario, como botones redondos en
          cuadrícula y no tarjetas a todo el ancho. Cada sección dice en una
          línea dónde se abre. Un encabezado sin nada debajo no se pinta. */}
      {enLaApp.length > 0 ? (
        <View style={estilos.seccion}>
          <Text style={estilos.subtitulo} accessibilityRole="header">
            En la app
          </Text>
          <Text style={estilos.ayudaTexto}>
            Se abren aquí mismo, dentro de la app.
          </Text>
          <View style={estilos.cuadricula}>
            {enLaApp.map((a) => (
              <Acceso
                key={a.to}
                a={a}
                onAbrir={abrirAcceso}
                columnas={columnas}
              />
            ))}
          </View>
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
          <Text style={estilos.ayudaTexto}>
            Se abren en el navegador del teléfono.
          </Text>
          <View style={estilos.cuadricula}>
            {enElNavegador.map((a) => (
              <Acceso
                key={a.to}
                a={a}
                onAbrir={abrirAcceso}
                columnas={columnas}
              />
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

/** Un acceso como botón redondo: el ícono en un círculo amarillo y el
 * nombre debajo. La descripción no se ve, pero la dice el lector de pantalla.
 * Los del navegador llevan una marca de «sale de la app» en el círculo. */
function Acceso({ a, onAbrir, columnas = 4 }) {
  const enApp = Boolean(a.rutaApp);
  // El color de su módulo (16/11/2026); los del navegador se distinguen por
  // la marca de «sale de la app» (`BotonRedondo`).
  return (
    <BotonRedondo
      testID={`acceso-${a.to}`}
      icono={nombreDeIcono(a.icono)}
      nombre={a.nombre}
      familia={a.familia}
      navegador={!enApp}
      etiqueta={enApp ? `${a.nombre}. ${a.texto}` : `${a.nombre}. ${a.texto}. Abrir en el navegador`}
      ancho={`${100 / columnas}%`}
      onPress={() => onAbrir(a)}
    />
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 20, paddingBottom: 32 },
  saludo: { gap: 4 },
  titulo: { fontSize: 24, fontWeight: "700", color: colores.tinta },
  cargo: { fontSize: 16, color: colores.tintaSuave },
  seccion: { gap: 10 },
  subtitulo: { fontSize: 18, fontWeight: "700", color: colores.tinta },
  presionada: { backgroundColor: colores.realce },
  ayudaTexto: { fontSize: 14, color: colores.tintaTenue, flexShrink: 1 },
  cuadricula: { flexDirection: "row", flexWrap: "wrap", rowGap: 12 },
  tituloNavegador: { flexDirection: "row", alignItems: "center", gap: 8 },
  pestanas: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colores.borde,
  },
  pestana: {
    flex: 1,
    minHeight: AREA_TACTIL,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  // Amarillo de la marca con borde negro: sobre el gris claro el amarillo
  // solo no llega al 3:1 que pide un elemento gráfico (WCAG 1.4.11).
  punto: {
    position: "absolute",
    top: -3,
    right: -7,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colores.acento,
    borderWidth: 1.5,
    borderColor: colores.marcaNegro,
  },
  pestanaActiva: { borderBottomColor: colores.acento },
  pestanaTexto: {
    fontSize: 15,
    fontWeight: "600",
    color: colores.tintaTenue,
    textAlign: "center",
    flexShrink: 1,
  },
  pestanaTextoActiva: { fontWeight: "700", color: colores.tinta },
});
