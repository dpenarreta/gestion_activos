import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { FormularioMisDatos, queFalta } from "../MisDatos/MisDatosPage";
import { aplica, CamposFormulario } from "../Soporte/Publico/CamposFormulario";
import "../Soporte/Soporte.css";

const VACIO = {
  categoria: "",
  caso: "",
  descripcion: "",
  impacto: "",
  urgencia: "",
};

/** Lo que se sabe de quien pide, sacado de «Mi perfil». */
function SusDatos({ datos, onEditar }) {
  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Sus datos</h3>
        <button
          type="button"
          className="btn btn-link btn-sm"
          onClick={onEditar}
        >
          <Icon name="pencil" /> Actualizar mi perfil
        </button>
      </div>
      <div className="mz-card-body mz-kv-grid">
        <div className="mz-kv">
          <span className="mz-kv-label">Nombre</span>
          {datos.nombre}
        </div>
        <div className="mz-kv">
          <span className="mz-kv-label">Correo</span>
          {datos.correo}
        </div>
        <div className="mz-kv">
          <span className="mz-kv-label">Teléfono</span>
          {datos.telefono}
        </div>
        <div className="mz-kv">
          <span className="mz-kv-label">Área</span>
          {datos.area?.nombre}
        </div>
        <div className="mz-kv">
          <span className="mz-kv-label">Agencia</span>
          {datos.agencia?.nombre}
        </div>
      </div>
    </section>
  );
}

/**
 * «Soporte TI → Nuevo ticket». Solo personas con sesión: su nombre, correo,
 * teléfono, área y agencia salen de «Mi perfil»; si falta algo, se le pide
 * completarlo (y queda guardado) antes de describir el problema.
 */
export function NuevoTicket() {
  const [datos, setDatos] = useState(null);
  const [editando, setEditando] = useState(false);
  const [valores, setValores] = useState(VACIO);
  const [adicionales, setAdicionales] = useState({});
  const [archivos, setArchivos] = useState([]);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [creado, setCreado] = useState(null);

  const cargar = useCallback(() => {
    soporteService
      .solicitar()
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo abrir la mesa de ayuda.")),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function fijar(campo, valor) {
    setValores((actual) => ({
      ...actual,
      [campo]: valor,
      ...(campo === "categoria" ? { caso: "" } : {}),
    }));
  }

  async function enviar(evento) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
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
      setError(mensajeDeError(err, "No se pudo crear el ticket."));
    } finally {
      setEnviando(false);
    }
  }

  if (!datos) {
    return error ? (
      <div className="mz-alert mz-alert--bad" role="alert">
        <Icon name="x-octagon" />
        {error}
      </div>
    ) : (
      <div className="mz-empty">Cargando…</div>
    );
  }

  if (creado) {
    return (
      <section className="mz-card" aria-live="polite">
        <div className="mz-card-body">
          <h3>Recibimos su solicitud</h3>
          <p>
            Su ticket es el <strong className="mz-mono">{creado.numero}</strong>
            .
          </p>
          {creado.estado === "esperando_aprobacion" ? (
            <p>Necesita una aprobación: en cuanto la den, entra a la cola.</p>
          ) : creado.posicion ? (
            <p className="soporte-publico__posicion">
              Posición en la cola: <strong>{creado.posicion}</strong>
            </p>
          ) : (
            <p>Ya lo está atendiendo una persona del equipo de soporte.</p>
          )}
          {creado.fuera_de_horario && (
            <div className="mz-alert mz-alert--warn">
              <Icon name="clock-history" />
              Lo recibimos fuera del horario de atención: quedó en la cola y se
              atenderá a la brevedad el siguiente día hábil.
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
              onClick={() => {
                setCreado(null);
                setValores(VACIO);
                setAdicionales({});
                setArchivos([]);
              }}
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

  return (
    <div className="mz-stack">
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {!datos.disponible ? (
        <div className="mz-alert mz-alert--info">
          <Icon name="info-circle" />
          La mesa de ayuda de esta empresa todavía no está disponible.
        </div>
      ) : faltan.length > 0 || editando ? (
        <section className="mz-card">
          <div className="mz-card-head">
            <h3>
              {faltan.length > 0
                ? "Complete sus datos"
                : "Actualizar mi perfil"}
            </h3>
          </div>
          <div className="mz-card-body">
            {faltan.length > 0 && (
              <div className="mz-alert mz-alert--warn mb-3" role="status">
                <Icon name="exclamation-triangle" />
                Antes de pedir soporte, complete: {queFalta(faltan)}. Queda
                guardado para la próxima vez.
              </div>
            )}
            <FormularioMisDatos
              datos={{
                ...misDatos,
                areas: datos.areas,
                agencias: datos.agencias,
              }}
              textoBoton="Guardar y continuar"
              onGuardado={() => {
                setEditando(false);
                cargar();
              }}
            />
          </div>
        </section>
      ) : (
        <>
          <SusDatos datos={misDatos} onEditar={() => setEditando(true)} />
          <form className="mz-card" onSubmit={enviar}>
            <div className="mz-card-head">
              <h3>¿En qué le ayudamos?</h3>
            </div>
            <div className="mz-card-body row g-3">
              <CamposFormulario
                campos={datos.campos}
                datos={datos}
                valores={valores}
                onBase={fijar}
                adicionales={adicionales}
                onAdicional={(clave, valor) =>
                  setAdicionales((actual) => ({ ...actual, [clave]: valor }))
                }
              />
              <div className="col-12">
                <label className="form-label" htmlFor="sp-adjuntos">
                  Adjuntos (opcional, hasta 3)
                </label>
                <input
                  id="sp-adjuntos"
                  type="file"
                  className="form-control"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
                  onChange={(e) =>
                    setArchivos(Array.from(e.target.files ?? []).slice(0, 3))
                  }
                />
                <div className="form-text">
                  Capturas de pantalla, fotos o documentos; hasta 10 MB cada
                  uno.
                </div>
              </div>
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
          </form>
        </>
      )}
    </div>
  );
}
