import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  errorDePrivacidad,
  privacidadService,
} from "../../../api/privacidadService";
import { ThemeContext } from "../../../context/ThemeContext";
import { useAuth } from "../../../hooks/useAuth";
import { TextoDelAviso } from "../../../pages/Privacidad/TextoDelAviso";
import { fijarTituloDePantalla } from "../../../utils/tituloDocumento";
import { LogoMarca } from "../../common/Marca/Marca";
import "./ConsentimientoGate.css";

/**
 * Consentimiento del tratamiento de datos (09/11/2026, portado del
 * `ConsentGate` de Nexo). Mientras la persona no acepte el aviso vigente de la
 * empresa no se pinta la intranet: solo esta pantalla, sin más salida que
 * aceptar o cerrar sesión. Así tampoco salen las consultas de las pantallas
 * de detrás.
 *
 * Lo que falta aceptar llega con la sesión (`GET /auth/me/` →
 * `consentimiento`), con el texto: no hace falta otra consulta. Sin aviso en
 * la empresa no se exige nada.
 */
export function ConsentimientoGate({ children }) {
  const { user } = useAuth();
  const consentimiento = user?.consentimiento;
  if (!consentimiento?.pendiente) return children;
  return <PantallaConsentimiento consentimiento={consentimiento} />;
}

const ID_PISTA = "pv-gate-pista";
const ID_ERROR = "pv-gate-error";

function PantallaConsentimiento({ consentimiento }) {
  const { refreshUser, logout } = useAuth();
  // Sin `useTheme`, que exige el proveedor (como en `PantallaAcceso`).
  const theme = useContext(ThemeContext)?.theme;
  const navigate = useNavigate();
  const titulo = useRef(null);
  const caja = useRef(null);
  const sentinela = useRef(null);
  const temporizador = useRef(null);
  const [acepto, setAcepto] = useState(false);
  const [alFinal, setAlFinal] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  // El foco al título: quien usa lector de pantalla sabe dónde está. Si llega
  // otra versión (el aviso cambió mientras lo leía), vuelve al título.
  useEffect(() => {
    titulo.current?.focus();
    fijarTituloDePantalla("Tratamiento de datos personales");
    return () => fijarTituloDePantalla(null);
  }, [consentimiento.version]);

  useEffect(() => () => clearTimeout(temporizador.current), []);

  // Como en Nexo, marcar la casilla no basta: hay que haber llegado al final
  // del texto. Si el texto entra entero (no desborda), ya se llegó.
  const revisarFinal = useCallback(() => {
    const el = caja.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 4)
      setAlFinal(true);
  }, []);

  // El desbordamiento cambia sin desplazarse (girar el teléfono, maximizar la
  // ventana, el zoom): si solo se mirara al montar y al desplazar, un cuadro
  // que deja de desbordar no dejaría aceptar nunca. Un sentinela al final del
  // texto (visible dentro de la caja = se llegó) y, además, cada cambio de
  // tamaño vuelve a mirar. jsdom no trae los observadores: hay guardas.
  useEffect(() => {
    setAlFinal(false);
    setAcepto(false);
    revisarFinal();
    const el = caja.current;
    const limpiezas = [];
    if (el && typeof window.IntersectionObserver === "function") {
      const io = new window.IntersectionObserver(
        (entradas) => {
          if (entradas.some((e) => e.isIntersecting)) setAlFinal(true);
        },
        { root: el, threshold: 0 },
      );
      if (sentinela.current) io.observe(sentinela.current);
      limpiezas.push(() => io.disconnect());
    }
    if (el && typeof window.ResizeObserver === "function") {
      const ro = new window.ResizeObserver(() => revisarFinal());
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
      limpiezas.push(() => ro.disconnect());
    }
    window.addEventListener("resize", revisarFinal);
    limpiezas.push(() => window.removeEventListener("resize", revisarFinal));
    return () => limpiezas.forEach((fn) => fn());
  }, [consentimiento.texto, revisarFinal]);

  // El mismo mensaje dos veces seguidas no se vuelve a anunciar si la región
  // no cambia: se vacía y se rellena en el siguiente ciclo.
  function mostrarError(mensaje) {
    clearTimeout(temporizador.current);
    setError("");
    temporizador.current = setTimeout(() => setError(mensaje), 50);
  }

  async function aceptar() {
    if (enviando) return;
    if (!alFinal) {
      mostrarError("Lea el aviso hasta el final para poder aceptarlo.");
      caja.current?.focus();
      return;
    }
    if (!acepto) {
      mostrarError("Marque la casilla para aceptar el aviso.");
      return;
    }
    setEnviando(true);
    clearTimeout(temporizador.current);
    setError("");
    try {
      await privacidadService.aceptarAviso(consentimiento.version);
    } catch (err) {
      const e = errorDePrivacidad(err, "No se pudo registrar su aceptación.");
      mostrarError(e.mensaje);
      // El aviso cambió: la sesión trae el texto nuevo para leerlo y aceptarlo.
      if (e.codigo === "aviso_cambiado") await refreshUser().catch(() => null);
      setEnviando(false);
      return;
    }
    // La aceptación ya quedó guardada: si lo que falla es releer la sesión,
    // no hay que volver a aceptar, solo recargar.
    try {
      await refreshUser();
    } catch {
      mostrarError("Su aceptación quedó registrada; recargue la página.");
    } finally {
      setEnviando(false);
    }
  }

  async function salir() {
    await logout();
    navigate("/login", { replace: true });
  }

  const inactivo = !acepto || !alFinal || enviando;

  return (
    <main className="pv-gate">
      <section
        className="pv-gate__tarjeta mz-card"
        aria-labelledby="pv-gate-titulo"
      >
        <div className="pv-gate__marca">
          {theme?.logo_url ? (
            <img
              src={theme.logo_url}
              alt={theme?.site_name || ""}
              className="login-logo"
            />
          ) : (
            // `marca.css` y la hoja del gate eligen la versión según el tema.
            <>
              <LogoMarca version="positivo" />
              <LogoMarca version="negativo" />
            </>
          )}
        </div>
        <h1 id="pv-gate-titulo" ref={titulo} tabIndex={-1}>
          Tratamiento de datos personales
        </h1>
        <p className="mz-desc mb-0">
          Antes de entrar a la intranet, lea y acepte cómo se tratan sus datos
          personales (versión {consentimiento.version} del aviso).
        </p>
        <p className="pv-gate__consecuencia mb-0">
          Si no lo acepta, no podrá usar la intranet. Si tiene dudas, consulte a
          Gestión Humana.
        </p>
        {/* Enfocable: con teclado también se desplaza hasta el final (una
            región con desplazamiento tiene que poder recibir el foco). */}
        <div
          ref={caja}
          className={`pv-gate__texto${alFinal ? "" : " pv-gate__texto--pendiente"}`}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          role="region"
          aria-label="Texto del aviso"
          onScroll={revisarFinal}
        >
          <TextoDelAviso texto={consentimiento.texto} />
          <div ref={sentinela} className="pv-gate__sentinela" aria-hidden />
        </div>
        {!alFinal && (
          <p id={ID_PISTA} className="mz-small mz-faint mb-0">
            Desplácese hasta el final del texto para poder aceptarlo.
          </p>
        )}
        <label className="pv-gate__casilla">
          <input
            type="checkbox"
            className="form-check-input"
            checked={acepto}
            onChange={(e) => setAcepto(e.target.checked)}
            aria-describedby={error ? ID_ERROR : undefined}
          />
          He leído y acepto el tratamiento de mis datos personales
        </label>
        {/* La región existe siempre (vacía): así se anuncia lo que entra. */}
        <div role="alert" id={ID_ERROR} className="pv-gate__error">
          {error && <div className="mz-alert mz-alert--bad mb-0">{error}</div>}
        </div>
        <div className="pv-gate__acciones">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={salir}
          >
            Cerrar sesión
          </button>
          {/* Sin `disabled`: un botón deshabilitado no dice por qué; al
              pulsarlo antes de tiempo, el mensaje lo explica. */}
          <button
            type="button"
            className="btn btn-primary pv-boton-envio"
            onClick={aceptar}
            aria-disabled={inactivo}
            aria-describedby={alFinal ? undefined : ID_PISTA}
          >
            {enviando ? "Registrando…" : "Aceptar y continuar"}
          </button>
        </div>
      </section>
    </main>
  );
}
