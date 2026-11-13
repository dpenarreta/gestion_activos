import { useId, useRef, useState } from "react";

import { adminUsersService } from "../../../api/adminUsersService";
import {
  Campo,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { Icon } from "../../../components/common/Icon/Icon";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import {
  cumpleReglas,
  ReglasContrasena,
} from "../../../components/common/ReglasContrasena/ReglasContrasena";
import { useAuth } from "../../../hooks/useAuth";
import "./ContrasenaDeLaCuenta.css";
import {
  erroresPorCampo,
  hayErroresGenerales,
  mensajeDeError,
} from "../../../utils/errores";

/*
 * La tarjeta «Contraseña» de la ficha: las tres formas de resolver el acceso
 * de otra persona, cada una con su permiso (US-015).
 *
 *  1. Enviar el enlace de recuperación (con sus opciones; la tarjeta que ya
 *     existía, `usuarios.restablecer_password`).
 *  2. Cambiarla por una que se indica (`usuarios.cambiar_password`).
 *  3. Dejar la contraseña temporal (`usuarios.clave_temporal`).
 *
 * El servidor lo vuelve a comprobar todo (permiso, cuenta propia,
 * superusuario): aquí solo se evita ofrecer lo que daría 403. La clave nunca
 * sale del estado de la ventana ni se escribe en consola, y la temporal no se
 * muestra ni se nombra.
 */

const FORM_INICIAL = {
  password: "",
  password_confirmacion: "",
  forzar_cambio: true,
  cerrar_sesiones: true,
};

const OPCIONES_ENLACE = {
  send_link: false,
  force_change_on_next_login: false,
  revoke_sessions: false,
};

const SIN_CLAVE_TEMPORAL =
  "El servidor no tiene una contraseña temporal configurada. Avise a TI.";

// Cada opción, en pasado (para decir qué se hizo) y en futuro (para pedir la
// confirmación): la misma lista, dos tiempos.
const FRASES_DE_OPCIONES = [
  [
    "send_link",
    "se envió el enlace de restablecimiento",
    "se enviará el enlace de restablecimiento",
  ],
  [
    "force_change_on_next_login",
    "deberá cambiar la contraseña en su próximo ingreso",
    "deberá cambiar la contraseña en su próximo ingreso",
  ],
  [
    "revoke_sessions",
    "se cerraron todas sus sesiones",
    "se cerrarán todas sus sesiones",
  ],
];

function listaDeOpciones(opciones, columna) {
  const hechos = FRASES_DE_OPCIONES.filter(([clave]) => opciones[clave]).map(
    (fila) => fila[columna],
  );
  return hechos.length <= 1
    ? (hechos[0] ?? "")
    : `${hechos.slice(0, -1).join(", ")} y ${hechos[hechos.length - 1]}`;
}

/**
 * Qué se hizo de verdad al restablecer, en vez de «La acción se ejecutó
 * correctamente»: quien lo pidió necesita saber si el enlace salió o si las
 * sesiones se cerraron (revisión final UX/UI, 28/10/2026).
 */
function textoDelRestablecimiento(opciones) {
  const lista = listaDeOpciones(opciones, 1);
  return lista ? `Listo: ${lista}.` : "Restablecimiento aplicado.";
}

function CampoClave({
  id,
  etiqueta,
  valor,
  onCambio,
  onSalir,
  error,
  descrito,
  visible,
  autoenfocar = false,
}) {
  return (
    <Campo id={id} etiqueta={etiqueta} obligatorio error={error}>
      <input
        name={id}
        type={visible ? "text" : "password"}
        className="form-control"
        autoComplete="new-password"
        aria-describedby={descrito}
        data-autofocus={autoenfocar || undefined}
        value={valor}
        onChange={onCambio}
        onBlur={onSalir}
      />
    </Campo>
  );
}

function VentanaCambiar({ usuario, onCerrar, onCambiada }) {
  const idBase = useId();
  const idReglas = `${idBase}-reglas`;
  const idCoinciden = `${idBase}-coinciden`;
  const idAyudaCambio = `${idBase}-ayuda-cambio`;
  const [form, setForm] = useState(FORM_INICIAL);
  const [errores, setErrores] = useState({});
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [visible, setVisible] = useState(false);
  // Se compara al salir del campo: avisar en cada letra sería ruido.
  const [repetidaTocada, setRepetidaTocada] = useState(false);
  const cuerpoRef = useRef(null);

  const coinciden =
    form.password_confirmacion !== "" &&
    form.password === form.password_confirmacion;
  const mostrarCoincidencia =
    repetidaTocada && form.password_confirmacion !== "";

  function cambiar(evento) {
    const { name, value } = evento.target;
    setForm({ ...form, [name]: value });
    if (errores[name]) setErrores({ ...errores, [name]: undefined });
  }

  async function enviar(evento) {
    evento.preventDefault();
    setAviso(null);
    const faltan = {};
    if (!form.password) {
      faltan.password = "Escriba la nueva contraseña.";
    } else if (!cumpleReglas(form.password)) {
      faltan.password = "La contraseña no cumple los requisitos de la lista.";
    }
    if (!form.password_confirmacion) {
      faltan.password_confirmacion = "Repita la contraseña.";
    } else if (form.password && form.password !== form.password_confirmacion) {
      faltan.password_confirmacion = "Las dos contraseñas no coinciden.";
    }
    if (Object.keys(faltan).length > 0) {
      setErrores(faltan);
      enfocarPrimerError(cuerpoRef.current);
      return;
    }
    setErrores({});
    setEnviando(true);
    try {
      await adminUsersService.cambiarPassword(usuario.id, form);
      onCambiada(
        `Se cambió la contraseña de ${usuario.nombre}. Se le avisó por correo.`,
      );
    } catch (err) {
      const porCampo = erroresPorCampo(err);
      setErrores(porCampo);
      // Lo que no es de un campo (403, 500, red) va arriba, completo.
      const hayCampos = Object.keys(porCampo).length > 0;
      setAviso(
        hayCampos && !hayErroresGenerales(err)
          ? "Revise los campos marcados."
          : mensajeDeError(err, "No se pudo cambiar la contraseña."),
      );
      enfocarPrimerError(cuerpoRef.current);
      setEnviando(false);
    }
  }

  return (
    <ModalDialog
      titulo="Cambiar contraseña"
      subtitulo={usuario.nombre}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Cambiar contraseña"
      textoGuardando="Cambiando…"
      isSaving={enviando}
      noValidate
    >
      <div ref={cuerpoRef} className="mz-stack">
        {aviso && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {aviso}
          </div>
        )}
        <CampoClave
          id="password"
          etiqueta="Nueva contraseña"
          valor={form.password}
          onCambio={cambiar}
          error={errores.password}
          descrito={idReglas}
          visible={visible}
          autoenfocar
        />
        <ReglasContrasena
          id={idReglas}
          clave={form.password}
          adicionales={["No puede ser la contraseña temporal"]}
        />
        <div>
          <CampoClave
            id="password_confirmacion"
            etiqueta="Repetir contraseña"
            valor={form.password_confirmacion}
            onCambio={cambiar}
            onSalir={() => setRepetidaTocada(true)}
            error={errores.password_confirmacion}
            descrito={mostrarCoincidencia ? idCoinciden : undefined}
            visible={visible}
          />
          {/* Región viva siempre montada: se anuncia el cambio de texto. */}
          <div
            id={idCoinciden}
            className={`mz-small mt-1 ${coinciden ? "contrasena-coincidencia--ok" : "contrasena-coincidencia--no"}`}
            aria-live="polite"
          >
            {mostrarCoincidencia && (
              <>
                <Icon
                  name={coinciden ? "check-circle-fill" : "x-circle-fill"}
                />{" "}
                {coinciden ? "Coinciden" : "No coinciden"}
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className={`btn btn-outline-secondary mz-tactil contrasena-mostrar align-self-start${visible ? " active" : ""}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          <Icon name={visible ? "eye-slash" : "eye"} /> Mostrar las contraseñas
        </button>
        <fieldset className="mz-stack">
          <legend className="form-label mb-1">Al guardar</legend>
          <div className="form-check">
            <input
              id="forzar_cambio"
              type="checkbox"
              className="form-check-input"
              aria-describedby={idAyudaCambio}
              checked={form.forzar_cambio}
              onChange={() =>
                setForm({ ...form, forzar_cambio: !form.forzar_cambio })
              }
            />
            <label className="form-check-label" htmlFor="forzar_cambio">
              Pedir que la cambie al entrar
            </label>
            <div id={idAyudaCambio} className="form-text">
              Recomendado: si lo desmarca, usted conocerá su contraseña.
            </div>
          </div>
          <div className="form-check">
            <input
              id="cerrar_sesiones"
              type="checkbox"
              className="form-check-input"
              checked={form.cerrar_sesiones}
              onChange={() =>
                setForm({ ...form, cerrar_sesiones: !form.cerrar_sesiones })
              }
            />
            <label className="form-check-label" htmlFor="cerrar_sesiones">
              Cerrar sus sesiones abiertas
            </label>
          </div>
        </fieldset>
      </div>
    </ModalDialog>
  );
}

export function ContrasenaDeLaCuenta({
  usuario,
  puedeEnviarEnlace,
  puedeCambiar,
  puedeClaveTemporal,
}) {
  const { user } = useAuth();
  const [ventana, setVentana] = useState(null); // "cambiar" | "temporal" | "enlace"
  const [exito, setExito] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [opciones, setOpciones] = useState(OPCIONES_ENLACE);
  const idSinOpciones = `${useId()}-sin-opciones`;
  const sinOpciones = !Object.values(opciones).some(Boolean);

  // Cambiar y dejar la temporal no valen sobre la propia cuenta (esa se
  // cambia en «Mi perfil») ni sobre un superusuario si quien mira no lo es:
  // el servidor las rechaza con 403.
  const esUnoMismo = String(user?.id) === String(usuario.id);
  const ajenoProtegido = usuario.esSuperusuario && !user?.is_superuser;
  const permitidoSobreEsta = !esUnoMismo && !ajenoProtegido;
  const verCambiar = puedeCambiar && permitidoSobreEsta;
  const verTemporal = puedeClaveTemporal && permitidoSobreEsta;
  if (!puedeEnviarEnlace && !verCambiar && !verTemporal) return null;

  function abrir(cual) {
    setExito(null);
    setError(null);
    setVentana(cual);
  }

  function alternar(clave) {
    setOpciones({ ...opciones, [clave]: !opciones[clave] });
  }

  async function aplicarEnlace() {
    setEnviando(true);
    setError(null);
    try {
      await adminUsersService.resetPassword(usuario.id, opciones);
      setExito(textoDelRestablecimiento(opciones));
      setOpciones(OPCIONES_ENLACE);
    } catch (err) {
      setError(
        mensajeDeError(
          err,
          "No se pudo ejecutar la acción de restablecimiento.",
        ),
      );
    } finally {
      setEnviando(false);
      setVentana(null);
    }
  }

  async function dejarTemporal() {
    setEnviando(true);
    setError(null);
    setExito(null);
    try {
      await adminUsersService.restablecerClaveTemporal(usuario.id);
      setExito(
        `La contraseña de ${usuario.nombre} volvió a la temporal. Deberá cambiarla al entrar y se le avisó por correo.`,
      );
    } catch (err) {
      const codigo = err?.response?.data?.error?.code;
      setError(
        codigo === "sin_clave_temporal"
          ? SIN_CLAVE_TEMPORAL
          : mensajeDeError(err, "No se pudo restablecer la contraseña."),
      );
    } finally {
      setEnviando(false);
      setVentana(null);
    }
  }

  const botonesEnColumna = "d-grid d-sm-flex gap-2 mt-2";

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Contraseña</h3>
      </div>
      <div className="mz-card-body">
        <p className="mz-desc mb-3">
          Para atender a quien no puede entrar. La persona recibe un aviso por
          correo y la contraseña nunca se envía.
        </p>
        {/* Región viva siempre montada y vacía: el resultado llega después y
            una región que aparece ya llena no siempre se anuncia. */}
        <div role="status">
          {exito && (
            <div className="mz-alert mz-alert--ok">
              <Icon name="check2-circle" />
              {exito}
            </div>
          )}
          {error && (
            <div className="mz-alert mz-alert--bad">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
        </div>

        {puedeEnviarEnlace && (
          <div className="mz-section">
            <h4>Enviar enlace de recuperación</h4>
            <p className="mz-desc">
              Úselo si la persona tiene correo y puede elegir su propia
              contraseña.
            </p>
            <div className="form-check">
              <input
                id="send_link"
                type="checkbox"
                className="form-check-input"
                checked={opciones.send_link}
                onChange={() => alternar("send_link")}
              />
              <label className="form-check-label" htmlFor="send_link">
                Enviar enlace de restablecimiento por correo
              </label>
            </div>
            <div className="form-check">
              <input
                id="force_change_on_next_login"
                type="checkbox"
                className="form-check-input"
                checked={opciones.force_change_on_next_login}
                onChange={() => alternar("force_change_on_next_login")}
              />
              <label
                className="form-check-label"
                htmlFor="force_change_on_next_login"
              >
                Pedir que la cambie al entrar
              </label>
            </div>
            <div className="form-check">
              <input
                id="revoke_sessions"
                type="checkbox"
                className="form-check-input"
                checked={opciones.revoke_sessions}
                onChange={() => alternar("revoke_sessions")}
              />
              <label className="form-check-label" htmlFor="revoke_sessions">
                Cerrar sus sesiones abiertas
              </label>
            </div>
            <div className={botonesEnColumna}>
              <button
                type="button"
                className="btn btn-outline-primary mz-tactil"
                disabled={sinOpciones}
                aria-describedby={sinOpciones ? idSinOpciones : undefined}
                onClick={() => abrir("enlace")}
              >
                <Icon name="envelope" /> Aplicar opciones
              </button>
              {sinOpciones && (
                <span
                  id={idSinOpciones}
                  className="mz-small mz-faint align-self-center"
                >
                  Marque al menos una opción.
                </span>
              )}
            </div>
          </div>
        )}

        {verCambiar && (
          <div className="mz-section">
            <h4>Cambiar contraseña</h4>
            <p className="mz-desc">
              Úselo si usted va a indicar la nueva contraseña y se la comunicará
              a la persona.
            </p>
            <div className={botonesEnColumna}>
              <button
                type="button"
                className="btn btn-primary mz-tactil"
                onClick={() => abrir("cambiar")}
              >
                <Icon name="key" /> Cambiar contraseña
              </button>
            </div>
          </div>
        )}

        {verTemporal && (
          <div className="mz-section">
            <h4>Dejar la contraseña temporal</h4>
            <p className="mz-desc">
              Úselo si la persona no puede recibir el enlace: entrará con la
              contraseña temporal de la intranet y deberá cambiarla.
            </p>
            <div className={botonesEnColumna}>
              <button
                type="button"
                className="btn btn-outline-danger mz-tactil"
                onClick={() => abrir("temporal")}
              >
                <Icon name="arrow-counterclockwise" /> Dejar la contraseña
                temporal
              </button>
            </div>
          </div>
        )}
      </div>

      {ventana === "cambiar" && (
        <VentanaCambiar
          usuario={usuario}
          onCerrar={() => setVentana(null)}
          onCambiada={(texto) => {
            setExito(texto);
            setVentana(null);
          }}
        />
      )}
      <ConfirmDialog
        isOpen={ventana === "enlace"}
        title="Restablecer contraseña"
        message={`Esta acción no puede deshacerse. Se aplicará lo marcado: ${listaDeOpciones(opciones, 2)}. ¿Confirma?`}
        isLoading={enviando}
        onConfirm={aplicarEnlace}
        onCancel={() => setVentana(null)}
      />
      <ConfirmDialog
        isOpen={ventana === "temporal"}
        title="Dejar la contraseña temporal"
        message={
          <>
            La contraseña de {usuario.nombre} pasará a ser la contraseña
            temporal de la intranet, que es la misma para todos. Hasta que entre
            y la cambie, cualquiera que la conozca podría usar su cuenta.
            <ul className="mt-2 mb-2">
              <li>Se cerrarán sus sesiones.</li>
              <li>Se anularán sus enlaces de recuperación.</li>
              <li>Se desbloqueará la cuenta.</li>
              <li>Recibirá un aviso por correo, sin la contraseña.</li>
            </ul>
            Comuníquele la contraseña temporal por un canal seguro.
          </>
        }
        confirmLabel="Dejar la contraseña temporal"
        cancelLabel="Volver"
        cancelClassName="btn-outline-secondary"
        confirmVariant="danger"
        isLoading={enviando}
        onConfirm={dejarTemporal}
        onCancel={() => setVentana(null)}
      />
    </section>
  );
}
