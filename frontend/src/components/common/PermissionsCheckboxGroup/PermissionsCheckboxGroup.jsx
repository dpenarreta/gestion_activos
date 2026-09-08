import { useEffect, useRef, useState } from "react";

import "./PermissionsCheckboxGroup.css";

/**
 * Selector de permisos agrupados por módulo, con buscador, filtro de
 * módulo, checkbox "seleccionar todo/ninguno" por módulo (con estado
 * indeterminado real) y resumen de seleccionados.
 *
 * `catalog`: { [moduloKey]: { label, description, permissions: { codename: nombre } } }
 * `selected`: Set<string> de codenames seleccionados.
 * `onChange`: (nextSelectedSet) => void
 */
export function PermissionsCheckboxGroup({ catalog, selected, onChange }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");

  const moduleEntries = Object.entries(catalog);
  const allCodenames = moduleEntries.flatMap(([, module]) => Object.keys(module.permissions));
  const selectedCount = allCodenames.filter((codename) => selected.has(codename)).length;
  const normalizedSearch = searchTerm.trim().toLowerCase();

  function toggleModule(codenames, shouldSelect) {
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
    const next = new Set(selected);
    if (checked) {
      next.add(codename);
    } else {
      next.delete(codename);
    }
    onChange(next);
  }

  return (
    <div className="permissions-checkbox-group">
      <div className="row g-2 mb-2">
        <div className="col-auto">
          <input
            className="form-control form-control-sm"
            placeholder="Buscar permiso"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
        <div className="col-auto">
          <select
            className="form-select form-select-sm"
            value={moduleFilter}
            onChange={(event) => setModuleFilter(event.target.value)}
          >
            <option value="">Todos los módulos</option>
            {moduleEntries.map(([moduleKey, module]) => (
              <option key={moduleKey} value={moduleKey}>
                {module.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="permissions-checkbox-group__summary">
        {selectedCount} de {allCodenames.length} permisos seleccionados
      </p>

      {moduleEntries
        .filter(([moduleKey]) => !moduleFilter || moduleKey === moduleFilter)
        .map(([moduleKey, module]) => {
          const permissionEntries = Object.entries(module.permissions).filter(
            ([codename, name]) =>
              !normalizedSearch ||
              codename.toLowerCase().includes(normalizedSearch) ||
              name.toLowerCase().includes(normalizedSearch)
          );
          if (permissionEntries.length === 0) {
            return null;
          }

          const moduleCodenames = Object.keys(module.permissions);
          const selectedInModule = moduleCodenames.filter((codename) => selected.has(codename)).length;

          return (
            <ModuleSection
              key={moduleKey}
              moduleKey={moduleKey}
              module={module}
              permissionEntries={permissionEntries}
              allSelected={selectedInModule === moduleCodenames.length}
              noneSelected={selectedInModule === 0}
              selected={selected}
              onToggleModule={(shouldSelect) => toggleModule(moduleCodenames, shouldSelect)}
              onTogglePermission={togglePermission}
            />
          );
        })}
    </div>
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
    <div className="card mb-2 permissions-module">
      <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div className="form-check mb-0">
          <input
            ref={headerCheckboxRef}
            type="checkbox"
            className="form-check-input"
            checked={allSelected}
            onChange={(event) => onToggleModule(event.target.checked)}
            id={`module-${moduleKey}`}
          />
          <label className="form-check-label fw-semibold" htmlFor={`module-${moduleKey}`}>
            {module.label}
          </label>
        </div>
        <small className="text-muted">{module.description}</small>
      </div>
      <div className="card-body py-2">
        {permissionEntries.map(([codename, name]) => (
          <div className="form-check" key={codename}>
            <input
              type="checkbox"
              className="form-check-input"
              id={`permission-${codename}`}
              checked={selected.has(codename)}
              onChange={(event) => onTogglePermission(codename, event.target.checked)}
            />
            <label className="form-check-label" htmlFor={`permission-${codename}`}>
              {name} <code className="permissions-checkbox-group__codename">{codename}</code>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
