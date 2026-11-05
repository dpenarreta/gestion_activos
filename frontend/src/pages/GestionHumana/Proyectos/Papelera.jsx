/*
 * La papelera de proyectos (`ProjectTrashPanel` de Nexo). Restaurar y
 * eliminar para siempre: el creador o el Administrador de Gestión Humana
 * (`can_delete` de cada fila, que el servidor vuelve a revisar). Lo vencido
 * se purga solo; el plazo restante lo calcula el servidor.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  errorDeProyectos,
  proyectosGhService,
} from "../../../api/proyectosGhService";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Aviso } from "../comunes";
import { PanelLateral } from "../Tareas/Ventanas";
import {
  ESTADO_PROYECTO,
  TONO_ESTADO_PROYECTO,
  tiempoParaPurga,
} from "./proyectosComunes";

/** «Se conserva 2 días · » según la retención que aplicó el servidor
 * (`recovery_center_retention_hours`, vigente al enviarlo a la papelera). */
function plazoEnDias(p) {
  if (!p.deleted_at || !p.expires_at) return "";
  const horas = Math.round(
    (new Date(p.expires_at) - new Date(p.deleted_at)) / 3600000,
  );
  if (!(horas > 0)) return "";
  const dias = horas / 24;
  const texto = Number.isInteger(dias)
    ? `${dias} ${dias === 1 ? "día" : "días"}`
    : `${horas} horas`;
  return `Se conserva ${texto} · `;
}

export function Papelera({ onCerrar, onRestaurado }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const enCurso = useRef(false);
  const avisoRef = useRef(null);

  const cargar = useCallback(() => {
    setError(null);
    setItems(null);
    proyectosGhService
      .papelera()
      .then((lista) => setItems(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(
          errorDeProyectos(err, "No se pudo cargar la papelera.").mensaje,
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** La fila desaparece con el botón que tenía el foco: el foco pasa al
   * aviso del resultado, que además lo anuncia. */
  function enfocarAviso() {
    setTimeout(() => avisoRef.current?.focus(), 0);
  }

  async function actuar(item, tipo) {
    if (enCurso.current) return;
    const eliminar = tipo === "eliminar";
    const seguir = await confirmar(
      eliminar
        ? {
            titulo: `¿Eliminar «${item.name}» para siempre?`,
            mensaje:
              "Se borran el proyecto, sus fases, actividades, comentarios, documentos e historial. No se puede deshacer.",
            accion: "Eliminar para siempre",
          }
        : {
            titulo: `¿Restaurar «${item.name}»?`,
            mensaje:
              "Vuelve al listado de proyectos con sus fases, participantes y documentos.",
            accion: "Restaurar",
            peligro: false,
          },
    );
    if (!seguir) return;
    enCurso.current = true;
    setOcupado(item.id);
    try {
      if (eliminar) await proyectosGhService.eliminarParaSiempre(item.id);
      else await proyectosGhService.restaurar(item.id);
      setItems((lista) => lista.filter((p) => p.id !== item.id));
      setAviso({
        texto: eliminar
          ? `«${item.name}» se eliminó para siempre.`
          : `«${item.name}» se restauró.`,
      });
      if (!eliminar) onRestaurado?.();
    } catch (err) {
      setAviso({
        tono: "bad",
        texto: errorDeProyectos(
          err,
          eliminar
            ? "No se pudo eliminar el proyecto."
            : "No se pudo restaurar el proyecto.",
        ).mensaje,
      });
    } finally {
      enCurso.current = false;
      setOcupado(null);
      enfocarAviso();
    }
  }

  return (
    <PanelLateral
      titulo="Papelera"
      subtitulo="Proyectos eliminados, pendientes de eliminación automática."
      onCerrar={onCerrar}
    >
      <div ref={avisoRef} tabIndex={-1} className="gp-aviso-foco">
        <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
      </div>
      <EstadoDeCarga
        cargando={items === null && !error}
        error={error}
        onReintentar={cargar}
        vacio={items?.length === 0}
        textoVacio="La papelera está vacía."
      />
      {items?.length > 0 && (
        <ul className="gp-papelera">
          {items.map((p) => (
            <li key={p.id} className="gp-papelera__item">
              <p className="mz-strong mb-1">{p.name}</p>
              <p className="mz-small mb-1">
                <span
                  className={`mz-pill ${TONO_ESTADO_PROYECTO[p.status] ?? "mz-pill--neutral"}`}
                >
                  {ESTADO_PROYECTO[p.status] ?? p.status}
                </span>{" "}
                <span className="mz-faint">
                  Responsable: {p.responsible?.name ?? "—"}
                </span>
              </p>
              <p className="mz-small gt-texto--warn mb-2">
                {plazoEnDias(p)}
                {tiempoParaPurga(p.ms_remaining)}
              </p>
              {p.can_delete ? (
                <div className="gp-botones">
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    disabled={ocupado === p.id}
                    onClick={() => actuar(p, "restaurar")}
                  >
                    Restaurar
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    disabled={ocupado === p.id}
                    onClick={() => actuar(p, "eliminar")}
                  >
                    Eliminar para siempre
                  </button>
                </div>
              ) : (
                <p className="mz-small mz-faint mb-0">
                  Solo {p.created_by?.name ?? "quien lo creó"} (creador) o el
                  Administrador de Gestión Humana pueden restaurarlo o
                  eliminarlo.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </PanelLateral>
  );
}
