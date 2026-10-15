import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { getEmpresaActiva } from "../../api/client";
import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { CAPACIDADES } from "./capacidades";
import {
  ICONO_DEL_GRUPO,
  PILDORA_DEL_GRUPO,
  fechaCorta,
} from "./formatoMatriz";
import { ObligacionFormModal } from "./ObligacionFormModal";
import { PeriodoPanel } from "./PeriodoPanel";
import { usePanelDePeriodo } from "./usePanelDePeriodo";
import "./Matriz.css";

function Indicador({ variante, etiqueta, valor, detalle, icono, destino }) {
  return (
    <Link to={destino} className={`mz-kpi mz-kpi--${variante}`}>
      <span className="mz-kpi-top">
        <span className="mz-kpi-label">{etiqueta}</span>
        <span className="mz-kpi-icon">
          <Icon name={icono} />
        </span>
      </span>
      <span className="mz-kpi-value">{valor}</span>
      <span className="mz-kpi-sub">{detalle}</span>
    </Link>
  );
}

function FilaPeriodo({ periodo, zona, onAbrir }) {
  const estado = periodo.estado;
  return (
    <button
      type="button"
      className="mz-row"
      onClick={() => onAbrir(periodo.id)}
    >
      <span className="mz-row-ic">
        <Icon name="building" />
      </span>
      <span className="mz-row-info">
        <strong>{periodo.obligacion.nombre}</strong>
        <span>
          {periodo.etiqueta} · {periodo.responsable?.nombre}
        </span>
      </span>
      <span className="mz-row-end">
        <span className={`mz-pill ${PILDORA_DEL_GRUPO[estado.group]}`}>
          <Icon name={ICONO_DEL_GRUPO[estado.group]} /> {estado.label}
        </span>
        <small>{fechaCorta(periodo.vence_en, zona)}</small>
      </span>
    </button>
  );
}

/**
 * El tablero de la Matriz en la empresa activa (§15.2): cuatro indicadores y
 * las dos listas que se miran al empezar el día —lo que vence y lo que se
 * cerró—. Sin `ver_todas`, todo se limita a los períodos propios.
 */
export function ResumenMatriz() {
  const navigate = useNavigate();
  const panel = usePanelDePeriodo();
  const [empresa, setEmpresa] = useState(undefined);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(() => {
    matrizService
      .resumen()
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el resumen.")),
      );
  }, []);

  useEffect(() => {
    matrizService
      .misEmpresas()
      .then(({ empresas }) => {
        const activa = String(getEmpresaActiva() ?? "");
        const encontrada =
          empresas.find((e) => String(e.id) === activa) ??
          (activa ? null : empresas[0]);
        setEmpresa(encontrada ?? null);
        if (encontrada) cargar();
      })
      .catch((err) => {
        setEmpresa(null);
        setError(mensajeDeError(err, "No se pudo cargar la Matriz."));
      });
  }, [cargar]);

  if (empresa === undefined) return <div className="mz-empty">Cargando…</div>;

  if (error && !datos) {
    return (
      <div className="mz-alert mz-alert--bad" role="alert">
        <Icon name="x-octagon" />
        {error}
      </div>
    );
  }

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

  const puedeCrear = empresa.capacidades.includes("matriz.crear");
  const zona = empresa.zona_horaria;
  const c = datos?.counts;

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
            Matriz de obligaciones · {empresa.roles.join(", ")} · zona horaria{" "}
            {zona}: los vencimientos se calculan en esa hora.
          </p>
        </div>
        <div className="mz-view-actions">
          <Link
            to="/admin/matriz/obligaciones"
            className="btn btn-outline-secondary btn-sm"
          >
            Ver matriz completa
          </Link>
          {puedeCrear && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setCreando(true)}
            >
              <Icon name="plus-lg" /> Nueva obligación
            </button>
          )}
        </div>
      </div>

      {c && (
        <div className="mz-kpi-grid">
          <Indicador
            variante="bad"
            etiqueta="Incumplidas"
            valor={c.overdue}
            detalle="Vencidas sin cierre validado"
            icono="exclamation-triangle"
            destino="/admin/matriz/obligaciones?status=incumplido"
          />
          <Indicador
            variante="warn"
            etiqueta="En progreso"
            valor={c.in_progress}
            detalle="Abiertas dentro del plazo"
            icono="clock"
            destino="/admin/matriz/obligaciones?status=en_progreso"
          />
          <Indicador
            variante="info"
            etiqueta="Próximas a vencer"
            valor={c.due_soon}
            detalle="En los próximos 7 días"
            icono="hourglass-split"
            destino="/admin/matriz/obligaciones?status=en_progreso&sort=due"
          />
          <Indicador
            variante="ok"
            etiqueta="Finalizadas"
            valor={c.done}
            detalle={`${c.done_on_time} a tiempo · ${c.done_late} fuera de plazo`}
            icono="check2-circle"
            destino="/admin/matriz/obligaciones?status=finalizado"
          />
        </div>
      )}

      <div className="mz-grid-2">
        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Próximos vencimientos</h3>
            <Link
              to="/admin/matriz/obligaciones"
              className="btn btn-outline-secondary btn-sm"
            >
              Ver todo
            </Link>
          </div>
          {datos?.upcoming.length === 0 && (
            <div className="mz-empty">
              <Icon name="journal-check" />
              <div>
                Nada pendiente. Las obligaciones abiertas aparecerán aquí.
              </div>
            </div>
          )}
          {datos?.upcoming.map((p) => (
            <FilaPeriodo
              key={p.id}
              periodo={p}
              zona={zona}
              onAbrir={panel.abrir}
            />
          ))}
        </section>

        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Cierres recientes</h3>
          </div>
          {datos?.recent_closures.length === 0 && (
            <div className="mz-empty">
              <Icon name="check2-circle" />
              <div>Todavía no hay cierres validados.</div>
            </div>
          )}
          {datos?.recent_closures.map((p) => (
            <FilaPeriodo
              key={p.id}
              periodo={p}
              zona={zona}
              onAbrir={panel.abrir}
            />
          ))}
          <div className="mz-card-body">
            <div className="mz-note">
              <Icon name="shield-check" />
              <span>
                {/* §8.1: el rol global no cuenta, solo el de la membresía. */}
                Su rol en esta empresa permite:{" "}
                {empresa.capacidades
                  .map((codigo) => CAPACIDADES[codigo]?.toLowerCase() ?? codigo)
                  .join(", ")}
                .
              </span>
            </div>
          </div>
        </section>
      </div>

      {panel.abierto && (
        <PeriodoPanel
          id={panel.abierto}
          onCerrar={panel.cerrar}
          onCambio={cargar}
        />
      )}
      {creando && (
        <ObligacionFormModal
          onCerrar={() => setCreando(false)}
          onCreada={(periodo) => {
            setCreando(false);
            navigate(`/admin/matriz/obligaciones?periodo=${periodo.id}`);
          }}
        />
      )}
    </div>
  );
}
