import * as Linking from "expo-linking";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { ordenesService } from "../../api/servicios";
import { tomarResultado } from "../../activos/avisoPendiente";
import { Alerta, Boton, BotonIcono, Cargando, ErrorConReintento } from "../../componentes/comunes";
import { Refresco } from "../../componentes/Refresco";
import {
  contactoDe,
  detalleDelCosto,
  mensajeDeOrdenes,
  moneda,
  pasosDisponibles,
  puedeAsignarse,
  regionDe,
  resumenDePildoras,
  sedeDe,
  TEXTO_NO_DISPONIBLE,
} from "../../ordenes/formato";
import { useCatalogosDeOrdenes } from "../../ordenes/useCatalogos";
import { useSesion } from "../../sesion/SesionContext";
import { useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { fechaCorta, fechaYHora } from "../../utils/fechas";
import { useMontado } from "../activos/piezas";
import { Dato, Seccion } from "../soporte/piezas";
import {
  confirmarQuitarCosto,
  VentanaAsignar,
  VentanaCambioDeEstado,
  VentanaCorregir,
  VentanaCosto,
} from "./AccionesDeLaOrden";
import { CumplimientoOrden, EstadoOrden, PrioridadOrden } from "./piezas";
import { useRellenoDeLaBurbuja } from "../../navegacion/BurbujaDeSoporte";

export { TEXTO_NO_DISPONIBLE };

/** Las filas de materiales o de mano de obra, con «Quitar» si se puede. */
function FilasDeCosto({ tipo, filas, puede, quitando, onQuitar }) {
  const estilos = useEstilos(fabricaDeEstilos);
  if (!filas.length) return <Text style={estilos.tenue}>Nada registrado.</Text>;
  return filas.map((fila) => {
    const detalle = detalleDelCosto(tipo, fila);
    const subtotal = moneda(fila.subtotal);
    return (
      <View key={fila.id} style={estilos.costo} testID={`${tipo}-${fila.id}`}>
        <View style={estilos.costoTextos} accessible accessibilityLabel={`${fila.descripcion}. ${detalle}. Subtotal: ${subtotal}`}>
          <Text style={estilos.costoNombre}>{fila.descripcion}</Text>
          <Text style={estilos.tenue}>{detalle}</Text>
          <Text style={estilos.costoSubtotal}>{`Subtotal: ${subtotal}`}</Text>
        </View>
        {puede ? (
          <BotonIcono
            testID={`quitar-${tipo}-${fila.id}`}
            icono="delete-outline"
            variante="peligro"
            etiqueta={`Quitar ${fila.descripcion}`}
            cargando={quitando === `${tipo}-${fila.id}`}
            deshabilitado={Boolean(quitando)}
            onPress={() => onQuitar(tipo, fila)}
          />
        ) : null}
      </View>
    );
  });
}

/**
 * La ficha de una orden de trabajo (US-025, CA-9 a CA-13), con `GET
 * ordenes/{id}/`: el número, el título, el estado, la prioridad y el
 * cumplimiento; los datos (sede, solicitante, contacto tal como llega del
 * servidor, enmascarado sin `ordenes.ver_contacto`, responsable, fecha,
 * descripción y cierre); los materiales, la mano de obra y los costos con
 * IVA; y el recorrido.
 *
 * Lo que se puede hacer sale del servidor (`permisos`):
 * - un botón por estado destino de `permisos.acciones`, con el verbo de la
 *   web (CA-10);
 * - «Asignar» o «Reasignar» con `permisos.asignar`, mientras la orden se
 *   pueda reasignar (CA-11);
 * - agregar y quitar materiales y horas con `permisos.registrar_costos`
 *   (CA-12);
 * - «Corregir» con `permisos.editar` (CA-13).
 *
 * Cada envío devuelve el detalle: se pinta tal cual y se anuncia el
 * resultado. `empresa`: la de un enlace; las acciones solo se ofrecen en la
 * empresa activa, como en Gestión de Activos.
 */
export function FichaOrden({ id, empresa = null }) {
  // US-029: lo último no queda bajo la burbuja de soporte.
  const rellenoBurbuja = useRellenoDeLaBurbuja();
  const estilos = useEstilos(fabricaDeEstilos);
  const { empresaActiva, versionEmpresa } = useSesion();
  const [carga, setCarga] = useState({ estado: "cargando", datos: null, error: null, aviso: null });
  const [refrescando, setRefrescando] = useState(false);
  const [ventana, setVentana] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [quitando, setQuitando] = useState(null);
  const [errorAccion, setErrorAccion] = useState(null);
  const montado = useMontado();
  const consulta = useRef(0);
  const cargaRef = useRef(carga);
  cargaRef.current = carga;
  const quitandoRef = useRef(false);
  // QA-TECH: los catálogos de «Asignar» y «Corregir» se piden una sola vez,
  // y solo si la persona puede hacer una de las dos.
  const previa = carga.datos;
  const enLaActivaPrevia = !empresa || String(empresa) === String(empresaActiva?.id ?? "");
  const necesitaCatalogos = Boolean(previa && enLaActivaPrevia && (puedeAsignarse(previa) || previa.permisos?.editar));
  const catalogos = useCatalogosDeOrdenes(necesitaCatalogos);
  const [errorLlamar, setErrorLlamar] = useState(null);

  const cargar = useCallback(
    async ({ silenciosa = false } = {}) => {
      const numero = ++consulta.current;
      if (!silenciosa) setCarga({ estado: "cargando", datos: null, error: null, aviso: null });
      try {
        const datos = await ordenesService.detalle(id, { empresa: empresa ?? undefined });
        if (!montado.current || numero !== consulta.current) return;
        setCarga({ estado: "listo", datos, error: null, aviso: null });
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        const noEsta = e?.response?.status === 404;
        if (silenciosa && cargaRef.current.estado === "listo" && !noEsta) {
          const aviso = `${mensajeDeOrdenes(e, "No se pudo actualizar la orden.")} Se muestra la última información.`;
          setCarga((c) => ({ ...c, aviso }));
        } else {
          setCarga({
            estado: "error",
            datos: null,
            error: noEsta ? TEXTO_NO_DISPONIBLE : mensajeDeOrdenes(e, "No se pudo abrir la orden."),
            aviso: null,
          });
        }
      }
    },
    [id, empresa, montado],
  );

  // Lo que dejó el alta («Orden OT-2026-000015 registrada.»). En un efecto:
  // se toma una sola vez.
  useEffect(() => {
    const previo = tomarResultado(`orden-${id}`);
    if (previo) setResultado({ ...previo, clave: Date.now() });
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  async function refrescar() {
    setRefrescando(true);
    await cargar({ silenciosa: cargaRef.current.estado === "listo" });
    if (montado.current) setRefrescando(false);
  }

  /** Lo que devolvió el servidor tras una acción: la ficha nueva y el
   * resultado, que se anuncia. Sin detalle en la respuesta, se vuelve a
   * leer. */
  function alGuardar(actualizada, mensaje) {
    setVentana(null);
    setErrorAccion(null);
    if (actualizada && typeof actualizada === "object" && actualizada.id) {
      consulta.current += 1;
      setCarga({ estado: "listo", datos: actualizada, error: null, aviso: null });
    } else {
      cargar({ silenciosa: true });
    }
    // La `Alerta` de tipo «bien» lo anuncia al lector de pantalla.
    setResultado({ texto: mensaje, clave: Date.now() });
  }

  /** QA-FUNC O-1: el servidor rechazó el paso porque la orden cambió (o ya
   * no se puede): se dice el motivo y la ficha se pone al día. */
  function alRechazo(texto) {
    setVentana(null);
    setErrorAccion({ texto, clave: Date.now() });
    cargar({ silenciosa: true });
  }

  async function llamar(url) {
    setErrorLlamar(null);
    try {
      await Linking.openURL(url);
    } catch {
      if (montado.current) setErrorLlamar("No se pudo abrir el teléfono para llamar. Marque el número a mano.");
    }
  }

  async function quitar(tipo, fila) {
    if (quitandoRef.current) return;
    quitandoRef.current = true;
    try {
      if (!(await confirmarQuitarCosto(fila)) || !montado.current) return;
      setQuitando(`${tipo}-${fila.id}`);
      setErrorAccion(null);
      const actualizada = await ordenesService.quitarCosto(id, tipo, fila.id);
      if (!montado.current) return;
      alGuardar(actualizada, `Se quitó «${fila.descripcion}».`);
    } catch (e) {
      if (!montado.current) return;
      setErrorAccion({ texto: mensajeDeOrdenes(e, "No se pudo quitar la fila.", { envio: true }), clave: Date.now() });
      // Si ya no estaba, la ficha al día lo muestra.
      cargar({ silenciosa: true });
    } finally {
      quitandoRef.current = false;
      if (montado.current) setQuitando(null);
    }
  }

  if (carga.estado === "cargando") return <Cargando texto="Cargando la orden…" />;
  if (carga.estado === "error") {
    return (
      <View style={estilos.centro}>
        <ErrorConReintento texto={carga.error} onReintentar={() => cargar()} />
      </View>
    );
  }

  const orden = carga.datos ?? {};
  const permisos = orden.permisos ?? {};
  const enLaActiva = !empresa || String(empresa) === String(empresaActiva?.id ?? "");
  const pasos = enLaActiva ? pasosDisponibles(orden) : [];
  const asignable = enLaActiva && puedeAsignarse(orden);
  const editable = enLaActiva && Boolean(permisos.editar);
  const conCostos = enLaActiva && Boolean(permisos.registrar_costos);
  const materiales = Array.isArray(orden.materiales) ? orden.materiales : [];
  const manoDeObra = Array.isArray(orden.mano_de_obra) ? orden.mano_de_obra : [];
  const movimientos = Array.isArray(orden.movimientos) ? orden.movimientos : [];
  const costos = orden.costos ?? {};
  const tieneResponsable = Boolean(orden.tecnico || orden.proveedor);
  const contacto = contactoDe(orden);
  // QA-FUNC O-2: cómo se llega a poder reasignarla.
  const comoReasignar = {
    en_ejecucion: "Para reasignarla, páusela antes: una orden en ejecución no se reasigna.",
    pendiente_aprobacion:
      "Para reasignarla, quien acepta el trabajo debe devolverla a ejecución y luego pausarla: una orden pendiente de aprobación no se reasigna.",
  }[orden.estado];

  return (
    <ScrollView
      testID="ficha-orden"
      style={estilos.pantalla}
      contentContainerStyle={[estilos.contenido, rellenoBurbuja]}
      refreshControl={<Refresco refreshing={refrescando} onRefresh={refrescar} />}
    >
      {carga.aviso ? <Alerta tipo="aviso" texto={carga.aviso} /> : null}
      {resultado?.texto ? <Alerta tipo="bien" texto={resultado.texto} clave={resultado.clave} testID="resultado-orden" /> : null}
      {errorAccion ? <Alerta tipo="mal" texto={errorAccion.texto} clave={errorAccion.clave} testID="error-accion" /> : null}

      <View style={estilos.cabecera}>
        <Text style={estilos.numero}>{orden.numero}</Text>
        <Text style={estilos.titulo} accessibilityRole="header">
          {orden.titulo}
        </Text>
        {/* QA-TECH: las tres píldoras se leen juntas, con lo que es cada una. */}
        <View style={estilos.pildoras} accessible accessibilityLabel={resumenDePildoras(orden)} testID="pildoras-de-la-orden">
          <PrioridadOrden orden={orden} />
          <EstadoOrden orden={orden} testID="estado-de-la-orden" />
          <CumplimientoOrden orden={orden} />
        </View>
      </View>

      {!enLaActiva ? (
        <Alerta tipo="info" texto="Esta orden es de otra empresa. Para moverla, cámbiese a ella en «Cuenta»." />
      ) : null}

      {pasos.length > 0 || asignable ? (
        <Seccion titulo="Qué se puede hacer ahora" testID="pasos">
          {pasos.map((p) => (
            <Boton
              key={p.destino}
              testID={`paso-${p.destino}`}
              titulo={p.texto}
              icono={p.icono}
              variante={p.avanza ? "primario" : "secundario"}
              onPress={() => setVentana({ tipo: "paso", destino: p.destino })}
            />
          ))}
          {asignable ? (
            <Boton
              testID="asignar"
              titulo={tieneResponsable ? "Reasignar" : "Asignar"}
              icono="account-switch-outline"
              variante={pasos.length ? "secundario" : "primario"}
              onPress={() => setVentana({ tipo: "asignar" })}
            />
          ) : null}
        </Seccion>
      ) : null}
      {enLaActiva && permisos.asignar && comoReasignar ? (
        <Text style={estilos.tenue} testID="reasignar-pausada">
          {comoReasignar}
        </Text>
      ) : null}

      <Seccion
        titulo="Datos de la orden"
        testID="datos-de-la-orden"
        derecha={
          editable ? (
            <Boton
              testID="corregir"
              titulo="Corregir"
              icono="pencil-outline"
              variante="secundario"
              onPress={() => setVentana({ tipo: "corregir" })}
            />
          ) : null
        }
      >
        <Dato nombre="Sede" valor={sedeDe(orden)} />
        <Dato nombre="Región" valor={regionDe(orden) || "—"} />
        <Dato nombre="Categoría" valor={orden.categoria_display} />
        <Dato nombre="Solicitada por" valor={orden.solicitante?.nombre} />
        <View style={estilos.contacto}>
          <View accessible accessibilityLabel={contacto.dicho} testID="contacto">
            <Text style={estilos.datoNombre}>Teléfono de contacto</Text>
            <Text style={estilos.datoValor}>{contacto.texto}</Text>
          </View>
          {contacto.llamar ? (
            <Boton
              testID="llamar"
              titulo="Llamar"
              icono="phone-outline"
              variante="secundario"
              etiqueta={`Llamar al ${contacto.texto}`}
              onPress={() => llamar(contacto.llamar)}
            />
          ) : null}
          {errorLlamar ? <Alerta tipo="mal" texto={errorLlamar} /> : null}
        </View>
        <Dato nombre="Responsable" valor={orden.responsable || "Sin asignar"} />
        <Dato nombre="Programada" valor={orden.fecha_programada ? fechaCorta(orden.fecha_programada) : "Sin fecha"} />
        <Dato nombre="Registrada" valor={fechaYHora(orden.created_at)} />
        <Dato nombre="Descripción" valor={orden.descripcion} />
        {orden.estado === "cerrada" ? (
          <Dato
            nombre="Cierre"
            valor={`${fechaYHora(orden.fecha_cierre)} · ${
              orden.con_observaciones ? `con observaciones: ${orden.observaciones_cierre}` : "aceptada sin observaciones"
            }`}
          />
        ) : null}
      </Seccion>

      <Seccion titulo="Materiales y mano de obra" testID="costos-de-la-orden">
        <Text style={estilos.subtitulo} accessibilityRole="header">
          Materiales
        </Text>
        <FilasDeCosto tipo="materiales" filas={materiales} puede={conCostos} quitando={quitando} onQuitar={quitar} />
        {conCostos ? (
          <Boton
            testID="agregar-material"
            titulo="Agregar material"
            icono="plus"
            variante="secundario"
            deshabilitado={Boolean(quitando)}
            onPress={() => setVentana({ tipo: "costo", costo: "materiales" })}
          />
        ) : null}
        <Text style={estilos.subtitulo} accessibilityRole="header">
          Mano de obra
        </Text>
        <FilasDeCosto tipo="mano-de-obra" filas={manoDeObra} puede={conCostos} quitando={quitando} onQuitar={quitar} />
        {conCostos ? (
          <Boton
            testID="agregar-mano-de-obra"
            titulo="Agregar mano de obra"
            icono="plus"
            variante="secundario"
            deshabilitado={Boolean(quitando)}
            onPress={() => setVentana({ tipo: "costo", costo: "mano-de-obra" })}
          />
        ) : null}
        <View style={estilos.totales} testID="totales">
          <Dato nombre="Subtotal" valor={moneda(costos.subtotal)} />
          {/* UX H-13: sin porcentaje, solo «IVA». */}
          <Dato
            nombre={costos.iva_porcentaje !== undefined && costos.iva_porcentaje !== null ? `IVA (${costos.iva_porcentaje} %)` : "IVA"}
            valor={moneda(costos.iva)}
          />
          <View style={estilos.total} accessible accessibilityLabel={`Total: ${moneda(costos.total)}`}>
            <Text style={estilos.totalNombre}>Total</Text>
            <Text style={estilos.totalValor}>{moneda(costos.total)}</Text>
          </View>
        </View>
      </Seccion>

      <Seccion titulo="Recorrido" testID="recorrido">
        {movimientos.length === 0 ? <Text style={estilos.tenue}>Sin movimientos.</Text> : null}
        {movimientos.map((m) => (
          <View
            key={m.id}
            style={estilos.movimiento}
            accessible
            accessibilityLabel={[m.descripcion, `${fechaYHora(m.created_at)}, ${m.actor}`, m.nota ? `Nota: ${m.nota}` : null]
              .filter(Boolean)
              .join(". ")}
            testID={`movimiento-${m.id}`}
          >
            <Text style={estilos.movimientoTexto}>{m.descripcion}</Text>
            <Text style={estilos.tenue}>{`${fechaYHora(m.created_at)} · ${m.actor}`}</Text>
            {m.nota ? <Text style={estilos.nota}>{m.nota}</Text> : null}
          </View>
        ))}
      </Seccion>

      {ventana?.tipo === "paso" ? (
        <VentanaCambioDeEstado
          orden={orden}
          destino={ventana.destino}
          onCerrar={() => setVentana(null)}
          onGuardado={alGuardar}
          onRechazo={alRechazo}
        />
      ) : null}
      {ventana?.tipo === "asignar" ? (
        <VentanaAsignar
          orden={orden}
          catalogos={catalogos}
          onCerrar={() => setVentana(null)}
          onGuardado={alGuardar}
          onRechazo={alRechazo}
        />
      ) : null}
      {ventana?.tipo === "costo" ? (
        <VentanaCosto orden={orden} tipo={ventana.costo} onCerrar={() => setVentana(null)} onGuardado={alGuardar} onRechazo={alRechazo} />
      ) : null}
      {ventana?.tipo === "corregir" ? (
        <VentanaCorregir
          orden={orden}
          catalogos={catalogos}
          onCerrar={() => setVentana(null)}
          onGuardado={alGuardar}
          onRechazo={alRechazo}
        />
      ) : null}
    </ScrollView>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, paddingBottom: 40, gap: 16 },
  centro: { padding: 16 },
  cabecera: { gap: 6 },
  numero: { fontSize: 14, fontWeight: "600", color: colores.tintaSuave },
  titulo: { fontSize: 20, fontWeight: "700", color: colores.titulo },
  pildoras: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  subtitulo: { fontSize: 15, fontWeight: "700", color: colores.tinta },
  costo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.fondo,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  costoTextos: { flex: 1, gap: 2 },
  costoNombre: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  costoSubtotal: { fontSize: 14, fontWeight: "600", color: colores.tinta },
  totales: { gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colores.borde },
  total: { gap: 2, paddingTop: 8, borderTopWidth: 2, borderTopColor: colores.primario },
  totalNombre: { fontSize: 15, fontWeight: "700", color: colores.tinta },
  totalValor: { fontSize: 22, fontWeight: "700", color: colores.titulo },
  contacto: { gap: 8 },
  datoNombre: { fontSize: 13, color: colores.tintaSuave },
  datoValor: { fontSize: 16, color: colores.tinta, fontWeight: "600" },
  movimiento: { gap: 2, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colores.borde },
  movimientoTexto: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  // UX H-08: la nota se distingue con una barra a la izquierda, no con
  // cursiva (cuesta leerla con la letra grande).
  nota: { fontSize: 14, color: colores.tinta, paddingLeft: 8, borderLeftWidth: 3, borderLeftColor: colores.bordeFuerte },
});
