import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { alertasService } from "../../../api/alertasService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Alertas.css";

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Alertas" }];

const SEVERIDADES = {
  alta: {
    clase: "alta",
    etiqueta: "Atender ya",
    icono: "exclamation-octagon-fill",
  },
  media: {
    clase: "media",
    etiqueta: "Revisar",
    icono: "exclamation-triangle-fill",
  },
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

  const conPendientes =
    datos?.alertas.filter((alerta) => alerta.total > 0) ?? [];
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
            {configurando ? "Ocultar configuración" : "Configurar alertas"}
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
              <i
                className={`bi bi-${severidad.icono} me-2`}
                aria-hidden="true"
              />
              {alerta.titulo}
            </h3>
            <p className="small text-muted mb-0">{alerta.detalle}</p>
          </div>
          <span
            className="alerta-card__total"
            aria-label={`${alerta.total} equipos`}
          >
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
    {
      campo: "avisar_proximos_a_reemplazo",
      etiqueta: "Equipos próximos a reemplazo",
    },
    {
      campo: "avisar_garantias_por_vencer",
      etiqueta: "Garantías próximas a vencer",
    },
    {
      campo: "avisar_demasiadas_reparaciones",
      etiqueta: "Equipos con demasiadas reparaciones",
    },
    {
      campo: "avisar_reparaciones_pendientes",
      etiqueta: "Reparaciones sin cerrar",
    },
    {
      campo: "avisar_custodios_inactivos",
      etiqueta: "Equipos con custodio inactivo",
    },
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
                  setValores({
                    ...valores,
                    [campo]: Number(event.target.value),
                  })
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

        <hr className="my-4" />
        <NotificacionesPanel valores={valores} setValores={setValores} />

        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={isSaving}
        >
          {isSaving ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </form>
  );
}

const DIAS_SEMANA = [
  [0, "Lunes"],
  [1, "Martes"],
  [2, "Miércoles"],
  [3, "Jueves"],
  [4, "Viernes"],
  [5, "Sábado"],
  [6, "Domingo"],
];

/**
 * Envío del resumen por correo (§19).
 *
 * Solo aparecen como posibles destinatarios los usuarios que ya pueden abrir
 * esta pantalla: el correo enlaza a los listados del parque, y avisar a
 * alguien de algo que no puede consultar es filtrarle información. Sus
 * direcciones llegan enmascaradas desde el backend — aquí hace falta
 * reconocer a la persona, no copiar su correo.
 */
function NotificacionesPanel({ valores, setValores }) {
  const [candidatos, setCandidatos] = useState([]);
  const [envios, setEnvios] = useState([]);
  const [prueba, setPrueba] = useState(null);
  const [enviandoPrueba, setEnviandoPrueba] = useState(false);

  useEffect(() => {
    alertasService
      .destinatariosDisponibles()
      .then(setCandidatos)
      .catch(() => setCandidatos([]));
    alertasService
      .historialEnvios()
      .then(setEnvios)
      .catch(() => setEnvios([]));
  }, []);

  const seleccionados = valores.destinatarios ?? [];

  function alternarDestinatario(id) {
    setValores({
      ...valores,
      destinatarios: seleccionados.includes(id)
        ? seleccionados.filter((elegido) => elegido !== id)
        : [...seleccionados, id],
    });
  }

  async function handlePrueba() {
    setEnviandoPrueba(true);
    setPrueba(null);
    try {
      const respuesta = await alertasService.enviarPrueba();
      setPrueba({ ok: true, texto: respuesta.detail });
    } catch (err) {
      setPrueba({
        ok: false,
        texto: mensajeDeError(err, "No se pudo enviar el correo de prueba."),
      });
    } finally {
      setEnviandoPrueba(false);
    }
  }

  return (
    <section>
      <h3 className="h6 text-uppercase text-muted mb-3">
        Notificaciones por correo
      </h3>

      <div className="form-check form-switch mb-3">
        <input
          id="alerta-notificaciones_activas"
          type="checkbox"
          className="form-check-input"
          checked={valores.notificaciones_activas}
          onChange={(event) =>
            setValores({
              ...valores,
              notificaciones_activas: event.target.checked,
            })
          }
        />
        <label
          className="form-check-label"
          htmlFor="alerta-notificaciones_activas"
        >
          Enviar el resumen de alertas por correo
        </label>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-md-4">
          <label className="form-label" htmlFor="alerta-frecuencia">
            Frecuencia
          </label>
          <select
            id="alerta-frecuencia"
            className="form-select"
            value={valores.frecuencia}
            onChange={(event) =>
              setValores({ ...valores, frecuencia: event.target.value })
            }
          >
            <option value="diaria">Diaria</option>
            <option value="semanal">Semanal</option>
          </select>
        </div>

        {valores.frecuencia === "semanal" && (
          <div className="col-md-4">
            <label className="form-label" htmlFor="alerta-dia_envio_semanal">
              Día del envío
            </label>
            <select
              id="alerta-dia_envio_semanal"
              className="form-select"
              value={valores.dia_envio_semanal}
              onChange={(event) =>
                setValores({
                  ...valores,
                  dia_envio_semanal: Number(event.target.value),
                })
              }
            >
              {DIAS_SEMANA.map(([numero, nombre]) => (
                <option key={numero} value={numero}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="form-check mb-3">
        <input
          id="alerta-omitir_si_no_hay_pendientes"
          type="checkbox"
          className="form-check-input"
          checked={valores.omitir_si_no_hay_pendientes}
          onChange={(event) =>
            setValores({
              ...valores,
              omitir_si_no_hay_pendientes: event.target.checked,
            })
          }
        />
        <label
          className="form-check-label"
          htmlFor="alerta-omitir_si_no_hay_pendientes"
        >
          No enviar los días sin nada pendiente
        </label>
        <div className="form-text">
          {/* El correo que llega todos los días diciendo lo mismo deja de
              leerse, y arrastra consigo al que sí traía algo. */}
          Apagado, llega también el correo que dice «revisado, nada pendiente».
        </div>
      </div>

      <fieldset className="mb-3">
        <legend className="form-label">Destinatarios</legend>
        {candidatos.length === 0 ? (
          <p className="form-text mb-0">
            Ningún usuario puede recibir el resumen todavía: hace falta que
            tenga el permiso «Ver el centro de alertas» y un correo registrado.
          </p>
        ) : (
          <div className="row g-2">
            {candidatos.map((candidato) => (
              <div className="col-md-6" key={candidato.id}>
                <div className="form-check">
                  <input
                    id={`destinatario-${candidato.id}`}
                    type="checkbox"
                    className="form-check-input"
                    checked={seleccionados.includes(candidato.id)}
                    onChange={() => alternarDestinatario(candidato.id)}
                  />
                  <label
                    className="form-check-label"
                    htmlFor={`destinatario-${candidato.id}`}
                  >
                    {candidato.nombre}{" "}
                    <small className="text-muted">{candidato.correo}</small>
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="form-text">
          Solo aparecen quienes pueden ver las alertas: el correo enlaza a los
          listados del parque. Las direcciones van en copia oculta.
        </div>
      </fieldset>

      <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={handlePrueba}
          disabled={enviandoPrueba}
        >
          {enviandoPrueba ? "Enviando…" : "Enviar una prueba a mi correo"}
        </button>
        {valores.ultimo_envio && (
          <small className="text-muted">
            Último resumen enviado el {valores.ultimo_envio}.
          </small>
        )}
      </div>

      {prueba && (
        <div
          className={`alert ${prueba.ok ? "alert-success" : "alert-danger"} py-2`}
        >
          {prueba.texto}
        </div>
      )}

      {envios.length > 0 && (
        <details className="mt-2">
          <summary className="small text-muted">Últimos envíos</summary>
          <ul className="list-unstyled small mt-2 mb-0">
            {envios.map((envio) => (
              <li key={envio.id} className="mb-1">
                <span className="text-muted">
                  {new Date(envio.created_at).toLocaleString()}
                </span>{" "}
                — {envio.resultado_display}
                {envio.resultado === "enviado"
                  ? ` a ${envio.total_destinatarios} destinatario(s)`
                  : ""}
                {/* El motivo es lo que distingue un día tranquilo de un envío
                    que falló: sin él, ambos se ven igual desde fuera. */}
                {envio.motivo && (
                  <span className="text-muted"> · {envio.motivo}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
