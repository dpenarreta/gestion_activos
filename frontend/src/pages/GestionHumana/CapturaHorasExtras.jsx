/*
 * Captura masiva de Horas extras: una tabla tipo Excel con una fila por
 * persona y fecha. Cada fila válida con cambios se envía sola (guardado
 * automático por lotes); las incompletas quedan como borrador y nunca se
 * crea nada inválido. La validación de aquí es una ayuda: el servidor vuelve
 * a validar cada fila, responde fila por fila y nunca toma del navegador la
 * identidad del colaborador (solo su id, la fecha y lo capturado).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorDeNovedades, novedadesService } from "../../api/novedadesService";
import { confirmar } from "../../components/common/Confirmar/confirmar";
import { AnuncioDeResultados } from "../../components/common/AnuncioDeResultados/AnuncioDeResultados";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import { PERM } from "../../modulos/permisosGestionHumana";
import { coincideBusqueda } from "../../utils/busqueda";
import {
  Aviso,
  IndicadorDeGuardado,
  diaDeSemana,
  fecha,
  hoyLocal,
  respaldo,
  useColaDeGuardado,
} from "./comunes";
import { useNovedades } from "./ContextoNovedades";
import { EliminarHorasExtras } from "./Dialogos";
import { ImportarExcel } from "./ImportarExcel";
import { filasDestino, useArrastreRelleno } from "./useArrastreRelleno";

/** Las 13 columnas, en el orden del formato oficial; `campo: null` es
 * identidad que sale de la base (solo lectura). */
export const COLUMNAS = [
  { titulo: "FECHA", nombre: "Fecha", campo: "date", tipo: "fecha" },
  { titulo: "CEDULA", nombre: "Cédula", campo: null, tipo: "ro", de: "cedula" },
  {
    titulo: "NOMBRE DEL COLABORADOR",
    nombre: "Nombre del colaborador",
    campo: null,
    tipo: "ro",
    de: "full_name",
  },
  {
    titulo: "REGIONAL",
    nombre: "Regional",
    campo: null,
    tipo: "ro",
    de: "regional",
  },
  { titulo: "ÁREA", nombre: "Área", campo: null, tipo: "ro", de: "area" },
  { titulo: "CARGO", nombre: "Cargo", campo: null, tipo: "ro", de: "cargo" },
  {
    titulo: "# HORAS EXTRAS",
    nombre: "Horas extras",
    campo: "overtime_hours",
    tipo: "horas",
  },
  {
    titulo: "# HORAS SABADO",
    nombre: "Horas de sábado",
    campo: "saturday_hours",
    tipo: "horas",
  },
  { titulo: "SABADO", nombre: "Sábado", campo: "is_saturday", tipo: "marca" },
  { titulo: "DOMINGO", nombre: "Domingo", campo: "is_sunday", tipo: "marca" },
  { titulo: "FERIADO", nombre: "Feriado", campo: "is_holiday", tipo: "marca" },
  {
    titulo: "TRABAJO REALIZADO",
    nombre: "Trabajo realizado",
    campo: "work_done",
    tipo: "texto",
  },
  {
    titulo: "OBSERVACIONES",
    nombre: "Observaciones",
    campo: "observations",
    tipo: "texto",
  },
];

/** Fecha y nombre quedan a la vista al desplazar, con la casilla y el n.º. */
const FIJA = {
  0: "gh-fija gh-fija-cap--fecha",
  2: "gh-fija gh-fija-cap--nombre",
};

const HORAS = /^\d{1,2}([.,]\d{1,2})?$/;
const LOTE = 500;

const ESTADO_FILA = {
  new: ["Nueva", "mz-pill--info"],
  modified: ["Modificada", "mz-pill--warn"],
  saved: ["Guardada", "mz-pill--ok"],
  incomplete: ["Nueva · incompleta", "mz-pill--info"],
  error: ["Con error", "mz-pill--bad"],
  locked: ["Bloqueada", "mz-pill--neutral"],
  clean: ["Sin cambios", "mz-pill--neutral"],
};

let secuencia = 0;
const nuevaClave = () => {
  secuencia += 1;
  return `n${Date.now().toString(36)}${secuencia}`;
};

export const esRellenable = (c) =>
  Boolean(COLUMNAS[c]?.campo) && COLUMNAS[c].tipo !== "fecha";

function estadoDe(fila) {
  if (fila.estado === "locked") return "locked";
  if (fila.id === null && fila.pendiente && !fila.revisada) return "incomplete";
  if (Object.keys(fila.errores).length) return "error";
  if (fila.pendiente) return fila.id === null ? "new" : "modified";
  return fila.estado === "saved" ? "saved" : "clean";
}

export function filaDeColaborador(c, dia) {
  const semana = dia ? diaDeSemana(dia) : -1;
  return {
    key: nuevaClave(),
    id: null,
    version: null,
    collaborator_id: c.id,
    cedula: c.cedula,
    full_name: c.full_name,
    regional: c.regional,
    area: c.area,
    cargo: c.cargo,
    date: dia,
    overtime_hours: "",
    saturday_hours: "",
    is_saturday: semana === 6,
    is_sunday: semana === 0,
    // null = automático: el servidor lo marca con el calendario de feriados.
    is_holiday: null,
    work_done: "",
    observations: "",
    estado: "new",
    pendiente: true,
    // Una fila recién agregada no se marca con errores hasta que se edita o
    // se sale de ella: antes sería un reproche por algo que aún no se hizo.
    revisada: false,
    errores: {},
  };
}

function filaDeRegistro(r) {
  return {
    key: `r${r.id}`,
    id: r.id,
    version: r.version,
    collaborator_id: r.collaborator_id,
    cedula: r.cedula,
    full_name: r.full_name,
    regional: r.regional,
    area: r.area,
    cargo: r.cargo,
    date: r.date,
    overtime_hours: r.overtime_hours === "0" ? "" : r.overtime_hours,
    saturday_hours: r.saturday_hours === "0" ? "" : r.saturday_hours,
    is_saturday: r.is_saturday,
    is_sunday: r.is_sunday,
    is_holiday: r.is_holiday,
    work_done: r.work_done,
    observations: r.observations,
    estado: "existing",
    pendiente: false,
    errores: {},
  };
}

function errorDeHoras(valor) {
  if (String(valor ?? "").trim() === "") return undefined;
  if (!HORAS.test(String(valor).trim()))
    return "Número válido, hasta 2 decimales (2 o 1.5).";
  if (Number(String(valor).replace(",", ".")) > 24)
    return "No puede superar 24 horas.";
  return undefined;
}

/** Error de plazo con la regla que el servidor ya resolvió (`deadline_rules`). */
function errorDePlazo(dia, reglas) {
  if (!reglas || !dia) return null;
  if (dia > reglas.today)
    return "Fecha futura: no se registran novedades por adelantado.";
  const salta = reglas.overtime?.can_bypass ?? reglas.can_bypass_deadline;
  if (!salta && dia < reglas.overtime?.earliest_open_date) {
    return "El plazo de esta fecha venció: solicite la corrección al Asistente de Operaciones o al Administrador.";
  }
  return null;
}

/** Errores de una fila por campo (vacío = válida). */
export function validarFila(fila, mes, duplicadas, reglas) {
  const errores = {};
  const plazo = errorDePlazo(fila.date, reglas);
  if (!fila.date) errores.date = "La fecha es obligatoria.";
  else if (fila.date < mes.start_date || fila.date > mes.end_date)
    errores.date = "Fuera del mes elegido.";
  else if (plazo) errores.date = plazo;
  else if (duplicadas.has(`${fila.collaborator_id}|${fila.date}`))
    errores.date = "La misma persona y fecha está dos veces en la tabla.";
  const extra = errorDeHoras(fila.overtime_hours);
  const sabado = errorDeHoras(fila.saturday_hours);
  if (extra) errores.overtime_hours = extra;
  if (sabado) errores.saturday_hours = sabado;
  if (!extra && !sabado) {
    const total =
      Number(String(fila.overtime_hours || 0).replace(",", ".")) +
      Number(String(fila.saturday_hours || 0).replace(",", "."));
    if (total <= 0)
      errores.overtime_hours = "Registre horas extras o de sábado.";
  }
  if ((fila.work_done ?? "").length > 500)
    errores.work_done = "Máximo 500 caracteres.";
  if ((fila.observations ?? "").length > 1000)
    errores.observations = "Máximo 1000 caracteres.";
  return errores;
}

export function duplicadasDe(filas) {
  const cuenta = new Map();
  for (const f of filas) {
    if (!f.date) continue;
    const k = `${f.collaborator_id}|${f.date}`;
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  return new Set([...cuenta].filter(([, n]) => n > 1).map(([k]) => k));
}

function marca(valor) {
  const v = String(valor)
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (["SI", "S", "X", "1", "TRUE", "VERDADERO"].includes(v)) return true;
  if (["", "NO", "N", "0", "FALSE", "FALSO"].includes(v)) return false;
  return null;
}

function fechaDeTexto(valor) {
  const v = valor.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export function CapturaHorasExtras({ mes, supervisorId }) {
  const { me, can, marcarPendientes } = useNovedades();
  const almacen = useMemo(
    () =>
      respaldo(`horas|${mes.code}|${supervisorId ?? "todos"}|${me.user?.id}`),
    [mes.code, supervisorId, me.user?.id],
  );
  // El respaldo se recupera al crear el estado, antes de cualquier efecto:
  // si se leyera en un efecto, el que guarda correría antes con la tabla
  // vacía y lo borraría.
  const [recuperadas] = useState(() => almacen.leer() ?? []);
  const [filas, setFilas] = useState(recuperadas);
  const [equipo, setEquipo] = useState([]);
  const [errorEquipo, setErrorEquipo] = useState(null);
  const [versionEquipo, setVersionEquipo] = useState(0);
  const [cargandoFecha, setCargandoFecha] = useState(false);
  const [fechaNueva, setFechaNueva] = useState(() => {
    const hoy = hoyLocal();
    return hoy >= mes.start_date && hoy <= mes.end_date ? hoy : mes.start_date;
  });
  const [marcadas, setMarcadas] = useState(new Set());
  const [activa, setActiva] = useState(null);
  const [rango, setRango] = useState(null);
  const [aviso, setAviso] = useState(
    recuperadas.length
      ? {
          texto:
            "Se recuperaron cambios que no se habían confirmado; se envían automáticamente.",
          tono: "info",
        }
      : null,
  );
  const [dialogo, setDialogo] = useState(null);
  const contenedor = useRef(null);
  const botonAgregar = useRef(null);
  const filasRef = useRef(filas);
  filasRef.current = filas;

  const puedeEscribir = can(PERM.registrar);
  const abierto = mes.status !== "CLOSED" && mes.status !== "FUTURE";
  const editable = useCallback(
    (fila) => Boolean(puedeEscribir && abierto && fila.estado !== "locked"),
    [puedeEscribir, abierto],
  );
  const reglas = me.deadline_rules;

  useEffect(() => {
    let vigente = true;
    setErrorEquipo(null);
    novedadesService
      .colaboradores({
        status: "ACTIVE",
        supervisor: supervisorId ?? undefined,
      })
      .then((lista) => vigente && setEquipo(lista))
      .catch(
        (err) =>
          vigente &&
          setErrorEquipo(
            errorDeNovedades(
              err,
              "No se pudo cargar la lista de colaboradores.",
            ).mensaje,
          ),
      );
    return () => {
      vigente = false;
    };
  }, [supervisorId, versionEquipo]);

  const duplicadas = useMemo(() => duplicadasDe(filas), [filas]);
  const validadas = useMemo(
    () =>
      filas.map((f) => {
        if (!f.pendiente || f.estado === "locked") return f;
        if (f.id === null && !f.revisada) return f;
        const locales = validarFila(f, mes, duplicadas, reglas);
        const delServidor = f.estado === "error" ? f.errores : {};
        return { ...f, errores: { ...delServidor, ...locales } };
      }),
    [filas, mes, duplicadas, reglas],
  );
  const pendientes = validadas.filter((f) => f.pendiente).length;

  const resumen = useMemo(() => {
    const r = {
      nuevas: 0,
      modificadas: 0,
      validas: 0,
      conErrores: 0,
      duplicadas: 0,
      bloqueadas: 0,
    };
    for (const f of validadas) {
      const e = estadoDe(f);
      // «Nuevas» cuenta toda fila sin guardar, tenga o no errores.
      if (f.id === null && f.pendiente) r.nuevas += 1;
      if (e === "modified") r.modificadas += 1;
      if (e === "error") r.conErrores += 1;
      if (e === "locked") r.bloqueadas += 1;
      if (f.pendiente && e !== "error" && e !== "locked") r.validas += 1;
      if (duplicadas.has(`${f.collaborator_id}|${f.date}`)) r.duplicadas += 1;
    }
    return r;
  }, [validadas, duplicadas]);

  /** Filas listas para enviarse: con cambios, válidas y no bloqueadas. */
  const enviables = useCallback(
    (lista) => {
      const dups = duplicadasDe(lista);
      return lista.filter(
        (f) =>
          f.pendiente &&
          f.estado !== "locked" &&
          f.estado !== "error" &&
          Object.keys(validarFila(f, mes, dups, reglas)).length === 0,
      );
    },
    [mes, reglas],
  );

  const cola = useColaDeGuardado(async ({ alEmpezar }) => {
    if (!puedeEscribir || !abierto) return null;
    const aEnviar = enviables(filasRef.current);
    if (!aEnviar.length) return null;
    alEmpezar();
    const revisiones = new Map(aEnviar.map((f) => [f.key, f.rev ?? 0]));
    const resultados = new Map();
    let fallo = null;
    for (let inicio = 0; inicio < aEnviar.length; inicio += LOTE) {
      const parte = aEnviar.slice(inicio, inicio + LOTE);
      try {
        const respuesta = await novedadesService.guardarLoteHorasExtras(
          mes.code,
          parte.map((f) => ({
            client_key: f.key,
            id: f.id,
            version: f.version,
            collaborator_id: f.collaborator_id,
            date: f.date,
            overtime_hours: String(f.overtime_hours ?? "").replace(",", "."),
            saturday_hours: String(f.saturday_hours ?? "").replace(",", "."),
            is_saturday: f.is_saturday,
            is_sunday: f.is_sunday,
            is_holiday: f.is_holiday,
            work_done: f.work_done,
            observations: f.observations,
          })),
        );
        respuesta.rows.forEach((r) => resultados.set(r.client_key, r));
      } catch (err) {
        // Nada se borra: las filas quedan en la tabla y en el respaldo, y el
        // reintento no duplica (el servidor reconoce lo ya guardado).
        fallo = errorDeNovedades(
          err,
          "No se pudieron guardar las horas extras.",
        );
        break;
      }
    }
    if (resultados.size) {
      setFilas((previas) =>
        previas.map((f) => {
          const res = resultados.get(f.key);
          if (!res) return f;
          const misma = (f.rev ?? 0) === revisiones.get(f.key);
          if (["created", "updated", "unchanged"].includes(res.status)) {
            const guardada = {
              ...f,
              id: res.record_id ?? f.id,
              version: res.version ?? f.version,
            };
            // Si la fila cambió mientras se guardaba, la edición nueva queda
            // pendiente (con el id y la versión ya confirmados).
            return misma
              ? { ...guardada, estado: "saved", pendiente: false, errores: {} }
              : guardada;
          }
          if (!misma) return f;
          return {
            ...f,
            estado: res.status === "locked" ? "locked" : "error",
            errores: res.errors ?? { row: "No se pudo guardar." },
          };
        }),
      );
    }
    if (fallo) return { fallo };
    const valores = [...resultados.values()];
    const rechazadas = valores.filter(
      (r) => !["created", "updated", "unchanged"].includes(r.status),
    ).length;
    if (rechazadas) {
      // Guardado parcial: nunca se presenta como éxito total.
      return {
        rechazadas: `${valores.length - rechazadas} fila(s) guardadas; ${rechazadas} no se guardaron: revise las marcadas.`,
      };
    }
    return { enviadas: valores.length };
  });

  // Cada cambio válido se envía solo, tras una pausa (no por tecla).
  useEffect(() => {
    if (enviables(filas).length) cola.programar();
    // `cola.programar` es estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, enviables]);

  // Respaldo de lo pendiente, sin la cédula (dato protegido).
  useEffect(() => {
    const pendientesAhora = filas.filter((f) => f.pendiente);
    if (pendientesAhora.length) {
      almacen.guardar(pendientesAhora.map((f) => ({ ...f, cedula: "" })));
    } else almacen.borrar();
    marcarPendientes(pendientesAhora.length);
  }, [filas, almacen, marcarPendientes]);
  useEffect(() => () => marcarPendientes(0), [marcarPendientes]);

  // Editar una fila la vuelve pendiente y limpia los errores del servidor.
  const tocada = (f) => ({
    ...f,
    rev: (f.rev ?? 0) + 1,
    pendiente: true,
    revisada: true,
    errores: {},
    estado:
      f.estado === "locked" ? "locked" : f.id === null ? "new" : "existing",
  });

  /** Al salir de una fila nueva, ya se valida (aunque no se haya escrito). */
  function revisar(clave) {
    setFilas((previas) =>
      previas.map((f) =>
        f.key === clave && f.id === null && !f.revisada
          ? { ...f, revisada: true }
          : f,
      ),
    );
  }

  function actualizar(clave, cambios) {
    setFilas((previas) =>
      previas.map((f) => (f.key === clave ? tocada({ ...f, ...cambios }) : f)),
    );
  }

  function agregar(ids) {
    const elegidos = equipo.filter((c) => ids.includes(c.id));
    setFilas((previas) => [
      ...previas,
      ...elegidos.map((c) => filaDeColaborador(c, fechaNueva)),
    ]);
    setAviso({
      texto: `${elegidos.length} fila(s) agregada(s) con fecha ${fecha(fechaNueva)}. Complete las horas: se guardan solas.`,
      tono: "info",
    });
  }

  async function cargarDeLaFecha() {
    if (!fechaNueva || cargandoFecha) return;
    setCargandoFecha(true);
    try {
      const datos = await novedadesService.horasExtras({
        period: mes.code,
        supervisor: supervisorId ?? undefined,
        date_from: fechaNueva,
        date_to: fechaNueva,
        limit: 1000,
      });
      // Se filtra contra las filas vigentes al aplicar, no contra las de
      // cuando se pidió: dos cargas seguidas no duplican filas.
      const presentes = new Set(
        filasRef.current.map((f) => f.id).filter(Boolean),
      );
      const nuevas = datos.records.filter((r) => !presentes.has(r.id));
      setFilas((previas) => {
        const ya = new Set(previas.map((f) => f.id).filter(Boolean));
        return [
          ...previas,
          ...datos.records.filter((r) => !ya.has(r.id)).map(filaDeRegistro),
        ];
      });
      setAviso({
        texto: nuevas.length
          ? `${nuevas.length} registro(s) del ${fecha(fechaNueva)} cargados para editar.`
          : `No hay más registros del ${fecha(fechaNueva)}.`,
        tono: "info",
      });
    } catch (err) {
      setAviso({ texto: errorDeNovedades(err).mensaje, tono: "bad" });
    } finally {
      setCargandoFecha(false);
    }
  }

  /** Tras quitar una fila, el foco pasa a la que queda en su lugar (o a la
   * anterior); sin filas, al botón para agregar. */
  function enfocarTrasQuitar(indice) {
    requestAnimationFrame(() => {
      const raiz = contenedor.current;
      const destino =
        raiz?.querySelector(`[data-r="${indice}"][data-c="0"]`) ??
        raiz?.querySelector(`[data-r="${indice - 1}"][data-c="0"]`) ??
        botonAgregar.current;
      destino?.focus();
    });
  }

  function quitar(clave) {
    setFilas((previas) => previas.filter((f) => f.key !== clave));
    setMarcadas((previas) => {
      const siguientes = new Set(previas);
      siguientes.delete(clave);
      return siguientes;
    });
    setActiva(null);
    setRango(null);
  }

  async function quitarMarcadas() {
    const salen = filas.filter((f) => marcadas.has(f.key));
    if (
      salen.some((f) => f.pendiente) &&
      !(await confirmar({
        titulo: "¿Quitar las filas marcadas?",
        mensaje:
          "Algunas tienen cambios sin guardar que se perderán. Lo ya guardado no se elimina: solo deja de verse aquí.",
        accion: "Quitar",
      }))
    )
      return;
    setFilas((previas) => previas.filter((f) => !marcadas.has(f.key)));
    setMarcadas(new Set());
  }

  async function eliminarFila(fila) {
    const indice = filas.findIndex((f) => f.key === fila.key);
    if (fila.id === null) {
      quitar(fila.key);
      enfocarTrasQuitar(indice);
      setAviso({
        texto: `Fila de ${fila.full_name} quitada (no estaba guardada).`,
        tono: "info",
        accion: {
          texto: "Deshacer",
          onClick: () => {
            setFilas((previas) =>
              previas.some((f) => f.key === fila.key)
                ? previas
                : [...previas, fila],
            );
            setAviso(null);
          },
        },
      });
      return;
    }
    if (
      fila.pendiente &&
      !(await confirmar({
        titulo: "Esta fila tiene cambios sin guardar",
        mensaje: "Si continúa con la eliminación, esos cambios se pierden.",
        accion: "Continuar",
      }))
    )
      return;
    setDialogo({ tipo: "eliminar", fila });
  }

  async function aplicarFecha() {
    const objetivo = filas.filter((f) => marcadas.has(f.key) && editable(f));
    if (!objetivo.length) return;
    const si = await confirmar({
      titulo: `¿Aplicar el ${fecha(fechaNueva)} a ${objetivo.length} fila(s)?`,
      mensaje: "Se recalculan las marcas de sábado y domingo de esas filas.",
      accion: "Aplicar fecha",
      peligro: false,
    });
    if (!si) return;
    const semana = diaDeSemana(fechaNueva);
    setFilas((previas) =>
      previas.map((f) =>
        marcadas.has(f.key) && editable(f)
          ? tocada({
              ...f,
              date: fechaNueva,
              is_saturday: semana === 6,
              is_sunday: semana === 0,
              is_holiday: null,
            })
          : f,
      ),
    );
  }

  async function descartarBorradores() {
    const si = await confirmar({
      titulo: "¿Descartar los borradores?",
      mensaje:
        "Las filas que no se guardaron se quitan de la tabla. Lo ya guardado no cambia.",
      accion: "Descartar",
    });
    if (si) setFilas((previas) => previas.filter((f) => !f.pendiente));
  }

  /** Copia el valor de la celda origen en las filas destino de la misma
   * columna (siempre el mismo valor, nunca una serie). Fecha e identidad no
   * se copian. */
  function copiar(columna, origen, destinos) {
    const campo = COLUMNAS[columna]?.campo;
    if (!esRellenable(columna) || !filas[origen]) return;
    const valor = filas[origen][campo];
    const antes = filas;
    let copiadas = 0;
    let saltadas = 0;
    const cambiadas = new Set();
    const siguientes = filas.map((f, i) => {
      if (!destinos.includes(i)) return f;
      if (!editable(f)) {
        saltadas += 1;
        return f;
      }
      if (f[campo] === valor) return f;
      copiadas += 1;
      cambiadas.add(i);
      return tocada({ ...f, [campo]: valor });
    });
    if (!copiadas && !saltadas) {
      setAviso({
        texto: "Las celdas de destino ya tienen ese valor.",
        tono: "info",
      });
      return;
    }
    setFilas(siguientes);
    setAviso({
      texto:
        `${COLUMNAS[columna].titulo}: valor copiado en ${copiadas} fila(s)` +
        (saltadas ? `; ${saltadas} bloqueada(s) sin cambios` : "") +
        ". Se guarda automáticamente.",
      tono: saltadas ? "warn" : "ok",
      accion: copiadas
        ? {
            texto: "Deshacer",
            onClick: () => {
              setFilas((actuales) =>
                actuales.map((f, i) => {
                  const previa = antes[i];
                  if (!cambiadas.has(i) || !previa || previa.key !== f.key)
                    return f;
                  return tocada({ ...f, [campo]: previa[campo] });
                }),
              );
              setAviso(null);
            },
          }
        : undefined,
    });
  }

  const arrastre = useArrastreRelleno({
    contenedorRef: contenedor,
    alSoltar: ({ col, desde, hasta }) => {
      copiar(col, desde, filasDestino(desde, hasta));
      setRango({ c: col, r1: desde, r2: hasta });
    },
  });

  /** Ctrl+D: con un rango, la primera celda en el resto; con filas marcadas,
   * la activa en esas filas; si no, la de arriba en la activa. */
  function copiarHaciaAbajo() {
    if (!activa || !esRellenable(activa.c)) {
      setAviso({
        texto:
          "Elija una celda de horas, de sábado, domingo o feriado, o de texto.",
        tono: "info",
      });
      return;
    }
    if (rango && rango.c === activa.c && rango.r1 !== rango.r2) {
      const [a, b] =
        rango.r1 <= rango.r2 ? [rango.r1, rango.r2] : [rango.r2, rango.r1];
      copiar(activa.c, a, filasDestino(a, b));
      return;
    }
    const conMarca = filas
      .map((f, i) => (marcadas.has(f.key) ? i : -1))
      .filter((i) => i >= 0 && i !== activa.r);
    if (conMarca.length) {
      copiar(activa.c, activa.r, conMarca);
      return;
    }
    if (activa.r > 0) copiar(activa.c, activa.r - 1, [activa.r]);
  }

  function teclas(evento) {
    const objetivo = evento.currentTarget;
    const r = Number(objetivo.dataset.r);
    const c = Number(objetivo.dataset.c);
    if (
      (evento.ctrlKey || evento.metaKey) &&
      evento.key.toLowerCase() === "d"
    ) {
      evento.preventDefault();
      copiarHaciaAbajo();
      return;
    }
    if (
      evento.shiftKey &&
      (evento.key === "ArrowDown" || evento.key === "ArrowUp")
    ) {
      evento.preventDefault();
      const base = rango && rango.c === c ? rango : { c, r1: r, r2: r };
      const r2 = Math.max(
        0,
        Math.min(
          filas.length - 1,
          base.r2 + (evento.key === "ArrowDown" ? 1 : -1),
        ),
      );
      setRango({ c, r1: base.r1, r2 });
      return;
    }
    const mov = { ArrowDown: [1, 0], Enter: [1, 0], ArrowUp: [-1, 0] };
    const esTexto = objetivo.type === "text";
    if (
      evento.key === "ArrowRight" &&
      (!esTexto || objetivo.selectionEnd === objetivo.value.length)
    )
      mov.ArrowRight = [0, 1];
    if (
      evento.key === "ArrowLeft" &&
      (!esTexto || objetivo.selectionStart === 0)
    )
      mov.ArrowLeft = [0, -1];
    const delta = mov[evento.key];
    if (!delta) return;
    let [nr, nc] = [r + delta[0], c + delta[1]];
    for (let vuelta = 0; vuelta < 20; vuelta += 1) {
      const siguiente = contenedor.current?.querySelector(
        `[data-r="${nr}"][data-c="${nc}"]`,
      );
      if (siguiente && !siguiente.disabled) {
        evento.preventDefault();
        siguiente.focus();
        if (siguiente.type === "text") siguiente.select();
        return;
      }
      if (delta[1] === 0) return;
      nc += delta[1];
      if (nc < 0 || nc >= COLUMNAS.length) return;
    }
  }

  /** Pegar un bloque copiado de Excel (con tabulaciones o varias líneas)
   * desde la celda donde se pega, solo en las columnas editables. */
  function pegar(evento, fila0, col0) {
    const texto = evento.clipboardData?.getData("text/plain") ?? "";
    if (!texto.includes("\t") && !texto.includes("\n")) return;
    evento.preventDefault();
    const lineas = texto.replace(/\r/g, "").split("\n");
    if (lineas.at(-1) === "") lineas.pop();
    let invalidos = 0;
    let sobrantes = 0;
    const siguientes = filas.map((f) => ({ ...f }));
    lineas.forEach((linea, i) => {
      const destino = siguientes[fila0 + i];
      if (!destino) {
        sobrantes += 1;
        return;
      }
      if (!editable(destino)) return;
      let tocadaAqui = false;
      linea.split("\t").forEach((crudo, j) => {
        const col = COLUMNAS[col0 + j];
        if (!col?.campo) return;
        if (col.tipo === "marca") {
          const v = marca(crudo);
          if (v === null) invalidos += 1;
          else {
            destino[col.campo] = v;
            tocadaAqui = true;
          }
        } else if (col.tipo === "fecha") {
          const v = fechaDeTexto(crudo);
          if (v === null) invalidos += 1;
          else {
            destino.date = v;
            tocadaAqui = true;
          }
        } else {
          destino[col.campo] = crudo.trim();
          tocadaAqui = true;
        }
      });
      if (tocadaAqui) siguientes[fila0 + i] = tocada(destino);
    });
    setFilas(siguientes);
    const notas = [
      invalidos
        ? `${invalidos} valor(es) no reconocidos (use números, SI/NO y fechas dd/mm/aaaa)`
        : "",
      sobrantes
        ? `${sobrantes} fila(s) del portapapeles sobran: agregue primero los colaboradores`
        : "",
    ].filter(Boolean);
    setAviso({
      texto: notas.length
        ? `Pegado con observaciones: ${notas.join("; ")}.`
        : "Datos pegados. Se guardan automáticamente.",
      tono: notas.length ? "warn" : "ok",
    });
  }

  const todasMarcadas =
    filas.length > 0 && filas.every((f) => marcadas.has(f.key));
  const listaDeErrores = validadas.flatMap((f, i) =>
    Object.entries(f.errores).map(([campo, mensaje]) => ({
      i,
      nombre: f.full_name,
      campo,
      mensaje,
      // La celda a la que lleva el botón (la fecha si el error es de la fila).
      c: Math.max(
        COLUMNAS.findIndex((col) => col.campo === campo),
        0,
      ),
    })),
  );
  const tituloDeCampo = (campo) =>
    COLUMNAS.find((c) => c.campo === campo)?.titulo ??
    (campo === "row" ? "Fila" : "Colaborador");
  const hayFilas = filas.length > 0;

  return (
    <div className="gh-page">
      {mes.status === "CLOSED" && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="lock" />
          <span>
            {mes.label} de Horas extras está cerrado para este equipo: la
            captura está bloqueada.
          </span>
        </div>
      )}
      {!puedeEscribir && (
        <div className="mz-alert mz-alert--info" role="status">
          <span>
            No tiene habilitado el registro de novedades: puede consultar los
            registros.
          </span>
        </div>
      )}
      <div className="mz-filter-bar">
        <div className="mz-inline-field">
          <label htmlFor="gh-captura-fecha">
            Fecha de trabajo de las filas nuevas
          </label>
          <input
            id="gh-captura-fecha"
            type="date"
            className="form-control form-control-sm"
            value={fechaNueva}
            min={mes.start_date}
            max={mes.end_date}
            onChange={(e) => setFechaNueva(e.target.value)}
          />
        </div>
        <button
          type="button"
          ref={botonAgregar}
          className="btn btn-primary btn-sm"
          disabled={!puedeEscribir || !abierto || Boolean(errorEquipo)}
          onClick={() => setDialogo({ tipo: "agregar" })}
        >
          <Icon name="plus-lg" /> Agregar colaboradores
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={cargandoFecha}
          onClick={cargarDeLaFecha}
        >
          <Icon name="arrow-repeat" />{" "}
          {cargandoFecha ? "Cargando…" : "Cargar los registros de esa fecha"}
        </button>
        {can(PERM.importar) && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={!puedeEscribir || !abierto}
            onClick={() => setDialogo({ tipo: "importar" })}
          >
            <Icon name="upload" /> Importar
          </button>
        )}
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() =>
            novedadesService
              .plantillaHorasExtras()
              .catch((err) =>
                setAviso({ texto: errorDeNovedades(err).mensaje, tono: "bad" }),
              )
          }
        >
          <Icon name="file-earmark-excel" /> Plantilla
        </button>
      </div>

      {errorEquipo && (
        <EstadoDeCarga
          error={errorEquipo}
          onReintentar={() => setVersionEquipo((v) => v + 1)}
        />
      )}

      {hayFilas && (
        <div className="gh-barra">
          <div className="gh-resumen" aria-live="polite">
            <span>
              Nuevas: <strong>{resumen.nuevas}</strong>
            </span>
            <span>
              Modificadas: <strong>{resumen.modificadas}</strong>
            </span>
            <span>
              Válidas: <strong>{resumen.validas}</strong>
            </span>
            <span>
              Con errores: <strong>{resumen.conErrores}</strong>
            </span>
            <span>
              Posibles duplicados: <strong>{resumen.duplicadas}</strong>
            </span>
            <span>
              Bloqueadas: <strong>{resumen.bloqueadas}</strong>
            </span>
          </div>
          <div className="gh-barra__grupo">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={
                !puedeEscribir ||
                !abierto ||
                !activa ||
                !esRellenable(activa?.c)
              }
              title="Copia el valor de la celda activa en el rango elegido (Mayús+↓) o en las filas marcadas. Atajo: Ctrl+D"
              onClick={copiarHaciaAbajo}
            >
              <Icon name="arrow-down-square" /> Copiar hacia abajo
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={!marcadas.size}
              onClick={aplicarFecha}
            >
              Aplicar la fecha a las marcadas
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={!marcadas.size}
              onClick={quitarMarcadas}
            >
              <Icon name="x-lg" /> Quitar las marcadas
            </button>
          </div>
        </div>
      )}

      {hayFilas && (
        <IndicadorDeGuardado
          estado={cola.estado}
          pendientes={pendientes}
          mensaje={cola.mensaje}
          onReintentar={cola.ahora}
        >
          {pendientes > 0 && cola.estado !== "saving" && (
            <button
              type="button"
              className="btn btn-link btn-sm p-0"
              onClick={descartarBorradores}
            >
              Descartar borradores
            </button>
          )}
        </IndicadorDeGuardado>
      )}
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      {filas.length === 0 ? (
        <div className="mz-estado mz-empty">
          <p className="mb-1">
            Elija la fecha de trabajo y pulse «Agregar colaboradores» para crear
            una fila por persona.
          </p>
          <p className="mz-small mz-faint mb-0">
            También puede cargar los registros existentes de esa fecha para
            editarlos. Para pegar celdas copiadas de Excel, agregue primero las
            filas.
          </p>
        </div>
      ) : (
        <div
          ref={contenedor}
          className="gh-grilla-wrap"
          role="region"
          aria-label={`Captura de horas extras de ${mes.label}`}
          // Se desplaza con el teclado aunque todas sus celdas estén bloqueadas.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
        >
          <table className="gh-grilla">
            <caption className="visually-hidden">
              Captura de horas extras: una fila por persona y fecha. Ctrl+D
              copia hacia abajo.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="gh-fija gh-fija-cap--marca">
                  <input
                    type="checkbox"
                    aria-label="Marcar todas las filas"
                    checked={todasMarcadas}
                    onChange={(e) =>
                      setMarcadas(
                        e.target.checked
                          ? new Set(filas.map((f) => f.key))
                          : new Set(),
                      )
                    }
                  />
                </th>
                <th scope="col" className="gh-fija gh-fija-cap--numero">
                  #
                </th>
                {COLUMNAS.map((c, i) => (
                  <th key={c.titulo} scope="col" className={FIJA[i]}>
                    {c.titulo}
                  </th>
                ))}
                <th scope="col">Estado</th>
                <th scope="col">
                  <span className="visually-hidden">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {validadas.map((fila, r) => {
                const estado = estadoDe(fila);
                const puede = editable(fila);
                return (
                  <tr
                    key={fila.key}
                    data-fila={r}
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget))
                        revisar(fila.key);
                    }}
                  >
                    <td className="gh-fija gh-fija-cap--marca gh-celda">
                      <input
                        type="checkbox"
                        aria-label={`Marcar la fila de ${fila.full_name}`}
                        checked={marcadas.has(fila.key)}
                        onChange={(e) =>
                          setMarcadas((previas) => {
                            const siguientes = new Set(previas);
                            if (e.target.checked) siguientes.add(fila.key);
                            else siguientes.delete(fila.key);
                            return siguientes;
                          })
                        }
                      />
                    </td>
                    <td className="gh-fija gh-fija-cap--numero gh-texto">
                      {r + 1}
                    </td>
                    {COLUMNAS.map((col, c) => {
                      if (!col.campo) {
                        return (
                          <td
                            key={col.titulo}
                            className={`gh-texto ${col.de === "cedula" ? "gh-mono mz-faint" : ""} ${FIJA[c] ?? ""}`}
                          >
                            {fila[col.de]}
                          </td>
                        );
                      }
                      const error = fila.errores[col.campo];
                      const enRango =
                        rango &&
                        rango.c === c &&
                        rango.r1 !== rango.r2 &&
                        r >= Math.min(rango.r1, rango.r2) &&
                        r <= Math.max(rango.r1, rango.r2);
                      const clases = [
                        "gh-celda",
                        FIJA[c],
                        col.tipo === "texto" && "gh-celda--texto",
                        col.tipo === "horas" && "gh-celda--horas",
                        arrastre.enArrastre(r, c) && "gh-celda--arrastre",
                        error && "gh-celda--error",
                        enRango && "gh-celda--rango",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      const etiqueta = `${col.nombre} de ${fila.full_name}`;
                      const alEnfocar = () => {
                        setActiva({ r, c });
                        if (
                          !rango ||
                          rango.c !== c ||
                          (rango.r1 !== r && rango.r2 !== r)
                        )
                          setRango({ c, r1: r, r2: r });
                      };
                      const controlador =
                        activa?.r === r &&
                        activa?.c === c &&
                        !arrastre.arrastre &&
                        puede &&
                        esRellenable(c) ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            className="gh-relleno"
                            aria-label="Arrastrar hacia abajo para copiar el valor"
                            title="Arrastre para copiar este valor a otras filas (Esc cancela)"
                            onMouseDown={(e) => arrastre.empezar(e, r, c)}
                          />
                        ) : null;
                      if (col.tipo === "marca") {
                        const valor = fila[col.campo];
                        return (
                          <td
                            key={col.titulo}
                            className={clases}
                            title={
                              col.campo === "is_holiday" && valor === null
                                ? "Automático según el calendario de feriados"
                                : error
                            }
                          >
                            <input
                              type="checkbox"
                              data-r={r}
                              data-c={c}
                              disabled={!puede}
                              checked={valor === true}
                              aria-label={
                                col.campo === "is_holiday" && valor === null
                                  ? `${etiqueta} (automático)`
                                  : etiqueta
                              }
                              onFocus={alEnfocar}
                              onChange={(e) =>
                                actualizar(fila.key, {
                                  [col.campo]: e.target.checked,
                                })
                              }
                              onKeyDown={teclas}
                            />
                            {controlador}
                          </td>
                        );
                      }
                      return (
                        <td key={col.titulo} className={clases} title={error}>
                          <input
                            type={col.tipo === "fecha" ? "date" : "text"}
                            inputMode={
                              col.tipo === "horas" ? "decimal" : undefined
                            }
                            autoComplete="off"
                            min={
                              col.tipo === "fecha" ? mes.start_date : undefined
                            }
                            max={
                              col.tipo === "fecha" ? mes.end_date : undefined
                            }
                            maxLength={
                              col.tipo === "texto"
                                ? col.campo === "work_done"
                                  ? 500
                                  : 1000
                                : undefined
                            }
                            data-r={r}
                            data-c={c}
                            value={fila[col.campo] ?? ""}
                            disabled={!puede}
                            aria-label={
                              error ? `${etiqueta}. ${error}` : etiqueta
                            }
                            aria-invalid={error ? true : undefined}
                            onFocus={(e) => {
                              alEnfocar();
                              if (e.target.type === "text") e.target.select();
                            }}
                            onChange={(e) => {
                              const valor = e.target.value;
                              if (col.tipo === "fecha") {
                                const semana = valor ? diaDeSemana(valor) : -1;
                                actualizar(fila.key, {
                                  date: valor,
                                  is_saturday: semana === 6,
                                  is_sunday: semana === 0,
                                  is_holiday: null,
                                });
                              } else {
                                actualizar(fila.key, { [col.campo]: valor });
                              }
                            }}
                            onKeyDown={teclas}
                            onPaste={(e) => pegar(e, r, c)}
                          />
                          {controlador}
                        </td>
                      );
                    })}
                    <td
                      className="gh-texto"
                      title={
                        Object.values(fila.errores).join(" · ") || undefined
                      }
                    >
                      <span className={`mz-pill ${ESTADO_FILA[estado][1]}`}>
                        {ESTADO_FILA[estado][0]}
                      </span>
                    </td>
                    <td className="gh-texto">
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        disabled={!puede || dialogo !== null}
                        aria-label={
                          fila.id === null
                            ? `Quitar la fila de ${fila.full_name} (no está guardada)`
                            : `Eliminar el registro de ${fila.full_name} del ${fecha(fila.date)}`
                        }
                        onClick={() => eliminarFila(fila)}
                      >
                        <Icon name="trash" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {listaDeErrores.length > 0 && (
        <div
          className="mz-alert mz-alert--bad"
          role="status"
          aria-live="polite"
        >
          <div>
            <strong>Corrija estas filas (las demás se guardan igual):</strong>
            <ul className="gh-lista-errores">
              {listaDeErrores.slice(0, 50).map((e, n) => (
                <li key={n}>
                  <button
                    type="button"
                    className="gh-enlace"
                    onClick={() =>
                      contenedor.current
                        ?.querySelector(`[data-r="${e.i}"][data-c="${e.c}"]`)
                        ?.focus()
                    }
                  >
                    Fila {e.i + 1} · {e.nombre} · {tituloDeCampo(e.campo)}
                  </button>
                  : {e.mensaje}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {dialogo?.tipo === "agregar" && (
        <ElegirColaboradores
          equipo={equipo}
          dia={fechaNueva}
          ocupados={
            new Set(
              filas
                .filter((f) => f.date === fechaNueva)
                .map((f) => f.collaborator_id),
            )
          }
          onCerrar={() => setDialogo(null)}
          onAgregar={(ids) => {
            setDialogo(null);
            agregar(ids);
          }}
        />
      )}
      {dialogo?.tipo === "importar" && (
        <ImportarExcel
          tipo="OVERTIME"
          periodo={mes.code}
          rango={mes}
          onCerrar={() => setDialogo(null)}
          onImportado={(texto, tono) => {
            setDialogo(null);
            setAviso({ texto, tono });
            cargarDeLaFecha();
          }}
        />
      )}
      {dialogo?.tipo === "eliminar" && (
        <EliminarHorasExtras
          registro={dialogo.fila}
          onCerrar={() => setDialogo(null)}
          onHecho={(yaNoExistia) => {
            const indice = filas.findIndex((f) => f.key === dialogo.fila.key);
            quitar(dialogo.fila.key);
            setDialogo(null);
            enfocarTrasQuitar(indice);
            setAviso({
              texto: yaNoExistia
                ? "El registro ya no existía (otra persona lo eliminó). Se quitó de la tabla."
                : "Registro eliminado. El colaborador sigue en la base.",
              tono: yaNoExistia ? "info" : "ok",
            });
          }}
        />
      )}
    </div>
  );
}

/** Elegir del equipo a quiénes agregar como filas para la fecha elegida. */
function ElegirColaboradores({ equipo, dia, ocupados, onCerrar, onAgregar }) {
  const [busqueda, setBusqueda] = useState("");
  const campoElegir = useRef(null);
  const [elegidos, setElegidos] = useState(new Set());
  // En cada tecla, sin distinguir tildes ni mayúsculas y cada palabra en
  // cualquier orden (búsqueda en vivo, 06/11/2026).
  const visibles = useMemo(
    () =>
      equipo.filter((c) =>
        coincideBusqueda(busqueda, c.full_name, c.cedula, c.cargo, c.area),
      ),
    [equipo, busqueda],
  );
  const libres = visibles.filter((c) => !ocupados.has(c.id));
  const alternar = (id) =>
    setElegidos((previos) => {
      const siguientes = new Set(previos);
      if (siguientes.has(id)) siguientes.delete(id);
      else siguientes.add(id);
      return siguientes;
    });

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={`Agregar colaboradores · ${fecha(dia)}`}
      onCerrar={onCerrar}
      onSubmit={(e) => {
        e.preventDefault();
        if (elegidos.size) onAgregar([...elegidos]);
      }}
      textoConfirmar={`Agregar ${elegidos.size} fila(s)`}
      puedeConfirmar={elegidos.size > 0 && Boolean(dia)}
      anchoMaximo="720px"
    >
      <div className="gh-barra mb-2" data-sin-descarte>
        <div className="mz-fb-search flex-grow-1">
          <Icon name="search" />
          <input
            ref={campoElegir}
            type="search"
            aria-label="Buscar por nombre, cédula, cargo o área"
            data-autofocus
            placeholder="Buscar nombre, cédula, cargo o área"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={!libres.length}
          onClick={() =>
            setElegidos(new Set([...elegidos, ...libres.map((c) => c.id)]))
          }
        >
          Marcar los visibles ({libres.length})
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={!elegidos.size}
          onClick={() => setElegidos(new Set())}
        >
          Limpiar
        </button>
      </div>
      <AnuncioDeResultados termino={busqueda} total={visibles.length} />
      {equipo.length === 0 ? (
        <p className="mz-estado mz-empty">
          No hay colaboradores activos en este equipo.
        </p>
      ) : (
        <ul className="gh-seleccion" aria-label="Colaboradores del equipo">
          {visibles.length === 0 && (
            <li className="mz-estado mz-faint">
              Sin resultados para «{busqueda.trim()}».{" "}
              <button
                type="button"
                className="btn btn-link btn-sm p-0 align-baseline"
                onClick={() => {
                  setBusqueda("");
                  // Tras limpiar, el foco vuelve al buscador (auditoría UX/UI, 06/11/2026).
                  campoElegir.current?.focus();
                }}
              >
                Limpiar búsqueda
              </button>
            </li>
          )}
          {visibles.map((c) => {
            const ocupado = ocupados.has(c.id);
            return (
              <li key={c.id}>
                <label className={ocupado ? "mz-faint" : undefined}>
                  <input
                    type="checkbox"
                    disabled={ocupado}
                    checked={elegidos.has(c.id)}
                    onChange={() => alternar(c.id)}
                  />
                  <span className="gh-mono mz-small">{c.cedula}</span>
                  <span className="flex-grow-1">{c.full_name}</span>
                  {c.supervisor_name && (
                    <span className="mz-small mz-faint">
                      {c.supervisor_name}
                    </span>
                  )}
                  <span className="mz-small mz-faint">{c.cargo}</span>
                  {ocupado && (
                    <span className="mz-small">
                      Ya está en la tabla para esta fecha
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </ModalDialog>
  );
}
