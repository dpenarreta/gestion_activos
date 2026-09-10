import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { importacionActivosService } from "../../../api/activosService";
import { AdminTabs } from "../../../components/admin/AdminTabs/AdminTabs";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { ColumnasPlantillaPanel } from "./ColumnasPlantillaPanel";
import { mensajeDeError } from "../../../utils/errores";
import "./ImportarActivos.css";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Activos", path: "/admin/activos" },
  { label: "Carga masiva" },
];

/**
 * Carga masiva de activos desde una hoja de cálculo.
 *
 * El flujo es de dos pasos a propósito: al elegir el archivo se **valida** y
 * se muestra qué entraría y qué falla, y recién entonces aparece el botón de
 * confirmar. Importar directamente dejaría al usuario descubriendo los errores
 * cuando ya hay activos creados, y sin saber cuáles.
 */
const TABS = [
  { key: "cargar", label: "Cargar archivo", path: "/admin/activos/importar" },
  {
    key: "columnas",
    label: "Columnas de la plantilla",
    path: "/admin/activos/importar/columnas",
  },
];

export function ImportarActivosPage({ seccion = "cargar" }) {
  if (seccion === "columnas") {
    return (
      <div className="importar-activos-page">
        <Breadcrumbs items={BREADCRUMB_ITEMS} />
        <h2>Carga masiva de activos</h2>
        <AdminTabs tabs={TABS} />
        <div
          role="tabpanel"
          id="admin-tabpanel-columnas"
          aria-labelledby="admin-tab-columnas"
          className="pt-3"
        >
          <ColumnasPlantillaPanel />
        </div>
      </div>
    );
  }
  return <PanelCarga />;
}

function PanelCarga() {
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [archivo, setArchivo] = useState(null);
  const [reporte, setReporte] = useState(null);
  const [error, setError] = useState(null);
  const [isValidando, setIsValidando] = useState(false);
  const [isImportando, setIsImportando] = useState(false);
  const [resultado, setResultado] = useState(null);

  async function handleDescargarPlantilla() {
    setError(null);
    try {
      const blob = await importacionActivosService.descargarPlantilla();
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = "plantilla-carga-activos.xlsx";
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar la plantilla."));
    }
  }

  async function handleArchivo(event) {
    const seleccionado = event.target.files?.[0];
    setReporte(null);
    setResultado(null);
    setError(null);
    if (!seleccionado) {
      setArchivo(null);
      return;
    }
    setArchivo(seleccionado);
    setIsValidando(true);
    try {
      setReporte(await importacionActivosService.enviar(seleccionado));
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo leer el archivo."));
      setArchivo(null);
    } finally {
      setIsValidando(false);
    }
  }

  async function handleImportar() {
    setIsImportando(true);
    setError(null);
    try {
      const respuesta = await importacionActivosService.enviar(archivo, {
        confirmar: true,
      });
      setResultado(respuesta);
      setReporte(null);
      setArchivo(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo completar la importación."));
    } finally {
      setIsImportando(false);
    }
  }

  function limpiar() {
    setArchivo(null);
    setReporte(null);
    setResultado(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="importar-activos-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2>Carga masiva de activos</h2>
        <Link to="/admin/activos" className="btn btn-outline-secondary btn-sm">
          Volver al inventario
        </Link>
      </div>

      <AdminTabs tabs={TABS} />

      <div
        className="pt-3"
        role="tabpanel"
        id="admin-tabpanel-cargar"
        aria-labelledby="admin-tab-cargar"
      >
        {error && <div className="alert alert-danger">{error}</div>}

        <ol className="pasos-carga">
          <li className="paso">
            <div className="paso__numero">1</div>
            <div className="paso__contenido">
              <h3 className="h6">Descargue la plantilla</h3>
              <p className="text-muted small mb-2">
                Incluye las columnas que se deben llenar, una hoja de
                instrucciones, un ejemplo y los códigos vigentes de tipos de
                dispositivo, departamentos y empleados.
              </p>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={handleDescargarPlantilla}
              >
                <i
                  className="bi bi-file-earmark-excel me-1"
                  aria-hidden="true"
                />
                Descargar plantilla (.xlsx)
              </button>
            </div>
          </li>

          <li className="paso">
            <div className="paso__numero">2</div>
            <div className="paso__contenido">
              <h3 className="h6">Complete una fila por equipo</h3>
              <p className="text-muted small mb-0">
                Las columnas marcadas con <strong>*</strong> son obligatorias.
                El código de barras <strong>no se llena</strong>: lo genera el
                sistema al importar. Máximo 1000 filas por carga.
              </p>
            </div>
          </li>

          <li className="paso">
            <div className="paso__numero">3</div>
            <div className="paso__contenido">
              <h3 className="h6">Suba el archivo</h3>
              <p className="text-muted small mb-2">
                Se revisa completo y se le muestra qué entraría. Nada se guarda
                hasta que confirme.
              </p>
              <input
                ref={inputRef}
                type="file"
                className="form-control form-control-sm"
                accept=".xlsx"
                aria-label="Archivo de carga masiva"
                onChange={handleArchivo}
                disabled={isValidando || isImportando}
              />
              {isValidando && (
                <p className="text-muted small mt-2 mb-0">
                  Revisando el archivo…
                </p>
              )}
            </div>
          </li>
        </ol>

        {reporte && <ReporteValidacion reporte={reporte} archivo={archivo} />}

        {reporte && (
          <div className="d-flex gap-2 mt-3">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleImportar}
              disabled={!reporte.es_importable || isImportando}
            >
              {/* El texto dice lo que va a pasar de verdad: con errores
                pendientes, "Importar 2 activos" prometería algo que el botón
                no hace, aunque esté deshabilitado. */}
              {isImportando
                ? "Importando…"
                : reporte.es_importable
                  ? `Importar ${reporte.filas_validas} activo(s)`
                  : `Corrija ${reporte.filas_con_error ?? reporte.errores.length} fila(s) para importar`}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={limpiar}
            >
              Elegir otro archivo
            </button>
          </div>
        )}

        {resultado && (
          <ResultadoImportacion
            resultado={resultado}
            onVerInventario={() => navigate("/admin/activos")}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Agrupa los hallazgos por fila.
 *
 * Una lista plana repite el número de fila en cada línea y obliga a
 * reconstruir a ojo cuántos problemas tiene cada una: con tres errores en la
 * fila 7 se lee tres veces «7» y no queda claro si son tres filas o una. Al
 * corregir se trabaja fila por fila, así que el reporte se ordena igual.
 */
function porFila(hallazgos) {
  const filas = new Map();
  for (const hallazgo of hallazgos) {
    if (!filas.has(hallazgo.fila)) {
      filas.set(hallazgo.fila, []);
    }
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

function ReporteValidacion({ reporte, archivo }) {
  const {
    total_filas: totalFilas,
    filas_validas: filasValidas,
    filas_con_error: filasConError,
    errores,
    advertencias = [],
    vista_previa: vistaPrevia,
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
            <div className="resumen-etiqueta">Listas para importar</div>
          </div>
        </div>
        <div className="col-auto">
          {/* Se cuentan filas, no errores: es lo que hay que ir a corregir en
              el archivo, y una fila puede traer tres problemas. */}
          <div
            className={`resumen-caja ${errores.length > 0 ? "resumen-caja--error" : ""}`}
          >
            <div className="resumen-valor">
              {filasConError ?? errores.length}
            </div>
            <div className="resumen-etiqueta">Filas con error</div>
          </div>
        </div>
        {advertencias.length > 0 && (
          <div className="col-auto">
            <div className="resumen-caja resumen-caja--aviso">
              <div className="resumen-valor">{advertencias.length}</div>
              <div className="resumen-etiqueta">Avisos</div>
            </div>
          </div>
        )}
      </div>

      {errores.length > 0 && (
        <>
          <div className="alert alert-danger">
            <strong>No se importará nada mientras haya errores.</strong> La
            carga es todo o nada: un inventario a medio cargar es peor que uno
            vacío, porque no se sabe qué entró. Corrija lo siguiente en el
            archivo y vuelva a subirlo.
          </div>
          <ListaPorFila hallazgos={errores} tono="error" />
        </>
      )}

      {advertencias.length > 0 && (
        <>
          <div className="alert alert-warning">
            {/* Separadas de los errores a propósito: no bloquean, y mezclarlas
                obligaría a elegir entre frenar cargas legítimas o callar cosas
                que conviene mirar antes de confirmar. */}
            <strong>Esto se importará igual</strong>, pero conviene revisarlo
            antes de confirmar.
          </div>
          <ListaPorFila hallazgos={advertencias} tono="aviso" />
        </>
      )}

      {errores.length === 0 && vistaPrevia.length > 0 && (
        <>
          <p className="text-muted small">
            Primeros {vistaPrevia.length} de {filasValidas} activos que se
            crearán:
          </p>
          <div className="table-responsive">
            <table className="table table-sm table-striped align-middle">
              <thead>
                <tr>
                  <th className="text-end">Fila</th>
                  <th>Nombre</th>
                  <th>Equipo</th>
                  <th>Serie</th>
                  <th>Tipo</th>
                  <th>Área</th>
                  <th>Custodio</th>
                </tr>
              </thead>
              <tbody>
                {vistaPrevia.map((fila) => (
                  <tr key={fila.fila}>
                    <td className="text-end text-muted">{fila.fila}</td>
                    <td>{fila.nombre}</td>
                    <td>
                      {fila.marca} {fila.modelo}
                    </td>
                    <td>
                      <code>{fila.numero_serie}</code>
                    </td>
                    <td>{fila.tipo}</td>
                    <td>{fila.departamento}</td>
                    <td>
                      {fila.custodio || (
                        <span className="text-muted">Bodega</span>
                      )}
                    </td>
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

function ResultadoImportacion({ resultado, onVerInventario }) {
  return (
    <section className="mt-4">
      <div className="alert alert-success">
        <h3 className="h6">
          Se importaron {resultado.creados.length} activo(s) con su código de
          barras generado.
        </h3>
        <p className="small mb-0">
          Ya puede imprimir sus etiquetas desde la ficha de cada uno.
        </p>
      </div>

      <div className="table-responsive">
        <table className="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>Código de barras</th>
              <th>Activo</th>
            </tr>
          </thead>
          <tbody>
            {resultado.creados.map((activo) => (
              <tr key={activo.id}>
                <td>
                  <Link to={`/admin/activos/${activo.id}`}>
                    <code className="codigo-barras">
                      {activo.codigo_barras}
                    </code>
                  </Link>
                </td>
                <td>{activo.nombre}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        onClick={onVerInventario}
      >
        Ver el inventario
      </button>
    </section>
  );
}
