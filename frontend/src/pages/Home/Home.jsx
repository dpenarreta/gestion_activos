import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { apiClient } from "../../api/client";
import { env } from "../../config/env";
import { useAuth } from "../../hooks/useAuth";
import "./Home.css";

export function Home() {
  const [status, setStatus] = useState("checking");
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    apiClient
      .get("/health/")
      .then(() => setStatus("ok"))
      .catch(() => setStatus("unavailable"));
  }, []);

  return (
    <div className="container home-page">
      <h1>Bienvenido a {env.appName}</h1>
      <p className="text-muted">
        Página inicial operativa del skeleton reutilizable. Estado del backend:{" "}
        <span className={`badge ${status === "ok" ? "bg-success" : "bg-secondary"}`}>{status}</span>
      </p>
      {isAuthenticated ? (
        <Link to="/admin" className="btn btn-primary">
          Ir al panel administrativo
        </Link>
      ) : (
        <Link to="/login" className="btn btn-primary">
          Iniciar sesión
        </Link>
      )}
    </div>
  );
}
