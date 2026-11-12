/*
 * Crear o editar una causa con sus niveles ordenados (`llamados.configurar`).
 * Cada nivel lleva su tipo, si envía correo, si copia al jefe, el monto
 * sugerido (solo en la sanción económica) y la plantilla del correo con
 * variables. La vista previa pinta la plantilla con datos de ejemplo como
 * **texto** (nunca como HTML). Un nivel ya usado no se quita: se desactiva.
 */
import { useEffect, useRef, useState } from "react";

import { llamadosService } from "../../../api/llamadosService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import {
  erroresPorCampo,
  hayErroresGenerales,
  mensajeDeError,
} from "../../../utils/errores";
import { ErrorEnLinea } from "../comunes";
import {
  SANCION,
  TIPOS,
  claveDeVariable,
  conEjemplos,
  montoANumero,
  renderPlantilla,
} from "./llamadosComunes";

let contador = 0;
const nuevaClave = () => {
  contador += 1;
  return `nuevo-${contador}`;
};

function nivelVacio() {
  return {
    clave: nuevaClave(),
    id: null,
    nombre: "",
    tipo: "escrito",
    envia_correo: false,
    copia_jefe: false,
    monto_sugerido: "",
    asunto: "",
    cuerpo: "",
    activo: true,
    en_uso: false,
  };
}

function desdeServidor(n) {
  return {
    clave: `n-${n.id}`,
    id: n.id,
    nombre: n.nombre ?? "",
    tipo: n.tipo ?? "escrito",
    envia_correo: Boolean(n.envia_correo),
    copia_jefe: Boolean(n.copia_jefe ?? n.copia_jefe_inmediato),
    monto_sugerido:
      n.monto_sugerido === null || n.monto_sugerido === undefined
        ? ""
        : String(n.monto_sugerido),
    asunto: n.asunto ?? "",
    cuerpo: n.cuerpo ?? "",
    activo: n.activo !== false,
    en_uso: Boolean(n.en_uso ?? n.usado),
  };
}

/**
 * La vista previa de la plantilla: la renderiza el servidor (`vista-previa/`,
 * que entiende las secciones como `{{#monto}}`) con datos de ejemplo, y avisa
 * de las variables que no existen. Se pinta el **texto**, nunca el HTML. Si el
 * servidor no responde, se usa el mismo cálculo en el navegador.
 */
function VistaPrevia({ asunto, cuerpo, variables }) {
  const [datos, setDatos] = useState(null);
  const [respaldo, setRespaldo] = useState(false);

  useEffect(() => {
    let vigente = true;
    const pausa = setTimeout(() => {
      llamadosService
        .vistaPrevia(asunto, cuerpo)
        .then((respuesta) => {
          if (!vigente) return;
          setRespaldo(false);
          setDatos({
            asunto: respuesta.asunto ?? respuesta.asunto_texto,
            texto: respuesta.texto ?? "",
            desconocidas: respuesta.desconocidas ?? [],
          });
        })
        .catch(() => {
          if (!vigente) return;
          setRespaldo(true);
          const a = renderPlantilla(asunto, {});
          const c = renderPlantilla(cuerpo, {});
          setDatos({
            asunto: conEjemplos(asunto, variables),
            texto: conEjemplos(cuerpo, variables),
            desconocidas: [
              ...new Set([...a.desconocidas, ...c.desconocidas]),
            ].filter((d) => !variables.some((v) => claveDeVariable(v) === d)),
          });
        });
    }, 300);
    return () => {
      vigente = false;
      clearTimeout(pausa);
    };
  }, [asunto, cuerpo, variables]);

  return (
    <div
      className="mz-card p-3"
      role="region"
      aria-label="Vista previa del correo con datos de ejemplo"
    >
      <p className="mz-small mz-faint">
        Datos de ejemplo
        {respaldo && " (calculada en su equipo: el servidor no respondió)"}
      </p>
      {datos === null ? (
        <p className="mz-faint mb-0" role="status">
          Preparando la vista previa…
        </p>
      ) : (
        <>
          <p className="mb-2">
            <strong>Asunto:</strong>{" "}
            {datos.asunto ?? conEjemplos(asunto, variables)}
          </p>
          <p className="mb-0" style={{ whiteSpace: "pre-wrap" }}>
            {datos.texto}
          </p>
          {datos.desconocidas.length > 0 && variables.length > 0 && (
            <p className="mz-alert mz-alert--warn mt-2 mb-0" role="status">
              <Icon name="exclamation-triangle" />
              <span>
                Variables desconocidas, que no se reemplazarán:{" "}
                {datos.desconocidas.map((d) => `{${d}}`).join(", ")}.
              </span>
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Los campos de un solo nivel, con su editor de plantilla. */
function EditorDeNivel({
  indice,
  total,
  nivel,
  variables,
  errores,
  deshabilitado,
  ordenBloqueado,
  onCambio,
  onMover,
  onQuitar,
}) {
  const p = `nivel-${nivel.clave}`;
  const asunto = useRef(null);
  const cuerpo = useRef(null);
  const [destino, setDestino] = useState("cuerpo");
  const [verPrevia, setVerPrevia] = useState(false);

  /** Inserta `{variable}` donde está el cursor del campo que se editó último. */
  function insertar(clave) {
    const campo = destino === "asunto" ? asunto.current : cuerpo.current;
    const texto = `{${clave}}`;
    const actual = nivel[destino];
    const inicio = campo?.selectionStart ?? actual.length;
    const fin = campo?.selectionEnd ?? actual.length;
    onCambio({
      [destino]: actual.slice(0, inicio) + texto + actual.slice(fin),
    });
    // El cursor queda tras la variable y el foco vuelve al campo.
    requestAnimationFrame(() => {
      if (!campo) return;
      campo.focus();
      campo.setSelectionRange(inicio + texto.length, inicio + texto.length);
    });
  }

  return (
    <fieldset className="mz-card p-3 mz-stack" disabled={deshabilitado}>
      <legend className="h6 float-none w-auto px-1 mb-0">
        Nivel {indice + 1}
        {nivel.activo === false && (
          <span className="mz-pill mz-pill--neutral ms-2">Desactivado</span>
        )}
      </legend>
      <div className="d-flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm mz-tactil"
          id={`${p}-subir`}
          onClick={() => onMover(-1)}
          disabled={indice === 0 || ordenBloqueado}
        >
          <Icon name="arrow-up" /> Subir
          <span className="visually-hidden"> el nivel {indice + 1}</span>
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm mz-tactil"
          id={`${p}-bajar`}
          onClick={() => onMover(1)}
          disabled={indice === total - 1 || ordenBloqueado}
        >
          <Icon name="arrow-down" /> Bajar
          <span className="visually-hidden"> el nivel {indice + 1}</span>
        </button>
        {!nivel.en_uso && (
          <button
            type="button"
            className="btn btn-outline-danger btn-sm mz-tactil"
            onClick={onQuitar}
          >
            <Icon name="trash" /> Quitar
            <span className="visually-hidden"> el nivel {indice + 1}</span>
          </button>
        )}
      </div>
      {nivel.en_uso && (
        <p className="mz-small mz-faint mb-0">
          Este nivel ya se usó en llamados: no se puede quitar, solo desactivar.
        </p>
      )}
      {ordenBloqueado && indice === 0 && (
        <p className="mz-small mz-faint mb-0">
          El orden no se puede cambiar mientras algún nivel esté en uso: los
          llamados ya emitidos dependen de él.
        </p>
      )}
      <Campo
        id={`${p}-nombre`}
        etiqueta="Nombre del nivel"
        obligatorio
        error={errores.nombre}
      >
        <input
          className="form-control"
          value={nivel.nombre}
          maxLength={120}
          placeholder="Primer llamado (verbal)"
          onChange={(e) => onCambio({ nombre: e.target.value })}
        />
      </Campo>
      <Campo id={`${p}-tipo`} etiqueta="Tipo" obligatorio error={errores.tipo}>
        <select
          className="form-select"
          value={nivel.tipo}
          onChange={(e) => onCambio({ tipo: e.target.value })}
        >
          {Object.entries(TIPOS).map(([valor, texto]) => (
            <option key={valor} value={valor}>
              {texto}
            </option>
          ))}
        </select>
      </Campo>
      {nivel.tipo === SANCION && (
        <Campo
          id={`${p}-monto`}
          etiqueta="Monto sugerido (USD)"
          error={errores.monto_sugerido}
          ayuda="Al emitir, Gestión Humana parte de este monto y lo puede cambiar."
        >
          <input
            className="form-control"
            inputMode="decimal"
            value={nivel.monto_sugerido}
            onChange={(e) => onCambio({ monto_sugerido: e.target.value })}
          />
        </Campo>
      )}
      <div className="form-check">
        <input
          id={`${p}-correo`}
          type="checkbox"
          className="form-check-input"
          checked={nivel.envia_correo}
          onChange={(e) => onCambio({ envia_correo: e.target.checked })}
        />
        <label className="form-check-label" htmlFor={`${p}-correo`}>
          Envía correo a la persona
        </label>
      </div>
      {nivel.envia_correo && (
        <>
          <div className="form-check">
            <input
              id={`${p}-copia`}
              type="checkbox"
              className="form-check-input"
              checked={nivel.copia_jefe}
              onChange={(e) => onCambio({ copia_jefe: e.target.checked })}
            />
            <label className="form-check-label" htmlFor={`${p}-copia`}>
              Con copia al jefe inmediato
            </label>
          </div>
          <Campo
            id={`${p}-asunto`}
            etiqueta="Asunto del correo"
            obligatorio
            error={errores.asunto}
          >
            <input
              ref={asunto}
              className="form-control"
              value={nivel.asunto}
              onFocus={() => setDestino("asunto")}
              onChange={(e) => onCambio({ asunto: e.target.value })}
            />
          </Campo>
          <Campo
            id={`${p}-cuerpo`}
            etiqueta="Cuerpo del correo"
            obligatorio
            error={errores.cuerpo}
            ayuda="Es texto: no admite HTML. Pulse una variable para insertarla donde está el cursor."
          >
            <textarea
              ref={cuerpo}
              className="form-control"
              rows={6}
              value={nivel.cuerpo}
              onFocus={() => setDestino("cuerpo")}
              onChange={(e) => onCambio({ cuerpo: e.target.value })}
            />
          </Campo>
          <fieldset className="mz-stack">
            <legend className="form-label mb-1">Insertar variable en</legend>
            <div className="d-flex gap-3">
              {[
                ["asunto", "Asunto"],
                ["cuerpo", "Cuerpo"],
              ].map(([valor, texto]) => (
                <div className="form-check" key={valor}>
                  <input
                    id={`${p}-destino-${valor}`}
                    type="radio"
                    name={`${p}-destino`}
                    className="form-check-input"
                    checked={destino === valor}
                    onChange={() => setDestino(valor)}
                  />
                  <label
                    className="form-check-label"
                    htmlFor={`${p}-destino-${valor}`}
                  >
                    {texto}
                  </label>
                </div>
              ))}
            </div>
            <div
              role="group"
              aria-label={`Variables del nivel ${indice + 1}`}
              className="d-flex flex-wrap gap-1"
            >
              {variables.map((v) => {
                const clave = claveDeVariable(v);
                return (
                  <button
                    key={clave}
                    type="button"
                    className="btn btn-outline-secondary btn-sm mz-tactil"
                    aria-describedby={`${p}-var-${clave}`}
                    onClick={() => insertar(clave)}
                  >
                    {`{${clave}}`}
                  </button>
                );
              })}
            </div>
            <ul className="mz-small mz-faint mb-0 ps-3">
              {variables.map((v) => {
                const clave = claveDeVariable(v);
                return (
                  <li key={clave} id={`${p}-var-${clave}`}>
                    <code>{`{${clave}}`}</code>
                    {typeof v === "object" && v.descripcion
                      ? `: ${v.descripcion}`
                      : ""}
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm mz-tactil"
              aria-expanded={verPrevia}
              onClick={() => setVerPrevia((v) => !v)}
            >
              <Icon name="eye" /> {verPrevia ? "Ocultar" : "Ver"} vista previa
            </button>
          </div>
          {verPrevia && (
            <VistaPrevia
              asunto={nivel.asunto}
              cuerpo={nivel.cuerpo}
              variables={variables}
            />
          )}
        </>
      )}
      {nivel.id !== null && (
        <div className="form-check">
          <input
            id={`${p}-activo`}
            type="checkbox"
            className="form-check-input"
            checked={nivel.activo}
            onChange={(e) => onCambio({ activo: e.target.checked })}
          />
          <label className="form-check-label" htmlFor={`${p}-activo`}>
            Nivel activo
          </label>
        </div>
      )}
    </fieldset>
  );
}

export function FormularioCausa({ causa, variables, onCerrar, onGuardado }) {
  const editando = Boolean(causa);
  const [nombre, setNombre] = useState(causa?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(causa?.descripcion ?? "");
  const [plazo, setPlazo] = useState(
    String(causa?.plazo_reincidencia_meses ?? causa?.plazo_reincidencia ?? 12),
  );
  const [activa, setActiva] = useState(causa?.activa !== false);
  const [niveles, setNiveles] = useState(() =>
    [...(causa?.niveles ?? [])]
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      .map(desdeServidor),
  );
  const [errores, setErrores] = useState({});
  const [erroresNivel, setErroresNivel] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [modificado, setModificado] = useState(false);
  const [anuncio, setAnuncio] = useState("");
  const contenedor = useRef(null);
  const titulo = useRef(null);
  // Con un nivel ya usado, el orden se congela: reordenar cambiaría el
  // «siguiente nivel» de los llamados que ya existen.
  const ordenBloqueado = niveles.some((n) => n.en_uso);

  function cambiarNivel(clave, cambios) {
    setNiveles((lista) =>
      lista.map((n) => (n.clave === clave ? { ...n, ...cambios } : n)),
    );
  }
  function mover(indice, delta) {
    setNiveles((lista) => {
      const copia = [...lista];
      const destino = indice + delta;
      if (destino < 0 || destino >= copia.length) return lista;
      [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
      return copia;
    });
    setModificado(true);
    // En el extremo, el botón que se pulsó queda deshabilitado: el foco pasa
    // al contrario para seguir moviendo o deshacer.
    const destinoFinal = indice + delta;
    if (destinoFinal === 0 || destinoFinal === niveles.length - 1) {
      const clave = niveles[indice].clave;
      const contrario = delta < 0 ? "bajar" : "subir";
      requestAnimationFrame(() =>
        contenedor.current
          ?.querySelector(`#nivel-${clave}-${contrario}`)
          ?.focus(),
      );
    }
    setAnuncio(
      `El nivel «${niveles[indice].nombre || indice + 1}» ahora es el número ${indice + delta + 1} de ${niveles.length}.`,
    );
  }
  function quitar(clave) {
    setNiveles((lista) => lista.filter((x) => x.clave !== clave));
    setModificado(true);
    // El botón desaparece: el foco va al título de la lista de niveles.
    requestAnimationFrame(() => titulo.current?.focus());
  }

  function validar() {
    const propios = {};
    const porNivel = {};
    if (!nombre.trim()) propios.nombre = "Indique el nombre de la causa.";
    const meses = Number(plazo);
    if (!Number.isInteger(meses) || meses < 1 || meses > 120) {
      propios.plazo_reincidencia_meses = "Indique los meses, de 1 a 120.";
    }
    if (!niveles.length) propios.niveles = "Agregue al menos un nivel.";
    niveles.forEach((n) => {
      const e = {};
      if (!n.nombre.trim()) e.nombre = "Indique el nombre del nivel.";
      if (n.envia_correo && !n.asunto.trim()) e.asunto = "Escriba el asunto.";
      if (n.envia_correo && !n.cuerpo.trim()) e.cuerpo = "Escriba el cuerpo.";
      if (
        n.tipo === SANCION &&
        n.monto_sugerido !== "" &&
        montoANumero(n.monto_sugerido) === null
      ) {
        e.monto_sugerido = "Indique un monto válido, por ejemplo 10,50.";
      }
      if (Object.keys(e).length) porNivel[n.clave] = e;
    });
    return { propios, porNivel };
  }

  async function enviar(evento) {
    evento.preventDefault();
    setError(null);
    const { propios, porNivel } = validar();
    setErrores(propios);
    setErroresNivel(porNivel);
    if (Object.keys(propios).length || Object.keys(porNivel).length) {
      enfocarPrimerError(contenedor.current);
      return;
    }
    const cuerpo = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim(),
      plazo_reincidencia_meses: Number(plazo),
      activa,
      niveles: niveles.map((n, i) => ({
        ...(n.id !== null ? { id: n.id } : {}),
        orden: i + 1,
        nombre: n.nombre.trim(),
        tipo: n.tipo,
        envia_correo: n.envia_correo,
        copia_jefe: n.envia_correo && n.copia_jefe,
        monto_sugerido:
          n.tipo === SANCION && n.monto_sugerido !== ""
            ? montoANumero(n.monto_sugerido)
            : null,
        // El texto se conserva aunque el nivel deje de enviar correo.
        asunto: n.asunto,
        cuerpo: n.cuerpo,
        activo: n.activo,
      })),
    };
    setGuardando(true);
    try {
      const guardada = editando
        ? await llamadosService.editarCausa(causa.id, cuerpo)
        : await llamadosService.crearCausa(cuerpo);
      onGuardado(guardada, editando);
    } catch (err) {
      const campos = erroresPorCampo(err);
      setErrores(campos);
      setError(
        hayErroresGenerales(err) || !Object.keys(campos).length
          ? mensajeDeError(err, "No se pudo guardar la causa.")
          : "Revise los campos marcados.",
      );
      enfocarPrimerError(contenedor.current);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ModalDialog
      titulo={editando ? "Editar causa" : "Nueva causa"}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Guardar"
      isSaving={guardando}
      sucio={modificado}
      noValidate
      anchoMaximo="48rem"
    >
      <div className="mz-stack" ref={contenedor}>
        <LeyendaObligatorios />
        {error && <ErrorEnLinea mensaje={error} />}
        <Campo
          id="causa-nombre"
          etiqueta="Nombre"
          obligatorio
          error={errores.nombre}
        >
          <input
            className="form-control"
            value={nombre}
            maxLength={200}
            data-autofocus
            onChange={(e) => setNombre(e.target.value)}
          />
        </Campo>
        <Campo
          id="causa-descripcion"
          etiqueta="Descripción"
          error={errores.descripcion}
        >
          <textarea
            className="form-control"
            rows={2}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </Campo>
        <Campo
          id="causa-plazo"
          etiqueta="Plazo de reincidencia (meses)"
          obligatorio
          error={errores.plazo_reincidencia_meses}
          ayuda="Un llamado cuenta para el siguiente nivel durante estos meses."
        >
          <input
            type="number"
            min={1}
            max={120}
            className="form-control"
            value={plazo}
            onChange={(e) => setPlazo(e.target.value)}
          />
        </Campo>
        <div className="form-check">
          <input
            id="causa-activa"
            type="checkbox"
            className="form-check-input"
            checked={activa}
            onChange={(e) => setActiva(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="causa-activa">
            Causa activa (se puede elegir al emitir o solicitar)
          </label>
        </div>

        <section aria-labelledby="causa-niveles-titulo" className="mz-stack">
          <h4
            id="causa-niveles-titulo"
            className="h6 mb-0"
            tabIndex={-1}
            ref={titulo}
          >
            Niveles, en orden de escalamiento
          </h4>
          <p className="visually-hidden" role="status">
            {anuncio}
          </p>
          {errores.niveles && (
            <p className="mz-field-error mb-0" role="alert">
              {errores.niveles}
            </p>
          )}
          {niveles.map((n, i) => (
            <EditorDeNivel
              key={n.clave}
              indice={i}
              total={niveles.length}
              nivel={n}
              variables={variables}
              errores={erroresNivel[n.clave] ?? {}}
              deshabilitado={guardando}
              ordenBloqueado={ordenBloqueado}
              onCambio={(cambios) => cambiarNivel(n.clave, cambios)}
              onMover={(d) => mover(i, d)}
              onQuitar={() => quitar(n.clave)}
            />
          ))}
          <div>
            <button
              type="button"
              className="btn btn-outline-secondary mz-tactil"
              disabled={guardando}
              onClick={() => {
                setNiveles((lista) => [...lista, nivelVacio()]);
                setModificado(true);
              }}
            >
              <Icon name="plus-lg" /> Agregar nivel
            </button>
          </div>
        </section>
      </div>
    </ModalDialog>
  );
}
