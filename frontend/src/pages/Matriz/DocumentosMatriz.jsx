import { useCallback, useEffect, useState } from "react";

import { getEmpresaActiva } from "../../api/client";
import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import {
  ICONO_DEL_GRUPO,
  PILDORA_DEL_GRUPO,
  fechaCorta,
} from "./formatoMatriz";
import { PeriodoPanel } from "./PeriodoPanel";
import { usePanelDePeriodo } from "./usePanelDePeriodo";
import "./Matriz.css";

function FilaExpediente({ periodo, zona, onAbrir }) {
  const estado = periodo.estado;
  const n = periodo.documentos_validos;
  return (
    <button
      type="button"
      className="mz-row"
      onClick={() => onAbrir(periodo.id)}
    >
      <span className="mz-row-ic">
        <Icon name={n > 0 ? "folder-check" : "folder2-open"} />
      </span>
      <span className="mz-row-info">
        <strong>{periodo.obligacion.nombre}</strong>
        <span>
          {periodo.codigo} · {periodo.etiqueta} · {periodo.responsable?.nombre}
        </span>
      </span>
      <span className="mz-row-end">
        <span className={`mz-pill ${PILDORA_DEL_GRUPO[estado.group]}`}>
          <Icon name={ICONO_DEL_GRUPO[estado.group]} /> {estado.label}
        </span>
        <small>
          {n > 0
            ? `${n} ${n === 1 ? "documento" : "documentos"}`
            : `Vence ${fechaCorta(periodo.vence_en, zona)}`}
        </small>
      </span>
    </button>
  );
}

function Lista({ titulo, filas, vacio, icono, zona, onAbrir }) {
  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>
          {titulo} <span className="mz-faint">· {filas.length}</span>
        </h3>
      </div>
      {filas.length === 0 && (
        <div className="mz-empty">
          <Icon name={icono} />
          <div>{vacio}</div>
        </div>
      )}
      {filas.map((p) => (
        <FilaExpediente key={p.id} periodo={p} zona={zona} onAbrir={onAbrir} />
      ))}
    </section>
  );
}

/**
 * La vista Documentos (§15.7): los expedientes con evidencia válida y los que
 * aún no tienen ninguna. Cada fila abre el período en el panel lateral, donde
 * están el visor y la carga.
 */
export function DocumentosMatriz() {
  const panel = usePanelDePeriodo();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  // La zona de la empresa activa: los vencimientos se leen en su hora.
  const [zona, setZona] = useState(undefined);

  const cargar = useCallback(() => {
    matrizService
      .documentosResumen()
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar los documentos.")),
      );
  }, []);

  useEffect(() => {
    cargar();
    matrizService
      .misEmpresas()
      .then(({ empresas }) => {
        const activa = String(getEmpresaActiva() ?? "");
        const empresa =
          empresas.find((e) => String(e.id) === activa) ?? empresas[0];
        setZona(empresa?.zona_horaria);
      })
      .catch(() => {});
  }, [cargar]);

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Documentos</h2>
          <p className="mz-desc">
            Evidencia de cumplimiento por período. Abra un expediente para ver,
            descargar o cargar sus PDF.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {!datos && !error && <div className="mz-empty">Cargando…</div>}

      {datos && (
        <div className="mz-grid-2">
          <Lista
            titulo="Con evidencia"
            filas={datos.with_evidence}
            vacio="Todavía no hay períodos con documentos válidos."
            icono="folder-check"
            zona={zona}
            onAbrir={panel.abrir}
          />
          <Lista
            titulo="Pendientes de evidencia"
            filas={datos.pending}
            vacio="Ningún período espera evidencia."
            icono="journal-check"
            zona={zona}
            onAbrir={panel.abrir}
          />
        </div>
      )}

      {panel.abierto && (
        <PeriodoPanel
          id={panel.abierto}
          onCerrar={panel.cerrar}
          onCambio={cargar}
        />
      )}
    </div>
  );
}
