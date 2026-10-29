import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { licenciasService } from "../../api/licenciasService";
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
  DESTINOS,
  DESTINOS_APROBADOR,
  DESTINOS_AVISO,
  SelectorDestino,
} from "./licenciasComunes";
import "./Institucional.css";
import { confirmar } from "../../components/common/Confirmar/confirmar";

const ADJUNTOS = [
  ["no", "No se pide documento"],
  ["opcional", "Documento opcional"],
  ["obligatorio", "Documento obligatorio"],
];

const NUEVO = {
  nombre: "",
  descripcion: "",
  activo: true,
  adjunto: "no",
  orden: 0,
  dias_minimos: 0,
  dias_maximos: 0,
  descuenta_vacaciones: false,
  sabados_por_periodo: 0,
  domingos_por_periodo: 0,
  restricciones: "",
  pide_motivo: true,
  pasos: [{ nombre: "Jefatura", aprobadores: [{ tipo: "jefe_inmediato" }] }],
  avisos_aprobada: [{ tipo: "solicitante" }],
  avisos_rechazada: [{ tipo: "solicitante" }],
};

/** Los destinos que necesitan elegir a alguien, y con qué campo. */
const CAMPO_DE = { persona: "usuario", rol: "rol", cargo: "cargo" };
const LISTA_DE = { persona: "personas", rol: "roles", cargo: "cargos" };

// Claves estables para pasos y destinos: con el índice como clave, al mover
// un paso el foco quedaba en el que ocupaba su lugar (auditoría UX/UI,
// 29/10/2026).
let ultimaClave = 0;
const nuevaClave = () => `k${(ultimaClave += 1)}`;

function conClaves(flujo) {
  const destinos = (lista) =>
    (lista ?? []).map((d) => ({ ...d, _k: nuevaClave() }));
  return {
    ...flujo,
    pasos: (flujo.pasos ?? []).map((p) => ({
      ...p,
      _k: nuevaClave(),
      aprobadores: destinos(p.aprobadores),
    })),
    avisos_aprobada: destinos(flujo.avisos_aprobada),
    avisos_rechazada: destinos(flujo.avisos_rechazada),
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
function paraEnviar(flujo) {
  return {
    nombre: flujo.nombre,
    descripcion: flujo.descripcion,
    activo: flujo.activo,
    adjunto: flujo.adjunto,
    orden: Number(flujo.orden) || 0,
    dias_minimos: Number(flujo.dias_minimos) || 0,
    dias_maximos: Number(flujo.dias_maximos) || 0,
    descuenta_vacaciones: Boolean(flujo.descuenta_vacaciones),
    sabados_por_periodo: flujo.descuenta_vacaciones
      ? Number(flujo.sabados_por_periodo) || 0
      : 0,
    domingos_por_periodo: flujo.descuenta_vacaciones
      ? Number(flujo.domingos_por_periodo) || 0
      : 0,
    restricciones: flujo.restricciones ?? "",
    pide_motivo: flujo.pide_motivo !== false,
    // Con su id: al editar, el servidor conserva el paso y las solicitudes
    // que están en él.
    pasos: flujo.pasos.map((p) => ({
      ...(p.id ? { id: p.id } : {}),
      nombre: p.nombre,
      aprobadores: limpiarDestinos(p.aprobadores),
    })),
    avisos_aprobada: limpiarDestinos(flujo.avisos_aprobada),
    avisos_rechazada: limpiarDestinos(flujo.avisos_rechazada),
  };
}

/** «Su jefe inmediato», «Juan Pérez», «Rol Talento Humano»…: un destino en
 * palabras, con las opciones cargadas. */
function describir(destino, opciones) {
  const campo = CAMPO_DE[destino.tipo];
  if (!campo) return DESTINOS[destino.tipo] ?? destino.tipo;
  const elegido = opciones?.[LISTA_DE[destino.tipo]]?.find(
    (o) => o.id === destino[campo],
  );
  if (!elegido) return `${DESTINOS[destino.tipo]} (sin elegir)`;
  return destino.tipo === "persona"
    ? elegido.nombre
    : `${destino.tipo === "rol" ? "Rol" : "Cargo"} ${elegido.nombre}`;
}

const VACIO_DE_ERRORES = { campos: {}, pasos: {}, avisos: {}, mensajes: [] };

const NOMBRE_AVISO = {
  avisos_aprobada: "A quién avisar si se aprueba",
  avisos_rechazada: "A quién avisar si se rechaza",
};

/** Lo que falta antes de enviar: nombres vacíos, pasos sin aprobador y
 * destinos sin elegir. Con la misma forma que los errores del servidor. */
function validar(flujo) {
  const errores = { campos: {}, pasos: {}, avisos: {}, mensajes: [] };
  if (!flujo.nombre.trim()) {
    errores.campos.nombre = "Escriba el nombre del permiso.";
    errores.mensajes.push("Nombre del permiso: escríbalo.");
  }
  const sinElegir = (d) => CAMPO_DE[d.tipo] && !d[CAMPO_DE[d.tipo]];
  flujo.pasos.forEach((paso, i) => {
    const propio = { destinos: {} };
    if (!paso.nombre.trim()) {
      propio.nombre = "Escriba el nombre del paso.";
      errores.mensajes.push(`Paso ${i + 1}: escriba su nombre.`);
    }
    if (paso.aprobadores.length === 0) {
      propio.lista = "Agregue al menos un aprobador.";
      errores.mensajes.push(`Paso ${i + 1}: agregue al menos un aprobador.`);
    }
    paso.aprobadores.forEach((d, j) => {
      if (sinElegir(d)) {
        propio.destinos[j] = "Elija a quién.";
        errores.mensajes.push(
          `Paso ${i + 1}, aprobador ${j + 1}: elija ${DESTINOS[d.tipo].toLowerCase()}.`,
        );
      }
    });
    if (propio.nombre || propio.lista || Object.keys(propio.destinos).length)
      errores.pasos[i] = propio;
  });
  for (const clave of ["avisos_aprobada", "avisos_rechazada"]) {
    const destinos = {};
    flujo[clave].forEach((d, j) => {
      if (sinElegir(d)) {
        destinos[j] = "Elija a quién.";
        errores.mensajes.push(
          `${NOMBRE_AVISO[clave]}, ${j + 1}: elija a quién.`,
        );
      }
    });
    if (Object.keys(destinos).length) errores.avisos[clave] = { destinos };
  }
  return errores;
}

const NOMBRE_CAMPO = {
  nombre: "Nombre del permiso",
  descripcion: "Descripción",
  adjunto: "Documento de respaldo",
  dias_minimos: "Mínimo de días",
  dias_maximos: "Máximo de días",
  sabados_por_periodo: "Sábados por período",
  domingos_por_periodo: "Domingos por período",
  restricciones: "Otras indicaciones",
  avisos_aprobada: "A quién avisar si se aprueba",
  avisos_rechazada: "A quién avisar si se rechaza",
};

const texto = (v) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").join(" ") : v;

/** Los errores del servidor con la forma de `validar`: los de los pasos y
 * avisos llegan anidados (`pasos: [{}, {aprobadores: [{usuario: [...]}]}]`)
 * y antes se leían «[object Object]» (auditoría UX/UI, 29/10/2026). */
function erroresDelServidor(err) {
  const datos = err?.response?.data;
  const fuente = datos?.error?.details ?? (datos?.error ? {} : datos) ?? {};
  const errores = {
    campos: erroresPorCampo(err),
    pasos: {},
    avisos: {},
    mensajes: [],
  };
  for (const [campo, valor] of Object.entries(errores.campos)) {
    if (campo === "pasos") continue;
    errores.mensajes.push(`${NOMBRE_CAMPO[campo] ?? campo}: ${valor}`);
  }
  if (Array.isArray(fuente.pasos)) {
    if (fuente.pasos.every((v) => typeof v === "string")) {
      errores.general = fuente.pasos.join(" ");
      errores.mensajes.push(errores.general);
    } else {
      fuente.pasos.forEach((paso, i) => {
        if (!paso || typeof paso !== "object") return;
        const propio = { destinos: {} };
        if (paso.nombre) propio.nombre = texto(paso.nombre);
        const aprob = paso.aprobadores;
        if (Array.isArray(aprob) && aprob.every((v) => typeof v === "string")) {
          propio.lista = aprob.join(" ");
        } else if (Array.isArray(aprob)) {
          aprob.forEach((d, j) => {
            if (d && typeof d === "object" && Object.keys(d).length)
              propio.destinos[j] = Object.values(d).map(texto).join(" ");
          });
        }
        if (propio.nombre)
          errores.mensajes.push(`Paso ${i + 1}: ${propio.nombre}`);
        if (propio.lista)
          errores.mensajes.push(`Paso ${i + 1}: ${propio.lista}`);
        Object.entries(propio.destinos).forEach(([j, m]) =>
          errores.mensajes.push(
            `Paso ${i + 1}, aprobador ${Number(j) + 1}: ${m}`,
          ),
        );
        errores.pasos[i] = propio;
      });
    }
  }
  for (const clave of ["avisos_aprobada", "avisos_rechazada"]) {
    if (!Array.isArray(fuente[clave])) continue;
    const destinos = {};
    fuente[clave].forEach((d, j) => {
      if (d && typeof d === "object" && Object.keys(d).length) {
        destinos[j] = Object.values(d).map(texto).join(" ");
        errores.mensajes.push(
          `${NOMBRE_AVISO[clave]}, ${j + 1}: ${destinos[j]}`,
        );
      }
    });
    errores.avisos[clave] = { destinos };
  }
  const generales = [fuente.non_field_errors, fuente.detail]
    .map(texto)
    .filter(Boolean);
  errores.mensajes.push(...generales);
  if (!errores.mensajes.length)
    errores.mensajes.push(
      mensajeDeError(err, "No se pudo guardar el tipo de permiso."),
    );
  return errores;
}

/** Los tipos sin a quién elegir (quien solicita, su jefe…) van una sola vez
 * por lista. */
const tiposLibres = (tipos, lista, propio) =>
  tipos.filter(
    (t) => CAMPO_DE[t] || t === propio || !lista.some((d) => d.tipo === t),
  );

/** Una lista de destinos (aprobadores de un paso o avisos), con agregar y
 * quitar; el foco sigue a la fila nueva o a la vecina de la que se quitó. */
export function ListaDeDestinos({
  idBase,
  prefijo,
  grupoId,
  lista,
  tipos,
  opciones,
  onCambio,
  vacio,
  conector,
  minimo = 0,
  etiquetaAgregar = "Agregar",
  errores = {},
  errorLista,
  anunciar = () => {},
}) {
  // Sin `idBase` ni claves (la usan también los tipos de proyecto), se arma
  // con el prefijo y la posición.
  const base =
    idBase ?? `destino-${prefijo.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const idDe = (d, i) => `${base}-${d._k ?? i}`;
  const enfocar = (id) =>
    requestAnimationFrame(() => document.getElementById(id)?.focus());

  function quitar(i) {
    // La vecina queda en la posición i (si había siguiente) o en i - 1.
    const destino = lista[i + 1]
      ? idDe(lista[i + 1], i)
      : lista[i - 1]
        ? idDe(lista[i - 1], i - 1)
        : `${base}-agregar`;
    onCambio(lista.filter((_, j) => j !== i));
    anunciar(`Se quitó ${prefijo}, opción ${i + 1}.`);
    enfocar(destino);
  }

  function agregar() {
    // El primer tipo que no esté ya en la lista (no repetir «Quien solicita»).
    const tipo =
      tipos.find((t) => CAMPO_DE[t] || !lista.some((d) => d.tipo === t)) ??
      tipos[0];
    const nuevo = { tipo, _k: nuevaClave() };
    onCambio([...lista, nuevo]);
    anunciar(`Se agregó ${prefijo}, opción ${lista.length + 1}.`);
    enfocar(idDe(nuevo, lista.length));
  }

  return (
    <div className="flujo-destinos" role="group" aria-labelledby={grupoId}>
      {lista.map((destino, i) => {
        const error = errores?.[i];
        const idError = `${idDe(destino, i)}-error`;
        return (
          <div key={destino._k ?? i}>
            <div className="flujo-destinos__fila">
              {/* «o» entre aprobadores (aprueba cualquiera); los avisos no
                  llevan conector: los reciben todos. */}
              {conector && (
                <span className="flujo-destinos__conector" aria-hidden="true">
                  {i > 0 ? conector : ""}
                </span>
              )}
              <SelectorDestino
                id={idDe(destino, i)}
                etiqueta={`${prefijo}, opción ${i + 1}`}
                valor={destino}
                onCambio={(nuevo) =>
                  onCambio(
                    lista.map((d, j) => (j === i ? { ...nuevo, _k: d._k } : d)),
                  )
                }
                opciones={opciones}
                tipos={tiposLibres(
                  tipos,
                  lista.filter((_, j) => j !== i),
                  destino.tipo,
                )}
                invalido={Boolean(error)}
                describedBy={error ? idError : undefined}
              />
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                aria-label={`Quitar ${prefijo}, opción ${i + 1}`}
                disabled={lista.length <= minimo}
                title={
                  lista.length <= minimo
                    ? "Cada paso necesita al menos un aprobador."
                    : undefined
                }
                onClick={() => quitar(i)}
              >
                <Icon name="x-lg" />
              </button>
            </div>
            {error && (
              <small id={idError} className="invalid-feedback d-block">
                {error}
              </small>
            )}
          </div>
        );
      })}
      {lista.length === 0 && (
        <p
          className={`mz-small mb-1 ${errorLista ? "text-danger" : "mz-faint"}`}
        >
          {errorLista || vacio}
        </p>
      )}
      <button
        type="button"
        id={`${base}-agregar`}
        className="btn btn-link btn-sm px-0 flujo-destinos__agregar"
        onClick={agregar}
      >
        <Icon name="plus" /> {etiquetaAgregar}
      </button>
    </div>
  );
}

/** El recorrido que queda configurado, en una línea por etapa. */
function ResumenDeRuta({ flujo, opciones }) {
  const lista = (destinos) =>
    destinos.map((d) => describir(d, opciones)).join(", ") || "nadie";
  return (
    <section className="flujo-ruta" aria-labelledby="flujo-ruta">
      <h4 id="flujo-ruta" className="flujo-seccion">
        Así queda la ruta
      </h4>
      <ol className="flujo-ruta__pasos">
        <li>
          <strong>Solicita</strong> quien pide el permiso
        </li>
        {flujo.pasos.map((p, i) => (
          <li key={p._k}>
            <strong>
              {i + 1}. {p.nombre || "(sin nombre)"}
            </strong>{" "}
            — lo aprueba{" "}
            {p.aprobadores.map((d) => describir(d, opciones)).join(" o ") ||
              "nadie todavía"}
          </li>
        ))}
        <li>
          <strong>Al terminar</strong> se avisa: si se aprueba, a{" "}
          {lista(flujo.avisos_aprobada)}; si se rechaza, a{" "}
          {lista(flujo.avisos_rechazada)}.
        </li>
      </ol>
      <p className="mz-faint mz-small mb-0">
        Si un paso no encuentra a nadie (por ejemplo, quien solicita no tiene
        jefe en el organigrama o el rol está vacío), la solicitud queda en manos
        de quien administra los tipos de permiso.
      </p>
    </section>
  );
}

/** Crear o editar un tipo de permiso: datos, restricciones, pasos en orden y
 * avisos al terminar (auditoría UX/UI, 29/10/2026). */
function EditorFlujo({
  inicial,
  opciones,
  errorOpciones,
  onReintentarOpciones,
  onGuardado,
  onCerrar,
}) {
  const [flujo, setFlujo] = useState(() => conClaves(inicial));
  const original = useMemo(
    () => JSON.stringify(paraEnviar(conClaves(inicial))),
    [inicial],
  );
  const [errores, setErrores] = useState(VACIO_DE_ERRORES);
  const [anuncio, setAnuncio] = useState("");
  const formulario = useRef(null);
  const [guardando, setGuardando] = useState(false);
  const { panelRef, handleBackdropClick, marcarCambio } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const editando = Boolean(inicial.id);
  const enCurso = inicial.solicitudes_en_curso ?? 0;

  // Agregar, quitar o mover filas también son cambios: cerrar pregunta antes
  // de descartarlos (antes solo contaba lo escrito en un campo).
  useEffect(() => {
    if (JSON.stringify(paraEnviar(flujo)) !== original) marcarCambio(true);
  }, [flujo, original, marcarCambio]);

  const fijar = (campo) => (e) =>
    setFlujo((f) => ({
      ...f,
      [campo]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));
  const pasos = flujo.pasos;
  const cambiarPasos = (nuevos) => setFlujo((f) => ({ ...f, pasos: nuevos }));
  const enfocar = (id) =>
    requestAnimationFrame(() => document.getElementById(id)?.focus());

  function mover(i, delta, boton) {
    const j = i + delta;
    if (j < 0 || j >= pasos.length) return;
    const nuevos = [...pasos];
    [nuevos[i], nuevos[j]] = [nuevos[j], nuevos[i]];
    cambiarPasos(nuevos);
    // Los errores van por posición: tras mover, ya no corresponden.
    setErrores((e) => ({ ...e, pasos: {} }));
    const paso = pasos[i];
    setAnuncio(`«${paso.nombre || "Paso"}» ahora es el paso ${j + 1}.`);
    // El foco sigue al paso que se movió; si llegó al extremo, al otro botón.
    const extremo = j === 0 || j === pasos.length - 1;
    const otro = boton === "subir" ? "bajar" : "subir";
    enfocar(`paso-${paso._k}-${extremo ? otro : boton}`);
  }

  function quitarPaso(i) {
    const vecino = pasos[i + 1] ?? pasos[i - 1];
    setAnuncio(`Se quitó el paso «${pasos[i].nombre || i + 1}».`);
    cambiarPasos(pasos.filter((_, j) => j !== i));
    setErrores((e) => ({ ...e, pasos: {} }));
    if (vecino) enfocar(`paso-${vecino._k}-nombre`);
  }

  function agregarPaso() {
    const nuevo = {
      _k: nuevaClave(),
      nombre: `Paso ${pasos.length + 1}`,
      aprobadores: [{ tipo: "persona", _k: nuevaClave() }],
    };
    cambiarPasos([...pasos, nuevo]);
    setAnuncio(
      `Se agregó el paso ${pasos.length + 1}: elija quién lo aprueba.`,
    );
    enfocar(`paso-${nuevo._k}-nombre`);
  }

  async function guardar(evento) {
    evento.preventDefault();
    setErrores(VACIO_DE_ERRORES);
    // Lo que se puede saber sin ir al servidor, antes de enviar.
    const propios = validar(flujo);
    if (propios.mensajes.length) {
      setErrores(propios);
      enfocarPrimerError(formulario.current);
      return;
    }
    setGuardando(true);
    try {
      await onGuardado(paraEnviar(flujo));
    } catch (err) {
      setErrores(erroresDelServidor(err));
      setGuardando(false);
      enfocarPrimerError(formulario.current);
    }
  }

  const titulo = editando
    ? `Editar «${inicial.nombre}»`
    : "Nuevo tipo de permiso";

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
        aria-labelledby="flujo-editor-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="flujo-editor-titulo">{titulo}</h3>
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
          id="flujo-form"
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
                Siguen en su paso; los cambios de aprobadores valen para los
                pasos que empiecen desde ahora, y un paso con solicitudes en
                curso no se puede quitar hasta que terminen.
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

          <section aria-labelledby="flujo-datos" className="flujo-bloque">
            <h4 id="flujo-datos" className="flujo-seccion">
              Datos del permiso
            </h4>
            <LeyendaObligatorios />
            <div className="row g-2">
              <Campo
                id="flujo-nombre"
                etiqueta="Nombre del permiso"
                obligatorio
                error={errores.campos.nombre}
                className="col-12 col-md-6"
              >
                <input
                  className="form-control form-control-sm"
                  maxLength={120}
                  placeholder="Ej.: Permiso por calamidad doméstica"
                  value={flujo.nombre}
                  onChange={fijar("nombre")}
                />
              </Campo>
              <Campo
                id="flujo-adjunto"
                etiqueta="Documento de respaldo"
                error={errores.campos.adjunto}
                className="col-12 col-md-6"
              >
                <select
                  className="form-select form-select-sm"
                  value={flujo.adjunto}
                  onChange={fijar("adjunto")}
                >
                  {ADJUNTOS.map(([id, nombre]) => (
                    <option key={id} value={id}>
                      {nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo
                id="flujo-descripcion"
                etiqueta="Descripción (la ve quien solicita)"
                error={errores.campos.descripcion}
                className="col-12"
              >
                <input
                  className="form-control form-control-sm"
                  value={flujo.descripcion}
                  onChange={fijar("descripcion")}
                />
              </Campo>
              <div className="col-12">
                <label className="form-check">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={flujo.activo}
                    onChange={fijar("activo")}
                  />{" "}
                  <span className="form-check-label">
                    Activo (se puede solicitar)
                  </span>
                </label>
                <label className="form-check">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={flujo.pide_motivo !== false}
                    onChange={fijar("pide_motivo")}
                  />{" "}
                  <span className="form-check-label">
                    Pide un motivo a quien solicita
                  </span>
                </label>
              </div>
            </div>
          </section>

          <section
            aria-labelledby="flujo-restricciones"
            className="flujo-bloque"
          >
            <h4 id="flujo-restricciones" className="flujo-seccion">
              Restricciones
            </h4>
            <p className="mz-faint mz-small mb-2">
              Quien solicita las ve al elegir las fechas, con si las cumple. Los
              mínimos y máximos no dejan enviar la solicitud; 0 es sin
              restricción.
            </p>
            <div className="row g-2">
              <Campo
                id="flujo-minimo"
                etiqueta="Mínimo de días seguidos"
                error={errores.campos.dias_minimos}
                className="col-6 col-md-3"
              >
                <input
                  type="number"
                  min={0}
                  className="form-control form-control-sm"
                  value={flujo.dias_minimos ?? 0}
                  onChange={fijar("dias_minimos")}
                />
              </Campo>
              <Campo
                id="flujo-maximo"
                etiqueta="Máximo de días seguidos"
                error={errores.campos.dias_maximos}
                className="col-6 col-md-3"
              >
                <input
                  type="number"
                  min={0}
                  className="form-control form-control-sm"
                  value={flujo.dias_maximos ?? 0}
                  onChange={fijar("dias_maximos")}
                />
              </Campo>
              <div className="col-12 col-md-6 d-flex align-items-end">
                <label className="form-check mb-1">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={Boolean(flujo.descuenta_vacaciones)}
                    onChange={fijar("descuenta_vacaciones")}
                  />{" "}
                  <span className="form-check-label">
                    Se descuenta de las vacaciones pendientes
                  </span>
                </label>
              </div>
              {flujo.descuenta_vacaciones && (
                <>
                  <Campo
                    id="flujo-sabados"
                    etiqueta="Sábados por período"
                    error={errores.campos.sabados_por_periodo}
                    className="col-6 col-md-3"
                  >
                    <input
                      type="number"
                      min={0}
                      className="form-control form-control-sm"
                      value={flujo.sabados_por_periodo ?? 0}
                      onChange={fijar("sabados_por_periodo")}
                    />
                  </Campo>
                  <Campo
                    id="flujo-domingos"
                    etiqueta="Domingos por período"
                    error={errores.campos.domingos_por_periodo}
                    className="col-6 col-md-3"
                  >
                    <input
                      type="number"
                      min={0}
                      className="form-control form-control-sm"
                      value={flujo.domingos_por_periodo ?? 0}
                      onChange={fijar("domingos_por_periodo")}
                    />
                  </Campo>
                  <p className="col-12 col-md-6 mz-faint mz-small mb-0 align-self-end">
                    De cada período anual deben salir al menos esos sábados y
                    domingos. Si al completarse el período faltan, se marcan por
                    defecto los siguientes a la solicitud.
                  </p>
                </>
              )}
              <Campo
                id="flujo-indicaciones"
                etiqueta="Otras indicaciones (una por línea; solo se informan)"
                error={errores.campos.restricciones}
                className="col-12"
              >
                <textarea
                  rows={2}
                  className="form-control form-control-sm"
                  placeholder="Ej.: Pídalas con 15 días de anticipación."
                  value={flujo.restricciones ?? ""}
                  onChange={fijar("restricciones")}
                />
              </Campo>
            </div>
          </section>

          <section aria-labelledby="flujo-pasos" className="flujo-bloque">
            <h4 id="flujo-pasos" className="flujo-seccion">
              Pasos de aprobación, en orden
            </h4>
            <p className="mz-faint mz-small mb-2">
              Cada paso lo aprueba cualquiera de sus aprobadores; aprobado, pasa
              al siguiente. Si alguno lo rechaza, la solicitud termina.
            </p>
            {!opciones && !errorOpciones && (
              <p className="mz-faint mz-small" role="status">
                Cargando personas, roles y cargos…
              </p>
            )}
            <ol className="flujo-pasos">
              {pasos.map((paso, i) => {
                const error = errores.pasos[i] ?? {};
                const idNombre = `paso-${paso._k}-nombre`;
                return (
                  <li key={paso._k} className="flujo-paso">
                    <div className="flujo-paso__cabecera">
                      <span className="flujo-paso__numero" aria-hidden="true">
                        {i + 1}
                      </span>
                      <input
                        id={idNombre}
                        aria-label={`Nombre del paso ${i + 1}`}
                        className={`form-control form-control-sm${error.nombre ? " is-invalid" : ""}`}
                        aria-invalid={error.nombre ? true : undefined}
                        aria-describedby={
                          error.nombre ? `${idNombre}-error` : undefined
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
                      <button
                        type="button"
                        id={`paso-${paso._k}-subir`}
                        className={`btn btn-outline-secondary btn-sm${i === 0 ? " invisible" : ""}`}
                        aria-label={`Subir el paso ${i + 1}`}
                        aria-hidden={i === 0 ? true : undefined}
                        tabIndex={i === 0 ? -1 : undefined}
                        onClick={() => mover(i, -1, "subir")}
                      >
                        <Icon name="arrow-up" />
                      </button>
                      <button
                        type="button"
                        id={`paso-${paso._k}-bajar`}
                        className={`btn btn-outline-secondary btn-sm${i === pasos.length - 1 ? " invisible" : ""}`}
                        aria-label={`Bajar el paso ${i + 1}`}
                        aria-hidden={i === pasos.length - 1 ? true : undefined}
                        tabIndex={i === pasos.length - 1 ? -1 : undefined}
                        onClick={() => mover(i, 1, "bajar")}
                      >
                        <Icon name="arrow-down" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        aria-label={`Quitar el paso ${i + 1}`}
                        disabled={pasos.length === 1}
                        title={
                          pasos.length === 1
                            ? "Un tipo de permiso necesita al menos un paso."
                            : undefined
                        }
                        onClick={() => quitarPaso(i)}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                    {error.nombre && (
                      <small
                        id={`${idNombre}-error`}
                        className="invalid-feedback d-block"
                      >
                        {error.nombre}
                      </small>
                    )}
                    <span
                      id={`paso-${paso._k}-aprueba`}
                      className="mz-small mz-faint"
                    >
                      Paso {i + 1}: lo aprueba cualquiera de:
                    </span>
                    <ListaDeDestinos
                      idBase={`paso-${paso._k}-aprobador`}
                      grupoId={`paso-${paso._k}-aprueba`}
                      conector="o"
                      prefijo={`aprobador del paso ${i + 1}`}
                      etiquetaAgregar={`Agregar aprobador al paso ${i + 1}`}
                      lista={paso.aprobadores}
                      tipos={DESTINOS_APROBADOR}
                      opciones={opciones}
                      minimo={1}
                      vacio="Agregue al menos un aprobador."
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
              onClick={agregarPaso}
            >
              <Icon name="plus-lg" /> Agregar paso
            </button>
          </section>

          <section aria-labelledby="flujo-avisos" className="flujo-bloque">
            <h4 id="flujo-avisos" className="flujo-seccion">
              A quién se avisa el resultado
            </h4>
            <p className="mz-faint mz-small mb-2">
              Al terminar la solicitud, reciben el aviso en la campana{" "}
              <strong>todos</strong> los de la lista que corresponda.
            </p>
            <div className="flujo-avisos">
              {[
                [
                  "avisos_aprobada",
                  "aprobada",
                  "check-circle",
                  "Si se aprueba",
                ],
                ["avisos_rechazada", "rechazada", "x-circle", "Si se rechaza"],
              ].map(([clave, resultado, icono, cuando]) => (
                <div
                  key={clave}
                  className={`flujo-avisos__caja flujo-avisos__caja--${resultado}`}
                >
                  <strong
                    id={`flujo-${clave}`}
                    className="flujo-avisos__titulo"
                  >
                    <Icon name={icono} /> {cuando}, se avisa a:
                  </strong>
                  <ListaDeDestinos
                    idBase={`flujo-${clave}-destino`}
                    grupoId={`flujo-${clave}`}
                    prefijo={`aviso ${cuando.toLowerCase()}`}
                    etiquetaAgregar={`Agregar a quién avisar ${cuando.toLowerCase()}`}
                    lista={flujo[clave]}
                    tipos={DESTINOS_AVISO}
                    opciones={opciones}
                    vacio="Nadie recibe aviso."
                    errores={errores.avisos[clave]?.destinos}
                    anunciar={setAnuncio}
                    onCambio={(avisos) =>
                      setFlujo((f) => ({ ...f, [clave]: avisos }))
                    }
                  />
                </div>
              ))}
            </div>
          </section>

          <ResumenDeRuta flujo={flujo} opciones={opciones} />
        </form>
        {/* Fijo abajo: en un formulario tan largo, guardar o cancelar sin
            bajar hasta el final. */}
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
            form="flujo-form"
            className="btn btn-primary btn-sm"
            disabled={guardando}
          >
            {guardando
              ? "Guardando…"
              : editando
                ? "Guardar cambios"
                : "Crear tipo de permiso"}
          </button>
        </div>
      </div>
    </div>
  );
}

const NOMBRE_ADJUNTO = Object.fromEntries(ADJUNTOS);

/** Las restricciones de un tipo, en pocas palabras, para su tarjeta. */
function resumenDeRestricciones(f) {
  return [
    f.dias_minimos ? `Mín. ${f.dias_minimos} días` : null,
    f.dias_maximos ? `Máx. ${f.dias_maximos} días` : null,
    f.descuenta_vacaciones ? "Descuenta vacaciones" : null,
    f.adjunto !== "no" ? NOMBRE_ADJUNTO[f.adjunto] : null,
  ].filter(Boolean);
}

/**
 * Solicitud de permisos → Configurar tipos de permiso (pide
 * `licencias.configurar`): los tipos de permiso, cada uno con sus pasos de
 * aprobación (quién aprueba cada uno) y a quién se avisa el resultado según
 * se apruebe o se rechace.
 */
export function FlujosPermisoPage() {
  const [flujos, setFlujos] = useState(null);
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
    return licenciasService
      .flujos()
      .then(setFlujos)
      .catch((err) =>
        setErrorCarga(
          mensajeDeError(err, "No se pudieron cargar los tipos de permiso."),
        ),
      );
  }, []);

  // Sin las opciones no se pueden elegir aprobadores: el aviso va dentro del
  // editor (antes quedaba tapado detrás de la ventana), con «Reintentar».
  const cargarOpciones = useCallback(() => {
    setErrorOpciones(null);
    licenciasService
      .opciones()
      .then(setOpciones)
      .catch((err) =>
        setErrorOpciones(
          mensajeDeError(
            err,
            "No se pudieron cargar las personas, roles y cargos para elegir aprobadores.",
          ),
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
    cargarOpciones();
  }, [cargar, cargarOpciones]);

  async function guardar(datos) {
    await licenciasService.guardarFlujo(editando.id, datos);
    setAviso(
      editando.id
        ? `Tipo de permiso «${datos.nombre}» actualizado.`
        : `Tipo de permiso «${datos.nombre}» creado.`,
    );
    setEditando(null);
    await cargar();
  }

  async function borrar(flujo) {
    if (
      !(await confirmar({
        titulo: `¿Borrar el tipo de permiso «${flujo.nombre}»?`,
        mensaje: "No tiene solicitudes. Se borra con sus pasos y avisos.",
        accion: "Borrar",
      }))
    )
      return;
    setError(null);
    setAviso(null);
    try {
      await licenciasService.eliminarFlujo(flujo.id);
      setAviso(`«${flujo.nombre}» se borró.`);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo borrar."));
    }
  }

  /** Con solicitudes no se borra: se desactiva (o se vuelve a activar). */
  async function cambiarActivo(flujo) {
    const activar = !flujo.activo;
    if (
      !activar &&
      !(await confirmar({
        titulo: `¿Desactivar «${flujo.nombre}»?`,
        mensaje:
          "Ya no se podrá solicitar. Las solicitudes que tiene se conservan y las que están en curso siguen su aprobación.",
        accion: "Desactivar",
        peligro: false,
      }))
    )
      return;
    setError(null);
    setAviso(null);
    try {
      await licenciasService.guardarFlujo(flujo.id, {
        ...paraEnviar(conClaves(flujo)),
        activo: activar,
      });
      setAviso(
        activar
          ? `«${flujo.nombre}» se activó: ya se puede solicitar.`
          : `«${flujo.nombre}» se desactivó.`,
      );
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo cambiar."));
    }
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Tipos de permiso</h2>
          <p className="mz-desc">
            Los tipos de permiso que se pueden solicitar, cómo se escala su
            aprobación y a quién se avisa el resultado.
          </p>
        </div>
        <div className="mz-actions">
          <Link
            to="/admin/institucional/permisos"
            className="btn btn-outline-secondary btn-sm"
          >
            <Icon name="arrow-left" /> Volver a las solicitudes
          </Link>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEditando({ ...NUEVO })}
          >
            <Icon name="plus-lg" /> Nuevo tipo de permiso
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
        cargando={flujos === null}
        error={errorCarga}
        onReintentar={cargar}
        vacio={flujos?.length === 0}
        textoVacio="Todavía no hay tipos de permiso."
      />
      <div className="flujos-lista">
        {(flujos ?? []).map((f) => {
          const resumen = resumenDeRestricciones(f);
          return (
            <section
              key={f.id}
              className={`flujo-tarjeta${f.activo ? "" : " flujo-tarjeta--inactivo"}`}
              aria-label={f.nombre}
            >
              <header className="flujo-tarjeta__cabecera">
                <div>
                  <strong>{f.nombre}</strong>
                  {!f.activo && <span className="mz-faint"> (inactivo)</span>}
                  {f.descripcion && <small>{f.descripcion}</small>}
                </div>
                <span className="flujo-tarjeta__acciones">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    aria-label={`Editar ${f.nombre}`}
                    onClick={() => setEditando(f)}
                  >
                    <Icon name="pencil" />
                  </button>
                  {f.tiene_solicitudes ? (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      aria-label={`${f.activo ? "Desactivar" : "Activar"} ${f.nombre}`}
                      title={
                        f.activo
                          ? "Tiene solicitudes: no se borra, se desactiva."
                          : "Volver a permitir que se solicite."
                      }
                      onClick={() => cambiarActivo(f)}
                    >
                      <Icon name={f.activo ? "pause-circle" : "play-circle"} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      aria-label={`Borrar ${f.nombre}`}
                      onClick={() => borrar(f)}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </span>
              </header>
              {(resumen.length > 0 || f.solicitudes_en_curso > 0) && (
                <div className="flujo-tarjeta__resumen">
                  {resumen.map((r) => (
                    <span key={r} className="mz-pill mz-pill--neutral">
                      {r}
                    </span>
                  ))}
                  {f.solicitudes_en_curso > 0 && (
                    <span className="mz-pill mz-pill--warn">
                      {f.solicitudes_en_curso} en curso
                    </span>
                  )}
                </div>
              )}
              <ol className="flujo-tarjeta__pasos">
                {f.pasos.map((p) => (
                  <li key={p.id}>
                    <strong>{p.nombre}</strong>
                    <span className="mz-faint mz-small">
                      {p.aprobadores.map((a) => a.descripcion).join(" o ")}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="flujo-tarjeta__avisos mz-small">
                <span>
                  <Icon name="check-circle" className="text-success" />{" "}
                  Aprobada:{" "}
                  {f.avisos_aprobada.map((a) => a.descripcion).join(", ") ||
                    "nadie"}
                </span>
                <span>
                  <Icon name="x-circle" className="text-danger" /> Rechazada:{" "}
                  {f.avisos_rechazada.map((a) => a.descripcion).join(", ") ||
                    "nadie"}
                </span>
              </div>
            </section>
          );
        })}
      </div>

      {editando && (
        <EditorFlujo
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
