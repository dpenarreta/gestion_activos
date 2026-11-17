import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { ESPERA_FOCO_ANDROID_MS, ESPERA_FOCO_IOS_MS } from "../../accesibilidad/irAlBloque";
import { ordenesService } from "../../api/servicios";
import { BotonIcono, ErrorConReintento } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { ErrorDeCampo } from "../../componentes/Selectores";
import { ESPERA_BUSCAR_MS, mensajeDeOrdenes, opcionesDeResponsables } from "../../ordenes/formato";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";
import { normalizar } from "../../utils/texto";
import { useMontado } from "../activos/piezas";

/** El texto que acompaña a cada opción. */
function detalleDe(opcion) {
  if (opcion.tipo === "proveedor") return "Proveedor";
  return opcion.proveedor ? `Persona · último proveedor: ${opcion.proveedor.nombre}` : "Persona";
}

/** Las opciones de un grupo, cada una un botón que la elige. */
function Grupo({ titulo, opciones, onElegir, deshabilitado, testID }) {
  if (!opciones.length) return null;
  return (
    <View style={estilos.grupo}>
      <Text style={estilos.grupoTitulo} accessibilityRole="header">
        {titulo}
      </Text>
      {opciones.map((o) => (
        <Pressable
          key={`${o.tipo}-${o.id}`}
          testID={`${testID}-${o.tipo}-${o.id}`}
          onPress={() => onElegir(o)}
          disabled={deshabilitado}
          accessibilityRole="button"
          accessibilityState={{ disabled: deshabilitado }}
          accessibilityLabel={`${o.nombre}. ${detalleDe(o)}`}
          accessibilityHint="Lo elige para la orden"
          style={({ pressed }) => [estilos.opcion, pressed && estilos.presionada]}
        >
          <Icono nombre={o.tipo === "proveedor" ? "domain" : "account-hard-hat-outline"} size={20} color={colores.primario} />
          <View style={estilos.textos}>
            <Text style={estilos.opcionTexto}>{o.nombre}</Text>
            <Text style={estilos.tenue}>{detalleDe(o)}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Elegir quién realiza una orden escribiendo parte de su nombre (US-025,
 * CA-14; el `BuscadorDeResponsable.jsx` de la web): `GET
 * ordenes/responsables/?q=`, en dos grupos, «Proveedores» y «Personas», 400 ms
 * después de la última tecla (sin texto, al tocar el campo, los primeros de
 * cada grupo). Una respuesta vieja no pisa a una nueva.
 *
 * - Lo elegido se ve en una tarjeta con «Quitar»: lo que se ve es lo que se
 *   guarda.
 * - Al final de la lista, «Registrar proveedor nuevo» con lo escrito: el
 *   camino cuando lo que se busca no existe (CA-15).
 * - «Buscar» en el teclado elige si lo escrito coincide exactamente con una
 *   sola opción.
 * - UX H-03: tras elegir, el foco del lector va a la tarjeta de lo elegido;
 *   tras quitarlo, al campo de búsqueda. UX H-12: en iOS (sin regiones vivas)
 *   se anuncia cuántos resultados hay.
 *
 * `soloProveedores`: el campo «Proveedor» de una persona.
 */
export function BuscadorDeResponsable({
  etiqueta,
  obligatorio = false,
  opcional = false,
  ayuda,
  error,
  elegido,
  onElegir,
  onTexto,
  onRegistrar,
  soloProveedores = false,
  placeholder,
  textoVacio,
  etiquetaQuitar,
  refFoco,
  deshabilitado = false,
  testID = "responsable",
}) {
  const [texto, setTexto] = useState("");
  const [abierta, setAbierta] = useState(false);
  const [vez, setVez] = useState(0);
  const [estado, setEstado] = useState({ cargando: false, datos: null, error: null, buscadoCon: null });
  const montado = useMontado();
  const consulta = useRef(0);
  const termino = texto.trim();
  // El nodo accesible que se ve (la tarjeta o el campo), sin perder el
  // `refFoco` de quien lo usa (`useIrAlBloque`).
  const nodo = useRef(null);
  const focoPendiente = useRef(false);
  const fijarNodo = useCallback(
    (n) => {
      nodo.current = n;
      if (typeof refFoco === "function") refFoco(n);
      else if (refFoco) refFoco.current = n;
    },
    [refFoco],
  );

  // Tras elegir o quitar desde aquí, el foco va a lo que apareció.
  useEffect(() => {
    if (!focoPendiente.current) return undefined;
    focoPendiente.current = false;
    const espera = setTimeout(
      () => {
        if (!nodo.current) return;
        try {
          AccessibilityInfo.sendAccessibilityEvent(nodo.current, "focus");
        } catch {
          // Sin lector de pantalla no hay foco que mover.
        }
      },
      Platform.OS === "android" ? ESPERA_FOCO_ANDROID_MS : ESPERA_FOCO_IOS_MS,
    );
    return () => clearTimeout(espera);
  }, [elegido]);

  useEffect(() => {
    onTexto?.(elegido ? "" : texto);
  }, [texto, elegido, onTexto]);

  useEffect(() => {
    if (!abierta || elegido) return undefined;
    const numero = ++consulta.current;
    setEstado((s) => ({ ...s, cargando: true, error: null }));
    const pausa = setTimeout(
      () => {
        ordenesService
          .responsables(termino, { soloProveedores })
          .then((datos) => {
            if (!montado.current || numero !== consulta.current) return;
            setEstado({ cargando: false, datos, error: null, buscadoCon: termino });
          })
          .catch((e) => {
            if (!montado.current || numero !== consulta.current) return;
            setEstado({ cargando: false, datos: null, error: mensajeDeOrdenes(e, "No se pudo buscar."), buscadoCon: termino });
          });
      },
      termino ? ESPERA_BUSCAR_MS : 0,
    );
    return () => clearTimeout(pausa);
  }, [abierta, elegido, termino, vez, soloProveedores, montado]);

  function elegir(opcion) {
    setTexto("");
    setAbierta(false);
    focoPendiente.current = true;
    onElegir(opcion);
  }

  function quitar() {
    focoPendiente.current = true;
    onElegir(null);
  }

  const { proveedores, personas } = opcionesDeResponsables(estado.datos, { soloProveedores });
  const todas = [...proveedores, ...personas];
  const aDia = estado.buscadoCon === termino && !estado.cargando;
  const cuantos = aDia && !estado.error ? todas.length : null;

  useEffect(() => {
    if (Platform.OS !== "ios" || cuantos === null || !abierta || elegido) return;
    anunciar(cuantos === 0 ? "Ningún resultado." : `${cuantos} ${cuantos === 1 ? "resultado" : "resultados"}.`);
  }, [cuantos, estado.buscadoCon, abierta, elegido]);

  function buscarYa() {
    if (!aDia) return;
    const iguales = todas.filter((o) => normalizar(o.nombre) === normalizar(termino));
    if (iguales.length === 1) elegir(iguales[0]);
  }

  const etiquetaAccesible = [
    `${etiqueta}${obligatorio ? " (obligatorio)" : ""}`,
    ayuda,
    error ? `Error: ${error}` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <View style={estilos.campo}>
      <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
        {etiqueta}
        {obligatorio ? <Text style={estilos.obligatorio}> *</Text> : null}
        {opcional ? <Text style={estilos.opcional}> (opcional)</Text> : null}
      </Text>
      {ayuda ? (
        <Text style={estilos.ayuda} importantForAccessibility="no" accessibilityElementsHidden>
          {ayuda}
        </Text>
      ) : null}
      {elegido ? (
        <View style={estilos.elegido} testID={`${testID}-elegido`}>
          <View
            ref={fijarNodo}
            style={estilos.textos}
            accessible
            accessibilityLabel={[`${etiqueta}: ${elegido.nombre}`, detalleDe(elegido), ayuda, error ? `Error: ${error}` : null]
              .filter(Boolean)
              .join(". ")}
          >
            <Text style={estilos.opcionTexto}>{elegido.nombre}</Text>
            <Text style={estilos.tenue}>{detalleDe(elegido)}</Text>
          </View>
          <BotonIcono
            testID={`${testID}-quitar`}
            icono="close"
            color={colores.tinta}
            etiqueta={etiquetaQuitar ? `${etiquetaQuitar} ${elegido.nombre}` : `Cambiar ${elegido.nombre}`}
            deshabilitado={deshabilitado}
            onPress={quitar}
          />
        </View>
      ) : (
        <TextInput
          ref={fijarNodo}
          testID={testID}
          value={texto}
          onChangeText={(v) => {
            setTexto(v);
            setAbierta(true);
          }}
          onFocus={() => setAbierta(true)}
          editable={!deshabilitado}
          placeholder={placeholder}
          placeholderTextColor={colores.tintaTenue}
          accessibilityLabel={etiquetaAccesible}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={buscarYa}
          style={[estilos.entrada, error && estilos.entradaConError]}
        />
      )}
      <ErrorDeCampo error={error} />
      {!elegido && abierta ? (
        <View style={estilos.resultados} testID={`${testID}-resultados`}>
          {estado.cargando ? (
            <View style={estilos.linea} accessible accessibilityRole="progressbar" accessibilityLabel="Buscando…">
              <ActivityIndicator color={colores.primario} />
              <Text style={estilos.tenue}>Buscando…</Text>
            </View>
          ) : null}
          {estado.error ? <ErrorConReintento texto={estado.error} onReintentar={() => setVez((v) => v + 1)} /> : null}
          {aDia && !estado.error ? (
            <>
              {todas.length === 0 && textoVacio ? (
                <Text style={estilos.tenue} accessibilityLiveRegion="polite">
                  {textoVacio(termino)}
                </Text>
              ) : null}
              <Grupo titulo="Proveedores" opciones={proveedores} onElegir={elegir} deshabilitado={deshabilitado} testID={testID} />
              <Grupo titulo="Personas" opciones={personas} onElegir={elegir} deshabilitado={deshabilitado} testID={testID} />
            </>
          ) : null}
          {onRegistrar ? (
            <Pressable
              testID={`${testID}-registrar`}
              onPress={() => onRegistrar(termino)}
              disabled={deshabilitado}
              accessibilityRole="button"
              accessibilityState={{ disabled: deshabilitado }}
              accessibilityLabel={termino ? `Registrar el proveedor «${termino}»` : "Registrar un proveedor nuevo"}
              style={({ pressed }) => [estilos.opcion, estilos.registrar, pressed && estilos.presionada]}
            >
              <Icono nombre="plus-circle-outline" size={20} color={colores.primario} />
              <Text style={estilos.opcionTexto}>{termino ? `Registrar el proveedor «${termino}»` : "Registrar un proveedor nuevo"}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const estilos = crearEstilos({
  campo: { gap: 6 },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  obligatorio: { color: colores.malTexto },
  opcional: { fontSize: 14, fontWeight: "400", color: colores.tintaSuave },
  ayuda: { fontSize: 13, color: colores.tintaSuave },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  entrada: CONTROLES.entrada,
  entradaConError: CONTROLES.entradaConError,
  resultados: { gap: 8 },
  grupo: { gap: 6 },
  grupoTitulo: { fontSize: 14, fontWeight: "700", color: colores.tintaSuave },
  linea: { flexDirection: "row", alignItems: "center", gap: 6 },
  textos: { flex: 1, gap: 2 },
  opcion: CONTROLES.opcion,
  opcionTexto: { ...CONTROLES.opcionTexto, fontWeight: "600" },
  registrar: { borderStyle: "dashed" },
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
});
