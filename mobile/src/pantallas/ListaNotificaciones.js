import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";

import { anunciar } from "../accesibilidad/anunciar";
import { mensajeDeError } from "../api/errores";
import { notificacionesService } from "../api/servicios";
import {
  Alerta,
  Cargando,
  ErrorConReintento,
  Vacio,
} from "../componentes/comunes";
import { Refresco } from "../componentes/Refresco";
import { Icono } from "../componentes/Icono";
import { estaLeida, iconoDe } from "../notificaciones/abrir";
import { abrirNotificacion } from "../notificaciones/abrirNotificacion";
import { coloresDe } from "../notificaciones/coloresDeModulo";
import { useContador } from "../notificaciones/ContadorContext";
import { useSesion } from "../sesion/SesionContext";
import { AREA_TACTIL } from "../tema/colores";
import { useApariencia, useColores, useEstilos } from "../tema/apariencia";
import {
  claveDeDia,
  fechaCompleta,
  grupoDeFecha,
  haceCuantoLlego,
} from "../utils/fechas";
import { useMedianoche } from "../utils/useMedianoche";
import { crearEstilos } from "../tema/tipografia";
import { useRellenoDeLaBurbuja } from "../navegacion/BurbujaDeSoporte";

/**
 * Las notificaciones de la campana (CA-6): las mismas que en la web, de la más
 * reciente a la más antigua, paginadas con scroll infinito y pull-to-refresh,
 * con filtro «No leídas» y «Marcar todas como leídas».
 */
export const TEXTO_TODAS_LEIDAS =
  "Todas las notificaciones quedaron como leídas.";

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
  // US-029: lo último no queda bajo la burbuja de soporte.
  const rellenoBurbuja = useRellenoDeLaBurbuja();
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
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
        const datos = await notificacionesService.listar({
          pagina: 1,
          soloNoLeidas,
        });
        if (!montado.current || numero !== consulta.current) return;
        setItems(Array.isArray(datos?.results) ? datos.results : []);
        setSiguiente(datos?.next ? 2 : null);
        setEstado("listo");
        setError(null);
        setErrorMas(null);
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        if (
          refrescar &&
          estadoRef.current === "listo" &&
          itemsRef.current.length > 0
        ) {
          // Con la lista ya a la vista, un refresco fallido no la borra: se
          // conserva y se dice arriba (revisión de QA-UX, 12/11/2026).
          setAvisoAccion(
            mensajeDeError(e, "No se pudieron actualizar las notificaciones.") +
              " Se muestran las anteriores.",
          );
        } else {
          setError(
            mensajeDeError(e, "No se pudieron cargar las notificaciones."),
          );
          setEstado("error");
        }
      } finally {
        if (montado.current && numero === consulta.current)
          setRefrescando(false);
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
      const datos = await notificacionesService.listar({
        pagina: siguiente,
        soloNoLeidas,
      });
      if (!montado.current || numero !== consulta.current) return;
      const nuevos = Array.isArray(datos?.results) ? datos.results : [];
      setItems((actuales) => {
        const vistos = new Set(actuales.map((n) => n.id));
        return [...actuales, ...nuevos.filter((n) => !vistos.has(n.id))];
      });
      setSiguiente(datos?.next ? siguiente + 1 : null);
    } catch (e) {
      if (montado.current)
        setErrorMas(
          mensajeDeError(e, "No se pudieron cargar más notificaciones."),
        );
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

  // US-027 (17/11/2026): la misma lógica que «Para hoy» del Inicio. Se ve
  // leída enseguida; el detalle (o `abrirNotificacion`, si va a otra
  // pantalla de la app) la marca en el servidor.
  function abrir(notificacion) {
    abrirNotificacion({
      notificacion,
      router,
      mapa,
      recargarContador,
      alMarcarLeida: () =>
        setItems((actuales) =>
          actuales.map((n) =>
            n.id === notificacion.id ? { ...n, leida: true } : n,
          ),
        ),
    });
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
        {/* Sin el texto «Mostrar» (16/11/2026, a pedido del usuario, para
            ganar espacio): el lector lo sigue diciendo, es el nombre del
            grupo de filtros. */}
        <View
          style={estilos.filtros}
          accessibilityRole="radiogroup"
          accessibilityLabel="Mostrar"
        >
          {[
            { valor: false, texto: "Todas" },
            { valor: true, texto: "No leídas" },
          ].map((opcion) => {
            const activa = soloNoLeidas === opcion.valor;
            // «No leídas» con su contador encima, como un punto con número
            // (16/11/2026, a pedido del usuario).
            const cuenta = opcion.valor ? noLeidas : 0;
            return (
              <Pressable
                key={opcion.texto}
                onPress={() => setSoloNoLeidas(opcion.valor)}
                accessibilityRole="radio"
                accessibilityLabel={
                  cuenta > 0
                    ? `${opcion.texto}, ${cuenta} sin leer`
                    : opcion.texto
                }
                accessibilityState={{ checked: activa }}
                accessibilityHint="Mostrar"
                style={[estilos.chip, activa && estilos.chipActivo]}
              >
                <Text
                  style={[estilos.chipTexto, activa && estilos.chipTextoActivo]}
                >
                  {opcion.texto}
                </Text>
                {cuenta > 0 ? (
                  <View style={estilos.contador} testID="contador-no-leidas">
                    <Text style={estilos.contadorTexto}>
                      {cuenta > 99 ? "99+" : cuenta}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        {noLeidas > 0 && (
          <View style={estilos.marcarTodas}>
            {/* Con texto visible y sin ícono, del tamaño de las píldoras,
                para que los 3 entren en una línea (16/11/2026, a pedido del
                usuario). Si no cabe, el texto pasa a 2 líneas. */}
            <Pressable
              testID="marcar-todas"
              onPress={marcarTodas}
              disabled={marcando}
              accessibilityRole="button"
              accessibilityLabel="Marcar todo como leído"
              accessibilityState={{ disabled: marcando, busy: marcando }}
              style={({ pressed }) => [
                estilos.chip,
                estilos.chipMarcar,
                marcando && estilos.inactivo,
                pressed && estilos.presionado,
              ]}
            >
              {marcando ? (
                <ActivityIndicator size="small" color={colores.primario} />
              ) : null}
              <Text style={[estilos.chipTexto, estilos.chipMarcarTexto]}>
                Marcar todo como leído
              </Text>
            </Pressable>
          </View>
        )}
      </View>
      {avisoAccion && (
        <Alerta
          texto={avisoAccion.texto}
          clave={avisoAccion.clave}
          tipo="mal"
        />
      )}
    </View>
  );

  let cuerpoVacio = null;
  if (estado === "cargando")
    cuerpoVacio = <Cargando texto="Cargando notificaciones…" />;
  else if (estado === "error")
    cuerpoVacio = (
      <ErrorConReintento texto={error} onReintentar={() => cargar()} />
    );
  else
    cuerpoVacio = (
      <Vacio
        icono="bell-off-outline"
        texto={
          soloNoLeidas
            ? "No tiene notificaciones sin leer."
            : "No tiene notificaciones."
        }
      />
    );

  return (
    <FlatList
      testID="lista-notificaciones"
      style={estilos.pantalla}
      contentContainerStyle={[estilos.contenido, rellenoBurbuja]}
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
            <ErrorConReintento
              texto={errorMas}
              onReintentar={() => cargarMas({ reintento: true })}
            />
          </View>
        ) : null
      }
      renderItem={({ item }) =>
        item.encabezado ? (
          <Text
            style={estilos.grupo}
            accessibilityRole="header"
            testID={item.clave}
          >
            {item.encabezado}
          </Text>
        ) : (
          <ElementoNotificacion
            notificacion={item.notificacion}
            onAbrir={abrir}
          />
        )
      }
      onEndReached={() => cargarMas()}
      onEndReachedThreshold={0.4}
      refreshControl={
        <Refresco
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
  const { colores, oscuro } = useApariencia();
  const estilos = useEstilos(fabricaDeEstilos);
  const leida = estaLeida(notificacion);
  const fecha = haceCuantoLlego(notificacion.created_at);
  const dia = fechaCompleta(notificacion.created_at);
  const color = coloresDe(notificacion, oscuro);
  const etiqueta = [
    leida ? null : "Sin leer",
    notificacion.modulo_nombre,
    notificacion.titulo,
    notificacion.resumen,
    fecha,
    dia ? `llegó el ${dia}` : null,
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
      style={({ pressed }) => [
        estilos.item,
        !leida && estilos.itemNuevo,
        pressed && estilos.presionado,
      ]}
    >
      {/* Sin leer: el punto arriba a la izquierda (16/11/2026). */}
      {!leida && (
        <View style={estilos.punto} testID={`sin-leer-${notificacion.id}`} />
      )}
      {/* Cada módulo con su color (16/11/2026): el ícono sobre su fondo
          claro, en un cuadro redondeado. */}
      <View
        style={[estilos.icono, { backgroundColor: color.fondo }]}
        testID={`icono-${notificacion.id}`}
      >
        <Icono
          bootstrap={iconoDe(notificacion)}
          size={22}
          color={color.icono}
        />
      </View>
      <View style={estilos.texto}>
        {/* El módulo a la izquierda y hace cuánto llegó arriba a la
            derecha (16/11/2026, a pedido del usuario). Con letra grande, la
            fecha baja a la línea siguiente. */}
        <View style={estilos.filaSuperior}>
          <View
            style={[estilos.etiqueta, { backgroundColor: color.etiqueta }]}
            testID={`etiqueta-${notificacion.id}`}
          >
            <Text style={[estilos.etiquetaTexto, { color: color.sobreEtiqueta }]}>
              {notificacion.modulo_nombre}
            </Text>
          </View>
          <View style={estilos.filaFecha}>
            <Icono
              nombre="clock-outline"
              size={14}
              color={colores.tintaTenue}
            />
            <Text style={estilos.fecha} testID={`llego-${notificacion.id}`}>
              {fecha}
            </Text>
          </View>
        </View>
        <Text style={[estilos.titulo, !leida && estilos.tituloNuevo]}>
          {notificacion.titulo}
        </Text>
        {notificacion.resumen ? (
          <Text style={estilos.resumen}>{notificacion.resumen}</Text>
        ) : null}
        {/* El día y la hora en que llegó, abajo a la derecha. */}
        {dia ? (
          <Text style={estilos.dia} testID={`dia-${notificacion.id}`}>
            {dia}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const fabricaDeEstilos = (colores, CONTROLES) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 8, flexGrow: 1 },
  cabecera: { gap: 12, marginBottom: 8 },
  filaCabecera: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pregunta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  filtros: { flexDirection: "row", gap: 6 },
  marcarTodas: { marginLeft: "auto", flexShrink: 1 },
  chip: { ...CONTROLES.pildora, paddingHorizontal: 12 },
  chipMarcar: { flexShrink: 1, paddingHorizontal: 10 },
  chipMarcarTexto: { fontSize: 13, fontWeight: "600", textAlign: "center" },
  inactivo: { opacity: 0.6 },
  chipActivo: CONTROLES.pildoraActiva,
  chipTexto: { ...CONTROLES.pildoraTexto, fontSize: 14, fontWeight: "400" },
  chipTextoActivo: { ...CONTROLES.pildoraTextoActivo, fontWeight: "600" },
  grupo: {
    fontSize: 14,
    fontWeight: "700",
    color: colores.tintaSuave,
    marginTop: 8,
  },
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
  itemNuevo: {
    borderColor: colores.bordeRealce,
    backgroundColor: colores.realceSuave,
  },
  presionado: { opacity: 0.85 },
  icono: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  texto: { flex: 1, gap: 4 },
  etiqueta: {
    flexShrink: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  // El color del texto va con el del módulo (`sobreEtiqueta`, US-026).
  etiquetaTexto: { fontSize: 12, fontWeight: "600" },
  contador: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    backgroundColor: colores.insignia,
    borderWidth: 2,
    borderColor: colores.fondo,
    alignItems: "center",
    justifyContent: "center",
  },
  contadorTexto: { fontSize: 11, fontWeight: "700", color: colores.sobreInsignia },
  modulo: { fontSize: 13, color: colores.tintaTenue, flexShrink: 1 },
  titulo: { fontSize: 16, color: colores.tinta },
  tituloNuevo: { fontWeight: "700" },
  resumen: { fontSize: 14, color: colores.tintaSuave },
  fecha: { fontSize: 13, color: colores.tintaTenue, flexShrink: 1 },
  dia: {
    fontSize: 12,
    color: colores.tintaTenue,
    textAlign: "right",
    marginTop: 4,
  },
  filaSuperior: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 8,
  },
  filaFecha: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
  },
  punto: {
    position: "absolute",
    top: 6,
    left: 6,
    zIndex: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    // Ámbar dorado (16/11/2026, prueba pedida por el usuario) con borde
    // ámbar oscuro: sobre el gris, el amarillo solo no llega al 3:1.
    backgroundColor: colores.puntoNuevo,
    borderWidth: 2,
    borderColor: colores.bordePuntoNuevo,
  },
  pie: { padding: 16 },
});
