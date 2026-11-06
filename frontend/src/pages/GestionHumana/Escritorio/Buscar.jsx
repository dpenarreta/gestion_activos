/*
 * El buscador del Escritorio (`GlobalSearchOverlay` de Nexo, aquí como una
 * pestaña): busca en las notas en que participa (también en el texto de sus
 * respuestas) y en sus recordatorios, con filtros por prioridad, día,
 * remitente, destinatario y estado. Hasta 50 de cada uno (lo corta el
 * servidor). Los filtros viven en la URL: al recargar, la búsqueda sigue.
 */
import { useEffect, useId, useState } from "react";

import {
  errorDeEscritorio,
  escritorioService,
} from "../../../api/escritorioService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { fechaHora } from "../comunes";
import { useEscritorio } from "./ContextoEscritorio";
import { DetalleNota } from "./DetalleNota";
import { claseDeColor, nombreDe } from "./escritorioComunes";
import { Pildora } from "./Piezas";

export const FILTROS_DE_BUSQUEDA = [
  "q",
  "priority",
  "date",
  "sender",
  "recipient",
  "status",
];

const ESTADOS = [
  { id: "PENDIENTE", texto: "Pendientes (notas sin leer y recordatorios)" },
  { id: "LEIDA", texto: "Notas leídas" },
  { id: "ARCHIVADA", texto: "Notas archivadas" },
  { id: "COMPLETADO", texto: "Recordatorios completados" },
];

const MAXIMO = 50;

export function Buscar({ filtros, onBuscar }) {
  const { prioridadesNota, prioridadesRecordatorio, estadosRecordatorio } =
    useEscritorio();
  const base = useId();
  const id = (c) => `${base}-${c}`;
  const [borrador, setBorrador] = useState(filtros);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [vez, setVez] = useState(0);
  const [abierta, setAbierta] = useState(null);
  const clave = FILTROS_DE_BUSQUEDA.map((c) => filtros[c] ?? "").join("|");
  const hayBusqueda = FILTROS_DE_BUSQUEDA.some((c) => filtros[c]);

  // Si la URL cambia (atrás, adelante), el formulario la sigue.
  useEffect(() => {
    setBorrador(filtros);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  useEffect(() => {
    if (!hayBusqueda) {
      setResultado(null);
      setError(null);
      return undefined;
    }
    let vigente = true;
    setError(null);
    setResultado(null);
    escritorioService
      .buscar(filtros)
      .then((d) => {
        if (vigente)
          setResultado({
            notes: d?.notes ?? [],
            reminders: d?.reminders ?? [],
          });
      })
      .catch((err) => {
        if (vigente)
          setError(errorDeEscritorio(err, "No se pudo buscar.").mensaje);
      });
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, vez]);

  function cambiar(campo, valor) {
    setBorrador((b) => ({ ...b, [campo]: valor }));
  }

  function enviar(evento) {
    evento.preventDefault();
    const limpio = Object.fromEntries(
      FILTROS_DE_BUSQUEDA.map((c) => [c, String(borrador[c] ?? "").trim()]),
    );
    onBuscar(limpio);
  }

  function limpiar() {
    const vacio = Object.fromEntries(FILTROS_DE_BUSQUEDA.map((c) => [c, ""]));
    setBorrador(vacio);
    onBuscar(vacio);
    document.getElementById(id("q"))?.focus();
  }

  const total =
    (resultado?.notes.length ?? 0) + (resultado?.reminders.length ?? 0);

  return (
    <div className="gh-page">
      <form
        className="mz-card ed-buscador"
        role="search"
        aria-label="Buscar en el Escritorio"
        onSubmit={enviar}
        noValidate
      >
        <div className="mz-card-body ed-buscador__campos">
          <div className="mz-campo ed-buscador__texto">
            <label className="form-label" htmlFor={id("q")}>
              Texto
            </label>
            <input
              id={id("q")}
              type="search"
              className="form-control"
              maxLength={200}
              value={borrador.q ?? ""}
              placeholder="Palabras del mensaje, de una respuesta o del recordatorio"
              onChange={(e) => cambiar("q", e.target.value)}
            />
          </div>
          <div className="mz-campo">
            <label className="form-label" htmlFor={id("priority")}>
              Prioridad
            </label>
            <select
              id={id("priority")}
              className="form-select"
              value={borrador.priority ?? ""}
              onChange={(e) => cambiar("priority", e.target.value)}
            >
              <option value="">Cualquiera</option>
              <optgroup label="De las notas">
                {prioridadesNota.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.texto}
                  </option>
                ))}
              </optgroup>
              <optgroup label="De los recordatorios">
                {prioridadesRecordatorio
                  .filter((p) => !prioridadesNota.some((n) => n.id === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.texto}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>
          <div className="mz-campo">
            <label className="form-label" htmlFor={id("date")}>
              Día
            </label>
            <input
              id={id("date")}
              type="date"
              className="form-control"
              value={borrador.date ?? ""}
              onChange={(e) => cambiar("date", e.target.value)}
            />
          </div>
          <div className="mz-campo">
            <label className="form-label" htmlFor={id("status")}>
              Estado
            </label>
            <select
              id={id("status")}
              className="form-select"
              value={borrador.status ?? ""}
              onChange={(e) => cambiar("status", e.target.value)}
            >
              <option value="">Cualquiera</option>
              {ESTADOS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.texto}
                </option>
              ))}
            </select>
          </div>
          <div className="mz-campo">
            <label className="form-label" htmlFor={id("sender")}>
              De (nombre)
            </label>
            <input
              id={id("sender")}
              type="text"
              className="form-control"
              maxLength={100}
              value={borrador.sender ?? ""}
              onChange={(e) => cambiar("sender", e.target.value)}
            />
          </div>
          <div className="mz-campo">
            <label className="form-label" htmlFor={id("recipient")}>
              Para (nombre)
            </label>
            <input
              id={id("recipient")}
              type="text"
              className="form-control"
              maxLength={100}
              value={borrador.recipient ?? ""}
              onChange={(e) => cambiar("recipient", e.target.value)}
            />
          </div>
        </div>
        <div className="mz-card-body pt-0 ed-acciones">
          <button type="submit" className="btn btn-primary btn-sm">
            <Icon name="search" /> Buscar
          </button>
          {hayBusqueda && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={limpiar}
            >
              Limpiar
            </button>
          )}
        </div>
      </form>

      {!hayBusqueda ? (
        <p className="mz-small mz-faint mb-0">
          Escriba un texto o elija un filtro y pulse Buscar.
        </p>
      ) : (
        <EstadoDeCarga
          cargando={resultado === null && !error}
          error={error}
          onReintentar={() => setVez((v) => v + 1)}
          vacio={resultado !== null && total === 0}
          textoVacio="No se encontró nada con esa búsqueda."
        />
      )}
      <p className="mz-small mz-faint mb-0" role="status">
        {resultado && total > 0
          ? `${resultado.notes.length} ${resultado.notes.length === 1 ? "nota" : "notas"} y ${resultado.reminders.length} ${resultado.reminders.length === 1 ? "recordatorio" : "recordatorios"}.${
              resultado.notes.length >= MAXIMO ||
              resultado.reminders.length >= MAXIMO
                ? ` Se muestran los ${MAXIMO} más recientes: afine la búsqueda.`
                : ""
            }`
          : ""}
      </p>

      {resultado?.notes.length > 0 && (
        <section aria-labelledby={id("notas")}>
          <h3 id={id("notas")} className="ed-subtitulo">
            Notas
          </h3>
          <ul className="ed-resultados">
            {resultado.notes.map((n) => (
              <li
                key={n.id}
                className={`ed-resultado ${claseDeColor(n.color)}`}
              >
                <p className="mz-small mb-1">
                  <span className="mz-strong">
                    {n.is_mine
                      ? `Para ${nombreDe(n.recipient)}`
                      : `De ${nombreDe(n.sender)}`}
                  </span>
                  <span className="mz-faint"> · {fechaHora(n.created_at)}</span>
                </p>
                <p className="ed-hoy__extracto mb-2">{n.message}</p>
                <div className="ed-hoy__fila">
                  <Pildora opciones={prioridadesNota} valor={n.priority} />
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => setAbierta(n)}
                  >
                    Abrir{" "}
                    <span className="visually-hidden">
                      la nota {n.is_mine ? "para" : "de"}{" "}
                      {nombreDe(n.is_mine ? n.recipient : n.sender)}
                    </span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {resultado?.reminders.length > 0 && (
        <section aria-labelledby={id("recordatorios")}>
          <h3 id={id("recordatorios")} className="ed-subtitulo">
            Recordatorios
          </h3>
          <ul className="ed-resultados">
            {resultado.reminders.map((r) => (
              <li key={r.id} className="ed-resultado ed-resultado--neutro">
                <p className="mz-strong mb-1">{r.title}</p>
                {r.description && (
                  <p className="ed-hoy__extracto mz-small mb-2">
                    {r.description}
                  </p>
                )}
                <div className="ed-hoy__fila">
                  <span className="mz-small">
                    <Icon name="alarm" /> {fechaHora(r.due_at)}
                  </span>
                  <span className="mz-pill-row">
                    <Pildora
                      opciones={prioridadesRecordatorio}
                      valor={r.priority}
                    />
                    <Pildora opciones={estadosRecordatorio} valor={r.status} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {abierta && (
        <DetalleNota id={abierta.id} onCerrar={() => setAbierta(null)} />
      )}
    </div>
  );
}
