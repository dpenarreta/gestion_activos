/*
 * «Protección de datos» → «Textos» (`/admin/privacidad/textos`, US-004,
 * 11/11/2026): todos los textos sobre datos personales que muestra la
 * intranet, agrupados por módulo y, dentro, por sección. De cada uno, su
 * nombre, dónde se muestra, si pide aceptación, la versión vigente (y la
 * exigida, si no coinciden), quién lo editó y cuándo, y el texto.
 *
 * Con `privacidad.textos` (`puede_editar`) se edita: entre 20 y 6000
 * caracteres, con título solo donde lo lleva, motivo opcional y vista previa.
 * Si el texto cambia, sube la versión. Cada texto tiene su historial de
 * versiones. Sin ese permiso, solo se consulta.
 *
 * Los textos se escriben como texto simple (párrafos y listas con «- »):
 * nada se interpreta como HTML (`TextoDelAviso`).
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  errorDePrivacidad,
  privacidadService,
} from "../../api/privacidadService";
import { Campo, enfocarPrimerError } from "../../components/common/Campo/Campo";
import { coincideBusqueda } from "../../utils/busqueda";
import { confirmar } from "../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useUnsavedChangesOpcional } from "../../context/UnsavedChangesContext";
import { useAuth } from "../../hooks/useAuth";
import { olvidarTextosVigentes } from "../../hooks/useTextoVigente";
import { fechaHora } from "../GestionHumana/comunes";
import { Ventana } from "../GestionHumana/Tareas/Ventanas";
import {
  PERMISOS_PRIVACIDAD,
  PLAZO_POR_DEFECTO,
  enUnaLinea,
  esDeUnaLinea,
  rutaDeAceptaciones,
} from "./privacidadComunes";
import { TextoDeProteccion, TextoDelAviso } from "./TextoDelAviso";
import "./Privacidad.css";

/** Los mismos topes del servidor (`apps/privacidad/textos.py`). */
export const TEXTO_MIN = 20;
export const TEXTO_MAX = 6000;
export const TITULO_MAX = 200;
export const MOTIVO_MAX = 300;

/** Lo que significa cada variable, para quien edita. */
const AYUDA_VARIABLES = {
  plazo: "los días del plazo para responder una solicitud",
};
/** Con qué se ve cada variable en la vista previa (un ejemplo). */
const EJEMPLO_VARIABLES = { plazo: String(PLAZO_POR_DEFECTO) };

const idDeTexto = (clave) => `pv-texto-${clave}`;

function conEjemplos(texto, variables) {
  return variables.reduce(
    (t, v) => t.split(`{${v}}`).join(EJEMPLO_VARIABLES[v] ?? `{${v}}`),
    texto,
  );
}

/**
 * Lo que el servidor rechazaría, dicho antes de enviar y junto a cada campo.
 * El servidor lo vuelve a validar.
 */
export function validarTexto(entrada, valores) {
  const errores = {};
  const texto = valores.texto.trim();
  if (texto.length < TEXTO_MIN) {
    errores.texto = `Escriba el texto completo (al menos ${TEXTO_MIN} caracteres).`;
  } else if (texto.length > TEXTO_MAX) {
    errores.texto = `El texto admite hasta ${TEXTO_MAX} caracteres.`;
  } else {
    const faltan = (entrada.variables ?? []).filter(
      (v) => !texto.includes(`{${v}}`),
    );
    if (faltan.length) {
      errores.texto = `El texto debe conservar ${faltan
        .map((v) => `{${v}}`)
        .join(", ")}: la pantalla lo reemplaza por su valor.`;
    }
  }
  if (entrada.lleva_titulo) {
    const titulo = valores.titulo.trim();
    if (!titulo) errores.titulo = "Escriba el título.";
    else if (titulo.length > TITULO_MAX)
      errores.titulo = `El título admite hasta ${TITULO_MAX} caracteres.`;
  }
  if (valores.motivo.trim().length > MOTIVO_MAX) {
    errores.motivo = `El motivo admite hasta ${MOTIVO_MAX} caracteres.`;
  }
  return errores;
}

/** Si al guardar se ofrece «Pedir aceptarlo de nuevo» (solo el aviso general). */
export function ofrecePedirDeNuevo(entrada) {
  return (
    entrada.requiere_aceptacion &&
    !entrada.pide_aceptar_de_nuevo_al_guardar &&
    entrada.existe
  );
}

export function TextosPrivacidad() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [anuncio, setAnuncio] = useState(null);
  const [editando, setEditando] = useState(null);
  const [historial, setHistorial] = useState(null);
  const [buscar, setBuscar] = useState("");
  const [parametros] = useSearchParams();
  const pedido = useRef(parametros.get("texto"));
  const { user } = useAuth();
  const puedeVerAceptaciones = PERMISOS_PRIVACIDAD.some((p) =>
    user?.permissions?.includes(p),
  );

  const cargar = useCallback(() => {
    setError("");
    return privacidadService
      .textos()
      .then(setDatos)
      .catch((err) =>
        setError(
          errorDePrivacidad(err, "No se pudieron cargar los textos.").mensaje,
        ),
      );
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  // `?texto=<clave>` (los enlaces «Se edita en Protección de datos»): se
  // lleva a ese texto y se le da el foco, una vez.
  useEffect(() => {
    if (!datos || !pedido.current) return;
    const tarjeta = document.getElementById(idDeTexto(pedido.current));
    pedido.current = null;
    if (tarjeta) {
      tarjeta.scrollIntoView({ block: "start" });
      tarjeta.focus();
    }
  }, [datos]);

  function alGuardar(nuevo, mensaje) {
    olvidarTextosVigentes(nuevo.clave);
    setDatos((actual) => ({
      ...actual,
      modulos: actual.modulos.map((m) => ({
        ...m,
        secciones: m.secciones.map((s) => ({
          ...s,
          textos: s.textos.map((t) => (t.clave === nuevo.clave ? nuevo : t)),
        })),
      })),
    }));
    setEditando(null);
    setAnuncio(mensaje);
  }

  if (error) return <EstadoDeCarga error={error} onReintentar={cargar} />;
  if (!datos) return <EstadoDeCarga cargando />;

  const puedeEditar = Boolean(datos.puede_editar);
  // La búsqueda por nombre (sin distinguir tildes ni mayúsculas) deja solo
  // los módulos y secciones con algún texto que coincide.
  const termino = buscar.trim();
  const modulosVisibles = datos.modulos
    .map((m) => ({
      ...m,
      secciones: m.secciones
        .map((s) => ({
          ...s,
          textos: s.textos.filter((t) => coincideBusqueda(termino, t.nombre)),
        }))
        .filter((s) => s.textos.length > 0),
    }))
    .filter((m) => m.secciones.length > 0);
  return (
    <div className="mz-stack pv-textos">
      <div>
        <h3 className="h5 mb-1">Textos de protección de datos</h3>
        <p className="mz-desc mb-0">
          Todo lo que la intranet le muestra a las personas sobre sus datos
          personales, por módulo y sección. Lo que se guarda aquí es lo que cada
          persona ve desde ese momento.
        </p>
      </div>
      {!puedeEditar && (
        <p className="pv-nota mb-0">
          <Icon name="eye" /> Solo puede consultarlos: editarlos requiere el
          permiso «Editar textos de protección de datos».
        </p>
      )}
      <div role="status">
        {anuncio && (
          <div className="mz-alert mz-alert--ok mb-0">
            <Icon name="check2-circle" /> {anuncio}
          </div>
        )}
      </div>

      <IndiceYBuscador
        modulos={datos.modulos}
        buscar={buscar}
        onBuscar={setBuscar}
      />

      {modulosVisibles.length === 0 ? (
        <EstadoDeCarga
          vacio
          textoVacio="No hay textos en el catálogo."
          hayFiltros={Boolean(buscar.trim())}
          termino={buscar}
          onLimpiarFiltros={() => setBuscar("")}
          etiquetaLimpiar="Limpiar la búsqueda"
        />
      ) : (
        modulosVisibles.map((modulo) => (
          <Modulo
            key={modulo.modulo}
            modulo={modulo}
            puedeEditar={puedeEditar}
            puedeVerAceptaciones={puedeVerAceptaciones}
            alEditar={(t) => {
              setAnuncio(null);
              setEditando(t);
            }}
            alVerHistorial={setHistorial}
          />
        ))
      )}

      {editando && (
        <EditorDeTexto
          entrada={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={alGuardar}
        />
      )}
      {historial && (
        <HistorialDeVersiones
          entrada={historial}
          onCerrar={() => setHistorial(null)}
        />
      )}
    </div>
  );
}

/** El id de un módulo, para el índice de arriba. */
const idDeModulo = (modulo) =>
  `pv-modulo-${modulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()}`;

/** El índice de módulos (anclas) y el buscador por nombre. */
function IndiceYBuscador({ modulos, buscar, onBuscar }) {
  return (
    <div className="pv-indice">
      <nav aria-label="Módulos del catálogo">
        <ul className="pv-indice__lista">
          {modulos.map((m) => (
            <li key={m.modulo}>
              <a href={`#${idDeModulo(m.modulo)}`} className="pv-indice__chip">
                {m.modulo}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <label
        className="mz-fb-search pv-indice__buscar"
        htmlFor="pv-textos-buscar"
      >
        <Icon name="search" />
        <span className="visually-hidden">Buscar un texto por su nombre</span>
        <input
          id="pv-textos-buscar"
          type="search"
          placeholder="Buscar un texto por su nombre"
          value={buscar}
          onChange={(e) => onBuscar(e.target.value)}
          data-sin-descarte
        />
      </label>
    </div>
  );
}

function Modulo({ modulo, ...props }) {
  const id = useId();
  return (
    <section
      id={idDeModulo(modulo.modulo)}
      className="pv-modulo"
      aria-labelledby={`${id}-modulo`}
    >
      <h4 id={`${id}-modulo`} className="pv-modulo__titulo h5">
        {modulo.modulo}
      </h4>
      {modulo.secciones.map((seccion, i) => (
        <section
          key={seccion.seccion}
          className="pv-seccion"
          aria-labelledby={`${id}-seccion-${i}`}
        >
          <h5 id={`${id}-seccion-${i}`} className="pv-seccion__titulo">
            {seccion.seccion}
          </h5>
          <ul className="pv-lista-textos" aria-label={seccion.seccion}>
            {seccion.textos.map((t) => (
              <TarjetaTexto key={t.clave} entrada={t} {...props} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

/** Si la versión exigida no es la vigente. */
function exigidaDistinta(entrada) {
  return (
    entrada.existe &&
    entrada.requiere_aceptacion &&
    entrada.version_exigida !== null &&
    entrada.version_exigida !== entrada.version
  );
}

function Versiones({ entrada }) {
  if (!entrada.existe) {
    return (
      <span className="mz-pill mz-pill--warn">
        <Icon name="exclamation-circle" /> Sin crear
      </span>
    );
  }
  return (
    <span className="mz-pill">
      Versión {entrada.version}
      {exigidaDistinta(entrada) && ` · se exige la ${entrada.version_exigida}`}
    </span>
  );
}

function TarjetaTexto({
  entrada,
  puedeEditar,
  puedeVerAceptaciones,
  alEditar,
  alVerHistorial,
}) {
  const id = idDeTexto(entrada.clave);
  return (
    <li id={id} className="mz-card pv-texto-tarjeta" tabIndex={-1}>
      <div className="mz-row-between">
        <h6 id={`${id}-nombre`} className="pv-texto-tarjeta__nombre">
          {entrada.nombre}
        </h6>
        <div className="mz-pill-row mt-0">
          {entrada.requiere_aceptacion ? (
            <span className="mz-pill mz-pill--info">
              <Icon name="check2-square" /> Pide aceptación
            </span>
          ) : (
            <span className="mz-pill mz-pill--neutral">
              <Icon name="info-circle" /> Solo se muestra
            </span>
          )}
          <Versiones entrada={entrada} />
        </div>
      </div>
      {entrada.descripcion && (
        <p className="pv-nota mb-0">{entrada.descripcion}</p>
      )}
      <p className="mz-small mz-faint mb-0">
        {!entrada.existe
          ? "Esta empresa todavía no tiene este texto: no se le pide a nadie. El de abajo es el que se propone."
          : entrada.editado_en
            ? `Editado el ${fechaHora(entrada.editado_en)}${
                entrada.editado_por ? ` por ${entrada.editado_por.nombre}` : ""
              }`
            : "Sin ediciones: es el texto inicial."}
      </p>
      {entrada.variables?.length > 0 && (
        <p className="mz-small mb-0">
          Variables:{" "}
          {entrada.variables.map((v, i) => (
            <span key={v}>
              {i > 0 && ", "}
              <code>{`{${v}}`}</code>
              {AYUDA_VARIABLES[v] ? ` (${AYUDA_VARIABLES[v]})` : ""}
            </span>
          ))}
        </p>
      )}
      {exigidaDistinta(entrada) && (
        <p className="mz-small mb-0">
          Se pide aceptar desde la versión {entrada.version_exigida}: quien
          aceptó la {entrada.version_exigida} o posterior no tiene que volver a
          aceptar.
        </p>
      )}
      <TextoDeLaTarjeta entrada={entrada} />
      <div className="pv-acciones">
        {puedeEditar && (
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={() => alEditar(entrada)}
          >
            <Icon name="pencil" /> {entrada.existe ? "Editar" : "Crear"}
            <span className="visually-hidden"> «{entrada.nombre}»</span>
          </button>
        )}
        {entrada.existe && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => alVerHistorial(entrada)}
          >
            <Icon name="clock-history" /> Versiones
            <span className="visually-hidden"> de «{entrada.nombre}»</span>
          </button>
        )}
        {entrada.requiere_aceptacion && puedeVerAceptaciones && (
          <Link
            to={rutaDeAceptaciones(entrada.clave)}
            className="btn btn-sm btn-outline-secondary"
          >
            <Icon name="people" /> Aceptaciones
            <span className="visually-hidden"> de «{entrada.nombre}»</span>
          </Link>
        )}
      </div>
    </li>
  );
}

/** Hasta este largo el texto se lee entero en la tarjeta. */
const LARGO_CORTO = 220;

/**
 * El texto en la tarjeta: los de una línea y los cortos, enteros; los largos,
 * sus tres primeras líneas y «Ver el texto completo» (QA-UX: la caja con
 * desplazamiento obligaba a desplazar dentro de cada tarjeta).
 */
function TextoDeLaTarjeta({ entrada }) {
  if (esDeUnaLinea(entrada)) {
    return <p className="pv-texto-linea mb-0">{enUnaLinea(entrada.texto)}</p>;
  }
  if (entrada.texto.length <= LARGO_CORTO && !entrada.lleva_titulo) {
    return (
      <TextoDelAviso
        texto={entrada.texto}
        className="pv-texto-tarjeta__texto"
      />
    );
  }
  return (
    <div className="pv-texto-tarjeta__texto">
      {entrada.lleva_titulo && entrada.titulo && (
        <p className="pv-etiqueta">{entrada.titulo}</p>
      )}
      {/* El resumen es para la vista; el lector de pantalla lee el completo
          al desplegarlo. */}
      <p className="pv-texto-resumen mb-1" aria-hidden="true">
        {enUnaLinea(entrada.texto)}
      </p>
      <details className="pv-detalles">
        <summary>
          Ver el texto completo
          <span className="visually-hidden"> de «{entrada.nombre}»</span>
        </summary>
        <div className="pv-aviso-previa">
          <TextoDelAviso texto={entrada.texto} />
        </div>
      </details>
    </div>
  );
}

/** Un contador «N de M caracteres» que no habla en cada tecla. */
function Contador({ id, valor, maximo, minimo }) {
  const largo = valor.trim().length;
  const fuera = largo > maximo || (minimo !== undefined && largo < minimo);
  return (
    <p
      id={id}
      className={`mz-small mb-0 ${fuera ? "pv-totales--mal" : "mz-faint"}`}
    >
      {largo} de {maximo} caracteres
      {minimo !== undefined ? ` (mínimo ${minimo})` : ""}
    </p>
  );
}

export function EditorDeTexto({ entrada, onCerrar, onGuardado }) {
  const idForm = `${useId()}-form`;
  const [valores, setValores] = useState({
    texto: entrada.texto ?? "",
    titulo: entrada.titulo ?? "",
    motivo: "",
  });
  const [pedirDeNuevo, setPedirDeNuevo] = useState(false);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const formulario = useRef(null);
  const sinGuardar = useUnsavedChangesOpcional();
  const setIsDirty = sinGuardar?.setIsDirty;

  const cambiado =
    valores.texto !== (entrada.texto ?? "") ||
    (entrada.lleva_titulo && valores.titulo !== (entrada.titulo ?? "")) ||
    valores.motivo !== "" ||
    pedirDeNuevo;
  // Con cambios, salir por el menú o por otra pestaña pregunta antes (la
  // ventana ya pregunta al cerrarla con lo escrito).
  useEffect(() => {
    if (!setIsDirty) return undefined;
    setIsDirty(cambiado);
    return () => setIsDirty(false);
  }, [cambiado, setIsDirty]);

  const fijar = (campo) => (e) => {
    const valor = e.target.value;
    setValores((v) => ({ ...v, [campo]: valor }));
    setErrores((actuales) => ({ ...actuales, [campo]: undefined }));
  };

  const pedir = ofrecePedirDeNuevo(entrada);
  const unaLinea = esDeUnaLinea(entrada);
  const siguiente = (entrada.version ?? 0) + 1;
  // Pedir aceptarlo de nuevo siempre abre una versión nueva en el servidor
  // (aunque el texto no cambie): esa es la que queda exigida (QA-FUNC O-5).
  const versionPedida = siguiente;

  async function guardar(evento) {
    evento.preventDefault();
    if (guardando) return;
    setError("");
    const encontrados = validarTexto(entrada, valores);
    if (Object.keys(encontrados).length) {
      setErrores(encontrados);
      // Tras pintar los errores: el foco va al primer campo con error.
      setTimeout(() => enfocarPrimerError(formulario.current), 0);
      return;
    }
    if (pedir && pedirDeNuevo) {
      const si = await confirmar({
        titulo: "¿Pedir que todas las personas lo acepten de nuevo?",
        mensaje:
          "Sube la versión exigida: nadie lo tendrá aceptado y cada persona lo aceptará la próxima vez que entre.",
        accion: "Guardar y pedir aceptación",
      });
      if (!si) return;
    }
    setGuardando(true);
    setErrores({});
    try {
      const nuevo = await privacidadService.guardarTexto(entrada.clave, {
        texto: valores.texto,
        titulo: entrada.lleva_titulo ? valores.titulo : undefined,
        motivo: valores.motivo,
        pedirDeNuevo: pedir && pedirDeNuevo,
      });
      setIsDirty?.(false);
      onGuardado(nuevo, mensajeDeGuardado(entrada, nuevo, pedirDeNuevo));
    } catch (err) {
      const e = errorDePrivacidad(err, "No se pudo guardar el texto.");
      const campos = {};
      ["texto", "titulo", "motivo"].forEach((c) => {
        if (e.campos[c]) campos[c] = e.campos[c];
      });
      setErrores(campos);
      // Lo que no es de un campo, arriba en la ventana.
      setError(Object.keys(campos).length ? "" : e.mensaje);
      setGuardando(false);
      setTimeout(() => enfocarPrimerError(formulario.current), 0);
    }
  }

  const pie = (
    <>
      <button
        type="button"
        className="btn btn-outline-secondary"
        onClick={onCerrar}
        disabled={guardando}
      >
        Cancelar
      </button>
      {/* Sin `disabled` mientras guarda: el foco no cae en <body>. */}
      <button
        type="submit"
        form={idForm}
        className="btn btn-primary pv-boton-envio"
        aria-disabled={guardando}
      >
        {guardando ? "Guardando…" : entrada.existe ? "Guardar" : "Crear"}
      </button>
    </>
  );

  return (
    <Ventana
      titulo={`${entrada.existe ? "Editar" : "Crear"}: ${entrada.nombre}`}
      subtitulo={`${entrada.modulo} › ${entrada.seccion}${
        entrada.existe ? ` · versión ${entrada.version}` : ""
      }`}
      onCerrar={onCerrar}
      pie={pie}
      ancha
      // Mientras guarda, nada la cierra ni se edita (QA-UX).
      bloqueada={guardando}
    >
      <form
        id={idForm}
        ref={formulario}
        className="mz-stack pv-formulario"
        onSubmit={guardar}
        noValidate
        aria-busy={guardando}
      >
        {error && (
          <div className="mz-alert mz-alert--bad mb-0" role="alert">
            <Icon name="x-octagon" /> {error}
          </div>
        )}
        {entrada.descripcion && (
          <p className="pv-nota mb-0">{entrada.descripcion}</p>
        )}
        {entrada.lleva_titulo && (
          <Campo
            id={`${idForm}-titulo`}
            etiqueta="Título"
            obligatorio
            ayuda={`${valores.titulo.trim().length} de ${TITULO_MAX} caracteres`}
            error={errores.titulo}
          >
            <input
              className="form-control"
              maxLength={TITULO_MAX}
              value={valores.titulo}
              onChange={fijar("titulo")}
              readOnly={guardando}
            />
          </Campo>
        )}
        <Campo
          id={`${idForm}-texto`}
          etiqueta="Texto"
          obligatorio
          ayuda={
            <>
              {unaLinea
                ? "Se muestra en una sola línea: escriba una frase, sin párrafos ni listas."
                : "Una línea en blanco separa párrafos; las líneas que empiezan con «- » forman una lista."}
              {entrada.existe &&
                ` Si cambia el texto, se guardará como versión ${siguiente}.`}
              {entrada.variables?.length > 0 && (
                <>
                  {" "}
                  Conserve{" "}
                  {entrada.variables.map((v, i) => (
                    <span key={v}>
                      {i > 0 && ", "}
                      <code>{`{${v}}`}</code>
                      {AYUDA_VARIABLES[v]
                        ? `: se reemplaza por ${AYUDA_VARIABLES[v]}`
                        : ""}
                    </span>
                  ))}
                  .
                </>
              )}
            </>
          }
          error={errores.texto}
        >
          <textarea
            className="form-control"
            rows={unaLinea ? 3 : 12}
            value={valores.texto}
            onChange={fijar("texto")}
            readOnly={guardando}
            aria-describedby={`${idForm}-contador`}
            data-autofocus
          />
        </Campo>
        <Contador
          id={`${idForm}-contador`}
          valor={valores.texto}
          maximo={TEXTO_MAX}
          minimo={TEXTO_MIN}
        />
        {/* Cómo lo verá cada persona, con párrafos y listas. */}
        <details className="pv-detalles">
          <summary>Vista previa</summary>
          <div className="pv-aviso-previa">
            {entrada.variables?.length > 0 && (
              <p className="mz-small mz-faint">
                Con un valor de ejemplo en{" "}
                {entrada.variables.map((v) => `{${v}}`).join(", ")}.
              </p>
            )}
            {entrada.lleva_titulo && valores.titulo.trim() && (
              <p className="pv-etiqueta">{valores.titulo}</p>
            )}
            {unaLinea ? (
              <p className="pv-texto-linea mb-0">
                {enUnaLinea(
                  conEjemplos(valores.texto, entrada.variables ?? []),
                )}
              </p>
            ) : (
              <TextoDelAviso
                texto={conEjemplos(valores.texto, entrada.variables ?? [])}
              />
            )}
          </div>
        </details>
        <Campo
          id={`${idForm}-motivo`}
          etiqueta="Motivo del cambio (opcional)"
          ayuda={`Queda en el historial de versiones y en la auditoría. ${
            valores.motivo.trim().length
          } de ${MOTIVO_MAX} caracteres.`}
          error={errores.motivo}
        >
          <input
            className="form-control"
            maxLength={MOTIVO_MAX}
            value={valores.motivo}
            onChange={fijar("motivo")}
            readOnly={guardando}
          />
        </Campo>
        {pedir && (
          <label className="pv-casilla">
            <input
              type="checkbox"
              className="form-check-input"
              checked={pedirDeNuevo}
              disabled={guardando}
              onChange={(e) => setPedirDeNuevo(e.target.checked)}
            />
            Pedir aceptarlo de nuevo: quedará exigida la versión {versionPedida}{" "}
            y todas las personas deberán aceptarla otra vez
          </label>
        )}
        {entrada.requiere_aceptacion &&
          entrada.pide_aceptar_de_nuevo_al_guardar && (
            <p className="pv-nota mb-0">
              <Icon name="info-circle" /> Si cambia el texto, la versión{" "}
              {siguiente} es la que se pide aceptar, cuando lo pida su pantalla
              (vea la descripción).
            </p>
          )}
      </form>
    </Ventana>
  );
}

function mensajeDeGuardado(entrada, nuevo, pedirDeNuevo) {
  if (!entrada.existe) {
    return `«${nuevo.nombre}» creado (versión ${nuevo.version}).`;
  }
  const subio = nuevo.version !== entrada.version;
  if (pedirDeNuevo && ofrecePedirDeNuevo(entrada)) {
    return `«${nuevo.nombre}» guardado como versión ${nuevo.version}: todas las personas lo aceptarán de nuevo.`;
  }
  return subio
    ? `«${nuevo.nombre}» guardado como versión ${nuevo.version}.`
    : `«${nuevo.nombre}» sin cambios en el texto: sigue en la versión ${nuevo.version}.`;
}

export function HistorialDeVersiones({ entrada, onCerrar }) {
  const [versiones, setVersiones] = useState(null);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    setError("");
    privacidadService
      .versionesTexto(entrada.clave)
      .then(setVersiones)
      .catch((err) =>
        setError(
          errorDePrivacidad(err, "No se pudieron cargar las versiones.")
            .mensaje,
        ),
      );
  }, [entrada.clave]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <Ventana
      titulo={`Versiones: ${entrada.nombre}`}
      subtitulo={`${entrada.modulo} › ${entrada.seccion}`}
      onCerrar={onCerrar}
      ancha
    >
      {error ? (
        <EstadoDeCarga error={error} onReintentar={cargar} />
      ) : !versiones ? (
        <EstadoDeCarga cargando />
      ) : versiones.length === 0 ? (
        <EstadoDeCarga vacio textoVacio="Todavía no tiene versiones." />
      ) : (
        <ol className="pv-historial" aria-label="Versiones, de la más nueva">
          {versiones.map((v) => (
            <li key={v.version}>
              <p className="pv-subtitulo">
                Versión {v.version}
                {v.vigente && (
                  <span className="mz-pill mz-pill--ok ms-2">
                    <Icon name="check2-circle" /> Vigente
                  </span>
                )}
              </p>
              <p className="mz-small mz-faint mb-1">
                {fechaHora(v.editado_en)}
                {v.editado_por ? ` · ${v.editado_por.nombre}` : ""}
                {v.motivo ? ` · Motivo: ${v.motivo}` : ""}
              </p>
              <details className="pv-detalles">
                <summary>
                  Ver el texto
                  <span className="visually-hidden">
                    {" "}
                    de la versión {v.version}
                  </span>
                </summary>
                <div className="pv-aviso-previa">
                  {v.titulo && <p className="pv-etiqueta">{v.titulo}</p>}
                  <TextoDeProteccion
                    clave={entrada.clave}
                    formato={entrada.formato}
                    texto={v.texto}
                  />
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </Ventana>
  );
}
