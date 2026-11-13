import { useFocusEffect, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { soporteService } from "../../api/servicios";
import { Alerta, Boton, BotonIcono, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { SelectorDeLista } from "../../componentes/Selectores";
import { useSesion } from "../../sesion/SesionContext";
import { ESTADOS, esModuloApagado, mensajeDeSoporte, PRIORIDADES, textoDeVence, TONOS } from "../../soporte/formato";
import { SONDEO_LISTAS_MS, useSondeo } from "../../soporte/useSondeo";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";
import { ESPERA_BUSCAR_MS } from "../../utils/busqueda";
import { EstadoTicket, Pildora, PrioridadTicket, Separador, VenceTicket } from "./piezas";

/**
 * La bandeja del equipo (US-014, CA-8 y CA-9), como `Bandeja.jsx` de la web:
 *
 * - arriba, la cabecera del técnico en dos líneas (en horario, «X de N», «N
 *   en la cola para usted», nivel) y «Tomar siguiente» y «Registrar ticket»;
 * - las vistas «Asignados a mí», «Cola» y, con `ver_todos` o `asignar»,
 *   «Todos», como fichas (H-04);
 * - búsqueda (n.º, solicitante, descripción; espera de 300 ms) con
 *   «Actualizar» al lado, y los filtros en fichas que caben en una o dos
 *   líneas: estado («Abiertos» por defecto; no en la cola), prioridad, «Solo
 *   vencidos» y «Limpiar» (H-03, H-08);
 * - de a 20, con más al llegar al final (`page`);
 * - se refresca al volver, al tirar hacia abajo y cada 30 s, sin perder lo
 *   ya cargado ni lo que se está escribiendo.
 *
 * Si `GET tickets/bandeja/` responde 403, la persona no es del equipo: se
 * avisa a `onNoEsDelEquipo` y no se muestra ningún error.
 *
 * T2 (ronda 1 de QA): se lleva la cuenta de las páginas pedidas (no se deduce
 * de cuántos tickets hay, que cambia al quitar repetidos); el refresco pide
 * hasta 100 de una vez y conserva lo cargado más allá, sin repetidos; si la
 * página pedida ya no existe (404), se recarga desde el principio (G-10).
 */
export { ESPERA_BUSCAR_MS };
export const TAMANO_PAGINA = 20;
/** Lo más que da el servidor por página (`max_page_size`). */
export const MAXIMO_POR_PAGINA = 100;
export const TEXTO_COLA_VACIA = "No hay tickets en la cola para usted.";
export const TEXTO_NO_ES_TECNICO =
  "Usted no es parte del equipo de soporte de esta empresa. Quien configura la mesa de ayuda lo da de alta en Configuración → Mesa de ayuda → Técnicos.";
/** H-21: quien solo registra tickets no atiende la cola. */
export const TEXTO_SOLO_REGISTRA =
  "Usted registra tickets a nombre de otras personas (por teléfono, WhatsApp o en persona); no atiende la cola. Los que registre los atiende el equipo de soporte.";

function textoDeQuien(t) {
  if (t.tecnico?.nombre) return `Atiende ${t.tecnico.nombre}`;
  if (t.posicion) return `Puesto ${t.posicion} en la cola`;
  return "Sin asignar";
}

/** H-14: solo se vuelve a pintar si cambió lo que muestra. */
function mismaTarjeta(antes, ahora) {
  return antes.onAbrir === ahora.onAbrir && JSON.stringify(antes.ticket) === JSON.stringify(ahora.ticket);
}

/** Una fila de la bandeja en unas cuatro líneas (H-12). */
export const TarjetaTicket = memo(function TarjetaTicket({ ticket: t, onAbrir }) {
  const vence = textoDeVence(t.sla);
  const nombre = [
    t.numero,
    [t.solicitante_nombre, t.agencia].filter(Boolean).join(", "),
    [t.caso, t.categoria].filter(Boolean).join(", "),
    `Prioridad: ${t.prioridad_display}`,
    `Estado: ${t.estado_display}${t.escalado_por_sla ? ", escalado por SLA" : ""}`,
    textoDeQuien(t),
    `Plazo: ${vence.texto}${vence.fecha ? `, ${vence.fecha}` : ""}`,
  ].join(". ");
  return (
    <Pressable
      testID={`ticket-${t.id}`}
      onPress={() => onAbrir(t)}
      accessibilityRole="button"
      accessibilityLabel={nombre}
      accessibilityHint="Abre la ficha del ticket"
      style={({ pressed }) => [estilos.tarjeta, pressed && estilos.presionada]}
    >
      <View style={estilos.fila}>
        <Text style={estilos.numero}>{t.numero}</Text>
        <EstadoTicket ticket={t} />
        {t.escalado_por_sla ? <Pildora texto="Escalado por SLA" tono={{ ...TONOS.mal, icono: "stairs-up" }} /> : null}
      </View>
      <Text style={estilos.solicitante}>{[t.solicitante_nombre, t.agencia].filter(Boolean).join(" · ")}</Text>
      <Text style={estilos.tenue}>{[t.caso, t.categoria, textoDeQuien(t)].filter(Boolean).join(" · ")}</Text>
      <View style={estilos.fila}>
        <PrioridadTicket ticket={t} />
        <VenceTicket sla={t.sla} />
      </View>
    </Pressable>
  );
}, mismaTarjeta);

function opcionesDe(lista) {
  return lista.map(([valor, texto]) => ({ valor, texto }));
}

/**
 * Une `nuevos` (la primera tanda del refresco) con lo ya cargado más allá,
 * sin repetir (QA-TECH, ronda 2, b). Se corta la lista previa después del
 * último ticket del refresco que ya estaba en ella, no por posición: si
 * entró un ticket nuevo arriba, el que quedó en la frontera (el 100 de antes,
 * ahora el 101) no se pierde. Si ninguno estaba, se corta en `desde`.
 */
export function unirSinRepetir(nuevos, previos, desde) {
  const vistos = new Set(nuevos.map((t) => t.id));
  const posicion = new Map(previos.map((t, i) => [t.id, i]));
  let corte = -1;
  for (let i = nuevos.length - 1; i >= 0 && corte < 0; i -= 1) {
    if (posicion.has(nuevos[i].id)) corte = posicion.get(nuevos[i].id) + 1;
  }
  const resto = previos.slice(corte >= 0 ? corte : desde).filter((t) => !vistos.has(t.id));
  return [...nuevos, ...resto];
}

/** «12 tickets» o «1 ticket con «ana»» (N-06). */
export function textoDelTotal(total, q) {
  const cuantos = `${total} ${total === 1 ? "ticket" : "tickets"}`;
  return q ? `${cuantos} con «${q}»` : cuantos;
}

const SIN_FILTROS = { q: "", estado: "", prioridad: "", vencidos: false };
const LISTA_VACIA = { estado: "inactiva", items: [], total: 0, hayMas: false, error: null, aviso: null };

export function Bandeja({ onAbrir, onNoEsDelEquipo, pie = null, alActualizar }) {
  const router = useRouter();
  const { versionEmpresa } = useSesion();
  const [cabecera, setCabecera] = useState({ estado: "cargando", datos: null, error: null });
  const [etiquetas, setEtiquetas] = useState({ estados: ESTADOS, prioridades: PRIORIDADES });
  const [ambitoElegido, setAmbitoElegido] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtros, setFiltros] = useState(SIN_FILTROS);
  const [lista, setLista] = useState(LISTA_VACIA);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorMas, setErrorMas] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const [tomando, setTomando] = useState(false);
  const [resultadoTomar, setResultadoTomar] = useState(null);
  const montado = useRef(true);
  const consulta = useRef(0);
  const pidiendoMas = useRef(false);
  const tomandoRef = useRef(false);
  // T2: cuántas páginas de 20 se pidieron con éxito.
  const paginas = useRef(0);
  // QA-TECH, ronda 2 (a): con un refresco silencioso en vuelo no se piden
  // más páginas; si no, el refresco pisaba la página recién traída.
  const refrescosEnVuelo = useRef(0);
  const listaRef = useRef(lista);
  listaRef.current = lista;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const datos = cabecera.datos;
  const tecnico = datos?.tecnico ?? null;
  const veTodos = Boolean(datos?.puede?.ver_todos || datos?.puede?.asignar);
  const ambitos = [
    ...(tecnico
      ? [
          { id: "mios", texto: "Asignados a mí" },
          { id: "cola", texto: "Cola" },
        ]
      : []),
    ...(veTodos ? [{ id: "todos", texto: "Todos" }] : []),
  ];
  const porDefecto = ambitos[0]?.id ?? null;
  const ambito = ambitos.some((a) => a.id === ambitoElegido) ? ambitoElegido : porDefecto;

  const cargarCabecera = useCallback(
    async ({ silenciosa = false } = {}) => {
      try {
        const respuesta = await soporteService.bandeja();
        if (!montado.current) return;
        setCabecera({ estado: "listo", datos: respuesta, error: null });
      } catch (e) {
        if (!montado.current) return;
        // CA-1: sin permiso de equipo, no es un error que mostrar.
        if (e?.response?.status === 403 && !esModuloApagado(e)) {
          onNoEsDelEquipo?.();
          return;
        }
        // Un refresco fallido no borra la cabecera que ya había (CA-22).
        if (silenciosa) return;
        setCabecera({ estado: "error", datos: null, error: mensajeDeSoporte(e, "No se pudo cargar la bandeja.") });
      }
    },
    [onNoEsDelEquipo],
  );

  useEffect(() => {
    setCabecera({ estado: "cargando", datos: null, error: null });
    cargarCabecera();
    Promise.resolve(soporteService.etiquetas())
      .then((e) => {
        if (montado.current && Array.isArray(e?.estados) && Array.isArray(e?.prioridades)) setEtiquetas(e);
      })
      .catch(() => {});
  }, [cargarCabecera, versionEmpresa]);

  // La búsqueda se aplica sola al dejar de escribir.
  useEffect(() => {
    const espera = setTimeout(() => {
      setFiltros((f) => (f.q === busqueda.trim() ? f : { ...f, q: busqueda.trim() }));
    }, ESPERA_BUSCAR_MS);
    return () => clearTimeout(espera);
  }, [busqueda]);

  function parametros(pagina, tamano = TAMANO_PAGINA) {
    return {
      ambito,
      page: pagina,
      page_size: tamano === TAMANO_PAGINA ? undefined : tamano,
      q: filtros.q || undefined,
      estado: ambito !== "cola" && filtros.estado ? filtros.estado : undefined,
      prioridad: filtros.prioridad || undefined,
      vencidos: filtros.vencidos ? "true" : undefined,
    };
  }
  const parametrosRef = useRef(parametros);
  parametrosRef.current = parametros;

  /**
   * Desde la primera página, o (`silenciosa`: sondeo, foco, tirar) recarga lo
   * que ya se ve, hasta 100 de una vez, sin «Cargando»; lo cargado más allá
   * se conserva y, si falla, la lista se queda.
   */
  const cargarLista = useCallback(
    async ({ silenciosa = false } = {}) => {
      if (!ambito) return;
      const numero = ++consulta.current;
      if (silenciosa) refrescosEnVuelo.current += 1;
      const pedidas = silenciosa ? Math.max(1, paginas.current) : 1;
      const tamano = Math.min(MAXIMO_POR_PAGINA, pedidas * TAMANO_PAGINA);
      if (!silenciosa) {
        paginas.current = 0;
        setLista({ ...LISTA_VACIA, estado: "cargando" });
      }
      setErrorMas(null);
      try {
        const respuesta = await soporteService.tickets(parametrosRef.current(1, tamano));
        if (!montado.current || numero !== consulta.current) return;
        const nuevos = Array.isArray(respuesta?.results) ? respuesta.results : Array.isArray(respuesta) ? respuesta : [];
        const masAlla = silenciosa && pedidas * TAMANO_PAGINA > MAXIMO_POR_PAGINA;
        if (!silenciosa) paginas.current = 1;
        setLista((previa) => ({
          estado: "listo",
          items: masAlla ? unirSinRepetir(nuevos, previa.items, tamano) : nuevos,
          total: Number(respuesta?.count ?? nuevos.length),
          hayMas: masAlla ? previa.hayMas : Boolean(respuesta?.next),
          error: null,
          aviso: null,
        }));
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        if (silenciosa && listaRef.current.estado === "listo") {
          setLista((l) => ({ ...l, aviso: `${mensajeDeSoporte(e, "No se pudo actualizar la bandeja.")} Se muestran los anteriores.` }));
        } else {
          setLista({ ...LISTA_VACIA, estado: "error", error: mensajeDeSoporte(e, "No se pudieron cargar los tickets.") });
        }
      } finally {
        if (silenciosa) refrescosEnVuelo.current -= 1;
      }
    },
    [ambito],
  );

  // Al cambiar la vista o un filtro, desde la primera página.
  useEffect(() => {
    if (!ambito) return;
    cargarLista();
  }, [ambito, filtros, cargarLista]);

  // CA-8 y H-16: tras cambiar la búsqueda o un filtro, cuántos hay. En
  // Android lo dice la región viva del total; en iOS, el anuncio.
  const ultimoAnuncio = useRef("");
  const primerTotal = useRef(true);
  useEffect(() => {
    if (lista.estado !== "listo") return;
    const clave = JSON.stringify({ ambito, filtros, total: lista.total });
    if (primerTotal.current) {
      primerTotal.current = false;
      ultimoAnuncio.current = clave;
      return;
    }
    if (clave === ultimoAnuncio.current) return;
    ultimoAnuncio.current = clave;
    // N-06: solo en iOS; en Android lo dice la región viva del total.
    if (Platform.OS === "ios") anunciar(`${textoDelTotal(lista.total, filtros.q)}.`);
  }, [lista.estado, lista.total, filtros, ambito]);

  async function cargarMas() {
    const actual = listaRef.current;
    if (pidiendoMas.current || refrescosEnVuelo.current > 0 || actual.estado !== "listo" || !actual.hayMas) return;
    pidiendoMas.current = true;
    setCargandoMas(true);
    setErrorMas(null);
    const numero = consulta.current;
    const pagina = paginas.current + 1;
    try {
      const respuesta = await soporteService.tickets(parametrosRef.current(pagina));
      if (!montado.current || numero !== consulta.current) return;
      paginas.current = pagina;
      const nuevos = Array.isArray(respuesta?.results) ? respuesta.results : [];
      setLista((l) => {
        const vistos = new Set(l.items.map((t) => t.id));
        return {
          ...l,
          items: [...l.items, ...nuevos.filter((t) => !vistos.has(t.id))],
          total: Number(respuesta?.count ?? l.total),
          hayMas: Boolean(respuesta?.next),
        };
      });
    } catch (e) {
      // QA-TECH, ronda 2 (c): un error de una consulta ya vieja no se muestra.
      if (!montado.current || numero !== consulta.current) return;
      // G-10: la página ya no existe (la lista se acortó): desde el principio.
      if (e?.response?.status === 404) {
        pidiendoMas.current = false;
        cargarLista();
        return;
      }
      setErrorMas(mensajeDeSoporte(e, "No se pudieron cargar más tickets."));
    } finally {
      pidiendoMas.current = false;
      if (montado.current) setCargandoMas(false);
    }
  }

  const refrescarSilencioso = useCallback(
    () => Promise.all([cargarCabecera({ silenciosa: true }), cargarLista({ silenciosa: true })]),
    [cargarCabecera, cargarLista],
  );

  // Al volver a la pantalla (no la primera vez). Por un ref: si no, el
  // efecto se repetía al cambiar la vista y pedía la lista dos veces.
  const refrescarRef = useRef(refrescarSilencioso);
  refrescarRef.current = refrescarSilencioso;
  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      refrescarRef.current();
    }, []),
  );

  useSondeo(refrescarSilencioso, SONDEO_LISTAS_MS, cabecera.estado === "listo");

  async function refrescar() {
    setRefrescando(true);
    await Promise.all([cargarCabecera({ silenciosa: true }), cargarLista({ silenciosa: true }), alActualizar?.()]);
    if (montado.current) setRefrescando(false);
  }

  /** CA-9: el siguiente de la cola. Cola vacía (404) es un aviso, no un
   * error. */
  async function tomarSiguiente() {
    if (tomandoRef.current) return;
    tomandoRef.current = true;
    setTomando(true);
    setResultadoTomar(null);
    try {
      const ticket = await soporteService.tomarSiguiente();
      if (!montado.current) return;
      if (!ticket?.id) {
        setResultadoTomar({ tipo: "info", texto: TEXTO_COLA_VACIA, clave: Date.now() });
        return;
      }
      cargarCabecera({ silenciosa: true });
      alActualizar?.();
      anunciar(`Tomó el ticket ${ticket.numero ?? ""}.`);
      onAbrir(ticket);
    } catch (e) {
      if (!montado.current) return;
      if (e?.response?.status === 404) {
        setResultadoTomar({ tipo: "info", texto: TEXTO_COLA_VACIA, clave: Date.now() });
        anunciar(TEXTO_COLA_VACIA);
      } else {
        setResultadoTomar({ tipo: "mal", texto: mensajeDeSoporte(e, "No se pudo tomar el siguiente ticket."), clave: Date.now() });
      }
    } finally {
      tomandoRef.current = false;
      if (montado.current) setTomando(false);
    }
  }

  function limpiarFiltros() {
    setBusqueda("");
    setFiltros(SIN_FILTROS);
    anunciar("Filtros quitados.");
  }

  const renderItem = useCallback(({ item }) => <TarjetaTicket ticket={item} onAbrir={onAbrir} />, [onAbrir]);

  if (cabecera.estado === "cargando") return <Cargando texto="Cargando la bandeja…" />;
  if (cabecera.estado === "error") {
    return (
      <View style={estilos.contenido}>
        <ErrorConReintento texto={cabecera.error} onReintentar={() => cargarCabecera()} />
        {pie}
      </View>
    );
  }

  const sinColaParaMi = tecnico && tecnico.cola_para_mi === 0;
  const hayFiltros = Boolean(filtros.q || busqueda.trim() || filtros.estado || filtros.prioridad || filtros.vencidos);
  const textoVacio = filtros.vencidos
    ? "No hay tickets vencidos."
    : hayFiltros
      ? "Ningún ticket coincide con los filtros."
      : ambito === "mios"
        ? "No tiene tickets en atención."
        : ambito === "cola"
          ? "No hay tickets esperando en la cola."
          : "No hay tickets.";

  const encabezado = (
    <View style={estilos.cabecera}>
      {tecnico ? (
        // Dos líneas (H-08): el estado y lo que tiene, y su nivel.
        <View style={estilos.tecnico} testID="cabecera-tecnico">
          <View style={estilos.fila}>
            <Pildora
              texto={tecnico.en_horario ? "En horario de atención" : "Fuera de su horario"}
              tono={tecnico.en_horario ? { ...TONOS.bien, icono: "clock-check-outline" } : { ...TONOS.neutro, icono: "weather-night" }}
            />
            <Text style={estilos.texto}>
              <Text style={estilos.negrita}>{tecnico.abiertos}</Text> de {tecnico.capacidad} en atención ·{" "}
              {sinColaParaMi ? (
                "No hay tickets de sus categorías en la cola"
              ) : (
                <>
                  <Text style={estilos.negrita}>{tecnico.cola_para_mi}</Text> en la cola para usted
                </>
              )}
            </Text>
          </View>
          {/* H-08: una sola línea; el lector dice todas las categorías. */}
          <Text
            style={estilos.tenue}
            numberOfLines={1}
            accessibilityLabel={`Nivel ${tecnico.nivel}. Categorías: ${tecnico.categorias?.length ? tecnico.categorias.join(", ") : "sin categorías asignadas"}`}
            testID="nivel-tecnico"
          >
            {tecnico.nivel} · {tecnico.categorias?.length ? tecnico.categorias.join(", ") : "sin categorías asignadas"}
          </Text>
        </View>
      ) : null}
      {datos?.categorias_sin_tecnicos?.length > 0 ? (
        <Alerta
          tipo="mal"
          texto={
            datos.categorias_sin_tecnicos.length === 1
              ? `La categoría «${datos.categorias_sin_tecnicos[0]}» no tiene técnicos: sus tickets no se reparten.`
              : `${datos.categorias_sin_tecnicos.length} categorías no tienen técnicos (${datos.categorias_sin_tecnicos.join(", ")}): sus tickets no se reparten.`
          }
        />
      ) : null}
      {!tecnico && !veTodos ? (
        <Alerta tipo="info" texto={datos?.puede?.registrar ? TEXTO_SOLO_REGISTRA : TEXTO_NO_ES_TECNICO} />
      ) : null}
      <View style={estilos.acciones}>
        {tecnico ? (
          <View style={estilos.accion}>
            <Boton
              testID="tomar-siguiente"
              titulo={tomando ? "Tomando…" : "Tomar siguiente"}
              icono="inbox-arrow-down"
              cargando={tomando}
              deshabilitado={sinColaParaMi}
              pista={sinColaParaMi ? "No hay tickets de sus categorías en la cola" : "Le asigna el ticket más urgente de su cola y lo abre"}
              onPress={() => {
                tomarSiguiente();
              }}
            />
          </View>
        ) : null}
        {datos?.puede?.registrar ? (
          <View style={estilos.accion}>
            <Boton
              testID="registrar-ticket"
              titulo="Registrar"
              etiqueta="Registrar ticket a nombre de otra persona"
              icono="phone-plus-outline"
              variante="secundario"
              pista="Para lo que llega por teléfono, WhatsApp o en persona"
              onPress={() => router.push("/soporte/registrar")}
            />
          </View>
        ) : null}
      </View>
      {resultadoTomar ? (
        <Alerta tipo={resultadoTomar.tipo} texto={resultadoTomar.texto} clave={resultadoTomar.clave} testID="resultado-tomar" />
      ) : null}

      {ambitos.length > 1 ? (
        // H-04 y N-10: el nivel 2, como pestañas subrayadas (texto y borde
        // inferior grueso negro), para que no se confundan con los filtros.
        <View style={estilos.pestanas} accessibilityRole="tablist" accessibilityLabel="Qué tickets ver">
          {ambitos.map((a) => {
            const activa = a.id === ambito;
            return (
              <Pressable
                key={a.id}
                testID={`vista-${a.id}`}
                onPress={() => setAmbitoElegido(a.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: activa }}
                accessibilityLabel={a.texto}
                style={[estilos.pestana, activa && estilos.pestanaActiva]}
              >
                <Text style={[estilos.pestanaTexto, activa && estilos.pestanaTextoActiva]}>{a.texto}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {ambito ? (
        <View style={estilos.filtros}>
          <View style={estilos.filaBusqueda} accessibilityRole="search">
            <TextInput
              testID="buscar-tickets"
              value={busqueda}
              onChangeText={setBusqueda}
              placeholder="N.º, solicitante o descripción"
              placeholderTextColor={colores.tintaTenue}
              accessibilityLabel="Buscar: n.º de ticket, solicitante o descripción"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => setFiltros((f) => ({ ...f, q: busqueda.trim() }))}
              style={estilos.entrada}
            />
            <BotonIcono
              testID="actualizar-bandeja"
              icono="refresh"
              variante="contorno"
              etiqueta={refrescando ? "Actualizando…" : "Actualizar la bandeja"}
              cargando={refrescando}
              onPress={refrescar}
            />
          </View>
          {/* H-03: los filtros en una sola fila que se desplaza de lado. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={estilos.filaFiltros}
            testID="fila-filtros"
          >
            {ambito !== "cola" ? (
              <SelectorDeLista
                compacto
                testID="filtro-estado"
                etiqueta="Estado"
                opciones={opcionesDe(etiquetas.estados)}
                valor={filtros.estado}
                vacio="Abiertos"
                conVacio
                onCambio={(v) => setFiltros((f) => ({ ...f, estado: v }))}
              />
            ) : null}
            <SelectorDeLista
              compacto
              testID="filtro-prioridad"
              etiqueta="Prioridad"
              opciones={opcionesDe(etiquetas.prioridades)}
              valor={filtros.prioridad}
              vacio="Todas"
              conVacio
              onCambio={(v) => setFiltros((f) => ({ ...f, prioridad: v }))}
            />
            <Pressable
              testID="filtro-vencidos"
              onPress={() => setFiltros((f) => ({ ...f, vencidos: !f.vencidos }))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: filtros.vencidos }}
              accessibilityLabel="Solo vencidos"
              style={[estilos.ficha, filtros.vencidos && estilos.fichaActiva]}
            >
              <Icono
                nombre={filtros.vencidos ? "checkbox-marked-outline" : "checkbox-blank-outline"}
                size={20}
                color={colores.tinta}
              />
              <Text style={estilos.fichaTexto}>Solo vencidos</Text>
            </Pressable>
            {hayFiltros ? (
              <Pressable
                testID="limpiar-filtros"
                onPress={limpiarFiltros}
                accessibilityRole="button"
                accessibilityLabel="Limpiar los filtros"
                style={estilos.ficha}
              >
                <Icono nombre="close" size={18} color={colores.tinta} />
                <Text style={estilos.fichaTexto}>Limpiar</Text>
              </Pressable>
            ) : null}
          </ScrollView>
          {lista.estado === "listo" ? (
            <Text style={estilos.tenue} accessibilityLiveRegion="polite" testID="total-tickets">
              {`${textoDelTotal(lista.total, filtros.q)}. ${ambito === "cola" ? "El más crítico primero." : "Primero lo que vence antes."}`}
            </Text>
          ) : null}
          {lista.aviso ? <Alerta tipo="mal" texto={lista.aviso} /> : null}
        </View>
      ) : (
        <View style={estilos.soloActualizar}>
          <BotonIcono
            testID="actualizar-bandeja"
            icono="refresh"
            variante="contorno"
            etiqueta={refrescando ? "Actualizando…" : "Actualizar la bandeja"}
            cargando={refrescando}
            onPress={refrescar}
          />
        </View>
      )}
    </View>
  );

  let vacio = null;
  if (ambito) {
    if (lista.estado === "cargando" || lista.estado === "inactiva") vacio = <Cargando texto="Cargando los tickets…" />;
    else if (lista.estado === "error") vacio = <ErrorConReintento texto={lista.error} onReintentar={() => cargarLista()} />;
    else vacio = <Vacio icono="inbox-outline" texto={textoVacio} />;
  }

  return (
    <FlatList
      testID="lista-bandeja"
      style={estilos.lista}
      contentContainerStyle={estilos.contenido}
      data={lista.estado === "listo" ? lista.items : []}
      keyExtractor={(t) => String(t.id)}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={estilos.encabezado}>{encabezado}</View>}
      ListEmptyComponent={vacio}
      ListFooterComponent={
        <View style={estilos.pie}>
          {cargandoMas ? (
            <View accessible accessibilityRole="progressbar" accessibilityLabel="Cargando más tickets…">
              <ActivityIndicator color={colores.primario} />
            </View>
          ) : null}
          {errorMas ? <ErrorConReintento texto={errorMas} onReintentar={cargarMas} /> : null}
          {lista.estado === "listo" && lista.hayMas && !cargandoMas && !errorMas ? (
            <Boton testID="ver-mas" titulo="Ver más tickets" icono="chevron-down" variante="secundario" onPress={cargarMas} />
          ) : null}
          {pie}
        </View>
      }
      onEndReached={() => {
        cargarMas();
      }}
      onEndReachedThreshold={0.4}
      renderItem={renderItem}
      ItemSeparatorComponent={Separador}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    />
  );
}

const estilos = crearEstilos({
  lista: { flex: 1 },
  contenido: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  encabezado: { marginBottom: 10 },
  cabecera: { gap: 8 },
  tecnico: {
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  // H-03: «Tomar siguiente» y «Registrar» en una fila.
  acciones: { flexDirection: "row", gap: 8 },
  accion: { flexGrow: 1, flexShrink: 1 },
  filaFiltros: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 16 },
  ficha: { ...CONTROLES.pildora, paddingVertical: 6 },
  // N-10: un filtro activo va con fondo `realce` y contorno negro de 2 (no
  // negro relleno, que es el de las pestañas de la Mesa).
  fichaActiva: { backgroundColor: colores.realce, borderColor: colores.primario, borderWidth: 2 },
  fichaTexto: CONTROLES.pildoraTexto,
  pestanas: { flexDirection: "row", flexWrap: "wrap", borderBottomWidth: 1, borderBottomColor: colores.borde },
  pestana: {
    minHeight: AREA_TACTIL,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  pestanaActiva: { borderBottomColor: colores.primario },
  pestanaTexto: { fontSize: 15, fontWeight: "500", color: colores.tintaSuave },
  pestanaTextoActiva: { fontWeight: "700", color: colores.titulo },
  filtros: { gap: 8 },
  filaBusqueda: { flexDirection: "row", alignItems: "center", gap: 8 },
  entrada: { ...CONTROLES.entrada, flex: 1 },
  soloActualizar: { alignItems: "flex-end" },
  pie: { gap: 10, marginTop: 12 },
  tarjeta: {
    minHeight: AREA_TACTIL,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  presionada: { backgroundColor: colores.realce },
  fila: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  numero: { flexGrow: 1, fontSize: 16, fontWeight: "700", color: colores.titulo },
  solicitante: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  texto: { flexShrink: 1, fontSize: 15, color: colores.tinta },
  negrita: { fontWeight: "700" },
  tenue: { fontSize: 14, color: colores.tintaSuave },
});
