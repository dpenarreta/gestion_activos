import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "../../components/common/Button/Button";
import { useAuth } from "../../hooks/useAuth";
import { PantallaAcceso } from "../../components/common/PantallaAcceso/PantallaAcceso";

export function Login() {
  const { login, isLoading, error } = useAuth();
  const navigate = useNavigate();
  // Quien llega aquí de vuelta merece saber por qué: encontrarse la pantalla
  // de login sin explicación se lee como que el sistema falló, y lleva a
  // reintentar pensando que algo va mal.
  const [searchParams] = useSearchParams();
  const cerradaPorInactividad = searchParams.get("motivo") === "inactividad";
  const [form, setForm] = useState({ identifier: "", password: "" });

  function handleChange(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      const me = await login(form);
      // Al panel, no a la portada: quien entra viene a trabajar, y la portada
      // solo ofrecía un botón para seguir hasta aquí. `/admin` reparte a cada
      // quien a la primera pantalla que puede abrir (ver `InicioDelPanel`).
      navigate(
        me.must_change_password ? "/change-password-required" : "/admin",
      );
    } catch {
      // El mensaje de error ya se expone vía useAuth().error
    }
  }

  return (
    <PantallaAcceso
      titulo="Acceso al sistema"
      subtitulo="Ingrese con su usuario corporativo."
    >
      <form onSubmit={handleSubmit}>
        {cerradaPorInactividad && !error && (
          <div className="mz-alert mz-alert--warn" role="status">
            <i className="bi bi-clock-history" aria-hidden="true" />
            Su sesión se cerró por inactividad. Vuelva a iniciar sesión.
          </div>
        )}
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <i className="bi bi-x-octagon" aria-hidden="true" />
            {error}
          </div>
        )}
        <div className="mb-3">
          <label className="form-label" htmlFor="identifier">
            Usuario o correo
          </label>
          <input
            id="identifier"
            name="identifier"
            className="form-control"
            value={form.identifier}
            onChange={handleChange}
            required
          />
        </div>
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
        <Button type="submit" isLoading={isLoading}>
          Entrar
        </Button>
        <div className="login-links">
          <Link to="/forgot-password">¿Olvidaste tu contraseña?</Link>
        </div>
      </form>
    </PantallaAcceso>
  );
}
