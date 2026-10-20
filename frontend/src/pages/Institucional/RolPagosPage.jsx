import { useEffect, useState } from "react";

import { nominaService } from "../../api/nominaService";
import { Icon } from "../../components/common/Icon/Icon";
import { VisorPdf } from "../../components/common/VisorPdf/VisorPdf";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import "./Institucional.css";

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
function Confirmar({ estado, periodo, onVisto, onCerrar }) {
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
export function RolPagosPage() {
  const hoy = new Date();
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  // Por defecto, el mes anterior (en enero, diciembre del año pasado).
  const [periodo, setPeriodo] = useState(() => ({
    anio: hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear(),
    mes: hoy.getMonth() === 0 ? 12 : hoy.getMonth(),
    codigo: "",
  }));
  const [confirmando, setConfirmando] = useState(false);
  const [visto, setVisto] = useState(null);
  const [ultima, setUltima] = useState(null);
  const [configurando, setConfigurando] = useState(false);

  function cargar() {
    return nominaService
      .estado()
      .then(setEstado)
      .catch((err) => setError(mensajeDeError(err, "No se pudo cargar.")));
  }

  useEffect(() => {
    cargar();
  }, []);

  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);
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
        {estado?.puede_configurar && (
          <div className="mz-actions">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setConfigurando(true)}
            >
              <Icon name="gear" /> Textos de la consulta
            </button>
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
      {estado && !estado.codigo && !estado.puede_consultar_otros && (
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

      {estado && (
        <section className="mz-card" aria-label="Período a consultar">
          <form
            className="mz-card-body rol-pagos__periodo"
            onSubmit={(e) => {
              e.preventDefault();
              setAviso(null);
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
                <input
                  id="rol-codigo"
                  className="form-control form-control-sm"
                  placeholder={
                    estado.codigo ? `El suyo: ${estado.codigo}` : "Código"
                  }
                  maxLength={40}
                  value={periodo.codigo}
                  onChange={(e) =>
                    setPeriodo((p) => ({ ...p, codigo: e.target.value }))
                  }
                />
              ) : (
                <input
                  id="rol-codigo"
                  className="form-control form-control-sm"
                  value={estado.codigo}
                  readOnly
                  aria-describedby="rol-codigo-ayuda"
                />
              )}
              {!estado.puede_consultar_otros && (
                <small id="rol-codigo-ayuda" className="mz-faint">
                  Sale de su sesión.
                </small>
              )}
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-sm align-self-end"
              disabled={
                !estado.disponible ||
                (!estado.codigo &&
                  !(estado.puede_consultar_otros && periodo.codigo.trim()))
              }
            >
              <Icon name="search" /> Consultar
            </button>
          </form>
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
          onVisto={({ blob, consulta }) => {
            const nuevo = {
              blob,
              consulta,
              anio: periodo.anio,
              mes: periodo.mes,
            };
            setConfirmando(false);
            setUltima(nuevo);
            setVisto(nuevo);
          }}
        />
      )}
      {visto && (
        <VisorPdf
          titulo={`Rol de pagos · ${MESES[visto.mes - 1]} ${visto.anio}`}
          blob={visto.blob}
          nombreArchivo={`rol-de-pagos-${visto.anio}-${String(visto.mes).padStart(2, "0")}.pdf`}
          onCerrar={() => setVisto(null)}
        />
      )}
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
