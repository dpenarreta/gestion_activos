import { useFocusEffect } from "expo-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { soporteService } from "../../api/servicios";
import { Alerta, Boton, BotonIcono, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { useSesion } from "../../sesion/SesionContext";
import { mensajeDeSoporte } from "../../soporte/formato";
import { SONDEO_LISTAS_MS, useSondeo } from "../../soporte/useSondeo";
import { colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { fechaYHora } from "../../utils/fechas";
import { CampoTexto } from "../permisos/piezas";
import { Dato, Separador } from "./piezas";

/**
 * «Aprobaciones» (US-014, CA-17), como `AprobacionesPage.jsx` de la web: las
 * solicitudes que esperan el visto bueno de la persona (jefe de área, Talento
 * Humano…), con el ticket, quién pide, área y agencia, el caso, la prioridad
 * y la descripción. «Aprobar» o «No aprobar»; no aprobar pide la nota (hasta
 * 500) y avisa de que cierra el ticket.
 */
export const MAXIMO_NOTA = 500;
export const TEXTO_NOTA_OBLIGATORIA = "Escriba una nota para poder no aprobarla: es lo que le llega a quien la pidió.";
/** G-6: con su visto bueno aún faltan otros. */
export const TEXTO_FALTAN_OTRAS = "Aprobada. Aún faltan otras aprobaciones.";

function confirmar({ titulo, mensaje, accion }) {
  return new Promise((resolver) => {
    Alert.alert(
      titulo,
      mensaje,
      [
        { text: "Volver", style: "cancel", onPress: () => resolver(false) },
        { text: accion, style: "destructive", onPress: () => resolver(true) },
      ],
      { cancelable: true, onDismiss: () => resolver(false) },
    );
  });
}

const TarjetaAprobacion = memo(function TarjetaAprobacion({ aprobacion, onDecidir }) {
  const { fontScale } = useWindowDimensions();
  const [nota, setNota] = useState("");
  const [errorNota, setErrorNota] = useState(null);
  const [enviando, setEnviando] = useState(null);
  const [error, setError] = useState(null);
  // H-05: la nota aparece al tocar «No aprobar» (no se pide para aprobar).
  const [rechazando, setRechazando] = useState(false);
  const candado = useRef(false);
  const montado = useRef(true);
  const campoNota = useRef(null);
  const t = aprobacion.ticket ?? {};

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // Al aparecer, el campo se lleva el foco (y el teclado).
  useEffect(() => {
    if (rechazando) campoNota.current?.focus?.();
  }, [rechazando]);

  /** N-05: deja de rechazar; con una nota escrita, primero lo confirma. */
  async function cancelarRechazo() {
    if (candado.current) return;
    if (nota.trim()) {
      const si = await confirmar({
        titulo: "¿Descartar la nota?",
        mensaje: "No se envió: la solicitud sigue esperando su decisión.",
        accion: "Descartar",
      });
      if (!si) return;
    }
    setNota("");
    setErrorNota(null);
    setRechazando(false);
  }

  async function decidir(aprobar) {
    if (candado.current) return;
    const texto = nota.trim();
    // N-05: aprobar con una nota de rechazo escrita se confirma: la nota no
    // se envía.
    if (aprobar && rechazando && texto) {
      const si = await confirmar({
        titulo: `¿Aprobar ${t.numero}?`,
        mensaje: "Escribió una nota para no aprobarla. Si la aprueba, esa nota no se envía.",
        accion: "Aprobar",
      });
      if (!si) return;
    }
    if (!aprobar && !rechazando) {
      setRechazando(true);
      anunciar("Escriba por qué no la aprueba y vuelva a tocar «No aprobar».");
      return;
    }
    if (!aprobar && !texto) {
      setErrorNota(TEXTO_NOTA_OBLIGATORIA);
      anunciar(TEXTO_NOTA_OBLIGATORIA);
      campoNota.current?.focus?.();
      return;
    }
    candado.current = true;
    if (!aprobar) {
      const si = await confirmar({
        titulo: `¿No aprobar ${t.numero}?`,
        mensaje: `El ticket se cierra y se le avisa a ${t.solicitante || "quien lo pidió"} con su nota: «${texto}».`,
        accion: "No aprobar",
      });
      if (!si) {
        candado.current = false;
        return;
      }
    }
    setEnviando(aprobar ? "aprobar" : "rechazar");
    setError(null);
    const fallo = await onDecidir(aprobacion, aprobar, aprobar ? "" : texto);
    candado.current = false;
    // Si salió bien, la tarjeta ya no está: nada que actualizar.
    if (!montado.current) return;
    setEnviando(null);
    if (fallo) setError({ texto: fallo, clave: Date.now() });
  }

  const base = { flexBasis: 140 * Math.max(1, fontScale), flexGrow: 1 };
  return (
    <View style={estilos.tarjeta} testID={`aprobacion-${aprobacion.id}`}>
      <Text style={estilos.titulo} accessibilityRole="header">
        {[t.numero, t.codigo, t.caso].filter(Boolean).join(" · ")}
      </Text>
      <Text style={estilos.tenue}>
        {aprobacion.rol}
        {aprobacion.sin_aprobador ? " · sin responsable con cuenta" : ""} · {fechaYHora(aprobacion.creada)}
      </Text>
      <Dato nombre="Pide" valor={[t.solicitante, t.correo].filter(Boolean).join(" · ")} />
      <Dato nombre="Área y agencia" valor={[t.area, t.agencia].filter(Boolean).join(" · ")} />
      <Dato nombre="Caso" valor={[t.caso, t.categoria].filter(Boolean).join(" · ")} />
      <Dato nombre="Prioridad" valor={t.prioridad_display} />
      {(t.datos_adicionales ?? []).map((d) => (
        <Dato key={d.clave} nombre={d.etiqueta} valor={d.valor} />
      ))}
      {/* H-26: la descripción en texto normal, no en negrita. */}
      <View style={estilos.descripcion}>
        <Text style={estilos.tenue}>Descripción</Text>
        <Text style={estilos.texto} selectable>
          {t.descripcion}
        </Text>
      </View>
      {rechazando ? (
        <CampoTexto
          testID={`nota-${aprobacion.id}`}
          refFoco={campoNota}
          etiqueta="Por qué no la aprueba"
          obligatorio
          ayuda="No aprobar cierra el ticket y le avisa a quien lo pidió con esta nota."
          valor={nota}
          onCambio={(v) => {
            setNota(v);
            if (v.trim()) setErrorNota(null);
          }}
          error={errorNota}
          multilinea
          maximo={MAXIMO_NOTA}
          deshabilitado={Boolean(enviando)}
        />
      ) : null}
      {rechazando ? (
        <Boton
          testID={`cancelar-rechazo-${aprobacion.id}`}
          titulo="Cancelar"
          etiqueta="Cancelar: no rechazar la solicitud"
          icono="close"
          variante="secundario"
          deshabilitado={Boolean(enviando)}
          onPress={() => {
            cancelarRechazo();
          }}
        />
      ) : null}
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} /> : null}
      <View style={estilos.decision}>
        <View style={base}>
          <Boton
            testID={`no-aprobar-${aprobacion.id}`}
            titulo={enviando === "rechazar" ? "Enviando…" : "No aprobar"}
            icono="close-circle-outline"
            variante="secundario"
            cargando={enviando === "rechazar"}
            deshabilitado={Boolean(enviando)}
            onPress={() => {
              decidir(false);
            }}
          />
        </View>
        <View style={base}>
          <Boton
            testID={`aprobar-${aprobacion.id}`}
            titulo={enviando === "aprobar" ? "Enviando…" : "Aprobar"}
            icono="check-circle-outline"
            cargando={enviando === "aprobar"}
            deshabilitado={Boolean(enviando)}
            onPress={() => {
              decidir(true);
            }}
          />
        </View>
      </View>
    </View>
  );
});

export function Aprobaciones({ pie = null, alActualizar }) {
  const { versionEmpresa } = useSesion();
  const alturaCabecera = useAlturaCabecera();
  const [estado, setEstado] = useState("cargando");
  const [lista, setLista] = useState([]);
  const [error, setError] = useState(null);
  const [hecho, setHecho] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const montado = useRef(true);
  const consulta = useRef(0);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async ({ silenciosa = false } = {}) => {
    const numero = ++consulta.current;
    if (!silenciosa) setEstado("cargando");
    try {
      const datos = await soporteService.aprobaciones();
      if (!montado.current || numero !== consulta.current) return;
      setLista(Array.isArray(datos) ? datos : []);
      setEstado("listo");
      setError(null);
    } catch (e) {
      if (!montado.current || numero !== consulta.current) return;
      if (silenciosa && estadoRef.current === "listo") return;
      setError(mensajeDeSoporte(e, "No se pudieron cargar las aprobaciones."));
      setEstado("error");
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      cargar({ silenciosa: true });
    }, [cargar]),
  );

  useSondeo(() => cargar({ silenciosa: true }), SONDEO_LISTAS_MS, estado === "listo");

  /** Devuelve el mensaje de error, o `null` si salió bien. */
  const decidir = useCallback(
    async (aprobacion, aprobar, nota) => {
      setHecho(null);
      try {
        const respuesta = await soporteService.decidirAprobacion(aprobacion.id, aprobar, nota);
        if (!montado.current) return null;
        const numero = aprobacion.ticket?.numero ?? "";
        const texto = !aprobar
          ? `${numero} no aprobado: se le avisó a quien lo pidió.`
          : respuesta?.estado === "esperando_aprobacion"
            ? `${numero}: ${TEXTO_FALTAN_OTRAS}`
            : `${numero} aprobado: entra a la cola de soporte.`;
        setHecho({ texto, clave: Date.now() });
        setLista((l) => l.filter((a) => a.id !== aprobacion.id));
        cargar({ silenciosa: true });
        alActualizar?.();
        return null;
      } catch (e) {
        return mensajeDeSoporte(e, "No se pudo registrar la decisión.", { envio: true });
      }
    },
    [cargar, alActualizar],
  );

  async function refrescar() {
    setRefrescando(true);
    await Promise.all([cargar({ silenciosa: true }), alActualizar?.()]);
    if (montado.current) setRefrescando(false);
  }

  const renderItem = useCallback(
    ({ item }) => <TarjetaAprobacion aprobacion={item} onDecidir={decidir} />,
    [decidir],
  );

  let vacio;
  if (estado === "cargando") vacio = <Cargando texto="Cargando las aprobaciones…" />;
  else if (estado === "error") vacio = <ErrorConReintento texto={error} onReintentar={() => cargar()} />;
  else vacio = <Vacio icono="check-all" texto="No tiene aprobaciones pendientes." />;

  return (
    // H-05: el teclado no tapa la nota (como el detalle de una solicitud).
    <KeyboardAvoidingView
      style={estilos.lista}
      behavior="padding"
      enabled={Platform.OS === "android"}
      keyboardVerticalOffset={alturaCabecera}
    >
    <FlatList
      testID="lista-aprobaciones"
      style={estilos.lista}
      contentContainerStyle={estilos.contenido}
      data={estado === "listo" ? lista : []}
      keyExtractor={(a) => String(a.id)}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      automaticallyAdjustKeyboardInsets
      ListHeaderComponent={
        <View style={estilos.cabecera}>
          <View style={estilos.filaCabecera}>
            <Text style={estilos.explicacion}>
              Solicitudes de soporte que necesitan su visto bueno. Mientras no las apruebe, no entran a la cola.
            </Text>
            <BotonIcono
              testID="actualizar-aprobaciones"
              icono="refresh"
              variante="contorno"
              etiqueta={refrescando ? "Actualizando…" : "Actualizar las aprobaciones"}
              cargando={refrescando}
              onPress={refrescar}
            />
          </View>
          {hecho ? <Alerta tipo="bien" texto={hecho.texto} clave={hecho.clave} testID="resultado-aprobacion" /> : null}
        </View>
      }
      ListEmptyComponent={vacio}
      ListFooterComponent={pie ? <View style={estilos.pie}>{pie}</View> : null}
      renderItem={renderItem}
      ItemSeparatorComponent={Separador}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    />
    </KeyboardAvoidingView>
  );
}

const estilos = crearEstilos({
  lista: { flex: 1 },
  contenido: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  cabecera: { gap: 10, marginBottom: 10 },
  filaCabecera: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  explicacion: { flex: 1, fontSize: 15, color: colores.tintaSuave },
  pie: { marginTop: 20 },
  tarjeta: {
    gap: 10,
    padding: 14,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  titulo: { fontSize: 17, fontWeight: "700", color: colores.titulo },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  texto: { fontSize: 15, color: colores.tinta },
  descripcion: { gap: 2 },
  decision: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
