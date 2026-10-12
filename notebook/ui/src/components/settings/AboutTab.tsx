import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// What this notebook is made of and whose data it uses (D-321 step 5): the food tracker's values come
// from the German food table BLS 4.0 (CC BY 4.0, which asks that its publisher and citation are named)
// and, for packaged food, from Open Food Facts (ODbL). The same notice lies beside the downloaded table
// in .godspeed/food/bls-4.0/NOTICE.md.
export const BLS_CITATION =
  "Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0, Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0";

export function AboutTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>About this notebook</CardTitle>
          <CardDescription>Godspeed Mission Control is open source under the AGPL-3.0 licence.</CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Food values</CardTitle>
          <CardDescription>Where the food tracker's numbers come from.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Calories, protein, carbohydrates and fat come from the German food table, the
            Bundeslebensmittelschlüssel (BLS) 4.0, published by the Max Rubner-Institut under the licence{" "}
            <a className="underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.
            It is downloaded once from{" "}
            <a className="underline" href="https://www.blsdb.de" target="_blank" rel="noreferrer">blsdb.de</a>{" "}
            and works offline after that. This notebook keeps only the energy and nutrient columns it uses.
          </p>
          <p className="text-muted-foreground">Citation: {BLS_CITATION}</p>
          <p>
            Packaged food looked up by barcode or brand comes from{" "}
            <a className="underline" href="https://openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a>,
            whose database is available under the Open Database License (ODbL) and its contents under the
            Database Contents License. The products looked up are kept on this computer.
          </p>
          <p className="text-muted-foreground">
            The numbers are estimates from these tables. Every entry can be changed in your notebook.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
