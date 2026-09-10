import { useEffect, useState } from "react";

import { adminUsersService } from "../../../api/adminUsersService";
import { empresasService } from "../../../api/empresasService";
import { rolesService } from "../../../api/rolesService";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Empresas.css";

/**
 * A qué empresas entra una cuenta y qué puede hacer en cada una.
 *
 * Van juntas porque son una sola decisión. Dar acceso a una empresa sin decir
 * a qué, o decir a qué sin dar el acceso, son estados a medias que alguien
 * tendría que acordarse de completar; y el rol es justamente lo que convierte
 * «ve LaarSeguridad» en «puede dar de baja equipos de LaarSeguridad».
 *
 * Va en la ficha del usuario y no en la de la empresa porque la pregunta que se
 * hace de verdad es «qué ve esta persona», no «quiénes ven esta empresa»: tanto
 * el alta de un empleado como la revisión de un acceso se miran cuenta a cuenta.
 *
 * Los roles globales van aparte y exigen otro permiso (`usuarios.editar`): valen
 * en todas las empresas, incluidas las que se creen mañana, así que conceder uno
 * no es lo mismo que dar acceso a una empresa concreta.
 */
export function AsignacionEmpresas({ usuarioId }) {
  const puedeVer = usePermission("empresas.ver");
  const puedeAsignar = usePermission("empresas.asignar");
  const puedeRolesGlobales = usePermission("usuarios.editar");

  const [empresas, setEmpresas] = useState([]);
  const [roles, setRoles] = useState([]);
  const [sinCatalogoDeRoles, setSinCatalogoDeRoles] = useState(false);
  const [asignadas, setAsignadas] = useState({});
  const [predeterminada, setPredeterminada] = useState(null);
  const [rolesGlobales, setRolesGlobales] = useState([]);
  const [esSuperusuario, setEsSuperusuario] = useState(false);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!puedeVer || !usuarioId) return;
    Promise.all([
      empresasService.list({ page_size: 100 }),
      adminUsersService.get(usuarioId),
      // Sin `roles.ver` el catálogo no se puede leer, pero las empresas sí se
      // pueden seguir asignando: se degrada la columna, no la pantalla.
      rolesService.list().catch(() => null),
    ])
      .then(([listado, usuario, catalogo]) => {
        setEmpresas(listado.results ?? []);
        setRoles(catalogo ?? []);
        setSinCatalogoDeRoles(catalogo === null);
        const membresias = usuario.empresas ?? [];
        setAsignadas(
          Object.fromEntries(
            membresias.map((empresa) => [
              empresa.id,
              (empresa.roles ?? []).map((rol) => rol.id),
            ]),
          ),
        );
        setPredeterminada(
          membresias.find((empresa) => empresa.es_predeterminada)?.id ?? null,
        );
        setRolesGlobales((usuario.roles ?? []).map((rol) => rol.id));
        setEsSuperusuario(Boolean(usuario.is_superuser));
      })
      .catch(() => setError("No se pudieron cargar las empresas."));
  }, [usuarioId, puedeVer]);

  function alternarEmpresa(empresaId) {
    setMensaje(null);
    setAsignadas((actuales) => {
      const siguiente = { ...actuales };
      if (empresaId in siguiente) {
        delete siguiente[empresaId];
        // Quitar la predeterminada dejaría al usuario entrando cada día en una
        // empresa que ya no puede ver.
        if (predeterminada === empresaId) {
          const quedan = Object.keys(siguiente).map(Number);
          setPredeterminada(quedan[0] ?? null);
        }
      } else {
        siguiente[empresaId] = [];
        if (predeterminada === null) setPredeterminada(empresaId);
      }
      return siguiente;
    });
  }

  function alternarRol(empresaId, rolId) {
    setMensaje(null);
    setAsignadas((actuales) => {
      const propios = actuales[empresaId] ?? [];
      return {
        ...actuales,
        [empresaId]: propios.includes(rolId)
          ? propios.filter((id) => id !== rolId)
          : [...propios, rolId],
      };
    });
  }

  function alternarRolGlobal(rolId) {
    setMensaje(null);
    setRolesGlobales((actuales) =>
      actuales.includes(rolId)
        ? actuales.filter((id) => id !== rolId)
        : [...actuales, rolId],
    );
  }

  async function guardar() {
    setIsSaving(true);
    setError(null);
    setMensaje(null);
    try {
      if (puedeAsignar) {
        await adminUsersService.assignEmpresas(
          usuarioId,
          Object.entries(asignadas).map(([empresaId, rolesDeLaEmpresa]) => ({
            empresa_id: Number(empresaId),
            roles: rolesDeLaEmpresa,
            es_predeterminada: Number(empresaId) === predeterminada,
          })),
        );
      }
      if (puedeRolesGlobales) {
        await adminUsersService.assignRoles(usuarioId, rolesGlobales);
      }
      setMensaje("Empresas y roles actualizados.");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudieron guardar los accesos."));
    } finally {
      setIsSaving(false);
    }
  }

  if (!puedeVer) return null;

  return (
    <div className="empresas-asignacion mt-4">
      <h5>Empresas y roles</h5>
      <p className="text-muted">
        Solo verá la información de las empresas marcadas, y en cada una podrá
        hacer lo que digan los roles que tenga ahí. La predeterminada es la que
        se abre al entrar.
      </p>

      {error && <div className="alert alert-danger">{error}</div>}
      {mensaje && <div className="alert alert-success">{mensaje}</div>}

      {empresas.length === 1 && (
        <div className="alert alert-info">
          {/* Con una sola empresa no hay de quién aislarse, y el backend deja
              trabajar en ella aunque nadie haya marcado nada: decirlo aquí
              evita que se lea como un permiso que falta. */}
          Hay una sola empresa: todas las cuentas trabajan en ella aunque no se
          marque nada. La asignación empieza a decidir en cuanto exista una
          segunda.
        </div>
      )}

      {sinCatalogoDeRoles && (
        <div className="alert alert-warning">
          No se pudo leer el catálogo de roles (hace falta el permiso
          «roles.ver»). Puede asignar empresas, pero no los roles de cada una.
        </div>
      )}

      <div className="table-responsive">
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Empresa</th>
              <th className="text-center">Asignada</th>
              <th className="text-center">Predeterminada</th>
              <th>Roles en esta empresa</th>
            </tr>
          </thead>
          <tbody>
            {empresas.map((empresa) => {
              const estaAsignada = empresa.id in asignadas;
              return (
                <tr key={empresa.id}>
                  <td>
                    {empresa.nombre}
                    {!empresa.activa && (
                      <span className="badge text-bg-secondary ms-2">
                        Inactiva
                      </span>
                    )}
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      aria-label={`Asignar ${empresa.nombre}`}
                      checked={estaAsignada}
                      disabled={!puedeAsignar}
                      onChange={() => alternarEmpresa(empresa.id)}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="radio"
                      name="empresa-predeterminada"
                      className="form-check-input"
                      aria-label={`${empresa.nombre} como predeterminada`}
                      checked={predeterminada === empresa.id}
                      disabled={!puedeAsignar || !estaAsignada}
                      onChange={() => setPredeterminada(empresa.id)}
                    />
                  </td>
                  <td>
                    <div className="empresas-asignacion__roles">
                      {roles.map((rol) => (
                        <div className="form-check" key={rol.id}>
                          <input
                            type="checkbox"
                            className="form-check-input"
                            id={`rol-${empresa.id}-${rol.id}`}
                            checked={(asignadas[empresa.id] ?? []).includes(
                              rol.id,
                            )}
                            disabled={!puedeAsignar || !estaAsignada}
                            onChange={() => alternarRol(empresa.id, rol.id)}
                          />
                          <label
                            className="form-check-label"
                            htmlFor={`rol-${empresa.id}-${rol.id}`}
                          >
                            {rol.name}
                          </label>
                        </div>
                      ))}
                      {roles.length === 0 && (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                    {/* Sin rol ve la empresa en el selector pero no puede
                        abrir nada dentro: se dice aquí y no en un error
                        posterior, cuando ya se guardó. */}
                    {/* El superusuario se salta los permisos: avisarle de
                        que no verá nada sería falso. */}
                    {estaAsignada &&
                      !esSuperusuario &&
                      (asignadas[empresa.id] ?? []).length === 0 &&
                      rolesGlobales.length === 0 && (
                        <div className="form-text text-warning">
                          Sin rol aquí: entrará a la empresa pero no verá nada
                          dentro.
                        </div>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h6 className="mt-3">Roles en todas las empresas</h6>
      <p className="text-muted">
        Valen en cualquier empresa, incluidas las que se creen después. Son los
        del administrador del grupo, que tiene que poder entrar a todas.
      </p>
      <div className="empresas-asignacion__roles mb-3">
        {roles.map((rol) => (
          <div className="form-check" key={rol.id}>
            <input
              type="checkbox"
              className="form-check-input"
              id={`rol-global-${rol.id}`}
              checked={rolesGlobales.includes(rol.id)}
              disabled={!puedeRolesGlobales}
              onChange={() => alternarRolGlobal(rol.id)}
            />
            <label
              className="form-check-label"
              htmlFor={`rol-global-${rol.id}`}
            >
              {rol.name}
            </label>
          </div>
        ))}
        {roles.length === 0 && <span className="text-muted">—</span>}
      </div>

      {(puedeAsignar || puedeRolesGlobales) && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={isSaving}
          onClick={guardar}
        >
          {isSaving ? "Guardando…" : "Guardar empresas y roles"}
        </button>
      )}
    </div>
  );
}
