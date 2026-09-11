import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { concesionariosService } from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Organizacion.css";

const VACIO = {
  nombre: "",
  identificacion: "",
  contacto: "",
  telefono: "",
  correo: "",
  observaciones: "",
  activo: true,
};

/**
 * Ficha del partner dueño de los equipos en concesión.
 *
 * Los mismos datos de contacto que un proveedor, y a propósito: la pregunta es
 * la misma —a quién se llama cuando algo falló—. Lo que cambia es qué responde
 * cada catálogo, y por eso son dos.
 */
export function ConcesionarioForm() {
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
    concesionariosService
      .get(id)
      .then((datos) => {
        setValores({
          nombre: datos.nombre,
          identificacion: datos.identificacion || "",
          contacto: datos.contacto || "",
          telefono: datos.telefono || "",
          correo: datos.correo || "",
          observaciones: datos.observaciones || "",
          activo: datos.activo,
        });
        setTotalActivos(datos.total_activos ?? 0);
      })
      .catch(() => setError("No se pudo cargar el concesionario."));
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
        await concesionariosService.update(id, valores);
      } else {
        await concesionariosService.create(valores);
      }
      navigate("/admin/organizacion/concesionarios");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el concesionario."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="organizacion-page">
      <Breadcrumbs
        items={[
          { label: "Administración" },
          {
            label: "Concesionarios",
            path: "/admin/organizacion/concesionarios",
          },
          { label: esEdicion ? "Editar" : "Nuevo" },
        ]}
      />
      <h2>{esEdicion ? "Editar concesionario" : "Nuevo concesionario"}</h2>

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
              maxLength={150}
              placeholder="Servientrega Andina"
              value={valores.nombre}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("nombre", event.target.value)}
            />
            <div className="form-text">
              Como aparece en el contrato. Escrito de dos formas distintas
              serían dos partners, con sus equipos repartidos entre ambos.
            </div>
          </div>
          <div className="col-md-5">
            <label className="form-label" htmlFor="identificacion">
              Identificación
            </label>
            <input
              id="identificacion"
              className="form-control"
              maxLength={20}
              placeholder="0992222333001"
              value={valores.identificacion}
              disabled={!puedeEditar}
              onChange={(event) =>
                actualizar("identificacion", event.target.value)
              }
            />
            <div className="form-text">RUC o identificación tributaria.</div>
          </div>

          <div className="col-md-4">
            <label className="form-label" htmlFor="contacto">
              Contacto
            </label>
            <input
              id="contacto"
              className="form-control"
              maxLength={120}
              placeholder="Quién atiende la relación"
              value={valores.contacto}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("contacto", event.target.value)}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="telefono">
              Teléfono
            </label>
            <input
              id="telefono"
              className="form-control"
              maxLength={30}
              value={valores.telefono}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("telefono", event.target.value)}
            />
            <div className="form-text">
              A quién llamar para coordinar una devolución o un reemplazo.
            </div>
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="correo">
              Correo
            </label>
            <input
              id="correo"
              type="email"
              className="form-control"
              value={valores.correo}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("correo", event.target.value)}
            />
          </div>

          <div className="col-12">
            <label className="form-label" htmlFor="observaciones">
              Condiciones de la concesión
            </label>
            <textarea
              id="observaciones"
              className="form-control"
              rows={2}
              placeholder="Qué cubre cada parte y hasta cuándo"
              value={valores.observaciones}
              disabled={!puedeEditar}
              onChange={(event) =>
                actualizar("observaciones", event.target.value)
              }
            />
          </div>

          <div className="col-12">
            <div className="form-check">
              <input
                id="activo"
                type="checkbox"
                className="form-check-input"
                checked={valores.activo}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("activo", event.target.checked)}
              />
              <label className="form-check-label" htmlFor="activo">
                Concesionario activo
              </label>
            </div>
            {/* Darlo de baja con equipos suyos en uso los dejaría apuntando a
                alguien que el formulario ya no ofrece: el backend lo impide, y
                avisarlo aquí evita el intento. */}
            {esEdicion && totalActivos > 0 && (
              <div className="form-text">
                {totalActivos} equipo(s) en uso son suyos: para darlo de baja,
                cámbieles el concesionario primero.
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
            onClick={() => navigate("/admin/organizacion/concesionarios")}
          >
            Volver
          </button>
        </div>
      </form>
    </div>
  );
}
