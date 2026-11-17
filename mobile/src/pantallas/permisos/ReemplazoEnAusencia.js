import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { mensajeDeError } from "../../api/errores";
import { reemplazoService } from "../../api/servicios";
import { Boton, ErrorConReintento } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { ESPERA_BUSCAR_MS, MAXIMO_RESULTADOS, TEXTO_HAY_MAS, textoDeResultados } from "../../utils/busqueda";

/**
 * El bloque «Mientras usted no está» de la nueva solicitud, con los textos de
 * `ReemplazoEnAusencia.jsx` de la web: su jefe inmediato u otra persona.
 * Desde el 17/11/2026 (commit 0af6682) esa otra persona solo puede ser de su
 * misma área o su jefe directo: se elige entre los candidatos del servidor
 * (`/organizacion/mi-reemplazo/candidatos/`), no en el directorio del chat.
 * Lo que se eligió antes de la regla no se descarta solo; si se intenta
 * guardar a alguien fuera de ella, el 400 en `persona_id` va junto al campo.
 * `reemplazo` es lo que devuelve `useReemplazoEnAusencia`.
 */
// Una sola pausa para todos los buscadores (US-014, QA-TECH).
export { ESPERA_BUSCAR_MS };

export const TEXTO_AYUDA_REEMPLAZO =
  "Si a usted le toca aprobar solicitudes, mientras esté ausente pasan a esta persona. Solo puede elegir a alguien de su misma área o a su jefe directo. Esta elección se guarda para todas sus ausencias.";
/** Sin candidatos y sin nada escrito: el texto de la web
 * (`ReemplazoEnAusencia.jsx`, `textoNadie`). */
export const TEXTO_NADIE_DEL_AREA =
  "No hay nadie de su área con ese nombre. Solo se puede elegir a alguien de la misma área o al jefe directo.";
/** Sin candidatos con un nombre escrito: igual que la web (`SelectorDePersonas`). */
export const TEXTO_NADIE_COINCIDE = "Nadie coincide con la búsqueda.";
const textoSinCandidatos = (consulta) => ((consulta ?? "").trim() ? TEXTO_NADIE_COINCIDE : TEXTO_NADIE_DEL_AREA);
/** La etiqueta del candidato que es su jefe directo, como en la web. */
export const ETIQUETA_JEFE_DIRECTO = "Jefe directo";
export const TEXTO_SIN_JEFE =
  "Usted no tiene un jefe inmediato registrado: sus aprobaciones se quedarán con usted. Si alguien debe aprobar por usted, elija «Otra persona».";

/**
 * `refFoco`: a dónde va el foco del lector con un error en este bloque
 * (R-03): el buscador si se está eligiendo a otra persona; si no, la
 * pregunta «¿Quién aprueba por usted?»; mientras carga, el título.
 */
export function ReemplazoEnAusencia({ reemplazo, deshabilitado = false, refFoco }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
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
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  return (
    <View style={estilos.filaError}>
      <Icono nombre="alert-circle-outline" size={16} color={colores.malTexto} />
      <Text style={estilos.error}>{texto}</Text>
    </View>
  );
}

/** «Persona que aprobará por usted» (obligatoria con «Otra persona»): la
 * elegida, o la lista de candidatos (jefe directo primero, luego su área),
 * que se pide al abrirse y se filtra por nombre con una pausa al escribir.
 * Son pocos (hasta 20), así que no hace falta un mínimo de letras. */
function BuscadorDePersona({ persona, onElegir, error, deshabilitado, refFoco }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
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

  useEffect(() => {
    if (persona) return undefined;
    setErrorBusqueda(null);
    let vigente = true;
    setBuscando(true);
    const pausa = setTimeout(
      () => {
        reemplazoService
          .candidatos(consulta)
          .then((lista) => {
            if (!vigente || !montado.current) return;
            const encontradas = Array.isArray(lista) ? lista : [];
            setResultados(encontradas);
            // Cuántas hay se dice: la lista cambia sin mover el foco.
            anunciar(encontradas.length ? textoDeResultados(encontradas.length) : textoSinCandidatos(consulta));
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
      // Al abrirse, sin pausa; al escribir, con ella.
      consulta ? ESPERA_BUSCAR_MS : 0,
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
      ) : resultados === null ? null : resultados.length === 0 ? (
        <Text style={estilos.tenue} accessibilityLiveRegion="polite" testID="reemplazo-nadie">
          {textoSinCandidatos(consulta)}
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
              accessibilityLabel={[p.nombre, p.es_jefe ? ETIQUETA_JEFE_DIRECTO : null].filter(Boolean).join(". ")}
              style={({ pressed }) => [estilos.persona, pressed && estilos.presionada]}
            >
              <Text style={estilos.opcionTexto}>{p.nombre}</Text>
              {p.es_jefe ? (
                <View style={estilos.etiquetaJefe} testID={`reemplazo-jefe-${p.id}`}>
                  <Text style={estilos.etiquetaJefeTexto}>{ETIQUETA_JEFE_DIRECTO}</Text>
                </View>
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

const fabricaDeEstilos = (colores, CONTROLES) => crearEstilos({
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
  etiquetaJefe: {
    alignSelf: "flex-start",
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colores.realce,
  },
  etiquetaJefeTexto: { fontSize: 13, fontWeight: "600", color: colores.tinta },
  buscando: { flexDirection: "row", alignItems: "center", gap: 8 },
  filaError: { flexDirection: "row", alignItems: "center", gap: 6 },
  error: { flex: 1, fontSize: 14, color: colores.malTexto },
});
