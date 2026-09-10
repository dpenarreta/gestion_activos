import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { empresasService } from "../../../api/empresasService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Empresas.css";

const VACIO = { nombre: "", codigo: "", identificacion: "", activa: true };

export function EmpresaForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();
  const puedeEditar = usePermission("empresas.editar");

  const [valores, setValores] = useState(VACIO);
  const [usuarios, setUsuarios] = useState(0);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!esEdicion) return;
    empresasService
      .get(id)
      .then((datos) => {
        setValores({
          nombre: datos.nombre,
          codigo: datos.codigo,
          identificacion: datos.identificacion || "",
          activa: datos.activa,
        });
        setUsuarios(datos.usuarios ?? 0);
      })
      .catch(() => setError("No se pudo cargar la empresa."));
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
        await empresasService.update(id, valores);
      } else {
        await empresasService.create(valores);
      }
      navigate("/admin/empresas");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la empresa."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="empresas-page">
      <Breadcrumbs
        items={[
          { label: "Administración" },
          { label: "Empresas", path: "/admin/empresas" },
          { label: esEdicion ? "Editar" : "Nueva" },
        ]}
      />
      <h2>{esEdicion ? "Editar empresa" : "Nueva empresa"}</h2>

      {error && <div className="alert alert-danger">{error}</div>}

      {!esEdicion && (
        <div className="alert alert-info">
          {/* Mientras existe una sola empresa, todas las cuentas trabajan en
              ella sin membresía. Crear la segunda cambia esa regla, y quien no
              lo sepa verá a media empresa quedarse sin datos de golpe. */}
          Al crear la segunda empresa, la asignación pasa a ser obligatoria:
          quien no tenga ninguna asignada dejará de ver información. Revise
          Usuarios después de guardar.
        </div>
      )}

      <form onSubmit={handleSubmit} className="empresas-form">
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
              placeholder="LaarCourier"
              value={valores.nombre}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("nombre", event.target.value)}
            />
            <div className="form-text">
              Es lo que se lee en el selector del menú, así que conviene que se
              distinga de un vistazo de las demás.
            </div>
          </div>
          <div className="col-md-5">
            <label className="form-label" htmlFor="codigo">
              Código
            </label>
            <input
              id="codigo"
              className="form-control"
              required
              maxLength={10}
              placeholder="LC"
              value={valores.codigo}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("codigo", event.target.value)}
            />
            <div className="form-text">
              Identificador corto. Es lo que se muestra en el menú contraído.
            </div>
          </div>
          <div className="col-md-7">
            <label className="form-label" htmlFor="identificacion">
              Identificación
            </label>
            <input
              id="identificacion"
              className="form-control"
              maxLength={20}
              placeholder="1790012345001"
              value={valores.identificacion}
              disabled={!puedeEditar}
              onChange={(event) =>
                actualizar("identificacion", event.target.value)
              }
            />
            <div className="form-text">RUC o identificación tributaria.</div>
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
                Empresa activa
              </label>
            </div>
            <div className="form-text">
              {/* Es la dueña de todo lo registrado: borrarla dejaría el
                  inventario huérfano, así que no se elimina, se desactiva. */}
              Desactivarla la saca del selector sin borrar su información.
              {esEdicion && usuarios > 0 && (
                <> Hoy trabajan aquí {usuarios} usuario(s).</>
              )}
            </div>
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
            className="btn btn-cancelar"
            onClick={() => navigate("/admin/empresas")}
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
