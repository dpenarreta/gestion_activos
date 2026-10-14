import { useState } from "react";
import { Link } from "react-router-dom";

import { activosService } from "../../../api/activosService";
import { Icon } from "../../../components/common/Icon/Icon";
import { EscanerCamara } from "../../../components/activos/EscanerCamara/EscanerCamara";
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
  const [camaraAbierta, setCamaraAbierta] = useState(false);

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
      <div className="mz-view-head">
        <div>
          <h2>Consulta por escáner</h2>
          <p className="mz-desc">
            Dispare la lectora sobre la etiqueta del equipo. También funciona
            escribiendo el código o el número de serie del fabricante, o leyendo
            con la cámara si está en el teléfono.
          </p>
        </div>
        {/* La cámara es el camino para las etiquetas en QR, que una pistola
            láser no puede leer. Va detrás de un botón y no abierta de entrada:
            en bodega se escanea con la pistola, y pedir permiso de cámara a
            quien no la va a usar es ruido —y en el escritorio, una ventana
            negra—. */}
        <div className="mz-view-actions">
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() => setCamaraAbierta((abierta) => !abierta)}
          >
            <Icon name="camera" />{" "}
            {camaraAbierta ? "Cerrar la cámara" : "Escanear con la cámara"}
          </button>
        </div>
      </div>

      {camaraAbierta && (
        <EscanerCamara
          onCerrar={() => setCamaraAbierta(false)}
          onLeer={(codigo) => {
            setCamaraAbierta(false);
            handleEscanear(codigo);
          }}
        />
      )}

      <EscanerInput
        className="escaner-page__campo mb-4"
        placeholder="Esperando lectura…"
        onEscanear={handleEscanear}
        enfocarAlMontar
        mantenerFoco
        disabled={isLoading}
      />

      {error && (
        <div className="mz-alert mz-alert--warn" role="alert">
          <Icon name="exclamation-triangle" />
          {error}
        </div>
      )}

      {avisoLector && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="info-circle" />
          <div>
            <strong>Revise la configuración del lector.</strong>{" "}
            {avisoLector.mensaje}
          </div>
        </div>
      )}

      {ficha && <ResultadoEscaneo ficha={ficha} />}

      {recientes.length > 1 && (
        <section className="mz-section mt-4">
          <h4>Escaneos recientes</h4>
          <ul className="list-unstyled d-flex flex-wrap gap-2 mb-0">
            {recientes.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/admin/activos/${item.id}`}
                  className="btn btn-outline-secondary btn-sm"
                >
                  <code className="mz-mono">{item.codigo_barras}</code> ·{" "}
                  {item.nombre}
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
    <section className="mz-card escaner-resultado">
      <div className="mz-card-head flex-wrap gap-2">
        <div>
          <h3>{activo.nombre}</h3>
          <div className="activo-detalle__identidad mt-1">
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
        <div className="mz-actions m-0">
          <Link
            to={`/admin/activos/${activo.id}`}
            className="btn btn-outline-primary btn-sm"
          >
            <Icon name="card-list" /> Ver ficha completa
          </Link>
          {/* No se ofrece sobre un equipo que ya salió del parque: el backend
              rechaza la intervención, y el estado está ahí al lado para que
              se vea por qué. */}
          {puedeRegistrarMantenimiento && activo.esta_operativo && (
            <Link
              to={`/admin/mantenimientos/new?activo=${activo.id}`}
              className="btn btn-primary btn-sm"
            >
              <Icon name="tools" /> Registrar mantenimiento
            </Link>
          )}
        </div>
      </div>

      <div className="mz-card-body">
        <AlertaRenovacion renovacion={activo.renovacion} />

        <dl className="mz-kv-grid activo-datos">
          <div className="mz-kv">
            <dt className="mz-kv-label">Responsable</dt>
            <dd>
              {activo.responsables_resumen || (
                <span className="mz-faint">Sin asignar</span>
              )}
            </dd>
          </div>
          <div className="mz-kv">
            <dt className="mz-kv-label">Equipo</dt>
            <dd>
              {activo.marca} {activo.modelo}
            </dd>
          </div>
          <div className="mz-kv">
            <dt className="mz-kv-label">Área</dt>
            <dd>{activo.departamento_nombre}</dd>
          </div>
          <div className="mz-kv">
            <dt className="mz-kv-label">Serie</dt>
            <dd>
              <code className="mz-mono">{activo.numero_serie}</code>
            </dd>
          </div>
          <div className="mz-kv">
            <dt className="mz-kv-label">Ciudad</dt>
            <dd>{activo.ciudad || "—"}</dd>
          </div>
          <div className="mz-kv">
            <dt className="mz-kv-label">Antigüedad</dt>
            <dd>{formatearMeses(activo.antiguedad_meses)}</dd>
          </div>
        </dl>

        <div className="activo-indicadores mt-3">
          <div className="indicador">
            <div className="indicador-valor">{activo.total_mantenimientos}</div>
            <div className="indicador-etiqueta">Mantenimientos</div>
          </div>
          <div className="indicador">
            <div className="indicador-valor">
              {activo.total_componentes_criticos}
            </div>
            <div className="indicador-etiqueta">Piezas críticas</div>
          </div>
          <div className="indicador">
            <div className="indicador-valor">
              {formatearMoneda(costos.costo_total)}
            </div>
            <div className="indicador-etiqueta">Invertido</div>
          </div>
        </div>

        {ultimoMantenimiento && (
          <p className="mz-faint mz-small mb-0 mt-3">
            Última intervención:{" "}
            {formatearFecha(ultimoMantenimiento.fecha_intervencion)} —{" "}
            {ultimoMantenimiento.tipo_display},{" "}
            {ultimoMantenimiento.descripcion}
          </p>
        )}
        <p className="mz-faint mz-small mb-0 mt-1">
          {movimientos.length} movimiento(s) de custodia registrados.
        </p>
      </div>
    </section>
  );
}
