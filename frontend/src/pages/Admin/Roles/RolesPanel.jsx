import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { rolesService } from "../../../api/rolesService";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { FilaDeEstado } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./RolesPanel.css";

/**
 * Listado de roles.
 *
 * Es un panel y no una página completa: vive dentro de `RolesPage`, que aporta
 * el encabezado y las pestañas compartidas con el catálogo de permisos. Por
 * eso «Nuevo rol» va en la barra del panel y no en el encabezado de la vista:
 * en la pestaña del catálogo no hay nada que crear.
 */
export function RolesPanel() {
  const puedeEditar = usePermission("roles.editar");
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [eliminando, setEliminando] = useState(false);
  const [aEliminar, setAEliminar] = useState(null);

  function loadRoles() {
    setIsLoading(true);
    setErrorCarga(null);
    rolesService
      .list()
      .then(setRoles)
      .catch((err) =>
        setErrorCarga(
          mensajeDeError(err, "No se pudo cargar el listado de roles."),
        ),
      )
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadRoles();
  }, []);

  async function confirmarEliminacion() {
    setEliminando(true);
    try {
      await rolesService.remove(aEliminar.id);
      setAEliminar(null);
      setError(null);
      loadRoles();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo eliminar el rol."));
      setAEliminar(null);
    } finally {
      setEliminando(false);
    }
  }

  return (
    <div className="roles-list-page">
      <div className="roles-list-barra">
        <p className="mz-faint mb-0">
          Un rol agrupa permisos. Se asigna a un usuario desde su ficha, en{" "}
          <Link to="/admin/users">Usuarios</Link>.
        </p>
        {puedeEditar && (
          <Link to="/admin/roles/new" className="btn btn-primary btn-sm">
            <Icon name="plus-lg" /> Nuevo rol
          </Link>
        )}
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th className="num">Permisos</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {/* Cargando, error con reintento y vacío dentro de la tabla
                (auditoría UX/UI, fase 2, 28/10/2026). */}
            <FilaDeEstado
              columnas={3}
              cargando={isLoading && roles.length === 0}
              error={errorCarga}
              onReintentar={loadRoles}
              vacio={!isLoading && roles.length === 0}
              textoVacio="Todavía no hay roles registrados."
            />
            {!errorCarga &&
              roles.map((role) => (
                <tr key={role.id}>
                  <td className="mz-strong">
                    {role.name}
                    {role.cargo && (
                      <span className="d-block mz-small mz-faint fw-normal">
                        <Icon name="diagram-3" /> Cargo del organigrama de{" "}
                        {role.cargo.empresa}: lo tiene quien ocupa el cargo
                      </span>
                    )}
                  </td>
                  <td className="num">{role.permission_codenames.length}</td>
                  <td className="acciones">
                    <Link
                      to={`/admin/roles/${role.id}`}
                      className="btn btn-outline-primary btn-sm"
                      aria-label={`${puedeEditar ? "Editar" : "Ver"} ${role.name}`}
                    >
                      {puedeEditar ? "Editar" : "Ver"}
                    </Link>
                    {/* El de un cargo se borra al borrar el cargo. */}
                    {puedeEditar && !role.cargo && (
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => setAEliminar(role)}
                        aria-label={`Eliminar ${role.name}`}
                      >
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        isOpen={Boolean(aEliminar)}
        title="¿Eliminar el rol?"
        confirmLabel="Eliminar rol"
        confirmVariant="danger"
        cancelClassName="btn-outline-secondary"
        isLoading={eliminando}
        message={
          aEliminar
            ? `Se eliminará el rol "${aEliminar.name}". Los usuarios que lo tengan asignado perderán los ${aEliminar.permission_codenames.length} permisos que otorga.`
            : ""
        }
        onConfirm={confirmarEliminacion}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  );
}
