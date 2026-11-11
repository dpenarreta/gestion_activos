/*
 * «Protección de datos» → «Aceptaciones» (`/admin/privacidad/aceptaciones`,
 * US-004, 11/11/2026): el registro común de quién aceptó cada texto de
 * protección de datos, con persona, versión, fecha, IP, origen y si sigue
 * vigente, fue retirada o restablecida. Las filas no se sobrescriben: es un
 * historial. Se filtra por módulo, sección, texto, persona y estado; cada
 * fila abre el texto exacto que se aceptó, y todo se exporta a Excel.
 *
 * Con el aviso de tratamiento de datos elegido, además, la vista «Personas
 * frente al aviso» (la que era `/admin/privacidad/consentimiento`): quién
 * falta por aceptarlo y «Restablecer».
 *
 * Los filtros viven en la URL: los enlaces de «Textos» y de Códigos de
 * conducta llegan con el texto ya elegido, y recargar los conserva.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  errorDePrivacidad,
  privacidadService,
} from "../../api/privacidadService";
import { AnuncioDeResultados } from "../../components/common/AnuncioDeResultados/AnuncioDeResultados";
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
import { Ventana } from "../GestionHumana/Tareas/Ventanas";
import { PersonasDelAviso } from "./PersonasDelAviso";
import { CLAVES_TEXTO } from "./privacidadComunes";
import { TextoDeProteccion } from "./TextoDelAviso";
import "./Privacidad.css";

const VACIOS = { modulo: "", seccion: "", clave: "", persona: "", estado: "" };
const VISTA_PERSONAS = "personas";
function filtrosDeLaUrl(parametros) {
  return Object.fromEntries(
    Object.keys(VACIOS).map((k) => [k, parametros.get(k) ?? ""]),
  );
}

/** Cada estado con su texto e ícono: el color nunca va solo. */
const ESTADOS_ACEPTACION = {
  vigente: { texto: "Vigente", tono: "ok", icono: "check2-circle" },
  retirada: { texto: "Retirada", tono: "bad", icono: "x-circle" },
  restablecida: {
    texto: "Restablecida",
    tono: "warn",
    icono: "arrow-counterclockwise",
  },
};

export function PildoraAceptacion({ aceptacion }) {
  const e = ESTADOS_ACEPTACION[aceptacion.estado] ?? {
    texto: aceptacion.estado || "—",
    tono: "neutral",
    icono: "dot",
  };
  return (
    <span className="pv-estado-aceptacion">
      <span className={`mz-pill mz-pill--${e.tono}`}>
        <Icon name={e.icono} /> {e.texto}
      </span>
      {aceptacion.vigente && aceptacion.de_la_version_exigida === false && (
        <span className="mz-small mz-faint d-block">
          De una versión anterior a la que se exige hoy
        </span>
      )}
    </span>
  );
}

function Origen({ aceptacion }) {
  return (
    <>
      {aceptacion.origen_label || aceptacion.origen || "—"}
      {aceptacion.migrada && (
        <span className="mz-pill mz-pill--neutral ms-1">
          <Icon name="box-arrow-in-down" /> Migrada
        </span>
      )}
    </>
  );
}

const versionDe = (a) => (a.version === null ? "—" : a.version);

export function AceptacionesPrivacidad() {
  const [parametros, setParametros] = useSearchParams();
  const iniciales = useRef(filtrosDeLaUrl(parametros)).current;
  const [vista, setVista] = useState(
    parametros.get("vista") === VISTA_PERSONAS ? VISTA_PERSONAS : "",
  );
  const enTarjetas = useVistaDeTarjetas();
  const [catalogo, setCatalogo] = useState(null);
  const [errorCatalogo, setErrorCatalogo] = useState("");
  const [abierta, setAbierta] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [anuncioExcel, setAnuncioExcel] = useState(null);
  const campoBusqueda = useRef(null);

  const cargarCatalogo = useCallback(() => {
    setErrorCatalogo("");
    privacidadService
      .textos()
      .then((d) => setCatalogo(d.modulos ?? []))
      .catch((err) =>
        setErrorCatalogo(
          errorDePrivacidad(
            err,
            "No se pudo cargar la lista de textos para filtrar.",
          ).mensaje,
        ),
      );
  }, []);
  useEffect(() => {
    cargarCatalogo();
  }, [cargarCatalogo]);

  // El servidor filtra por `estado=vigente|retirada|restablecida` (cada uno
  // devuelve justo las filas con ese estado): total, paginación y Excel
  // salen del servidor.
  const cargar = useCallback(
    (params) => privacidadService.aceptaciones(params),
    [],
  );
  const listado = useListadoPaginado(
    cargar,
    iniciales,
    "No se pudieron cargar las aceptaciones.",
  );
  const busqueda = useBusquedaEnVivo({
    inicial: iniciales.persona,
    alBuscar: (persona) => listado.actualizarFiltros({ persona }),
  });
  const { filtros } = listado;
  const esElAviso = filtros.clave === CLAVES_TEXTO.AVISO;
  const enPersonas = esElAviso && vista === VISTA_PERSONAS;

  // Los filtros (y la vista) a la URL, sin apilar historial.
  useEffect(() => {
    const nuevos = new URLSearchParams();
    Object.entries(filtros).forEach(([k, v]) => {
      if (v) nuevos.set(k, v);
    });
    if (enPersonas) nuevos.set("vista", VISTA_PERSONAS);
    if (nuevos.toString() !== parametros.toString())
      setParametros(nuevos, { replace: true });
    // Solo cuando cambian los filtros o la vista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros, enPersonas]);

  // Las opciones de cada filtro dependen del anterior: las secciones del
  // módulo elegido y los textos de la sección (o del módulo).
  const modulos = useMemo(() => catalogo ?? [], [catalogo]);
  const secciones = useMemo(
    () =>
      filtros.modulo
        ? (modulos.find((m) => m.modulo === filtros.modulo)?.secciones ?? [])
        : [],
    [modulos, filtros.modulo],
  );
  const grupos = useMemo(() => {
    const base = filtros.modulo
      ? secciones.map((s) => ({ ...s, modulo: filtros.modulo }))
      : modulos.flatMap((m) =>
          m.secciones.map((s) => ({ ...s, modulo: m.modulo })),
        );
    return base
      .filter((s) => !filtros.seccion || s.seccion === filtros.seccion)
      .map((s) => ({
        etiqueta: filtros.modulo ? s.seccion : `${s.modulo} › ${s.seccion}`,
        textos: s.textos.filter((t) => t.requiere_aceptacion),
      }))
      .filter((g) => g.textos.length > 0);
  }, [modulos, secciones, filtros.modulo, filtros.seccion]);

  const hayFiltros = Object.values(filtros).some(Boolean);
  function limpiarFiltros() {
    busqueda.fijar("");
    setVista("");
    listado.actualizarFiltros(VACIOS);
  }

  async function exportar() {
    if (exportando) return;
    setExportando(true);
    setAnuncioExcel(null);
    try {
      const nombre = await privacidadService.exportarAceptaciones(filtros);
      setAnuncioExcel({ tipo: "ok", texto: `Se descargó ${nombre}.` });
    } catch (err) {
      const e = errorDePrivacidad(err, "No se pudo exportar a Excel.");
      // 400 `demasiadas_filas`: el mensaje del servidor y, si viene, el tope.
      const tope = err?.response?.data?.error?.details?.tope;
      const conTope =
        e.codigo === "demasiadas_filas" &&
        tope &&
        !e.mensaje.includes(String(tope))
          ? `${e.mensaje} (máximo ${Number(tope).toLocaleString("es-EC")} filas: use más filtros).`
          : e.mensaje;
      setAnuncioExcel({ tipo: "error", texto: conTope });
    } finally {
      setExportando(false);
    }
  }

  const filas = listado.resultados;
  const estado = {
    error: listado.error,
    onReintentar: listado.refresh,
    cargando: listado.isLoading && filas.length === 0,
    vacio: !listado.isLoading && filas.length === 0,
    textoVacio: "Todavía no hay aceptaciones registradas.",
    hayFiltros,
    onLimpiarFiltros: limpiarFiltros,
    termino: filtros.persona,
    campoBusquedaRef: campoBusqueda,
  };

  return (
    <div className="mz-stack pv-aceptaciones">
      <div>
        <h3 className="h5 mb-1">Aceptaciones</h3>
        <p className="mz-desc mb-0">
          Quién aceptó cada texto de protección de datos, con la versión, la
          fecha, la IP y desde dónde. Las aceptaciones no se sobrescriben: una
          autorización retirada conserva su fecha de retiro.
        </p>
      </div>

      <form
        className="mz-filter-bar pv-filtros"
        role="search"
        aria-label="Filtrar aceptaciones"
        onSubmit={(e) => {
          e.preventDefault();
          busqueda.buscarYa();
        }}
      >
        <div className="mz-inline-field">
          <label htmlFor="pv-acep-modulo">Módulo</label>
          <select
            id="pv-acep-modulo"
            className="form-select form-select-sm"
            value={filtros.modulo}
            disabled={!catalogo}
            onChange={(e) =>
              listado.actualizarFiltros({
                modulo: e.target.value,
                seccion: "",
                clave: "",
              })
            }
          >
            <option value="">Todos</option>
            {modulos.map((m) => (
              <option key={m.modulo} value={m.modulo}>
                {m.modulo}
              </option>
            ))}
          </select>
        </div>
        <div className="mz-inline-field">
          <label htmlFor="pv-acep-seccion">Sección</label>
          <select
            id="pv-acep-seccion"
            className="form-select form-select-sm"
            value={filtros.seccion}
            disabled={!filtros.modulo}
            onChange={(e) =>
              listado.actualizarFiltros({ seccion: e.target.value, clave: "" })
            }
          >
            <option value="">Todas</option>
            {secciones.map((s) => (
              <option key={s.seccion} value={s.seccion}>
                {s.seccion}
              </option>
            ))}
          </select>
        </div>
        <div className="mz-inline-field">
          <label htmlFor="pv-acep-texto">Texto</label>
          <select
            id="pv-acep-texto"
            className="form-select form-select-sm"
            value={filtros.clave}
            disabled={!catalogo}
            onChange={(e) =>
              listado.actualizarFiltros({ clave: e.target.value })
            }
          >
            <option value="">Todos</option>
            {grupos.map((g) => (
              <optgroup key={g.etiqueta} label={g.etiqueta}>
                {g.textos.map((t) => (
                  <option key={t.clave} value={t.clave}>
                    {t.nombre}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <label className="mz-fb-search" htmlFor="pv-acep-persona">
          <Icon name="search" />
          <span className="visually-hidden">Buscar persona</span>
          <input
            id="pv-acep-persona"
            ref={campoBusqueda}
            type="search"
            placeholder="Persona: nombre o usuario"
            data-sin-descarte
            {...busqueda.propsCampo}
          />
        </label>
        <div className="mz-inline-field">
          <label htmlFor="pv-acep-estado">Estado</label>
          <select
            id="pv-acep-estado"
            className="form-select form-select-sm"
            value={filtros.estado}
            onChange={(e) =>
              listado.actualizarFiltros({ estado: e.target.value })
            }
          >
            <option value="">Todas</option>
            <option value="vigente">Vigentes</option>
            <option value="retirada">Retiradas</option>
            <option value="restablecida">Restablecidas</option>
          </select>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm ms-auto pv-boton-envio"
          onClick={exportar}
          aria-disabled={exportando}
        >
          <Icon name="file-earmark-excel" />{" "}
          {exportando ? "Exportando…" : "Exportar a Excel"}
        </button>
      </form>
      {errorCatalogo && (
        <EstadoDeCarga error={errorCatalogo} onReintentar={cargarCatalogo} />
      )}
      <div role="status">
        {anuncioExcel?.tipo === "ok" && (
          <div className="mz-alert mz-alert--ok mb-0">
            <Icon name="check2-circle" /> {anuncioExcel.texto}
          </div>
        )}
      </div>
      <div role="alert">
        {anuncioExcel?.tipo === "error" && (
          <div className="mz-alert mz-alert--bad mb-0">
            <Icon name="x-octagon" /> {anuncioExcel.texto}
          </div>
        )}
      </div>

      {esElAviso ? (
        <div
          className="btn-group btn-group-sm pv-vistas"
          role="group"
          aria-label="Qué mostrar del aviso"
        >
          <button
            type="button"
            className={`btn ${enPersonas ? "btn-outline-secondary" : "btn-primary"}`}
            aria-pressed={!enPersonas}
            onClick={() => setVista("")}
          >
            Registro de aceptaciones
          </button>
          <button
            type="button"
            className={`btn ${enPersonas ? "btn-primary" : "btn-outline-secondary"}`}
            aria-pressed={enPersonas}
            onClick={() => setVista(VISTA_PERSONAS)}
          >
            Personas frente al aviso
          </button>
        </div>
      ) : (
        <p className="mz-small mb-0">
          <button
            type="button"
            className="btn btn-link btn-sm p-0 pv-enlace"
            onClick={() => {
              setVista(VISTA_PERSONAS);
              listado.actualizarFiltros({
                modulo: "",
                seccion: "",
                clave: CLAVES_TEXTO.AVISO,
              });
            }}
          >
            Ver quién falta por aceptar el aviso de tratamiento de datos
          </button>
        </p>
      )}

      {enPersonas ? (
        <PersonasDelAviso />
      ) : (
        <>
          <AnuncioDeResultados
            termino={filtros.persona}
            total={listado.total}
            sustantivo={["aceptación", "aceptaciones"]}
            cargando={listado.isLoading}
          />
          {enTarjetas ? (
            <div className="pv-tarjetas" aria-busy={listado.isLoading}>
              <EstadoDeCarga {...estado} />
              {!listado.error && filas.length > 0 && (
                <ul className="mz-cards-lista" aria-label="Aceptaciones">
                  {filas.map((a) => (
                    <TarjetaAceptacion
                      key={a.id}
                      aceptacion={a}
                      alAbrir={setAbierta}
                    />
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="mz-table-wrap" aria-busy={listado.isLoading}>
              <table className="mz-table">
                <caption className="visually-hidden">
                  Aceptaciones de textos de protección de datos
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Persona</th>
                    <th scope="col">Texto</th>
                    <th scope="col">Versión</th>
                    <th scope="col">Aceptada el</th>
                    <th scope="col">IP</th>
                    <th scope="col">Origen</th>
                    <th scope="col">Estado</th>
                    <th scope="col">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <span className="pv-titular">{a.persona?.nombre}</span>
                        <div className="mz-small mz-faint">
                          {a.persona?.usuario}
                        </div>
                      </td>
                      <td>
                        {a.nombre_texto}
                        <div className="mz-small mz-faint">
                          {a.modulo} › {a.seccion}
                        </div>
                      </td>
                      <td>{versionDe(a)}</td>
                      <td>{fechaHora(a.aceptado_en)}</td>
                      <td className="mz-small">{a.ip || "—"}</td>
                      <td className="mz-small">
                        <Origen aceptacion={a} />
                      </td>
                      <td>
                        <PildoraAceptacion aceptacion={a} />
                      </td>
                      <td className="text-end">
                        <BotonVer aceptacion={a} alAbrir={setAbierta} />
                      </td>
                    </tr>
                  ))}
                  <FilaDeEstado columnas={8} {...estado} />
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
            etiqueta={listado.total === 1 ? "aceptación" : "aceptaciones"}
          />
        </>
      )}

      {abierta && (
        <DetalleAceptacion
          aceptacion={abierta}
          onCerrar={() => setAbierta(null)}
        />
      )}
    </div>
  );
}

function BotonVer({ aceptacion, alAbrir }) {
  return (
    <button
      type="button"
      className="btn btn-sm btn-outline-secondary mz-tactil pv-boton-ver"
      onClick={() => alAbrir(aceptacion)}
    >
      Ver texto
      <span className="visually-hidden">
        {" "}
        aceptado por {aceptacion.persona?.nombre}: {aceptacion.nombre_texto}
      </span>
    </button>
  );
}

function TarjetaAceptacion({ aceptacion: a, alAbrir }) {
  return (
    <li className="mz-card-row pv-fila-tarjeta">
      <div className="mz-row-between">
        <span className="mz-strong pv-titular">{a.persona?.nombre}</span>
        <PildoraAceptacion aceptacion={a} />
      </div>
      <p className="mb-0">
        {a.nombre_texto}
        <span className="mz-small mz-faint d-block">
          {a.modulo} › {a.seccion}
        </span>
      </p>
      <div className="mz-card-meta mz-small">
        <span>Versión {versionDe(a)}</span>
        <span>{fechaHora(a.aceptado_en)}</span>
        <span>IP {a.ip || "—"}</span>
        <span>
          <Origen aceptacion={a} />
        </span>
      </div>
      <div className="mz-card-acciones pv-acciones">
        <BotonVer aceptacion={a} alAbrir={alAbrir} />
      </div>
    </li>
  );
}

function DetalleAceptacion({ aceptacion, onCerrar }) {
  const [detalle, setDetalle] = useState(null);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    setError("");
    privacidadService
      .aceptacion(aceptacion.id)
      .then(setDetalle)
      .catch((err) =>
        setError(
          errorDePrivacidad(err, "No se pudo cargar la aceptación.").mensaje,
        ),
      );
  }, [aceptacion.id]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const a = detalle ?? aceptacion;
  return (
    <Ventana
      titulo={`${a.nombre_texto}: ${a.persona?.nombre ?? ""}`}
      subtitulo={`${a.modulo} › ${a.seccion}`}
      onCerrar={onCerrar}
      ancha
    >
      <div className="mz-stack">
        <dl className="pv-datos">
          <div>
            <dt>Persona</dt>
            <dd className="pv-titular">
              {a.persona?.nombre}
              <div className="mz-small mz-faint">{a.persona?.usuario}</div>
            </dd>
          </div>
          <div>
            <dt>Versión</dt>
            <dd>{versionDe(a)}</dd>
          </div>
          <div>
            <dt>Aceptada el</dt>
            <dd>{fechaHora(a.aceptado_en)}</dd>
          </div>
          <div>
            <dt>IP</dt>
            <dd>{a.ip || "—"}</dd>
          </div>
          <div>
            <dt>Origen</dt>
            <dd>
              <Origen aceptacion={a} />
            </dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>
              <PildoraAceptacion aceptacion={a} />
            </dd>
          </div>
          {a.retirada_en && (
            <div>
              <dt>Retirada el</dt>
              <dd>
                {fechaHora(a.retirada_en)}
                {a.retirada_por ? ` por ${a.retirada_por.nombre}` : ""}
              </dd>
            </div>
          )}
          {a.restablecida_en && (
            <div>
              <dt>Restablecida el</dt>
              <dd>
                {fechaHora(a.restablecida_en)}
                {a.restablecida_por ? ` por ${a.restablecida_por.nombre}` : ""}
              </dd>
            </div>
          )}
          {a.navegador && (
            <div className="pv-datos__ancho">
              <dt>Navegador</dt>
              <dd className="mz-small pv-titular">{a.navegador}</dd>
            </div>
          )}
        </dl>

        {error ? (
          <EstadoDeCarga error={error} onReintentar={cargar} />
        ) : !detalle ? (
          <EstadoDeCarga cargando />
        ) : (
          <TextoAceptado detalle={detalle} />
        )}
      </div>
    </Ventana>
  );
}

function TextoAceptado({ detalle }) {
  if (detalle.texto) {
    return (
      <section aria-labelledby="pv-acep-texto-titulo">
        <h4 id="pv-acep-texto-titulo" className="pv-subtitulo">
          Texto exacto que aceptó
        </h4>
        <div className="pv-aviso-previa">
          {detalle.titulo && <p className="pv-etiqueta">{detalle.titulo}</p>}
          <TextoDeProteccion clave={detalle.clave} texto={detalle.texto} />
        </div>
      </section>
    );
  }
  if (detalle.texto_de_la_version) {
    return (
      <section aria-labelledby="pv-acep-texto-titulo">
        <h4 id="pv-acep-texto-titulo" className="pv-subtitulo">
          Texto de la versión {versionDe(detalle)}
        </h4>
        <p className="mz-alert mz-alert--info mb-2">
          <Icon name="info-circle" /> No se guardó el texto exacto de esta
          aceptación: es el de su versión según el historial del texto.
        </p>
        <div className="pv-aviso-previa">
          {detalle.texto_de_la_version.titulo && (
            <p className="pv-etiqueta">{detalle.texto_de_la_version.titulo}</p>
          )}
          <TextoDeProteccion
            clave={detalle.clave}
            texto={detalle.texto_de_la_version.texto}
          />
        </div>
      </section>
    );
  }
  return (
    <p className="mz-alert mz-alert--info mb-0">
      <Icon name="info-circle" /> No se registró el texto que se aceptó
      {detalle.migrada
        ? ": es una aceptación migrada que solo guardaba la fecha."
        : "."}
    </p>
  );
}
