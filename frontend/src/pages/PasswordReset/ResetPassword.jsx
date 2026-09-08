import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { authService } from "../../api/authService";
import { Button } from "../../components/common/Button/Button";
import "./PasswordReset.css";

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [form, setForm] = useState({ new_password: "", new_password_confirm: "" });
  const [error, setError] = useState(null);
  const [isDone, setIsDone] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  function handleChange(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await authService.confirmPasswordReset({ token, ...form });
      setIsDone(true);
    } catch (err) {
      const details = err.response?.data?.error?.details;
      const message =
        (details && Object.values(details).flat().join(" ")) ||
        err.response?.data?.error?.message ||
        "No se pudo restablecer la contraseña.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  if (isDone) {
    return (
      <div className="container password-reset-page">
        <h2>Recuperar contraseña</h2>
        <div className="col-12 col-md-4">
          <div className="alert alert-success">
            Tu contraseña fue actualizada correctamente. Ya podés iniciar sesión.
          </div>
          <Link to="/login">Iniciar sesión</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container password-reset-page">
      <h2>Establecer nueva contraseña</h2>
      <form onSubmit={handleSubmit} className="col-12 col-md-4">
        {error && (
          <div className="alert alert-danger">
            {error}
            <div className="mt-2">
              <Link to="/forgot-password">Solicitar un nuevo enlace</Link>
            </div>
          </div>
        )}
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
          Restablecer contraseña
        </Button>
      </form>
    </div>
  );
}
