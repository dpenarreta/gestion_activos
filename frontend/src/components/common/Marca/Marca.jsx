import iconoLce from "../../../assets/marca/lce.png";
import logoNegativo from "../../../assets/marca/laarcourier-negativo.png";
import logoPositivo from "../../../assets/marca/laarcourier-positivo.png";

/**
 * El logotipo de LAARCOURIER en sus versiones a color del Brand Book 2026
 * (página 10): «positivo» —letras negras— para fondos claros y «negativo»
 * —letras blancas— para el carbón. La estela es amarilla en las dos. El manual
 * no deja cambiarle el color, el borde, la orientación ni la proporción: aquí
 * solo se elige la versión, y `marca.css` fija el alto.
 *
 * Es lo que se muestra cuando Configuración → Identidad no trae un logo
 * propio (`logo_url`).
 */
const VERSIONES = { positivo: logoPositivo, negativo: logoNegativo };

export function LogoMarca({ version = "positivo", alt = "LAARCOURIER" }) {
  return (
    <img
      src={VERSIONES[version]}
      alt={alt}
      className={`marca-logo marca-logo--${version}`}
    />
  );
}

/**
 * El ícono LCE (página 7 del manual), para donde no cabe el logotipo: el menú
 * lateral contraído. El manual no lo deja junto al logotipo en una misma
 * composición.
 */
export function IconoMarca({ alt = "" }) {
  return <img src={iconoLce} alt={alt} className="marca-icono" />;
}
