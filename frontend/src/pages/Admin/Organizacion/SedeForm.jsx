import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { sedesService } from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Organizacion.css";

const VACIO = { nombre: "", ciudad: "", direccion: "", activa: true };

export function SedeForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();
  const puedeEditar = usePermission("organizacion.editar");

  const [valores, setValores] = useState(VACIO);
  const [totalUbicaciones, setTotalUbicaciones] = useState(0);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!esEdicion) return;
    sedesService
      .get(id)
      .then((datos) => {
        setValores({
          nombre: datos.nombre,
          ciudad: datos.ciudad || "",
          direccion: datos.direccion || "",
          activa: datos.activa,
        });
        setTotalUbicaciones(datos.total_ubicaciones ?? 0);
      })
      .catch(() => setError("No se pudo cargar la sede."));
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
        await sedesService.update(id, valores);
      } else {
        await sedesService.create(valores);
      }
      navigate("/admin/organizacion/sedes");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la sede."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="organizacion-page">
      <Breadcrumbs
        items={[
          { label: "Administración" },
          { label: "Sedes", path: "/admin/organizacion/sedes" },
          { label: esEdicion ? "Editar" : "Nueva" },
        ]}
      />
      <h2>{esEdicion ? "Editar sede" : "Nueva sede"}</h2>

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={handleSubmit} className="organizacion-form">
        <div className="row g-3">
          <div className="col-md-7">
            <label className="form-label" htmlFor="nombre">
              Nombre
            </label>
            <input
              id="nombre"
              className="form-control"
              required
              maxLength={120}
              placeholder="Sede Quito Norte"
              value={valores.nombre}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("nombre", event.target.value)}
            />
            <div className="form-text">
              Como se la nombra internamente. Es lo que se lee al trasladar un
              equipo, así que conviene que se distinga de un vistazo de las
              demás.
            </div>
          </div>
          <div className="col-md-5">
            <label className="form-label" htmlFor="ciudad">
              Ciudad
            </label>
            <input
              id="ciudad"
              className="form-control"
              maxLength={120}
              placeholder="Quito"
              value={valores.ciudad}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("ciudad", event.target.value)}
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="direccion">
              Dirección
            </label>
            <input
              id="direccion"
              className="form-control"
              maxLength={200}
              placeholder="Av. Amazonas y Naciones Unidas"
              value={valores.direccion}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("direccion", event.target.value)}
            />
            <div className="form-text">
              Para quien tenga que ir a buscar el equipo.
            </div>
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
                Sede abierta
              </label>
            </div>
            {/* Cerrarla dejaría sus ubicaciones colgando de un sitio que el
                formulario ya no ofrece: el backend lo impide, y avisarlo aquí
                evita el intento. */}
            {esEdicion && totalUbicaciones > 0 && (
              <div className="form-text">
                Tiene {totalUbicaciones} ubicación(es): para cerrarla, ciérrelas
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
            onClick={() => navigate("/admin/organizacion/sedes")}
          >
            Volver
          </button>
        </div>
      </form>
    </div>
  );
}
