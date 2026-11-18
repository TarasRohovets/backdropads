"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { GenerationsApi } from "@/api/generations.api";
import { apiError } from "@/api/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface CreationRef {
  generationId: string;
  conceptId: string;
  creativeType: string;
}

/** Confirm, then delete one generated image or video. */
export function DeleteCreationDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: CreationRef | null;
  onClose: () => void;
  onDeleted?: (result: { generationDeleted: boolean }) => void;
}) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (t: CreationRef) => GenerationsApi.deleteConcept(t.generationId, t.conceptId),
    onSuccess: (result, t) => {
      qc.invalidateQueries({ queryKey: ["generations"] });
      qc.invalidateQueries({ queryKey: ["generation", t.generationId] });
      toast.success(t.creativeType === "video" ? "Video deleted" : "Image deleted");
      onDeleted?.(result);
    },
    onError: (e) => toast.error(apiError(e).message),
    onSettled: onClose,
  });
  const noun = target?.creativeType === "video" ? "video" : "image";

  return (
    <AlertDialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this {noun}?</AlertDialogTitle>
          <AlertDialogDescription>
            It's removed for good. Ads you already saved from it stay in My Ads.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-flame text-flame-foreground hover:bg-flame/90"
            onClick={(e) => {
              e.preventDefault();
              if (target) remove.mutate(target);
            }}
          >
            {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
