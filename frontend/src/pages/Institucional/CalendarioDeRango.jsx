import { useEffect, useRef, useState } from "react";

import { Icon } from "../../components/common/Icon/Icon";
import { iso } from "./CalendarioInicio";
import { conMayuscula, fechaPorTecla } from "./navegacionCalendario";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function primeroDelMes(texto) {
  const [anio, mes] = texto.split("-").map(Number);
  return new Date(anio, mes - 1, 1);
}

function seisSemanas(mes) {
  const corrimiento = (mes.getDay() + 6) % 7; // lunes = 0
  return Array.from(
    { length: 42 },
    (_, i) => new Date(mes.getFullYear(), mes.getMonth(), 1 - corrimiento + i),
  );
}

const esFecha = (texto) => /^\d{4}-\d{2}-\d{2}$/.test(texto ?? "");

/**
 * Elegir «desde» y «hasta» en un mes: el primer clic marca el inicio y el
 * segundo el fin (si es anterior al inicio, pasa a ser el inicio). Lo que se
 * escriba en los campos Desde y Hasta se ve marcado aquí, y lo que se elija
 * aquí llena esos campos: los dos muestran siempre lo mismo.
 *
 * Con el teclado la grilla es una sola parada de Tab: las flechas mueven el
 * cursor (ver `navegacionCalendario.js`) y Enter o Espacio eligen el día.
 */
export function CalendarioDeRango({ desde, hasta, onCambio }) {
  const [mes, setMes] = useState(() =>
    primeroDelMes(esFecha(desde) ? desde : iso(new Date())),
  );
  // Tras el primer clic se espera el segundo, que cierra el rango.
  const [esperandoFin, setEsperandoFin] = useState(false);
  // El día donde está el cursor del teclado (el único con Tab).
  const [cursor, setCursor] = useState(null);
  const botones = useRef(new Map());
  const enfocar = useRef(false);

  // Si «desde» se escribe en el campo y cae en otro mes, el calendario lo sigue.
  useEffect(() => {
    if (!esFecha(desde)) return;
    const objetivo = primeroDelMes(desde);
    setMes((actual) =>
      actual.getTime() === objetivo.getTime() ? actual : objetivo,
    );
  }, [desde]);

  const valido = esFecha(desde) && esFecha(hasta) && desde <= hasta;
  const titulo = conMayuscula(
    mes.toLocaleDateString("es-EC", { month: "long", year: "numeric" }),
  );
  const hoy = iso(new Date());
  const dias = seisSemanas(mes);
  const aLaVista = (clave) => dias.some((d) => iso(d) === clave);
  // El que recibe el Tab: el cursor, si no el inicio del rango, si no hoy, si
  // no el 1 del mes; siempre uno que esté a la vista.
  const enfocable = [cursor, esFecha(desde) ? desde : null, hoy, iso(mes)].find(
    (c) => c && aLaVista(c),
  );

  useEffect(() => {
    if (!enfocar.current || !cursor) return;
    enfocar.current = false;
    botones.current.get(cursor)?.focus();
  }, [cursor, mes]);

  function teclaEnDia(evento, dia) {
    const nueva = fechaPorTecla(dia, evento.key);
    if (!nueva) return;
    evento.preventDefault();
    const clave = iso(nueva);
    if (!aLaVista(clave) || evento.key.startsWith("Page")) {
      setMes(new Date(nueva.getFullYear(), nueva.getMonth(), 1));
    }
    enfocar.current = true;
    setCursor(clave);
  }

  function elegir(clave) {
    if (!esperandoFin || !esFecha(desde) || clave < desde) {
      onCambio({ desde: clave, hasta: clave });
      setEsperandoFin(true);
    } else {
      onCambio({ desde, hasta: clave });
      setEsperandoFin(false);
    }
  }

  function cambiarMes(delta) {
    setMes((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  return (
    <div className="calendario calendario-rango">
      <div className="calendario__cabecera">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          aria-label="Mes anterior"
          onClick={() => cambiarMes(-1)}
        >
          <Icon name="chevron-left" />
        </button>
        <strong className="calendario__mes">{titulo}</strong>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          aria-label="Mes siguiente"
          onClick={() => cambiarMes(1)}
        >
          <Icon name="chevron-right" />
        </button>
      </div>
      <div
        className="calendario__grilla"
        role="grid"
        aria-label={`Elegir fechas: ${titulo}`}
      >
        <div className="calendario__fila" role="row">
          {DIAS.map((d) => (
            <span
              key={d}
              className="calendario__dia-semana"
              role="columnheader"
            >
              {d}
            </span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, semana) => (
          <div className="calendario__fila" role="row" key={semana}>
            {dias.slice(semana * 7, semana * 7 + 7).map((dia) => {
              const clave = iso(dia);
              const dentro = valido && clave >= desde && clave <= hasta;
              const inicio = valido && clave === desde;
              const fin = valido && clave === hasta;
              return (
                <button
                  key={clave}
                  ref={(nodo) =>
                    nodo
                      ? botones.current.set(clave, nodo)
                      : botones.current.delete(clave)
                  }
                  type="button"
                  role="gridcell"
                  tabIndex={clave === enfocable ? 0 : -1}
                  aria-selected={dentro}
                  aria-current={clave === hoy ? "date" : undefined}
                  aria-label={dia.toLocaleDateString("es-EC", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                  className={[
                    "calendario__dia",
                    dia.getMonth() !== mes.getMonth() &&
                      "calendario__dia--fuera",
                    clave === hoy && "calendario__dia--hoy",
                    dentro && "calendario-rango__dentro",
                    inicio && "calendario-rango__inicio",
                    fin && "calendario-rango__fin",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    setCursor(clave);
                    elegir(clave);
                  }}
                  onKeyDown={(e) => teclaEnDia(e, dia)}
                >
                  <span>{dia.getDate()}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p
        className="calendario-rango__ayuda mz-faint mz-small"
        aria-live="polite"
      >
        {esperandoFin
          ? "Ahora elija el último día."
          : "Elija el primer día y luego el último."}
      </p>
    </div>
  );
}
