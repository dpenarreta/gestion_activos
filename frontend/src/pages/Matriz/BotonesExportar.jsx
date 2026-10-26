import { useState } from "react";

import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { descargarBlob } from "../../utils/descargas";

/** Entrega un archivo ya descargado como si fuera un enlace normal (y lo
 * registra: `descargarBlob`). */
export function guardarBlob(blob, nombre) {
  descargarBlob(blob, nombre);
}

function hoy() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}`;
}

/**
 * Exportar a Excel y PDF (§16), con los mismos filtros de la pantalla: el
 * archivo lo arma el servidor con la misma consulta, así que no puede decir
 * algo distinto de lo que se ve. Solo aparece con el permiso `exportar`.
 */
export function BotonesExportar({ recurso, params, nombre }) {
  const [formato, setFormato] = useState(null);
  const [error, setError] = useState(null);

  async function exportar(elegido) {
    setFormato(elegido);
    setError(null);
    try {
      const blob = await matrizService.exportar(recurso, params, elegido);
      guardarBlob(blob, `${nombre}-${hoy()}.${elegido}`);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo exportar."));
    } finally {
      setFormato(null);
    }
  }

  return (
    <>
      {[
        ["xlsx", "Excel", "file-earmark-spreadsheet"],
        ["pdf", "PDF", "file-earmark-pdf"],
      ].map(([valor, texto, icono]) => (
        <button
          key={valor}
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={formato !== null}
          onClick={() => exportar(valor)}
        >
          <Icon name={icono} /> {formato === valor ? "Exportando…" : texto}
        </button>
      ))}
      {error && (
        <span className="mz-small mz-bad" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
