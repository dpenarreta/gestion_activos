import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { erroresPorCampo, mensajeDeError } from "../../api/errores";
import { chatService } from "../../api/servicios";
import { ICONO_DE_ESTADO } from "../../chat/formato";
import {
  ALMUERZO_MAXIMO,
  ALMUERZO_MINIMO,
  AUSENCIAS,
  avisarMiEstado,
  diaYMes,
  errorDeRegreso,
  erroresDeVacaciones,
  ESTADOS,
  fechaLocal,
  horaDeHoy,
  textoVacacionesSugeridas,
} from "../../chat/miEstado";
import { Alerta, Boton, Cargando, Desplegable, ErrorConReintento } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { SelectorFecha } from "../../componentes/SelectorFecha";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { useReemplazoEnAusencia, YA_QUEDO_GUARDADO } from "../../permisos/useReemplazoEnAusencia";
import { colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";
import { ReemplazoEnAusencia } from "../permisos/ReemplazoEnAusencia";

/**
 * «Mi estado» en el chat (US-011, CA-8), con las opciones, los textos y las
 * reglas de la ventana de la web (`VentanaEstado` de `MiEstado.jsx`). Se
 * abre desde la pestaña «Chat» y desde «Cuenta». Lo ven los demás junto a su
 * nombre y al escribirle.
 */
export const TEXTO_GUARDADO = "Su estado se guardó.";

export function MiEstado() {
  const router = useRouter();
  const [datos, setDatos] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async () => {
    setErrorCarga(null);
    try {
      const d = await chatService.miEstado();
      if (montado.current) setDatos(d);
    } catch (e) {
      if (montado.current) setErrorCarga(mensajeDeError(e, "No se pudo cargar su estado."));
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (errorCarga) {
    return (
      <View style={estilos.contenido}>
        <ErrorConReintento texto={errorCarga} onReintentar={cargar} />
      </View>
    );
  }
  if (!datos) return <Cargando texto="Cargando su estado…" />;
  return (
    <FormularioEstado
      datos={datos}
      onGuardado={(nuevo) => {
        avisarMiEstado(nuevo);
        anunciar(TEXTO_GUARDADO);
        router.back();
      }}
    />
  );
}

export function FormularioEstado({ datos, onGuardado }) {
  const alturaCabecera = useAlturaCabecera();
  const sugeridas = datos.vacaciones_sugeridas;
  const vigente = datos.vigente;
  // Si lo que rige es una ausencia (también la de un permiso aprobado), la
  // pantalla abre en ella.
  const [estado, setEstado] = useState(AUSENCIAS.includes(vigente?.clave) ? vigente.clave : datos.estado);
  // «Fuera de la oficina» por un permiso aprobado: no lo eligió la persona.
  const fueraPorPermiso = vigente?.clave === "fuera_oficina" && datos.estado !== "fuera_oficina";
  const [eligio, setEligio] = useState(false);
  const [regresoFuera, setRegresoFuera] = useState(
    datos.estado === "fuera_oficina" && datos.hasta ? fechaLocal(datos.hasta) : "",
  );
  const [errores, setErrores] = useState({});
  const ausente = AUSENCIAS.includes(estado);
  const porPermiso = fueraPorPermiso && !eligio && estado === "fuera_oficina";
  const reemplazo = useReemplazoEnAusencia({ activo: ausente });
  const [mensaje, setMensaje] = useState(
    (vigente?.clave === "vacaciones" ? datos.mensaje_vacaciones : datos.mensaje) ?? "",
  );
  const [hasta, setHasta] = useState("");
  const [inicio, setInicio] = useState(datos.almuerzo_inicio || "");
  const [minutos, setMinutos] = useState(String(datos.almuerzo_minutos || 60));
  const [desde, setDesde] = useState(datos.vacaciones_desde ?? sugeridas?.desde ?? "");
  const [regreso, setRegreso] = useState(datos.vacaciones_hasta ?? sugeridas?.hasta ?? "");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  // «Mi horario de almuerzo» plegado salvo que haga falta: al estar en
  // almuerzo o con un error en los minutos (auditoría UX, H-10).
  const [almuerzoAbierto, setAlmuerzoAbierto] = useState(
    datos.estado === "almuerzo" || vigente?.clave === "almuerzo",
  );
  const enCurso = useRef(false);
  const montado = useRef(true);
  // N-06: con un error en los minutos, la pantalla y el lector van al
  // almuerzo, ya abierto.
  const desplazable = useRef(null);
  // R-03: el foco va al campo de los minutos.
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const limpiarError = (campo) => setErrores((actuales) => ({ ...actuales, [campo]: undefined }));

  async function guardar(cambios, conReemplazo = false) {
    if (enCurso.current) return;
    enCurso.current = true;
    setGuardando(true);
    setError(null);
    setErrores({});
    // Primero quién aprueba por usted: al guardar el estado, lo pendiente
    // pasa a esa persona y tiene que encontrarla ya elegida.
    let reemplazoGuardado = false;
    try {
      if (conReemplazo) {
        const resultado = await reemplazo.guardar();
        if (!resultado.ok) {
          if (montado.current) setError({ texto: resultado.mensaje, clave: Date.now() });
          return;
        }
        reemplazoGuardado = resultado.guardado;
      }
      try {
        const nuevo = await chatService.guardarEstado(cambios);
        if (montado.current) onGuardado(nuevo);
      } catch (e) {
        if (!montado.current) return;
        const campos = erroresPorCampo(e);
        setErrores(campos);
        if (campos.almuerzo_minutos) {
          setAlmuerzoAbierto(true);
          irA("almuerzo");
        }
        const base =
          campos.hasta || campos.vacaciones_desde || campos.vacaciones_hasta || campos.almuerzo_minutos
            ? "Revise los campos marcados."
            : mensajeDeError(e, "No se pudo guardar su estado.");
        setError({ texto: reemplazoGuardado ? `${base} ${YA_QUEDO_GUARDADO}` : base, clave: Date.now() });
      }
    } finally {
      enCurso.current = false;
      if (montado.current) setGuardando(false);
    }
  }

  function enviar() {
    if (enCurso.current) return;
    let propios = {};
    if (estado === "fuera_oficina" && !porPermiso) {
      const deRegreso = errorDeRegreso(regresoFuera);
      if (deRegreso) propios.hasta = deRegreso;
    }
    if (estado === "vacaciones") propios = erroresDeVacaciones(desde, regreso);
    const cuantos = Number(minutos);
    if (!Number.isInteger(cuantos) || cuantos < ALMUERZO_MINIMO || cuantos > ALMUERZO_MAXIMO) {
      propios.almuerzo_minutos = `El almuerzo dura entre ${ALMUERZO_MINIMO} y ${ALMUERZO_MAXIMO} minutos.`;
      setAlmuerzoAbierto(true);
      // Si es el único error, se va a él; si hay otros, están más arriba.
      if (Object.keys(propios).length === 1) irA("almuerzo");
    }
    const deReemplazo = ausente && reemplazo.validar();
    if (Object.keys(propios).length || deReemplazo) {
      setErrores(propios);
      setError({ texto: "Revise los campos marcados.", clave: Date.now() });
      return;
    }
    const almuerzo = { almuerzo_inicio: inicio || null, almuerzo_minutos: cuantos };
    // Con la ausencia del permiso sin tocar: solo el almuerzo y, antes, el
    // reemplazo.
    if (porPermiso) {
      guardar(almuerzo, true);
      return;
    }
    const cambios = { estado, mensaje, ...almuerzo };
    if (estado === "vacaciones") {
      cambios.vacaciones_desde = desde || null;
      cambios.vacaciones_hasta = regreso || null;
    }
    if (estado === "reunion" || estado === "no_disponible") cambios.hasta = horaDeHoy(hasta);
    if (estado === "fuera_oficina") cambios.hasta = regresoFuera;
    guardar(cambios, ausente);
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
        testID="mi-estado"
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} /> : null}
        {vigente?.detalle ? <Alerta tipo="info" texto={`Ahora: ${vigente.detalle}.`} /> : null}

        <View accessibilityRole="radiogroup" accessibilityLabel="¿Cómo está?" style={estilos.grupo}>
          <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
            ¿Cómo está?
          </Text>
          {ESTADOS.map((opcion) => {
            const activa = estado === opcion.clave;
            return (
              <Pressable
                key={opcion.clave}
                testID={`estado-${opcion.clave}`}
                onPress={() => {
                  setEstado(opcion.clave);
                  setEligio(true);
                  setErrores({});
                  if (opcion.clave === "almuerzo") setAlmuerzoAbierto(true);
                }}
                disabled={guardando}
                accessibilityRole="radio"
                accessibilityState={{ checked: activa, disabled: guardando }}
                accessibilityLabel={opcion.nombre}
                style={[estilos.opcion, activa && estilos.opcionActiva]}
              >
                <Icono
                  nombre={activa ? "radiobox-marked" : "radiobox-blank"}
                  size={22}
                  color={activa ? colores.primario : colores.bordeControl}
                />
                <Icono nombre={ICONO_DE_ESTADO[opcion.clave]} size={20} color={colores.tintaSuave} />
                <Text style={estilos.opcionTexto}>{opcion.nombre}</Text>
              </Pressable>
            );
          })}
        </View>
        {ausente ? <Text style={estilos.leyenda}>Los campos con * son obligatorios.</Text> : null}

        {estado === "almuerzo" ? (
          <Text style={estilos.texto}>
            Durará {minutos} minutos desde ahora; después vuelve solo a «Disponible». Quien le escriba sabrá que está en
            almuerzo.
          </Text>
        ) : null}

        {estado === "reunion" || estado === "no_disponible" ? (
          <View style={estilos.grupo}>
            <SelectorFecha
              testID="estado-hasta"
              etiqueta="Hasta (opcional)"
              modo="time"
              valor={hasta}
              onCambio={setHasta}
              ayuda="Sin hora, dura hasta que lo cambie."
              error={errores.hasta}
              deshabilitado={guardando}
            />
            {hasta ? (
              <Boton titulo="Quitar la hora" variante="secundario" icono="close" onPress={() => setHasta("")} />
            ) : null}
          </View>
        ) : null}

        {estado === "vacaciones" ? (
          <View style={estilos.grupo}>
            {sugeridas ? <Alerta tipo="info" texto={textoVacacionesSugeridas(sugeridas)} /> : null}
            <View style={estilos.filaFechas}>
              <SelectorFecha
                testID="vacaciones-desde"
                etiqueta="Desde"
                obligatorio
                valor={desde}
                onCambio={(v) => {
                  setDesde(v);
                  limpiarError("vacaciones_desde");
                }}
                error={errores.vacaciones_desde}
                deshabilitado={guardando}
              />
              <SelectorFecha
                testID="vacaciones-hasta"
                etiqueta="Hasta"
                obligatorio
                valor={regreso}
                minimo={desde || undefined}
                onCambio={(v) => {
                  setRegreso(v);
                  limpiarError("vacaciones_hasta");
                }}
                error={errores.vacaciones_hasta}
                deshabilitado={guardando}
              />
            </View>
            <Text style={estilos.ayuda}>
              Antes de salir, quien le escriba verá cuándo estará de vacaciones; mientras duren, que está de vacaciones.
            </Text>
            {datos.vacaciones_desde ? (
              <Boton
                testID="quitar-vacaciones"
                titulo="Quitar mis vacaciones"
                icono="delete-outline"
                variante="secundario"
                deshabilitado={guardando}
                onPress={() => guardar({ quitar_vacaciones: true })}
              />
            ) : null}
          </View>
        ) : null}

        {estado === "fuera_oficina" && fueraPorPermiso ? (
          <Alerta
            tipo="info"
            texto={`Tiene un permiso aprobado hasta el ${diaYMes(vigente.hasta)}: mientras dure, quien le escriba verá «Fuera de la oficina».`}
          />
        ) : null}
        {estado === "fuera_oficina" && !porPermiso ? (
          <SelectorFecha
            testID="fuera-regreso"
            etiqueta="Último día fuera de la oficina"
            obligatorio
            valor={regresoFuera}
            minimo={fechaLocal()}
            onCambio={(v) => {
              setRegresoFuera(v);
              limpiarError("hasta");
            }}
            ayuda="Desde el día siguiente vuelve a «Disponible». Quien le escriba verá «Fuera de la oficina hasta el…»."
            error={errores.hasta}
            deshabilitado={guardando}
          />
        ) : null}

        {estado !== "disponible" && !porPermiso ? (
          <View style={estilos.grupo}>
            <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
              Mensaje para quien le escriba (opcional)
            </Text>
            <TextInput
              testID="estado-mensaje"
              value={mensaje}
              onChangeText={setMensaje}
              maxLength={140}
              editable={!guardando}
              placeholder={ausente ? "Para lo urgente, escriba a…" : "Vuelvo pronto"}
              placeholderTextColor={colores.tintaTenue}
              accessibilityLabel="Mensaje para quien le escriba (opcional), hasta 140 caracteres"
              style={estilos.entrada}
            />
          </View>
        ) : null}

        {ausente ? <ReemplazoEnAusencia reemplazo={reemplazo} deshabilitado={guardando} /> : null}

        <View style={estilos.bloque} testID="bloque-almuerzo" {...bloque("almuerzo")}>
          {/* R-02: un encabezado de verdad y, debajo, el botón que abre o
              cierra, con `expanded`. */}
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Mi horario de almuerzo
          </Text>
          <Desplegable
            titulo={almuerzoAbierto ? "Ocultar el horario" : "Ver o cambiar el horario"}
            abierto={almuerzoAbierto}
            onCambiar={setAlmuerzoAbierto}
            testID="almuerzo-plegable"
          >
            <View style={estilos.filaFechas}>
              <SelectorFecha
                testID="almuerzo-inicio"
                etiqueta="Salgo a las"
                modo="time"
                valor={inicio}
                onCambio={setInicio}
                deshabilitado={guardando}
              />
              <View style={estilos.campoMinutos}>
                <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
                  Minutos
                </Text>
                <TextInput
                  ref={refFoco("almuerzo")}
                  testID="almuerzo-minutos"
                  value={minutos}
                  onChangeText={(v) => {
                    setMinutos(v.replace(/\D/g, "").slice(0, 3));
                    limpiarError("almuerzo_minutos");
                  }}
                  keyboardType="number-pad"
                  editable={!guardando}
                  accessibilityLabel={`Minutos de almuerzo, entre ${ALMUERZO_MINIMO} y ${ALMUERZO_MAXIMO}${
                    errores.almuerzo_minutos ? `. Error: ${errores.almuerzo_minutos}` : ""
                  }`}
                  style={[estilos.entrada, errores.almuerzo_minutos && estilos.entradaConError]}
                />
                {errores.almuerzo_minutos ? <Text style={estilos.error}>{errores.almuerzo_minutos}</Text> : null}
              </View>
            </View>
            <Text style={estilos.ayuda}>A esa hora el chat de la web le ofrecerá marcar que salió a almorzar.</Text>
          </Desplegable>
        </View>

        <View style={estilos.acciones}>
          <Boton
            testID="guardar-estado"
            titulo={guardando ? "Guardando…" : estado === "almuerzo" ? "Salgo a almorzar" : "Guardar"}
            icono="content-save-outline"
            cargando={guardando}
            onPress={enviar}
          />
          {/* Sin «Cancelar»: repetía «Volver» de la cabecera (auditoría UX,
              H-16). */}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 14, paddingBottom: 40 },
  grupo: { gap: 6 },
  bloque: {
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
  },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.tinta },
  texto: { fontSize: 15, color: colores.tinta },
  ayuda: { fontSize: 13, color: colores.tintaTenue },
  leyenda: { fontSize: 14, color: colores.tintaSuave },
  opcion: CONTROLES.opcion,
  opcionActiva: CONTROLES.opcionActiva,
  opcionTexto: CONTROLES.opcionTexto,
  filaFechas: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  campoMinutos: { gap: 4, flexGrow: 1, flexBasis: 120 },
  entrada: CONTROLES.entrada,
  entradaConError: CONTROLES.entradaConError,
  error: { fontSize: 14, color: colores.malTexto },
  acciones: { gap: 10 },
});
