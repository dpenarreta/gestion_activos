import { useCallback, useEffect, useState } from "react";

import { tiposDispositivoService } from "../../../api/activosService";
import { politicasService } from "../../../api/politicasService";
import {
  Campo,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { FilaDeEstado } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import {
  erroresPorCampo,
  hayErroresGenerales,
  mensajeDeError,
} from "../../../utils/errores";
import "./Politicas.css";

const VACIO = {
  nombre: "",
  tipo_dispositivo: "",
  max_mantenimientos: "",
  ventana_mantenimientos_meses: "",
  max_componentes_criticos: "",
  vida_util_meses: "",
  vida_util_critica_meses: "",
  activa: true,
};

/**
 * Valores que enuncia el §11 del documento funcional. Se ofrecen como atajo
 * al crear una política, no como valores por defecto: rellenar solo el que
 * falta es distinto de imponerle a la empresa unos umbrales que no eligió.
 */
const UMBRALES_SUGERIDOS = {
  vida_util_meses: "48",
  vida_util_critica_meses: "60",
  max_mantenimientos: "3",
  ventana_mantenimientos_meses: "12",
};

// Un error del servidor sobre estos campos va bajo el campo; sobre otra cosa,
// en el aviso de arriba con su detalle.
const CAMPOS_POLITICA = new Set([
  "nombre",
  "tipo_dispositivo",
  "max_mantenimientos",
  "ventana_mantenimientos_meses",
  "max_componentes_criticos",
  "vida_util_meses",
  "vida_util_critica_meses",
]);

/**
 * Parametrización de los criterios de sustitución (RF-06, §11).
 *
 * Los umbrales están escalonados en dos niveles: la vida útil sugiere
 * «evaluar» el reemplazo y la vida útil crítica lo «recomienda». Con un solo
 * nivel había que elegir entre avisar tarde o llenar la pantalla de alertas
 * que nadie puede atender todas a la vez.
 *
 * Un umbral vacío no significa cero: significa "no evaluar este criterio".
 * Es la distinción más fácil de malinterpretar de todo el módulo —dejar la
 * vida útil en blanco pensando que desactiva la alerta, cuando ponerla en
 * cero la dispararía para todos los equipos—, así que se explica en el
 * formulario y no solo en la documentación.
 */
export function PoliticasList() {
  const puedeEditar = usePermission("politicas.editar");
  const [tipos, setTipos] = useState([]);
  const [enEdicion, setEnEdicion] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [reevaluando, setReevaluando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [errorAccion, setErrorAccion] = useState(null);

  const cargar = useCallback((params) => politicasService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    {},
    "No se pudo cargar el listado de políticas.",
  );

  useEffect(() => {
    tiposDispositivoService
      .list({ page_size: 100 })
      .then((datos) => setTipos(datos.results ?? datos))
      .catch(() => setTipos([]));
  }, []);

  // Reevaluar recorre todo el inventario y tarda: el botón se apaga y dice
  // que está trabajando, para que no se pulse dos veces creyendo que no
  // respondió (revisión final UX/UI, 28/10/2026).
  async function handleReevaluar() {
    setErrorAccion(null);
    setAviso(null);
    setReevaluando(true);
    try {
      const resultado = await politicasService.reevaluar();
      const { recomendado = 0, evaluar = 0 } = resultado.por_nivel ?? {};
      setAviso(
        `${resultado.activos_evaluados} activo(s) evaluados; ${resultado.con_sugerencia} con ` +
          `sugerencia (${recomendado} con reemplazo recomendado, ${evaluar} a evaluar).`,
      );
      listado.refresh();
    } catch (err) {
      setErrorAccion(
        mensajeDeError(err, "No se pudo reevaluar el inventario."),
      );
    } finally {
      setReevaluando(false);
    }
  }

  async function confirmarEliminacion() {
    setEliminando(true);
    try {
      await politicasService.remove(aEliminar.id);
      setAEliminar(null);
      listado.refresh();
    } catch (err) {
      setErrorAccion(mensajeDeError(err, "No se pudo eliminar la política."));
      setAEliminar(null);
    } finally {
      setEliminando(false);
    }
  }

  const hayGlobal = listado.resultados.some((politica) => politica.es_global);

  return (
    <section className="mz-card politicas-panel">
      <div className="mz-card-head">
        <h3>Cuándo se sugiere reemplazar un equipo</h3>
        {puedeEditar && (
          <div className="mz-view-actions">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={handleReevaluar}
              disabled={reevaluando}
            >
              {reevaluando ? (
                <>
                  <span
                    className="spinner-border spinner-border-sm"
                    aria-hidden="true"
                  />{" "}
                  Reevaluando…
                </>
              ) : (
                <>
                  <Icon name="arrow-repeat" /> Reevaluar inventario
                </>
              )}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setEnEdicion(VACIO)}
            >
              <Icon name="plus-lg" /> Nueva política
            </button>
          </div>
        )}
      </div>

      <div className="mz-card-body">
        <p className="mz-faint mb-0">
          Definen cuándo el sistema sugiere reemplazar un equipo. La política de
          un tipo de dispositivo tiene prioridad sobre la global; los tipos sin
          política propia se rigen por ella.
        </p>

        {aviso && (
          <div className="mz-alert mz-alert--ok" role="status">
            <Icon name="check2-circle" />
            <div className="flex-grow-1">{aviso}</div>
            <button
              type="button"
              className="mz-close"
              aria-label="Cerrar"
              onClick={() => setAviso(null)}
            >
              <Icon name="x-lg" />
            </button>
          </div>
        )}
        {errorAccion && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {errorAccion}
          </div>
        )}
        {!listado.isLoading &&
          !listado.error &&
          !hayGlobal &&
          listado.resultados.length > 0 && (
            <div className="mz-alert mz-alert--warn">
              <Icon name="exclamation-triangle" />
              No hay una política global. Los tipos de dispositivo sin política
              propia no se evalúan y nunca mostrarán una sugerencia de
              renovación.
            </div>
          )}
      </div>

      <div className="mz-table-wrap">
        <table className="mz-table mz-table--ancha">
          <thead>
            <tr>
              <th>Política</th>
              <th>Alcance</th>
              <th className="num">Máx. mantenimientos</th>
              <th className="num">Máx. piezas críticas</th>
              <th className="num">Evaluar a los</th>
              <th className="num">Recomendar a los</th>
              <th className="ps-4">Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {/* Cargando, error con reintento y vacío dentro de la tabla: antes
                un fallo mostraba a la vez el error y «Sin políticas
                configuradas» (revisión final UX/UI, 28/10/2026). */}
            <FilaDeEstado
              columnas={8}
              cargando={listado.isLoading && listado.resultados.length === 0}
              error={listado.error}
              onReintentar={listado.refresh}
              vacio={!listado.isLoading && listado.resultados.length === 0}
              textoVacio="Sin políticas configuradas. Ningún equipo mostrará sugerencias de renovación."
            />
            {!listado.error &&
              listado.resultados.map((politica) => (
                <tr key={politica.id}>
                  <td className="mz-strong">{politica.nombre}</td>
                  <td>
                    {politica.es_global ? (
                      <span className="mz-pill mz-pill--neutral">Global</span>
                    ) : (
                      politica.tipo_dispositivo_nombre
                    )}
                  </td>
                  <Umbral
                    valor={politica.max_mantenimientos}
                    nota={
                      politica.ventana_mantenimientos_meses
                        ? `en ${politica.ventana_mantenimientos_meses} meses`
                        : "histórico"
                    }
                  />
                  <Umbral valor={politica.max_componentes_criticos} />
                  <Umbral valor={politica.vida_util_meses} sufijo=" meses" />
                  <Umbral
                    valor={politica.vida_util_critica_meses}
                    sufijo=" meses"
                  />
                  <td className="ps-4">
                    <span
                      className={`mz-pill ${politica.activa ? "mz-pill--ok" : "mz-pill--neutral"}`}
                    >
                      {politica.activa ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td className="acciones">
                    {puedeEditar && (
                      <>
                        <button
                          type="button"
                          className="btn btn-outline-primary btn-sm"
                          onClick={() => setEnEdicion(politica)}
                          aria-label={`Editar ${politica.nombre}`}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => setAEliminar(politica)}
                          aria-label={`Eliminar ${politica.nombre}`}
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {enEdicion && (
        <PoliticaDialog
          politica={enEdicion}
          tipos={tipos}
          hayGlobal={hayGlobal}
          onCerrar={() => setEnEdicion(null)}
          onGuardado={() => {
            setEnEdicion(null);
            listado.refresh();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(aEliminar)}
        title="¿Eliminar la política?"
        confirmLabel="Eliminar política"
        confirmVariant="danger"
        cancelClassName="btn-outline-secondary"
        isLoading={eliminando}
        message={
          aEliminar
            ? aEliminar.es_global
              ? `Se eliminará la política global "${aEliminar.nombre}". Los tipos sin política propia dejarán de evaluarse y sus alertas se apagarán.`
              : `Se eliminará "${aEliminar.nombre}". Los activos de ${aEliminar.tipo_dispositivo_nombre} pasarán a regirse por la política global y se reevaluarán.`
            : ""
        }
        onConfirm={confirmarEliminacion}
        onCancel={() => setAEliminar(null)}
      />
    </section>
  );
}

/** Un umbral vacío se muestra como "no evalúa", no como cero. */
function Umbral({ valor, sufijo = "", nota }) {
  return (
    <td className="num">
      {valor === null || valor === undefined ? (
        <span className="mz-faint mz-small">no evalúa</span>
      ) : (
        <>
          {valor}
          {sufijo}
          {/* El periodo acompaña al número: «3 mantenimientos» significa algo
              muy distinto en 12 meses que en toda la vida del equipo. */}
          {nota && <div className="mz-small mz-faint">{nota}</div>}
        </>
      )}
    </td>
  );
}

function PoliticaDialog({ politica, tipos, hayGlobal, onCerrar, onGuardado }) {
  const esEdicion = Boolean(politica.id);
  const [valores, setValores] = useState({
    nombre: politica.nombre || "",
    tipo_dispositivo: politica.tipo_dispositivo || "",
    max_mantenimientos: politica.max_mantenimientos ?? "",
    ventana_mantenimientos_meses: politica.ventana_mantenimientos_meses ?? "",
    max_componentes_criticos: politica.max_componentes_criticos ?? "",
    vida_util_meses: politica.vida_util_meses ?? "",
    vida_util_critica_meses: politica.vida_util_critica_meses ?? "",
    activa: politica.activa ?? true,
  });
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  /** Cambia un valor y borra el error de ese campo, que ya se está corrigiendo. */
  function actualizar(campo, valor) {
    setValores((actuales) => ({ ...actuales, [campo]: valor }));
    setErrores((actuales) =>
      actuales[campo] ? { ...actuales, [campo]: undefined } : actuales,
    );
  }

  const sinUmbrales =
    valores.max_mantenimientos === "" &&
    valores.max_componentes_criticos === "" &&
    valores.vida_util_meses === "" &&
    valores.vida_util_critica_meses === "";

  // Se avisa antes de guardar, porque el mensaje del servidor llega cuando el
  // usuario ya dio por terminado el formulario.
  const segundoNivelInvertido =
    valores.vida_util_meses !== "" &&
    valores.vida_util_critica_meses !== "" &&
    Number(valores.vida_util_critica_meses) <= Number(valores.vida_util_meses);
  const ventanaSinMaximo =
    valores.ventana_mantenimientos_meses !== "" &&
    valores.max_mantenimientos === "";

  // Solo puede existir una política global; ofrecer la opción cuando ya hay
  // otra produciría un error de restricción al guardar.
  const puedeSerGlobal = !hayGlobal || politica.es_global;

  async function handleSubmit(event) {
    event.preventDefault();
    const formulario = event.currentTarget;
    setIsSaving(true);
    setError(null);
    setErrores({});
    try {
      const payload = {
        nombre: valores.nombre,
        tipo_dispositivo: valores.tipo_dispositivo || null,
        // Cadena vacía significa "no evaluar este criterio": se envía null,
        // que es lo que el backend interpreta como umbral desactivado.
        max_mantenimientos:
          valores.max_mantenimientos === ""
            ? null
            : Number(valores.max_mantenimientos),
        ventana_mantenimientos_meses:
          valores.ventana_mantenimientos_meses === ""
            ? null
            : Number(valores.ventana_mantenimientos_meses),
        max_componentes_criticos:
          valores.max_componentes_criticos === ""
            ? null
            : Number(valores.max_componentes_criticos),
        vida_util_meses:
          valores.vida_util_meses === ""
            ? null
            : Number(valores.vida_util_meses),
        vida_util_critica_meses:
          valores.vida_util_critica_meses === ""
            ? null
            : Number(valores.vida_util_critica_meses),
        activa: valores.activa,
      };
      if (esEdicion) {
        await politicasService.update(politica.id, payload);
      } else {
        await politicasService.create(payload);
      }
      onGuardado();
    } catch (err) {
      // Cada error bajo su campo; el aviso de arriba lleva el detalle si hay
      // alguno que no es de un campo (revisión final UX/UI, 28/10/2026).
      const porCampo = erroresPorCampo(err);
      const claves = Object.keys(porCampo);
      setErrores(porCampo);
      setError(
        claves.length > 0 &&
          claves.every((clave) => CAMPOS_POLITICA.has(clave)) &&
          !hayErroresGenerales(err)
          ? "Revise los campos marcados."
          : mensajeDeError(err, "No se pudo guardar la política."),
      );
      setIsSaving(false);
      enfocarPrimerError(formulario);
    }
  }

  return (
    <ModalDialog
      titulo={esEdicion ? "Editar política" : "Nueva política de renovación"}
      onCerrar={onCerrar}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      puedeConfirmar={
        !sinUmbrales && !segundoNivelInvertido && !ventanaSinMaximo
      }
    >
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="mz-field-grid mb-3">
        <Campo
          id="pol-nombre"
          etiqueta="Nombre"
          obligatorio
          error={errores.nombre}
          className="mz-field"
        >
          <input
            className="form-control"
            maxLength={120}
            placeholder="Laptops corporativas"
            value={valores.nombre}
            onChange={(event) => actualizar("nombre", event.target.value)}
          />
        </Campo>

        <Campo
          id="pol-tipo"
          etiqueta="Se aplica a"
          ayuda="La política de un tipo específico tiene prioridad sobre la global."
          error={errores.tipo_dispositivo}
          className="mz-field"
        >
          <select
            className="form-select"
            value={valores.tipo_dispositivo}
            onChange={(event) =>
              actualizar("tipo_dispositivo", event.target.value)
            }
          >
            <option value="" disabled={!puedeSerGlobal}>
              Todos los tipos (política global)
              {!puedeSerGlobal && " — ya existe una"}
            </option>
            {tipos.map((tipo) => (
              <option key={tipo.id} value={tipo.id}>
                {tipo.nombre}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      {/* Se conserva `row g-3`: los umbrales de mantenimiento van de tres en
          fila, y la rejilla de dos columnas de la identidad los separaría. */}
      <div className="mz-section">
        <h4>Umbrales</h4>
        <div className="mz-alert mz-alert--info mt-0" role="status">
          <Icon name="info-circle" />
          <div>
            Dejar un umbral <strong>vacío</strong> desactiva ese criterio.
            Ponerlo en <strong>cero</strong> es distinto: haría que la alerta se
            dispare siempre.
          </div>
        </div>

        <div className="row g-3">
          <Campo
            id="pol-vida"
            etiqueta="Evaluar reemplazo a los (meses)"
            ayuda="Primer aviso: conviene empezar a mirarlo."
            error={errores.vida_util_meses}
            className="col-md-6"
          >
            <input
              type="number"
              min="0"
              className="form-control"
              placeholder="Sin límite"
              value={valores.vida_util_meses}
              onChange={(event) =>
                actualizar("vida_util_meses", event.target.value)
              }
            />
          </Campo>
          <Campo
            id="pol-vida-critica"
            etiqueta="Recomendar reemplazo a los (meses)"
            ayuda="Segundo aviso: ya toca presupuestarlo."
            error={errores.vida_util_critica_meses}
            className="col-md-6"
          >
            <input
              type="number"
              min="0"
              className="form-control"
              placeholder="Sin segundo nivel"
              value={valores.vida_util_critica_meses}
              onChange={(event) =>
                actualizar("vida_util_critica_meses", event.target.value)
              }
            />
          </Campo>
          <Campo
            id="pol-mant"
            etiqueta="Máx. mantenimientos"
            error={errores.max_mantenimientos}
            className="col-md-4"
          >
            <input
              type="number"
              min="0"
              className="form-control"
              placeholder="Sin límite"
              value={valores.max_mantenimientos}
              onChange={(event) =>
                actualizar("max_mantenimientos", event.target.value)
              }
            />
          </Campo>
          {/* Sin ventana el contador solo sube: un equipo que falló mucho
              hace seis años queda marcado para siempre. */}
          <Campo
            id="pol-ventana"
            etiqueta="Contados en los últimos (meses)"
            ayuda="Vacío = todo el historial del equipo."
            error={errores.ventana_mantenimientos_meses}
            className="col-md-4"
          >
            <input
              type="number"
              min="1"
              className="form-control"
              placeholder="Todo el historial"
              value={valores.ventana_mantenimientos_meses}
              onChange={(event) =>
                actualizar("ventana_mantenimientos_meses", event.target.value)
              }
            />
          </Campo>
          <Campo
            id="pol-criticas"
            etiqueta="Máx. piezas críticas"
            error={errores.max_componentes_criticos}
            className="col-md-4"
          >
            <input
              type="number"
              min="0"
              className="form-control"
              placeholder="Sin límite"
              value={valores.max_componentes_criticos}
              onChange={(event) =>
                actualizar("max_componentes_criticos", event.target.value)
              }
            />
          </Campo>
        </div>

        {!esEdicion && (
          <button
            type="button"
            className="btn btn-link btn-sm px-0 mt-2"
            onClick={() => setValores({ ...valores, ...UMBRALES_SUGERIDOS })}
          >
            Usar los umbrales del documento funcional (48 / 60 meses, 3
            reparaciones en 12 meses)
          </button>
        )}

        {sinUmbrales && (
          <div className="mz-alert mz-alert--warn mb-0">
            <Icon name="exclamation-triangle" />
            Defina al menos un umbral: una política sin ninguno no evaluaría
            nada.
          </div>
        )}
        {segundoNivelInvertido && (
          <div className="mz-alert mz-alert--warn mb-0">
            <Icon name="exclamation-triangle" />
            El segundo nivel debe ser posterior al primero. Al revés,
            «recomendar» absorbería a «evaluar» y el primer aviso no llegaría
            nunca.
          </div>
        )}
        {ventanaSinMaximo && (
          <div className="mz-alert mz-alert--warn mb-0">
            <Icon name="exclamation-triangle" />
            La ventana solo tiene sentido junto a un máximo de mantenimientos.
          </div>
        )}
      </div>

      <div className="form-check">
        <input
          id="pol-activa"
          type="checkbox"
          className="form-check-input"
          checked={valores.activa}
          onChange={(event) =>
            setValores({ ...valores, activa: event.target.checked })
          }
        />
        <label className="form-check-label" htmlFor="pol-activa">
          Política activa
        </label>
        <div className="form-text">
          Desactivar una política de tipo significa «este tipo no se evalúa»; no
          hace que caiga en la global.
        </div>
      </div>
    </ModalDialog>
  );
}
