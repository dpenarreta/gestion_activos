import { Link } from "react-router-dom";

import "./Errors.css";

export function NotFound() {
  return (
    <div className="mz-error-page">
      <div className="mz-error-card">
        <span className="mz-error-code">404</span>
        <h1>Página no encontrada</h1>
        <p className="mz-desc">La página que buscás no existe o fue movida.</p>
        <Link to="/" className="btn btn-primary">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
