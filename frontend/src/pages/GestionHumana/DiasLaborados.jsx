/*
 * Días laborados: la matriz del período 23 → 22 de un equipo (o de todos los
 * equipos autorizados, con alcance nacional). Se escribe en la celda y se
 * guarda solo, sin botón: lo que el servidor todavía no confirmó se ve como
 * pendiente, se reintenta si se cae la red y queda en el respaldo de la
 * pestaña. Las reglas (fin de semana, plazo por fecha, fecha futura, período
 * cerrado, equipo anterior) ya vienen resueltas por el servidor para esta
 * persona: la pantalla solo bloquea lo que él informa y él vuelve a validar
 * cada celda al guardar.
 */
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { errorDeNovedades, novedadesService } from "../../api/novedadesService";
import { AnuncioDeResultados } from "../../components/common/AnuncioDeResultados/AnuncioDeResultados";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { PERM } from "../../modulos/permisosGestionHumana";
import { coincideBusqueda } from "../../utils/busqueda";
import {
  Aviso,
  ESTADO_COLABORADOR,
  ESTADO_PERIODO,
  HORAS_MIENTRAS_ESCRIBE,
  IndicadorDeGuardado,
  MenuDeAcciones,
  TONO_PERIODO,
  fecha,
  fechaHora,
  respaldo,
  useColaDeGuardado,
} from "./comunes";
import {
  BarraDeAlcance,
  ConAcceso,
  Encabezado,
  useNovedades,
} from "./ContextoNovedades";
import {
  CambiarEstado,
  CerrarPeriodo,
  Correccion,
  CorregirCedula,
  RetirarDeDias,
} from "./Dialogos";
import { ImportarExcel } from "./ImportarExcel";
import { filasDestino, useArrastreRelleno } from "./useArrastreRelleno";

const claveDe = (colaboradorId, dia) => `${colaboradorId}|${dia}`;
/** Cédula, Empleado, Supervisor y Cargo van antes de los días: la columna
 * de una celda (`data-c`) cuenta desde la primera de ellas. */
const COLUMNAS_FIJAS = 4;

export function DiasLaborados() {
  return (
    <ConAcceso titulo="Días laborados">
      <PantallaDias />
    </ConAcceso>
  );
}

function PantallaDias() {
  const { me, supervisorId, supervisores, errorSupervisores, periodo } =
    useNovedades();
  const faltaEquipo = supervisorId === null && !me.national_read;
  return (
    <div className="gh-page">
      <Encabezado
        titulo="Días laborados"
        descripcion="Horas laboradas por día de cada colaborador, del 23 al 22. Se guarda automáticamente al escribir."
      />
      <BarraDeAlcance tipo="periodo" idBase="gh-dias" />
      {faltaEquipo ? (
        // Si la lista de supervisores falló, el error (con «Reintentar») ya
        // está arriba, en la barra: aquí no se dice «no hay supervisores».
        errorSupervisores ? null : (
          <EstadoDeCarga
            vacio
            textoVacio={
              supervisores.length
                ? "Días laborados se trabaja por equipo: elija el supervisor en el selector de arriba."
                : "Todavía no hay usuarios con el rol Supervisor de Operaciones."
            }
          />
        )
      ) : (
        periodo && (
          <Matriz
            key={`${periodo}|${supervisorId ?? "todos"}`}
            periodo={periodo}
            supervisorId={supervisorId}
          />
        )
      )}
    </div>
  );
}

function Matriz({ periodo, supervisorId }) {
  const ctx = useNovedades();
  const { me, can } = ctx;
  const [matriz, setMatriz] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [borradores, setBorradores] = useState({});
  const [erroresCelda, setErroresCelda] = useState({});
  const [busqueda, setBusqueda] = useState("");
  // El buscador, para devolverle el foco al limpiar.
  const campoBusqueda = useRef(null);
  const [activa, setActiva] = useState(null);
  const [rango, setRango] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [dialogo, setDialogo] = useState(null);
  const [motivo, setMotivo] = useState(null);
  const contenedor = useRef(null);
  const matrizRef = useRef(null);
  const borradoresRef = useRef({});
  const erroresRef = useRef({});
  matrizRef.current = matriz;
  borradoresRef.current = borradores;
  erroresRef.current = erroresCelda;

  const almacen = useMemo(
    () => respaldo(`dias|${periodo}|${supervisorId ?? "todos"}|${me.user?.id}`),
    [periodo, supervisorId, me.user?.id],
  );

  const pedirMatriz = useCallback(
    () => novedadesService.matriz(periodo, supervisorId ?? undefined),
    [periodo, supervisorId],
  );

  const cola = useColaDeGuardado(async ({ alEmpezar }) => {
    const actual = matrizRef.current;
    if (!actual?.editable) return null;
    const enviadas = Object.entries(borradoresRef.current).filter(
      ([clave]) => !(clave in erroresRef.current),
    );
    if (!enviadas.length) return null;
    alEmpezar();
    // Cada celda va al equipo de su fila (con un solo supervisor, todas al
    // mismo): un envío por equipo.
    const porEquipo = new Map();
    for (const [clave, horas] of enviadas) {
      const [cid, dia] = clave.split("|");
      const fila = actual.rows.find((r) => r.collaborator_id === Number(cid));
      const equipo = fila?.supervisor_id ?? actual.supervisor?.id;
      if (equipo === undefined) continue;
      const lista = porEquipo.get(equipo) ?? [];
      lista.push({
        clave,
        celda: {
          collaborator_id: Number(cid),
          date: dia,
          hours: horas.trim() === "" ? null : horas.replace(",", "."),
          // null explícito: la celda estaba vacía al cargar; si otra persona
          // la llenó entretanto, el servidor responde conflicto en vez de
          // pisarla.
          version: fila?.cells?.[dia]?.version ?? null,
        },
      });
      porEquipo.set(equipo, lista);
    }
    const confirmadas = [];
    let fallo = null;
    for (const [equipo, lista] of porEquipo) {
      try {
        await novedadesService.guardarCeldas(
          actual.period.code,
          equipo,
          lista.map((x) => x.celda),
        );
        confirmadas.push(...lista.map((x) => x.clave));
      } catch (err) {
        fallo = errorDeNovedades(err, "No se pudieron guardar los cambios.");
        break;
      }
    }
    // Se quita el borrador solo si sigue siendo el valor enviado: lo escrito
    // mientras se guardaba queda para el próximo envío.
    if (confirmadas.length) {
      const valores = Object.fromEntries(enviadas);
      setBorradores((previos) => {
        const siguientes = { ...previos };
        for (const clave of confirmadas) {
          if (siguientes[clave] === valores[clave]) delete siguientes[clave];
        }
        return siguientes;
      });
      try {
        setMatriz(await pedirMatriz());
      } catch {
        // La matriz vieja sigue en pantalla; el próximo guardado la renueva.
      }
    }
    if (!fallo) return { enviadas: confirmadas.length };
    const celdas = Array.isArray(fallo.detalle?.cells)
      ? fallo.detalle.cells
      : [];
    if (celdas.length) {
      // Rechazo por celda (dato inválido, plazo vencido, fecha futura,
      // conflicto): esas quedan marcadas y conservadas; las demás se
      // vuelven a enviar sin ellas.
      setErroresCelda((previos) => ({
        ...previos,
        ...Object.fromEntries(
          celdas.map((c) => [claveDe(c.collaborator_id, c.date), c.message]),
        ),
      }));
      if (fallo.codigo === "conflict") {
        try {
          setMatriz(await pedirMatriz());
        } catch {
          // idem
        }
      }
      cola.programar(50);
      return {
        rechazadas: `${celdas.length} celda(s) no se guardaron: revise las marcadas en rojo.`,
      };
    }
    return { fallo };
  });

  const cargar = useCallback(async () => {
    setErrorCarga(null);
    try {
      const datos = await pedirMatriz();
      setMatriz(datos);
      // Lo que quedó sin confirmar (corte de red, cambio de pantalla) se
      // recupera y se vuelve a enviar solo.
      const recuperados = almacen.leer() ?? {};
      setBorradores(recuperados);
      setErroresCelda({});
      if (Object.keys(recuperados).length) {
        cola.setEstado("pending");
        cola.setMensaje(
          "Se recuperaron cambios que no se habían confirmado; se envían automáticamente.",
        );
        cola.programar(300);
      }
    } catch (err) {
      setMatriz(null);
      setErrorCarga(
        errorDeNovedades(err, "No se pudo cargar Días laborados.").mensaje,
      );
    }
    // `cola` es estable en lo que se usa aquí (setEstado, setMensaje, programar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedirMatriz, almacen]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const pendientes = Object.keys(borradores).length;
  const { marcarPendientes } = ctx;
  useEffect(() => {
    if (!matriz) return;
    if (pendientes) almacen.guardar(borradores);
    else almacen.borrar();
    marcarPendientes(pendientes);
  }, [borradores, pendientes, matriz, almacen, marcarPendientes]);
  useEffect(() => () => marcarPendientes(0), [marcarPendientes]);

  // En cada tecla, sin distinguir tildes ni mayúsculas (búsqueda en vivo,
  // 06/11/2026). La grilla puede ser grande —un equipo por los días del
  // mes—: con el valor diferido el campo responde primero y la grilla se
  // vuelve a pintar después, sin trabar el tecleo.
  const buscado = useDeferredValue(busqueda.trim());
  const filas = useMemo(() => {
    if (!matriz) return [];
    if (!buscado) return matriz.rows;
    return matriz.rows.filter((r) =>
      coincideBusqueda(buscado, r.full_name, r.cedula),
    );
  }, [matriz, buscado]);

  const arrastre = useArrastreRelleno({
    contenedorRef: contenedor,
    alSoltar: ({ col, desde, hasta }) => {
      copiar(col, desde, filasDestino(desde, hasta));
      setRango({ c: col, r1: desde, r2: hasta });
    },
  });

  const esAdministrador = me.national_write && can(PERM.colaboradores);
  const gestionaColaboradores = can(PERM.colaboradores) && !me.is_assistant;
  const corrigeCerrados = can(PERM.corregir) && me.national_write;

  function valorDe(fila, dia) {
    const clave = claveDe(fila.collaborator_id, dia);
    if (clave in borradores) return borradores[clave];
    return fila.cells?.[dia]?.hours ?? "";
  }

  /** La misma regla que deshabilita la celda: fin de semana, fila sin
   * edición, plazo vencido o fecha futura (ya resuelto por el servidor para
   * esta persona), celda del equipo anterior, o colaborador no activo sin
   * valor previo. */
  function bloqueada(fila, columna) {
    const editable = fila.editable ?? matriz?.editable ?? false;
    const tieneValor = (fila.cells?.[columna.date]?.hours ?? null) !== null;
    return (
      columna.is_weekend ||
      !editable ||
      columna.deadline_state === "future" ||
      columna.deadline_state === "expired" ||
      Boolean(fila.cells?.[columna.date]?.other_team) ||
      (fila.status !== "ACTIVE" && !tieneValor)
    );
  }

  function motivoDeBloqueo(fila, columna) {
    if (columna.is_weekend) return "Sábado o domingo: no admite registros.";
    if (columna.deadline_state === "future")
      return "Fecha futura: no se registran novedades por adelantado.";
    if (columna.deadline_state === "expired")
      return `El plazo venció el ${columna.deadline_label}: solicite la corrección al Asistente de Operaciones o al Administrador.`;
    const otro = fila.cells?.[columna.date]?.other_team;
    if (otro)
      return `Lo registró el equipo de ${otro} (colaborador reasignado): no se modifica desde aquí.`;
    if (columna.deadline_state === "late")
      return `El plazo venció el ${columna.deadline_label}: su corrección queda registrada como fuera de plazo.`;
    return null;
  }

  function cambiarCelda(fila, dia, crudo) {
    if (!HORAS_MIENTRAS_ESCRIBE.test(crudo)) return;
    const clave = claveDe(fila.collaborator_id, dia);
    const original = fila.cells?.[dia]?.hours ?? "";
    setBorradores((previos) => {
      const siguientes = { ...previos };
      if (crudo === original) delete siguientes[clave];
      else siguientes[clave] = crudo;
      return siguientes;
    });
    setErroresCelda((previos) => {
      if (!(clave in previos)) return previos;
      const siguientes = { ...previos };
      delete siguientes[clave];
      return siguientes;
    });
    cola.programar();
  }

  /** Copia el valor de la celda origen en las filas destino de la misma
   * fecha (nunca una serie). Las bloqueadas no se tocan y se informan; el
   * resto entra como borrador y se guarda con el guardado automático. */
  function copiar(indiceColumna, indiceOrigen, destinos) {
    const columna = matriz?.columns[indiceColumna - COLUMNAS_FIJAS];
    const origen = filas[indiceOrigen];
    if (!columna || !origen) return;
    const valor = valorDe(origen, columna.date);
    const antes = {};
    const originales = {};
    const cambios = {};
    let saltadas = 0;
    for (const i of destinos) {
      const fila = filas[i];
      if (!fila) continue;
      if (bloqueada(fila, columna)) {
        saltadas += 1;
        continue;
      }
      if (valorDe(fila, columna.date) === valor) continue;
      const clave = claveDe(fila.collaborator_id, columna.date);
      antes[clave] = clave in borradores ? borradores[clave] : undefined;
      originales[clave] = fila.cells?.[columna.date]?.hours ?? "";
      cambios[clave] = valor;
    }
    const copiadas = Object.keys(cambios).length;
    if (!copiadas && !saltadas) {
      setAviso({
        texto: "Las celdas de destino ya tienen ese valor.",
        tono: "info",
      });
      return;
    }
    setBorradores((previos) => {
      const siguientes = { ...previos };
      for (const [clave, v] of Object.entries(cambios)) {
        if (v === originales[clave]) delete siguientes[clave];
        else siguientes[clave] = v;
      }
      return siguientes;
    });
    setErroresCelda((previos) =>
      Object.fromEntries(
        Object.entries(previos).filter(([k]) => !(k in cambios)),
      ),
    );
    if (copiadas) cola.programar();
    const deshacer = () => {
      const vigente = matrizRef.current;
      setBorradores((previos) => {
        const siguientes = { ...previos };
        for (const clave of Object.keys(cambios)) {
          const deseado = antes[clave] ?? originales[clave];
          const [cid, dia] = clave.split("|");
          const guardado =
            vigente?.rows.find((r) => r.collaborator_id === Number(cid))
              ?.cells?.[dia]?.hours ?? "";
          if (deseado === guardado && !cola.enVuelo.current)
            delete siguientes[clave];
          else siguientes[clave] = deseado;
        }
        return siguientes;
      });
      setAviso(null);
      cola.programar();
    };
    setAviso({
      texto:
        `${fecha(columna.date)}: valor copiado en ${copiadas} fila(s)` +
        (saltadas ? `; ${saltadas} bloqueada(s) sin cambios` : "") +
        ". Se guarda automáticamente.",
      tono: saltadas ? "warn" : "ok",
      accion: copiadas ? { texto: "Deshacer", onClick: deshacer } : undefined,
    });
  }

  /** Copiar hacia abajo (Ctrl+D): con un rango en la columna, la primera
   * celda en el resto; si no, la de arriba en la activa. */
  function copiarHaciaAbajo() {
    if (!activa) return;
    if (rango && rango.c === activa.c && rango.r1 !== rango.r2) {
      const [a, b] =
        rango.r1 <= rango.r2 ? [rango.r1, rango.r2] : [rango.r2, rango.r1];
      copiar(activa.c, a, filasDestino(a, b));
      return;
    }
    if (activa.r > 0) copiar(activa.c, activa.r - 1, [activa.r]);
  }

  /** Sin teclado (al tacto): el valor de la celda activa en todas las filas
   * de abajo de la misma fecha. Se puede deshacer desde el aviso. */
  function copiarALasDeAbajo() {
    if (!activa) return;
    const destinos = filas.map((_, i) => i).filter((i) => i > activa.r);
    if (!destinos.length) {
      setAviso({
        texto: "No hay filas debajo de la celda elegida.",
        tono: "info",
      });
      return;
    }
    copiar(activa.c, activa.r, destinos);
  }

  function enfocarCelda(r, c) {
    const celda = contenedor.current?.querySelector(
      `input[data-r="${r}"][data-c="${c}"]`,
    );
    celda?.focus();
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
    const movimientos = {
      ArrowDown: [1, 0],
      Enter: [1, 0],
      ArrowUp: [-1, 0],
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
    };
    const mov = movimientos[evento.key];
    if (!mov) return;
    if (
      (evento.key === "ArrowLeft" || evento.key === "ArrowRight") &&
      objetivo.selectionStart !== objetivo.selectionEnd
    )
      return;
    evento.preventDefault();
    // Moverse confirma la celda: se guarda enseguida. Las bloqueadas también
    // reciben el foco: así se lee por qué no se editan.
    cola.programar(150);
    enfocarCelda(r + mov[0], c + mov[1]);
  }

  function descartarRechazadas() {
    setBorradores((previos) =>
      Object.fromEntries(
        Object.entries(previos).filter(([k]) => !(k in erroresCelda)),
      ),
    );
    setErroresCelda({});
    cola.setEstado("idle");
    cola.setMensaje(null);
  }

  function terminarDialogo(texto, tono = "ok") {
    setDialogo(null);
    if (texto) setAviso({ texto, tono });
    cargar();
  }

  async function exportar() {
    try {
      await novedadesService.exportarDias(
        matriz.period.code,
        matriz.supervisor.id,
      );
    } catch (err) {
      setAviso({
        texto: errorDeNovedades(err, "No se pudo exportar.").mensaje,
        tono: "bad",
      });
    }
  }

  if (errorCarga) {
    return <EstadoDeCarga error={errorCarga} onReintentar={cargar} />;
  }
  if (!matriz) return <EstadoDeCarga cargando />;

  const rechazadas = Object.keys(erroresCelda).length;
  // Todos los rechazos, cada uno con un botón que lleva a su celda.
  const listaDeRechazos = Object.entries(erroresCelda).map(
    ([clave, mensaje]) => {
      const [cid, dia] = clave.split("|");
      const fila = matriz.rows.find((f) => f.collaborator_id === Number(cid));
      return {
        clave,
        mensaje,
        nombre: fila?.full_name ?? "Colaborador",
        dia,
        r: filas.findIndex((f) => f.collaborator_id === Number(cid)),
        c: matriz.columns.findIndex((col) => col.date === dia) + COLUMNAS_FIJAS,
      };
    },
  );
  const filasElegidas =
    rango && rango.r1 !== rango.r2 ? Math.abs(rango.r2 - rango.r1) + 1 : 0;
  const columnaActiva = activa
    ? matriz.columns[activa.c - COLUMNAS_FIJAS]
    : null;
  const celdaActivaEditable = Boolean(
    columnaActiva &&
    filas[activa.r] &&
    !bloqueada(filas[activa.r], columnaActiva),
  );
  const accionesDeFila = (fila) => {
    const abierta = (fila.period_status ?? matriz.period.status) === "OPEN";
    const colaborador = {
      id: fila.collaborator_id,
      full_name: fila.full_name,
      cedula: fila.cedula,
      status: fila.status,
    };
    return [
      gestionaColaboradores &&
        fila.is_current_member &&
        abierta && {
          texto: "Cambiar estado",
          onClick: () => setDialogo({ tipo: "estado", colaborador }),
        },
      esAdministrador && {
        texto: "Corregir cédula",
        onClick: () => setDialogo({ tipo: "cedula", colaborador }),
      },
      esAdministrador && {
        texto: "Retirar de Días laborados",
        peligro: true,
        onClick: () => setDialogo({ tipo: "retirar", colaborador }),
      },
    ];
  };

  return (
    <>
      <div className="gh-barra">
        <div className="gh-barra__grupo">
          <strong>{matriz.supervisor?.name ?? "Todos los supervisores"}</strong>
          <span className="mz-faint">· {matriz.period.label}</span>
          {!matriz.supervisor && matriz.supervisors_total !== undefined && (
            <span className="mz-faint">
              · {matriz.supervisors_closed} de {matriz.supervisors_total}{" "}
              supervisores cerraron
            </span>
          )}
          {matriz.supervisor && (
            <span
              className={`mz-pill ${TONO_PERIODO[matriz.period.status] ?? "mz-pill--neutral"}`}
            >
              {matriz.period.status === "CLOSED" ? <Icon name="lock" /> : null}{" "}
              {ESTADO_PERIODO[matriz.period.status] ?? matriz.period.status}
            </span>
          )}
          {matriz.period.status === "CLOSED" && matriz.period.closed_at && (
            <span className="mz-small mz-faint">
              Cerrado el {fechaHora(matriz.period.closed_at)} por{" "}
              {matriz.period.closed_by}
            </span>
          )}
          {!matriz.editable && matriz.period.status === "OPEN" && (
            <span className="mz-pill mz-pill--info">Solo lectura</span>
          )}
        </div>
        <div className="gh-barra__grupo">
          <div className="mz-fb-search mz-fb-search--compact">
            <Icon name="search" />
            <input
              ref={campoBusqueda}
              type="search"
              aria-label="Buscar por cédula o nombre"
              placeholder="Buscar cédula o nombre"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <AnuncioDeResultados termino={buscado} total={filas.length} />
          {matriz.supervisor && can(PERM.exportar) && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={exportar}
            >
              <Icon name="file-earmark-excel" /> Exportar a Excel
            </button>
          )}
          {matriz.supervisor && matriz.editable && can(PERM.importar) && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setDialogo({ tipo: "importar" })}
            >
              <Icon name="upload" /> Importar
            </button>
          )}
          {matriz.supervisor && matriz.closable && (
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              disabled={pendientes > 0}
              onClick={() => setDialogo({ tipo: "cerrar" })}
            >
              <Icon name="lock" /> Cerrar período
            </button>
          )}
        </div>
      </div>
      {matriz.supervisor && matriz.closable && pendientes > 0 && (
        <p className="mz-small mz-faint mb-0">
          «Cerrar período» se habilita cuando se guarden los cambios pendientes.
        </p>
      )}
      {!matriz.supervisor && (
        <p className="mz-small mz-faint mb-0">
          Para importar, exportar o cerrar el período, elija un supervisor
          arriba.
        </p>
      )}

      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      {matriz.editable && (
        <div className="gh-barra">
          <IndicadorDeGuardado
            estado={cola.estado}
            pendientes={pendientes}
            mensaje={cola.mensaje}
            onReintentar={cola.ahora}
          >
            {rechazadas > 0 && (
              <button
                type="button"
                className="btn btn-link btn-sm p-0"
                onClick={descartarRechazadas}
              >
                <Icon name="arrow-counterclockwise" /> Deshacer las celdas
                rechazadas
              </button>
            )}
          </IndicadorDeGuardado>
          <div className="gh-barra__grupo">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={!celdaActivaEditable}
              title="Copia la celda de arriba en la elegida o, con un rango (Mayús+↓), la primera del rango en el resto. Atajo: Ctrl+D"
              onClick={copiarHaciaAbajo}
            >
              <Icon name="arrow-down-square" /> Copiar hacia abajo
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={!celdaActivaEditable}
              onClick={copiarALasDeAbajo}
            >
              <Icon name="arrow-bar-down" /> Copiar a las filas de abajo
            </button>
          </div>
        </div>
      )}

      {listaDeRechazos.length > 0 && (
        <div
          className="mz-alert mz-alert--bad"
          role="status"
          aria-live="polite"
        >
          <Icon name="x-octagon" />
          <div>
            <strong>Estas celdas no se guardaron:</strong>
            <ul className="gh-lista-errores">
              {listaDeRechazos.map((e) => (
                <li key={e.clave}>
                  <button
                    type="button"
                    className="gh-enlace"
                    disabled={e.r < 0}
                    onClick={() => enfocarCelda(e.r, e.c)}
                  >
                    {e.nombre} · {fecha(e.dia)}
                  </button>
                  : {e.mensaje}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="gh-leyenda" aria-hidden="true">
        <span>
          <span className="gh-leyenda__muestra gh-finde" /> Sábado o domingo
        </span>
        <span>
          <span className="gh-leyenda__muestra gh-celda--bloqueada" /> Bloqueada
          (al elegirla se explica por qué)
        </span>
        <span>
          <span className="gh-leyenda__muestra gh-celda--tarde" /> Fuera de
          plazo (el cambio queda registrado así)
        </span>
        <span>
          <span className="gh-leyenda__muestra gh-celda--pendiente" /> Por
          guardar
        </span>
        <span>
          <span className="gh-leyenda__muestra gh-celda--error" /> No se guardó
        </span>
        {matriz.editable && (
          <span className="gh-solo-teclado">
            Ctrl+D copia hacia abajo · Mayús+↓ elige un rango
          </span>
        )}
      </div>

      {matriz.rows.length === 0 ? (
        <EstadoDeCarga
          vacio
          textoVacio={
            matriz.supervisor
              ? "No hay colaboradores en la base de este supervisor. Regístrelos en «Colaboradores»."
              : "No hay colaboradores en las bases de los supervisores autorizados para este período."
          }
        />
      ) : filas.length === 0 ? (
        <EstadoDeCarga
          vacio
          hayFiltros
          termino={buscado}
          campoBusquedaRef={campoBusqueda}
          etiquetaLimpiar="Limpiar búsqueda"
          onLimpiarFiltros={() => setBusqueda("")}
        />
      ) : (
        <>
          <div
            ref={contenedor}
            className="gh-grilla-wrap"
            role="region"
            aria-label={`Días laborados de ${matriz.period.label}`}
            // Se desplaza con el teclado aunque todas sus celdas estén bloqueadas.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
          >
            <table className="gh-grilla gh-grilla--dias">
              <caption className="visually-hidden">
                Días laborados de {matriz.period.label}: una fila por
                colaborador y una columna por día.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="gh-fija gh-col-cedula">
                    Cédula
                  </th>
                  <th scope="col" className="gh-fija gh-col-empleado">
                    Empleado
                  </th>
                  <th scope="col" className="gh-col-secundaria">
                    Supervisor
                  </th>
                  <th scope="col" className="gh-col-secundaria">
                    Cargo
                  </th>
                  {matriz.columns.map((c) => (
                    <th
                      key={c.date}
                      scope="col"
                      className={`gh-col-dia ${c.is_weekend ? "gh-finde" : c.holiday ? "gh-feriado" : ""}`}
                      title={`${c.weekday} ${fecha(c.date)}${c.holiday ? ` · Feriado: ${c.holiday}` : ""}`}
                    >
                      <span className="gh-col-dia__num">
                        {String(c.day).padStart(2, "0")}
                      </span>
                      <span className="gh-col-dia__sem">
                        {c.weekday.slice(0, 3)}
                      </span>
                      <span className="visually-hidden">
                        {` ${c.weekday} ${fecha(c.date)}${c.holiday ? `, feriado ${c.holiday}` : ""}`}
                      </span>
                    </th>
                  ))}
                  <th scope="col" className="gh-num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila, r) => {
                  const corrige =
                    corrigeCerrados &&
                    (fila.period_status ?? matriz.period.status) === "CLOSED";
                  return (
                    <tr
                      key={`${fila.supervisor_id ?? ""}-${fila.collaborator_id}`}
                      data-fila={r}
                    >
                      <td className="gh-fija gh-col-cedula gh-texto gh-mono">
                        {fila.cedula}
                      </td>
                      <th scope="row" className="gh-fija gh-col-empleado">
                        <span className="gh-identidad">
                          <span className="gh-identidad__texto">
                            <span
                              className="gh-identidad__nombre"
                              title={fila.full_name}
                            >
                              {fila.full_name}
                            </span>
                            <span className="gh-identidad__secundaria gh-mono">
                              {fila.cedula}
                            </span>
                          </span>
                          {fila.status !== "ACTIVE" && (
                            <span
                              className={`mz-pill ${fila.status === "SUSPENDED" ? "mz-pill--warn" : "mz-pill--neutral"}`}
                            >
                              {ESTADO_COLABORADOR[fila.status]}
                            </span>
                          )}
                          <MenuDeAcciones
                            etiqueta={`Más acciones para ${fila.full_name}`}
                            acciones={accionesDeFila(fila)}
                          />
                        </span>
                      </th>
                      <td className="gh-texto mz-faint gh-col-secundaria">
                        {fila.supervisor_name ?? matriz.supervisor?.name}
                      </td>
                      <td className="gh-texto gh-col-secundaria">
                        {fila.cargo}
                      </td>
                      {matriz.columns.map((columna, ci) => {
                        const c = ci + COLUMNAS_FIJAS;
                        const clave = claveDe(
                          fila.collaborator_id,
                          columna.date,
                        );
                        const valor = valorDe(fila, columna.date);
                        const error = erroresCelda[clave];
                        const etiqueta = `${fila.full_name}, ${columna.weekday} ${fecha(columna.date)}`;
                        if (corrige && !columna.is_weekend) {
                          return (
                            <td key={columna.date} className="gh-celda">
                              <button
                                type="button"
                                className="gh-celda__corregir"
                                aria-label={`Corregir ${etiqueta} (período cerrado). Valor: ${valor || "vacío"}`}
                                onClick={() =>
                                  setDialogo({
                                    tipo: "corregir",
                                    fila,
                                    dia: columna.date,
                                  })
                                }
                              >
                                {valor}
                              </button>
                            </td>
                          );
                        }
                        const cerrada = bloqueada(fila, columna);
                        const tarde =
                          !cerrada && columna.deadline_state === "late";
                        const pendiente = clave in borradores;
                        const motivoCelda =
                          error ??
                          (tarde
                            ? `Esta fecha ya venció (${columna.deadline_label}): el cambio queda como fuera de plazo.`
                            : cerrada
                              ? (motivoDeBloqueo(fila, columna) ??
                                "No se puede editar.")
                              : null);
                        const enRango =
                          rango &&
                          rango.c === c &&
                          rango.r1 !== rango.r2 &&
                          r >= Math.min(rango.r1, rango.r2) &&
                          r <= Math.max(rango.r1, rango.r2);
                        const clases = [
                          "gh-celda",
                          columna.is_weekend && "gh-finde",
                          cerrada &&
                            !columna.is_weekend &&
                            "gh-celda--bloqueada",
                          tarde && "gh-celda--tarde",
                          arrastre.enArrastre(r, c) && "gh-celda--arrastre",
                          error && "gh-celda--error",
                          pendiente && !error && "gh-celda--pendiente",
                          enRango && "gh-celda--rango",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        const conControlador =
                          activa?.r === r &&
                          activa?.c === c &&
                          !arrastre.arrastre &&
                          !cerrada &&
                          valor.trim() !== "";
                        const nombre = [
                          etiqueta,
                          pendiente && !error ? "por guardar" : null,
                          motivoCelda,
                        ]
                          .filter(Boolean)
                          .join(", ");
                        return (
                          <td key={columna.date} className={clases}>
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              data-r={r}
                              data-c={c}
                              value={valor}
                              readOnly={cerrada}
                              aria-disabled={cerrada ? true : undefined}
                              aria-label={nombre}
                              aria-invalid={error ? true : undefined}
                              onChange={(e) =>
                                !cerrada &&
                                cambiarCelda(fila, columna.date, e.target.value)
                              }
                              onBlur={() => pendiente && cola.programar(150)}
                              onKeyDown={teclas}
                              onFocus={(e) => {
                                setActiva({ r, c });
                                setMotivo(
                                  motivoCelda
                                    ? `${fila.full_name} · ${fecha(columna.date)}: ${motivoCelda}`
                                    : null,
                                );
                                if (
                                  !rango ||
                                  rango.c !== c ||
                                  (rango.r1 !== r && rango.r2 !== r)
                                ) {
                                  setRango({ c, r1: r, r2: r });
                                }
                                if (!cerrada) e.target.select();
                              }}
                            />
                            {conControlador && (
                              <button
                                type="button"
                                tabIndex={-1}
                                className="gh-relleno"
                                aria-label={`Arrastrar para copiar ${valor} a otras filas`}
                                title="Arrastre para copiar este valor a otras filas (Esc cancela)"
                                onMouseDown={(e) => arrastre.empezar(e, r, c)}
                              />
                            )}
                          </td>
                        );
                      })}
                      <td className="gh-num">
                        <strong>{fila.total_hours}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="gh-motivo mz-small" aria-live="polite">
            {motivo ?? ""}
            {filasElegidas > 0 && ` ${filasElegidas} filas elegidas.`}
          </p>
        </>
      )}

      {dialogo?.tipo === "cerrar" && (
        <CerrarPeriodo
          periodo={matriz.period.code}
          supervisorId={matriz.supervisor.id}
          hoy={me.deadline_rules?.today}
          finDelPeriodo={matriz.period.end_date}
          onCerrar={() => setDialogo(null)}
          onCerrado={(texto) => {
            ctx.recargarPeriodos();
            terminarDialogo(texto);
          }}
        />
      )}
      {dialogo?.tipo === "importar" && (
        <ImportarExcel
          tipo="WORKED_DAYS"
          periodo={matriz.period.code}
          rango={matriz.period}
          supervisorId={matriz.supervisor.id}
          onCerrar={() => setDialogo(null)}
          onImportado={terminarDialogo}
        />
      )}
      {dialogo?.tipo === "estado" && (
        <CambiarEstado
          colaborador={dialogo.colaborador}
          onCerrar={() => setDialogo(null)}
          onHecho={terminarDialogo}
        />
      )}
      {dialogo?.tipo === "cedula" && (
        <CorregirCedula
          colaborador={dialogo.colaborador}
          onCerrar={() => setDialogo(null)}
          onHecho={terminarDialogo}
        />
      )}
      {dialogo?.tipo === "retirar" && (
        <RetirarDeDias
          colaborador={dialogo.colaborador}
          onCerrar={() => setDialogo(null)}
          onHecho={terminarDialogo}
        />
      )}
      {dialogo?.tipo === "corregir" && (
        <Correccion
          tipo="dia"
          titulo={`${dialogo.fila.full_name} · ${fecha(dialogo.dia)}`}
          valorActual={dialogo.fila.cells?.[dialogo.dia]?.hours ?? ""}
          cuerpo={{
            collaborator_id: dialogo.fila.collaborator_id,
            supervisor_id: dialogo.fila.supervisor_id ?? matriz.supervisor?.id,
            date: dialogo.dia,
          }}
          onCerrar={() => setDialogo(null)}
          onHecho={terminarDialogo}
        />
      )}
    </>
  );
}
