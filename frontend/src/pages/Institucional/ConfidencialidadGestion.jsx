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
import { descargarBlob } from "../../utils/descargas";

/**
 * Gestionar documentos → «Acuerdo de confidencialidad»: el título y el texto
 * que se presentan antes de leer los documentos. Cambiarlos no obliga a nadie
 * a aceptar de nuevo; lo que lo obliga es un cambio de contenido: publicar un
 * documento, reemplazar su archivo o volver a publicar uno retirado.
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
          aceptarlo no ve el contenido. Se vuelve a pedir cuando se publica un
          documento, se reemplaza su archivo o se vuelve a publicar uno retirado
          (corregir datos, retirarlo o borrarlo no lo pide).
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

const ESTADOS = {
  vigente: ["Aceptó", "mz-pill--ok"],
  antes: ["Aceptó antes de un cambio", "mz-pill--warn"],
  nunca: ["No ha aceptado", "mz-pill--neutral"],
};

const FILTROS = [
  ["pendientes", "Pendientes"],
  ["aceptaron", "Aceptaron"],
  ["todas", "Todas"],
];

/**
 * Gestionar documentos → «Aceptaciones»: cada persona activa con su estado
 * frente al acuerdo vigente, el resumen «X de Y aceptaron», quién falta, un
 * buscador y la exportación a Excel (auditoría UX/UI, 30/10/2026: antes solo
 * la lista de aceptaciones, una por cada cambio, sin saber quién faltaba).
 */
export function AceptacionesConfidencialidad() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState("pendientes");
  const [buscar, setBuscar] = useState("");
  const [exportando, setExportando] = useState(false);
  const [errorExportar, setErrorExportar] = useState(null);

  const cargar = useCallback(() => {
    setError(null);
    institucionalService
      .aceptacionesConfidencialidad()
      .then(setDatos)
      .catch((err) =>
        setError(
          mensajeDeError(err, "No se pudieron cargar las aceptaciones."),
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function exportar() {
    setExportando(true);
    setErrorExportar(null);
    try {
      descargarBlob(
        await institucionalService.exportarAceptaciones(),
        "aceptaciones-confidencialidad.xlsx",
      );
    } catch (err) {
      setErrorExportar(mensajeDeError(err, "No se pudo exportar."));
    } finally {
      setExportando(false);
    }
  }

  const texto = buscar.trim().toLowerCase();
  const conteos = {
    pendientes: datos?.pendientes ?? 0,
    aceptaron: datos?.aceptaron ?? 0,
    todas: datos?.total ?? 0,
  };
  const filas = (datos?.personas ?? []).filter(
    (f) =>
      (filtro === "todas" ||
        (filtro === "aceptaron" ? f.vigente : !f.vigente)) &&
      (!texto ||
        f.persona.toLowerCase().includes(texto) ||
        (f.correo ?? "").toLowerCase().includes(texto)),
  );
  const nombreFiltro = Object.fromEntries(FILTROS)[filtro];
  const textoVacio = texto
    ? filtro === "todas"
      ? "Nadie coincide con la búsqueda."
      : `Nadie coincide con la búsqueda en «${nombreFiltro}».`
    : filtro === "pendientes"
      ? "Nadie tiene pendiente aceptar el acuerdo."
      : "Todavía nadie ha aceptado el acuerdo vigente.";
  const estadoDeCarga = {
    cargando: datos === null && !error,
    error,
    onReintentar: cargar,
    vacio: datos !== null && filas.length === 0,
    textoVacio,
  };
  const porcentaje = datos?.total
    ? Math.round((100 * datos.aceptaron) / datos.total)
    : 0;

  return (
    <div className="mz-stack">
      {datos && (
        <section className="mz-card" aria-label="Resumen de aceptaciones">
          <div className="mz-card-body aceptaciones-resumen">
            <div>
              <strong className="aceptaciones-resumen__cifra">
                {datos.aceptaron} de {datos.total}
              </strong>{" "}
              personas aceptaron el acuerdo vigente
              <div
                className="onboarding-barra"
                role="progressbar"
                aria-valuenow={porcentaje}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Personas que aceptaron"
              >
                <span style={{ width: `${porcentaje}%` }} />
              </div>
            </div>
            <span
              className={`mz-pill ${datos.pendientes ? "mz-pill--warn" : "mz-pill--ok"}`}
            >
              {datos.pendientes
                ? `${datos.pendientes} ${datos.pendientes === 1 ? "pendiente" : "pendientes"}`
                : "Todas aceptaron"}
            </span>
          </div>
        </section>
      )}

      <div className="mz-filter-bar aceptaciones-filtros">
        <div
          className="btn-group btn-group-sm"
          role="group"
          aria-label="Mostrar"
        >
          {FILTROS.map(([id, etiqueta]) => (
            <button
              key={id}
              type="button"
              className={`btn ${filtro === id ? "btn-primary" : "btn-outline-secondary"}`}
              aria-pressed={filtro === id}
              onClick={() => setFiltro(id)}
            >
              {etiqueta}
              {datos && ` (${conteos[id]})`}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="form-control form-control-sm aceptaciones-filtros__buscar"
          placeholder="Buscar por nombre o correo"
          aria-label="Buscar persona"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          data-sin-descarte
        />
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm ms-auto"
          onClick={exportar}
          disabled={exportando || !datos}
        >
          <Icon name="file-earmark-excel" />{" "}
          {exportando ? "Exportando…" : "Exportar a Excel"}
        </button>
      </div>
      {errorExportar && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {errorExportar}
        </div>
      )}
      {datos && (
        <p className="visually-hidden" role="status">
          {filas.length} {filas.length === 1 ? "persona" : "personas"}
        </p>
      )}
      {datos && texto && filtro !== "todas" && filas.length === 0 && (
        <p className="mb-0">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setFiltro("todas")}
          >
            Buscar en todas
          </button>
        </p>
      )}

      <div className="mz-table-wrap mz-table-wrap--con-tarjetas">
        <table className="mz-table">
          <caption className="visually-hidden">
            Aceptaciones del acuerdo de confidencialidad
          </caption>
          <thead>
            <tr>
              <th scope="col">Persona</th>
              <th scope="col">Correo</th>
              <th scope="col">Estado</th>
              <th scope="col">Aceptó el</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const [estado, clase] = ESTADOS[f.estado] ?? ESTADOS.nunca;
              return (
                <tr key={f.id}>
                  <td>{f.persona}</td>
                  <td className="mz-small">{f.correo || "—"}</td>
                  <td>
                    <span className={`mz-pill ${clase}`}>{estado}</span>
                  </td>
                  <td>
                    {f.aceptado_en ? formatearFecha(f.aceptado_en, true) : "—"}
                  </td>
                </tr>
              );
            })}
            {/* Cargando, error con «Reintentar» y vacío en la tabla. */}
            <FilaDeEstado columnas={4} {...estadoDeCarga} />
          </tbody>
        </table>
      </div>
      {/* En el teléfono, una tarjeta por persona (la tabla no cabe). */}
      <div className="mz-cards">
        <EstadoDeCarga {...estadoDeCarga} />
        {filas.length > 0 && (
          <ul className="mz-cards-lista" aria-label="Aceptaciones">
            {filas.map((f) => {
              const [estado, clase] = ESTADOS[f.estado] ?? ESTADOS.nunca;
              return (
                <li key={f.id} className="mz-card-row">
                  <div className="mz-row-between">
                    <strong className="mz-card-row__titulo">{f.persona}</strong>
                    <span className={`mz-pill ${clase}`}>{estado}</span>
                  </div>
                  <div className="mz-card-meta">
                    <span>{f.correo || "Sin correo"}</span>
                    {f.aceptado_en && (
                      <span>
                        Aceptó el {formatearFecha(f.aceptado_en, true)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
