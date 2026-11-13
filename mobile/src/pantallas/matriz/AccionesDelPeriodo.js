import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { erroresPorCampo, mensajeDeError } from "../../api/errores";
import { matrizService } from "../../api/servicios";
import { Alerta, Boton, Cargando, ErrorConReintento } from "../../componentes/comunes";
import { confirmarDescarte } from "../../componentes/confirmarDescarte";
import { OpcionesEnLinea, SelectorDeLista } from "../../componentes/Selectores";
import { SelectorFecha } from "../../componentes/SelectorFecha";
import { Ventana } from "../../componentes/Ventana";
import {
  fechaHoraEnZona,
  horaDeLaZona,
  mensajeDeMatriz,
  MINIMO_MOTIVO,
  PRIORIDADES,
  TEXTO_PUEDE_HABERSE_GUARDADO,
} from "../../matriz/formato";
import { sinRespuestaClara } from "../../soporte/formato";
import { colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { CampoTexto } from "../permisos/piezas";

/**
 * Los tres ajustes rápidos que la app hace en un período (US-019, CA-5), con
 * las mismas llamadas, validaciones y mensajes que la web
 * (`SeguimientoModal.jsx`, `CambiarFechaModal.jsx` y la confirmación de
 * «Reenviar recordatorio» de `PeriodoPanel.jsx`). Cada uno en su ventana.
 *
 * Ronda 1 de QA (13/11/2026):
 * - B-1: mientras guarda o envía, la ventana no se cierra (ni con la X ni con
 *   Atrás); al llegar la respuesta, sea cual sea, se anuncia y el detalle se
 *   relee (`onRespuesta`).
 * - H-02: un candado síncrono (`useRef`) para que un doble toque haga una
 *   sola petición, como en `NuevoTicket.js`.
 * - H-01: cerrar con cambios pide confirmación (`confirmarDescarte`).
 * - H-15: el error de validación nombra los campos y lleva el foco al primero.
 * - Sin respuesta clara del servidor se dice que puede que se haya guardado;
 *   lo escrito se conserva.
 */

export const TEXTO_RESPONSABLE_OBLIGATORIO = "El responsable es obligatorio.";
export const TEXTO_SUPLENTE_DISTINTO = "El suplente tiene que ser otra persona que el responsable.";
export const TEXTO_AVANCE = "El avance va de 0 a 100, sin decimales.";
export const TEXTO_FECHA_OBLIGATORIA = "Elija la nueva fecha.";
export const TEXTO_MOTIVO_CORTO = `Escriba al menos ${MINIMO_MOTIVO} caracteres.`;
export const TEXTO_CONFIRMAR_RECORDATORIO =
  "Se envía ahora un recordatorio al responsable (y al suplente, si la empresa lo pide), aunque ya se haya enviado otro hoy.";
export const TEXTO_CAMBIO_PERMANENTE =
  "Este cambio queda registrado en el historial junto con la fecha anterior y no puede eliminarse.";
export const TEXTO_RECORDATORIO_INCIERTO =
  "No hubo respuesta del servidor: puede que el recordatorio sí se haya enviado. Revise el historial antes de reintentar.";

/** El nombre visible de cada campo, para decir cuáles revisar (H-15). */
export const NOMBRES_DE_CAMPO = {
  responsable: "Responsable",
  suplente: "Suplente",
  supervisor: "Supervisor",
  aprobador: "Aprobador",
  prioridad: "Prioridad",
  avance: "Avance (%)",
  sede: "Sucursal",
  observaciones: "Observaciones",
  due_date: "Nueva fecha",
  due_time: "Hora",
  reason: "Justificación",
};

/** «Revise: Responsable y Avance (%).», en el orden del formulario. */
export function textoRevise(campos, orden) {
  const nombres = orden.filter((c) => campos[c]).map((c) => NOMBRES_DE_CAMPO[c] ?? c);
  if (nombres.length === 0) return "Revise los campos marcados.";
  const unidos = nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
  return `Revise ${nombres.length === 1 ? "el campo" : "los campos"}: ${unidos}.`;
}

function subtituloDe(periodo) {
  return [periodo.codigo, periodo.obligacion?.nombre].filter(Boolean).join(" · ");
}

/** El error de un guardado: el mensaje de arriba y los de cada campo. */
function errorDeGuardado(e, porDefecto, orden) {
  if (sinRespuestaClara(e)) {
    return { texto: TEXTO_PUEDE_HABERSE_GUARDADO, campos: {}, incierto: true, clave: Date.now() };
  }
  const campos = erroresPorCampo(e);
  const propio = e?.response?.data?.error?.message;
  const conCampos = Object.keys(campos).some((c) => orden.includes(c));
  const texto =
    conCampos && (!propio || propio === "Error en la solicitud.")
      ? textoRevise(campos, orden)
      : conCampos
        ? mensajeDeError(e, porDefecto)
        : mensajeDeMatriz(e, porDefecto);
  return { texto, campos, incierto: false, clave: Date.now() };
}

/** H-02: un candado que se cierra antes del primer `await`. */
function useCandado() {
  const cerrado = useRef(false);
  return {
    tomar() {
      if (cerrado.current) return false;
      cerrado.current = true;
      return true;
    },
    soltar() {
      cerrado.current = false;
    },
  };
}

function useMontado() {
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  return montado;
}

// --- Editar seguimiento ---------------------------------------------------------------

function opcionDePersona(p) {
  return { valor: p.id, texto: p.nombre, detalle: p.email || undefined };
}

/** Las personas de la empresa, con las que ya figuran aunque no estén en la
 * lista (una cuenta que dejó la empresa sigue a la vista). */
export function opcionesDePersonas(personas, periodo) {
  const opciones = (Array.isArray(personas) ? personas : []).map(opcionDePersona);
  const vistos = new Set(opciones.map((o) => String(o.valor)));
  for (const campo of ["responsable", "suplente", "supervisor", "aprobador"]) {
    const p = periodo?.[campo];
    if (p?.id && !vistos.has(String(p.id))) {
      vistos.add(String(p.id));
      opciones.push(opcionDePersona(p));
    }
  }
  return opciones;
}

/** Valida como la web y el servidor antes de enviar. `{campo: texto}`. */
export function validarSeguimiento(valores) {
  const errores = {};
  if (!valores.responsable) errores.responsable = TEXTO_RESPONSABLE_OBLIGATORIO;
  if (valores.suplente && String(valores.suplente) === String(valores.responsable)) {
    errores.suplente = TEXTO_SUPLENTE_DISTINTO;
  }
  const avance = String(valores.avance ?? "").trim();
  if (!/^\d{1,3}$/.test(avance) || Number(avance) > 100) errores.avance = TEXTO_AVANCE;
  return errores;
}

const CAMPOS_SEGUIMIENTO = [
  "responsable",
  "suplente",
  "supervisor",
  "aprobador",
  "prioridad",
  "avance",
  "sede",
  "observaciones",
];

function valoresDe(periodo) {
  return {
    responsable: periodo.responsable?.id ?? null,
    suplente: periodo.suplente?.id ?? null,
    supervisor: periodo.supervisor?.id ?? null,
    aprobador: periodo.aprobador?.id ?? null,
    prioridad: periodo.prioridad,
    avance: String(periodo.avance ?? 0),
    observaciones: periodo.observaciones || "",
    sede: periodo.sede?.id ?? null,
  };
}

export function FormularioSeguimiento({ periodo, empresa, onCerrar, onGuardado, onRespuesta }) {
  const [opciones, setOpciones] = useState({ estado: "cargando", personas: [], sedes: [], prioridades: [] });
  const [iniciales] = useState(() => valoresDe(periodo));
  const [valores, setValores] = useState(iniciales);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const montado = useMontado();
  const candado = useCandado();
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  // En un ref: si el detalle se relee mientras la ventana está abierta, no
  // se vuelven a pedir las opciones.
  const periodoRef = useRef(periodo);
  periodoRef.current = periodo;

  // `useOpcionesMatriz` de la web: catálogos y personas, una vez.
  const cargarOpciones = useCallback(async () => {
    setOpciones((o) => ({ ...o, estado: "cargando" }));
    try {
      const [catalogos, personas] = await Promise.all([
        matrizService.catalogos({ empresa }),
        matrizService.personas({ empresa }),
      ]);
      if (!montado.current) return;
      setOpciones({
        estado: "listo",
        personas: opcionesDePersonas(personas, periodoRef.current),
        sedes: (catalogos?.sedes ?? []).map((s) => ({ valor: s.id, texto: s.nombre })),
        prioridades: (catalogos?.prioridades?.length
          ? catalogos.prioridades
          : Object.entries(PRIORIDADES).map(([valor, nombre]) => ({ valor, nombre }))
        ).map((p) => ({ valor: p.valor, texto: p.nombre })),
        error: null,
      });
    } catch (e) {
      if (!montado.current) return;
      setOpciones({
        estado: "error",
        personas: [],
        sedes: [],
        prioridades: [],
        error: mensajeDeMatriz(e, "No se pudieron cargar las personas y las sucursales."),
      });
    }
  }, [empresa, montado]);

  useEffect(() => {
    cargarOpciones();
  }, [cargarOpciones]);

  function fijar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  const conCambios = CAMPOS_SEGUIMIENTO.some((c) => String(valores[c] ?? "") !== String(iniciales[c] ?? ""));

  async function cerrar() {
    if (guardando) return;
    if (conCambios && !(await confirmarDescarte())) return;
    onCerrar();
  }

  function mostrarErrores(campos, texto) {
    setErrores(campos);
    setError({ texto, clave: Date.now() });
    const primero = CAMPOS_SEGUIMIENTO.find((c) => campos[c]);
    if (primero) irA(primero);
  }

  async function guardar() {
    if (!candado.tomar()) return;
    const encontrados = validarSeguimiento(valores);
    if (Object.keys(encontrados).length) {
      candado.soltar();
      mostrarErrores(encontrados, textoRevise(encontrados, CAMPOS_SEGUIMIENTO));
      return;
    }
    setErrores({});
    setError(null);
    setGuardando(true);
    try {
      const actualizado = await matrizService.editarSeguimiento(
        periodo.id,
        { ...valores, avance: Number(valores.avance) },
        { empresa },
      );
      if (!montado.current) return;
      onGuardado(actualizado);
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDeGuardado(e, "No se pudo guardar el seguimiento.", CAMPOS_SEGUIMIENTO);
      mostrarErrores(fallo.campos, fallo.texto);
      onRespuesta?.();
    } finally {
      candado.soltar();
      if (montado.current) setGuardando(false);
    }
  }

  const personaVacia = (obligatorio) => (obligatorio ? "Seleccione…" : "Sin asignar");

  return (
    <Ventana
      titulo="Editar seguimiento"
      subtitulo={subtituloDe(periodo)}
      onCerrar={cerrar}
      ocupada={guardando}
      refDesplazable={desplazable}
      testID="ventana-seguimiento"
    >
      {opciones.estado === "cargando" ? <Cargando texto="Cargando las personas…" /> : null}
      {opciones.estado === "error" ? <ErrorConReintento texto={opciones.error} onReintentar={cargarOpciones} /> : null}
      {opciones.estado === "listo" ? (
        <>
          {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="seguimiento-error" /> : null}
          {[
            ["responsable", "Responsable", true],
            ["suplente", "Suplente", false],
            ["supervisor", "Supervisor", false],
            ["aprobador", "Aprobador", false],
          ].map(([campo, etiqueta, obligatorio]) => (
            <View key={campo} {...bloque(campo)}>
              <SelectorDeLista
                testID={`seguimiento-${campo}`}
                refFoco={refFoco(campo)}
                etiqueta={etiqueta}
                obligatorio={obligatorio}
                opciones={opciones.personas}
                valor={valores[campo]}
                vacio={personaVacia(obligatorio)}
                conVacio={!obligatorio}
                buscable
                error={errores[campo]}
                deshabilitado={guardando}
                onCambio={(v) => fijar(campo, v === "" ? null : v)}
              />
            </View>
          ))}
          <View {...bloque("prioridad")}>
            <OpcionesEnLinea
              testID="seguimiento-prioridad"
              refFoco={refFoco("prioridad")}
              etiqueta="Prioridad"
              opciones={opciones.prioridades}
              valor={valores.prioridad}
              error={errores.prioridad}
              deshabilitado={guardando}
              onCambio={(v) => fijar("prioridad", v)}
            />
          </View>
          <View {...bloque("avance")}>
            <CampoTexto
              testID="seguimiento-avance"
              refFoco={refFoco("avance")}
              etiqueta="Avance (%)"
              ayuda="De 0 a 100."
              teclado="number-pad"
              maximo={3}
              valor={valores.avance}
              error={errores.avance}
              deshabilitado={guardando}
              onCambio={(v) => fijar("avance", v.replace(/\D/g, ""))}
            />
          </View>
          <View {...bloque("sede")}>
            <SelectorDeLista
              testID="seguimiento-sede"
              refFoco={refFoco("sede")}
              etiqueta="Sucursal"
              opciones={opciones.sedes}
              valor={valores.sede}
              vacio="Sin sucursal"
              conVacio
              buscable
              error={errores.sede}
              deshabilitado={guardando}
              onCambio={(v) => fijar("sede", v === "" ? null : v)}
            />
          </View>
          <View {...bloque("observaciones")}>
            {/* O-2: sin límite de largo, como el servidor. */}
            <CampoTexto
              testID="seguimiento-observaciones"
              refFoco={refFoco("observaciones")}
              etiqueta="Observaciones"
              opcional
              multilinea
              valor={valores.observaciones}
              error={errores.observaciones}
              deshabilitado={guardando}
              onCambio={(v) => fijar("observaciones", v)}
            />
          </View>
          <Boton
            testID="guardar-seguimiento"
            titulo={guardando ? "Guardando…" : "Guardar"}
            icono="check"
            cargando={guardando}
            onPress={guardar}
          />
        </>
      ) : null}
      <Boton
        testID="cancelar-seguimiento"
        titulo="Cancelar"
        variante="secundario"
        deshabilitado={guardando}
        onPress={cerrar}
      />
    </Ventana>
  );
}

// --- Cambiar fecha --------------------------------------------------------------------

const CAMPOS_FECHA = ["due_date", "due_time", "reason"];
const HORA_POR_DEFECTO = "17:00";

export function validarFecha({ fecha, motivo }) {
  const errores = {};
  if (!fecha) errores.due_date = TEXTO_FECHA_OBLIGATORIA;
  if ((motivo ?? "").trim().length < MINIMO_MOTIVO) errores.reason = TEXTO_MOTIVO_CORTO;
  return errores;
}

export function FormularioFecha({ periodo, empresa, onCerrar, onGuardado, onRespuesta }) {
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState(HORA_POR_DEFECTO);
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const montado = useMontado();
  const candado = useCandado();
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const zona = periodo.empresa?.zona_horaria;
  const enLaHora = horaDeLaZona(zona);
  const conCambios = Boolean(fecha) || hora !== HORA_POR_DEFECTO || motivo.trim().length > 0;

  async function cerrar() {
    if (guardando) return;
    if (conCambios && !(await confirmarDescarte())) return;
    onCerrar();
  }

  function mostrarErrores(campos, texto) {
    setErrores(campos);
    setError({ texto, clave: Date.now() });
    const primero = CAMPOS_FECHA.find((c) => campos[c]);
    if (primero) irA(primero);
  }

  async function guardar() {
    if (!candado.tomar()) return;
    const encontrados = validarFecha({ fecha, motivo });
    if (Object.keys(encontrados).length) {
      candado.soltar();
      mostrarErrores(encontrados, textoRevise(encontrados, CAMPOS_FECHA));
      return;
    }
    setErrores({});
    setError(null);
    setGuardando(true);
    try {
      const actualizado = await matrizService.cambiarVencimiento(
        periodo.id,
        { due_date: fecha, due_time: hora || null, reason: motivo.trim() },
        { empresa },
      );
      if (!montado.current) return;
      onGuardado(actualizado);
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDeGuardado(e, "No se pudo cambiar la fecha.", CAMPOS_FECHA);
      mostrarErrores(fallo.campos, fallo.texto);
      onRespuesta?.();
    } finally {
      candado.soltar();
      if (montado.current) setGuardando(false);
    }
  }

  const largo = motivo.trim().length;
  return (
    <Ventana
      titulo="Cambiar fecha de vencimiento"
      subtitulo={subtituloDe(periodo)}
      onCerrar={cerrar}
      ocupada={guardando}
      refDesplazable={desplazable}
      testID="ventana-fecha"
    >
      <Alerta tipo="aviso" texto={TEXTO_CAMBIO_PERMANENTE} />
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="fecha-error" /> : null}
      <View accessible accessibilityLabel={`Vencimiento actual: ${fechaHoraEnZona(periodo.vence_en, zona)}`}>
        <Text style={estilos.etiqueta}>Vencimiento actual</Text>
        <Text style={estilos.valor}>{fechaHoraEnZona(periodo.vence_en, zona)}</Text>
      </View>
      <View style={estilos.fila}>
        <View style={estilos.campoFecha} {...bloque("due_date")}>
          <SelectorFecha
            testID="nueva-fecha"
            refFoco={refFoco("due_date")}
            etiqueta="Nueva fecha"
            obligatorio
            valor={fecha}
            minimo={periodo.fecha_inicio || undefined}
            error={errores.due_date}
            deshabilitado={guardando}
            onCambio={(v) => {
              setFecha(v);
              if (errores.due_date) setErrores((e) => ({ ...e, due_date: undefined }));
            }}
          />
        </View>
        <View style={estilos.campoFecha} {...bloque("due_time")}>
          <SelectorFecha
            testID="nueva-hora"
            refFoco={refFoco("due_time")}
            etiqueta="Hora"
            modo="time"
            valor={hora}
            error={errores.due_time}
            deshabilitado={guardando}
            onCambio={setHora}
          />
        </View>
      </View>
      {enLaHora ? <Text style={estilos.tenue}>{`En ${enLaHora}.`}</Text> : null}
      <View {...bloque("reason")}>
        {/* O-2: sin límite de largo, como el servidor. */}
        <CampoTexto
          testID="justificacion"
          refFoco={refFoco("reason")}
          etiqueta="Justificación"
          obligatorio
          multilinea
          ayuda={`Al menos ${MINIMO_MOTIVO} caracteres.${largo > 0 && largo < MINIMO_MOTIVO ? ` Lleva ${largo}.` : ""}`}
          valor={motivo}
          error={errores.reason}
          deshabilitado={guardando}
          onCambio={(v) => {
            setMotivo(v);
            if (errores.reason && v.trim().length >= MINIMO_MOTIVO) setErrores((e) => ({ ...e, reason: undefined }));
          }}
        />
      </View>
      <Boton
        testID="guardar-fecha"
        titulo={guardando ? "Guardando…" : "Cambiar fecha"}
        icono="calendar-edit"
        cargando={guardando}
        onPress={guardar}
      />
      <Boton
        testID="cancelar-fecha"
        titulo="Cancelar"
        variante="secundario"
        deshabilitado={guardando}
        onPress={cerrar}
      />
    </Ventana>
  );
}

// --- Reenviar recordatorio ------------------------------------------------------------

export function ConfirmarRecordatorio({ periodo, empresa, onCerrar, onEnviado, onRespuesta }) {
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const montado = useMontado();
  const candado = useCandado();

  async function enviar() {
    if (!candado.tomar()) return;
    setError(null);
    setEnviando(true);
    try {
      await matrizService.enviarRecordatorio(periodo.id, { empresa });
      if (!montado.current) return;
      onEnviado();
    } catch (e) {
      if (!montado.current) return;
      const texto = sinRespuestaClara(e)
        ? TEXTO_RECORDATORIO_INCIERTO
        : mensajeDeMatriz(e, "No se pudo completar la acción.");
      setError({ texto, clave: Date.now() });
      anunciar(texto);
      onRespuesta?.();
    } finally {
      candado.soltar();
      if (montado.current) setEnviando(false);
    }
  }

  return (
    <Ventana
      titulo="Reenviar recordatorio"
      subtitulo={subtituloDe(periodo)}
      onCerrar={onCerrar}
      ocupada={enviando}
      testID="ventana-recordatorio"
    >
      <Text style={estilos.texto}>{TEXTO_CONFIRMAR_RECORDATORIO}</Text>
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="recordatorio-error" /> : null}
      <Boton
        testID="enviar-recordatorio"
        titulo={enviando ? "Enviando…" : "Enviar recordatorio"}
        icono="send-outline"
        cargando={enviando}
        onPress={enviar}
      />
      <Boton
        testID="cancelar-recordatorio"
        titulo="Cancelar"
        variante="secundario"
        onPress={onCerrar}
        deshabilitado={enviando}
      />
    </Ventana>
  );
}

const estilos = crearEstilos({
  etiqueta: { fontSize: 13, color: colores.tintaSuave },
  valor: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  texto: { fontSize: 15, color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  campoFecha: { flexGrow: 1, flexBasis: 140 },
});
