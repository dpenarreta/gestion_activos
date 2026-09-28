import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "../../components/common/Button/Button";
import { useAuth } from "../../hooks/useAuth";
import "./Login.css";

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
    <div className="container login-page">
      <h2>Iniciar sesión</h2>
      <form onSubmit={handleSubmit} className="col-12 col-md-4">
        {cerradaPorInactividad && !error && (
          <div className="alert alert-warning" role="status">
            Su sesión se cerró por inactividad. Vuelva a iniciar sesión.
          </div>
        )}
        {error && <div className="alert alert-danger">{error}</div>}
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
        <div className="mt-3">
          <Link to="/forgot-password">¿Olvidaste tu contraseña?</Link>
        </div>
      </form>
    </div>
  );
}
