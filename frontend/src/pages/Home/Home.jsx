import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiClient } from "../../api/client";
import { env } from "../../config/env";
import { useAuth } from "../../hooks/useAuth";
import { PantallaAcceso } from "../../components/common/PantallaAcceso/PantallaAcceso";
import { RUTA_DE_ENTRADA } from "../../modulos/modulos";

/**
 * La portada, que es de quien todavía no ha entrado.
 *
 * Para quien ya tiene sesión no había nada que hacer aquí: un saludo, el estado
 * del backend y un botón para seguir hasta el panel. Ese botón era un clic de
 * más cada día, y la página que lo contenía no respondía ninguna pregunta que
 * alguien se hiciera de verdad. Ahora la portada solo se dibuja para quien
 * tiene algo que hacer en ella —iniciar sesión—, y el resto pasa de largo.
 *
 * Vale para todas las puertas, no solo para el login: una dirección guardada en
 * favoritos, el enlace del logo del menú o volver desde un 404 acaban aquí
 * igual, y todas llevan ahora al mismo sitio.
 */
export function Home() {
  const [status, setStatus] = useState("checking");
  const { isAuthenticated, isInitializing } = useAuth();

  useEffect(() => {
    apiClient
      .get("/health/")
      .then(() => setStatus("ok"))
      .catch(() => setStatus("unavailable"));
  }, []);

  // Mientras se recupera el perfil de un token guardado todavía no se sabe si
  // hay sesión: pintar la portada aquí la haría parpadear en cada recarga.
  if (isInitializing) {
    return null;
  }
  if (isAuthenticated) {
    return <Navigate to={RUTA_DE_ENTRADA} replace />;
  }

  return (
    <PantallaAcceso
      titulo={`Bienvenido a ${env.appName}`}
      subtitulo="Inicie sesión para consultar y administrar el inventario."
    >
      <p className="mz-small mz-faint">
        Estado del backend:{" "}
        <span
          className={`mz-pill ${status === "ok" ? "mz-pill--ok" : "mz-pill--neutral"}`}
        >
          {status}
        </span>
      </p>
      <Link to="/login" className="btn btn-primary w-100">
        Iniciar sesión
      </Link>
    </PantallaAcceso>
  );
}
