import "./Breadcrumbs.css";

/** Migas de pan estáticas y genéricas: `items: [{ label, path? }]`. */
export function Breadcrumbs({ items }) {
  return (
    <nav aria-label="breadcrumb" className="breadcrumbs">
      <ol className="breadcrumb">
        {items.map((item, index) => (
          <li
            key={item.label}
            className={`breadcrumb-item ${index === items.length - 1 ? "active" : ""}`}
            aria-current={index === items.length - 1 ? "page" : undefined}
          >
            {item.path && index !== items.length - 1 ? (
              <a href={item.path}>{item.label}</a>
            ) : (
              item.label
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
