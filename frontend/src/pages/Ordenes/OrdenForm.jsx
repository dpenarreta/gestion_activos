import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ordenesService } from "../../api/ordenesService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import "./Ordenes.css";

const VACIO = {
  sede: "",
  categoria: "",
  prioridad: "media",
  titulo: "",
  descripcion: "",
  telefono_contacto: "",
};

/**
 * Solicitar una orden de trabajo. Pide lo justo para que quien coordina la
 * pueda asignar: dónde, qué, qué tan urgente y a quién llamar.
 */
export function OrdenForm() {
  const navegar = useNavigate();
  const [catalogos, setCatalogos] = useState(null);
  const [valores, setValores] = useState(VACIO);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    ordenesService
      .catalogos()
      .then(setCatalogos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar las sedes.")),
      );
  }, []);

  function fijar(campo, valor) {
    setValores((actual) => ({ ...actual, [campo]: valor }));
  }

  async function guardar(evento) {
    evento.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const orden = await ordenesService.create(valores);
      navegar(`/admin/ordenes/lista/${orden.id}`);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo registrar la orden."));
      setIsSaving(false);
    }
  }

  return (
    <div className="ordenes-page">
      <div className="mz-view-head">
        <div>
          <h2>Nueva orden de trabajo</h2>
          <p className="mz-desc">
            Reporte lo que hay que reparar o mantener en una sede. Quien
            coordina el mantenimiento la asigna a un técnico o proveedor.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Datos de la orden</h3>
        </div>
        <form onSubmit={guardar} className="mz-card-body">
          <div className="row g-3">
            <div className="col-12 col-md-6">
              <label className="form-label" htmlFor="ot-sede">
                Sede
              </label>
              <select
                id="ot-sede"
                className="form-select"
                required
                value={valores.sede}
                onChange={(evento) => fijar("sede", evento.target.value)}
              >
                <option value="">Elija la sede</option>
                {(catalogos?.sedes ?? []).map((sede) => (
                  <option key={sede.id} value={sede.id}>
                    {sede.nombre}
                    {sede.ciudad ? ` · ${sede.ciudad}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label" htmlFor="ot-categoria">
                Categoría
              </label>
              <select
                id="ot-categoria"
                className="form-select"
                required
                value={valores.categoria}
                onChange={(evento) => fijar("categoria", evento.target.value)}
              >
                <option value="">Elija</option>
                {(catalogos?.categorias ?? []).map((opcion) => (
                  <option key={opcion.valor} value={opcion.valor}>
                    {opcion.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label" htmlFor="ot-prioridad">
                Prioridad
              </label>
              <select
                id="ot-prioridad"
                className="form-select"
                value={valores.prioridad}
                onChange={(evento) => fijar("prioridad", evento.target.value)}
              >
                {(catalogos?.prioridades ?? []).map((opcion) => (
                  <option key={opcion.valor} value={opcion.valor}>
                    {opcion.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12">
              <label className="form-label" htmlFor="ot-titulo">
                Qué hay que hacer
              </label>
              <input
                id="ot-titulo"
                className="form-control"
                required
                maxLength={150}
                placeholder="Sin luz en el área de cajas"
                value={valores.titulo}
                onChange={(evento) => fijar("titulo", evento.target.value)}
              />
            </div>
            <div className="col-12">
              <label className="form-label" htmlFor="ot-descripcion">
                Descripción
              </label>
              <textarea
                id="ot-descripcion"
                className="form-control"
                rows={3}
                placeholder="Desde cuándo pasa, dónde exactamente y qué se ha intentado."
                value={valores.descripcion}
                onChange={(evento) => fijar("descripcion", evento.target.value)}
              />
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label" htmlFor="ot-telefono">
                Teléfono de contacto
              </label>
              <input
                id="ot-telefono"
                className="form-control"
                inputMode="tel"
                placeholder="099 000 0000"
                value={valores.telefono_contacto}
                onChange={(evento) =>
                  fijar("telefono_contacto", evento.target.value)
                }
              />
              <div className="form-text">
                Para que el técnico coordine la visita. Se muestra enmascarado a
                quien no lo necesita completo.
              </div>
            </div>
            <div className="col-12 mz-actions justify-content-end">
              <button
                type="button"
                className="btn btn-cancelar"
                onClick={() => navegar("/admin/ordenes/lista")}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSaving}
              >
                {isSaving ? "Registrando…" : "Registrar orden"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
