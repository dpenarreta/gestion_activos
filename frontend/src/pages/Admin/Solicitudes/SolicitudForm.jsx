import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { solicitudesService } from "../../../api/solicitudesService";
import { EspecificacionesDelTipo } from "../../../components/activos/EspecificacionesDelTipo/EspecificacionesDelTipo";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { mensajeDeError } from "../../../utils/errores";
import "./Solicitudes.css";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Solicitudes" },
  { label: "Realizar solicitud" },
];

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
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    solicitudesService
      .encargados()
      .then(setEncargados)
      .catch(() =>
        setError(
          "No se pudo cargar a quién asignarle la solicitud. Inténtelo de nuevo.",
        ),
      );
    solicitudesService
      .catalogo()
      .then((datos) => {
        setTipos(datos.tipos_dispositivo ?? []);
        setComponentes(datos.componentes ?? []);
      })
      // Sin catálogo se puede pedir igual, escribiéndolo: es peor bloquear la
      // solicitud que ofrecer un desplegable vacío.
      .catch(() => {});
  }, []);

  function fijar(campo, valor) {
    setValores((actuales) => ({ ...actuales, [campo]: valor }));
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
    setIsSaving(true);
    setError(null);
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
      setError(mensajeDeError(err, "No se pudo registrar la solicitud."));
      setIsSaving(false);
    }
  }

  if (aviso) {
    return (
      <div className="solicitudes-page">
        <Breadcrumbs items={BREADCRUMB_ITEMS} />
        <div className="alert alert-warning">
          <strong>Su solicitud #{aviso.id} quedó registrada</strong>, pero no se
          pudo avisar por correo a {aviso.aviso.sin_correo.join(", ")}: su
          cuenta no tiene dirección registrada. Aparecerá igual en sus
          «Solicitudes recibidas», pero conviene avisarle.
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navegar(`/admin/solicitudes/${aviso.id}`)}
        >
          Ver la solicitud
        </button>
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
    <div className="solicitudes-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <h2 className="mb-1">Realizar solicitud</h2>
      <p className="text-muted">
        Pida un dispositivo o un componente que todavía no existe en el
        inventario. Llegará a quien elija como encargado de la compra.
      </p>

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={guardar} className="row g-3">
        <div className="col-12 col-md-6">
          <label className="form-label" htmlFor="sol-clase">
            Qué necesita
          </label>
          <select
            id="sol-clase"
            className="form-select"
            value={valores.clase}
            onChange={(evento) => cambiarClase(evento.target.value)}
          >
            <option value="dispositivo">Un dispositivo</option>
            <option value="componente">Un componente o repuesto</option>
          </select>
        </div>

        <div className="col-12 col-md-6">
          <label className="form-label" htmlFor="sol-catalogo">
            {esDispositivo ? "Tipo de dispositivo" : "Componente"}
          </label>
          <select
            id="sol-catalogo"
            className="form-select"
            value={
              esDispositivo ? valores.tipo_dispositivo : valores.componente
            }
            onChange={(evento) =>
              esDispositivo
                ? cambiarTipo(evento.target.value)
                : fijar("componente", evento.target.value)
            }
            required
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
          <div className="form-text">
            {esDispositivo
              ? "Si el equipo que necesita no está en la lista, pídale a Sistemas que cree el tipo: es lo que trae sus características."
              : "Si el repuesto no está en la lista, pídale a Sistemas que lo añada al catálogo de componentes."}
          </div>
        </div>

        {caracteristicasDelTipo.length > 0 && (
          <div className="col-12">
            <h6 className="mb-1">Con qué características</h6>
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
          </div>
        )}

        <div className="col-6 col-md-3">
          <label className="form-label" htmlFor="sol-cantidad">
            Cantidad
          </label>
          <input
            id="sol-cantidad"
            type="number"
            min="1"
            className="form-control"
            required
            value={valores.cantidad}
            onChange={(evento) => fijar("cantidad", evento.target.value)}
          />
        </div>

        <div className="col-6 col-md-3">
          <label className="form-label" htmlFor="sol-prioridad">
            Prioridad
          </label>
          <select
            id="sol-prioridad"
            className="form-select"
            value={valores.prioridad}
            onChange={(evento) => fijar("prioridad", evento.target.value)}
          >
            <option value="baja">Baja</option>
            <option value="media">Media</option>
            <option value="alta">Alta</option>
          </select>
        </div>

        <div className="col-12 col-md-6">
          <label className="form-label" htmlFor="sol-fecha">
            Se necesita para
          </label>
          <input
            id="sol-fecha"
            type="date"
            className="form-control"
            value={valores.fecha_necesaria}
            onChange={(evento) => fijar("fecha_necesaria", evento.target.value)}
          />
          <div className="form-text">
            Opcional. Vacío significa que no hay fecha comprometida.
          </div>
        </div>

        <div className="col-12 col-md-6">
          <label className="form-label" htmlFor="sol-encargado">
            Quién realizará la compra
          </label>
          <select
            id="sol-encargado"
            className="form-select"
            required
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
          <div className="form-text">
            Solo aparecen quienes pueden gestionar compras: le llegará un aviso
            y la verá en sus «Solicitudes recibidas».
          </div>
        </div>

        <div className="col-12">
          <label className="form-label" htmlFor="sol-justificacion">
            Para qué hace falta
          </label>
          <textarea
            id="sol-justificacion"
            className="form-control"
            rows={3}
            required
            placeholder="Entra un analista el 1 de octubre y no hay equipo libre."
            value={valores.justificacion}
            onChange={(evento) => fijar("justificacion", evento.target.value)}
          />
          <div className="form-text">
            Es lo que sostiene la compra ante quien la autoriza.
          </div>
        </div>

        <div className="col-12 d-flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving ? "Enviando…" : "Enviar solicitud"}
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => navegar("/admin/solicitudes/mias")}
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
