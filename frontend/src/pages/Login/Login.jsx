import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "../../components/common/Button/Button";
import { useAuth } from "../../hooks/useAuth";
import { PantallaAcceso } from "../../components/common/PantallaAcceso/PantallaAcceso";
import {
  MODULO_DE_ENTRADA,
  RUTA_DE_ENTRADA,
  recordarModulo,
} from "../../modulos/modulos";
import { fijarTituloDePantalla } from "../../utils/tituloDocumento";

export function Login() {
  // La pestaña dice en qué pantalla se está, no solo el nombre del sitio
  // (revisión final UX/UI, 28/10/2026).
  useEffect(() => {
    fijarTituloDePantalla("Iniciar sesión");
    return () => fijarTituloDePantalla(null);
  }, []);
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
      // Siempre a Institucional → Inicio (19/10/2026): es de todos, tenga los
      // permisos que tenga, y desde ahí se va a cada módulo.
      recordarModulo(MODULO_DE_ENTRADA);
      navigate(
        me.must_change_password ? "/change-password-required" : RUTA_DE_ENTRADA,
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
            autoComplete="username"
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
            autoComplete="current-password"
            value={form.password}
            onChange={handleChange}
            required
          />
        </div>
        <Button type="submit" isLoading={isLoading}>
          Entrar
        </Button>
        <div className="login-links">
          <Link to="/forgot-password">¿Olvidó su contraseña?</Link>
        </div>
      </form>
    </PantallaAcceso>
  );
}
