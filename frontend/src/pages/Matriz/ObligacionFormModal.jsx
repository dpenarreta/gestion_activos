import { useEffect, useRef, useState } from "react";

import { matrizService } from "../../api/matrizService";
import {
  Campo as CampoComun,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import {
  hayErroresGenerales,
  erroresPorCampo,
  mensajeDeError,
} from "../../utils/errores";
import { useOpcionesMatriz } from "./useOpcionesMatriz";

/** Las que vencen un día y mes fijos del año en que les toca. */
const DE_DIA_Y_MES = new Set([
  "anual",
  "bienal",
  "trienal",
  "quinquenal",
  "decenal",
]);

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

/*
 * Auditoría UX/UI, fase 2 (28/10/2026): el `Campo` propio no marcaba los
 * obligatorios ni ligaba el error a su control (sin aria-invalid ni
 * aria-describedby) y el foco no iba al primer error. Ahora es el común,
 * con el ancho de la rejilla de este formulario.
 */
function Campo({ completo, ...props }) {
  return (
    <CampoComun
      className={`mz-field ${completo ? "mz-field--full" : ""}`}
      {...props}
    />
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
  const contenedor = useRef(null);

  function fijar(campo, valor) {
    setValores((actual) => ({ ...actual, [campo]: valor }));
  }

  // Si la regla aplica, lo natural es que el responsable sea uno mismo: se
  // propone, y se puede cambiar (siendo entonces el suplente).
  const yo = opciones.reglas?.solo_propias ? opciones.reglas.yo : null;
  useEffect(() => {
    if (yo) {
      setValores((actual) =>
        actual.responsable ? actual : { ...actual, responsable: String(yo) },
      );
    }
  }, [yo]);

  async function guardar(evento) {
    evento.preventDefault();
    setIsSaving(true);
    setErrores({});
    setErrorGeneral(null);
    // Lo vacío no viaja: el servidor aplica sus valores por defecto. El mes
    // solo cuenta en las anuales: si se eligió «anual», se escribió un mes y
    // luego se cambió de periodicidad, el campo ya no se ve y su error
    // quedaría donde nadie puede leerlo.
    const datos = Object.fromEntries(
      Object.entries(valores).filter(
        ([campo, valor]) =>
          valor !== "" &&
          (campo !== "mes_vencimiento" ||
            DE_DIA_Y_MES.has(valores.periodicidad)),
      ),
    );
    try {
      const periodo = await matrizService.crearObligacion(datos);
      onCreada(periodo);
    } catch (err) {
      const porCampo = erroresPorCampo(err);
      setErrores(porCampo);
      // Si todo quedó bajo su campo, arriba basta con pedir que se revisen:
      // repetirlo listaba los nombres internos de la API (auditoría UX/UI).
      setErrorGeneral(
        Object.keys(porCampo).length > 0 &&
          Object.keys(porCampo).every((campo) => campo in valores) &&
          !hayErroresGenerales(err)
          ? "No se pudo crear la obligación: revise los campos marcados."
          : mensajeDeError(err, "No se pudo crear la obligación."),
      );
      setIsSaving(false);
      enfocarPrimerError(contenedor.current);
    }
  }

  // Anual o de varios años: vence un día y mes fijos.
  const anual = DE_DIA_Y_MES.has(valores.periodicidad);
  // La regla la decide el servidor (sin «ver todas» y sin permiso de la
  // empresa, quien crea tiene que figurar); aquí solo se explica.
  const soloPropias = Boolean(opciones.reglas?.solo_propias);
  const seleccion = (id, etiqueta, campo, lista, opcional) => (
    <Campo
      id={id}
      etiqueta={etiqueta}
      obligatorio={!opcional}
      error={errores[campo]}
    >
      <select
        className="form-select"
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
      <div ref={contenedor}>
        {errorGeneral && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {errorGeneral}
          </div>
        )}
        <LeyendaObligatorios />

        <div className="mz-section">
          <h4>Obligación</h4>
          <div className="mz-field-grid">
            <Campo
              id="obl-nombre"
              etiqueta="Nombre"
              obligatorio
              error={errores.nombre}
              completo
            >
              <input
                className="form-control"
                maxLength={200}
                placeholder="Declaración de IVA"
                value={valores.nombre}
                onChange={(e) => fijar("nombre", e.target.value)}
              />
            </Campo>
            {seleccion(
              "obl-area",
              "Tema",
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
              obligatorio
              error={errores.evidencia_esperada}
              completo
            >
              <input
                className="form-control"
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
                type="date"
                className="form-control"
                value={valores.fecha_vencimiento}
                onChange={(e) => fijar("fecha_vencimiento", e.target.value)}
              />
            </Campo>
            <Campo id="obl-hora" etiqueta="Hora" error={errores.hora}>
              <input
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
          {soloPropias && (
            <div className="mz-note mt-0 mb-3" role="note">
              <Icon name="info-circle" />
              <span>
                Usted ve solo las obligaciones donde es responsable o suplente,
                así que tiene que figurar en una de las dos: si no, dejaría de
                verla al guardarla. Para crear a nombre de otra persona sin
                figurar, pida un rol con «ver todas» o que un administrador lo
                permita en Configuración → Empresas.
              </span>
            </div>
          )}
          <div className="mz-field-grid">
            {seleccion(
              "obl-responsable",
              "Responsable",
              "responsable",
              personas,
            )}
            {seleccion("obl-suplente", "Suplente", "suplente", personas, true)}
            {seleccion(
              "obl-supervisor",
              "Supervisor",
              "supervisor",
              personas,
              true,
            )}
            {seleccion(
              "obl-aprobador",
              "Aprobador",
              "aprobador",
              personas,
              true,
            )}
            <Campo
              id="obl-prioridad"
              etiqueta="Prioridad"
              error={errores.prioridad}
            >
              <select
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
      </div>
    </ModalDialog>
  );
}
