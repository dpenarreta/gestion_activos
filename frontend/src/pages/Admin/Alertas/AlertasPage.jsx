import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { alertasService } from "../../../api/alertasService";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import "./Alertas.css";

const SEVERIDADES = {
  alta: {
    clase: "alta",
    etiqueta: "Atender ya",
    icono: "exclamation-octagon-fill",
    pill: "mz-pill--bad",
  },
  media: {
    clase: "media",
    etiqueta: "Revisar",
    icono: "exclamation-triangle-fill",
    pill: "mz-pill--warn",
  },
  baja: {
    clase: "baja",
    etiqueta: "Informativa",
    icono: "info-circle-fill",
    pill: "mz-pill--neutral",
  },
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
  const puedeConfigurar = usePermission("notificaciones.configurar");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

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

  const conPendientes =
    datos?.alertas.filter((alerta) => alerta.total > 0) ?? [];
  const resueltas = datos?.alertas.filter((alerta) => alerta.total === 0) ?? [];

  return (
    <div className="alertas-page">
      <div className="mz-view-head">
        <div>
          <h2>Alertas del parque</h2>
          <p className="mz-desc">
            Lo que pide atención hoy. Cada alerta lleva al listado ya filtrado,
            donde se resuelve.
          </p>
        </div>
        {puedeConfigurar && (
          <div className="mz-view-actions">
            {/* La configuración es general del sistema: vive en
                Configuración → Notificaciones, junto a los demás avisos. */}
            <Link
              to="/admin/configuracion/notificaciones/alertas"
              className="btn btn-outline-secondary btn-sm"
            >
              <Icon name="sliders" /> Configurar alertas
            </Link>
          </div>
        )}
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {isLoading && <div className="mz-empty">Cargando…</div>}

      {datos && conPendientes.length === 0 && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          Ninguna de las alertas activas tiene equipos pendientes hoy.
        </div>
      )}

      {datos && conPendientes.length > 0 && (
        <p className="mz-faint">
          {datos.total_alertas} alerta(s) con {datos.total_elementos}{" "}
          situación(es) por atender. Un mismo equipo puede aparecer en varias:
          cada una se resuelve de una forma distinta.
        </p>
      )}

      <div className="alertas-grid">
        {conPendientes.map((alerta) => (
          <TarjetaAlerta key={alerta.tipo} alerta={alerta} />
        ))}
      </div>

      {resueltas.length > 0 && (
        <section className="mz-card alertas-resueltas">
          <div className="mz-card-head">
            <h3>Sin pendientes</h3>
          </div>
          {resueltas.map((alerta) => (
            <div className="mz-row" key={alerta.tipo}>
              <span className="mz-row-ic alertas-resueltas__ic">
                <Icon name="check-circle" />
              </span>
              <span className="mz-row-info">
                <strong>{alerta.titulo}</strong>
                <span>{alerta.detalle}</span>
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function TarjetaAlerta({ alerta }) {
  const severidad = SEVERIDADES[alerta.severidad] || SEVERIDADES.baja;

  return (
    <article className={`mz-card alerta-card alerta-card--${severidad.clase}`}>
      <div className="mz-card-head alerta-card__cabecera">
        <div className="min-w-0">
          <h3>
            <Icon name={severidad.icono} className="alerta-card__icono" />
            {alerta.titulo}
          </h3>
          <span className={`mz-pill ${severidad.pill}`}>
            {severidad.etiqueta}
          </span>
        </div>
        <span
          className="alerta-card__total"
          aria-label={`${alerta.total} equipos`}
        >
          {alerta.total}
        </span>
      </div>

      <p className="mz-faint mz-small alerta-card__detalle">{alerta.detalle}</p>

      <div className="alerta-card__muestra">
        {alerta.muestra.map((elemento) => (
          <Link
            key={elemento.clave}
            to={`/admin/activos/${elemento.id}`}
            className="mz-row"
          >
            <span className="mz-row-info">
              <strong>{elemento.nombre}</strong>
              <span>{elemento.dato}</span>
            </span>
            <span className="mz-row-end">
              <code className="mz-code">{elemento.codigo_barras}</code>
            </span>
          </Link>
        ))}
      </div>

      {/* La muestra es un anticipo, no la lista: el trabajo se hace en el
          listado filtrado, que además permite exportar y ordenar. */}
      <div className="mz-card-body">
        <Link to={alerta.destino} className="btn btn-outline-primary btn-sm">
          Ver los {alerta.total}
        </Link>
      </div>
    </article>
  );
}
