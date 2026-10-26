import { useEffect, useState } from "react";

import { nominaService } from "../../api/nominaService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import "./Institucional.css";
import { AdjuntosObservacion } from "./AdjuntosObservacion";
import { DescargaMasivaRolPagos } from "./DescargaMasivaRolPagos";
import { HabilitadosRolPagos } from "./HabilitadosRolPagos";
import { ConstanciaRol } from "./ConstanciaRol";
import { SeguimientoRolPagos } from "./SeguimientoRolPagos";
import { HistorialRolPagos } from "./HistorialRolPagos";
import { VisorRolPagos } from "./VisorRolPagos";
import { AuditadoRolPagos } from "./AuditadoRolPagos";

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

/** Si la consulta respondió que no hay rol de ese mes. */
function esSinRol(err) {
  return err?.response?.status === 404;
}

/** El detalle de un error que llega como blob (la consulta pide un PDF). */
async function errorDeBlob(err, porDefecto) {
  const datos = err?.response?.data;
  if (datos instanceof Blob) {
    try {
      const texto =
        typeof datos.text === "function"
          ? await datos.text()
          : await new Promise((resolver, rechazar) => {
              const lector = new FileReader();
              lector.onload = () => resolver(lector.result);
              lector.onerror = rechazar;
              lector.readAsText(datos);
            });
      const json = JSON.parse(texto);
      const detalle =
        json?.error?.message ??
        json?.detail ??
        Object.values(json?.error?.details ?? {}).flat()[0];
      if (detalle) return String(detalle);
    } catch {
      /* No era JSON: el mensaje por defecto. */
    }
  }
  return mensajeDeError(err, porDefecto);
}

function Ventana({ titulo, onCerrar, children }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>{titulo}</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body">{children}</div>
      </div>
    </div>
  );
}

/** Aceptar los términos y confirmar la contraseña para ver el rol. */
function Confirmar({ estado, periodo, onVisto, onSinRol, onCerrar }) {
  const [acepto, setAcepto] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [consultando, setConsultando] = useState(false);

  async function ver(evento) {
    evento.preventDefault();
    setConsultando(true);
    setError(null);
    try {
      onVisto(
        await nominaService.consultar({
          ...periodo,
          acepto,
          version: estado.version,
          password,
        }),
      );
    } catch (err) {
      if (esSinRol(err)) {
        onSinRol(await errorDeBlob(err, "No hay rol de pagos para ese mes."));
        return;
      }
      setError(await errorDeBlob(err, "No se pudo consultar el rol de pagos."));
      setPassword("");
      setConsultando(false);
    }
  }

  return (
    <Ventana titulo="Confirmar consulta del rol de pagos" onCerrar={onCerrar}>
      <form className="mz-stack" onSubmit={ver}>
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        <p className="mb-0">
          Rol de pagos de{" "}
          <strong>
            {MESES[periodo.mes - 1]} de {periodo.anio}
          </strong>{" "}
          · código <strong>{periodo.codigo || estado.codigo}</strong>
        </p>
        <div
          className="rol-pagos__terminos"
          aria-label="Términos y condiciones"
        >
          {estado.terminos}
        </div>
        <label className="form-check">
          <input
            type="checkbox"
            className="form-check-input"
            checked={acepto}
            onChange={(e) => setAcepto(e.target.checked)}
          />{" "}
          <span className="form-check-label">
            Acepto los términos y declaro que soy el propietario de este rol de
            pagos.
          </span>
        </label>
        <div>
          <label className="form-label mz-small" htmlFor="rol-password">
            Contraseña de su cuenta
          </label>
          <input
            id="rol-password"
            type="password"
            autoComplete="current-password"
            required
            className="form-control form-control-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onCerrar}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!acepto || !password || consultando}
          >
            {consultando ? "Consultando…" : "Ver rol de pagos"}
          </button>
        </div>
      </form>
    </Ventana>
  );
}

/** Enviar el último rol consultado al correo personal (se regenera). */
function EnviarCorreo({ estado, ultima, onCorreoGuardado }) {
  const [correo, setCorreo] = useState("");
  const [guardar, setGuardar] = useState(false);
  const [aceptoGuardar, setAceptoGuardar] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const usaGuardado = !correo.trim() && Boolean(estado.correo_guardado);

  async function enviar(evento) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    setAviso(null);
    try {
      const respuesta = await nominaService.enviar({
        consulta: ultima.consulta,
        correo: correo.trim(),
        guardar: guardar && Boolean(correo.trim()),
        acepto_guardar: aceptoGuardar,
      });
      setAviso(`Listo: se envió a ${respuesta.enviado_a}.`);
      if (guardar && aceptoGuardar && correo.trim()) onCorreoGuardado();
      setCorreo("");
      setGuardar(false);
      setAceptoGuardar(false);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar el correo."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="mz-card" aria-labelledby="rol-enviar-titulo">
      <form className="mz-card-body mz-stack" onSubmit={enviar}>
        <div>
          <h3 id="rol-enviar-titulo" className="h6 mb-1">
            <Icon name="envelope" /> Enviar a mi correo personal
          </h3>
          <p className="mz-faint mz-small mb-0">
            Se envía el rol de {MESES[ultima.mes - 1].toLowerCase()} de{" "}
            {ultima.anio} que acaba de consultar (se vuelve a generar; no queda
            guardado). Puede hacerlo durante 15 minutos.
          </p>
        </div>
        {aviso && (
          <div className="mz-alert mz-alert--info" role="status">
            <Icon name="check2-circle" />
            {aviso}
          </div>
        )}
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        <div>
          <label className="form-label mz-small" htmlFor="rol-correo">
            Correo personal
          </label>
          <input
            id="rol-correo"
            type="email"
            className="form-control form-control-sm"
            placeholder={
              estado.correo_guardado
                ? `Vacío: se usa el guardado (${estado.correo_guardado})`
                : "nombre@correo.com"
            }
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
          />
          <small className="mz-faint">
            No se guarda, salvo que marque la opción de abajo.
          </small>
        </div>
        {correo.trim() && (
          <label className="form-check">
            <input
              type="checkbox"
              className="form-check-input"
              checked={guardar}
              onChange={(e) => {
                setGuardar(e.target.checked);
                if (!e.target.checked) setAceptoGuardar(false);
              }}
            />{" "}
            <span className="form-check-label">
              Guardar este correo para próximos envíos
            </span>
          </label>
        )}
        {guardar && correo.trim() && (
          <div className="rol-pagos__consentimiento">
            <p className="mz-small mb-2">{estado.consentimiento_correo}</p>
            <label className="form-check mb-0">
              <input
                type="checkbox"
                className="form-check-input"
                checked={aceptoGuardar}
                onChange={(e) => setAceptoGuardar(e.target.checked)}
              />{" "}
              <span className="form-check-label">
                Acepto que se almacene mi correo personal.
              </span>
            </label>
          </div>
        )}
        <div className="mz-actions justify-content-end">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={
              enviando ||
              (!correo.trim() && !usaGuardado) ||
              (guardar && !aceptoGuardar)
            }
          >
            {enviando ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </form>
    </section>
  );
}

/** Los textos de la consulta (con `roles_pago.configurar`). */
function Configurar({ estado, onGuardado, onCerrar }) {
  const [terminos, setTerminos] = useState(estado.terminos);
  const [consentimiento, setConsentimiento] = useState(
    estado.consentimiento_correo,
  );
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await nominaService.configurar({
        terminos,
        consentimiento_correo: consentimiento,
      });
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
      setGuardando(false);
    }
  }

  return (
    <Ventana titulo="Textos de la consulta" onCerrar={onCerrar}>
      <form className="mz-stack" onSubmit={guardar}>
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        <div>
          <label className="form-label mz-small" htmlFor="rol-cfg-terminos">
            Términos que se aceptan en cada consulta
          </label>
          <textarea
            id="rol-cfg-terminos"
            rows={6}
            required
            maxLength={4000}
            className="form-control form-control-sm"
            value={terminos}
            onChange={(e) => setTerminos(e.target.value)}
          />
          <small className="mz-faint">
            Si los cambia, quien consulte después los aceptará de nuevo. Versión
            actual: {estado.version}.
          </small>
        </div>
        <div>
          <label className="form-label mz-small" htmlFor="rol-cfg-correo">
            Consentimiento para guardar el correo personal
          </label>
          <textarea
            id="rol-cfg-correo"
            rows={4}
            required
            maxLength={2000}
            className="form-control form-control-sm"
            value={consentimiento}
            onChange={(e) => setConsentimiento(e.target.value)}
          />
        </div>
        <div className="mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onCerrar}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={guardando}
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Ventana>
  );
}

/**
 * Institucional → Consultar rol de pagos: se elige año y mes (el código de
 * empleado sale de la sesión), se aceptan los términos y se confirma la
 * contraseña. El PDF se ve y se descarga; se puede enviar al correo personal.
 */
/** Las observaciones de la persona a sus roles de pagos, en todos sus
 * estados (22/10/2026): solo las suyas, con la conversación con Talento
 * Humano. */
function MisObservaciones() {
  const [lista, setLista] = useState(null);
  useEffect(() => {
    nominaService
      .misObservaciones()
      .then(setLista)
      .catch(() => setLista([]));
  }, []);
  if (!lista || lista.length === 0) return null;
  return (
    <section className="mz-card" aria-label="Mis observaciones">
      <div className="mz-card-body mz-stack">
        <h3 className="h6 mb-0">
          <Icon name="chat-left-dots" /> Mis observaciones
        </h3>
        {lista.map((o) => (
          <details key={o.id} className="rol-pagos__observacion">
            <summary>
              <strong className="text-capitalize">
                {MESES[o.mes - 1]} {o.anio}
              </strong>{" "}
              · <span className="mz-pill">{o.estado_display}</span>
              {o.ultima && <span className="mz-faint"> · {o.ultima}</span>}
            </summary>
            <ol className="sugerencia-comentarios mt-2">
              {(o.mensajes ?? []).map((m) => (
                <li key={m.id}>
                  <strong>{m.tipo_display}</strong>{" "}
                  <small className="mz-faint">
                    · {m.autor} · {formatearFecha(m.fecha, true)}
                  </small>
                  {m.texto && <p className="mb-0">{m.texto}</p>}
                  <AdjuntosObservacion adjuntos={m.adjuntos} />
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </section>
  );
}

/** Sus roles de pagos abiertos (26/10/2026): por período, cuándo lo abrió
 * y aceptó los términos, y cuándo dio su conformidad, con fecha, hora e IP. */
function MisRolesAbiertos({ roles }) {
  if (!roles?.length) return null;
  return (
    <section className="mz-card" aria-label="Mis roles abiertos">
      <div className="mz-card-body mz-stack">
        <h3 className="h6 mb-0">
          <Icon name="envelope-open" /> Mis roles abiertos
        </h3>
        <ul className="rol-constancia__lista">
          {roles.map((r) => (
            <li key={`${r.anio}-${r.mes}`}>
              <strong>
                {MESES[r.mes - 1]} {r.anio}
              </strong>
              <ConstanciaRol rol={r} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function RolPagosPage() {
  const hoy = new Date();
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  // Por defecto, el mes anterior (en enero, diciembre del año pasado).
  const [periodo, setPeriodo] = useState(() => {
    // Desde el aviso de «rol corregido» llega con el año y el mes.
    const pedido = new URLSearchParams(window.location.search);
    const anio = Number(pedido.get("anio"));
    const mes = Number(pedido.get("mes"));
    if (anio && mes >= 1 && mes <= 12) return { anio, mes, codigo: "" };
    return {
      anio: hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear(),
      mes: hoy.getMonth() === 0 ? 12 : hoy.getMonth(),
      codigo: "",
    };
  });
  const [confirmando, setConfirmando] = useState(false);
  const [visto, setVisto] = useState(null);
  const [ultima, setUltima] = useState(null);
  const [configurando, setConfigurando] = useState(false);
  const [historial, setHistorial] = useState(false);
  const [habilitados, setHabilitados] = useState(false);
  const [masiva, setMasiva] = useState(false);
  const [seguimiento, setSeguimiento] = useState(false);
  const [auditado, setAuditado] = useState(false);
  // El último mes consultado sin rol: se dice en la página, con qué revisar.
  const [sinRol, setSinRol] = useState(null);

  function cargar() {
    return nominaService
      .estado()
      .then((datos) => {
        setEstado(datos);
        // El código se autocompleta con el de la sesión (si aún no hay otro).
        setPeriodo((p) => (p.codigo ? p : { ...p, codigo: datos.codigo }));
      })
      .catch((err) => setError(mensajeDeError(err, "No se pudo cargar.")));
  }

  useEffect(() => {
    cargar();
  }, []);

  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);
  // La constancia del período elegido, si ya abrió su propio rol de ese mes.
  const elegido =
    (!periodo.codigo.trim() || periodo.codigo.trim() === estado?.codigo) &&
    (estado?.mis_roles ?? []).find(
      (r) => r.anio === periodo.anio && r.mes === periodo.mes,
    );
  const mesesDelAnio =
    Number(periodo.anio) === hoy.getFullYear() ? hoy.getMonth() + 1 : 12;

  async function olvidar() {
    try {
      await nominaService.olvidarCorreo();
      setAviso("Su correo personal guardado se eliminó.");
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo eliminar."));
    }
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Consultar rol de pagos</h2>
          <p className="mz-desc">
            Elija el año y el mes. Para verlo, acepte los términos y confirme
            con la contraseña de su cuenta. El documento no se guarda en el
            sistema.
          </p>
        </div>
        {(estado?.puede_configurar ||
          estado?.puede_ver_historial ||
          estado?.puede_habilitar ||
          estado?.puede_descarga_masiva ||
          estado?.puede_seguimiento) && (
          <div className="mz-actions">
            {estado.puede_seguimiento && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setSeguimiento(true)}
              >
                <Icon name="envelope-exclamation" /> Roles sin abrir
              </button>
            )}
            {estado.puede_descarga_masiva && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setMasiva(true)}
              >
                <Icon name="file-earmark-zip" /> Descarga masiva
              </button>
            )}
            {estado.puede_habilitar && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setHabilitados(true)}
              >
                <Icon name="person-check" /> Usuarios habilitados
              </button>
            )}
            {estado.puede_ver_historial && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setAuditado(true)}
              >
                <Icon name="file-earmark-check" /> Descargar rol auditado
              </button>
            )}
            {estado.puede_ver_historial && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setHistorial(true)}
              >
                <Icon name="clock-history" /> Historial por empleado
              </button>
            )}
            {estado.puede_configurar && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setConfigurando(true)}
              >
                <Icon name="gear" /> Textos de la consulta
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check-circle" />
          {aviso}
        </div>
      )}
      {estado && !estado.habilitado && (
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="person-lock" />
          Su cuenta no está habilitada para consultar el rol de pagos. Se
          habilita a quienes aceptaron recibirlo en forma virtual: pídaselo a
          Talento Humano.
        </div>
      )}
      {estado?.habilitado &&
        !estado.codigo &&
        !estado.puede_consultar_otros && (
          <div className="mz-alert mz-alert--warn" role="status">
            <Icon name="person-vcard" />
            Su cuenta todavía no tiene código de empleado, así que no puede
            consultar su rol de pagos. Pídale a Talento Humano que se lo asigne.
          </div>
        )}
      {estado && !estado.disponible && (
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="hourglass-split" />
          La consulta del rol de pagos todavía no está disponible.
        </div>
      )}

      {estado?.habilitado && (
        <section className="mz-card" aria-label="Período a consultar">
          <form
            className="mz-card-body rol-pagos__periodo"
            onSubmit={(e) => {
              e.preventDefault();
              setAviso(null);
              setSinRol(null);
              setConfirmando(true);
            }}
          >
            <div>
              <label className="form-label mz-small" htmlFor="rol-anio">
                Año
              </label>
              <select
                id="rol-anio"
                className="form-select form-select-sm"
                value={periodo.anio}
                onChange={(e) => {
                  const anio = Number(e.target.value);
                  setPeriodo((p) => ({
                    ...p,
                    anio,
                    mes:
                      anio === hoy.getFullYear()
                        ? Math.min(p.mes, hoy.getMonth() + 1)
                        : p.mes,
                  }));
                }}
              >
                {anios.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label mz-small" htmlFor="rol-mes">
                Mes
              </label>
              <select
                id="rol-mes"
                className="form-select form-select-sm"
                value={periodo.mes}
                onChange={(e) =>
                  setPeriodo((p) => ({ ...p, mes: Number(e.target.value) }))
                }
              >
                {MESES.slice(0, mesesDelAnio).map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label mz-small" htmlFor="rol-codigo">
                Código de empleado
              </label>
              {estado.puede_consultar_otros ? (
                <>
                  <input
                    id="rol-codigo"
                    className="form-control form-control-sm"
                    placeholder={
                      estado.codigo ? `El suyo: ${estado.codigo}` : "Código"
                    }
                    maxLength={40}
                    inputMode="numeric"
                    aria-describedby="rol-codigo-ayuda"
                    value={periodo.codigo}
                    onChange={(e) =>
                      setPeriodo((p) => ({ ...p, codigo: e.target.value }))
                    }
                  />
                  <small id="rol-codigo-ayuda" className="mz-faint">
                    {periodo.codigo.trim() &&
                    periodo.codigo.trim() !== estado.codigo ? (
                      <>
                        Consultando a otra persona.{" "}
                        {estado.codigo && (
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 align-baseline"
                            onClick={() =>
                              setPeriodo((p) => ({
                                ...p,
                                codigo: estado.codigo,
                              }))
                            }
                          >
                            Volver a mi código
                          </button>
                        )}
                      </>
                    ) : (
                      "El suyo; puede escribir el de otra persona."
                    )}
                  </small>
                </>
              ) : (
                <>
                  {/* Sin permiso no se cambia ni se borra: es el de su cuenta
                      (el servidor tampoco acepta otro). */}
                  <input
                    id="rol-codigo"
                    className="form-control form-control-sm rol-pagos__codigo-fijo"
                    value={estado.codigo || "Sin código"}
                    readOnly
                    aria-readonly="true"
                    aria-describedby="rol-codigo-ayuda"
                  />
                  <small id="rol-codigo-ayuda" className="mz-faint">
                    <Icon name="lock" /> Solo su código; prohibido usar el de
                    otra persona.
                  </small>
                </>
              )}
            </div>
            {/* A la altura de los campos, no del fondo de la fila: debajo del
                código puede haber una línea de ayuda. */}
            <div className="rol-pagos__accion">
              <span className="form-label mz-small" aria-hidden="true">
                &nbsp;
              </span>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={
                  !estado.disponible ||
                  (!estado.codigo &&
                    !(estado.puede_consultar_otros && periodo.codigo.trim()))
                }
              >
                <Icon name="search" /> Consultar
              </button>
            </div>
          </form>
          {elegido && (
            <div className="mz-card-body pt-0">
              <ConstanciaRol rol={elegido} />
            </div>
          )}
        </section>
      )}

      {estado?.por_confirmar?.length > 0 && (
        <section
          className="mz-card rol-pagos__por-confirmar"
          aria-label="Correcciones por confirmar"
        >
          <div className="mz-card-body mz-stack">
            <h3 className="h6 mb-0">
              <Icon name="arrow-repeat" /> Talento Humano corrigió su rol de
              pagos
            </h3>
            {estado.por_confirmar.map((c) => (
              <div key={c.id} className="rol-pagos__correccion">
                <span>
                  <strong className="text-capitalize">
                    {MESES[c.mes - 1]} {c.anio}
                  </strong>
                  {c.nota && <span className="mz-faint"> · {c.nota}</span>}
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setPeriodo((p) => ({
                      ...p,
                      anio: c.anio,
                      mes: c.mes,
                      codigo: estado.codigo,
                    }));
                    setSinRol(null);
                    setConfirmando(true);
                  }}
                >
                  Revisar y confirmar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {sinRol && (
        <section className="mz-card rol-pagos__sin-rol" role="status">
          <div className="mz-card-body">
            <Icon name="calendar-x" className="rol-pagos__sin-rol-icono" />
            <div>
              <h3 className="h6 mb-1">
                Sin rol de pagos para {MESES[sinRol.mes - 1].toLowerCase()} de{" "}
                {sinRol.anio}
              </h3>
              <p className="mb-1">{sinRol.mensaje}</p>
              <ul className="mz-faint mz-small mb-0">
                <li>Puede que ese mes todavía no esté cerrado en nómina.</li>
                <li>O que en ese período no estuviera en nómina.</li>
                <li>Si cree que es un error, consulte con Talento Humano.</li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {ultima && (
        <div className="d-flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() => setVisto(ultima)}
          >
            <Icon name="file-earmark-pdf" /> Ver de nuevo el rol de{" "}
            {MESES[ultima.mes - 1].toLowerCase()} {ultima.anio}
          </button>
        </div>
      )}
      {ultima && (
        <EnviarCorreo
          key={ultima.consulta}
          estado={estado}
          ultima={ultima}
          onCorreoGuardado={cargar}
        />
      )}

      {estado?.correo_guardado && (
        <p className="mz-faint mz-small mb-0">
          Tiene guardado el correo personal {estado.correo_guardado}.{" "}
          <button
            type="button"
            className="btn btn-link btn-sm p-0 align-baseline"
            onClick={olvidar}
          >
            Eliminarlo
          </button>
        </p>
      )}

      {confirmando && estado && (
        <Confirmar
          estado={estado}
          periodo={periodo}
          onCerrar={() => setConfirmando(false)}
          onSinRol={(mensaje) => {
            setConfirmando(false);
            setSinRol({ anio: periodo.anio, mes: periodo.mes, mensaje });
          }}
          onVisto={({ blob, consulta }) => {
            const codigo = periodo.codigo.trim() || estado.codigo;
            const nuevo = {
              blob,
              consulta,
              anio: periodo.anio,
              mes: periodo.mes,
              // La conformidad es solo del rol propio.
              propio: codigo === estado.codigo,
              conformidad: null,
            };
            setConfirmando(false);
            setUltima(nuevo);
            setVisto(nuevo);
            // Queda la constancia de que lo abrió (fecha, hora e IP).
            cargar();
          }}
        />
      )}
      {visto && (
        <VisorRolPagos
          titulo={`Rol de pagos · ${MESES[visto.mes - 1]} ${visto.anio}`}
          blob={visto.blob}
          nombreArchivo={`rol-de-pagos-${visto.anio}-${String(visto.mes).padStart(2, "0")}.pdf`}
          consulta={visto.consulta}
          propio={visto.propio}
          conformidad={visto.conformidad}
          correccion={
            estado?.por_confirmar?.find(
              (c) => c.anio === visto.anio && c.mes === visto.mes,
            ) ?? null
          }
          onConformidad={(respuesta) => {
            setVisto((v) => v && { ...v, conformidad: respuesta });
            setUltima((u) => u && { ...u, conformidad: respuesta });
            // Confirmar (o volver a observar) cambia lo pendiente.
            cargar();
          }}
          onCerrar={() => setVisto(null)}
        />
      )}
      {estado?.habilitado && <MisRolesAbiertos roles={estado.mis_roles} />}
      {estado?.habilitado && <MisObservaciones />}
      {historial && <HistorialRolPagos onCerrar={() => setHistorial(false)} />}
      {habilitados && (
        <HabilitadosRolPagos onCerrar={() => setHabilitados(false)} />
      )}
      {masiva && <DescargaMasivaRolPagos onCerrar={() => setMasiva(false)} />}
      {seguimiento && (
        <SeguimientoRolPagos
          onCerrar={() => setSeguimiento(false)}
          puedeVerRol={Boolean(estado?.puede_ver_historial)}
        />
      )}
      {auditado && <AuditadoRolPagos onCerrar={() => setAuditado(false)} />}
      {configurando && estado && (
        <Configurar
          estado={estado}
          onCerrar={() => setConfigurando(false)}
          onGuardado={() => {
            setConfigurando(false);
            setAviso("Textos guardados.");
            cargar();
          }}
        />
      )}
    </div>
  );
}
