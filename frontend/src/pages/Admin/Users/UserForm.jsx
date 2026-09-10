import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { adminUsersService } from "../../../api/adminUsersService";
import { Button } from "../../../components/common/Button/Button";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { usePermission } from "../../../hooks/usePermission";
import { AsignacionEmpresas } from "../Empresas/AsignacionEmpresas";
import "./UserForm.css";

const EMPTY_FORM = {
  username: "",
  email: "",
  password: "",
  first_name: "",
  last_name: "",
};
const EMPTY_RESET_OPTIONS = {
  send_link: false,
  force_change_on_next_login: false,
  revoke_sessions: false,
};

export function UserForm() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const canResetPassword = usePermission("usuarios.restablecer_password");
  const [form, setForm] = useState(EMPTY_FORM);
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
        });
      } else {
        // Al crear, se pasa a la URL de edición del usuario recién creado
        // (`replace` para que "atrás" no vuelva al formulario de alta ya
        // resuelto) — nunca se sale hacia el listado.
        const created = await adminUsersService.create(form);
        navigate(`/admin/users/${created.id}`, { replace: true });
      }
    } catch (err) {
      setError(
        err.response?.data?.error?.message || "No se pudo guardar el usuario.",
      );
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
      <h2>{isEditing ? "Editar usuario" : "Nuevo usuario"}</h2>
      <form onSubmit={handleSubmit} className="col-12 col-md-5">
        {error && <div className="alert alert-danger">{error}</div>}

        <div className="mb-3">
          <label className="form-label" htmlFor="username">
            Nombre de usuario
          </label>
          <input
            id="username"
            name="username"
            className="form-control"
            value={form.username}
            onChange={handleChange}
            required
          />
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="email">
            Correo
          </label>
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
          <div className="mb-3">
            <label className="form-label" htmlFor="password">
              Contraseña
            </label>
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

        <div className="mb-3">
          <label className="form-label" htmlFor="first_name">
            Nombres
          </label>
          <input
            id="first_name"
            name="first_name"
            className="form-control"
            value={form.first_name}
            onChange={handleChange}
          />
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="last_name">
            Apellidos
          </label>
          <input
            id="last_name"
            name="last_name"
            className="form-control"
            value={form.last_name}
            onChange={handleChange}
          />
        </div>

        <Button type="submit" isLoading={isLoading}>
          Guardar
        </Button>
      </form>

      {isEditing && <AsignacionEmpresas usuarioId={id} />}

      {isEditing && canResetPassword && (
        <div className="col-12 col-md-5 mt-4">
          <h5>Restablecer contraseña</h5>
          {resetMessage && (
            <div className="alert alert-success">{resetMessage}</div>
          )}
          {resetError && <div className="alert alert-danger">{resetError}</div>}
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
              onChange={() => toggleResetOption("force_change_on_next_login")}
            />
            <label
              className="form-check-label"
              htmlFor="force_change_on_next_login"
            >
              Forzar cambio de contraseña en el próximo inicio de sesión
            </label>
          </div>
          <div className="form-check mb-3">
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
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={!Object.values(resetOptions).some(Boolean)}
            onClick={() => setIsConfirmResetOpen(true)}
          >
            Ejecutar
          </button>
        </div>
      )}

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
