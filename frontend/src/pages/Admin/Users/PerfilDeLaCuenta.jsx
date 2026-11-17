import { useEffect, useState } from "react";

import { adminUsersService } from "../../../api/adminUsersService";
import { Icon } from "../../../components/common/Icon/Icon";
import { mensajeDeError } from "../../../utils/errores";

/*
 * «Datos de Mi perfil» en la ficha del usuario (17/11/2026). Tras confirmar
 * su perfil, la persona ya no cambia su área ni su agencia: las corrige aquí
 * quien tenga `usuarios.corregir_perfil`. Los nombres se corrigen arriba, en
 * la misma ficha.
 */
export function PerfilDeLaCuenta({ usuarioId }) {
  const [datos, setDatos] = useState(null);
  const [area, setArea] = useState("");
  const [agencia, setAgencia] = useState("");
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);
  const [guardando, setGuardando] = useState(false);

  function cargar(respuesta) {
    setDatos(respuesta);
    setArea(respuesta.area ? String(respuesta.area.id) : "");
    setAgencia(respuesta.agencia ? String(respuesta.agencia.id) : "");
  }

  useEffect(() => {
    let vigente = true;
    adminUsersService
      .perfil(usuarioId)
      .then((respuesta) => vigente && cargar(respuesta))
      .catch(
        (err) =>
          vigente &&
          setError(mensajeDeError(err, "No se pudieron cargar sus datos.")),
      );
    return () => {
      vigente = false;
    };
  }, [usuarioId]);

  const cambio =
    datos &&
    (area !== (datos.area ? String(datos.area.id) : "") ||
      agencia !== (datos.agencia ? String(datos.agencia.id) : ""));

  async function guardar(evento) {
    evento.preventDefault();
    setError(null);
    setExito(null);
    setGuardando(true);
    try {
      const respuesta = await adminUsersService.corregirPerfil(usuarioId, {
        ...(area ? { area: Number(area) } : {}),
        agencia: agencia ? Number(agencia) : null,
      });
      cargar(respuesta);
      setExito("Datos corregidos. La persona ya los ve en Mi perfil.");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudieron corregir los datos."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Datos de Mi perfil</h3>
      </div>
      <form className="mz-card-body" onSubmit={guardar}>
        <p className="mz-small mz-faint">
          {datos?.confirmado
            ? "La persona ya confirmó su perfil: su área y su agencia solo se corrigen aquí."
            : "La persona todavía no confirma su perfil; puede corregirlos aquí o dejar que los complete ella."}
        </p>
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        {exito && (
          <div className="mz-alert mz-alert--ok" role="status">
            <Icon name="check2-circle" />
            {exito}
          </div>
        )}
        {datos && (
          <div className="row g-2">
            <div className="col-12 col-md-6">
              <label className="form-label" htmlFor="perfil-area">
                Área
              </label>
              <select
                id="perfil-area"
                className="form-select"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                {!area && <option value="">Sin área</option>}
                {datos.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label" htmlFor="perfil-agencia">
                Agencia
              </label>
              <select
                id="perfil-agencia"
                className="form-select"
                value={agencia}
                onChange={(e) => setAgencia(e.target.value)}
              >
                <option value="">Sin agencia</option>
                {datos.agencias.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12">
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!cambio || guardando}
              >
                {guardando ? "Guardando…" : "Corregir datos"}
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
