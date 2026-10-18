import { SEOHead } from "@/components/SEOHead";

const Privacy = () => (
  <main className="container py-12 max-w-3xl">
    <SEOHead title="Privacy - Godspeed Mission Control" description="Privacy for this installation." />
    <h1 className="text-3xl font-bold mb-6">Privacy</h1>
    <p className="text-muted-foreground">Your notebook is operated by the person or organization that installed it. Ask that operator about storage, backups, retention and any connected AI or other services. Check the configured services before entering personal information.</p>
  </main>
);

export default Privacy;
