import { useEffect, useState } from "react";

import { ordenesService } from "../../api/ordenesService";
import { Icon } from "../../components/common/Icon/Icon";
import { descargarBlob } from "../../utils/descargas";
import { mensajeDeError } from "../../utils/errores";
import { moneda } from "./comunes";
import { TarjetasDeIndicadores } from "./PanelOrdenes";
import "./Ordenes.css";

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

/** Los últimos doce meses y los dos últimos años, del más reciente al más viejo. */
function periodos(hoy = new Date()) {
  const lista = [];
  for (let i = 0; i < 12; i += 1) {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const mes = String(fecha.getMonth() + 1).padStart(2, "0");
    lista.push([
      `${fecha.getFullYear()}-${mes}`,
      `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`,
    ]);
  }
  lista.push([String(hoy.getFullYear()), `Año ${hoy.getFullYear()}`]);
  lista.push([String(hoy.getFullYear() - 1), `Año ${hoy.getFullYear() - 1}`]);
  return lista;
}

/**
 * Reportes → Órdenes de trabajo: indicadores y gráficos con filtros, y la
 * exportación a Excel o PDF. Cada exportación queda en la bitácora; el
 * teléfono del solicitante sale enmascarado a quien no lo ve completo.
 */
export function ReportesOrdenes() {
  const [catalogos, setCatalogos] = useState(null);
  const [filtros, setFiltros] = useState({
    periodo: "",
    region: "",
    categoria: "",
  });
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [exportando, setExportando] = useState(null);

  useEffect(() => {
    ordenesService
      .catalogos()
      .then(setCatalogos)
      .catch(() => setCatalogos(null));
  }, []);

  useEffect(() => {
    setError(null);
    ordenesService
      .reportes(filtros)
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron calcular los reportes.")),
      );
  }, [filtros]);

  async function exportar(formato) {
    setExportando(formato);
    setError(null);
    try {
      const respuesta = await ordenesService.exportar({ ...filtros, formato });
      const fecha = new Date().toISOString().slice(0, 10);
      descargarBlob(respuesta.data, `ordenes-de-trabajo-${fecha}.${formato}`);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo exportar."));
    } finally {
      setExportando(null);
    }
  }

  const fijar = (campo) => (evento) =>
    setFiltros((actual) => ({ ...actual, [campo]: evento.target.value }));

  return (
    <div className="ordenes-page mz-stack">
      <section className="mz-card">
        <div className="mz-card-body">
          <div className="row g-3 align-items-end">
            <div className="col-12 col-md-3">
              <label className="form-label" htmlFor="or-periodo">
                Periodo
              </label>
              <select
                id="or-periodo"
                className="form-select"
                value={filtros.periodo}
                onChange={fijar("periodo")}
              >
                <option value="">Todo</option>
                {periodos().map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label" htmlFor="or-region">
                Región
              </label>
              <select
                id="or-region"
                className="form-select"
                value={filtros.region}
                onChange={fijar("region")}
              >
                <option value="">Todas</option>
                {(catalogos?.regiones ?? []).map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label" htmlFor="or-categoria">
                Categoría
              </label>
              <select
                id="or-categoria"
                className="form-select"
                value={filtros.categoria}
                onChange={fijar("categoria")}
              >
                <option value="">Todas</option>
                {(catalogos?.categorias ?? []).map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12 col-md-3 mz-actions justify-content-md-end">
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={exportando !== null}
                onClick={() => exportar("xlsx")}
              >
                {exportando === "xlsx" ? "Exportando…" : "Exportar Excel"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={exportando !== null}
                onClick={() => exportar("pdf")}
              >
                {exportando === "pdf" ? "Exportando…" : "Exportar PDF"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {datos && (
        <>
          <TarjetasDeIndicadores kpis={datos.kpis} />
          <div className="ordenes-graficos">
            {datos.graficos.map((grafico) => (
              <Grafico key={grafico.clave} grafico={grafico} />
            ))}
          </div>
        </>
      )}
      <p className="mz-small mz-faint mb-0">
        Cada exportación queda registrada en la bitácora con usuario, fecha y
        filtros.
      </p>
    </div>
  );
}

function Grafico({ grafico }) {
  const valores = grafico.filas.map((fila) => Number(fila.valor));
  const maximo = Math.max(1, ...valores);
  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>{grafico.titulo}</h3>
      </div>
      <div className="mz-card-body">
        {grafico.filas.map((fila) => {
          const valor = Number(fila.valor);
          return (
            <div key={fila.etiqueta} className="ordenes-barra">
              <span>{fila.etiqueta}</span>
              <div className="ordenes-barra__pista" aria-hidden="true">
                <div
                  className="ordenes-barra__relleno"
                  style={{ width: `${Math.round((valor / maximo) * 100)}%` }}
                />
              </div>
              <span className="ordenes-barra__cifra">
                {grafico.moneda ? moneda(valor) : valor}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
