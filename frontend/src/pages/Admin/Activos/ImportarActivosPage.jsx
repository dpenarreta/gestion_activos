import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { importacionActivosService } from "../../../api/activosService";
import { AdminTabs } from "../../../components/admin/AdminTabs/AdminTabs";
import { Icon } from "../../../components/common/Icon/Icon";
import { ColumnasPlantillaPanel } from "./ColumnasPlantillaPanel";
import { mensajeDeError } from "../../../utils/errores";
import "./ImportarActivos.css";
import { descargarBlob } from "../../../utils/descargas";

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
        <Encabezado />
        <AdminTabs tabs={TABS} />
        <div
          role="tabpanel"
          id="admin-tabpanel-columnas"
          aria-labelledby="admin-tab-columnas"
        >
          <ColumnasPlantillaPanel />
        </div>
      </div>
    );
  }
  return <PanelCarga />;
}

/* El mismo encabezado en las dos pestañas: son una sola pantalla, y que el
   título o la salida cambiaran al pasar de una a otra haría pensar que se
   salió de ella. */
function Encabezado() {
  return (
    <div className="mz-view-head">
      <div>
        <h2>Carga masiva de activos</h2>
        <p className="mz-desc">
          Muchos equipos de una vez, desde una hoja de cálculo. El archivo se
          revisa entero antes de guardar nada.
        </p>
      </div>
      <div className="mz-view-actions">
        <Link to="/admin/activos" className="btn btn-outline-secondary btn-sm">
          <Icon name="arrow-left" /> Volver al inventario
        </Link>
      </div>
    </div>
  );
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
  const [isArrastrando, setIsArrastrando] = useState(false);

  async function handleDescargarPlantilla() {
    setError(null);
    try {
      const blob = await importacionActivosService.descargarPlantilla();
      descargarBlob(blob, "plantilla-carga-activos.xlsx");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar la plantilla."));
    }
  }

  function handleArchivo(event) {
    validar(event.target.files?.[0]);
  }

  // Soltar el archivo sobre la zona hace lo mismo que elegirlo: la zona
  // invita a arrastrar, y que no hiciera nada al soltar sería engañoso.
  function handleSoltar(event) {
    event.preventDefault();
    setIsArrastrando(false);
    if (isValidando || isImportando) return;
    const soltado = event.dataTransfer?.files?.[0];
    if (soltado) validar(soltado);
  }

  async function validar(seleccionado) {
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

  const ocupado = isValidando || isImportando;

  return (
    <div className="importar-activos-page">
      <Encabezado />

      <AdminTabs tabs={TABS} />

      <div
        role="tabpanel"
        id="admin-tabpanel-cargar"
        aria-labelledby="admin-tab-cargar"
      >
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}

        <ol className="pasos-carga">
          <li className="mz-card paso">
            <div className="paso__numero">1</div>
            <div className="paso__contenido">
              <h3 className="paso__titulo">Descargue la plantilla</h3>
              <p className="mz-small mz-faint mb-2">
                Incluye las columnas que se deben llenar, una hoja de
                instrucciones, un ejemplo y los códigos vigentes de tipos de
                dispositivo, departamentos y empleados.
              </p>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={handleDescargarPlantilla}
              >
                <Icon name="file-earmark-excel" /> Descargar plantilla (.xlsx)
              </button>
            </div>
          </li>

          <li className="mz-card paso">
            <div className="paso__numero">2</div>
            <div className="paso__contenido">
              <h3 className="paso__titulo">Complete una fila por equipo</h3>
              <p className="mz-small mz-faint mb-0">
                Las columnas marcadas con <strong>*</strong> son obligatorias.
                El código de barras <strong>no se llena</strong>: lo genera el
                sistema al importar. Máximo 1000 filas por carga.
              </p>
            </div>
          </li>

          <li className="mz-card paso">
            <div className="paso__numero">3</div>
            <div className="paso__contenido">
              <h3 className="paso__titulo">Suba el archivo</h3>
              <p className="mz-small mz-faint mb-2">
                Se revisa completo y se le muestra qué entraría. Nada se guarda
                hasta que confirme.
              </p>
              {/* El campo de archivo va dentro de la zona y oculto a la vista:
                  la zona entera es la que se pulsa, y el campo conserva su
                  nombre accesible y el foco de teclado. */}
              <label
                className={`mz-drop carga-drop${isArrastrando ? " is-drag" : ""}${ocupado ? " is-disabled" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!ocupado) setIsArrastrando(true);
                }}
                onDragLeave={() => setIsArrastrando(false)}
                onDrop={handleSoltar}
              >
                <Icon name="cloud-arrow-up" />
                <div>
                  {archivo
                    ? archivo.name
                    : "Arrastre el .xlsx aquí o haga clic para elegirlo"}
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  className="visually-hidden"
                  accept=".xlsx"
                  aria-label="Archivo de carga masiva"
                  onChange={handleArchivo}
                  disabled={ocupado}
                />
              </label>
              {isValidando && (
                <p className="mz-small mz-faint mt-2 mb-0" role="status">
                  Revisando el archivo…
                </p>
              )}
            </div>
          </li>
        </ol>

        {reporte && <ReporteValidacion reporte={reporte} archivo={archivo} />}

        {reporte && (
          <div className="mz-actions justify-content-end mt-3">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={limpiar}
            >
              Elegir otro archivo
            </button>
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
    <section className="mz-card mt-4">
      <div className="mz-card-head">
        <h3>Revisión de {archivo?.name}</h3>
      </div>

      <div className="mz-card-body">
        <div className="mz-kpi-grid">
          <div className="mz-kpi mz-kpi--info">
            <div className="mz-kpi-top">
              <span className="mz-kpi-label">Filas con datos</span>
              <span className="mz-kpi-icon">
                <Icon name="table" />
              </span>
            </div>
            <div className="mz-kpi-value">{totalFilas}</div>
          </div>
          <div className={`mz-kpi ${filasValidas > 0 ? "mz-kpi--ok" : ""}`}>
            <div className="mz-kpi-top">
              <span className="mz-kpi-label">Listas para importar</span>
              <span className="mz-kpi-icon">
                <Icon name="check2-circle" />
              </span>
            </div>
            <div className="mz-kpi-value">{filasValidas}</div>
          </div>
          {/* Se cuentan filas, no errores: es lo que hay que ir a corregir en
              el archivo, y una fila puede traer tres problemas. */}
          <div className={`mz-kpi ${errores.length > 0 ? "mz-kpi--bad" : ""}`}>
            <div className="mz-kpi-top">
              <span className="mz-kpi-label">Filas con error</span>
              <span className="mz-kpi-icon">
                <Icon name="x-octagon" />
              </span>
            </div>
            <div className="mz-kpi-value">
              {filasConError ?? errores.length}
            </div>
          </div>
          {advertencias.length > 0 && (
            <div className="mz-kpi mz-kpi--warn">
              <div className="mz-kpi-top">
                <span className="mz-kpi-label">Avisos</span>
                <span className="mz-kpi-icon">
                  <Icon name="exclamation-triangle" />
                </span>
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
                carga es todo o nada: un inventario a medio cargar es peor que
                uno vacío, porque no se sabe qué entró. Corrija lo siguiente en
                el archivo y vuelva a subirlo.
              </div>
            </div>
            <ListaPorFila hallazgos={errores} tono="error" />
          </>
        )}

        {advertencias.length > 0 && (
          <>
            <div className="mz-alert mz-alert--warn" role="status">
              <Icon name="exclamation-triangle" />
              {/* Separadas de los errores a propósito: no bloquean, y
                  mezclarlas obligaría a elegir entre frenar cargas legítimas o
                  callar cosas que conviene mirar antes de confirmar. */}
              <div>
                <strong>Esto se importará igual</strong>, pero conviene
                revisarlo antes de confirmar.
              </div>
            </div>
            <ListaPorFila hallazgos={advertencias} tono="aviso" />
          </>
        )}

        {errores.length === 0 && vistaPrevia.length > 0 && (
          <p className="mz-small mz-faint mb-0">
            Primeros {vistaPrevia.length} de {filasValidas} activos que se
            crearán:
          </p>
        )}
      </div>

      {errores.length === 0 && vistaPrevia.length > 0 && (
        <div className="mz-table-wrap">
          <table className="mz-table">
            <thead>
              <tr>
                <th className="num">Fila</th>
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
                  <td className="num mz-faint">{fila.fila}</td>
                  <td className="mz-strong">{fila.nombre}</td>
                  <td>
                    {fila.marca} {fila.modelo}
                  </td>
                  <td className="mz-mono">{fila.numero_serie}</td>
                  <td>{fila.tipo}</td>
                  <td>{fila.departamento}</td>
                  <td>
                    {fila.custodio || <span className="mz-faint">Bodega</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ResultadoImportacion({ resultado, onVerInventario }) {
  return (
    <section className="mz-card mt-4">
      <div className="mz-card-body">
        <div className="mz-alert mz-alert--info mb-0" role="status">
          <Icon name="check2-circle" />
          <div>
            <h3 className="resultado-carga__titulo">
              Se importaron {resultado.creados.length} activo(s) con su código
              de barras generado.
            </h3>
            Ya puede imprimir sus etiquetas desde la ficha de cada uno.
          </div>
        </div>
      </div>

      <div className="mz-table-wrap">
        <table className="mz-table">
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
                <td className="mz-strong">{activo.nombre}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mz-card-body">
        <div className="mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onVerInventario}
          >
            Ver el inventario
          </button>
        </div>
      </div>
    </section>
  );
}
