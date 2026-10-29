import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { conMayuscula, fechaPorTecla } from "./navegacionCalendario";

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
    icono: "gift",
    tipos: ["cumpleanos", "aniversario"],
  },
};

/** Si un evento va en la pestaña elegida («todo», en el mes, va todo). */
function enGrupo(evento, grupo) {
  const tipos = GRUPOS_DE_EVENTO[grupo]?.tipos;
  return !tipos || tipos.includes(evento.tipo);
}

/** El id de la pestaña de un grupo, para que su panel la nombre. */
const idDePestana = (base, grupo) => `${base}-pestana-${grupo}`;

/**
 * Las pestañas, cada una con cuántas fechas tiene en lo que se muestra.
 * Patrón Tabs de WAI-ARIA (auditoría UX/UI, 27/10/2026): una sola parada de
 * Tab, las flechas (e Inicio / Fin) cambian de pestaña y cada una dice qué
 * panel controla.
 */
function PestanasDeEventos({
  grupo,
  onCambio,
  cuentas,
  conTodo = false,
  idBase,
  panelId,
}) {
  const opciones = Object.entries(GRUPOS_DE_EVENTO);
  if (conTodo) opciones.push(["todo", { nombre: "Todo", icono: "grid" }]);
  const ids = opciones.map(([id]) => id);
  const botones = useRef({});

  function teclas(evento) {
    const actual = ids.indexOf(grupo);
    const destino = {
      ArrowRight: (actual + 1) % ids.length,
      ArrowLeft: (actual - 1 + ids.length) % ids.length,
      Home: 0,
      End: ids.length - 1,
    }[evento.key];
    if (destino === undefined) return;
    evento.preventDefault();
    onCambio(ids[destino]);
    botones.current[ids[destino]]?.focus();
  }

  return (
    <div
      className="mz-tabs calendario__pestanas"
      role="tablist"
      aria-label="Qué fechas ver"
    >
      {opciones.map(([id, g]) => (
        <button
          key={id}
          ref={(nodo) => {
            botones.current[id] = nodo;
          }}
          id={idDePestana(idBase, id)}
          type="button"
          role="tab"
          aria-selected={grupo === id}
          aria-controls={panelId}
          tabIndex={grupo === id ? 0 : -1}
          className={grupo === id ? "is-active" : undefined}
          onClick={() => onCambio(id)}
          onKeyDown={teclas}
        >
          <Icon name={g.icono} /> {g.nombre}
          {cuentas?.[id] > 0 && (
            <span className="mz-tabs__cuenta">
              {cuentas[id]}
              <span className="visually-hidden">
                {cuentas[id] === 1 ? " fecha" : " fechas"}
              </span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Si las fechas no cargaron: decirlo, y no «sin eventos», que sería falso
 * (auditoría UX/UI, 27/10/2026). */
function ErrorDelCalendario({ onReintentar }) {
  return (
    <div className="mz-alert mz-alert--bad mz-alert--accion" role="alert">
      <Icon name="x-octagon" />
      <span>No pudimos cargar el calendario.</span>
      <button
        type="button"
        className="btn btn-sm btn-outline-danger ms-auto"
        onClick={onReintentar}
      >
        <Icon name="arrow-clockwise" /> Reintentar
      </button>
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

/** «del 16 al 17 de febrero»; con meses distintos, cada uno con el suyo. */
function rango(desde, hasta) {
  if (desde.slice(0, 7) === hasta.slice(0, 7))
    return `del ${Number(desde.slice(8))} al ${diaYMes(hasta)}`;
  return `del ${diaYMes(desde)} al ${diaYMes(hasta)}`;
}

/** «Lunes, 2 de noviembre». */
function diaCompleto(fecha) {
  return conMayuscula(
    new Date(`${fecha}T00:00:00`).toLocaleDateString("es-EC", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
  );
}

/** Tipo, duración y si se repite: lo que acompaña al título de una fecha;
 * con `fecha`, también el día (en «Próximas fechas»). El tipo va siempre en
 * texto, no solo en el ícono (auditoría UX/UI, 29/10/2026). */
function datosDelEvento(e, { conDia = false } = {}) {
  const varios = e.fecha_fin && e.fecha_fin !== e.fecha;
  return [
    TIPOS_EN_CALENDARIO[e.tipo]?.nombre,
    varios
      ? rango(e.fecha, e.fecha_fin)
      : conDia
        ? diaCompleto(e.fecha).toLowerCase()
        : null,
    e.cada_anio ? "cada año" : null,
  ]
    .filter(Boolean)
    .join(" · ");
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

/** Lo que tiene un día, con el ícono de cada tipo: en la grilla del mes los
 * tipos no se distinguen solo por el color (auditoría UX/UI, 27/10/2026). */
function MarcasDelDia({ eventos }) {
  if (!eventos.length) return null;
  const cuantos = {};
  for (const e of eventos) cuantos[e.tipo] = (cuantos[e.tipo] ?? 0) + 1;
  return (
    <span className="calendario__marcas" aria-hidden="true">
      {Object.entries(cuantos).map(([t, n]) => (
        <span key={t} className="calendario__marca-grupo">
          <Icon
            name={TIPOS_EN_CALENDARIO[t]?.icono ?? "star-fill"}
            className={`calendario__marca calendario__marca--${t}`}
          />
          {/* Varias fechas del mismo tipo: cuántas más, junto a su ícono. */}
          {n > 1 && <span className="calendario__mas">+{n - 1}</span>}
        </span>
      ))}
    </span>
  );
}

/** Dónde cae un día dentro de un feriado de varios días, para unir sus
 * celdas como un solo tramo. */
function tramoDeFeriado(eventos, clave) {
  const largo = eventos.find(
    (e) => e.tipo === "feriado" && e.fecha_fin && e.fecha_fin !== e.fecha,
  );
  if (!largo) return null;
  if (clave === largo.fecha) return "inicio";
  if (clave === largo.fecha_fin) return "fin";
  return "medio";
}

/**
 * El calendario del mes, ampliado: los días con eventos importantes,
 * cumpleaños y feriados marcados con el ícono de su tipo. Se cambia de mes con
 * los botones (u «Hoy» para volver); al tocar un día se listan sus fechas con
 * su detalle. Con el teclado la grilla es una sola parada de Tab y se recorre
 * con las flechas (ver `navegacionCalendario.js`).
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
  const [estado, setEstado] = useState("cargando");
  const idBase = useId();
  const panelId = `${idBase}-panel`;
  const tituloId = `${idBase}-titulo`;
  const botones = useRef(new Map());
  const detalle = useRef(null);
  const enfocar = useRef(false);

  const dias = useMemo(
    () => semanasDelMes(mes.getFullYear(), mes.getMonth()),
    [mes],
  );
  // El día que recibe el Tab: el elegido si está a la vista; si no, el 1.
  const enfocable = dias.some((d) => iso(d) === elegido) ? elegido : iso(mes);

  // Tras moverse con el teclado, el foco sigue al día (aunque cambie el mes).
  useEffect(() => {
    if (!enfocar.current) return;
    enfocar.current = false;
    botones.current.get(elegido)?.focus();
  }, [elegido, dias]);

  function teclaEnDia(evento, dia) {
    const nueva = fechaPorTecla(dia, evento.key);
    if (!nueva) return;
    evento.preventDefault();
    if (
      nueva.getMonth() !== mes.getMonth() ||
      nueva.getFullYear() !== mes.getFullYear()
    ) {
      const aLaVista = dias.some((d) => iso(d) === iso(nueva));
      if (!aLaVista || evento.key.startsWith("Page")) {
        setMes(new Date(nueva.getFullYear(), nueva.getMonth(), 1));
      }
    }
    enfocar.current = true;
    setElegido(iso(nueva));
  }

  const cargar = useCallback(() => {
    let vigente = true;
    setEstado("cargando");
    Promise.resolve(
      institucionalService.calendario?.(iso(dias[0]), iso(dias[41])),
    )
      .then((lista) => {
        if (!vigente) return;
        setApariciones(Array.isArray(lista) ? lista : []);
        setEstado("listo");
      })
      .catch(() => {
        if (!vigente) return;
        setApariciones([]);
        setEstado("error");
      });
    return () => {
      vigente = false;
    };
  }, [dias]);

  useEffect(() => cargar(), [cargar]);

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
  // Las pestañas cuentan solo lo que cae en el mes, no lo de los días de los
  // meses vecinos que completan la grilla (auditoría UX/UI, 29/10/2026).
  const inicioMes = iso(mes);
  const finMes = iso(new Date(mes.getFullYear(), mes.getMonth() + 1, 0));
  const enElMes = useMemo(
    () =>
      delMes.filter(
        (a) => (a.fecha_fin || a.fecha) >= inicioMes && a.fecha <= finMes,
      ),
    [delMes, inicioMes, finMes],
  );
  const cuentas = contar(enElMes);
  const mapa = useMemo(() => porDia(visibles), [visibles]);
  const delDia = mapa[elegido] ?? [];
  const leyenda = Object.entries(TIPOS_EN_CALENDARIO).filter(([id]) =>
    enGrupo({ tipo: id }, grupo),
  );
  const titulo = conMayuscula(
    mes.toLocaleDateString("es-EC", { month: "long", year: "numeric" }),
  );
  const nombreMes = mes.toLocaleDateString("es-EC", { month: "long" });
  const enHoy =
    elegido === hoyIso &&
    mes.getMonth() === hoy.getMonth() &&
    mes.getFullYear() === hoy.getFullYear();

  /** Cambia de mes y lleva el día elegido con él (el mismo número de día, u
   * hoy si se vuelve al mes actual): el detalle no queda en otro mes. */
  function cambiarMes(delta) {
    const nuevo = new Date(mes.getFullYear(), mes.getMonth() + delta, 1);
    setMes(nuevo);
    const esElDeHoy =
      nuevo.getMonth() === hoy.getMonth() &&
      nuevo.getFullYear() === hoy.getFullYear();
    const ultimo = new Date(
      nuevo.getFullYear(),
      nuevo.getMonth() + 1,
      0,
    ).getDate();
    const dia = Math.min(Number(elegido.slice(8)), ultimo);
    setElegido(
      esElDeHoy
        ? hoyIso
        : iso(new Date(nuevo.getFullYear(), nuevo.getMonth(), dia)),
    );
  }

  function elegir(clave) {
    setElegido(clave);
    // En el teléfono el detalle queda bajo la grilla: se trae a la vista.
    requestAnimationFrame(() =>
      detalle.current?.scrollIntoView?.({ block: "nearest" }),
    );
  }

  const resumenDelMes =
    estado !== "listo"
      ? ""
      : `${titulo}: ${
          cuentas[grupo]
            ? `${cuentas[grupo]} ${cuentas[grupo] === 1 ? "fecha" : "fechas"}`
            : "sin fechas"
        }.`;

  return (
    <section className="calendario" aria-labelledby={tituloId}>
      <div className="calendario__cabecera">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          disabled={enHoy}
          onClick={() => {
            setMes(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
            setElegido(hoyIso);
          }}
        >
          Hoy
        </button>
        <h4 id={tituloId} className="calendario__mes">
          {titulo}
        </h4>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          aria-label="Mes anterior"
          onClick={() => cambiarMes(-1)}
        >
          <Icon name="chevron-left" />
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          aria-label="Mes siguiente"
          onClick={() => cambiarMes(1)}
        >
          <Icon name="chevron-right" />
        </button>
      </div>
      {/* Solo se anuncia el mes y cuántas fechas tiene; cada día ya se
          anuncia al enfocarlo (auditoría UX/UI, 29/10/2026). */}
      <p className="visually-hidden" aria-live="polite">
        {resumenDelMes}
      </p>

      <PestanasDeEventos
        grupo={grupo}
        onCambio={setGrupo}
        cuentas={cuentas}
        conTodo
        idBase={idBase}
        panelId={panelId}
      />
      {estado === "error" && <ErrorDelCalendario onReintentar={cargar} />}

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={idDePestana(idBase, grupo)}
      >
        <div
          className="calendario__grilla"
          role="grid"
          aria-label={titulo}
          aria-busy={estado === "cargando"}
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
                const eventos = mapa[clave] ?? [];
                const tipos = [...new Set(eventos.map((e) => e.tipo))];
                const fuera = dia.getMonth() !== mes.getMonth();
                const feriado = tipos.includes("feriado");
                const tramo = feriado ? tramoDeFeriado(eventos, clave) : null;
                const nombreDia = dia.toLocaleDateString("es-EC", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                });
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
                    aria-selected={clave === elegido}
                    aria-current={clave === hoyIso ? "date" : undefined}
                    aria-label={`${nombreDia}${
                      eventos.length
                        ? `: ${eventos
                            .map(
                              (e) =>
                                `${TIPOS_EN_CALENDARIO[e.tipo]?.nombre ?? "Evento"}, ${e.titulo}`,
                            )
                            .join("; ")}`
                        : ""
                    }`}
                    className={[
                      "calendario__dia",
                      fuera && "calendario__dia--fuera",
                      feriado && "calendario__dia--feriado",
                      tramo && `calendario__dia--tramo-${tramo}`,
                      clave === hoyIso && "calendario__dia--hoy",
                      clave === elegido && "calendario__dia--elegido",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => elegir(clave)}
                    onKeyDown={(e) => teclaEnDia(e, dia)}
                  >
                    <span>{dia.getDate()}</span>
                    <MarcasDelDia eventos={eventos} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="calendario__leyenda" aria-hidden="true">
          {leyenda.map(([id, t]) => (
            <span key={id}>
              <Icon
                name={t.icono}
                className={`calendario__marca calendario__marca--${id}`}
              />{" "}
              {t.nombre}
            </span>
          ))}
        </div>
        {estado === "listo" && !cuentas[grupo] && (
          <p className="mz-faint mz-small mb-2">
            {grupo === "celebraciones"
              ? `No hay celebraciones en ${nombreMes}.`
              : grupo === "importantes"
                ? `No hay eventos ni feriados en ${nombreMes}.`
                : `No hay fechas en ${nombreMes}.`}
          </p>
        )}

        <div className="calendario__detalle" ref={detalle}>
          <strong>{diaCompleto(elegido)}</strong>
          {estado === "cargando" ? (
            <p className="mz-faint mb-0">Cargando fechas…</p>
          ) : estado === "error" ? (
            <p className="mz-faint mb-0">No se pudieron cargar las fechas.</p>
          ) : delDia.length === 0 ? (
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
                <small>{datosDelEvento(e)}</small>
                {e.descripcion && <small>{e.descripcion}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Si hoy y mañana no tienen nada: lo que viene en los próximos 30 días,
 * para que la columna no quede en blanco (auditoría UX/UI, 27/10/2026). */
function ProximasFechas({ eventos }) {
  if (!eventos.length) return null;
  return (
    <div className="calendario-resumen__dia calendario-resumen__proximas">
      <strong>Próximas fechas</strong>
      <ul className="calendario__eventos">
        {eventos.map((e) => (
          <li key={`${e.id}-${e.fecha}`}>
            <span className={`calendario__icono calendario__icono--${e.tipo}`}>
              <Icon name={TIPOS_EN_CALENDARIO[e.tipo]?.icono ?? "star-fill"} />
            </span>
            <span>
              <strong>{e.titulo}</strong>
              <small>{datosDelEvento(e, { conDia: true })}</small>
            </span>
          </li>
        ))}
      </ul>
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
        className="mz-modal mz-modal--wide calendario-ventana"
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
  // Se piden 30 días: hoy y mañana, y lo que viene si estos están vacíos.
  const limiteIso = iso(
    new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 30),
  );
  const [apariciones, setApariciones] = useState([]);
  const idBase = useId();
  const panelId = `${idBase}-panel`;
  const [estado, setEstado] = useState("cargando");
  const [ampliado, setAmpliado] = useState(false);
  const lista = useRef(null);
  const [reintento, setReintento] = useState(false);
  const [grupo, setGrupo] = useState("importantes");

  const cargar = useCallback(() => {
    let vigente = true;
    setEstado("cargando");
    Promise.resolve(institucionalService.calendario?.(hoyIso, limiteIso))
      .then((lista) => {
        if (!vigente) return;
        setApariciones(Array.isArray(lista) ? lista : []);
        setEstado("listo");
      })
      .catch(() => vigente && setEstado("error"));
    return () => {
      vigente = false;
    };
  }, [hoyIso, limiteIso]);

  useEffect(() => cargar(), [cargar]);

  useEffect(() => {
    if (reintento && estado !== "cargando") {
      lista.current?.focus();
      setReintento(false);
    }
  }, [reintento, estado]);

  const mapa = useMemo(() => porDia(apariciones), [apariciones]);
  const deHoy = mapa[hoyIso] ?? [];
  const deManana = mapa[mananaIso] ?? [];
  // Cada fecha una vez, aunque caiga hoy y mañana (las de varios días).
  const cuentas = contar([
    ...new Map([...deHoy, ...deManana].map((e) => [e.id, e])).values(),
  ]);
  const vacio =
    grupo === "celebraciones" ? "Sin celebraciones." : "Sin eventos.";
  const deHoyEnGrupo = deHoy.filter((e) => enGrupo(e, grupo));
  const deMananaEnGrupo = deManana.filter((e) => enGrupo(e, grupo));
  const proximas =
    deHoyEnGrupo.length || deMananaEnGrupo.length
      ? []
      : apariciones
          .filter((a) => a.fecha > mananaIso && enGrupo(a, grupo))
          .sort((a, b) => a.fecha.localeCompare(b.fecha))
          .slice(0, 3);

  return (
    <div className="calendario calendario-resumen">
      <PestanasDeEventos
        grupo={grupo}
        onCambio={setGrupo}
        cuentas={cuentas}
        idBase={idBase}
        panelId={panelId}
      />
      <div
        id={panelId}
        className="calendario-resumen__lista"
        role="tabpanel"
        aria-labelledby={idDePestana(idBase, grupo)}
        ref={lista}
        tabIndex={-1}
      >
        {estado === "cargando" ? (
          <div
            className="inicio-esqueleto inicio-esqueleto--lineas"
            role="status"
          >
            <span />
            <span />
            <span />
            <span className="visually-hidden">Cargando el calendario…</span>
          </div>
        ) : estado === "error" ? (
          <ErrorDelCalendario
            onReintentar={() => {
              setReintento(true);
              cargar();
            }}
          />
        ) : (
          <>
            <ListaDelDia
              etiqueta="Hoy"
              fecha={hoyIso}
              eventos={deHoyEnGrupo}
              vacio={vacio}
            />
            <ListaDelDia
              etiqueta="Mañana"
              fecha={mananaIso}
              eventos={deMananaEnGrupo}
              vacio={vacio}
            />
            <ProximasFechas eventos={proximas} />
            {!deHoyEnGrupo.length &&
              !deMananaEnGrupo.length &&
              !proximas.length && (
                <p className="mz-faint mz-small mb-0">
                  Nada en los próximos 30 días.
                </p>
              )}
          </>
        )}
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
    </div>
  );
}
