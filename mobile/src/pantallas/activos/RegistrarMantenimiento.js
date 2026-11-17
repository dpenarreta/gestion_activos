import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { activosService, mantenimientosService } from "../../api/servicios";
import { dejarResultado } from "../../activos/avisoPendiente";
import { dinero, ESPERA_BUSCAR_MS, estaOperativo, mensajeDeActivos, TEXTO_NO_DISPONIBLE } from "../../activos/formato";
import {
  CAUSAS_SUGERIDAS,
  cuerpoDelComponente,
  cuerpoDelRegistro,
  diasEntre,
  erroresDeLineas,
  ESTADOS_FINALES,
  FINALES_SIN_VUELTA,
  hayCambiosEnElRegistro,
  hoyIso,
  LARGO_CAUSA,
  LARGO_RESPONSABLE,
  LARGO_SERIE,
  lineaDe,
  piezasCriticas,
  quienRecibeElAviso,
  TEXTO_SIN_VUELTA,
  textoDelAvisoDeMantenimiento,
  TIPOS_DE_MANTENIMIENTO,
  TIPOS_DE_RESPONSABLE,
  totalDeRepuestos,
  validarComponenteNuevo,
  validarLineas,
  validarRegistro,
  valoresIniciales,
} from "../../activos/mantenimientos";
import { Alerta, Boton, BotonIcono, Cargando, Desplegable, ErrorConReintento } from "../../componentes/comunes";
import { confirmarDescarte } from "../../componentes/confirmarDescarte";
import { Icono } from "../../componentes/Icono";
import { Casilla, ErrorDeCampo, OpcionesEnLinea } from "../../componentes/Selectores";
import { SelectorFecha } from "../../componentes/SelectorFecha";
import { Ventana } from "../../componentes/Ventana";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { useSesion } from "../../sesion/SesionContext";
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { fechaCorta } from "../../utils/fechas";
import { CampoTexto } from "../permisos/piezas";
import { errorDeGuardado, textoRevise, useCandado, useReenvioConfirmado, useSalirConCambios } from "./formularios";
import { rutaDelMantenimiento } from "./Mantenimientos";
import { EstadoDelActivo, useMontado } from "./piezas";

export const TEXTO_SIN_PERMISO_REGISTRAR = "No tiene permiso para registrar mantenimientos en esta empresa.";
export const TEXTO_NO_OPERATIVO = "Este activo está fuera de inventario: no se le registran mantenimientos.";

/** Los campos en el orden de la pantalla, con su nombre para «Revise…». */
const CAMPOS = {
  activo: "Equipo",
  tipo: "Tipo",
  fecha_intervencion: "Fecha de ingreso",
  tipo_responsable: "A cargo de",
  responsable: "Técnico o proveedor",
  descripcion: "Trabajo realizado",
  fecha_salida: "Fecha de salida",
  solucion: "Solución aplicada",
  estado_final: "Estado final",
  causa: "Causa de la falla",
  diagnostico: "Diagnóstico",
  garantia_usada: "Cubierto por garantía",
  costo_mano_obra: "Costo de mano de obra",
  componentes: "Repuestos",
};

/** Lo que va en «Más detalles (opcional)» y en «¿Ya salió?»: con un error,
 * su bloque se abre solo (UX H-03). */
const DE_MAS_DETALLES = ["causa", "diagnostico", "garantia_usada", "costo_mano_obra"];
const DE_LA_SALIDA = ["fecha_salida", "solucion", "estado_final"];

const SALIO = [
  { valor: "no", texto: "No, sigue en reparación" },
  { valor: "si", texto: "Sí, ya salió" },
];

function resultados(datos) {
  if (Array.isArray(datos)) return datos;
  return Array.isArray(datos?.results) ? datos.results : [];
}

function resumenDelActivo(a) {
  return [a?.codigo_barras, a?.nombre].filter(Boolean).join(" · ");
}

/** Un buscador que pide al servidor con 400 ms de espera. `pedir(q)`
 * devuelve la página; `inicial`: si pide también sin texto. */
function useBusquedaRemota(pedir, { inicial = false, mensaje }) {
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState({ cargando: false, lista: [], error: null, hecha: false });
  const [vez, setVez] = useState(0);
  const montado = useMontado();

  useEffect(() => {
    const q = texto.trim();
    if (!q && !inicial) {
      setEstado({ cargando: false, lista: [], error: null, hecha: false });
      return undefined;
    }
    let vigente = true;
    setEstado((s) => ({ ...s, cargando: true, error: null }));
    const pausa = setTimeout(
      () => {
        pedir(q)
          .then((datos) => {
            if (vigente && montado.current) setEstado({ cargando: false, lista: resultados(datos), error: null, hecha: true });
          })
          .catch((e) => {
            if (vigente && montado.current) setEstado({ cargando: false, lista: [], error: mensajeDeActivos(e, mensaje), hecha: true });
          });
      },
      q ? ESPERA_BUSCAR_MS : 0,
    );
    return () => {
      vigente = false;
      clearTimeout(pausa);
    };
  }, [texto, vez, pedir, inicial, mensaje, montado]);

  return { texto, setTexto, estado, reintentar: () => setVez((v) => v + 1) };
}

// --- Elegir el activo ---------------------------------------------------------------

/** Sin `?activo=` (desde la lista, CA-14): un buscador de los activos
 * operativos (`GET activos/?operativos=true&q=`). */
function BuscadorDeActivo({ onElegir, error, refFoco, deshabilitado }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const pedir = useCallback((q) => activosService.buscarOperativos(q), []);
  const { texto, setTexto, estado, reintentar } = useBusquedaRemota(pedir, { mensaje: "No se pudo buscar el equipo." });
  return (
    <View style={estilos.campo}>
      <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
        Equipo <Text style={estilos.obligatorio}>*</Text>
      </Text>
      <TextInput
        ref={refFoco}
        testID="buscar-equipo"
        value={texto}
        onChangeText={setTexto}
        editable={!deshabilitado}
        placeholder="Código de barras, serie o nombre"
        placeholderTextColor={colores.tintaTenue}
        accessibilityLabel={`Equipo (obligatorio). Buscar por código de barras, serie o nombre${error ? `. Error: ${error}` : ""}`}
        autoCorrect={false}
        autoCapitalize="none"
        style={[estilos.entrada, error && estilos.entradaConError]}
      />
      <ErrorDeCampo error={error} />
      {estado.cargando ? (
        <View style={estilos.linea} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colores.primario} />
          <Text style={estilos.tenue}>Buscando…</Text>
        </View>
      ) : null}
      {estado.error ? <ErrorConReintento texto={estado.error} onReintentar={reintentar} /> : null}
      {!estado.cargando && !estado.error && estado.hecha && texto.trim() && estado.lista.length === 0 ? (
        <Text style={estilos.tenue} accessibilityLiveRegion="polite">{`Ningún equipo operativo coincide con «${texto.trim()}».`}</Text>
      ) : null}
      {estado.lista.map((a) => (
        <Pressable
          key={a.id}
          testID={`equipo-${a.id}`}
          onPress={() => {
            onElegir(a);
            setTexto("");
          }}
          disabled={deshabilitado}
          accessibilityRole="button"
          accessibilityLabel={`${resumenDelActivo(a)}${a.responsables_resumen ? `. Responsable: ${a.responsables_resumen}` : ""}`}
          accessibilityHint="Lo elige para el mantenimiento"
          style={({ pressed }) => [estilos.opcion, pressed && estilos.presionada]}
        >
          <Icono nombre="monitor" size={20} color={colores.primario} />
          <View style={estilos.textos}>
            <Text style={estilos.opcionTexto}>{resumenDelActivo(a)}</Text>
            {a.responsables_resumen ? <Text style={estilos.tenue}>{a.responsables_resumen}</Text> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// --- Elegir o crear un componente (CA-15) -------------------------------------------

const CAMPOS_COMPONENTE = { nombre: "Nombre", codigo: "Código", descripcion: "Descripción" };

/**
 * Elegir un repuesto del catálogo (`GET mantenimientos/componentes/?q=`, solo
 * los activos) y, con `mantenimientos.componentes`, «Crear componente»
 * (`POST mantenimientos/componentes/`), que lo deja elegido.
 */
function VentanaDeComponente({ puedeCrear, onElegir, onCerrar }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const pedir = useCallback((q) => mantenimientosService.componentes(q), []);
  const { texto, setTexto, estado, reintentar } = useBusquedaRemota(pedir, {
    inicial: true,
    mensaje: "No se pudo cargar el catálogo de componentes.",
  });
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: "", codigo: "", descripcion: "", es_critico: false });
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const montado = useMontado();
  const candado = useCandado();
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const disponibles = estado.lista.filter((c) => c.activo !== false);
  const conCambios = creando && (nuevo.nombre.trim() || nuevo.codigo.trim() || nuevo.descripcion.trim());

  async function cerrar() {
    if (guardando) return;
    if (conCambios && !(await confirmarDescarte())) return;
    onCerrar();
  }

  function fijar(campo, valor) {
    setNuevo((n) => ({ ...n, [campo]: valor }));
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function abrirCrear() {
    setCreando(true);
    setNuevo((n) => ({ ...n, nombre: n.nombre || texto.trim() }));
    irA("crear", { foco: false });
  }

  async function crear() {
    if (!candado.tomar()) return;
    const encontrados = validarComponenteNuevo(nuevo);
    if (Object.keys(encontrados).length) {
      candado.soltar();
      setErrores(encontrados);
      setError({ texto: textoRevise(encontrados, CAMPOS_COMPONENTE), clave: Date.now() });
      irA(Object.keys(CAMPOS_COMPONENTE).find((c) => encontrados[c]));
      return;
    }
    setErrores({});
    setError(null);
    setGuardando(true);
    try {
      const creado = await mantenimientosService.crearComponente(cuerpoDelComponente(nuevo));
      if (!montado.current) return;
      onElegir(creado, `Componente creado: ${creado?.nombre ?? nuevo.nombre.trim()}.`);
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDeGuardado(e, "No se pudo crear el componente.", CAMPOS_COMPONENTE);
      setErrores(fallo.campos);
      setError({ texto: fallo.texto, clave: fallo.clave });
      irA(Object.keys(CAMPOS_COMPONENTE).find((c) => fallo.campos[c]) ?? "crear");
    } finally {
      candado.soltar();
      if (montado.current) setGuardando(false);
    }
  }

  return (
    <Ventana titulo="Agregar repuesto" onCerrar={cerrar} ocupada={guardando} refDesplazable={desplazable} testID="ventana-componente">
      <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
        Buscar en el catálogo
      </Text>
      <TextInput
        testID="buscar-componente"
        value={texto}
        onChangeText={setTexto}
        placeholder="Nombre o código del repuesto"
        placeholderTextColor={colores.tintaTenue}
        accessibilityLabel="Buscar en el catálogo de componentes por nombre o código"
        autoCorrect={false}
        style={estilos.entrada}
      />
      {estado.cargando ? (
        <View style={estilos.linea} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colores.primario} />
          <Text style={estilos.tenue}>Buscando…</Text>
        </View>
      ) : null}
      {estado.error ? <ErrorConReintento texto={estado.error} onReintentar={reintentar} /> : null}
      {!estado.cargando && !estado.error && estado.hecha && disponibles.length === 0 ? (
        <Text style={estilos.tenue} accessibilityLiveRegion="polite">
          {texto.trim() ? `Ningún componente coincide con «${texto.trim()}».` : "El catálogo de componentes está vacío."}
        </Text>
      ) : null}
      {disponibles.map((c) => (
        <Pressable
          key={c.id}
          testID={`componente-${c.id}`}
          onPress={() => onElegir(c)}
          disabled={guardando}
          accessibilityRole="button"
          accessibilityLabel={`${c.nombre}${c.codigo ? `, código ${c.codigo}` : ""}${c.es_critico ? ". Pieza crítica" : ""}`}
          accessibilityHint="Lo agrega a los repuestos"
          style={({ pressed }) => [estilos.opcion, pressed && estilos.presionada]}
        >
          <Icono nombre="plus-circle-outline" size={20} color={colores.primario} />
          <View style={estilos.textos}>
            <Text style={estilos.opcionTexto}>{c.nombre}</Text>
            <Text style={estilos.tenue}>{[c.codigo, c.es_critico ? "Pieza crítica" : null].filter(Boolean).join(" · ")}</Text>
          </View>
        </Pressable>
      ))}
      {puedeCrear ? (
        <View {...bloque("crear")} style={estilos.crear}>
          {!creando ? (
            <Boton
              testID="crear-componente"
              titulo="Crear componente"
              icono="plus"
              variante="secundario"
              pista="Si el repuesto no está en el catálogo, lo crea y lo deja elegido"
              onPress={abrirCrear}
            />
          ) : (
            <>
              <Text style={estilos.subtitulo} accessibilityRole="header">
                Crear componente
              </Text>
              {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="componente-error" /> : null}
              <View {...bloque("nombre")}>
                <CampoTexto
                  testID="componente-nombre"
                  refFoco={refFoco("nombre")}
                  etiqueta="Nombre"
                  obligatorio
                  maximo={150}
                  valor={nuevo.nombre}
                  error={errores.nombre}
                  deshabilitado={guardando}
                  onCambio={(v) => fijar("nombre", v)}
                />
              </View>
              <View {...bloque("codigo")}>
                <CampoTexto
                  testID="componente-codigo"
                  refFoco={refFoco("codigo")}
                  etiqueta="Código"
                  obligatorio
                  ayuda="Corto y único, por ejemplo DISCO-SSD. Se guarda en mayúsculas."
                  maximo={30}
                  valor={nuevo.codigo}
                  error={errores.codigo}
                  deshabilitado={guardando}
                  onCambio={(v) => fijar("codigo", v)}
                />
              </View>
              <View {...bloque("descripcion")}>
                <CampoTexto
                  testID="componente-descripcion"
                  refFoco={refFoco("descripcion")}
                  etiqueta="Descripción"
                  opcional
                  multilinea
                  valor={nuevo.descripcion}
                  error={errores.descripcion}
                  deshabilitado={guardando}
                  onCambio={(v) => fijar("descripcion", v)}
                />
              </View>
              <Casilla
                testID="componente-critico"
                etiqueta="Es una pieza crítica"
                ayuda="Su reemplazo cuenta para la sugerencia de renovación del equipo (tarjeta madre, disco, fuente de poder…)."
                marcada={nuevo.es_critico}
                onCambio={(v) => fijar("es_critico", v)}
              />
              <Boton
                testID="guardar-componente"
                titulo={guardando ? "Creando…" : "Crear y elegir"}
                icono="check"
                cargando={guardando}
                onPress={crear}
              />
            </>
          )}
        </View>
      ) : (
        <Text style={estilos.tenue}>Si el repuesto no está en el catálogo, pida a Sistemas que lo agregue.</Text>
      )}
      <Boton testID="cancelar-componente" titulo="Cancelar" variante="secundario" deshabilitado={guardando} onPress={cerrar} />
    </Ventana>
  );
}

// --- Una línea de repuesto ----------------------------------------------------------

function LineaDeRepuesto({ linea, indice, errores = {}, onCambio, onQuitar, deshabilitado, refFoco }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const nombre = `${linea.nombre}${linea.codigo ? ` (${linea.codigo})` : ""}`;
  return (
    <View style={estilos.repuesto} testID={`linea-${indice}`}>
      <View style={estilos.repuestoCabecera}>
        <View ref={refFoco} accessible accessibilityLabel={`Repuesto ${indice + 1}: ${nombre}${linea.critico ? ". Pieza crítica" : ""}`} style={estilos.textos}>
          <Text style={estilos.opcionTexto}>{nombre}</Text>
          {linea.critico ? (
            <View style={estilos.linea}>
              <Icono nombre="alert-decagram-outline" size={16} color={colores.avisoTexto} />
              <Text style={estilos.critico}>Pieza crítica: cuenta para la renovación</Text>
            </View>
          ) : null}
        </View>
        <BotonIcono
          testID={`quitar-linea-${indice}`}
          icono="delete-outline"
          color={colores.malTexto}
          etiqueta={`Quitar el repuesto ${nombre}`}
          deshabilitado={deshabilitado}
          onPress={onQuitar}
        />
      </View>
      <View style={estilos.fila}>
        <View style={estilos.mitad}>
          <CampoTexto
            testID={`linea-${indice}-cantidad`}
            etiqueta="Cantidad"
            obligatorio
            teclado="number-pad"
            maximo={6}
            valor={linea.cantidad}
            error={errores.cantidad}
            deshabilitado={deshabilitado}
            onCambio={(v) => onCambio("cantidad", v)}
          />
        </View>
        <View style={estilos.mitad}>
          <CampoTexto
            testID={`linea-${indice}-costo`}
            etiqueta="Costo unitario"
            opcional
            teclado="decimal-pad"
            maximo={14}
            valor={linea.costo_unitario}
            error={errores.costo_unitario}
            deshabilitado={deshabilitado}
            onCambio={(v) => onCambio("costo_unitario", v)}
          />
        </View>
      </View>
      <CampoTexto
        testID={`linea-${indice}-serie`}
        etiqueta="Número de serie nuevo"
        opcional
        maximo={LARGO_SERIE}
        valor={linea.numero_serie_nuevo}
        error={errores.numero_serie_nuevo}
        deshabilitado={deshabilitado}
        onCambio={(v) => onCambio("numero_serie_nuevo", v)}
      />
      <CampoTexto
        testID={`linea-${indice}-observaciones`}
        etiqueta="Observaciones"
        opcional
        valor={linea.observaciones}
        error={errores.observaciones}
        deshabilitado={deshabilitado}
        onCambio={(v) => onCambio("observaciones", v)}
      />
      <ErrorDeCampo error={errores.componente} />
    </View>
  );
}

// --- La pantalla --------------------------------------------------------------------

/**
 * «Registrar mantenimiento» (US-022, CA-14 y CA-15), como `MantenimientoForm`
 * de la web: el equipo (de la ficha o el escáner con `?activo=`, o elegido
 * con un buscador), el tipo, la fecha de ingreso (no futura ni anterior a la
 * compra), quién lo hizo, el trabajo realizado y lo opcional (causa,
 * diagnóstico, solución, salida, estado final, garantía, mano de obra), más
 * los repuestos del catálogo. Envía `POST mantenimientos/`; si queda abierto,
 * el servidor pasa el equipo a «En reparación».
 *
 * Un solo envío aunque se toque dos veces; los 400 junto a su campo (también
 * en cada repuesto); sin respuesta clara, «puede haberse guardado»; salir con
 * cambios pregunta. Al guardar se abre el detalle del mantenimiento.
 */
export function RegistrarMantenimiento({ activoId = null }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const router = useRouter();
  const alturaCabecera = useAlturaCabecera();
  const { usuario } = useSesion();
  const permisos = usuario?.permissions ?? [];
  const puedeRegistrar = permisos.includes("mantenimientos.registrar");
  const puedeCrearComponente = permisos.includes("mantenimientos.componentes");
  const [hoy] = useState(() => hoyIso());
  const [iniciales] = useState(() => valoresIniciales(hoy));
  const [valores, setValores] = useState(iniciales);
  const [lineas, setLineas] = useState([]);
  const [erroresLineas, setErroresLineas] = useState([]);
  const [activo, setActivo] = useState(null);
  const [cargaActivo, setCargaActivo] = useState({ estado: activoId ? "cargando" : "listo", error: null });
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [ventana, setVentana] = useState(false);
  const [salio, setSalio] = useState(false);
  const [masDetalles, setMasDetalles] = useState(false);
  const montado = useMontado();
  const candado = useCandado();
  const reenvio = useReenvioConfirmado();
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const tocado = hayCambiosEnElRegistro(iniciales, valores, lineas) || (!activoId && Boolean(activo));
  const { salir } = useSalirConCambios(tocado && !enviando, { ocupado: enviando });

  const cargarActivo = useCallback(async () => {
    if (!activoId) return;
    setCargaActivo({ estado: "cargando", error: null });
    try {
      const datos = await activosService.historial(activoId);
      if (!montado.current) return;
      setActivo(datos?.activo ?? null);
      setCargaActivo({ estado: "listo", error: null });
    } catch (e) {
      if (!montado.current) return;
      const texto = e?.response?.status === 404 ? TEXTO_NO_DISPONIBLE : mensajeDeActivos(e, "No se pudo cargar el equipo.");
      setCargaActivo({ estado: "error", error: texto });
    }
  }, [activoId, montado]);

  useEffect(() => {
    if (puedeRegistrar) cargarActivo();
  }, [cargarActivo, puedeRegistrar]);

  function fijar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function fijarLinea(indice, campo, valor) {
    setLineas((ls) => ls.map((l, i) => (i === indice ? { ...l, [campo]: valor } : l)));
    setErroresLineas((es) => es.map((e, i) => (i === indice && e?.[campo] ? { ...e, [campo]: undefined } : e)));
  }

  function quitarLinea(indice) {
    setLineas((ls) => ls.filter((_, i) => i !== indice));
    setErroresLineas((es) => es.filter((_, i) => i !== indice));
    setResultado({ texto: "Repuesto quitado.", clave: Date.now() });
  }

  function elegirComponente(componente, mensaje) {
    setVentana(false);
    setLineas((ls) => [...ls, lineaDe(componente)]);
    setErroresLineas((es) => [...es, {}]);
    if (errores.componentes) setErrores((e) => ({ ...e, componentes: undefined }));
    setResultado({ texto: mensaje ?? `Repuesto agregado: ${componente.nombre}.`, clave: Date.now() });
  }

  function cambiarSalio(si) {
    setSalio(si);
    if (si && !valores.fecha_salida) fijar("fecha_salida", hoy);
    if (!si) setErrores((e) => ({ ...e, fecha_salida: undefined, solucion: undefined, estado_final: undefined }));
  }

  function mostrarErrores(campos, texto, lineasConError = []) {
    if (DE_MAS_DETALLES.some((c) => campos[c])) setMasDetalles(true);
    if (DE_LA_SALIDA.some((c) => campos[c])) setSalio(true);
    setErrores(campos);
    setErroresLineas(lineas.map((_, i) => lineasConError[i] ?? {}));
    setError({ texto, clave: Date.now() });
    setResultado(null);
    irA(Object.keys(CAMPOS).find((c) => campos[c]));
  }

  async function guardar() {
    if (!candado.tomar()) return;
    const encontrados = validarRegistro({
      activo,
      valores: salio ? valores : { ...valores, fecha_salida: "" },
      lineas,
      hoy: hoyIso(),
      fechaAdquisicion: activo?.fecha_adquisicion,
      salio,
    });
    if (Object.keys(encontrados).length) {
      candado.soltar();
      mostrarErrores(encontrados, textoRevise(encontrados, CAMPOS), validarLineas(lineas));
      return;
    }
    if (!(await reenvio.confirmar())) {
      candado.soltar();
      return;
    }
    if (!montado.current) return;
    setErrores({});
    setErroresLineas(lineas.map(() => ({})));
    setError(null);
    setEnviando(true);
    try {
      const creado = await mantenimientosService.registrar(cuerpoDelRegistro({ activo: activo.id, valores, lineas, salio }));
      if (!montado.current) return;
      reenvio.limpiar();
      dejarResultado(`mantenimiento-${creado.id}`, {
        texto: creado.sigue_fuera_de_operacion
          ? "Mantenimiento registrado. El equipo queda «En reparación» hasta que se registre su salida."
          : "Mantenimiento registrado.",
        aviso: textoDelAvisoDeMantenimiento(creado.aviso),
      });
      salir(() => router.replace(rutaDelMantenimiento(creado)));
    } catch (e) {
      if (!montado.current) return;
      const deLineas = erroresDeLineas(e);
      const fallo = errorDeGuardado(e, "No se pudo registrar el mantenimiento.", CAMPOS);
      reenvio.marcar(fallo);
      const hayDeLineas = deLineas.lineas.some((l) => Object.keys(l).length > 0);
      const campos = { ...fallo.campos, ...(hayDeLineas || deLineas.general ? { componentes: deLineas.general ?? "Revise los repuestos marcados." } : {}) };
      const texto = hayDeLineas && Object.keys(fallo.campos).length === 0 ? textoRevise(campos, CAMPOS) : fallo.texto;
      mostrarErrores(campos, texto, deLineas.lineas);
    } finally {
      candado.soltar();
      if (montado.current) setEnviando(false);
    }
  }

  if (!puedeRegistrar) {
    return (
      <View style={estilos.centro}>
        <Alerta tipo="info" texto={TEXTO_SIN_PERMISO_REGISTRAR} testID="sin-permiso-registrar" />
      </View>
    );
  }
  if (cargaActivo.estado === "cargando") return <Cargando texto="Cargando el equipo…" />;
  if (cargaActivo.estado === "error") {
    return (
      <View style={estilos.centro}>
        <ErrorConReintento texto={cargaActivo.error} onReintentar={cargarActivo} />
      </View>
    );
  }
  if (activoId && activo && !estaOperativo(activo)) {
    return (
      <View style={estilos.centro}>
        <Alerta tipo="info" texto={TEXTO_NO_OPERATIVO} testID="activo-no-operativo" />
      </View>
    );
  }

  const dias = diasEntre(valores.fecha_intervencion, valores.fecha_salida);
  const total = totalDeRepuestos(lineas);
  const criticas = piezasCriticas(lineas);
  const aviso = quienRecibeElAviso(activo);

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior="padding"
      enabled={Platform.OS === "android"}
      keyboardVerticalOffset={alturaCabecera}
    >
      <ScrollView
        ref={desplazable}
        testID="registrar-mantenimiento-formulario"
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        automaticallyAdjustKeyboardInsets
      >
        {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="registrar-error" /> : null}
        {resultado ? <Alerta tipo="bien" texto={resultado.texto} clave={resultado.clave} testID="registrar-resultado" /> : null}
        <Text style={estilos.leyenda}>Los campos con * son obligatorios.</Text>

        <View {...bloque("activo")} style={estilos.campo}>
          {activo ? (
            <View
              ref={refFoco("activo")}
              style={estilos.elegido}
              testID="equipo-elegido"
              accessible={!!activoId}
              accessibilityLabel={activoId ? `Equipo: ${resumenDelActivo(activo)}` : undefined}
            >
              <View style={estilos.textos}>
                <Text style={estilos.etiqueta}>Equipo</Text>
                <Text style={estilos.opcionTexto}>{resumenDelActivo(activo)}</Text>
                <EstadoDelActivo activo={activo} />
              </View>
              {!activoId ? (
                <BotonIcono
                  testID="cambiar-equipo"
                  icono="close"
                  color={colores.tinta}
                  etiqueta={`Cambiar el equipo ${resumenDelActivo(activo)}`}
                  deshabilitado={enviando}
                  onPress={() => setActivo(null)}
                />
              ) : null}
            </View>
          ) : (
            <BuscadorDeActivo
              refFoco={refFoco("activo")}
              error={errores.activo}
              deshabilitado={enviando}
              onElegir={(a) => {
                setActivo(a);
                if (errores.activo) setErrores((e) => ({ ...e, activo: undefined }));
              }}
            />
          )}
          {aviso ? <Text style={estilos.tenue}>{aviso}</Text> : null}
        </View>

        <View {...bloque("tipo")}>
          <OpcionesEnLinea
            testID="mantenimiento-tipo"
            refFoco={refFoco("tipo")}
            etiqueta="Tipo"
            obligatorio
            opciones={TIPOS_DE_MANTENIMIENTO}
            valor={valores.tipo}
            error={errores.tipo}
            deshabilitado={enviando}
            onCambio={(v) => fijar("tipo", v)}
          />
        </View>

        <View {...bloque("fecha_intervencion")}>
          <SelectorFecha
            testID="mantenimiento-fecha"
            refFoco={refFoco("fecha_intervencion")}
            etiqueta="Fecha de ingreso"
            obligatorio
            valor={valores.fecha_intervencion}
            minimo={activo?.fecha_adquisicion || undefined}
            maximo={hoy}
            ayuda={activo?.fecha_adquisicion ? `El equipo se adquirió el ${fechaCorta(activo.fecha_adquisicion)}.` : undefined}
            error={errores.fecha_intervencion}
            deshabilitado={enviando}
            onCambio={(v) => fijar("fecha_intervencion", v)}
          />
        </View>

        <View {...bloque("tipo_responsable")}>
          <OpcionesEnLinea
            testID="mantenimiento-a-cargo"
            refFoco={refFoco("tipo_responsable")}
            etiqueta="A cargo de"
            obligatorio
            opciones={TIPOS_DE_RESPONSABLE}
            valor={valores.tipo_responsable}
            error={errores.tipo_responsable}
            deshabilitado={enviando}
            onCambio={(v) => fijar("tipo_responsable", v)}
          />
        </View>

        <View {...bloque("responsable")}>
          <CampoTexto
            testID="mantenimiento-responsable"
            refFoco={refFoco("responsable")}
            etiqueta="Nombre del técnico o proveedor"
            obligatorio
            maximo={LARGO_RESPONSABLE}
            valor={valores.responsable}
            error={errores.responsable}
            deshabilitado={enviando}
            onCambio={(v) => fijar("responsable", v)}
          />
        </View>

        <View {...bloque("descripcion")}>
          <CampoTexto
            testID="mantenimiento-descripcion"
            refFoco={refFoco("descripcion")}
            etiqueta="Trabajo realizado"
            obligatorio
            multilinea
            valor={valores.descripcion}
            error={errores.descripcion}
            deshabilitado={enviando}
            onCambio={(v) => fijar("descripcion", v)}
          />
        </View>

        {/* UX H-04: la salida solo se pide si el equipo ya salió. Cada bloque
            sigue siendo hijo directo del ScrollView: `useIrAlBloque` mide
            contra él. */}
        <View {...bloque("salio")}>
          <OpcionesEnLinea
            testID="mantenimiento-salio"
            refFoco={refFoco("salio")}
            etiqueta="¿El equipo ya salió del taller?"
            ayuda="Si sigue en reparación, queda «En reparación» hasta que se registre su salida."
            opciones={SALIO}
            valor={salio ? "si" : "no"}
            deshabilitado={enviando}
            onCambio={(v) => cambiarSalio(v === "si")}
          />
        </View>
        {salio ? (
          <View {...bloque("fecha_salida")}>
            <SelectorFecha
              testID="mantenimiento-salida"
              refFoco={refFoco("fecha_salida")}
              etiqueta="Fecha de salida"
              obligatorio
              valor={valores.fecha_salida}
              minimo={valores.fecha_intervencion || undefined}
              maximo={hoy}
              porDefecto={hoy}
              ayuda={valores.fecha_salida ? `${dias ?? 0} ${dias === 1 ? "día" : "días"} fuera de operación.` : undefined}
              error={errores.fecha_salida}
              deshabilitado={enviando}
              onCambio={(v) => fijar("fecha_salida", v)}
            />
          </View>
        ) : null}
        {salio ? (
          <View {...bloque("solucion")}>
            <CampoTexto
              testID="mantenimiento-solucion"
              refFoco={refFoco("solucion")}
              etiqueta="Solución aplicada"
              opcional
              multilinea
              valor={valores.solucion}
              error={errores.solucion}
              deshabilitado={enviando}
              onCambio={(v) => fijar("solucion", v)}
            />
          </View>
        ) : null}
        {salio ? (
          <View {...bloque("estado_final")}>
            <OpcionesEnLinea
              testID="mantenimiento-estado-final"
              refFoco={refFoco("estado_final")}
              etiqueta="Estado final"
              obligatorio
              opciones={ESTADOS_FINALES}
              valor={valores.estado_final}
              error={errores.estado_final}
              deshabilitado={enviando}
              onCambio={(v) => fijar("estado_final", v)}
            />
          </View>
        ) : null}
        {salio && FINALES_SIN_VUELTA.includes(valores.estado_final) ? <Alerta tipo="aviso" texto={TEXTO_SIN_VUELTA} /> : null}

        {/* UX H-03: lo opcional, plegado; se abre solo si tiene errores. */}
        <Desplegable titulo="Más detalles (opcional)" abierto={masDetalles} onCambiar={setMasDetalles} testID="mas-detalles" />
        {masDetalles ? (
          <View {...bloque("causa")} style={estilos.campo}>
            <CampoTexto
              testID="mantenimiento-causa"
              refFoco={refFoco("causa")}
              etiqueta="Causa de la falla"
              opcional
              maximo={LARGO_CAUSA}
              placeholder="Pantalla dañada, batería, disco, lentitud…"
              valor={valores.causa}
              error={errores.causa}
              deshabilitado={enviando}
              onCambio={(v) => fijar("causa", v)}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={estilos.chips}
              accessibilityLabel="Causas frecuentes"
            >
              {CAUSAS_SUGERIDAS.map((c) => (
                <Pressable
                  key={c}
                  testID={`causa-${c}`}
                  onPress={() => fijar("causa", c)}
                  disabled={enviando}
                  accessibilityRole="button"
                  accessibilityLabel={`Causa frecuente: ${c}`}
                  accessibilityState={{ selected: valores.causa === c, disabled: enviando }}
                  style={({ pressed }) => [estilos.chip, valores.causa === c && estilos.chipActivo, pressed && estilos.presionada]}
                >
                  {valores.causa === c ? <Icono nombre="check" size={16} color={colores.sobrePrimario} /> : null}
                  <Text style={[estilos.chipTexto, valores.causa === c && estilos.chipTextoActivo]}>{c}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
        {masDetalles ? (
          <View {...bloque("diagnostico")}>
            <CampoTexto
              testID="mantenimiento-diagnostico"
              refFoco={refFoco("diagnostico")}
              etiqueta="Diagnóstico"
              opcional
              multilinea
              valor={valores.diagnostico}
              error={errores.diagnostico}
              deshabilitado={enviando}
              onCambio={(v) => fijar("diagnostico", v)}
            />
          </View>
        ) : null}
        {masDetalles ? (
          <View {...bloque("garantia_usada")}>
            <Casilla
              testID="mantenimiento-garantia"
              refFoco={refFoco("garantia_usada")}
              etiqueta="Cubierto por garantía"
              marcada={valores.garantia_usada}
              error={errores.garantia_usada}
              deshabilitado={enviando}
              onCambio={(v) => fijar("garantia_usada", v)}
            />
          </View>
        ) : null}
        {masDetalles ? (
          <View {...bloque("costo_mano_obra")}>
            <CampoTexto
              testID="mantenimiento-costo"
              refFoco={refFoco("costo_mano_obra")}
              etiqueta="Costo de mano de obra (USD)"
              opcional
              teclado="decimal-pad"
              maximo={14}
              valor={valores.costo_mano_obra}
              error={errores.costo_mano_obra}
              deshabilitado={enviando}
              onCambio={(v) => fijar("costo_mano_obra", v)}
            />
          </View>
        ) : null}

        <View {...bloque("componentes")} style={estilos.campo}>
          <Text ref={refFoco("componentes")} style={estilos.subtitulo} accessibilityRole="header">
            Repuestos utilizados
          </Text>
          {lineas.length === 0 ? (
            <Text style={estilos.tenue}>Sin repuestos. Una intervención puede no consumir ninguno (por ejemplo, una limpieza).</Text>
          ) : null}
          <ErrorDeCampo error={errores.componentes} />
          {lineas.map((l, i) => (
            <LineaDeRepuesto
              key={l.uid ?? `${l.componente}-${i}`}
              linea={l}
              indice={i}
              errores={erroresLineas[i]}
              deshabilitado={enviando}
              onCambio={(campo, v) => fijarLinea(i, campo, v)}
              onQuitar={() => quitarLinea(i)}
            />
          ))}
          {lineas.length > 0 ? (
            <Text style={estilos.tenue} accessibilityLiveRegion="polite">
              {[`Repuestos: ${dinero(total)}`, criticas ? `${criticas} ${criticas === 1 ? "pieza crítica" : "piezas críticas"}` : null]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
          <Boton
            testID="agregar-repuesto"
            titulo="Agregar repuesto"
            icono="plus"
            variante="secundario"
            deshabilitado={enviando}
            onPress={() => setVentana(true)}
          />
        </View>

        <Boton
          testID="guardar-mantenimiento"
          titulo={enviando ? "Guardando…" : "Registrar mantenimiento"}
          icono="check"
          cargando={enviando}
          onPress={guardar}
        />
      </ScrollView>
      {ventana ? (
        <VentanaDeComponente puedeCrear={puedeCrearComponente} onElegir={elegirComponente} onCerrar={() => setVentana(false)} />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const fabricaDeEstilos = (colores, CONTROLES) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 16, paddingBottom: 40 },
  centro: { padding: 16 },
  campo: { gap: 6 },
  leyenda: { fontSize: 14, color: colores.tintaSuave },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  obligatorio: { color: colores.malTexto },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.titulo },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  critico: { flexShrink: 1, fontSize: 14, color: colores.avisoTexto, fontWeight: "600" },
  linea: { flexDirection: "row", alignItems: "center", gap: 6 },
  textos: { flex: 1, gap: 2 },
  entrada: CONTROLES.entrada,
  entradaConError: CONTROLES.entradaConError,
  opcion: CONTROLES.opcion,
  opcionTexto: { ...CONTROLES.opcionTexto, fontWeight: "600" },
  presionada: { backgroundColor: colores.realce },
  elegido: {
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
  chips: { gap: 8, paddingVertical: 2 },
  chip: CONTROLES.pildora,
  chipActivo: CONTROLES.pildoraActiva,
  chipTexto: CONTROLES.pildoraTexto,
  chipTextoActivo: CONTROLES.pildoraTextoActivo,
  repuesto: {
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  repuestoCabecera: { flexDirection: "row", alignItems: "center", gap: 8 },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  mitad: { flexGrow: 1, flexBasis: 140 },
  crear: { gap: 12 },
});
