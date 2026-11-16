import { useEffect, useMemo, useState } from "react";

import { activosService } from "../../../api/activosService";
import {
  departamentosService,
  empleadosService,
  sedesService,
} from "../../../api/organizacionService";
import { useResultadosEnVivo } from "../../../hooks/useBusquedaEnVivo";
import { Icon } from "../../common/Icon/Icon";
import { ModalDialog } from "../../common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../../utils/errores";
import "./AsignarCustodioDialog.css";

const MODOS = {
  ASIGNAR: "asignar",
  TRASLADAR: "trasladar",
};

/**
 * Buscar a la persona por nombre o código, en el servidor (16/11/2026).
 *
 * Era un desplegable con los primeros 200 empleados —el servidor da 100 como
 * máximo—: con las 712 personas de nómina, quien no estaba entre las primeras
 * no aparecía. Ahora se escribe y se elige.
 */
function BuscadorDeEmpleado({ id, excluir = [], onElegir, describe }) {
  const [texto, setTexto] = useState("");
  const busqueda = useResultadosEnVivo(texto.trim(), (q) =>
    q.length < 2
      ? Promise.resolve([])
      : empleadosService
          .list({ activo: "true", q, page_size: 20 })
          .then((datos) => datos.results ?? datos),
  );
  const resultados = (busqueda.datos ?? []).filter(
    (e) => !excluir.includes(String(e.id)),
  );
  const corto = texto.trim().length < 2;
  return (
    <div className="buscador-empleado">
      <input
        id={id}
        type="search"
        className="form-control"
        placeholder="Escriba el nombre o el código"
        aria-describedby={describe}
        autoComplete="off"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
      {!corto && (
        <ul className="buscador-empleado__resultados" aria-label="Resultados">
          {busqueda.cargando && resultados.length === 0 && (
            <li className="mz-faint mz-small">Buscando…</li>
          )}
          {!busqueda.cargando && resultados.length === 0 && (
            <li className="mz-faint mz-small">
              Nadie coincide con «{texto.trim()}».
            </li>
          )}
          {resultados.map((empleado) => (
            <li key={empleado.id}>
              <button
                type="button"
                className="buscador-empleado__opcion"
                onClick={() => {
                  onElegir(empleado);
                  setTexto("");
                }}
              >
                <span className="mz-strong">{empleado.nombre_completo}</span>
                <span className="mz-faint mz-small">
                  {[empleado.codigo_empleado, empleado.departamento_nombre]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Dónde está una sede, dicho como lo diría una persona: «en Quito». */
function donde(sede) {
  if (!sede) return "";
  return (sede.ciudad || "").trim() || sede.nombre;
}

/**
 * Entrega, devolución y traslado de un activo (RF-01).
 *
 * Las dos operaciones se piden desde el mismo sitio pero mueven cosas
 * distintas: **entregar** cambia de quién responde por el equipo, **trasladar**
 * cambia dónde está. Mezclarlas en un solo formulario obligaba a rellenar
 * campos que no venían al caso y, peor, dejaba dudas sobre qué se iba a
 * modificar.
 *
 * Arriba va siempre la situación actual —quién lo tiene, de qué área y en qué
 * ciudad está—, porque es lo primero que se comprueba antes de mover un equipo
 * y porque el registro que queda en el historial es «de esto a esto»: sin ver
 * el punto de partida, el destino solo es la mitad del dato.
 *
 * De un equipo **compartido** responden varias personas en igualdad, así que
 * allí no se elige a alguien: se mantiene una lista, de la que se suma y se
 * quita. En un equipo normal sigue el desplegable de siempre, porque hacer que
 * quien entrega una laptop pase por una lista de una sola fila sería peor.
 */
export function AsignarCustodioDialog({ activo, onCerrar, onGuardado }) {
  // Las personas conocidas: las que ya responden por el equipo y las que se
  // eligen en el buscador.
  const [empleados, setEmpleados] = useState(() => activo.responsables || []);
  const [departamentos, setDepartamentos] = useState([]);
  const [sedes, setSedes] = useState([]);

  const [modo, setModo] = useState(MODOS.ASIGNAR);
  // Siempre una lista, también cuando el equipo tiene un solo responsable: dos
  // formas de guardar lo mismo es la manera segura de que un día digan cosas
  // distintas.
  const [responsables, setResponsables] = useState(() =>
    (activo.responsables || []).map((persona) => String(persona.id)),
  );
  const [departamento, setDepartamento] = useState(activo.departamento || "");
  const [sede, setSede] = useState(activo.sede || "");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  // Qué catálogo no cargó. Antes una lista que fallaba quedaba vacía, sin
  // aviso, como si no hubiera nadie a quien entregar el equipo (auditoría
  // UX/UI, fase 2, 28/10/2026); ahora se dice junto al campo.
  const [fallos, setFallos] = useState({});

  useEffect(() => {
    const fallo = (catalogo, mensaje) =>
      setFallos((actuales) => ({ ...actuales, [catalogo]: mensaje }));
    departamentosService
      .list({ activo: "true", page_size: 100 })
      .then((datos) => setDepartamentos(datos.results ?? datos))
      .catch(() => {
        setDepartamentos([]);
        fallo(
          "departamentos",
          "No se pudieron cargar las áreas: no se puede mostrar a cuál quedará adscrito.",
        );
      });
    sedesService
      .list({ activa: "true", page_size: 200 })
      .then((datos) => setSedes(datos.results ?? datos))
      .catch(() => {
        setSedes([]);
        fallo("sedes", "No se pudo cargar la lista de sedes.");
      });
  }, []);

  const elegidos = useMemo(
    () =>
      responsables
        .map((id) => empleados.find((e) => String(e.id) === id))
        .filter(Boolean),
    [empleados, responsables],
  );
  /** Guarda a la persona elegida en el buscador para poder nombrarla. */
  function conocer(persona) {
    setEmpleados((actuales) =>
      actuales.some((e) => e.id === persona.id)
        ? actuales
        : [...actuales, persona],
    );
  }
  const sedeElegida = useMemo(
    () => sedes.find((s) => String(s.id) === String(sede)),
    [sedes, sede],
  );
  //: A qué área quedará adscrito, si es que cambia. No se pregunta —es la de
  //: quien recibe el equipo— pero sí se enseña: un dato que cambia sin que
  //: nadie lo vea es un dato que nadie va a corregir cuando esté mal.
  const areaDeDestino = useMemo(
    () =>
      String(departamento || "") !== String(activo.departamento || "")
        ? departamentos.find((d) => String(d.id) === String(departamento))
        : null,
    [departamentos, departamento, activo.departamento],
  );

  /**
   * Al elegir a una persona, el área se propone sola: un equipo entregado a
   * alguien de Contabilidad normalmente pasa a Contabilidad, y hacer que el
   * usuario lo seleccione dos veces invita a dejarlo descuadrado. Sigue siendo
   * editable, porque un préstamo entre áreas es un caso legítimo.
   */
  function proponerAreaDe(id, elegida) {
    const persona =
      elegida || empleados.find((e) => String(e.id) === String(id));
    if (persona?.departamento) {
      setDepartamento(String(persona.departamento));
    }
  }

  /** Un equipo normal cambia de manos: el elegido sustituye al anterior. */
  function elegirUnico(id, persona) {
    setResponsables(id ? [String(id)] : []);
    proponerAreaDe(id, persona);
  }

  /** Uno compartido suma: el turno crece y mengua sin que nadie sea el titular. */
  function sumar(id, persona) {
    if (!id) return;
    setResponsables((actuales) =>
      actuales.includes(String(id)) ? actuales : [...actuales, String(id)],
    );
    // El área se propone solo con el primero: con el turno ya formado,
    // reproponerla en cada alta pisaría lo que alguien acaba de elegir.
    if (responsables.length === 0) proponerAreaDe(id, persona);
  }

  function quitar(id) {
    setResponsables((actuales) =>
      actuales.filter((otro) => otro !== String(id)),
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      // Cada modo manda solo lo suyo. El traslado manda la lista vacía
      // porque mover un equipo es sacárselo a quien lo tenía: pasa a la sede
      // de destino, y una sede no responde por nada.
      //
      // La entrega sí lleva la sede: entregar un equipo suele ser ponerlo
      // donde trabaja quien lo recibe, y tener que registrar después un
      // traslado aparte dejaba el sitio desactualizado hasta que alguien se
      // acordara. El área va con ella, pero no se pregunta: es la de quien
      // recibe el equipo, y se enseña debajo para que el cambio no sea mudo.
      const datos =
        modo === MODOS.TRASLADAR
          ? { responsables: [], sede: sede || null, motivo }
          : {
              responsables: responsables.map(Number),
              departamento: departamento || null,
              sede: sede || null,
              motivo,
            };

      await activosService.asignar(activo.id, datos);
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo registrar el movimiento."));
      setIsSaving(false);
    }
  }

  const antes = activo.responsables || [];
  const esDevolucion =
    modo === MODOS.ASIGNAR && responsables.length === 0 && antes.length > 0;
  const mismosQueAntes =
    responsables.length === antes.length &&
    antes.every((persona) => responsables.includes(String(persona.id)));
  const cambioDeSede = String(sede || "") !== String(activo.sede || "");
  const hayCambio =
    modo === MODOS.TRASLADAR
      ? cambioDeSede
      : !mismosQueAntes ||
        cambioDeSede ||
        String(departamento || "") !== String(activo.departamento || "");

  return (
    <ModalDialog
      titulo="Asignar o trasladar activo"
      subtitulo={`${activo.codigo_barras} · ${activo.nombre}`}
      onCerrar={onCerrar}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      puedeConfirmar={hayCambio}
      textoConfirmar={
        modo === MODOS.TRASLADAR ? "Registrar traslado" : "Confirmar"
      }
    >
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <section className="situacion-actual">
        <h3 className="situacion-actual__titulo">Situación actual</h3>
        <dl className="situacion-actual__datos">
          <dt>{activo.compartido ? "Responsables" : "Responsable"}</dt>
          <dd>
            {activo.responsables_resumen || (
              <span className="mz-faint">Sin asignar</span>
            )}
          </dd>
          <dt>Área</dt>
          <dd>{activo.departamento_nombre || "—"}</dd>
          <dt>Ciudad</dt>
          <dd>
            {activo.ciudad || (
              <span className="mz-faint">Sin sede registrada</span>
            )}
          </dd>
        </dl>
      </section>

      <div
        className="btn-group w-100 mb-3"
        role="group"
        aria-label="Tipo de movimiento"
      >
        <input
          type="radio"
          className="btn-check"
          name="modo-movimiento"
          id="modo-asignar"
          checked={modo === MODOS.ASIGNAR}
          onChange={() => setModo(MODOS.ASIGNAR)}
        />
        <label className="btn btn-outline-primary" htmlFor="modo-asignar">
          Entregar o devolver
        </label>

        <input
          type="radio"
          className="btn-check"
          name="modo-movimiento"
          id="modo-trasladar"
          checked={modo === MODOS.TRASLADAR}
          onChange={() => setModo(MODOS.TRASLADAR)}
        />
        <label className="btn btn-outline-primary" htmlFor="modo-trasladar">
          Trasladar de ubicación
        </label>
      </div>

      {modo === MODOS.ASIGNAR ? (
        <>
          {activo.compartido ? (
            <div className="mz-field mb-3">
              <span className="form-label d-block" id="etiqueta-responsables">
                Responsables
              </span>
              {/* Una lista de la que se suma y se quita, no un desplegable:
                  ninguno manda sobre otro, así que no hay un «nuevo
                  responsable» que sustituya al anterior. */}
              <ul
                className="responsables-elegidos"
                aria-labelledby="etiqueta-responsables"
              >
                {elegidos.map((persona) => (
                  <li key={persona.id} className="mz-pill mz-pill--neutral">
                    <span>{persona.nombre_completo}</span>
                    <button
                      type="button"
                      className="mz-close"
                      aria-label={`Quitar a ${persona.nombre_completo}`}
                      onClick={() => quitar(persona.id)}
                    >
                      <Icon name="x-lg" />
                    </button>
                  </li>
                ))}
                {elegidos.length === 0 && (
                  <li className="mz-faint">Nadie responde por él</li>
                )}
              </ul>
              <label className="mt-2" htmlFor="sumar-responsable">
                Sumar a alguien
              </label>
              <BuscadorDeEmpleado
                id="sumar-responsable"
                excluir={responsables}
                onElegir={(persona) => {
                  conocer(persona);
                  sumar(persona.id, persona);
                }}
              />
              <FalloCatalogo id="sumar-responsable-fallo">
                {fallos.empleados}
              </FalloCatalogo>
            </div>
          ) : (
            <div className="mz-field mb-3">
              <label htmlFor="custodio">Nuevo responsable</label>
              {elegidos[0] ? (
                <div className="responsable-elegido">
                  <span>
                    <span className="mz-strong">
                      {elegidos[0].nombre_completo}
                    </span>
                    {elegidos[0].codigo_empleado && (
                      <span className="mz-faint mz-small">
                        {" "}
                        · {elegidos[0].codigo_empleado}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0"
                    onClick={() => elegirUnico("")}
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <>
                  <BuscadorDeEmpleado
                    id="custodio"
                    onElegir={(persona) => {
                      conocer(persona);
                      elegirUnico(persona.id, persona);
                    }}
                  />
                  <div className="form-text">
                    Sin nadie elegido, el equipo vuelve a bodega.
                  </div>
                </>
              )}
              <FalloCatalogo id="custodio-fallo">
                {fallos.empleados}
              </FalloCatalogo>
              {elegidos[0]?.departamento_nombre && (
                <div id="custodio-ayuda" className="form-text">
                  {elegidos[0].nombre_completo} pertenece a{" "}
                  <strong>{elegidos[0].departamento_nombre}</strong>.
                </div>
              )}
            </div>
          )}

          {/* Como aviso y no como nota al pie: que el equipo se quede sin
              nadie que responda por él es la consecuencia que hay que leer
              antes de confirmar. Quien devuelve un equipo lo sabe; quien
              quitaba a la última persona de un turno, no siempre. Como
              nota y no como alerta: aparece al elegir «sin custodio» y no
              debe interrumpir al lector de pantalla (revisión final UX/UI,
              28/10/2026). */}
          {esDevolucion && (
            <div className="mz-alert mz-alert--warn" role="note">
              <Icon name="exclamation-triangle" />
              <div>
                <strong>Aviso:</strong> El equipo quedará{" "}
                <strong>sin responsable</strong> y volverá a bodega. Nadie
                responderá por él hasta que se lo entregue a alguien.{" "}
                {activo.responsables_resumen} seguirá en su historial.
              </div>
            </div>
          )}

          <div className="mz-field mb-3">
            <label htmlFor="sede-entrega">Sede donde queda el equipo</label>
            <select
              id="sede-entrega"
              className="form-select"
              aria-describedby={
                [
                  fallos.sedes && "sede-entrega-fallo",
                  "sede-entrega-ayuda",
                  fallos.departamentos && "area-fallo",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              value={sede}
              onChange={(event) => setSede(event.target.value)}
            >
              <option value="">Sin sede registrada</option>
              {sedes.map((unaSede) => (
                <option key={unaSede.id} value={unaSede.id}>
                  {unaSede.nombre}
                  {unaSede.ciudad ? ` — ${unaSede.ciudad}` : ""}
                </option>
              ))}
            </select>
            <FalloCatalogo id="sede-entrega-fallo">
              {fallos.sedes}
            </FalloCatalogo>
            {cambioDeSede && (
              // En ciudades, que es como se cuenta un movimiento de sitio:
              // «pasó de Quito a Guayaquil».
              <p className="situacion-actual__cambio">
                {activo.ciudad || "Sin sede"} <span aria-hidden="true">→</span>{" "}
                <strong>{donde(sedeElegida) || "Sin sede"}</strong>
              </p>
            )}
            <div id="sede-entrega-ayuda" className="form-text">
              {/* El área no se pregunta: es la de quien recibe el equipo. Pero
                  tampoco se cambia en silencio, así que se dice aquí. */}
              {areaDeDestino
                ? `Quedará adscrito a ${areaDeDestino.nombre}, el área de quien lo recibe.`
                : "El área a la que está adscrito no cambia."}
            </div>
            <FalloCatalogo id="area-fallo">
              {fallos.departamentos}
            </FalloCatalogo>
          </div>
        </>
      ) : (
        <>
          {/* Arriba y como alerta, no como nota al pie de un campo: es la
              consecuencia menos evidente del traslado —el equipo cambia de
              sitio *y* deja de tener responsable— y hay que leerla antes de
              elegir el destino, no después. Sin role="alert": está siempre
              que se elige trasladar y no es un hecho nuevo que interrumpa
              al lector de pantalla (auditoría UX/UI, fase 2). */}
          <div className="mz-alert mz-alert--warn">
            <Icon name="exclamation-triangle" />
            <div>
              <strong>Aviso:</strong> El equipo quedará sin responsable y se
              asignará únicamente a la nueva ubicación
            </div>
          </div>

          <div className="mz-field mb-3">
            <label htmlFor="sede">Sede de destino</label>
            <select
              id="sede"
              className="form-select"
              aria-describedby={[fallos.sedes && "sede-fallo", "sede-ayuda"]
                .filter(Boolean)
                .join(" ")}
              value={sede}
              onChange={(event) => setSede(event.target.value)}
            >
              <option value="">Sin sede registrada</option>
              {sedes.map((unaSede) => (
                <option key={unaSede.id} value={unaSede.id}>
                  {unaSede.nombre}
                  {unaSede.ciudad ? ` — ${unaSede.ciudad}` : ""}
                </option>
              ))}
            </select>
            <FalloCatalogo id="sede-fallo">{fallos.sedes}</FalloCatalogo>
            {hayCambio && (
              // En ciudades, que es como se cuenta un traslado: «pasó de Quito
              // a Guayaquil». El nombre interno de la sede no le dice nada a
              // quien tiene que ir a buscar el equipo.
              <p className="situacion-actual__cambio">
                {activo.ciudad || "Sin sede"} <span aria-hidden="true">→</span>{" "}
                <strong>{donde(sedeElegida) || "Sin sede"}</strong>
              </p>
            )}
            <div id="sede-ayuda" className="form-text">
              Quien lo tuviera seguirá figurando en el historial del equipo.
            </div>
          </div>
        </>
      )}

      <div className="mz-field">
        <label htmlFor="motivo">Motivo</label>
        <textarea
          id="motivo"
          className="form-control"
          aria-describedby="motivo-ayuda"
          rows={2}
          placeholder={
            modo === MODOS.TRASLADAR
              ? "Cambio de sede, envío a sucursal, cierre de oficina…"
              : "Ingreso de personal, cambio de área, devolución por renuncia…"
          }
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
        />
        <div id="motivo-ayuda" className="form-text">
          Queda registrado en el historial del equipo.
        </div>
      </div>
    </ModalDialog>
  );
}

/** El aviso de que un catálogo no cargó, bajo el campo que lo usa. */
function FalloCatalogo({ id, children }) {
  if (!children) return null;
  return (
    <div id={id} className="mz-field-error">
      {children}
    </div>
  );
}
