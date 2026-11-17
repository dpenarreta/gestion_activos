import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";

import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { activosService, organizacionService } from "../../api/servicios";
import {
  ADVERTENCIAS,
  confirmacionDeSalida,
  cuerpoDeAsignacion,
  ESPERA_BUSCAR_MS,
  esSalida,
  estadosParaCambiar,
  hayCambioDeAsignacion,
  mensajeDeActivos,
  resumenDeAsignacion,
  validarCambioDeEstado,
  valoresDeAsignacion,
} from "../../activos/formato";
import { Alerta, Boton, BotonIcono, ErrorConReintento } from "../../componentes/comunes";
import { confirmarDescarte } from "../../componentes/confirmarDescarte";
import { Icono } from "../../componentes/Icono";
import { ErrorDeCampo, OpcionesEnLinea, SelectorDeLista } from "../../componentes/Selectores";
import { Ventana } from "../../componentes/Ventana";
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { CampoTexto } from "../permisos/piezas";
import { errorDeGuardado, textoRevise, useCandado, useReenvioConfirmado } from "./formularios";
import { useMontado } from "./piezas";

/**
 * Asignar (CA-8) y cambiar el estado (CA-9) de un activo desde su ficha,
 * cada uno en su ventana, con las mismas llamadas y reglas que la web
 * (`AsignarCustodioDialog.jsx` y `CambiarEstadoDialog.jsx`):
 *
 * - mientras guarda, la ventana no se cierra y un doble toque hace una sola
 *   petición (candado síncrono, como en la Matriz);
 * - los errores 400 del servidor van junto a su campo y arriba se dice qué
 *   revisar;
 * - sin respuesta clara del servidor se dice que pudo haberse guardado, y el
 *   siguiente envío pregunta antes de repetirlo (QA-FUNC B4);
 * - cerrar con cambios pide confirmación (`confirmarDescarte`).
 *
 * El candado, los errores y la confirmación del reenvío son los de
 * `formularios.js` (QA-TECH H-18).
 */

export const TEXTO_SIN_CAMBIOS = "No cambió nada: elija otra persona, área o sede.";

/** Los campos que muestra cada ventana, con su nombre para «Revise…»
 * (QA-FUNC B2): «Asignar» no tiene `estado`, así que un 400 en `estado` (el
 * activo pasó a «Perdido» mientras tanto) se dice arriba con el mensaje del
 * servidor. */
const CAMPOS_DE_ASIGNAR = { responsables: "Responsables", departamento: "Área", sede: "Sede", motivo: "Motivo" };
const CAMPOS_DE_ESTADO = { estado: "Nuevo estado", motivo: "Motivo" };

function subtituloDe(activo) {
  return [activo?.codigo_barras, activo?.nombre].filter(Boolean).join(" · ");
}

function resultados(datos) {
  if (Array.isArray(datos)) return datos;
  return Array.isArray(datos?.results) ? datos.results : [];
}

// --- Asignar ------------------------------------------------------------------------

/** Una persona elegida, con «Quitar». */
function Elegida({ persona, onQuitar, deshabilitado }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  return (
    <View style={estilos.elegida} testID={`responsable-${persona.id}`}>
      <Icono nombre="account-check-outline" size={20} color={colores.tinta} />
      <View style={estilos.elegidaTextos}>
        <Text style={estilos.elegidaNombre}>{persona.nombre}</Text>
        {persona.detalle ? <Text style={estilos.tenue}>{persona.detalle}</Text> : null}
      </View>
      <BotonIcono
        icono="close"
        etiqueta={`Quitar a ${persona.nombre}`}
        onPress={() => onQuitar(persona.id)}
        deshabilitado={deshabilitado}
        testID={`quitar-${persona.id}`}
      />
    </View>
  );
}

/** Un empleado de `organizacion/empleados/` como persona elegible (lo usa
 * también el alta de un activo, US-023). */
export function personaDeEmpleado(e) {
  return {
    id: String(e.id),
    nombre: e.nombre_completo || [e.nombres, e.apellidos].filter(Boolean).join(" ") || `Empleado ${e.id}`,
    detalle: [e.codigo_empleado, e.cargo, e.departamento_nombre].filter(Boolean).join(" · ") || undefined,
    departamento: e.departamento ? String(e.departamento) : "",
  };
}

/** El buscador de empleados: escribir, esperar 400 ms y elegir. */
function BuscadorDeEmpleados({ excluidos, onElegir, deshabilitado, refFoco, error, compartido }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState({ cargando: false, lista: [], error: null });
  const [vez, setVez] = useState(0);
  const montado = useMontado();

  useEffect(() => {
    const q = texto.trim();
    if (!q) {
      setEstado({ cargando: false, lista: [], error: null });
      return undefined;
    }
    let vigente = true;
    setEstado((s) => ({ ...s, cargando: true, error: null }));
    const pausa = setTimeout(() => {
      organizacionService
        .empleados(q)
        .then((datos) => {
          if (vigente && montado.current) setEstado({ cargando: false, lista: resultados(datos).map(personaDeEmpleado), error: null });
        })
        .catch((e) => {
          if (vigente && montado.current) {
            setEstado({ cargando: false, lista: [], error: mensajeDeActivos(e, "No se pudo buscar a las personas.") });
          }
        });
    }, ESPERA_BUSCAR_MS);
    return () => {
      vigente = false;
      clearTimeout(pausa);
    };
  }, [texto, vez, montado]);

  const visibles = estado.lista.filter((p) => !excluidos.includes(p.id));
  const etiqueta = compartido ? "Agregar responsable" : "Buscar a quién se le entrega";
  return (
    <View style={estilos.campo}>
      <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
        {etiqueta}
      </Text>
      <TextInput
        ref={refFoco}
        testID="buscar-empleado"
        value={texto}
        onChangeText={setTexto}
        editable={!deshabilitado}
        placeholder="Nombre, apellido o código"
        placeholderTextColor={colores.tintaTenue}
        accessibilityLabel={`${etiqueta}. Nombre, apellido o código${error ? `. Error: ${error}` : ""}`}
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
      {!estado.cargando && !estado.error && texto.trim() && visibles.length === 0 ? (
        <Text style={estilos.tenue} accessibilityLiveRegion="polite">{`Nadie coincide con «${texto.trim()}».`}</Text>
      ) : null}
      {visibles.map((p) => (
        <Pressable
          key={p.id}
          testID={`empleado-${p.id}`}
          onPress={() => {
            onElegir(p);
            setTexto("");
          }}
          disabled={deshabilitado}
          accessibilityRole="button"
          accessibilityLabel={`${p.nombre}${p.detalle ? `. ${p.detalle}` : ""}`}
          accessibilityHint={compartido ? "Lo agrega a los responsables" : "Lo elige como responsable"}
          style={({ pressed }) => [estilos.opcion, pressed && estilos.presionada]}
        >
          <Icono nombre="account-plus-outline" size={20} color={colores.primario} />
          <View style={estilos.elegidaTextos}>
            <Text style={estilos.opcionTexto}>{p.nombre}</Text>
            {p.detalle ? <Text style={estilos.tenue}>{p.detalle}</Text> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/** Las opciones de un catálogo, con la actual aunque ya no venga (un área
 * desactivada sigue a la vista). */
function opcionesCon(lista, actual) {
  const opciones = lista.map((x) => ({
    valor: String(x.id),
    texto: x.nombre,
    detalle: x.ciudad && x.ciudad !== x.nombre ? x.ciudad : undefined,
  }));
  if (actual?.valor && !opciones.some((o) => o.valor === actual.valor)) opciones.unshift(actual);
  return opciones;
}

/**
 * «Asignar» (CA-8): quién responde por el equipo (un buscador de
 * empleados; en un equipo compartido, varios en igualdad), el área (se
 * propone la de quien lo recibe), la sede y el motivo. Quitar a todos es
 * devolverlo a bodega. Envía `POST activos/{id}/asignar/`.
 */
export function FormularioAsignar({ activo, onCerrar, onGuardado }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const [iniciales] = useState(() => valoresDeAsignacion(activo));
  const [valores, setValores] = useState(iniciales);
  const [personas, setPersonas] = useState(() =>
    (activo?.responsables ?? []).map((p) => ({
      id: String(p.id),
      nombre: p.nombre_completo,
      detalle: p.codigo_empleado || undefined,
    })),
  );
  const [catalogos, setCatalogos] = useState({ estado: "cargando", areas: [], sedes: [], fallos: {} });
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const montado = useMontado();
  const candado = useCandado();
  const reenvio = useReenvioConfirmado();
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const compartido = Boolean(activo?.compartido);

  const cargarCatalogos = useCallback(async () => {
    setCatalogos((c) => ({ ...c, estado: "cargando" }));
    const [areas, sedes] = await Promise.allSettled([organizacionService.departamentos(), organizacionService.sedes()]);
    if (!montado.current) return;
    const fallos = {};
    if (areas.status === "rejected") fallos.departamento = mensajeDeActivos(areas.reason, "No se pudieron cargar las áreas.");
    if (sedes.status === "rejected") fallos.sede = mensajeDeActivos(sedes.reason, "No se pudieron cargar las sedes.");
    setCatalogos({
      estado: "listo",
      areas: areas.status === "fulfilled" ? resultados(areas.value) : [],
      sedes: sedes.status === "fulfilled" ? resultados(sedes.value) : [],
      fallos,
    });
  }, [montado]);

  useEffect(() => {
    cargarCatalogos();
  }, [cargarCatalogos]);

  const opcionesDeArea = useMemo(
    () =>
      opcionesCon(
        catalogos.areas,
        activo?.departamento ? { valor: String(activo.departamento), texto: activo.departamento_nombre || "Área actual" } : null,
      ),
    [catalogos.areas, activo],
  );
  const opcionesDeSede = useMemo(
    () => opcionesCon(catalogos.sedes, activo?.sede ? { valor: String(activo.sede), texto: activo.sede_nombre || "Sede actual" } : null),
    [catalogos.sedes, activo],
  );

  function fijar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function elegir(persona) {
    // Un equipo normal cambia de manos: el elegido reemplaza al anterior. Uno
    // compartido suma, sin titular. El área se propone con el primero.
    const antes = valores.responsables;
    const nuevos = compartido ? [...antes, persona.id] : [persona.id];
    setPersonas((ps) => (compartido ? [...ps.filter((p) => p.id !== persona.id), persona] : [persona]));
    setValores((v) => ({
      ...v,
      responsables: nuevos,
      departamento: (!compartido || antes.length === 0) && persona.departamento ? persona.departamento : v.departamento,
    }));
    if (errores.responsables) setErrores((e) => ({ ...e, responsables: undefined }));
  }

  function quitar(id) {
    setPersonas((ps) => ps.filter((p) => p.id !== id));
    fijar(
      "responsables",
      valores.responsables.filter((x) => x !== id),
    );
  }

  const conCambios = hayCambioDeAsignacion(iniciales, valores) || Boolean(valores.motivo.trim());
  const resumen = resumenDeAsignacion(iniciales, valores);

  async function cerrar() {
    if (guardando) return;
    if (conCambios && !(await confirmarDescarte())) return;
    onCerrar();
  }

  function mostrarErrores(campos, texto) {
    setErrores(campos);
    setError({ texto, clave: Date.now() });
    const primero = Object.keys(CAMPOS_DE_ASIGNAR).find((c) => campos[c]);
    irA(primero);
  }

  async function guardar() {
    if (!candado.tomar()) return;
    if (!hayCambioDeAsignacion(iniciales, valores)) {
      candado.soltar();
      setError({ texto: TEXTO_SIN_CAMBIOS, clave: Date.now() });
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
    setGuardando(true);
    try {
      const actualizado = await activosService.asignar(activo.id, cuerpoDeAsignacion(valores));
      if (!montado.current) return;
      reenvio.limpiar();
      onGuardado(actualizado, resumen ? `Movimiento registrado. ${resumen}` : "Movimiento registrado.");
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDeGuardado(e, "No se pudo registrar el movimiento.", CAMPOS_DE_ASIGNAR);
      reenvio.marcar(fallo);
      mostrarErrores(fallo.campos, fallo.texto);
    } finally {
      candado.soltar();
      if (montado.current) setGuardando(false);
    }
  }

  return (
    <Ventana
      titulo="Asignar o trasladar"
      subtitulo={subtituloDe(activo)}
      onCerrar={cerrar}
      ocupada={guardando}
      refDesplazable={desplazable}
      testID="ventana-asignar"
    >
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="asignar-error" /> : null}
      <View
        style={estilos.situacion}
        accessible
        accessibilityLabel={[
          "Situación actual",
          `Responsable: ${activo?.responsables_resumen || "sin asignar"}`,
          `Área: ${activo?.departamento_nombre || "sin área"}`,
          `Sede: ${activo?.sede_nombre || "sin sede"}`,
        ].join(". ")}
      >
        <Text style={estilos.subtitulo}>Situación actual</Text>
        <Text style={estilos.dato}>{`Responsable: ${activo?.responsables_resumen || "Sin asignar"}`}</Text>
        <Text style={estilos.dato}>{`Área: ${activo?.departamento_nombre || "—"}`}</Text>
        <Text style={estilos.dato}>{`Sede: ${activo?.sede_nombre || "Sin sede"}`}</Text>
      </View>

      <View {...bloque("responsables")} style={estilos.campo}>
        <Text style={estilos.etiqueta} accessibilityRole="header">
          {compartido ? "Responsables (equipo compartido)" : "Responsable"}
        </Text>
        {personas.length === 0 ? (
          <Text style={estilos.tenue}>Sin responsable: el equipo queda en bodega.</Text>
        ) : (
          personas.map((p) => <Elegida key={p.id} persona={p} onQuitar={quitar} deshabilitado={guardando} />)
        )}
        <BuscadorDeEmpleados
          excluidos={valores.responsables}
          onElegir={elegir}
          deshabilitado={guardando}
          refFoco={refFoco("responsables")}
          error={errores.responsables}
          compartido={compartido}
        />
      </View>

      <View {...bloque("departamento")}>
        <SelectorDeLista
          testID="asignar-area"
          refFoco={refFoco("departamento")}
          etiqueta="Área"
          ayuda={catalogos.fallos.departamento}
          opciones={opcionesDeArea}
          valor={valores.departamento}
          buscable
          error={errores.departamento}
          deshabilitado={guardando || catalogos.estado === "cargando"}
          onCambio={(v) => fijar("departamento", String(v ?? ""))}
        />
      </View>

      <View {...bloque("sede")}>
        <SelectorDeLista
          testID="asignar-sede"
          refFoco={refFoco("sede")}
          etiqueta="Sede"
          ayuda={catalogos.fallos.sede}
          opciones={opcionesDeSede}
          valor={valores.sede}
          vacio="Sin sede"
          conVacio
          buscable
          error={errores.sede}
          deshabilitado={guardando || catalogos.estado === "cargando"}
          onCambio={(v) => fijar("sede", String(v ?? ""))}
        />
      </View>
      {catalogos.fallos.departamento || catalogos.fallos.sede ? (
        <Boton titulo="Volver a cargar áreas y sedes" icono="refresh" variante="secundario" onPress={cargarCatalogos} />
      ) : null}

      <View {...bloque("motivo")}>
        <CampoTexto
          testID="asignar-motivo"
          refFoco={refFoco("motivo")}
          etiqueta="Motivo"
          opcional
          multilinea
          valor={valores.motivo}
          error={errores.motivo}
          deshabilitado={guardando}
          onCambio={(v) => fijar("motivo", v)}
        />
      </View>

      {resumen ? <Alerta tipo="info" texto={resumen} testID="asignar-resumen" /> : null}
      <Boton
        testID="guardar-asignacion"
        titulo={guardando ? "Guardando…" : "Guardar movimiento"}
        icono="check"
        cargando={guardando}
        onPress={guardar}
      />
      <Boton testID="cancelar-asignacion" titulo="Cancelar" variante="secundario" deshabilitado={guardando} onPress={cerrar} />
    </Ventana>
  );
}

// --- Cambiar estado -----------------------------------------------------------------

/** La pregunta antes de sacar el equipo del inventario. Resuelve `true` si
 * la persona sigue. Tocar fuera o Atrás es no hacerlo. */
export function confirmarSalidaDelInventario(estado, activo) {
  const { titulo, mensaje } = confirmacionDeSalida(estado, activo);
  return new Promise((resolver) => {
    Alert.alert(
      titulo,
      mensaje,
      [
        { text: "No, volver", style: "cancel", onPress: () => resolver(false) },
        { text: "Sí, sacarlo del inventario", style: "destructive", onPress: () => resolver(true) },
      ],
      { cancelable: true, onDismiss: () => resolver(false) },
    );
  });
}

/**
 * «Cambiar estado» (CA-9): los estados del modelo menos el actual; para
 * dado de baja, perdido o robado el motivo es obligatorio y se pide
 * confirmación, porque saca el activo del inventario. Envía
 * `POST activos/{id}/cambiar-estado/`.
 */
export function FormularioCambiarEstado({ activo, onCerrar, onGuardado }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const [estado, setEstado] = useState("");
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const montado = useMontado();
  const candado = useCandado();
  const reenvio = useReenvioConfirmado();
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const opciones = estadosParaCambiar(activo?.estado).map((o) => ({
    valor: o.valor,
    texto: o.salida ? `${o.texto} (sale del inventario)` : o.texto,
  }));
  const salida = esSalida(estado);
  const conCambios = Boolean(estado) || Boolean(motivo.trim());

  async function cerrar() {
    if (guardando) return;
    if (conCambios && !(await confirmarDescarte())) return;
    onCerrar();
  }

  function mostrarErrores(campos, texto) {
    setErrores(campos);
    setError({ texto, clave: Date.now() });
    irA(["estado", "motivo"].find((c) => campos[c]));
  }

  async function guardar() {
    if (!candado.tomar()) return;
    const encontrados = validarCambioDeEstado({ estado, motivo });
    if (Object.keys(encontrados).length) {
      candado.soltar();
      mostrarErrores(encontrados, textoRevise(encontrados, CAMPOS_DE_ESTADO));
      return;
    }
    if (salida && !(await confirmarSalidaDelInventario(estado, activo))) {
      candado.soltar();
      return;
    }
    if (!(await reenvio.confirmar())) {
      candado.soltar();
      return;
    }
    if (!montado.current) return;
    setErrores({});
    setError(null);
    setGuardando(true);
    try {
      const actualizado = await activosService.cambiarEstado(activo.id, { estado, motivo: motivo.trim() });
      if (!montado.current) return;
      reenvio.limpiar();
      const nombre = actualizado?.estado_display || opciones.find((o) => o.valor === estado)?.texto;
      onGuardado(actualizado, `Estado cambiado a «${nombre}».`);
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDeGuardado(e, "No se pudo cambiar el estado del activo.", CAMPOS_DE_ESTADO);
      reenvio.marcar(fallo);
      mostrarErrores(fallo.campos, fallo.texto);
    } finally {
      candado.soltar();
      if (montado.current) setGuardando(false);
    }
  }

  return (
    <Ventana
      titulo="Cambiar estado"
      subtitulo={subtituloDe(activo)}
      onCerrar={cerrar}
      ocupada={guardando}
      refDesplazable={desplazable}
      testID="ventana-estado"
    >
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="estado-error" /> : null}
      {opciones.length === 0 ? (
        <Alerta tipo="info" texto="Este activo está dado de baja: su estado ya no se modifica." />
      ) : (
        <>
          <Text style={estilos.tenue}>{`Estado actual: ${activo?.estado_display || activo?.estado}`}</Text>
          <View {...bloque("estado")}>
            <OpcionesEnLinea
              testID="nuevo-estado"
              refFoco={refFoco("estado")}
              etiqueta="Nuevo estado"
              obligatorio
              opciones={opciones}
              valor={estado}
              error={errores.estado}
              deshabilitado={guardando}
              onCambio={(v) => {
                setEstado(v);
                if (errores.estado) setErrores((e) => ({ ...e, estado: undefined }));
              }}
            />
          </View>
          {salida ? <Alerta tipo="aviso" texto={ADVERTENCIAS[estado]} testID="advertencia-salida" /> : null}
          <View {...bloque("motivo")}>
            <CampoTexto
              testID="estado-motivo"
              refFoco={refFoco("motivo")}
              etiqueta="Motivo"
              obligatorio={salida}
              opcional={!salida}
              ayuda={salida ? "Obligatorio: queda en el historial del equipo." : undefined}
              multilinea
              valor={motivo}
              error={errores.motivo}
              deshabilitado={guardando}
              onCambio={(v) => {
                setMotivo(v);
                if (errores.motivo) setErrores((e) => ({ ...e, motivo: undefined }));
              }}
            />
          </View>
          <Boton
            testID="guardar-estado"
            titulo={guardando ? "Guardando…" : "Cambiar estado"}
            icono="check"
            variante={salida ? "peligro" : "primario"}
            cargando={guardando}
            onPress={guardar}
          />
        </>
      )}
      <Boton testID="cancelar-estado" titulo="Cancelar" variante="secundario" deshabilitado={guardando} onPress={cerrar} />
    </Ventana>
  );
}

const fabricaDeEstilos = (colores, CONTROLES) => crearEstilos({
  campo: { gap: 6 },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  subtitulo: { fontSize: 16, fontWeight: "700", color: colores.titulo },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  dato: { fontSize: 15, color: colores.tinta },
  linea: { flexDirection: "row", alignItems: "center", gap: 8 },
  situacion: {
    gap: 2,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  entrada: CONTROLES.entrada,
  entradaConError: CONTROLES.entradaConError,
  elegida: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colores.primario,
    backgroundColor: colores.realce,
  },
  elegidaTextos: { flex: 1, gap: 2, paddingVertical: 6 },
  elegidaNombre: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  opcion: CONTROLES.opcion,
  opcionTexto: CONTROLES.opcionTexto,
  presionada: { backgroundColor: colores.realce },
});
