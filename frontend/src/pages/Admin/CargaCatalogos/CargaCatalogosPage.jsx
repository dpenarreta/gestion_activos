import { useEffect, useRef, useState } from "react";

import { catalogosMasivosService } from "../../../api/catalogosService";
import { Icon } from "../../../components/common/Icon/Icon";
import { descargarBlob } from "../../../utils/descargas";
import { mensajeDeError } from "../../../utils/errores";
import "./CargaCatalogos.css";

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
      <div className="mz-view-head">
        <div>
          <h2>Carga de catálogos</h2>
          <p className="mz-desc">
            Cada catálogo tiene su propio archivo. Se descarga con lo que ya
            está registrado dentro, así que sirve de referencia al llenar la
            plantilla de activos y de plantilla para añadir filas debajo.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="mz-tabs" role="tablist">
        {catalogos.map((catalogo) => (
          <button
            key={catalogo.clave}
            type="button"
            role="tab"
            aria-selected={elegido?.clave === catalogo.clave}
            className={elegido?.clave === catalogo.clave ? "is-active" : ""}
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
  const [isArrastrando, setIsArrastrando] = useState(false);

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

  /*
   * El archivo llega por el selector o arrastrado sobre el recuadro; en los
   * dos casos se revisa igual, y nada se guarda hasta que se confirme.
   */
  async function revisar(elegido) {
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

  function soltarArchivo(event) {
    event.preventDefault();
    setIsArrastrando(false);
    revisar(event.dataTransfer?.files?.[0]);
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
    <section className="mz-card">
      <div className="mz-card-body">
        <div className="carga-catalogos__pasos">
          <div className="paso">
            <span className="paso__numero">1</span>
            <div>
              <strong>Descargue el archivo de {catalogo.plural}</strong>
              <p className="mz-faint mb-2">
                Baja con lo que ya está registrado. Escriba las filas nuevas
                debajo, sin borrar las que hay.
                {catalogo.nota ? ` ${catalogo.nota}` : ""}
              </p>
              <button
                type="button"
                className="btn btn-exportar btn-sm"
                onClick={descargar}
              >
                <Icon name="file-earmark-excel" /> Descargar plantilla (.xlsx)
              </button>
            </div>
          </div>

          <div className="paso">
            <span className="paso__numero">2</span>
            <div>
              <strong>Suba el archivo</strong>
              <p className="mz-faint mb-2">
                Se revisa completo y se le muestra qué entraría. Nada se guarda
                hasta que confirme. Volver a subir el mismo archivo no duplica
                nada.
              </p>
              <div
                className={`mz-drop carga-catalogos__drop${isArrastrando ? " is-drag" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsArrastrando(true);
                }}
                onDragLeave={() => setIsArrastrando(false)}
                onDrop={soltarArchivo}
              >
                <Icon name="cloud-arrow-up" />
                <div>Arrastre aquí el archivo .xlsx, o elíjalo:</div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx"
                  className="form-control form-control-sm"
                  aria-label={`Archivo de ${catalogo.plural}`}
                  onChange={(event) => revisar(event.target.files?.[0])}
                />
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mz-alert mz-alert--bad mt-3" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        {isValidando && (
          <p className="mz-faint mt-3" role="status">
            Revisando el archivo…
          </p>
        )}

        {reporte && (
          <>
            <ReporteCatalogo reporte={reporte} archivo={archivo} />
            <div className="mz-actions">
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
          <div className="mz-alert mz-alert--info mt-3" role="status">
            <Icon name="check2-circle" />
            <div>
              Se crearon <strong>{resultado.creados}</strong> {catalogo.plural}.{" "}
              {resultado.advertencias.length > 0 &&
                `${resultado.advertencias.length} fila(s) ya existían y se omitieron.`}
            </div>
          </div>
        )}
      </div>
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
      <h3 className="carga-catalogos__titulo">Revisión de {archivo?.name}</h3>

      <div className="mz-kpi-grid carga-catalogos__resumen">
        <div className="mz-kpi mz-kpi--info">
          <div className="mz-kpi-top">
            <span className="mz-kpi-label">Filas con datos</span>
          </div>
          <div className="mz-kpi-value">{totalFilas}</div>
        </div>
        <div className={`mz-kpi ${filasValidas > 0 ? "mz-kpi--ok" : ""}`}>
          <div className="mz-kpi-top">
            <span className="mz-kpi-label">Se crearán</span>
          </div>
          <div className="mz-kpi-value">{filasValidas}</div>
        </div>
        <div className={`mz-kpi ${errores.length > 0 ? "mz-kpi--bad" : ""}`}>
          <div className="mz-kpi-top">
            <span className="mz-kpi-label">Filas con error</span>
          </div>
          <div className="mz-kpi-value">{filasConError}</div>
        </div>
        {advertencias.length > 0 && (
          <div className="mz-kpi mz-kpi--warn">
            <div className="mz-kpi-top">
              <span className="mz-kpi-label">Ya existían</span>
            </div>
            <div className="mz-kpi-value">{advertencias.length}</div>
          </div>
        )}
      </div>

      {errores.length > 0 && (
        <>
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            <div>
              <strong>No se importará nada mientras haya errores.</strong> La
              carga es todo o nada: a medias no se sabría qué entró.
            </div>
          </div>
          <ListaPorFila hallazgos={errores} tono="error" />
        </>
      )}

      {advertencias.length > 0 && (
        <>
          <div className="mz-alert mz-alert--warn" role="status">
            <Icon name="exclamation-triangle" />
            <div>
              <strong>Estas filas ya existen</strong> y se omiten; el resto se
              importa igual.
            </div>
          </div>
          <ListaPorFila hallazgos={advertencias} tono="aviso" />
        </>
      )}

      {errores.length === 0 && vistaPrevia.length > 0 && (
        <>
          <p className="mz-faint mz-small">
            Primeras {vistaPrevia.length} de {filasValidas} filas que se
            crearán:
          </p>
          <div className="mz-table-wrap mb-3">
            <table className="mz-table">
              <thead>
                <tr>
                  <th className="num">Fila</th>
                  {columnas.map((columna) => (
                    <th key={columna}>{columna}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vistaPrevia.map((fila) => (
                  <tr key={fila.fila}>
                    <td className="num mz-faint">{fila.fila}</td>
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
