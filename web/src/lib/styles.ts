// Style-inspiration catalog for the create wizard.
// Picking one sends `styleId` to the API; skipping sends nothing.

export interface StyleDef {
  id: string;
  name: string;
  industry: string;
  imageSeed: string;
  palette: [string, string];
}

export const STYLE_INDUSTRIES = [
  "All",
  "E-commerce",
  "Beauty",
  "Fitness",
  "Food & drink",
  "Fashion",
  "SaaS & tech",
  "Home",
  "Travel",
  "UGC",
] as const;

export const STYLES: StyleDef[] = [
  { id: "ecom-spotlight", name: "Clean product spotlight", industry: "E-commerce", imageSeed: "style-spotlight", palette: ["#1A1A22", "#101014"] },
  { id: "ecom-discount-pop", name: "Bold discount pop", industry: "E-commerce", imageSeed: "style-discount", palette: ["#E8422A", "#1C0E0A"] },
  { id: "ecom-lifestyle", name: "Lifestyle in-use", industry: "E-commerce", imageSeed: "style-lifestyle", palette: ["#D98A18", "#201505"] },
  { id: "beauty-editorial", name: "Editorial glow", industry: "Beauty", imageSeed: "style-glow", palette: ["#C98A6B", "#1D120C"] },
  { id: "beauty-clinical", name: "Clinical minimal", industry: "Beauty", imageSeed: "style-clinical", palette: ["#8FB5B0", "#0E1514"] },
  { id: "beauty-before-after", name: "Before & after", industry: "Beauty", imageSeed: "style-beforeafter", palette: ["#B76E79", "#180E10"] },
  { id: "fitness-grit", name: "High-energy grit", industry: "Fitness", imageSeed: "style-grit", palette: ["#E8422A", "#121212"] },
  { id: "fitness-progress", name: "Progress proof", industry: "Fitness", imageSeed: "style-progress", palette: ["#1E9E6A", "#07160F"] },
  { id: "food-closeup", name: "Appetite close-up", industry: "Food & drink", imageSeed: "style-closeup", palette: ["#C24914", "#1B0D05"] },
  { id: "food-cafe", name: "Café warmth", industry: "Food & drink", imageSeed: "style-cafe", palette: ["#C2803E", "#241A12"] },
  { id: "fashion-street", name: "Street style", industry: "Fashion", imageSeed: "style-street", palette: ["#3A3A44", "#101014"] },
  { id: "fashion-runway", name: "Runway minimal", industry: "Fashion", imageSeed: "style-runway", palette: ["#8A8A96", "#141418"] },
  { id: "fashion-noir", name: "Luxury noir", industry: "Fashion", imageSeed: "style-noir", palette: ["#1A1A22", "#000000"] },
  { id: "saas-ui", name: "UI showcase", industry: "SaaS & tech", imageSeed: "style-ui", palette: ["#2E6FB0", "#0A1220"] },
  { id: "saas-data", name: "Data confidence", industry: "SaaS & tech", imageSeed: "style-data", palette: ["#1E9E6A", "#0A1512"] },
  { id: "home-cozy", name: "Cozy interior", industry: "Home", imageSeed: "style-cozy", palette: ["#B08654", "#1C140C"] },
  { id: "home-scandi", name: "Scandinavian calm", industry: "Home", imageSeed: "style-scandi", palette: ["#A7AFA2", "#151713"] },
  { id: "travel-vista", name: "Wanderlust vista", industry: "Travel", imageSeed: "style-vista", palette: ["#2E8FA3", "#0A181C"] },
  { id: "travel-city", name: "City break", industry: "Travel", imageSeed: "style-city", palette: ["#D98A18", "#16120A"] },
  { id: "ugc-selfie", name: "Creator selfie", industry: "UGC", imageSeed: "style-selfie", palette: ["#E86A8A", "#1A0D12"] },
  { id: "ugc-testimonial", name: "Talking testimonial", industry: "UGC", imageSeed: "style-testimonial", palette: ["#4FA3FF", "#0A1220"] },
];

export const styleDef = (id: string | null | undefined): StyleDef | undefined =>
  STYLES.find((s) => s.id === id);
