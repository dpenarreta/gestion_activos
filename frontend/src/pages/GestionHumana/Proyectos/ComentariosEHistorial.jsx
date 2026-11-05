/*
 * Comentarios e historial de un proyecto (`ProjectCommentsTab` y
 * `ProjectHistoryTab` de Nexo). Comentar: quien participa. El historial es
 * de solo lectura, del más reciente al más antiguo; un fallo de red se dice
 * como error, nunca como «sin eventos».
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  errorDeProyectos,
  proyectosGhService,
} from "../../../api/proyectosGhService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { ErrorEnLinea, fechaHora } from "../comunes";
import { haceCuanto, iniciales } from "../Tareas/tareasComunes";
import { EVENTO_HISTORIAL, nombreDe, rolDe } from "./proyectosComunes";

export function Comentarios({ proyecto, onComentado }) {
  const [comentarios, setComentarios] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState("");
  const [errorEnvio, setErrorEnvio] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const campo = useRef(null);

  const cargar = useCallback(() => {
    setError(null);
    proyectosGhService
      .comentarios(proyecto.id)
      .then((lista) => setComentarios(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(
          errorDeProyectos(err, "No se pudieron cargar los comentarios.")
            .mensaje,
        ),
      );
  }, [proyecto.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function enviar(evento) {
    evento?.preventDefault();
    if (!texto.trim() || enCurso.current) return;
    enCurso.current = true;
    setEnviando(true);
    setErrorEnvio(null);
    setMensaje(null);
    try {
      const nuevo = await proyectosGhService.comentar(
        proyecto.id,
        texto.trim(),
      );
      setComentarios((lista) => [...(lista ?? []), nuevo]);
      setTexto("");
      setMensaje("Comentario publicado.");
      onComentado?.();
      campo.current?.focus();
    } catch (err) {
      // Lo escrito se conserva para reintentar.
      setErrorEnvio(
        errorDeProyectos(err, "No se pudo publicar el comentario.").mensaje,
      );
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <div className="mz-stack gp-angosto">
      <h3 className="gp-subtitulo">Comentarios</h3>
      <EstadoDeCarga
        cargando={comentarios === null && !error}
        error={error}
        onReintentar={cargar}
        vacio={comentarios?.length === 0}
        textoVacio="Todavía no hay comentarios."
      />
      {comentarios?.length > 0 && (
        <ul className="gt-hilo">
          {comentarios.map((c) => (
            <li key={c.id} className="gt-hilo__item">
              <span className="gt-avatar" aria-hidden="true">
                {iniciales(nombreDe(c.author))}
              </span>
              <div className="gt-min0 flex-grow-1">
                <div className="gt-hilo__cabeza">
                  <strong>{nombreDe(c.author)}</strong>
                  {rolDe(c.author) && (
                    <span className="mz-small mz-faint">{rolDe(c.author)}</span>
                  )}
                  <span className="mz-small mz-faint">
                    <time
                      dateTime={c.created_at}
                      title={fechaHora(c.created_at)}
                    >
                      {haceCuanto(c.created_at)}
                    </time>
                  </span>
                </div>
                <p className="gt-hilo__texto mb-0">{c.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {proyecto.can_participate ? (
        <form onSubmit={enviar}>
          <p role="status" className="visually-hidden">
            {mensaje}
          </p>
          <ErrorEnLinea mensaje={errorEnvio} className="mb-2" />
          <label className="form-label" htmlFor="gp-comentario">
            Nuevo comentario
          </label>
          <textarea
            ref={campo}
            id="gp-comentario"
            className="form-control"
            rows={3}
            maxLength={5000}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar(e);
            }}
            aria-describedby="gp-comentario-ayuda"
          />
          <p id="gp-comentario-ayuda" className="form-text">
            Ctrl + Enter también lo publica.
          </p>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!texto.trim() || enviando}
          >
            <Icon name="send" /> {enviando ? "Publicando…" : "Comentar"}
          </button>
        </form>
      ) : (
        <p className="mz-small mz-faint mb-0">
          Solo quienes participan en el proyecto pueden comentar.
        </p>
      )}
    </div>
  );
}

export function Historial({ proyecto }) {
  const [eventos, setEventos] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback(() => {
    setError(null);
    setEventos(null);
    proyectosGhService
      .historial(proyecto.id)
      .then((lista) => setEventos(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(
          errorDeProyectos(err, "No se pudo cargar el historial.").mensaje,
        ),
      );
  }, [proyecto.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="mz-stack gp-angosto">
      <h3 className="gp-subtitulo">Historial</h3>
      <EstadoDeCarga
        cargando={eventos === null && !error}
        error={error}
        onReintentar={cargar}
        vacio={eventos?.length === 0}
        textoVacio="Sin eventos registrados."
      />
      {eventos?.length > 0 && (
        <ol className="mz-timeline">
          {eventos.map((h) => (
            <li key={h.id} className="mz-tl-item">
              <p className="mz-small mz-strong mb-0">
                {EVENTO_HISTORIAL[h.event] ?? h.event}
              </p>
              <p className="mb-0">{h.description}</p>
              <p className="mz-small mz-faint mb-0">
                {nombreDe(h.actor)} · {fechaHora(h.created_at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
