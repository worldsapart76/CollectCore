export default function PageContainer({ title, children, className = "" }) {
  return (
    <section className={`page-container ${className}`.trim()}>
      {title ? <h1 className="page-title">{title}</h1> : null}
      <div className="page-body">{children}</div>
    </section>
  );
}