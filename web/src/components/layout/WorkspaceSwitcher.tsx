"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Loader2, Plus, Settings2 } from "lucide-react";
import { WorkspacesApi } from "@/api/workspaces.api";
import { apiError, getWorkspaceId, setWorkspaceId } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Deterministic tile color per workspace so each brand is recognisable at a glance. */
const TILE = ["bg-primary text-primary-foreground", "bg-iris text-white", "bg-flame text-white", "bg-mint text-background", "bg-honey text-background"];
const tileFor = (id: string) => TILE[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % TILE.length];

/** Switch the page to another workspace: everything on screen belongs to the old one, so reload clean. */
export function switchWorkspace(id: string) {
  setWorkspaceId(id);
  window.location.assign("/dashboard");
}

export function WorkspaceSwitcher() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const list = useQuery({ queryKey: ["workspaces"], queryFn: () => WorkspacesApi.list() });

  // Keep the stored id in sync with what the API resolved (e.g. a deleted workspace falls back).
  useEffect(() => {
    if (list.data && getWorkspaceId() !== list.data.currentId) setWorkspaceId(list.data.currentId);
  }, [list.data]);

  const create = useMutation({
    mutationFn: () => WorkspacesApi.create(name.trim()),
    onSuccess: (ws) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      setCreating(false);
      setName("");
      toast.success(`Workspace “${ws.name}” created`);
      switchWorkspace(ws.id);
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const data = list.data;
  const current = data?.workspaces.find((w) => w.id === data.currentId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Switch workspace"
            className="flex w-full items-center gap-2.5 rounded-2xl border border-sidebar-border bg-background/40 px-2.5 py-2 text-left transition-colors hover:border-iris/50"
          >
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-display text-sm font-bold", current ? tileFor(current.id) : "bg-secondary")}>
              {current?.name.trim()[0]?.toUpperCase() ?? "·"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{current?.name ?? "Workspace"}</span>
              <span className="block text-[10px] text-muted-foreground">
                {data ? `${data.workspaces.length} workspace${data.workspaces.length === 1 ? "" : "s"}` : " "}
              </span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="eyebrow">Workspaces</DropdownMenuLabel>
          {data?.workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onClick={() => w.id !== data.currentId && switchWorkspace(w.id)} className="gap-2.5">
              <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold", tileFor(w.id))}>
                {w.name.trim()[0]?.toUpperCase()}
              </span>
              <span className="truncate">{w.name}</span>
              {w.id === data.currentId && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreating(true)} className="gap-2.5 font-semibold">
            <Plus className="h-3.5 w-3.5" /> New workspace
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="gap-2.5 text-muted-foreground">
            <Link href="/settings?tab=workspaces">
              <Settings2 className="h-3.5 w-3.5" /> Manage workspaces
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              One per brand, store or client — with its own ads, uploads, brand kits and flows.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <Label htmlFor="wsName">Name</Label>
            <Input id="wsName" autoFocus className="mt-1.5" placeholder="e.g. Morning Theory Coffee" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            <DialogFooter className="mt-5">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create workspace
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
