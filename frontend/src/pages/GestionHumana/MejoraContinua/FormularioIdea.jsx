/*
 * «Proponer idea» (`NewIdeaFormModal` de Nexo): título, descripción, impacto
 * y un adjunto opcional. El adjunto se revisa aquí con las reglas que da el
 * servidor en `me/` (formatos y tamaño) para avisar antes de subir; el
 * servidor lo vuelve a validar, también por la firma del contenido, y su
 * motivo (`details.attachment`) se muestra tal cual.
 */
import { useId, useRef, useState } from "react";

import {
  errorDeMejora,
  mejoraContinuaService,
} from "../../../api/mejoraContinuaService";
import {
  Campo,
  LeyendaObligatorios,
} from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import { Ventana } from "../Tareas/Ventanas";
import { useMejoraContinua } from "./ContextoMejoraContinua";
import {
  DESCRIPCION_MAX,
  IMPACTOS,
  TITULO_MAX,
  listaDeFormatos,
  problemaDelAdjunto,
  tamano,
} from "./mejoraComunes";

const ORDEN = ["title", "description", "impact", "attachment"];

export function FormularioIdea({ onCerrar, onCreada }) {
  const { reglasAdjunto } = useMejoraContinua();
  const base = useId();
  const ids = {
    title: `${base}-titulo`,
    description: `${base}-descripcion`,
    impact: `${base}-impacto`,
    attachment: `${base}-adjunto`,
    formulario: `${base}-formulario`,
  };
  const [valores, setValores] = useState({
    title: "",
    description: "",
    impact: "MEDIO",
  });
  const [archivo, setArchivo] = useState(null);
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const selector = useRef(null);

  function cambiar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    setErrores((e) => {
      const resto = { ...e };
      delete resto[campo];
      return resto;
    });
  }

  function elegirArchivo(evento) {
    const elegido = evento.target.files?.[0] ?? null;
    const problema = problemaDelAdjunto(elegido, reglasAdjunto);
    if (problema) {
      // No se guarda: el campo queda vacío y dice por qué.
      setArchivo(null);
      evento.target.value = "";
      setErrores((e) => ({ ...e, attachment: problema }));
      return;
    }
    setArchivo(elegido);
    setErrores((e) => {
      const resto = { ...e };
      delete resto.attachment;
      return resto;
    });
  }

  function quitarArchivo() {
    setArchivo(null);
    if (selector.current) {
      selector.current.value = "";
      selector.current.focus();
    }
  }

  function validar() {
    const e = {};
    if (!valores.title.trim()) e.title = "Escriba un título para la idea.";
    if (!valores.description.trim())
      e.description = "Describa el problema y la mejora que propone.";
    if (!valores.impact) e.impact = "Elija el impacto esperado.";
    const problema = problemaDelAdjunto(archivo, reglasAdjunto);
    if (problema) e.attachment = problema;
    return e;
  }

  function enfocar(campos) {
    const primero = ORDEN.find((c) => campos[c]);
    if (primero) document.getElementById(ids[primero])?.focus();
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
      const idea = await mejoraContinuaService.proponer({
        title: valores.title.trim(),
        description: valores.description.trim(),
        impact: valores.impact,
        archivo,
      });
      onCreada(idea);
    } catch (err) {
      const e = errorDeMejora(err, "No se pudo proponer la idea.");
      if (Object.keys(e.campos).length) {
        setErrores(e.campos);
        enfocar(e.campos);
      }
      setErrorGeneral(e.mensaje);
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  const aceptados = (reglasAdjunto.extensions ?? []).join(",");

  return (
    <Ventana
      titulo="Proponer una idea de mejora"
      subtitulo="Cuente qué problema ve y cómo lo mejoraría. Quien gestiona Mejora continua la revisará."
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
            className="btn btn-primary"
            disabled={enviando}
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
                <Icon name="send" /> Proponer idea
              </>
            )}
          </button>
        </>
      }
    >
      <form
        id={ids.formulario}
        className="mc-formulario"
        onSubmit={enviar}
        noValidate
        aria-busy={enviando}
      >
        <LeyendaObligatorios />
        {errorGeneral && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            <span>{errorGeneral}</span>
          </div>
        )}
        <Campo
          id={ids.title}
          etiqueta="Título"
          obligatorio
          error={errores.title}
          ayuda={`${valores.title.length} de ${TITULO_MAX} caracteres.`}
        >
          <input
            type="text"
            data-autofocus
            className="form-control"
            value={valores.title}
            maxLength={TITULO_MAX}
            placeholder="Nombre corto de la idea"
            onChange={(e) => cambiar("title", e.target.value)}
          />
        </Campo>
        <Campo
          id={ids.description}
          etiqueta="Descripción"
          obligatorio
          error={errores.description}
          ayuda={`${valores.description.length} de ${DESCRIPCION_MAX} caracteres.`}
        >
          <textarea
            className="form-control"
            rows={5}
            value={valores.description}
            maxLength={DESCRIPCION_MAX}
            placeholder="El problema, la mejora propuesta y a quién beneficia"
            onChange={(e) => cambiar("description", e.target.value)}
          />
        </Campo>
        <fieldset
          className="mc-grupo"
          aria-describedby={errores.impact ? `${ids.impact}-error` : undefined}
        >
          <legend className="mc-grupo__titulo">Impacto esperado</legend>
          <div
            className="gt-opciones mc-impactos"
            id={ids.impact}
            tabIndex={-1}
          >
            {IMPACTOS.map((i) => (
              <label key={i.id} className="gt-opcion">
                <input
                  type="radio"
                  name={`${base}-impacto`}
                  value={i.id}
                  checked={valores.impact === i.id}
                  onChange={() => cambiar("impact", i.id)}
                />
                <span className="gt-opcion__texto">{i.texto}</span>
              </label>
            ))}
          </div>
          {errores.impact && (
            <p id={`${ids.impact}-error`} className="mz-field-error mb-0">
              {errores.impact}
            </p>
          )}
        </fieldset>
        <Campo
          id={ids.attachment}
          etiqueta="Archivo adjunto (opcional)"
          error={errores.attachment}
          ayuda={`${listaDeFormatos(reglasAdjunto.extensions ?? [])}, hasta ${tamano(reglasAdjunto.max_bytes)}.`}
        >
          <input
            ref={selector}
            type="file"
            className="form-control"
            accept={aceptados}
            onChange={elegirArchivo}
          />
        </Campo>
        {archivo && (
          <div className="mc-archivo">
            <Icon name="paperclip" />
            {/* El nombre ya lo muestra el selector de archivo: aquí solo el
                tamaño y cómo quitarlo. */}
            <span className="mc-archivo__nombre">
              Listo para adjuntar ({tamano(archivo.size)})
            </span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={quitarArchivo}
              disabled={enviando}
            >
              Quitar <span className="visually-hidden">{archivo.name}</span>
            </button>
          </div>
        )}
      </form>
    </Ventana>
  );
}
