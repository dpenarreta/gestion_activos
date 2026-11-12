/*
 * Pestaña «Llamados»: la lista con sus filtros (persona, causa, nivel,
 * estado y fechas), «Emitir llamado» (`llamados.emitir`) o «Solicitar
 * llamado de atención» (solo `llamados.solicitar`) y el detalle. Qué llamados
 * llegan lo decide el servidor: con `ver` o `emitir`, todos; un jefe, solo
 * los que pidió. `?llamado=<id>` (el enlace de los avisos) abre el detalle.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { llamadosService } from "../../../api/llamadosService";
import { FilaDeEstado } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { mensajeDeError } from "../../../utils/errores";
import { formatearMoneda } from "../../../utils/formato";
import { Aviso, fecha } from "../comunes";
import { SelectorDePersonas, coincide } from "../SelectorDePersonas";
import { DetalleLlamado } from "./DetalleLlamado";
import { FormularioLlamado } from "./FormularioLlamado";
import {
  ESTADOS,
  SANCION,
  avisoDeEmision,
  causaDe,
  comoPersona,
  nivelDe,
  nombreDe,
  personaDe,
  tipoDe,
} from "./llamadosComunes";
import { PildoraEstado } from "./Piezas";

const SIN_FILTROS = {
  persona: "",
  causa: "",
  nivel: "",
  estado: "",
  desde: "",
  hasta: "",
};

export function ListaLlamados({
  causas,
  cargandoCausas,
  errorCausas,
  puedeEmitir,
  puedeVerTodos,
  puedeSolicitar,
  puedeConfigurar,
}) {
  const [parametros, setParametros] = useSearchParams();
  const [filtros, setFiltros] = useState(SIN_FILTROS);
  const [personaFiltro, setPersonaFiltro] = useState([]);
  const [llamados, setLlamados] = useState(null);
  const [error, setError] = useState(null);
  const [vez, setVez] = useState(0);
  const [pendientes, setPendientes] = useState(0);
  const [formulario, setFormulario] = useState(null);
  const [aviso, setAviso] = useState(null);
  const detalle = parametros.get("llamado");
  const zonaDeAviso = useRef(null);

  // El éxito de una acción se anuncia y recibe el foco: la ventana que la
  // hizo ya se cerró y el foco no debe quedar perdido.
  useEffect(() => {
    if (!aviso) return undefined;
    const cuadro = requestAnimationFrame(() => zonaDeAviso.current?.focus());
    return () => cancelAnimationFrame(cuadro);
  }, [aviso]);

  useEffect(() => {
    let vigente = true;
    setError(null);
    llamadosService
      .llamados(filtros)
      .then((lista) => vigente && setLlamados(lista))
      .catch((err) => {
        if (vigente) {
          setLlamados([]);
          setError(mensajeDeError(err, "No se pudieron cargar los llamados."));
        }
      });
    return () => {
      vigente = false;
    };
  }, [filtros, vez]);

  // Cuántas solicitudes esperan la revisión de Gestión Humana.
  useEffect(() => {
    if (!puedeEmitir) return undefined;
    let vigente = true;
    llamadosService
      .llamados({ estado: "solicitado" })
      .then((lista) => vigente && setPendientes(lista.length))
      .catch(() => vigente && setPendientes(0));
    return () => {
      vigente = false;
    };
  }, [puedeEmitir, vez]);

  const recargar = useCallback(() => {
    setLlamados(null);
    setVez((v) => v + 1);
  }, []);

  const causasActivas = useMemo(
    () => causas.filter((c) => c.activa !== false),
    [causas],
  );
  const niveles = useMemo(
    () =>
      causas.flatMap((c) =>
        (c.niveles ?? []).map((n) => ({ ...n, causaNombre: c.nombre })),
      ),
    [causas],
  );
  const nivelesVisibles = filtros.causa
    ? niveles.filter((n) =>
        causas
          .find((c) => String(c.id) === filtros.causa)
          ?.niveles?.some((x) => x.id === n.id),
      )
    : niveles;

  function fijar(clave, valor) {
    setLlamados(null);
    setFiltros((f) => ({
      ...f,
      [clave]: valor,
      // Un nivel de otra causa ya no aplica.
      ...(clave === "causa" ? { nivel: "" } : {}),
    }));
  }

  function limpiar() {
    setLlamados(null);
    setFiltros(SIN_FILTROS);
    setPersonaFiltro([]);
  }

  function abrirDetalle(id) {
    setParametros((actuales) => {
      const nuevos = new URLSearchParams(actuales);
      nuevos.set("llamado", String(id));
      return nuevos;
    });
  }
  function cerrarDetalle() {
    setParametros((actuales) => {
      const nuevos = new URLSearchParams(actuales);
      nuevos.delete("llamado");
      return nuevos;
    });
  }

  const hayFiltros = Object.values(filtros).some(Boolean);
  const cargando = llamados === null;
  const modo = puedeEmitir ? "emitir" : "solicitar";
  const puedeRegistrar = puedeEmitir || puedeSolicitar;
  const sinCausas = !cargandoCausas && !errorCausas && !causasActivas.length;
  const etiquetaRegistrar = puedeEmitir
    ? "Emitir llamado"
    : "Solicitar llamado de atención";

  return (
    <div className="mz-stack">
      <div className="d-flex flex-wrap gap-2 align-items-center">
        {puedeRegistrar && !sinCausas && (
          <button
            type="button"
            className="btn btn-primary mz-tactil"
            onClick={() => setFormulario(modo)}
            disabled={cargandoCausas || Boolean(errorCausas)}
          >
            <Icon name="plus-lg" /> {etiquetaRegistrar}
          </button>
        )}
        {!puedeVerTodos && (
          <span className="mz-small mz-faint">
            Aquí ve los llamados que usted solicitó.
          </span>
        )}
      </div>
      {sinCausas && puedeRegistrar && (
        <p className="mz-alert mz-alert--info mb-0" role="status">
          <Icon name="info-circle" />
          <span>
            No hay causas activas para registrar llamados.{" "}
            {puedeConfigurar ? (
              <Link to="?vista=causas">Configure una causa</Link>
            ) : (
              "Pida a Gestión Humana que configure una."
            )}
          </span>
        </p>
      )}
      {errorCausas && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          <span>{errorCausas}</span>
        </div>
      )}

      {puedeEmitir && pendientes > 0 && (
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="exclamation-triangle" />
          <span className="flex-grow-1">
            {pendientes === 1
              ? "1 solicitud espera su revisión."
              : `${pendientes} solicitudes esperan su revisión.`}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm mz-tactil"
            onClick={() => fijar("estado", "solicitado")}
          >
            Ver
            <span className="visually-hidden"> las solicitudes</span>
          </button>
        </div>
      )}
      <div ref={zonaDeAviso} tabIndex={-1}>
        <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
      </div>

      <form
        className="mz-filter-bar"
        role="search"
        aria-label="Filtrar llamados"
        onSubmit={(e) => e.preventDefault()}
      >
        {puedeVerTodos && (
          <div className="w-100">
            <SelectorDePersonas
              id="filtro-persona"
              leyenda="Persona"
              etiquetaBuscador="Buscar persona"
              multiple={false}
              elegidos={personaFiltro}
              onCambio={(elegidas) => {
                setPersonaFiltro(elegidas);
                fijar("persona", elegidas[0]?.id ?? "");
              }}
              buscar={(texto) =>
                llamadosService
                  .personas(texto, puedeEmitir ? "emitir" : "ver")
                  .then((lista) =>
                    lista.map(comoPersona).filter((p) => coincide(p, texto)),
                  )
              }
            />
          </div>
        )}
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por causa"
          value={filtros.causa}
          onChange={(e) => fijar("causa", e.target.value)}
        >
          <option value="">Todas las causas</option>
          {causas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por nivel"
          value={filtros.nivel}
          onChange={(e) => fijar("nivel", e.target.value)}
        >
          <option value="">Todos los niveles</option>
          {nivelesVisibles.map((n) => (
            <option key={n.id} value={n.id}>
              {filtros.causa ? n.nombre : `${n.causaNombre} · ${n.nombre}`}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por estado"
          value={filtros.estado}
          onChange={(e) => fijar("estado", e.target.value)}
        >
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([id, e]) => (
            <option key={id} value={id}>
              {e.texto}
            </option>
          ))}
        </select>
        <label className="mz-small d-flex align-items-center gap-1">
          Desde
          <input
            type="date"
            className="form-control form-control-sm"
            value={filtros.desde}
            max={filtros.hasta || undefined}
            onChange={(e) => fijar("desde", e.target.value)}
          />
        </label>
        <label className="mz-small d-flex align-items-center gap-1">
          Hasta
          <input
            type="date"
            className="form-control form-control-sm"
            value={filtros.hasta}
            min={filtros.desde || undefined}
            onChange={(e) => fijar("hasta", e.target.value)}
          />
        </label>
      </form>

      <div className="mz-table-wrap" aria-busy={cargando}>
        <table className="mz-table">
          <caption className="visually-hidden">Llamados de atención</caption>
          <thead>
            <tr>
              <th scope="col">N.º</th>
              <th scope="col">Fecha del hecho</th>
              <th scope="col">Persona</th>
              <th scope="col">Causa</th>
              <th scope="col">Nivel</th>
              <th scope="col">Estado</th>
              {puedeEmitir && <th scope="col">Solicitado por</th>}
              <th scope="col">Monto</th>
              <th scope="col">
                <span className="visually-hidden">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(llamados ?? []).map((l) => (
              <tr key={l.id}>
                <td>{l.numero ?? "—"}</td>
                <td>{fecha(l.fecha_hecho)}</td>
                <td>{nombreDe(personaDe(l))}</td>
                <td>{nombreDe(causaDe(l))}</td>
                <td>{nombreDe(nivelDe(l))}</td>
                <td>
                  <PildoraEstado estado={l.estado} />
                </td>
                {puedeEmitir && (
                  <td>
                    {l.estado === "solicitado" || l.solicitado_por
                      ? nombreDe(l.solicitado_por)
                      : "—"}
                  </td>
                )}
                <td className="num">
                  {tipoDe(l) === SANCION || l.monto
                    ? formatearMoneda(l.monto)
                    : "—"}
                </td>
                <td className="num">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm mz-tactil"
                    onClick={() => abrirDetalle(l.id)}
                  >
                    Ver
                    <span className="visually-hidden">
                      {" "}
                      el llamado a {nombreDe(personaDe(l))}
                    </span>
                  </button>
                </td>
              </tr>
            ))}
            <FilaDeEstado
              columnas={puedeEmitir ? 9 : 8}
              cargando={cargando}
              error={error}
              onReintentar={recargar}
              vacio={llamados?.length === 0 && !error}
              hayFiltros={hayFiltros}
              onLimpiarFiltros={limpiar}
              textoVacio={
                puedeVerTodos
                  ? "Aún no hay llamados de atención registrados."
                  : "Aún no ha solicitado ningún llamado de atención."
              }
              accionVacio={
                puedeRegistrar && !sinCausas ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm mz-tactil"
                    onClick={() => setFormulario(modo)}
                    disabled={cargandoCausas || Boolean(errorCausas)}
                  >
                    {puedeEmitir ? "Emitir el primero" : "Solicitar el primero"}
                  </button>
                ) : null
              }
            />
          </tbody>
        </table>
      </div>

      {formulario && (
        <FormularioLlamado
          modo={formulario}
          causas={causas}
          onCerrar={() => setFormulario(null)}
          onGuardado={(creado, emitido) => {
            setFormulario(null);
            setAviso(
              emitido
                ? avisoDeEmision(creado, "El llamado quedó emitido.")
                : {
                    texto:
                      "La solicitud quedó registrada. Gestión Humana la revisará.",
                  },
            );
            recargar();
          }}
        />
      )}
      {detalle && (
        <DetalleLlamado
          id={detalle}
          causas={causas}
          onCerrar={cerrarDetalle}
          onCambio={(nuevo) => {
            setAviso(nuevo);
            recargar();
          }}
        />
      )}
    </div>
  );
}
