import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  activosService,
  tiposDispositivoService,
} from "../../../api/activosService";
import {
  departamentosService,
  empleadosService,
  sedesService,
} from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { EspecificacionesEditor } from "../../../components/activos/EspecificacionesEditor/EspecificacionesEditor";
import { mensajeDeError } from "../../../utils/errores";
import "./Activos.css";

const VACIO = {
  tipo: "",
  nombre: "",
  marca: "",
  modelo: "",
  numero_serie: "",
  especificaciones: {},
  observaciones: "",
  custodio: "",
  departamento: "",
  sede: "",
  criticidad: "media",
  uso: "administrativo",
  fecha_adquisicion: "",
  fecha_ingreso: "",
  costo_adquisicion: "",
  proveedor: "",
  fecha_fin_garantia: "",
};

export function ActivoForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();

  const [valores, setValores] = useState(VACIO);
  const [tipos, setTipos] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [sedes, setSedes] = useState([]);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    tiposDispositivoService
      .list({ page_size: 100 })
      .then((datos) =>
        setTipos((datos.results ?? datos).filter((tipo) => tipo.activo)),
      )
      .catch(() => setTipos([]));
    departamentosService
      .list({ activo: "true", page_size: 100 })
      .then((datos) => setDepartamentos(datos.results ?? datos))
      .catch(() => setDepartamentos([]));
    empleadosService
      .list({ activo: "true", page_size: 200 })
      .then((datos) => setEmpleados(datos.results ?? datos))
      .catch(() => setEmpleados([]));
    // Solo sedes abiertas: dejar un equipo en una sede cerrada lo deja
    // registrado en un sitio donde nadie va a buscarlo.
    sedesService
      .list({ activa: "true", page_size: 100 })
      .then((datos) => setSedes(datos.results ?? datos))
      .catch(() => setSedes([]));
  }, []);

  useEffect(() => {
    if (!esEdicion) return;
    activosService
      .get(id)
      .then((datos) =>
        setValores({
          tipo: datos.tipo,
          nombre: datos.nombre,
          marca: datos.marca,
          modelo: datos.modelo,
          numero_serie: datos.numero_serie,
          especificaciones: datos.especificaciones || {},
          observaciones: datos.observaciones || "",
          custodio: datos.custodio || "",
          departamento: datos.departamento,
          sede: datos.sede || "",
          criticidad: datos.criticidad || "media",
          uso: datos.uso || "administrativo",
          fecha_ingreso: datos.fecha_ingreso || "",
          fecha_adquisicion: datos.fecha_adquisicion,
          costo_adquisicion: datos.costo_adquisicion || "",
          proveedor: datos.proveedor || "",
          fecha_fin_garantia: datos.fecha_fin_garantia || "",
        }),
      )
      .catch(() => setError("No se pudo cargar el activo."));
  }, [id, esEdicion]);

  function actualizar(campo, valor) {
    setValores((actuales) => ({ ...actuales, [campo]: valor }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        tipo: valores.tipo,
        nombre: valores.nombre,
        marca: valores.marca,
        modelo: valores.modelo,
        numero_serie: valores.numero_serie,
        especificaciones: valores.especificaciones,
        observaciones: valores.observaciones,
        sede: valores.sede || null,
        criticidad: valores.criticidad,
        uso: valores.uso,
        fecha_adquisicion: valores.fecha_adquisicion,
        fecha_ingreso: valores.fecha_ingreso || null,
        costo_adquisicion: valores.costo_adquisicion || null,
        proveedor: valores.proveedor,
        fecha_fin_garantia: valores.fecha_fin_garantia || null,
      };

      if (esEdicion) {
        // Custodio y departamento no se envían al editar: cambiarlos exige la
        // acción de asignación, que deja el movimiento en el historial. El
        // backend los ignora aquí de todos modos.
        await activosService.update(id, payload);
        navigate(`/admin/activos/${id}`);
      } else {
        const creado = await activosService.create({
          ...payload,
          custodio: valores.custodio || null,
          departamento: valores.departamento,
        });
        navigate(`/admin/activos/${creado.id}`);
      }
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el activo."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="activos-page">
      <Breadcrumbs
        items={[
          { label: "Administración" },
          { label: "Activos", path: "/admin/activos" },
          { label: esEdicion ? "Editar ficha" : "Nuevo activo" },
        ]}
      />
      <h2>{esEdicion ? "Editar ficha técnica" : "Nuevo activo"}</h2>

      {!esEdicion && (
        <p className="text-muted">
          El código de barras se genera automáticamente al guardar, a partir del
          tipo de dispositivo.
        </p>
      )}

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={handleSubmit} className="activo-form">
        <fieldset className="mb-4">
          <legend className="h6 text-uppercase text-muted">
            Identificación
          </legend>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label" htmlFor="tipo">
                Tipo de dispositivo
              </label>
              <select
                id="tipo"
                className="form-select"
                required
                value={valores.tipo}
                onChange={(event) => actualizar("tipo", event.target.value)}
              >
                <option value="">Seleccione un tipo</option>
                {tipos.map((tipo) => (
                  <option key={tipo.id} value={tipo.id}>
                    {tipo.nombre} ({tipo.codigo})
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-8">
              <label className="form-label" htmlFor="nombre">
                Nombre del activo
              </label>
              <input
                id="nombre"
                className="form-control"
                required
                maxLength={150}
                placeholder="Laptop Contabilidad 01"
                value={valores.nombre}
                onChange={(event) => actualizar("nombre", event.target.value)}
              />
              <div className="form-text">
                Se imprime en la etiqueta, junto al código de barras.
              </div>
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="marca">
                Marca
              </label>
              <input
                id="marca"
                className="form-control"
                required
                maxLength={80}
                value={valores.marca}
                onChange={(event) => actualizar("marca", event.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="modelo">
                Modelo
              </label>
              <input
                id="modelo"
                className="form-control"
                required
                maxLength={120}
                value={valores.modelo}
                onChange={(event) => actualizar("modelo", event.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="numero_serie">
                Número de serie
              </label>
              <input
                id="numero_serie"
                className="form-control font-monospace"
                required
                maxLength={120}
                value={valores.numero_serie}
                onChange={(event) =>
                  actualizar("numero_serie", event.target.value)
                }
              />
              <div className="form-text">Único en todo el inventario.</div>
            </div>
          </div>
        </fieldset>

        <fieldset className="mb-4">
          <legend className="h6 text-uppercase text-muted">
            Especificaciones del hardware
          </legend>
          <EspecificacionesEditor
            valor={valores.especificaciones}
            onChange={(especificaciones) =>
              actualizar("especificaciones", especificaciones)
            }
          />
        </fieldset>

        <fieldset className="mb-4">
          <legend className="h6 text-uppercase text-muted">
            Custodia y ubicación
          </legend>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label" htmlFor="departamento">
                Departamento
              </label>
              <select
                id="departamento"
                className="form-select"
                required={!esEdicion}
                disabled={esEdicion}
                value={valores.departamento}
                onChange={(event) =>
                  actualizar("departamento", event.target.value)
                }
              >
                <option value="">Seleccione un departamento</option>
                {departamentos.map((departamento) => (
                  <option key={departamento.id} value={departamento.id}>
                    {departamento.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-6">
              <label className="form-label" htmlFor="custodio">
                Custodio
              </label>
              <select
                id="custodio"
                className="form-select"
                disabled={esEdicion}
                value={valores.custodio}
                onChange={(event) => actualizar("custodio", event.target.value)}
              >
                <option value="">Sin asignar (queda en bodega)</option>
                {empleados.map((empleado) => (
                  <option key={empleado.id} value={empleado.id}>
                    {empleado.nombre_completo}
                  </option>
                ))}
              </select>
            </div>
            {esEdicion && (
              <div className="col-12">
                <div className="form-text">
                  El custodio y el departamento se cambian desde la ficha, con
                  la acción «Asignar / trasladar»: así el cambio queda
                  registrado en el historial.
                </div>
              </div>
            )}
            <div className="col-md-6">
              <label className="form-label" htmlFor="sede">
                Sede
              </label>
              <select
                id="sede"
                className="form-select"
                value={valores.sede}
                onChange={(event) => actualizar("sede", event.target.value)}
              >
                <option value="">Sin sede registrada</option>
                {sedes.map((sede) => (
                  <option key={sede.id} value={sede.id}>
                    {sede.nombre}
                    {sede.ciudad ? ` — ${sede.ciudad}` : ""}
                  </option>
                ))}
              </select>
              <div className="form-text">
                {/* El catálogo es lo que hace que el filtro por sede devuelva
                    todos los equipos que están ahí y no solo los que alguien
                    escribió igual. */}
                Se administra en Organización → Sedes.
              </div>
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="criticidad">
                Criticidad
              </label>
              <select
                id="criticidad"
                className="form-select"
                value={valores.criticidad}
                onChange={(event) =>
                  actualizar("criticidad", event.target.value)
                }
              >
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="critica">Crítica</option>
              </select>
              <div className="form-text">
                Qué tan urgente es reponerlo si falla.
              </div>
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="uso">
                Uso
              </label>
              <select
                id="uso"
                className="form-select"
                value={valores.uso}
                onChange={(event) => actualizar("uso", event.target.value)}
              >
                <option value="administrativo">Administrativo</option>
                <option value="operativo">Operativo</option>
                <option value="desarrollo">Desarrollo</option>
                <option value="diseno">Diseño</option>
                <option value="gerencial">Gerencial</option>
                <option value="atencion_cliente">Atención al cliente</option>
                <option value="bodega">Bodega</option>
                <option value="infraestructura">Infraestructura</option>
              </select>
              <div className="form-text">
                La función que cumple, no cuánto se usa.
              </div>
            </div>
          </div>
        </fieldset>

        <fieldset className="mb-4">
          <legend className="h6 text-uppercase text-muted">Adquisición</legend>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label" htmlFor="fecha_adquisicion">
                Fecha de adquisición
              </label>
              <input
                id="fecha_adquisicion"
                type="date"
                className="form-control"
                required
                value={valores.fecha_adquisicion}
                onChange={(event) =>
                  actualizar("fecha_adquisicion", event.target.value)
                }
              />
              <div className="form-text">
                Base del cálculo de vida útil del equipo.
              </div>
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="fecha_ingreso">
                Fecha de ingreso
              </label>
              <input
                id="fecha_ingreso"
                type="date"
                className="form-control"
                value={valores.fecha_ingreso}
                onChange={(event) =>
                  actualizar("fecha_ingreso", event.target.value)
                }
              />
              <div className="form-text">
                {/* La garantía corre desde la compra y la custodia desde el
                    ingreso: un equipo comprado en diciembre puede entrar en
                    marzo. */}
                Cuándo entró al inventario, si es distinta de la compra.
              </div>
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="costo_adquisicion">
                Costo de compra
              </label>
              <input
                id="costo_adquisicion"
                type="number"
                step="0.01"
                min="0"
                className="form-control"
                value={valores.costo_adquisicion}
                onChange={(event) =>
                  actualizar("costo_adquisicion", event.target.value)
                }
              />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="proveedor">
                Proveedor
              </label>
              <input
                id="proveedor"
                className="form-control"
                maxLength={150}
                value={valores.proveedor}
                onChange={(event) =>
                  actualizar("proveedor", event.target.value)
                }
              />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="fecha_fin_garantia">
                Fin de garantía
              </label>
              <input
                id="fecha_fin_garantia"
                type="date"
                className="form-control"
                min={valores.fecha_adquisicion || undefined}
                value={valores.fecha_fin_garantia}
                onChange={(event) =>
                  actualizar("fecha_fin_garantia", event.target.value)
                }
              />
              <div className="form-text">
                Déjelo vacío si el equipo no tiene garantía registrada.
              </div>
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
                onChange={(event) =>
                  actualizar("observaciones", event.target.value)
                }
              />
            </div>
          </div>
        </fieldset>

        <div className="d-flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving
              ? "Guardando…"
              : esEdicion
                ? "Guardar cambios"
                : "Registrar activo"}
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() =>
              navigate(esEdicion ? `/admin/activos/${id}` : "/admin/activos")
            }
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
