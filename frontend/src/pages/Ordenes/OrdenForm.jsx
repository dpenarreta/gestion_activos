import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ordenesService } from "../../api/ordenesService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { Icon } from "../../components/common/Icon/Icon";
import {
  erroresPorCampo,
  hayErroresGenerales,
  mensajeDeError,
} from "../../utils/errores";
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
  const contenedorRef = useRef(null);
  const [catalogos, setCatalogos] = useState(null);
  const [errorCatalogos, setErrorCatalogos] = useState(null);
  const [valores, setValores] = useState(VACIO);
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    ordenesService
      .catalogos()
      .then(setCatalogos)
      .catch((err) =>
        setErrorCatalogos(
          mensajeDeError(err, "No se pudieron cargar las sedes."),
        ),
      );
  }, []);

  function fijar(campo, valor) {
    setValores((actual) => ({ ...actual, [campo]: valor }));
    // Al corregir el campo, su error deja de valer.
    setErrores((actuales) => {
      if (!actuales[campo]) return actuales;
      const resto = { ...actuales };
      delete resto[campo];
      return resto;
    });
  }

  async function guardar(evento) {
    evento.preventDefault();
    setError(null);
    setErrores({});
    // Los obligatorios se revisan aquí y no con `required`: la burbuja del
    // navegador tapaba el error del campo y se veía distinta en cada
    // formulario (revisión final UX/UI, 28/10/2026).
    const faltan = {};
    if (!valores.sede) faltan.sede = "Elija la sede.";
    if (!valores.categoria) faltan.categoria = "Elija la categoría.";
    if (!valores.titulo.trim()) faltan.titulo = "Diga qué hay que hacer.";
    if (Object.keys(faltan).length > 0) {
      setErrores(faltan);
      setError("No se pudo registrar la orden: revise los campos marcados.");
      enfocarPrimerError(contenedorRef.current);
      return;
    }
    setIsSaving(true);
    try {
      const orden = await ordenesService.create(valores);
      navegar(`/admin/ordenes/lista/${orden.id}`);
    } catch (err) {
      const porCampo = erroresPorCampo(err);
      setErrores(porCampo);
      // Si todo quedó bajo su campo, arriba basta con decir que se revisen;
      // si no, el aviso lleva el motivo completo.
      const todoEnSuCampo =
        Object.keys(porCampo).length > 0 &&
        Object.keys(porCampo).every((campo) => campo in VACIO) &&
        !hayErroresGenerales(err);
      setError(
        todoEnSuCampo
          ? "No se pudo registrar la orden: revise los campos marcados."
          : mensajeDeError(err, "No se pudo registrar la orden."),
      );
      setIsSaving(false);
      enfocarPrimerError(contenedorRef.current);
    }
  }

  return (
    <div className="ordenes-page" ref={contenedorRef}>
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
          <LeyendaObligatorios />
        </div>
        <form onSubmit={guardar} className="mz-card-body" noValidate>
          <div className="row g-3">
            <Campo
              id="ot-sede"
              etiqueta="Sede"
              obligatorio
              // Si los catálogos no cargan, se dice junto al campo que queda
              // vacío y no como un fallo del formulario.
              error={errores.sede || errorCatalogos}
              className="col-12 col-md-6"
            >
              <select
                className="form-select"
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
            </Campo>
            <Campo
              id="ot-categoria"
              etiqueta="Categoría"
              obligatorio
              error={errores.categoria}
              className="col-6 col-md-3"
            >
              <select
                className="form-select"
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
            </Campo>
            <Campo
              id="ot-prioridad"
              etiqueta="Prioridad"
              error={errores.prioridad}
              className="col-6 col-md-3"
            >
              <select
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
            </Campo>
            <Campo
              id="ot-titulo"
              etiqueta="Qué hay que hacer"
              obligatorio
              error={errores.titulo}
              className="col-12"
            >
              <input
                className="form-control"
                maxLength={150}
                placeholder="Sin luz en el área de cajas"
                value={valores.titulo}
                onChange={(evento) => fijar("titulo", evento.target.value)}
              />
            </Campo>
            <Campo
              id="ot-descripcion"
              etiqueta="Descripción"
              error={errores.descripcion}
              className="col-12"
            >
              <textarea
                className="form-control"
                rows={3}
                placeholder="Desde cuándo pasa, dónde exactamente y qué se ha intentado."
                value={valores.descripcion}
                onChange={(evento) => fijar("descripcion", evento.target.value)}
              />
            </Campo>
            <Campo
              id="ot-telefono"
              etiqueta="Teléfono de contacto"
              ayuda="Para que el técnico coordine la visita. Se muestra enmascarado a quien no lo necesita completo."
              error={errores.telefono_contacto}
              className="col-12 col-md-6"
            >
              <input
                className="form-control"
                inputMode="tel"
                placeholder="099 000 0000"
                value={valores.telefono_contacto}
                onChange={(evento) =>
                  fijar("telefono_contacto", evento.target.value)
                }
              />
            </Campo>
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
