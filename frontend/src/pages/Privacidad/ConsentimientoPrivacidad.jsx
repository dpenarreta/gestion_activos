/*
 * Consentimiento del tratamiento de datos (`/admin/privacidad/consentimiento`,
 * 09/11/2026): el aviso que cada persona acepta al entrar, con su versión, y
 * quién lo aceptó. Con `privacidad.ver` se consulta; con `privacidad.atender`
 * además se edita el texto, se pide aceptarlo de nuevo y se restablece el
 * consentimiento de una persona o de todas. El servidor vuelve a exigir cada
 * permiso.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  errorDePrivacidad,
  privacidadService,
} from "../../api/privacidadService";
import { AnuncioDeResultados } from "../../components/common/AnuncioDeResultados/AnuncioDeResultados";
import { confirmar } from "../../components/common/Confirmar/confirmar";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { Paginacion } from "../../components/common/Paginacion/Paginacion";
import { useBusquedaEnVivo } from "../../hooks/useBusquedaEnVivo";
import { useListadoPaginado } from "../../hooks/useListadoPaginado";
import { useVistaDeTarjetas } from "../../hooks/useMediaQuery";
import { fechaHora } from "../GestionHumana/comunes";
import { RUTA_BANDEJA } from "./privacidadComunes";
import { TextoDelAviso } from "./TextoDelAviso";
import "./Privacidad.css";

const AVISO_MAX = 20000;

export function ConsentimientoPrivacidad() {
  const [resumen, setResumen] = useState(null);
  const [errorResumen, setErrorResumen] = useState("");
  // { tipo: "ok" | "error", texto }: el éxito se anuncia con cortesía y el
  // error de inmediato, cada uno con su color.
  const [anuncio, setAnuncio] = useState(null);
  const enTarjetas = useVistaDeTarjetas();

  const cargarResumen = useCallback(() => {
    setErrorResumen("");
    return privacidadService
      .aviso()
      .then(setResumen)
      .catch((err) =>
        setErrorResumen(
          errorDePrivacidad(err, "No se pudo cargar el aviso.").mensaje,
        ),
      );
  }, []);
  useEffect(() => {
    cargarResumen();
  }, [cargarResumen]);

  const cargar = useCallback(
    (params) => privacidadService.personasConsentimiento(params),
    [],
  );
  const listado = useListadoPaginado(
    cargar,
    { q: "", estado: "" },
    "No se pudieron cargar las personas.",
  );
  const busqueda = useBusquedaEnVivo({
    inicial: "",
    alBuscar: (q) => listado.actualizarFiltros({ q }),
  });

  const limpiarAnuncio = useCallback(() => setAnuncio(null), []);
  const anunciarError = useCallback(
    (texto) => setAnuncio({ tipo: "error", texto }),
    [],
  );

  function refrescar(mensaje) {
    setAnuncio({ tipo: "ok", texto: mensaje });
    cargarResumen();
    listado.refresh();
  }

  const puedeAtender = Boolean(resumen?.puede_atender);

  async function restablecerTodos() {
    limpiarAnuncio();
    const si = await confirmar({
      titulo: "¿Restablecer el consentimiento de todas las personas?",
      mensaje:
        "Todas tendrán que aceptar el aviso otra vez la próxima vez que entren. Las aceptaciones anteriores se conservan como constancia.",
      accion: "Restablecer a todas",
    });
    if (!si) return;
    try {
      const r = await privacidadService.restablecerTodos();
      refrescar(
        `Consentimiento restablecido: ${r.restablecidas} ${
          r.restablecidas === 1 ? "aceptación" : "aceptaciones"
        } sin efecto.`,
      );
    } catch (err) {
      anunciarError(errorDePrivacidad(err).mensaje);
    }
  }

  const personas = listado.resultados;
  const hayFiltros = Boolean(listado.filtros.q || listado.filtros.estado);
  const estadoDeLista = {
    error: listado.error,
    onReintentar: listado.refresh,
    cargando: listado.isLoading && personas.length === 0,
    vacio: !listado.isLoading && personas.length === 0,
    textoVacio: "No hay personas en la empresa.",
    hayFiltros,
    onLimpiarFiltros: () => {
      busqueda.fijar("");
      listado.actualizarFiltros({ q: "", estado: "" });
    },
    termino: listado.filtros.q,
  };
  const propsPersona = {
    puedeAtender,
    alEmpezar: limpiarAnuncio,
    alRestablecer: refrescar,
    alFallar: anunciarError,
  };

  return (
    <div className="mz-stack pv-consentimiento">
      <div className="mz-view-head">
        <div>
          <h2>Protección de datos: consentimiento</h2>
          <p className="mz-desc">
            El aviso de tratamiento de datos que cada persona acepta al entrar a
            la intranet, y quién lo aceptó.{" "}
            <Link to={RUTA_BANDEJA}>Ver las solicitudes de derechos</Link>
          </p>
        </div>
      </div>

      {/* Las dos regiones existen siempre (vacías): así se anuncia lo que
          entra en ellas. */}
      <div role="status">
        {anuncio?.tipo === "ok" && (
          <div className="mz-alert mz-alert--ok mb-0">
            <Icon name="check2-circle" /> {anuncio.texto}
          </div>
        )}
      </div>
      <div role="alert">
        {anuncio?.tipo === "error" && (
          <div className="mz-alert mz-alert--bad mb-0">
            <Icon name="x-octagon" /> {anuncio.texto}
          </div>
        )}
      </div>

      {errorResumen ? (
        <EstadoDeCarga error={errorResumen} onReintentar={cargarResumen} />
      ) : !resumen ? (
        <EstadoDeCarga cargando />
      ) : (
        <EditorDelAviso
          resumen={resumen}
          puedeAtender={puedeAtender}
          alEmpezar={limpiarAnuncio}
          alGuardar={(r, mensaje) => {
            setResumen(r);
            refrescar(mensaje);
          }}
          alRestablecerTodos={restablecerTodos}
        />
      )}

      <h3 className="h5 mb-0">Personas de la empresa</h3>
      <form
        className="mz-filter-bar"
        role="search"
        aria-label="Filtrar personas"
        onSubmit={(e) => {
          e.preventDefault();
          busqueda.buscarYa();
        }}
      >
        <label className="mz-fb-search" htmlFor="pv-consentimiento-buscar">
          <Icon name="search" />
          <span className="visually-hidden">Buscar personas</span>
          <input
            id="pv-consentimiento-buscar"
            type="search"
            placeholder="Nombre, usuario o correo"
            {...busqueda.propsCampo}
          />
        </label>
        <div className="mz-inline-field">
          <label htmlFor="pv-consentimiento-estado">Estado</label>
          <select
            id="pv-consentimiento-estado"
            className="form-select form-select-sm"
            value={listado.filtros.estado}
            onChange={(e) =>
              listado.actualizarFiltros({ estado: e.target.value })
            }
          >
            <option value="">Todas</option>
            <option value="ACEPTADO">Aceptaron el aviso vigente</option>
            <option value="PENDIENTE">Les falta aceptarlo</option>
          </select>
        </div>
      </form>
      <AnuncioDeResultados
        termino={listado.filtros.q}
        total={listado.total}
        sustantivo={["persona", "personas"]}
        cargando={listado.isLoading}
      />

      {/* En el teléfono, cada persona en una tarjeta (como la bandeja de
          solicitudes): cuatro columnas a 375 px se leían desplazándose. */}
      {enTarjetas ? (
        <div className="pv-tarjetas" aria-busy={listado.isLoading}>
          <EstadoDeCarga {...estadoDeLista} />
          {!listado.error && personas.length > 0 && (
            <ul className="mz-cards-lista" aria-label="Personas">
              {personas.map((p) => (
                <TarjetaPersona key={p.id} persona={p} {...propsPersona} />
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mz-table-wrap" aria-busy={listado.isLoading}>
          <table className="mz-table">
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col">Aviso vigente</th>
                <th scope="col">Última aceptación</th>
                <th scope="col">
                  <span className="visually-hidden">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => (
                <FilaPersona key={p.id} persona={p} {...propsPersona} />
              ))}
              <FilaDeEstado columnas={4} {...estadoDeLista} />
            </tbody>
          </table>
        </div>
      )}
      <Paginacion
        total={listado.total}
        pagina={listado.pagina}
        hasNext={listado.hasNext}
        hasPrevious={listado.hasPrevious}
        onCambiarPagina={listado.setPagina}
        etiqueta={listado.total === 1 ? "persona" : "personas"}
      />
    </div>
  );
}

function EditorDelAviso({
  resumen,
  puedeAtender,
  alEmpezar,
  alGuardar,
  alRestablecerTodos,
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [pedirDeNuevo, setPedirDeNuevo] = useState(false);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const campo = useRef(null);
  const botonEditar = useRef(null);
  // Al cerrar el editor (Guardar o Cancelar) el foco vuelve al botón que lo
  // abrió: si no, cae en <body> al desaparecer el formulario.
  const volverAlBoton = useRef(false);

  useEffect(() => {
    if (editando) {
      campo.current?.focus();
    } else if (volverAlBoton.current) {
      volverAlBoton.current = false;
      botonEditar.current?.focus();
    }
  }, [editando]);

  function empezar() {
    alEmpezar();
    setTexto(resumen.existe ? resumen.texto : resumen.texto_inicial);
    setPedirDeNuevo(false);
    setError("");
    setEditando(true);
  }

  function cerrar() {
    volverAlBoton.current = true;
    setEditando(false);
  }

  async function guardar(e) {
    e.preventDefault();
    if (guardando) return;
    if (!texto.trim()) {
      setError("Escriba el texto del aviso.");
      campo.current?.focus();
      return;
    }
    if (resumen.existe && pedirDeNuevo) {
      const si = await confirmar({
        titulo: "¿Pedir que todas las personas acepten el aviso de nuevo?",
        mensaje:
          "Sube la versión del aviso: nadie lo tendrá aceptado y cada persona lo aceptará la próxima vez que entre.",
        accion: "Guardar y pedir aceptación",
      });
      if (!si) return;
    }
    setGuardando(true);
    setError("");
    try {
      const r = await privacidadService.guardarAviso({ texto, pedirDeNuevo });
      cerrar();
      alGuardar(
        r,
        !resumen.existe
          ? "Aviso creado: cada persona lo aceptará al entrar."
          : pedirDeNuevo
            ? `Aviso guardado como versión ${r.version}: todas las personas lo aceptarán de nuevo.`
            : "Aviso guardado. La versión no cambió.",
      );
    } catch (err) {
      const e2 = errorDePrivacidad(err, "No se pudo guardar el aviso.");
      setError(e2.campos.texto || e2.mensaje);
    } finally {
      setGuardando(false);
    }
  }

  const { totales } = resumen;
  const describe = [
    "pv-aviso-ayuda",
    "pv-aviso-contador",
    error ? "pv-aviso-error" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="mz-card pv-aviso" aria-labelledby="pv-aviso-titulo">
      <div className="mz-row-between">
        <h3 id="pv-aviso-titulo" className="h5 mb-0">
          {resumen.existe
            ? `Aviso vigente (versión ${resumen.version})`
            : "Sin aviso"}
        </h3>
        {puedeAtender && !editando && (
          <div className="pv-acciones">
            <button
              ref={botonEditar}
              type="button"
              className="btn btn-sm btn-outline-primary"
              onClick={empezar}
            >
              <Icon name="pencil" />{" "}
              {resumen.existe ? "Editar el aviso" : "Crear el aviso"}
            </button>
            {resumen.existe && (
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={alRestablecerTodos}
              >
                <Icon name="arrow-counterclockwise" /> Restablecer a todas
              </button>
            )}
          </div>
        )}
      </div>
      {resumen.existe ? (
        <p className="mz-small mz-faint mb-0">
          Rige desde el {fechaHora(resumen.version_desde)}
          {resumen.editado_por ? ` · editado por ${resumen.editado_por}` : ""}
          {" · "}
          {totales.aceptaron} de {totales.personas}{" "}
          {totales.personas === 1
            ? "persona lo aceptó"
            : "personas lo aceptaron"}
        </p>
      ) : (
        <p className="mz-small mb-0">
          Esta empresa no tiene aviso: no se le pide aceptarlo a nadie.
        </p>
      )}

      {editando ? (
        <form onSubmit={guardar} noValidate className="mz-stack">
          <label htmlFor="pv-aviso-texto" className="form-label mb-0">
            Texto del aviso
          </label>
          <p id="pv-aviso-ayuda" className="mz-small mz-faint mb-0">
            Una línea en blanco separa párrafos; las líneas que empiezan con «-
            » forman una lista.
          </p>
          <textarea
            id="pv-aviso-texto"
            ref={campo}
            className={`form-control${error ? " is-invalid" : ""}`}
            rows={14}
            maxLength={AVISO_MAX}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            aria-describedby={describe}
            aria-invalid={Boolean(error)}
          />
          <p id="pv-aviso-contador" className="mz-small mz-faint mb-0">
            {texto.length}/{AVISO_MAX} caracteres
          </p>
          {error && (
            <div id="pv-aviso-error" className="invalid-feedback d-block">
              {error}
            </div>
          )}
          {/* Cómo lo verá cada persona al entrar, con párrafos y listas. */}
          <details className="pv-detalles">
            <summary>Vista previa</summary>
            <div className="pv-aviso-previa">
              <TextoDelAviso texto={texto} />
            </div>
          </details>
          {resumen.existe && (
            <label className="pv-casilla">
              <input
                type="checkbox"
                className="form-check-input"
                checked={pedirDeNuevo}
                onChange={(e) => setPedirDeNuevo(e.target.checked)}
              />
              Es un cambio sustancial: pedir que todas las personas lo acepten
              de nuevo
            </label>
          )}
          <div className="pv-acciones">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={cerrar}
            >
              Cancelar
            </button>
            {/* Sin `disabled` mientras guarda: el foco no cae en <body>. */}
            <button
              type="submit"
              className="btn btn-primary pv-boton-envio"
              aria-disabled={guardando}
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      ) : (
        resumen.existe && <TextoDelAviso texto={resumen.texto} />
      )}
    </section>
  );
}

/** Lo que comparten la fila (escritorio) y la tarjeta (teléfono). */
function usePersona(persona, { alEmpezar, alRestablecer, alFallar }) {
  const [historial, setHistorial] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");

  const cargarHistorial = useCallback(async () => {
    setError("");
    try {
      setHistorial(await privacidadService.historialConsentimiento(persona.id));
    } catch (err) {
      setError(
        errorDePrivacidad(err, "No se pudo cargar el historial.").mensaje,
      );
    }
  }, [persona.id]);

  function alternar() {
    if (abierto) {
      setAbierto(false);
      return;
    }
    setAbierto(true);
    cargarHistorial();
  }

  async function restablecer() {
    alEmpezar();
    const si = await confirmar({
      titulo: `¿Restablecer el consentimiento de ${persona.nombre}?`,
      mensaje:
        "Tendrá que aceptar el aviso otra vez la próxima vez que entre. Su aceptación anterior se conserva como constancia.",
      accion: "Restablecer",
    });
    if (!si) return;
    try {
      const r = await privacidadService.restablecerConsentimiento(persona.id);
      setHistorial(r);
      alRestablecer(`Consentimiento de ${persona.nombre} restablecido.`);
    } catch (err) {
      alFallar(errorDePrivacidad(err).mensaje);
    }
  }

  return { historial, abierto, error, alternar, restablecer, cargarHistorial };
}

function AccionesPersona({ persona, puedeAtender, estado, idHistorial }) {
  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={estado.alternar}
        aria-expanded={estado.abierto}
        aria-controls={idHistorial}
      >
        Historial
        <span className="visually-hidden"> de {persona.nombre}</span>
      </button>
      {puedeAtender && persona.estado === "ACEPTADO" && (
        <button
          type="button"
          className="btn btn-sm btn-outline-danger"
          onClick={estado.restablecer}
        >
          Restablecer
          <span className="visually-hidden"> a {persona.nombre}</span>
        </button>
      )}
    </>
  );
}

function UltimaAceptacion({ ultima }) {
  if (!ultima) return "—";
  return (
    <>
      {fechaHora(ultima.aceptado_en)}
      <div className="mz-small mz-faint">
        Versión {ultima.version}
        {ultima.restablecida_en ? " · restablecida" : ""}
      </div>
    </>
  );
}

function HistorialPersona({ persona, estado }) {
  const { error, historial, cargarHistorial } = estado;
  if (error)
    return <EstadoDeCarga error={error} onReintentar={cargarHistorial} />;
  if (!historial) return <EstadoDeCarga cargando />;
  if (historial.aceptaciones.length === 0)
    return <p className="mb-0">Todavía no ha aceptado ningún aviso.</p>;
  return (
    <ul className="mb-0" aria-label={`Aceptaciones de ${persona.nombre}`}>
      {historial.aceptaciones.map((a) => (
        <li key={a.id}>
          Versión {a.version} ({a.origen_label}) el {fechaHora(a.aceptado_en)}
          {a.ip ? ` desde ${a.ip}` : ""}
          {a.restablecida_en
            ? ` · restablecida el ${fechaHora(a.restablecida_en)}${
                a.restablecida_por ? ` por ${a.restablecida_por}` : ""
              }`
            : ""}
        </li>
      ))}
    </ul>
  );
}

function FilaPersona({ persona, puedeAtender, ...acciones }) {
  const estado = usePersona(persona, acciones);
  const idHistorial = `pv-historial-${persona.id}`;
  return (
    <>
      <tr>
        <td>
          {persona.nombre}
          <div className="mz-small mz-faint">
            {persona.correo || persona.usuario}
          </div>
        </td>
        <td>
          <EstadoPersona estado={persona.estado} />
          {persona.aceptacion_de_nexo && (
            <div className="mz-small mz-faint">Aceptó antes en Nexo</div>
          )}
        </td>
        <td>
          <UltimaAceptacion ultima={persona.ultima_aceptacion} />
        </td>
        <td className="text-end">
          <div className="pv-acciones">
            <AccionesPersona
              persona={persona}
              puedeAtender={puedeAtender}
              estado={estado}
              idHistorial={idHistorial}
            />
          </div>
        </td>
      </tr>
      {estado.abierto && (
        <tr id={idHistorial}>
          <td colSpan={4}>
            <HistorialPersona persona={persona} estado={estado} />
          </td>
        </tr>
      )}
    </>
  );
}

function TarjetaPersona({ persona, puedeAtender, ...acciones }) {
  const estado = usePersona(persona, acciones);
  const idHistorial = `pv-historial-${persona.id}`;
  return (
    <li className="mz-card-row pv-fila-tarjeta">
      <div className="mz-row-between">
        <span className="mz-strong pv-titular">{persona.nombre}</span>
        <EstadoPersona estado={persona.estado} />
      </div>
      <p className="mz-small mz-faint mb-0 pv-titular">
        {persona.correo || persona.usuario}
      </p>
      {persona.aceptacion_de_nexo && (
        <p className="mz-small mz-faint mb-0">Aceptó antes en Nexo</p>
      )}
      <div className="mz-small">
        Última aceptación:{" "}
        <UltimaAceptacion ultima={persona.ultima_aceptacion} />
      </div>
      <div className="mz-card-acciones">
        <AccionesPersona
          persona={persona}
          puedeAtender={puedeAtender}
          estado={estado}
          idHistorial={idHistorial}
        />
      </div>
      {estado.abierto && (
        <div id={idHistorial} className="mz-card-detalle">
          <HistorialPersona persona={persona} estado={estado} />
        </div>
      )}
    </li>
  );
}

function EstadoPersona({ estado }) {
  if (!estado) return <span className="mz-faint">No se exige</span>;
  return estado === "ACEPTADO" ? (
    <span className="mz-pill mz-pill--ok">
      <Icon name="check2-circle" /> Aceptado
    </span>
  ) : (
    <span className="mz-pill mz-pill--warn">
      <Icon name="hourglass-split" /> Pendiente
    </span>
  );
}
