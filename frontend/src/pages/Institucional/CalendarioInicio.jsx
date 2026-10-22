import { useEffect, useMemo, useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** Cada tipo con su color e ícono, en el calendario y en su leyenda. */
export const TIPOS_DE_EVENTO = {
  evento: { nombre: "Evento", icono: "star-fill" },
  cumpleanos: { nombre: "Cumpleaños", icono: "gift-fill" },
  feriado: { nombre: "Feriado", icono: "flag-fill" },
};

/** Lo que muestra el calendario: los tipos que se cargan a mano y los que
 * salen solos de «Mi perfil» (los aniversarios en la empresa). */
export const TIPOS_EN_CALENDARIO = {
  ...TIPOS_DE_EVENTO,
  aniversario: { nombre: "Aniversario", icono: "award-fill" },
};

/** Las pestañas del calendario (22/10/2026): los eventos importantes y los
 * feriados por un lado, y las celebraciones de las personas (cumpleaños y
 * aniversarios) por otro, para que estas no tapen a aquellos. */
export const GRUPOS_DE_EVENTO = {
  importantes: {
    nombre: "Eventos y feriados",
    icono: "calendar-event",
    tipos: ["evento", "feriado"],
  },
  celebraciones: {
    nombre: "Celebraciones",
    icono: "balloon-heart",
    tipos: ["cumpleanos", "aniversario"],
  },
};

/** Si un evento va en la pestaña elegida («todo», en el mes, va todo). */
function enGrupo(evento, grupo) {
  const tipos = GRUPOS_DE_EVENTO[grupo]?.tipos;
  return !tipos || tipos.includes(evento.tipo);
}

/** Las pestañas, cada una con cuántas fechas tiene en lo que se muestra. */
function PestanasDeEventos({ grupo, onCambio, cuentas, conTodo = false }) {
  const opciones = Object.entries(GRUPOS_DE_EVENTO);
  if (conTodo) opciones.push(["todo", { nombre: "Todo", icono: "grid" }]);
  return (
    <div
      className="mz-tabs calendario__pestanas"
      role="tablist"
      aria-label="Qué fechas ver"
    >
      {opciones.map(([id, g]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={grupo === id}
          className={grupo === id ? "is-active" : undefined}
          onClick={() => onCambio(id)}
        >
          <Icon name={g.icono} /> {g.nombre}
          {cuentas?.[id] > 0 && (
            <span className="calendario__cuenta">{cuentas[id]}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Cuántas fechas de cada pestaña hay en una lista de eventos. */
function contar(eventos) {
  const cuentas = { todo: eventos.length };
  for (const id of Object.keys(GRUPOS_DE_EVENTO))
    cuentas[id] = eventos.filter((e) => enGrupo(e, id)).length;
  return cuentas;
}

/** AAAA-MM-DD de una fecha local (sin pasar por UTC, que correría el día). */
export function iso(fecha) {
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${m}-${d}`;
}

function diaYMes(fecha) {
  return new Date(`${fecha}T00:00:00`).toLocaleDateString("es-EC", {
    day: "numeric",
    month: "long",
  });
}

/** Tipo, duración y si se repite: lo que acompaña al título de una fecha. */
function datosDelEvento(e) {
  return [
    TIPOS_EN_CALENDARIO[e.tipo]?.nombre,
    e.fecha_fin && e.fecha_fin !== e.fecha
      ? `del ${diaYMes(e.fecha)} al ${diaYMes(e.fecha_fin)}`
      : null,
    e.cada_anio ? "cada año" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Una línea por fecha, para el globo que sale al pasar sobre un día. */
function detalleCorto(e) {
  const tipo = TIPOS_EN_CALENDARIO[e.tipo]?.nombre ?? e.tipo;
  return `${tipo}: ${e.titulo}${e.descripcion ? ` — ${e.descripcion}` : ""}`;
}

/** Las 6 semanas que se dibujan para un mes, empezando el lunes. */
function semanasDelMes(anio, mes) {
  const primero = new Date(anio, mes, 1);
  const corrimiento = (primero.getDay() + 6) % 7; // lunes = 0
  const inicio = new Date(anio, mes, 1 - corrimiento);
  return Array.from(
    { length: 42 },
    (_, i) =>
      new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i),
  );
}

/** Cada día (AAAA-MM-DD) con lo que cae en él, incluidos los de varios días. */
function porDia(apariciones) {
  const mapa = {};
  for (const a of apariciones) {
    const [ai, mi, di] = a.fecha.split("-").map(Number);
    const fin = a.fecha_fin || a.fecha;
    for (
      let d = new Date(ai, mi - 1, di);
      iso(d) <= fin;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    ) {
      (mapa[iso(d)] ??= []).push(a);
    }
  }
  return mapa;
}

/**
 * El calendario del mes, ampliado: los días con eventos importantes,
 * cumpleaños y feriados marcados con puntos de color. Se cambia de mes con las
 * flechas (u «Hoy» para volver); al pasar sobre un día se ve qué tiene, y al
 * tocarlo se listan sus fechas con su detalle.
 */
export function CalendarioMes({
  hoy = new Date(),
  grupoInicial = "importantes",
}) {
  const hoyIso = iso(hoy);
  const [grupo, setGrupo] = useState(grupoInicial);
  const [mes, setMes] = useState(
    () => new Date(hoy.getFullYear(), hoy.getMonth(), 1),
  );
  const [elegido, setElegido] = useState(hoyIso);
  const [apariciones, setApariciones] = useState([]);

  const dias = useMemo(
    () => semanasDelMes(mes.getFullYear(), mes.getMonth()),
    [mes],
  );

  useEffect(() => {
    let vigente = true;
    Promise.resolve(
      institucionalService.calendario?.(iso(dias[0]), iso(dias[41])),
    )
      .then(
        (lista) => vigente && setApariciones(Array.isArray(lista) ? lista : []),
      )
      .catch(() => vigente && setApariciones([]));
    return () => {
      vigente = false;
    };
  }, [dias]);

  const delMes = useMemo(
    () =>
      apariciones.filter(
        (a) =>
          (a.fecha_fin || a.fecha) >= iso(dias[0]) && a.fecha <= iso(dias[41]),
      ),
    [apariciones, dias],
  );
  const visibles = useMemo(
    () => delMes.filter((a) => enGrupo(a, grupo)),
    [delMes, grupo],
  );
  const mapa = useMemo(() => porDia(visibles), [visibles]);
  const delDia = mapa[elegido] ?? [];
  const leyenda = Object.entries(TIPOS_EN_CALENDARIO).filter(([id]) =>
    enGrupo({ tipo: id }, grupo),
  );
  const titulo = mes.toLocaleDateString("es-EC", {
    month: "long",
    year: "numeric",
  });

  function cambiarMes(delta) {
    setMes((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  return (
    <section className="calendario" aria-labelledby="calendario-titulo">
      <div className="calendario__cabecera">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          aria-label="Mes anterior"
          onClick={() => cambiarMes(-1)}
        >
          <Icon name="chevron-left" />
        </button>
        <h3 id="calendario-titulo" className="calendario__mes">
          {titulo}
        </h3>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          aria-label="Mes siguiente"
          onClick={() => cambiarMes(1)}
        >
          <Icon name="chevron-right" />
        </button>
        <button
          type="button"
          className="btn btn-sm btn-link"
          onClick={() => {
            setMes(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
            setElegido(hoyIso);
          }}
        >
          Hoy
        </button>
      </div>

      <PestanasDeEventos
        grupo={grupo}
        onCambio={setGrupo}
        cuentas={contar(delMes)}
        conTodo
      />

      <div className="calendario__grilla" role="grid" aria-label={titulo}>
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
              const eventos = mapa[clave] ?? [];
              const tipos = [...new Set(eventos.map((e) => e.tipo))];
              const fuera = dia.getMonth() !== mes.getMonth();
              const nombreDia = dia.toLocaleDateString("es-EC", {
                day: "numeric",
                month: "long",
              });
              return (
                <button
                  key={clave}
                  type="button"
                  role="gridcell"
                  aria-selected={clave === elegido}
                  aria-label={`${nombreDia}${
                    eventos.length
                      ? `: ${eventos.map((e) => e.titulo).join(", ")}`
                      : ""
                  }`}
                  className={[
                    "calendario__dia",
                    fuera && "calendario__dia--fuera",
                    clave === hoyIso && "calendario__dia--hoy",
                    clave === elegido && "calendario__dia--elegido",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={
                    eventos.length
                      ? eventos.map((e) => detalleCorto(e)).join("\n")
                      : undefined
                  }
                  onClick={() => setElegido(clave)}
                >
                  <span>{dia.getDate()}</span>
                  {tipos.length > 0 && (
                    <span className="calendario__marcas" aria-hidden="true">
                      {tipos.map((t) => (
                        <span
                          key={t}
                          className={`calendario__marca calendario__marca--${t}`}
                        />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="calendario__leyenda" aria-hidden="true">
        {leyenda.map(([id, t]) => (
          <span key={id}>
            <span className={`calendario__marca calendario__marca--${id}`} />{" "}
            {t.nombre}
          </span>
        ))}
      </div>

      <div className="calendario__detalle" aria-live="polite">
        <strong>
          {new Date(`${elegido}T00:00:00`).toLocaleDateString("es-EC", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </strong>
        {delDia.length === 0 ? (
          <p className="mz-faint mb-0">
            {grupo === "celebraciones"
              ? "Sin celebraciones este día."
              : "Sin eventos este día."}
          </p>
        ) : (
          <ul className="calendario__eventos">
            {delDia.map((e) => (
              <li key={`${e.id}-${e.fecha}`}>
                <span
                  className={`calendario__icono calendario__icono--${e.tipo}`}
                >
                  <Icon
                    name={TIPOS_EN_CALENDARIO[e.tipo]?.icono ?? "star-fill"}
                  />
                </span>
                <span>
                  <strong>{e.titulo}</strong>
                  <small>{datosDelEvento(e)}</small>
                  {e.descripcion && <small>{e.descripcion}</small>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Las fechas de un día, en texto, para el resumen. */
function ListaDelDia({ etiqueta, fecha, eventos, vacio = "Sin eventos." }) {
  const nombre = new Date(`${fecha}T00:00:00`).toLocaleDateString("es-EC", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return (
    <div className="calendario-resumen__dia">
      <strong>
        {etiqueta} <span className="mz-faint">· {nombre}</span>
      </strong>
      {eventos.length === 0 ? (
        <p className="mz-faint mb-0">{vacio}</p>
      ) : (
        <ul className="calendario__eventos">
          {eventos.map((e) => (
            <li key={`${e.id}-${e.fecha}`}>
              <span
                className={`calendario__icono calendario__icono--${e.tipo}`}
              >
                <Icon
                  name={TIPOS_EN_CALENDARIO[e.tipo]?.icono ?? "star-fill"}
                />
              </span>
              <span>
                <strong>{e.titulo}</strong>
                {e.descripcion && <small>{e.descripcion}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** El calendario del mes en una ventana grande. */
function VentanaCalendario({ hoy, grupo, onCerrar }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Calendario"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>
            <Icon name="calendar3" /> Calendario
          </h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar calendario"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body">
          <CalendarioMes hoy={hoy} grupoInicial={grupo} />
        </div>
      </div>
    </div>
  );
}

/**
 * El calendario de Inicio, recogido: en texto, lo de hoy y lo de mañana, en
 * dos pestañas —eventos y feriados, y celebraciones de las personas— para que
 * los cumpleaños no saturen lo importante. El botón «Ver calendario» lo
 * amplía al mes completo, en la misma pestaña.
 */
export function CalendarioInicio({ hoy = new Date() }) {
  const hoyIso = iso(hoy);
  const mananaIso = iso(
    new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1),
  );
  const [apariciones, setApariciones] = useState([]);
  const [ampliado, setAmpliado] = useState(false);
  const [grupo, setGrupo] = useState("importantes");

  useEffect(() => {
    let vigente = true;
    Promise.resolve(institucionalService.calendario?.(hoyIso, mananaIso))
      .then(
        (lista) => vigente && setApariciones(Array.isArray(lista) ? lista : []),
      )
      .catch(() => vigente && setApariciones([]));
    return () => {
      vigente = false;
    };
  }, [hoyIso, mananaIso]);

  const mapa = useMemo(() => porDia(apariciones), [apariciones]);
  const deHoy = mapa[hoyIso] ?? [];
  const deManana = mapa[mananaIso] ?? [];
  // Cada fecha una vez, aunque caiga hoy y mañana (las de varios días).
  const cuentas = contar([
    ...new Map([...deHoy, ...deManana].map((e) => [e.id, e])).values(),
  ]);
  const vacio =
    grupo === "celebraciones" ? "Sin celebraciones." : "Sin eventos.";

  return (
    <section
      className="calendario calendario-resumen"
      aria-label="Próximos eventos"
    >
      <PestanasDeEventos grupo={grupo} onCambio={setGrupo} cuentas={cuentas} />
      <div className="calendario-resumen__lista" role="tabpanel">
        <ListaDelDia
          etiqueta="Hoy"
          fecha={hoyIso}
          eventos={deHoy.filter((e) => enGrupo(e, grupo))}
          vacio={vacio}
        />
        <ListaDelDia
          etiqueta="Mañana"
          fecha={mananaIso}
          eventos={deManana.filter((e) => enGrupo(e, grupo))}
          vacio={vacio}
        />
      </div>
      <button
        type="button"
        className="btn btn-outline-primary btn-sm calendario-resumen__ampliar"
        onClick={() => setAmpliado(true)}
      >
        <Icon name="arrows-fullscreen" /> Ver calendario
      </button>
      {ampliado && (
        <VentanaCalendario
          hoy={hoy}
          grupo={grupo}
          onCerrar={() => setAmpliado(false)}
        />
      )}
    </section>
  );
}
