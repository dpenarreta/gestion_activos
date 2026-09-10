import { useEffect, useState } from "react";

import { getEmpresaActiva } from "../../../api/client";
import { empresasService } from "../../../api/empresasService";
import { rolesService } from "../../../api/rolesService";
import "./Empresas.css";

/**
 * Con qué empresa y qué rol nace una cuenta nueva.
 *
 * Va en el alta y no solo en la ficha porque una cuenta sin empresa ni rol no
 * puede hacer nada: quien entrara así vería un sistema vacío y llamaría a
 * soporte. Dejarlo para un segundo paso garantiza que alguna se quede a medias
 * el día que a quien la crea lo interrumpan entre uno y otro.
 *
 * Un solo rol y no varios: el alta responde a «esta persona entra como qué», y
 * las combinaciones —dos roles en una empresa, roles distintos en cada una— se
 * arman después en la ficha, donde se ve el conjunto.
 */
export function SeleccionEmpresaYRol({ empresaId, rolId, onChange }) {
  const [empresas, setEmpresas] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([empresasService.list({ page_size: 100 }), rolesService.list()])
      .then(([listado, catalogo]) => {
        const activas = (listado.results ?? []).filter(
          (empresa) => empresa.activa,
        );
        setEmpresas(activas);
        setRoles(catalogo ?? []);
        // Se propone la empresa en la que se está trabajando: dar de alta a
        // alguien es, casi siempre, darlo de alta donde uno está.
        const enCurso = Number(getEmpresaActiva());
        const propuesta =
          activas.find((empresa) => empresa.id === enCurso) ?? activas[0];
        if (propuesta) onChange({ empresaId: propuesta.id, rolId });
      })
      .catch(() => setError("No se pudieron cargar las empresas y los roles."));
    // Solo al montar: después manda lo que elija quien está creando la cuenta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <div className="alert alert-warning">{error}</div>;

  return (
    <>
      {empresas.length > 1 && (
        <div className="mb-3">
          <label className="form-label" htmlFor="empresa">
            Empresa
          </label>
          <select
            id="empresa"
            className="form-select"
            value={empresaId ?? ""}
            required
            onChange={(event) =>
              onChange({ empresaId: Number(event.target.value), rolId })
            }
          >
            {empresas.map((empresa) => (
              <option key={empresa.id} value={empresa.id}>
                {empresa.nombre}
              </option>
            ))}
          </select>
          <div className="form-text">
            Solo verá la información de esta empresa. Después se le pueden
            añadir otras desde su ficha.
          </div>
        </div>
      )}

      <div className="mb-3">
        <label className="form-label" htmlFor="rol">
          Rol
        </label>
        <select
          id="rol"
          className="form-select"
          value={rolId ?? ""}
          required
          onChange={(event) =>
            onChange({ empresaId, rolId: Number(event.target.value) })
          }
        >
          <option value="">Seleccione un rol</option>
          {roles.map((rol) => (
            <option key={rol.id} value={rol.id}>
              {rol.name}
            </option>
          ))}
        </select>
        <div className="form-text">
          {empresas.length > 1
            ? "Lo que podrá hacer dentro de la empresa elegida. En otras empresas puede tener uno distinto."
            : "Lo que podrá hacer dentro del sistema."}
        </div>
        {roles.length === 0 && (
          <div className="form-text text-warning">
            No hay roles creados todavía: créelos en Usuarios y roles → Roles y
            permisos.
          </div>
        )}
      </div>
    </>
  );
}
