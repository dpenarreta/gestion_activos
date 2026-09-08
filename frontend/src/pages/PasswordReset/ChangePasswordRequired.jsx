import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { authService } from "../../api/authService";
import { Button } from "../../components/common/Button/Button";
import { useAuth } from "../../hooks/useAuth";
import "./PasswordReset.css";

const EMPTY_FORM = { current_password: "", new_password: "", new_password_confirm: "" };

export function ChangePasswordRequired() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  function handleChange(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await authService.changePassword(form);
      await refreshUser();
      navigate("/");
    } catch (err) {
      const details = err.response?.data?.error?.details;
      const message =
        (details && Object.values(details).flat().join(" ")) ||
        err.response?.data?.error?.message ||
        "No se pudo cambiar la contraseña.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="container password-reset-page">
      <h2>Debe cambiar su contraseña</h2>
      <p className="text-muted">
        Un administrador solicitó que establezca una nueva contraseña antes de continuar.
      </p>
      <form onSubmit={handleSubmit} className="col-12 col-md-4">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="mb-3">
          <label className="form-label" htmlFor="current_password">
            Contraseña actual
          </label>
          <input
            id="current_password"
            name="current_password"
            type="password"
            className="form-control"
            value={form.current_password}
            onChange={handleChange}
            required
          />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="new_password">
            Nueva contraseña
          </label>
          <input
            id="new_password"
            name="new_password"
            type="password"
            className="form-control"
            value={form.new_password}
            onChange={handleChange}
            required
          />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="new_password_confirm">
            Confirmar contraseña
          </label>
          <input
            id="new_password_confirm"
            name="new_password_confirm"
            type="password"
            className="form-control"
            value={form.new_password_confirm}
            onChange={handleChange}
            required
          />
        </div>
        <Button type="submit" isLoading={isLoading}>
          Cambiar contraseña
        </Button>
      </form>
    </div>
  );
}
