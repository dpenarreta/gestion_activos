import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { solicitudesService } from "../../../api/solicitudesService";
import { EspecificacionesDelTipo } from "../../../components/activos/EspecificacionesDelTipo/EspecificacionesDelTipo";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  erroresPorCampo,
  hayErroresGenerales,
  mensajeDeError,
} from "../../../utils/errores";
import "./Solicitudes.css";

const VACIA = {
  encargado: "",
  clase: "dispositivo",
  tipo_dispositivo: "",
  componente: "",
  especificaciones: {},
  cantidad: 1,
  justificacion: "",
  prioridad: "media",
  fecha_necesaria: "",
};

/**
 * Pedir algo que todavía no existe.
 *
 * Lo que se pide sale del catálogo: es lo que trae las características con las
 * que se describe el pedido —«una laptop con 32 GB y disco NVMe»— y lo que
 * evita la dispersión de escribir «laptop», «Laptop» y «portátil» para lo
 * mismo. Pedir algo que el catálogo no tiene empieza por darlo de alta como
 * tipo, que es donde se declara qué se especifica de él.
 *
 * El encargado no es una lista de todos los usuarios: son los que pueden
 * atender una compra. Asignársela a quien no puede es dejarla en un buzón que
 * nadie abre, y quien pide se queda esperando sin saberlo.
 */
export function SolicitudForm() {
  const navegar = useNavigate();
  const [valores, setValores] = useState(VACIA);
  const [encargados, setEncargados] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [componentes, setComponentes] = useState([]);
  const contenedorRef = useRef(null);
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  const [errorEncargados, setErrorEncargados] = useState(null);
  const [errorCatalogo, setErrorCatalogo] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    solicitudesService
      .encargados()
      .then(setEncargados)
      // Junto al campo que queda vacío, no arriba (revisión final UX/UI,
      // 28/10/2026).
      .catch((err) =>
        setErrorEncargados(
          mensajeDeError(
            err,
            "No se pudo cargar a quién asignarle la solicitud. Inténtelo de nuevo.",
          ),
        ),
      );
    solicitudesService
      .catalogo()
      .then((datos) => {
        setTipos(datos.tipos_dispositivo ?? []);
        setComponentes(datos.componentes ?? []);
      })
      // Antes fallaba en silencio y el desplegable quedaba vacío sin
      // explicación: ahora lo dice junto al campo (revisión final UX/UI,
      // 28/10/2026).
      .catch((err) =>
        setErrorCatalogo(
          mensajeDeError(
            err,
            "No se pudo cargar el catálogo. Recargue la página para volver a intentarlo.",
          ),
        ),
      );
  }, []);

  function fijar(campo, valor) {
    setValores((actuales) => ({ ...actuales, [campo]: valor }));
    // Al corregir el campo, su error deja de valer.
    setErrores((actuales) => {
      if (!actuales[campo]) return actuales;
      const resto = { ...actuales };
      delete resto[campo];
      return resto;
    });
  }

  function cambiarClase(clase) {
    // Se limpia la elección del catálogo anterior: una solicitud no puede
    // llevar un tipo de dispositivo y un componente a la vez, y arrastrarlo
    // invisible haría que el servidor la rechazara sin que se vea por qué.
    setValores((actuales) => ({
      ...actuales,
      clase,
      tipo_dispositivo: "",
      componente: "",
      especificaciones: {},
    }));
  }

  function cambiarTipo(id) {
    // Y con el tipo se van sus características: las de una laptop no describen
    // una impresora, y el servidor rechazaría lo que arrastrara del anterior.
    setValores((actuales) => ({
      ...actuales,
      tipo_dispositivo: id,
      especificaciones: {},
    }));
  }

  async function guardar(evento) {
    evento.preventDefault();
    setError(null);
    setErrores({});
    // Los obligatorios se revisan aquí y no con `required`: la burbuja del
    // navegador tapaba el error del campo (revisión final UX/UI,
    // 28/10/2026). Las características del tipo siguen con el suyo.
    const faltan = {};
    if (valores.clase === "dispositivo" && !valores.tipo_dispositivo) {
      faltan.tipo_dispositivo = "Elija el tipo de dispositivo.";
    }
    if (valores.clase === "componente" && !valores.componente) {
      faltan.componente = "Elija el componente.";
    }
    if (!(Number(valores.cantidad) >= 1)) {
      faltan.cantidad = "Indique al menos 1.";
    }
    if (!valores.encargado) faltan.encargado = "Elija a quién le llega.";
    if (!valores.justificacion.trim()) {
      faltan.justificacion = "Explique para qué hace falta.";
    }
    if (Object.keys(faltan).length > 0) {
      setErrores(faltan);
      setError("No se pudo enviar la solicitud: revise los campos marcados.");
      enfocarPrimerError(contenedorRef.current);
      return;
    }
    setIsSaving(true);
    try {
      const creada = await solicitudesService.create({
        encargado: Number(valores.encargado),
        clase: valores.clase,
        tipo_dispositivo: valores.tipo_dispositivo
          ? Number(valores.tipo_dispositivo)
          : null,
        componente: valores.componente ? Number(valores.componente) : null,
        especificaciones: valores.especificaciones,
        cantidad: Number(valores.cantidad) || 1,
        justificacion: valores.justificacion.trim(),
        prioridad: valores.prioridad,
        fecha_necesaria: valores.fecha_necesaria || null,
      });
      // Si al encargado no le llegó el correo hay que decirlo antes de salir:
      // quien pide debe saberlo ahora, no cuando pregunte por qué nadie la
      // atendió.
      if (creada.aviso?.sin_correo?.length > 0) {
        setAviso(creada);
        setIsSaving(false);
        return;
      }
      navegar(`/admin/solicitudes/${creada.id}`);
    } catch (err) {
      const porCampo = erroresPorCampo(err);
      setErrores(porCampo);
      // Si todo quedó bajo su campo, arriba basta con decir que se revisen;
      // si no, el aviso lleva el motivo completo.
      const todoEnSuCampo =
        Object.keys(porCampo).length > 0 &&
        Object.keys(porCampo).every((campo) => campo in VACIA) &&
        !hayErroresGenerales(err);
      setError(
        todoEnSuCampo
          ? "No se pudo enviar la solicitud: revise los campos marcados."
          : mensajeDeError(err, "No se pudo registrar la solicitud."),
      );
      setIsSaving(false);
      enfocarPrimerError(contenedorRef.current);
    }
  }

  if (aviso) {
    return (
      <div className="solicitudes-page">
        <div className="mz-view-head">
          <div>
            <h2>Realizar solicitud</h2>
          </div>
        </div>
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="exclamation-triangle" />
          <div>
            <strong>Su solicitud #{aviso.id} quedó registrada</strong>, pero no
            se pudo avisar por correo a {aviso.aviso.sin_correo.join(", ")}: su
            cuenta no tiene dirección registrada. Aparecerá igual en sus
            «Solicitudes recibidas», pero conviene avisarle.
          </div>
        </div>
        <div className="mz-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navegar(`/admin/solicitudes/${aviso.id}`)}
          >
            Ver la solicitud
          </button>
        </div>
      </div>
    );
  }

  const esDispositivo = valores.clase === "dispositivo";
  const delCatalogo = esDispositivo ? tipos : componentes;
  // Solo un tipo del catálogo trae características: lo escrito a mano no tiene
  // contra qué describirse, y un componente del catálogo de repuestos tampoco
  // declara ninguna.
  const tipoElegido = esDispositivo
    ? tipos.find((fila) => String(fila.id) === String(valores.tipo_dispositivo))
    : null;
  const caracteristicasDelTipo = tipoElegido?.caracteristicas ?? [];
  const nombreDelTipo = tipoElegido ? `«${tipoElegido.nombre}»` : "el tipo";

  return (
    <div className="solicitudes-page" ref={contenedorRef}>
      <div className="mz-view-head">
        <div>
          <h2>Realizar solicitud</h2>
          <p className="mz-desc">
            Pida un dispositivo o un componente que todavía no existe en el
            inventario. Llegará a quien elija como encargado de la compra.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {/* Se conserva `row g-3`: cantidad y prioridad comparten fila a un cuarto
          de ancho cada una, que la rejilla de dos columnas no reproduce. */}
      <section className="mz-card solicitud-form">
        <div className="mz-card-head">
          <h3>Datos de la solicitud</h3>
          <LeyendaObligatorios />
        </div>
        <form onSubmit={guardar} className="mz-card-body">
          <div className="row g-3">
            <Campo
              id="sol-clase"
              etiqueta="Qué necesita"
              className="col-12 col-md-6"
            >
              <select
                className="form-select"
                value={valores.clase}
                onChange={(evento) => cambiarClase(evento.target.value)}
              >
                <option value="dispositivo">Un dispositivo</option>
                <option value="componente">Un componente o repuesto</option>
              </select>
            </Campo>

            <Campo
              id="sol-catalogo"
              etiqueta={esDispositivo ? "Tipo de dispositivo" : "Componente"}
              obligatorio
              ayuda={
                esDispositivo
                  ? "Si el equipo que necesita no está en la lista, pídale a Sistemas que cree el tipo: es lo que trae sus características."
                  : "Si el repuesto no está en la lista, pídale a Sistemas que lo añada al catálogo de componentes."
              }
              // Si el catálogo no carga, se dice aquí: antes el desplegable
              // quedaba vacío sin explicación (revisión final UX/UI,
              // 28/10/2026).
              error={
                (esDispositivo
                  ? errores.tipo_dispositivo
                  : errores.componente) || errorCatalogo
              }
              className="col-12 col-md-6"
            >
              <select
                className="form-select"
                value={
                  esDispositivo ? valores.tipo_dispositivo : valores.componente
                }
                onChange={(evento) =>
                  esDispositivo
                    ? cambiarTipo(evento.target.value)
                    : fijar("componente", evento.target.value)
                }
              >
                <option value="">
                  Elija {esDispositivo ? "el tipo" : "el componente"}
                </option>
                {delCatalogo.map((fila) => (
                  <option key={fila.id} value={fila.id}>
                    {fila.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            {caracteristicasDelTipo.length > 0 && (
              <div className="col-12">
                <h4 className="solicitud-subtitulo">Con qué características</h4>
                <p className="form-text mt-0">
                  Las que {nombreDelTipo} declara. Las marcadas con{" "}
                  <strong>*</strong> hay que especificarlas para poder enviar la
                  solicitud; el resto, solo si su pedido lo exige.
                </p>
                <EspecificacionesDelTipo
                  caracteristicas={caracteristicasDelTipo}
                  valor={valores.especificaciones}
                  onChange={(especificaciones) =>
                    fijar("especificaciones", especificaciones)
                  }
                />
                {errores.especificaciones && (
                  <div className="mz-field-error">
                    {errores.especificaciones}
                  </div>
                )}
              </div>
            )}

            <Campo
              id="sol-cantidad"
              etiqueta="Cantidad"
              obligatorio
              error={errores.cantidad}
              className="col-6 col-md-3"
            >
              <input
                type="number"
                min="1"
                className="form-control"
                value={valores.cantidad}
                onChange={(evento) => fijar("cantidad", evento.target.value)}
              />
            </Campo>

            <Campo
              id="sol-prioridad"
              etiqueta="Prioridad"
              error={errores.prioridad}
              className="col-6 col-md-3"
            >
              <select
                className="form-select"
                value={valores.prioridad}
                onChange={(evento) => fijar("prioridad", evento.target.value)}
              >
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
              </select>
            </Campo>

            <Campo
              id="sol-fecha"
              etiqueta="Se necesita para"
              ayuda="Opcional. Vacío significa que no hay fecha comprometida."
              error={errores.fecha_necesaria}
              className="col-12 col-md-6"
            >
              <input
                type="date"
                className="form-control"
                value={valores.fecha_necesaria}
                onChange={(evento) =>
                  fijar("fecha_necesaria", evento.target.value)
                }
              />
            </Campo>

            <Campo
              id="sol-encargado"
              etiqueta="Quién realizará la compra"
              obligatorio
              ayuda="Solo aparecen quienes pueden gestionar compras: le llegará un aviso y la verá en sus «Solicitudes recibidas»."
              error={errores.encargado || errorEncargados}
              className="col-12 col-md-6"
            >
              <select
                className="form-select"
                value={valores.encargado}
                onChange={(evento) => fijar("encargado", evento.target.value)}
              >
                <option value="">Elija a quién le llega</option>
                {encargados.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo
              id="sol-justificacion"
              etiqueta="Para qué hace falta"
              obligatorio
              ayuda="Es lo que sostiene la compra ante quien la autoriza."
              error={errores.justificacion}
              className="col-12"
            >
              <textarea
                className="form-control"
                rows={3}
                placeholder="Entra un analista el 1 de octubre y no hay equipo libre."
                value={valores.justificacion}
                onChange={(evento) =>
                  fijar("justificacion", evento.target.value)
                }
              />
            </Campo>

            <div className="col-12 mz-actions justify-content-end">
              <button
                type="button"
                className="btn btn-cancelar"
                onClick={() => navegar("/admin/solicitudes/mias")}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSaving}
              >
                {isSaving ? "Enviando…" : "Enviar solicitud"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
