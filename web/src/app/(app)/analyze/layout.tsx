import { notFound } from "next/navigation";
import { ANALYZE_ENABLED } from "@/lib/features";

export default function AnalyzeLayout({ children }: { children: React.ReactNode }) {
  if (!ANALYZE_ENABLED) notFound();
  return children;
}
