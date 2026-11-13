import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { erroresPorCampo } from "../../api/errores";
import { soporteService } from "../../api/servicios";
import { Alerta, Boton, Cargando, ErrorConReintento } from "../../componentes/comunes";
import { Casilla, OpcionesEnLinea, SelectorDeLista } from "../../componentes/Selectores";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { volverAlModulo } from "../../navegacion/abrir";
import { useAdjuntosPorEnviar, validarLista } from "../../soporte/adjuntos";
import {
  adicionalesParaEnviar,
  camposVisibles,
  mensajeDeSoporte,
  TONOS,
  unirConY,
  validarCampos,
} from "../../soporte/formato";
import { useRecargarResumenSoporte } from "../../soporte/ResumenSoporteContext";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";
import {
  ESPERA_BUSCAR_MS,
  MAXIMO_RESULTADOS,
  MINIMO_BUSQUEDA,
  TEXTO_HAY_MAS,
  TEXTO_MINIMO_BUSQUEDA,
  textoDeResultados,
} from "../../utils/busqueda";
import { CampoTexto } from "../permisos/piezas";
import { FormularioDelTicket } from "./FormularioDelTicket";
import { AdjuntosPorEnviar, Dato, Pildora } from "./piezas";

/**
 * «Registrar ticket» a nombre de otra persona (US-014, CA-16), como
 * `RegistrarTicket.jsx` de la web: lo que llega por teléfono, WhatsApp o en
 * persona también entra a la mesa. Solo personas con cuenta: se busca
 * (`GET tickets/personas/?q=`, desde 2 letras, con una pausa de 300 ms y
 * hasta 8 a la vista), sus datos salen de «Mi perfil» y lo que le falte
 * (teléfono, área, agencia) se completa aquí, solo para este ticket. Luego el
 * canal (teléfono por defecto), el mismo formulario del alta propia con la
 * sugerencia de caso, los adjuntos y «Asignármelo» si es técnico.
 */
export { ESPERA_BUSCAR_MS };
/** G-11: el nombre no se completa aquí: es de su perfil. */
export const TEXTO_SIN_NOMBRE =
  "A esta persona le falta su nombre y apellido en «Mi perfil». Debe corregirse en la web (lo hace ella o quien administra los usuarios) antes de registrarle un ticket.";
export const TEXTO_FALTAN_DATOS =
  "A esta persona le faltan datos: complételos para este ticket. Pídale que actualice «Mi perfil».";

const VACIO = { categoria: "", caso: "", descripcion: "", impacto: "", urgencia: "" };

/** Qué le falta a la persona para este ticket: área y agencia bloquean el
 * alta en el servidor; el teléfono, no (se pide si no tiene ninguno). */
export function faltanDeLaPersona(persona) {
  if (!persona) return { nombre: false, telefono: false, area: false, agencia: false };
  return {
    nombre: !String(persona.nombre ?? "").trim(),
    telefono: !persona.telefono && !persona.telefono_corporativo,
    area: !persona.area,
    agencia: !persona.agencia,
  };
}

const FilaPersona = memo(function FilaPersona({ persona: p, onElegir }) {
  const incompleta = Object.values(faltanDeLaPersona(p)).some(Boolean);
  const detalle = [p.area?.nombre, p.agencia?.nombre, p.correo].filter(Boolean).join(" · ");
  return (
    <Pressable
      testID={`persona-${p.id}`}
      onPress={() => onElegir(p)}
      accessibilityRole="button"
      accessibilityLabel={[p.nombre || p.correo, detalle, incompleta ? "Datos incompletos" : null].filter(Boolean).join(". ")}
      accessibilityHint="Registra el ticket a nombre de esta persona"
      style={({ pressed }) => [estilos.persona, pressed && estilos.presionada]}
    >
      <Text style={estilos.nombre}>{p.nombre || p.correo}</Text>
      {detalle ? <Text style={estilos.tenue}>{detalle}</Text> : null}
      {incompleta ? <Pildora texto="Datos incompletos" tono={{ ...TONOS.aviso, icono: "alert-outline" }} /> : null}
    </Pressable>
  );
});

export function RegistrarTicket() {
  const router = useRouter();
  const navegacion = useNavigation();
  const alturaCabecera = useAlturaCabecera();
  const { recargar: recargarResumen } = useRecargarResumenSoporte();
  const [carga, setCarga] = useState({ estado: "cargando", datos: null, error: null });
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState({ estado: "inactiva", lista: [], error: null });
  const [vez, setVez] = useState(0);
  const [persona, setPersona] = useState(null);
  const [completar, setCompletar] = useState({ telefono: "", area: "", sede: "" });
  const [canal, setCanal] = useState("telefono");
  const [asignarme, setAsignarme] = useState(false);
  const [valores, setValores] = useState(VACIO);
  const [adicionales, setAdicionales] = useState({});
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [creado, setCreado] = useState(null);
  const adjuntos = useAdjuntosPorEnviar();
  const enCurso = useRef(false);
  const montado = useRef(true);
  const desplazable = useRef(null);
  const claveError = useRef(0);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const [salida, setSalida] = useState(false);
  const navegacionPendiente = useRef(null);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const mostrarError = useCallback((texto) => {
    claveError.current += 1;
    setError(texto ? { texto, clave: claveError.current } : null);
  }, []);

  const cargar = useCallback(async () => {
    setCarga({ estado: "cargando", datos: null, error: null });
    try {
      const datos = await soporteService.formularioInterno();
      if (!montado.current) return;
      setCarga({ estado: "listo", datos, error: null });
    } catch (e) {
      if (!montado.current) return;
      setCarga({ estado: "error", datos: null, error: mensajeDeSoporte(e, "No se pudo cargar el formulario.") });
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // La búsqueda: desde 2 letras y tras una pausa; solo cuenta la respuesta
  // de lo último escrito.
  const consulta = busqueda.trim();
  useEffect(() => {
    if (persona) return undefined;
    if (consulta.length < MINIMO_BUSQUEDA) {
      setResultados({ estado: "inactiva", lista: [], error: null });
      return undefined;
    }
    let vigente = true;
    setResultados((r) => ({ ...r, estado: "buscando", error: null }));
    const pausa = setTimeout(() => {
      Promise.resolve(soporteService.personas(consulta))
        .then((lista) => {
          if (!vigente || !montado.current) return;
          const encontradas = Array.isArray(lista) ? lista : [];
          setResultados({ estado: "listo", lista: encontradas, error: null });
          anunciar(textoDeResultados(encontradas.length, consulta));
        })
        .catch((e) => {
          if (vigente && montado.current) {
            setResultados({ estado: "error", lista: [], error: mensajeDeSoporte(e, "No se pudo buscar a las personas.") });
          }
        });
    }, ESPERA_BUSCAR_MS);
    return () => {
      vigente = false;
      clearTimeout(pausa);
    };
  }, [consulta, persona, vez]);

  const tocado =
    Boolean(persona) &&
    (Object.values(valores).some((v) => String(v ?? "").trim() !== "") ||
      Object.keys(adicionales).length > 0 ||
      adjuntos.lista.length > 0);

  usePreventRemove(tocado && !creado && !enviando && !salida, ({ data }) => {
    Alert.alert("¿Descartar el ticket?", "Se perderá lo que escribió y los archivos elegidos.", [
      { text: "Seguir escribiendo", style: "cancel" },
      {
        text: "Descartar",
        style: "destructive",
        onPress: () => {
          navegacionPendiente.current = () => navegacion.dispatch(data.action);
          setSalida(true);
        },
      },
    ]);
  });

  useEffect(() => {
    if (!salida || !navegacionPendiente.current) return;
    const navegar = navegacionPendiente.current;
    navegacionPendiente.current = null;
    navegar();
  }, [salida]);

  const elegirPersona = useCallback((p) => {
    setPersona(p);
    setCompletar({ telefono: "", area: "", sede: "" });
    anunciar(`Registra a nombre de ${p.nombre || p.correo}.`);
  }, []);

  function fijar(campo, valor) {
    setValores((actual) => ({
      ...actual,
      [campo]: valor,
      ...(campo === "categoria" && actual.categoria !== valor ? { caso: "" } : {}),
    }));
    setErrores((a) => (a[campo] ? { ...a, [campo]: undefined } : a));
  }

  function fijarAdicional(clave, valor) {
    setAdicionales((actual) => ({ ...actual, [clave]: valor }));
    setErrores((a) => (a[clave] ? { ...a, [clave]: undefined } : a));
  }

  function irAlPrimero(conError) {
    const orden = [
      "solicitante",
      "telefono",
      "area",
      "sede",
      "canal",
      ...camposVisibles(carga.datos?.campos, valores.categoria, true).map((c) => c.clave),
      "adjuntos",
    ];
    const primero = orden.find((c) => conError.includes(c));
    irA(primero ?? null);
  }

  async function enviar() {
    if (enCurso.current) return;
    const datos = carga.datos;
    const faltan = faltanDeLaPersona(persona);
    if (faltan.nombre) {
      mostrarError(TEXTO_SIN_NOMBRE);
      irA(null);
      return;
    }
    const propios = validarCampos(datos.campos, valores, adicionales);
    if (faltan.area && !completar.area) propios.area = "Elija el área de la persona.";
    if (faltan.agencia && !completar.sede) propios.sede = "Elija la agencia de la persona.";
    const errorAdjuntos = validarLista(adjuntos.lista);
    if (errorAdjuntos) propios.adjuntos = errorAdjuntos;
    if (Object.keys(propios).length) {
      setErrores(propios);
      mostrarError("Revise los campos marcados.");
      irAlPrimero(Object.keys(propios));
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    setErrores({});
    mostrarError(null);
    try {
      const { categoria, ...base } = valores;
      const campos = {
        ...base,
        solicitante: persona.id,
        canal,
        asignarme: asignarme ? "true" : "false",
        adicionales: adicionalesParaEnviar(datos.campos, valores, adicionales),
      };
      if (faltan.telefono && completar.telefono.trim()) campos.telefono = completar.telefono.trim();
      if (faltan.area) campos.area = completar.area;
      if (faltan.agencia) campos.sede = completar.sede;
      const ticket = await soporteService.registrar(campos, adjuntos.lista);
      if (!montado.current) return;
      adjuntos.vaciar();
      recargarResumen();
      if (ticket?.visible === false) {
        setCreado(ticket);
        anunciar(`Ticket ${ticket.numero} registrado; quedó en la cola.`);
        return;
      }
      anunciar(`Ticket ${ticket?.numero ?? ""} registrado.`);
      // Sin la pregunta de descartar: ya se envió.
      navegacionPendiente.current = () =>
        router.replace({ pathname: "/soporte/ticket/[id]", params: { id: String(ticket.id) } });
      setSalida(true);
    } catch (e) {
      if (!montado.current) return;
      const datosError = e?.response?.data?.error;
      const porCampo = erroresPorCampo(e);
      if (datosError?.code === "faltan_datos") {
        // Lo que le falta a la persona: se marca en sus campos.
        const lista = (Array.isArray(datosError.details?.faltan) ? datosError.details.faltan : []).map((f) =>
          String(f).toLowerCase(),
        );
        const marcados = {};
        if (lista.includes("área")) marcados.area = "Elija el área de la persona.";
        if (lista.includes("agencia")) marcados.sede = "Elija la agencia de la persona.";
        setErrores(marcados);
        setPersona((p) => ({
          ...p,
          nombre: lista.includes("nombre y apellido") ? "" : p.nombre,
          area: lista.includes("área") ? null : p.area,
          agencia: lista.includes("agencia") ? null : p.agencia,
        }));
        const completables = lista.filter((f) => f !== "nombre y apellido");
        mostrarError(
          [
            lista.includes("nombre y apellido") ? TEXTO_SIN_NOMBRE : null,
            completables.length ? `A esta persona le falta ${unirConY(completables)}: complételo para este ticket.` : null,
          ]
            .filter(Boolean)
            .join(" "),
        );
        irAlPrimero(Object.keys(marcados));
        return;
      }
      const visibles = new Set([
        "solicitante",
        "telefono",
        "area",
        "sede",
        "canal",
        ...camposVisibles(datos.campos, valores.categoria, true).map((c) => c.clave),
      ]);
      const deCampos = Object.keys(porCampo).filter((c) => visibles.has(c));
      const otros = Object.entries(porCampo)
        .filter(([c]) => !visibles.has(c))
        .map(([, t]) => t);
      setErrores(porCampo);
      const base =
        deCampos.length && !otros.length
          ? "Revise los campos marcados."
          : mensajeDeSoporte(e, "No se pudo registrar el ticket.", { envio: true });
      mostrarError([base, ...otros.filter((t) => !base.includes(t))].join(" "));
      if (deCampos.length && !otros.length) irAlPrimero(deCampos);
      else irA(null);
    } finally {
      enCurso.current = false;
      if (montado.current) setEnviando(false);
    }
  }

  function registrarOtro() {
    setCreado(null);
    setPersona(null);
    setBusqueda("");
    setValores(VACIO);
    setAdicionales({});
    setErrores({});
    mostrarError(null);
  }

  if (carga.estado === "cargando") return <Cargando texto="Cargando el formulario…" />;
  if (carga.estado === "error") {
    return (
      <View style={estilos.contenido}>
        <ErrorConReintento texto={carga.error} onReintentar={cargar} />
      </View>
    );
  }
  const datos = carga.datos;

  if (creado) {
    return (
      <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} testID="registrado">
        <Alerta
          tipo="bien"
          texto={`Ticket ${creado.numero} registrado; quedó en la cola. Quien lo pidió recibe el número por correo.`}
        />
        <Boton testID="registrar-otro" titulo="Registrar otro" icono="plus" onPress={registrarOtro} />
        <Boton
          titulo="Volver a la bandeja"
          icono="arrow-left"
          variante="secundario"
          onPress={() => volverAlModulo(router, { pathname: "/soporte", params: { vista: "bandeja" } })}
        />
      </ScrollView>
    );
  }

  if (!persona) {
    const visibles = resultados.lista.slice(0, MAXIMO_RESULTADOS);
    const hayMas = resultados.lista.length > MAXIMO_RESULTADOS;
    return (
      <ScrollView
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        keyboardShouldPersistTaps="handled"
        testID="buscar-persona"
      >
        <Text style={estilos.titulo} accessibilityRole="header">
          ¿Quién pide?
        </Text>
        <Text style={estilos.tenue}>
          Para lo que llega por teléfono, WhatsApp o en persona. Quien pidió recibe por correo su número y el enlace
          para seguirlo.
        </Text>
        <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
          Busque a la persona por su nombre o correo
        </Text>
        <TextInput
          testID="buscar-persona-campo"
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Ej.: Carla o carla@grupolaar.com"
          placeholderTextColor={colores.tintaTenue}
          accessibilityLabel={`Busque a la persona por su nombre o correo. ${TEXTO_MINIMO_BUSQUEDA}`}
          autoCorrect={false}
          autoFocus
          style={estilos.entrada}
        />
        {consulta.length < MINIMO_BUSQUEDA ? (
          <Text style={estilos.tenue} testID="minimo-busqueda">
            {TEXTO_MINIMO_BUSQUEDA}
          </Text>
        ) : null}
        {resultados.estado === "buscando" ? (
          <View style={estilos.fila} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colores.primario} />
            <Text style={estilos.tenue}>Buscando…</Text>
          </View>
        ) : null}
        {resultados.estado === "error" ? (
          <ErrorConReintento texto={resultados.error} onReintentar={() => setVez((v) => v + 1)} />
        ) : null}
        {resultados.estado === "listo" && resultados.lista.length === 0 ? (
          <Text style={estilos.tenue}>{`Nadie coincide con «${consulta}».`}</Text>
        ) : null}
        {resultados.estado === "listo"
          ? visibles.map((p) => <FilaPersona key={p.id} persona={p} onElegir={elegirPersona} />)
          : null}
        {resultados.estado === "listo" && hayMas ? (
          <Text style={estilos.tenue} testID="hay-mas">
            {TEXTO_HAY_MAS}
          </Text>
        ) : null}
        <Text style={estilos.tenue}>
          Solo personas registradas. Si quien llama no tiene cuenta, pida a la administración que la cree.
        </Text>
      </ScrollView>
    );
  }

  const faltan = faltanDeLaPersona(persona);
  const canales = Array.isArray(datos.canales) && datos.canales.length
    ? datos.canales
    : [{ id: "telefono", nombre: "Teléfono" }];

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior="padding"
      enabled={Platform.OS === "android"}
      keyboardVerticalOffset={alturaCabecera}
    >
      <ScrollView
        ref={desplazable}
        testID="registrar-formulario"
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        automaticallyAdjustKeyboardInsets
      >
        {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="error-envio" /> : null}
        <Text style={estilos.leyenda}>Los campos con * son obligatorios.</Text>
        <View style={estilos.personaElegida} {...bloque("solicitante")} testID="persona-elegida">
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Pide
          </Text>
          {faltan.nombre ? <Alerta tipo="aviso" texto={TEXTO_SIN_NOMBRE} testID="sin-nombre" /> : null}
          <Dato nombre="Nombre" valor={persona.nombre || persona.correo} />
          <Dato nombre="Correo" valor={persona.correo} />
          <Dato nombre="Teléfono" valor={persona.telefono_corporativo || persona.telefono} />
          <Dato nombre="Área" valor={persona.area?.nombre} />
          <Dato nombre="Agencia" valor={persona.agencia?.nombre} />
          <Boton
            testID="cambiar-persona"
            titulo="Cambiar de persona"
            icono="account-switch-outline"
            variante="secundario"
            deshabilitado={enviando}
            onPress={() => setPersona(null)}
          />
        </View>
        {faltan.telefono || faltan.area || faltan.agencia ? <Alerta tipo="aviso" texto={TEXTO_FALTAN_DATOS} /> : null}
        {faltan.telefono ? (
          <View {...bloque("telefono")}>
            <CampoTexto
              testID="completar-telefono"
              refFoco={refFoco("telefono")}
              etiqueta="Teléfono"
              opcional
              ayuda="De 7 a 15 dígitos. Solo para este ticket."
              teclado="phone-pad"
              valor={completar.telefono}
              onCambio={(v) => setCompletar((c) => ({ ...c, telefono: v }))}
              error={errores.telefono}
              maximo={20}
            />
          </View>
        ) : null}
        {faltan.area ? (
          <View {...bloque("area")}>
            <SelectorDeLista
              testID="completar-area"
              refFoco={refFoco("area")}
              etiqueta="Área"
              obligatorio
              vacio="Elija el área"
              opciones={(datos.areas ?? []).map((a) => ({ valor: String(a.id), texto: a.nombre }))}
              valor={completar.area}
              onCambio={(v) => {
                setCompletar((c) => ({ ...c, area: v }));
                setErrores((a) => ({ ...a, area: undefined }));
              }}
              error={errores.area}
            />
          </View>
        ) : null}
        {faltan.agencia ? (
          <View {...bloque("sede")}>
            <SelectorDeLista
              testID="completar-agencia"
              refFoco={refFoco("sede")}
              etiqueta="Agencia"
              obligatorio
              vacio="Elija la agencia"
              opciones={(datos.agencias ?? []).map((a) => ({ valor: String(a.id), texto: a.nombre }))}
              valor={completar.sede}
              onCambio={(v) => {
                setCompletar((c) => ({ ...c, sede: v }));
                setErrores((a) => ({ ...a, sede: undefined }));
              }}
              error={errores.sede}
            />
          </View>
        ) : null}
        <View {...bloque("canal")}>
          <OpcionesEnLinea
            testID="canal"
            refFoco={refFoco("canal")}
            etiqueta="¿Por dónde llegó?"
            obligatorio
            opciones={canales.map((c) => ({ valor: c.id, texto: c.nombre }))}
            valor={canal}
            onCambio={setCanal}
            error={errores.canal}
          />
        </View>
        <FormularioDelTicket
          datos={datos}
          valores={valores}
          onBase={fijar}
          adicionales={adicionales}
          onAdicional={fijarAdicional}
          errores={errores}
          tercera
          bloque={bloque}
          refFoco={refFoco}
          deshabilitado={enviando}
        />
        <View {...bloque("adjuntos")}>
          <AdjuntosPorEnviar
            adjuntos={adjuntos}
            deshabilitado={enviando}
            refFoco={refFoco("adjuntos")}
            errorExterno={errores.adjuntos}
          />
        </View>
        {datos.soy_tecnico ? (
          <Casilla
            testID="asignarme"
            etiqueta="Asignármelo (lo atiendo ahora)"
            marcada={asignarme}
            onCambio={setAsignarme}
          />
        ) : null}
        <Boton
          testID="enviar-registro"
          titulo={enviando ? "Registrando…" : "Registrar ticket"}
          icono="send"
          cargando={enviando}
          deshabilitado={faltan.nombre}
          pista={faltan.nombre ? TEXTO_SIN_NOMBRE : undefined}
          onPress={() => {
            enviar();
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 14, paddingBottom: 40 },
  titulo: { fontSize: 22, fontWeight: "700", color: colores.titulo },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.titulo },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  leyenda: { fontSize: 14, color: colores.tintaSuave },
  entrada: CONTROLES.entrada,
  fila: { flexDirection: "row", alignItems: "center", gap: 8 },
  persona: {
    minHeight: AREA_TACTIL,
    gap: 4,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  presionada: { backgroundColor: colores.realce },
  nombre: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  personaElegida: {
    gap: 8,
    padding: 14,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
});
