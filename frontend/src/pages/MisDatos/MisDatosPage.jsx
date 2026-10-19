import { useEffect, useState } from "react";

import { misDatosService } from "../../api/misDatosService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";

const NOMBRES = {
  nombre: "nombre y apellido",
  telefono: "teléfono",
  area: "área",
  agencia: "agencia",
};

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
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const fijar = (campo) => (e) =>
    setValores((actual) => ({ ...actual, [campo]: e.target.value }));

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
          Correo
        </label>
        <input
          id="md-correo"
          className="form-control"
          value={datos.correo}
          disabled
        />
        <div className="form-text">
          El de su cuenta: lo cambia la administración.
        </div>
      </div>
      <div className="col-12 col-md-6">
        <label className="form-label" htmlFor="md-telefono">
          Teléfono
        </label>
        <input
          id="md-telefono"
          className="form-control"
          required
          inputMode="tel"
          autoComplete="tel"
          value={valores.telefono}
          onChange={fijar("telefono")}
        />
      </div>
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
        {/* De un catálogo, no obligatorio: mientras esté vacío no hay qué
            elegir. */}
        <select
          id="md-cargo"
          className="form-select"
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
      </div>
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
    </div>
  );
}
