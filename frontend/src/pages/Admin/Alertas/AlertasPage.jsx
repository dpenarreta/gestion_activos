import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { alertasService } from "../../../api/alertasService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Alertas.css";

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Alertas" }];

const SEVERIDADES = {
  alta: { clase: "alta", etiqueta: "Atender ya", icono: "exclamation-octagon-fill" },
  media: { clase: "media", etiqueta: "Revisar", icono: "exclamation-triangle-fill" },
  baja: { clase: "baja", etiqueta: "Informativa", icono: "info-circle-fill" },
};

/**
 * Centro de alertas del parque (§19 del documento funcional).
 *
 * Las siete alertas se muestran siempre, incluidas las que están en cero: que
 * una alerta diga «nada pendiente» es información —significa que se revisó—
 * y es distinto de que esté apagada, en cuyo caso no aparece en absoluto.
 *
 * Cada tarjeta enlaza al listado ya filtrado en vez de traerse todos los
 * elementos: la pantalla que resume el estado del parque tiene que abrir
 * rápido, y el trabajo real se hace sobre el listado.
 */
export function AlertasPage() {
  const puedeConfigurar = usePermission("alertas.configurar");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [configurando, setConfigurando] = useState(false);

  const cargar = useCallback(() => {
    setIsLoading(true);
    alertasService
      .resumen()
      .then(setDatos)
      .catch(() => setError("No se pudieron cargar las alertas."))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const conPendientes = datos?.alertas.filter((alerta) => alerta.total > 0) ?? [];
  const resueltas = datos?.alertas.filter((alerta) => alerta.total === 0) ?? [];

  return (
    <div className="alertas-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2>Alertas del parque</h2>
        {puedeConfigurar && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setConfigurando((abierto) => !abierto)}
          >
            {configurando ? "Ocultar configuración" : "Configurar umbrales"}
          </button>
        )}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {configurando && datos && (
        <ConfiguracionPanel
          inicial={datos.configuracion}
          onGuardado={() => {
            setConfigurando(false);
            cargar();
          }}
        />
      )}

      {isLoading && <p className="text-muted">Cargando…</p>}

      {datos && conPendientes.length === 0 && (
        <div className="alert alert-success">
          Ninguna de las alertas activas tiene equipos pendientes hoy.
        </div>
      )}

      {datos && conPendientes.length > 0 && (
        <p className="text-muted">
          {datos.total_alertas} alerta(s) con {datos.total_elementos} situación(es) por atender. Un
          mismo equipo puede aparecer en varias: cada una se resuelve de una forma distinta.
        </p>
      )}

      <div className="alertas-grid">
        {conPendientes.map((alerta) => (
          <TarjetaAlerta key={alerta.tipo} alerta={alerta} />
        ))}
      </div>

      {resueltas.length > 0 && (
        <section className="mt-4">
          <h3 className="h6 text-uppercase text-muted">Sin pendientes</h3>
          <ul className="list-unstyled alertas-resueltas mb-0">
            {resueltas.map((alerta) => (
              <li key={alerta.tipo}>
                <i className="bi bi-check-circle me-2" aria-hidden="true" />
                {alerta.titulo}
                <small className="text-muted ms-2">{alerta.detalle}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TarjetaAlerta({ alerta }) {
  const severidad = SEVERIDADES[alerta.severidad] || SEVERIDADES.baja;

  return (
    <article className={`card alerta-card alerta-card--${severidad.clase}`}>
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start gap-2">
          <div>
            <h3 className="h6 mb-1">
              <i className={`bi bi-${severidad.icono} me-2`} aria-hidden="true" />
              {alerta.titulo}
            </h3>
            <p className="small text-muted mb-0">{alerta.detalle}</p>
          </div>
          <span className="alerta-card__total" aria-label={`${alerta.total} equipos`}>
            {alerta.total}
          </span>
        </div>

        <ul className="list-unstyled alerta-card__muestra">
          {alerta.muestra.map((elemento) => (
            <li key={elemento.clave}>
              <Link to={`/admin/activos/${elemento.id}`}>
                <code className="codigo-barras">{elemento.codigo_barras}</code>
                <span className="alerta-card__nombre">{elemento.nombre}</span>
              </Link>
              <small className="text-muted d-block">{elemento.dato}</small>
            </li>
          ))}
        </ul>

        {/* La muestra es un anticipo, no la lista: el trabajo se hace en el
            listado filtrado, que además permite exportar y ordenar. */}
        <Link to={alerta.destino} className="btn btn-outline-primary btn-sm">
          Ver los {alerta.total}
        </Link>
      </div>
    </article>
  );
}

function ConfiguracionPanel({ inicial, onGuardado }) {
  const [valores, setValores] = useState(inicial);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const umbrales = [
    {
      campo: "dias_sin_asignar",
      etiqueta: "Días en bodega sin asignar",
      ayuda: "Capital inmovilizado, no una urgencia.",
    },
    {
      campo: "dias_reparacion_pendiente",
      etiqueta: "Días en reparación sin cerrar",
      ayuda: "Pasado el plazo, o se atascó o alguien olvidó cerrarla.",
    },
    {
      campo: "dias_sin_actualizacion",
      etiqueta: "Días sin actualizar la ficha",
      ayuda: "No dice que el dato esté mal, dice que nadie lo ha confirmado.",
    },
  ];

  const interruptores = [
    { campo: "avisar_proximos_a_reemplazo", etiqueta: "Equipos próximos a reemplazo" },
    { campo: "avisar_garantias_por_vencer", etiqueta: "Garantías próximas a vencer" },
    { campo: "avisar_demasiadas_reparaciones", etiqueta: "Equipos con demasiadas reparaciones" },
    { campo: "avisar_reparaciones_pendientes", etiqueta: "Reparaciones sin cerrar" },
    { campo: "avisar_custodios_inactivos", etiqueta: "Equipos con custodio inactivo" },
    { campo: "avisar_sin_asignar", etiqueta: "Activos sin asignar" },
    { campo: "avisar_sin_actualizacion", etiqueta: "Fichas sin actualizar" },
  ];

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await alertasService.guardarConfiguracion(valores);
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la configuración."));
      setIsSaving(false);
    }
  }

  return (
    <form className="card mb-4" onSubmit={handleSubmit}>
      <div className="card-body">
        <h3 className="h6 text-uppercase text-muted mb-3">Umbrales de aviso</h3>
        {error && <div className="alert alert-danger">{error}</div>}

        <div className="row g-3 mb-4">
          {umbrales.map(({ campo, etiqueta, ayuda }) => (
            <div className="col-md-4" key={campo}>
              <label className="form-label" htmlFor={`alerta-${campo}`}>
                {etiqueta}
              </label>
              <input
                id={`alerta-${campo}`}
                type="number"
                min="1"
                className="form-control"
                value={valores[campo]}
                onChange={(event) =>
                  setValores({ ...valores, [campo]: Number(event.target.value) })
                }
              />
              <div className="form-text">{ayuda}</div>
            </div>
          ))}
        </div>

        <h3 className="h6 text-uppercase text-muted mb-3">Alertas activas</h3>
        <div className="row g-2 mb-3">
          {interruptores.map(({ campo, etiqueta }) => (
            <div className="col-md-6" key={campo}>
              <div className="form-check">
                <input
                  id={`alerta-${campo}`}
                  type="checkbox"
                  className="form-check-input"
                  checked={valores[campo]}
                  onChange={(event) =>
                    setValores({ ...valores, [campo]: event.target.checked })
                  }
                />
                <label className="form-check-label" htmlFor={`alerta-${campo}`}>
                  {etiqueta}
                </label>
              </div>
            </div>
          ))}
        </div>
        <p className="form-text">
          {/* Apagar es preferible a ignorar: una alerta que no se puede apagar
              acaba siendo ruido que se ignora en bloque, y con ella el resto. */}
          Una alerta apagada deja de calcularse y no aparece en esta pantalla.
        </p>

        <button type="submit" className="btn btn-primary btn-sm" disabled={isSaving}>
          {isSaving ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </form>
  );
}
