import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { guardarArchivo, proyectosService } from "../../api/proyectosService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import {
  CAMPO_DE,
  ListaDeDestinos,
  describir,
  nuevaClave,
} from "./FlujosPermisoPage";
import { DESTINOS, DESTINOS_APROBADOR } from "./licenciasComunes";
import "./Institucional.css";
import { confirmar } from "../../components/common/Confirmar/confirmar";

export const TIPOS_DE_CAMPO = [
  ["texto", "Texto corto"],
  ["parrafo", "Párrafo"],
  ["numero", "Número"],
  ["fecha", "Fecha"],
  ["lista", "Lista de opciones"],
  ["casilla", "Casilla (sí / no)"],
  ["correo", "Correo"],
  ["telefono", "Teléfono"],
];

const NUEVO = {
  nombre: "",
  descripcion: "",
  activo: false,
  tiene_plantilla: false,
  campos: [
    { etiqueta: "Objetivo del proyecto", tipo: "parrafo", obligatorio: true },
  ],
  pasos: [
    { nombre: "Aprobación", aprobadores: [{ tipo: "jefe_inmediato" }] },
    { nombre: "Autorización", aprobadores: [{ tipo: "persona" }] },
    { nombre: "Revisión", aprobadores: [{ tipo: "persona" }] },
  ],
};

const ACEPTA = ".docx,.xlsx,.pdf";
const EXTENSIONES = ["docx", "xlsx", "pdf"];
const MAXIMO_PLANTILLA = 10 * 1024 * 1024;

/** Claves estables para campos, pasos y destinos (con la posición como
 * clave, el foco quedaba en la fila que ocupaba el lugar de la movida). */
function conClaves(tipo) {
  return {
    ...tipo,
    campos: (tipo.campos ?? []).map((c) => ({ ...c, _k: nuevaClave() })),
    pasos: (tipo.pasos ?? []).map((p) => ({
      ...p,
      _k: nuevaClave(),
      aprobadores: (p.aprobadores ?? []).map((d) => ({
        ...d,
        _k: nuevaClave(),
      })),
    })),
  };
}

const limpiarDestinos = (lista) =>
  lista.map(({ tipo, usuario, rol, cargo }) => ({
    tipo,
    usuario: usuario ?? null,
    rol: rol ?? null,
    cargo: cargo ?? null,
  }));

/** Lo que se envía (y con lo que se compara si hubo cambios). */
function paraEnviar(tipo) {
  return {
    nombre: tipo.nombre,
    descripcion: tipo.descripcion ?? "",
    // Sin plantilla todavía no se activa: se activa al cargarla.
    activo: tipo.tiene_plantilla ? Boolean(tipo.activo) : false,
    campos: tipo.campos.map((c) => ({
      id: c.id ?? null,
      etiqueta: c.etiqueta,
      tipo: c.tipo,
      opciones:
        c.tipo === "lista"
          ? (c.opciones ?? []).map((o) => o.trim()).filter(Boolean)
          : [],
      obligatorio: Boolean(c.obligatorio),
      ayuda: c.ayuda ?? "",
    })),
    pasos: tipo.pasos.map((p) => ({
      id: p.id ?? null,
      nombre: p.nombre,
      aprobadores: limpiarDestinos(p.aprobadores),
    })),
  };
}

const VACIO = { campos: {}, filas: {}, pasos: {}, mensajes: [] };

/** Lo que falta antes de enviar, con la forma de los errores del servidor
 * (auditoría UX/UI, 30/10/2026: antes nada se revisaba y el error llegaba
 * como «pasos 2 › aprobadores 1 › usuario: …»). */
function validar(tipo, plantilla) {
  const e = { campos: {}, filas: {}, pasos: {}, mensajes: [] };
  if (!tipo.nombre.trim()) {
    e.campos.nombre = "Escriba el nombre del tipo de proyecto.";
    e.mensajes.push("Nombre del tipo de proyecto: escríbalo.");
  }
  if (plantilla) {
    const extension = plantilla.name.split(".").pop().toLowerCase();
    if (!EXTENSIONES.includes(extension)) {
      e.campos.plantilla = "Use un archivo Word (.docx), Excel (.xlsx) o PDF.";
      e.mensajes.push(`Plantilla: ${e.campos.plantilla}`);
    } else if (plantilla.size > MAXIMO_PLANTILLA) {
      e.campos.plantilla = "El archivo pasa de 10 MB.";
      e.mensajes.push(`Plantilla: ${e.campos.plantilla}`);
    }
  }
  const vistas = new Map();
  tipo.campos.forEach((c, i) => {
    const propio = {};
    const etiqueta = c.etiqueta.trim().toLowerCase();
    if (!etiqueta) propio.etiqueta = "Escriba el nombre del campo.";
    else if (vistas.has(etiqueta))
      propio.etiqueta = `Se llama igual que el campo ${vistas.get(etiqueta) + 1}.`;
    else vistas.set(etiqueta, i);
    if (c.tipo === "lista" && !(c.opciones ?? []).some((o) => o.trim()))
      propio.opciones = "Escriba al menos una opción.";
    if (propio.etiqueta) e.mensajes.push(`Campo ${i + 1}: ${propio.etiqueta}`);
    if (propio.opciones) e.mensajes.push(`Campo ${i + 1}: ${propio.opciones}`);
    if (propio.etiqueta || propio.opciones) e.filas[i] = propio;
  });
  tipo.pasos.forEach((paso, i) => {
    const propio = { destinos: {} };
    if (!paso.nombre.trim()) {
      propio.nombre = "Escriba el nombre del paso.";
      e.mensajes.push(`Paso ${i + 1}: escriba su nombre.`);
    }
    if (paso.aprobadores.length === 0) {
      propio.lista = "Agregue al menos a alguien que decida.";
      e.mensajes.push(`Paso ${i + 1}: agregue a quien lo decide.`);
    }
    paso.aprobadores.forEach((d, j) => {
      if (CAMPO_DE[d.tipo] && !d[CAMPO_DE[d.tipo]]) {
        propio.destinos[j] = "Elija a quién.";
        e.mensajes.push(
          `Paso ${i + 1}, quien decide ${j + 1}: elija ${DESTINOS[d.tipo].toLowerCase()}.`,
        );
      }
    });
    if (propio.nombre || propio.lista || Object.keys(propio.destinos).length)
      e.pasos[i] = propio;
  });
  return e;
}

const NOMBRE_CAMPO = {
  nombre: "Nombre del tipo de proyecto",
  descripcion: "Indicaciones",
  activo: "Activo",
  plantilla: "Plantilla",
  archivo: "Plantilla",
};

const texto = (v) =>
  Array.isArray(v)
    ? v.filter((x) => typeof x === "string").join(" ")
    : typeof v === "string"
      ? v
      : "";

/** Los errores del servidor con la forma de `validar`. */
function erroresDelServidor(err, porDefecto) {
  const datos = err?.response?.data;
  const fuente = datos?.error?.details ?? (datos?.error ? {} : datos) ?? {};
  const e = {
    campos: erroresPorCampo(err),
    filas: {},
    pasos: {},
    mensajes: [],
  };
  for (const [campo, valor] of Object.entries(e.campos)) {
    // «pasos» y «campos» van abajo, con su nombre legible.
    if (campo === "pasos" || campo === "campos") continue;
    e.mensajes.push(`${NOMBRE_CAMPO[campo] ?? campo}: ${valor}`);
  }
  if (Array.isArray(fuente.campos) && !e.campos.campos) {
    fuente.campos.forEach((c, i) => {
      if (!c || typeof c !== "object" || !Object.keys(c).length) return;
      const propio = {};
      if (c.etiqueta) propio.etiqueta = texto(c.etiqueta);
      if (c.opciones) propio.opciones = texto(c.opciones);
      const resto = Object.entries(c)
        .filter(([k]) => k !== "etiqueta" && k !== "opciones")
        .map(([, v]) => texto(v))
        .filter(Boolean);
      if (resto.length)
        propio.etiqueta = [propio.etiqueta, ...resto].filter(Boolean).join(" ");
      e.filas[i] = propio;
      Object.values(propio).forEach((m) =>
        e.mensajes.push(`Campo ${i + 1}: ${m}`),
      );
    });
  }
  if (Array.isArray(fuente.pasos) && !e.campos.pasos) {
    fuente.pasos.forEach((paso, i) => {
      if (!paso || typeof paso !== "object") return;
      const propio = { destinos: {} };
      if (paso.nombre) propio.nombre = texto(paso.nombre);
      const aprob = paso.aprobadores;
      if (Array.isArray(aprob) && aprob.every((v) => typeof v === "string"))
        propio.lista = aprob.join(" ");
      else if (Array.isArray(aprob))
        aprob.forEach((d, j) => {
          if (d && typeof d === "object" && Object.keys(d).length)
            propio.destinos[j] = Object.values(d).map(texto).join(" ");
        });
      if (propio.nombre) e.mensajes.push(`Paso ${i + 1}: ${propio.nombre}`);
      if (propio.lista) e.mensajes.push(`Paso ${i + 1}: ${propio.lista}`);
      Object.entries(propio.destinos).forEach(([j, m]) =>
        e.mensajes.push(`Paso ${i + 1}, quien decide ${Number(j) + 1}: ${m}`),
      );
      e.pasos[i] = propio;
    });
  }
  if (e.campos.pasos) e.mensajes.push(`Pasos: ${e.campos.pasos}`);
  if (e.campos.campos) e.mensajes.push(`Formulario: ${e.campos.campos}`);
  e.mensajes.push(
    ...[fuente.non_field_errors, fuente.detail].map(texto).filter(Boolean),
  );
  // Quitar duplicados (pasos/campos ya listados arriba).
  e.mensajes = [...new Set(e.mensajes)].filter(
    (m) => !/^(Pasos|Formulario): $/.test(m),
  );
  if (!e.mensajes.length) e.mensajes.push(mensajeDeError(err, porDefecto));
  return e;
}

/** Los pasos que no van a encontrar a nadie: nadie decide dos pasos de la
 * misma solicitud, así que un paso cuyos únicos aprobadores (el jefe
 * inmediato o una persona) ya decidieron uno anterior pasa a quien administra
 * (auditoría UX/UI, 30/10/2026: en producción, los tres pasos eran del jefe
 * inmediato y el 2 y el 3 caían siempre en los administradores). */
function pasosSinQuienDecida(pasos) {
  const usados = new Set();
  const problemas = [];
  pasos.forEach((paso, i) => {
    const claves = paso.aprobadores
      .filter((d) => d.tipo === "jefe_inmediato" || d.tipo === "persona")
      .map((d) => `${d.tipo}:${d.usuario ?? ""}`);
    const soloUnicos =
      paso.aprobadores.length > 0 &&
      claves.length === paso.aprobadores.length &&
      claves.every((c) => !c.endsWith(":") || c.startsWith("jefe"));
    if (i > 0 && soloUnicos && claves.every((c) => usados.has(c)))
      problemas.push(i);
    claves.forEach((c) => usados.add(c));
  });
  return problemas;
}

/** El recorrido que queda configurado. */
function RutaDeAprobacion({ pasos, opciones }) {
  const sinNadie = pasosSinQuienDecida(pasos);
  return (
    <section className="flujo-ruta" aria-labelledby="tp-ruta">
      <h4 id="tp-ruta" className="flujo-seccion">
        Así queda la ruta
      </h4>
      <ol className="flujo-ruta__pasos">
        <li>
          <strong>Solicita</strong> quien pide el proyecto, con la plantilla
          llena
        </li>
        {pasos.map((p, i) => (
          <li key={p._k}>
            <strong>
              {i + 1}. {p.nombre || "(sin nombre)"}
            </strong>{" "}
            — lo decide{" "}
            {p.aprobadores.map((d) => describir(d, opciones)).join(" o ") ||
              "nadie todavía"}
          </li>
        ))}
        <li>
          <strong>Aprobado el último paso</strong>, el proyecto se puede iniciar
        </li>
      </ol>
      {sinNadie.length > 0 && (
        <div className="mz-alert mz-alert--warn" role="note">
          <Icon name="exclamation-triangle" />
          <span>
            {sinNadie.length === 1 ? "El paso" : "Los pasos"}{" "}
            <strong>{sinNadie.map((i) => i + 1).join(", ")}</strong>{" "}
            {sinNadie.length === 1 ? "lo decide" : "los decide"} quien ya
            decidió uno anterior. Como nadie decide dos pasos de la misma
            solicitud, {sinNadie.length === 1 ? "pasará" : "pasarán"} a quien
            administra los tipos de proyecto. Elija a otra persona, un rol o un
            cargo.
          </span>
        </div>
      )}
      <p className="mz-faint mz-small mb-0">
        Nadie decide dos pasos de la misma solicitud. Si un paso no encuentra a
        nadie (por ejemplo, quien solicita no tiene jefe en el organigrama), la
        solicitud pasa a quien administra los tipos de proyecto.
      </p>
    </section>
  );
}

/** Subir, bajar y quitar una fila; los de los extremos se ocultan. */
function Orden({
  idBase,
  nombre,
  i,
  total,
  onMover,
  onQuitar,
  minimo = 0,
  motivoQuitar,
  motivoMover,
}) {
  const bloqueado = total <= minimo || Boolean(motivoQuitar);
  // Con solicitudes en curso, un paso que ya existía no se mueve.
  const fijo = Boolean(motivoMover);
  return (
    <>
      <button
        type="button"
        id={`${idBase}-subir`}
        className={`btn btn-outline-secondary btn-sm${i === 0 ? " invisible" : ""}`}
        disabled={fijo}
        title={motivoMover}
        aria-label={`Subir ${nombre}`}
        aria-hidden={i === 0 ? true : undefined}
        tabIndex={i === 0 ? -1 : undefined}
        onClick={() => onMover(-1)}
      >
        <Icon name="arrow-up" />
      </button>
      <button
        type="button"
        id={`${idBase}-bajar`}
        className={`btn btn-outline-secondary btn-sm${i === total - 1 ? " invisible" : ""}`}
        disabled={fijo}
        title={motivoMover}
        aria-label={`Bajar ${nombre}`}
        aria-hidden={i === total - 1 ? true : undefined}
        tabIndex={i === total - 1 ? -1 : undefined}
        onClick={() => onMover(1)}
      >
        <Icon name="arrow-down" />
      </button>
      <button
        type="button"
        className="btn btn-outline-danger btn-sm"
        aria-label={`Quitar ${nombre}`}
        disabled={bloqueado}
        title={
          motivoQuitar ||
          (total <= minimo ? "Hace falta al menos uno." : undefined)
        }
        onClick={onQuitar}
      >
        <Icon name="trash" />
      </button>
    </>
  );
}

/** Una lista ordenable (campos o pasos): mover y quitar con el foco que
 * sigue a la fila, y un anuncio para el lector de pantalla. */
function useListaOrdenada(lista, onCambio, { prefijo, anunciar, nombreDe }) {
  const enfocar = (id) =>
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  return {
    mover(i, delta, boton) {
      const j = i + delta;
      if (j < 0 || j >= lista.length) return;
      const nueva = [...lista];
      [nueva[i], nueva[j]] = [nueva[j], nueva[i]];
      onCambio(nueva);
      anunciar(
        `«${nombreDe(lista[i]) || prefijo}» ahora es el ${prefijo} ${j + 1}.`,
      );
      const extremo = j === 0 || j === lista.length - 1;
      const otro = boton === "subir" ? "bajar" : "subir";
      enfocar(`${prefijo}-${lista[i]._k}-${extremo ? otro : boton}`);
    },
    quitar(i) {
      const vecino = lista[i + 1] ?? lista[i - 1];
      onCambio(lista.filter((_, j) => j !== i));
      anunciar(`Se quitó el ${prefijo} ${i + 1}.`);
      // Sin vecina (se quitó la última), al botón de agregar.
      enfocar(vecino ? `${prefijo}-${vecino._k}-nombre` : `${prefijo}-agregar`);
    },
    agregar(nuevo) {
      onCambio([...lista, nuevo]);
      anunciar(`Se agregó el ${prefijo} ${lista.length + 1}.`);
      enfocar(`${prefijo}-${nuevo._k}-nombre`);
    },
  };
}

/** Los campos del formulario: agregar, quitar, ordenar y decir si son
 * obligatorios. */
function EditorDeCampos({
  campos,
  onCambio,
  errores,
  anunciar,
  alCambiarOrden,
}) {
  const cambiar = (i, cambios) =>
    onCambio(campos.map((c, j) => (j === i ? { ...c, ...cambios } : c)));
  const orden = useListaOrdenada(
    campos,
    (nuevos) => {
      onCambio(nuevos);
      alCambiarOrden();
    },
    { prefijo: "campo", anunciar, nombreDe: (c) => c.etiqueta },
  );
  return (
    <div className="mz-stack">
      {campos.length === 0 && (
        <p className="mz-faint mz-small mb-0">
          Sin campos propios: solo se pide el nombre del proyecto y la plantilla
          llena.
        </p>
      )}
      <ol className="flujo-pasos">
        {campos.map((campo, i) => {
          const error = errores[i] ?? {};
          const base = `campo-${campo._k}`;
          return (
            <li key={campo._k} className="flujo-paso">
              <div className="flujo-paso__cabecera campo-proyecto__cabecera">
                <span className="flujo-paso__numero" aria-hidden="true">
                  {i + 1}
                </span>
                <input
                  id={`${base}-nombre`}
                  aria-label={`Nombre del campo ${i + 1}`}
                  className={`form-control form-control-sm campo-proyecto__nombre${error.etiqueta ? " is-invalid" : ""}`}
                  aria-required="true"
                  aria-invalid={error.etiqueta ? true : undefined}
                  aria-describedby={
                    error.etiqueta ? `${base}-nombre-error` : undefined
                  }
                  maxLength={120}
                  value={campo.etiqueta}
                  onChange={(e) => cambiar(i, { etiqueta: e.target.value })}
                />
                <select
                  aria-label={`Tipo del campo ${i + 1}`}
                  className="form-select form-select-sm campo-proyecto__tipo"
                  value={campo.tipo}
                  onChange={(e) => cambiar(i, { tipo: e.target.value })}
                >
                  {TIPOS_DE_CAMPO.map(([id, nombre]) => (
                    <option key={id} value={id}>
                      {nombre}
                    </option>
                  ))}
                </select>
                <span className="campo-proyecto__orden">
                  <Orden
                    idBase={base}
                    nombre={`el campo ${i + 1}`}
                    i={i}
                    total={campos.length}
                    onMover={(delta) =>
                      orden.mover(i, delta, delta < 0 ? "subir" : "bajar")
                    }
                    onQuitar={() => orden.quitar(i)}
                  />
                </span>
              </div>
              {error.etiqueta && (
                <small
                  id={`${base}-nombre-error`}
                  className="invalid-feedback d-block"
                >
                  {error.etiqueta}
                </small>
              )}
              <div className="row g-2">
                <div className="col-12 col-md-8">
                  <input
                    aria-label={`Ayuda del campo ${i + 1}`}
                    className="form-control form-control-sm"
                    maxLength={300}
                    placeholder="Ayuda para quien llena (opcional)"
                    value={campo.ayuda ?? ""}
                    onChange={(e) => cambiar(i, { ayuda: e.target.value })}
                  />
                </div>
                <div className="col-12 col-md-4 d-flex align-items-center">
                  <label className="form-check mb-0">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      aria-label={`Campo ${i + 1} obligatorio`}
                      checked={Boolean(campo.obligatorio)}
                      onChange={(e) =>
                        cambiar(i, { obligatorio: e.target.checked })
                      }
                    />{" "}
                    <span className="form-check-label" aria-hidden="true">
                      Obligatorio
                    </span>
                  </label>
                </div>
                {campo.tipo === "lista" && (
                  <Campo
                    id={`${base}-opciones`}
                    etiqueta={`Opciones del campo ${i + 1}`}
                    ayuda="Una opción por línea; por ejemplo: Alta, Media y Baja, cada una en su línea."
                    error={error.opciones}
                    obligatorio
                    className="col-12"
                  >
                    <textarea
                      className="form-control form-control-sm"
                      rows={3}
                      value={(campo.opciones ?? []).join("\n")}
                      onChange={(e) =>
                        cambiar(i, { opciones: e.target.value.split("\n") })
                      }
                    />
                  </Campo>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        id="campo-agregar"
        className="btn btn-outline-primary btn-sm align-self-start"
        onClick={() =>
          orden.agregar({
            _k: nuevaClave(),
            etiqueta: "",
            tipo: "texto",
            obligatorio: false,
            ayuda: "",
          })
        }
      >
        <Icon name="plus-lg" /> Agregar campo
      </button>
    </div>
  );
}

/** Crear o editar un tipo de proyecto: datos, plantilla, formulario y
 * aprobaciones (auditoría UX/UI, 30/10/2026). */
function EditorTipo({
  inicial,
  opciones,
  errorOpciones,
  onReintentarOpciones,
  onGuardado,
  onCerrar,
}) {
  const [tipo, setTipo] = useState(() => conClaves(inicial));
  const original = useMemo(
    () => JSON.stringify(paraEnviar(conClaves(inicial))),
    // Solo al abrir: si el tipo se crea y falla la plantilla, `inicial`
    // cambia (recibe su id) pero lo escrito sigue siendo un cambio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [plantilla, setPlantilla] = useState(null);
  const [errores, setErrores] = useState(VACIO);
  const [anuncio, setAnuncio] = useState("");
  const formulario = useRef(null);
  const [guardando, setGuardando] = useState(false);
  const { panelRef, handleBackdropClick, marcarCambio } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const editando = Boolean(inicial.id);
  const enCurso = inicial.solicitudes_en_curso ?? 0;

  // Agregar, quitar o mover filas, o elegir una plantilla, también son
  // cambios: cerrar pregunta antes de descartarlos.
  useEffect(() => {
    if (JSON.stringify(paraEnviar(tipo)) !== original || plantilla)
      marcarCambio(true);
  }, [tipo, plantilla, original, marcarCambio]);

  const fijar = (campo) => (e) =>
    setTipo((t) => ({
      ...t,
      [campo]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));
  const pasos = tipo.pasos;
  const cambiarPasos = (nuevos) => setTipo((t) => ({ ...t, pasos: nuevos }));
  const conPlantilla = tipo.tiene_plantilla || Boolean(plantilla);
  // Los errores van por posición: al mover o quitar, ya no corresponden.
  const limpiarFilas = () =>
    setErrores((e) => ({ ...e, filas: {}, pasos: {} }));
  const ordenPasos = useListaOrdenada(
    pasos,
    (nuevos) => {
      cambiarPasos(nuevos);
      limpiarFilas();
    },
    { prefijo: "paso", anunciar: setAnuncio, nombreDe: (p) => p.nombre },
  );

  async function guardar(evento) {
    evento.preventDefault();
    setErrores(VACIO);
    const propios = validar(tipo, plantilla);
    if (propios.mensajes.length) {
      setErrores(propios);
      enfocarPrimerError(formulario.current);
      return;
    }
    setGuardando(true);
    try {
      await onGuardado(paraEnviar(tipo), plantilla, Boolean(tipo.activo));
    } catch (err) {
      setErrores(
        erroresDelServidor(err, "No se pudo guardar el tipo de proyecto."),
      );
      setGuardando(false);
      enfocarPrimerError(formulario.current);
    }
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal mz-modal--wide flujo-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tp-editor-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="tp-editor-titulo">
            {editando ? `Editar «${inicial.nombre}»` : "Nuevo tipo de proyecto"}
          </h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <form
          id="tp-form"
          ref={formulario}
          className="mz-panel-body mz-stack"
          onSubmit={guardar}
          noValidate
        >
          <p className="visually-hidden" aria-live="polite">
            {anuncio}
          </p>
          {errores.mensajes.length > 0 && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              <div>
                <strong>Revise lo marcado:</strong>
                <ul className="mb-0 ps-3">
                  {errores.mensajes.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {editando && enCurso > 0 && (
            <div className="mz-alert mz-alert--info" role="note">
              <Icon name="info-circle" />
              <span>
                Este tipo tiene <strong>{enCurso}</strong>{" "}
                {enCurso === 1 ? "solicitud en curso" : "solicitudes en curso"}.
                Siguen en su paso; los cambios de quién decide valen para los
                pasos que empiecen desde ahora. Mientras tanto, un paso con
                solicitudes no se puede quitar y los pasos que ya existían no se
                pueden reordenar (sí agregar nuevos).
              </span>
            </div>
          )}
          {errorOpciones && (
            <div
              className="mz-alert mz-alert--bad mz-alert--accion"
              role="alert"
            >
              <Icon name="x-octagon" />
              <span>{errorOpciones}</span>
              <button
                type="button"
                className="btn btn-sm btn-outline-danger ms-auto"
                onClick={onReintentarOpciones}
              >
                <Icon name="arrow-clockwise" /> Reintentar
              </button>
            </div>
          )}

          <section aria-labelledby="tp-datos" className="flujo-bloque">
            <h4 id="tp-datos" className="flujo-seccion">
              Datos del tipo
            </h4>
            <LeyendaObligatorios />
            <div className="row g-2">
              <Campo
                id="tp-nombre"
                etiqueta="Nombre del tipo de proyecto"
                obligatorio
                error={errores.campos.nombre}
                className="col-12"
              >
                <input
                  className="form-control form-control-sm"
                  maxLength={120}
                  placeholder="Ej.: Desarrollo de un reporte"
                  value={tipo.nombre}
                  onChange={fijar("nombre")}
                  data-autofocus
                />
              </Campo>
              <Campo
                id="tp-descripcion"
                etiqueta="Indicaciones (las ve quien solicita)"
                error={errores.campos.descripcion}
                className="col-12"
              >
                <textarea
                  rows={2}
                  className="form-control form-control-sm"
                  value={tipo.descripcion ?? ""}
                  onChange={fijar("descripcion")}
                />
              </Campo>
              <div className="col-12">
                <label className="form-check mb-0">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={Boolean(tipo.activo)}
                    disabled={!conPlantilla}
                    aria-describedby="tp-activo-ayuda"
                    aria-invalid={errores.campos.activo ? true : undefined}
                    onChange={fijar("activo")}
                  />{" "}
                  <span className="form-check-label">
                    Activo (se puede solicitar)
                  </span>
                </label>
                <small
                  id="tp-activo-ayuda"
                  className={`d-block ${errores.campos.activo ? "text-danger" : "mz-faint"}`}
                >
                  {errores.campos.activo ||
                    (conPlantilla
                      ? "Desactivado, nadie puede solicitarlo."
                      : "Para activarlo, cargue antes la plantilla (abajo).")}
                </small>
              </div>
            </div>
          </section>

          <section aria-labelledby="tp-plantilla" className="flujo-bloque">
            <h4 id="tp-plantilla" className="flujo-seccion">
              Plantilla
            </h4>
            <p className="mz-faint mz-small mb-2">
              Quien solicita la descarga, la llena y la vuelve a cargar con su
              solicitud. Word (.docx), Excel (.xlsx) o PDF, hasta 10 MB.
            </p>
            {tipo.tiene_plantilla && (
              <p className="mz-small mb-1">
                <Icon name="file-earmark-text" /> Actual:{" "}
                <strong>{tipo.plantilla_nombre}</strong>
              </p>
            )}
            <Campo
              id="tp-archivo"
              etiqueta={
                tipo.tiene_plantilla
                  ? "Reemplazar por otra (opcional)"
                  : "Cargar la plantilla (hace falta para activarlo)"
              }
              error={errores.campos.plantilla ?? errores.campos.archivo}
            >
              <input
                type="file"
                accept={ACEPTA}
                className="form-control form-control-sm"
                onChange={(e) => setPlantilla(e.target.files?.[0] ?? null)}
              />
            </Campo>
          </section>

          <section aria-labelledby="tp-campos" className="flujo-bloque">
            <h4 id="tp-campos" className="flujo-seccion">
              Formulario
            </h4>
            <p className="mz-faint mz-small mb-2">
              Además del nombre del proyecto y la plantilla llena, se piden
              estos campos, en este orden. Los obligatorios no dejan enviar la
              solicitud vacíos.
            </p>
            <EditorDeCampos
              campos={tipo.campos}
              onCambio={(campos) => setTipo((t) => ({ ...t, campos }))}
              errores={errores.filas}
              anunciar={setAnuncio}
              alCambiarOrden={limpiarFilas}
            />
          </section>

          <section aria-labelledby="tp-pasos" className="flujo-bloque">
            <h4 id="tp-pasos" className="flujo-seccion">
              Aprobaciones antes de iniciar
            </h4>
            <p className="mz-faint mz-small mb-2">
              Cada paso lo decide cualquiera de los indicados; aprobado, pasa al
              siguiente. Aprobado el último, el proyecto se puede iniciar. Si
              alguien lo rechaza, no se inicia.
            </p>
            {!opciones && !errorOpciones && (
              <p className="mz-faint mz-small" role="status">
                Cargando personas, roles y cargos…
              </p>
            )}
            <ol className="flujo-pasos">
              {pasos.map((paso, i) => {
                const error = errores.pasos[i] ?? {};
                const base = `paso-${paso._k}`;
                const conSolicitudes = paso.en_curso ?? 0;
                return (
                  <li key={paso._k} className="flujo-paso">
                    <div className="flujo-paso__cabecera">
                      <span className="flujo-paso__numero" aria-hidden="true">
                        {i + 1}
                      </span>
                      <input
                        id={`${base}-nombre`}
                        aria-label={`Nombre del paso ${i + 1}`}
                        aria-required="true"
                        className={`form-control form-control-sm${error.nombre ? " is-invalid" : ""}`}
                        aria-invalid={error.nombre ? true : undefined}
                        aria-describedby={
                          error.nombre ? `${base}-nombre-error` : undefined
                        }
                        maxLength={120}
                        value={paso.nombre}
                        onChange={(e) =>
                          cambiarPasos(
                            pasos.map((p, j) =>
                              j === i ? { ...p, nombre: e.target.value } : p,
                            ),
                          )
                        }
                      />
                      <Orden
                        idBase={base}
                        nombre={`el paso ${i + 1}`}
                        i={i}
                        total={pasos.length}
                        minimo={1}
                        motivoMover={
                          enCurso > 0 && paso.id
                            ? "Hay solicitudes en curso: los pasos que ya existían no se reordenan hasta que terminen."
                            : undefined
                        }
                        motivoQuitar={
                          conSolicitudes
                            ? `Tiene ${conSolicitudes} ${conSolicitudes === 1 ? "solicitud" : "solicitudes"} en curso: no se puede quitar.`
                            : undefined
                        }
                        onMover={(delta) =>
                          ordenPasos.mover(
                            i,
                            delta,
                            delta < 0 ? "subir" : "bajar",
                          )
                        }
                        onQuitar={() => ordenPasos.quitar(i)}
                      />
                    </div>
                    {error.nombre && (
                      <small
                        id={`${base}-nombre-error`}
                        className="invalid-feedback d-block"
                      >
                        {error.nombre}
                      </small>
                    )}
                    <span id={`${base}-decide`} className="mz-small mz-faint">
                      Paso {i + 1}: lo decide cualquiera de:
                      {conSolicitudes > 0 &&
                        ` (${conSolicitudes} en curso en este paso)`}
                    </span>
                    <ListaDeDestinos
                      idBase={`${base}-aprobador`}
                      grupoId={`${base}-decide`}
                      conector="o"
                      prefijo={`quien decide el paso ${i + 1}`}
                      etiquetaAgregar={`Agregar quién decide el paso ${i + 1}`}
                      lista={paso.aprobadores}
                      tipos={DESTINOS_APROBADOR}
                      opciones={opciones}
                      minimo={1}
                      vacio="Agregue al menos a alguien que decida."
                      errores={error.destinos}
                      errorLista={error.lista}
                      anunciar={setAnuncio}
                      onCambio={(aprobadores) =>
                        cambiarPasos(
                          pasos.map((p, j) =>
                            j === i ? { ...p, aprobadores } : p,
                          ),
                        )
                      }
                    />
                  </li>
                );
              })}
            </ol>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={() =>
                ordenPasos.agregar({
                  _k: nuevaClave(),
                  nombre: `Paso ${pasos.length + 1}`,
                  aprobadores: [{ tipo: "persona", _k: nuevaClave() }],
                })
              }
            >
              <Icon name="plus-lg" /> Agregar paso
            </button>
          </section>

          <RutaDeAprobacion pasos={pasos} opciones={opciones} />
        </form>
        {/* Fijo abajo: guardar o cancelar sin bajar hasta el final. */}
        <div className="mz-panel-foot">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onCerrar}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="tp-form"
            className="btn btn-primary btn-sm"
            disabled={guardando}
          >
            {guardando
              ? "Guardando…"
              : editando
                ? "Guardar cambios"
                : "Crear tipo de proyecto"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Solicitud de proyectos → Tipos de proyecto (pide `proyectos.configurar`):
 * cada tipo con su plantilla, su formulario (campos obligatorios u
 * opcionales) y sus pasos con quién decide cada uno.
 */
export function TiposProyectoPage() {
  const [tipos, setTipos] = useState(null);
  const [opciones, setOpciones] = useState(null);
  const [errorOpciones, setErrorOpciones] = useState(null);
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState(null);
  // El fallo al cargar va junto a la lista, con «Reintentar» (auditoría
  // UX/UI, fase 2, 28/10/2026).
  const [errorCarga, setErrorCarga] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(() => {
    setErrorCarga(null);
    return proyectosService
      .tiposConfigurados()
      .then(setTipos)
      .catch((err) =>
        setErrorCarga(
          mensajeDeError(err, "No se pudieron cargar los tipos de proyecto."),
        ),
      );
  }, []);

  // Sin las opciones no se pueden elegir aprobadores: el aviso va dentro del
  // editor (antes quedaba tapado detrás de la ventana), con «Reintentar».
  const cargarOpciones = useCallback(() => {
    setErrorOpciones(null);
    proyectosService
      .opciones()
      .then(setOpciones)
      .catch((err) =>
        setErrorOpciones(
          mensajeDeError(
            err,
            "No se pudieron cargar las personas, roles y cargos para elegir quién decide.",
          ),
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
    cargarOpciones();
  }, [cargar, cargarOpciones]);

  /** Guarda los datos, luego la plantilla y luego activa. Si la plantilla
   * falla, el tipo ya quedó guardado: el editor pasa a editarlo (con su id),
   * así el reintento no lo duplica, y lo dice (auditoría UX/UI, 30/10/2026). */
  async function guardar(datos, plantilla, activar) {
    const guardado = await proyectosService.guardarTipo(editando.id, datos);
    const nuevo = !editando.id;
    if (plantilla) {
      try {
        await proyectosService.cargarPlantilla(guardado.id, plantilla);
        if (activar && !datos.activo) {
          await proyectosService.activarTipo(guardado.id, true);
        }
      } catch (err) {
        setEditando((e) => ({ ...e, ...guardado, id: guardado.id }));
        cargar();
        const motivo = mensajeDeError(err, "no se pudo cargar el archivo.");
        throw Object.assign(new Error(motivo), {
          response: {
            data: {
              error: {
                message: `${nuevo ? "El tipo se creó" : "Los cambios se guardaron"}, pero la plantilla no se cargó: ${motivo} Elija el archivo de nuevo y guarde.`,
              },
            },
          },
        });
      }
    }
    setAviso(
      nuevo
        ? `Tipo de proyecto «${datos.nombre}» creado.`
        : `Tipo de proyecto «${datos.nombre}» actualizado.`,
    );
    setEditando(null);
    await cargar();
  }

  async function hacer(accion, exito) {
    setError(null);
    setAviso(null);
    try {
      await accion();
      setAviso(exito);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo completar."));
    }
  }

  async function descargar(tipo) {
    try {
      guardarArchivo(
        await proyectosService.plantillaConfigurada(tipo.id),
        tipo.plantilla_nombre,
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar la plantilla."));
    }
  }

  async function cambiarActivo(t) {
    if (
      t.activo &&
      !(await confirmar({
        titulo: `¿Desactivar «${t.nombre}»?`,
        mensaje:
          "Ya no se podrá solicitar. Las solicitudes que tiene se conservan y las que están en curso siguen su aprobación.",
        accion: "Desactivar",
        peligro: false,
      }))
    )
      return;
    hacer(
      () => proyectosService.activarTipo(t.id, !t.activo),
      t.activo
        ? `«${t.nombre}» ya no se puede solicitar.`
        : `«${t.nombre}» ya se puede solicitar.`,
    );
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Tipos de proyecto</h2>
          <p className="mz-desc">
            Los proyectos que se pueden solicitar: su plantilla, los datos que
            se piden y quién aprueba, autoriza y revisa antes de iniciarlos.
          </p>
        </div>
        <div className="mz-actions">
          <Link
            to="/admin/institucional/proyectos"
            className="btn btn-outline-secondary btn-sm"
          >
            <Icon name="arrow-left" /> Volver a las solicitudes
          </Link>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEditando({ ...NUEVO })}
          >
            <Icon name="plus-lg" /> Nuevo tipo de proyecto
          </button>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check-circle" />
          {aviso}
        </div>
      )}

      <EstadoDeCarga
        cargando={tipos === null}
        error={errorCarga}
        onReintentar={cargar}
        vacio={tipos?.length === 0}
        textoVacio="Todavía no hay tipos de proyecto."
      />
      <div className="flujos-lista">
        {(tipos ?? []).map((t) => {
          const obligatorios = t.campos.filter((c) => c.obligatorio).length;
          return (
            <section
              key={t.id}
              className={`flujo-tarjeta${t.activo ? "" : " flujo-tarjeta--inactivo"}`}
              aria-label={t.nombre}
            >
              <header className="flujo-tarjeta__cabecera">
                <div>
                  <strong>{t.nombre}</strong>{" "}
                  {!t.activo && (
                    <span className="mz-pill mz-pill--neutral">Inactivo</span>
                  )}
                  {t.descripcion && <small>{t.descripcion}</small>}
                </div>
                <span className="flujo-tarjeta__acciones">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    aria-label={`Editar ${t.nombre}`}
                    onClick={() => setEditando(t)}
                  >
                    <Icon name="pencil" />
                  </button>
                  {t.solicitudes > 0 ? (
                    t.tiene_plantilla && (
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        aria-label={`${t.activo ? "Desactivar" : "Activar"} ${t.nombre}`}
                        title={
                          t.activo
                            ? "Tiene solicitudes: no se borra, se desactiva."
                            : "Volver a permitir que se solicite."
                        }
                        onClick={() => cambiarActivo(t)}
                      >
                        <Icon
                          name={t.activo ? "pause-circle" : "play-circle"}
                        />
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      aria-label={`Borrar ${t.nombre}`}
                      onClick={async () => {
                        const si = await confirmar({
                          titulo: `¿Borrar el tipo de proyecto «${t.nombre}»?`,
                          mensaje:
                            "No tiene solicitudes. Se borra con su plantilla, su formulario y sus pasos.",
                          accion: "Borrar",
                        });
                        if (si) {
                          hacer(
                            () => proyectosService.eliminarTipo(t.id),
                            `«${t.nombre}» se borró.`,
                          );
                        }
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </span>
              </header>
              <div className="mz-small d-flex flex-wrap gap-2 align-items-center">
                {t.tiene_plantilla ? (
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0"
                    onClick={() => descargar(t)}
                  >
                    <Icon name="file-earmark-arrow-down" /> {t.plantilla_nombre}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => setEditando(t)}
                  >
                    <Icon name="upload" /> Cargar plantilla
                  </button>
                )}
                <span className="mz-faint">
                  {t.campos.length} {t.campos.length === 1 ? "campo" : "campos"}{" "}
                  ({obligatorios}{" "}
                  {obligatorios === 1 ? "obligatorio" : "obligatorios"}) ·{" "}
                  {t.solicitudes}{" "}
                  {t.solicitudes === 1 ? "solicitud" : "solicitudes"}
                </span>
                {t.solicitudes_en_curso > 0 && (
                  <span className="mz-pill mz-pill--warn">
                    {t.solicitudes_en_curso} en curso
                  </span>
                )}
                {t.tiene_plantilla && !t.solicitudes && (
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm ms-auto"
                    onClick={() => cambiarActivo(t)}
                  >
                    {t.activo ? "Desactivar" : "Activar"}
                  </button>
                )}
              </div>
              <ol className="flujo-tarjeta__pasos">
                {t.pasos.map((p) => (
                  <li key={p.id}>
                    <strong>{p.nombre}</strong>
                    <span className="mz-faint mz-small">
                      {p.aprobadores.map((a) => a.descripcion).join(" o ")}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>

      {editando && (
        <EditorTipo
          inicial={editando}
          opciones={opciones}
          errorOpciones={errorOpciones}
          onReintentarOpciones={cargarOpciones}
          onGuardado={guardar}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}
