"use client";

import { use } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { FlowsApi } from "@/api/flows.api";
import { Button } from "@/components/ui/button";

// The board is canvas-heavy and browser-only — load it client-side.
const FlowBoard = dynamic(() => import("@/components/flows/FlowBoard").then((m) => m.FlowBoard), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

export default function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Load once; the board owns the state from here and autosaves.
  const flow = useQuery({ queryKey: ["flow", id], queryFn: () => FlowsApi.get(id), staleTime: Infinity, refetchOnMount: "always" });

  if (flow.isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (flow.isError || !flow.data) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <h1 className="font-display text-xl font-bold">Flow not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">It may have been deleted, or the API isn't running.</p>
        <Button asChild className="mt-6">
          <Link href="/flows">All flows</Link>
        </Button>
      </div>
    );
  }

  return <FlowBoard key={flow.data.id} flow={flow.data} />;
}
