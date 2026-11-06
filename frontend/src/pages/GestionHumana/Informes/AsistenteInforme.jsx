/*
 * Asistente de generación de un informe ejecutivo (`ReportWizardModal` de
 * Nexo). Pide el tipo y el período, una fecha de corte opcional (avisando si
 * el mes ya tiene cierre) y filtros que solo ACOTAN el equipo: rol, área y
 * colaboradores. Muestra antes de enviar cuántas personas entrarán, con la
 * misma regla del servidor (`roster/`).
 *
 * Lo que no se porta de Nexo: las «secciones a incluir» y el formato (PDF
 * ejecutivo, completo o Excel). Aquí el informe se guarda congelado con sus
 * once páginas y desde el visor se imprime o se baja a Excel; los filtros
 * rápidos por datos («con riesgo», «destacados») dependían de un informe ya
 * cargado en pantalla.
 *
 * Todo lo valida otra vez el servidor: aquí solo se adelanta el aviso.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { errorDeInformes, informesService } from "../../../api/informesService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { sumarMeses } from "../Desempeno/kpiComunes";
import { ROLES, rolLegible } from "../Tareas/tareasComunes";
import { Ventana } from "../Tareas/Ventanas";
import {
  MAX_DIAS,
  MAX_MESES,
  MIN_MESES,
  TIPO,
  TIPOS,
  TIPO_CIERRE,
  cuerpoDelPedido,
  diaDeHoy,
  fechaLargaUtc,
  inicioDelPeriodo,
  mesDeHoy,
  validarPeriodo,
} from "./informesComunes";

const AYUDA_TIPO = {
  MENSUAL: "Un mes calendario.",
  RANGO_MESES: `De ${MIN_MESES} a ${MAX_MESES} meses completos.`,
  RANGO_PERSONALIZADO: `Entre dos fechas, hasta ${MAX_DIAS} días.`,
};

const ETIQUETA_ROSTER = {
  CONSOLIDADO: "equipo consolidado",
  POR_AREA: "por área o rol",
  INDIVIDUAL: "individual",
};

/** El orden de los campos en pantalla: el foco va al primero con error. */
const ORDEN_CAMPOS = [
  "tipo",
  "mes",
  "desde",
  "hasta",
  "fecha_corte",
  "roles",
  "areas",
  "colaboradores",
];

function valoresIniciales() {
  const actual = mesDeHoy();
  return {
    tipo: "MENSUAL",
    mes: actual,
    // Un trimestre por defecto, como el atajo de Nexo.
    desdeMes: sumarMeses(actual, -2),
    hastaMes: actual,
    desdeDia: "",
    hastaDia: diaDeHoy(),
    fechaCorte: "",
    roles: [],
    areas: [],
    colaboradores: [],
  };
}

function alternar(lista, valor) {
  return lista.includes(valor)
    ? lista.filter((v) => v !== valor)
    : [...lista, valor];
}

/** Un campo con su etiqueta, su ayuda y su error enlazados (WCAG 1.3.1 y
 * 3.3.1): el lector de pantalla los lee al entrar al campo. */
function Campo({ id, etiqueta, ayuda, error, children }) {
  return (
    <div className="mz-field">
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {ayuda && (
        <p id={`${id}-ayuda`} className="mz-small mz-faint mb-0 mt-1">
          {ayuda}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mz-field-error mb-0">
          {error}
        </p>
      )}
    </div>
  );
}

function describir(id, { ayuda, error }) {
  return (
    [ayuda && `${id}-ayuda`, error && `${id}-error`]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

/** El aviso del cierre de mes: si el mes está cerrado, el informe toma esa
 * fecha de corte salvo que se elija otra. */
function AvisoDeCierre({ mes }) {
  const [cierre, setCierre] = useState({ estado: "cargando" });
  useEffect(() => {
    let vigente = true;
    setCierre({ estado: "cargando" });
    informesService
      .estadoDeCierre(mes)
      .then((datos) => vigente && setCierre({ estado: "listo", datos }))
      .catch(() => vigente && setCierre({ estado: "error" }));
    return () => {
      vigente = false;
    };
  }, [mes]);

  if (cierre.estado === "cargando")
    return (
      <p className="mz-small mz-faint mb-0" role="status">
        Consultando el cierre del mes…
      </p>
    );
  if (cierre.estado === "error")
    return (
      <p className="mz-small mz-faint mb-0" role="status">
        No se pudo consultar el cierre del mes. Puede generar igual: el servidor
        aplica el corte del cierre si existe.
      </p>
    );
  const d = cierre.datos;
  if (!d?.closed)
    return (
      <div className="mz-alert mz-alert--info mb-0" role="status">
        <Icon name="calendar" />
        <span>
          Este mes no tiene cierre. Sin fecha de corte, el informe toma lo
          registrado hasta el fin del mes (o hasta hoy, si el mes sigue en
          curso).
        </span>
      </div>
    );
  return (
    <div className="mz-alert mz-alert--info mb-0" role="status">
      <Icon name="calendar-check" />
      <span>
        Este mes está {TIPO_CIERRE[d.closure_type] ?? "cerrado"}, con fecha de
        corte del {fechaLargaUtc(d.cutoff_date)}
        {d.working_days_considered !== null &&
        d.working_days_considered !== undefined
          ? ` (${d.working_days_considered} días hábiles considerados)`
          : ""}
        . Si no elige otra fecha de corte, el informe usará esa.
      </span>
    </div>
  );
}

export function AsistenteInforme({ onCerrar, onGenerado }) {
  const base = useId();
  const ids = {
    mes: `${base}-mes`,
    desde: `${base}-desde`,
    hasta: `${base}-hasta`,
    fecha_corte: `${base}-corte`,
    tipo: `${base}-tipo`,
    roles: `${base}-roles`,
    areas: `${base}-areas`,
    colaboradores: `${base}-colaboradores`,
    buscar: `${base}-buscar`,
    previa: `${base}-previa`,
    formulario: `${base}-formulario`,
  };
  const [valores, setValores] = useState(valoresIniciales);
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const avisoGeneral = useRef(null);

  // El equipo completo de la persona (sin filtros): de él salen las opciones
  // de rol, área y colaboradores, así nunca se ofrece algo fuera de su
  // alcance.
  const [equipo, setEquipo] = useState({ cargando: true });
  const [vezEquipo, setVezEquipo] = useState(0);
  useEffect(() => {
    let vigente = true;
    setEquipo({ cargando: true });
    informesService
      .roster()
      .then((d) => vigente && setEquipo({ datos: d, cargando: false }))
      .catch(
        (err) =>
          vigente &&
          setEquipo({
            cargando: false,
            error: errorDeInformes(
              err,
              "No se pudo cargar su equipo para el informe.",
            ).mensaje,
          }),
      );
    return () => {
      vigente = false;
    };
  }, [vezEquipo]);

  const personas = useMemo(() => equipo.datos?.users ?? [], [equipo.datos]);
  const opcionesRol = useMemo(() => {
    const presentes = new Set(personas.map((p) => p.role).filter(Boolean));
    return ROLES.filter((r) => presentes.has(r));
  }, [personas]);
  const opcionesArea = useMemo(() => {
    const areas = new Map();
    for (const p of personas)
      if (p.unidad_id)
        areas.set(p.unidad_id, p.unidad || `Área ${p.unidad_id}`);
    return [...areas.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [personas]);

  const [buscar, setBuscar] = useState("");
  const visibles = useMemo(() => {
    const texto = buscar.trim().toLowerCase();
    if (!texto) return personas;
    return personas.filter((p) =>
      [p.full_name, p.name, p.cargo, p.unidad]
        .filter(Boolean)
        .some((t) => t.toLowerCase().includes(texto)),
    );
  }, [personas, buscar]);

  // Vista previa: cuántas personas entran con los filtros, preguntada al
  // servidor (la misma regla que aplicará al generar). Con una pausa corta
  // para no pedir en cada clic.
  const hayFiltros =
    valores.roles.length + valores.areas.length + valores.colaboradores.length >
    0;
  const [previa, setPrevia] = useState({ cargando: false });
  useEffect(() => {
    if (!equipo.datos) return undefined;
    if (!hayFiltros) {
      setPrevia({
        cargando: false,
        total: equipo.datos.user_ids?.length ?? personas.length,
        tipo: equipo.datos.roster_kind,
      });
      return undefined;
    }
    let vigente = true;
    setPrevia((p) => ({ ...p, cargando: true, error: null }));
    const temporizador = setTimeout(() => {
      informesService
        .roster({
          roles: valores.roles,
          areas: valores.areas,
          colaboradores: valores.colaboradores,
        })
        .then(
          (d) =>
            vigente &&
            setPrevia({
              cargando: false,
              total: d.user_ids?.length ?? d.users?.length ?? 0,
              tipo: d.roster_kind,
            }),
        )
        .catch(
          (err) =>
            vigente &&
            setPrevia({
              cargando: false,
              error: errorDeInformes(
                err,
                "No se pudo calcular cuántas personas entran.",
              ).mensaje,
            }),
        );
    }, 300);
    return () => {
      vigente = false;
      clearTimeout(temporizador);
    };
  }, [
    equipo.datos,
    personas.length,
    hayFiltros,
    valores.roles,
    valores.areas,
    valores.colaboradores,
  ]);

  function cambiar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    // El error del campo deja de aplicar en cuanto se corrige.
    const clave = {
      desdeMes: "desde",
      desdeDia: "desde",
      hastaMes: "hasta",
      hastaDia: "hasta",
      fechaCorte: "fecha_corte",
    }[campo];
    setErrores((e) => {
      const resto = { ...e };
      delete resto[clave ?? campo];
      return resto;
    });
    setErrorGeneral(null);
  }

  function enfocarPrimerError(campos) {
    const primero = ORDEN_CAMPOS.find((c) => campos[c]);
    if (primero) document.getElementById(ids[primero])?.focus();
  }

  async function generar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const locales = validarPeriodo(valores);
    if (Object.keys(locales).length) {
      setErrores(locales);
      setErrorGeneral(null);
      enfocarPrimerError(locales);
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    setErrores({});
    setErrorGeneral(null);
    try {
      const { informe, nuevo } = await informesService.generar(
        cuerpoDelPedido(valores),
      );
      onGenerado(informe, nuevo);
    } catch (err) {
      const e = errorDeInformes(err, "No se pudo generar el informe.");
      if (e.codigo === "roster_vacio") {
        setErrorGeneral(e.mensaje);
      } else if (Object.keys(e.campos).length) {
        setErrores(e.campos);
        setErrorGeneral(
          e.mensaje || "Revise los datos marcados antes de generar.",
        );
        enfocarPrimerError(e.campos);
        return;
      } else {
        setErrorGeneral(e.mensaje);
      }
      // Sin un campo al que llevar el foco, se lleva al aviso.
      requestAnimationFrame(() => avisoGeneral.current?.focus());
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  const err = (campo) => errores[campo];
  const inicio = inicioDelPeriodo(valores);
  const sinEquipo = equipo.datos && personas.length === 0;
  // Con 0 personas el servidor respondería 422: se avisa y no se ofrece.
  const sinNadie = !previa.cargando && !previa.error && previa.total === 0;

  return (
    <Ventana
      titulo="Generar informe ejecutivo"
      subtitulo="El informe se guarda congelado: después se abre, imprime o descarga sin recalcularse."
      onCerrar={onCerrar}
      bloqueada={enviando}
      ancha
      pie={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onCerrar}
            disabled={enviando}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form={ids.formulario}
            className="btn btn-primary"
            disabled={enviando || equipo.cargando || sinEquipo || sinNadie}
            aria-describedby={sinNadie ? ids.previa : undefined}
          >
            {enviando ? (
              <>
                <span
                  className="spinner-border spinner-border-sm"
                  aria-hidden="true"
                />{" "}
                Generando…
              </>
            ) : (
              <>
                <Icon name="file-earmark-bar-graph" /> Generar informe
              </>
            )}
          </button>
        </>
      }
    >
      <form
        id={ids.formulario}
        className="ie-asistente"
        onSubmit={generar}
        noValidate
        aria-busy={enviando}
      >
        {errorGeneral && (
          <div
            ref={avisoGeneral}
            tabIndex={-1}
            className="mz-alert mz-alert--bad"
            role="alert"
          >
            <Icon name="x-octagon" />
            <span>{errorGeneral}</span>
          </div>
        )}
        {enviando && (
          <p className="mz-small mz-faint mb-0" role="status">
            Generando el informe. Puede tardar unos segundos…
          </p>
        )}

        <fieldset className="ie-asistente__grupo">
          <legend className="ie-asistente__titulo">Tipo de informe</legend>
          <div
            className="gt-opciones"
            id={ids.tipo}
            tabIndex={-1}
            role="radiogroup"
            aria-label="Tipo de informe"
            aria-describedby={err("tipo") ? `${ids.tipo}-error` : undefined}
          >
            {TIPOS.map((t) => (
              <label key={t} className="gt-opcion">
                <input
                  type="radio"
                  name={`${base}-tipo`}
                  value={t}
                  checked={valores.tipo === t}
                  onChange={() => {
                    cambiar("tipo", t);
                    setErrores({});
                  }}
                />
                <span className="gt-opcion__texto">
                  {TIPO[t]}
                  <span className="mz-small d-block">{AYUDA_TIPO[t]}</span>
                </span>
              </label>
            ))}
          </div>
          {err("tipo") && (
            <p id={`${ids.tipo}-error`} className="mz-field-error mb-0">
              {err("tipo")}
            </p>
          )}
        </fieldset>

        <fieldset className="ie-asistente__grupo">
          <legend className="ie-asistente__titulo">Período</legend>
          <div className="mz-field-grid ie-asistente__campos">
            {valores.tipo === "MENSUAL" && (
              <Campo id={ids.mes} etiqueta="Mes" error={err("mes")}>
                <input
                  id={ids.mes}
                  type="month"
                  className="form-control"
                  value={valores.mes}
                  max={mesDeHoy()}
                  onChange={(e) => cambiar("mes", e.target.value)}
                  aria-invalid={Boolean(err("mes"))}
                  aria-describedby={describir(ids.mes, { error: err("mes") })}
                  required
                />
              </Campo>
            )}
            {valores.tipo === "RANGO_MESES" && (
              <>
                <Campo
                  id={ids.desde}
                  etiqueta="Desde (mes)"
                  error={err("desde")}
                >
                  <input
                    id={ids.desde}
                    type="month"
                    className="form-control"
                    value={valores.desdeMes}
                    max={mesDeHoy()}
                    onChange={(e) => cambiar("desdeMes", e.target.value)}
                    aria-invalid={Boolean(err("desde"))}
                    aria-describedby={describir(ids.desde, {
                      error: err("desde"),
                    })}
                    required
                  />
                </Campo>
                <Campo
                  id={ids.hasta}
                  etiqueta="Hasta (mes)"
                  ayuda={`Entre ${MIN_MESES} y ${MAX_MESES} meses, contando los dos extremos.`}
                  error={err("hasta")}
                >
                  <input
                    id={ids.hasta}
                    type="month"
                    className="form-control"
                    value={valores.hastaMes}
                    max={mesDeHoy()}
                    onChange={(e) => cambiar("hastaMes", e.target.value)}
                    aria-invalid={Boolean(err("hasta"))}
                    aria-describedby={describir(ids.hasta, {
                      ayuda: true,
                      error: err("hasta"),
                    })}
                    required
                  />
                </Campo>
              </>
            )}
            {valores.tipo === "RANGO_PERSONALIZADO" && (
              <>
                <Campo id={ids.desde} etiqueta="Desde" error={err("desde")}>
                  <input
                    id={ids.desde}
                    type="date"
                    className="form-control"
                    value={valores.desdeDia}
                    max={diaDeHoy()}
                    onChange={(e) => cambiar("desdeDia", e.target.value)}
                    aria-invalid={Boolean(err("desde"))}
                    aria-describedby={describir(ids.desde, {
                      error: err("desde"),
                    })}
                    required
                  />
                </Campo>
                <Campo
                  id={ids.hasta}
                  etiqueta="Hasta"
                  ayuda={`Hasta ${MAX_DIAS} días desde la fecha de inicio.`}
                  error={err("hasta")}
                >
                  <input
                    id={ids.hasta}
                    type="date"
                    className="form-control"
                    value={valores.hastaDia}
                    onChange={(e) => cambiar("hastaDia", e.target.value)}
                    aria-invalid={Boolean(err("hasta"))}
                    aria-describedby={describir(ids.hasta, {
                      ayuda: true,
                      error: err("hasta"),
                    })}
                    required
                  />
                </Campo>
              </>
            )}
            <Campo
              id={ids.fecha_corte}
              etiqueta="Fecha de corte (opcional)"
              ayuda="Cuenta lo registrado hasta el final de ese día. Si la deja vacía, se usa el corte del cierre de mes o el fin del período (nunca después de hoy)."
              error={err("fecha_corte")}
            >
              <input
                id={ids.fecha_corte}
                type="date"
                className="form-control"
                value={valores.fechaCorte}
                min={inicio ?? undefined}
                max={diaDeHoy()}
                onChange={(e) => cambiar("fechaCorte", e.target.value)}
                aria-invalid={Boolean(err("fecha_corte"))}
                aria-describedby={describir(ids.fecha_corte, {
                  ayuda: true,
                  error: err("fecha_corte"),
                })}
              />
            </Campo>
          </div>
          {valores.tipo === "MENSUAL" && /^\d{4}-\d{2}$/.test(valores.mes) && (
            <AvisoDeCierre mes={valores.mes} />
          )}
        </fieldset>

        <fieldset className="ie-asistente__grupo">
          <legend className="ie-asistente__titulo">
            Colaboradores (opcional)
          </legend>
          <p className="mz-small mz-faint mb-0">
            Sin filtros, el informe incluye a todo su equipo. Los filtros solo
            acotan: nunca suman personas fuera de su alcance.
          </p>
          {equipo.cargando || equipo.error ? (
            <EstadoDeCarga
              cargando={equipo.cargando}
              error={equipo.error}
              onReintentar={() => setVezEquipo((v) => v + 1)}
            />
          ) : sinEquipo ? (
            <div className="mz-alert mz-alert--warn mb-0" role="alert">
              <Icon name="exclamation-triangle" />
              <span>
                No tiene colaboradores en su alcance según el organigrama: no
                hay sobre quién generar un informe.
              </span>
            </div>
          ) : (
            <>
              <div className="ie-asistente__filtros">
                <GrupoDeCasillas
                  id={ids.roles}
                  titulo="Rol"
                  error={err("roles")}
                  opciones={opcionesRol.map((r) => ({
                    valor: r,
                    texto: rolLegible(r),
                  }))}
                  elegidos={valores.roles}
                  onCambio={(r) => cambiar("roles", alternar(valores.roles, r))}
                  vacio="Su equipo no tiene roles de Gestión Humana asignados."
                />
                <GrupoDeCasillas
                  id={ids.areas}
                  titulo="Área"
                  error={err("areas")}
                  opciones={opcionesArea.map((a) => ({
                    valor: a.id,
                    texto: a.nombre,
                  }))}
                  elegidos={valores.areas}
                  onCambio={(a) => cambiar("areas", alternar(valores.areas, a))}
                  vacio="Nadie de su equipo tiene un cargo con área en el organigrama."
                />
              </div>

              <div className="ie-asistente__personas">
                <div className="ie-asistente__personas-cabecera">
                  <label htmlFor={ids.buscar} className="mz-small fw-semibold">
                    Buscar colaboradores
                  </label>
                  <input
                    id={ids.buscar}
                    type="search"
                    className="form-control form-control-sm"
                    placeholder="Nombre, cargo o área"
                    value={buscar}
                    onChange={(e) => setBuscar(e.target.value)}
                  />
                </div>
                <GrupoDeCasillas
                  id={ids.colaboradores}
                  titulo={`Colaboradores (${valores.colaboradores.length} elegidos de ${personas.length})`}
                  error={err("colaboradores")}
                  desplazable
                  opciones={visibles.map((p) => ({
                    valor: p.id,
                    texto: p.full_name || p.name,
                    detalle: [p.cargo || rolLegible(p.role), p.unidad]
                      .filter(Boolean)
                      .join(" · "),
                  }))}
                  elegidos={valores.colaboradores}
                  onCambio={(id) =>
                    cambiar(
                      "colaboradores",
                      alternar(valores.colaboradores, id),
                    )
                  }
                  vacio="Nadie coincide con la búsqueda."
                />
                {valores.colaboradores.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-link btn-sm align-self-start ie-quitar"
                    onClick={() => cambiar("colaboradores", [])}
                  >
                    Quitar la selección de colaboradores
                  </button>
                )}
              </div>

              <VistaPrevia id={ids.previa} previa={previa} />
            </>
          )}
        </fieldset>
      </form>
    </Ventana>
  );
}

/** Un grupo de casillas con su título como leyenda (se lee al entrar). */
function GrupoDeCasillas({
  id,
  titulo,
  opciones,
  elegidos,
  onCambio,
  error,
  vacio,
  desplazable = false,
}) {
  return (
    <fieldset
      id={id}
      tabIndex={-1}
      className="ie-casillas"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="ie-casillas__titulo">{titulo}</legend>
      {opciones.length === 0 ? (
        <p className="mz-small mz-faint mb-0">{vacio}</p>
      ) : (
        <ul
          className={`ie-casillas__lista${desplazable ? " ie-casillas__lista--desplazable" : ""}`}
        >
          {opciones.map((o) => (
            <li key={o.valor}>
              <label className="ie-casilla">
                <input
                  type="checkbox"
                  className="form-check-input"
                  checked={elegidos.includes(o.valor)}
                  onChange={() => onCambio(o.valor)}
                />
                <span>
                  {o.texto}
                  {o.detalle && (
                    <span className="mz-small mz-faint d-block">
                      {o.detalle}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={`${id}-error`} className="mz-field-error mb-0">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Cuántas personas entrarían: región viva que anuncia solo el resultado.
 * «Calculando…» se ve pero no se lee: anunciarlo en cada clic era ruido. */
function VistaPrevia({ id, previa }) {
  let calculando = false;
  let contenido;
  let tono = "info";
  if (previa.error) {
    contenido = previa.error;
    tono = "warn";
  } else if (previa.cargando || previa.total === undefined) {
    calculando = true;
    contenido = "Calculando cuántas personas entran…";
  } else if (previa.total === 0) {
    tono = "warn";
    contenido =
      "Con estos filtros no entra nadie: el informe no se puede generar. Quite o cambie algún filtro.";
  } else {
    contenido = `Entrarán ${previa.total} ${previa.total === 1 ? "persona" : "personas"}${
      previa.tipo && ETIQUETA_ROSTER[previa.tipo]
        ? ` (informe ${ETIQUETA_ROSTER[previa.tipo]})`
        : ""
    }.`;
  }
  return (
    <div
      id={id}
      className={`mz-alert mz-alert--${tono} mb-0 ie-previa`}
      role="status"
      aria-live="polite"
    >
      <Icon name={tono === "warn" ? "exclamation-triangle" : "people"} />
      <span aria-hidden={calculando ? "true" : undefined}>{contenido}</span>
    </div>
  );
}
