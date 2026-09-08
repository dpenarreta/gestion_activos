import { useState } from "react";
import { Link } from "react-router-dom";

import { authService } from "../../api/authService";
import { Button } from "../../components/common/Button/Button";
import "./PasswordReset.css";

// El mensaje que muestra la vista viene siempre del backend
// (PASSWORD_RESET_GENERIC_MESSAGE): nunca revela si la cuenta existe.
export function ForgotPassword() {
  const [identifier, setIdentifier] = useState("");
  const [message, setMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    try {
      const response = await authService.requestPasswordReset(identifier);
      setMessage(response.detail);
    } catch {
      // Ante cualquier error (incluida una falla de red) se muestra el mismo
      // mensaje genérico — no hay una rama distinta que revele nada.
      setMessage(
        "Si el dato ingresado corresponde a una cuenta, se enviará un enlace de recuperación."
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="container password-reset-page">
      <h2>Recuperar contraseña</h2>
      <form onSubmit={handleSubmit} className="col-12 col-md-4">
        {message ? (
          <div className="alert alert-info">{message}</div>
        ) : (
          <>
            <div className="mb-3">
              <label className="form-label" htmlFor="identifier">
                Usuario o correo
              </label>
              <input
                id="identifier"
                className="form-control"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                required
              />
            </div>
            <Button type="submit" isLoading={isLoading}>
              Enviar enlace de recuperación
            </Button>
          </>
        )}
        <div className="mt-3">
          <Link to="/login">Volver a iniciar sesión</Link>
        </div>
      </form>
    </div>
  );
}
