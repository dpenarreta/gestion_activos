import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { authService } from "../../api/authService";
import { Button } from "../../components/common/Button/Button";
import { useAuth } from "../../hooks/useAuth";
import { PantallaAcceso } from "../../components/common/PantallaAcceso/PantallaAcceso";
import { ReglasContrasena } from "../../components/common/ReglasContrasena/ReglasContrasena";
import { RUTA_DE_ENTRADA } from "../../modulos/modulos";

const EMPTY_FORM = {
  current_password: "",
  new_password: "",
  new_password_confirm: "",
};

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
      navigate(RUTA_DE_ENTRADA);
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
    <PantallaAcceso
      titulo="Debe cambiar su contraseña"
      subtitulo="Es su primer ingreso o un administrador lo pidió: antes de continuar, reemplace la clave temporal por una contraseña propia."
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <i className="bi bi-x-octagon" aria-hidden="true" />
            {error}
          </div>
        )}
        <div className="mb-3">
          <label className="form-label" htmlFor="current_password">
            Contraseña actual (la temporal que le dieron)
          </label>
          <input
            id="current_password"
            name="current_password"
            type="password"
            className="form-control"
            autoComplete="current-password"
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
            autoComplete="new-password"
            aria-describedby="reglas-nueva"
            value={form.new_password}
            onChange={handleChange}
            required
          />
          <ReglasContrasena id="reglas-nueva" clave={form.new_password} />
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
            autoComplete="new-password"
            value={form.new_password_confirm}
            onChange={handleChange}
            required
          />
        </div>
        <Button type="submit" isLoading={isLoading}>
          Cambiar contraseña
        </Button>
      </form>
    </PantallaAcceso>
  );
}
