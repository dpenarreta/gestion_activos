import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "../../common/Icon/Icon";
import "./EscanerCamara.css";

/*
 * Lectura con la cámara del teléfono.
 *
 * La pistola es el camino normal en bodega —se comporta como un teclado y
 * teclea el código—, pero no entra en todas partes: un equipo en casa de
 * alguien, una revisión en sitio, un almacén sin lector a mano. Ahí el lector
 * es el teléfono, y para eso existen las etiquetas en QR.
 *
 * Lee **QR y Code 128**: quien tenga el teléfono delante no debería tener que
 * mirar qué simbología lleva pegada el equipo.
 *
 * La librería de decodificación se carga **solo al abrir la cámara**
 * (`import()` dinámico). Son unos cientos de kilobytes que no tiene por qué
 * descargar quien entra al panel desde el escritorio a mirar un listado.
 */
export function EscanerCamara({ onLeer, onCerrar }) {
  const videoRef = useRef(null);
  const controlesRef = useRef(null);
  const [estado, setEstado] = useState("iniciando");
  const [error, setError] = useState(null);

  const detener = useCallback(() => {
    // Soltar la cámara explícitamente: sin esto el piloto del teléfono se
    // queda encendido hasta que se cierra la pestaña, y eso se lee como que
    // la aplicación sigue mirando.
    controlesRef.current?.stop();
    controlesRef.current = null;
    const flujo = videoRef.current?.srcObject;
    if (flujo) {
      flujo.getTracks().forEach((pista) => pista.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    let cancelado = false;

    async function arrancar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        // Pasa en http:// y en navegadores viejos: la cámara solo está
        // disponible en contexto seguro.
        setEstado("no_disponible");
        return;
      }

      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const { BarcodeFormat, DecodeHintType } =
          await import("@zxing/library");

        // Solo los dos formatos que este sistema imprime: buscar los veinte
        // que la librería soporta hace el reconocimiento más lento y más
        // propenso a leer cualquier cosa impresa que haya al lado.
        const pistas = new Map([
          [
            DecodeHintType.POSSIBLE_FORMATS,
            [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128],
          ],
        ]);
        const lector = new BrowserMultiFormatReader(pistas);

        if (cancelado) return;
        setEstado("leyendo");

        controlesRef.current = await lector.decodeFromVideoDevice(
          // `undefined` deja que el navegador elija; con el teléfono en la
          // mano eso es la cámara trasera, que es la que apunta a la etiqueta.
          undefined,
          videoRef.current,
          (resultado) => {
            if (!resultado || cancelado) return;
            detener();
            onLeer(resultado.getText());
          },
        );
      } catch (err) {
        if (cancelado) return;
        setEstado("error");
        setError(
          err?.name === "NotAllowedError"
            ? "No se concedió permiso para usar la cámara. Actívelo en el navegador y vuelva a intentarlo."
            : "No se pudo abrir la cámara. Puede seguir escaneando con la pistola o escribir el código.",
        );
      }
    }

    arrancar();
    return () => {
      cancelado = true;
      detener();
    };
  }, [detener, onLeer]);

  return (
    <div className="escaner-camara">
      <div className="escaner-camara__cabecera">
        <strong>Apunte al código del equipo</strong>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => {
            detener();
            onCerrar();
          }}
        >
          <Icon name="x-lg" /> Cerrar la cámara
        </button>
      </div>

      {estado === "no_disponible" && (
        <div className="mz-alert mz-alert--warn m-0" role="status">
          <Icon name="exclamation-triangle" />
          Este navegador no da acceso a la cámara. Suele pasar al entrar por una
          dirección sin HTTPS; también puede escanear con la pistola o escribir
          el código.
        </div>
      )}

      {error && (
        <div className="mz-alert mz-alert--bad m-0" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {/* `playsInline` es lo que evita que iOS abra el vídeo a pantalla
          completa y tape la pantalla entera al empezar a leer. */}
      <video
        ref={videoRef}
        className={`escaner-camara__video ${
          estado === "leyendo" ? "" : "escaner-camara__video--oculto"
        }`}
        muted
        playsInline
        aria-label="Vista de la cámara para escanear"
      />

      {estado === "leyendo" && (
        <p className="mz-faint mz-small mb-0">
          Lee códigos QR y de barras. Se cierra sola al reconocer uno.
        </p>
      )}
    </div>
  );
}
