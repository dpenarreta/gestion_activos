import { useRef, useState } from "react";

import { ordenesService } from "../../api/ordenesService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import {
  erroresPorCampo,
  hayErroresGenerales,
  mensajeDeError,
} from "../../utils/errores";

const VACIO = {
  nombre: "",
  telefono: "",
  correo: "",
  contacto: "",
  identificacion: "",
};

const SIN_CONTACTO = "Indique un teléfono o un correo para contactarlo.";
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Los mismos mensajes que da el servidor (`ProveedorRapidoSerializer`).
 * Que falten teléfono y correo es un error del grupo «Contacto»
 * (`errores.medio`), no de uno de los dos.
 */
export function validarProveedor(valores) {
  const errores = {};
  if (!valores.nombre.trim()) {
    errores.nombre = "Escriba el nombre o la razón social.";
  }
  const telefono = valores.telefono.trim();
  const correo = valores.correo.trim();
  const digitos = telefono.replace(/\D/g, "").length;
  if (!telefono && !correo) {
    errores.medio = SIN_CONTACTO;
  }
  if (telefono && (digitos < 7 || digitos > 15)) {
    errores.telefono = "Escriba un teléfono de 7 a 15 dígitos.";
  }
  if (correo && !CORREO.test(correo)) {
    errores.correo = "Escriba un correo válido, como nombre@empresa.com.";
  }
  return errores;
}

/**
 * Registrar un proveedor con los datos mínimos sin salir de la orden
 * (US-006, CA-3, 11/11/2026): nombre o razón social y una forma de
 * contactarlo. Un técnico independiente sin cuenta se registra aquí a su
 * nombre. El resto de la ficha se completa en el catálogo de proveedores.
 *
 * `destino` dice dónde quedará el proveedor al guardarlo, para que no sea una
 * sorpresa. `nombreInicial` trae lo que se escribió en el buscador.
 */
export function RegistrarProveedorDialog({
  destino,
  nombreInicial = "",
  onCerrar,
  onRegistrado,
}) {
  const cuerpoRef = useRef(null);
  const [valores, setValores] = useState({ ...VACIO, nombre: nombreInicial });
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  function fijar(campo) {
    return (evento) => {
      const valor = evento.target.value;
      setValores((actual) => ({ ...actual, [campo]: valor }));
      setErrores((actuales) => {
        // Escribir teléfono o correo resuelve el error del grupo.
        const afectados =
          campo === "correo" || campo === "telefono"
            ? [campo, "medio"]
            : [campo];
        if (!afectados.some((c) => actuales[c])) return actuales;
        const resto = { ...actuales };
        afectados.forEach((c) => delete resto[c]);
        return resto;
      });
    };
  }

  async function guardar(evento) {
    evento.preventDefault();
    setError(null);
    const faltan = validarProveedor(valores);
    if (Object.keys(faltan).length > 0) {
      setErrores(faltan);
      enfocarPrimerError(cuerpoRef.current);
      return;
    }
    setErrores({});
    setIsSaving(true);
    try {
      const proveedor = await ordenesService.registrarProveedor({
        nombre: valores.nombre.trim(),
        telefono: valores.telefono.trim(),
        correo: valores.correo.trim(),
        contacto: valores.contacto.trim(),
        identificacion: valores.identificacion.trim(),
      });
      onRegistrado(proveedor);
    } catch (err) {
      const porCampo = erroresPorCampo(err);
      // El servidor da en `telefono` que falten los dos; con ambos vacíos, es
      // el error del grupo.
      if (
        porCampo.telefono &&
        !valores.telefono.trim() &&
        !valores.correo.trim()
      ) {
        porCampo.medio = porCampo.telefono;
        delete porCampo.telefono;
      }
      setErrores(porCampo);
      const todoEnSuCampo =
        Object.keys(porCampo).length > 0 &&
        Object.keys(porCampo).every(
          (campo) => campo in VACIO || campo === "medio",
        ) &&
        !hayErroresGenerales(err);
      setError(
        todoEnSuCampo
          ? null
          : mensajeDeError(err, "No se pudo registrar el proveedor."),
      );
      setIsSaving(false);
      enfocarPrimerError(cuerpoRef.current);
    }
  }

  const idErrorMedio = errores.medio ? "op-medio-error" : undefined;

  return (
    <ModalDialog
      titulo="Registrar proveedor nuevo"
      subtitulo={destino}
      onCerrar={onCerrar}
      onSubmit={guardar}
      textoConfirmar="Registrar y elegir"
      textoGuardando="Registrando…"
      isSaving={isSaving}
      noValidate
      anchoMaximo="34rem"
    >
      <div ref={cuerpoRef} className="row g-3">
        {error && (
          <div className="col-12">
            <div className="mz-alert mz-alert--bad mb-0" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          </div>
        )}
        <div className="col-12">
          <LeyendaObligatorios />
        </div>
        <Campo
          id="op-nombre"
          etiqueta="Nombre o razón social"
          obligatorio
          error={errores.nombre}
          className="col-12"
        >
          <input
            className="form-control"
            maxLength={150}
            autoComplete="off"
            value={valores.nombre}
            onChange={fijar("nombre")}
            data-autofocus
          />
        </Campo>
        <fieldset
          className="col-12 ordenes-contacto"
          aria-describedby={idErrorMedio}
        >
          <legend className="form-label ordenes-contacto__titulo">
            Contacto (al menos uno)
            <span className="mz-campo__obligatorio" aria-hidden="true">
              {" "}
              *
            </span>
            <span className="visually-hidden"> (obligatorio)</span>
          </legend>
          <div className="row g-3">
            <CampoDeContacto
              id="op-telefono"
              etiqueta="Teléfono"
              error={errores.telefono}
              // El error del grupo marca el primero de los dos, para que el
              // foco llegue aquí tras validar.
              invalidoPorGrupo={Boolean(errores.medio)}
              idErrorGrupo={idErrorMedio}
              inputMode="tel"
              maxLength={30}
              placeholder="099 000 0000"
              value={valores.telefono}
              onChange={fijar("telefono")}
            />
            <CampoDeContacto
              id="op-correo"
              etiqueta="Correo"
              error={errores.correo}
              idErrorGrupo={idErrorMedio}
              type="email"
              maxLength={254}
              value={valores.correo}
              onChange={fijar("correo")}
            />
          </div>
          {errores.medio && (
            <div id="op-medio-error" className="mz-field-error">
              {errores.medio}
            </div>
          )}
        </fieldset>
        <Campo
          id="op-contacto"
          etiqueta="Persona de contacto (opcional)"
          error={errores.contacto}
          className="col-12 col-sm-6"
        >
          <input
            className="form-control"
            maxLength={120}
            autoComplete="off"
            value={valores.contacto}
            onChange={fijar("contacto")}
          />
        </Campo>
        <Campo
          id="op-identificacion"
          etiqueta="Cédula o RUC (opcional)"
          error={errores.identificacion}
          className="col-12 col-sm-6"
        >
          <input
            className="form-control"
            inputMode="numeric"
            maxLength={20}
            autoComplete="off"
            value={valores.identificacion}
            onChange={fijar("identificacion")}
          />
        </Campo>
      </div>
    </ModalDialog>
  );
}

/**
 * Teléfono o correo dentro del grupo «Contacto»: como `Campo`, pero además
 * enlazado al error del grupo (que `Campo` no conoce y cuyo `aria-invalid`
 * pisaría).
 */
function CampoDeContacto({
  id,
  etiqueta,
  error,
  invalidoPorGrupo = false,
  idErrorGrupo,
  ...control
}) {
  const idError = error ? `${id}-error` : null;
  const describe = [idError, idErrorGrupo].filter(Boolean).join(" ");
  const invalido = Boolean(error) || invalidoPorGrupo;
  return (
    <div className="mz-campo col-12 col-sm-6">
      <label className="form-label" htmlFor={id}>
        {etiqueta}
      </label>
      <input
        id={id}
        className={`form-control${invalido ? " is-invalid" : ""}`}
        autoComplete="off"
        aria-invalid={invalido || undefined}
        aria-describedby={describe || undefined}
        {...control}
      />
      {error && (
        <div id={idError} className="mz-field-error">
          {error}
        </div>
      )}
    </div>
  );
}
