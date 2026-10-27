import { useState } from "react";

import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../utils/errores";
import { diaCorto } from "./formatoMatriz";

const TIPOS = { general: "General", seguro: "Seguro", arriendo: "Arriendo" };

/** Los campos de la ficha (27/10/2026): [campo, etiqueta, tipo de dato]. */
const CAMPOS = {
  general: [["emitido_en", "Fecha de emisión", "fecha"]],
  seguro: [
    ["tipo_seguro", "Tipo de seguro", "texto"],
    ["aseguradora", "Aseguradora", "texto"],
    ["broker", "Broker", "texto"],
    ["poliza", "Póliza", "texto"],
    ["asegurado", "Asegurado", "texto"],
    ["propietario", "Propietario", "texto"],
    ["vigencia_desde", "Vigencia desde", "fecha"],
    ["vigencia_hasta", "Vigencia hasta", "fecha"],
    ["prima", "Prima (USD)", "monto"],
    ["prima_detalle", "Prima (texto, si no es una cifra)", "texto"],
    ["valor_asegurado", "Valor asegurado (USD)", "monto"],
    ["detalle", "Detalle", "texto"],
    ["placa", "Placa", "texto"],
    ["marca", "Marca", "texto"],
    ["modelo", "Modelo", "texto"],
    ["tipo_vehiculo", "Tipo de vehículo", "texto"],
  ],
  arriendo: [
    ["canon", "Canon mensual (USD)", "monto"],
    ["garantia", "Garantía (USD)", "monto"],
    ["duracion", "Duración del contrato", "texto"],
    ["renovado", "Renovado", "si_no"],
    ["incremento", "Incremento / condiciones", "texto"],
  ],
};

const monto = (valor) =>
  Number(valor).toLocaleString("es-EC", {
    style: "currency",
    currency: "USD",
  });

function mostrar(valor, tipo) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (tipo === "fecha") return diaCorto(valor);
  if (tipo === "monto") return monto(valor);
  if (tipo === "si_no") return valor ? "Sí" : "No";
  return valor;
}

function camposDe(tipo) {
  return [
    ...CAMPOS.general,
    ...(CAMPOS[tipo] ?? []),
    ["notas", "Notas", "texto"],
  ];
}

function EditarFicha({ obligacion, onCerrar, onGuardada }) {
  const inicial = obligacion.ficha ?? { tipo: "general" };
  const [valores, setValores] = useState(inicial);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const fijar = (campo) => (e) =>
    setValores((v) => ({ ...v, [campo]: e.target.value }));

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    // Vacíos como nulos: un monto o una fecha en blanco no es «0».
    const datos = Object.fromEntries(
      Object.entries(valores).map(([k, v]) => [k, v === "" ? null : v]),
    );
    for (const [campo, , tipo] of camposDe(valores.tipo)) {
      if (tipo === "texto" && datos[campo] === null) datos[campo] = "";
    }
    try {
      await matrizService.guardarFicha(obligacion.id, datos);
      onGuardada();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la ficha."));
      setGuardando(false);
    }
  }

  return (
    <ModalDialog
      titulo="Ficha de la obligación"
      subtitulo={obligacion.nombre}
      onCerrar={onCerrar}
      onSubmit={guardar}
      textoConfirmar="Guardar ficha"
      isSaving={guardando}
      anchoMaximo="720px"
    >
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      <div className="mz-ficha-form">
        <div className="mz-field">
          <label htmlFor="ficha-tipo">Tipo</label>
          <select
            id="ficha-tipo"
            className="form-select form-select-sm"
            value={valores.tipo}
            onChange={fijar("tipo")}
          >
            {Object.entries(TIPOS).map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
        </div>
        {camposDe(valores.tipo).map(([campo, etiqueta, tipo]) => (
          <div
            key={campo}
            className={`mz-field${campo === "notas" || campo === "incremento" ? " mz-ficha-form__completo" : ""}`}
          >
            <label htmlFor={`ficha-${campo}`}>{etiqueta}</label>
            {tipo === "si_no" ? (
              <select
                id={`ficha-${campo}`}
                className="form-select form-select-sm"
                value={
                  valores[campo] === true
                    ? "si"
                    : valores[campo] === false
                      ? "no"
                      : ""
                }
                onChange={(e) =>
                  setValores((v) => ({
                    ...v,
                    [campo]:
                      e.target.value === "" ? null : e.target.value === "si",
                  }))
                }
              >
                <option value="">Sin dato</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            ) : campo === "notas" ? (
              <textarea
                id={`ficha-${campo}`}
                className="form-control form-control-sm"
                rows={2}
                value={valores[campo] ?? ""}
                onChange={fijar(campo)}
              />
            ) : (
              <input
                id={`ficha-${campo}`}
                className="form-control form-control-sm"
                type={
                  tipo === "fecha"
                    ? "date"
                    : tipo === "monto"
                      ? "number"
                      : "text"
                }
                step={tipo === "monto" ? "0.01" : undefined}
                min={tipo === "monto" ? "0" : undefined}
                value={valores[campo] ?? ""}
                onChange={fijar(campo)}
              />
            )}
          </div>
        ))}
      </div>
    </ModalDialog>
  );
}

/**
 * La ficha de la obligación en el detalle del período (27/10/2026): fecha de
 * emisión y, si es un seguro o un arriendo, su detalle. Quien puede editar la
 * obligación la completa o la corrige.
 */
export function FichaObligacion({ obligacion, puedeEditar, onGuardada }) {
  const [editando, setEditando] = useState(false);
  const ficha = obligacion.ficha;
  if (!ficha && !puedeEditar) return null;
  const llenos = ficha
    ? camposDe(ficha.tipo)
        .map(([campo, etiqueta, tipo]) => [
          campo,
          etiqueta,
          mostrar(ficha[campo], tipo),
        ])
        .filter(([, , valor]) => valor !== null)
    : [];

  return (
    <div className="mz-section">
      <div className="mz-section-head">
        <div className="mz-section-head__titulo">
          <h4>Ficha</h4>
          {ficha && ficha.tipo !== "general" && (
            <span className="mz-pill mz-pill--neutral">
              {TIPOS[ficha.tipo]}
            </span>
          )}
        </div>
        {puedeEditar && (
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() => setEditando(true)}
          >
            <Icon name="pencil" /> {ficha ? "Editar ficha" : "Agregar ficha"}
          </button>
        )}
      </div>
      {llenos.length ? (
        <div className="mz-kv-grid">
          {llenos.map(([campo, etiqueta, valor]) => (
            <div
              key={campo}
              className={`mz-kv${campo === "notas" || campo === "incremento" ? " mz-kv--full" : ""}`}
            >
              <span className="mz-kv-label">{etiqueta}</span>
              {valor}
            </div>
          ))}
        </div>
      ) : (
        <p className="mz-small mz-faint mb-0">
          Aún no hay ficha.
          {puedeEditar &&
            " Use «Agregar ficha» para registrar la emisión y el detalle del seguro o del arriendo."}
        </p>
      )}
      {editando && (
        <EditarFicha
          obligacion={obligacion}
          onCerrar={() => setEditando(false)}
          onGuardada={() => {
            setEditando(false);
            onGuardada?.();
          }}
        />
      )}
    </div>
  );
}
