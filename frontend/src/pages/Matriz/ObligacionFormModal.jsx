import { useState } from "react";

import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../utils/errores";
import { useOpcionesMatriz } from "./useOpcionesMatriz";

const VACIO = {
  nombre: "",
  descripcion: "",
  area: "",
  entidad: "",
  tipo: "regulatoria",
  periodicidad: "mensual",
  evidencia_esperada: "",
  fundamento_legal: "",
  fundamento_url: "",
  dia_vencimiento: "",
  mes_vencimiento: "",
  fecha_vencimiento: "",
  hora: "17:00",
  prioridad: "media",
  responsable: "",
  suplente: "",
  supervisor: "",
  aprobador: "",
  sede: "",
  observaciones: "",
};

/** Los errores del servidor, campo por campo (§15.5). */
function erroresPorCampo(err) {
  const datos = err?.response?.data;
  const detalles = datos?.error?.details ?? datos;
  return detalles && typeof detalles === "object" ? detalles : {};
}

function Campo({ id, etiqueta, error, completo, ayuda, children }) {
  return (
    <div className={`mz-field ${completo ? "mz-field--full" : ""}`}>
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {ayuda && !error && <div className="form-text">{ayuda}</div>}
      {error && (
        <div className="mz-field-error">{[].concat(error).join(" ")}</div>
      )}
    </div>
  );
}

/**
 * Nueva obligación (§11.1): la plantilla y su primer período en una sola
 * ventana. Al crearla se abre el detalle del período nuevo.
 *
 * Sin fecha de vencimiento, el primero sale de la regla de la plantilla (día
 * del mes, o día y mes si es anual). Lo valida todo el servidor; aquí solo se
 * muestran sus errores junto a cada campo.
 */
export function ObligacionFormModal({ onCerrar, onCreada }) {
  const opciones = useOpcionesMatriz();
  const [valores, setValores] = useState(VACIO);
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  function fijar(campo, valor) {
    setValores((actual) => ({ ...actual, [campo]: valor }));
  }

  async function guardar(evento) {
    evento.preventDefault();
    setIsSaving(true);
    setErrores({});
    setErrorGeneral(null);
    // Lo vacío no viaja: el servidor aplica sus valores por defecto.
    const datos = Object.fromEntries(
      Object.entries(valores).filter(([, valor]) => valor !== ""),
    );
    try {
      const periodo = await matrizService.crearObligacion(datos);
      onCreada(periodo);
    } catch (err) {
      setErrores(erroresPorCampo(err));
      setErrorGeneral(mensajeDeError(err, "No se pudo crear la obligación."));
      setIsSaving(false);
    }
  }

  const anual = valores.periodicidad === "anual";
  const seleccion = (id, etiqueta, campo, lista, opcional) => (
    <Campo id={id} etiqueta={etiqueta} error={errores[campo]}>
      <select
        id={id}
        className="form-select"
        required={!opcional}
        value={valores[campo]}
        onChange={(e) => fijar(campo, e.target.value)}
      >
        <option value="">{opcional ? "Sin asignar" : "Seleccione…"}</option>
        {lista}
      </select>
    </Campo>
  );
  const personas = opciones.personas.map((p) => (
    <option key={p.id} value={p.id}>
      {p.nombre}
    </option>
  ));

  return (
    <ModalDialog
      titulo="Nueva obligación"
      subtitulo="Se crea con su primer período."
      onCerrar={onCerrar}
      onSubmit={guardar}
      textoConfirmar="Crear obligación"
      isSaving={isSaving}
      anchoMaximo="880px"
    >
      {errorGeneral && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {errorGeneral}
        </div>
      )}

      <div className="mz-section">
        <h4>Obligación</h4>
        <div className="mz-field-grid">
          <Campo
            id="obl-nombre"
            etiqueta="Nombre"
            error={errores.nombre}
            completo
          >
            <input
              id="obl-nombre"
              className="form-control"
              required
              maxLength={200}
              placeholder="Declaración de IVA"
              value={valores.nombre}
              onChange={(e) => fijar("nombre", e.target.value)}
            />
          </Campo>
          {seleccion(
            "obl-area",
            "Área",
            "area",
            opciones.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            )),
          )}
          {seleccion(
            "obl-entidad",
            "Entidad de control",
            "entidad",
            opciones.entidades.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            )),
          )}
          <Campo id="obl-tipo" etiqueta="Tipo" error={errores.tipo}>
            <select
              id="obl-tipo"
              className="form-select"
              value={valores.tipo}
              onChange={(e) => fijar("tipo", e.target.value)}
            >
              {opciones.tipos.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id="obl-periodicidad"
            etiqueta="Periodicidad"
            error={errores.periodicidad}
          >
            <select
              id="obl-periodicidad"
              className="form-select"
              value={valores.periodicidad}
              onChange={(e) => fijar("periodicidad", e.target.value)}
            >
              {opciones.periodicidades.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id="obl-evidencia"
            etiqueta="Evidencia esperada"
            error={errores.evidencia_esperada}
            completo
          >
            <input
              id="obl-evidencia"
              className="form-control"
              required
              maxLength={255}
              placeholder="Formulario 104 y comprobante de pago"
              value={valores.evidencia_esperada}
              onChange={(e) => fijar("evidencia_esperada", e.target.value)}
            />
          </Campo>
          <Campo
            id="obl-descripcion"
            etiqueta="Descripción"
            error={errores.descripcion}
            completo
          >
            <textarea
              id="obl-descripcion"
              className="form-control"
              rows={2}
              value={valores.descripcion}
              onChange={(e) => fijar("descripcion", e.target.value)}
            />
          </Campo>
          <Campo
            id="obl-fundamento"
            etiqueta="Fundamento legal"
            error={errores.fundamento_legal}
          >
            <input
              id="obl-fundamento"
              className="form-control"
              value={valores.fundamento_legal}
              onChange={(e) => fijar("fundamento_legal", e.target.value)}
            />
          </Campo>
          <Campo
            id="obl-url"
            etiqueta="Enlace al fundamento"
            error={errores.fundamento_url}
          >
            <input
              id="obl-url"
              type="url"
              className="form-control"
              placeholder="https://"
              value={valores.fundamento_url}
              onChange={(e) => fijar("fundamento_url", e.target.value)}
            />
          </Campo>
        </div>
      </div>

      <div className="mz-section">
        <h4>Vencimiento</h4>
        <div className="mz-field-grid">
          <Campo
            id="obl-fecha"
            etiqueta="Primer vencimiento"
            error={errores.fecha_vencimiento}
            ayuda="Vacío: sale de la regla de abajo."
          >
            <input
              id="obl-fecha"
              type="date"
              className="form-control"
              value={valores.fecha_vencimiento}
              onChange={(e) => fijar("fecha_vencimiento", e.target.value)}
            />
          </Campo>
          <Campo id="obl-hora" etiqueta="Hora" error={errores.hora}>
            <input
              id="obl-hora"
              type="time"
              className="form-control"
              value={valores.hora}
              onChange={(e) => fijar("hora", e.target.value)}
            />
          </Campo>
          <Campo
            id="obl-dia"
            etiqueta="Día de vencimiento"
            error={errores.dia_vencimiento}
            ayuda="Regla para los períodos siguientes."
          >
            <input
              id="obl-dia"
              type="number"
              min="1"
              max="31"
              className="form-control"
              value={valores.dia_vencimiento}
              onChange={(e) => fijar("dia_vencimiento", e.target.value)}
            />
          </Campo>
          {anual && (
            <Campo
              id="obl-mes"
              etiqueta="Mes de vencimiento"
              error={errores.mes_vencimiento}
            >
              <input
                id="obl-mes"
                type="number"
                min="1"
                max="12"
                className="form-control"
                value={valores.mes_vencimiento}
                onChange={(e) => fijar("mes_vencimiento", e.target.value)}
              />
            </Campo>
          )}
        </div>
      </div>

      <div className="mz-section">
        <h4>Responsables</h4>
        <div className="mz-field-grid">
          {seleccion("obl-responsable", "Responsable", "responsable", personas)}
          {seleccion("obl-suplente", "Suplente", "suplente", personas, true)}
          {seleccion(
            "obl-supervisor",
            "Supervisor",
            "supervisor",
            personas,
            true,
          )}
          {seleccion("obl-aprobador", "Aprobador", "aprobador", personas, true)}
          <Campo
            id="obl-prioridad"
            etiqueta="Prioridad"
            error={errores.prioridad}
          >
            <select
              id="obl-prioridad"
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
          </Campo>
          {seleccion(
            "obl-sede",
            "Sucursal",
            "sede",
            opciones.sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            )),
            true,
          )}
        </div>
        <p className="mz-small mz-faint mt-2 mb-0">
          Sin aprobador, aprueba el gerente general de la empresa.
        </p>
      </div>
    </ModalDialog>
  );
}
