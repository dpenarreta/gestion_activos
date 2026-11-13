import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { erroresPorCampo } from "../../api/errores";
import { soporteService } from "../../api/servicios";
import { Alerta, Boton, Cargando, ErrorConReintento } from "../../componentes/comunes";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { useSesion } from "../../sesion/SesionContext";
import { useAdjuntosPorEnviar, validarLista } from "../../soporte/adjuntos";
import {
  adicionalesParaEnviar,
  camposVisibles,
  enLaCola,
  faltanEnElPerfil,
  mensajeDeSoporte,
  rutaDeAltaPropia,
  unirConY,
  validarCampos,
} from "../../soporte/formato";
import { useRecargarResumenSoporte } from "../../soporte/ResumenSoporteContext";
import { colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { AbrirEnLaWeb } from "../permisos/piezas";
import { FormularioDelTicket } from "./FormularioDelTicket";
import { AdjuntosPorEnviar } from "./piezas";

/**
 * «Nuevo ticket» a nombre propio (US-014, CA-4, CA-5 y CA-22), como
 * `NuevoTicket.jsx` de la web: se describe primero y la app sugiere el caso;
 * los datos de contacto salen de «Mi perfil» y, si falta algo, se explica y
 * se ofrece completarlo en el navegador (la app no edita la ficha de
 * contacto). Se crea por «Soporte TI» (`soporte.crear`) o, sin él, por la Mesa
 * (`soporte.mesa_crear`).
 *
 * Un solo envío aunque se toque dos veces (candado en un ref). Si falla, lo
 * escrito y los adjuntos se quedan; sin respuesta del servidor se avisa de
 * que puede haberse enviado (no hay clave de idempotencia).
 */
export const TEXTO_SIN_PERMISO_PARA_CREAR =
  "Para crear tickets a su nombre necesita el permiso «Crear tickets»; pídaselo a su jefe o a Tecnología.";
export const TEXTO_NO_DISPONIBLE = "La mesa de ayuda de esta empresa todavía no está disponible.";
export const TEXTO_FUERA_DE_HORARIO =
  "Lo recibimos fuera del horario de atención: se atenderá a la brevedad el siguiente día hábil.";

const VACIO = { categoria: "", caso: "", descripcion: "", impacto: "", urgencia: "" };

/** «Antes de pedir soporte, complete en «Mi perfil»: área y agencia.» */
export function textoFaltanDatos(faltan) {
  return `Antes de pedir soporte, complete en «Mi perfil»: ${unirConY(faltan)}. La app no edita su perfil: hágalo en el navegador y vuelva.`;
}

/** Lo que se sabe de quien pide, en una línea (como la web). */
function textoDeSusDatos(d) {
  return [
    d.nombre,
    d.correo,
    d.telefono_corporativo && `corporativo ${d.telefono_corporativo}`,
    d.telefono && `personal ${d.telefono}`,
    d.area?.nombre,
    d.agencia?.nombre,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function NuevoTicket() {
  const router = useRouter();
  const navegacion = useNavigation();
  const alturaCabecera = useAlturaCabecera();
  const { usuario, empresaActiva } = useSesion();
  const { recargar: recargarResumen } = useRecargarResumenSoporte();
  const ruta = rutaDeAltaPropia(usuario?.permissions ?? []);
  // Primitivos: `ruta` es un objeto nuevo en cada render.
  const puedeCrear = Boolean(ruta);
  const desdeLaMesa = Boolean(ruta?.desdeLaMesa);
  const [carga, setCarga] = useState({ estado: "cargando", datos: null, error: null });
  const [valores, setValores] = useState(VACIO);
  const [adicionales, setAdicionales] = useState({});
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [faltanDelServidor, setFaltanDelServidor] = useState(null);
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
    if (!puedeCrear) {
      setCarga({ estado: "sin_permiso", datos: null, error: null });
      return;
    }
    setCarga((c) => ({ ...c, estado: "cargando", error: null }));
    try {
      const datos = await soporteService.formularioPropio({ desdeLaMesa });
      if (!montado.current) return;
      setFaltanDelServidor(null);
      setCarga({ estado: "listo", datos, error: null });
    } catch (e) {
      if (!montado.current) return;
      setCarga({ estado: "error", datos: null, error: mensajeDeSoporte(e, "No se pudo abrir la mesa de ayuda.") });
    }
  }, [puedeCrear, desdeLaMesa]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const tocado =
    Object.values(valores).some((v) => String(v ?? "").trim() !== "") ||
    Object.keys(adicionales).length > 0 ||
    adjuntos.lista.length > 0;

  // CA-22: salir con algo escrito pide confirmación; tras crear, no.
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

  function fijar(campo, valor) {
    setValores((actual) => ({
      ...actual,
      [campo]: valor,
      ...(campo === "categoria" && actual.categoria !== valor ? { caso: "" } : {}),
    }));
    setErrores((actuales) => (actuales[campo] ? { ...actuales, [campo]: undefined } : actuales));
  }

  function fijarAdicional(clave, valor) {
    setAdicionales((actual) => ({ ...actual, [clave]: valor }));
    setErrores((actuales) => (actuales[clave] ? { ...actuales, [clave]: undefined } : actuales));
  }

  /** Al primer campo que falla, en el orden de la pantalla. */
  function irAlPrimero(conError) {
    const orden = [...camposVisibles(carga.datos?.campos, valores.categoria, true).map((c) => c.clave), "adjuntos"];
    const primero = orden.find((c) => conError.includes(c));
    if (primero) irA(primero);
    else irA(null);
  }

  async function enviar() {
    if (enCurso.current) return;
    const datos = carga.datos;
    const faltan = validarCampos(datos.campos, valores, adicionales);
    const errorAdjuntos = validarLista(adjuntos.lista);
    if (errorAdjuntos) faltan.adjuntos = errorAdjuntos;
    if (Object.keys(faltan).length) {
      setErrores(faltan);
      mostrarError("Revise los campos marcados.");
      irAlPrimero(Object.keys(faltan));
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    mostrarError(null);
    setErrores({});
    setFaltanDelServidor(null);
    try {
      const { categoria, ...campos } = valores;
      campos.adicionales = adicionalesParaEnviar(datos.campos, valores, adicionales);
      const respuesta = await soporteService.crearTicket(campos, adjuntos.lista, { desdeLaMesa });
      if (!montado.current) return;
      adjuntos.vaciar();
      setCreado(respuesta);
      recargarResumen();
      anunciar(`Recibimos su solicitud: ticket ${respuesta?.numero ?? ""}.`);
      desplazable.current?.scrollTo?.({ y: 0, animated: false });
    } catch (e) {
      if (!montado.current) return;
      const datosError = e?.response?.data?.error;
      if (datosError?.code === "faltan_datos") {
        const faltan = Array.isArray(datosError.details?.faltan) ? datosError.details.faltan : [];
        setFaltanDelServidor(faltan.map((f) => String(f).toLowerCase()));
        mostrarError(textoFaltanDatos(faltan.map((f) => String(f).toLowerCase())));
        irA(null);
        return;
      }
      const porCampo = erroresPorCampo(e);
      const visibles = new Set(camposVisibles(datos.campos, valores.categoria, true).map((c) => c.clave));
      const deCampos = Object.keys(porCampo).filter((c) => visibles.has(c));
      const otros = Object.entries(porCampo)
        .filter(([c]) => !visibles.has(c))
        .map(([, texto]) => texto);
      setErrores(porCampo);
      // Un error de un campo que no está a la vista se dice arriba.
      const base =
        deCampos.length && !otros.length
          ? "Revise los campos marcados."
          : mensajeDeSoporte(e, "No se pudo crear el ticket.", { envio: true });
      mostrarError([base, ...otros.filter((t) => !base.includes(t))].join(" "));
      if (deCampos.length && !otros.length) irAlPrimero(deCampos);
      else irA(null);
    } finally {
      enCurso.current = false;
      if (montado.current) setEnviando(false);
    }
  }

  function crearOtro() {
    setCreado(null);
    setValores(VACIO);
    setAdicionales({});
    setErrores({});
    mostrarError(null);
  }

  if (carga.estado === "sin_permiso") {
    return (
      <View style={estilos.contenido}>
        <Alerta tipo="aviso" texto={TEXTO_SIN_PERMISO_PARA_CREAR} />
      </View>
    );
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
  const empresa = empresaActiva?.id;

  if (creado) {
    return (
      <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} testID="ticket-creado">
        <Text style={estilos.titulo} accessibilityRole="header">
          Recibimos su solicitud
        </Text>
        <Text style={estilos.texto}>
          Su ticket es el <Text style={estilos.negrita}>{creado.numero}</Text>. Le avisaremos por correo y en la
          campana cuando le respondan.
        </Text>
        <Alerta
          tipo="info"
          texto={
            creado.estado === "esperando_aprobacion"
              ? "Necesita una aprobación: en cuanto la den, entra a la cola."
              : creado.posicion
                ? enLaCola(creado.posicion)
                : "Ya lo está atendiendo una persona del equipo de soporte."
          }
        />
        {creado.fuera_de_horario ? <Alerta tipo="aviso" texto={TEXTO_FUERA_DE_HORARIO} /> : null}
        <Boton
          testID="ver-mi-ticket"
          titulo="Ver mi ticket"
          icono="ticket-outline"
          onPress={() => router.replace({ pathname: "/soporte/mi-ticket/[id]", params: { id: String(creado.id) } })}
        />
        <Boton testID="crear-otro" titulo="Crear otro" icono="plus" variante="secundario" onPress={crearOtro} />
      </ScrollView>
    );
  }

  if (!datos?.disponible) {
    return (
      <View style={estilos.contenido}>
        <Alerta tipo="info" texto={TEXTO_NO_DISPONIBLE} />
      </View>
    );
  }
  if (datos.puede_crear === false) {
    return (
      <View style={estilos.contenido}>
        <Alerta tipo="aviso" texto={TEXTO_SIN_PERMISO_PARA_CREAR} />
      </View>
    );
  }

  const faltanAlAbrir = faltanEnElPerfil(datos.mis_datos);
  if (faltanAlAbrir.length > 0) {
    return (
      <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} testID="faltan-datos">
        <Text style={estilos.titulo} accessibilityRole="header">
          Complete sus datos
        </Text>
        <Alerta tipo="aviso" texto={textoFaltanDatos(faltanAlAbrir)} />
        <AbrirEnLaWeb
          testID="completar-perfil"
          ruta="/admin/perfil"
          empresa={empresa}
          titulo="Completar «Mi perfil» en el navegador"
        />
        <Boton
          testID="revisar-de-nuevo"
          titulo="Ya lo completé: revisar de nuevo"
          icono="refresh"
          variante="secundario"
          onPress={cargar}
        />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior="padding"
      enabled={Platform.OS === "android"}
      keyboardVerticalOffset={alturaCabecera}
    >
      <ScrollView
        ref={desplazable}
        testID="nuevo-ticket"
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        automaticallyAdjustKeyboardInsets
      >
        <Text style={estilos.titulo} accessibilityRole="header">
          ¿En qué le ayudamos?
        </Text>
        {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="error-envio" /> : null}
        {faltanDelServidor ? (
          <AbrirEnLaWeb
            testID="completar-perfil"
            ruta="/admin/perfil"
            empresa={empresa}
            titulo="Completar «Mi perfil» en el navegador"
          />
        ) : null}
        <Text style={estilos.leyenda}>Los campos con * son obligatorios.</Text>
        <FormularioDelTicket
          datos={datos}
          valores={valores}
          onBase={fijar}
          adicionales={adicionales}
          onAdicional={fijarAdicional}
          errores={errores}
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
        <View style={estilos.susDatos} accessible accessibilityLabel={`Le contactaremos como ${textoDeSusDatos(datos.mis_datos ?? {})}.`}>
          <Text style={estilos.tenue}>
            Le contactaremos como <Text style={estilos.negrita}>{textoDeSusDatos(datos.mis_datos ?? {})}</Text>.
          </Text>
        </View>
        <AbrirEnLaWeb
          testID="cambiar-mis-datos"
          ruta="/admin/perfil"
          empresa={empresa}
          titulo="Cambiar mis datos en el navegador"
        />
        <Boton
          testID="crear-ticket"
          titulo={enviando ? "Enviando…" : "Crear ticket"}
          icono="send"
          cargando={enviando}
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
  contenido: { padding: 16, gap: 16, paddingBottom: 40 },
  titulo: { fontSize: 22, fontWeight: "700", color: colores.titulo },
  texto: { fontSize: 16, color: colores.tinta },
  negrita: { fontWeight: "700" },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  leyenda: { fontSize: 14, color: colores.tintaSuave },
  susDatos: { paddingTop: 4 },
});
