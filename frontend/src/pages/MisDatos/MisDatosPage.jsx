import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";

import { misDatosService } from "../../api/misDatosService";
import {
  enfocarPrimerError,
  LeyendaObligatorios,
} from "../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import {
  erroresPorCampo,
  hayErroresGenerales,
  mensajeDeError,
} from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import { MiAniversario } from "./MiAniversario";
import { MiCargo } from "./MiCargo";
import { MiCumpleanos } from "./MiCumpleanos";
import { MisHerramientas } from "./MisHerramientas";
import { MiSupervision } from "./MiSupervision";
import "./MisDatos.css";

// «Mis derechos» se carga al abrir su pestaña: la mayoría entra al perfil a
// revisar sus datos, no a ejercer un derecho.
const MisDerechos = lazy(() =>
  import("../Privacidad/MisDerechos").then((m) => ({ default: m.MisDerechos })),
);

/** Las pestañas del perfil; `?seccion=mis-derechos` abre la segunda (a ella
 * llevan los avisos de la campana cuando cambia una solicitud). */
const SECCIONES = [
  { id: "mis-datos", etiqueta: "Mis datos", icono: "person-vcard" },
  { id: "mis-derechos", etiqueta: "Mis derechos", icono: "shield-lock" },
];

const NOMBRES = {
  nombre: "nombre y apellido",
  nombres: "nombres",
  apellidos: "apellidos",
  correo: "correo institucional",
  telefono: "teléfono",
  // Falta la respuesta, no un número: «No» también vale (11/11/2026).
  telefono_corporativo: "si tiene teléfono o línea corporativa",
  area: "área",
  agencia: "agencia",
  cargo: "cargo",
};

/** Cada dato obligatorio con su nombre, para listarlos. */
export const DATOS_OBLIGATORIOS = [
  ["nombres", "Nombres"],
  ["apellidos", "Apellidos"],
  ["correo", "Correo institucional"],
  ["telefono_corporativo", "¿Tiene teléfono o línea corporativa?"],
  ["area", "Área"],
  ["agencia", "Agencia"],
  ["cargo", "Cargo"],
];

/** Los campos de los teléfonos: sus errores se muestran junto a ellos y no
 * en el aviso general. */
/** El asterisco de obligatorio, como el de `Campo` (auditoría UX, 11/11/2026:
 * antes solo lo llevaban los teléfonos). */
function MarcaObligatorio() {
  return (
    <>
      <span className="mz-campo__obligatorio" aria-hidden="true">
        {" "}
        *
      </span>
      <span className="visually-hidden"> (obligatorio)</span>
    </>
  );
}

const CAMPOS_PROPIOS = new Set([
  "tiene_telefono_corporativo",
  "telefono_corporativo",
  "telefono",
  "acepta_telefono",
]);

/**
 * El formulario de «Mi perfil». Lo usa su pantalla y, cuando falta algo, la
 * Mesa de ayuda antes de crear un ticket. Al guardar devuelve los datos
 * actualizados (`onGuardado`).
 */
export function FormularioMisDatos({
  datos,
  onGuardado,
  textoBoton = "Guardar",
  accionExtra = null,
}) {
  const [valores, setValores] = useState({
    nombres: datos.nombres ?? "",
    apellidos: datos.apellidos ?? "",
    telefono: datos.telefono ?? "",
    area: datos.area?.id ?? "",
    agencia: datos.agencia?.id ?? "",
    cargo: datos.cargo?.id ?? "",
    // Autoriza guardar su teléfono y que la empresa lo use para contactarlo
    // (LOPDP). Solo hace falta si escribe un teléfono.
    acepta_telefono: Boolean(datos.telefono_autorizacion?.aceptado),
    // El corporativo va aparte del personal (10/11/2026): la pregunta es
    // obligatoria y `null` es «sin responder», así que no se preselecciona.
    // Es un número de la empresa: no pide la autorización de datos
    // personales.
    tiene_telefono_corporativo: datos.tiene_telefono_corporativo ?? null,
    telefono_corporativo: datos.telefono_corporativo ?? "",
  });
  const [error, setError] = useState(null);
  // Los errores que se muestran junto a su campo (los del teléfono
  // corporativo, del navegador o del servidor).
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const formulario = useRef(null);
  // El radio «Sí»: al faltar la respuesta el foco se lleva aquí a mano (el
  // grupo es un `radiogroup` con `aria-invalid`, y cada radio enlaza el
  // motivo).
  const primeraOpcion = useRef(null);
  // Ya tiene cargo: lo eligió (o se lo asignaron) y no lo cambia desde aquí.
  const cargoFijo = Boolean(datos.cargo);
  const avisoCargo = !cargoFijo && valores.cargo !== "";
  const fijar = (campo) => (e) =>
    setValores((actual) => ({ ...actual, [campo]: e.target.value }));
  const autorizacion = datos.telefono_autorizacion;
  const conCorporativo = valores.tiene_telefono_corporativo === true;
  // Uno u otro (11/11/2026): con «Sí» solo el corporativo, obligatorio y sin
  // autorización; con «No» solo el personal, opcional, y solo entonces la
  // autorización de datos personales. Sin responder, ninguno de los dos.
  const sinCorporativo = valores.tiene_telefono_corporativo === false;
  // La autorización se exige solo si escribe un teléfono personal.
  const conTelefono = sinCorporativo && valores.telefono.trim() !== "";

  function responderCorporativo(tiene) {
    setValores((actual) => ({ ...actual, tiene_telefono_corporativo: tiene }));
    setErrores((actual) => ({
      ...actual,
      tiene_telefono_corporativo: undefined,
      telefono_corporativo: undefined,
    }));
  }

  /** Lo que el formulario revisa antes de enviar. El navegador ya frena los
   * campos `required` (y con `onInvalid` el motivo se ve junto al campo), pero
   * la regla debe valer igual si el envío llega sin esa validación. */
  function revisar() {
    const faltan = {};
    if (valores.tiene_telefono_corporativo === null) {
      faltan.tiene_telefono_corporativo =
        "Indique si tiene teléfono o línea corporativa asignada.";
    } else if (conCorporativo && valores.telefono_corporativo.trim() === "") {
      faltan.telefono_corporativo = "Escriba su teléfono corporativo.";
    }
    if (conTelefono && !valores.acepta_telefono) {
      faltan.acepta_telefono =
        "Para guardar su teléfono personal, marque la autorización.";
    }
    return faltan;
  }

  async function guardar(evento) {
    evento.preventDefault();
    const faltan = revisar();
    if (Object.keys(faltan).length > 0) {
      setErrores(faltan);
      setError(null);
      if (faltan.tiene_telefono_corporativo) primeraOpcion.current?.focus();
      else enfocarPrimerError(formulario.current);
      return;
    }
    setGuardando(true);
    setError(null);
    setErrores({});
    try {
      onGuardado?.(
        await misDatosService.guardar({
          ...valores,
          // Solo viaja el teléfono de la respuesta: con «No» el corporativo
          // va vacío y con «Sí», el personal (el servidor hace lo mismo).
          telefono_corporativo: conCorporativo
            ? valores.telefono_corporativo.trim()
            : "",
          telefono: sinCorporativo ? valores.telefono : "",
          acepta_telefono: conTelefono && valores.acepta_telefono,
        }),
      );
    } catch (err) {
      // Los de los teléfonos van junto a su campo; el resto, en el aviso de
      // arriba como antes.
      const porCampo = erroresPorCampo(err);
      const propios = Object.fromEntries(
        Object.entries(porCampo).filter(([campo]) => CAMPOS_PROPIOS.has(campo)),
      );
      setErrores(propios);
      const soloPropios =
        Object.keys(porCampo).length > 0 &&
        Object.keys(porCampo).every((campo) => CAMPOS_PROPIOS.has(campo)) &&
        !hayErroresGenerales(err);
      setError(
        soloPropios
          ? "Revise los campos marcados."
          : mensajeDeError(err, "No se pudieron guardar sus datos."),
      );
      if (propios.tiene_telefono_corporativo) primeraOpcion.current?.focus();
      else enfocarPrimerError(formulario.current);
    } finally {
      setGuardando(false);
    }
  }

  const errorPregunta = errores.tiene_telefono_corporativo;
  const errorCorporativo = errores.telefono_corporativo;
  const errorPersonal = errores.telefono;
  const errorAutorizacion = errores.acepta_telefono;
  // Tenía un número guardado y cambia la respuesta: al guardar se quita.
  const quitaCorporativo =
    sinCorporativo && Boolean(datos.telefono_corporativo);
  const quitaPersonal = conCorporativo && Boolean(datos.telefono);

  return (
    <form className="row g-3" ref={formulario} onSubmit={guardar}>
      <div className="col-12">
        <LeyendaObligatorios />
      </div>
      {error && (
        <div className="col-12">
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        </div>
      )}
      <div className="col-12 col-md-6">
        <label className="form-label" htmlFor="md-nombres">
          Nombres
          <MarcaObligatorio />
        </label>
        <input
          id="md-nombres"
          className="form-control"
          required
          maxLength={150}
          autoComplete="given-name"
          value={valores.nombres}
          onChange={fijar("nombres")}
        />
      </div>
      <div className="col-12 col-md-6">
        <label className="form-label" htmlFor="md-apellidos">
          Apellidos
          <MarcaObligatorio />
        </label>
        <input
          id="md-apellidos"
          className="form-control"
          required
          maxLength={150}
          autoComplete="family-name"
          value={valores.apellidos}
          onChange={fijar("apellidos")}
        />
      </div>
      <div className="col-12 col-md-6">
        <label className="form-label" htmlFor="md-correo">
          Correo institucional
        </label>
        <input
          id="md-correo"
          className={`form-control${
            datos.correo_institucional === false ? " is-invalid" : ""
          }`}
          value={datos.correo}
          disabled
        />
        {datos.correo_institucional === false ? (
          <div className="invalid-feedback d-block">
            No es un correo institucional (@grupolaar.com). Lo corrige la
            administración: pídale que lo cambie en su usuario.
          </div>
        ) : (
          <div className="form-text">
            El de su cuenta: lo cambia la administración.
          </div>
        )}
      </div>
      <div className="col-12 col-md-6">
        <label className="form-label" htmlFor="md-codigo-empleado">
          Código de empleado
        </label>
        <input
          id="md-codigo-empleado"
          className="form-control"
          value={datos.codigo_empleado || "Sin asignar"}
          disabled
        />
        <div className="form-text">Lo asigna Talento Humano.</div>
      </div>
      <div className="col-12">
        <fieldset
          className="mis-datos__pregunta"
          role="radiogroup"
          aria-required="true"
          aria-invalid={errorPregunta ? "true" : undefined}
          aria-describedby={errorPregunta ? "md-corporativo-falta" : undefined}
        >
          <legend className="form-label">
            ¿Tiene teléfono o línea corporativa asignada?
            <MarcaObligatorio />
          </legend>
          <div className="mis-datos__si-no">
            {[
              [true, "Sí", "md-corporativo-si"],
              [false, "No", "md-corporativo-no"],
            ].map(([valor, etiqueta, id]) => (
              <div key={id} className="form-check">
                <input
                  id={id}
                  type="radio"
                  name="tiene_telefono_corporativo"
                  className={`form-check-input${errorPregunta ? " is-invalid" : ""}`}
                  required
                  ref={valor ? primeraOpcion : undefined}
                  aria-describedby={
                    errorPregunta ? "md-corporativo-falta" : undefined
                  }
                  onInvalid={() =>
                    setErrores((actual) => ({
                      ...actual,
                      tiene_telefono_corporativo:
                        revisar().tiene_telefono_corporativo,
                    }))
                  }
                  checked={valores.tiene_telefono_corporativo === valor}
                  onChange={() => responderCorporativo(valor)}
                />
                <label className="form-check-label" htmlFor={id}>
                  {etiqueta}
                </label>
              </div>
            ))}
          </div>
          {errorPregunta && (
            <div
              id="md-corporativo-falta"
              className="invalid-feedback d-block"
              role="alert"
            >
              <Icon name="exclamation-circle" /> {errorPregunta}
            </div>
          )}
          {/* Siempre montado para que el lector anuncie el aviso al aparecer:
              al guardar se pierde un dato (auditoría UX, 11/11/2026). */}
          <div id="md-telefono-quita" role="status" aria-live="polite">
            {(quitaCorporativo || quitaPersonal) && (
              <div className="mz-alert mz-alert--warn mt-2 mb-0">
                <Icon name="exclamation-triangle" />
                {quitaCorporativo
                  ? `Al guardar se quitará el número corporativo ${datos.telefono_corporativo} de su perfil.`
                  : `Al guardar se quitará el teléfono personal ${datos.telefono} de su perfil: con línea corporativa solo se registra esa.`}
              </div>
            )}
          </div>
        </fieldset>
      </div>
      {conCorporativo && (
        <div className="col-12 col-md-6">
          <label className="form-label" htmlFor="md-telefono-corporativo">
            Teléfono corporativo
            <MarcaObligatorio />
          </label>
          <input
            id="md-telefono-corporativo"
            className={`form-control${errorCorporativo ? " is-invalid" : ""}`}
            required
            maxLength={30}
            inputMode="tel"
            autoComplete="work tel"
            aria-invalid={errorCorporativo ? "true" : undefined}
            aria-describedby={
              errorCorporativo
                ? "md-telefono-corporativo-error md-telefono-corporativo-ayuda"
                : "md-telefono-corporativo-ayuda"
            }
            onInvalid={() =>
              setErrores((actual) => ({
                ...actual,
                telefono_corporativo: revisar().telefono_corporativo,
              }))
            }
            value={valores.telefono_corporativo}
            onChange={(e) => {
              fijar("telefono_corporativo")(e);
              setErrores((actual) => ({
                ...actual,
                telefono_corporativo: undefined,
              }));
            }}
          />
          {errorCorporativo && (
            <div
              id="md-telefono-corporativo-error"
              className="invalid-feedback d-block"
            >
              <Icon name="exclamation-circle" /> {errorCorporativo}
            </div>
          )}
          <div id="md-telefono-corporativo-ayuda" className="form-text">
            Es el número que le asignó la empresa (7 a 15 dígitos, por ejemplo
            0991234567). Lo verán sus compañeros en el directorio del chat y lo
            usará la Mesa de ayuda. No requiere su autorización de datos
            personales.
          </div>
        </div>
      )}
      {sinCorporativo && (
        <div className="col-12 col-md-6">
          <label className="form-label" htmlFor="md-telefono">
            Teléfono personal <span className="mz-faint">(opcional)</span>
          </label>
          <input
            id="md-telefono"
            maxLength={30}
            className={`form-control${errorPersonal ? " is-invalid" : ""}`}
            inputMode="tel"
            autoComplete="tel"
            aria-invalid={errorPersonal ? "true" : undefined}
            aria-describedby={
              errorPersonal
                ? "md-telefono-error md-telefono-ayuda"
                : "md-telefono-ayuda"
            }
            value={valores.telefono}
            onChange={(e) => {
              fijar("telefono")(e);
              setErrores((actual) => ({ ...actual, telefono: undefined }));
            }}
          />
          {errorPersonal && (
            <div id="md-telefono-error" className="invalid-feedback d-block">
              <Icon name="exclamation-circle" /> {errorPersonal}
            </div>
          )}
          <div id="md-telefono-ayuda" className="form-text">
            7 a 15 dígitos. Si lo escribe, antes de guardar deberá autorizar el
            uso de su número personal.
          </div>
        </div>
      )}
      {/* La autorización es solo del personal: el corporativo no la pide. */}
      {conTelefono && (
        <div className="col-12">
          <div className="form-check mis-datos__autorizacion">
            <input
              id="md-acepta-telefono"
              type="checkbox"
              className={`form-check-input${errorAutorizacion ? " is-invalid" : ""}`}
              required
              aria-invalid={errorAutorizacion ? "true" : undefined}
              aria-describedby={
                errorAutorizacion ? "md-acepta-telefono-error" : undefined
              }
              onInvalid={() =>
                setErrores((actual) => ({
                  ...actual,
                  acepta_telefono: revisar().acepta_telefono,
                }))
              }
              checked={valores.acepta_telefono}
              onChange={(e) => {
                setValores((actual) => ({
                  ...actual,
                  acepta_telefono: e.target.checked,
                }));
                setErrores((actual) => ({
                  ...actual,
                  acepta_telefono: undefined,
                }));
              }}
            />
            <label className="form-check-label" htmlFor="md-acepta-telefono">
              {autorizacion?.texto ??
                "Autorizo a la empresa a guardar mi número de teléfono personal y a que otras personas de la empresa lo usen para contactarme."}
            </label>
            {errorAutorizacion && (
              <div
                id="md-acepta-telefono-error"
                className="invalid-feedback d-block"
              >
                <Icon name="exclamation-circle" /> {errorAutorizacion}
              </div>
            )}
            {autorizacion?.aceptado && autorizacion.aceptado_en && (
              <div className="form-text">
                Autorizado el {formatearFecha(autorizacion.aceptado_en, true)}.
              </div>
            )}
            {!autorizacion?.aceptado && autorizacion?.version_aceptada && (
              <div className="form-text">
                El texto cambió desde que lo aceptó: para guardar su teléfono,
                acéptelo de nuevo.
              </div>
            )}
          </div>
        </div>
      )}
      <div className="col-12 col-md-4">
        <label className="form-label" htmlFor="md-area">
          Área
          <MarcaObligatorio />
        </label>
        <select
          id="md-area"
          className="form-select"
          required
          value={valores.area}
          onChange={fijar("area")}
        >
          <option value="">Elija su área</option>
          {(datos.areas ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="col-12 col-md-4">
        <label className="form-label" htmlFor="md-agencia">
          Agencia
          <MarcaObligatorio />
        </label>
        <select
          id="md-agencia"
          className="form-select"
          required
          value={valores.agencia}
          onChange={fijar("agencia")}
        >
          <option value="">Elija su agencia</option>
          {(datos.agencias ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="col-12 col-md-4">
        <label className="form-label" htmlFor="md-cargo">
          Cargo
          <MarcaObligatorio />
        </label>
        {/* Del catálogo del organigrama; obligatorio. Se elige una sola vez:
            después lo cambia TI o la administración. */}
        <select
          id="md-cargo"
          className="form-select"
          required
          disabled={cargoFijo}
          aria-describedby={
            avisoCargo ? "md-cargo-ayuda md-cargo-aviso" : "md-cargo-ayuda"
          }
          value={valores.cargo}
          onChange={fijar("cargo")}
        >
          <option value="">
            {(datos.cargos ?? []).length > 0
              ? "Elija su cargo"
              : "Sin cargos disponibles"}
          </option>
          {(datos.cargos ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <div id="md-cargo-ayuda" className="form-text">
          {cargoFijo
            ? "Su cargo solo lo cambia TI o la administración del sistema."
            : "Lo elige una sola vez."}
        </div>
      </div>
      {/* No es una alerta: no es un error, y anunciarla interrumpía al elegir
          el cargo. Es la descripción del campo, que el lector de pantalla lee
          al llegar a él (auditoría UX/UI, fase 2, 28/10/2026). */}
      {avisoCargo && (
        <div className="col-12">
          <div className="mz-alert mz-alert--warn">
            <Icon name="exclamation-triangle" />
            <span id="md-cargo-aviso">
              <strong>Revise que su cargo sea el correcto.</strong> Una vez
              guardado, no podrá cambiarlo usted: solo TI o la administración
              del sistema pueden modificarlo.
            </span>
          </div>
        </div>
      )}
      <div className="col-12 mz-actions justify-content-end">
        {accionExtra}
        <button type="submit" className="btn btn-primary" disabled={guardando}>
          {guardando ? "Guardando…" : textoBoton}
        </button>
      </div>
    </form>
  );
}

/** Lo que falta, en palabras: «teléfono y agencia». */
export function queFalta(faltan = []) {
  const nombres = faltan.map((clave) => NOMBRES[clave] ?? clave);
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
}

/**
 * «Mi perfil» (se abre desde el usuario, abajo en el menú): cada persona
 * revisa y actualiza su nombre, sus teléfonos (corporativo y personal), área
 * y agencia. La Mesa de ayuda
 * los usa para cargar sus tickets por defecto.
 */
export function MisDatosPage() {
  const [parametros, setParametros] = useSearchParams();
  const seccion =
    parametros.get("seccion") === "mis-derechos" ? "mis-derechos" : "mis-datos";

  function cambiarSeccion(id) {
    setParametros(id === "mis-derechos" ? { seccion: id } : {}, {
      replace: true,
    });
  }

  return (
    <div className="mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Mi perfil</h2>
          <p className="mz-desc">
            {seccion === "mis-derechos"
              ? "Lo que la ley le permite pedir sobre sus datos personales, y sus solicitudes."
              : "Su información personal. Con ella se cargan sus pedidos de soporte: manténgala al día."}
          </p>
        </div>
      </div>
      <Pestanas
        etiqueta="Secciones de su perfil"
        idBase="perfil"
        valor={seccion}
        onCambio={cambiarSeccion}
        opciones={SECCIONES}
      />
      <PanelDePestana idBase="perfil" valor={seccion} className="mz-stack">
        {seccion === "mis-derechos" ? (
          <Suspense fallback={<EstadoDeCarga cargando />}>
            <MisDerechos />
          </Suspense>
        ) : (
          <SeccionMisDatos />
        )}
      </PanelDePestana>
    </div>
  );
}

/** La pestaña «Mis datos»: el formulario y lo que cuelga de él. */
function SeccionMisDatos() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(() => {
    setError(null);
    misDatosService
      .obtener()
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar sus datos.")),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <>
      {/* Cargando y error con «Reintentar»; antes la pantalla quedaba en
          blanco mientras llegaban los datos (auditoría UX/UI, fase 2,
          28/10/2026). */}
      <EstadoDeCarga
        cargando={datos === null}
        error={error}
        onReintentar={cargar}
      />
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}
      {datos?.faltan?.length > 0 && !aviso && (
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="exclamation-triangle" />
          Le falta completar: {queFalta(datos.faltan)}.
        </div>
      )}
      {datos && (
        <section className="mz-card">
          <div className="mz-card-body">
            <FormularioMisDatos
              key={JSON.stringify([
                datos.telefono,
                datos.tiene_telefono_corporativo,
                datos.telefono_corporativo,
                datos.area,
                datos.agencia,
              ])}
              datos={datos}
              onGuardado={(nuevos) => {
                setDatos(nuevos);
                setAviso("Sus datos quedaron guardados.");
              }}
            />
          </div>
        </section>
      )}
      {datos && <MiCargo perfil={datos.cargo_perfil} />}
      {datos && <MiSupervision linea={datos.supervision} cargo={datos.cargo} />}
      {datos && <MisHerramientas />}
      {datos && <MiCumpleanos inicial={datos.cumpleanos} />}
      {datos && <MiAniversario inicial={datos.aniversario} />}
    </>
  );
}
