/*
 * Comentarios de una tarea (`CommentPanel` de Nexo). Abrirlos los marca como
 * vistos en el servidor; al comentar, el servidor avisa al jefe inmediato
 * según el organigrama. El texto se pinta como texto, nunca como HTML.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { ErrorEnLinea, fechaHora } from "../comunes";
import { PanelLateral } from "./Ventanas";
import { iniciales, nombreDe, rolLegible } from "./tareasComunes";

export function PanelComentarios({ tarea, onCerrar, onComentado, onVistos }) {
  const [comentarios, setComentarios] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState("");
  const [errorEnvio, setErrorEnvio] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const final = useRef(null);

  const cargar = useCallback(() => {
    setError(null);
    setComentarios(null);
    tareasService
      .comentarios(tarea.id)
      .then((lista) => {
        setComentarios(Array.isArray(lista) ? lista : []);
        onVistos?.(tarea.id);
      })
      .catch((err) =>
        setError(
          errorDeTareas(err, "No se pudieron cargar los comentarios.").mensaje,
        ),
      );
    // `onVistos` cambia en cada render de quien abre el panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarea.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    final.current?.scrollIntoView?.({ block: "nearest" });
  }, [comentarios]);

  async function enviar(evento) {
    evento?.preventDefault();
    if (!texto.trim() || enCurso.current) return;
    enCurso.current = true;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const nuevo = await tareasService.comentar(tarea.id, texto.trim());
      setComentarios((lista) => [...(lista ?? []), nuevo]);
      setTexto("");
      onComentado?.(tarea.id);
    } catch (err) {
      setErrorEnvio(
        errorDeTareas(
          err,
          "No se pudo publicar el comentario. Su texto se conserva.",
        ).mensaje,
      );
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <PanelLateral
      titulo={tarea.title}
      subtitulo={`Comentarios${comentarios ? ` · ${comentarios.length}` : ""}`}
      onCerrar={onCerrar}
      pie={
        <form onSubmit={enviar} className="gt-comentar">
          <label className="form-label" htmlFor="gt-comentario-nuevo">
            Nuevo comentario
          </label>
          <textarea
            id="gt-comentario-nuevo"
            className="form-control"
            rows={3}
            maxLength={5000}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar(e);
            }}
            aria-describedby="gt-comentario-ayuda"
          />
          <p id="gt-comentario-ayuda" className="mz-small mz-faint mb-2">
            Ctrl + Enter también envía.
          </p>
          <ErrorEnLinea mensaje={errorEnvio} className="mb-2" />
          <button
            type="submit"
            className="btn btn-primary w-100"
            disabled={!texto.trim() || enviando}
          >
            {enviando ? "Enviando…" : "Comentar"}
          </button>
        </form>
      }
    >
      <EstadoDeCarga
        cargando={comentarios === null && !error}
        error={error}
        onReintentar={cargar}
        vacio={comentarios?.length === 0}
        textoVacio="Todavía no hay comentarios en esta tarea."
      />
      {comentarios?.length > 0 && (
        <ol className="gt-hilo" aria-label="Comentarios de la tarea">
          {comentarios.map((c) => {
            const autor = nombreDe(c.author);
            return (
              <li key={c.id} className="gt-hilo__item">
                <span className="gt-avatar" aria-hidden="true">
                  {iniciales(autor)}
                </span>
                <div className="gt-min0">
                  <div className="gt-hilo__cabeza">
                    <strong>{autor}</strong>
                    {c.author?.roles?.[0]?.name && (
                      <span className="mz-small mz-faint">
                        {rolLegible(c.author.roles[0].name)}
                      </span>
                    )}
                    <span className="mz-small mz-faint">
                      {fechaHora(c.created_at)}
                    </span>
                  </div>
                  <p className="gt-hilo__texto">{c.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div ref={final} />
    </PanelLateral>
  );
}
