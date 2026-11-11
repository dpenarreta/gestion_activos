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
import { BuscadorDeResponsable } from "./BuscadorDeResponsable";
import { hoyLocal } from "./comunes";
import { RegistrarProveedorDialog } from "./RegistrarProveedorDialog";
import "./Ordenes.css";

const VACIO = {
  sede: "",
  categoria: "",
  prioridad: "media",
  titulo: "",
  descripcion: "",
  telefono_contacto: "",
  fecha_programada: "",
};

/** Los campos que tienen un sitio en la pantalla para mostrar su error. */
const CAMPOS_CON_ERROR = new Set([
  ...Object.keys(VACIO),
  "responsable",
  "tecnico",
  "proveedor",
]);

/** Los mismos mensajes que da el servidor (`validar_responsable_y_fecha`). */
const SIN_RESPONSABLE =
  "Indique el proveedor o la persona que realizará la orden.";
const SIN_FECHA = "Indique la fecha en que debe cumplirse la orden.";
const FECHA_PASADA = "La fecha programada no puede ser anterior a hoy.";
/** Se escribió un nombre pero no se eligió de la lista: lo mismo al salir
 * del campo y al enviar (QA-UX, ronda 2, 11/11/2026). */
const RESPONSABLE_SIN_ELEGIR =
  "Elija de la lista quién realiza la orden o registre un proveedor nuevo.";
const PROVEEDOR_SIN_ELEGIR =
  "Elija de la lista el proveedor o deje el campo vacío.";

const buscarResponsables = (q) => ordenesService.responsables(q);
const buscarProveedores = (q) =>
  ordenesService.responsables(q, { solo: "proveedores" });

/**
 * Crear una orden de trabajo: dónde, qué, qué tan urgente, a quién llamar y,
 * desde el 11/11/2026 (US-006), quién la realiza y para cuándo. La orden nace
 * programada con ese compromiso, sin esperar a que alguien la asigne.
 *
 * «Quién la realiza» es un proveedor o una persona con cuenta. Al elegir una
 * persona se propone el proveedor de su última orden con proveedor, que es
 * solo una aproximación (el sistema no guarda de qué proveedor es cada
 * persona): se ve en «Proveedor (opcional)», justo debajo, y se puede quitar
 * o cambiar. Corregir el nombre de la persona no borra ese proveedor; se
 * reemplaza al elegir otra persona, y entonces se avisa a la vista.
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
  // `{tipo: "persona" | "proveedor", id, nombre, proveedor}` o null.
  const [responsable, setResponsable] = useState(null);
  // La última persona elegida: sigue mientras se corrige su nombre y se
  // olvida al elegir un proveedor como responsable.
  const [persona, setPersona] = useState(null);
  // El proveedor con el que la persona realiza la orden (o ninguno).
  const [proveedorDePersona, setProveedorDePersona] = useState(null);
  // Lo escrito en cada buscador, para saber si quedó un nombre sin elegir.
  const [textoResponsable, setTextoResponsable] = useState("");
  const [textoProveedor, setTextoProveedor] = useState("");
  // `{destino: "responsable" | "proveedor", nombre}` con la ventana abierta.
  const [registro, setRegistro] = useState(null);
  // Para lectores de pantalla (lo visible ya está en la ayuda del campo).
  const [aviso, setAviso] = useState("");
  // Un cambio que no se pidió en ese campo (el proveedor reemplazado al
  // elegir otra persona): se dice a la vista.
  const [avisoVisible, setAvisoVisible] = useState("");
  const hoy = hoyLocal();
  const conProveedor = Boolean(persona);

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

  function quitarErrores(...campos) {
    setErrores((actuales) => {
      if (!campos.some((campo) => actuales[campo])) return actuales;
      const resto = { ...actuales };
      campos.forEach((campo) => delete resto[campo]);
      return resto;
    });
  }

  function fijar(campo, valor) {
    setValores((actual) => ({ ...actual, [campo]: valor }));
    // Al corregir el campo, su error deja de valer.
    quitarErrores(campo);
  }

  function elegirResponsable(elegido) {
    setResponsable(elegido);
    if (!elegido) return; // Se está corrigiendo el nombre: nada más cambia.
    quitarErrores("responsable", "tecnico", "proveedor");
    setAvisoVisible("");
    if (elegido.tipo === "proveedor") {
      setPersona(null);
      setProveedorDePersona(null);
      setAviso("");
      return;
    }
    const sugerido = elegido.proveedor;
    // La misma persona otra vez: se respeta lo que ya se eligió.
    if (persona?.id === elegido.id) {
      setPersona(elegido);
      return;
    }
    if (
      persona &&
      proveedorDePersona &&
      proveedorDePersona.id !== sugerido?.id
    ) {
      setAvisoVisible(
        sugerido
          ? `El proveedor cambió de ${proveedorDePersona.nombre} a ${sugerido.nombre}, el último de ${elegido.nombre}.`
          : `Se quitó el proveedor ${proveedorDePersona.nombre}: ${elegido.nombre} no tiene proveedor anterior.`,
      );
    }
    setPersona(elegido);
    setProveedorDePersona(sugerido);
    setAviso(
      sugerido
        ? `Se propuso el proveedor ${sugerido.nombre}. Puede quitarlo o cambiarlo.`
        : "",
    );
  }

  function elegirProveedorDePersona(elegido) {
    setProveedorDePersona(
      elegido ? { id: elegido.id, nombre: elegido.nombre } : null,
    );
    setAvisoVisible("");
    if (elegido) quitarErrores("proveedor");
  }

  function abrirRegistro(destino, nombre = "") {
    setRegistro({ destino, nombre });
  }

  function proveedorRegistrado(proveedor) {
    const destino = registro?.destino;
    setRegistro(null);
    if (destino === "proveedor" && persona) {
      elegirProveedorDePersona(proveedor);
      setAviso(
        `Proveedor ${proveedor.nombre} registrado y elegido como proveedor de ${persona.nombre}.`,
      );
      return;
    }
    elegirResponsable({
      tipo: "proveedor",
      id: proveedor.id,
      nombre: proveedor.nombre,
      proveedor: null,
    });
    setAviso(`Proveedor ${proveedor.nombre} registrado y elegido.`);
  }

  function datosAEnviar() {
    const esPersona = responsable?.tipo === "persona";
    return {
      ...valores,
      tecnico: esPersona ? responsable.id : null,
      proveedor: esPersona
        ? (proveedorDePersona?.id ?? null)
        : (responsable?.id ?? null),
    };
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
    if (!responsable) {
      faltan.responsable = textoResponsable.trim()
        ? RESPONSABLE_SIN_ELEGIR
        : SIN_RESPONSABLE;
    }
    if (conProveedor && !proveedorDePersona && textoProveedor.trim()) {
      faltan.proveedor = PROVEEDOR_SIN_ELEGIR;
    }
    if (!valores.fecha_programada) faltan.fecha_programada = SIN_FECHA;
    // aaaa-mm-dd se compara bien como texto.
    else if (valores.fecha_programada < hoy)
      faltan.fecha_programada = FECHA_PASADA;
    if (Object.keys(faltan).length > 0) {
      setErrores(faltan);
      setError("No se pudo registrar la orden: revise los campos marcados.");
      enfocarPrimerError(contenedorRef.current);
      return;
    }
    setIsSaving(true);
    try {
      const orden = await ordenesService.create(datosAEnviar());
      navegar(`/admin/ordenes/lista/${orden.id}`);
    } catch (err) {
      const porCampo = erroresPorCampo(err);
      // El error del técnico va junto a «Quién la realiza», y el del
      // proveedor también cuando no hay una persona elegida (entonces el
      // proveedor es quien la realiza y no tiene campo propio).
      if (porCampo.tecnico && !porCampo.responsable) {
        porCampo.responsable = porCampo.tecnico;
      }
      if (porCampo.proveedor && !conProveedor) {
        porCampo.responsable = [porCampo.responsable, porCampo.proveedor]
          .filter(Boolean)
          .join(" ");
      }
      setErrores(porCampo);
      // Si todo quedó bajo su campo, arriba basta con decir que se revisen;
      // si no, el aviso lleva el motivo completo.
      const todoEnSuCampo =
        Object.keys(porCampo).length > 0 &&
        Object.keys(porCampo).every((campo) => CAMPOS_CON_ERROR.has(campo)) &&
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

  // La propuesta solo se explica mientras la persona sigue elegida: con
  // «Quién la realiza» vacío o a medio corregir, se lee neutra.
  const personaElegida = responsable?.tipo === "persona";
  const propuesto =
    personaElegida &&
    persona?.proveedor &&
    proveedorDePersona?.id === persona.proveedor.id;
  const cargandoCatalogos = !catalogos && !errorCatalogos;

  return (
    <div className="ordenes-page" ref={contenedorRef}>
      <div className="mz-view-head">
        <div>
          <h2>Nueva orden de trabajo</h2>
          <p className="mz-desc">
            Reporte lo que hay que reparar o mantener en una sede, quién lo
            realiza y para cuándo. La orden queda programada con esa fecha.
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
          <div className="row g-4">
            <fieldset className="col-12 ordenes-grupo">
              <legend className="ordenes-grupo__titulo">Qué y dónde</legend>
              <div className="row g-3">
                <Campo
                  id="ot-sede"
                  etiqueta="Sede"
                  obligatorio
                  // Si los catálogos no cargan, se dice junto al campo que
                  // queda vacío y no como un fallo del formulario.
                  error={errores.sede || errorCatalogos}
                  className="col-12 col-md-6"
                >
                  <select
                    className="form-select"
                    value={valores.sede}
                    disabled={cargandoCatalogos}
                    onChange={(evento) => fijar("sede", evento.target.value)}
                  >
                    <option value="">
                      {cargandoCatalogos ? "Cargando…" : "Elija la sede"}
                    </option>
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
                    disabled={cargandoCatalogos}
                    onChange={(evento) =>
                      fijar("categoria", evento.target.value)
                    }
                  >
                    <option value="">
                      {cargandoCatalogos ? "Cargando…" : "Elija"}
                    </option>
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
                    disabled={cargandoCatalogos}
                    onChange={(evento) =>
                      fijar("prioridad", evento.target.value)
                    }
                  >
                    {cargandoCatalogos && (
                      <option value={valores.prioridad}>Cargando…</option>
                    )}
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
                    onChange={(evento) =>
                      fijar("descripcion", evento.target.value)
                    }
                  />
                </Campo>
                <Campo
                  id="ot-telefono"
                  etiqueta="Teléfono de quien reporta"
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
              </div>
            </fieldset>

            <fieldset className="col-12 ordenes-grupo">
              <legend className="ordenes-grupo__titulo">
                Quién y para cuándo
              </legend>
              <div className="row g-3">
                <BuscadorDeResponsable
                  id="ot-responsable"
                  etiqueta="Quién la realiza"
                  obligatorio
                  valor={responsable}
                  onChange={elegirResponsable}
                  onTexto={setTextoResponsable}
                  onRegistrar={(nombre) => abrirRegistro("responsable", nombre)}
                  buscar={buscarResponsables}
                  placeholder="Escriba el nombre del proveedor o de la persona"
                  ayuda="Un proveedor o una persona con cuenta que atiende órdenes."
                  textoVacio={(termino) =>
                    termino
                      ? `Ningún proveedor ni persona coincide con «${termino}». Puede registrar un proveedor nuevo.`
                      : "Todavía no hay proveedores ni personas que atiendan órdenes. Puede registrar un proveedor nuevo."
                  }
                  mensajeSinElegir={RESPONSABLE_SIN_ELEGIR}
                  error={errores.responsable}
                  className="col-12 col-md-8"
                />
                {conProveedor && (
                  <div className="col-12 col-md-8">
                    <div className="ordenes-proveedor-de-persona">
                      <BuscadorDeResponsable
                        id="ot-proveedor"
                        etiqueta="Proveedor (opcional)"
                        valor={proveedorDePersona}
                        onChange={elegirProveedorDePersona}
                        onTexto={setTextoProveedor}
                        onRegistrar={(nombre) =>
                          abrirRegistro("proveedor", nombre)
                        }
                        buscar={buscarProveedores}
                        soloProveedores
                        etiquetaQuitar="Quitar el proveedor"
                        mensajeSinElegir={PROVEEDOR_SIN_ELEGIR}
                        placeholder="Sin proveedor: lo realiza por su cuenta"
                        ayuda={
                          propuesto
                            ? `Propuesto: ${persona.proveedor.nombre} (último proveedor de ${persona.nombre}). Quítelo o cámbielo si esta vez no aplica.`
                            : personaElegida
                              ? `Si ${persona.nombre} la realiza por cuenta de un proveedor, elíjalo; si no, déjelo vacío.`
                              : "Se conserva mientras corrige «Quién la realiza»."
                        }
                        textoVacio={(termino) =>
                          termino
                            ? `Ningún proveedor coincide con «${termino}». Puede registrar un proveedor nuevo.`
                            : "Todavía no hay proveedores. Puede registrar un proveedor nuevo."
                        }
                        error={errores.proveedor}
                      />
                      {avisoVisible && (
                        <p className="ordenes-aviso mz-small" role="status">
                          <Icon name="info-circle" /> {avisoVisible}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <div className="col-12">
                  <button
                    type="button"
                    className="btn btn-outline-primary ordenes-registrar-proveedor"
                    onClick={() =>
                      abrirRegistro(
                        personaElegida ? "proveedor" : "responsable",
                      )
                    }
                  >
                    <Icon name="plus-lg" />
                    {personaElegida
                      ? `Registrar proveedor de ${responsable.nombre}`
                      : "Registrar proveedor nuevo"}
                  </button>
                  <div className="visually-hidden" role="status">
                    {aviso}
                  </div>
                </div>
                <Campo
                  id="ot-fecha"
                  etiqueta="Fecha programada"
                  obligatorio
                  ayuda="El día en que debe cumplirse: hoy o después."
                  error={errores.fecha_programada}
                  className="col-12 col-sm-6 col-md-4"
                >
                  <input
                    type="date"
                    className="form-control"
                    min={hoy}
                    value={valores.fecha_programada}
                    onChange={(evento) =>
                      fijar("fecha_programada", evento.target.value)
                    }
                  />
                </Campo>
              </div>
            </fieldset>

            <div className="col-12 mz-actions justify-content-end ordenes-form-acciones">
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

      {/* Fuera del formulario de la orden: la ventana trae el suyo. */}
      {registro && (
        <RegistrarProveedorDialog
          destino={
            registro.destino === "proveedor" && persona
              ? `Quedará como proveedor de ${persona.nombre} en esta orden.`
              : "Quedará como quien realiza la orden."
          }
          nombreInicial={registro.nombre}
          onCerrar={() => setRegistro(null)}
          onRegistrado={proveedorRegistrado}
        />
      )}
    </div>
  );
}
