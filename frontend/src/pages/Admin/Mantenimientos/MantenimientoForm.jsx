import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { activosService } from "../../../api/activosService";
import { componentesService, mantenimientosService } from "../../../api/mantenimientosService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { LineasComponentes } from "../../../components/mantenimientos/LineasComponentes/LineasComponentes";
import { mensajeDeError } from "../../../utils/errores";
import "./Mantenimientos.css";

const hoy = () => new Date().toISOString().slice(0, 10);

const CAUSAS_SUGERIDAS = [
  "Pantalla dañada",
  "Batería agotada",
  "Disco fallando",
  "Teclado dañado",
  "Lentitud",
  "Virus o malware",
  "Fuente de poder",
  "Sobrecalentamiento",
  "Falla de red",
  "Mantenimiento preventivo",
];

/** Días entre ingreso y salida, para mostrarlos mientras se captura. */
function diasFuera({ fecha_intervencion: ingreso, fecha_salida: salida }) {
  if (!ingreso || !salida) return 0;
  const dias = (new Date(salida) - new Date(ingreso)) / 86400000;
  return Math.max(Math.round(dias), 0);
}

const VACIO = {
  activo: "",
  tipo: "correctivo",
  fecha_intervencion: hoy(),
  fecha_salida: "",
  tipo_responsable: "tecnico_interno",
  responsable: "",
  causa: "",
  descripcion: "",
  diagnostico: "",
  solucion: "",
  estado_final: "reparado",
  garantia_usada: false,
  costo_mano_obra: "",
};

const ESTADOS_FINALES = [
  { valor: "reparado", etiqueta: "Reparado" },
  { valor: "pendiente", etiqueta: "Pendiente" },
  { valor: "no_reparable", etiqueta: "No reparable" },
  { valor: "dado_de_baja", etiqueta: "Dado de baja" },
];

export function MantenimientoForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [valores, setValores] = useState(() => ({
    ...VACIO,
    // Permite entrar desde la ficha de un activo con el equipo ya elegido.
    activo: searchParams.get("activo") || "",
  }));
  const [lineas, setLineas] = useState([]);
  const [activos, setActivos] = useState([]);
  const [componentes, setComponentes] = useState([]);
  const [activoSeleccionado, setActivoSeleccionado] = useState(null);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Solo activos vigentes: el backend rechaza intervenciones sobre equipos
    // dados de baja, y ofrecerlos aquí solo produciría un error al guardar.
    activosService
      .list({ page_size: 300 })
      .then((datos) =>
        setActivos((datos.results ?? datos).filter((activo) => activo.estado !== "dado_de_baja"))
      )
      .catch(() => setActivos([]));
    componentesService
      .list({ page_size: 200 })
      .then((datos) => setComponentes((datos.results ?? datos).filter((c) => c.activo)))
      .catch(() => setComponentes([]));
  }, []);

  useEffect(() => {
    if (!esEdicion) return;
    mantenimientosService
      .get(id)
      .then((datos) => {
        setValores({
          activo: datos.activo,
          tipo: datos.tipo,
          fecha_intervencion: datos.fecha_intervencion,
          fecha_salida: datos.fecha_salida || "",
          tipo_responsable: datos.tipo_responsable,
          responsable: datos.responsable,
          causa: datos.causa || "",
          descripcion: datos.descripcion,
          diagnostico: datos.diagnostico || "",
          solucion: datos.solucion || "",
          estado_final: datos.estado_final,
          garantia_usada: datos.garantia_usada,
          costo_mano_obra: datos.costo_mano_obra || "",
        });
        setLineas(
          datos.componentes.map((componente) => ({
            componente: componente.componente,
            cantidad: componente.cantidad,
            costo_unitario: componente.costo_unitario || "",
            numero_serie_nuevo: componente.numero_serie_nuevo || "",
          }))
        );
      })
      .catch(() => setError("No se pudo cargar la intervención."));
  }, [id, esEdicion]);

  // La fecha no puede ser anterior a la compra del equipo; conocerla permite
  // acotar el selector de fecha en vez de esperar al error del servidor.
  useEffect(() => {
    if (!valores.activo) {
      setActivoSeleccionado(null);
      return;
    }
    const encontrado = activos.find((activo) => String(activo.id) === String(valores.activo));
    setActivoSeleccionado(encontrado || null);
  }, [valores.activo, activos]);

  function actualizar(campo, valor) {
    setValores((actuales) => ({ ...actuales, [campo]: valor }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        ...valores,
        // Vacío significa «sigue fuera de operación», no una fecha en blanco.
        fecha_salida: valores.fecha_salida || null,
        costo_mano_obra: valores.costo_mano_obra || null,
        componentes: lineas
          .filter((linea) => linea.componente)
          .map((linea) => ({
            componente: linea.componente,
            cantidad: Number(linea.cantidad) || 1,
            costo_unitario: linea.costo_unitario || null,
            numero_serie_nuevo: linea.numero_serie_nuevo || "",
          })),
      };
      if (esEdicion) {
        await mantenimientosService.update(id, payload);
      } else {
        await mantenimientosService.create(payload);
      }
      // Volver a la ficha del activo cuando se entró desde ella: es donde el
      // usuario quiere ver reflejado el contador que acaba de mover.
      navigate(valores.activo ? `/admin/activos/${valores.activo}` : "/admin/mantenimientos");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la intervención."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mantenimientos-page">
      <Breadcrumbs
        items={[
          { label: "Administración" },
          { label: "Mantenimientos", path: "/admin/mantenimientos" },
          { label: esEdicion ? "Editar" : "Registrar" },
        ]}
      />
      <h2>{esEdicion ? "Editar intervención" : "Registrar mantenimiento"}</h2>

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={handleSubmit} className="mantenimiento-form">
        <fieldset className="mb-4">
          <legend className="h6 text-uppercase text-muted">Intervención</legend>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label" htmlFor="activo">
                Activo intervenido
              </label>
              <select
                id="activo"
                className="form-select"
                required
                disabled={esEdicion}
                value={valores.activo}
                onChange={(event) => actualizar("activo", event.target.value)}
              >
                <option value="">Seleccione un activo</option>
                {activos.map((activo) => (
                  <option key={activo.id} value={activo.id}>
                    {activo.codigo_barras} — {activo.nombre}
                  </option>
                ))}
              </select>
              {esEdicion && (
                <div className="form-text">
                  Una intervención no cambia de activo. Si se capturó sobre el equipo equivocado,
                  elimínela y regístrela de nuevo.
                </div>
              )}
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="tipo">
                Tipo
              </label>
              <select
                id="tipo"
                className="form-select"
                value={valores.tipo}
                onChange={(event) => actualizar("tipo", event.target.value)}
              >
                <option value="correctivo">Correctivo</option>
                <option value="preventivo">Preventivo</option>
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="fecha">
                Fecha de ingreso
              </label>
              <input
                id="fecha"
                type="date"
                className="form-control"
                required
                max={hoy()}
                min={activoSeleccionado?.fecha_adquisicion}
                value={valores.fecha_intervencion}
                onChange={(event) => actualizar("fecha_intervencion", event.target.value)}
              />
              {activoSeleccionado && (
                <div className="form-text">
                  El equipo se adquirió el {activoSeleccionado.fecha_adquisicion}.
                </div>
              )}
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="fecha_salida">
                Fecha de salida
              </label>
              <input
                id="fecha_salida"
                type="date"
                className="form-control"
                max={hoy()}
                min={valores.fecha_intervencion || undefined}
                value={valores.fecha_salida}
                onChange={(event) => actualizar("fecha_salida", event.target.value)}
              />
              <div className="form-text">
                {valores.fecha_salida
                  ? `${diasFuera(valores)} día(s) fuera de operación.`
                  : "Vacío mientras el equipo siga fuera de operación."}
              </div>
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="tipo_responsable">
                A cargo de
              </label>
              <select
                id="tipo_responsable"
                className="form-select"
                value={valores.tipo_responsable}
                onChange={(event) => actualizar("tipo_responsable", event.target.value)}
              >
                <option value="tecnico_interno">Técnico interno</option>
                <option value="proveedor_externo">Proveedor externo</option>
              </select>
            </div>
            <div className="col-md-8">
              <label className="form-label" htmlFor="responsable">
                Nombre del técnico o proveedor
              </label>
              <input
                id="responsable"
                className="form-control"
                required
                maxLength={150}
                value={valores.responsable}
                onChange={(event) => actualizar("responsable", event.target.value)}
              />
            </div>
            <div className="col-md-6">
              <label className="form-label" htmlFor="causa">
                Causa de la falla
              </label>
              <input
                id="causa"
                className="form-control"
                list="causas-frecuentes"
                maxLength={150}
                placeholder="Pantalla dañada, batería, disco, lentitud…"
                value={valores.causa}
                onChange={(event) => actualizar("causa", event.target.value)}
              />
              {/* Sugerencias para que la misma falla no se escriba de tres
                  formas distintas: es lo que permite ver causas recurrentes. */}
              <datalist id="causas-frecuentes">
                {CAUSAS_SUGERIDAS.map((causa) => (
                  <option key={causa} value={causa} />
                ))}
              </datalist>
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="estado_final">
                Estado final
              </label>
              <select
                id="estado_final"
                className="form-select"
                value={valores.estado_final}
                onChange={(event) => actualizar("estado_final", event.target.value)}
              >
                {ESTADOS_FINALES.map((opcion) => (
                  <option key={opcion.valor} value={opcion.valor}>
                    {opcion.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3 d-flex align-items-end">
              <div className="form-check mb-2">
                <input
                  id="garantia_usada"
                  type="checkbox"
                  className="form-check-input"
                  checked={valores.garantia_usada}
                  onChange={(event) => actualizar("garantia_usada", event.target.checked)}
                />
                <label className="form-check-label" htmlFor="garantia_usada">
                  Cubierto por garantía
                </label>
              </div>
            </div>
            <div className="col-12">
              <label className="form-label" htmlFor="descripcion">
                Trabajo realizado
              </label>
              <textarea
                id="descripcion"
                className="form-control"
                rows={2}
                required
                value={valores.descripcion}
                onChange={(event) => actualizar("descripcion", event.target.value)}
              />
            </div>
            <div className="col-12">
              <label className="form-label" htmlFor="diagnostico">
                Diagnóstico
              </label>
              <textarea
                id="diagnostico"
                className="form-control"
                rows={2}
                value={valores.diagnostico}
                onChange={(event) => actualizar("diagnostico", event.target.value)}
              />
            </div>
            <div className="col-12">
              <label className="form-label" htmlFor="solucion">
                Solución aplicada
              </label>
              <textarea
                id="solucion"
                className="form-control"
                rows={2}
                value={valores.solucion}
                onChange={(event) => actualizar("solucion", event.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="costo_mano_obra">
                Costo de mano de obra
              </label>
              <input
                id="costo_mano_obra"
                type="number"
                step="0.01"
                min="0"
                className="form-control"
                value={valores.costo_mano_obra}
                onChange={(event) => actualizar("costo_mano_obra", event.target.value)}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="mb-4">
          <legend className="h6 text-uppercase text-muted">Componentes y repuestos utilizados</legend>
          <LineasComponentes
            lineas={lineas}
            componentes={componentes}
            onChange={setLineas}
            esEdicion={esEdicion}
          />
        </fieldset>

        <div className="d-flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving ? "Guardando…" : esEdicion ? "Guardar cambios" : "Registrar intervención"}
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => navigate("/admin/mantenimientos")}
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
