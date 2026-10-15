import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { empresasService } from "../../../api/empresasService";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Empresas.css";

const VACIO = {
  nombre: "",
  codigo: "",
  identificacion: "",
  activa: true,
  zona_horaria: "America/Guayaquil",
  color: "#164B86",
  gerente_general: "",
  base_cumplimiento: "validacion",
};

/** Sugerencias para el campo de zona horaria; se acepta cualquier zona IANA,
 * que valida el servidor. */
const ZONAS = [
  "America/Guayaquil",
  "America/Bogota",
  "America/Lima",
  "America/Mexico_City",
  "America/Panama",
  "America/New_York",
  "Europe/Madrid",
  "UTC",
];

export function EmpresaForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();
  const puedeEditar = usePermission("empresas.editar");

  const [valores, setValores] = useState(VACIO);
  const [usuarios, setUsuarios] = useState(0);
  const [personas, setPersonas] = useState([]);
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
          zona_horaria: datos.zona_horaria,
          color: datos.color,
          gerente_general: datos.gerente_general ?? "",
          base_cumplimiento: datos.base_cumplimiento,
        });
        setUsuarios(datos.usuarios ?? 0);
      })
      .catch(() => setError("No se pudo cargar la empresa."));
    empresasService
      .personas(id)
      .then(setPersonas)
      .catch(() => setPersonas([]));
  }, [id, esEdicion]);

  function actualizar(campo, valor) {
    setValores((actuales) => ({ ...actuales, [campo]: valor }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    // Sin gerente se manda `null`, no la cadena vacía del desplegable.
    const datos = {
      ...valores,
      gerente_general: valores.gerente_general || null,
    };
    try {
      if (esEdicion) {
        await empresasService.update(id, datos);
      } else {
        await empresasService.create(datos);
      }
      navigate("/admin/empresas");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la empresa."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>{esEdicion ? "Editar empresa" : "Nueva empresa"}</h2>
          <p className="mz-desc">
            Una empresa del grupo, con su propio inventario y sus propios
            catálogos.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {!esEdicion && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="info-circle" />
          {/* Mientras existe una sola empresa, todas las cuentas trabajan en
              ella sin membresía. Crear la segunda cambia esa regla, y quien no
              lo sepa verá a media empresa quedarse sin datos de golpe. */}
          <div>
            Al crear la segunda empresa, la asignación pasa a ser obligatoria:
            quien no tenga ninguna asignada dejará de ver información. Revise
            Usuarios después de guardar.
          </div>
        </div>
      )}

      <section className="mz-card empresas-ficha">
        <div className="mz-card-head">
          <h3>Datos de la empresa</h3>
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
                placeholder="LaarCourier"
                value={valores.nombre}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("nombre", event.target.value)}
              />
              <div className="form-text">
                Es lo que se lee en el selector del menú, así que conviene que
                se distinga de un vistazo de las demás.
              </div>
            </div>
            <div className="mz-field">
              <label htmlFor="codigo">Código</label>
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
            <div className="mz-field">
              <label htmlFor="identificacion">Identificación</label>
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

          {/* Lo que pide la Matriz de obligaciones (§4.1): sus vencimientos se
              calculan en la hora de cada empresa. */}
          <div className="mz-section mt-3">
            <h4>Matriz de obligaciones</h4>
            <div className="mz-field-grid">
              <div className="mz-field">
                <label htmlFor="zona_horaria">Zona horaria</label>
                <input
                  id="zona_horaria"
                  className="form-control"
                  required
                  list="zonas-horarias"
                  value={valores.zona_horaria}
                  disabled={!puedeEditar}
                  onChange={(event) =>
                    actualizar("zona_horaria", event.target.value)
                  }
                />
                <datalist id="zonas-horarias">
                  {ZONAS.map((zona) => (
                    <option key={zona} value={zona} />
                  ))}
                </datalist>
                <div className="form-text">
                  Los vencimientos y recordatorios se calculan en esta hora.
                </div>
              </div>
              <div className="mz-field">
                <label htmlFor="color">Color</label>
                <div className="empresas-color">
                  <input
                    id="color"
                    type="color"
                    className="form-control form-control-color"
                    value={valores.color}
                    disabled={!puedeEditar}
                    onChange={(event) =>
                      actualizar("color", event.target.value.toUpperCase())
                    }
                  />
                  <span className="mz-mono">{valores.color}</span>
                </div>
                <div className="form-text">
                  Distingue la empresa en el selector y en el menú.
                </div>
              </div>
              <div className="mz-field">
                <label htmlFor="gerente_general">Gerente general</label>
                <select
                  id="gerente_general"
                  className="form-select"
                  value={valores.gerente_general}
                  disabled={!puedeEditar || !esEdicion}
                  onChange={(event) =>
                    actualizar("gerente_general", event.target.value)
                  }
                >
                  <option value="">Sin asignar</option>
                  {personas.map((persona) => (
                    <option key={persona.id} value={persona.id}>
                      {persona.nombre}
                    </option>
                  ))}
                </select>
                <div className="form-text">
                  {esEdicion
                    ? "Aprueba por defecto los cierres. Debe trabajar en la empresa."
                    : "Se elige después de guardar, entre quienes trabajan en ella."}
                </div>
              </div>
              <div className="mz-field">
                <label htmlFor="base_cumplimiento">Cuenta como cumplida</label>
                <select
                  id="base_cumplimiento"
                  className="form-select"
                  value={valores.base_cumplimiento}
                  disabled={!puedeEditar}
                  onChange={(event) =>
                    actualizar("base_cumplimiento", event.target.value)
                  }
                >
                  <option value="validacion">Cuando se valida el cierre</option>
                  <option value="envio">Cuando se envía a validación</option>
                </select>
                <div className="form-text">
                  Qué fecha decide si una obligación se cumplió a tiempo.
                </div>
              </div>
            </div>
          </div>

          <div className="mz-actions justify-content-end mt-3">
            <button
              type="button"
              className="btn btn-cancelar"
              onClick={() => navigate("/admin/empresas")}
            >
              Cancelar
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
