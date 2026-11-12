/*
 * Pestaña «Causas» (`llamados.configurar`): las causas con sus niveles y el
 * alta y la edición de cada una. Una causa ya usada no se borra: se
 * desactiva (casilla «Causa activa» del formulario), para conservar el
 * historial.
 */
import { useState } from "react";

import { FilaDeEstado } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { Aviso } from "../comunes";
import { FormularioCausa } from "./FormularioCausa";

export function CausasLlamados({
  causas,
  cargando,
  error,
  variables,
  errorVariables,
  onReintentar,
  onGuardada,
}) {
  const [editando, setEditando] = useState(null);
  const [aviso, setAviso] = useState(null);

  return (
    <div className="mz-stack">
      <div>
        <button
          type="button"
          className="btn btn-primary mz-tactil"
          onClick={() => setEditando("nueva")}
        >
          <Icon name="plus-lg" /> Nueva causa
        </button>
      </div>
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
      {errorVariables && (
        <div className="mz-alert mz-alert--warn" role="alert">
          <Icon name="exclamation-triangle" />
          <span>
            {errorVariables} Las plantillas se pueden editar, pero sin la lista
            de variables.
          </span>
        </div>
      )}
      <div className="mz-table-wrap" aria-busy={cargando}>
        <table className="mz-table">
          <caption className="visually-hidden">Causas de llamados</caption>
          <thead>
            <tr>
              <th scope="col">Causa</th>
              <th scope="col">Reincidencia</th>
              <th scope="col">Niveles</th>
              <th scope="col">Estado</th>
              <th scope="col">
                <span className="visually-hidden">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {causas.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.nombre}
                  {c.descripcion && (
                    <div className="mz-small mz-faint">{c.descripcion}</div>
                  )}
                </td>
                <td>
                  {c.plazo_reincidencia_meses ?? c.plazo_reincidencia} meses
                </td>
                <td>
                  <ol className="mb-0 ps-3 mz-small">
                    {(c.niveles ?? []).map((n) => (
                      <li key={n.id}>
                        {n.nombre}
                        {n.activo === false && " (desactivado)"}
                      </li>
                    ))}
                  </ol>
                </td>
                <td>
                  <span
                    className={`mz-pill mz-pill--${c.activa === false ? "neutral" : "ok"}`}
                  >
                    {c.activa === false ? "Inactiva" : "Activa"}
                  </span>
                </td>
                <td className="num">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm mz-tactil"
                    onClick={() => setEditando(c)}
                  >
                    Editar
                    <span className="visually-hidden">
                      {" "}
                      la causa {c.nombre}
                    </span>
                  </button>
                </td>
              </tr>
            ))}
            <FilaDeEstado
              columnas={5}
              cargando={cargando}
              error={error}
              onReintentar={onReintentar}
              vacio={!cargando && !error && causas.length === 0}
              textoVacio="Aún no hay causas de llamados de atención."
              accionVacio={
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setEditando("nueva")}
                >
                  Crear la primera
                </button>
              }
            />
          </tbody>
        </table>
      </div>
      {editando && (
        <FormularioCausa
          causa={editando === "nueva" ? null : editando}
          variables={variables}
          onCerrar={() => setEditando(null)}
          onGuardado={(guardada, fueEdicion) => {
            setEditando(null);
            setAviso({
              texto: fueEdicion
                ? "La causa quedó actualizada."
                : "La causa quedó creada.",
            });
            onGuardada(guardada);
          }}
        />
      )}
    </div>
  );
}
