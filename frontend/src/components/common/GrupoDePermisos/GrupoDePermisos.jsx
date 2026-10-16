import { useId } from "react";

import { Icon } from "../Icon/Icon";
import "./GrupoDePermisos.css";

/**
 * Un grupo del catálogo de permisos como sección de acordeón: el encabezado
 * dice qué grupo es, si sus permisos son generales o de un módulo y cuántos
 * tiene; el cuerpo, los bloques del grupo.
 *
 * `extra` va en el encabezado, fuera del botón que abre y cierra (por ejemplo,
 * la casilla de «seleccionar todo el grupo» del formulario de rol): un control
 * dentro de otro botón no se puede usar con teclado.
 */
export function GrupoDePermisos({
  grupo,
  abierto,
  onAlternar,
  resumen,
  extra,
  children,
}) {
  const idCuerpo = useId();
  const general = grupo.alcance === "general";

  return (
    <section
      className={`mz-card grupo-permisos${abierto ? " is-open" : ""}`}
      aria-label={grupo.label}
    >
      <div className="grupo-permisos__cabecera">
        {extra}
        <button
          type="button"
          className="grupo-permisos__boton"
          aria-expanded={abierto}
          aria-controls={idCuerpo}
          onClick={onAlternar}
        >
          <span className="grupo-permisos__titulo">
            <strong>{grupo.label}</strong>
            <span
              className={`mz-pill ${general ? "grupo-permisos__general" : "mz-pill--neutral"}`}
            >
              {general ? "General" : "Módulo"}
            </span>
          </span>
          <span className="grupo-permisos__resumen mz-small mz-faint">
            {resumen}
          </span>
          <Icon
            name={abierto ? "chevron-up" : "chevron-down"}
            className="grupo-permisos__chevron"
          />
        </button>
      </div>
      {grupo.description && (
        <p className="grupo-permisos__descripcion mz-small mz-faint">
          {grupo.description}
        </p>
      )}
      <div id={idCuerpo} hidden={!abierto} className="grupo-permisos__cuerpo">
        {children}
      </div>
    </section>
  );
}
