import { useCallback, useEffect, useId, useState } from "react";

import { chatService } from "../../../api/chatService";
import { reemplazoService } from "../../../api/reemplazoService";
import { SelectorDePersonas } from "../../../pages/GestionHumana/SelectorDePersonas";
import { erroresPorCampo, mensajeDeError } from "../../../utils/errores";
import { Icon } from "../Icon/Icon";
import "./EtiquetaAusencia.css";

/*
 * «¿Quién aprueba por usted mientras no está?» (11/11/2026, US-001).
 *
 * Su jefe inmediato (lo de siempre) u otra persona de la empresa, que se
 * busca por nombre con el selector de personas de siempre y el directorio
 * del chat (que ya deja fuera a quien entra: nadie se elige a sí mismo; el
 * servidor también lo rechaza).
 *
 * Se usa en dos sitios, «Mi estado» del chat y la nueva solicitud de
 * permiso, y en los dos se guarda con el botón del formulario que lo
 * contiene, antes de lo demás: el estado de chat reasigna lo pendiente al
 * guardarse y tiene que encontrar ya la elección hecha. Por eso el estado
 * vive en `useReemplazoEnAusencia` y el formulario llama a `guardar()`.
 */

/** El aviso general cuando no se pudo guardar el reemplazo. */
export const MENSAJE_DE_FALLO = "No se pudo guardar quién aprueba por usted.";

/**
 * Los textos del bloque. Por omisión, la persona habla de sí misma («Mi
 * estado», su solicitud). En la ficha del usuario (US-018) lo configura un
 * administrador por otra persona: `TEXTOS_POR_OTRA`.
 */
export const TEXTOS_PROPIOS = {
  encabezado: "Mientras usted no está",
  pregunta: "¿Quién aprueba por usted?",
  ayuda:
    "Si a usted le toca aprobar solicitudes, mientras esté ausente pasan a esta persona. Esta elección se guarda para todas sus ausencias.",
  jefe: "Mi jefe inmediato",
  sinJefe:
    "Usted no tiene un jefe inmediato registrado: sus aprobaciones se quedarán con usted. Si alguien debe aprobar por usted, elija «Otra persona».",
  leyendaPersona: "Persona que aprobará por usted",
  elijaPersona: "Elija a la persona que aprobará por usted.",
  cargando: "Cargando quién aprueba por usted…",
  errorCarga: "No se pudo cargar quién aprueba por usted.",
  fallo: MENSAJE_DE_FALLO,
};

export const TEXTOS_POR_OTRA = {
  encabezado: "Mientras no está",
  pregunta: "¿Quién aprueba por esta persona?",
  ayuda:
    "Si a esta persona le toca aprobar solicitudes, mientras esté ausente pasan a quien se elija aquí. Vale para todas sus ausencias en esta empresa y es la misma elección que ella ve en «Mi estado».",
  jefe: "Su jefe inmediato",
  sinJefe:
    "No tiene un jefe inmediato registrado: sus aprobaciones se quedarán con ella. Si alguien debe aprobar por ella, elija «Otra persona».",
  leyendaPersona: "Persona que aprobará por ella",
  elijaPersona: "Elija a la persona que aprobará por ella.",
  cargando: "Cargando quién aprueba por esta persona…",
  errorCarga: "No se pudo cargar quién aprueba por esta persona.",
  fallo: "No se pudo guardar quién aprueba por esta persona.",
};

/** Lo que se añade al error de una solicitud o de un estado que falló
 * después de guardar el reemplazo: la elección sí quedó. */
export const YA_QUEDO_GUARDADO =
  "Su elección de quién aprueba por usted sí quedó guardada.";

/** Lo que viene del directorio del chat, con los nombres que espera el
 * selector de personas. */
function aPersona(p) {
  return { id: p.id, full_name: p.nombre, role_label: p.cargo || "" };
}

function buscarPersonas(texto) {
  return chatService.directorio(texto).then((lista) => lista.map(aPersona));
}

/**
 * El estado del reemplazo: lo cargado, lo elegido y el error del campo.
 * `activo` en falso no pide nada (el bloque no se ve).
 *
 * `guardar()` devuelve `{ok, guardado, mensaje}`:
 * - `ok`: quedó guardado o no había nada que guardar.
 * - `guardado`: se guardó algo ahora. Si después falla lo demás, hay que
 *   decir que esto sí quedó.
 * - `mensaje`: si falló, lo que va en el aviso general del formulario. Un
 *   error de validación (`persona_id`, `modo`) va además junto al campo; uno
 *   de red o del servidor, solo en el aviso general (revisión UX/UI de
 *   US-001, 11/11/2026).
 */
export function useReemplazoEnAusencia({
  activo = true,
  servicio = reemplazoService,
  textos = TEXTOS_PROPIOS,
} = {}) {
  const [datos, setDatos] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [modo, setModoElegido] = useState("jefe");
  const [persona, setPersonaElegida] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => {
    setErrorCarga(null);
    Promise.resolve()
      .then(() => servicio.obtener())
      .then((d) => {
        setDatos(d);
        setModoElegido(d?.modo === "persona" ? "persona" : "jefe");
        setPersonaElegida(d?.persona ?? null);
      })
      .catch((err) => setErrorCarga(mensajeDeError(err, textos.errorCarga)));
  }, [servicio, textos]);

  useEffect(() => {
    if (activo && !datos) cargar();
    // Solo al mostrarse por primera vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo]);

  const setModo = (nuevo) => {
    setModoElegido(nuevo);
    setError(null);
  };
  const setPersona = (nueva) => {
    setPersonaElegida(nueva);
    setError(null);
  };

  const cambiado =
    Boolean(datos) &&
    (modo !== datos.modo ||
      (modo === "persona" && persona?.id !== datos.persona?.id));

  /** Lo que se sabe sin ir al servidor: con «Otra persona», hay que elegirla. */
  function validar() {
    if (datos && modo === "persona" && !persona) {
      const mensaje = textos.elijaPersona;
      setError(mensaje);
      return mensaje;
    }
    return null;
  }

  async function guardar() {
    const fallo = (mensaje) => ({ ok: false, guardado: false, mensaje });
    // Sin datos (aún cargando o falló la carga) no hay elección que guardar:
    // queda la que ya tenía.
    if (!activo || !datos) return { ok: true, guardado: false };
    if (validar()) return fallo(textos.fallo);
    if (!cambiado) return { ok: true, guardado: false };
    setGuardando(true);
    setError(null);
    try {
      const guardado = await servicio.guardar(
        modo === "persona" ? { modo, persona_id: persona.id } : { modo },
      );
      setDatos(guardado);
      return { ok: true, guardado: true };
    } catch (err) {
      const campos = erroresPorCampo(err);
      const delCampo = campos.persona_id || campos.modo;
      if (delCampo) {
        setError(delCampo);
        return fallo(textos.fallo);
      }
      return fallo(mensajeDeError(err, textos.fallo));
    } finally {
      setGuardando(false);
    }
  }

  return {
    datos,
    errorCarga,
    cargar,
    modo,
    setModo,
    persona,
    setPersona,
    error,
    guardando,
    cambiado,
    validar,
    guardar,
    textos,
  };
}

/** El bloque «Mientras usted no está»: la pregunta, con sus dos respuestas
 * y el buscador si es «Otra persona». `reemplazo` es lo que devuelve
 * `useReemplazoEnAusencia`. Va separado del resto del formulario y con su
 * encabezado: no es un dato de la solicitud ni del estado, sino una elección
 * que vale para todas sus ausencias (revisión UX/UI, 11/11/2026). */
export function ReemplazoEnAusencia({ reemplazo, deshabilitado = false }) {
  const base = useId();
  const idTitulo = `${base}-titulo`;
  // `encabezado: null` lo quita: la tarjeta que lo contiene ya tiene título
  // (la ficha del usuario, US-018).
  const encabezado = reemplazo.textos
    ? reemplazo.textos.encabezado
    : TEXTOS_PROPIOS.encabezado;
  return (
    <section
      className="reemplazo-ausencia__bloque"
      aria-labelledby={encabezado ? idTitulo : undefined}
    >
      {encabezado && (
        <h4 id={idTitulo} className="reemplazo-ausencia__encabezado">
          {encabezado}
        </h4>
      )}
      <Pregunta
        base={base}
        reemplazo={reemplazo}
        deshabilitado={deshabilitado}
      />
    </section>
  );
}

function Pregunta({ base, reemplazo, deshabilitado }) {
  const idAyuda = `${base}-ayuda`;
  const idError = `${base}-error`;
  const idBuscador = `${base}-buscador`;
  const {
    datos,
    errorCarga,
    cargar,
    modo,
    setModo,
    persona,
    setPersona,
    error,
    guardando,
  } = reemplazo;
  const textos = reemplazo.textos ?? TEXTOS_PROPIOS;
  const bloqueado = deshabilitado || guardando;

  if (errorCarga) {
    return (
      <div className="mz-alert mz-alert--bad" role="alert">
        <Icon name="x-octagon" />
        <span className="flex-grow-1">{errorCarga}</span>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={cargar}
        >
          Reintentar
        </button>
      </div>
    );
  }
  if (!datos) {
    return (
      <p className="mz-small mz-faint mb-0" aria-busy="true">
        {textos.cargando}
      </p>
    );
  }

  const jefe = datos.jefe;
  // El error de «Otra persona» va en el buscador; uno de `modo`, aquí,
  // enlazado por `aria-describedby`. La alerta (y el foco) es el aviso
  // general del formulario: dos `role="alert"` se anunciarían dos veces.
  const errorDelGrupo = modo === "persona" ? null : error;
  return (
    <fieldset
      className="reemplazo-ausencia"
      aria-describedby={
        [idAyuda, errorDelGrupo && idError].filter(Boolean).join(" ") ||
        undefined
      }
    >
      <legend className="reemplazo-ausencia__titulo">{textos.pregunta}</legend>
      <p id={idAyuda} className="form-text mt-0">
        {textos.ayuda}
      </p>
      <div className="reemplazo-ausencia__opciones">
        <label className="reemplazo-ausencia__opcion">
          <input
            type="radio"
            className="form-check-input"
            name={`${base}-modo`}
            checked={modo === "jefe"}
            disabled={bloqueado}
            onChange={() => setModo("jefe")}
          />
          <span>{jefe ? `${textos.jefe} (${jefe.nombre})` : textos.jefe}</span>
        </label>
        <label className="reemplazo-ausencia__opcion">
          <input
            type="radio"
            className="form-check-input"
            name={`${base}-modo`}
            checked={modo === "persona"}
            disabled={bloqueado}
            onChange={() => setModo("persona")}
          />
          <span>Otra persona</span>
        </label>
      </div>
      {!jefe && modo === "jefe" && (
        <p className="reemplazo-ausencia__aviso mb-0">
          <Icon name="exclamation-triangle" /> {textos.sinJefe}
        </p>
      )}
      {errorDelGrupo && (
        <p id={idError} className="mz-field-error mb-0">
          {errorDelGrupo}
        </p>
      )}
      {modo === "persona" && (
        <div className="mt-2">
          <SelectorDePersonas
            id={idBuscador}
            leyenda={textos.leyendaPersona}
            etiquetaBuscador="Buscar por nombre"
            obligatorio
            multiple={false}
            elegidos={
              persona ? [{ id: persona.id, full_name: persona.nombre }] : []
            }
            onCambio={(lista) =>
              setPersona(
                lista[0]
                  ? { id: lista[0].id, nombre: lista[0].full_name }
                  : null,
              )
            }
            buscar={buscarPersonas}
            error={error}
            deshabilitado={bloqueado}
            textoNadie="No hay personas para elegir."
          />
        </div>
      )}
    </fieldset>
  );
}
