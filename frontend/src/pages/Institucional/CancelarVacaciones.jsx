import { useId, useRef, useState } from "react";

import { licenciasService } from "../../api/licenciasService";
import { Campo, enfocarPrimerError } from "../../components/common/Campo/Campo";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import { usePermission } from "../../hooks/usePermission";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";

/*
 * Cancelar vacaciones aprobadas (US-012). Lo común a «Mis vacaciones» y al
 * detalle de la solicitud: el momento, la etiqueta del comentario (Motivo o
 * Justificación), la elección de qué pasa con los días, los textos y la
 * ventana que los junta. Las opciones permitidas (`opciones_devolver`) y los
 * días de cada una (`dias_por_opcion`) los manda el servidor; aquí solo se
 * muestran.
 */

export const MOMENTOS = {
  por_empezar: "Por empezar",
  en_curso: "En curso",
  terminada: "Terminadas",
};

const OPCIONES = ["restantes", "todos", "ninguno"];

export const ERROR_ELEGIR_DIAS = "Elija qué pasa con los días de vacaciones.";
export const AVISO_CAMBIARON =
  "Estas vacaciones cambiaron de estado. Cierre y vuelva a abrir para ver las opciones.";
export const AVISO_YA_CANCELADAS = "Estas vacaciones ya se habían cancelado.";
export const AVISO_SIN_DESHACER =
  "Esta acción no se puede deshacer: para volver a tomarlas habrá que pedirlas de nuevo.";

/** «1 día», «4 días». */
export function dias(n) {
  return `${n} ${n === 1 ? "día" : "días"}`;
}

/** El momento de unas vacaciones frente a hoy (por si el servidor no lo
 * manda). */
export function momentoDe(desde, hasta, hoy = new Date()) {
  const dia = [
    hoy.getFullYear(),
    String(hoy.getMonth() + 1).padStart(2, "0"),
    String(hoy.getDate()).padStart(2, "0"),
  ].join("-");
  if (desde > dia) return "por_empezar";
  if (hasta < dia) return "terminada";
  return "en_curso";
}

/** Antes de empezar se pide un motivo; después, una justificación. */
export function etiquetaDelComentario(momento) {
  return momento === "por_empezar" ? "Motivo" : "Justificación";
}

function conocidas(opciones) {
  return (opciones ?? []).filter((o) => OPCIONES.includes(o));
}

/** Hay que elegir entre varias opciones de días. */
export function hayQueElegir(opciones) {
  return conocidas(opciones).length > 1;
}

/** La opción con que se envía: la única que hay, o la elegida. Sin opciones
 * (antes de empezar) no se envía nada: el servidor devuelve todo. */
export function devolverElegido(opciones, elegida) {
  const lista = conocidas(opciones);
  if (lista.length === 1) return lista[0];
  return elegida || undefined;
}

/** La etiqueta de cada radio, con los días reales de esa opción. */
export function etiquetaDeOpcion(opcion, porOpcion, total, extra = "") {
  const texto = etiquetaBase(opcion, porOpcion, total);
  return opcion === "todos" && extra ? `${texto} ${extra}` : texto;
}

function etiquetaBase(opcion, porOpcion, total) {
  const n = porOpcion?.[opcion];
  if (typeof n !== "number") {
    return {
      restantes: "Devolver los días que faltan (desde hoy)",
      todos: "Devolver todos los días",
      ninguno: "No devolver días",
    }[opcion];
  }
  if (opcion === "restantes") {
    return `Devolver los días que faltan: ${dias(n)} (desde hoy, incluido)`;
  }
  if (opcion === "todos") return `Devolver todos los días: ${dias(n)}`;
  return total === 1
    ? "No devolver días: el día sigue contando como gozado"
    : `No devolver días: los ${total} días siguen contando como gozados`;
}

/** Lo que dice la opción única, que no se elige. */
export function textoDeOpcionUnica(opcion, porOpcion, total) {
  const n = porOpcion?.[opcion];
  if (typeof n !== "number") {
    return {
      restantes: "Se le devolverán los días que faltan (desde hoy).",
      todos: "Se le devolverán todos los días.",
      ninguno: "No se le devolverán días.",
    }[opcion];
  }
  const los = n === 1 ? "el día" : `los ${n} días`;
  if (opcion === "restantes") {
    return `Se le devolverán ${los} que faltan (desde hoy, incluido).`;
  }
  if (opcion === "todos") return `Se le devolverán ${los}.`;
  return total === 1
    ? "No se le devolverá el día: sigue contando como gozado."
    : `No se le devolverán días: los ${total} siguen contando como gozados.`;
}

function listaY(partes) {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** La solicitud ya no admite la acción: el servidor responde con el código
 * `solicitud_cerrada`; si no lo manda, un 400 sin errores de campo y sin
 * `details`. */
export function esSolicitudCerrada(err) {
  const respuesta = err?.response;
  if (respuesta?.data?.error?.code === "solicitud_cerrada") return true;
  return (
    respuesta?.status === 400 &&
    Object.keys(erroresPorCampo(err)).length === 0 &&
    !respuesta?.data?.error?.details
  );
}

/** Con error, el foco va a la justificación o, si el error es de los días,
 * al primer radio. */
function enfocarError(contenedor, errores) {
  if (!contenedor) return;
  if (errores?.devolver && !errores?.comentario) {
    requestAnimationFrame(() =>
      contenedor.querySelector('input[type="radio"]')?.focus(),
    );
    return;
  }
  enfocarPrimerError(contenedor);
}

/** A quién se avisa al cancelar (el backend no avisa a quien cancela). */
export function avisados({ porEmpezar, propia, nombre }) {
  return [
    "a su jefe inmediato",
    ...(propia ? [] : [`a ${nombre || "la persona"}`]),
    ...(porEmpezar ? [] : ["a quienes las aprobaron"]),
  ];
}

/** Lo que se lee antes de cancelar, según el momento y de quién sean. */
export function TextoDeCancelar({
  momento,
  propia,
  nombre,
  porOpcion,
  total,
  opciones,
}) {
  const porEmpezar = momento === "por_empezar";
  const persona = nombre || "la persona";
  const quienes = listaY(avisados({ porEmpezar, propia, nombre: persona }));
  const lista = conocidas(opciones);
  return (
    <div className="mz-small">
      {porEmpezar ? (
        <p className="mb-1">
          {propia
            ? "Cancela sus vacaciones antes de que empiecen. "
            : `Cancela las vacaciones de ${persona} antes de que empiecen. `}
          {typeof porOpcion?.todos === "number"
            ? textoDeOpcionUnica("todos", porOpcion, total)
            : "Se le devolverán todos los días."}{" "}
          Se avisará {quienes}.
        </p>
      ) : (
        <p className="mb-1">
          {propia ? "Sus vacaciones" : `Las vacaciones de ${persona}`}{" "}
          {momento === "terminada" ? "ya terminaron" : "ya empezaron"}. La
          justificación queda en el historial y se avisará {quienes}.
        </p>
      )}
      {!porEmpezar && lista.length === 1 && (
        <p className="mb-1">
          <Icon name="info-circle" />{" "}
          {textoDeOpcionUnica(lista[0], porOpcion, total)}
        </p>
      )}
      <p className="mb-0">{AVISO_SIN_DESHACER}</p>
    </div>
  );
}

/** El mensaje de éxito, calculado con la opción que de verdad se envió. */
export function mensajeDeExito({ vacaciones, devolver, propia, nombre }) {
  const { desde, hasta, momento, dias_por_opcion: porOpcion } = vacaciones;
  const porEmpezar = momento === "por_empezar";
  const clave = porEmpezar ? "todos" : devolver;
  const n = clave ? porOpcion?.[clave] : undefined;
  const de = propia ? "" : ` de ${nombre || "la persona"}`;
  const quienes = listaY(avisados({ porEmpezar, propia, nombre }));
  let devueltos = "";
  if (typeof n === "number") {
    devueltos =
      n > 0 ? ` Se devolvieron ${dias(n)}.` : " No se devolvieron días.";
  }
  return `Se cancelaron las vacaciones${de} del ${formatearFecha(desde)} al ${formatearFecha(hasta)}.${devueltos} Se avisó ${quienes}.`;
}

/** Qué pasa con los días: radios si hay más de una opción; si ninguna, o una
 * sola (que se lee en el texto de arriba), nada. */
export function OpcionesDevolver({
  extraTodos = "",
  opciones,
  valor,
  onCambio,
  error,
  disabled = false,
  diasPorOpcion,
  total,
}) {
  const nombre = useId();
  const lista = conocidas(opciones);
  if (lista.length < 2) return null;
  const idError = error ? `${nombre}-error` : undefined;
  return (
    <fieldset
      className="mz-campo cancelar-devolver"
      role="radiogroup"
      aria-invalid={error ? true : undefined}
      aria-describedby={idError}
      disabled={disabled}
    >
      <legend className="form-label mz-small">
        ¿Qué pasa con los días?
        <span className="mz-campo__obligatorio" aria-hidden="true">
          {" "}
          *
        </span>
        <span className="visually-hidden"> (obligatorio)</span>
      </legend>
      {lista.map((o) => (
        <div key={o} className="form-check">
          <input
            type="radio"
            className="form-check-input"
            id={`${nombre}-${o}`}
            name={nombre}
            value={o}
            checked={valor === o}
            aria-describedby={idError}
            onChange={() => onCambio(o)}
          />
          <label className="form-check-label" htmlFor={`${nombre}-${o}`}>
            {etiquetaDeOpcion(o, diasPorOpcion, total, extraTodos)}
          </label>
        </div>
      ))}
      {error && (
        <div id={idError} className="mz-field-error">
          {error}
        </div>
      )}
    </fieldset>
  );
}

/**
 * La ventana para cancelar unas vacaciones aprobadas.
 * `vacaciones`: { id, desde, hasta, dias, momento, opciones_devolver,
 * dias_por_opcion }. `propia`: las cancela la misma persona; si no, `nombre`
 * es de quien son. `onListo(solicitud, devolver)` al cancelar;
 * `onCerrar({ recargar })` al cerrar (con `recargar` si lo que se veía quedó
 * desactualizado).
 */
export function CancelarVacacionesDialog({
  vacaciones,
  propia = true,
  nombre,
  onCerrar,
  onListo,
}) {
  const {
    id,
    desde,
    hasta,
    momento,
    opciones_devolver: opciones,
    dias_por_opcion: porOpcion,
  } = vacaciones;
  const total = porOpcion?.todos ?? vacaciones.dias;
  const porEmpezar = momento === "por_empezar";
  const idCampo = `${useId()}-comentario`;
  const cuerpo = useRef(null);
  const ocupado = useRef(false);
  const recargar = useRef(false);
  const [comentario, setComentario] = useState("");
  const [elegida, setElegida] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [cerrada, setCerrada] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const hayRadios = !porEmpezar && hayQueElegir(opciones);
  // Solo Gestión Humana puede devolver lo ya gozado: se borran también las
  // ausencias pasadas.
  const esGestion = usePermission("licencias.anular_aprobadas");

  async function enviar(evento) {
    evento.preventDefault();
    if (ocupado.current) return;
    const motivo = comentario.trim();
    const devolver = devolverElegido(opciones, elegida);
    const faltan = {};
    if (!motivo) {
      faltan.comentario = porEmpezar
        ? "Escriba el motivo de la cancelación."
        : "Escriba la justificación: queda en el historial.";
    }
    if (hayRadios && !devolver) faltan.devolver = ERROR_ELEGIR_DIAS;
    setError(null);
    setErrores(faltan);
    if (Object.keys(faltan).length > 0) {
      enfocarError(cuerpo.current, faltan);
      return;
    }
    ocupado.current = true;
    setEnviando(true);
    try {
      const solicitud = await licenciasService.cancelar(id, motivo, devolver);
      onListo(solicitud, devolver);
    } catch (err) {
      const delServidor = erroresPorCampo(err);
      const campos = {};
      if (delServidor.comentario) campos.comentario = delServidor.comentario;
      if (delServidor.devolver) {
        if (hayRadios) {
          campos.devolver = delServidor.devolver;
        } else {
          // No hay radios donde mostrarlo: lo que se veía ya no es cierto.
          recargar.current = true;
          setError(AVISO_CAMBIARON);
        }
      }
      setErrores(campos);
      if (Object.keys(campos).length === 0 && !delServidor.devolver) {
        if (esSolicitudCerrada(err)) {
          recargar.current = true;
          setCerrada(true);
          setError(AVISO_YA_CANCELADAS);
        } else {
          setError(
            mensajeDeError(err, "No se pudieron cancelar las vacaciones."),
          );
        }
      }
      enfocarError(cuerpo.current, campos);
    } finally {
      ocupado.current = false;
      setEnviando(false);
    }
  }

  const persona = propia ? "" : `Vacaciones de ${nombre || "la persona"} · `;

  return (
    <ModalDialog
      titulo="Cancelar vacaciones"
      subtitulo={`${persona}Del ${formatearFecha(desde)} al ${formatearFecha(hasta)} · ${dias(vacaciones.dias)}`}
      onCerrar={() => onCerrar({ recargar: recargar.current })}
      onSubmit={cerrada ? undefined : enviar}
      textoConfirmar="Cancelar vacaciones"
      textoGuardando="Cancelando…"
      textoCancelar={cerrada ? "Cerrar" : "Volver"}
      variante="danger"
      isSaving={enviando}
      sinPreguntarAlDescartar={cerrada}
      noValidate
    >
      <div ref={cuerpo} className="mz-stack">
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        {!cerrada && (
          <>
            <TextoDeCancelar
              momento={momento}
              propia={propia}
              nombre={nombre}
              porOpcion={porOpcion}
              total={total}
              opciones={opciones}
            />
            <Campo
              id={idCampo}
              etiqueta={etiquetaDelComentario(momento)}
              obligatorio
              error={errores.comentario}
            >
              <textarea
                rows={3}
                className="form-control"
                value={comentario}
                maxLength={2000}
                disabled={enviando}
                onChange={(e) => {
                  setComentario(e.target.value);
                  setErrores((a) => ({ ...a, comentario: undefined }));
                }}
              />
            </Campo>
            <OpcionesDevolver
              extraTodos={
                esGestion && !porEmpezar
                  ? "(se borran también las ausencias ya pasadas)"
                  : ""
              }
              opciones={opciones}
              valor={elegida}
              onCambio={(o) => {
                setElegida(o);
                setErrores((a) => ({ ...a, devolver: undefined }));
              }}
              error={errores.devolver}
              disabled={enviando}
              diasPorOpcion={porOpcion}
              total={total}
            />
          </>
        )}
      </div>
    </ModalDialog>
  );
}
