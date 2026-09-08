import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "../../components/common/Button/Button";
import { useAuth } from "../../hooks/useAuth";
import "./Register.css";

export function Register() {
  const { register, isLoading, error } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", email: "", password: "" });

  function handleChange(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      await register(form);
      navigate("/");
    } catch {
      // El mensaje de error ya se expone vía useAuth().error
    }
  }

  return (
    <div className="container register-page">
      <h2>Crear cuenta</h2>
      <form onSubmit={handleSubmit} className="col-12 col-md-4">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="mb-3">
          <label className="form-label" htmlFor="username">
            Usuario
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
          Registrarme
        </Button>
      </form>
    </div>
  );
}
