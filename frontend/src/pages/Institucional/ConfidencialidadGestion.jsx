import { useCallback, useEffect, useRef, useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
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
  // Cargando, error al cargar con «Reintentar» y errores por campo
  // (auditoría UX/UI, fase 2, 28/10/2026).
  const [errorCarga, setErrorCarga] = useState(null);
  const [errores, setErrores] = useState({});
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const formulario = useRef(null);

  const cargar = useCallback(() => {
    setErrorCarga(null);
    institucionalService
      .confidencialidad()
      .then(({ titulo, texto }) => setValores({ titulo, texto }))
      .catch((err) =>
        setErrorCarga(mensajeDeError(err, "No se pudo cargar el acuerdo.")),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    setErrores({});
    setAviso(null);
    try {
      const { titulo, texto } =
        await institucionalService.guardarConfidencialidad(valores);
      setValores({ titulo, texto });
      setAviso("Acuerdo guardado.");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el acuerdo."));
      setErrores(erroresPorCampo(err));
      enfocarPrimerError(formulario.current);
    } finally {
      setGuardando(false);
    }
  }

  if (!valores) {
    return <EstadoDeCarga cargando error={errorCarga} onReintentar={cargar} />;
  }

  return (
    <form ref={formulario} className="mz-card" onSubmit={guardar}>
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
          <LeyendaObligatorios />
        </div>
        <Campo
          id="acuerdo-titulo-campo"
          etiqueta="Título"
          obligatorio
          error={errores.titulo}
          className="col-12"
        >
          <input
            className="form-control form-control-sm"
            maxLength={200}
            value={valores.titulo}
            onChange={(e) =>
              setValores((v) => ({ ...v, titulo: e.target.value }))
            }
          />
        </Campo>
        <Campo
          id="acuerdo-texto-campo"
          etiqueta="Texto del acuerdo"
          obligatorio
          error={errores.texto}
          className="col-12"
        >
          <textarea
            className="form-control form-control-sm"
            rows={10}
            value={valores.texto}
            onChange={(e) =>
              setValores((v) => ({ ...v, texto: e.target.value }))
            }
          />
        </Campo>
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

  const cargar = useCallback(() => {
    setError(null);
    institucionalService
      .aceptacionesConfidencialidad()
      .then(setFilas)
      .catch((err) =>
        setError(
          mensajeDeError(err, "No se pudieron cargar las aceptaciones."),
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <>
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
            {/* Cargando, error con «Reintentar» y vacío en la tabla
                (auditoría UX/UI, fase 2, 28/10/2026). */}
            <FilaDeEstado
              columnas={4}
              cargando={filas === null}
              error={error}
              onReintentar={cargar}
              vacio={filas?.length === 0}
              textoVacio="Nadie ha aceptado el acuerdo todavía"
            />
          </tbody>
        </table>
      </div>
    </>
  );
}
