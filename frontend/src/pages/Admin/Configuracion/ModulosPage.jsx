import { useState } from "react";

import { empresasService } from "../../../api/empresasService";
import { Icon } from "../../../components/common/Icon/Icon";
import { useEstadoModulos } from "../../../modulos/EstadoModulos";
import { MODULOS } from "../../../modulos/modulos";
import { mensajeDeError } from "../../../utils/errores";
import { confirmar } from "../../../components/common/Confirmar/confirmar";

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
  // Al terminar se dice qué cambió: antes el interruptor se movía sin ningún
  // aviso (revisión final UX/UI, 28/10/2026).
  const [aviso, setAviso] = useState(null);

  async function cambiar(id, activo) {
    const nombre = MODULOS.find((m) => m.id === id)?.nombre;
    // Apagar un módulo lo oculta a toda la empresa: se confirma.
    if (!activo) {
      const si = await confirmar({
        titulo: `¿Apagar ${nombre ?? "este módulo"}?`,
        mensaje:
          "Nadie de esta empresa lo verá, aunque tenga sus permisos; solo el superusuario y el administrador siguen entrando.",
        accion: "Apagar",
      });
      if (!si) return;
    }
    setCambiando(id);
    setError(null);
    setAviso(null);
    try {
      // El cliente HTTP avisa del cambio y el estado se vuelve a pedir; se
      // pide también aquí para no depender de ese aviso.
      await empresasService.cambiarModulo(id, activo);
      await recargar();
      setAviso(
        activo
          ? `${nombre ?? "El módulo"} quedó encendido para esta empresa.`
          : `${nombre ?? "El módulo"} quedó apagado: nadie de esta empresa lo verá.`,
      );
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
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check2-circle" />
          {aviso}
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
                    // Solo el nombre: el estado ya lo anuncia el interruptor, y
                    // repetirlo se oía «encendido, activado» (revisión final
                    // UX/UI, 28/10/2026).
                    aria-label={modulo?.nombre ?? estado.nombre}
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
