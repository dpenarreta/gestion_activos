import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { soporteService } from "../../../api/soporteService";
import { Icon } from "../../../components/common/Icon/Icon";
import { mensajeDeError } from "../../../utils/errores";
import { aplica, CamposFormulario } from "./CamposFormulario";
import "./Publico.css";

const VACIO = {
  nombre: "",
  telefono: "",
  correo: "",
  sede: "",
  area: "",
  categoria: "",
  caso: "",
  descripcion: "",
  acepta_datos: false,
  sitio_web: "",
};

/**
 * El formulario público de la mesa de ayuda de una empresa (`/soporte/:codigo`).
 *
 * Lo usa cualquier empleado, de la matriz o de una agencia, sin iniciar
 * sesión. Qué pregunta lo decide cada empresa (menú Mesa de ayuda →
 * Formulario). Al enviarlo ve su número de ticket y su posición en la cola, y le
 * llega por correo el enlace para seguirlo.
 */
export function FormularioSoporte() {
  const { codigo } = useParams();
  const [datos, setDatos] = useState(null);
  const [valores, setValores] = useState(VACIO);
  const [adicionales, setAdicionales] = useState({});
  const [archivos, setArchivos] = useState([]);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [creado, setCreado] = useState(null);

  useEffect(() => {
    soporteService
      .formulario(codigo)
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No encontramos esta mesa de ayuda.")),
      );
  }, [codigo]);

  function fijar(campo, valor) {
    setValores((actual) => ({
      ...actual,
      [campo]: valor,
      // Otra categoría, otros casos: el elegido ya no vale.
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
      // Solo lo de los campos propios que aplican a la categoría elegida.
      const propios = Object.fromEntries(
        (datos.campos ?? [])
          .filter((c) => !c.base && aplica(c, valores.categoria))
          .filter((c) => adicionales[c.clave] !== undefined)
          .map((c) => [c.clave, adicionales[c.clave]]),
      );
      campos.adicionales = JSON.stringify(propios);
      setCreado(await soporteService.crearTicket(codigo, campos, archivos));
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo crear el ticket."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="soporte-publico">
      <div className="soporte-publico__caja">
        <header className="soporte-publico__cabecera">
          <span className="soporte-publico__icono" aria-hidden="true">
            <Icon name="headset" />
          </span>
          <div>
            <h1>Mesa de ayuda de TI</h1>
            {datos && <p className="mz-faint mb-0">{datos.empresa}</p>}
          </div>
        </header>

        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}

        {creado ? (
          <section
            className="mz-card soporte-publico__resultado"
            aria-live="polite"
          >
            <div className="mz-card-body">
              <h2>Recibimos su solicitud</h2>
              <p>
                Su ticket es el{" "}
                <strong className="mz-mono">{creado.numero}</strong>.
              </p>
              {creado.posicion ? (
                <p className="soporte-publico__posicion">
                  Posición en la cola: <strong>{creado.posicion}</strong>
                </p>
              ) : (
                <p>Ya lo está atendiendo una persona del equipo de soporte.</p>
              )}
              {creado.fuera_de_horario && (
                <div className="mz-alert mz-alert--warn">
                  <Icon name="clock-history" />
                  Lo recibimos fuera del horario de atención: quedó en la cola y
                  se atenderá a la brevedad el siguiente día hábil.
                </div>
              )}
              <p className="mz-faint">
                Le enviamos a su correo el enlace para seguirlo, leer las
                respuestas y contestar.
              </p>
              <Link
                className="btn btn-primary"
                to={`/soporte/seguimiento/${creado.token}`}
              >
                Ver mi ticket
              </Link>
            </div>
          </section>
        ) : datos && !datos.disponible ? (
          <div className="mz-alert mz-alert--info">
            <Icon name="info-circle" />
            La mesa de ayuda de esta empresa todavía no está disponible.
          </div>
        ) : (
          datos && (
            <form className="mz-card" onSubmit={enviar}>
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
                {/* Campo trampa contra bots: una persona no lo ve ni lo llena. */}
                <div className="soporte-publico__trampa" aria-hidden="true">
                  <label htmlFor="sp-web">Sitio web</label>
                  <input
                    id="sp-web"
                    tabIndex={-1}
                    autoComplete="off"
                    value={valores.sitio_web}
                    onChange={(e) => fijar("sitio_web", e.target.value)}
                  />
                </div>
                <div className="col-12">
                  <div className="form-check">
                    <input
                      id="sp-datos"
                      type="checkbox"
                      className="form-check-input"
                      required
                      checked={valores.acepta_datos}
                      onChange={(e) => fijar("acepta_datos", e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="sp-datos">
                      Acepto que mis datos se usen solo para atender esta
                      solicitud.
                    </label>
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
          )
        )}
      </div>
    </main>
  );
}
