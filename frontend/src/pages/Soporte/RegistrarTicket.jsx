import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { aplica, CamposFormulario } from "./Publico/CamposFormulario";
import "./Soporte.css";

const VACIO = {
  nombre: "",
  telefono: "",
  correo: "",
  sede: "",
  area: "",
  categoria: "",
  caso: "",
  descripcion: "",
  impacto: "",
  urgencia: "",
};

/**
 * Registrar un ticket en nombre de quien pide: lo que llega por teléfono,
 * WhatsApp o en persona también entra a la mesa («sin ticket no hay
 * atención»). Usa el mismo formulario que configuró la empresa, más el canal.
 * Quien pidió recibe por correo su número y el enlace de seguimiento.
 */
export function RegistrarTicket() {
  const navigate = useNavigate();
  const [datos, setDatos] = useState(null);
  const [valores, setValores] = useState(VACIO);
  const [adicionales, setAdicionales] = useState({});
  const [canal, setCanal] = useState("telefono");
  const [asignarme, setAsignarme] = useState(false);
  const [archivos, setArchivos] = useState([]);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [creado, setCreado] = useState(null);

  useEffect(() => {
    soporteService
      .formularioInterno()
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el formulario.")),
      );
  }, []);

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
      const campos = {
        ...valores,
        canal,
        asignarme: asignarme ? "true" : "false",
      };
      delete campos.categoria;
      const propios = Object.fromEntries(
        (datos.campos ?? [])
          .filter((c) => !c.base && aplica(c, valores.categoria))
          .filter((c) => adicionales[c.clave] !== undefined)
          .map((c) => [c.clave, adicionales[c.clave]]),
      );
      campos.adicionales = JSON.stringify(propios);
      const ticket = await soporteService.registrar(campos, archivos);
      if (ticket.visible === false) setCreado(ticket);
      else navigate(`/admin/soporte/tickets/${ticket.id}`);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo registrar el ticket."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="soporte-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Registrar ticket</h2>
          <p className="mz-desc">
            Para lo que llega por teléfono, WhatsApp o en persona. Quien pidió
            recibe por correo su número y el enlace para seguirlo.
          </p>
        </div>
        <div className="mz-view-actions">
          <Link
            className="btn btn-outline-secondary btn-sm"
            to="/admin/soporte/bandeja"
          >
            Volver a la bandeja
          </Link>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {creado ? (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          Ticket <strong className="mz-mono">{creado.numero}</strong>{" "}
          registrado; quedó en la cola.
        </div>
      ) : (
        datos && (
          <form className="mz-card" onSubmit={enviar}>
            <div className="mz-card-body row g-3">
              <div className="col-12 col-md-6">
                <label className="form-label" htmlFor="rt-canal">
                  ¿Por dónde llegó?
                </label>
                <select
                  id="rt-canal"
                  className="form-select"
                  value={canal}
                  onChange={(e) => setCanal(e.target.value)}
                >
                  {datos.canales.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <CamposFormulario
                campos={datos.campos}
                datos={datos}
                valores={valores}
                onBase={fijar}
                adicionales={adicionales}
                onAdicional={(clave, valor) =>
                  setAdicionales((actual) => ({ ...actual, [clave]: valor }))
                }
                prefijo="rt"
              />
              <div className="col-12">
                <label className="form-label" htmlFor="rt-adjuntos">
                  Adjuntos (opcional, hasta 3)
                </label>
                <input
                  id="rt-adjuntos"
                  type="file"
                  className="form-control"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
                  onChange={(e) =>
                    setArchivos(Array.from(e.target.files ?? []).slice(0, 3))
                  }
                />
              </div>
              {datos.soy_tecnico && (
                <div className="col-12">
                  <div className="form-check">
                    <input
                      id="rt-asignarme"
                      type="checkbox"
                      className="form-check-input"
                      checked={asignarme}
                      onChange={(e) => setAsignarme(e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="rt-asignarme">
                      Me lo asigno (lo atiendo ahora)
                    </label>
                  </div>
                </div>
              )}
              <div className="col-12 mz-actions justify-content-end">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={enviando}
                >
                  {enviando ? "Registrando…" : "Registrar ticket"}
                </button>
              </div>
            </div>
          </form>
        )
      )}
    </div>
  );
}
