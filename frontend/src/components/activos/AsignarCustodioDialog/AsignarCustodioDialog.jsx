import { useEffect, useState } from "react";

import { activosService } from "../../../api/activosService";
import { departamentosService, empleadosService } from "../../../api/organizacionService";
import { ModalDialog } from "../../common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../../utils/errores";

/**
 * Asignación, traslado y devolución de un activo (RF-01).
 *
 * Las tres son la misma operación con distinto destino, y el backend deduce
 * cuál fue a partir del resultado: con custodio es una asignación, sin él una
 * devolución a bodega. Por eso el diálogo no pregunta "qué tipo de
 * movimiento" — sería pedirle al usuario un dato que ya se desprende de su
 * propia elección.
 */
export function AsignarCustodioDialog({ activo, onCerrar, onGuardado }) {
  const [empleados, setEmpleados] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [custodio, setCustodio] = useState(activo.custodio || "");
  const [departamento, setDepartamento] = useState(activo.departamento || "");
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
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await activosService.asignar(activo.id, {
        custodio: custodio || null,
        departamento: departamento || null,
        motivo,
      });
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo registrar la asignación."));
      setIsSaving(false);
    }
  }

  const esDevolucion = !custodio && Boolean(activo.custodio);

  return (
    <ModalDialog
      titulo="Asignar o trasladar activo"
      subtitulo={`${activo.codigo_barras} · ${activo.nombre}`}
      onCerrar={onCerrar}
      onSubmit={handleSubmit}
      isSaving={isSaving}
    >
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="mb-3">
        <label className="form-label" htmlFor="custodio">
          Custodio
        </label>
        <select
          id="custodio"
          className="form-select"
          value={custodio}
          onChange={(event) => setCustodio(event.target.value)}
        >
          <option value="">Sin custodio (devolver a bodega)</option>
          {empleados.map((empleado) => (
            <option key={empleado.id} value={empleado.id}>
              {empleado.nombre_completo} — {empleado.departamento_nombre}
            </option>
          ))}
        </select>
        {esDevolucion && (
          <div className="form-text">
            El activo quedará en bodega. {activo.custodio_nombre} dejará de figurar como
            responsable, pero seguirá en el historial del equipo.
          </div>
        )}
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="departamento">
          Departamento
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
      </div>

      <div className="mb-0">
        <label className="form-label" htmlFor="motivo">
          Motivo
        </label>
        <textarea
          id="motivo"
          className="form-control"
          rows={2}
          placeholder="Ingreso de personal, cambio de área, devolución por renuncia…"
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
        />
        <div className="form-text">Queda registrado en el historial del equipo.</div>
      </div>
    </ModalDialog>
  );
}
