import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";

import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { solicitudesService } from "../../api/servicios";
import { tomarResultado } from "../../activos/avisoPendiente";
import { mensajeDeActivos } from "../../activos/formato";
import {
  accionesDeSolicitud,
  confirmacionDelPaso,
  estadoDeSolicitud,
  fechaDePedido,
  PASOS,
  prioridadDe,
  queSePide,
  resultadoDelPaso,
  textoDelAvisoDeSolicitud,
  TEXTO_NOTA_OBLIGATORIA,
  valorDeEspecificacion,
} from "../../activos/solicitudes";
import { Alerta, Boton, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { confirmarDescarte } from "../../componentes/confirmarDescarte";
import { Ventana } from "../../componentes/Ventana";
import { useSesion } from "../../sesion/SesionContext";
import { colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { fechaCorta, fechaYHora } from "../../utils/fechas";
import { CampoTexto } from "../permisos/piezas";
import { Dato, Pildora, Seccion } from "../soporte/piezas";
import { errorDeGuardado, useCandado } from "./formularios";
import { useMontado } from "./piezas";

export const TEXTO_SOLICITUD_NO_DISPONIBLE = "Esta solicitud no existe o no participa en ella.";

const CAMPOS_PASO = { nota: "Nota", estado: "Estado" };

/**
 * Un paso de la solicitud en su ventana (CA-18, CA-20): dice qué va a pasar,
 * pide la nota (obligatoria al rechazar) y confirma. Es la confirmación de
 * cancelar (CA-18). Envía `POST solicitudes/{id}/cambiar-estado/`; un 403 se
 * explica con el mensaje del servidor (CA-2).
 */
function FormularioPaso({ solicitud, estado, empresa, onCerrar, onGuardado }) {
  const paso = PASOS[estado];
  const pregunta = confirmacionDelPaso(estado, solicitud);
  const [nota, setNota] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const montado = useMontado();
  const candado = useCandado();
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);

  async function cerrar() {
    if (guardando) return;
    if (nota.trim() && !(await confirmarDescarte())) return;
    onCerrar();
  }

  async function guardar() {
    if (!candado.tomar()) return;
    if (paso?.exigeNota && !nota.trim()) {
      candado.soltar();
      setErrores({ nota: TEXTO_NOTA_OBLIGATORIA });
      setError({ texto: "Revise el campo: Nota.", clave: Date.now() });
      irA("nota");
      return;
    }
    setErrores({});
    setError(null);
    setGuardando(true);
    try {
      const actualizada = await solicitudesService.cambiarEstado(solicitud.id, { estado, nota: nota.trim() }, { empresa });
      if (!montado.current) return;
      onGuardado(actualizada, resultadoDelPaso(estado), textoDelAvisoDeSolicitud(actualizada?.aviso));
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDeGuardado(e, "No se pudo cambiar el estado de la solicitud.", CAMPOS_PASO);
      setErrores(fallo.campos);
      setError({ texto: fallo.texto, clave: fallo.clave });
      irA(fallo.campos.nota ? "nota" : null);
    } finally {
      candado.soltar();
      if (montado.current) setGuardando(false);
    }
  }

  return (
    <Ventana
      titulo={pregunta.titulo}
      subtitulo={`Solicitud #${solicitud.id}`}
      onCerrar={cerrar}
      ocupada={guardando}
      refDesplazable={desplazable}
      testID="ventana-paso"
    >
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="paso-error" /> : null}
      <Text style={estilos.dato}>{pregunta.texto}</Text>
      {errores.estado ? <Alerta tipo="mal" texto={errores.estado} /> : null}
      <View {...bloque("nota")}>
        <CampoTexto
          testID="paso-nota"
          refFoco={refFoco("nota")}
          etiqueta={paso?.exigeNota ? "Motivo del rechazo" : "Nota"}
          obligatorio={Boolean(paso?.exigeNota)}
          opcional={!paso?.exigeNota}
          ayuda={paso?.exigeNota ? "Le llega a quien pidió como explicación." : "Queda en el recorrido de la solicitud."}
          multilinea
          valor={nota}
          error={errores.nota}
          deshabilitado={guardando}
          onCambio={(v) => {
            setNota(v);
            if (errores.nota) setErrores((x) => ({ ...x, nota: undefined }));
          }}
        />
      </View>
      <Boton
        testID="confirmar-paso"
        titulo={guardando ? "Guardando…" : estado === "cancelada" ? "Sí, cancelar la solicitud" : paso?.texto ?? "Confirmar"}
        icono={paso?.icono ?? "check"}
        variante={estado === "rechazada" || estado === "cancelada" ? "peligro" : "primario"}
        cargando={guardando}
        onPress={guardar}
      />
      <Boton
        testID="volver-paso"
        titulo={estado === "cancelada" ? "No, mantenerla" : "Volver"}
        variante="secundario"
        deshabilitado={guardando}
        onPress={cerrar}
      />
    </Ventana>
  );
}

/**
 * El detalle de una solicitud de equipo (US-022, CA-18 y CA-20), con `GET
 * solicitudes/{id}/`: qué se pidió, con qué características, cantidad,
 * prioridad, fecha, quién la pidió y quién la gestiona, la justificación y el
 * recorrido (`movimientos[]`, con fecha, quién y la nota).
 *
 * Ofrece solo lo que el estado y la persona permiten (`accionesDeSolicitud`):
 * los pasos del encargado (tomarla, comprada, entregada, rechazar con
 * motivo) y cancelar para quien la pidió. Las acciones solo en la empresa
 * activa; `empresa`, la de un aviso (CA-21).
 */
export function DetalleSolicitudDeEquipo({ id, empresa = null }) {
  const { usuario, empresaActiva, versionEmpresa } = useSesion();
  const permisos = usuario?.permissions ?? [];
  const [carga, setCarga] = useState({ estado: "cargando", datos: null, error: null, aviso: null });
  const [refrescando, setRefrescando] = useState(false);
  const [paso, setPaso] = useState(null);
  const [resultado, setResultado] = useState(null);
  const montado = useMontado();
  const consulta = useRef(0);
  const cargaRef = useRef(carga);
  cargaRef.current = carga;

  const cargar = useCallback(
    async ({ silenciosa = false } = {}) => {
      const numero = ++consulta.current;
      if (!silenciosa) setCarga({ estado: "cargando", datos: null, error: null, aviso: null });
      try {
        const datos = await solicitudesService.detalle(id, { empresa: empresa ?? undefined });
        if (!montado.current || numero !== consulta.current) return;
        setCarga({ estado: "listo", datos, error: null, aviso: null });
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        const noEsta = e?.response?.status === 404;
        if (silenciosa && cargaRef.current.estado === "listo" && !noEsta) {
          const aviso = `${mensajeDeActivos(e, "No se pudo actualizar la solicitud.")} Se muestra la última información.`;
          setCarga((c) => ({ ...c, aviso }));
        } else {
          setCarga({
            estado: "error",
            datos: null,
            error: noEsta ? TEXTO_SOLICITUD_NO_DISPONIBLE : mensajeDeActivos(e, "No se pudo abrir la solicitud."),
            aviso: null,
          });
        }
      }
    },
    [id, empresa, montado],
  );

  // Lo que dejó el alta («registrado», a quién no le llegó el correo). En un
  // efecto y no al crear el estado: se toma una sola vez, y en modo estricto
  // el inicializador corre dos veces.
  useEffect(() => {
    const previo = tomarResultado(`solicitud-${id}`);
    if (previo) setResultado({ ...previo, clave: Date.now() });
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  async function refrescar() {
    setRefrescando(true);
    await cargar({ silenciosa: cargaRef.current.estado === "listo" });
    if (montado.current) setRefrescando(false);
  }

  function alMover(actualizada, mensaje, aviso) {
    setPaso(null);
    setResultado({ texto: mensaje, aviso, clave: Date.now() });
    if (actualizada?.id) {
      setCarga({ estado: "listo", datos: actualizada, error: null, aviso: null });
    } else {
      cargar({ silenciosa: true });
    }
  }

  if (carga.estado === "cargando") return <Cargando texto="Cargando la solicitud…" />;
  if (carga.estado === "error") {
    return (
      <View style={estilos.centro}>
        <ErrorConReintento texto={carga.error} onReintentar={() => cargar()} />
      </View>
    );
  }

  const s = carga.datos ?? {};
  const estado = estadoDeSolicitud(s.estado, s.estado_display);
  const prioridad = prioridadDe(s);
  const enLaActiva = !empresa || String(empresa) === String(empresaActiva?.id ?? "");
  const acciones = enLaActiva ? accionesDeSolicitud(s, { usuarioId: usuario?.id, permisos }) : { pasos: [], cancelar: false };
  const especificaciones = Object.entries(s.especificaciones ?? {});
  const movimientos = Array.isArray(s.movimientos) ? s.movimientos : [];

  return (
    <ScrollView
      testID="detalle-solicitud-equipo"
      style={estilos.pantalla}
      contentContainerStyle={estilos.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    >
      {carga.aviso ? <Alerta tipo="aviso" texto={carga.aviso} /> : null}
      {resultado?.texto ? <Alerta tipo="bien" texto={resultado.texto} clave={resultado.clave} testID="resultado-solicitud" /> : null}
      {resultado?.aviso ? <Alerta tipo="aviso" texto={resultado.aviso} testID="aviso-sin-correo" /> : null}

      <View style={estilos.cabecera}>
        <Text style={estilos.numero}>{`Solicitud #${s.id}`}</Text>
        <Text style={estilos.titulo} accessibilityRole="header">
          {queSePide(s)}
        </Text>
        <View style={estilos.pildoras}>
          <Pildora texto={estado.texto} tono={estado} testID="estado-de-la-solicitud" />
          {prioridad ? <Pildora texto={prioridad.texto} tono={prioridad} /> : null}
        </View>
      </View>

      {acciones.pasos.length > 0 || acciones.cancelar ? (
        <View style={estilos.acciones} testID="acciones-de-la-solicitud">
          {acciones.pasos.map((e) => (
            <Boton
              key={e}
              testID={`paso-${e}`}
              titulo={PASOS[e].texto}
              icono={PASOS[e].icono}
              variante={PASOS[e].variante}
              onPress={() => setPaso(e)}
            />
          ))}
          {acciones.cancelar ? (
            <Boton
              testID="paso-cancelada"
              titulo={PASOS.cancelada.texto}
              icono={PASOS.cancelada.icono}
              variante="secundario"
              onPress={() => setPaso("cancelada")}
            />
          ) : null}
        </View>
      ) : null}
      {!enLaActiva ? (
        <Alerta tipo="info" texto="Esta solicitud es de otra empresa. Para moverla, cámbiese a ella en «Cuenta»." />
      ) : null}
      {s.esta_cerrada ? (
        <Alerta tipo="info" texto="Su recorrido terminó y no se reabre. Si vuelve a hacer falta, se pide de nuevo." />
      ) : null}

      <Seccion titulo="Datos de la solicitud" testID="datos-de-la-solicitud">
        <Dato nombre="Qué se pide" valor={s.lo_que_se_pide} />
        <Dato nombre="Clase" valor={s.clase_display} />
        <Dato nombre="Cantidad" valor={s.cantidad === undefined ? null : String(s.cantidad)} />
        <Dato nombre="Se necesita para" valor={s.fecha_necesaria ? fechaCorta(s.fecha_necesaria) : "Sin fecha comprometida"} />
        <Dato nombre="Quién la pidió" valor={s.solicitante_nombre} />
        <Dato nombre="Quién la gestiona" valor={s.encargado_nombre} />
        <Dato nombre="Pedida el" valor={fechaDePedido(s)} />
        <Dato nombre="Para qué hace falta" valor={s.justificacion} />
      </Seccion>

      {especificaciones.length > 0 ? (
        <Seccion titulo="Con qué características" testID="especificaciones">
          {especificaciones.map(([nombre, valor]) => (
            <Dato key={nombre} nombre={nombre} valor={valorDeEspecificacion(valor)} />
          ))}
        </Seccion>
      ) : null}

      <Seccion titulo="Recorrido" testID="recorrido">
        {/* UX H-26: sin pasos registrados también se dice. */}
        {movimientos.length === 0 ? <Vacio icono="history" texto="Sin pasos registrados todavía." /> : null}
        {movimientos.map((m) => (
          <View
            key={m.id}
            style={estilos.movimiento}
            testID={`movimiento-${m.id}`}
            accessible
            accessibilityLabel={[
              m.estado_nuevo_display || m.estado_nuevo,
              fechaYHora(m.created_at),
              m.actor_nombre || "el sistema",
              m.nota,
            ]
              .filter(Boolean)
              .join(". ")}
          >
            <Text style={estilos.movimientoTitulo}>{m.estado_nuevo_display || m.estado_nuevo}</Text>
            <Text style={estilos.tenue}>{`${fechaYHora(m.created_at)} · ${m.actor_nombre || "el sistema"}`}</Text>
            {m.nota ? <Text style={estilos.dato}>{m.nota}</Text> : null}
          </View>
        ))}
      </Seccion>

      {paso ? (
        <FormularioPaso
          solicitud={s}
          estado={paso}
          empresa={empresa ?? undefined}
          onCerrar={() => setPaso(null)}
          onGuardado={alMover}
        />
      ) : null}
    </ScrollView>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, paddingBottom: 40, gap: 16 },
  centro: { padding: 16 },
  cabecera: { gap: 6 },
  numero: { fontSize: 14, fontWeight: "600", color: colores.tintaSuave },
  titulo: { fontSize: 20, fontWeight: "700", color: colores.titulo },
  pildoras: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  acciones: { gap: 8 },
  dato: { fontSize: 15, color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  movimiento: {
    gap: 2,
    paddingLeft: 12,
    paddingVertical: 4,
    borderLeftWidth: 3,
    borderLeftColor: colores.bordeFuerte,
  },
  movimientoTitulo: { fontSize: 15, fontWeight: "700", color: colores.titulo },
});
