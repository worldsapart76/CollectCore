export default function FilterSection({ title, children }) {
  return (
    <section className="filter-section">
      <div className="filter-section-title">{title}</div>
      <div className="filter-section-body">{children}</div>
    </section>
  );
}