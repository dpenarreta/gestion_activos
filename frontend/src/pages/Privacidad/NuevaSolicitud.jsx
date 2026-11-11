/*
 * «Nueva solicitud» del titular: qué derecho ejerce (con lo que significa
 * cada uno) y la descripción, obligatoria en la corrección (sin decir qué
 * dato y por qué, no hay qué corregir). Se valida aquí para avisar antes de
 * enviar; el servidor lo vuelve a validar y su motivo va bajo el campo.
 *
 * Mientras se envía, la ventana queda `bloqueada`: ni Escape ni la X la
 * cierran a medio camino (se perdería saber si la solicitud llegó).
 */
import { useEffect, useId, useRef, useState } from "react";

import {
  errorDePrivacidad,
  privacidadService,
} from "../../api/privacidadService";
import {
  Campo,
  LeyendaObligatorios,
} from "../../components/common/Campo/Campo";
import { Icon } from "../../components/common/Icon/Icon";
import { Ventana } from "../GestionHumana/Tareas/Ventanas";
import { ExplicacionDeTipo } from "./Piezas";
import { DESCRIPCION_MAX, TIPOS } from "./privacidadComunes";

const ORDEN = ["tipo", "descripcion"];

/** La ayuda de la descripción, según lo que se pide. */
const AYUDA = {
  ACCESO:
    "Opcional. Si busca algo en particular, cuéntelo aquí. Para una copia de sus datos no hace falta esta solicitud: use «Descargar mis datos».",
  RECTIFICACION:
    "Diga qué dato está mal, dónde lo vio y cuál es el correcto. Si es su teléfono, área o agencia, puede corregirlo usted mismo en la pestaña Mis datos.",
  ELIMINACION:
    "Opcional. Diga qué datos quiere que se borren y, si quiere, por qué.",
};

/** Lleva el foco a un campo y lo centra: el pie fijo de la ventana no lo
 * tapa. jsdom no implementa `scrollIntoView`. */
function enfocarYCentrar(elemento) {
  if (!elemento) return;
  elemento.focus();
  if (typeof elemento.scrollIntoView === "function")
    elemento.scrollIntoView({ block: "center" });
}

/**
 * @param {string} [tipoInicial] el tipo ya elegido (desde las tarjetas de
 *   «Sus derechos»); la persona puede cambiarlo.
 */
export function NuevaSolicitud({
  plazoDias,
  tipoInicial = "",
  onCerrar,
  onEnviada,
}) {
  const base = useId();
  const ids = {
    tipo: `${base}-tipo`,
    descripcion: `${base}-descripcion`,
    formulario: `${base}-formulario`,
  };
  const inicialValido = TIPOS.some((t) => t.id === tipoInicial);
  const [tipo, setTipo] = useState(inicialValido ? tipoInicial : "");
  const [descripcion, setDescripcion] = useState("");
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const primerTipo = useRef(null);
  const alertaRef = useRef(null);

  // Un fallo sin campo se lee al instante: el foco va a la alerta.
  useEffect(() => {
    if (errorGeneral) alertaRef.current?.focus();
  }, [errorGeneral]);

  const obligatoria = tipo === "RECTIFICACION";

  function quitarError(campo) {
    setErrores((e) => {
      const resto = { ...e };
      delete resto[campo];
      return resto;
    });
  }

  function validar() {
    const e = {};
    if (!tipo) e.tipo = "Elija qué quiere pedir.";
    if (obligatoria && !descripcion.trim())
      e.descripcion = "Describa qué dato quiere corregir y por qué.";
    if (descripcion.length > DESCRIPCION_MAX)
      e.descripcion = `La descripción admite hasta ${DESCRIPCION_MAX} caracteres.`;
    return e;
  }

  function enfocar(campos) {
    const primero = ORDEN.find((c) => campos[c]);
    if (primero === "tipo") {
      // El grupo de opciones: el foco va a la marcada o a la primera.
      const marcada = document.querySelector(
        `input[name="${ids.tipo}"]:checked`,
      );
      enfocarYCentrar(marcada ?? primerTipo.current);
    } else if (primero) {
      enfocarYCentrar(document.getElementById(ids[primero]));
    }
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const locales = validar();
    if (Object.keys(locales).length) {
      setErrores(locales);
      setErrorGeneral(null);
      enfocar(locales);
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    try {
      const resultado = await privacidadService.crearSolicitud({
        tipo,
        descripcion: descripcion.trim(),
      });
      onEnviada(resultado);
    } catch (err) {
      const e = errorDePrivacidad(err, "No se pudo enviar su solicitud.");
      if (Object.keys(e.campos).length) {
        setErrores(e.campos);
        enfocar(e.campos);
        // El mensaje ya está bajo su campo: arriba no se repite.
        if (!ORDEN.some((c) => e.campos[c])) setErrorGeneral(e.mensaje);
      } else {
        setErrorGeneral(e.mensaje);
      }
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <Ventana
      titulo="Nueva solicitud sobre sus datos"
      subtitulo={`La empresa debe responderle en un plazo de ${plazoDias} días. Verá la respuesta aquí, en su perfil, y le llegará un aviso.`}
      onCerrar={onCerrar}
      bloqueada={enviando}
      pie={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onCerrar}
            disabled={enviando}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form={ids.formulario}
            className="btn btn-primary pv-boton-envio"
            // No se deshabilita mientras se envía: el foco no debe caer en
            // <body>; el envío doble lo frena `enCurso`.
            aria-disabled={enviando ? "true" : undefined}
          >
            {enviando ? (
              <>
                <span
                  className="spinner-border spinner-border-sm"
                  aria-hidden="true"
                />{" "}
                Enviando…
              </>
            ) : (
              <>
                <Icon name="send" /> Enviar solicitud
              </>
            )}
          </button>
        </>
      }
    >
      <form
        id={ids.formulario}
        className="pv-formulario"
        onSubmit={enviar}
        noValidate
        aria-busy={enviando}
      >
        <LeyendaObligatorios />
        {errorGeneral && (
          <div
            ref={alertaRef}
            tabIndex={-1}
            className="mz-alert mz-alert--bad pv-alerta"
            role="alert"
          >
            <Icon name="x-octagon" />
            <span>{errorGeneral}</span>
          </div>
        )}
        <fieldset
          className="pv-grupo"
          aria-describedby={errores.tipo ? `${ids.tipo}-error` : undefined}
          aria-invalid={errores.tipo ? true : undefined}
        >
          <legend className="pv-grupo__titulo">
            ¿Qué quiere pedir?
            <span className="mz-campo__obligatorio" aria-hidden="true">
              {" "}
              *
            </span>
            <span className="visually-hidden"> (obligatorio)</span>
          </legend>
          <div className="pv-tipos">
            {TIPOS.map((t, i) => {
              const idOpcion = `${ids.tipo}-${t.id}`;
              // Al abrir, el foco va al tipo ya elegido o al primero.
              const autofocus = inicialValido ? t.id === tipoInicial : i === 0;
              return (
                // La tarjeta entera elige el tipo; el nombre accesible es
                // solo el del tipo y la explicación va como descripción.
                <div
                  key={t.id}
                  className={`pv-tipo${tipo === t.id ? " pv-tipo--elegido" : ""}`}
                >
                  <input
                    ref={i === 0 ? primerTipo : undefined}
                    id={idOpcion}
                    type="radio"
                    className="form-check-input"
                    name={ids.tipo}
                    value={t.id}
                    checked={tipo === t.id}
                    aria-describedby={[
                      `${idOpcion}-explicacion`,
                      errores.tipo ? `${ids.tipo}-error` : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-autofocus={autofocus ? true : undefined}
                    onChange={() => {
                      setTipo(t.id);
                      quitarError("tipo");
                      quitarError("descripcion");
                    }}
                  />
                  <div className="pv-tipo__texto">
                    <label htmlFor={idOpcion} className="pv-tipo__nombre">
                      <Icon name={t.icono} /> {t.texto}
                    </label>
                    <span
                      id={`${idOpcion}-explicacion`}
                      className="pv-tipo__explicacion"
                    >
                      <ExplicacionDeTipo tipo={t} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {errores.tipo && (
            <p id={`${ids.tipo}-error`} className="mz-field-error mb-0">
              {errores.tipo}
            </p>
          )}
        </fieldset>

        {tipo === "ELIMINACION" && (
          <div className="mz-alert mz-alert--info mb-0">
            <Icon name="info-circle" />
            <span>
              Nada se borra automáticamente: el equipo que atiende estas
              solicitudes revisa cada pedido y hace la eliminación a mano.
              Algunos datos se conservan porque la ley obliga a guardarlos (por
              ejemplo, el rol de pagos y los registros de auditoría). En la
              respuesta le diremos qué se borró, qué no y por qué.
            </span>
          </div>
        )}

        <Campo
          id={ids.descripcion}
          etiqueta={obligatoria ? "Descripción" : "Descripción (opcional)"}
          obligatorio={obligatoria}
          error={errores.descripcion}
          ayuda={`${AYUDA[tipo] ?? "Cuéntenos lo que necesita."} ${descripcion.length} de ${DESCRIPCION_MAX} caracteres.`}
        >
          <textarea
            className="form-control"
            rows={5}
            value={descripcion}
            maxLength={DESCRIPCION_MAX}
            onChange={(e) => {
              setDescripcion(e.target.value);
              quitarError("descripcion");
            }}
          />
        </Campo>
      </form>
    </Ventana>
  );
}
