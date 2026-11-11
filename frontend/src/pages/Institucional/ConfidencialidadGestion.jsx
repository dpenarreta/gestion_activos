import { useCallback, useEffect, useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { AnuncioDeResultados } from "../../components/common/AnuncioDeResultados/AnuncioDeResultados";
import { Icon } from "../../components/common/Icon/Icon";
import { coincideBusqueda } from "../../utils/busqueda";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import { descargarBlob } from "../../utils/descargas";
import {
  SeConsultaEnProteccionDeDatos,
  SeEditaEnProteccionDeDatos,
} from "../Privacidad/SeEditaEnProteccionDeDatos";
import { CLAVES_TEXTO } from "../Privacidad/privacidadComunes";
import { TextoDelAviso } from "../Privacidad/TextoDelAviso";

/**
 * Gestionar documentos → «Acuerdo de confidencialidad»: el título y el texto
 * que se presentan antes de leer los documentos, de solo lectura. Desde
 * US-004 (11/11/2026, CA-7) se editan en «Protección de datos» → «Textos»;
 * aquí se ve el vigente con el enlace. Se vuelve a pedir aceptarlo cuando
 * cambia su texto o un documento (publicar, reemplazar el archivo o volver a
 * publicar uno retirado).
 */
export function AcuerdoConfidencialidad() {
  const [valores, setValores] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);

  const cargar = useCallback(() => {
    setErrorCarga(null);
    institucionalService
      .confidencialidad()
      .then(({ titulo, texto, version }) =>
        setValores({ titulo, texto, version }),
      )
      .catch((err) =>
        setErrorCarga(mensajeDeError(err, "No se pudo cargar el acuerdo.")),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!valores) {
    return <EstadoDeCarga cargando error={errorCarga} onReintentar={cargar} />;
  }

  return (
    <section className="mz-card" aria-labelledby="acuerdo-vigente-titulo">
      <div className="mz-card-body mz-stack">
        {/* El título primero: es lo que lee cada persona (QA-UX). */}
        <div className="mz-row-between">
          <h3 id="acuerdo-vigente-titulo" className="h6 mb-0">
            {valores.titulo}
          </h3>
          {valores.version && (
            <span className="mz-pill">Versión {valores.version}</span>
          )}
        </div>
        <div
          className="acuerdo-texto"
          // Una región con desplazamiento tiene que poder recibir el foco.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          role="region"
          aria-label="Texto del acuerdo"
        >
          <TextoDelAviso texto={valores.texto} />
        </div>
        <p className="mz-faint mb-0">
          Se presenta a cada persona al entrar a «Códigos de conducta». Sin
          aceptarlo no ve el contenido. Se vuelve a pedir cuando cambia su
          texto, se publica un documento, se reemplaza su archivo o se vuelve a
          publicar uno retirado (corregir datos, retirarlo o borrarlo no lo
          pide).
        </p>
        <SeEditaEnProteccionDeDatos
          que="El título y el texto del acuerdo"
          clave={CLAVES_TEXTO.ACUERDO}
        />
      </div>
    </section>
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

  const texto = buscar.trim();
  const conteos = {
    pendientes: datos?.pendientes ?? 0,
    aceptaron: datos?.aceptaron ?? 0,
    todas: datos?.total ?? 0,
  };
  const filas = (datos?.personas ?? []).filter(
    (f) =>
      (filtro === "todas" ||
        (filtro === "aceptaron" ? f.vigente : !f.vigente)) &&
      // Sin distinguir tildes ni mayúsculas (búsqueda en vivo, 06/11/2026).
      coincideBusqueda(texto, f.persona, f.correo),
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
      {/* Esta lista es de solo lectura y sigue aquí para quien gestiona los
          documentos; el registro completo, con IP, versión y el texto
          aceptado, está en Protección de datos (US-004, CA-7). */}
      <SeConsultaEnProteccionDeDatos
        que="El registro completo de aceptaciones del acuerdo, con la versión, la IP y el texto aceptado,"
        clave={CLAVES_TEXTO.ACUERDO}
        plural={false}
      />
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
      {/* Con pausa y solo al buscar: la región anterior hablaba en cada
          tecla (auditoría UX/UI de la búsqueda en vivo, 06/11/2026). */}
      <AnuncioDeResultados
        termino={texto}
        total={filas.length}
        sustantivo={["persona", "personas"]}
      />
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
