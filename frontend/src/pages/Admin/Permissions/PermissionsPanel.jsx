import { useState } from "react";

import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { GrupoDePermisos } from "../../../components/common/GrupoDePermisos/GrupoDePermisos";
import { usePermissionsCatalog } from "../../../hooks/usePermissionsCatalog";
import { agruparCatalogo } from "../../../utils/gruposDePermisos";
import "./PermissionsPanel.css";

/**
 * Catálogo de permisos, en solo lectura.
 *
 * Los permisos son una fuente de verdad versionada en código (ver
 * `backend/apps/permissions/catalog.py`), no un recurso editable en runtime:
 * un permiso que no esté en ese archivo no existe para el sistema. Esta vista
 * sirve para consultarlos y saber qué habilita cada uno antes de asignarlo.
 *
 * Se agrupan por la parte del sistema a la que pertenecen —los generales, que
 * valen en todo el sistema, y los de cada módulo—, cada grupo en un acordeón
 * que se abre y se cierra.
 *
 * Es un panel y no una página: vive dentro de la pantalla de Roles, que es
 * donde los permisos efectivamente se asignan.
 */
export function PermissionsPanel() {
  const { catalog, isLoading, error, recargar } = usePermissionsCatalog();
  const [abiertos, setAbiertos] = useState(() => new Set());

  const grupos = agruparCatalogo(catalog);
  const total = grupos.reduce(
    (suma, grupo) =>
      suma +
      grupo.modulos.reduce(
        (parcial, [, modulo]) =>
          parcial + Object.keys(modulo.permissions).length,
        0,
      ),
    0,
  );

  function alternar(id) {
    setAbiertos((actual) => {
      const siguiente = new Set(actual);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  const todosAbiertos =
    grupos.length > 0 && grupos.every((g) => abiertos.has(g.id));

  return (
    <div className="permissions-page">
      <div className="permissions-page__intro">
        <p className="mz-faint mb-0">
          {total > 0 && <strong>{total} permisos</strong>} agrupados en los
          generales del sistema y los de cada módulo. Para otorgarlos, edite un
          rol en la pestaña <strong>Roles</strong> y asígneselo al usuario desde
          su ficha.
        </p>
        {grupos.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() =>
              setAbiertos(
                todosAbiertos ? new Set() : new Set(grupos.map((g) => g.id)),
              )
            }
          >
            {todosAbiertos ? "Cerrar todos" : "Abrir todos"}
          </button>
        )}
      </div>

      {/* Cargando y error como en el resto (auditoría UX/UI, fase 2). */}
      <EstadoDeCarga
        cargando={isLoading}
        error={error}
        onReintentar={recargar}
      />

      {grupos.map((grupo) => {
        const permisos = grupo.modulos.reduce(
          (suma, [, modulo]) => suma + Object.keys(modulo.permissions).length,
          0,
        );
        return (
          <GrupoDePermisos
            key={grupo.id}
            grupo={grupo}
            abierto={abiertos.has(grupo.id)}
            onAlternar={() => alternar(grupo.id)}
            resumen={`${grupo.modulos.length} ${
              grupo.modulos.length === 1 ? "bloque" : "bloques"
            } · ${permisos} permisos`}
          >
            {grupo.modulos.map(([moduleKey, module]) => (
              <section className="mz-card" key={moduleKey}>
                <div className="mz-card-head">
                  <div>
                    <h3>{module.label}</h3>
                    <div className="mz-small mz-faint">
                      {module.description}
                    </div>
                  </div>
                </div>
                {/* Tabla de permisos de la identidad: el nombre que se lee a
                    la izquierda y, a la derecha, el código con el que el
                    servidor lo reconoce —el que hay que buscar en
                    `catalog.py`—. */}
                <table className="mz-perm-table permissions-page__tabla">
                  <thead>
                    <tr>
                      <th>Permiso</th>
                      <th>Código</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(module.permissions).map(
                      ([codename, label]) => (
                        <tr key={codename}>
                          <td>{label}</td>
                          <td className="mz-code">{codename}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </section>
            ))}
          </GrupoDePermisos>
        );
      })}
    </div>
  );
}
