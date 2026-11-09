import { useEffect, useState } from "react";

import { getEmpresaActiva } from "../../../api/client";
import { empresasService } from "../../../api/empresasService";
import { rolesService } from "../../../api/rolesService";
import { Campo } from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import { rolesElegibles } from "./rolesElegibles";
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
 *
 * Solo se ofrecen los roles que se eligen a mano, por orden alfabético: los
 * de cargo del organigrama eran la mayoría del catálogo, el servidor los
 * descarta si se envían a mano y el rol buscado quedaba enterrado entre ellos
 * (06/11/2026). No se agrupan con `<optgroup>`: el catálogo no trae área ni
 * nivel de los roles manuales, y quedan pocos.
 *
 * Los de cargo se dan eligiendo el cargo: quien puede asignar cargos recibe
 * ese campo en `campoCargo`, entre la empresa (los cargos son de ella) y el
 * rol. Con un cargo elegido, el rol deja de ser obligatorio (`rolOpcional`):
 * la cuenta ya tiene el de su cargo (09/11/2026).
 */
export function SeleccionEmpresaYRol({
  empresaId,
  rolId,
  onChange,
  errores = {},
  campoCargo = null,
  ofreceCargo = Boolean(campoCargo),
  rolOpcional = false,
}) {
  const [empresas, setEmpresas] = useState([]);
  // `null` mientras carga: con `[]` se leía «No hay roles creados todavía»
  // durante los segundos de la carga (auditoría UX/UI, 06/11/2026).
  const [roles, setRoles] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([empresasService.list({ page_size: 100 }), rolesService.list()])
      .then(([listado, catalogo]) => {
        const activas = (listado.results ?? []).filter(
          (empresa) => empresa.activa,
        );
        setEmpresas(activas);
        setRoles(rolesElegibles(catalogo));
        // Se propone la empresa en la que se está trabajando: dar de alta a
        // alguien es, casi siempre, darlo de alta donde uno está.
        const enCurso = Number(getEmpresaActiva());
        const propuesta =
          activas.find((empresa) => empresa.id === enCurso) ?? activas[0];
        // Marcada como propuesta: la elige el sistema, no quien crea la
        // cuenta, y no cuenta como cambio sin guardar al salir.
        if (propuesta)
          onChange({ empresaId: propuesta.id, rolId }, { propuesta: true });
      })
      .catch(() => setError("No se pudieron cargar las empresas y los roles."));
    // Solo al montar: después manda lo que elija quien está creando la cuenta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="mz-alert mz-alert--warn" role="alert">
        <Icon name="exclamation-triangle" />
        {error}
      </div>
    );
  }

  // Con `Campo`, como el resto del alta: obligatorio marcado, ayuda y error
  // enlazados y sin `required`, cuya burbuja del navegador tapaba el error
  // propio (auditoría UX/UI, 06/11/2026). Lo valida `UserForm` al enviar.
  return (
    <div className="mz-field-grid">
      {empresas.length > 1 && (
        <Campo
          id="empresa"
          etiqueta="Empresa"
          obligatorio
          error={errores.empresa}
          ayuda="Solo verá la información de esta empresa. Después se le pueden añadir otras desde su ficha."
        >
          <select
            className="form-select"
            value={empresaId ?? ""}
            onChange={(event) =>
              onChange({
                empresaId: event.target.value
                  ? Number(event.target.value)
                  : null,
                rolId,
              })
            }
          >
            {empresas.map((empresa) => (
              <option key={empresa.id} value={empresa.id}>
                {empresa.nombre}
              </option>
            ))}
          </select>
        </Campo>
      )}

      {campoCargo && <div className="mz-field--full">{campoCargo}</div>}

      <div>
        <Campo
          id="rol"
          etiqueta={rolOpcional ? "Rol adicional (opcional)" : "Rol"}
          obligatorio={!rolOpcional}
          error={errores.rol}
          ayuda={`${
            rolOpcional
              ? "Solo si necesita algo más de lo que le da su cargo."
              : empresas.length > 1
                ? "Lo que podrá hacer dentro de la empresa elegida. En otras empresas puede tener uno distinto."
                : "Lo que podrá hacer dentro del sistema."
          } ${
            // `ofreceCargo` y no `campoCargo`: en una empresa ajena el hueco
            // lleva una nota, no el selector, y no se puede elegir «arriba».
            ofreceCargo
              ? "Los roles de un cargo (p. ej. Jefe de Cartera) se dan eligiendo el cargo arriba."
              : "Los roles de los cargos del organigrama no se eligen aquí: los recibe al ocupar su cargo."
          }`}
        >
          <select
            className="form-select"
            value={rolId ?? ""}
            disabled={roles === null}
            onChange={(event) =>
              // Volver a «Seleccione un rol» es no tener rol (null), no el
              // rol 0 (auditoría UX/UI, 06/11/2026).
              onChange({
                empresaId,
                rolId: event.target.value ? Number(event.target.value) : null,
              })
            }
          >
            <option value="">
              {roles === null
                ? "Cargando roles…"
                : rolOpcional
                  ? "Sin rol adicional"
                  : "Seleccione un rol"}
            </option>
            {(roles ?? []).map((rol) => (
              <option key={rol.id} value={rol.id}>
                {rol.name}
              </option>
            ))}
          </select>
        </Campo>
        {roles !== null && roles.length === 0 && (
          <div className="mz-small mz-warn mt-1">
            <Icon name="exclamation-triangle" /> No hay roles creados todavía:
            créelos en Usuarios y roles → Roles y permisos.
          </div>
        )}
      </div>
    </div>
  );
}
