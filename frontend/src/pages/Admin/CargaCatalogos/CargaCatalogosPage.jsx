import { useEffect, useRef, useState } from "react";

import { catalogosMasivosService } from "../../../api/catalogosService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { descargarBlob } from "../../../utils/descargas";
import { mensajeDeError } from "../../../utils/errores";
import "./CargaCatalogos.css";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Carga de catálogos" },
];

/**
 * Carga masiva de los catálogos, **un archivo por catálogo**.
 *
 * La plantilla de activos llegó a traer ocho hojas en un solo libro, cinco de
 * ellas solo de consulta, y ninguno de esos catálogos se podía cargar: para
 * dar de alta cincuenta empleados había que teclearlos uno a uno mientras el
 * archivo ya los listaba.
 *
 * La lista de catálogos viene del backend, no de una constante de aquí: uno
 * nuevo aparece en esta pantalla sin tocar el frontend, igual que un reporte.
 */
export function CargaCatalogosPage() {
  const [catalogos, setCatalogos] = useState([]);
  const [elegido, setElegido] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    catalogosMasivosService
      .listar()
      .then((datos) => {
        const disponibles = datos.catalogos.filter((c) => c.puede);
        setCatalogos(disponibles);
        setElegido(disponibles[0] ?? null);
      })
      .catch((err) =>
        setError(
          mensajeDeError(err, "No se pudo cargar la lista de catálogos."),
        ),
      );
  }, []);

  return (
    <div className="carga-catalogos-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <h2>Carga de catálogos</h2>
      <p className="text-muted">
        Cada catálogo tiene su propio archivo. Se descarga con lo que ya está
        registrado dentro, así que sirve de referencia al llenar la plantilla de
        activos y de plantilla para añadir filas debajo.
      </p>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="carga-catalogos__selector" role="tablist">
        {catalogos.map((catalogo) => (
          <button
            key={catalogo.clave}
            type="button"
            role="tab"
            aria-selected={elegido?.clave === catalogo.clave}
            className={`btn btn-sm ${
              elegido?.clave === catalogo.clave
                ? "btn-primary"
                : "btn-outline-primary"
            }`}
            onClick={() => setElegido(catalogo)}
          >
            {catalogo.nombre}
          </button>
        ))}
      </div>

      {elegido && <PanelCatalogo catalogo={elegido} key={elegido.clave} />}
    </div>
  );
}

function PanelCatalogo({ catalogo }) {
  const inputRef = useRef(null);
  const [archivo, setArchivo] = useState(null);
  const [reporte, setReporte] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [isValidando, setIsValidando] = useState(false);
  const [isImportando, setIsImportando] = useState(false);

  function limpiar() {
    setArchivo(null);
    setReporte(null);
    setResultado(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function descargar() {
    setError(null);
    try {
      const blob = await catalogosMasivosService.plantilla(catalogo.clave);
      descargarBlob(blob, `plantilla-${catalogo.clave}.xlsx`);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar la plantilla."));
    }
  }

  async function elegirArchivo(event) {
    const elegido = event.target.files?.[0];
    if (!elegido) return;
    setArchivo(elegido);
    setReporte(null);
    setResultado(null);
    setError(null);
    setIsValidando(true);
    try {
      setReporte(
        await catalogosMasivosService.validar(catalogo.clave, elegido),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo revisar el archivo."));
    } finally {
      setIsValidando(false);
    }
  }

  async function importar() {
    setIsImportando(true);
    setError(null);
    try {
      setResultado(
        await catalogosMasivosService.importar(catalogo.clave, archivo),
      );
      setReporte(null);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo importar el archivo."));
    } finally {
      setIsImportando(false);
    }
  }

  return (
    <section className="carga-catalogos__panel">
      <div className="carga-catalogos__pasos">
        <div className="paso">
          <span className="paso__numero">1</span>
          <div>
            <strong>Descargue el archivo de {catalogo.plural}</strong>
            <p className="text-muted mb-2">
              Baja con lo que ya está registrado. Escriba las filas nuevas
              debajo, sin borrar las que hay.
              {catalogo.nota ? ` ${catalogo.nota}` : ""}
            </p>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={descargar}
            >
              <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
              Descargar plantilla (.xlsx)
            </button>
          </div>
        </div>

        <div className="paso">
          <span className="paso__numero">2</span>
          <div>
            <strong>Suba el archivo</strong>
            <p className="text-muted mb-2">
              Se revisa completo y se le muestra qué entraría. Nada se guarda
              hasta que confirme. Volver a subir el mismo archivo no duplica
              nada.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              className="form-control form-control-sm w-auto"
              aria-label={`Archivo de ${catalogo.plural}`}
              onChange={elegirArchivo}
            />
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger mt-3">{error}</div>}
      {isValidando && <p className="text-muted mt-3">Revisando el archivo…</p>}

      {reporte && (
        <>
          <ReporteCatalogo reporte={reporte} archivo={archivo} />
          <div className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!reporte.es_importable || isImportando}
              onClick={importar}
            >
              {isImportando
                ? "Importando…"
                : reporte.es_importable
                  ? `Importar ${reporte.filas_validas} ${catalogo.plural}`
                  : `Corrija ${reporte.filas_con_error} fila(s) para importar`}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={limpiar}
            >
              Elegir otro archivo
            </button>
          </div>
        </>
      )}

      {resultado && (
        <div className="alert alert-success mt-3">
          Se crearon <strong>{resultado.creados}</strong> {catalogo.plural}.{" "}
          {resultado.advertencias.length > 0 &&
            `${resultado.advertencias.length} fila(s) ya existían y se omitieron.`}
        </div>
      )}
    </section>
  );
}

/** Agrupa los hallazgos por fila: al corregir se trabaja fila por fila. */
function porFila(hallazgos) {
  const filas = new Map();
  for (const hallazgo of hallazgos) {
    if (!filas.has(hallazgo.fila)) filas.set(hallazgo.fila, []);
    filas.get(hallazgo.fila).push(hallazgo);
  }
  return [...filas.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([fila, lista]) => ({ fila, hallazgos: lista }));
}

function ListaPorFila({ hallazgos, tono }) {
  return (
    <ul className={`hallazgos hallazgos--${tono}`}>
      {porFila(hallazgos).map(({ fila, hallazgos: deLaFila }) => (
        <li key={fila} className="hallazgos__fila">
          <span className="hallazgos__numero">Fila {fila}</span>
          <ul className="hallazgos__detalle">
            {deLaFila.map((hallazgo, indice) => (
              <li key={`${hallazgo.columna}-${indice}`}>
                <strong>{hallazgo.columna}:</strong> {hallazgo.mensaje}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function ReporteCatalogo({ reporte, archivo }) {
  const {
    total_filas: totalFilas,
    filas_validas: filasValidas,
    filas_con_error: filasConError,
    errores,
    advertencias,
    vista_previa: vistaPrevia,
    columnas,
  } = reporte;

  return (
    <section className="mt-4">
      <h3 className="h5">Revisión de {archivo?.name}</h3>

      <div className="row g-2 mb-3">
        <div className="col-auto">
          <div className="resumen-caja">
            <div className="resumen-valor">{totalFilas}</div>
            <div className="resumen-etiqueta">Filas con datos</div>
          </div>
        </div>
        <div className="col-auto">
          <div
            className={`resumen-caja ${filasValidas > 0 ? "resumen-caja--ok" : ""}`}
          >
            <div className="resumen-valor">{filasValidas}</div>
            <div className="resumen-etiqueta">Se crearán</div>
          </div>
        </div>
        <div className="col-auto">
          <div
            className={`resumen-caja ${errores.length > 0 ? "resumen-caja--error" : ""}`}
          >
            <div className="resumen-valor">{filasConError}</div>
            <div className="resumen-etiqueta">Filas con error</div>
          </div>
        </div>
        {advertencias.length > 0 && (
          <div className="col-auto">
            <div className="resumen-caja resumen-caja--aviso">
              <div className="resumen-valor">{advertencias.length}</div>
              <div className="resumen-etiqueta">Ya existían</div>
            </div>
          </div>
        )}
      </div>

      {errores.length > 0 && (
        <>
          <div className="alert alert-danger">
            <strong>No se importará nada mientras haya errores.</strong> La
            carga es todo o nada: a medias no se sabría qué entró.
          </div>
          <ListaPorFila hallazgos={errores} tono="error" />
        </>
      )}

      {advertencias.length > 0 && (
        <>
          <div className="alert alert-warning">
            <strong>Estas filas ya existen</strong> y se omiten; el resto se
            importa igual.
          </div>
          <ListaPorFila hallazgos={advertencias} tono="aviso" />
        </>
      )}

      {errores.length === 0 && vistaPrevia.length > 0 && (
        <>
          <p className="text-muted small">
            Primeras {vistaPrevia.length} de {filasValidas} filas que se
            crearán:
          </p>
          <div className="table-responsive">
            <table className="table table-sm table-striped align-middle">
              <thead>
                <tr>
                  <th className="text-end">Fila</th>
                  {columnas.map((columna) => (
                    <th key={columna}>{columna}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vistaPrevia.map((fila) => (
                  <tr key={fila.fila}>
                    <td className="text-end text-muted">{fila.fila}</td>
                    {fila.valores.map((valor, indice) => (
                      <td key={indice}>{valor}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
