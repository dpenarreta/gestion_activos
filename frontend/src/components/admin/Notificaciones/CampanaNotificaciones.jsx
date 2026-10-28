import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { notificacionesService } from "../../../api/notificacionesService";
import {
  fijarSonido,
  prepararSonido,
  sonarNotificacion,
  sonidoActivado,
} from "../../../utils/sonidoNotificacion";
import { Icon } from "../../common/Icon/Icon";
import "./CampanaNotificaciones.css";

/** Cada cuánto se revisa si llegó algo (sin WebSockets: se consulta). Medio
 * minuto: con sonido, un aviso que tarda un minuto en sonar ya llega tarde. */
const REFRESCO_MS = 30_000;

/** La notificación sin leer más nueva (los id crecen con el tiempo). */
function ultimaSinLeer(recientes) {
  return (recientes ?? [])
    .filter((n) => !n.leida)
    .reduce((maximo, n) => Math.max(maximo, n.id), 0);
}

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
        // Un aria-label sobre un <span> no lo lee ningún lector de pantalla:
        // el punto se ve y el texto oculto se oye (revisión final UX/UI,
        // 28/10/2026).
        <>
          <span className="campana-item__punto" aria-hidden="true" />
          <span className="visually-hidden">Sin leer</span>
        </>
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
  const [conSonido, setConSonido] = useState(sonidoActivado);
  const contenedor = useRef(null);
  const boton = useRef(null);
  // La más nueva ya vista: suena solo lo que llegue después. `null` hasta la
  // primera carga, que no suena (lo pendiente al entrar no es nuevo).
  const vista = useRef(null);

  const cargar = useCallback(() => {
    notificacionesService
      .resumen()
      .then((respuesta) => {
        const ultima = ultimaSinLeer(respuesta.recientes);
        if (vista.current !== null && ultima > vista.current) {
          sonarNotificacion();
        }
        vista.current = Math.max(vista.current ?? 0, ultima);
        setDatos(respuesta);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => prepararSonido(), []);

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
            <button
              type="button"
              className="btn btn-link btn-sm p-0 ms-auto"
              aria-pressed={conSonido}
              aria-label={
                conSonido
                  ? "Silenciar el sonido de las notificaciones"
                  : "Activar el sonido de las notificaciones"
              }
              title={conSonido ? "Sonido activado" : "Sonido silenciado"}
              onClick={() => {
                const nuevo = !conSonido;
                fijarSonido(nuevo);
                setConSonido(nuevo);
                if (nuevo) sonarNotificacion(); // para que oiga cómo suena
              }}
            >
              <Icon name={conSonido ? "volume-up" : "volume-mute"} />
            </button>
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
