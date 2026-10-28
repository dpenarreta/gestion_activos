import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { sedesService } from "../../../api/organizacionService";
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
  ciudad: "",
  direccion: "",
  region: "",
  provincia: "",
  responsables: [],
  activa: true,
};
// Un error del servidor sobre uno de estos campos va bajo el campo; sobre
// otra cosa, en el aviso de arriba con el detalle completo.
const CAMPOS_DEL_FORMULARIO = new Set(Object.keys(VACIO));

const REGIONES = [
  ["sierra", "Sierra"],
  ["costa", "Costa"],
  ["amazonia", "Amazonía"],
  ["insular", "Insular"],
];

export function SedeForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();
  const puedeEditar = usePermission("organizacion.editar");

  const [valores, setValores] = useState(VACIO);
  const [totalActivos, setTotalActivos] = useState(0);
  const [personas, setPersonas] = useState([]);
  const [error, setError] = useState(null);
  const [erroresCampo, setErroresCampo] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    sedesService
      .personas()
      .then(setPersonas)
      .catch(() => setPersonas([]));
  }, []);

  useEffect(() => {
    if (!esEdicion) return;
    sedesService
      .get(id)
      .then((datos) => {
        setValores({
          nombre: datos.nombre,
          ciudad: datos.ciudad || "",
          direccion: datos.direccion || "",
          region: datos.region || "",
          provincia: datos.provincia || "",
          responsables: datos.responsables ?? [],
          activa: datos.activa,
        });
        setTotalActivos(datos.total_activos ?? 0);
      })
      .catch(() => setError("No se pudo cargar la sede."));
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
        await sedesService.update(id, valores);
      } else {
        await sedesService.create(valores);
      }
      navigate("/admin/organizacion/sedes");
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
          : mensajeDeError(err, "No se pudo guardar la sede."),
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
          <h2>{esEdicion ? "Editar sede" : "Nueva sede"}</h2>
          <p className="mz-desc">
            Un edificio o local donde pueden quedar equipos, con lo necesario
            para ir a buscarlos, y quién responde por él.
          </p>
        </div>
      </div>

      <section className="mz-card organizacion-ficha">
        <div className="mz-card-head">
          <h3>Datos de la sede</h3>
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
              ayuda="Como se la nombra internamente. Es lo que se lee al trasladar un equipo, así que conviene que se distinga de un vistazo de las demás."
              error={erroresCampo.nombre}
              className="mz-field"
            >
              <input
                className="form-control"
                maxLength={120}
                placeholder="Sede Quito Norte"
                value={valores.nombre}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("nombre", event.target.value)}
              />
            </Campo>
            {/* La ayuda es lo que se lee al preguntar dónde está un equipo:
                «está en Quito». El nombre interno de la sede no le dice nada
                a quien tiene que ir a buscarlo. */}
            <Campo
              id="ciudad"
              etiqueta="Ciudad"
              obligatorio
              ayuda="Es lo que se muestra al decir dónde está un equipo."
              error={erroresCampo.ciudad}
              className="mz-field"
            >
              <input
                className="form-control"
                maxLength={120}
                placeholder="Quito"
                value={valores.ciudad}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("ciudad", event.target.value)}
              />
            </Campo>
            <Campo
              id="direccion"
              etiqueta="Dirección"
              ayuda="Para quien tenga que ir a buscar el equipo."
              error={erroresCampo.direccion}
              className="mz-field mz-field--full"
            >
              <input
                className="form-control"
                maxLength={200}
                placeholder="Av. Amazonas y Naciones Unidas"
                value={valores.direccion}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("direccion", event.target.value)
                }
              />
            </Campo>
            <Campo
              id="region"
              etiqueta="Región"
              ayuda="El mantenimiento de sedes reporta por región."
              error={erroresCampo.region}
              className="mz-field"
            >
              <select
                className="form-select"
                value={valores.region}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("region", event.target.value)}
              >
                <option value="">Sin indicar</option>
                {REGIONES.map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo
              id="provincia"
              etiqueta="Provincia"
              error={erroresCampo.provincia}
              className="mz-field"
            >
              <input
                className="form-control"
                maxLength={80}
                placeholder="Pichincha"
                value={valores.provincia}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("provincia", event.target.value)
                }
              />
            </Campo>
            <fieldset
              className="mz-field mz-field--full"
              aria-describedby={
                erroresCampo.responsables ? "responsables-error" : undefined
              }
            >
              <legend className="form-label">Responsables de la sede</legend>
              <div className="form-text mt-0 mb-2">
                Ven las órdenes de trabajo de esta sede y aceptan el trabajo
                terminado (Mantenimiento de sedes). Pueden ser varios.
              </div>
              {personas.length === 0 ? (
                <p className="mz-small mz-faint mb-0">
                  No hay cuentas en esta empresa para elegir.
                </p>
              ) : (
                <div className="sede-responsables">
                  {personas.map((persona) => (
                    <div className="form-check" key={persona.id}>
                      <input
                        id={`responsable-${persona.id}`}
                        type="checkbox"
                        className="form-check-input"
                        checked={valores.responsables.includes(persona.id)}
                        disabled={!puedeEditar}
                        onChange={(event) =>
                          actualizar(
                            "responsables",
                            event.target.checked
                              ? [...valores.responsables, persona.id]
                              : valores.responsables.filter(
                                  (idPersona) => idPersona !== persona.id,
                                ),
                          )
                        }
                      />
                      <label
                        className="form-check-label"
                        htmlFor={`responsable-${persona.id}`}
                      >
                        {persona.nombre}
                      </label>
                    </div>
                  ))}
                </div>
              )}
              {erroresCampo.responsables && (
                <div id="responsables-error" className="mz-field-error">
                  {erroresCampo.responsables}
                </div>
              )}
            </fieldset>
            <div className="mz-field--full">
              <div className="form-check">
                <input
                  id="activa"
                  type="checkbox"
                  className={`form-check-input${erroresCampo.activa ? " is-invalid" : ""}`}
                  checked={valores.activa}
                  disabled={!puedeEditar}
                  aria-invalid={erroresCampo.activa ? true : undefined}
                  aria-describedby={
                    erroresCampo.activa ? "activa-error" : undefined
                  }
                  onChange={(event) =>
                    actualizar("activa", event.target.checked)
                  }
                />
                <label className="form-check-label" htmlFor="activa">
                  Sede abierta
                </label>
              </div>
              {/* Cerrarla dejaría esos equipos en un sitio que el formulario ya
                  no ofrece: el backend lo impide, y avisarlo aquí evita el
                  intento. */}
              {esEdicion && totalActivos > 0 && (
                <div className="form-text">
                  Hay {totalActivos} activo(s) aquí: para cerrarla, muévalos
                  primero.
                </div>
              )}
              {erroresCampo.activa && (
                <div id="activa-error" className="mz-field-error">
                  {erroresCampo.activa}
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
                onClick={() => navigate("/admin/organizacion/sedes")}
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
