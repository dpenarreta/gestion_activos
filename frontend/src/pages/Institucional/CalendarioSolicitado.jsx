import { iso } from "./CalendarioInicio";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function fecha(texto) {
  const [anio, mes, dia] = texto.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

/**
 * Un calendario reducido a las semanas del permiso: los días pedidos
 * marcados y los sábados y domingos destacados, para ver de un vistazo si la
 * solicitud toma fines de semana. Solo de lectura.
 */
export function CalendarioSolicitado({ desde, hasta }) {
  if (!desde || !hasta || hasta < desde) return null;
  const inicio = fecha(desde);
  const fin = fecha(hasta);
  // Del lunes de la semana del primer día al domingo de la del último.
  const lunes = new Date(inicio);
  lunes.setDate(inicio.getDate() - ((inicio.getDay() + 6) % 7));
  const domingo = new Date(fin);
  domingo.setDate(fin.getDate() + ((7 - fin.getDay()) % 7));

  const dias = [];
  for (let d = new Date(lunes); d <= domingo; d.setDate(d.getDate() + 1)) {
    dias.push(new Date(d));
  }
  const semanas = [];
  for (let i = 0; i < dias.length; i += 7) semanas.push(dias.slice(i, i + 7));

  const pedidos = dias.filter((d) => iso(d) >= desde && iso(d) <= hasta);
  const sabados = pedidos.filter((d) => d.getDay() === 6).length;
  const domingos = pedidos.filter((d) => d.getDay() === 0).length;
  const finDeSemana = sabados + domingos;
  const mes = (d) => d.toLocaleDateString("es-EC", { month: "short" });

  return (
    <section className="cal-solicitado" aria-label="Días solicitados">
      <table className="cal-solicitado__tabla">
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Semana</span>
            </th>
            {DIAS.map((d) => (
              <th key={d} scope="col">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semanas.map((semana) => (
            <tr key={iso(semana[0])}>
              <th scope="row" className="cal-solicitado__mes">
                {mes(semana[0])}
              </th>
              {semana.map((d) => {
                const clave = iso(d);
                const pedido = clave >= desde && clave <= hasta;
                const finde = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <td
                    key={clave}
                    className={[
                      "cal-solicitado__dia",
                      pedido && "is-pedido",
                      finde && "is-finde",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-label={`${d.toLocaleDateString("es-EC", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}${pedido ? ", solicitado" : ""}`}
                  >
                    {d.getDate()}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cal-solicitado__resumen">
        {pedidos.length} {pedidos.length === 1 ? "día" : "días"} ·{" "}
        {finDeSemana === 0 ? (
          "ninguno de fin de semana"
        ) : (
          <strong>
            {finDeSemana} de fin de semana (
            {[
              sabados && `${sabados} ${sabados === 1 ? "sábado" : "sábados"}`,
              domingos &&
                `${domingos} ${domingos === 1 ? "domingo" : "domingos"}`,
            ]
              .filter(Boolean)
              .join(" y ")}
            )
          </strong>
        )}
      </p>
    </section>
  );
}
