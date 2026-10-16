import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { plantillasCorreoService } from "../../../api/plantillasCorreoService";
import { Icon } from "../../../components/common/Icon/Icon";
import { useUnsavedChanges } from "../../../context/UnsavedChangesContext";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./PlantillasCorreo.css";

/** Cuánto se espera tras la última tecla para pedir la vista previa. */
const ESPERA_VISTA_PREVIA_MS = 400;

/**
 * Editor de una plantilla de correo.
 *
 * El HTML se escribe o se pega tal cual —un diseño hecho afuera sirve— y los
 * datos de cada envío se ponen con variables (`{{nombre}}`), que se insertan
 * con un clic en la lista. La vista previa usa datos de ejemplo y se dibuja en
 * un `iframe` aislado (`sandbox`): el HTML pegado no puede ejecutar nada en
 * esta página.
 */
export function PlantillaCorreoEditor() {
  const { clave } = useParams();
  const puedeEditar = usePermission("configuracion.editar");
  const { setIsDirty } = useUnsavedChanges();
  const areaRef = useRef(null);
  const ultimoCampoRef = useRef("html");

  const [plantilla, setPlantilla] = useState(null);
  const [asunto, setAsunto] = useState("");
  const [html, setHtml] = useState("");
  const [vista, setVista] = useState(null);
  const [verTexto, setVerTexto] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  function cargarDesde(datos) {
    setPlantilla(datos);
    setAsunto(datos.asunto);
    setHtml(datos.html);
  }

  useEffect(() => {
    plantillasCorreoService
      .get(clave)
      .then(cargarDesde)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar la plantilla.")),
      );
  }, [clave]);

  const hayCambios =
    Boolean(plantilla) &&
    (asunto !== plantilla.asunto || html !== plantilla.html);

  useEffect(() => {
    setIsDirty(hayCambios);
    return () => setIsDirty(false);
  }, [hayCambios, setIsDirty]);

  // Vista previa en vivo, con una pausa para no pedirla en cada tecla.
  useEffect(() => {
    if (!plantilla || !asunto.trim() || !html.trim()) return undefined;
    const temporizador = setTimeout(() => {
      plantillasCorreoService
        .vistaPrevia(clave, { asunto, html })
        .then(setVista)
        .catch(() => setVista(null));
    }, ESPERA_VISTA_PREVIA_MS);
    return () => clearTimeout(temporizador);
  }, [clave, plantilla, asunto, html]);

  /** Inserta la variable donde está el cursor (en el asunto o en el HTML). */
  function insertar(nombre) {
    const marca = `{{${nombre}}}`;
    if (ultimoCampoRef.current === "asunto") {
      setAsunto((actual) => actual + marca);
      return;
    }
    const area = areaRef.current;
    if (!area) {
      setHtml((actual) => actual + marca);
      return;
    }
    const inicio = area.selectionStart ?? html.length;
    const fin = area.selectionEnd ?? html.length;
    const nuevo = html.slice(0, inicio) + marca + html.slice(fin);
    setHtml(nuevo);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(inicio + marca.length, inicio + marca.length);
    });
  }

  async function ejecutar(accion, mensaje) {
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      const resultado = await accion();
      if (resultado?.clave) cargarDesde(resultado);
      setAviso(mensaje ?? resultado?.detail);
    } catch (err) {
      const motivo = err?.response?.data?.motivo;
      setError(
        mensajeDeError(err, "No se pudo completar la acción.") +
          (motivo ? ` Motivo: ${motivo}` : ""),
      );
    } finally {
      setOcupado(false);
    }
  }

  if (!plantilla) {
    return error ? (
      <div className="mz-alert mz-alert--bad" role="alert">
        <Icon name="x-octagon" />
        {error}
      </div>
    ) : (
      <div className="mz-empty">Cargando…</div>
    );
  }

  const comunes = plantilla.variables.filter((v) => v.comun);
  const propias = plantilla.variables.filter((v) => !v.comun);

  return (
    <div className="plantillas-correo">
      <div className="plantillas-correo__cabecera">
        <div>
          <Link
            to="/admin/configuracion/notificaciones/plantillas"
            className="mz-small"
          >
            <Icon name="arrow-left" /> Plantillas de correo
          </Link>
          <h3 className="mt-1 mb-1">
            {plantilla.nombre}{" "}
            <span
              className={`mz-pill ${plantilla.personalizada ? "mz-pill--ok" : "mz-pill--neutral"}`}
            >
              {plantilla.personalizada ? "Personalizado" : "Por defecto"}
            </span>
          </h3>
          <p className="mz-small mz-faint mb-0">
            {plantilla.modulo} · {plantilla.descripcion}
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}

      <div className="plantillas-correo__editor">
        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Diseño</h3>
          </div>
          <div className="mz-card-body">
            <div className="mz-field">
              <label htmlFor="pc-asunto">Asunto</label>
              <input
                id="pc-asunto"
                className="form-control"
                maxLength={255}
                value={asunto}
                disabled={!puedeEditar}
                onFocus={() => {
                  ultimoCampoRef.current = "asunto";
                }}
                onChange={(evento) => setAsunto(evento.target.value)}
              />
            </div>
            <div className="mz-field">
              <label htmlFor="pc-html">HTML del correo</label>
              <textarea
                id="pc-html"
                ref={areaRef}
                className="form-control plantillas-correo__codigo"
                spellCheck={false}
                value={html}
                disabled={!puedeEditar}
                onFocus={() => {
                  ultimoCampoRef.current = "html";
                }}
                onChange={(evento) => setHtml(evento.target.value)}
              />
              <div className="form-text">
                Puede pegar un diseño hecho en otra herramienta. Use estilos en
                línea y tablas: los clientes de correo corporativos ignoran las
                hojas de estilo. Las filas opcionales se escriben entre{" "}
                <code>{"{{#variable}}"}</code> y <code>{"{{/variable}}"}</code>{" "}
                (solo se muestran si la variable tiene valor); con{" "}
                <code>{"{{^variable}}"}</code>, solo si está vacía.
              </div>
            </div>
            {puedeEditar && (
              <div className="mz-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    ocupado || !hayCambios || !asunto.trim() || !html.trim()
                  }
                  onClick={() =>
                    ejecutar(
                      () =>
                        plantillasCorreoService.guardar(clave, {
                          asunto,
                          html,
                        }),
                      "Plantilla guardada. Los próximos correos salen con este diseño.",
                    )
                  }
                >
                  Guardar
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  disabled={ocupado || !hayCambios}
                  onClick={() => {
                    setAsunto(plantilla.asunto);
                    setHtml(plantilla.html);
                  }}
                >
                  Descartar cambios
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  disabled={ocupado}
                  onClick={() => {
                    setAsunto(plantilla.asunto_por_defecto);
                    setHtml(plantilla.html_por_defecto);
                  }}
                >
                  Cargar el diseño por defecto
                </button>
                {plantilla.personalizada && (
                  <button
                    type="button"
                    className="btn btn-outline-danger"
                    disabled={ocupado}
                    onClick={() =>
                      ejecutar(
                        () => plantillasCorreoService.restablecer(clave),
                        "Se restableció el diseño por defecto.",
                      )
                    }
                  >
                    Restablecer
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  disabled={ocupado || hayCambios}
                  title={
                    hayCambios
                      ? "Guarde primero: la prueba usa la plantilla guardada"
                      : undefined
                  }
                  onClick={() =>
                    ejecutar(() => plantillasCorreoService.probar(clave))
                  }
                >
                  Enviarme una prueba
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="mz-card plantillas-correo__vista">
          <div className="mz-card-head">
            <h3>Vista previa</h3>
            <div className="mz-actions">
              <button
                type="button"
                className={`btn btn-sm ${verTexto ? "btn-outline-secondary" : "btn-secondary"}`}
                onClick={() => setVerTexto(false)}
                aria-pressed={!verTexto}
              >
                Correo
              </button>
              <button
                type="button"
                className={`btn btn-sm ${verTexto ? "btn-secondary" : "btn-outline-secondary"}`}
                onClick={() => setVerTexto(true)}
                aria-pressed={verTexto}
              >
                Texto plano
              </button>
            </div>
          </div>
          <div className="mz-card-body">
            {vista ? (
              <>
                <p className="plantillas-correo__asunto">
                  <span className="mz-faint">Asunto:</span> {vista.asunto}
                </p>
                {vista.desconocidas.length > 0 && (
                  <div className="mz-alert mz-alert--warn" role="alert">
                    <Icon name="exclamation-triangle" />
                    Estas variables no existen en este correo y saldrán vacías:{" "}
                    {vista.desconocidas
                      .map((nombre) => `{{${nombre}}}`)
                      .join(", ")}
                  </div>
                )}
                {verTexto ? (
                  <pre className="plantillas-correo__texto">{vista.texto}</pre>
                ) : (
                  <iframe
                    title="Vista previa del correo"
                    className="plantillas-correo__marco"
                    sandbox=""
                    srcDoc={vista.html}
                  />
                )}
                <p className="mz-small mz-faint mb-0">
                  Con datos de ejemplo. La versión en texto plano acompaña al
                  correo para los buzones que no muestran HTML.
                </p>
              </>
            ) : (
              <p className="mz-faint mb-0">
                Escriba el asunto y el HTML para ver la vista previa.
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Variables disponibles</h3>
          <span className="mz-small mz-faint">
            {puedeEditar
              ? "Clic en una para insertarla donde está el cursor"
              : ""}
          </span>
        </div>
        <div className="mz-card-body plantillas-correo__variables">
          <TablaDeVariables
            titulo="De este correo"
            variables={propias}
            puedeEditar={puedeEditar}
            onInsertar={insertar}
          />
          <TablaDeVariables
            titulo="Comunes a todos los correos"
            variables={comunes}
            puedeEditar={puedeEditar}
            onInsertar={insertar}
          />
        </div>
      </section>
    </div>
  );
}

function TablaDeVariables({ titulo, variables, puedeEditar, onInsertar }) {
  return (
    <div>
      <h4 className="mz-small mz-strong">{titulo}</h4>
      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Qué contiene</th>
              <th>Ejemplo</th>
            </tr>
          </thead>
          <tbody>
            {variables.map((variable) => (
              <tr key={variable.nombre}>
                <td>
                  {puedeEditar ? (
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 mz-mono"
                      onClick={() => onInsertar(variable.nombre)}
                      aria-label={`Insertar {{${variable.nombre}}}`}
                    >
                      {`{{${variable.nombre}}}`}
                    </button>
                  ) : (
                    <code>{`{{${variable.nombre}}}`}</code>
                  )}
                </td>
                <td>
                  {variable.descripcion}
                  {variable.html && (
                    <div className="mz-small mz-faint">
                      Bloque HTML que arma el sistema
                    </div>
                  )}
                </td>
                <td className="mz-small mz-faint plantillas-correo__ejemplo">
                  {variable.html ? "(tabla)" : variable.ejemplo || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
