import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { notificacionesService } from "../../../api/notificacionesService";
import { Icon } from "../../common/Icon/Icon";
import "./CampanaNotificaciones.css";

/** Cada cuánto se revisa si llegó algo (sin WebSockets: se consulta). */
const REFRESCO_MS = 60_000;

/** «hace 5 min», «hace 3 h», «ayer», o la fecha. */
export function haceCuanto(fecha, ahora = new Date()) {
  const minutos = Math.floor((ahora - new Date(fecha)) / 60_000);
  if (minutos < 1) return "ahora";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  if (horas < 48) return "ayer";
  return new Date(fecha).toLocaleDateString("es-EC", {
    day: "numeric",
    month: "short",
  });
}

/** Una notificación: el módulo que la manda, el resumen y a dónde lleva. */
export function ElementoNotificacion({ notificacion, onAbrir }) {
  const contenido = (
    <>
      <span className="campana-item__icono" aria-hidden="true">
        <Icon name={notificacion.icono} />
      </span>
      <span className="campana-item__texto">
        <span className="campana-item__modulo">
          {notificacion.modulo_nombre}
        </span>
        <strong className="campana-item__titulo">{notificacion.titulo}</strong>
        {notificacion.resumen && (
          <span className="campana-item__resumen">{notificacion.resumen}</span>
        )}
        <span className="campana-item__fecha">
          {haceCuanto(notificacion.created_at)}
        </span>
      </span>
      {!notificacion.leida && (
        <span className="campana-item__punto" aria-label="Sin leer" />
      )}
    </>
  );
  const clase = `campana-item${notificacion.leida ? "" : " campana-item--nueva"}`;
  return (
    <button
      type="button"
      className={clase}
      onClick={() => onAbrir(notificacion)}
    >
      {contenido}
    </button>
  );
}

/**
 * La campana de la barra superior. Muestra cuántas notificaciones hay sin
 * leer y, al abrirla, las más recientes: de qué módulo vienen, un resumen y
 * un clic que lleva directo a lo que la originó (y la marca como leída).
 */
export function CampanaNotificaciones() {
  const navigate = useNavigate();
  const [abierta, setAbierta] = useState(false);
  const [datos, setDatos] = useState({ no_leidas: 0, recientes: [] });
  const [error, setError] = useState(false);
  const contenedor = useRef(null);
  const boton = useRef(null);

  const cargar = useCallback(() => {
    notificacionesService
      .resumen()
      .then((respuesta) => {
        setDatos(respuesta);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, REFRESCO_MS);
    // Al volver a la pestaña se revisa enseguida, sin esperar el minuto.
    const alVolver = () => {
      if (document.visibilityState === "visible") cargar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [cargar]);

  useEffect(() => {
    if (!abierta) return undefined;
    function fuera(evento) {
      if (!contenedor.current?.contains(evento.target)) setAbierta(false);
    }
    function tecla(evento) {
      if (evento.key === "Escape") {
        setAbierta(false);
        boton.current?.focus();
      }
    }
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierta]);

  async function abrir(notificacion) {
    setAbierta(false);
    if (!notificacion.leida) {
      setDatos((actual) => ({
        no_leidas: Math.max(0, actual.no_leidas - 1),
        recientes: actual.recientes.map((n) =>
          n.id === notificacion.id ? { ...n, leida: true } : n,
        ),
      }));
      notificacionesService.leer(notificacion.id).catch(() => cargar());
    }
    if (notificacion.enlace) navigate(notificacion.enlace);
  }

  async function leerTodas() {
    try {
      await notificacionesService.leerTodas();
    } finally {
      cargar();
    }
  }

  const etiqueta =
    datos.no_leidas > 0
      ? `Notificaciones: ${datos.no_leidas} sin leer`
      : "Notificaciones";

  return (
    <div className="campana" ref={contenedor}>
      <button
        type="button"
        ref={boton}
        className="mz-icon-btn"
        aria-label={etiqueta}
        title={etiqueta}
        aria-expanded={abierta}
        aria-haspopup="dialog"
        onClick={() => {
          if (!abierta) cargar();
          setAbierta((valor) => !valor);
        }}
      >
        <Icon name={datos.no_leidas > 0 ? "bell-fill" : "bell"} />
        {datos.no_leidas > 0 && (
          <span className="campana__contador" aria-hidden="true">
            {datos.no_leidas > 99 ? "99+" : datos.no_leidas}
          </span>
        )}
      </button>

      {abierta && (
        <div
          className="campana__panel"
          role="dialog"
          aria-label="Notificaciones"
        >
          <div className="campana__cabecera">
            <strong>Notificaciones</strong>
            {datos.no_leidas > 0 && (
              <button
                type="button"
                className="btn btn-link btn-sm p-0"
                onClick={leerTodas}
              >
                Marcar todas como leídas
              </button>
            )}
          </div>
          <div className="campana__lista">
            {error && datos.recientes.length === 0 ? (
              <p className="campana__vacio">
                No se pudieron cargar las notificaciones.
              </p>
            ) : datos.recientes.length === 0 ? (
              <p className="campana__vacio">
                <Icon name="bell-slash" />
                No tiene notificaciones.
              </p>
            ) : (
              datos.recientes.map((n) => (
                <ElementoNotificacion
                  key={n.id}
                  notificacion={n}
                  onAbrir={abrir}
                />
              ))
            )}
          </div>
          <Link
            className="campana__pie"
            to="/admin/notificaciones"
            onClick={() => setAbierta(false)}
          >
            Ver todas las notificaciones
          </Link>
        </div>
      )}
    </div>
  );
}
