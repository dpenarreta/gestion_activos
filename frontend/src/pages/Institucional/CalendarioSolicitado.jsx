import { iso } from "./CalendarioInicio";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function fecha(texto) {
  const [anio, mes, dia] = texto.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

/**
 * Un calendario reducido a las semanas del permiso: los días pedidos
 * marcados y los sábados y domingos destacados, para ver de un vistazo si la
 * solicitud toma fines de semana; y los feriados que caen en esas fechas
 * (`feriados`, AAAA-MM-DD). Solo de lectura.
 */
export function CalendarioSolicitado({ desde, hasta, feriados = [] }) {
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
  const enFeriado = new Set(feriados);
  const feriadosPedidos = pedidos.filter((d) => enFeriado.has(iso(d)));
  const mes = (d) => d.toLocaleDateString("es-EC", { month: "short" });
  // Una semana entre dos meses lleva los dos («oct–nov»), no solo el del
  // lunes (auditoría UX/UI de la revisión, 29/10/2026).
  const mesDeSemana = (semana) => {
    const primero = mes(semana[0]);
    const ultimo = mes(semana[6]);
    return primero === ultimo ? primero : `${primero}–${ultimo}`;
  };
  const diaLargo = (d) =>
    d.toLocaleDateString("es-EC", { day: "numeric", month: "long" });

  return (
    <section className="cal-solicitado" aria-label="Días solicitados">
      <table className="cal-solicitado__tabla">
        <caption className="visually-hidden">
          Las semanas del permiso, con los días solicitados marcados
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Mes</span>
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
                {mesDeSemana(semana)}
              </th>
              {semana.map((d) => {
                const clave = iso(d);
                const pedido = clave >= desde && clave <= hasta;
                const finde = d.getDay() === 0 || d.getDay() === 6;
                const feriado = enFeriado.has(clave);
                return (
                  <td
                    key={clave}
                    className={[
                      "cal-solicitado__dia",
                      pedido && "is-pedido",
                      finde && "is-finde",
                      feriado && "is-feriado",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-label={`${d.toLocaleDateString("es-EC", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}${feriado ? ", feriado" : ""}${pedido ? ", solicitado" : ""}`}
                  >
                    {d.getDate()}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Los días ya están arriba, en los datos: aquí solo lo que el
          calendario aporta (fines de semana y feriados). */}
      <p className="cal-solicitado__resumen">
        {finDeSemana === 0 ? (
          "Ningún día de fin de semana"
        ) : (
          <strong>
            {finDeSemana} {finDeSemana === 1 ? "día" : "días"} de fin de semana
            (
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
        {feriadosPedidos.length > 0 && (
          <>
            {" · "}
            <span className="cal-solicitado__feriados">
              {feriadosPedidos.length === 1
                ? `1 feriado (${diaLargo(feriadosPedidos[0])})`
                : `${feriadosPedidos.length} feriados (${feriadosPedidos
                    .map(diaLargo)
                    .join(", ")})`}
            </span>
          </>
        )}
      </p>
    </section>
  );
}
