/*
 * Los recordatorios personales (`RemindersPanel` y `ReminderCard` de Nexo):
 * por vencimiento, con su prioridad, su estado, si está vencido y su
 * repetición. Completar (si se repite, el servidor crea el siguiente),
 * posponer con los atajos de `me/` (`snooze_presets_minutes`) o a una fecha,
 * reabrir uno completado, archivar, editar, eliminar y convertir en tarea
 * (con acceso a Tareas).
 *
 * Completar uno ya completado, reabrir uno pendiente o convertir dos veces
 * responde 409 (un doble clic o dos pestañas): se avisa y se recarga.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  errorDeEscritorio,
  escritorioService,
} from "../../../api/escritorioService";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { fechaHora } from "../comunes";
import { enfocarDespues, vecinoDe } from "../enfocar";
import { Semaforo } from "../Desempeno/Componentes";
import { aCampoLocal, deCampoLocal } from "../Reuniones/reunionesComunes";
import { useEscritorio } from "./ContextoEscritorio";
import { ConvertirEnTarea } from "./ConvertirEnTarea";
import { FormularioRecordatorio } from "./FormularioRecordatorio";
import {
  RUTA_TAREAS,
  buscarOpcion,
  dentroDe,
  textoDePosponer,
  vencido,
} from "./escritorioComunes";
import { BotonIcono } from "./Notas";
import { Adjunto, Historial, Pildora } from "./Piezas";

const ID_CONTADOR = "ed-recordatorios-contador";
const idDeRecordatorio = (id) => `ed-recordatorio-${id}`;

/** La hora actual, puesta al día cada `cada` ms (para «Vencido» con la
 * pantalla abierta). */
function useAhora(cada) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const intervalo = setInterval(() => setAhora(Date.now()), cada);
    return () => clearInterval(intervalo);
  }, [cada]);
  return ahora;
}

/** El filtro se lee en plural («Pendientes»), la píldora en singular. */
const FILTRO_DE_ESTADO = {
  PENDIENTE: "Pendientes",
  COMPLETADO: "Completados",
};

export function Recordatorios({
  estado,
  archivados,
  onFiltro,
  version,
  onAviso,
  onNuevo,
}) {
  const { estadosRecordatorio } = useEscritorio();
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  const [vez, setVez] = useState(0);
  const [editando, setEditando] = useState(null);
  const [convirtiendo, setConvirtiendo] = useState(null);

  // Al recargar con los mismos filtros (tras un 409 o al completar uno que
  // se repite) la lista se queda a la vista mientras llega la nueva: si se
  // vaciara, el foco caería en <body>.
  const filtro = `${estado}|${archivados}`;
  const ultimoFiltro = useRef(filtro);

  useEffect(() => {
    let vigente = true;
    setError(null);
    if (ultimoFiltro.current !== filtro) {
      ultimoFiltro.current = filtro;
      setLista(null);
    }
    escritorioService
      .recordatorios({ archived: archivados, status: estado })
      .then((datos) => {
        if (vigente) setLista(Array.isArray(datos) ? datos : []);
      })
      .catch((err) => {
        if (vigente)
          setError(
            errorDeEscritorio(err, "No se pudieron cargar los recordatorios.")
              .mensaje,
          );
      });
    return () => {
      vigente = false;
    };
    // `filtro` resume `estado` y `archivados`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, vez, version]);

  const recargar = () => setVez((v) => v + 1);
  // «Vencido» se recalcula con la pantalla abierta.
  const ahora = useAhora(60_000);
  // Adónde va el foco cuando la lista se vuelve a pintar tras una acción
  // (si no, caía en <body> al desaparecer el botón pulsado).
  const foco = useRef(null);

  useEffect(() => {
    if (lista === null || !foco.current) return;
    enfocarDespues(foco.current, ID_CONTADOR);
    foco.current = null;
  }, [lista]);

  /** El foco tras quitar `id`: el vecino o, si no queda, el contador. */
  function enfocarVecino(id) {
    const vecino = vecinoDe(lista, id);
    foco.current = vecino ? idDeRecordatorio(vecino.id) : ID_CONTADOR;
  }

  /** Reemplaza el recordatorio o lo quita si ya no cabe en el filtro.
   * `destino`: adónde va el foco si sigue en la lista (su título si no se
   * dice; `null` para no moverlo, como al volver de una ventana). */
  function reemplazar(nuevo, destino) {
    const cabe =
      Boolean(nuevo.archived) === archivados &&
      (!estado || nuevo.status === estado);
    if (!cabe) enfocarVecino(nuevo.id);
    else if (destino !== null)
      foco.current = destino ?? idDeRecordatorio(nuevo.id);
    setLista((actual) =>
      cabe
        ? (actual ?? []).map((r) => (r.id === nuevo.id ? nuevo : r))
        : (actual ?? []).filter((r) => r.id !== nuevo.id),
    );
  }

  return (
    <div className="gh-page">
      <form
        className="mz-filter-bar ed-filtros"
        role="search"
        aria-label="Filtrar recordatorios"
        onSubmit={(e) => e.preventDefault()}
      >
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por estado"
          value={estado}
          onChange={(e) => onFiltro("estado", e.target.value)}
        >
          <option value="">Todo estado</option>
          {estadosRecordatorio.map((e) => (
            <option key={e.id} value={e.id}>
              {FILTRO_DE_ESTADO[e.id] ?? e.texto}
            </option>
          ))}
        </select>
        <label className="ed-casilla">
          <input
            type="checkbox"
            className="form-check-input"
            checked={archivados}
            onChange={(e) =>
              onFiltro("archivados", e.target.checked ? "1" : "")
            }
          />
          Ver los archivados
        </label>
      </form>

      <EstadoDeCarga
        cargando={lista === null && !error}
        error={error}
        onReintentar={recargar}
        vacio={lista !== null && lista.length === 0}
        hayFiltros={Boolean(estado)}
        onLimpiarFiltros={() => onFiltro("estado", "")}
        textoVacio={
          archivados
            ? "No tiene recordatorios archivados."
            : "No tiene recordatorios."
        }
        accionVacio={
          archivados ? null : (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onNuevo}
            >
              Crear un recordatorio
            </button>
          )
        }
      />
      {/* Siempre montado; recibe el foco si la lista queda vacía. */}
      <p
        id={ID_CONTADOR}
        className="mz-small mz-faint mb-0"
        role="status"
        tabIndex={-1}
      >
        {lista?.length
          ? `${lista.length} ${lista.length === 1 ? "recordatorio" : "recordatorios"}`
          : ""}
      </p>
      {lista?.length > 0 && (
        <ul className="ed-recordatorios">
          {lista.map((r) => (
            <TarjetaRecordatorio
              key={r.id}
              recordatorio={r}
              ahora={ahora}
              onActualizado={reemplazar}
              onEnfocar={(id) => {
                foco.current = id;
              }}
              onRecargar={recargar}
              onAviso={onAviso}
              onEditar={() => setEditando(r)}
              onConvertir={() => setConvirtiendo(r)}
              onEliminado={() => {
                enfocarVecino(r.id);
                setLista((actual) =>
                  (actual ?? []).filter((x) => x.id !== r.id),
                );
              }}
            />
          ))}
        </ul>
      )}

      {editando && (
        <FormularioRecordatorio
          recordatorio={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={(nuevo) => {
            setEditando(null);
            // La ventana devuelve el foco a «Editar», que sigue ahí.
            reemplazar(nuevo, null);
            onAviso({ texto: "Recordatorio guardado." });
          }}
        />
      )}
      {convirtiendo && (
        <ConvertirEnTarea
          recordatorio={convirtiendo}
          onCerrar={() => setConvirtiendo(null)}
          onConvertido={(tarea) => {
            const id = convirtiendo.id;
            setConvirtiendo(null);
            setLista((actual) =>
              (actual ?? []).map((r) =>
                r.id === id
                  ? {
                      ...r,
                      converted_to_task_id: tarea.task_id,
                      converted_to_task_at: new Date().toISOString(),
                    }
                  : r,
              ),
            );
            onAviso({
              texto: `Se creó la tarea «${tarea.task_title}», asignada a usted.`,
            });
          }}
        />
      )}
    </div>
  );
}

function TarjetaRecordatorio({
  recordatorio: r,
  onActualizado,
  onRecargar,
  onAviso,
  onEditar,
  onConvertir,
  onEliminado,
  onEnfocar,
  ahora,
}) {
  const {
    prioridadesRecordatorio,
    estadosRecordatorio,
    repeticiones,
    ajustes,
    puedeConvertirEnTarea,
  } = useEscritorio();
  const base = useId();
  const [panel, setPanel] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const enCurso = useRef(false);
  const completado = r.status === "COMPLETADO";
  const atrasado = vencido(r, ahora);
  const idTitulo = idDeRecordatorio(r.id);
  const idPosponer = `${idTitulo}-posponer`;
  const repeticion = buscarOpcion(repeticiones, r.repeat);

  async function hacer(action, dueAt, texto) {
    // Posponer deja el foco en «Posponer» (sigue ahí); lo demás, en el
    // título (completar y reabrir cambian los botones).
    const destino = action === "postpone" ? idPosponer : undefined;
    if (enCurso.current) return;
    enCurso.current = true;
    setOcupado(action);
    try {
      const nuevo = await escritorioService.accionDeRecordatorio(
        r.id,
        action,
        dueAt,
      );
      setPanel(null);
      onActualizado(nuevo, destino);
      // Si se repite, el servidor creó el siguiente: hay que traerlo.
      if (action === "complete" && r.repeat !== "UNA_VEZ") onRecargar();
      onAviso({ texto });
    } catch (err) {
      const e = errorDeEscritorio(err, "No se pudo completar la acción.");
      if (e.estado === 409 || e.codigo === "conflict") {
        onAviso({
          tono: "warn",
          texto: `${e.mensaje} Se recargó la lista con su estado actual.`,
        });
        setPanel(null);
        onEnfocar(idTitulo);
        onRecargar();
      } else {
        onAviso({ tono: "bad", texto: e.campos.due_at || e.mensaje });
      }
    } finally {
      enCurso.current = false;
      setOcupado(null);
    }
  }

  async function eliminar() {
    const si = await confirmar({
      titulo: `¿Eliminar el recordatorio «${r.title}»?`,
      accion: "Eliminar recordatorio",
    });
    if (!si) return;
    setOcupado("delete");
    try {
      await escritorioService.eliminarRecordatorio(r.id);
      onEliminado();
      onAviso({ texto: "Recordatorio eliminado." });
    } catch (err) {
      onAviso({
        tono: "bad",
        texto: errorDeEscritorio(err, "No se pudo eliminar el recordatorio.")
          .mensaje,
      });
      setOcupado(null);
    }
  }

  const botones = { posponer: useRef(null), reabrir: useRef(null) };
  const alternar = (cual) => setPanel((p) => (p === cual ? null : cual));
  /** Cerrar sin elegir: el foco vuelve al botón que abrió el panel (si no,
   * caía en <body> al desaparecer el formulario). */
  function cerrarPanel() {
    const cual = panel;
    setPanel(null);
    requestAnimationFrame(() => botones[cual]?.current?.focus());
  }
  const deshabilitado = ocupado !== null;

  return (
    <li
      className={`ed-recordatorio${completado ? " ed-recordatorio--hecho" : ""}${atrasado ? " ed-recordatorio--vencido" : ""}`}
    >
      <div className="ed-recordatorio__cabecera">
        {/* Con tabIndex -1: destino del foco tras una acción. */}
        <h4 id={idTitulo} className="ed-recordatorio__titulo" tabIndex={-1}>
          {r.title}
        </h4>
        <div className="mz-pill-row">
          <Pildora opciones={prioridadesRecordatorio} valor={r.priority} />
          <Pildora opciones={estadosRecordatorio} valor={r.status} />
          {atrasado && (
            <Semaforo tono="bad">
              <Icon name="exclamation-circle" /> Vencido
            </Semaforo>
          )}
          {r.repeat !== "UNA_VEZ" && (
            <Semaforo tono="neutral">
              <Icon name="arrow-repeat" /> {repeticion.texto}
            </Semaforo>
          )}
          {r.archived && (
            <Semaforo tono="neutral">
              <Icon name="archive" /> Archivado
            </Semaforo>
          )}
        </div>
      </div>
      <p className="mb-0 ed-recordatorio__vence">
        <Icon name="alarm" />{" "}
        {completado
          ? `Completado el ${fechaHora(r.completed_at)}`
          : `Vence el ${fechaHora(r.due_at)}`}
      </p>
      {r.description && <p className="ed-texto mz-small">{r.description}</p>}
      {(r.converted_to_task_id || r.converted_to_task_at) && (
        <p className="mz-small mb-0">
          <Icon name="kanban" />{" "}
          {puedeConvertirEnTarea && r.converted_to_task_id ? (
            <Link to={`${RUTA_TAREAS}/${r.converted_to_task_id}`}>
              Convertido en tarea: ver la tarea
            </Link>
          ) : (
            "Convertido en tarea"
          )}
        </p>
      )}
      <Adjunto adjunto={r.attachment} idBase={`recordatorio-${r.id}`} />

      <div className="ed-acciones">
        {!completado ? (
          <>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              disabled={deshabilitado}
              onClick={() =>
                hacer("complete", null, "Recordatorio completado.")
              }
            >
              <Icon name="check2-circle" />{" "}
              {ocupado === "complete" ? "Guardando…" : "Completar"}
              <span className="visually-hidden"> «{r.title}»</span>
            </button>
            <button
              ref={botones.posponer}
              id={idPosponer}
              type="button"
              className="btn btn-outline-secondary btn-sm"
              aria-expanded={panel === "posponer"}
              aria-controls={`${base}-posponer`}
              disabled={deshabilitado}
              onClick={() => alternar("posponer")}
            >
              <Icon name="clock-history" /> Posponer
              <span className="visually-hidden"> «{r.title}»</span>
            </button>
          </>
        ) : (
          <button
            ref={botones.reabrir}
            type="button"
            className="btn btn-outline-secondary btn-sm"
            aria-expanded={panel === "reabrir"}
            aria-controls={`${base}-reabrir`}
            disabled={deshabilitado}
            onClick={() => alternar("reabrir")}
          >
            <Icon name="arrow-counterclockwise" /> Reabrir
            <span className="visually-hidden"> «{r.title}»</span>
          </button>
        )}
        <BotonIcono
          icono="pencil"
          texto="Editar"
          disabled={deshabilitado}
          onClick={onEditar}
        />
        <BotonIcono
          icono={r.archived ? "box-arrow-up" : "archive"}
          texto={r.archived ? "Desarchivar" : "Archivar"}
          disabled={deshabilitado}
          onClick={() =>
            hacer(
              r.archived ? "unarchive" : "archive",
              null,
              r.archived
                ? "Recordatorio desarchivado."
                : "Recordatorio archivado.",
            )
          }
        />
        {puedeConvertirEnTarea &&
          !r.converted_to_task_id &&
          !r.converted_to_task_at && (
            <BotonIcono
              icono="kanban"
              texto="Convertir en tarea"
              disabled={deshabilitado}
              onClick={onConvertir}
            />
          )}
        <BotonIcono
          icono="trash"
          texto="Eliminar"
          peligro
          disabled={deshabilitado}
          onClick={eliminar}
        />
      </div>

      {panel === "posponer" && (
        <PanelDeFecha
          id={`${base}-posponer`}
          titulo="Posponer hasta"
          atajos={ajustes.snooze_presets_minutes}
          boton="Posponer"
          obligatoria
          ocupado={deshabilitado}
          onCancelar={cerrarPanel}
          onElegir={(iso) =>
            hacer(
              "postpone",
              iso,
              `Recordatorio pospuesto al ${fechaHora(iso)}.`,
            )
          }
        />
      )}
      {panel === "reabrir" && (
        <PanelDeFecha
          id={`${base}-reabrir`}
          titulo="Nueva fecha (opcional)"
          boton="Reabrir"
          ocupado={deshabilitado}
          onCancelar={cerrarPanel}
          onElegir={(iso) =>
            hacer(
              "reopen",
              iso,
              iso
                ? `Recordatorio reabierto para el ${fechaHora(iso)}.`
                : "Recordatorio reabierto.",
            )
          }
        />
      )}

      <Historial
        cargar={() => escritorioService.historialDeRecordatorio(r.id)}
      />
    </li>
  );
}

/**
 * Elegir una fecha: los atajos («15 minutos», «Mañana a esta hora») mandan
 * enseguida; la fecha a mano, con su botón. Escape lo cierra. Con
 * `obligatoria`, la fecha a mano no puede ir vacía (posponer); sin ella, sí
 * (reabrir sin mover la fecha).
 */
function PanelDeFecha({
  id,
  titulo,
  atajos = [],
  boton,
  obligatoria = false,
  ocupado,
  onCancelar,
  onElegir,
}) {
  const idCampo = `${id}-fecha`;
  const [valor, setValor] = useState("");
  const [error, setError] = useState(null);
  const campo = useRef(null);

  useEffect(() => {
    // Al campo de fecha, no a un atajo: un atajo actúa al instante y un
    // Enter de más pospondría sin querer (auditoría UX/UI, 06/11/2026).
    campo.current?.focus();
  }, [id]);

  function enviar(evento) {
    evento.preventDefault();
    const iso = deCampoLocal(valor);
    if (obligatoria && !iso) {
      setError("Elija la fecha y la hora, o use un atajo.");
      campo.current?.focus();
      return;
    }
    onElegir(iso);
  }

  return (
    // Escape dentro del panel lo cierra (no hay ventana).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <form
      id={id}
      className="ed-subformulario"
      onSubmit={enviar}
      noValidate
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancelar();
        }
      }}
    >
      {atajos.length > 0 && (
        <fieldset className="ed-atajos">
          <legend className="ed-grupo__titulo">
            {boton}: atajos (se aplican al pulsarlos)
          </legend>
          <div className="ed-acciones">
            {atajos.map((m) => (
              <button
                key={m}
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={ocupado}
                onClick={() => onElegir(dentroDe(m))}
              >
                {textoDePosponer(m)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <label htmlFor={idCampo} className="form-label mb-0">
        {titulo}
      </label>
      <div className="ed-fila-fecha">
        <input
          ref={campo}
          id={idCampo}
          type="datetime-local"
          className={`form-control${error ? " is-invalid" : ""}`}
          min={aCampoLocal(new Date().toISOString())}
          value={valor}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${idCampo}-error` : undefined}
          onChange={(e) => {
            setValor(e.target.value);
            setError(null);
          }}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={ocupado}
        >
          {boton}
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={ocupado}
          onClick={onCancelar}
        >
          Cancelar
        </button>
      </div>
      {error && (
        <p id={`${idCampo}-error`} className="mz-field-error mb-0">
          {error}
        </p>
      )}
    </form>
  );
}
