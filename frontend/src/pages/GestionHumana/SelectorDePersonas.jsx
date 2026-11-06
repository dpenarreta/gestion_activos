/*
 * Elegir personas con un buscador y una lista (los invitados de una reunión,
 * el destinatario de una nota del Escritorio). Lo elegido se muestra arriba
 * con «Quitar»; debajo, el buscador y los resultados, con casillas (varias
 * personas) o radios (una sola). El número de resultados se anuncia en una
 * región viva siempre montada.
 *
 * El buscador nunca se deshabilita mientras cargan los resultados: es el
 * control que recibe el foco al abrir la ventana (auditoría UX/UI,
 * 06/11/2026: un `select` deshabilitado dejaba el foco fuera).
 *
 * `buscar(texto)` devuelve una promesa con la lista: puede pedir al servidor
 * (`reuniones/invitables/?q=`) o filtrar una lista ya cargada.
 */
import { useEffect, useState } from "react";

import { Icon } from "../../components/common/Icon/Icon";

export const nombreDePersona = (persona) =>
  persona ? persona.full_name || persona.name || `#${persona.id}` : "—";

/** Filtra una lista por nombre o usuario, sin tildes ni mayúsculas. */
export function coincide(persona, texto) {
  const normal = (v) =>
    String(v ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  const buscado = normal(texto).trim();
  if (!buscado) return true;
  return [persona.full_name, persona.name, persona.username].some((v) =>
    normal(v).includes(buscado),
  );
}

export function SelectorDePersonas({
  id,
  leyenda,
  etiquetaBuscador,
  obligatorio = false,
  multiple = true,
  maximo = Infinity,
  elegidos,
  onCambio,
  buscar,
  error,
  deshabilitado = false,
  autofoco = false,
  textoNadie = "No hay personas para elegir.",
  textoSinElegir,
  textoElegidos,
  mensajeDeError = "No se pudo cargar la lista de personas.",
}) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState(null);
  const [errorBusqueda, setErrorBusqueda] = useState(null);
  const [vez, setVez] = useState(0);
  const idGrupo = `${id}-grupo`;
  const idError = `${id}-error`;
  const idAyuda = `${id}-ayuda`;
  const idLista = `${id}-lista`;
  const elegidosIds = new Set(elegidos.map((p) => p.id));

  useEffect(() => {
    let vigente = true;
    setErrorBusqueda(null);
    // Con una pausa al escribir: no se pide en cada tecla.
    const pausa = setTimeout(
      () => {
        Promise.resolve()
          .then(() => buscar(texto.trim()))
          .then((lista) => {
            if (vigente) setResultados(Array.isArray(lista) ? lista : []);
          })
          .catch((err) => {
            if (vigente) {
              setResultados([]);
              setErrorBusqueda(
                err?.response?.data?.error?.message || mensajeDeError,
              );
            }
          });
      },
      texto ? 300 : 0,
    );
    return () => {
      vigente = false;
      clearTimeout(pausa);
    };
    // `buscar` es estable en quien lo usa; se vuelve a pedir al escribir o
    // al reintentar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, vez]);

  function alternar(persona, marcado) {
    if (!multiple) onCambio(marcado ? [persona] : []);
    else if (marcado) onCambio([...elegidos, persona]);
    else onCambio(elegidos.filter((p) => p.id !== persona.id));
  }

  const ayuda =
    elegidos.length === 0 ? textoSinElegir : textoElegidos?.(elegidos.length);

  return (
    <fieldset
      className="gh-personas"
      id={idGrupo}
      aria-describedby={
        [ayuda && idAyuda, error && idError].filter(Boolean).join(" ") ||
        undefined
      }
    >
      <legend className="gh-personas__titulo">
        {leyenda}
        {obligatorio && (
          <>
            <span className="mz-campo__obligatorio" aria-hidden="true">
              {" "}
              *
            </span>
            <span className="visually-hidden"> (obligatorio)</span>
          </>
        )}
      </legend>
      {ayuda && (
        <p id={idAyuda} className="form-text mt-0">
          {ayuda}
        </p>
      )}
      {elegidos.length > 0 && (
        <ul className="gh-personas__elegidos">
          {elegidos.map((p) => (
            <li key={p.id} className="gh-personas__elegido">
              <span className="gh-personas__nombre">{nombreDePersona(p)}</span>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={deshabilitado}
                onClick={() => {
                  alternar(p, false);
                  // El botón desaparece: el foco va al buscador.
                  document.getElementById(id)?.focus();
                }}
              >
                Quitar{" "}
                <span className="visually-hidden">{nombreDePersona(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={idError} className="mz-field-error mb-0">
          {error}
        </p>
      )}
      <label htmlFor={id} className="form-label mt-2">
        {etiquetaBuscador}
      </label>
      <input
        id={id}
        type="search"
        className={`form-control${error ? " is-invalid" : ""}`}
        value={texto}
        placeholder="Nombre o usuario"
        autoComplete="off"
        data-autofocus={autofoco || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? idError : undefined}
        aria-controls={idLista}
        onChange={(e) => setTexto(e.target.value)}
      />
      {/* Siempre montado: el número de resultados se anuncia al escribir. */}
      <p className="mz-small mz-faint mb-0 mt-1" role="status">
        {resultados === null
          ? "Buscando…"
          : resultados.length === 0
            ? texto.trim()
              ? "Nadie coincide con la búsqueda."
              : textoNadie
            : `${resultados.length} ${resultados.length === 1 ? "persona encontrada" : "personas encontradas"}.`}
      </p>
      {errorBusqueda && (
        <div className="mz-alert mz-alert--bad mt-2" role="alert">
          <Icon name="x-octagon" />
          <span className="flex-grow-1">{errorBusqueda}</span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setVez((v) => v + 1)}
          >
            Reintentar
          </button>
        </div>
      )}
      <ul
        id={idLista}
        className="gh-personas__resultados"
        aria-label={leyenda}
        hidden={!resultados?.length}
      >
        {(resultados ?? []).map((p) => {
          const marcado = elegidosIds.has(p.id);
          const lleno = multiple && !marcado && elegidos.length >= maximo;
          return (
            <li key={p.id}>
              <label className="gh-personas__resultado">
                <input
                  type={multiple ? "checkbox" : "radio"}
                  name={multiple ? undefined : `${id}-eleccion`}
                  className="form-check-input"
                  checked={marcado}
                  disabled={deshabilitado || lleno}
                  onChange={(e) => alternar(p, e.target.checked)}
                />
                <span className="gh-personas__nombre">
                  {nombreDePersona(p)}
                  {p.role_label && (
                    <span className="mz-faint"> · {p.role_label}</span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
