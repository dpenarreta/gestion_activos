import { useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { descargarBlob } from "../../utils/descargas";
import { mensajeDeError } from "../../utils/errores";
import { usePedirMotivo } from "../../components/common/PedirMotivo/PedirMotivo";

/** El reporte de una carga: cuántos cargos y personas, y lo que hay que ver. */
function Reporte({ reporte }) {
  return (
    <div className="mz-stack" aria-live="polite">
      {reporte.valido ? (
        <div
          className={`mz-alert ${reporte.aplicado ? "mz-alert--info" : "mz-alert--warn"}`}
          role="status"
        >
          <Icon name={reporte.aplicado ? "check2-circle" : "clipboard-check"} />
          <span>
            {reporte.aplicado ? "Carga aplicada: " : "El archivo está bien: "}
            {reporte.personas} {reporte.personas === 1 ? "persona" : "personas"}{" "}
            en {reporte.cargos} {reporte.cargos === 1 ? "cargo" : "cargos"} (
            {reporte.con_cuenta} con cuenta, a quienes se les asigna el cargo, y{" "}
            {reporte.sin_cuenta} sin cuenta, que quedan registradas en el
            organigrama).
            {!reporte.aplicado && " Todavía no se guardó nada."}
          </span>
        </div>
      ) : (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          <span>
            El archivo tiene {reporte.total_errores}{" "}
            {reporte.total_errores === 1 ? "error" : "errores"}; corríjalos y
            vuelva a subirlo. No se guardó nada.
          </span>
        </div>
      )}
      {reporte.errores?.length > 0 && (
        <ul className="carga-personas__lista carga-personas__lista--errores">
          {reporte.errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {reporte.avisos?.length > 0 && (
        <>
          <strong className="mz-small">Para revisar</strong>
          <ul className="carga-personas__lista">
            {reporte.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Carga masiva de personas del organigrama: se descarga la plantilla (una
 * hoja por unidad, con el gerente del área y su cadena de mando), se llenan
 * los nombres y se sube. Primero se valida sin guardar; luego se confirma.
 */
/** Descarga uno de los dos archivos del organigrama. */
export async function descargarArchivoOrganigrama(tipo) {
  if (tipo === "completo") {
    const hoy = new Date().toISOString().slice(0, 10);
    descargarBlob(
      await institucionalService.exportarOrganigrama(),
      `organigrama-completo-${hoy}.xlsx`,
    );
  } else {
    descargarBlob(
      await institucionalService.plantillaPersonas(),
      "plantilla-carga-organigrama.xlsx",
    );
  }
}

export function CargaPersonas({ onCerrar, onCargado }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const [archivo, setArchivo] = useState(null);
  const [reporte, setReporte] = useState(null);
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);
  const [pedirMotivo, dialogoMotivo] = usePedirMotivo();

  async function descargar(tipo) {
    setError(null);
    try {
      await descargarArchivoOrganigrama(tipo);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar el archivo."));
    }
  }

  async function enviar(confirmar) {
    if (!archivo) return;
    // Aplicarla cambia el organigrama: pide el motivo (validar no).
    const motivo = confirmar
      ? await pedirMotivo("Se aplica la carga masiva de personas.")
      : null;
    if (confirmar && !motivo) return;
    setTrabajando(true);
    setError(null);
    try {
      const resultado = await institucionalService.cargarPersonas(archivo, {
        confirmar,
        motivo,
      });
      setReporte(resultado);
      if (resultado.aplicado) onCargado?.();
    } catch (err) {
      if (err?.response?.data?.errores) setReporte(err.response.data);
      else setError(mensajeDeError(err, "No se pudo procesar el archivo."));
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      {dialogoMotivo}
      <div
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="carga-personas-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="carga-personas-titulo">Carga masiva de personas</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body mz-stack">
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          <ol className="carga-personas__pasos">
            <li>
              <strong>Descargue un archivo.</strong> La plantilla trae la
              estructura vacía; el organigrama completo trae además a quien
              ocupa hoy cada plaza, para corregir lo ya cargado. Los dos tienen
              una hoja por unidad, con su gerente de área arriba y debajo toda
              su cadena de mando, nivel por nivel.
              <div className="d-flex flex-wrap gap-2 mt-2">
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  onClick={() => descargar("plantilla")}
                >
                  <Icon name="file-earmark-arrow-down" /> Plantilla de carga
                  masiva
                </button>
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  onClick={() => descargar("completo")}
                >
                  <Icon name="file-earmark-spreadsheet" /> Organigrama completo
                </button>
              </div>
            </li>
            <li>
              <strong>Llene las columnas amarillas</strong> (Nombres, Apellidos
              y Correo institucional) sin cambiar la estructura ni el ID. En
              cada hoja que traiga personas, las personas sin cuenta de esa
              unidad se reemplazan por las del archivo; las hojas vacías no
              cambian nada.
            </li>
            <li>
              <strong>Súbala.</strong> Primero se valida y se muestra qué se
              cargará; nada se guarda hasta que confirme.
              <div className="d-flex flex-wrap gap-2 align-items-center mt-2">
                <input
                  type="file"
                  accept=".xlsx"
                  aria-label="Plantilla llena (.xlsx)"
                  className="form-control form-control-sm carga-personas__archivo"
                  onChange={(e) => {
                    setArchivo(e.target.files?.[0] ?? null);
                    setReporte(null);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={!archivo || trabajando}
                  onClick={() => enviar(false)}
                >
                  {trabajando && !reporte ? "Validando…" : "Validar"}
                </button>
              </div>
            </li>
          </ol>
          {reporte && <Reporte reporte={reporte} />}
          <div className="mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              {reporte?.aplicado ? "Cerrar" : "Cancelar"}
            </button>
            {reporte?.valido && !reporte.aplicado && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={trabajando}
                onClick={() => enviar(true)}
              >
                {trabajando ? "Cargando…" : "Confirmar carga"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
