/*
 * Los campos del formulario de «Soporte TI», como los configuró la empresa
 * (menú Mesa de ayuda → Formulario). Los pinta el formulario de verdad, el
 * alta interna y la vista previa del editor, así que lo que se ve al
 * configurar es lo que verá el empleado.
 *
 * Auditoría UX/UI (30/10/2026): sin las burbujas del navegador (una a la vez,
 * en «tú»); los obligatorios llevan «*», el error sale bajo su campo y la
 * ayuda está asociada al control. Quien pide puede describir primero y el
 * sistema le sugiere la categoría y el caso.
 */
import { useEffect, useState } from "react";

import { sugerirCasos } from "./sugerirCaso";

/** El formulario de siempre: lo que se muestra si el servidor no manda campos. */
export const CAMPOS_BASE = [
  ["nombre", "Nombre y apellido", "texto"],
  ["telefono", "Teléfono de contacto", "telefono"],
  ["correo", "Correo", "correo"],
  ["sede", "Agencia", "lista"],
  ["area", "Área", "lista"],
  ["categoria", "Categoría", "lista"],
  ["caso", "Caso de ayuda", "lista"],
  ["descripcion", "Describa el problema", "parrafo"],
  ["impacto", "¿A quién afecta?", "lista"],
  ["urgencia", "¿Puede seguir trabajando?", "lista"],
].map(([clave, etiqueta, tipo]) => ({
  clave,
  etiqueta,
  tipo,
  ayuda: "",
  opciones: [],
  obligatorio: true,
  base: true,
  categorias: [],
}));

const ANCHOS = new Set(["parrafo", "casilla", "correo"]);

/** Las respuestas de la matriz de prioridad, si el servidor no las manda. */
const IMPACTOS = [
  { id: "bajo", nombre: "Solo a mí" },
  { id: "medio", nombre: "A mi área o grupo de trabajo" },
  { id: "alto", nombre: "A toda la agencia, la sucursal o la empresa" },
];
const URGENCIAS = [
  { id: "alta", nombre: "No, la operación está detenida" },
  { id: "media", nombre: "Sí, pero con dificultad" },
  { id: "baja", nombre: "Sí, puede esperar" },
];

/* Cuando el equipo registra un ticket a nombre de otra persona, las
 * preguntas en primera persona («Solo a mí») no se entendían: «mí» era quien
 * llamaba, no quien escribía. */
const TERCERA_PERSONA = {
  etiquetas: {
    "¿Puede seguir trabajando?": "¿La persona puede seguir trabajando?",
  },
  impacto: {
    bajo: "Solo a la persona que lo reporta",
    medio: "A su área o grupo de trabajo",
    alto: "A toda la agencia, la sucursal o la empresa",
  },
  urgencia: {
    alta: "No, su operación está detenida",
    media: "Sí, pero con dificultad",
    baja: "Sí, puede esperar",
  },
};

/** El error de un campo vacío, en «usted» y diciendo qué hacer. */
const FALTA = {
  categoria: "Elija la categoría de su problema.",
  caso: "Elija el caso que mejor lo describe.",
  descripcion: "Cuéntenos qué pasa.",
  impacto: "Elija a quién afecta.",
  urgencia: "Elija si puede seguir trabajando.",
  sede: "Elija su agencia.",
  area: "Elija su área.",
};

/** Los obligatorios que faltan, clave → mensaje, de los campos a la vista. */
export function validarCampos(campos, valores, adicionales) {
  const errores = {};
  for (const campo of campos?.length ? campos : CAMPOS_BASE) {
    if (!campo.obligatorio || !aplica(campo, valores.categoria)) continue;
    const valor = campo.base
      ? valores[campo.clave]
      : adicionales?.[campo.clave];
    const vacio =
      valor === undefined ||
      valor === null ||
      valor === false ||
      String(valor).trim() === "";
    if (vacio)
      errores[campo.clave] =
        FALTA[campo.clave] ?? `Complete «${campo.etiqueta}».`;
  }
  return errores;
}

/** Si un campo propio aplica a la categoría elegida (sin filtro: siempre). */
export function aplica(campo, categoria) {
  if (campo.base || !campo.categorias?.length) return true;
  return campo.categorias.map(String).includes(String(categoria));
}

function textoDeAyuda(campo, porDefecto = "") {
  return campo.ayuda || porDefecto;
}

/** Lo que cada control lleva para el lector de pantalla y el error. */
function accesible({ campo, error, describe }) {
  return {
    "aria-required": campo.obligatorio || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describe || undefined,
  };
}

function Lista({
  id,
  valor,
  onCambiar,
  opciones,
  vacio,
  disabled,
  aria,
  invalido,
}) {
  return (
    <select
      id={id}
      className={`form-select${invalido ? " is-invalid" : ""}`}
      disabled={disabled}
      value={valor}
      onChange={(e) => onCambiar(e.target.value)}
      {...aria}
    >
      <option value="">{vacio}</option>
      {opciones.map(([v, etiqueta]) => (
        <option key={v} value={v}>
          {etiqueta}
        </option>
      ))}
    </select>
  );
}

/** El control de un campo del sistema: sus opciones salen de la empresa. */
function ControlBase({ campo, id, datos, valores, onBase, aria, tercera }) {
  const valor = valores[campo.clave] ?? "";
  const cambiar = (v) => onBase(campo.clave, v);
  const invalido = Boolean(aria["aria-invalid"]);
  const categoria = datos.categorias.find(
    (c) => String(c.id) === String(valores.categoria),
  );
  switch (campo.clave) {
    case "sede":
      return (
        <Lista
          id={id}
          campo={campo}
          aria={aria}
          invalido={invalido}
          valor={valor}
          onCambiar={cambiar}
          vacio="Elija su agencia"
          opciones={datos.agencias.map((a) => [a.id, a.nombre])}
        />
      );
    case "impacto":
    case "urgencia": {
      const propias =
        campo.clave === "impacto"
          ? (datos.impactos ?? IMPACTOS)
          : (datos.urgencias ?? URGENCIAS);
      const opciones = tercera
        ? propias.map((o) => ({
            ...o,
            nombre: TERCERA_PERSONA[campo.clave][o.id] ?? o.nombre,
          }))
        : propias;
      return (
        <Lista
          id={id}
          campo={campo}
          aria={aria}
          invalido={invalido}
          valor={valor}
          onCambiar={cambiar}
          vacio="Elija una opción"
          opciones={opciones.map((o) => [o.id, o.nombre])}
        />
      );
    }
    case "area":
      return (
        <Lista
          id={id}
          campo={campo}
          aria={aria}
          invalido={invalido}
          valor={valor}
          onCambiar={cambiar}
          vacio="Elija su área"
          opciones={datos.areas.map((a) => [a.id, a.nombre])}
        />
      );
    case "categoria":
      return (
        <Lista
          id={id}
          campo={campo}
          aria={aria}
          invalido={invalido}
          valor={valor}
          onCambiar={cambiar}
          vacio="Elija la categoría"
          opciones={datos.categorias.map((c) => [c.id, c.nombre])}
        />
      );
    case "caso": {
      const caso = categoria?.casos.find((c) => String(c.id) === String(valor));
      return (
        <>
          <Lista
            id={id}
            campo={campo}
            aria={aria}
            invalido={invalido}
            valor={valor}
            onCambiar={cambiar}
            disabled={!categoria}
            vacio={categoria ? "Elija el caso" : "Elija primero la categoría"}
            opciones={(categoria?.casos ?? []).map((c) => [c.id, c.nombre])}
          />
          {/* Sin «Prioridad: P1 · Crítica» (antes): la persona no sabe qué es
              «P1» y la prioridad final depende de lo que responda abajo. */}
          {caso?.tipo_display && (
            <div className="mz-small mz-faint mt-1">{caso.tipo_display}</div>
          )}
        </>
      );
    }
    case "descripcion":
      return (
        <textarea
          id={id}
          className={`form-control${invalido ? " is-invalid" : ""}`}
          rows={4}
          maxLength={5000}
          placeholder="Por ejemplo: «No puedo imprimir desde mi computadora, la impresora dice papel atascado»."
          value={valor}
          onChange={(e) => cambiar(e.target.value)}
          {...aria}
        />
      );
    default: {
      const tipos = { correo: "email", telefono: "tel" };
      return (
        <input
          id={id}
          type={tipos[campo.tipo] ?? "text"}
          className={`form-control${invalido ? " is-invalid" : ""}`}
          {...aria}
          maxLength={campo.clave === "nombre" ? 150 : undefined}
          autoComplete={
            { nombre: "name", telefono: "tel", correo: "email" }[campo.clave]
          }
          inputMode={campo.tipo === "telefono" ? "tel" : undefined}
          value={valor}
          onChange={(e) => cambiar(e.target.value)}
        />
      );
    }
  }
}

/** El control de un campo propio, según su tipo. */
export function ControlPropio({ campo, id, valor, onCambiar, aria: propio }) {
  const aria = {
    "aria-required": campo.obligatorio || undefined,
    ...propio,
  };
  const invalido = aria["aria-invalid"] ? " is-invalid" : "";
  const comun = {
    id,
    ...aria,
    onChange: (e) => onCambiar(e.target.value),
  };
  switch (campo.tipo) {
    case "parrafo":
      return (
        <textarea
          {...comun}
          className={`form-control${invalido}`}
          rows={3}
          maxLength={2000}
          value={valor ?? ""}
        />
      );
    case "lista":
      return (
        <select
          {...comun}
          className={`form-select${invalido}`}
          value={valor ?? ""}
        >
          <option value="">Elija una opción</option>
          {campo.opciones.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "casilla":
      return (
        <input
          id={id}
          type="checkbox"
          className={`form-check-input${invalido}`}
          {...aria}
          checked={Boolean(valor)}
          onChange={(e) => onCambiar(e.target.checked)}
        />
      );
    default: {
      const tipos = {
        numero: "number",
        fecha: "date",
        correo: "email",
        telefono: "tel",
      };
      return (
        <input
          {...comun}
          type={tipos[campo.tipo] ?? "text"}
          className={`form-control${invalido}`}
          step={campo.tipo === "numero" ? "any" : undefined}
          maxLength={campo.tipo === "texto" ? 200 : undefined}
          value={valor ?? ""}
        />
      );
    }
  }
}

/** «¿Es alguno de estos?»: los casos que se parecen a lo que escribió. */
function Sugerencias({ datos, valores, onBase }) {
  const descripcion = valores.descripcion ?? "";
  const corta = descripcion.trim().length < 12;
  const sugeridas = corta ? [] : sugerirCasos(descripcion, datos.categorias);
  // Al lector de pantalla, solo un resumen y cuando deja de escribir (antes
  // se le leía la lista entera con cada tecla).
  const resumen = corta
    ? ""
    : sugeridas.length
      ? `${sugeridas.length} ${sugeridas.length === 1 ? "caso sugerido" : "casos sugeridos"} bajo la descripción.`
      : "Sin casos sugeridos.";
  const [anuncio, setAnuncio] = useState("");
  useEffect(() => {
    const espera = setTimeout(() => setAnuncio(resumen), 600);
    return () => clearTimeout(espera);
  }, [resumen]);
  const elegida = (s) =>
    String(s.caso.id) === String(valores.caso) &&
    String(s.categoria.id) === String(valores.categoria);
  return (
    <div className="col-12">
      <span className="visually-hidden" aria-live="polite">
        {anuncio}
      </span>
      {!corta && (
        <div className="soporte-sugeridos">
          {sugeridas.length === 0 ? (
            <p className="mz-small mz-faint mb-0">
              No encontramos un caso parecido: elija la categoría y el caso
              abajo.
            </p>
          ) : (
            <>
              <p className="mz-small mb-1">
                <strong>¿Es alguno de estos?</strong> Elija uno y se llena la
                categoría y el caso; puede cambiarlos abajo.
              </p>
              <div className="d-flex flex-wrap gap-2">
                {sugeridas.map((s) => (
                  <button
                    key={s.caso.id}
                    type="button"
                    className={`btn btn-sm ${elegida(s) ? "btn-primary" : "btn-outline-primary"}`}
                    aria-pressed={elegida(s)}
                    onClick={() => {
                      onBase("categoria", String(s.categoria.id));
                      onBase("caso", String(s.caso.id));
                    }}
                  >
                    {s.categoria.nombre} › {s.caso.nombre}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Con «describir primero», la descripción va antes de la categoría. */
function ordenar(campos, describirPrimero) {
  if (!describirPrimero) return campos;
  const descripcion = campos.find((c) => c.clave === "descripcion");
  const categoria = campos.findIndex((c) => c.clave === "categoria");
  if (!descripcion || categoria < 0) return campos;
  const resto = campos.filter((c) => c !== descripcion);
  const donde = resto.findIndex((c) => c.clave === "categoria");
  return [...resto.slice(0, donde), descripcion, ...resto.slice(donde)];
}

/**
 * Pinta los campos en su orden. `valores` son los del sistema y `adicionales`
 * los propios (clave → valor). Un campo propio limitado a ciertas categorías
 * aparece solo al elegir una de ellas.
 */
export function CamposFormulario({
  campos,
  datos,
  valores,
  onBase,
  adicionales,
  onAdicional,
  prefijo = "sp",
  errores = {},
  tercera = false,
  describirPrimero = false,
}) {
  const visibles = ordenar(
    (campos?.length ? campos : CAMPOS_BASE).filter((campo) =>
      aplica(campo, valores.categoria),
    ),
    describirPrimero,
  );
  return visibles.map((campo) => {
    const id = `${prefijo}-${campo.clave}`;
    const error = errores[campo.clave];
    const ayuda = textoDeAyuda(
      campo,
      campo.clave === "correo"
        ? "Aquí le llegan los avisos de su ticket."
        : campo.clave === "descripcion" && describirPrimero
          ? "Con sus palabras: qué pasa, desde cuándo y qué mensaje ve."
          : "",
    );
    const idAyuda = ayuda ? `${id}-ayuda` : null;
    const idError = error ? `${id}-error` : null;
    const aria = accesible({
      campo,
      error,
      describe: [idAyuda, idError].filter(Boolean).join(" "),
    });
    const etiqueta =
      (tercera && TERCERA_PERSONA.etiquetas[campo.etiqueta]) || campo.etiqueta;
    const pie = (
      <>
        {ayuda && (
          <div id={idAyuda} className="form-text">
            {ayuda}
          </div>
        )}
        {error && (
          <div id={idError} className="mz-field-error">
            {error}
          </div>
        )}
      </>
    );
    const marca = campo.obligatorio ? (
      <>
        <span className="mz-campo__obligatorio" aria-hidden="true">
          {" "}
          *
        </span>
        <span className="visually-hidden"> (obligatorio)</span>
      </>
    ) : (
      <span className="mz-faint fw-normal"> (opcional)</span>
    );
    if (!campo.base && campo.tipo === "casilla") {
      return (
        <div key={campo.clave} className="col-12">
          <div className="form-check">
            <ControlPropio
              campo={campo}
              id={id}
              aria={aria}
              valor={adicionales[campo.clave]}
              onCambiar={(v) => onAdicional(campo.clave, v)}
            />
            <label className="form-check-label" htmlFor={id}>
              {etiqueta}
              {marca}
            </label>
          </div>
          {pie}
        </div>
      );
    }
    const ancho =
      ANCHOS.has(campo.tipo) || campo.clave === "descripcion"
        ? "col-12"
        : "col-12 col-md-6";
    return [
      <div key={campo.clave} className={ancho}>
        <label className="form-label" htmlFor={id}>
          {etiqueta}
          {marca}
        </label>
        {campo.base ? (
          <ControlBase
            campo={campo}
            id={id}
            aria={aria}
            tercera={tercera}
            datos={datos}
            valores={valores}
            onBase={onBase}
          />
        ) : (
          <ControlPropio
            campo={campo}
            id={id}
            aria={aria}
            valor={adicionales[campo.clave]}
            onCambiar={(v) => onAdicional(campo.clave, v)}
          />
        )}
        {pie}
      </div>,
      describirPrimero && campo.clave === "descripcion" && (
        <Sugerencias
          key="sugerencias"
          datos={datos}
          valores={valores}
          onBase={onBase}
        />
      ),
    ];
  });
}
