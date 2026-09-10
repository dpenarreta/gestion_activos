import { useEffect, useMemo, useState } from "react";

import { activosService } from "../../../api/activosService";
import {
  departamentosService,
  empleadosService,
  sedesService,
} from "../../../api/organizacionService";
import { ModalDialog } from "../../common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../../utils/errores";
import "./AsignarCustodioDialog.css";

const MODOS = {
  ASIGNAR: "asignar",
  TRASLADAR: "trasladar",
};

/** Dónde está una sede, dicho como lo diría una persona: «en Quito». */
function donde(sede) {
  if (!sede) return "";
  return (sede.ciudad || "").trim() || sede.nombre;
}

/**
 * Entrega, devolución y traslado de un activo (RF-01).
 *
 * Las dos operaciones se piden desde el mismo sitio pero mueven cosas
 * distintas: **entregar** cambia de quién responde por el equipo, **trasladar**
 * cambia dónde está. Mezclarlas en un solo formulario obligaba a rellenar
 * campos que no venían al caso y, peor, dejaba dudas sobre qué se iba a
 * modificar.
 *
 * Arriba va siempre la situación actual —quién lo tiene, de qué área y en qué
 * ciudad está—, porque es lo primero que se comprueba antes de mover un equipo
 * y porque el registro que queda en el historial es «de esto a esto»: sin ver
 * el punto de partida, el destino solo es la mitad del dato.
 */
export function AsignarCustodioDialog({ activo, onCerrar, onGuardado }) {
  const [empleados, setEmpleados] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [sedes, setSedes] = useState([]);

  const [modo, setModo] = useState(MODOS.ASIGNAR);
  const [custodio, setCustodio] = useState(activo.custodio || "");
  const [departamento, setDepartamento] = useState(activo.departamento || "");
  const [sede, setSede] = useState(activo.sede || "");
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
    sedesService
      .list({ activa: "true", page_size: 200 })
      .then((datos) => setSedes(datos.results ?? datos))
      .catch(() => setSedes([]));
  }, []);

  const empleadoElegido = useMemo(
    () => empleados.find((e) => String(e.id) === String(custodio)),
    [empleados, custodio],
  );
  const sedeElegida = useMemo(
    () => sedes.find((s) => String(s.id) === String(sede)),
    [sedes, sede],
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
      // Cada modo manda solo lo suyo. El traslado manda `custodio: null`
      // porque mover un equipo es sacárselo a quien lo tenía: pasa a la sede
      // de destino, y una sede no responde por nada. El área sí se conserva
      // —dice de quién es el presupuesto del equipo, no quién lo custodia—,
      // así que no se envía.
      const datos =
        modo === MODOS.TRASLADAR
          ? { custodio: null, sede: sede || null, motivo }
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
      ? String(sede || "") !== String(activo.sede || "")
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
          <dt>Ciudad</dt>
          <dd>
            {activo.ciudad || (
              <span className="text-muted">Sin sede registrada</span>
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
              {/* La sede no se toca en este modo: entregar un equipo no lo
                  cambia de sitio. */}
              El equipo no cambia de sitio con la entrega.
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Arriba y como alerta, no como nota al pie de un campo: es la
              consecuencia menos evidente del traslado —el equipo cambia de
              sitio *y* deja de tener responsable— y hay que leerla antes de
              elegir el destino, no después. */}
          <div className="alert alert-warning" role="alert">
            <strong>Aviso:</strong> El equipo quedará sin responsable y se
            asignará únicamente a la nueva ubicación
          </div>

          <div className="mb-3">
            <label className="form-label" htmlFor="sede">
              Sede de destino
            </label>
            <select
              id="sede"
              className="form-select"
              value={sede}
              onChange={(event) => setSede(event.target.value)}
            >
              <option value="">Sin sede registrada</option>
              {sedes.map((unaSede) => (
                <option key={unaSede.id} value={unaSede.id}>
                  {unaSede.nombre}
                  {unaSede.ciudad ? ` — ${unaSede.ciudad}` : ""}
                </option>
              ))}
            </select>
            {hayCambio && (
              // En ciudades, que es como se cuenta un traslado: «pasó de Quito
              // a Guayaquil». El nombre interno de la sede no le dice nada a
              // quien tiene que ir a buscar el equipo.
              <p className="situacion-actual__cambio">
                {activo.ciudad || "Sin sede"} <span aria-hidden="true">→</span>{" "}
                <strong>{donde(sedeElegida) || "Sin sede"}</strong>
              </p>
            )}
            <div className="form-text">
              Quien lo tuviera seguirá figurando en el historial del equipo.
            </div>
          </div>
        </>
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
              ? "Cambio de sede, envío a sucursal, cierre de oficina…"
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
