import { useState } from "react";
import { Link } from "react-router-dom";

import { authService } from "../../api/authService";
import { Button } from "../../components/common/Button/Button";
import { PantallaAcceso } from "../../components/common/PantallaAcceso/PantallaAcceso";

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
        "Si el dato ingresado corresponde a una cuenta, se enviará un enlace de recuperación.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <PantallaAcceso
      titulo="Recuperar contraseña"
      subtitulo="Le enviaremos un enlace para elegir una nueva."
    >
      <form onSubmit={handleSubmit}>
        {message ? (
          <div className="mz-alert mz-alert--info" role="status">
            <i className="bi bi-envelope-check" aria-hidden="true" />
            {message}
          </div>
        ) : (
          <>
            <div className="mb-3">
              <label className="form-label" htmlFor="identifier">
                Usuario o correo
              </label>
              <input
                id="identifier"
                className="form-control"
                autoComplete="username"
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
        <div className="login-links">
          <Link to="/login">Volver a iniciar sesión</Link>
        </div>
      </form>
    </PantallaAcceso>
  );
}
