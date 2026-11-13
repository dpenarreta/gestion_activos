import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { anunciar } from "../accesibilidad/anunciar";
import { mensajeDeError } from "../api/errores";
import { notificacionesService } from "../api/servicios";
import { Alerta, BotonIcono, Cargando, ErrorConReintento, Vacio } from "../componentes/comunes";
import { Icono } from "../componentes/Icono";
import { volverAlModulo } from "../navegacion/abrir";
import { esRutaDeModulo } from "../navegacion/modulos";
import { destinoDeNotificacion, estaLeida, iconoDe } from "../notificaciones/abrir";
import { useContador } from "../notificaciones/ContadorContext";
import { rutaEnApp } from "../notificaciones/modulosEnApp";
import { useSesion } from "../sesion/SesionContext";
import { AREA_TACTIL, colores } from "../tema/colores";
import { CONTROLES } from "../tema/controles";
import { claveDeDia, grupoDeFecha, haceCuanto } from "../utils/fechas";
import { useMedianoche } from "../utils/useMedianoche";
import { crearEstilos } from "../tema/tipografia";

/**
 * Las notificaciones de la campana (CA-6): las mismas que en la web, de la más
 * reciente a la más antigua, paginadas con scroll infinito y pull-to-refresh,
 * con filtro «No leídas» y «Marcar todas como leídas».
 */
export const TEXTO_TODAS_LEIDAS = "Todas las notificaciones quedaron como leídas.";

/**
 * Las filas de la lista con un encabezado «Hoy», «Ayer» o «Anteriores» antes
 * del primer aviso de cada grupo (auditoría UX, H-23). Llegan de la más
 * reciente a la más antigua, así que cada grupo aparece una vez.
 */
export function agruparPorDia(notificaciones, ahora = new Date()) {
  const filas = [];
  let actual = null;
  for (const n of notificaciones) {
    const grupo = grupoDeFecha(n.created_at, ahora);
    if (grupo !== actual) {
      actual = grupo;
      filas.push({ clave: `grupo-${grupo}`, encabezado: grupo });
    }
    filas.push({ clave: String(n.id), notificacion: n });
  }
  return filas;
}

export function ListaNotificaciones({ mapa } = {}) {
  const router = useRouter();
  const { versionEmpresa } = useSesion();
  const { noLeidas, recargar: recargarContador } = useContador();
  const [soloNoLeidas, setSoloNoLeidas] = useState(false);
  const [items, setItems] = useState([]);
  const [estado, setEstado] = useState("cargando"); // cargando | listo | error
  const [error, setError] = useState(null);
  const [siguiente, setSiguiente] = useState(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [marcando, setMarcando] = useState(false);
  // `{texto, clave}`: la clave cambia en cada aviso para volver a
  // anunciarlo aunque el texto se repita.
  const [avisoAccion, setAviso] = useState(null);
  const claveAviso = useRef(0);
  const setAvisoAccion = useCallback((texto) => {
    setAviso(texto ? { texto, clave: ++claveAviso.current } : null);
  }, []);
  // Cada carga lleva un número: si cambia el filtro o la empresa mientras
  // viaja, su respuesta ya no se pinta.
  const consulta = useRef(0);
  const montado = useRef(true);
  const [errorMas, setErrorMas] = useState(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(
    async ({ refrescar = false } = {}) => {
      const numero = ++consulta.current;
      // El aviso de la carga anterior se va: si esta sale bien no queda nada
      // que decir, y si falla otra vez se vuelve a anunciar.
      setAvisoAccion(null);
      if (refrescar) setRefrescando(true);
      else setEstado("cargando");
      try {
        const datos = await notificacionesService.listar({ pagina: 1, soloNoLeidas });
        if (!montado.current || numero !== consulta.current) return;
        setItems(Array.isArray(datos?.results) ? datos.results : []);
        setSiguiente(datos?.next ? 2 : null);
        setEstado("listo");
        setError(null);
        setErrorMas(null);
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        if (refrescar && estadoRef.current === "listo" && itemsRef.current.length > 0) {
          // Con la lista ya a la vista, un refresco fallido no la borra: se
          // conserva y se dice arriba (revisión de QA-UX, 12/11/2026).
          setAvisoAccion(
            mensajeDeError(e, "No se pudieron actualizar las notificaciones.") +
              " Se muestran las anteriores.",
          );
        } else {
          setError(mensajeDeError(e, "No se pudieron cargar las notificaciones."));
          setEstado("error");
        }
      } finally {
        if (montado.current && numero === consulta.current) setRefrescando(false);
      }
    },
    [soloNoLeidas],
  );

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  // Al volver a la pestaña (por ejemplo, desde el detalle) se refresca sin
  // tapar la lista con el «Cargando».
  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      cargar({ refrescar: true });
      recargarContador();
    }, [cargar, recargarContador]),
  );

  /** `reintento`: el botón del pie. El scroll no reintenta solo tras un fallo,
   * para no repetir la petición en bucle. */
  async function cargarMas({ reintento = false } = {}) {
    if (!siguiente || cargandoMas || estado !== "listo") return;
    if (errorMas && !reintento) return;
    const numero = consulta.current;
    setErrorMas(null);
    setCargandoMas(true);
    try {
      const datos = await notificacionesService.listar({ pagina: siguiente, soloNoLeidas });
      if (!montado.current || numero !== consulta.current) return;
      const nuevos = Array.isArray(datos?.results) ? datos.results : [];
      setItems((actuales) => {
        const vistos = new Set(actuales.map((n) => n.id));
        return [...actuales, ...nuevos.filter((n) => !vistos.has(n.id))];
      });
      setSiguiente(datos?.next ? siguiente + 1 : null);
    } catch (e) {
      if (montado.current) setErrorMas(mensajeDeError(e, "No se pudieron cargar más notificaciones."));
    } finally {
      if (montado.current) setCargandoMas(false);
    }
  }

  async function marcarTodas() {
    setMarcando(true);
    setAvisoAccion(null);
    try {
      await notificacionesService.leerTodas();
      anunciar(TEXTO_TODAS_LEIDAS);
      await Promise.all([cargar({ refrescar: true }), recargarContador()]);
    } catch (e) {
      if (montado.current) setAvisoAccion(mensajeDeError(e));
    } finally {
      if (montado.current) setMarcando(false);
    }
  }

  async function abrir(notificacion) {
    if (!estaLeida(notificacion)) {
      // Se ve leída enseguida; el detalle (o aquí, si va a otra pantalla de
      // la app) la marca en el servidor.
      setItems((actuales) =>
        actuales.map((n) => (n.id === notificacion.id ? { ...n, leida: true } : n)),
      );
      if (rutaEnApp(notificacion, mapa)) {
        notificacionesService
          .leer(notificacion.id)
          .then(() => recargarContador())
          .catch(() => {});
      }
    }
    const destino = destinoDeNotificacion(notificacion, mapa);
    // US-016: Avisos es una pantalla del Stack; lo que lleva a un módulo
    // vuelve a los de debajo en lugar de apilar otra copia.
    if (esRutaDeModulo(destino)) volverAlModulo(router, destino);
    else router.push(destino);
  }

  // El día de hoy en las dependencias: tras la medianoche, el siguiente
  // render (o refresco) pasa «Hoy» a «Ayer» (B4).
  // O3: a las 00:00:05 se vuelve a dibujar aunque no llegue nada.
  const tic = useMedianoche();
  const hoy = claveDeDia(new Date());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filas = useMemo(() => agruparPorDia(items), [items, hoy, tic]);

  // Una sola fila: «Mostrar», las píldoras y «Marcar todas» como ícono; con
  // la letra grande, baja de línea (auditoría UX, H-11). «Mostrar» sigue a la
  // vista (decisión del usuario).
  const cabecera = (
    <View style={estilos.cabecera}>
      <View style={estilos.filaCabecera}>
        {/* La pregunta se ve y se lee (revisión UX, ronda 2). */}
        <Text style={estilos.pregunta} accessibilityRole="header">
          Mostrar
        </Text>
        <View style={estilos.filtros} accessibilityRole="radiogroup" accessibilityLabel="Mostrar">
          {[
            { valor: false, texto: "Todas" },
            { valor: true, texto: "No leídas" },
          ].map((opcion) => {
            const activa = soloNoLeidas === opcion.valor;
            return (
              <Pressable
                key={opcion.texto}
                onPress={() => setSoloNoLeidas(opcion.valor)}
                accessibilityRole="radio"
                accessibilityState={{ checked: activa }}
                accessibilityHint="Mostrar"
                style={[estilos.chip, activa && estilos.chipActivo]}
              >
                <Text style={[estilos.chipTexto, activa && estilos.chipTextoActivo]}>{opcion.texto}</Text>
              </Pressable>
            );
          })}
        </View>
        {noLeidas > 0 && (
          <View style={estilos.marcarTodas}>
            <BotonIcono
              testID="marcar-todas"
              icono="check-all"
              etiqueta="Marcar todas como leídas"
              variante="contorno"
              cargando={marcando}
              onPress={marcarTodas}
            />
          </View>
        )}
      </View>
      {avisoAccion && <Alerta texto={avisoAccion.texto} clave={avisoAccion.clave} tipo="mal" />}
    </View>
  );

  let cuerpoVacio = null;
  if (estado === "cargando") cuerpoVacio = <Cargando texto="Cargando notificaciones…" />;
  else if (estado === "error") cuerpoVacio = <ErrorConReintento texto={error} onReintentar={() => cargar()} />;
  else
    cuerpoVacio = (
      <Vacio
        icono="bell-off-outline"
        texto={soloNoLeidas ? "No tiene notificaciones sin leer." : "No tiene notificaciones."}
      />
    );

  return (
    <FlatList
      testID="lista-notificaciones"
      style={estilos.pantalla}
      contentContainerStyle={estilos.contenido}
      data={estado === "listo" ? filas : []}
      keyExtractor={(f) => f.clave}
      ListHeaderComponent={cabecera}
      ListEmptyComponent={cuerpoVacio}
      ListFooterComponent={
        cargandoMas ? (
          <View
            style={estilos.pie}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Cargando más notificaciones…"
          >
            <ActivityIndicator color={colores.primario} />
          </View>
        ) : errorMas ? (
          <View style={estilos.pie}>
            <ErrorConReintento texto={errorMas} onReintentar={() => cargarMas({ reintento: true })} />
          </View>
        ) : null
      }
      renderItem={({ item }) =>
        item.encabezado ? (
          <Text style={estilos.grupo} accessibilityRole="header" testID={item.clave}>
            {item.encabezado}
          </Text>
        ) : (
          <ElementoNotificacion notificacion={item.notificacion} onAbrir={abrir} />
        )
      }
      onEndReached={() => cargarMas()}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={refrescando}
          onRefresh={() => {
            cargar({ refrescar: true });
            recargarContador();
          }}
        />
      }
    />
  );
}

export function ElementoNotificacion({ notificacion, onAbrir }) {
  const leida = estaLeida(notificacion);
  const fecha = haceCuanto(notificacion.created_at);
  const etiqueta = [
    leida ? null : "Sin leer",
    notificacion.modulo_nombre,
    notificacion.titulo,
    notificacion.resumen,
    fecha,
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <Pressable
      testID={`notificacion-${notificacion.id}`}
      onPress={() => onAbrir(notificacion)}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityHint="Abre el detalle"
      style={({ pressed }) => [estilos.item, !leida && estilos.itemNuevo, pressed && estilos.presionado]}
    >
      <View style={estilos.icono}>
        <Icono bootstrap={iconoDe(notificacion)} size={22} color={colores.primario} />
      </View>
      <View style={estilos.texto}>
        <Text style={estilos.modulo}>{notificacion.modulo_nombre}</Text>
        <Text style={[estilos.titulo, !leida && estilos.tituloNuevo]}>{notificacion.titulo}</Text>
        {notificacion.resumen ? <Text style={estilos.resumen}>{notificacion.resumen}</Text> : null}
        <Text style={estilos.fecha}>{fecha}</Text>
      </View>
      {!leida && <View style={estilos.punto} />}
    </Pressable>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 8, flexGrow: 1 },
  cabecera: { gap: 12, marginBottom: 8 },
  filaCabecera: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  pregunta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  filtros: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  marcarTodas: { marginLeft: "auto" },
  chip: { ...CONTROLES.pildora, paddingHorizontal: 16 },
  chipActivo: CONTROLES.pildoraActiva,
  chipTexto: { ...CONTROLES.pildoraTexto, fontWeight: "400" },
  chipTextoActivo: { ...CONTROLES.pildoraTextoActivo, fontWeight: "600" },
  grupo: { fontSize: 14, fontWeight: "700", color: colores.tintaSuave, marginTop: 8 },
  item: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    minHeight: AREA_TACTIL,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  itemNuevo: { borderColor: colores.primario, backgroundColor: colores.realce },
  presionado: { opacity: 0.85 },
  icono: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colores.acento,
    alignItems: "center",
    justifyContent: "center",
  },
  texto: { flex: 1, gap: 2 },
  modulo: { fontSize: 13, color: colores.tintaTenue },
  titulo: { fontSize: 16, color: colores.tinta },
  tituloNuevo: { fontWeight: "700" },
  resumen: { fontSize: 14, color: colores.tintaSuave },
  fecha: { fontSize: 13, color: colores.tintaTenue },
  punto: { width: 10, height: 10, borderRadius: 5, backgroundColor: colores.primario, marginTop: 6 },
  pie: { padding: 16 },
});
