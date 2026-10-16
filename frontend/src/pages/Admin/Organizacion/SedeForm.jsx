import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { sedesService } from "../../../api/organizacionService";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
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
  const [isSaving, setIsSaving] = useState(false);

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

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <section className="mz-card organizacion-ficha">
        <div className="mz-card-head">
          <h3>Datos de la sede</h3>
        </div>
        <form onSubmit={handleSubmit} className="mz-card-body">
          <div className="mz-field-grid">
            <div className="mz-field">
              <label htmlFor="nombre">Nombre</label>
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
            <div className="mz-field">
              <label htmlFor="ciudad">Ciudad</label>
              <input
                id="ciudad"
                className="form-control"
                required
                maxLength={120}
                placeholder="Quito"
                value={valores.ciudad}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("ciudad", event.target.value)}
              />
              <div className="form-text">
                {/* Es lo que se lee al preguntar dónde está un equipo: «está en
                    Quito». El nombre interno de la sede no le dice nada a quien
                    tiene que ir a buscarlo. */}
                Es lo que se muestra al decir dónde está un equipo.
              </div>
            </div>
            <div className="mz-field mz-field--full">
              <label htmlFor="direccion">Dirección</label>
              <input
                id="direccion"
                className="form-control"
                maxLength={200}
                placeholder="Av. Amazonas y Naciones Unidas"
                value={valores.direccion}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("direccion", event.target.value)
                }
              />
              <div className="form-text">
                Para quien tenga que ir a buscar el equipo.
              </div>
            </div>
            <div className="mz-field">
              <label htmlFor="region">Región</label>
              <select
                id="region"
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
              <div className="form-text">
                El mantenimiento de sedes reporta por región.
              </div>
            </div>
            <div className="mz-field">
              <label htmlFor="provincia">Provincia</label>
              <input
                id="provincia"
                className="form-control"
                maxLength={80}
                placeholder="Pichincha"
                value={valores.provincia}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("provincia", event.target.value)
                }
              />
            </div>
            <fieldset className="mz-field mz-field--full">
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
            </fieldset>
            <div className="mz-field--full">
              <div className="form-check">
                <input
                  id="activa"
                  type="checkbox"
                  className="form-check-input"
                  checked={valores.activa}
                  disabled={!puedeEditar}
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
            </div>
          </div>

          <div className="mz-actions justify-content-end mt-3">
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
        </form>
      </section>
    </div>
  );
}
