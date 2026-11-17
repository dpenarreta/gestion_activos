import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { ESPERA_FOCO_ANDROID_MS, ESPERA_FOCO_IOS_MS, useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { activosService, organizacionService } from "../../api/servicios";
import { dejarResultado } from "../../activos/avisoPendiente";
import {
  CONDICIONES,
  CRITICIDADES,
  cuerpoDeAlta,
  cuerpoDeEdicion,
  especificacionesHeredadas,
  falloDeCatalogo,
  hayCambiosEnElActivo,
  LARGOS,
  PROPIEDADES,
  seVanAPerderEspecificaciones,
  TEXTO_SIN_CAMBIOS_EN_LA_FICHA,
  textoDelAlta,
  textoDelAvisoDeAlta,
  USOS,
  validarActivo,
  valoresDeActivo,
  valoresVacios,
} from "../../activos/fichaTecnica";
import { ESPERA_BUSCAR_MS, mensajeDeActivos, puedeEditarActivos, puedeRegistrarActivos, TEXTO_NO_DISPONIBLE } from "../../activos/formato";
import { erroresDeEspecificaciones, valorDeEspecificacion } from "../../activos/solicitudes";
import { Alerta, Boton, BotonIcono, Cargando, Desplegable, ErrorConReintento } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { Casilla, ErrorDeCampo, OpcionesEnLinea, SelectorDeLista } from "../../componentes/Selectores";
import { SelectorFecha } from "../../componentes/SelectorFecha";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { useSesion } from "../../sesion/SesionContext";
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { CampoTexto } from "../permisos/piezas";
import { personaDeEmpleado } from "./AccionesDelActivo";
import { errorDeGuardado, textoRevise, useCandado, useReenvioConfirmado, useSalirConCambios } from "./formularios";
import { BotonEscanearSerie } from "./EscanearSerie";
import { CampoDeCaracteristica } from "./NuevaSolicitudDeEquipo";
import { useMontado } from "./piezas";

export const TEXTO_SIN_PERMISO_REGISTRAR_ACTIVO = "No tiene permiso para registrar activos en esta empresa.";
export const TEXTO_SIN_PERMISO_EDITAR_ACTIVO = "No tiene permiso para editar activos en esta empresa.";
export const TITULO_CAMBIO_DE_TIPO = "¿Cambiar el tipo de dispositivo?";

/** Los campos en el orden de la pantalla, con su nombre para «Revise…». El
 * área, el custodio y quién lo pidió solo están en el alta. */
const CAMPOS_DE_ALTA = {
  tipo: "Tipo de dispositivo",
  nombre: "Nombre del activo",
  marca: "Marca",
  modelo: "Modelo",
  numero_serie: "Número de serie",
  especificaciones: "Características",
  responsables: "Custodio",
  departamento: "Área",
  solicitado_por: "Lo pidió",
  compartido: "Varias personas responden por él",
  fecha_adquisicion: "Fecha de adquisición",
  sede: "Sede",
  criticidad: "Criticidad",
  uso: "Uso",
  fecha_ingreso: "Fecha de ingreso",
  costo_adquisicion: "Costo de compra",
  condicion: "Condición al adquirirlo",
  proveedor: "Proveedor",
  propiedad: "De quién es el equipo",
  concesionario: "Concesionario",
  fecha_fin_garantia: "Fin de garantía",
  observaciones: "Observaciones",
};
const CAMPOS_DE_EDICION = Object.fromEntries(
  Object.entries(CAMPOS_DE_ALTA).filter(([c]) => !["departamento", "responsables", "solicitado_por"].includes(c)),
);

/** Lo plegado (UX H-03 de la US-022): con un error, su bloque se abre solo. */
const DE_UBICACION = ["sede", "criticidad", "uso"];
const DE_LA_COMPRA = [
  "fecha_ingreso",
  "costo_adquisicion",
  "condicion",
  "proveedor",
  "propiedad",
  "concesionario",
  "fecha_fin_garantia",
  "observaciones",
];

function resultados(datos) {
  if (Array.isArray(datos)) return datos;
  return Array.isArray(datos?.results) ? datos.results : [];
}

/** Las opciones de un catálogo, con la actual aunque ya no venga (una sede
 * que se cerró sigue a la vista en la ficha que la tiene). */
function opcionesCon(lista, actual, aTexto = (x) => x.nombre) {
  const opciones = lista.map((x) => ({ valor: String(x.id), texto: aTexto(x) }));
  if (actual?.valor && !opciones.some((o) => o.valor === actual.valor)) opciones.unshift(actual);
  return opciones;
}

export const TEXTO_BUSQUEDA_SIN_ELEGIR = "Elija a alguien de la lista o borre lo que escribió en la búsqueda.";
export const TEXTO_CARACTERISTICA_SIN_AGREGAR = "Toque «Agregar característica» o borre lo que escribió.";
export const TEXTO_CARACTERISTICAS_CARGANDO = "Espere a que se carguen las características del tipo.";
export const TEXTO_CARACTERISTICAS_SIN_CARGAR =
  "No se pudieron cargar las características del tipo: toque «Reintentar» antes de guardar.";
export const TEXTO_AREA_PROPUESTA = "Propuesta según el custodio; puede cambiarla.";

/** Lleva el foco del lector de pantalla a `nodo` tras el siguiente pintado
 * (como `irAlBloque.js`). Devuelve la limpieza. */
function enfocar(nodo) {
  if (!nodo) return undefined;
  const espera = setTimeout(
    () => {
      try {
        AccessibilityInfo.sendAccessibilityEvent(nodo, "focus");
      } catch {
        // Sin lector de pantalla no hay nada que mover.
      }
    },
    Platform.OS === "android" ? ESPERA_FOCO_ANDROID_MS : ESPERA_FOCO_IOS_MS,
  );
  return () => clearTimeout(espera);
}

/** La pregunta antes de cambiar el tipo con características escritas (CA-3). */
function confirmarCambioDeTipo(nombre) {
  return new Promise((resolver) => {
    Alert.alert(
      TITULO_CAMBIO_DE_TIPO,
      `Lo que escribió en las características${nombre ? ` de «${nombre}»` : ""} se pierde: el tipo nuevo pide las suyas.`,
      [
        { text: "Mantener el tipo", style: "cancel", onPress: () => resolver(false) },
        { text: "Cambiar el tipo", style: "destructive", onPress: () => resolver(true) },
      ],
      { cancelable: true, onDismiss: () => resolver(false) },
    );
  });
}

// --- Elegir a una persona (custodio y «Lo pidió») ----------------------------------

/**
 * Una persona de `organizacion/empleados/`: escribir, esperar 400 ms y
 * elegir; elegida, se ve con «Quitar». Es un buscador y no una lista: la web
 * pide todos los empleados de una vez y el servidor da como mucho 100.
 *
 * UX H-01/H-02: `onPendiente(true)` mientras hay texto en la búsqueda sin
 * elegir a nadie; el formulario no guarda así ni deja salir sin preguntar.
 * UX H-04: al elegir o quitar, el foco pasa al control que reemplaza al
 * anterior (la persona elegida o el buscador).
 */
function ElegirEmpleado({ etiqueta, ayuda, pedir, elegida, onElegir, onQuitar, onPendiente, error, refFoco, deshabilitado, testID }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState({ cargando: false, lista: [], error: null });
  const [vez, setVez] = useState(0);
  const montado = useMontado();
  const nodo = useRef(null);
  const moverFoco = useRef(false);
  const ref = useCallback(
    (n) => {
      nodo.current = n;
      if (typeof refFoco === "function") refFoco(n);
    },
    [refFoco],
  );

  useEffect(() => {
    if (!moverFoco.current) return undefined;
    moverFoco.current = false;
    return enfocar(nodo.current);
  }, [elegida]);

  const pendiente = !elegida && Boolean(texto.trim());
  useEffect(() => {
    onPendiente?.(pendiente);
  }, [pendiente, onPendiente]);
  useEffect(() => () => onPendiente?.(false), [onPendiente]);

  useEffect(() => {
    const q = texto.trim();
    if (!q) {
      setEstado({ cargando: false, lista: [], error: null });
      return undefined;
    }
    let vigente = true;
    setEstado((s) => ({ ...s, cargando: true, error: null }));
    const pausa = setTimeout(() => {
      pedir(q)
        .then((datos) => {
          if (vigente && montado.current) setEstado({ cargando: false, lista: resultados(datos).map(personaDeEmpleado), error: null });
        })
        .catch((e) => {
          if (vigente && montado.current) setEstado({ cargando: false, lista: [], error: falloDeCatalogo(e, "los empleados") });
        });
    }, ESPERA_BUSCAR_MS);
    return () => {
      vigente = false;
      clearTimeout(pausa);
    };
  }, [texto, vez, pedir, montado]);

  if (elegida) {
    return (
      <View style={estilos.campo}>
        <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
          {etiqueta}
        </Text>
        <View style={estilos.elegida} testID={`${testID}-elegido`}>
          <View
            ref={ref}
            accessible
            accessibilityLabel={`${etiqueta}: ${elegida.nombre}${elegida.detalle ? `. ${elegida.detalle}` : ""}${error ? `. Error: ${error}` : ""}`}
            style={estilos.textos}
          >
            <Text style={estilos.opcionTexto}>{elegida.nombre}</Text>
            {elegida.detalle ? <Text style={estilos.tenue}>{elegida.detalle}</Text> : null}
          </View>
          <BotonIcono
            testID={`${testID}-quitar`}
            icono="close"
            color={colores.tinta}
            etiqueta={`Quitar a ${elegida.nombre} de ${etiqueta.toLowerCase()}`}
            deshabilitado={deshabilitado}
            onPress={() => {
              moverFoco.current = true;
              onQuitar();
            }}
          />
        </View>
        {ayuda ? <Text style={estilos.tenue}>{ayuda}</Text> : null}
        <ErrorDeCampo error={error} />
      </View>
    );
  }

  return (
    <View style={estilos.campo}>
      <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
        {etiqueta}
        <Text style={estilos.opcional}> (opcional)</Text>
      </Text>
      {ayuda ? (
        <Text style={estilos.tenue} importantForAccessibility="no" accessibilityElementsHidden>
          {ayuda}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        testID={testID}
        value={texto}
        onChangeText={setTexto}
        editable={!deshabilitado}
        placeholder="Nombre, apellido o código"
        placeholderTextColor={colores.tintaTenue}
        accessibilityLabel={[`${etiqueta} (opcional). Buscar por nombre, apellido o código`, ayuda, error ? `Error: ${error}` : null]
          .filter(Boolean)
          .join(". ")}
        autoCorrect={false}
        style={[estilos.entrada, error && estilos.entradaConError]}
      />
      <ErrorDeCampo error={error} />
      {estado.cargando ? (
        <View style={estilos.linea} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colores.primario} />
          <Text style={estilos.tenue}>Buscando…</Text>
        </View>
      ) : null}
      {estado.error ? <ErrorConReintento texto={estado.error} onReintentar={() => setVez((v) => v + 1)} /> : null}
      {!estado.cargando && !estado.error && texto.trim() && estado.lista.length === 0 ? (
        <Text style={estilos.tenue} accessibilityLiveRegion="polite">{`Nadie coincide con «${texto.trim()}».`}</Text>
      ) : null}
      {estado.lista.map((p) => (
        <Pressable
          key={p.id}
          testID={`${testID}-${p.id}`}
          onPress={() => {
            moverFoco.current = true;
            onElegir(p);
            setTexto("");
          }}
          disabled={deshabilitado}
          accessibilityRole="button"
          accessibilityLabel={`${p.nombre}${p.detalle ? `. ${p.detalle}` : ""}`}
          accessibilityHint={`Lo elige en ${etiqueta.toLowerCase()}`}
          style={({ pressed }) => [estilos.opcion, pressed && estilos.presionada]}
        >
          <Icono nombre="account-plus-outline" size={20} color={colores.primario} />
          <View style={estilos.textos}>
            <Text style={estilos.opcionTexto}>{p.nombre}</Text>
            {p.detalle ? <Text style={estilos.tenue}>{p.detalle}</Text> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// --- Especificaciones (CA-3) --------------------------------------------------------

/** Un par «Característica: valor» con «Quitar». */
function Par({ nombre, valor, error, onQuitar, deshabilitado, prefijo }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  return (
    <View style={estilos.par} testID={`${prefijo}-${nombre}`}>
      <View style={estilos.parFila}>
        <View style={estilos.textos} accessible accessibilityLabel={`${nombre}: ${valorDeEspecificacion(valor)}${error ? `. Error: ${error}` : ""}`}>
          <Text style={estilos.etiqueta}>{nombre}</Text>
          <Text style={estilos.dato}>{valorDeEspecificacion(valor)}</Text>
        </View>
        <BotonIcono
          testID={`quitar-${prefijo}-${nombre}`}
          icono="delete-outline"
          color={colores.malTexto}
          etiqueta={`Quitar ${nombre}`}
          deshabilitado={deshabilitado}
          onPress={onQuitar}
        />
      </View>
      <ErrorDeCampo error={error} />
    </View>
  );
}

/**
 * Sin características declaradas, el tipo todavía no se describió y siguen
 * valiendo los pares libres, como `EspecificacionesEditor` de la web.
 * UX H-01: lo escrito sin «Agregar» queda pendiente (`onPendiente`) y no se
 * pierde en silencio; `error` va junto al campo «Característica».
 */
function EspecificacionesLibres({ valor, onCambio, onPendiente, error, refFoco, deshabilitado }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const [clave, setClave] = useState("");
  const [contenido, setContenido] = useState("");
  const entradas = Object.entries(valor ?? {});
  const pendiente = Boolean(clave.trim() || contenido.trim());
  useEffect(() => {
    onPendiente?.(pendiente);
  }, [pendiente, onPendiente]);
  useEffect(() => () => onPendiente?.(false), [onPendiente]);

  function agregar() {
    const nombre = clave.trim();
    const dato = contenido.trim();
    if (!nombre || !dato) return;
    onCambio({ ...valor, [nombre]: dato });
    setClave("");
    setContenido("");
  }

  function quitar(nombre) {
    const copia = { ...valor };
    delete copia[nombre];
    onCambio(copia);
  }

  return (
    <View style={estilos.campo} testID="especificaciones-libres">
      <Text style={estilos.tenue}>Este tipo todavía no declara sus características: anote las que sirvan (procesador, RAM, disco…).</Text>
      {entradas.map(([nombre, dato]) => (
        <Par key={nombre} prefijo="espec-libre" nombre={nombre} valor={dato} deshabilitado={deshabilitado} onQuitar={() => quitar(nombre)} />
      ))}
      <CampoTexto
        testID="espec-libre-clave"
        refFoco={refFoco}
        etiqueta="Característica"
        placeholder="Procesador"
        maximo={80}
        error={error}
        valor={clave}
        deshabilitado={deshabilitado}
        onCambio={setClave}
      />
      <CampoTexto
        testID="espec-libre-valor"
        etiqueta="Valor"
        placeholder="Intel Core i5-1335U"
        maximo={200}
        valor={contenido}
        deshabilitado={deshabilitado}
        onCambio={setContenido}
      />
      <Boton
        testID="agregar-espec-libre"
        titulo="Agregar característica"
        icono="plus"
        variante="secundario"
        deshabilitado={deshabilitado || !clave.trim() || !contenido.trim()}
        onPress={agregar}
      />
    </View>
  );
}

// --- La pantalla --------------------------------------------------------------------

/**
 * «Registrar activo» y «Editar» (US-023, CA-2 a CA-5), el mismo formulario
 * que `ActivoForm.jsx` de la web: identificación (tipo, nombre, marca,
 * modelo y serie), las características que declara el tipo, la custodia
 * (solo en el alta: área, custodio y quién lo pidió), «compartido», la fecha
 * de adquisición y, plegado, lo opcional (sede, criticidad, uso, compra,
 * propiedad y garantía).
 *
 * Sin `id` es el alta (`POST activos/`, con `activos.crear`): al guardar se
 * abre la ficha nueva, que anuncia su código de barras. Con `id` es la
 * edición (`PATCH activos/{id}/`, con `activos.editar`): no toca el estado,
 * los responsables ni el área, que cambian con «Asignar» y «Cambiar estado»;
 * al guardar se vuelve a la ficha, que se recarga.
 *
 * Como «Registrar mantenimiento»: un solo envío aunque se toque dos veces;
 * los 400 junto a su campo; sin respuesta clara, «puede haberse guardado» y
 * el siguiente envío lo confirma; salir con cambios pregunta.
 */
export function FormularioActivo({ id = null }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const esEdicion = Boolean(id);
  const router = useRouter();
  const alturaCabecera = useAlturaCabecera();
  const { usuario } = useSesion();
  const permisos = usuario?.permissions ?? [];
  const conPermiso = esEdicion ? puedeEditarActivos(permisos) : puedeRegistrarActivos(permisos);
  const CAMPOS = esEdicion ? CAMPOS_DE_EDICION : CAMPOS_DE_ALTA;
  const [iniciales, setIniciales] = useState(valoresVacios);
  const [valores, setValores] = useState(valoresVacios);
  const [activo, setActivo] = useState({ estado: esEdicion ? "cargando" : "listo", datos: null, error: null });
  const [catalogos, setCatalogos] = useState({
    estado: "cargando",
    tipos: [],
    areas: [],
    sedes: [],
    proveedores: [],
    concesionarios: [],
    fallos: {},
  });
  // `tipo`: de qué tipo son las características cargadas. Mientras no sea el
  // elegido se tratan como «cargando» (QA-TECH P3 #1): sin parpadeo de los
  // pares libres en el primer pintado de una edición.
  const [caracteristicas, setCaracteristicas] = useState({ tipo: "", estado: "listo", lista: [], error: null });
  const [vezCaracteristicas, setVezCaracteristicas] = useState(0);
  const [personas, setPersonas] = useState({ responsables: null, solicitado_por: null });
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [ubicacion, setUbicacion] = useState(false);
  const [compra, setCompra] = useState(false);
  const [areaPropuesta, setAreaPropuesta] = useState(false);
  // UX H-01/H-02: lo escrito y no confirmado (una característica sin
  // «Agregar», una búsqueda sin elegir a nadie).
  const [pendientes, setPendientes] = useState({ especificaciones: false, responsables: false, solicitado_por: false });
  const montado = useMontado();
  const candado = useCandado();
  const reenvio = useReenvioConfirmado();
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const hayPendientes = Object.values(pendientes).some(Boolean);
  const tocado = hayCambiosEnElActivo(iniciales, valores) || hayPendientes;
  const { salir } = useSalirConCambios(tocado && !enviando, { ocupado: enviando });
  const pendienteDe = useMemo(() => {
    const marcar = (campo) => (si) => setPendientes((p) => (p[campo] === si ? p : { ...p, [campo]: si }));
    return { especificaciones: marcar("especificaciones"), responsables: marcar("responsables"), solicitado_por: marcar("solicitado_por") };
  }, []);

  const cargarActivo = useCallback(async () => {
    if (!esEdicion) return;
    setActivo({ estado: "cargando", datos: null, error: null });
    try {
      const datos = await activosService.detalle(id);
      if (!montado.current) return;
      const cargados = valoresDeActivo(datos);
      setIniciales(cargados);
      setValores(cargados);
      // UX H-09: lo plegado que ya tiene datos empieza abierto.
      const porDefecto = valoresVacios();
      setUbicacion(DE_UBICACION.some((c) => cargados[c] !== porDefecto[c]));
      setCompra(DE_LA_COMPRA.some((c) => cargados[c] !== porDefecto[c]));
      setActivo({ estado: "listo", datos, error: null });
    } catch (e) {
      if (!montado.current) return;
      const texto = e?.response?.status === 404 ? TEXTO_NO_DISPONIBLE : mensajeDeActivos(e, "No se pudo cargar la ficha del activo.");
      setActivo({ estado: "error", datos: null, error: texto });
    }
  }, [esEdicion, id, montado]);

  const cargarCatalogos = useCallback(async () => {
    setCatalogos((c) => ({ ...c, estado: c.estado === "listo" ? "recargando" : "cargando" }));
    const [tipos, areas, sedes, proveedores, concesionarios] = await Promise.allSettled([
      activosService.tipos(),
      // El área solo se elige en el alta: en la edición no se pide.
      esEdicion ? Promise.resolve([]) : organizacionService.departamentos(),
      organizacionService.sedes(),
      organizacionService.proveedores(),
      organizacionService.concesionarios(),
    ]);
    if (!montado.current) return;
    const fallos = {};
    if (tipos.status === "rejected") {
      fallos.tipo = falloDeCatalogo(tipos.reason, "los tipos de dispositivo", { deOrganizacion: false });
    }
    if (areas.status === "rejected") fallos.departamento = falloDeCatalogo(areas.reason, "las áreas");
    if (sedes.status === "rejected") fallos.sede = falloDeCatalogo(sedes.reason, "las sedes");
    if (proveedores.status === "rejected") fallos.proveedor = falloDeCatalogo(proveedores.reason, "los proveedores");
    if (concesionarios.status === "rejected") fallos.concesionario = falloDeCatalogo(concesionarios.reason, "los concesionarios");
    const valor = (r) => (r.status === "fulfilled" ? resultados(r.value) : []);
    setCatalogos({
      estado: "listo",
      // Solo los tipos activos, como la web.
      tipos: valor(tipos).filter((t) => t.activo !== false),
      areas: valor(areas),
      sedes: valor(sedes),
      proveedores: valor(proveedores),
      concesionarios: valor(concesionarios),
      fallos,
    });
  }, [esEdicion, montado]);

  useEffect(() => {
    if (!conPermiso) return;
    cargarActivo();
    cargarCatalogos();
  }, [conPermiso, cargarActivo, cargarCatalogos]);

  // Las características del tipo elegido: se piden al servidor y no se
  // deducen de lo guardado, porque el formulario debe pedir las que el tipo
  // declara aunque el equipo no tenga ninguna todavía (como la web).
  useEffect(() => {
    const tipo = valores.tipo;
    if (!tipo) {
      setCaracteristicas({ tipo: "", estado: "listo", lista: [], error: null });
      return undefined;
    }
    let vigente = true;
    setCaracteristicas({ tipo, estado: "cargando", lista: [], error: null });
    activosService
      .caracteristicas(valores.tipo)
      .then((datos) => {
        if (!vigente || !montado.current) return;
        const lista = [...resultados(datos)].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
        setCaracteristicas({ tipo, estado: "listo", lista, error: null });
      })
      .catch((e) => {
        if (!vigente || !montado.current) return;
        setCaracteristicas({
          tipo,
          estado: "error",
          lista: [],
          error: falloDeCatalogo(e, "las características de este tipo", { deOrganizacion: false }),
        });
      });
    return () => {
      vigente = false;
    };
  }, [valores.tipo, vezCaracteristicas, montado]);

  const datosDelActivo = activo.datos;
  const opcionesDeTipo = useMemo(
    () =>
      opcionesCon(
        catalogos.tipos,
        datosDelActivo?.tipo ? { valor: String(datosDelActivo.tipo), texto: datosDelActivo.tipo_nombre || "Tipo actual" } : null,
        (t) => (t.codigo ? `${t.nombre} (${t.codigo})` : t.nombre),
      ),
    [catalogos.tipos, datosDelActivo],
  );
  const opcionesDeArea = useMemo(() => opcionesCon(catalogos.areas, null), [catalogos.areas]);
  const opcionesDeSede = useMemo(
    () =>
      opcionesCon(
        catalogos.sedes,
        datosDelActivo?.sede ? { valor: String(datosDelActivo.sede), texto: datosDelActivo.sede_nombre || "Sede actual" } : null,
        (s) => (s.ciudad && s.ciudad !== s.nombre ? `${s.nombre} — ${s.ciudad}` : s.nombre),
      ),
    [catalogos.sedes, datosDelActivo],
  );
  const opcionesDeProveedor = useMemo(
    () =>
      opcionesCon(
        catalogos.proveedores,
        datosDelActivo?.proveedor
          ? { valor: String(datosDelActivo.proveedor), texto: datosDelActivo.proveedor_nombre || "Proveedor actual" }
          : null,
      ),
    [catalogos.proveedores, datosDelActivo],
  );
  const opcionesDeConcesionario = useMemo(
    () =>
      opcionesCon(
        catalogos.concesionarios,
        datosDelActivo?.concesionario
          ? { valor: String(datosDelActivo.concesionario), texto: datosDelActivo.concesionario_nombre || "Concesionario actual" }
          : null,
      ),
    [catalogos.concesionarios, datosDelActivo],
  );
  const pedirCustodio = useCallback((q) => organizacionService.empleados(q), []);
  const pedirSolicitante = useCallback((q) => organizacionService.todosLosEmpleados(q), []);

  const estadoCaracteristicas = valores.tipo && caracteristicas.tipo !== valores.tipo ? "cargando" : caracteristicas.estado;
  const declaradas = estadoCaracteristicas === "listo" ? caracteristicas.lista : [];
  const conParesLibres = Boolean(valores.tipo) && estadoCaracteristicas === "listo" && declaradas.length === 0;
  const heredadas = declaradas.length ? especificacionesHeredadas(valores.especificaciones, declaradas) : [];
  const erroresEspec = errores.especificaciones && typeof errores.especificaciones === "object" ? errores.especificaciones : {};
  const errorEspecGeneral = typeof errores.especificaciones === "string" ? errores.especificaciones : null;

  /** El error de un campo: el del servidor o la validación, o el de su
   * catálogo (como `errorDe` de la web). */
  function errorDe(campo) {
    return errores[campo] || catalogos.fallos[campo];
  }

  function fijar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function fijarEspecificacion(nombre, valor) {
    setValores((v) => {
      const siguiente = { ...v.especificaciones };
      if (valor === "" || valor === null || valor === undefined) delete siguiente[nombre];
      else siguiente[nombre] = valor;
      return { ...v, especificaciones: siguiente };
    });
    // A partir del estado previo (QA-TECH P3 #2), también el error general.
    setErrores((e) => {
      const previo = e.especificaciones;
      if (typeof previo === "string") return { ...e, especificaciones: undefined };
      if (previo && typeof previo === "object" && previo[nombre]) return { ...e, especificaciones: { ...previo, [nombre]: undefined } };
      return e;
    });
  }

  async function cambiarTipo(nuevo) {
    const tipo = String(nuevo ?? "");
    if (tipo === valores.tipo) return;
    // En la edición se parte de lo guardado: lo que el tipo nuevo no
    // declare queda como «características anteriores», que el servidor
    // acepta porque ya estaban en el equipo.
    const base = esEdicion ? iniciales.especificaciones : {};
    if (valores.tipo && seVanAPerderEspecificaciones(valores, base)) {
      const nombre = opcionesDeTipo.find((o) => o.valor === valores.tipo)?.texto;
      if (!(await confirmarCambioDeTipo(nombre))) return;
      if (!montado.current) return;
    }
    setValores((v) => ({ ...v, tipo, especificaciones: { ...base } }));
    setErrores((e) => ({ ...e, tipo: undefined, especificaciones: undefined }));
  }

  function elegirCustodio(persona) {
    setPersonas((p) => ({ ...p, responsables: persona }));
    // El área se propone con la de quien lo recibe, si todavía no se eligió;
    // se anuncia y se dice junto al campo (UX H-04). Su error se limpia
    // (QA-TECH P3 #3).
    const area = opcionesDeArea.find((o) => o.valor === persona.departamento);
    const proponer = !valores.departamento && Boolean(area);
    setValores((v) => ({ ...v, responsables: [persona.id], departamento: proponer ? area.valor : v.departamento }));
    setErrores((e) => ({ ...e, responsables: undefined, ...(proponer ? { departamento: undefined } : {}) }));
    if (proponer) {
      setAreaPropuesta(true);
      anunciar(`Área propuesta: ${area.texto}. Puede cambiarla.`);
    }
  }

  function quitarCustodio() {
    setPersonas((p) => ({ ...p, responsables: null }));
    fijar("responsables", []);
  }

  function elegirSolicitante(persona) {
    setPersonas((p) => ({ ...p, solicitado_por: persona }));
    fijar("solicitado_por", persona.id);
  }

  function quitarSolicitante() {
    setPersonas((p) => ({ ...p, solicitado_por: null }));
    fijar("solicitado_por", "");
  }

  function mostrarErrores(campos, texto) {
    setInfo(null);
    if (DE_UBICACION.some((c) => campos[c])) setUbicacion(true);
    if (DE_LA_COMPRA.some((c) => campos[c])) setCompra(true);
    setErrores(campos);
    setError({ texto, clave: Date.now() });
    const primero = Object.keys(CAMPOS).find((c) =>
      c === "especificaciones"
        ? typeof campos.especificaciones === "string" || Object.values(campos.especificaciones ?? {}).some(Boolean)
        : campos[c],
    );
    if (primero === "especificaciones") {
      const nombre = declaradas.find((c) => campos.especificaciones?.[c.nombre])?.nombre;
      const libre = conParesLibres && typeof campos.especificaciones === "string";
      irA("especificaciones", { control: nombre ? `espec-${nombre}` : libre ? "espec-libre" : "especificaciones" });
    } else {
      irA(primero);
    }
  }

  function volverALaFicha() {
    if (typeof router.canGoBack === "function" && !router.canGoBack()) {
      router.replace({ pathname: "/activos/[id]", params: { id: String(id) } });
    } else {
      router.back();
    }
  }

  async function guardar() {
    if (!candado.tomar()) return;
    const encontrados = validarActivo(valores, {
      caracteristicas: declaradas,
      esEdicion,
      responsablesActuales: datosDelActivo?.responsables?.length ?? 0,
    });
    // QA-TECH P3 #1 y UX H-06: sin las características del tipo no se sabe
    // qué exigir. UX H-01/H-02: lo escrito y no confirmado no se pierde.
    if (valores.tipo && estadoCaracteristicas === "cargando") encontrados.especificaciones = TEXTO_CARACTERISTICAS_CARGANDO;
    else if (valores.tipo && estadoCaracteristicas === "error") encontrados.especificaciones = TEXTO_CARACTERISTICAS_SIN_CARGAR;
    else if (conParesLibres && pendientes.especificaciones) encontrados.especificaciones = TEXTO_CARACTERISTICA_SIN_AGREGAR;
    if (!esEdicion && pendientes.responsables) encontrados.responsables = TEXTO_BUSQUEDA_SIN_ELEGIR;
    if (!esEdicion && pendientes.solicitado_por) encontrados.solicitado_por = TEXTO_BUSQUEDA_SIN_ELEGIR;
    if (Object.keys(encontrados).length) {
      candado.soltar();
      mostrarErrores(encontrados, textoRevise(encontrados, CAMPOS));
      return;
    }
    const cuerpo = esEdicion ? cuerpoDeEdicion(iniciales, valores, declaradas) : cuerpoDeAlta(valores, declaradas);
    if (esEdicion && Object.keys(cuerpo).length === 0) {
      candado.soltar();
      setErrores({});
      setError(null);
      // UX H-07: no es un error, es información.
      setInfo(TEXTO_SIN_CAMBIOS_EN_LA_FICHA);
      anunciar(TEXTO_SIN_CAMBIOS_EN_LA_FICHA);
      irA();
      return;
    }
    if (!(await reenvio.confirmar())) {
      candado.soltar();
      return;
    }
    if (!montado.current) return;
    setErrores({});
    setError(null);
    setInfo(null);
    setEnviando(true);
    try {
      if (esEdicion) {
        await activosService.actualizar(id, cuerpo);
        if (!montado.current) return;
        reenvio.limpiar();
        dejarResultado(`activo-${id}`, { texto: "Ficha actualizada." });
        salir(volverALaFicha);
      } else {
        const creado = await activosService.crear(cuerpo);
        if (!montado.current) return;
        reenvio.limpiar();
        dejarResultado(`activo-${creado.id}`, { texto: textoDelAlta(creado), aviso: textoDelAvisoDeAlta(creado.aviso) });
        salir(() => router.replace({ pathname: "/activos/[id]", params: { id: String(creado.id) } }));
      }
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDeGuardado(e, esEdicion ? "No se pudo guardar la ficha." : "No se pudo registrar el activo.", CAMPOS);
      reenvio.marcar(fallo);
      const deEspec = erroresDeEspecificaciones(e);
      const hayDeEspec = Object.keys(deEspec).length > 0;
      const campos = hayDeEspec ? { ...fallo.campos, especificaciones: deEspec } : fallo.campos;
      // Con errores en las características, «Revise…» las nombra junto a los
      // demás campos, salvo que haya alguno que no se vea (ese se dice tal cual).
      const todosSeVen = Object.keys(fallo.campos).every((c) => CAMPOS[c]);
      const texto = hayDeEspec && todosSeVen ? textoRevise(campos, CAMPOS) : fallo.texto;
      mostrarErrores(campos, texto);
    } finally {
      candado.soltar();
      if (montado.current) setEnviando(false);
    }
  }

  if (!conPermiso) {
    return (
      <View style={estilos.centro}>
        <Alerta
          tipo="info"
          texto={esEdicion ? TEXTO_SIN_PERMISO_EDITAR_ACTIVO : TEXTO_SIN_PERMISO_REGISTRAR_ACTIVO}
          testID="sin-permiso-activo"
        />
      </View>
    );
  }
  if (activo.estado === "cargando") return <Cargando texto="Cargando la ficha…" />;
  if (activo.estado === "error") {
    return (
      <View style={estilos.centro}>
        <ErrorConReintento texto={activo.error} onReintentar={cargarActivo} />
      </View>
    );
  }
  if (catalogos.estado === "cargando") return <Cargando texto="Cargando los catálogos…" />;

  const hayFallos = Object.keys(catalogos.fallos).length > 0;
  const responsablesHoy = datosDelActivo?.responsables ?? [];
  // UX H-08: con varios responsables la marca no se puede quitar aquí.
  const bloqueaCompartido = esEdicion && responsablesHoy.length > 1 && iniciales.compartido && valores.compartido;
  // UX H-09: en la edición los títulos no dicen «(opcional)».
  const sufijo = esEdicion ? "" : " (opcional)";

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior="padding"
      enabled={Platform.OS === "android"}
      keyboardVerticalOffset={alturaCabecera}
    >
      <ScrollView
        ref={desplazable}
        testID={esEdicion ? "editar-ficha-tecnica" : "registrar-activo"}
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        automaticallyAdjustKeyboardInsets
      >
        {/* UX H-10: el título ya está en la cabecera de la pila. */}
        {esEdicion ? (
          <Text style={estilos.codigo} testID="codigo-en-edicion">
            {[datosDelActivo?.codigo_barras, datosDelActivo?.nombre].filter(Boolean).join(" · ")}
          </Text>
        ) : (
          <Text style={estilos.tenue}>El código de barras se genera automáticamente al guardar, a partir del tipo de dispositivo.</Text>
        )}
        {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="activo-error" /> : null}
        {info ? <Alerta tipo="info" texto={info} testID="activo-info" /> : null}
        <Text style={estilos.leyenda}>Los campos con * son obligatorios.</Text>

        <Text style={estilos.subtitulo} accessibilityRole="header">
          Identificación
        </Text>
        <View {...bloque("tipo")}>
          <SelectorDeLista
            testID="activo-tipo"
            refFoco={refFoco("tipo")}
            etiqueta="Tipo de dispositivo"
            obligatorio
            opciones={opcionesDeTipo}
            valor={valores.tipo}
            vacio="Seleccione un tipo"
            buscable
            error={errorDe("tipo")}
            deshabilitado={enviando}
            onCambio={cambiarTipo}
          />
        </View>
        <View {...bloque("nombre")}>
          <CampoTexto
            testID="activo-nombre"
            refFoco={refFoco("nombre")}
            etiqueta="Nombre del activo"
            obligatorio
            ayuda="Se imprime en la etiqueta, junto al código de barras."
            placeholder="Laptop Contabilidad 01"
            maximo={LARGOS.nombre}
            valor={valores.nombre}
            error={errores.nombre}
            deshabilitado={enviando}
            onCambio={(v) => fijar("nombre", v)}
          />
        </View>
        <View {...bloque("marca")}>
          <CampoTexto
            testID="activo-marca"
            refFoco={refFoco("marca")}
            etiqueta="Marca"
            obligatorio
            autoCorrect={false}
            maximo={LARGOS.marca}
            valor={valores.marca}
            error={errores.marca}
            deshabilitado={enviando}
            onCambio={(v) => fijar("marca", v)}
          />
        </View>
        <View {...bloque("modelo")}>
          <CampoTexto
            testID="activo-modelo"
            refFoco={refFoco("modelo")}
            etiqueta="Modelo"
            obligatorio
            autoCorrect={false}
            maximo={LARGOS.modelo}
            valor={valores.modelo}
            error={errores.modelo}
            deshabilitado={enviando}
            onCambio={(v) => fijar("modelo", v)}
          />
        </View>
        {/* UX H-15: el S/N se puede leer de la etiqueta del fabricante. */}
        <View {...bloque("numero_serie")} style={estilos.filaSerie}>
          <View style={estilos.textos}>
            <CampoTexto
              testID="activo-serie"
              refFoco={refFoco("numero_serie")}
              etiqueta="Número de serie"
              obligatorio
              ayuda="No se repite en el inventario de la empresa."
              autoCorrect={false}
              autoCapitalize="characters"
              autoComplete="off"
              maximo={LARGOS.numero_serie}
              valor={valores.numero_serie}
              error={errores.numero_serie}
              deshabilitado={enviando}
              onCambio={(v) => fijar("numero_serie", v)}
            />
          </View>
          <BotonEscanearSerie
            deshabilitado={enviando}
            onLeido={(texto) => {
              fijar("numero_serie", texto);
              anunciar(`Número de serie leído: ${texto}`);
            }}
          />
        </View>

        {valores.tipo ? (
          <View {...bloque("especificaciones")} style={estilos.campo} testID="caracteristicas">
            <Text ref={refFoco("especificaciones")} style={estilos.subtitulo} accessibilityRole="header">
              {declaradas.length > 0 ? "Características del equipo" : "Especificaciones del hardware"}
            </Text>
            {conParesLibres ? null : <ErrorDeCampo error={errorEspecGeneral} />}
            {estadoCaracteristicas === "cargando" ? (
              <View style={estilos.linea} accessibilityLiveRegion="polite">
                <ActivityIndicator color={colores.primario} />
                <Text style={estilos.tenue}>Cargando las características del tipo…</Text>
              </View>
            ) : null}
            {estadoCaracteristicas === "error" ? (
              <ErrorConReintento texto={caracteristicas.error} onReintentar={() => setVezCaracteristicas((v) => v + 1)} />
            ) : null}
            {declaradas.length > 0 ? (
              <>
                <Text style={estilos.tenue}>Las que declara el tipo. Las marcadas con * son obligatorias.</Text>
                {declaradas.map((c) => (
                  <CampoDeCaracteristica
                    key={c.id}
                    c={c}
                    refFoco={refFoco(`espec-${c.nombre}`)}
                    valor={valores.especificaciones?.[c.nombre]}
                    error={erroresEspec[c.nombre]}
                    deshabilitado={enviando}
                    onCambio={(v) => fijarEspecificacion(c.nombre, v)}
                  />
                ))}
              </>
            ) : null}
            {conParesLibres ? (
              <EspecificacionesLibres
                valor={valores.especificaciones}
                refFoco={refFoco("espec-libre")}
                error={errorEspecGeneral}
                onPendiente={pendienteDe.especificaciones}
                deshabilitado={enviando}
                onCambio={(v) => fijar("especificaciones", v)}
              />
            ) : null}
            {heredadas.length > 0 ? (
              <View style={estilos.campo} testID="caracteristicas-anteriores">
                <Text style={estilos.subtituloChico} accessibilityRole="header">
                  Características anteriores
                </Text>
                <Text style={estilos.tenue}>
                  Este equipo las tenía antes de que el tipo declarara las suyas. Se conservan tal como están; puede quitarlas.
                </Text>
                {heredadas.map(([nombre, dato]) => (
                  <Par
                    key={nombre}
                    prefijo="espec-anterior"
                    nombre={nombre}
                    valor={dato}
                    error={erroresEspec[nombre]}
                    deshabilitado={enviando}
                    onQuitar={() => fijarEspecificacion(nombre, "")}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <Text style={estilos.subtitulo} accessibilityRole="header">
          Custodia
        </Text>
        {esEdicion ? (
          <View style={estilos.bloqueado} testID="custodia-en-la-ficha">
            <Icono nombre="lock-outline" size={20} color={colores.tintaSuave} />
            <View style={estilos.textos}>
              <Text style={estilos.dato}>{`Responde: ${datosDelActivo?.responsables_resumen || "nadie (en bodega)"}`}</Text>
              <Text style={estilos.dato}>{`Área: ${datosDelActivo?.departamento_nombre || "sin área"}`}</Text>
              <Text style={estilos.tenue}>
                Quién responde y el área se cambian desde la ficha, con «Asignar»: así el cambio queda registrado en el historial.
              </Text>
            </View>
          </View>
        ) : null}
        {!esEdicion ? (
          <View {...bloque("responsables")}>
            <ElegirEmpleado
              testID="activo-custodio"
              refFoco={refFoco("responsables")}
              etiqueta="Custodio"
              ayuda={
                personas.responsables
                  ? valores.compartido
                    ? "A los demás se los suma desde la ficha, con «Asignar»: cada entrega deja su acta."
                    : undefined
                  : "Sin custodio, el equipo queda en bodega."
              }
              pedir={pedirCustodio}
              elegida={personas.responsables}
              error={errores.responsables}
              deshabilitado={enviando}
              onPendiente={pendienteDe.responsables}
              onElegir={elegirCustodio}
              onQuitar={quitarCustodio}
            />
          </View>
        ) : null}
        {!esEdicion ? (
          <View {...bloque("departamento")}>
            <SelectorDeLista
              testID="activo-area"
              refFoco={refFoco("departamento")}
              etiqueta="Área"
              obligatorio
              ayuda={areaPropuesta ? TEXTO_AREA_PROPUESTA : undefined}
              opciones={opcionesDeArea}
              valor={valores.departamento}
              vacio="Seleccione un área"
              buscable
              error={errorDe("departamento")}
              deshabilitado={enviando}
              onCambio={(v) => {
                setAreaPropuesta(false);
                fijar("departamento", String(v ?? ""));
              }}
            />
          </View>
        ) : null}
        {!esEdicion ? (
          <View {...bloque("solicitado_por")}>
            <ElegirEmpleado
              testID="activo-solicitante"
              refFoco={refFoco("solicitado_por")}
              etiqueta="Lo pidió"
              ayuda={
                personas.solicitado_por
                  ? "Se le avisará por correo de que el equipo ya llegó."
                  : "Si alguien lo pidió, anótelo y se le avisará al registrarlo. Vacío: es una compra de reposición."
              }
              pedir={pedirSolicitante}
              elegida={personas.solicitado_por}
              error={errores.solicitado_por}
              deshabilitado={enviando}
              onPendiente={pendienteDe.solicitado_por}
              onElegir={elegirSolicitante}
              onQuitar={quitarSolicitante}
            />
          </View>
        ) : null}
        <View {...bloque("compartido")}>
          <Casilla
            testID="activo-compartido"
            refFoco={refFoco("compartido")}
            etiqueta="Varias personas responden por él"
            ayuda={
              bloqueaCompartido
                ? `No se puede quitar: responden por él ${responsablesHoy.length} personas. Deje una sola con «Asignar» y luego quite la marca aquí.`
                : "Solo para equipos de turno, como un escáner de andén o una impresora de mostrador."
            }
            marcada={valores.compartido}
            error={errores.compartido}
            deshabilitado={enviando || bloqueaCompartido}
            onCambio={(v) => fijar("compartido", v)}
          />
        </View>

        <Text style={estilos.subtitulo} accessibilityRole="header">
          Adquisición
        </Text>
        <View {...bloque("fecha_adquisicion")}>
          <SelectorFecha
            testID="activo-fecha-adquisicion"
            refFoco={refFoco("fecha_adquisicion")}
            etiqueta="Fecha de adquisición"
            obligatorio
            ayuda="Base del cálculo de vida útil del equipo."
            valor={valores.fecha_adquisicion}
            error={errores.fecha_adquisicion}
            deshabilitado={enviando}
            onCambio={(v) => fijar("fecha_adquisicion", v)}
          />
        </View>

        {/* Lo opcional, plegado; se abre solo si tiene errores. Cada bloque
            sigue siendo hijo directo del ScrollView: `useIrAlBloque` mide
            contra él. */}
        <Desplegable titulo={`Ubicación y clasificación${sufijo}`} abierto={ubicacion} onCambiar={setUbicacion} testID="mas-ubicacion" />
        {ubicacion ? (
          <View {...bloque("sede")}>
            <SelectorDeLista
              testID="activo-sede"
              refFoco={refFoco("sede")}
              etiqueta="Sede"
              opcional
              ayuda="Se administra en Organización → Sedes."
              opciones={opcionesDeSede}
              valor={valores.sede}
              vacio="Sin sede registrada"
              conVacio
              buscable
              error={errorDe("sede")}
              deshabilitado={enviando}
              onCambio={(v) => fijar("sede", String(v ?? ""))}
            />
          </View>
        ) : null}
        {ubicacion ? (
          <View {...bloque("criticidad")}>
            <OpcionesEnLinea
              testID="activo-criticidad"
              refFoco={refFoco("criticidad")}
              etiqueta="Criticidad"
              ayuda="Qué tan urgente es reponerlo si falla."
              opciones={CRITICIDADES}
              valor={valores.criticidad}
              error={errores.criticidad}
              deshabilitado={enviando}
              onCambio={(v) => fijar("criticidad", v)}
            />
          </View>
        ) : null}
        {ubicacion ? (
          <View {...bloque("uso")}>
            <SelectorDeLista
              testID="activo-uso"
              refFoco={refFoco("uso")}
              etiqueta="Uso"
              ayuda="La función que cumple, no cuánto se usa."
              opciones={USOS}
              valor={valores.uso}
              error={errores.uso}
              deshabilitado={enviando}
              onCambio={(v) => fijar("uso", String(v ?? "administrativo"))}
            />
          </View>
        ) : null}

        <Desplegable titulo={`Compra y garantía${sufijo}`} abierto={compra} onCambiar={setCompra} testID="mas-compra" />
        {compra ? (
          <View {...bloque("fecha_ingreso")} style={estilos.campo}>
            <SelectorFecha
              testID="activo-fecha-ingreso"
              refFoco={refFoco("fecha_ingreso")}
              etiqueta="Fecha de ingreso"
              ayuda="Cuándo entró al inventario, si es distinta de la compra."
              valor={valores.fecha_ingreso}
              minimo={valores.fecha_adquisicion || undefined}
              error={errores.fecha_ingreso}
              deshabilitado={enviando}
              onCambio={(v) => fijar("fecha_ingreso", v)}
            />
            {valores.fecha_ingreso ? (
              <Boton
                testID="quitar-fecha-ingreso"
                titulo="Quitar la fecha de ingreso"
                icono="calendar-remove"
                variante="secundario"
                deshabilitado={enviando}
                onPress={() => fijar("fecha_ingreso", "")}
              />
            ) : null}
          </View>
        ) : null}
        {compra ? (
          <View {...bloque("costo_adquisicion")}>
            <CampoTexto
              testID="activo-costo"
              refFoco={refFoco("costo_adquisicion")}
              etiqueta="Costo de compra (USD)"
              opcional
              teclado="decimal-pad"
              maximo={14}
              valor={valores.costo_adquisicion}
              error={errores.costo_adquisicion}
              deshabilitado={enviando}
              onCambio={(v) => fijar("costo_adquisicion", v)}
            />
          </View>
        ) : null}
        {compra ? (
          <View {...bloque("condicion")}>
            <OpcionesEnLinea
              testID="activo-condicion"
              refFoco={refFoco("condicion")}
              etiqueta="Condición al adquirirlo"
              ayuda="Si se compró nuevo o se adquirió de segunda mano."
              opciones={CONDICIONES}
              valor={valores.condicion}
              error={errores.condicion}
              deshabilitado={enviando}
              onCambio={(v) => fijar("condicion", v)}
            />
          </View>
        ) : null}
        {compra ? (
          <View {...bloque("proveedor")}>
            <SelectorDeLista
              testID="activo-proveedor"
              refFoco={refFoco("proveedor")}
              etiqueta="Proveedor"
              opcional
              ayuda="Se administra en Organización → Proveedores."
              opciones={opcionesDeProveedor}
              valor={valores.proveedor}
              vacio="Sin proveedor registrado"
              conVacio
              buscable
              error={errorDe("proveedor")}
              deshabilitado={enviando}
              onCambio={(v) => fijar("proveedor", String(v ?? ""))}
            />
          </View>
        ) : null}
        {compra ? (
          <View {...bloque("propiedad")}>
            <OpcionesEnLinea
              testID="activo-propiedad"
              refFoco={refFoco("propiedad")}
              etiqueta="De quién es el equipo"
              ayuda="En concesión: lo compró un partner y lo mantenemos nosotros."
              opciones={PROPIEDADES}
              valor={valores.propiedad}
              error={errores.propiedad}
              deshabilitado={enviando}
              onCambio={(v) => fijar("propiedad", v)}
            />
          </View>
        ) : null}
        {compra && valores.propiedad === "concesion" ? (
          <View {...bloque("concesionario")}>
            <SelectorDeLista
              testID="activo-concesionario"
              refFoco={refFoco("concesionario")}
              etiqueta="Concesionario"
              obligatorio
              ayuda="Se administra en Organización → Concesionarios."
              opciones={opcionesDeConcesionario}
              valor={valores.concesionario}
              vacio="Elija el partner"
              buscable
              error={errorDe("concesionario")}
              deshabilitado={enviando}
              onCambio={(v) => fijar("concesionario", String(v ?? ""))}
            />
          </View>
        ) : null}
        {compra ? (
          <View {...bloque("fecha_fin_garantia")} style={estilos.campo}>
            <SelectorFecha
              testID="activo-fin-garantia"
              refFoco={refFoco("fecha_fin_garantia")}
              etiqueta="Fin de garantía"
              ayuda="Déjelo vacío si el equipo no tiene garantía registrada."
              valor={valores.fecha_fin_garantia}
              minimo={valores.fecha_adquisicion || undefined}
              error={errores.fecha_fin_garantia}
              deshabilitado={enviando}
              onCambio={(v) => fijar("fecha_fin_garantia", v)}
            />
            {valores.fecha_fin_garantia ? (
              <Boton
                testID="quitar-fin-garantia"
                titulo="Quitar el fin de garantía"
                icono="calendar-remove"
                variante="secundario"
                deshabilitado={enviando}
                onPress={() => fijar("fecha_fin_garantia", "")}
              />
            ) : null}
          </View>
        ) : null}
        {compra ? (
          <View {...bloque("observaciones")}>
            <CampoTexto
              testID="activo-observaciones"
              refFoco={refFoco("observaciones")}
              etiqueta="Observaciones"
              opcional
              multilinea
              valor={valores.observaciones}
              error={errores.observaciones}
              deshabilitado={enviando}
              onCambio={(v) => fijar("observaciones", v)}
            />
          </View>
        ) : null}

        {hayFallos ? (
          <Boton
            testID="recargar-catalogos"
            titulo="Volver a cargar los catálogos"
            icono="refresh"
            variante="secundario"
            cargando={catalogos.estado === "recargando"}
            onPress={cargarCatalogos}
          />
        ) : null}

        <Boton
          testID="guardar-activo"
          titulo={enviando ? "Guardando…" : esEdicion ? "Guardar cambios" : "Registrar activo"}
          icono="check"
          cargando={enviando}
          onPress={guardar}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const fabricaDeEstilos = (colores, CONTROLES) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 16, paddingBottom: 40 },
  centro: { padding: 16 },
  codigo: { fontSize: 14, fontWeight: "600", color: colores.tintaSuave },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.titulo },
  subtituloChico: { fontSize: 15, fontWeight: "700", color: colores.titulo },
  campo: { gap: 8 },
  leyenda: { fontSize: 14, color: colores.tintaSuave },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  opcional: { fontSize: 14, fontWeight: "400", color: colores.tintaSuave },
  dato: { fontSize: 15, color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  linea: { flexDirection: "row", alignItems: "center", gap: 6 },
  textos: { flex: 1, gap: 2 },
  entrada: CONTROLES.entrada,
  entradaConError: CONTROLES.entradaConError,
  opcion: CONTROLES.opcion,
  opcionTexto: { ...CONTROLES.opcionTexto, fontWeight: "600" },
  presionada: { backgroundColor: colores.realce },
  elegida: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colores.primario,
    backgroundColor: colores.realce,
  },
  par: {
    gap: 4,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  parFila: { flexDirection: "row", alignItems: "center", gap: 8 },
  filaSerie: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  // UX H-16: lo que aquí no se edita, como un dato bloqueado.
  bloqueado: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 8,
    backgroundColor: colores.hundido,
  },
});
