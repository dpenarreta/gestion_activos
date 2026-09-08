import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { rolesService } from "../../../api/rolesService";
import { Button } from "../../../components/common/Button/Button";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { PermissionsCheckboxGroup } from "../../../components/common/PermissionsCheckboxGroup/PermissionsCheckboxGroup";
import { usePermissionsCatalog } from "../../../hooks/usePermissionsCatalog";
import "./RoleForm.css";

export function RoleForm() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const { catalog, isLoading: isCatalogLoading, error: catalogError } = usePermissionsCatalog();

  const [name, setName] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    rolesService.get(id).then((role) => {
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
      setError(err.response?.data?.error?.message || "No se pudo guardar el rol.");
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
      <h2>{isEditing ? "Editar rol" : "Nuevo rol"}</h2>

      {(error || catalogError) && <div className="alert alert-danger">{error || catalogError}</div>}

      <form onSubmit={handleSubmit}>
        <div className="mb-3 col-12 col-md-5">
          <label className="form-label" htmlFor="name">
            Nombre del rol
          </label>
          <input
            id="name"
            className="form-control"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>

        {catalog && (
          <PermissionsCheckboxGroup catalog={catalog} selected={selected} onChange={setSelected} />
        )}

        <div className="mt-3">
          <Button type="submit">Guardar</Button>
        </div>
      </form>

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
