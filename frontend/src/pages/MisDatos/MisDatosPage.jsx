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
import {
  olvidarTextosVigentes,
  useTextoVigente,
} from "../../hooks/useTextoVigente";
import { CLAVES_TEXTO } from "../Privacidad/privacidadComunes";
import { CasillaDeAceptacion } from "./CasillaDeAceptacion";
import { MiAniversario } from "./MiAniversario";
import { MiCargo } from "./MiCargo";
import { MiCumpleanos } from "./MiCumpleanos";
import { MisHerramientas } from "./MisHerramientas";
import { MiSupervision } from "./MiSupervision";
import { MisLlamados } from "./MisLlamados";
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
  // El área también (US-005, 11/11/2026): el rechazo «la cambia Gestión
  // Humana» o «elija un área activa» se entiende junto al campo.
  "area",
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
    area: areaInicial(datos),
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
  // La casilla de la autorización cuando no hay texto: su «Reintentar».
  const casillaTelefono = useRef(null);
  // Ya tiene cargo: lo eligió (o se lo asignaron) y no lo cambia desde aquí.
  const cargoFijo = Boolean(datos.cargo);
  // El área se elige una sola vez, como el cargo (US-005, 11/11/2026): con
  // `area_fija` ya la guardó y solo la cambia Gestión Humana. Se usa la
  // marca del servidor y no si `area` viene vacía: puede venir de nómina sin
  // que la persona la haya guardado.
  const areaFija = Boolean(datos.area_fija);
  // El área que hay en el campo es la del cargo (el elegido ahora o el que ya
  // tenía asignado): se dice con una nota, que desaparece si la persona la
  // cambia.
  const [areaDelCargo, setAreaDelCargo] = useState(
    () => areaInicial(datos) !== (datos.area?.id ?? ""),
  );
  // Elegir el cargo cambió el área (la llenó, la reemplazó o la vació): se
  // dice junto al cargo, que es donde está la persona (auditoría UX,
  // 11/11/2026).
  const [anuncioArea, setAnuncioArea] = useState(null);
  // Lo que se elige una sola vez y cambió: se advierte antes de guardar.
  const eligeCargo = !cargoFijo && valores.cargo !== "";
  const eligeArea =
    !areaFija && String(valores.area) !== String(datos.area?.id ?? "");
  const avisoUnaVez = eligeCargo || eligeArea;
  const fijar = (campo) => (e) =>
    setValores((actual) => ({ ...actual, [campo]: e.target.value }));

  /** Elegir un cargo propone su área (la de su unidad del organigrama o la de
   * la superior). Si el cargo no tiene una, el área queda como estaba. */
  function elegirCargo(e) {
    const cargo = e.target.value;
    const area = areaFija
      ? null
      : (datos.cargos ?? []).find((c) => String(c.id) === cargo)?.area;
    const habia = String(valores.area);
    // Sin área en el cargo nuevo, la que venía del cargo anterior ya no vale:
    // se vacía para que la elija. La elegida a mano se respeta.
    const nueva = area ? String(area.id) : areaDelCargo ? "" : habia;
    setValores((actual) => ({ ...actual, cargo, area: nueva }));
    // Todo cambio del área se anuncia junto al cargo, venga de donde venga
    // (QA-UX N2, 11/11/2026).
    if (habia === nueva) setAnuncioArea(null);
    else if (area)
      setAnuncioArea(`Al elegirlo, su área pasó a «${area.nombre}».`);
    else setAnuncioArea("Este cargo no tiene un área asignada: elíjala.");
    setAreaDelCargo(Boolean(area));
    if (area) setErrores((actual) => ({ ...actual, area: undefined }));
  }

  function elegirArea(e) {
    fijar("area")(e);
    setAreaDelCargo(false);
    setAnuncioArea(null);
    setErrores((actual) => ({ ...actual, area: undefined }));
  }
  const autorizacion = datos.telefono_autorizacion;
  // El texto de la autorización llega con los datos; si no llegó, se pide al
  // catálogo de protección de datos (US-004). Sin texto del servidor no se
  // puede autorizar: no hay respaldo fijo.
  // Si el servidor dice que el texto cambió mientras se leía (400 en
  // `acepta_telefono`), se trae el vigente del catálogo y se pide de nuevo.
  const [textoDelCatalogo, setTextoDelCatalogo] = useState(false);
  const usarCatalogo = textoDelCatalogo || !autorizacion?.texto;
  const textoTelefono = useTextoVigente(
    usarCatalogo ? CLAVES_TEXTO.TELEFONO : null,
  );
  const textoDeAutorizacion = usarCatalogo
    ? textoTelefono.delServidor
      ? textoTelefono.texto
      : ""
    : autorizacion.texto;
  // La versión que se muestra viaja al guardar: si ya no es la vigente, el
  // servidor lo rechaza junto a la casilla.
  const versionTelefono = usarCatalogo
    ? textoTelefono.version
    : (autorizacion?.version ?? null);
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
    if (conTelefono && !textoDeAutorizacion) {
      // Sin el texto del servidor no hay qué autorizar (cargando o no
      // llegó): se dice qué hacer en vez de cortar sin aviso (QA-UX US-004).
      faltan.acepta_telefono = SIN_AUTORIZACION;
    } else if (conTelefono && !valores.acepta_telefono) {
      faltan.acepta_telefono =
        "Para guardar su teléfono personal, marque la autorización.";
    }
    return faltan;
  }

  /** Sin texto de la autorización, el foco va a «Reintentar» (si el texto
   * no llegó) o, mientras carga, al teléfono personal, que es lo que se
   * puede borrar para guardar lo demás. */
  function enfocarSinAutorizacion() {
    requestAnimationFrame(() => {
      const destino =
        casillaTelefono.current?.querySelector("button") ??
        formulario.current?.querySelector("#md-telefono");
      destino?.focus();
    });
  }

  async function guardar(evento) {
    evento.preventDefault();
    const faltan = revisar();
    if (Object.keys(faltan).length > 0) {
      setErrores(faltan);
      setError(null);
      if (faltan.tiene_telefono_corporativo) primeraOpcion.current?.focus();
      else if (faltan.acepta_telefono === SIN_AUTORIZACION) {
        enfocarSinAutorizacion();
      } else enfocarPrimerError(formulario.current);
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
          ...(conTelefono && valores.acepta_telefono && versionTelefono
            ? { version_telefono: versionTelefono }
            : {}),
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
      if (propios.acepta_telefono && conTelefono) {
        // El texto cambió: se trae el nuevo y la casilla vuelve a vacía.
        if (usarCatalogo) textoTelefono.reintentar();
        else {
          olvidarTextosVigentes(CLAVES_TEXTO.TELEFONO);
          setTextoDelCatalogo(true);
        }
        setValores((actual) => ({ ...actual, acepta_telefono: false }));
      }
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
  // Si el texto llega después, el aviso de que faltaba ya no aplica.
  const errorAutorizacion =
    errores.acepta_telefono === SIN_AUTORIZACION && textoDeAutorizacion
      ? undefined
      : errores.acepta_telefono;
  const errorArea = errores.area;
  const descripcionArea =
    [
      errorArea && "md-area-error",
      "md-area-ayuda",
      areaDelCargo && "md-area-nota",
      avisoUnaVez && !areaFija && "md-una-vez",
    ]
      .filter(Boolean)
      .join(" ") || undefined;
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
      {conTelefono && !textoDeAutorizacion && (
        <div className="col-12" ref={casillaTelefono}>
          <CasillaDeAceptacion
            id="md-acepta-telefono"
            vigente={textoTelefono}
            etiquetaNeutra="Autorizo el uso de mi teléfono personal"
            error={errorAutorizacion}
          />
        </div>
      )}
      {conTelefono && textoDeAutorizacion && (
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
              {textoDeAutorizacion}
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
      {/* Cargo y área juntos y en ese orden, en su propia fila: elegir el
          cargo llena el área (auditoría UX, 11/11/2026). */}
      <fieldset className="col-12 mis-datos__puesto">
        <legend className="form-label fw-semibold">Su puesto</legend>
        <div className="row g-3">
          <div className="col-12 col-md-4">
            <label className="form-label" htmlFor="md-cargo">
              Cargo
              <MarcaObligatorio />
            </label>
            {/* Del catálogo del organigrama; obligatorio. Se elige una sola vez:
            después lo cambia Gestión Humana. */}
            <select
              id="md-cargo"
              className="form-select"
              required
              disabled={cargoFijo}
              aria-describedby={[
                "md-cargo-ayuda",
                anuncioArea && "md-cargo-area",
                avisoUnaVez && !cargoFijo && "md-una-vez",
              ]
                .filter(Boolean)
                .join(" ")}
              value={valores.cargo}
              onChange={elegirCargo}
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
              {cargoFijo ? (
                <>
                  <Icon name="lock" /> Si no es el correcto, pídalo a Gestión
                  Humana por la Mesa de ayuda.
                </>
              ) : (
                "Lo elige una sola vez."
              )}
            </div>
            {/* Montado siempre para que el lector anuncie el cambio del área. */}
            <div role="status" aria-live="polite">
              {anuncioArea && (
                <div id="md-cargo-area" className="form-text">
                  <Icon name="arrow-left-right" /> {anuncioArea}
                </div>
              )}
            </div>
          </div>
          <div className="col-12 col-md-4">
            <label className="form-label" htmlFor="md-area">
              Área
              <MarcaObligatorio />
            </label>
            <select
              id="md-area"
              className={`form-select${errorArea ? " is-invalid" : ""}`}
              required
              disabled={areaFija}
              aria-invalid={errorArea ? "true" : undefined}
              aria-describedby={descripcionArea}
              value={valores.area}
              onChange={elegirArea}
            >
              <option value="">Elija su área</option>
              {/* La guardada puede estar inactiva y no venir en la lista: se
              muestra igual, marcada, para que el campo no aparezca vacío
              (QA-FUNC O-4). */}
              {datos.area &&
                !(datos.areas ?? []).some((a) => a.id === datos.area.id) && (
                  <option value={datos.area.id}>
                    {datos.area.nombre} (inactiva)
                  </option>
                )}
              {(datos.areas ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
            {errorArea && (
              <div id="md-area-error" className="invalid-feedback d-block">
                <Icon name="exclamation-circle" /> {errorArea}
              </div>
            )}
            <div id="md-area-ayuda" className="form-text">
              {areaFija ? (
                <>
                  <Icon name="lock" /> Si no es la correcta, pídala a Gestión
                  Humana por la Mesa de ayuda.
                </>
              ) : (
                "La elige una sola vez; revise que sea la de su trabajo."
              )}
            </div>
            {areaDelCargo && (
              <div id="md-area-nota" className="form-text">
                <Icon name="diagram-3" /> Área de su cargo
              </div>
            )}
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
        </div>
      </fieldset>
      {/* No es una alerta: no es un error, y anunciarla interrumpía al elegir
          el cargo. Es la descripción del cargo y del área, que el lector de
          pantalla lee al llegar a ellos (auditoría UX/UI, fase 2, 28/10/2026;
          con el área, US-005). */}
      {avisoUnaVez && (
        <div className="col-12">
          <div className="mz-alert mz-alert--warn">
            <Icon name="exclamation-triangle" />
            <span id="md-una-vez">{textoUnaVez(!cargoFijo, !areaFija)}</span>
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

/** Se guarda con un teléfono personal pero no hay texto de la autorización
 * (cargando o no llegó). */
const SIN_AUTORIZACION =
  "No se pudo cargar la autorización: reintente o borre el teléfono personal para guardar lo demás.";

/** El área con que abre el formulario: la guardada o, si todavía no tiene
 * ninguna, la del cargo que ya le asignaron (QA-FUNC O-1, 11/11/2026). */
function areaInicial(datos) {
  if (datos.area) return datos.area.id;
  if (!datos.area_fija && datos.area_del_cargo) {
    return String(datos.area_del_cargo.id);
  }
  return "";
}

/** El aviso de lo que se elige una sola vez, según lo que todavía puede
 * elegir. Quién lo cambia después y cómo pedirlo es el mismo texto en toda
 * la pantalla (auditoría UX, 11/11/2026). */
function textoUnaVez(cargo, area) {
  if (cargo && area) {
    return (
      <>
        <strong>Revise que su cargo y su área sean los correctos.</strong> Una
        vez guardados, no podrá cambiarlos usted: si no lo son, pídalo a Gestión
        Humana por la Mesa de ayuda.
      </>
    );
  }
  return cargo ? (
    <>
      <strong>Revise que su cargo sea el correcto.</strong> Una vez guardado, no
      podrá cambiarlo usted: si no lo es, pídalo a Gestión Humana por la Mesa de
      ayuda.
    </>
  ) : (
    <>
      <strong>Revise que su área sea la correcta.</strong> Una vez guardada, no
      podrá cambiarla usted: si no lo es, pídala a Gestión Humana por la Mesa de
      ayuda.
    </>
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
                // Al guardarla por primera vez el área queda fija aunque
                // sea la misma que traía de nómina (US-005).
                datos.area_fija,
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
      {datos && <MisLlamados />}
    </>
  );
}
