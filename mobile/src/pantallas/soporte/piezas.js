import { memo, useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, Text, View } from "react-native";

import { tamanoLegible } from "../../adjuntos/seleccion";
import { Alerta, Boton, BotonIcono } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import {
  elegirArchivoParaElTicket,
  elegirImagenParaElTicket,
  MAX_ADJUNTOS,
  TEXTO_AYUDA_ADJUNTOS,
  tomarFotoParaElTicket,
} from "../../soporte/adjuntos";
import { textoDeVence, tonoDeEstado, tonoDePrioridad, TONOS } from "../../soporte/formato";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { fechaYHora } from "../../utils/fechas";

/**
 * Piezas de la Mesa de ayuda (US-014) que comparten las listas y las fichas.
 * Cada estado, prioridad y plazo se dice con texto e ícono, no solo con
 * color (CA-23).
 */

/** Una pastilla con ícono y texto. `tono`: `{fondo, color, icono}`. */
export function Pildora({ texto, tono = TONOS.neutro, testID }) {
  return (
    <View style={[estilos.pildora, { backgroundColor: tono.fondo }]} testID={testID}>
      {tono.icono ? <Icono nombre={tono.icono} size={16} color={tono.color} /> : null}
      <Text style={[estilos.pildoraTexto, { color: tono.color }]}>{texto}</Text>
    </View>
  );
}

export function EstadoTicket({ ticket }) {
  return <Pildora texto={ticket.estado_display || ticket.estado} tono={tonoDeEstado(ticket.estado)} />;
}

/** Igual para quien pide y para el equipo: «P2 · Alta» (pedido del usuario, 13/11/2026). */
export function PrioridadTicket({ ticket }) {
  if (!ticket.prioridad) return null;
  const texto = ticket.prioridad_display;
  return <Pildora texto={`Prioridad: ${texto}`} tono={tonoDePrioridad(ticket.prioridad)} />;
}

/** El plazo que importa ahora, con su fecha. */
export function VenceTicket({ sla, ahora }) {
  const vence = textoDeVence(sla, ahora);
  return (
    <View style={estilos.vence}>
      <Pildora texto={vence.texto} tono={vence} />
      {vence.fecha ? <Text style={estilos.tenue}>{vence.fecha}</Text> : null}
    </View>
  );
}

/** Un dato de una ficha: nombre y valor, leídos juntos. */
export function Dato({ nombre, valor, children }) {
  if (!children && (valor === undefined || valor === null || valor === "")) return null;
  return (
    <View
      style={estilos.dato}
      accessible={!children}
      accessibilityLabel={children ? undefined : `${nombre}: ${valor}`}
    >
      <Text style={estilos.datoNombre}>{nombre}</Text>
      {children ?? <Text style={estilos.datoValor}>{valor}</Text>}
    </View>
  );
}

/** Una sección con su encabezado. */
export function Seccion({ titulo, children, testID, derecha = null }) {
  return (
    <View style={estilos.seccion} testID={testID}>
      <View style={estilos.seccionCabecera}>
        <Text style={estilos.subtitulo} accessibilityRole="header">
          {titulo}
        </Text>
        {derecha}
      </View>
      {children}
    </View>
  );
}

/** Los adjuntos de un ticket o de un mensaje: un botón por archivo. */
export const ListaDeAdjuntos = memo(function ListaDeAdjuntos({ lista, abriendo, onAbrir }) {
  if (!lista?.length) return null;
  return (
    <View style={estilos.adjuntos}>
      {lista.map((a) => {
        const cargando = abriendo === a.id;
        const tamano = tamanoLegible(a.tamano);
        return (
          <Pressable
            key={a.id}
            testID={`adjunto-${a.id}`}
            onPress={() => onAbrir(a)}
            disabled={Boolean(abriendo)}
            accessibilityRole="button"
            // Mientras descarga se dice lo mismo que se ve (QA-TECH).
            accessibilityLabel={
              cargando ? `Abriendo ${a.nombre}…` : `${a.nombre}${tamano ? `, ${tamano}` : ""}. Abrir el adjunto`
            }
            accessibilityState={{ busy: cargando, disabled: Boolean(abriendo) }}
            style={({ pressed }) => [estilos.adjunto, pressed && estilos.presionada]}
          >
            {cargando ? (
              <ActivityIndicator color={colores.primario} />
            ) : (
              <Icono nombre="paperclip" size={20} color={colores.primario} />
            )}
            <Text style={estilos.adjuntoTexto}>
              {cargando ? `Abriendo ${a.nombre}…` : a.nombre}
              {tamano && !cargando ? <Text style={estilos.tenue}>{` · ${tamano}`}</Text> : null}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

/** Quién habló en un mensaje, en texto (CA-11). `modo`: `equipo` (la ficha
 * del técnico) o `propio` (quien pidió). */
function marcaDe(mensaje, modo) {
  if (modo === "equipo") {
    if (mensaje.interno) return { texto: "Nota interna", dicho: "Nota interna (el usuario no la ve)", tono: { ...TONOS.aviso, icono: "lock" } };
    if (mensaje.del_solicitante) return { texto: "Usuario", dicho: "Usuario", tono: { ...TONOS.info, icono: "account-outline" } };
    return { texto: "Equipo", dicho: "Equipo", tono: { ...TONOS.neutro, icono: "headset" } };
  }
  if (mensaje.del_solicitante) return { texto: "Usted", dicho: "Usted", tono: { ...TONOS.info, icono: "account-outline" } };
  return { texto: "Soporte TI", dicho: "Soporte TI", tono: { ...TONOS.neutro, icono: "headset" } };
}

/** Un mensaje de la conversación. La nota interna va con otro fondo, un
 * borde y el candado, y se anuncia como tal. H-10 y N-01: lo de quien mira a
 * la derecha, lo del otro lado a la izquierda y la nota interna a todo el
 * ancho; el lado nunca es lo único que dice quién habló (la pastilla lo
 * dice). */
export const MensajeDelTicket = memo(function MensajeDelTicket({ mensaje, modo = "equipo", abriendo, onAbrir }) {
  const marca = marcaDe(mensaje, modo);
  const propio = modo === "propio" ? mensaje.del_solicitante : !mensaje.del_solicitante && !mensaje.interno;
  const autor = modo === "propio" && mensaje.del_solicitante ? "" : mensaje.autor;
  const cuando = fechaYHora(mensaje.fecha);
  // N-01: como en el chat, lo de quien mira va a la derecha (en la ficha de
  // quien pide, «Usted»; en la del equipo, el equipo).
  const lado = mensaje.interno ? null : propio ? estilos.aLaDerecha : estilos.aLaIzquierda;
  return (
    <View
      testID={`mensaje-${mensaje.id}`}
      style={[estilos.mensaje, lado, propio && estilos.mensajePropio, mensaje.interno && estilos.mensajeInterno]}
    >
      <View
        style={estilos.mensajeCabecera}
        accessible
        accessibilityLabel={[marca.dicho, autor, cuando].filter(Boolean).join(", ")}
      >
        <Pildora texto={marca.texto} tono={marca.tono} />
        {autor ? <Text style={estilos.autor}>{autor}</Text> : null}
        <Text style={estilos.tenue}>{cuando}</Text>
      </View>
      {mensaje.texto ? (
        <Text style={estilos.mensajeTexto} selectable>
          {mensaje.texto}
        </Text>
      ) : null}
      <ListaDeAdjuntos lista={mensaje.adjuntos} abriendo={abriendo} onAbrir={onAbrir} />
    </View>
  );
});

/**
 * Los archivos por enviar (`useAdjuntosPorEnviar`): la lista con «Quitar» y
 * «Adjuntar» con sus tres formas (cámara, galería o archivo), como el clip
 * del chat. Lo que no vale se dice antes de enviar (CA-18).
 */
export function AdjuntosPorEnviar({ adjuntos, deshabilitado = false, testID = "adjuntos", refFoco, errorExterno }) {
  const [opciones, setOpciones] = useState(false);
  const { lista, error, agregar, quitar } = adjuntos;
  const lleno = lista.length >= MAX_ADJUNTOS;
  // El foco de un error va a un bloque accesible que lo dice (QA-TECH).
  const dicho = ["Capturas o archivos (opcional)", TEXTO_AYUDA_ADJUNTOS, errorExterno ? `Error: ${errorExterno}` : null]
    .filter(Boolean)
    .join(". ");

  async function elegir(como) {
    setOpciones(false);
    await agregar(como);
  }

  return (
    <View style={estilos.porEnviar} testID={testID}>
      <View ref={refFoco} accessible accessibilityLabel={dicho} testID={`${testID}-etiqueta`}>
        <Text style={estilos.etiqueta}>
          Capturas o archivos <Text style={estilos.tenue}>(opcional)</Text>
        </Text>
        <Text style={estilos.tenue}>{TEXTO_AYUDA_ADJUNTOS}</Text>
        {errorExterno ? <Text style={estilos.errorTexto}>{errorExterno}</Text> : null}
      </View>
      {lista.map((a, i) => (
        <View key={`${a.uri}-${i}`} style={estilos.elegido} testID={`${testID}-elegido-${i}`}>
          <Icono
            nombre={a.type?.startsWith("image/") ? "file-image-outline" : "file-document-outline"}
            size={20}
            color={colores.primario}
          />
          <Text style={estilos.elegidoTexto}>
            {a.name}
            {a.size ? ` · ${tamanoLegible(a.size)}` : ""}
          </Text>
          <BotonIcono
            testID={`${testID}-quitar-${i}`}
            icono="close"
            color={colores.tinta}
            etiqueta={`Quitar el archivo ${a.name}`}
            deshabilitado={deshabilitado}
            onPress={() => quitar(i)}
          />
        </View>
      ))}
      {error ? <Alerta tipo="aviso" texto={error.texto} clave={error.clave} testID={`${testID}-error`} /> : null}
      <View>
        <Boton
          testID={`${testID}-adjuntar`}
          titulo={lleno ? `Adjuntar foto o archivo (máximo ${MAX_ADJUNTOS})` : "Adjuntar foto o archivo"}
          // WCAG 2.5.3: el nombre accesible empieza por lo que se ve.
          etiqueta={
            lleno
              ? `Adjuntar foto o archivo (máximo ${MAX_ADJUNTOS}): ya eligió ${MAX_ADJUNTOS}`
              : `Adjuntar foto o archivo, ${lista.length} de ${MAX_ADJUNTOS}`
          }
          icono="paperclip"
          variante="secundario"
          deshabilitado={deshabilitado}
          expandido={opciones}
          pista={TEXTO_AYUDA_ADJUNTOS}
          onPress={() => {
            // Con el teclado arriba, las opciones quedarían tapadas (N-07).
            if (!opciones) Keyboard.dismiss();
            setOpciones((v) => !v);
          }}
        />
      </View>
      {opciones ? (
        <View style={estilos.opcionesAdjunto} testID={`${testID}-opciones`}>
          <Boton
            testID={`${testID}-camara`}
            titulo="Tomar foto"
            icono="camera-outline"
            variante="secundario"
            onPress={() => elegir(tomarFotoParaElTicket)}
          />
          <Boton
            testID={`${testID}-galeria`}
            titulo="Elegir imagen"
            icono="image-outline"
            variante="secundario"
            onPress={() => elegir(elegirImagenParaElTicket)}
          />
          <Boton
            testID={`${testID}-archivo`}
            titulo="Elegir archivo"
            icono="file-document-outline"
            variante="secundario"
            onPress={() => elegir(elegirArchivoParaElTicket)}
          />
        </View>
      ) : null}
    </View>
  );
}

/** El espacio entre las filas de una lista. */
export function Separador() {
  return <View style={estilos.separador} />;
}

export const estilos = crearEstilos({
  pildora: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  pildoraTexto: { fontSize: 13, fontWeight: "700", flexShrink: 1 },
  vence: { gap: 2 },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  dato: { gap: 2 },
  datoNombre: { fontSize: 13, color: colores.tintaSuave },
  datoValor: { fontSize: 16, color: colores.tinta, fontWeight: "600" },
  seccion: {
    gap: 10,
    padding: 14,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  seccionCabecera: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  subtitulo: { flex: 1, fontSize: 17, fontWeight: "700", color: colores.titulo },
  adjuntos: { gap: 4 },
  adjunto: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  adjuntoTexto: { flex: 1, fontSize: 15, color: colores.enlace, textDecorationLine: "underline" },
  presionada: { backgroundColor: colores.realce },
  mensaje: {
    gap: 6,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  mensajePropio: { backgroundColor: colores.fondo },
  aLaDerecha: { marginLeft: 24 },
  aLaIzquierda: { marginRight: 24 },
  errorTexto: { fontSize: 14, color: colores.malTexto },
  // La nota interna: fondo de aviso, borde izquierdo grueso y el candado en
  // la pastilla; el lector dice «Nota interna (el usuario no la ve)».
  mensajeInterno: {
    backgroundColor: colores.avisoFondo,
    borderColor: colores.avisoTexto,
    borderLeftWidth: 5,
  },
  mensajeCabecera: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  autor: { fontSize: 15, fontWeight: "700", color: colores.tinta, flexShrink: 1 },
  mensajeTexto: { fontSize: 15, color: colores.tinta },
  porEnviar: { gap: 6 },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  elegido: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 10,
    borderRadius: 8,
    backgroundColor: colores.hundido,
  },
  elegidoTexto: { flex: 1, fontSize: 15, color: colores.tinta },
  opcionesAdjunto: { gap: 8 },
  separador: { height: 10 },
});
