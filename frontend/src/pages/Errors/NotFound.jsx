import { Link } from "react-router-dom";

import "./Errors.css";

export function NotFound() {
  return (
    <div className="container error-page">
      <h1>404</h1>
      <h2>Página no encontrada</h2>
      <p className="text-muted">La página que buscás no existe o fue movida.</p>
      <Link to="/" className="btn btn-primary">
        Volver al inicio
      </Link>
    </div>
  );
}
