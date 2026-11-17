import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { mensajeDeError } from "../../api/errores";
import { directorioService } from "../../api/servicios";
import { BotonIcono, ErrorConReintento } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { ErrorDeCampo } from "../../componentes/Selectores";
import { useColores, useEstilos } from "../../tema/apariencia";


import { crearEstilos } from "../../tema/tipografia";
import { ESPERA_BUSCAR_MS, MAXIMO_RESULTADOS, TEXTO_HAY_MAS, textoDeResultados } from "../../utils/busqueda";

/**
 * Buscar personas en el directorio del chat para un grupo (US-024): al crear
 * uno personalizado y al agregar gente en «Participantes». El mismo patrón
 * que «Nuevo mensaje» (`NuevoMensaje.js`): una pausa al escribir, el número
 * de resultados anunciado, «Reintentar» si falla y como mucho 8 a la vista.
 * Quien ya está (`excluir`) no se ofrece. `empresa`: la de la conversación
 * (CA-6), que va como `X-Empresa`. `children` (lo elegido) va bajo el campo.
 */
export function BuscadorDePersonas({
  etiqueta,
  ayuda,
  onElegir,
  excluir = [],
  empresa = null,
  error,
  obligatorio = false,
  deshabilitado = false,
  refFoco,
  testID = "buscar-personas",
  children,
}) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState(null);
  const [vez, setVez] = useState(0);
  const montado = useRef(true);
  const fuera = new Set(excluir.map(String));
  const disponibles = (resultados ?? []).filter((p) => !fuera.has(String(p.id)));
  const personas = disponibles.slice(0, MAXIMO_RESULTADOS);
  const hayMas = disponibles.length > MAXIMO_RESULTADOS;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    let vigente = true;
    setErrorBusqueda(null);
    setBuscando(true);
    const pausa = setTimeout(
      () => {
        directorioService
          .buscar(texto, empresa ? { empresa } : {})
          .then((lista) => {
            if (!vigente || !montado.current) return;
            const encontradas = Array.isArray(lista) ? lista : [];
            setResultados(encontradas);
            if (texto.trim()) anunciar(textoDeResultados(encontradas.length, texto.trim()));
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
      texto ? ESPERA_BUSCAR_MS : 0,
    );
    return () => {
      vigente = false;
      clearTimeout(pausa);
    };
  }, [texto, vez, empresa]);

  const nombre = [`${etiqueta}${obligatorio ? " (obligatorio)" : ""}`, ayuda, "Buscar por nombre o correo", error ? `Error: ${error}` : null]
    .filter(Boolean)
    .join(". ");

  return (
    <View style={estilos.campo}>
      <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
        {etiqueta}
        {obligatorio ? <Text style={estilos.obligatorio}> *</Text> : null}
      </Text>
      {ayuda ? (
        <Text style={estilos.tenue} importantForAccessibility="no" accessibilityElementsHidden>
          {ayuda}
        </Text>
      ) : null}
      <View style={estilos.filaEntrada}>
        <TextInput
          ref={refFoco}
          testID={testID}
          value={texto}
          onChangeText={setTexto}
          editable={!deshabilitado}
          placeholder="Buscar por nombre o correo"
          placeholderTextColor={colores.tintaTenue}
          accessibilityLabel={nombre}
          autoCorrect={false}
          autoCapitalize="none"
          // Enter aquí busca (ya lo hace solo): no debe enviar el formulario.
          returnKeyType="search"
          style={[estilos.entrada, error && estilos.entradaConError]}
        />
        {/* UX H-10: borrar la búsqueda de un toque. */}
        {texto ? (
          <BotonIcono
            testID={`${testID}-borrar`}
            icono="close-circle-outline"
            color={colores.tintaSuave}
            etiqueta="Borrar la búsqueda"
            deshabilitado={deshabilitado}
            onPress={() => setTexto("")}
          />
        ) : null}
      </View>
      <ErrorDeCampo error={error} />
      {/* Lo elegido va justo bajo el campo: no queda debajo de los 8
          resultados, fuera de la vista. */}
      {children}
      {buscando && resultados !== null ? (
        <View style={estilos.linea} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colores.primario} />
          <Text style={estilos.tenue}>Buscando…</Text>
        </View>
      ) : null}
      {errorBusqueda ? <ErrorConReintento texto={errorBusqueda} onReintentar={() => setVez((v) => v + 1)} /> : null}
      {resultados === null && !errorBusqueda ? (
        <ActivityIndicator color={colores.primario} accessibilityLabel="Buscando personas…" />
      ) : null}
      {resultados !== null && !errorBusqueda && !buscando && personas.length === 0 ? (
        <Text style={estilos.tenue} accessibilityLiveRegion="polite">
          {texto.trim() ? `Nadie más coincide con «${texto.trim()}».` : "No hay más personas para elegir."}
        </Text>
      ) : null}
      {errorBusqueda
        ? null
        : personas.map((p) => (
            <Pressable
              key={p.id}
              testID={`${testID}-persona-${p.id}`}
              onPress={() => onElegir(p)}
              disabled={deshabilitado}
              accessibilityRole="button"
              accessibilityState={{ disabled: deshabilitado }}
              accessibilityLabel={[`Agregar a ${p.nombre}`, p.cargo, p.area].filter(Boolean).join(". ")}
              style={({ pressed }) => [estilos.opcion, pressed && estilos.presionada]}
            >
              <Icono nombre="account-plus-outline" size={22} color={colores.primario} />
              <View style={estilos.textos}>
                <Text style={estilos.nombre}>{p.nombre}</Text>
                {p.cargo || p.area ? <Text style={estilos.tenue}>{[p.cargo, p.area].filter(Boolean).join(" · ")}</Text> : null}
              </View>
            </Pressable>
          ))}
      {hayMas && !errorBusqueda ? (
        <Text style={estilos.tenue} testID={`${testID}-hay-mas`}>
          {TEXTO_HAY_MAS}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Las personas elegidas como fichas que se envuelven (UX H-02), cada una con
 * «Quitar a …» (un ícono con su etiqueta, 48 dp). `onQuitar` no pregunta:
 * aún no se envió nada. El total no es una región viva: cada elección ya se
 * anuncia una vez (UX H-15).
 */
export function PersonasElegidas({ personas, onQuitar, deshabilitado = false, testID = "elegidas" }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  if (!personas.length) return null;
  return (
    <View style={estilos.elegidas} testID={testID}>
      <Text style={estilos.tenue}>{personas.length === 1 ? "1 persona elegida" : `${personas.length} personas elegidas`}</Text>
      <View style={estilos.fichas}>
        {personas.map((p) => (
          <View key={p.id} style={estilos.ficha} testID={`${testID}-${p.id}`}>
            <Text style={estilos.fichaTexto}>{p.nombre}</Text>
            <BotonIcono
              testID={`quitar-elegida-${p.id}`}
              icono="close"
              color={colores.tinta}
              tamano={20}
              etiqueta={`Quitar a ${p.nombre}`}
              deshabilitado={deshabilitado}
              onPress={() => onQuitar(p)}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const fabricaDeEstilos = (colores, CONTROLES) => crearEstilos({
  campo: { gap: 6 },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  obligatorio: { color: colores.malTexto },
  filaEntrada: { flexDirection: "row", alignItems: "center", gap: 4 },
  entrada: { ...CONTROLES.entrada, flex: 1 },
  entradaConError: CONTROLES.entradaConError,
  linea: { flexDirection: "row", alignItems: "center", gap: 8 },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  opcion: CONTROLES.opcion,
  presionada: { backgroundColor: colores.realce },
  textos: { flex: 1, gap: 2 },
  nombre: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  elegidas: { gap: 6 },
  fichas: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  ficha: {
    ...CONTROLES.pildora,
    // A la derecha, el área de 48 de «Quitar».
    paddingLeft: 14,
    paddingRight: 0,
    maxWidth: "100%",
    backgroundColor: colores.realce,
  },
  fichaTexto: { ...CONTROLES.pildoraTexto },
});
