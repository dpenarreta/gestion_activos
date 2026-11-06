/*
 * La bandeja «Hoy» (`TodayInbox` de Nexo, `GET escritorio/today/`): las notas
 * sin leer, los recordatorios pendientes hasta el fin del día, las tareas que
 * vencen en la semana y los proyectos con actividad reciente. Los dos
 * últimos bloques llegan `null` si la persona no entra a Tareas o a
 * Proyectos: entonces no se muestran.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  errorDeEscritorio,
  escritorioService,
} from "../../../api/escritorioService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { fechaHora } from "../comunes";
import { Semaforo } from "../Desempeno/Componentes";
import { ESTADO as ESTADO_TAREA, fechaCorta } from "../Tareas/tareasComunes";
import { useEscritorio } from "./ContextoEscritorio";
import { DetalleNota } from "./DetalleNota";
import { RUTA_PROYECTOS, RUTA_TAREAS, claseDeColor } from "./escritorioComunes";
import { Pildora } from "./Piezas";

export function Hoy({ version, onIrA }) {
  const { prioridadesNota, prioridadesRecordatorio } = useEscritorio();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [vez, setVez] = useState(0);
  const [abierta, setAbierta] = useState(null);
  // Al cerrar una nota se recarga la bandeja y su botón «Leer» desaparece:
  // el foco va al título del bloque (si no, caía en <body>).
  const enfocarNotas = useRef(false);

  useEffect(() => {
    let vigente = true;
    setError(null);
    setDatos(null);
    escritorioService
      .hoy()
      .then((d) => {
        if (vigente) setDatos(d ?? {});
      })
      .catch((err) => {
        if (vigente)
          setError(
            errorDeEscritorio(err, "No se pudo cargar lo de hoy.").mensaje,
          );
      });
    return () => {
      vigente = false;
    };
  }, [vez, version]);

  useEffect(() => {
    if (!datos || !enfocarNotas.current) return;
    enfocarNotas.current = false;
    document.getElementById("ed-hoy-notas")?.focus();
  }, [datos]);

  if (!datos)
    return (
      <EstadoDeCarga
        cargando={!error}
        error={error}
        onReintentar={() => setVez((v) => v + 1)}
      />
    );

  const notas = datos.pending_notes ?? [];
  const recordatorios = datos.today_reminders ?? [];
  const tareas = datos.upcoming_tasks;
  const proyectos = datos.recent_projects;

  return (
    <div className="ed-hoy">
      <Bloque
        id="ed-hoy-notas"
        titulo="Notas sin leer"
        icono="envelope"
        cuenta={notas.length}
        vacio="No tiene notas sin leer."
        pie={
          <button
            type="button"
            className="btn btn-link btn-sm px-0"
            onClick={() => onIrA("notas")}
          >
            Ir a Notas <Icon name="arrow-right" />
          </button>
        }
      >
        {notas.map((n) => (
          <li key={n.id} className={`ed-hoy__nota ${claseDeColor(n.color)}`}>
            <p className="mb-1 mz-small">
              <span className="mz-strong">De {n.sender_name}</span>
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
                Leer{" "}
                <span className="visually-hidden">
                  la nota de {n.sender_name}
                </span>
              </button>
            </div>
          </li>
        ))}
      </Bloque>

      <Bloque
        id="ed-hoy-recordatorios"
        titulo="Recordatorios de hoy"
        icono="alarm"
        cuenta={recordatorios.length}
        vacio="No tiene recordatorios pendientes para hoy."
        pie={
          <button
            type="button"
            className="btn btn-link btn-sm px-0"
            onClick={() => onIrA("recordatorios")}
          >
            Ir a Recordatorios <Icon name="arrow-right" />
          </button>
        }
      >
        {recordatorios.map((r) => (
          <li key={r.id} className="ed-hoy__item">
            <p className="mb-1 mz-strong">{r.title}</p>
            <div className="ed-hoy__fila">
              <span className="mz-small">
                <Icon name="clock" /> {fechaHora(r.due_at)}
              </span>
              <span className="mz-pill-row">
                <Pildora
                  opciones={prioridadesRecordatorio}
                  valor={r.priority}
                />
                {r.overdue && (
                  <Semaforo tono="bad">
                    <Icon name="exclamation-circle" /> Vencido
                  </Semaforo>
                )}
              </span>
            </div>
          </li>
        ))}
      </Bloque>

      {tareas && (
        <Bloque
          id="ed-hoy-tareas"
          titulo="Tareas de esta semana"
          icono="kanban"
          cuenta={tareas.length}
          vacio="No tiene tareas que venzan esta semana."
        >
          {tareas.map((t) => (
            <li key={t.id} className="ed-hoy__item">
              <Link to={`${RUTA_TAREAS}/${t.id}`} className="ed-hoy__enlace">
                {t.title}
              </Link>
              <p className="mz-small mz-faint mb-0">
                Vence el {fechaCorta(t.end_date)} ·{" "}
                {ESTADO_TAREA[t.status] ?? t.status}
              </p>
            </li>
          ))}
        </Bloque>
      )}

      {proyectos && (
        <Bloque
          id="ed-hoy-proyectos"
          titulo="Proyectos con movimiento"
          icono="folder2-open"
          cuenta={proyectos.length}
          vacio="Sus proyectos no tuvieron movimiento estos días."
        >
          {proyectos.map((p) => (
            <li key={p.id} className="ed-hoy__item">
              <Link to={`${RUTA_PROYECTOS}/${p.id}`} className="ed-hoy__enlace">
                {p.name}
              </Link>
              <p className="mz-small mz-faint mb-0">
                Actualizado el {fechaHora(p.updated_at)}
              </p>
            </li>
          ))}
        </Bloque>
      )}

      {abierta && (
        <DetalleNota
          id={abierta.id}
          onCerrar={() => {
            setAbierta(null);
            // La nota ya está leída: sale de «sin leer».
            enfocarNotas.current = true;
            setVez((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function Bloque({ id, titulo, icono, cuenta, vacio, pie, children }) {
  return (
    <section className="mz-card ed-hoy__bloque" aria-labelledby={id}>
      <div className="mz-card-head">
        <h3 id={id} tabIndex={-1}>
          <Icon name={icono} /> {titulo}{" "}
          <span className="mz-faint mz-small">({cuenta})</span>
        </h3>
      </div>
      <div className="mz-card-body">
        {cuenta === 0 ? (
          <p className="mz-small mz-faint mb-0">{vacio}</p>
        ) : (
          <ul className="ed-hoy__lista">{children}</ul>
        )}
        {pie && <div className="mt-2">{pie}</div>}
      </div>
    </section>
  );
}
