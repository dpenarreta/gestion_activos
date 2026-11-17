import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { ESPERA_FOCO_ANDROID_MS, ESPERA_FOCO_IOS_MS } from "../../accesibilidad/irAlBloque";
import { mensajeDeError } from "../../api/errores";
import { chatService } from "../../api/servicios";
import { useChat } from "../../chat/ChatContext";
import { extrasDePresencia, NOMBRE_DE_TIPO, textoPresencia } from "../../chat/formato";
import {
  CAMPOS_DE_LA_EDICION,
  errorDelGrupo,
  LARGO_NOMBRE_GRUPO,
  puedeCambiarMiembros,
  puedeRenombrar,
  puedeSalir,
  resultadoDeAgregar,
  TEXTO_EDICION_PUEDE_HABERSE_GUARDADO,
  TEXTO_PUEDE_HABER_SALIDO,
  TEXTO_SIN_NOMBRE,
  TEXTO_SIN_PERSONAS,
  TEXTO_SOLO_QUIEN_ADMINISTRA,
  TEXTO_TRASPASO,
  TEXTO_YA_NO_ESTA,
  TEXTO_YA_SALIO,
  textoDeAgregadas,
  textoDeAgregar,
  textoDeLargo,
  textoDeQuitar,
  textoReviseGrupo,
  traspasaLaAdministracion,
} from "../../chat/grupos";
import { usePresencia } from "../../chat/usePresencia";
import { Alerta, Boton, BotonIcono, Cargando, ErrorConReintento } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { volverAlModulo } from "../../navegacion/abrir";
import { useSesion } from "../../sesion/SesionContext";
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { useCandado, useReenvioConfirmado, useSalirConCambios } from "../activos/formularios";
import { CampoTexto } from "../permisos/piezas";
import { BuscadorDePersonas, PersonasElegidas } from "./BuscadorDePersonas";
import { Presencia } from "./piezas";
import { useRellenoDeLaBurbuja } from "../../navegacion/BurbujaDeSoporte";

/**
 * Los participantes de un grupo o del canal general (US-011, CA-6), con su
 * presencia (CA-8). Desde la US-024 (16/11/2026), en un grupo es
 * «Información del grupo» y el grupo se gestiona aquí, con las reglas de
 * `chat.services`:
 *
 * - quien lo administra lo renombra (personalizado o por área) y, en uno
 *   personalizado, agrega personas (buscador) y quita a otras, con
 *   confirmación (CA-3); a sí mismo no se quita;
 * - de un grupo personalizado se sale, con confirmación, y se vuelve a la
 *   lista de chats sin él (CA-4).
 *
 * Todo va con la empresa de la conversación (CA-6). Salir de la pantalla con
 * un cambio sin guardar pregunta; mientras se guarda, no se sale (CA-5). Un
 * solo editor abierto a la vez (UX H-16).
 */

export const TITULO_SALIR = "¿Salir del grupo?";
export const TEXTO_SALIR = "Dejará de ver sus mensajes. Para volver, quien administre el grupo tendrá que agregarle de nuevo.";
/** Tras salir, se olvida la conversación cuando la pantalla de debajo ya se
 * fue (QA-TECH P3): si no, se queda sin datos durante la transición. */
export const ESPERA_OLVIDAR_MS = 400;

/** Una pregunta con «Cancelar» y la acción en rojo; resuelve `true` si la
 * persona elige la acción. Tocar fuera o Atrás es «Cancelar». */
function preguntar(titulo, mensaje, accion) {
  return new Promise((resolver) => {
    Alert.alert(
      titulo,
      mensaje,
      [
        { text: "Cancelar", style: "cancel", onPress: () => resolver(false) },
        { text: accion, style: "destructive", onPress: () => resolver(true) },
      ],
      { cancelable: true, onDismiss: () => resolver(false) },
    );
  });
}

export function Participantes({ id, empresa = null }) {
  // US-029: lo último no queda bajo la burbuja de soporte.
  const rellenoBurbuja = useRellenoDeLaBurbuja();
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const router = useRouter();
  const navegacion = useNavigation();
  const alturaCabecera = useAlturaCabecera();
  const { usuario } = useSesion();
  const { cargarConversaciones, olvidarConversacion } = useChat();
  const [estado, setEstado] = useState("cargando");
  const [conversacion, setConversacion] = useState(null);
  const [error, setError] = useState(null);
  // La edición (US-024): un solo editor abierto, «nombre» o «agregar».
  const [editor, setEditor] = useState(null);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [porAgregar, setPorAgregar] = useState([]);
  const [errores, setErrores] = useState({});
  // `{tipo, texto, clave, subir}`: `subir` lleva la lista arriba (UX H-04).
  const [aviso, setAviso] = useState(null);
  // Qué se está enviando: «nombre», «agregar», «quitar-ID» o «salir».
  const [ocupado, setOcupado] = useState(null);
  const montado = useRef(true);
  const lista = useRef(null);
  const titulo = useRef(null);
  const campoNombre = useRef(null);
  const campoBuscar = useRef(null);
  const esperaFoco = useRef(null);
  const salidaDudosa = useRef(false);
  const candado = useCandado();
  // La confirmación de reenvío es de cada acción (QA-TECH P3).
  const reenvioNombre = useReenvioConfirmado();
  const reenvioAgregar = useReenvioConfirmado();
  const reenvioQuitar = useReenvioConfirmado();
  const participantes = Array.isArray(conversacion?.participantes) ? conversacion.participantes : [];
  const presencia = usePresencia(participantes.map((p) => p.id));
  const opciones = empresa ? { empresa } : {};
  const conCambios =
    (editor === "nombre" && nombreNuevo.trim() !== (conversacion?.nombre ?? "")) || (editor === "agregar" && porAgregar.length > 0);
  const { salir: irse } = useSalirConCambios(conCambios && !ocupado, { ocupado: Boolean(ocupado) });
  const esGrupo = conversacion?.tipo === "grupo" || conversacion?.tipo === "area";

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      if (esperaFoco.current) clearTimeout(esperaFoco.current);
    };
  }, []);

  // UX H-01: un grupo se abre como «Información del grupo» (aunque se llegue
  // sin `?grupo=1`, por un enlace).
  useEffect(() => {
    if (conversacion?.tipo) navegacion?.setOptions?.({ title: esGrupo ? "Información del grupo" : "Participantes" });
  }, [navegacion, conversacion?.tipo, esGrupo]);

  // UX H-04: arriba solo con un error o el resultado de renombrar o agregar.
  useEffect(() => {
    if (aviso?.subir) lista.current?.scrollToOffset?.({ offset: 0, animated: true });
  }, [aviso]);

  // UX H-03: al abrir un editor, el foco y el teclado van a su campo.
  useEffect(() => {
    if (editor === "nombre") campoNombre.current?.focus?.();
    if (editor === "agregar") campoBuscar.current?.focus?.();
  }, [editor]);

  /** Al cerrar un editor, el foco del lector vuelve al título (UX H-03). */
  function focoAlTitulo() {
    if (esperaFoco.current) clearTimeout(esperaFoco.current);
    esperaFoco.current = setTimeout(
      () => {
        esperaFoco.current = null;
        if (!titulo.current) return;
        try {
          AccessibilityInfo.sendAccessibilityEvent(titulo.current, "focus");
        } catch {
          // Sin lector de pantalla: no pasa nada.
        }
      },
      Platform.OS === "android" ? ESPERA_FOCO_ANDROID_MS : ESPERA_FOCO_IOS_MS,
    );
  }

  const cargar = useCallback(async () => {
    setEstado("cargando");
    setError(null);
    try {
      const datos = await chatService.conversacion(id, empresa ? { empresa } : {});
      if (!montado.current) return;
      setConversacion(datos);
      setEstado("listo");
    } catch (e) {
      if (!montado.current) return;
      setError(mensajeDeError(e, "No se pudieron cargar los participantes."));
      setEstado("error");
    }
  }, [id, empresa]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Sin «Cargando»: tras un 403, un 404 o una respuesta perdida, lo que
   * hay ahora (QA-FUNC O-4). Si falla, se queda lo de antes. */
  async function recargarEnSilencio() {
    try {
      const datos = await chatService.conversacion(id, opciones);
      if (montado.current && datos) setConversacion(datos);
    } catch {
      // Lo de antes sigue a la vista; el aviso ya dice qué pasó.
    }
  }

  function cerrarEditor() {
    setEditor(null);
    setPorAgregar([]);
    setErrores({});
    // UX H-16: al cancelar no queda el error del editor.
    setAviso((a) => (a?.tipo === "mal" ? null : a));
    focoAlTitulo();
  }

  function abrirEditor(cual) {
    // UX H-16: uno a la vez; el otro se cierra sin guardar.
    setPorAgregar([]);
    setErrores({});
    setAviso((a) => (a?.tipo === "mal" ? null : a));
    if (cual === "nombre") setNombreNuevo(conversacion?.nombre ?? "");
    setEditor(cual);
  }

  /** `PATCH` del grupo. Devuelve la conversación nueva o `null`. El candado
   * ya lo tomó quien llama (para que un doble toque no abra dos preguntas)
   * y aquí se suelta. */
  async function editar(que, datos, { reenvio, porDefecto, traducir }) {
    if (!(await reenvio.confirmar())) {
      candado.soltar();
      return null;
    }
    if (!montado.current) return null;
    setErrores({});
    setAviso(null);
    setOcupado(que);
    try {
      const nueva = await chatService.editarGrupo(id, datos, opciones);
      if (!montado.current) return null;
      reenvio.limpiar();
      if (nueva && Array.isArray(nueva.participantes)) setConversacion(nueva);
      // El nombre y los miembros de la conversación y de la lista.
      cargarConversaciones({ silenciosa: true });
      return nueva ?? {};
    } catch (e) {
      if (!montado.current) return null;
      const fallo = errorDelGrupo(e, porDefecto, {
        nombres: CAMPOS_DE_LA_EDICION,
        sinPermiso: TEXTO_SOLO_QUIEN_ADMINISTRA,
        puedeHaberse: TEXTO_EDICION_PUEDE_HABERSE_GUARDADO,
        traducir,
      });
      reenvio.marcar(fallo);
      setErrores(fallo.campos);
      setAviso({ tipo: "mal", texto: fallo.texto, clave: fallo.clave, subir: true });
      // QA-FUNC O-4: quien ya no administra deja de ver los controles; tras
      // una respuesta perdida, se ve lo que de verdad quedó.
      if (fallo.status === 403 || fallo.status === 404) {
        // QA-TECH P3-2: sin permiso, el editor se cierra; si no, al salir
        // preguntaría por cambios de un editor que ya no se ve.
        setEditor(null);
        setPorAgregar([]);
      }
      if (fallo.dudoso || fallo.status === 403 || fallo.status === 404) recargarEnSilencio();
      return null;
    } finally {
      candado.soltar();
      if (montado.current) setOcupado(null);
    }
  }

  async function guardarNombre() {
    if (!candado.tomar()) return;
    const limpio = nombreNuevo.trim();
    if (!limpio) {
      candado.soltar();
      setErrores({ nombre: TEXTO_SIN_NOMBRE });
      setAviso({ tipo: "mal", texto: textoReviseGrupo({ nombre: true }, CAMPOS_DE_LA_EDICION), clave: Date.now(), subir: true });
      return;
    }
    if (limpio === conversacion?.nombre) {
      candado.soltar();
      cerrarEditor();
      return;
    }
    const nueva = await editar("nombre", { nombre: limpio }, {
      reenvio: reenvioNombre,
      porDefecto: "No se pudo cambiar el nombre del grupo.",
    });
    if (nueva && montado.current) {
      setAviso({ tipo: "bien", texto: `El grupo ahora se llama «${limpio}».`, clave: Date.now(), subir: true });
      setEditor(null);
      focoAlTitulo();
    }
  }

  function elegir(persona) {
    setPorAgregar((actual) => (actual.some((p) => p.id === persona.id) ? actual : [...actual, persona]));
    if (errores.agregar) setErrores((e) => ({ ...e, agregar: undefined }));
    anunciar(`Se eligió a ${persona.nombre} para agregar.`);
  }

  function dejarDeElegir(persona) {
    setPorAgregar((actual) => actual.filter((p) => p.id !== persona.id));
    anunciar(`${persona.nombre} ya no se agregará.`);
  }

  async function agregar() {
    if (!candado.tomar()) return;
    if (porAgregar.length === 0) {
      candado.soltar();
      setErrores({ agregar: TEXTO_SIN_PERSONAS });
      setAviso({ tipo: "mal", texto: textoReviseGrupo({ agregar: true }, CAMPOS_DE_LA_EDICION), clave: Date.now(), subir: true });
      return;
    }
    const elegidas = porAgregar;
    const nueva = await editar("agregar", { agregar: elegidas.map((p) => p.id) }, {
      reenvio: reenvioAgregar,
      porDefecto: "No se pudo agregar a las personas.",
      traducir: { agregar: textoDeAgregar },
    });
    if (nueva && montado.current) {
      // QA-TECH P3: «Se agregó» solo para quien de verdad quedó en el grupo.
      const resultado = resultadoDeAgregar(elegidas, nueva);
      setAviso({
        tipo: resultado.faltan.length ? "aviso" : "bien",
        texto: textoDeAgregadas(resultado),
        clave: Date.now(),
        subir: true,
      });
      setPorAgregar([]);
      setEditor(null);
      focoAlTitulo();
    }
  }

  async function quitar(persona) {
    if (!candado.tomar()) return;
    const si = await preguntar(
      `¿Quitar a ${persona.nombre} del grupo?`,
      `Dejará de ver los mensajes del grupo. Podrá volver a agregar a ${persona.nombre} después.`,
      "Quitar",
    );
    if (!si || !montado.current) {
      candado.soltar();
      return;
    }
    const nueva = await editar(`quitar-${persona.id}`, { quitar: [persona.id] }, {
      reenvio: reenvioQuitar,
      porDefecto: `No se pudo quitar a ${persona.nombre}.`,
      // QA-FUNC O-1: el 400 de `quitar` se dice arriba, con palabras.
      traducir: { quitar: (texto) => textoDeQuitar(texto, persona) },
    });
    // UX H-04: «Se quitó» no sube la lista: se sigue donde se estaba.
    if (nueva && montado.current) setAviso({ tipo: "bien", texto: `Se quitó a ${persona.nombre} del grupo.`, clave: Date.now(), subir: false });
  }

  /** Ya fuera del grupo: a la lista de chats y, cuando la pantalla de debajo
   * ya se fue, la lista lo olvida y se refresca (QA-TECH P3, CA-4). */
  function irseDelGrupo(texto) {
    anunciar(texto);
    irse(() => volverAlModulo(router, "/chat"));
    setTimeout(() => {
      olvidarConversacion(id);
      cargarConversaciones({ silenciosa: true });
    }, ESPERA_OLVIDAR_MS);
  }

  async function salirDelGrupo() {
    if (!candado.tomar()) return;
    const mensaje = traspasaLaAdministracion(conversacion, usuario?.id) ? `${TEXTO_TRASPASO} ${TEXTO_SALIR}` : TEXTO_SALIR;
    const si = await preguntar(TITULO_SALIR, mensaje, "Salir del grupo");
    if (!si || !montado.current) {
      candado.soltar();
      return;
    }
    setAviso(null);
    setOcupado("salir");
    const nombre = conversacion?.nombre ?? "el grupo";
    try {
      await chatService.salir(id, opciones);
      if (!montado.current) return;
      salidaDudosa.current = false;
      irseDelGrupo(`Salió de ${nombre}.`);
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDelGrupo(e, "No se pudo salir del grupo.", {
        sinPermiso: TEXTO_YA_NO_ESTA,
        puedeHaberse: TEXTO_PUEDE_HABER_SALIDO,
      });
      // QA-FUNC O-2: tras una respuesta perdida, un 403 o 404 al reintentar
      // es que la salida sí llegó.
      if (salidaDudosa.current && (fallo.status === 403 || fallo.status === 404)) {
        salidaDudosa.current = false;
        irseDelGrupo(TEXTO_YA_SALIO);
        return;
      }
      if (fallo.dudoso) {
        salidaDudosa.current = true;
        cargarConversaciones({ silenciosa: true });
      }
      setAviso({ tipo: "mal", texto: fallo.texto, clave: fallo.clave, subir: true });
    } finally {
      candado.soltar();
      if (montado.current) setOcupado(null);
    }
  }

  if (estado === "cargando") return <Cargando texto="Cargando participantes…" />;
  if (estado === "error") {
    return (
      <View style={estilos.contenido}>
        <ErrorConReintento texto={error} onReintentar={cargar} />
      </View>
    );
  }

  const renombrable = puedeRenombrar(conversacion);
  const conMiembros = puedeCambiarMiembros(conversacion);
  const deLaQueSale = puedeSalir(conversacion);
  const ocupada = Boolean(ocupado);
  const miId = usuario?.id === undefined || usuario?.id === null ? null : String(usuario.id);
  const largo = textoDeLargo(nombreNuevo);

  const cabecera = (
    <View style={estilos.cabecera}>
      <Text ref={titulo} style={estilos.titulo} accessibilityRole="header">
        {conversacion?.nombre}
      </Text>
      {/* El tipo, salvo que repita el nombre (el canal general). */}
      {NOMBRE_DE_TIPO[conversacion?.tipo] && NOMBRE_DE_TIPO[conversacion?.tipo] !== conversacion?.nombre ? (
        <Text style={estilos.tenue}>{NOMBRE_DE_TIPO[conversacion?.tipo]}</Text>
      ) : null}
      {aviso ? <Alerta tipo={aviso.tipo} texto={aviso.texto} clave={aviso.clave} testID="aviso-del-grupo" /> : null}

      {renombrable && editor === "nombre" ? (
        <View style={estilos.bloque} testID="renombrar">
          <CampoTexto
            testID="nuevo-nombre"
            refFoco={campoNombre}
            etiqueta="Nombre del grupo"
            obligatorio
            maximo={LARGO_NOMBRE_GRUPO}
            ayuda={largo ?? undefined}
            valor={nombreNuevo}
            onCambio={(v) => {
              setNombreNuevo(v);
              if (errores.nombre) setErrores((e) => ({ ...e, nombre: undefined }));
            }}
            error={errores.nombre}
            deshabilitado={ocupada}
            // UX H-03: «Listo» en el teclado guarda.
            returnKeyType="done"
            onSubmitEditing={guardarNombre}
          />
          <View style={estilos.botones}>
            <Boton
              testID="guardar-nombre"
              titulo={ocupado === "nombre" ? "Guardando…" : "Guardar el nombre"}
              icono="check"
              cargando={ocupado === "nombre"}
              deshabilitado={ocupada && ocupado !== "nombre"}
              onPress={guardarNombre}
            />
            <Boton testID="cancelar-nombre" titulo="Cancelar" variante="secundario" deshabilitado={ocupada} onPress={cerrarEditor} />
          </View>
        </View>
      ) : null}

      {conMiembros && editor === "agregar" ? (
        <View style={estilos.bloque} testID="agregar-personas">
          <BuscadorDePersonas
            testID="buscar-para-agregar"
            refFoco={campoBuscar}
            etiqueta="Agregar personas"
            empresa={empresa}
            excluir={[...participantes.map((p) => p.id), ...porAgregar.map((p) => p.id)]}
            onElegir={elegir}
            error={errores.agregar}
            deshabilitado={ocupada}
          >
            <PersonasElegidas personas={porAgregar} onQuitar={dejarDeElegir} deshabilitado={ocupada} testID="por-agregar" />
          </BuscadorDePersonas>
          <View style={estilos.botones}>
            <Boton
              testID="confirmar-agregar"
              titulo={
                ocupado === "agregar"
                  ? "Agregando…"
                  : porAgregar.length > 1
                    ? `Agregar ${porAgregar.length} personas`
                    : "Agregar al grupo"
              }
              icono="account-plus-outline"
              cargando={ocupado === "agregar"}
              deshabilitado={ocupada && ocupado !== "agregar"}
              onPress={agregar}
            />
            <Boton testID="cancelar-agregar" titulo="Cancelar" variante="secundario" deshabilitado={ocupada} onPress={cerrarEditor} />
          </View>
        </View>
      ) : null}

      {(renombrable && editor !== "nombre") || (conMiembros && editor !== "agregar") ? (
        <View style={estilos.botones}>
          {renombrable && editor !== "nombre" ? (
            <Boton
              testID="renombrar-grupo"
              titulo="Cambiar el nombre"
              icono="pencil-outline"
              variante="secundario"
              deshabilitado={ocupada}
              onPress={() => abrirEditor("nombre")}
            />
          ) : null}
          {conMiembros && editor !== "agregar" ? (
            <Boton
              testID="abrir-agregar"
              titulo="Agregar personas"
              icono="account-plus-outline"
              variante="secundario"
              deshabilitado={ocupada}
              onPress={() => abrirEditor("agregar")}
            />
          ) : null}
        </View>
      ) : null}
      {renombrable && conversacion?.tipo === "area" ? (
        <Text style={estilos.tenue}>Los miembros de un grupo por área los da el área: aquí solo se cambia el nombre.</Text>
      ) : null}
      {/* UX H-13: el encabezado de la lista, con cuántos son. */}
      <Text style={estilos.subtitulo} accessibilityRole="header" testID="encabezado-participantes">
        {`Participantes (${participantes.length})`}
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior="padding"
      enabled={Platform.OS === "android"}
      keyboardVerticalOffset={alturaCabecera}
    >
      <FlatList
        ref={lista}
        testID="participantes"
        style={estilos.pantalla}
        contentContainerStyle={[estilos.contenido, rellenoBurbuja]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        data={participantes}
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={cabecera}
        ListFooterComponent={
          deLaQueSale ? (
            <View style={estilos.pie}>
              <Boton
                testID="salir-del-grupo"
                titulo={ocupado === "salir" ? "Saliendo…" : "Salir del grupo"}
                icono="logout"
                variante="peligro"
                cargando={ocupado === "salir"}
                deshabilitado={ocupada && ocupado !== "salir"}
                onPress={salirDelGrupo}
              />
            </View>
          ) : null
        }
        renderItem={({ item: p }) => {
          const suya = presencia[String(p.id)];
          const detalle = [p.cargo, p.area].filter(Boolean).join(" · ");
          const esUsted = miId !== null && String(p.id) === miId;
          const quitable = conMiembros && !esUsted;
          return (
            <View style={estilos.fila}>
              {/* Tocar a alguien abre su ficha de contacto (16/11/2026). */}
              <Pressable
                testID={`participante-${p.id}`}
                onPress={() =>
                  router.push({
                    pathname: "/chat/contacto/[id]",
                    params: empresa ? { id: String(p.id), empresa } : { id: String(p.id) },
                  })
                }
                style={({ pressed }) => [estilos.persona, pressed && estilos.presionado]}
                accessibilityRole="button"
                accessibilityHint="Abre su correo, teléfono, extensión y área."
                accessibilityLabel={[
                  p.nombre,
                  esUsted ? "Usted" : null,
                  p.administra ? "Administra el grupo" : null,
                  detalle,
                  suya ? [textoPresencia(suya), ...extrasDePresencia(suya)].join(" · ") : null,
                ]
                  .filter(Boolean)
                  .join(". ")}
              >
                <Icono nombre={p.administra ? "account-star-outline" : "account-outline"} size={22} color={colores.primario} />
                <View style={estilos.personaTexto}>
                  <Text style={estilos.nombre}>
                    {p.nombre}
                    {esUsted ? <Text style={estilos.tenue}> · Usted</Text> : null}
                    {p.administra ? <Text style={estilos.tenue}> · Administra</Text> : null}
                  </Text>
                  {suya ? <Presencia presencia={suya} /> : null}
                  {detalle ? <Text style={estilos.tenue}>{detalle}</Text> : null}
                </View>
                <Icono nombre="chevron-right" size={22} color={colores.tintaTenue} />
              </Pressable>
              {quitable ? (
                <BotonIcono
                  testID={`quitar-${p.id}`}
                  icono="account-remove-outline"
                  variante="peligro"
                  etiqueta={`Quitar a ${p.nombre} del grupo`}
                  cargando={ocupado === `quitar-${p.id}`}
                  deshabilitado={ocupada && ocupado !== `quitar-${p.id}`}
                  onPress={() => quitar(p)}
                />
              ) : conMiembros ? (
                // UX H-12: la fila propia, alineada con las que tienen «Quitar».
                <View style={estilos.hueco} />
              ) : null}
            </View>
          );
        }}
      />
    </KeyboardAvoidingView>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 6, paddingBottom: 40 },
  cabecera: { gap: 10, marginBottom: 8 },
  titulo: { fontSize: 20, fontWeight: "700", color: colores.titulo },
  subtitulo: { marginTop: 8, fontSize: 17, fontWeight: "700", color: colores.titulo },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  bloque: {
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
  },
  botones: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fila: { flexDirection: "row", alignItems: "center", gap: 8 },
  hueco: { width: AREA_TACTIL },
  persona: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: AREA_TACTIL,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  personaTexto: { flex: 1, gap: 2 },
  nombre: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  presionado: { opacity: 0.7 },
  pie: { marginTop: 16 },
});
