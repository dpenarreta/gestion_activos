import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { concesionariosService } from "../../../api/organizacionService";
import {
  Campo,
  enfocarPrimerError,
  LeyendaObligatorios,
} from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import {
  hayErroresGenerales,
  erroresPorCampo,
  mensajeDeError,
} from "../../../utils/errores";
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
// Un error del servidor sobre uno de estos campos va bajo el campo; sobre
// otra cosa, en el aviso de arriba con el detalle completo.
const CAMPOS_DEL_FORMULARIO = new Set(Object.keys(VACIO));

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
  const [erroresCampo, setErroresCampo] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const formRef = useRef(null);

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
    // Lo corregido deja de marcarse como error.
    setErroresCampo((actuales) =>
      actuales[campo] ? { ...actuales, [campo]: undefined } : actuales,
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setErroresCampo({});
    try {
      if (esEdicion) {
        await concesionariosService.update(id, valores);
      } else {
        await concesionariosService.create(valores);
      }
      navigate("/admin/organizacion/concesionarios");
    } catch (err) {
      // Cada error bajo su campo y, arriba, un aviso general; si alguno no es
      // de un campo del formulario, el aviso lleva el detalle completo
      // (auditoría UX/UI, fase 2, 28/10/2026).
      const porCampo = erroresPorCampo(err);
      const claves = Object.keys(porCampo);
      setErroresCampo(porCampo);
      setError(
        claves.length > 0 &&
          claves.every((clave) => CAMPOS_DEL_FORMULARIO.has(clave)) &&
          !hayErroresGenerales(err)
          ? "Revise los campos marcados."
          : mensajeDeError(err, "No se pudo guardar el concesionario."),
      );
      enfocarPrimerError(formRef.current);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>{esEdicion ? "Editar concesionario" : "Nuevo concesionario"}</h2>
          <p className="mz-desc">
            El partner dueño de los equipos en concesión, y a quién llamar para
            coordinar con él.
          </p>
        </div>
      </div>

      <section className="mz-card organizacion-ficha">
        <div className="mz-card-head">
          <h3>Datos del concesionario</h3>
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="mz-card-body">
          {/* Dentro del formulario: tras un error, el foco puede ir aquí si
              ningún campo quedó marcado. */}
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {/* Obligatorios marcados y cada error del servidor bajo su campo
              (auditoría UX/UI, fase 2, 28/10/2026). */}
          <div className="mz-field-grid">
            <Campo
              id="nombre"
              etiqueta="Nombre"
              obligatorio
              ayuda="Como aparece en el contrato. Escrito de dos formas distintas serían dos partners, con sus equipos repartidos entre ambos."
              error={erroresCampo.nombre}
              className="mz-field"
            >
              <input
                className="form-control"
                maxLength={150}
                placeholder="Servientrega Andina"
                value={valores.nombre}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("nombre", event.target.value)}
              />
            </Campo>
            <Campo
              id="identificacion"
              etiqueta="Identificación"
              ayuda="RUC o identificación tributaria."
              error={erroresCampo.identificacion}
              className="mz-field"
            >
              <input
                className="form-control"
                maxLength={20}
                placeholder="0992222333001"
                value={valores.identificacion}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("identificacion", event.target.value)
                }
              />
            </Campo>

            <Campo
              id="contacto"
              etiqueta="Contacto"
              error={erroresCampo.contacto}
              className="mz-field"
            >
              <input
                className="form-control"
                maxLength={120}
                placeholder="Quién atiende la relación"
                value={valores.contacto}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("contacto", event.target.value)}
              />
            </Campo>
            <Campo
              id="telefono"
              etiqueta="Teléfono"
              ayuda="A quién llamar para coordinar una devolución o un reemplazo."
              error={erroresCampo.telefono}
              className="mz-field"
            >
              <input
                className="form-control"
                maxLength={30}
                value={valores.telefono}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("telefono", event.target.value)}
              />
            </Campo>
            <Campo
              id="correo"
              etiqueta="Correo"
              error={erroresCampo.correo}
              className="mz-field"
            >
              <input
                type="email"
                className="form-control"
                value={valores.correo}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("correo", event.target.value)}
              />
            </Campo>

            <Campo
              id="observaciones"
              etiqueta="Condiciones de la concesión"
              error={erroresCampo.observaciones}
              className="mz-field mz-field--full"
            >
              <textarea
                className="form-control"
                rows={2}
                placeholder="Qué cubre cada parte y hasta cuándo"
                value={valores.observaciones}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("observaciones", event.target.value)
                }
              />
            </Campo>

            <div className="mz-field--full">
              <div className="form-check">
                <input
                  id="activo"
                  type="checkbox"
                  className={`form-check-input${erroresCampo.activo ? " is-invalid" : ""}`}
                  checked={valores.activo}
                  disabled={!puedeEditar}
                  aria-invalid={erroresCampo.activo ? true : undefined}
                  aria-describedby={
                    erroresCampo.activo ? "activo-error" : undefined
                  }
                  onChange={(event) =>
                    actualizar("activo", event.target.checked)
                  }
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
              {erroresCampo.activo && (
                <div id="activo-error" className="mz-field-error">
                  {erroresCampo.activo}
                </div>
              )}
            </div>
          </div>

          <div className="mz-actions justify-content-between align-items-center mt-3">
            <LeyendaObligatorios />
            <div className="d-flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-cancelar"
                onClick={() => navigate("/admin/organizacion/concesionarios")}
              >
                Volver
              </button>
              {puedeEditar && (
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSaving}
                >
                  {isSaving ? "Guardando…" : "Guardar"}
                </button>
              )}
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
