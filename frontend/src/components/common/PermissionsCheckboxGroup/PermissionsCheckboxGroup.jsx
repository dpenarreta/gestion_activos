import { useEffect, useRef, useState } from "react";

import {
  agruparCatalogo,
  codigosDelGrupo,
} from "../../../utils/gruposDePermisos";
import { GrupoDePermisos } from "../GrupoDePermisos/GrupoDePermisos";
import "./PermissionsCheckboxGroup.css";

/**
 * Selector de permisos agrupados por la parte del sistema a la que pertenecen
 * —los generales y los de cada módulo—, cada grupo en un acordeón que se abre
 * y se cierra. Dentro, sus bloques, con buscador, filtro de bloque, casilla
 * «seleccionar todo/ninguno» por grupo y por bloque (con estado indeterminado
 * real) y resumen de seleccionados.
 *
 * Mientras se busca o se filtra, los grupos con resultados se muestran
 * abiertos: lo encontrado no puede quedar escondido detrás de un acordeón.
 *
 * `catalog`: { [moduloKey]: { label, description, grupo, permissions: { codename: nombre } } }
 * `selected`: Set<string> de codenames seleccionados.
 * `onChange`: (nextSelectedSet) => void
 */
export function PermissionsCheckboxGroup({ catalog, selected, onChange }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [abiertos, setAbiertos] = useState(() => new Set());

  const grupos = agruparCatalogo(catalog);
  const allCodenames = grupos.flatMap(codigosDelGrupo);
  const selectedCount = allCodenames.filter((codename) =>
    selected.has(codename),
  ).length;
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filtrando = Boolean(normalizedSearch || moduleFilter);

  function toggleCodenames(codenames, shouldSelect) {
    const next = new Set(selected);
    codenames.forEach((codename) => {
      if (shouldSelect) {
        next.add(codename);
      } else {
        next.delete(codename);
      }
    });
    onChange(next);
  }

  function togglePermission(codename, checked) {
    toggleCodenames([codename], checked);
  }

  function alternar(id) {
    setAbiertos((actual) => {
      const siguiente = new Set(actual);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  return (
    <div className="permissions-checkbox-group">
      <div className="mz-filter-bar permissions-checkbox-group__filtros">
        <div>
          <input
            className="form-control form-control-sm"
            placeholder="Buscar permiso"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
        <div>
          <select
            className="form-select form-select-sm"
            value={moduleFilter}
            onChange={(event) => setModuleFilter(event.target.value)}
            aria-label="Filtrar por bloque"
          >
            <option value="">Todos los módulos</option>
            {grupos.map((grupo) => (
              <optgroup key={grupo.id} label={grupo.label}>
                {grupo.modulos.map(([moduleKey, module]) => (
                  <option key={moduleKey} value={moduleKey}>
                    {module.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <p className="permissions-checkbox-group__summary">
        {selectedCount} de {allCodenames.length} permisos seleccionados
      </p>

      {grupos.map((grupo) => {
        const bloques = grupo.modulos
          .filter(([moduleKey]) => !moduleFilter || moduleKey === moduleFilter)
          .map(([moduleKey, module]) => [
            moduleKey,
            module,
            Object.entries(module.permissions).filter(
              ([codename, name]) =>
                !normalizedSearch ||
                codename.toLowerCase().includes(normalizedSearch) ||
                name.toLowerCase().includes(normalizedSearch),
            ),
          ])
          .filter(([, , entradas]) => entradas.length > 0);
        if (bloques.length === 0) {
          return null;
        }

        const codigos = codigosDelGrupo(grupo);
        const enGrupo = codigos.filter((c) => selected.has(c)).length;

        return (
          <GrupoDePermisos
            key={grupo.id}
            grupo={grupo}
            abierto={filtrando || abiertos.has(grupo.id)}
            onAlternar={() => alternar(grupo.id)}
            resumen={`${enGrupo} de ${codigos.length} seleccionados`}
            extra={
              <CasillaDeTodos
                id={`grupo-${grupo.id}`}
                etiqueta={`Todo ${grupo.label}`}
                todos={enGrupo === codigos.length}
                ninguno={enGrupo === 0}
                onChange={(marcar) => toggleCodenames(codigos, marcar)}
              />
            }
          >
            {bloques.map(([moduleKey, module, permissionEntries]) => {
              const moduleCodenames = Object.keys(module.permissions);
              const selectedInModule = moduleCodenames.filter((codename) =>
                selected.has(codename),
              ).length;

              return (
                <ModuleSection
                  key={moduleKey}
                  moduleKey={moduleKey}
                  module={module}
                  permissionEntries={permissionEntries}
                  allSelected={selectedInModule === moduleCodenames.length}
                  noneSelected={selectedInModule === 0}
                  selected={selected}
                  onToggleModule={(shouldSelect) =>
                    toggleCodenames(moduleCodenames, shouldSelect)
                  }
                  onTogglePermission={togglePermission}
                />
              );
            })}
          </GrupoDePermisos>
        );
      })}
    </div>
  );
}

/** Casilla de «todos o ninguno», con estado indeterminado si hay algunos. */
function CasillaDeTodos({ id, etiqueta, todos, ninguno, onChange }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = !todos && !ninguno;
    }
  }, [todos, ninguno]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="form-check-input mt-0"
      checked={todos}
      onChange={(event) => onChange(event.target.checked)}
      id={id}
      aria-label={etiqueta}
    />
  );
}

function ModuleSection({
  moduleKey,
  module,
  permissionEntries,
  allSelected,
  noneSelected,
  selected,
  onToggleModule,
  onTogglePermission,
}) {
  const headerCheckboxRef = useRef(null);

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = !allSelected && !noneSelected;
    }
  }, [allSelected, noneSelected]);

  return (
    <div className="mz-card permissions-module">
      <div className="mz-card-head flex-wrap gap-2">
        <div className="form-check mb-0">
          <input
            ref={headerCheckboxRef}
            type="checkbox"
            className="form-check-input"
            checked={allSelected}
            onChange={(event) => onToggleModule(event.target.checked)}
            id={`module-${moduleKey}`}
          />
          <label
            className="form-check-label fw-semibold"
            htmlFor={`module-${moduleKey}`}
          >
            {module.label}
          </label>
        </div>
        <small className="mz-small mz-faint">{module.description}</small>
      </div>
      <div className="mz-card-body">
        {permissionEntries.map(([codename, name]) => (
          <div className="form-check" key={codename}>
            <input
              type="checkbox"
              className="form-check-input"
              id={`permission-${codename}`}
              checked={selected.has(codename)}
              onChange={(event) =>
                onTogglePermission(codename, event.target.checked)
              }
            />
            <label
              className="form-check-label"
              htmlFor={`permission-${codename}`}
            >
              {name}{" "}
              <code className="permissions-checkbox-group__codename">
                {codename}
              </code>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
