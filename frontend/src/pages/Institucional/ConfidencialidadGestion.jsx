import { useEffect, useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";

/**
 * Gestionar documentos → «Acuerdo de confidencialidad»: el título y el texto
 * que se presentan antes de leer los documentos. Cambiarlos no obliga a nadie
 * a aceptar de nuevo; lo que lo obliga es agregar, modificar o borrar un
 * documento.
 */
export function AcuerdoConfidencialidad() {
  const [valores, setValores] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    institucionalService
      .confidencialidad()
      .then(({ titulo, texto }) => setValores({ titulo, texto }))
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el acuerdo.")),
      );
  }, []);

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const { titulo, texto } =
        await institucionalService.guardarConfidencialidad(valores);
      setValores({ titulo, texto });
      setAviso("Acuerdo guardado.");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el acuerdo."));
    } finally {
      setGuardando(false);
    }
  }

  if (!valores) {
    return error ? (
      <div className="mz-alert mz-alert--bad" role="alert">
        <Icon name="x-octagon" />
        {error}
      </div>
    ) : null;
  }

  return (
    <form className="mz-card" onSubmit={guardar}>
      <div className="mz-card-body row g-2">
        <p className="col-12 mz-faint mb-1">
          Se presenta a cada persona al entrar a «Códigos de conducta». Sin
          aceptarlo no ve el contenido. Se vuelve a pedir cuando se agrega,
          modifica o borra cualquier documento.
        </p>
        {error && (
          <div className="col-12">
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          </div>
        )}
        {aviso && (
          <div className="col-12">
            <div className="mz-alert mz-alert--ok" role="status">
              <Icon name="check-circle" />
              {aviso}
            </div>
          </div>
        )}
        <div className="col-12">
          <label className="form-label mz-small" htmlFor="acuerdo-titulo-campo">
            Título
          </label>
          <input
            id="acuerdo-titulo-campo"
            className="form-control form-control-sm"
            required
            maxLength={200}
            value={valores.titulo}
            onChange={(e) =>
              setValores((v) => ({ ...v, titulo: e.target.value }))
            }
          />
        </div>
        <div className="col-12">
          <label className="form-label mz-small" htmlFor="acuerdo-texto-campo">
            Texto del acuerdo
          </label>
          <textarea
            id="acuerdo-texto-campo"
            className="form-control form-control-sm"
            rows={10}
            required
            value={valores.texto}
            onChange={(e) =>
              setValores((v) => ({ ...v, texto: e.target.value }))
            }
          />
        </div>
        <div className="col-12 mz-actions justify-content-end">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={guardando}
          >
            {guardando ? "Guardando…" : "Guardar acuerdo"}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Gestionar documentos → «Aceptaciones»: quién aceptó el acuerdo y cuándo.
 * «Vigente» es la aceptación que vale para los documentos de hoy; las otras
 * son de antes de un cambio y quedan como constancia.
 */
export function AceptacionesConfidencialidad() {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    institucionalService
      .aceptacionesConfidencialidad()
      .then(setFilas)
      .catch((err) =>
        setError(
          mensajeDeError(err, "No se pudieron cargar las aceptaciones."),
        ),
      );
  }, []);

  return (
    <>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Correo</th>
              <th>Aceptó el</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {(filas ?? []).map((f) => (
              <tr key={f.id}>
                <td>{f.persona}</td>
                <td className="mz-small">{f.correo}</td>
                <td>{formatearFecha(f.aceptado_en, true)}</td>
                <td>
                  <span
                    className={`mz-pill ${f.vigente ? "mz-pill--ok" : "mz-pill--neutral"}`}
                  >
                    {f.vigente ? "Vigente" : "Antes de un cambio"}
                  </span>
                </td>
              </tr>
            ))}
            {filas?.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={4}>Nadie ha aceptado el acuerdo todavía</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
