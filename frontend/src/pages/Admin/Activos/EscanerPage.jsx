import { useState } from "react";
import { Link } from "react-router-dom";

import { activosService } from "../../../api/activosService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { EscanerInput } from "../../../components/activos/EscanerInput/EscanerInput";
import { EstadoActivo } from "../../../components/activos/EstadoActivo/EstadoActivo";
import { AlertaRenovacion } from "../../../components/activos/AlertaRenovacion/AlertaRenovacion";
import { usePermission } from "../../../hooks/usePermission";
import {
  formatearFecha,
  formatearMeses,
  formatearMoneda,
} from "../../../utils/formato";
import "./Activos.css";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Activos", path: "/admin/activos" },
  { label: "Escáner" },
];

/**
 * Consulta de campo por lectura de código de barras (RF-03).
 *
 * Pantalla propia y no un modal dentro del listado porque el uso real es
 * repetitivo: el técnico recorre una oficina disparando la pistola equipo por
 * equipo. Aquí el campo conserva el foco entre lecturas y se lleva un
 * registro de los últimos escaneos, para poder volver a uno sin repetir el
 * disparo.
 */
export function EscanerPage() {
  const [ficha, setFicha] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [recientes, setRecientes] = useState([]);
  const [avisoLector, setAvisoLector] = useState(null);

  async function handleEscanear(codigo) {
    setIsLoading(true);
    setError(null);
    try {
      const datos = await activosService.porCodigo(codigo);
      setFicha(datos);
      // El backend avisa cuando ha tenido que reparar el código: la pistola
      // está enviando otra distribución de teclado y el guion llega como
      // apóstrofe. Se muestra aunque la búsqueda haya funcionado, porque el
      // mismo problema reaparecerá en la carga masiva y en el buscador.
      setAvisoLector(datos.advertencia_lector ?? null);
      setRecientes((actuales) => {
        const sinRepetir = actuales.filter(
          (item) => item.id !== datos.activo.id,
        );
        return [
          {
            id: datos.activo.id,
            codigo_barras: datos.activo.codigo_barras,
            nombre: datos.activo.nombre,
          },
          ...sinRepetir,
        ].slice(0, 8);
      });
    } catch (err) {
      setFicha(null);
      setAvisoLector(null);
      const mensajeDelServidor = err.response?.data?.error?.message;
      setError(
        err.response?.status === 404
          ? mensajeDelServidor ||
              `Ningún activo corresponde a "${codigo}". Verifique la etiqueta o busque por número de serie.`
          : "No se pudo consultar el activo.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="activos-page escaner-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <h2>Consulta por escáner</h2>
      <p className="text-muted">
        Dispare la lectora sobre la etiqueta del equipo. También funciona
        escribiendo el código o el número de serie del fabricante.
      </p>

      <EscanerInput
        className="escaner-page__campo mb-4"
        placeholder="Esperando lectura…"
        onEscanear={handleEscanear}
        enfocarAlMontar
        mantenerFoco
        disabled={isLoading}
      />

      {error && <div className="alert alert-warning">{error}</div>}

      {avisoLector && (
        <div className="alert alert-info">
          <strong>Revise la configuración del lector.</strong>{" "}
          {avisoLector.mensaje}
        </div>
      )}

      {ficha && <ResultadoEscaneo ficha={ficha} />}

      {recientes.length > 1 && (
        <section className="mt-4">
          <h3 className="h6 text-uppercase text-muted">Escaneos recientes</h3>
          <ul className="list-unstyled d-flex flex-wrap gap-2 mb-0">
            {recientes.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/admin/activos/${item.id}`}
                  className="btn btn-outline-secondary btn-sm"
                >
                  <code>{item.codigo_barras}</code> · {item.nombre}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ResultadoEscaneo({ ficha }) {
  const puedeRegistrarMantenimiento = usePermission("mantenimientos.registrar");
  const { activo, movimientos, mantenimientos, costos } = ficha;
  const ultimoMantenimiento = mantenimientos[0];

  return (
    <div className="card escaner-resultado">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
          <div>
            <h3 className="h4 mb-1">{activo.nombre}</h3>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <code className="codigo-barras">{activo.codigo_barras}</code>
              <EstadoActivo
                estado={activo.estado}
                etiqueta={activo.estado_display}
              />
            </div>
          </div>
          {/* Las dos cosas que se hacen con un equipo en la mano: mirarlo o
              anotar lo que le pasa. Ofrecer solo la ficha obligaba a entrar en
              ella y buscar ahí dentro el botón de registrar, que es un rodeo
              justo cuando el técnico tiene el equipo delante y una avería que
              apuntar. */}
          <div className="d-flex gap-2 flex-wrap">
            <Link
              to={`/admin/activos/${activo.id}`}
              className="btn btn-outline-primary btn-sm"
            >
              <i className="bi bi-card-list me-1" aria-hidden="true" />
              Ver ficha completa
            </Link>
            {/* No se ofrece sobre un equipo que ya salió del parque: el backend
                rechaza la intervención, y el estado está ahí al lado para que
                se vea por qué. */}
            {puedeRegistrarMantenimiento && activo.esta_operativo && (
              <Link
                to={`/admin/mantenimientos/new?activo=${activo.id}`}
                className="btn btn-primary btn-sm"
              >
                <i className="bi bi-tools me-1" aria-hidden="true" />
                Registrar mantenimiento
              </Link>
            )}
          </div>
        </div>

        <AlertaRenovacion renovacion={activo.renovacion} />

        <div className="row g-3">
          <div className="col-md-6">
            <dl className="row mb-0">
              <dt className="col-5 text-muted fw-normal">Responsable</dt>
              <dd className="col-7">
                {activo.custodio_nombre || (
                  <span className="text-muted">Sin asignar</span>
                )}
              </dd>
              <dt className="col-5 text-muted fw-normal">Área</dt>
              <dd className="col-7">{activo.departamento_nombre}</dd>
              <dt className="col-5 text-muted fw-normal">Ciudad</dt>
              <dd className="col-7">{activo.ciudad || "—"}</dd>
            </dl>
          </div>
          <div className="col-md-6">
            <dl className="row mb-0">
              <dt className="col-5 text-muted fw-normal">Equipo</dt>
              <dd className="col-7">
                {activo.marca} {activo.modelo}
              </dd>
              <dt className="col-5 text-muted fw-normal">Serie</dt>
              <dd className="col-7">
                <code>{activo.numero_serie}</code>
              </dd>
              <dt className="col-5 text-muted fw-normal">Antigüedad</dt>
              <dd className="col-7">
                {formatearMeses(activo.antiguedad_meses)}
              </dd>
            </dl>
          </div>
        </div>

        <hr />

        <div className="row text-center g-2">
          <div className="col-4">
            <div className="indicador">
              <div className="indicador-valor">
                {activo.total_mantenimientos}
              </div>
              <div className="indicador-etiqueta">Mantenimientos</div>
            </div>
          </div>
          <div className="col-4">
            <div className="indicador">
              <div className="indicador-valor">
                {activo.total_componentes_criticos}
              </div>
              <div className="indicador-etiqueta">Piezas críticas</div>
            </div>
          </div>
          <div className="col-4">
            <div className="indicador">
              <div className="indicador-valor">
                {formatearMoneda(costos.costo_total)}
              </div>
              <div className="indicador-etiqueta">Invertido</div>
            </div>
          </div>
        </div>

        {ultimoMantenimiento && (
          <p className="text-muted small mb-0 mt-3">
            Última intervención:{" "}
            {formatearFecha(ultimoMantenimiento.fecha_intervencion)} —{" "}
            {ultimoMantenimiento.tipo_display},{" "}
            {ultimoMantenimiento.descripcion}
          </p>
        )}
        <p className="text-muted small mb-0 mt-1">
          {movimientos.length} movimiento(s) de custodia registrados.
        </p>
      </div>
    </div>
  );
}
