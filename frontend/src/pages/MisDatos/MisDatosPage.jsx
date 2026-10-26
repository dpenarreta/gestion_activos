import { useEffect, useState } from "react";

import { misDatosService } from "../../api/misDatosService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import { MiAniversario } from "./MiAniversario";
import { MiCargo } from "./MiCargo";
import { MiCumpleanos } from "./MiCumpleanos";
import { MisHerramientas } from "./MisHerramientas";
import { MiSupervision } from "./MiSupervision";

const NOMBRES = {
  nombre: "nombre y apellido",
  nombres: "nombres",
  apellidos: "apellidos",
  correo: "correo institucional",
  telefono: "teléfono",
  area: "área",
  agencia: "agencia",
  cargo: "cargo",
};

/** Cada dato obligatorio con su nombre, para listarlos. */
export const DATOS_OBLIGATORIOS = [
  ["nombres", "Nombres"],
  ["apellidos", "Apellidos"],
  ["correo", "Correo institucional"],
  ["area", "Área"],
  ["agencia", "Agencia"],
  ["cargo", "Cargo"],
];

/**
 * El formulario de «Mi perfil». Lo usa su pantalla y, cuando falta algo, la
 * Mesa de ayuda antes de crear un ticket. Al guardar devuelve los datos
 * actualizados (`onGuardado`).
 */
export function FormularioMisDatos({
  datos,
  onGuardado,
  textoBoton = "Guardar",
}) {
  const [valores, setValores] = useState({
    nombres: datos.nombres ?? "",
    apellidos: datos.apellidos ?? "",
    telefono: datos.telefono ?? "",
    area: datos.area?.id ?? "",
    agencia: datos.agencia?.id ?? "",
    cargo: datos.cargo?.id ?? "",
    // Autoriza guardar su teléfono y que la empresa lo use para contactarlo
    // (LOPDP). Solo hace falta si escribe un teléfono.
    acepta_telefono: Boolean(datos.telefono_autorizacion?.aceptado),
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  // Ya tiene cargo: lo eligió (o se lo asignaron) y no lo cambia desde aquí.
  const cargoFijo = Boolean(datos.cargo);
  const fijar = (campo) => (e) =>
    setValores((actual) => ({ ...actual, [campo]: e.target.value }));
  const autorizacion = datos.telefono_autorizacion;
  // El teléfono es opcional (26/10/2026): la autorización aparece y se exige
  // solo cuando se escribe uno.
  const conTelefono = valores.telefono.trim() !== "";

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      onGuardado?.(await misDatosService.guardar(valores));
    } catch (err) {
      setError(mensajeDeError(err, "No se pudieron guardar sus datos."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="row g-3" onSubmit={guardar}>
      {error && (
        <div className="col-12">
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        </div>
      )}
      <div className="col-12 col-md-6">
        <label className="form-label" htmlFor="md-nombres">
          Nombres
        </label>
        <input
          id="md-nombres"
          className="form-control"
          required
          maxLength={150}
          autoComplete="given-name"
          value={valores.nombres}
          onChange={fijar("nombres")}
        />
      </div>
      <div className="col-12 col-md-6">
        <label className="form-label" htmlFor="md-apellidos">
          Apellidos
        </label>
        <input
          id="md-apellidos"
          className="form-control"
          required
          maxLength={150}
          autoComplete="family-name"
          value={valores.apellidos}
          onChange={fijar("apellidos")}
        />
      </div>
      <div className="col-12 col-md-6">
        <label className="form-label" htmlFor="md-correo">
          Correo institucional
        </label>
        <input
          id="md-correo"
          className={`form-control${
            datos.correo_institucional === false ? " is-invalid" : ""
          }`}
          value={datos.correo}
          disabled
        />
        {datos.correo_institucional === false ? (
          <div className="invalid-feedback d-block">
            No es un correo institucional (@grupolaar.com). Lo corrige la
            administración: pídale que lo cambie en su usuario.
          </div>
        ) : (
          <div className="form-text">
            El de su cuenta: lo cambia la administración.
          </div>
        )}
      </div>
      <div className="col-12 col-md-6">
        <label className="form-label" htmlFor="md-codigo-empleado">
          Código de empleado
        </label>
        <input
          id="md-codigo-empleado"
          className="form-control"
          value={datos.codigo_empleado || "Sin asignar"}
          disabled
        />
        <div className="form-text">Lo asigna Talento Humano.</div>
      </div>
      <div className="col-12 col-md-6">
        <label className="form-label" htmlFor="md-telefono">
          Teléfono <span className="mz-faint">(opcional)</span>
        </label>
        <input
          id="md-telefono"
          className="form-control"
          inputMode="tel"
          autoComplete="tel"
          aria-describedby="md-telefono-ayuda"
          value={valores.telefono}
          onChange={fijar("telefono")}
        />
        <div id="md-telefono-ayuda" className="form-text">
          Ingresar su teléfono es opcional, no es obligatorio. Si lo ingresa,
          antes de guardar deberá aceptar el tratamiento de sus datos
          personales.
        </div>
      </div>
      {conTelefono && (
        <div className="col-12">
          <div className="form-check mis-datos__autorizacion">
            <input
              id="md-acepta-telefono"
              type="checkbox"
              className="form-check-input"
              required
              checked={valores.acepta_telefono}
              onChange={(e) =>
                setValores((actual) => ({
                  ...actual,
                  acepta_telefono: e.target.checked,
                }))
              }
            />
            <label className="form-check-label" htmlFor="md-acepta-telefono">
              {autorizacion?.texto ??
                "Autorizo a la empresa a guardar mi número de teléfono de contacto, sea personal o empresarial, y a que otras personas de la empresa lo usen para contactarme."}
            </label>
            {autorizacion?.aceptado && autorizacion.aceptado_en && (
              <div className="form-text">
                Autorizado el {formatearFecha(autorizacion.aceptado_en, true)}.
              </div>
            )}
          </div>
        </div>
      )}
      <div className="col-12 col-md-4">
        <label className="form-label" htmlFor="md-area">
          Área
        </label>
        <select
          id="md-area"
          className="form-select"
          required
          value={valores.area}
          onChange={fijar("area")}
        >
          <option value="">Elija su área</option>
          {(datos.areas ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="col-12 col-md-4">
        <label className="form-label" htmlFor="md-agencia">
          Agencia
        </label>
        <select
          id="md-agencia"
          className="form-select"
          required
          value={valores.agencia}
          onChange={fijar("agencia")}
        >
          <option value="">Elija su agencia</option>
          {(datos.agencias ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="col-12 col-md-4">
        <label className="form-label" htmlFor="md-cargo">
          Cargo
        </label>
        {/* Del catálogo del organigrama; obligatorio. Se elige una sola vez:
            después lo cambia TI o la administración. */}
        <select
          id="md-cargo"
          className="form-select"
          required
          disabled={cargoFijo}
          aria-describedby="md-cargo-ayuda"
          value={valores.cargo}
          onChange={fijar("cargo")}
        >
          <option value="">
            {(datos.cargos ?? []).length > 0
              ? "Elija su cargo"
              : "Sin cargos disponibles"}
          </option>
          {(datos.cargos ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <div id="md-cargo-ayuda" className="form-text">
          {cargoFijo
            ? "Su cargo solo lo cambia TI o la administración del sistema."
            : "Lo elige una sola vez."}
        </div>
      </div>
      {!cargoFijo && valores.cargo !== "" && (
        <div className="col-12">
          <div className="mz-alert mz-alert--warn" role="alert">
            <Icon name="exclamation-triangle" />
            <span>
              <strong>Revise que su cargo sea el correcto.</strong> Una vez
              guardado, no podrá cambiarlo usted: solo TI o la administración
              del sistema pueden modificarlo.
            </span>
          </div>
        </div>
      )}
      <div className="col-12 mz-actions justify-content-end">
        <button type="submit" className="btn btn-primary" disabled={guardando}>
          {guardando ? "Guardando…" : textoBoton}
        </button>
      </div>
    </form>
  );
}

/** Lo que falta, en palabras: «teléfono y agencia». */
export function queFalta(faltan = []) {
  const nombres = faltan.map((clave) => NOMBRES[clave] ?? clave);
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
}

/**
 * «Mi perfil» (se abre desde el usuario, abajo en el menú): cada persona
 * revisa y actualiza su nombre, teléfono, área y agencia. La Mesa de ayuda
 * los usa para cargar sus tickets por defecto.
 */
export function MisDatosPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    misDatosService
      .obtener()
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar sus datos.")),
      );
  }, []);

  return (
    <div className="mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Mi perfil</h2>
          <p className="mz-desc">
            Su información personal. Con ella se cargan sus pedidos de soporte:
            manténgala al día.
          </p>
        </div>
      </div>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}
      {datos?.faltan?.length > 0 && !aviso && (
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="exclamation-triangle" />
          Le falta completar: {queFalta(datos.faltan)}.
        </div>
      )}
      {datos && (
        <section className="mz-card">
          <div className="mz-card-body">
            <FormularioMisDatos
              key={JSON.stringify([datos.telefono, datos.area, datos.agencia])}
              datos={datos}
              onGuardado={(nuevos) => {
                setDatos(nuevos);
                setAviso("Sus datos quedaron guardados.");
              }}
            />
          </div>
        </section>
      )}
      {datos && <MiCargo perfil={datos.cargo_perfil} />}
      {datos && <MiSupervision linea={datos.supervision} cargo={datos.cargo} />}
      {datos && <MisHerramientas />}
      {datos && <MiCumpleanos inicial={datos.cumpleanos} />}
      {datos && <MiAniversario inicial={datos.aniversario} />}
    </div>
  );
}
