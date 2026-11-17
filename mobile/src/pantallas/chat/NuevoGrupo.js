import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { anunciar } from "../../accesibilidad/anunciar";
import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { useTecladoAbierto } from "../../accesibilidad/teclado";
import { chatService } from "../../api/servicios";
import { useChat, useChatVisible } from "../../chat/ChatContext";
import {
  CAMPOS_DEL_GRUPO,
  cuerpoDelGrupo,
  errorDelGrupo,
  hayCambiosEnElGrupo,
  LARGO_NOMBRE_GRUPO,
  MODOS_DEL_GRUPO,
  PERMISO_GRUPOS_POR_AREA,
  TEXTO_SIN_PERMISO_AREA,
  textoDeLargo,
  textoReviseGrupo,
  validarGrupo,
} from "../../chat/grupos";
import { Alerta, Boton, ErrorConReintento } from "../../componentes/comunes";
import { OpcionesEnLinea, SelectorDeLista } from "../../componentes/Selectores";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { useSesion } from "../../sesion/SesionContext";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { useCandado, useReenvioConfirmado, useSalirConCambios } from "../activos/formularios";
import { CampoTexto } from "../permisos/piezas";
import { BuscadorDePersonas, PersonasElegidas } from "./BuscadorDePersonas";

/** UX H-09: quien crea el grupo no se busca a sí mismo. */
export const AYUDA_PERSONAS = "Usted ya forma parte del grupo y lo administrará.";
export const TEXTO_SIN_AREAS = "No hay áreas para elegir en esta empresa.";

/** «Crear grupo con 2 personas», «Crear grupo del área» (UX H-02). */
export function textoDelBotonCrear({ modo, elegidas }) {
  if (modo === "area") return "Crear grupo del área";
  const n = elegidas?.length ?? 0;
  if (n === 0) return "Crear grupo";
  return n === 1 ? "Crear grupo con 1 persona" : `Crear grupo con ${n} personas`;
}

/** UX H-08: las elegidas no van en un grupo por área. */
export function textoElegidasSinUso(n) {
  if (!n) return null;
  const quienes = n === 1 ? "La persona elegida no se usará" : `Las ${n} personas elegidas no se usarán`;
  return `${quienes}: en un grupo por área los miembros los da el área.`;
}

/**
 * «Nuevo grupo» (US-024, CA-1 y CA-2), en la pila: se entra desde la lista
 * de chats, «Mis grupos» y la barra del Chat. Como la web (`NuevoGrupo` de
 * `Panel.jsx`):
 *
 * - un nombre (obligatorio, hasta 120) y, por defecto, las personas, que se
 *   buscan en el directorio del chat, se ven como fichas y se pueden quitar;
 * - con `chat.grupos_por_area`, también «Por área»: se elige el área
 *   (`GET /chat/areas/`) y sus personas son los miembros.
 *
 * Las reglas de los formularios de la app (CA-5): candado contra el doble
 * envío, los 400 junto a su campo, confirmación antes de reenviar tras «puede
 * haberse creado» y pregunta antes de descartar lo empezado. «Crear grupo»
 * va en un pie fijo que se aparta con el teclado (UX H-02). Al crear se
 * reemplaza por la conversación nueva. El grupo se crea en la empresa activa,
 * la misma de la lista de chats.
 */
export function NuevoGrupo() {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  useChatVisible();
  const router = useRouter();
  const alturaCabecera = useAlturaCabecera();
  const teclado = useTecladoAbierto();
  const margenes = useSafeAreaInsets();
  const { usuario } = useSesion();
  const { cargarConversaciones } = useChat();
  const puedePorArea = (usuario?.permissions ?? []).includes(PERMISO_GRUPOS_POR_AREA);
  const [nombre, setNombre] = useState("");
  const [modo, setModo] = useState("personas");
  const [elegidas, setElegidas] = useState([]);
  const [area, setArea] = useState("");
  const [areas, setAreas] = useState({ estado: puedePorArea ? "cargando" : "listo", lista: [], error: null });
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const montado = useRef(true);
  const candado = useCandado();
  const reenvio = useReenvioConfirmado();
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const valores = { nombre, modo, elegidas, area };
  const { salir } = useSalirConCambios(hayCambiosEnElGrupo(valores) && !enviando, { ocupado: enviando });
  // UX H-07: «Por área» sin áreas que elegir no envía.
  const sinAreas = modo === "area" && (areas.estado !== "listo" || areas.lista.length === 0);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargarAreas = useCallback(async () => {
    if (!puedePorArea) return;
    setAreas({ estado: "cargando", lista: [], error: null });
    try {
      const lista = await chatService.areas();
      if (!montado.current) return;
      setAreas({ estado: "listo", lista: Array.isArray(lista) ? lista : [], error: null });
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDelGrupo(e, "No se pudieron cargar las áreas.", { sinPermiso: TEXTO_SIN_PERMISO_AREA });
      setAreas({ estado: "error", lista: [], error: fallo.dudoso ? "No se pudieron cargar las áreas." : fallo.texto });
    }
  }, [puedePorArea]);

  useEffect(() => {
    cargarAreas();
  }, [cargarAreas]);

  function limpiarError(campo) {
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function cambiarModo(nuevo) {
    setModo(nuevo);
    setErrores((e) => ({ ...e, participantes: undefined, departamento: undefined }));
  }

  function elegir(persona) {
    setElegidas((lista) => (lista.some((p) => p.id === persona.id) ? lista : [...lista, persona]));
    limpiarError("participantes");
    anunciar(`Se eligió a ${persona.nombre}.`);
  }

  function quitar(persona) {
    setElegidas((lista) => lista.filter((p) => p.id !== persona.id));
    anunciar(`Se quitó a ${persona.nombre} de la lista.`);
  }

  function mostrarErrores(campos, texto) {
    setErrores(campos);
    setError({ texto, clave: Date.now() });
    irA(Object.keys(CAMPOS_DEL_GRUPO).find((c) => campos[c]));
  }

  async function crear() {
    if (sinAreas) return;
    if (!candado.tomar()) return;
    const encontrados = validarGrupo(valores);
    if (Object.keys(encontrados).length) {
      candado.soltar();
      mostrarErrores(encontrados, textoReviseGrupo(encontrados, CAMPOS_DEL_GRUPO));
      return;
    }
    if (!(await reenvio.confirmar())) {
      candado.soltar();
      return;
    }
    if (!montado.current) return;
    setErrores({});
    setError(null);
    setEnviando(true);
    try {
      const conversacion = await chatService.crearGrupo(cuerpoDelGrupo(valores));
      if (!montado.current) return;
      reenvio.limpiar();
      // UX H-11: la conversación nueva se abre; el lector lo dice.
      anunciar(`Se creó el grupo ${conversacion?.nombre ?? nombre.trim()}.`);
      // La lista de chats (y «Mis grupos») ya lo trae al volver.
      cargarConversaciones({ silenciosa: true });
      salir(() => router.replace(`/chat/conversacion/${conversacion.id}`));
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDelGrupo(e, "No se pudo crear el grupo.", {
        nombres: CAMPOS_DEL_GRUPO,
        sinPermiso: modo === "area" ? TEXTO_SIN_PERMISO_AREA : undefined,
      });
      reenvio.marcar(fallo);
      mostrarErrores(fallo.campos, fallo.texto);
    } finally {
      candado.soltar();
      if (montado.current) setEnviando(false);
    }
  }

  const opcionesDeArea = areas.lista.map((a) => ({ valor: String(a.id), texto: a.nombre }));
  const largo = textoDeLargo(nombre);
  const sinUso = modo === "area" ? textoElegidasSinUso(elegidas.length) : null;

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior="padding"
      enabled={Platform.OS === "android"}
      keyboardVerticalOffset={alturaCabecera}
    >
      <ScrollView
        ref={desplazable}
        testID="nuevo-grupo"
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        automaticallyAdjustKeyboardInsets
      >
        {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="nuevo-grupo-error" /> : null}
        <Text style={estilos.leyenda}>Los campos con * son obligatorios.</Text>

        <View {...bloque("nombre")}>
          <CampoTexto
            testID="nombre-del-grupo"
            refFoco={refFoco("nombre")}
            etiqueta="Nombre del grupo"
            obligatorio
            maximo={LARGO_NOMBRE_GRUPO}
            // UX H-10: cerca del límite, cuántos caracteres quedan.
            ayuda={largo ?? undefined}
            valor={nombre}
            onCambio={(v) => {
              setNombre(v);
              limpiarError("nombre");
            }}
            error={errores.nombre}
            deshabilitado={enviando}
          />
        </View>

        {/* CA-2: «Por área» solo con el permiso, como en la web. */}
        {puedePorArea ? (
          <OpcionesEnLinea
            testID="modo-del-grupo"
            etiqueta="¿Quiénes son los miembros?"
            opciones={MODOS_DEL_GRUPO}
            valor={modo}
            onCambio={cambiarModo}
            deshabilitado={enviando}
          />
        ) : null}

        {modo === "area" ? (
          <View {...bloque("departamento")} style={estilos.campo}>
            {sinUso ? <Alerta tipo="info" texto={sinUso} testID="elegidas-sin-uso" /> : null}
            {areas.estado === "cargando" ? (
              <View style={estilos.linea} accessibilityLiveRegion="polite">
                <ActivityIndicator color={colores.primario} />
                <Text style={estilos.tenue}>Cargando las áreas…</Text>
              </View>
            ) : areas.estado === "error" ? (
              <ErrorConReintento texto={areas.error} onReintentar={cargarAreas} />
            ) : opcionesDeArea.length === 0 ? (
              <Alerta tipo="info" texto={TEXTO_SIN_AREAS} testID="sin-areas" />
            ) : (
              <SelectorDeLista
                testID="area-del-grupo"
                refFoco={refFoco("departamento")}
                etiqueta="Área"
                ayuda="Sus personas son los miembros del grupo."
                obligatorio
                buscable
                opciones={opcionesDeArea}
                valor={area}
                vacio="Elija el área"
                onCambio={(v) => {
                  setArea(v);
                  limpiarError("departamento");
                }}
                error={errores.departamento}
                deshabilitado={enviando}
              />
            )}
          </View>
        ) : (
          <View {...bloque("participantes")} style={estilos.campo}>
            <BuscadorDePersonas
              etiqueta="Personas"
              ayuda={AYUDA_PERSONAS}
              obligatorio
              refFoco={refFoco("participantes")}
              excluir={elegidas.map((p) => p.id)}
              onElegir={elegir}
              error={errores.participantes}
              deshabilitado={enviando}
            >
              <PersonasElegidas personas={elegidas} onQuitar={quitar} deshabilitado={enviando} />
            </BuscadorDePersonas>
          </View>
        )}
      </ScrollView>
      {/* UX H-02: el botón siempre a la vista, salvo con el teclado abierto. */}
      {teclado ? null : (
        <View style={[estilos.pie, { paddingBottom: 16 + (margenes?.bottom ?? 0) }]}>
          <Boton
            testID="crear-grupo"
            titulo={enviando ? "Creando…" : textoDelBotonCrear(valores)}
            icono="account-multiple-plus-outline"
            cargando={enviando}
            deshabilitado={sinAreas}
            onPress={crear}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 16, paddingBottom: 24 },
  campo: { gap: 10 },
  leyenda: { fontSize: 14, color: colores.tintaSuave },
  linea: { flexDirection: "row", alignItems: "center", gap: 8 },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  pie: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: colores.borde,
    backgroundColor: colores.superficie,
  },
});
