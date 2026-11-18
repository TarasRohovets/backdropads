"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Workspace } from "@/models";
import { WorkspacesApi } from "@/api/workspaces.api";
import { apiError } from "@/api/client";
import { switchWorkspace } from "@/components/layout/WorkspaceSwitcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

/** Settings → Workspaces: one per brand, store or client. */
export function WorkspacesTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["workspaces"], queryFn: () => WorkspacesApi.list() });
  const [newName, setNewName] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["workspaces"] });

  const create = useMutation({
    mutationFn: () => WorkspacesApi.create(newName.trim()),
    onSuccess: (ws) => {
      setNewName("");
      refresh();
      toast.success(`Workspace “${ws.name}” created`);
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  if (list.isLoading || !list.data) return <Skeleton className="h-64 rounded-3xl" />;
  const { workspaces, currentId } = list.data;

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Workspaces</p>
          <p className="text-sm text-muted-foreground">
            One per brand, store or client — each with its own ads, uploads, brand kits and flows.
          </p>
        </div>
        <span className="rounded-full bg-secondary px-3 py-1 font-mono text-xs">
          {workspaces.length}
        </span>
      </div>

      <ul className="mt-5 divide-y divide-border rounded-2xl border border-border">
        {workspaces.map((w) => (
          <WorkspaceRow key={w.id} workspace={w} current={w.id === currentId} deletable={workspaces.length > 1} onChanged={refresh} />
        ))}
      </ul>

      <form
          className="mt-5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) create.mutate();
          }}
        >
          <Input placeholder="New workspace name — e.g. a brand or client" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} />
          <Button type="submit" disabled={!newName.trim() || create.isPending} className="shrink-0">
            {create.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
            Add
          </Button>
      </form>
    </section>
  );
}

function WorkspaceRow({ workspace, current, deletable, onChanged }: { workspace: Workspace; current: boolean; deletable: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);

  const rename = useMutation({
    mutationFn: () => WorkspacesApi.rename(workspace.id, name.trim()),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const remove = useMutation({
    mutationFn: () => WorkspacesApi.remove(workspace.id),
    onSuccess: () => {
      toast.success(`Deleted “${workspace.name}”`);
      // Deleting the one you're in moves you to the next one.
      if (current) window.location.assign("/dashboard");
      else onChanged();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) rename.mutate();
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-9" />
          <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={!name.trim() || rename.isPending} aria-label="Save name">
            <Check className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setEditing(false)} aria-label="Cancel">
            <X className="h-4 w-4" />
          </Button>
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-sm font-semibold">
              {workspace.name}
              {current && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">Current</span>}
            </p>
            <p className="text-[11px] text-muted-foreground">Created {format(new Date(workspace.createdAt), "MMM d, yyyy")}</p>
          </div>
          {!current && (
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => switchWorkspace(workspace.id)}>
              Switch
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(true)} aria-label={`Rename ${workspace.name}`}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {deletable && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-flame hover:text-flame"
              disabled={remove.isPending}
              aria-label={`Delete ${workspace.name}`}
              onClick={() => {
                if (window.confirm(`Delete “${workspace.name}” and everything in it (ads, brand kits, flows)? This can't be undone.`)) remove.mutate();
              }}
            >
              {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          )}
        </>
      )}
    </li>
  );
}
