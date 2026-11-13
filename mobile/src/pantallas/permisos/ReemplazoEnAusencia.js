import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { mensajeDeError } from "../../api/errores";
import { directorioService } from "../../api/servicios";
import { Boton, ErrorConReintento } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";
import {
  MAXIMO_RESULTADOS,
  MINIMO_BUSQUEDA,
  TEXTO_HAY_MAS,
  TEXTO_MINIMO_BUSQUEDA,
  textoDeResultados,
} from "../../utils/busqueda";

/**
 * El bloque «Mientras usted no está» de la nueva solicitud, con los textos de
 * `ReemplazoEnAusencia.jsx` de la web: su jefe inmediato u otra persona de la
 * empresa, que se busca por nombre en el directorio del chat (que ya deja
 * fuera a quien pregunta; el servidor también lo rechaza). `reemplazo` es lo
 * que devuelve `useReemplazoEnAusencia`.
 */
export const ESPERA_BUSCAR_MS = 300;

export const TEXTO_AYUDA_REEMPLAZO =
  "Si a usted le toca aprobar solicitudes, mientras esté ausente pasan a esta persona. Esta elección se guarda para todas sus ausencias.";
export const TEXTO_SIN_JEFE =
  "Usted no tiene un jefe inmediato registrado: sus aprobaciones se quedarán con usted. Si alguien debe aprobar por usted, elija «Otra persona».";

/**
 * `refFoco`: a dónde va el foco del lector con un error en este bloque
 * (R-03): el buscador si se está eligiendo a otra persona; si no, la
 * pregunta «¿Quién aprueba por usted?»; mientras carga, el título.
 */
export function ReemplazoEnAusencia({ reemplazo, deshabilitado = false, refFoco }) {
  const { datos, errorCarga, cargar, modo, setModo, persona, setPersona, error, guardando } = reemplazo;
  const bloqueado = deshabilitado || guardando;
  const enBuscador = Boolean(datos) && modo === "persona" && !persona;

  let contenido;
  if (errorCarga) {
    contenido = <ErrorConReintento texto={errorCarga} onReintentar={cargar} />;
  } else if (!datos) {
    contenido = (
      <Text style={estilos.tenue} accessibilityLiveRegion="polite">
        Cargando quién aprueba por usted…
      </Text>
    );
  } else {
    const jefe = datos.jefe;
    const opciones = [
      // En «usted», como el resto de la app (la web dice «Mi jefe…»).
      { valor: "jefe", texto: jefe ? `Su jefe inmediato (${jefe.nombre})` : "Su jefe inmediato" },
      { valor: "persona", texto: "Otra persona" },
    ];
    contenido = (
      <>
        <Text style={estilos.pregunta} accessibilityRole="header" ref={enBuscador ? undefined : refFoco}>
          ¿Quién aprueba por usted?
        </Text>
        <Text style={estilos.tenue}>{TEXTO_AYUDA_REEMPLAZO}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="¿Quién aprueba por usted?">
          {opciones.map((o) => {
            const activo = modo === o.valor;
            return (
              <Pressable
                key={o.valor}
                testID={`reemplazo-${o.valor}`}
                onPress={() => setModo(o.valor)}
                disabled={bloqueado}
                accessibilityRole="radio"
                accessibilityState={{ checked: activo, disabled: bloqueado }}
                accessibilityLabel={o.texto}
                accessibilityHint="Quién aprueba por usted mientras no está"
                style={[estilos.opcion, activo && estilos.opcionActiva]}
              >
                <Icono
                  nombre={activo ? "radiobox-marked" : "radiobox-blank"}
                  size={22}
                  color={activo ? colores.primario : colores.bordeControl}
                />
                <Text style={estilos.opcionTexto}>{o.texto}</Text>
              </Pressable>
            );
          })}
        </View>
        {!jefe && modo === "jefe" ? (
          <View style={estilos.aviso}>
            <Icono nombre="alert-outline" size={18} color={colores.avisoTexto} />
            <Text style={estilos.avisoTexto}>{TEXTO_SIN_JEFE}</Text>
          </View>
        ) : null}
        {modo === "persona" ? (
          <BuscadorDePersona
            persona={persona}
            onElegir={setPersona}
            error={error}
            deshabilitado={bloqueado}
            refFoco={enBuscador ? refFoco : undefined}
          />
        ) : error ? (
          <ErrorDelCampo texto={error} />
        ) : null}
      </>
    );
  }

  return (
    <View style={estilos.bloque} testID="reemplazo-en-ausencia">
      <Text style={estilos.titulo} accessibilityRole="header" ref={datos ? undefined : refFoco}>
        Mientras usted no está
      </Text>
      {contenido}
    </View>
  );
}

function ErrorDelCampo({ texto }) {
  return (
    <View style={estilos.filaError}>
      <Icono nombre="alert-circle-outline" size={16} color={colores.malTexto} />
      <Text style={estilos.error}>{texto}</Text>
    </View>
  );
}

/** «Persona que aprobará por usted» (obligatoria con «Otra persona»): la
 * elegida, o un buscador por nombre con una pausa al escribir. */
function BuscadorDePersona({ persona, onElegir, error, deshabilitado, refFoco }) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState(null);
  const [vez, setVez] = useState(0);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const consulta = texto.trim();
  const corta = consulta.length < MINIMO_BUSQUEDA;

  useEffect(() => {
    if (persona) return undefined;
    setErrorBusqueda(null);
    if (consulta.length < MINIMO_BUSQUEDA) {
      // Sin buscar: nada que mostrar todavía.
      setResultados(null);
      setBuscando(false);
      return undefined;
    }
    let vigente = true;
    setBuscando(true);
    const pausa = setTimeout(
      () => {
        directorioService
          .buscar(consulta)
          .then((lista) => {
            if (!vigente || !montado.current) return;
            const encontradas = Array.isArray(lista) ? lista : [];
            setResultados(encontradas);
            // Cuántas hay se dice: la lista cambia sin mover el foco.
            anunciar(textoDeResultados(encontradas.length, consulta));
          })
          .catch((e) => {
            if (vigente && montado.current) {
              setResultados([]);
              setErrorBusqueda(mensajeDeError(e, "No se pudo buscar a las personas."));
            }
          })
          .finally(() => {
            if (vigente && montado.current) setBuscando(false);
          });
      },
      ESPERA_BUSCAR_MS,
    );
    return () => {
      vigente = false;
      clearTimeout(pausa);
    };
  }, [consulta, vez, persona]);

  if (persona) {
    return (
      <View style={estilos.elegida}>
        <Text style={estilos.etiqueta}>Persona que aprobará por usted</Text>
        <View style={estilos.filaElegida}>
          <Icono nombre="account-check-outline" size={22} color={colores.primario} />
          <Text style={estilos.nombreElegido}>{persona.nombre}</Text>
          <Boton
            testID="reemplazo-cambiar"
            titulo="Cambiar"
            variante="secundario"
            deshabilitado={deshabilitado}
            etiqueta={`Cambiar la persona que aprobará por usted: ${persona.nombre}`}
            onPress={() => onElegir(null)}
          />
        </View>
        {error ? <ErrorDelCampo texto={error} /> : null}
      </View>
    );
  }

  const etiqueta = [
    "Persona que aprobará por usted (obligatorio). Buscar por nombre",
    error ? `Error: ${error}` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <View style={estilos.elegida}>
      <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
        Persona que aprobará por usted<Text style={estilos.obligatorio}> *</Text>
      </Text>
      <TextInput
        ref={refFoco}
        testID="reemplazo-buscar"
        value={texto}
        onChangeText={setTexto}
        editable={!deshabilitado}
        placeholder="Buscar por nombre"
        placeholderTextColor={colores.tintaTenue}
        accessibilityLabel={etiqueta}
        autoCorrect={false}
        style={[estilos.entrada, error && estilos.entradaConError]}
      />
      {error ? <ErrorDelCampo texto={error} /> : null}
      {buscando ? (
        <View style={estilos.buscando} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colores.primario} />
          <Text style={estilos.tenue}>Buscando…</Text>
        </View>
      ) : null}
      {errorBusqueda ? (
        <ErrorConReintento texto={errorBusqueda} onReintentar={() => setVez((v) => v + 1)} />
      ) : corta ? (
        <Text style={estilos.tenue} testID="reemplazo-minimo">
          {TEXTO_MINIMO_BUSQUEDA}
        </Text>
      ) : resultados === null ? null : resultados.length === 0 ? (
        <Text style={estilos.tenue} accessibilityLiveRegion="polite">
          Nadie coincide con «{consulta}».
        </Text>
      ) : (
        <View accessibilityLabel="Personas encontradas">
          {resultados.slice(0, MAXIMO_RESULTADOS).map((p) => (
            <Pressable
              key={p.id}
              testID={`reemplazo-persona-${p.id}`}
              onPress={() => {
                onElegir({ id: p.id, nombre: p.nombre });
                anunciar(`Eligió a ${p.nombre} para aprobar por usted.`);
              }}
              disabled={deshabilitado}
              accessibilityRole="button"
              accessibilityState={{ disabled: deshabilitado }}
              accessibilityHint="Elige a esta persona para aprobar por usted"
              accessibilityLabel={[p.nombre, p.cargo, p.area].filter(Boolean).join(". ")}
              style={({ pressed }) => [estilos.persona, pressed && estilos.presionada]}
            >
              <Text style={estilos.opcionTexto}>{p.nombre}</Text>
              {p.cargo || p.area ? (
                <Text style={estilos.tenue}>{[p.cargo, p.area].filter(Boolean).join(" · ")}</Text>
              ) : null}
            </Pressable>
          ))}
          {resultados.length > MAXIMO_RESULTADOS ? (
            <Text style={estilos.tenue} testID="reemplazo-hay-mas">
              {TEXTO_HAY_MAS}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const estilos = crearEstilos({
  bloque: {
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
  },
  titulo: { fontSize: 17, fontWeight: "700", color: colores.tinta },
  pregunta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  obligatorio: { color: colores.malTexto },
  opcion: { ...CONTROLES.opcion, marginTop: 6 },
  opcionActiva: CONTROLES.opcionActiva,
  opcionTexto: CONTROLES.opcionTexto,
  aviso: {
    flexDirection: "row",
    gap: 6,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colores.avisoFondo,
  },
  avisoTexto: { flex: 1, fontSize: 14, color: colores.avisoTexto },
  elegida: { gap: 6, marginTop: 4 },
  filaElegida: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  nombreElegido: { flex: 1, minWidth: 120, fontSize: 16, fontWeight: "600", color: colores.tinta },
  entrada: CONTROLES.entrada,
  entradaConError: CONTROLES.entradaConError,
  persona: {
    minHeight: AREA_TACTIL,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colores.borde,
  },
  presionada: { backgroundColor: colores.realce },
  buscando: { flexDirection: "row", alignItems: "center", gap: 8 },
  filaError: { flexDirection: "row", alignItems: "center", gap: 6 },
  error: { flex: 1, fontSize: 14, color: colores.malTexto },
});
