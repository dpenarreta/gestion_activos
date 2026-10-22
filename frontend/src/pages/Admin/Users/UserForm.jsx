import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { adminUsersService } from "../../../api/adminUsersService";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import { baseDeUsername } from "../../../utils/nomenclatura";
import { AsignacionEmpresas } from "../Empresas/AsignacionEmpresas";
import { SeleccionEmpresaYRol } from "../Empresas/SeleccionEmpresaYRol";

const EMPTY_FORM = {
  username: "",
  email: "",
  password: "",
  first_name: "",
  last_name: "",
  codigo_empleado: "",
};
const EMPTY_RESET_OPTIONS = {
  send_link: false,
  force_change_on_next_login: false,
  revoke_sessions: false,
};

export function UserForm() {
  const puedeEditarCodigo = usePermission("roles_pago.habilitar");
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const canResetPassword = usePermission("usuarios.restablecer_password");
  const puedeAsignarEmpresas = usePermission("empresas.asignar");
  // Con qué empresa y rol nace la cuenta. Solo se pregunta al crearla: en
  // la ficha ya está el bloque completo, con todas sus empresas.
  const [alta, setAlta] = useState({ empresaId: null, rolId: null });
  const [form, setForm] = useState(EMPTY_FORM);
  // Con qué nombre entrará: se enseña mientras se escribe, para que no haya
  // que descubrirlo después de guardar.
  const usernamePropuesto = baseDeUsername(form.first_name, form.last_name);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resetOptions, setResetOptions] = useState(EMPTY_RESET_OPTIONS);
  const [isConfirmResetOpen, setIsConfirmResetOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState(null);
  const [resetError, setResetError] = useState(null);

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    setIsLoading(true);
    adminUsersService
      .get(id)
      .then((data) =>
        setForm({
          username: data.username,
          email: data.email,
          password: "",
          first_name: data.first_name,
          last_name: data.last_name,
          codigo_empleado: data.codigo_empleado ?? "",
        }),
      )
      .catch(() => setError("No se pudo cargar el usuario."))
      .finally(() => setIsLoading(false));
  }, [id, isEditing]);

  function handleChange(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      if (isEditing) {
        const {
          username,
          email,
          first_name: firstName,
          last_name: lastName,
        } = form;
        await adminUsersService.update(id, {
          username,
          email,
          first_name: firstName,
          last_name: lastName,
          codigo_empleado: form.codigo_empleado.trim(),
        });
      } else {
        // Al crear, se pasa a la URL de edición del usuario recién creado
        // (`replace` para que "atrás" no vuelva al formulario de alta ya
        // resuelto) — nunca se sale hacia el listado.
        // Sin `username`: lo compone el backend a partir del nombre.
        const created = await adminUsersService.create({
          email: form.email,
          password: form.password,
          first_name: form.first_name,
          last_name: form.last_name,
          ...(form.codigo_empleado.trim()
            ? { codigo_empleado: form.codigo_empleado.trim() }
            : {}),
          ...(puedeAsignarEmpresas && alta.empresaId && alta.rolId
            ? {
                empresas: [
                  {
                    empresa_id: alta.empresaId,
                    roles: [alta.rolId],
                    es_predeterminada: true,
                  },
                ],
              }
            : {}),
        });
        navigate(`/admin/users/${created.id}`, { replace: true });
      }
    } catch (err) {
      // `mensajeDeError` antepone el detalle de validación al mensaje genérico:
      // «Roles inexistentes» dice qué corregir, «No se pudo guardar» no.
      setError(mensajeDeError(err, "No se pudo guardar el usuario."));
    } finally {
      setIsLoading(false);
    }
  }

  function toggleResetOption(key) {
    setResetOptions({ ...resetOptions, [key]: !resetOptions[key] });
  }

  async function handleConfirmReset() {
    setIsResetting(true);
    setResetError(null);
    try {
      await adminUsersService.resetPassword(id, resetOptions);
      setResetMessage("La acción se ejecutó correctamente.");
      setResetOptions(EMPTY_RESET_OPTIONS);
    } catch (err) {
      setResetError(
        err.response?.data?.error?.message ||
          "No se pudo ejecutar la acción de restablecimiento.",
      );
    } finally {
      setIsResetting(false);
      setIsConfirmResetOpen(false);
    }
  }

  return (
    <div className="user-form-page">
      <div className="mz-view-head">
        <div>
          <h2>{isEditing ? "Editar usuario" : "Nuevo usuario"}</h2>
          <p className="mz-desc">
            {isEditing
              ? "Los datos de la cuenta, las empresas donde trabaja y su contraseña."
              : "La cuenta nace con su nombre, su correo y, si corresponde, la empresa y el rol con los que entra."}
          </p>
        </div>
      </div>

      <div className="mz-stack">
        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Datos de la cuenta</h3>
          </div>
          <form onSubmit={handleSubmit} className="mz-card-body">
            {error && (
              <div className="mz-alert mz-alert--bad" role="alert">
                <Icon name="x-octagon" />
                {error}
              </div>
            )}

            <div className="mz-field-grid">
              <div className="mz-field">
                <label htmlFor="first_name">Nombres</label>
                <input
                  id="first_name"
                  name="first_name"
                  className="form-control"
                  value={form.first_name}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="mz-field">
                <label htmlFor="last_name">Apellidos</label>
                <input
                  id="last_name"
                  name="last_name"
                  className="form-control"
                  value={form.last_name}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="mz-field">
                <label htmlFor="codigo_empleado">Código de empleado</label>
                <input
                  id="codigo_empleado"
                  name="codigo_empleado"
                  className="form-control"
                  maxLength={40}
                  inputMode="numeric"
                  value={form.codigo_empleado}
                  onChange={handleChange}
                  // Lo cambia solo nómina (`roles_pago.habilitar`, 22/10/2026).
                  disabled={!puedeEditarCodigo}
                  aria-describedby="codigo-empleado-ayuda"
                />
                <div className="form-text" id="codigo-empleado-ayuda">
                  El de nómina (p. ej. 20104758). Con él la persona consulta su
                  rol de pagos: solo lo asigna la administración. Déjelo vacío
                  si la cuenta no es de un empleado.
                </div>
              </div>

              <div className="mz-field">
                <label htmlFor="username">Nombre de usuario</label>
                <input
                  id="username"
                  name="username"
                  className="form-control"
                  value={isEditing ? form.username : usernamePropuesto}
                  readOnly
                  aria-describedby="username-ayuda"
                />
                <div className="form-text" id="username-ayuda">
                  {isEditing
                    ? "Se compuso al crear la cuenta y no cambia: es con lo que entra y con lo que aparece en la auditoría."
                    : "Se compone solo: inicial del nombre y apellido completo, sin tildes ni eñes. Si ya está en uso, se le añade un número."}
                </div>
              </div>

              <div className="mz-field">
                <label htmlFor="email">Correo</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="form-control"
                  value={form.email}
                  onChange={handleChange}
                  required
                />
              </div>

              {!isEditing && (
                <div className="mz-field">
                  <label htmlFor="password">Contraseña</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    className="form-control"
                    value={form.password}
                    onChange={handleChange}
                    required
                  />
                </div>
              )}
            </div>

            {!isEditing && puedeAsignarEmpresas && (
              <div className="mz-section mt-3">
                <h4>Empresa y rol</h4>
                <SeleccionEmpresaYRol
                  empresaId={alta.empresaId}
                  rolId={alta.rolId}
                  onChange={setAlta}
                />
              </div>
            )}

            <div className="mz-actions justify-content-end mt-3">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isLoading}
              >
                {isLoading ? "Procesando..." : "Guardar"}
              </button>
            </div>
          </form>
        </section>

        {isEditing && <AsignacionEmpresas usuarioId={id} />}

        {isEditing && canResetPassword && (
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Restablecer contraseña</h3>
            </div>
            <div className="mz-card-body">
              {resetMessage && (
                <div className="mz-alert mz-alert--info" role="status">
                  <Icon name="check2-circle" />
                  {resetMessage}
                </div>
              )}
              {resetError && (
                <div className="mz-alert mz-alert--bad" role="alert">
                  <Icon name="x-octagon" />
                  {resetError}
                </div>
              )}
              <div className="form-check">
                <input
                  id="send_link"
                  type="checkbox"
                  className="form-check-input"
                  checked={resetOptions.send_link}
                  onChange={() => toggleResetOption("send_link")}
                />
                <label className="form-check-label" htmlFor="send_link">
                  Enviar enlace de restablecimiento por correo
                </label>
              </div>
              <div className="form-check">
                <input
                  id="force_change_on_next_login"
                  type="checkbox"
                  className="form-check-input"
                  checked={resetOptions.force_change_on_next_login}
                  onChange={() =>
                    toggleResetOption("force_change_on_next_login")
                  }
                />
                <label
                  className="form-check-label"
                  htmlFor="force_change_on_next_login"
                >
                  Forzar cambio de contraseña en el próximo inicio de sesión
                </label>
              </div>
              <div className="form-check">
                <input
                  id="revoke_sessions"
                  type="checkbox"
                  className="form-check-input"
                  checked={resetOptions.revoke_sessions}
                  onChange={() => toggleResetOption("revoke_sessions")}
                />
                <label className="form-check-label" htmlFor="revoke_sessions">
                  Cerrar sesiones activas
                </label>
              </div>
              <div className="mz-actions justify-content-end mt-3">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={!Object.values(resetOptions).some(Boolean)}
                  onClick={() => setIsConfirmResetOpen(true)}
                >
                  <Icon name="key" /> Ejecutar
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        isOpen={isConfirmResetOpen}
        title="Restablecer contraseña"
        message="Esta acción no puede deshacerse. ¿Confirma que desea ejecutar las opciones seleccionadas?"
        isLoading={isResetting}
        onConfirm={handleConfirmReset}
        onCancel={() => setIsConfirmResetOpen(false)}
      />
    </div>
  );
}
