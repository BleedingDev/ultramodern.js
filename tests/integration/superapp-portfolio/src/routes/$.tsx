export default function PortfolioDomainRoutePage() {
  const currentPath =
    typeof window === 'undefined'
      ? 'portfolio-domain-route'
      : `${window.location.pathname}${window.location.search}`;

  return (
    <section className="panel" data-testid="domain-route-page">
      <h1>Domain Route</h1>
      <div data-testid="domain-route-kind">portfolio-domain-route</div>
      <div data-testid="domain-route-path">{currentPath}</div>
    </section>
  );
}
