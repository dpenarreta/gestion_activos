/*
 * Las notas (`NotesPanel` y `DeskNotePostIt` de Nexo): las pestañas
 * Escritorio (recibidas sin archivar), Fijadas, Archivadas y Enviadas, cada
 * nota como un post-it de su color. Leer, fijar y archivar son de quien la
 * recibió; eliminar, de quien la dejó (va a su papelera) o de quien la
 * recibió si ya la archivó (definitivo). El servidor vuelve a decidirlo y
 * responde 409 si no corresponde.
 *
 * El color es el fondo del cuerpo de la nota (con contraste AA en los dos
 * temas, ver `Escritorio.css`); los botones van en una banda neutra debajo.
 */
import { useEffect, useRef, useState } from "react";

import {
  errorDeEscritorio,
  escritorioService,
} from "../../../api/escritorioService";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../../components/common/Pestanas/Pestanas";
import { fechaHora } from "../comunes";
import { enfocarDespues, vecinoDe } from "../enfocar";
import { Semaforo } from "../Desempeno/Componentes";
import { useEscritorio } from "./ContextoEscritorio";
import { DetalleNota } from "./DetalleNota";
import { claseDeColor, idDeNota, nombreDe } from "./escritorioComunes";
import { Pildora } from "./Piezas";

const ID_CONTADOR = "ed-notas-contador";

export const VISTAS_DE_NOTAS = ["desk", "pinned", "archive", "sent"];

const VACIO = {
  desk: "Su escritorio está despejado: no tiene notas pendientes.",
  pinned: "No tiene notas fijadas.",
  archive: "No tiene notas archivadas.",
  sent: "Todavía no ha dejado notas a nadie.",
};

export function Notas({ vista, onVista, version, onAviso, onNuevaNota }) {
  const { sinLeer, refrescarSinLeer, ajustes } = useEscritorio();
  const [notas, setNotas] = useState(null);
  const [error, setError] = useState(null);
  const [vez, setVez] = useState(0);
  const [abierta, setAbierta] = useState(null);
  const [ocupada, setOcupada] = useState(null);
  // Adónde va el foco cuando la lista se vuelve a pintar tras una acción.
  const foco = useRef(null);

  useEffect(() => {
    if (notas === null || !foco.current) return;
    enfocarDespues(foco.current);
    foco.current = null;
  }, [notas]);

  /** Si la nota sale de la pestaña, el foco va a la vecina (o al contador
   * si no queda ninguna); si sigue, a su propio «Abrir». */
  function enfocarTras(id, sigue) {
    if (sigue) {
      foco.current = idDeNota(id);
      return;
    }
    const vecina = vecinoDe(notas, id);
    foco.current = vecina ? idDeNota(vecina.id) : ID_CONTADOR;
  }

  useEffect(() => {
    let vigente = true;
    setError(null);
    setNotas(null);
    escritorioService
      .notas(vista)
      .then((lista) => {
        if (vigente) setNotas(Array.isArray(lista) ? lista : []);
      })
      .catch((err) => {
        if (vigente)
          setError(
            errorDeEscritorio(err, "No se pudieron cargar las notas.").mensaje,
          );
      });
    return () => {
      vigente = false;
    };
  }, [vista, vez, version]);

  /** ¿Sigue en esta pestaña después del cambio? */
  function pertenece(nota) {
    if (vista === "sent") return nota.is_mine;
    if (vista === "archive") return nota.archived;
    if (vista === "pinned") return !nota.archived && nota.pinned;
    return !nota.archived;
  }

  function reemplazar(nueva) {
    setNotas((lista) =>
      (lista ?? [])
        .map((n) => (n.id === nueva.id ? { ...n, ...nueva } : n))
        .filter((n) => n.id !== nueva.id || pertenece(n)),
    );
  }

  async function accion(nota, action, texto) {
    if (ocupada) return;
    setOcupada(nota.id);
    try {
      const nueva = await escritorioService.accionDeNota(nota.id, action);
      // Leer quita su botón; archivar, devolver o desfijar en «Fijadas»
      // sacan la nota de la pestaña.
      const sigue = pertenece({ ...nota, ...nueva });
      if (!sigue || action === "read") enfocarTras(nota.id, sigue);
      reemplazar(nueva);
      if (action === "read" || action === "archive" || action === "unarchive")
        refrescarSinLeer();
      onAviso({ texto });
    } catch (err) {
      onAviso({
        tono: "bad",
        texto: errorDeEscritorio(err, "No se pudo completar la acción.")
          .mensaje,
      });
    } finally {
      setOcupada(null);
    }
  }

  async function eliminar(nota) {
    const definitivo = !nota.is_mine;
    const si = await confirmar({
      titulo: definitivo
        ? "¿Eliminar la nota definitivamente?"
        : `¿Eliminar la nota que dejó a ${nombreDe(nota.recipient)}?`,
      mensaje: definitivo
        ? "La nota y sus respuestas se borran para siempre."
        : `Deja de verse para los dos y se borra del todo en ${ajustes.trash_retention_hours} horas.`,
      accion: "Eliminar nota",
    });
    if (!si) return;
    setOcupada(nota.id);
    try {
      await escritorioService.eliminarNota(nota.id);
      enfocarTras(nota.id, false);
      setNotas((lista) => (lista ?? []).filter((n) => n.id !== nota.id));
      refrescarSinLeer();
      onAviso({ texto: "Nota eliminada." });
    } catch (err) {
      const e = errorDeEscritorio(err, "No se pudo eliminar la nota.");
      onAviso({ tono: e.estado === 409 ? "warn" : "bad", texto: e.mensaje });
    } finally {
      setOcupada(null);
    }
  }

  return (
    <div className="gh-page">
      <Pestanas
        etiqueta="Notas"
        idBase="ed-notas"
        valor={vista}
        onCambio={onVista}
        opciones={[
          {
            id: "desk",
            etiqueta: "Escritorio",
            icono: "inbox",
            cuenta: sinLeer,
            unidad: "sin leer",
          },
          { id: "pinned", etiqueta: "Fijadas", icono: "pin-angle" },
          { id: "archive", etiqueta: "Archivadas", icono: "archive" },
          { id: "sent", etiqueta: "Enviadas", icono: "send" },
        ]}
      />
      <PanelDePestana idBase="ed-notas" valor={vista} className="gh-page">
        {vista === "archive" && (
          <p className="mz-small mz-faint mb-0">
            Las notas archivadas se borran solas a los{" "}
            {ajustes.archive_retention_days} días.
          </p>
        )}
        <EstadoDeCarga
          cargando={notas === null && !error}
          error={error}
          onReintentar={() => setVez((v) => v + 1)}
          vacio={notas !== null && notas.length === 0}
          textoVacio={VACIO[vista]}
          accionVacio={
            vista === "sent" || vista === "desk" ? (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={onNuevaNota}
              >
                Dejar una nota
              </button>
            ) : null
          }
        />
        {/* Siempre montado; recibe el foco si la lista queda vacía. */}
        <p
          id={ID_CONTADOR}
          className="mz-small mz-faint mb-0"
          role="status"
          tabIndex={-1}
        >
          {notas?.length
            ? `${notas.length} ${notas.length === 1 ? "nota" : "notas"}`
            : ""}
        </p>
        {notas?.length > 0 && (
          <ul className="ed-notas">
            {notas.map((n) => (
              <PostIt
                key={n.id}
                nota={n}
                vista={vista}
                ocupada={ocupada === n.id}
                onAbrir={() => setAbierta(n)}
                onAccion={(action, texto) => accion(n, action, texto)}
                onEliminar={() => eliminar(n)}
              />
            ))}
          </ul>
        )}
      </PanelDePestana>

      {abierta && (
        <DetalleNota
          id={abierta.id}
          inicial={abierta}
          onCerrar={() => setAbierta(null)}
          onCambio={reemplazar}
        />
      )}
    </div>
  );
}

/** Una nota como post-it: el cuerpo en su color y las acciones en una
 * banda neutra. Cada botón dice qué hace (texto oculto con el nombre). */
export function PostIt({
  nota,
  vista,
  ocupada,
  onAbrir,
  onAccion,
  onEliminar,
}) {
  const { prioridadesNota, ajustes } = useEscritorio();
  const enviada = nota.is_mine;
  const sinLeer = !enviada && !nota.read;
  const quien = enviada
    ? `Para ${nombreDe(nota.recipient)}`
    : `De ${nombreDe(nota.sender)}`;
  const puedeEliminar = enviada || (vista === "archive" && nota.archived);
  return (
    <li className={`ed-nota${sinLeer ? " ed-nota--sin-leer" : ""}`}>
      <div className={`ed-nota__cuerpo ${claseDeColor(nota.color)}`}>
        <p className="ed-nota__quien">{quien}</p>
        <div className="mz-pill-row">
          <Pildora opciones={prioridadesNota} valor={nota.priority} />
          {sinLeer && (
            <Semaforo tono="info">
              <Icon name="envelope" /> Sin leer
            </Semaforo>
          )}
          {nota.pinned && !enviada && (
            <Semaforo tono="neutral">
              <Icon name="pin-angle-fill" /> Fijada
            </Semaforo>
          )}
        </div>
        <p className="ed-nota__mensaje">{nota.message}</p>
        <ul className="ed-nota__datos mz-small">
          <li>{fechaHora(nota.created_at)}</li>
          {nota.attachment && (
            <li>
              <Icon name="paperclip" /> Adjunto
            </li>
          )}
          {nota.reply_count > 0 && (
            <li>
              <Icon name="chat-left-text" /> {nota.reply_count} de{" "}
              {ajustes.max_replies} respuestas
            </li>
          )}
          {nota.converted_to_reminder_id && (
            <li>
              <Icon name="alarm" /> Convertida en recordatorio
            </li>
          )}
          {enviada && (
            <li>
              <Icon name={nota.read ? "check2-all" : "check2"} />{" "}
              {nota.read ? "Leída" : "Sin leer todavía"}
            </li>
          )}
        </ul>
      </div>
      <div className="ed-nota__acciones">
        <button
          id={idDeNota(nota.id)}
          type="button"
          className="btn btn-outline-primary btn-sm"
          onClick={onAbrir}
        >
          <Icon name="arrows-angle-expand" /> Abrir
          <span className="visually-hidden">
            {" "}
            la nota {enviada ? "para" : "de"}{" "}
            {nombreDe(enviada ? nota.recipient : nota.sender)}
          </span>
        </button>
        {!enviada && !nota.read && (
          <BotonIcono
            icono="envelope-open"
            texto="Marcar como leída"
            disabled={ocupada}
            onClick={() => onAccion("read", "Nota marcada como leída.")}
          />
        )}
        {!enviada && !nota.archived && (
          <BotonIcono
            icono={nota.pinned ? "pin-angle-fill" : "pin-angle"}
            texto={nota.pinned ? "Desfijar" : "Fijar"}
            disabled={ocupada}
            onClick={() =>
              onAccion(
                nota.pinned ? "unpin" : "pin",
                nota.pinned ? "Nota desfijada." : "Nota fijada arriba.",
              )
            }
          />
        )}
        {!enviada && (
          <BotonIcono
            icono={nota.archived ? "box-arrow-up" : "archive"}
            texto={nota.archived ? "Devolver al escritorio" : "Archivar"}
            disabled={ocupada}
            onClick={() =>
              onAccion(
                nota.archived ? "unarchive" : "archive",
                nota.archived
                  ? "Nota devuelta al escritorio."
                  : "Nota archivada.",
              )
            }
          />
        )}
        {puedeEliminar && (
          <BotonIcono
            icono="trash"
            texto="Eliminar"
            peligro
            disabled={ocupada}
            onClick={onEliminar}
          />
        )}
      </div>
    </li>
  );
}

/** Un botón con ícono y su texto: visible desde 881 px; en el teléfono
 * solo el ícono, con el texto para lectores de pantalla y como `title`. */
export function BotonIcono({ icono, texto, onClick, disabled, peligro }) {
  return (
    <button
      type="button"
      className={`btn btn-sm ed-boton-icono ${peligro ? "btn-outline-danger" : "btn-outline-secondary"}`}
      title={texto}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icono} />
      <span className="ed-boton-icono__texto">{texto}</span>
    </button>
  );
}
