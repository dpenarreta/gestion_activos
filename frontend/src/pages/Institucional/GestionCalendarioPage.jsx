import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { institucionalService } from "../../api/institucionalService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { FilaDeEstado } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import {
  PanelDePestana,
  idDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { useModalA11y } from "../../hooks/useModalA11y";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import { TIPOS_DE_EVENTO, iso } from "./CalendarioInicio";
import "./Institucional.css";
import { confirmar } from "../../components/common/Confirmar/confirmar";

/** Agregar o editar una fecha del calendario, en una ventana. */
function FormularioEvento({ inicial, titulo, onGuardar, onCerrar }) {
  const [valores, setValores] = useState(inicial);
  const [error, setError] = useState(null);
  // Errores junto a su campo y foco al primero (auditoría UX/UI, fase 2,
  // 28/10/2026).
  const [errores, setErrores] = useState({});
  const formulario = useRef(null);
  const [guardando, setGuardando] = useState(false);
  const editando = Boolean(inicial.id);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const fijar = (campo) => (e) =>
    setValores((v) => {
      const valor =
        e.target.type === "checkbox" ? e.target.checked : e.target.value;
      const siguiente = { ...v, [campo]: valor };
      // Un cumpleaños se repite cada año: se propone al elegir el tipo.
      if (campo === "tipo" && valor === "cumpleanos")
        siguiente.cada_anio = true;
      return siguiente;
    });

  async function enviar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    setErrores({});
    try {
      await onGuardar({
        titulo: valores.titulo,
        tipo: valores.tipo,
        fecha: valores.fecha,
        fecha_fin: valores.fecha_fin || null,
        descripcion: valores.descripcion,
        cada_anio: valores.cada_anio,
      });
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
      setErrores(erroresPorCampo(err));
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
        className="mz-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evento-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="evento-titulo">
            {titulo ?? (editando ? "Editar fecha" : "Agregar al calendario")}
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
          ref={formulario}
          className="mz-panel-body row g-2"
          onSubmit={enviar}
        >
          {error && (
            <div className="col-12">
              <div className="mz-alert mz-alert--bad" role="alert">
                <Icon name="x-octagon" />
                {error}
              </div>
            </div>
          )}
          <div className="col-12">
            <LeyendaObligatorios />
          </div>
          <Campo
            id="evento-titulo-campo"
            etiqueta="Título"
            obligatorio
            error={errores.titulo}
            className="col-12"
          >
            <input
              className="form-control form-control-sm"
              maxLength={150}
              placeholder="Cumpleaños de Rosa Vera"
              value={valores.titulo}
              onChange={fijar("titulo")}
            />
          </Campo>
          <Campo
            id="evento-tipo"
            etiqueta="Tipo"
            obligatorio
            error={errores.tipo}
            className="col-12"
          >
            <select
              className="form-select form-select-sm"
              value={valores.tipo}
              onChange={fijar("tipo")}
            >
              {Object.entries(TIPOS_DE_EVENTO).map(([id, t]) => (
                <option key={id} value={id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id="evento-fecha"
            etiqueta="Fecha"
            obligatorio
            error={errores.fecha}
            className="col-6"
          >
            <input
              type="date"
              className="form-control form-control-sm"
              value={valores.fecha}
              onChange={fijar("fecha")}
            />
          </Campo>
          <Campo
            id="evento-fin"
            etiqueta="Hasta (si dura varios días)"
            error={errores.fecha_fin}
            className="col-6"
          >
            <input
              type="date"
              min={valores.fecha || undefined}
              className="form-control form-control-sm"
              value={valores.fecha_fin ?? ""}
              onChange={fijar("fecha_fin")}
            />
          </Campo>
          <Campo
            id="evento-descripcion"
            etiqueta="Descripción (opcional)"
            error={errores.descripcion}
            className="col-12"
          >
            <input
              className="form-control form-control-sm"
              maxLength={300}
              value={valores.descripcion}
              onChange={fijar("descripcion")}
            />
          </Campo>
          <div className="col-12">
            <label className="form-check">
              <input
                type="checkbox"
                className="form-check-input"
                checked={valores.cada_anio}
                onChange={fijar("cada_anio")}
              />{" "}
              <span className="form-check-label">
                Se repite cada año (cumpleaños, aniversarios, feriados fijos)
              </span>
            </label>
            {editando && inicial.cada_anio && (
              <p className="mz-small mz-faint mb-0 mt-1">
                Esta fecha se repite cada año: los cambios se ven en todos los
                años.
              </p>
            )}
          </div>
          <div className="col-12 mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={guardando}
            >
              {guardando
                ? "Guardando…"
                : editando
                  ? "Guardar cambios"
                  : "Agregar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** El año de una fecha «AAAA-MM-DD». */
const anioDe = (fecha) => Number(String(fecha).slice(0, 4));

/** La misma fecha en otro año (el 29 de febrero pasa al 28 si no existe). */
function enOtroAnio(fecha, anio) {
  if (!fecha) return "";
  const [, mes, dia] = fecha.split("-").map(Number);
  const ultimo = new Date(anio, mes, 0).getDate();
  const d = Math.min(dia, ultimo);
  return `${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Los feriados que tocan un año: los de ese año (o que lo cruzan) y los que
 * se repiten cada año. Ordenados por mes y día. */
function feriadosDelAnio(eventos, anio) {
  return eventos
    .filter(
      (e) =>
        e.tipo === "feriado" &&
        (e.cada_anio ||
          anioDe(e.fecha) === anio ||
          (e.fecha_fin && anioDe(e.fecha_fin) === anio)),
    )
    .sort((a, b) => a.fecha.slice(5).localeCompare(b.fecha.slice(5)));
}

/** Los feriados de un año (los que no se repiten solos) que aún no están en
 * el año siguiente con el mismo título, día y mes. */
function pendientesDeCopiar(eventos, anio) {
  const clave = (e) => `${e.titulo.trim().toLowerCase()}|${e.fecha.slice(5)}`;
  const yaEstan = new Set(
    eventos
      .filter((e) => e.tipo === "feriado" && anioDe(e.fecha) === anio + 1)
      .map(clave),
  );
  return eventos.filter(
    (e) =>
      e.tipo === "feriado" &&
      !e.cada_anio &&
      anioDe(e.fecha) === anio &&
      !yaEstan.has(clave(e)),
  );
}

/** Una tabla de fechas del calendario con sus acciones. */
function TablaDeFechas({
  filas,
  cargando,
  errorCarga,
  onReintentar,
  textoVacio,
  onEditar,
  onBorrar,
  conTipo = true,
  anio = null,
}) {
  // Lo que se repite cada año se muestra con el año que se está viendo, no
  // con el año en que se creó.
  const fecha = (e, valor) =>
    formatearFecha(
      anio && e.cada_anio
        ? enOtroAnio(valor, anio + (anioDe(valor) - anioDe(e.fecha)))
        : valor,
    );
  return (
    <div className="mz-table-wrap">
      <table className="mz-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Título</th>
            {conTipo && <th>Tipo</th>}
            <th>Se repite</th>
            <th aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {(filas ?? []).map((e) => (
            <tr key={e.id}>
              <td className="text-nowrap">
                {fecha(e, e.fecha)}
                {e.fecha_fin && ` al ${fecha(e, e.fecha_fin)}`}
              </td>
              <td>
                {e.titulo}
                {e.descripcion && (
                  <span className="d-block mz-small mz-faint">
                    {e.descripcion}
                  </span>
                )}
              </td>
              {conTipo && (
                <td>
                  <span
                    className={`calendario__icono calendario__icono--${e.tipo} me-1`}
                  >
                    <Icon
                      name={TIPOS_DE_EVENTO[e.tipo]?.icono ?? "star-fill"}
                    />
                  </span>
                  {TIPOS_DE_EVENTO[e.tipo]?.nombre ?? e.tipo}
                </td>
              )}
              <td>{e.cada_anio ? "Cada año" : "—"}</td>
              <td className="num text-nowrap">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  aria-label={`Editar ${e.titulo}`}
                  onClick={() => onEditar(e)}
                >
                  <Icon name="pencil" />
                </button>{" "}
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  aria-label={`Borrar ${e.titulo}`}
                  onClick={() => onBorrar(e)}
                >
                  <Icon name="trash" />
                </button>
              </td>
            </tr>
          ))}
          <FilaDeEstado
            columnas={conTipo ? 5 : 4}
            cargando={cargando}
            error={errorCarga}
            onReintentar={onReintentar}
            vacio={filas?.length === 0}
            textoVacio={textoVacio}
          />
        </tbody>
      </table>
    </div>
  );
}

/**
 * Gestionar el calendario de Inicio, en dos pestañas: «Feriados», con una
 * pestaña interna por año («Año 2025», «Año 2026»…: el anterior, el actual y
 * el siguiente, los que tengan feriados y los que se agreguen con «Agregar
 * año»), porque de ellos depende el conteo de días hábiles (aviso del rol de
 * pagos); y «Otras fechas», con eventos y cumpleaños (29/10/2026).
 */
export function GestionCalendarioPage() {
  const anioActual = new Date().getFullYear();
  const [eventos, setEventos] = useState(null);
  const [error, setError] = useState(null);
  // El fallo al cargar va en la tabla, con «Reintentar» (auditoría UX/UI,
  // fase 2, 28/10/2026).
  const [errorCarga, setErrorCarga] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [editando, setEditando] = useState(null);
  const [seccion, setSeccion] = useState("feriados");
  const [anioVisto, setAnioVisto] = useState(anioActual);
  // Años agregados a mano que aún no tienen feriados.
  const [aniosNuevos, setAniosNuevos] = useState([]);
  const [copiando, setCopiando] = useState(false);

  const cargar = useCallback(() => {
    setErrorCarga(null);
    return institucionalService
      .eventos()
      .then(setEventos)
      .catch((err) =>
        setErrorCarga(mensajeDeError(err, "No se pudo cargar el calendario.")),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const anios = useMemo(() => {
    const conjunto = new Set([
      anioActual - 1,
      anioActual,
      anioActual + 1,
      ...aniosNuevos,
    ]);
    (eventos ?? [])
      .filter((e) => e.tipo === "feriado" && !e.cada_anio)
      .forEach((e) => conjunto.add(anioDe(e.fecha)));
    return [...conjunto].sort((a, b) => a - b);
  }, [eventos, anioActual, aniosNuevos]);

  function agregarAnio() {
    const nuevo = anios[anios.length - 1] + 1;
    setAniosNuevos((v) => [...v, nuevo]);
    setAnioVisto(nuevo);
    setAviso(`Se agregó el año ${nuevo}: cargue sus feriados.`);
    // El foco va a la pestaña nueva, para no tener que buscarla con el
    // teclado (auditoría UX/UI, 29/10/2026).
    requestAnimationFrame(() =>
      document
        .getElementById(idDePestana("feriados-anio", `a-${nuevo}`))
        ?.focus(),
    );
  }
  const feriados = eventos ? feriadosDelAnio(eventos, anioVisto) : null;
  const otras = eventos ? eventos.filter((e) => e.tipo !== "feriado") : null;
  const porCopiar = useMemo(
    () => (eventos ? pendientesDeCopiar(eventos, anioVisto) : []),
    [eventos, anioVisto],
  );

  async function guardar(datos) {
    await institucionalService.guardarEvento(editando.id, datos);
    setAviso(editando.id ? "Fecha actualizada." : "Fecha agregada.");
    setEditando(null);
    await cargar();
  }

  async function borrar(evento) {
    if (
      !(await confirmar({
        titulo: `¿Quitar «${evento.titulo}» del calendario?`,
        // Lo que se repite es un solo registro para todos los años.
        mensaje: evento.cada_anio
          ? "Se repite cada año: se quitará de todos los años."
          : undefined,
        accion: "Quitar",
      }))
    )
      return;
    setError(null);
    setAviso(null);
    try {
      await institucionalService.eliminarEvento(evento.id);
      setAviso(`«${evento.titulo}» se quitó del calendario.`);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo borrar."));
    }
  }

  function nueva(tipo, anio) {
    const hoy = new Date();
    const fecha =
      anio && anio !== hoy.getFullYear() ? `${anio}-01-01` : iso(hoy);
    setEditando({
      titulo: "",
      tipo,
      fecha,
      fecha_fin: "",
      descripcion: "",
      cada_anio: false,
    });
  }

  const editar = (e) => setEditando({ ...e, fecha_fin: e.fecha_fin ?? "" });

  /** Copia los feriados de un año (los que no se repiten solos) al
   * siguiente, como punto de partida: después se ajustan los que cambian de
   * fecha (Carnaval, Viernes Santo…). No duplica los que ya están. */
  async function copiarAlSiguiente(anio) {
    const destino = anio + 1;
    const nuevos = pendientesDeCopiar(eventos, anio);
    setError(null);
    if (nuevos.length === 0) {
      setAviso(`No hay feriados de ${anio} pendientes de copiar a ${destino}.`);
      return;
    }
    const plural = nuevos.length === 1 ? "" : "s";
    const si = await confirmar({
      titulo: `¿Copiar ${nuevos.length} feriado${plural} de ${anio} a ${destino}?`,
      mensaje:
        "Se copian con el mismo día y mes. Revise después los que cambian de fecha cada año (Carnaval, Viernes Santo, feriados trasladados).",
      accion: "Copiar",
      peligro: false,
    });
    if (!si) return;
    setCopiando(true);
    setAviso(null);
    let copiados = 0;
    try {
      for (const e of nuevos) {
        await institucionalService.guardarEvento(null, {
          titulo: e.titulo,
          tipo: "feriado",
          fecha: enOtroAnio(e.fecha, destino),
          fecha_fin: e.fecha_fin
            ? enOtroAnio(e.fecha_fin, anioDe(e.fecha_fin) + 1)
            : null,
          descripcion: e.descripcion ?? "",
          cada_anio: false,
        });
        copiados += 1;
      }
      setAviso(
        `Se ${nuevos.length === 1 ? "copió" : "copiaron"} ${nuevos.length} feriado${plural} a ${destino}. Revise los que cambian de fecha.`,
      );
      if (!anios.includes(destino)) setAniosNuevos((v) => [...v, destino]);
      setAnioVisto(destino);
    } catch (err) {
      setError(
        copiados
          ? `Se copiaron ${copiados} de ${nuevos.length}; falló el resto (${mensajeDeError(err, "error")}). Vuelva a pulsar «Copiar» para terminar: los ya copiados no se duplican.`
          : mensajeDeError(err, "No se pudieron copiar los feriados."),
      );
    } finally {
      setCopiando(false);
      await cargar();
    }
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Gestionar calendario</h2>
          <p className="mz-desc">
            Los feriados de cada año y los eventos y cumpleaños que se marcan en
            el calendario de Inicio. Los feriados también descuentan días
            hábiles (por ejemplo, para el aviso del rol de pagos).
          </p>
        </div>
        <div className="mz-actions">
          <Link
            to="/admin/institucional/inicio"
            className="btn btn-outline-secondary btn-sm"
          >
            <Icon name="arrow-left" /> Volver al inicio
          </Link>
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

      <Pestanas
        etiqueta="Calendario"
        idBase="gestion-calendario"
        valor={seccion}
        onCambio={(v) => !copiando && setSeccion(v)}
        opciones={[
          { id: "feriados", etiqueta: "Feriados", icono: "calendar-x" },
          { id: "otras", etiqueta: "Otras fechas", icono: "calendar-event" },
        ]}
      />
      <PanelDePestana idBase="gestion-calendario" valor={seccion}>
        <div aria-busy={copiando}>
          {seccion === "feriados" ? (
            <div className="mz-stack">
              <div className="gestion-calendario__anios">
                <Pestanas
                  className="mz-tabs--secundarias"
                  etiqueta="Feriados por año"
                  idBase="feriados-anio"
                  valor={`a-${anioVisto}`}
                  onCambio={(v) =>
                    !copiando && setAnioVisto(Number(v.slice(2)))
                  }
                  opciones={anios.map((a) => ({
                    id: `a-${a}`,
                    etiqueta: `Año ${a}`,
                  }))}
                />
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={copiando}
                  onClick={agregarAnio}
                >
                  <Icon name="plus-lg" /> Agregar año
                </button>
              </div>
              <PanelDePestana idBase="feriados-anio" valor={`a-${anioVisto}`}>
                <div className="mz-stack">
                  <div className="mz-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={copiando}
                      onClick={() => nueva("feriado", anioVisto)}
                    >
                      <Icon name="plus-lg" /> Agregar feriado de {anioVisto}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      disabled={copiando || porCopiar.length === 0}
                      title={
                        eventos && porCopiar.length === 0
                          ? `No hay feriados de ${anioVisto} pendientes de copiar a ${anioVisto + 1}.`
                          : undefined
                      }
                      onClick={() => copiarAlSiguiente(anioVisto)}
                    >
                      <Icon name="copy" />{" "}
                      {copiando
                        ? "Copiando…"
                        : `Copiar los feriados de ${anioVisto} a ${anioVisto + 1}`}
                    </button>
                  </div>
                  <TablaDeFechas
                    filas={feriados}
                    conTipo={false}
                    anio={anioVisto}
                    cargando={eventos === null && !errorCarga}
                    errorCarga={errorCarga}
                    onReintentar={cargar}
                    textoVacio={`Todavía no hay feriados de ${anioVisto}.`}
                    onEditar={editar}
                    onBorrar={borrar}
                  />
                </div>
              </PanelDePestana>
            </div>
          ) : (
            <div className="mz-stack">
              <div className="mz-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => nueva("evento")}
                >
                  <Icon name="plus-lg" /> Agregar fecha
                </button>
              </div>
              <TablaDeFechas
                filas={otras}
                cargando={eventos === null && !errorCarga}
                errorCarga={errorCarga}
                onReintentar={cargar}
                textoVacio="Todavía no hay eventos ni cumpleaños en el calendario."
                onEditar={editar}
                onBorrar={borrar}
              />
            </div>
          )}
        </div>
      </PanelDePestana>

      {editando && (
        <FormularioEvento
          inicial={editando}
          titulo={
            !editando.id && editando.tipo === "feriado"
              ? `Agregar feriado de ${anioDe(editando.fecha)}`
              : undefined
          }
          onGuardar={guardar}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}
