import { SEOHead } from "@/components/SEOHead";

const Impressum = () => (
  <main className="container py-12 max-w-3xl">
    <SEOHead title="Legal notice - Godspeed Mission Control" description="Legal notice for this installation." />
    <h1 className="text-3xl font-bold mb-6">Legal notice</h1>
    <p className="text-muted-foreground">This is a self-hosted Godspeed Mission Control installation. Contact the person or organization operating this installation for its legal notice. The software repository does not identify the operator of an installation.</p>
  </main>
);

export default Impressum;
