import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { proveedoresService } from "../../../api/organizacionService";
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

export function ProveedorForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();
  const puedeEditar = usePermission("organizacion.editar");

  const [valores, setValores] = useState(VACIO);
  const [totales, setTotales] = useState({ activos: 0, repuestos: 0 });
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!esEdicion) return;
    proveedoresService
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
        setTotales({
          activos: datos.total_activos ?? 0,
          repuestos: datos.total_repuestos ?? 0,
        });
      })
      .catch(() => setError("No se pudo cargar el proveedor."));
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
        await proveedoresService.update(id, valores);
      } else {
        await proveedoresService.create(valores);
      }
      navigate("/admin/organizacion/proveedores");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el proveedor."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="organizacion-page">
      <Breadcrumbs
        items={[
          { label: "Administración" },
          { label: "Proveedores", path: "/admin/organizacion/proveedores" },
          { label: esEdicion ? "Editar" : "Nuevo" },
        ]}
      />
      <h2>{esEdicion ? "Editar proveedor" : "Nuevo proveedor"}</h2>

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
              placeholder="Tecnomega"
              value={valores.nombre}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("nombre", event.target.value)}
            />
            <div className="form-text">
              Como aparece en la factura. Escrito de dos formas distintas serían
              dos proveedores, con las compras repartidas entre ambos.
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
              placeholder="0991234567001"
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
              placeholder="Quién atiende la cuenta"
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
              {/* Se necesita justo cuando algo falló: sin un teléfono a mano,
                  saber de quién fue la compra no sirve de nada. */}
              A quién llamar cuando un equipo o una pieza falla.
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
              Observaciones
            </label>
            <textarea
              id="observaciones"
              className="form-control"
              rows={2}
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
                Proveedor activo
              </label>
            </div>
            {/* Darlo de baja con equipos en uso los dejaría apuntando a alguien
                que el formulario ya no ofrece: el backend lo impide, y avisarlo
                aquí evita el intento. */}
            {esEdicion && totales.activos > 0 && (
              <div className="form-text">
                Se le compraron {totales.activos} equipo(s) y{" "}
                {totales.repuestos} repuesto(s): para darlo de baja, cámbieles
                el proveedor primero.
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
            onClick={() => navigate("/admin/organizacion/proveedores")}
          >
            Volver
          </button>
        </div>
      </form>
    </div>
  );
}
