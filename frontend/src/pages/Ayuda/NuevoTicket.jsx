import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import {
  enfocarPrimerError,
  LeyendaObligatorios,
} from "../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import { FormularioMisDatos, queFalta } from "../MisDatos/MisDatosPage";
import {
  aplica,
  CamposFormulario,
  validarCampos,
} from "../Soporte/Publico/CamposFormulario";
import { enLaCola } from "../Soporte/comunes";
import "../Soporte/Soporte.css";

/** Cuántos archivos acepta el servidor por ticket. */
const MAX_ADJUNTOS = 3;

const VACIO = {
  categoria: "",
  caso: "",
  descripcion: "",
  impacto: "",
  urgencia: "",
};

/** Lo que se sabe de quien pide, en una línea al final (antes ocupaba la
 * primera pantalla y el botón de enviar quedaba fuera de la vista). */
function SusDatos({ datos, onEditar }) {
  const partes = [
    datos.nombre,
    datos.correo,
    datos.telefono,
    datos.area?.nombre,
    datos.agencia?.nombre,
  ].filter(Boolean);
  return (
    <p className="soporte-sus-datos mz-small mb-0">
      <Icon name="person-badge" /> Le contactaremos como{" "}
      <strong>{partes.join(" · ")}</strong>.{" "}
      <button
        type="button"
        className="btn btn-link btn-sm p-0 align-baseline"
        onClick={onEditar}
      >
        Cambiar mis datos
      </button>
    </p>
  );
}

/**
 * «Soporte TI → Nuevo ticket». Solo personas con sesión: su nombre, correo,
 * teléfono, área y agencia salen de «Mi perfil»; si falta algo, se le pide
 * completarlo (y queda guardado) antes de describir el problema.
 *
 * Auditoría UX/UI (30/10/2026): primero se cuenta el problema y el sistema
 * sugiere la categoría y el caso; los errores salen bajo cada campo, en
 * «usted», y el del servidor junto al botón; «Cambiar mis datos» se puede
 * cancelar sin perder lo escrito.
 */
export function NuevoTicket() {
  const [datos, setDatos] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [editando, setEditando] = useState(false);
  const [valores, setValores] = useState(VACIO);
  const [adicionales, setAdicionales] = useState({});
  const [archivos, setArchivos] = useState([]);
  const [omitidos, setOmitidos] = useState(0);
  const [llaveArchivos, setLlaveArchivos] = useState(0);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [creado, setCreado] = useState(null);
  const formulario = useRef(null);
  const avisoError = useRef(null);
  const tituloCreado = useRef(null);

  const cargar = useCallback(() => {
    setErrorCarga(null);
    soporteService
      .solicitar()
      .then(setDatos)
      .catch((err) =>
        setErrorCarga(
          mensajeDeError(err, "No se pudo abrir la mesa de ayuda."),
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Al crearlo, el foco va al «Recibimos su solicitud»: el botón pulsado ya
  // no existe y el lector de pantalla no anunciaba la región nueva.
  useEffect(() => {
    if (creado) tituloCreado.current?.focus();
  }, [creado]);

  function fijar(campo, valor) {
    setValores((actual) => ({
      ...actual,
      [campo]: valor,
      ...(campo === "categoria" && actual.categoria !== valor
        ? { caso: "" }
        : {}),
    }));
    if (errores[campo])
      setErrores((actuales) => ({ ...actuales, [campo]: undefined }));
  }

  async function enviar(evento) {
    evento.preventDefault();
    setError(null);
    const faltan = validarCampos(datos.campos, valores, adicionales);
    setErrores(faltan);
    if (Object.keys(faltan).length) {
      enfocarPrimerError(formulario.current);
      return;
    }
    setEnviando(true);
    try {
      const campos = { ...valores };
      delete campos.categoria; // solo sirve para filtrar los casos
      const propios = Object.fromEntries(
        (datos.campos ?? [])
          .filter((c) => !c.base && aplica(c, valores.categoria))
          .filter((c) => adicionales[c.clave] !== undefined)
          .map((c) => [c.clave, adicionales[c.clave]]),
      );
      campos.adicionales = JSON.stringify(propios);
      setCreado(await soporteService.crearTicket(campos, archivos));
    } catch (err) {
      const delServidor = erroresPorCampo(err);
      setErrores(delServidor);
      setError(
        Object.keys(delServidor).length
          ? "Revise los campos marcados."
          : mensajeDeError(err, "No se pudo crear el ticket."),
      );
      // El aviso sale junto al botón y se lleva el foco (antes aparecía
      // arriba, fuera de la vista de quien miraba el botón).
      requestAnimationFrame(() =>
        Object.keys(delServidor).length
          ? enfocarPrimerError(formulario.current)
          : avisoError.current?.focus(),
      );
    } finally {
      setEnviando(false);
    }
  }

  function empezarOtro() {
    setCreado(null);
    setValores(VACIO);
    setAdicionales({});
    setArchivos([]);
    setOmitidos(0);
    setLlaveArchivos((n) => n + 1);
    setErrores({});
  }

  if (!datos) {
    return (
      <EstadoDeCarga
        cargando={!errorCarga}
        error={errorCarga}
        onReintentar={cargar}
      />
    );
  }

  if (creado) {
    return (
      <section className="mz-card">
        <div className="mz-card-body">
          <h3 ref={tituloCreado} tabIndex={-1}>
            <Icon name="check2-circle" /> Recibimos su solicitud
          </h3>
          <p>
            Su ticket es el <strong className="mz-mono">{creado.numero}</strong>
            . Le avisaremos por correo y en la campana cuando le respondan.
          </p>
          {creado.estado === "esperando_aprobacion" ? (
            <p>Necesita una aprobación: en cuanto la den, entra a la cola.</p>
          ) : creado.posicion ? (
            <p className="soporte-publico__posicion">
              {enLaCola(creado.posicion)}
            </p>
          ) : (
            <p>Ya lo está atendiendo una persona del equipo de soporte.</p>
          )}
          {creado.fuera_de_horario && (
            <div className="mz-alert mz-alert--warn">
              <Icon name="clock-history" />
              Lo recibimos fuera del horario de atención: se atenderá a la
              brevedad el siguiente día hábil.
            </div>
          )}
          <div className="mz-actions">
            <Link
              className="btn btn-primary"
              to={`/admin/ayuda/tickets/${creado.id}`}
            >
              Ver mi ticket
            </Link>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={empezarOtro}
            >
              Crear otro
            </button>
          </div>
        </div>
      </section>
    );
  }

  const misDatos = datos.mis_datos;
  const faltan = misDatos.faltan ?? [];

  if (!datos.disponible) {
    return (
      <div className="mz-alert mz-alert--info">
        <Icon name="info-circle" />
        La mesa de ayuda de esta empresa todavía no está disponible.
      </div>
    );
  }

  if (faltan.length > 0 || editando) {
    return (
      <section className="mz-card">
        <div className="mz-card-head">
          <h3>
            {faltan.length > 0 ? "Complete sus datos" : "Cambiar mis datos"}
          </h3>
        </div>
        <div className="mz-card-body">
          {faltan.length > 0 ? (
            <div className="mz-alert mz-alert--warn mb-3" role="status">
              <Icon name="exclamation-triangle" />
              Antes de pedir soporte, complete: {queFalta(faltan)}. Queda
              guardado para la próxima vez.
            </div>
          ) : (
            <p className="mz-small mz-faint">
              Lo que escribió en su solicitud se conserva.
            </p>
          )}
          <FormularioMisDatos
            datos={{
              ...misDatos,
              areas: datos.areas,
              agencias: datos.agencias,
            }}
            textoBoton="Guardar y continuar"
            accionExtra={
              faltan.length === 0 && (
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => setEditando(false)}
                >
                  Cancelar
                </button>
              )
            }
            onGuardado={() => {
              setEditando(false);
              cargar();
            }}
          />
        </div>
      </section>
    );
  }

  return (
    <form
      ref={formulario}
      className="mz-card"
      onSubmit={enviar}
      noValidate
      aria-labelledby="nt-titulo"
    >
      <div className="mz-card-head">
        <h3 id="nt-titulo">¿En qué le ayudamos?</h3>
      </div>
      {/* La fila va dentro del cuerpo: sus márgenes negativos ya no
          desplazan la tarjeta de lado. */}
      <div className="mz-card-body">
        <div className="row g-3">
          <div className="col-12">
            <LeyendaObligatorios />
          </div>
          <CamposFormulario
            campos={datos.campos}
            datos={datos}
            valores={valores}
            onBase={fijar}
            errores={errores}
            describirPrimero
            adicionales={adicionales}
            onAdicional={(clave, valor) => {
              setAdicionales((actual) => ({ ...actual, [clave]: valor }));
              if (errores[clave])
                setErrores((actuales) => ({ ...actuales, [clave]: undefined }));
            }}
          />
          <div className="col-12">
            <label className="form-label" htmlFor="sp-adjuntos">
              Capturas o archivos{" "}
              <span className="mz-faint fw-normal">(opcional, hasta 3)</span>
            </label>
            <input
              key={llaveArchivos}
              id="sp-adjuntos"
              type="file"
              className="form-control"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
              aria-describedby={
                omitidos > 0
                  ? "sp-adjuntos-ayuda sp-adjuntos-aviso"
                  : "sp-adjuntos-ayuda"
              }
              onChange={(e) => {
                const elegidos = Array.from(e.target.files ?? []);
                setArchivos(elegidos.slice(0, MAX_ADJUNTOS));
                setOmitidos(Math.max(0, elegidos.length - MAX_ADJUNTOS));
              }}
            />
            <div id="sp-adjuntos-ayuda" className="form-text">
              Una captura de pantalla ayuda mucho. Fotos, PDF, Word o Excel;
              hasta 10 MB cada uno.
            </div>
            {omitidos > 0 && (
              <div
                id="sp-adjuntos-aviso"
                className="mz-small mz-faint mt-1"
                role="status"
              >
                Máx. {MAX_ADJUNTOS} archivos; se omitieron {omitidos}.
              </div>
            )}
          </div>
          <div className="col-12">
            <SusDatos datos={misDatos} onEditar={() => setEditando(true)} />
          </div>
          {error && (
            <div className="col-12">
              <div
                ref={avisoError}
                className="mz-alert mz-alert--bad mb-0"
                role="alert"
                tabIndex={-1}
              >
                <Icon name="x-octagon" />
                {error}
              </div>
            </div>
          )}
          <div className="col-12 mz-actions justify-content-end">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={enviando}
            >
              {enviando ? "Enviando…" : "Crear ticket"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
