import { useState } from "react";

import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../utils/errores";
import { useOpcionesMatriz } from "./useOpcionesMatriz";

function SelectorPersona({
  id,
  etiqueta,
  valor,
  personas,
  onChange,
  obligatorio,
}) {
  return (
    <div className="mz-field">
      <label htmlFor={id}>{etiqueta}</label>
      <select
        id={id}
        className="form-select"
        required={obligatorio}
        value={valor ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : null)
        }
      >
        <option value="">{obligatorio ? "Seleccione…" : "Sin asignar"}</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * «Editar seguimiento» (§15.5): responsables, prioridad, avance, observaciones
 * y sucursal. Cada campo cambiado queda en el historial con su valor anterior.
 */
export function SeguimientoModal({ periodo, onCerrar, onGuardado }) {
  const opciones = useOpcionesMatriz();
  const [valores, setValores] = useState({
    responsable: periodo.responsable?.id ?? null,
    suplente: periodo.suplente?.id ?? null,
    supervisor: periodo.supervisor?.id ?? null,
    aprobador: periodo.aprobador?.id ?? null,
    prioridad: periodo.prioridad,
    avance: periodo.avance,
    observaciones: periodo.observaciones || "",
    sede: periodo.sede?.id ?? null,
  });
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  function fijar(campo, valor) {
    setValores((actual) => ({ ...actual, [campo]: valor }));
  }

  async function guardar(evento) {
    evento.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const actualizado = await matrizService.editarSeguimiento(periodo.id, {
        ...valores,
        avance: Number(valores.avance),
      });
      onGuardado(actualizado);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el seguimiento."));
      setIsSaving(false);
    }
  }

  return (
    <ModalDialog
      titulo="Editar seguimiento"
      subtitulo={`${periodo.codigo} · ${periodo.obligacion.nombre}`}
      onCerrar={onCerrar}
      onSubmit={guardar}
      textoConfirmar="Guardar"
      isSaving={isSaving}
      anchoMaximo="640px"
    >
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      <div className="mz-field-grid">
        <SelectorPersona
          id="seg-responsable"
          etiqueta="Responsable"
          obligatorio
          valor={valores.responsable}
          personas={opciones.personas}
          onChange={(v) => fijar("responsable", v)}
        />
        <SelectorPersona
          id="seg-suplente"
          etiqueta="Suplente"
          valor={valores.suplente}
          personas={opciones.personas}
          onChange={(v) => fijar("suplente", v)}
        />
        <SelectorPersona
          id="seg-supervisor"
          etiqueta="Supervisor"
          valor={valores.supervisor}
          personas={opciones.personas}
          onChange={(v) => fijar("supervisor", v)}
        />
        <SelectorPersona
          id="seg-aprobador"
          etiqueta="Aprobador"
          valor={valores.aprobador}
          personas={opciones.personas}
          onChange={(v) => fijar("aprobador", v)}
        />
        <div className="mz-field">
          <label htmlFor="seg-prioridad">Prioridad</label>
          <select
            id="seg-prioridad"
            className="form-select"
            value={valores.prioridad}
            onChange={(e) => fijar("prioridad", e.target.value)}
          >
            {opciones.prioridades.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="mz-field">
          <label htmlFor="seg-avance">Avance (%)</label>
          <input
            id="seg-avance"
            type="number"
            min="0"
            max="100"
            className="form-control"
            value={valores.avance}
            onChange={(e) => fijar("avance", e.target.value)}
          />
        </div>
        <div className="mz-field">
          <label htmlFor="seg-sede">Sucursal</label>
          <select
            id="seg-sede"
            className="form-select"
            value={valores.sede ?? ""}
            onChange={(e) =>
              fijar("sede", e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">Sin sucursal</option>
            {opciones.sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="mz-field mz-field--full">
          <label htmlFor="seg-observaciones">Observaciones</label>
          <textarea
            id="seg-observaciones"
            className="form-control"
            rows={3}
            value={valores.observaciones}
            onChange={(e) => fijar("observaciones", e.target.value)}
          />
        </div>
      </div>
    </ModalDialog>
  );
}
