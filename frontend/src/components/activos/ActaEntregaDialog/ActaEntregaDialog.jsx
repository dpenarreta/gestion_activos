import { useEffect, useState } from "react";

import { actasEntregaService } from "../../../api/activosService";
import { descargarBlob } from "../../../utils/descargas";
import { mensajeDeError } from "../../../utils/errores";
import { formatearFecha } from "../../../utils/formato";
import { Icon } from "../../common/Icon/Icon";
import { ModalDialog } from "../../common/ModalDialog/ModalDialog";
import "./ActaEntregaDialog.css";

const CALIFICACIONES = [
  { valor: "ok", texto: "Ok" },
  { valor: "falla", texto: "Falla" },
  { valor: "na", texto: "No aplica" },
];

/**
 * Acta de recepción de equipo AEE-LC-01 (16/11/2026).
 *
 * Replica la plantilla que TI llenaba a mano en cada entrega. El sistema pone
 * lo que ya sabe —la persona, la fecha, quién entregó y los equipos (todo lo
 * entregado a esa persona ese día, y se puede quitar alguno)—; el técnico
 * marca la prueba de funcionalidad y escribe las observaciones. Al guardar,
 * se descarga en Word (editable) y en PDF (para imprimir y firmar).
 */
export function ActaEntregaDialog({ movimientoId, onCerrar }) {
  const [preparacion, setPreparacion] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [acta, setActa] = useState(null);
  const [elegidos, setElegidos] = useState([]);
  const [pruebas, setPruebas] = useState({});
  const [paquete, setPaquete] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [descargando, setDescargando] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [sucio, setSucio] = useState(false);

  useEffect(() => {
    let vigente = true;
    actasEntregaService
      .preparar(movimientoId)
      .then((datos) => {
        if (!vigente) return;
        setPreparacion(datos);
        if (datos.acta) {
          cargarActa(datos.acta);
        } else {
          setElegidos(
            datos.candidatos.filter((c) => !c.acta_id).map((c) => c.id),
          );
        }
      })
      .catch((err) => {
        if (vigente)
          setErrorCarga(mensajeDeError(err, "No se pudo preparar el acta."));
      });
    return () => {
      vigente = false;
    };
  }, [movimientoId]);

  function cargarActa(datos) {
    setActa(datos);
    setElegidos(datos.movimientos.map((m) => m.id));
    setPruebas(datos.pruebas || {});
    setPaquete(
      datos.nuevo_de_paquete === true
        ? "si"
        : datos.nuevo_de_paquete === false
          ? "no"
          : "",
    );
    setObservaciones(datos.observaciones || "");
    setSucio(false);
  }

  function cambiar(funcion) {
    return (...args) => {
      setSucio(true);
      setAviso(null);
      funcion(...args);
    };
  }

  const alternarEquipo = cambiar((id) =>
    setElegidos((lista) =>
      lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id],
    ),
  );
  const calificar = cambiar((clave, valor) =>
    setPruebas((actuales) => ({ ...actuales, [clave]: valor })),
  );

  async function guardar(event) {
    event?.preventDefault();
    if (elegidos.length === 0) {
      setError("Elija al menos un equipo para el acta.");
      return;
    }
    setError(null);
    setGuardando(true);
    const payload = {
      movimientos: elegidos,
      pruebas: Object.fromEntries(
        Object.entries(pruebas).filter(([, v]) => v && v !== "na"),
      ),
      nuevo_de_paquete:
        paquete === "si" ? true : paquete === "no" ? false : null,
      observaciones: observaciones.trim(),
    };
    try {
      const guardada = acta
        ? await actasEntregaService.editar(acta.id, payload)
        : await actasEntregaService.crear(payload);
      cargarActa(guardada);
      setAviso(
        acta
          ? "Acta actualizada. Descárguela de nuevo para imprimirla."
          : `Acta N.º ${guardada.id} guardada. Descárguela en Word o PDF.`,
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el acta."));
    } finally {
      setGuardando(false);
    }
  }

  async function descargar(formato) {
    setDescargando(formato);
    setError(null);
    try {
      const blob = await actasEntregaService.documento(acta.id, formato);
      descargarBlob(blob, `acta-entrega-AEE-LC-01-${acta.id}.${formato}`);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar el acta."));
    } finally {
      setDescargando(null);
    }
  }

  const candidatos = preparacion?.candidatos ?? [];

  return (
    <ModalDialog
      titulo="Acta de recepción de equipo"
      subtitulo={
        preparacion
          ? `AEE-LC-01 · ${preparacion.custodio.nombre} · ${formatearFecha(preparacion.fecha)}`
          : "AEE-LC-01"
      }
      onCerrar={onCerrar}
      onSubmit={guardar}
      isSaving={guardando}
      puedeConfirmar={Boolean(preparacion) && (!acta || sucio)}
      textoConfirmar={acta ? "Guardar cambios" : "Guardar acta"}
      textoCancelar={acta ? "Cerrar" : "Cancelar"}
      sucio={sucio}
      anchoMaximo="760px"
    >
      {errorCarga && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {errorCarga}
        </div>
      )}
      {!preparacion && !errorCarga && (
        <p className="mz-faint" role="status">
          Preparando el acta…
        </p>
      )}
      {preparacion && (
        <>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {aviso && (
            <div className="mz-alert mz-alert--ok" role="status">
              <Icon name="check2-circle" />
              {aviso}
            </div>
          )}
          {acta && (
            <div className="acta-entrega__descargas">
              <span className="mz-strong">Acta N.º {acta.id}</span>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={() => descargar("docx")}
                disabled={Boolean(descargando) || sucio}
                title={
                  sucio ? "Guarde los cambios antes de descargar" : undefined
                }
              >
                <Icon name="file-earmark-word" />{" "}
                {descargando === "docx" ? "Descargando…" : "Word (editable)"}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => descargar("pdf")}
                disabled={Boolean(descargando) || sucio}
                title={
                  sucio ? "Guarde los cambios antes de descargar" : undefined
                }
              >
                <Icon name="file-earmark-pdf" />{" "}
                {descargando === "pdf" ? "Descargando…" : "PDF para imprimir"}
              </button>
            </div>
          )}

          <fieldset className="acta-entrega__grupo">
            <legend>Parte 1: equipos que se entregan</legend>
            <p className="mz-small mz-faint">
              Lo entregado a esta persona ese día. Quite lo que no va en esta
              acta.
            </p>
            <ul className="acta-entrega__equipos">
              {candidatos.map((c) => {
                const enOtra = c.acta_id && c.acta_id !== acta?.id;
                return (
                  <li key={c.id}>
                    <label className="form-check">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={elegidos.includes(c.id)}
                        disabled={enOtra}
                        onChange={() => alternarEquipo(c.id)}
                      />
                      <span className="form-check-label">
                        <span className="mz-strong">{c.activo.tipo}</span>{" "}
                        {c.activo.marca} {c.activo.modelo}
                        <span className="mz-faint mz-small d-block">
                          {c.activo.codigo_barras} · Serie{" "}
                          {c.activo.numero_serie}
                          {enOtra
                            ? ` · ya está en el acta N.º ${c.acta_id}`
                            : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <fieldset className="acta-entrega__grupo">
            <legend>Parte 2: prueba de funcionalidad</legend>
            <div className="acta-entrega__pruebas">
              {preparacion.pruebas.map((prueba) => (
                <div
                  key={prueba.clave}
                  className="acta-entrega__prueba"
                  role="radiogroup"
                  aria-label={prueba.etiqueta}
                >
                  <span className="acta-entrega__prueba-nombre">
                    {prueba.etiqueta}
                  </span>
                  <span className="acta-entrega__opciones">
                    {CALIFICACIONES.map((c) => (
                      <label key={c.valor} className="acta-entrega__opcion">
                        <input
                          type="radio"
                          name={`prueba-${prueba.clave}`}
                          value={c.valor}
                          checked={(pruebas[prueba.clave] || "na") === c.valor}
                          onChange={() => calificar(prueba.clave, c.valor)}
                        />{" "}
                        {c.texto}
                      </label>
                    ))}
                  </span>
                </div>
              ))}
              <div
                className="acta-entrega__prueba"
                role="radiogroup"
                aria-label="Nuevo de paquete"
              >
                <span className="acta-entrega__prueba-nombre">
                  Nuevo de paquete
                </span>
                <span className="acta-entrega__opciones">
                  {[
                    { valor: "si", texto: "Sí" },
                    { valor: "no", texto: "No" },
                    { valor: "", texto: "Sin marcar" },
                  ].map((c) => (
                    <label key={c.valor} className="acta-entrega__opcion">
                      <input
                        type="radio"
                        name="nuevo-de-paquete"
                        value={c.valor}
                        checked={paquete === c.valor}
                        onChange={cambiar(() => setPaquete(c.valor))}
                      />{" "}
                      {c.texto}
                    </label>
                  ))}
                </span>
              </div>
            </div>
          </fieldset>

          <div className="mb-2">
            <label
              className="form-label mz-strong"
              htmlFor="acta-observaciones"
            >
              Observaciones / recomendaciones técnicas / procesos realizados
            </label>
            <textarea
              id="acta-observaciones"
              className="form-control"
              rows={3}
              maxLength={1000}
              value={observaciones}
              placeholder="Por ejemplo: Se entrega cargador."
              onChange={cambiar((e) => setObservaciones(e.target.value))}
            />
            <p className="mz-small mz-faint mb-0">
              El origen, el destino y la fecha se completan solos.
            </p>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
