import { memo, useCallback, useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AREA_TACTIL, colores } from "../tema/colores";
import { CONTROLES } from "../tema/controles";
import { crearEstilos } from "../tema/tipografia";
import { BotonIcono } from "./comunes";
import { Icono } from "./Icono";

/**
 * Elegir una opción (US-014, 13/11/2026: el formulario de la Mesa de ayuda,
 * los filtros de la bandeja y «Asignar a»). La app no tenía un control de
 * lista: los grupos de radios de los permisos se repetían en cada pantalla.
 *
 * - `OpcionesEnLinea`: pocas opciones, a la vista (radios con
 *   `CONTROLES.opcion`).
 * - `SelectorDeLista`: muchas opciones; el campo es un botón que dice la
 *   etiqueta, lo elegido y el error, y abre la lista a pantalla completa. Con
 *   `compacto` (los filtros de la bandeja, H-03) es una ficha «Estado:
 *   Abiertos ▾», sin etiqueta aparte.
 * - `Casilla`: sí o no.
 *
 * Las etiquetas visibles empiezan el nombre accesible (WCAG 2.5.3), lo
 * obligatorio se dice con «(obligatorio)» y el error con «Error: …». Todo
 * escala con la letra del sistema: sin alturas fijas ni `numberOfLines`.
 */

function etiquetaAccesible({ etiqueta, obligatorio, ayuda, error }) {
  return [`${etiqueta}${obligatorio ? " (obligatorio)" : ""}`, ayuda, error ? `Error: ${error}` : null]
    .filter(Boolean)
    .join(". ");
}

function Etiqueta({ etiqueta, obligatorio, opcional, ayuda }) {
  return (
    <>
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
    </>
  );
}

export function ErrorDeCampo({ error }) {
  if (!error) return null;
  return (
    <View style={estilos.filaError} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Icono nombre="alert-circle-outline" size={16} color={colores.malTexto} />
      <Text style={estilos.error}>{error}</Text>
    </View>
  );
}

/** Pocas opciones a la vista. `opciones`: `[{valor, texto}]`. */
export function OpcionesEnLinea({
  etiqueta,
  opciones,
  valor,
  onCambio,
  obligatorio = false,
  opcional = false,
  ayuda,
  error,
  refFoco,
  testID,
  deshabilitado = false,
}) {
  const grupo = etiquetaAccesible({ etiqueta, obligatorio, ayuda, error });
  return (
    <View style={estilos.campo} testID={testID}>
      <Etiqueta etiqueta={etiqueta} obligatorio={obligatorio} opcional={opcional} ayuda={ayuda} />
      <View accessibilityRole="radiogroup" accessibilityLabel={grupo} style={estilos.opciones}>
        {opciones.map((o, i) => {
          const activa = String(o.valor) === String(valor ?? "");
          return (
            <Pressable
              key={String(o.valor)}
              ref={i === 0 ? refFoco : undefined}
              testID={testID ? `${testID}-${o.valor}` : undefined}
              onPress={() => onCambio(o.valor)}
              disabled={deshabilitado}
              accessibilityRole="radio"
              accessibilityState={{ checked: activa, disabled: deshabilitado }}
              accessibilityLabel={i === 0 && error ? `${o.texto}. Error: ${error}` : o.texto}
              accessibilityHint={etiqueta}
              style={({ pressed }) => [
                estilos.opcion,
                activa && estilos.opcionActiva,
                error && i === 0 && !activa && estilos.opcionConError,
                pressed && estilos.presionada,
              ]}
            >
              <Icono
                nombre={activa ? "radiobox-marked" : "radiobox-blank"}
                size={22}
                color={activa ? colores.primario : colores.bordeControl}
              />
              <Text style={estilos.opcionTexto}>{o.texto}</Text>
            </Pressable>
          );
        })}
      </View>
      <ErrorDeCampo error={error} />
    </View>
  );
}

const FilaDeOpcion = memo(function FilaDeOpcion({ opcion, activa, onElegir, testID }) {
  return (
    <Pressable
      testID={testID}
      onPress={() => onElegir(opcion.valor)}
      accessibilityRole="radio"
      accessibilityState={{ checked: activa }}
      accessibilityLabel={opcion.detalle ? `${opcion.texto}. ${opcion.detalle}` : opcion.texto}
      style={({ pressed }) => [estilos.opcion, activa && estilos.opcionActiva, pressed && estilos.presionada]}
    >
      <Icono
        nombre={activa ? "radiobox-marked" : "radiobox-blank"}
        size={22}
        color={activa ? colores.primario : colores.bordeControl}
      />
      <View style={estilos.opcionTextos}>
        <Text style={estilos.opcionTexto}>{opcion.texto}</Text>
        {opcion.detalle ? <Text style={estilos.ayuda}>{opcion.detalle}</Text> : null}
      </View>
    </Pressable>
  );
});

/**
 * Muchas opciones: un campo que abre la lista. `opciones`: `[{valor, texto,
 * detalle?}]`. `vacio`: lo que dice sin elegir; con `conVacio`, también es
 * una opción de la lista (los filtros: «Todas»).
 */
export function SelectorDeLista({
  etiqueta,
  opciones,
  valor,
  onCambio,
  vacio = "Elija una opción",
  conVacio = false,
  obligatorio = false,
  opcional = false,
  ayuda,
  error,
  deshabilitado = false,
  textoDeshabilitado,
  refFoco,
  testID,
  compacto = false,
}) {
  const [abierta, setAbierta] = useState(false);
  const elegida = opciones.find((o) => String(o.valor) === String(valor ?? ""));
  const visible = elegida?.texto ?? (deshabilitado && textoDeshabilitado ? textoDeshabilitado : vacio);
  const lista = conVacio ? [{ valor: "", texto: vacio }, ...opciones] : opciones;
  const elegir = useCallback(
    (nuevo) => {
      setAbierta(false);
      onCambio(nuevo);
    },
    [onCambio],
  );
  // WCAG 2.5.3: en el compacto se ve «Estado: Abiertos» y se dice igual.
  const nombre = compacto
    ? `${etiqueta}: ${visible}`
    : [etiquetaAccesible({ etiqueta, obligatorio, ayuda, error }), `Elegido: ${visible}`].join(". ");
  const conValor = Boolean(elegida) && String(elegida.valor) !== "";
  return (
    <View style={compacto ? null : estilos.campo}>
      {compacto ? null : <Etiqueta etiqueta={etiqueta} obligatorio={obligatorio} opcional={opcional} ayuda={ayuda} />}
      <Pressable
        ref={refFoco}
        testID={testID}
        onPress={() => setAbierta(true)}
        disabled={deshabilitado}
        accessibilityRole="button"
        accessibilityLabel={nombre}
        accessibilityHint="Abre la lista de opciones"
        accessibilityState={{ disabled: deshabilitado, expanded: abierta }}
        style={({ pressed }) =>
          compacto
            ? [estilos.ficha, conValor && estilos.fichaActiva, pressed && !conValor && estilos.presionada]
            : [estilos.selector, error && estilos.entradaConError, deshabilitado && estilos.inactivo, pressed && estilos.presionada]
        }
      >
        {compacto ? (
          <Text style={[estilos.fichaTexto, conValor && estilos.fichaTextoActiva]}>{`${etiqueta}: ${visible}`}</Text>
        ) : (
          <Text style={[estilos.selectorTexto, !elegida && estilos.selectorVacio]}>{visible}</Text>
        )}
        <Icono
          nombre="chevron-down"
          size={compacto ? 18 : 22}
          color={colores.primario}
        />
      </Pressable>
      {compacto ? null : <ErrorDeCampo error={error} />}
      <Modal visible={abierta} animationType="slide" onRequestClose={() => setAbierta(false)}>
        <SafeAreaView style={estilos.modal}>
          <View style={estilos.modalCabecera}>
            <Text style={estilos.modalTitulo} accessibilityRole="header">
              {etiqueta}
            </Text>
            <BotonIcono
              icono="close"
              etiqueta="Cerrar sin elegir"
              onPress={() => setAbierta(false)}
              testID={testID ? `${testID}-cerrar` : undefined}
            />
          </View>
          <FlatList
            data={lista}
            keyExtractor={(o) => String(o.valor)}
            contentContainerStyle={estilos.modalLista}
            accessibilityRole="radiogroup"
            accessibilityLabel={etiqueta}
            renderItem={({ item }) => (
              <FilaDeOpcion
                opcion={item}
                activa={String(item.valor) === String(valor ?? "")}
                onElegir={elegir}
                testID={testID ? `${testID}-opcion-${item.valor === "" ? "vacia" : item.valor}` : undefined}
              />
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

/** Sí o no, con el estado dicho (no solo el ícono). */
export function Casilla({ etiqueta, marcada, onCambio, ayuda, error, refFoco, testID, obligatorio = false }) {
  return (
    <View style={estilos.campo}>
      <Pressable
        ref={refFoco}
        testID={testID}
        onPress={() => onCambio(!marcada)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: Boolean(marcada) }}
        accessibilityLabel={etiquetaAccesible({ etiqueta, obligatorio, ayuda, error })}
        style={({ pressed }) => [estilos.casilla, pressed && estilos.presionada]}
      >
        <Icono
          nombre={marcada ? "checkbox-marked-outline" : "checkbox-blank-outline"}
          size={24}
          color={marcada ? colores.primario : colores.bordeControl}
        />
        <View style={estilos.opcionTextos}>
          <Text style={estilos.opcionTexto}>
            {etiqueta}
            {obligatorio ? <Text style={estilos.obligatorio}> *</Text> : null}
          </Text>
          {ayuda ? <Text style={estilos.ayuda}>{ayuda}</Text> : null}
        </View>
      </Pressable>
      <ErrorDeCampo error={error} />
    </View>
  );
}

const estilos = crearEstilos({
  campo: { gap: 4 },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  obligatorio: { color: colores.malTexto },
  opcional: { fontSize: 14, fontWeight: "400", color: colores.tintaSuave },
  ayuda: { fontSize: 13, color: colores.tintaSuave },
  opciones: { gap: 6 },
  opcion: CONTROLES.opcion,
  opcionActiva: CONTROLES.opcionActiva,
  opcionConError: { borderColor: colores.malTexto, borderWidth: 2 },
  opcionTexto: CONTROLES.opcionTexto,
  opcionTextos: { flex: 1, gap: 2 },
  presionada: { backgroundColor: colores.realce },
  selector: {
    ...CONTROLES.entrada,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
  },
  selectorTexto: { flex: 1, fontSize: 16, color: colores.tinta },
  ficha: { ...CONTROLES.pildora, paddingVertical: 6 },
  // N-10 (US-014): activo con fondo `realce` y contorno de 2, no negro
  // relleno (ese es el de las pestañas).
  fichaActiva: { backgroundColor: colores.realce, borderColor: colores.primario, borderWidth: 2 },
  fichaTexto: CONTROLES.pildoraTexto,
  fichaTextoActiva: { color: colores.tinta },
  selectorVacio: { color: colores.tintaTenue },
  entradaConError: CONTROLES.entradaConError,
  inactivo: { opacity: 0.6 },
  filaError: { flexDirection: "row", alignItems: "center", gap: 6 },
  error: { flex: 1, fontSize: 14, color: colores.malTexto },
  casilla: { minHeight: AREA_TACTIL, flexDirection: "row", alignItems: "center", gap: 10 },
  modal: { flex: 1, backgroundColor: colores.fondo },
  modalCabecera: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colores.superficie,
    borderBottomWidth: 1,
    borderBottomColor: colores.borde,
  },
  modalTitulo: { flex: 1, fontSize: 18, fontWeight: "700", color: colores.titulo },
  modalLista: { padding: 16, gap: 6 },
});
