/*
 * Las personas frente al aviso de tratamiento de datos (09/11/2026), dentro de
 * «Protección de datos» → «Aceptaciones» con el aviso elegido (US-004,
 * 11/11/2026; antes `/admin/privacidad/consentimiento`, que hoy redirige
 * aquí). Quién lo aceptó y a quién le falta, su historial y, con
 * `privacidad.atender`, restablecer el consentimiento de una persona o de
 * todas. El texto del aviso se edita en «Textos». El servidor vuelve a exigir
 * cada permiso.
 */
import { useCallback, useEffect, useState } from "react";
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
import { CLAVES_TEXTO, rutaDeTexto } from "./privacidadComunes";
import "./Privacidad.css";

export function PersonasDelAviso() {
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

  // Mientras restablece a todas: el botón dice «Restableciendo…» y no repite
  // el pedido (sin `disabled`: el foco no cae en <body>).
  const [restableciendoTodas, setRestableciendoTodas] = useState(false);

  async function restablecerTodos() {
    if (restableciendoTodas) return;
    limpiarAnuncio();
    const si = await confirmar({
      titulo: "¿Restablecer el consentimiento de todas las personas?",
      mensaje:
        "Todas tendrán que aceptar el aviso otra vez la próxima vez que entren. Las aceptaciones anteriores se conservan como constancia.",
      accion: "Restablecer a todas",
    });
    if (!si) return;
    setRestableciendoTodas(true);
    try {
      const r = await privacidadService.restablecerTodos();
      refrescar(
        `Consentimiento restablecido: ${r.restablecidas} ${
          r.restablecidas === 1 ? "aceptación" : "aceptaciones"
        } sin efecto.`,
      );
    } catch (err) {
      anunciarError(errorDePrivacidad(err).mensaje);
    } finally {
      setRestableciendoTodas(false);
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
        <ResumenDelAviso
          resumen={resumen}
          puedeAtender={puedeAtender}
          alRestablecerTodos={restablecerTodos}
          restableciendo={restableciendoTodas}
        />
      )}

      <h4 className="h6 mb-0">Personas de la empresa</h4>
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
            <caption className="visually-hidden">
              Personas de la empresa frente al aviso de tratamiento de datos
            </caption>
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

/** La versión vigente, cuántos lo aceptaron y «Restablecer a todas». */
function ResumenDelAviso({
  resumen,
  puedeAtender,
  alRestablecerTodos,
  restableciendo,
}) {
  const { totales } = resumen;
  return (
    <section className="mz-card pv-aviso" aria-labelledby="pv-aviso-titulo">
      <div className="mz-row-between">
        <h4 id="pv-aviso-titulo" className="h6 mb-0">
          {resumen.existe
            ? `Aviso vigente (versión ${resumen.version})`
            : "Sin aviso"}
        </h4>
        {puedeAtender && resumen.existe && (
          <div className="pv-acciones">
            <button
              type="button"
              className="btn btn-sm btn-outline-danger pv-boton-envio"
              onClick={alRestablecerTodos}
              aria-disabled={restableciendo}
            >
              <Icon name="arrow-counterclockwise" />{" "}
              {restableciendo ? "Restableciendo…" : "Restablecer a todas"}
            </button>
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
      <p className="mz-small mb-0">
        <Icon name="pencil-square" /> El texto del aviso está en{" "}
        <Link to={rutaDeTexto(CLAVES_TEXTO.AVISO)}>
          Protección de datos → Textos
        </Link>
        .
      </p>
    </section>
  );
}

/** Lo que comparten la fila (escritorio) y la tarjeta (teléfono). */
function usePersona(persona, { alEmpezar, alRestablecer, alFallar }) {
  const [historial, setHistorial] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");
  const [restableciendo, setRestableciendo] = useState(false);

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
    if (restableciendo) return;
    alEmpezar();
    const si = await confirmar({
      titulo: `¿Restablecer el consentimiento de ${persona.nombre}?`,
      mensaje:
        "Tendrá que aceptar el aviso otra vez la próxima vez que entre. Su aceptación anterior se conserva como constancia.",
      accion: "Restablecer",
    });
    if (!si) return;
    setRestableciendo(true);
    try {
      const r = await privacidadService.restablecerConsentimiento(persona.id);
      setHistorial(r);
      alRestablecer(`Consentimiento de ${persona.nombre} restablecido.`);
    } catch (err) {
      alFallar(errorDePrivacidad(err).mensaje);
    } finally {
      setRestableciendo(false);
    }
  }

  return {
    historial,
    abierto,
    error,
    alternar,
    restablecer,
    restableciendo,
    cargarHistorial,
  };
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
          className="btn btn-sm btn-outline-danger pv-boton-envio"
          onClick={estado.restablecer}
          aria-disabled={estado.restableciendo}
        >
          {estado.restableciendo ? "Restableciendo…" : "Restablecer"}
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
