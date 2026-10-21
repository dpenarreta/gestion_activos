import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { rolesService } from "../../../api/rolesService";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { Icon } from "../../../components/common/Icon/Icon";
import { PermissionsCheckboxGroup } from "../../../components/common/PermissionsCheckboxGroup/PermissionsCheckboxGroup";
import { usePermissionsCatalog } from "../../../hooks/usePermissionsCatalog";

export function RoleForm() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const {
    catalog,
    isLoading: isCatalogLoading,
    error: catalogError,
  } = usePermissionsCatalog();

  const [name, setName] = useState("");
  const [cargo, setCargo] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    rolesService.get(id).then((role) => {
      setCargo(role.cargo ?? null);
      setName(role.name);
      setSelected(new Set(role.permission_codenames));
    });
  }, [id, isEditing]);

  function handleSubmit(event) {
    event.preventDefault();
    setIsConfirmOpen(true);
  }

  async function handleConfirmSave() {
    setIsSaving(true);
    setError(null);
    try {
      const payload = { name, permission_codenames: Array.from(selected) };
      if (isEditing) {
        await rolesService.update(id, payload);
      } else {
        // Al crear, se pasa a la URL de edición del rol recién creado
        // (`replace` para que "atrás" no vuelva al formulario de alta ya
        // resuelto) — nunca se sale hacia el listado. Como ambas rutas
        // renderizan el mismo componente, React Router no lo desmonta al
        // navegar: hay que cerrar el diálogo explícitamente en esta rama
        // también, o quedaría abierto sobre la vista de edición.
        const created = await rolesService.create(payload);
        navigate(`/admin/roles/${created.id}`, { replace: true });
      }
      setIsConfirmOpen(false);
    } catch (err) {
      setError(
        err.response?.data?.error?.message || "No se pudo guardar el rol.",
      );
      setIsConfirmOpen(false);
    } finally {
      setIsSaving(false);
    }
  }

  if (isCatalogLoading) {
    return null;
  }

  return (
    <div className="role-form-page">
      <div className="mz-view-head">
        <div>
          <h2>{isEditing ? "Editar rol" : "Nuevo rol"}</h2>
          <p className="mz-desc">
            Un rol agrupa permisos; quien lo reciba podrá hacer exactamente lo
            que se marque aquí.
          </p>
        </div>
      </div>

      {(error || catalogError) && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error || catalogError}
        </div>
      )}

      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Datos del rol</h3>
        </div>
        <form onSubmit={handleSubmit} className="mz-card-body">
          <div className="mz-field-grid">
            <div className="mz-field">
              <label htmlFor="name">Nombre del rol</label>
              <input
                id="name"
                className="form-control"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                disabled={Boolean(cargo)}
              />
              {cargo && (
                <small className="mz-faint">
                  Es el rol del cargo «{cargo.nombre}»
                  {cargo.unidad && ` (${cargo.unidad})`} del organigrama de{" "}
                  {cargo.empresa}: se renombra con el cargo (Institucional →
                  Estructura) y lo tiene quien ocupa ese cargo. Sus permisos sí
                  se editan aquí.
                </small>
              )}
            </div>
          </div>

          {catalog && (
            <div className="mz-section mt-3">
              <h4>Permisos</h4>
              <PermissionsCheckboxGroup
                catalog={catalog}
                selected={selected}
                onChange={setSelected}
              />
            </div>
          )}

          <div className="mz-actions justify-content-end mt-3">
            <button type="submit" className="btn btn-primary">
              Guardar
            </button>
          </div>
        </form>
      </section>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="Confirmar guardado del rol"
        message={`Se guardará el rol "${name}" con ${selected.size} permiso(s) seleccionado(s).`}
        isLoading={isSaving}
        onConfirm={handleConfirmSave}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </div>
  );
}
