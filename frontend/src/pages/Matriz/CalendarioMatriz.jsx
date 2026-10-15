import { useCallback, useEffect, useMemo, useState } from "react";

import { getEmpresaActiva } from "../../api/client";
import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { useUltimaPeticion } from "../../hooks/useUltimaPeticion";
import { mensajeDeError } from "../../utils/errores";
import { MESES_LARGOS, diaLocal } from "./formatoMatriz";
import { PeriodoPanel } from "./PeriodoPanel";
import { usePanelDePeriodo } from "./usePanelDePeriodo";
import "./Matriz.css";

const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const POR_DIA = 3;

const CHIP_DEL_GRUPO = {
  incumplido: "mz-cal-chip--bad",
  en_progreso: "mz-cal-chip--warn",
  finalizado: "mz-cal-chip--ok",
};

function aIso(anio, mes, dia) {
  const dos = (n) => String(n).padStart(2, "0");
  return `${anio}-${dos(mes)}-${dos(dia)}`;
}

/** Las semanas del mes, de domingo a sábado, con los días de los meses
 * vecinos para completar la primera y la última. */
export function semanasDelMes(anio, mes) {
  const primero = new Date(Date.UTC(anio, mes - 1, 1));
  const inicio = new Date(primero);
  inicio.setUTCDate(1 - primero.getUTCDay());
  const dias = [];
  const cursor = new Date(inicio);
  do {
    dias.push({
      iso: aIso(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth() + 1,
        cursor.getUTCDate(),
      ),
      numero: cursor.getUTCDate(),
      delMes: cursor.getUTCMonth() === mes - 1,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  } while (cursor.getUTCMonth() === mes - 1 || cursor.getUTCDay() !== 0);
  return dias;
}

/**
 * El calendario del mes (§15.6): hasta tres períodos por día con el color de
 * su estado y «+N más»; un clic abre el detalle. Los días se cuentan en la
 * zona horaria de la empresa, como los vencimientos.
 */
export function CalendarioMatriz() {
  const panel = usePanelDePeriodo();
  const [zona, setZona] = useState(undefined);
  const [mes, setMes] = useState(null);
  const [periodos, setPeriodos] = useState(null);
  const [error, setError] = useState(null);
  const [abiertos, setAbiertos] = useState({});

  useEffect(() => {
    matrizService
      .misEmpresas()
      .then(({ empresas }) => {
        const activa = String(getEmpresaActiva() ?? "");
        const empresa =
          empresas.find((e) => String(e.id) === activa) ?? empresas[0];
        const z = empresa?.zona_horaria;
        setZona(z);
        const [a, m] = diaLocal(new Date().toISOString(), z).split("-");
        setMes({ anio: Number(a), mes: Number(m) });
      })
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar la Matriz.")),
      );
  }, []);

  const nuevaPeticion = useUltimaPeticion();
  const cargar = useCallback(() => {
    if (!mes) return;
    const vigente = nuevaPeticion();
    setPeriodos(null);
    setAbiertos({});
    matrizService
      .calendario(mes.anio, mes.mes)
      .then((datos) => vigente() && setPeriodos(datos.periods))
      .catch(
        (err) =>
          vigente() &&
          setError(mensajeDeError(err, "No se pudo cargar el calendario.")),
      );
  }, [mes, nuevaPeticion]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const porDia = useMemo(() => {
    const mapa = {};
    for (const periodo of periodos ?? []) {
      const dia = diaLocal(periodo.vence_en, zona);
      (mapa[dia] ??= []).push(periodo);
    }
    return mapa;
  }, [periodos, zona]);

  function mover(delta) {
    setMes(({ anio, mes: m }) => {
      const total = anio * 12 + (m - 1) + delta;
      return { anio: Math.floor(total / 12), mes: (total % 12) + 1 };
    });
  }

  function irAHoy() {
    const [a, m] = diaLocal(new Date().toISOString(), zona).split("-");
    setMes({ anio: Number(a), mes: Number(m) });
  }

  if (error && !mes) {
    return (
      <div className="mz-alert mz-alert--bad" role="alert">
        <Icon name="x-octagon" />
        {error}
      </div>
    );
  }
  if (!mes) return <div className="mz-empty">Cargando…</div>;

  const hoy = diaLocal(new Date().toISOString(), zona);
  const titulo = `${MESES_LARGOS[mes.mes - 1]} ${mes.anio}`;

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Calendario</h2>
          <p className="mz-desc">
            Los vencimientos del mes{zona ? `, en hora de ${zona}` : ""}.
          </p>
        </div>
        <div className="mz-view-actions">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            aria-label="Mes anterior"
            onClick={() => mover(-1)}
          >
            <Icon name="chevron-left" />
          </button>
          <span className="mz-cal-label" aria-live="polite">
            {titulo}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            aria-label="Mes siguiente"
            onClick={() => mover(1)}
          >
            <Icon name="chevron-right" />
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={irAHoy}
          >
            Hoy
          </button>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="mz-cal-grid" aria-busy={periodos === null}>
        {DIAS_SEMANA.map((dia) => (
          <div key={dia} className="mz-cal-dow">
            {dia}
          </div>
        ))}
        {semanasDelMes(mes.anio, mes.mes).map((dia) => {
          const lista = porDia[dia.iso] ?? [];
          const todos = abiertos[dia.iso];
          const visibles = todos ? lista : lista.slice(0, POR_DIA);
          return (
            <div
              key={dia.iso}
              className={[
                "mz-cal-day",
                dia.delMes ? "" : "is-other",
                dia.iso === hoy ? "is-today" : "",
              ].join(" ")}
              aria-label={dia.iso === hoy ? "Hoy" : undefined}
            >
              <span className="mz-cal-num">{dia.numero}</span>
              {visibles.map((periodo) => (
                <button
                  key={periodo.id}
                  type="button"
                  className={`mz-cal-chip ${CHIP_DEL_GRUPO[periodo.estado.group]}`}
                  title={`${periodo.codigo} · ${periodo.obligacion.nombre} · ${periodo.estado.label}`}
                  onClick={() => panel.abrir(periodo.id)}
                >
                  {periodo.obligacion.nombre}
                </button>
              ))}
              {!todos && lista.length > POR_DIA && (
                <button
                  type="button"
                  className="mz-cal-more"
                  onClick={() =>
                    setAbiertos((actuales) => ({
                      ...actuales,
                      [dia.iso]: true,
                    }))
                  }
                >
                  +{lista.length - POR_DIA} más
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mz-legend">
        <span>
          <i className="mz-legend-bad" /> Incumplido
        </span>
        <span>
          <i className="mz-legend-warn" /> En progreso
        </span>
        <span>
          <i className="mz-legend-ok" /> Finalizado
        </span>
      </div>

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
