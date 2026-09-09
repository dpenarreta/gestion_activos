import { useEffect, useMemo, useState } from "react";

import { activosService } from "../../../api/activosService";
import {
  departamentosService,
  empleadosService,
  ubicacionesService,
} from "../../../api/organizacionService";
import { ModalDialog } from "../../common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../../utils/errores";
import "./AsignarCustodioDialog.css";

const MODOS = {
  ASIGNAR: "asignar",
  TRASLADAR: "trasladar",
};

/**
 * Entrega, devolución y traslado de un activo (RF-01).
 *
 * Las dos operaciones se piden desde el mismo sitio pero mueven cosas
 * distintas: **entregar** cambia de quién responde por el equipo, **trasladar**
 * cambia dónde está. Mezclarlas en un solo formulario obligaba a rellenar
 * campos que no venían al caso y, peor, dejaba dudas sobre qué se iba a
 * modificar: cambiar de bodega no debería tocar al custodio, ni al revés.
 *
 * Arriba va siempre la situación actual —quién lo tiene, de qué área y dónde
 * está—, porque es lo primero que se comprueba antes de mover un equipo y
 * porque el registro que queda en el historial es «de esto a esto»: sin ver el
 * punto de partida, el destino solo es la mitad del dato.
 */
export function AsignarCustodioDialog({ activo, onCerrar, onGuardado }) {
  const [empleados, setEmpleados] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [ubicaciones, setUbicaciones] = useState([]);

  const [modo, setModo] = useState(MODOS.ASIGNAR);
  const [custodio, setCustodio] = useState(activo.custodio || "");
  const [departamento, setDepartamento] = useState(activo.departamento || "");
  const [ubicacion, setUbicacion] = useState(activo.ubicacion || "");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    empleadosService
      .list({ activo: "true", page_size: 200 })
      .then((datos) => setEmpleados(datos.results ?? datos))
      .catch(() => setEmpleados([]));
    departamentosService
      .list({ activo: "true", page_size: 100 })
      .then((datos) => setDepartamentos(datos.results ?? datos))
      .catch(() => setDepartamentos([]));
    ubicacionesService
      .list({ activa: "true", page_size: 100 })
      .then((datos) => setUbicaciones(datos.results ?? datos))
      .catch(() => setUbicaciones([]));
  }, []);

  const empleadoElegido = useMemo(
    () => empleados.find((e) => String(e.id) === String(custodio)),
    [empleados, custodio],
  );
  const ubicacionElegida = useMemo(
    () => ubicaciones.find((u) => String(u.id) === String(ubicacion)),
    [ubicaciones, ubicacion],
  );

  /**
   * Al elegir a una persona, el área se propone sola: un equipo entregado a
   * alguien de Contabilidad normalmente pasa a Contabilidad, y hacer que el
   * usuario lo seleccione dos veces invita a dejarlo descuadrado. Sigue siendo
   * editable, porque un préstamo entre áreas es un caso legítimo.
   */
  function elegirCustodio(id) {
    setCustodio(id);
    const persona = empleados.find((e) => String(e.id) === String(id));
    if (persona?.departamento) {
      setDepartamento(String(persona.departamento));
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      // Cada modo manda solo lo suyo: en un traslado no se envían custodio ni
      // área, así que el backend no los toca. Es lo que garantiza que mover un
      // equipo de bodega no le cambie el responsable por descuido.
      const datos =
        modo === MODOS.TRASLADAR
          ? {
              custodio: activo.custodio || null,
              ubicacion: ubicacion || null,
              motivo,
            }
          : {
              custodio: custodio || null,
              departamento: departamento || null,
              motivo,
            };

      await activosService.asignar(activo.id, datos);
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo registrar el movimiento."));
      setIsSaving(false);
    }
  }

  const esDevolucion =
    modo === MODOS.ASIGNAR && !custodio && Boolean(activo.custodio);
  const hayCambio =
    modo === MODOS.TRASLADAR
      ? String(ubicacion || "") !== String(activo.ubicacion || "")
      : String(custodio || "") !== String(activo.custodio || "") ||
        String(departamento || "") !== String(activo.departamento || "");

  return (
    <ModalDialog
      titulo="Asignar o trasladar activo"
      subtitulo={`${activo.codigo_barras} · ${activo.nombre}`}
      onCerrar={onCerrar}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      puedeConfirmar={hayCambio}
      textoConfirmar={
        modo === MODOS.TRASLADAR ? "Registrar traslado" : "Confirmar"
      }
    >
      {error && <div className="alert alert-danger">{error}</div>}

      <section className="situacion-actual">
        <h3 className="situacion-actual__titulo">Situación actual</h3>
        <dl className="situacion-actual__datos">
          <dt>Responsable</dt>
          <dd>
            {activo.custodio_nombre || (
              <span className="text-muted">Sin asignar</span>
            )}
          </dd>
          <dt>Área</dt>
          <dd>{activo.departamento_nombre || "—"}</dd>
          <dt>Ubicación</dt>
          <dd>
            {activo.ubicacion_nombre || (
              <span className="text-muted">Sin ubicación registrada</span>
            )}
          </dd>
        </dl>
      </section>

      <div
        className="btn-group w-100 mb-3"
        role="group"
        aria-label="Tipo de movimiento"
      >
        <input
          type="radio"
          className="btn-check"
          name="modo-movimiento"
          id="modo-asignar"
          checked={modo === MODOS.ASIGNAR}
          onChange={() => setModo(MODOS.ASIGNAR)}
        />
        <label className="btn btn-outline-primary" htmlFor="modo-asignar">
          Entregar o devolver
        </label>

        <input
          type="radio"
          className="btn-check"
          name="modo-movimiento"
          id="modo-trasladar"
          checked={modo === MODOS.TRASLADAR}
          onChange={() => setModo(MODOS.TRASLADAR)}
        />
        <label className="btn btn-outline-primary" htmlFor="modo-trasladar">
          Trasladar de ubicación
        </label>
      </div>

      {modo === MODOS.ASIGNAR ? (
        <>
          <div className="mb-3">
            <label className="form-label" htmlFor="custodio">
              Nuevo responsable
            </label>
            <select
              id="custodio"
              className="form-select"
              value={custodio}
              onChange={(event) => elegirCustodio(event.target.value)}
            >
              <option value="">Sin custodio (devolver a bodega)</option>
              {empleados.map((empleado) => (
                <option key={empleado.id} value={empleado.id}>
                  {empleado.nombre_completo} — {empleado.departamento_nombre}
                </option>
              ))}
            </select>
            {empleadoElegido && (
              <div className="form-text">
                {empleadoElegido.nombre_completo} pertenece a{" "}
                <strong>{empleadoElegido.departamento_nombre}</strong>.
              </div>
            )}
            {esDevolucion && (
              <div className="form-text">
                El activo quedará en bodega. {activo.custodio_nombre} dejará de
                figurar como responsable, pero seguirá en el historial del
                equipo.
              </div>
            )}
          </div>

          <div className="mb-3">
            <label className="form-label" htmlFor="departamento">
              Área a la que queda adscrito
            </label>
            <select
              id="departamento"
              className="form-select"
              value={departamento}
              onChange={(event) => setDepartamento(event.target.value)}
            >
              {departamentos.map((dep) => (
                <option key={dep.id} value={dep.id}>
                  {dep.nombre}
                </option>
              ))}
            </select>
            <div className="form-text">
              {/* La ubicación no se toca en este modo: entregar un equipo no lo
                  cambia de sitio. */}
              La ubicación física no cambia con la entrega.
            </div>
          </div>
        </>
      ) : (
        <div className="mb-3">
          <label className="form-label" htmlFor="ubicacion">
            Nueva ubicación
          </label>
          <select
            id="ubicacion"
            className="form-select"
            value={ubicacion}
            onChange={(event) => setUbicacion(event.target.value)}
          >
            <option value="">Sin ubicación registrada</option>
            {ubicaciones.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre_completo}
              </option>
            ))}
          </select>
          {hayCambio && (
            <p className="situacion-actual__cambio">
              {activo.ubicacion_nombre || "Sin ubicación"}{" "}
              <span aria-hidden="true">→</span>{" "}
              <strong>
                {ubicacionElegida?.nombre_completo || "Sin ubicación"}
              </strong>
            </p>
          )}
          <div className="form-text">
            El responsable no cambia: sigue siendo{" "}
            {activo.custodio_nombre || "nadie (equipo sin asignar)"}.
          </div>
        </div>
      )}

      <div className="mb-0">
        <label className="form-label" htmlFor="motivo">
          Motivo
        </label>
        <textarea
          id="motivo"
          className="form-control"
          rows={2}
          placeholder={
            modo === MODOS.TRASLADAR
              ? "Cambio de sede, reubicación de bodega, envío a sucursal…"
              : "Ingreso de personal, cambio de área, devolución por renuncia…"
          }
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
        />
        <div className="form-text">
          Queda registrado en el historial del equipo.
        </div>
      </div>
    </ModalDialog>
  );
}
