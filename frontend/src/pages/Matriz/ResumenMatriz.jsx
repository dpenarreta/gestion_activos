import { useEffect, useState } from "react";

import { getEmpresaActiva } from "../../api/client";
import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { CAPACIDADES } from "./capacidades";
import "./Matriz.css";

/**
 * La entrada de la Matriz de obligaciones en la empresa activa.
 *
 * Dice en qué empresa se está, con qué rol y qué permite: los permisos de la
 * Matriz salen del rol en *esta* empresa, y la misma persona puede ser
 * responsable en una y auditora en otra. El tablero con los indicadores y los
 * próximos vencimientos (§15.2) se suma aquí cuando existan obligaciones.
 */
export function ResumenMatriz() {
  const [estado, setEstado] = useState({ cargando: true });

  useEffect(() => {
    matrizService
      .misEmpresas()
      .then(({ empresas }) => {
        const activa = String(getEmpresaActiva() ?? "");
        setEstado({
          cargando: false,
          empresa:
            empresas.find((empresa) => String(empresa.id) === activa) ??
            (activa ? null : empresas[0]),
        });
      })
      .catch((err) =>
        setEstado({
          cargando: false,
          error: mensajeDeError(err, "No se pudo cargar la Matriz."),
        }),
      );
  }, []);

  if (estado.cargando) return <div className="mz-empty">Cargando…</div>;

  if (estado.error) {
    return (
      <div className="mz-alert mz-alert--bad" role="alert">
        <Icon name="x-octagon" />
        {estado.error}
      </div>
    );
  }

  const { empresa } = estado;
  if (!empresa) {
    return (
      <div className="mz-card">
        <div className="mz-empty">
          <Icon name="shield-lock" />
          <p className="mb-1">
            No tiene un rol de la Matriz en la empresa activa.
          </p>
          <p className="mz-small mb-0">
            Pida a un administrador que se lo asigne en Configuración →
            Usuarios, o cambie de empresa desde la barra superior.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="matriz-resumen"
      style={{ "--company-color": empresa.color }}
    >
      <div className="mz-view-head">
        <div>
          <h2>
            <span
              className="matriz-resumen__punto"
              style={{ background: empresa.color }}
              aria-hidden="true"
            />
            {empresa.nombre}
          </h2>
          <p className="mz-desc">
            Matriz de obligaciones · zona horaria {empresa.zona_horaria}: los
            vencimientos y recordatorios se calculan en esa hora.
          </p>
        </div>
      </div>

      <div className="mz-grid-2">
        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Obligaciones</h3>
          </div>
          <div className="mz-empty">
            <Icon name="journal-check" />
            <p className="mb-1">Todavía no hay obligaciones registradas.</p>
            <p className="mz-small mb-0">
              Aquí se verán los indicadores de cumplimiento y los próximos
              vencimientos de la empresa.
            </p>
          </div>
        </section>

        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Su rol en esta empresa</h3>
            {empresa.roles.map((rol) => (
              <span key={rol} className="mz-pill mz-pill--info">
                {rol}
              </span>
            ))}
          </div>
          <ul className="matriz-resumen__capacidades">
            {empresa.capacidades.map((codigo) => (
              <li key={codigo}>
                <Icon name="check2" className="mz-ok" />
                {CAPACIDADES[codigo] ?? codigo}
              </li>
            ))}
          </ul>
          <div className="mz-card-body pt-0">
            <div className="mz-note">
              <Icon name="info-circle" />
              {/* §8.1: el rol global no cuenta, solo el de la membresía. */}
              Estos permisos valen solo en esta empresa: en otra puede tener un
              rol distinto, o ninguno.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
