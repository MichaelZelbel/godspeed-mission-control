import { SEOHead } from "@/components/SEOHead";

const Cookies = () => (
  <main className="container py-12 max-w-3xl">
    <SEOHead title="Cookies - Godspeed Mission Control" description="Cookies for this installation." />
    <h1 className="text-3xl font-bold mb-6">Cookies</h1>
    <p className="text-muted-foreground">This installation uses browser storage for its sign-in and preferences. Its operator is responsible for describing any additional services and their browser storage.</p>
  </main>
);

export default Cookies;
