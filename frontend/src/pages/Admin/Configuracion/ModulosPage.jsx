import { useState } from "react";

import { empresasService } from "../../../api/empresasService";
import { Icon } from "../../../components/common/Icon/Icon";
import { useEstadoModulos } from "../../../modulos/EstadoModulos";
import { MODULOS } from "../../../modulos/modulos";
import { mensajeDeError } from "../../../utils/errores";

/**
 * Configuración → Módulos: encender y apagar los módulos de la empresa
 * activa. Apagado, el módulo desaparece para todos —aunque tengan sus
 * permisos— y su API deja de responder; solo el superusuario y quien tiene
 * `configuracion.modulos` lo siguen viendo y entrando, para prepararlo.
 */
export function ModulosPage() {
  const { modulos, cargado, recargar } = useEstadoModulos();
  const [cambiando, setCambiando] = useState(null);
  const [error, setError] = useState(null);

  async function cambiar(id, activo) {
    setCambiando(id);
    setError(null);
    try {
      // El cliente HTTP avisa del cambio y el estado se vuelve a pedir; se
      // pide también aquí para no depender de ese aviso.
      await empresasService.cambiarModulo(id, activo);
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo cambiar el módulo."));
    } finally {
      setCambiando(null);
    }
  }

  return (
    <div className="mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Módulos</h2>
          <p className="mz-desc">
            Encienda o apague los módulos de esta empresa. Un módulo apagado no
            lo ve nadie, aunque tenga sus permisos; solo el superusuario y el
            administrador siguen entrando.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="mz-card">
        <ul className="list-group list-group-flush">
          {!cargado && <li className="list-group-item mz-faint">Cargando…</li>}
          {modulos.map((estado) => {
            const modulo = MODULOS.find((m) => m.id === estado.id);
            return (
              <li
                key={estado.id}
                className="list-group-item d-flex align-items-center gap-3"
              >
                <Icon name={modulo?.icono ?? "grid"} />
                <div className="flex-grow-1">
                  <strong>{modulo?.nombre ?? estado.nombre}</strong>
                  {modulo?.descripcion && (
                    <small className="mz-faint d-block">
                      {modulo.descripcion}
                    </small>
                  )}
                </div>
                <label className="form-check form-switch m-0">
                  <input
                    type="checkbox"
                    role="switch"
                    className="form-check-input"
                    aria-label={`${modulo?.nombre ?? estado.nombre}: ${
                      estado.activo ? "encendido" : "apagado"
                    }`}
                    checked={estado.activo}
                    disabled={cambiando === estado.id}
                    onChange={(e) => cambiar(estado.id, e.target.checked)}
                  />{" "}
                  <span className="form-check-label mz-small">
                    {estado.activo ? "Encendido" : "Apagado"}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
