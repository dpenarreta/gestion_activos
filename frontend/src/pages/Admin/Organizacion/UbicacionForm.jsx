import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ubicacionesService } from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Organizacion.css";

const VACIO = { sede: "", nombre: "", detalle: "", activa: true };

export function UbicacionForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();
  const puedeEditar = usePermission("organizacion.editar");

  const [valores, setValores] = useState(VACIO);
  const [totalActivos, setTotalActivos] = useState(0);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!esEdicion) return;
    ubicacionesService
      .get(id)
      .then((datos) => {
        setValores({
          sede: datos.sede,
          nombre: datos.nombre,
          detalle: datos.detalle || "",
          activa: datos.activa,
        });
        setTotalActivos(datos.total_activos ?? 0);
      })
      .catch(() => setError("No se pudo cargar la ubicación."));
  }, [id, esEdicion]);

  function actualizar(campo, valor) {
    setValores((actuales) => ({ ...actuales, [campo]: valor }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      if (esEdicion) {
        await ubicacionesService.update(id, valores);
      } else {
        await ubicacionesService.create(valores);
      }
      navigate("/admin/organizacion/ubicaciones");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la ubicación."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="organizacion-page">
      <Breadcrumbs
        items={[
          { label: "Administración" },
          { label: "Ubicaciones", path: "/admin/organizacion/ubicaciones" },
          { label: esEdicion ? "Editar" : "Nueva" },
        ]}
      />
      <h2>{esEdicion ? "Editar ubicación" : "Nueva ubicación"}</h2>

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={handleSubmit} className="organizacion-form">
        <div className="row g-3">
          <div className="col-md-5">
            <label className="form-label" htmlFor="sede">
              Sede
            </label>
            <input
              id="sede"
              className="form-control"
              required
              maxLength={120}
              placeholder="Matriz Quito"
              value={valores.sede}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("sede", event.target.value)}
            />
            <div className="form-text">Edificio, local o ciudad.</div>
          </div>
          <div className="col-md-7">
            <label className="form-label" htmlFor="nombre">
              Nombre
            </label>
            <input
              id="nombre"
              className="form-control"
              required
              maxLength={120}
              placeholder="Bodega TI"
              value={valores.nombre}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("nombre", event.target.value)}
            />
            <div className="form-text">
              Lugar dentro de la sede. No puede repetirse dentro de la misma
              sede.
            </div>
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="detalle">
              Detalle
            </label>
            <input
              id="detalle"
              className="form-control"
              maxLength={150}
              placeholder="Piso 3, ala norte"
              value={valores.detalle}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("detalle", event.target.value)}
            />
          </div>
          <div className="col-12">
            <div className="form-check">
              <input
                id="activa"
                type="checkbox"
                className="form-check-input"
                checked={valores.activa}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("activa", event.target.checked)}
              />
              <label className="form-check-label" htmlFor="activa">
                Ubicación activa
              </label>
            </div>
            {/* Cerrar una ubicación con equipos dentro los dejaría en un sitio
                que el formulario ya no ofrece: el backend lo impide, y avisarlo
                aquí evita el intento. */}
            {esEdicion && totalActivos > 0 && (
              <div className="form-text">
                Hay {totalActivos} activo(s) aquí: para cerrarla, muévalos
                primero.
              </div>
            )}
          </div>
        </div>

        <div className="d-flex gap-2 mt-4">
          {puedeEditar && (
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSaving}
            >
              {isSaving ? "Guardando…" : "Guardar"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => navigate("/admin/organizacion/ubicaciones")}
          >
            Volver
          </button>
        </div>
      </form>
    </div>
  );
}
