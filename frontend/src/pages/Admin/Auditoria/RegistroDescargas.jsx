import { useCallback, useEffect, useState } from "react";

import { useSearchParams } from "react-router-dom";

import { descargasService } from "../../../api/descargasService";
import { nominaService } from "../../../api/nominaService";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { VisorPdf } from "../../../components/common/VisorPdf/VisorPdf";
import { usePermission } from "../../../hooks/usePermission";
import { descargarBlob } from "../../../utils/descargas";
import { mensajeDeError } from "../../../utils/errores";

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

function tamano(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** De qué rol de pagos se trata (no se guarda copia: se vuelve a generar). */
function DeQueRol({ referencia }) {
  if (referencia?.tipo === "rol_pagos") {
    return (
      <>
        Rol de pagos de {MESES[referencia.mes - 1]} {referencia.anio} · código{" "}
        {referencia.codigo}
      </>
    );
  }
  if (referencia?.tipo === "rol_pagos_auditado") {
    const meses = (referencia.periodos ?? [])
      .map(([anio, mes]) => `${MESES[mes - 1]} ${anio}`)
      .join(", ");
    return (
      <>
        Rol auditado · código {referencia.codigo} · {meses}
      </>
    );
  }
  if (referencia?.tipo === "rol_pagos_masivo") {
    return (
      <>
        Roles de pagos de {referencia.area} · {MESES[referencia.mes - 1]}{" "}
        {referencia.anio} ({referencia.incluidos} PDF)
      </>
    );
  }
  return null;
}

/** Volver a generar un rol de pagos desde nómina: pide la contraseña de
 * quien lo abre (`roles_pago.historial`), como el historial por empleado. */
function RegenerarRol({ referencia, onVer }) {
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState("");
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);

  async function generar(e) {
    e.preventDefault();
    setTrabajando(true);
    setError(null);
    try {
      const blob = await nominaService.rolDelHistorial({
        codigo: referencia.codigo,
        anio: referencia.anio,
        mes: referencia.mes,
        password: clave,
      });
      setAbierto(false);
      setClave("");
      onVer(
        blob,
        `rol-de-pagos-${referencia.codigo}-${referencia.anio}-${String(referencia.mes).padStart(2, "0")}.pdf`,
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo generar."));
    } finally {
      setTrabajando(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        onClick={() => setAbierto(true)}
      >
        <Icon name="arrow-repeat" /> Volver a generar
      </button>
    );
  }
  return (
    <form className="descargas-regenerar" onSubmit={generar}>
      <input
        type="password"
        className="form-control form-control-sm"
        aria-label="Confirme su contraseña"
        placeholder="Su contraseña"
        autoComplete="current-password"
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        required
      />
      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={trabajando || !clave}
      >
        Ver
      </button>
      <button
        type="button"
        className="btn btn-link btn-sm"
        onClick={() => setAbierto(false)}
      >
        Cancelar
      </button>
      {error && <small className="text-danger d-block w-100">{error}</small>}
    </form>
  );
}

const VACIOS = { q: "", desde: "", hasta: "", modulo: "" };

/**
 * Auditoría → Descargas de archivos (`auditoria.descargas`, 26/10/2026): cada
 * vez que alguien guardó un archivo del sistema en su equipo, quién fue, qué
 * archivo, cuándo, desde qué IP y la copia exacta de lo que guardó. Los roles
 * de pagos no guardan copia: se vuelven a generar desde nómina.
 */
export function RegistroDescargas() {
  const verRol = usePermission("roles_pago.historial");
  const [parametros] = useSearchParams();
  const inicial = {
    ...VACIOS,
    desde: parametros.get("desde") ?? "",
    hasta: parametros.get("hasta") ?? "",
  };
  const [borrador, setBorrador] = useState(inicial);
  const [filtros, setFiltros] = useState(inicial);
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState(null);
  const [modulos, setModulos] = useState([]);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [viendo, setViendo] = useState(null);
  const [abierto, setAbierto] = useState(null);

  useEffect(() => {
    descargasService
      .modulos()
      .then(setModulos)
      .catch(() => setModulos([]));
  }, []);

  const cargar = useCallback(() => {
    setCargando(true);
    const params = { page: pagina };
    Object.entries(filtros).forEach(([clave, valor]) => {
      if (valor) params[clave] = valor;
    });
    descargasService
      .listar(params)
      .then((d) => {
        setDatos(d);
        setError(null);
      })
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el registro.")),
      )
      .finally(() => setCargando(false));
  }, [filtros, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function aplicar(e) {
    e.preventDefault();
    setPagina(1);
    setFiltros(borrador);
  }

  function limpiar() {
    setBorrador(VACIOS);
    setPagina(1);
    setFiltros(VACIOS);
  }

  async function bajarCopia(d) {
    setError(null);
    try {
      descargarBlob(await descargasService.copia(d.id), d.nombre);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo abrir la copia."));
    }
  }

  async function exportar() {
    setError(null);
    try {
      const params = {};
      Object.entries(filtros).forEach(([clave, valor]) => {
        if (valor) params[clave] = valor;
      });
      const hoy = new Date().toISOString().slice(0, 10);
      descargarBlob(
        await descargasService.exportar(params),
        `descargas-${hoy}.xlsx`,
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo exportar."));
    }
  }

  const filas = datos?.results ?? [];
  const total = datos?.count ?? 0;

  return (
    <div className="auditoria-page">
      <p className="mz-small mz-faint mb-0">
        Cada vez que una persona guarda en su equipo un archivo del sistema:
        quién, qué archivo, cuándo y desde qué IP, con la copia exacta de lo que
        guardó. Ver un archivo en pantalla no cuenta. Los roles de pagos no
        guardan copia (sus términos dicen que no se guardan): se vuelven a
        generar desde nómina. Las copias se conservan un año.
      </p>
      <div className="mz-actions justify-content-end">
        <button
          type="button"
          className="btn btn-exportar btn-sm"
          onClick={exportar}
          disabled={total === 0}
        >
          <Icon name="file-earmark-spreadsheet" /> Exportar ({total})
        </button>
      </div>

      <form
        className="mz-filter-bar auditoria-filtros"
        onSubmit={aplicar}
        role="search"
      >
        <div>
          <label htmlFor="descargas-q" className="form-label">
            Persona, archivo o IP
          </label>
          <input
            id="descargas-q"
            className="form-control form-control-sm"
            value={borrador.q}
            onChange={(e) => setBorrador({ ...borrador, q: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="descargas-modulo" className="form-label">
            Parte del sistema
          </label>
          <select
            id="descargas-modulo"
            className="form-select form-select-sm"
            value={borrador.modulo}
            onChange={(e) =>
              setBorrador({ ...borrador, modulo: e.target.value })
            }
          >
            <option value="">Todas</option>
            {modulos.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="descargas-desde" className="form-label">
            Desde
          </label>
          <input
            id="descargas-desde"
            type="date"
            className="form-control form-control-sm"
            value={borrador.desde}
            onChange={(e) =>
              setBorrador({ ...borrador, desde: e.target.value })
            }
          />
        </div>
        <div>
          <label htmlFor="descargas-hasta" className="form-label">
            Hasta
          </label>
          <input
            id="descargas-hasta"
            type="date"
            className="form-control form-control-sm"
            value={borrador.hasta}
            onChange={(e) =>
              setBorrador({ ...borrador, hasta: e.target.value })
            }
          />
        </div>
        <div className="auditoria-filtros__acciones">
          <button type="submit" className="btn btn-primary btn-sm">
            <Icon name="funnel" /> Filtrar
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={limpiar}
          >
            Limpiar
          </button>
        </div>
      </form>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="table-responsive">
        <table className="table table-sm align-middle mb-0">
          <thead>
            <tr>
              <th>Fecha y hora</th>
              <th>Persona</th>
              <th>Archivo</th>
              <th>IP</th>
              <th>Copia</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((d) => (
              <tr key={d.id}>
                <td className="text-nowrap">
                  {d.momento.fecha}
                  <small className="d-block mz-faint">{d.momento.hora}</small>
                </td>
                <td>
                  <strong>{d.usuario.nombre}</strong>
                  <small className="d-block mz-faint">{d.usuario.correo}</small>
                </td>
                <td>
                  <span className="descargas-archivo">{d.nombre}</span>
                  <small className="d-block mz-faint">
                    {d.modulo} · {tamano(d.tamano)}
                    {d.referencia?.tipo && (
                      <>
                        {" · "}
                        <DeQueRol referencia={d.referencia} />
                      </>
                    )}
                  </small>
                  <small className="d-block">
                    {d.verificada ? (
                      <span className="text-success">
                        <Icon name="patch-check" /> Comprobado: es lo que
                        entregó el servidor
                      </span>
                    ) : (
                      <span className="mz-faint">
                        <Icon name="patch-question" /> No comprobado con el
                        servidor
                      </span>
                    )}{" "}
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 align-baseline"
                      aria-expanded={abierto === d.id}
                      onClick={() => setAbierto(abierto === d.id ? null : d.id)}
                    >
                      {abierto === d.id ? "Menos" : "Detalle"}
                    </button>
                  </small>
                  {abierto === d.id && (
                    <dl className="descargas-detalle">
                      <dt>Pantalla</dt>
                      <dd>{d.pantalla || "—"}</dd>
                      <dt>Entregado por</dt>
                      <dd>{d.origen || "—"}</dd>
                      <dt>Navegador</dt>
                      <dd>{d.navegador || "—"}</dd>
                      <dt>Huella SHA-256</dt>
                      <dd className="mz-mono">{d.sha256 || "—"}</dd>
                    </dl>
                  )}
                </td>
                <td className="text-nowrap">{d.ip || "—"}</td>
                <td>
                  {d.tiene_copia ? (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      aria-label={`Descargar la copia de ${d.nombre}`}
                      onClick={() => bajarCopia(d)}
                    >
                      <Icon name="download" /> Copia
                    </button>
                  ) : (
                    <>
                      <small className="mz-faint d-block">{d.sin_copia}</small>
                      {verRol && d.referencia?.tipo === "rol_pagos" && (
                        <RegenerarRol
                          referencia={d.referencia}
                          onVer={(blob, nombre) => setViendo({ blob, nombre })}
                        />
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!cargando && filas.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={5}>Sin descargas para esos filtros</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {cargando ? (
        <div className="mz-pager">
          <span className="mz-small mz-faint">Cargando…</span>
        </div>
      ) : (
        <Paginacion
          total={total}
          pagina={pagina}
          hasNext={Boolean(datos?.next)}
          hasPrevious={Boolean(datos?.previous)}
          onCambiarPagina={setPagina}
          etiqueta="descarga(s)"
        />
      )}

      {viendo && (
        <VisorPdf
          titulo="Rol de pagos vuelto a generar"
          blob={viendo.blob}
          nombreArchivo={viendo.nombre}
          onCerrar={() => setViendo(null)}
        />
      )}
    </div>
  );
}
