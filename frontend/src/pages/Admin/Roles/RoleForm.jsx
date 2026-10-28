import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { rolesService } from "../../../api/rolesService";
import {
  Campo,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { PermissionsCheckboxGroup } from "../../../components/common/PermissionsCheckboxGroup/PermissionsCheckboxGroup";
import { usePermission } from "../../../hooks/usePermission";
import { usePermissionsCatalog } from "../../../hooks/usePermissionsCatalog";
import {
  erroresPorCampo,
  hayErroresGenerales,
  mensajeDeError,
} from "../../../utils/errores";

export function RoleForm() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  const formRef = useRef(null);
  // Quien solo puede ver los roles llega aquí por «Ver» del listado: ve el
  // rol sin poder cambiarlo ni encontrar un «Guardar» que el servidor
  // rechazaría (auditoría UX/UI, fase 2, 28/10/2026).
  const puedeEditar = usePermission("roles.editar");
  const soloLectura = !puedeEditar;
  const {
    catalog,
    isLoading: isCatalogLoading,
    error: catalogError,
    recargar: recargarCatalogo,
  } = usePermissionsCatalog();

  const [name, setName] = useState("");
  const [cargo, setCargo] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  // Al terminar se dice qué se guardó: antes el diálogo se cerraba y nada
  // confirmaba que el rol hubiera quedado guardado (revisión final UX/UI,
  // 28/10/2026). Al crear, el aviso viaja con la navegación a la ficha nueva.
  const [aviso, setAviso] = useState(location.state?.aviso ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [cargandoRol, setCargandoRol] = useState(isEditing);
  const [errorRol, setErrorRol] = useState(null);

  // Si el rol no carga, se dice y se puede reintentar: antes la promesa no
  // tenía catch y quedaba un formulario vacío como si el rol no tuviera
  // permisos (auditoría UX/UI, fase 2, 28/10/2026).
  const cargarRol = useCallback(() => {
    if (!isEditing) {
      return;
    }
    setCargandoRol(true);
    setErrorRol(null);
    rolesService
      .get(id)
      .then((role) => {
        setCargo(role.cargo ?? null);
        setName(role.name);
        setSelected(new Set(role.permission_codenames));
      })
      .catch((err) =>
        setErrorRol(mensajeDeError(err, "No se pudo cargar el rol.")),
      )
      .finally(() => setCargandoRol(false));
  }, [id, isEditing]);

  useEffect(() => {
    cargarRol();
  }, [cargarRol]);

  function handleSubmit(event) {
    event.preventDefault();
    if (soloLectura) {
      return;
    }
    // El nombre vacío se avisa antes de pedir confirmación: confirmar para
    // que después lo rechace el servidor era un paso inútil (revisión final
    // UX/UI, 28/10/2026).
    if (!name.trim()) {
      setErrores({ name: "Escriba el nombre del rol." });
      setError(null);
      enfocarPrimerError(formRef.current);
      return;
    }
    setIsConfirmOpen(true);
  }

  async function handleConfirmSave() {
    setIsSaving(true);
    setError(null);
    setErrores({});
    setAviso(null);
    const textoAviso = `Rol «${name}» guardado con ${selected.size} ${
      selected.size === 1 ? "permiso" : "permisos"
    }.`;
    try {
      const payload = { name, permission_codenames: Array.from(selected) };
      if (isEditing) {
        await rolesService.update(id, payload);
        setAviso(textoAviso);
      } else {
        // Al crear, se pasa a la URL de edición del rol recién creado
        // (`replace` para que "atrás" no vuelva al formulario de alta ya
        // resuelto) — nunca se sale hacia el listado. Como ambas rutas
        // renderizan el mismo componente, React Router no lo desmonta al
        // navegar: hay que cerrar el diálogo explícitamente en esta rama
        // también, o quedaría abierto sobre la vista de edición.
        const created = await rolesService.create(payload);
        setAviso(textoAviso);
        navigate(`/admin/roles/${created.id}`, {
          replace: true,
          state: { aviso: textoAviso },
        });
      }
      setIsConfirmOpen(false);
    } catch (err) {
      // El error del nombre va bajo el campo; el resto, en el aviso de arriba
      // completo (revisión final UX/UI, 28/10/2026).
      const porCampo = erroresPorCampo(err);
      const claves = Object.keys(porCampo);
      setErrores(porCampo);
      setError(
        claves.length > 0 &&
          claves.every((clave) => clave === "name") &&
          !hayErroresGenerales(err)
          ? "Revise los campos marcados."
          : mensajeDeError(err, "No se pudo guardar el rol."),
      );
      setIsConfirmOpen(false);
      enfocarPrimerError(formRef.current);
    } finally {
      setIsSaving(false);
    }
  }

  const titulo = soloLectura
    ? "Ver rol"
    : isEditing
      ? "Editar rol"
      : "Nuevo rol";

  return (
    <div className="role-form-page">
      <div className="mz-view-head">
        <div>
          <h2>{titulo}</h2>
          <p className="mz-desc">
            Un rol agrupa permisos; quien lo reciba podrá hacer exactamente lo
            que se marque aquí.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}

      <EstadoDeCarga
        cargando={isCatalogLoading || cargandoRol}
        error={errorRol || catalogError}
        onReintentar={() => {
          if (errorRol) cargarRol();
          if (catalogError) recargarCatalogo();
        }}
      />

      {!isCatalogLoading && !cargandoRol && !errorRol && !catalogError && (
        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Datos del rol</h3>
          </div>
          <form ref={formRef} onSubmit={handleSubmit} className="mz-card-body">
            <fieldset disabled={soloLectura}>
              <div className="mz-field-grid">
                <Campo
                  id="name"
                  etiqueta="Nombre del rol"
                  obligatorio={!soloLectura && !cargo}
                  ayuda={
                    cargo ? (
                      <>
                        Es el rol del cargo «{cargo.nombre}»
                        {cargo.unidad && ` (${cargo.unidad})`} del organigrama
                        de {cargo.empresa}: se renombra con el cargo
                        (Institucional → Estructura) y lo tiene quien ocupa ese
                        cargo. Sus permisos sí se editan aquí.
                      </>
                    ) : null
                  }
                  error={errores.name}
                  className="mz-field"
                >
                  <input
                    className="form-control"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setErrores((actuales) =>
                        actuales.name
                          ? { ...actuales, name: undefined }
                          : actuales,
                      );
                    }}
                    disabled={Boolean(cargo)}
                  />
                </Campo>
              </div>
            </fieldset>

            {catalog && (
              <div className="mz-section mt-3">
                <h4>Permisos</h4>
                <PermissionsCheckboxGroup
                  catalog={catalog}
                  selected={selected}
                  onChange={setSelected}
                  soloLectura={soloLectura}
                />
              </div>
            )}

            {!soloLectura && (
              <div className="mz-actions justify-content-end mt-3">
                <button type="submit" className="btn btn-primary">
                  Guardar
                </button>
              </div>
            )}
          </form>
        </section>
      )}

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
