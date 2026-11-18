"use client";

import { type Upload } from "@/api/uploads.api";
import { LibraryPicker } from "@/components/uploads/LibraryPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** The central upload library in a dialog: pick earlier photos / documents to attach (click toggles). */
export function LibraryDialog({
  open,
  onOpenChange,
  selectedUrls,
  onToggle,
  onUploadNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedUrls: string[];
  onToggle: (upload: Upload) => void;
  /** opens the file picker; new files land in the library too */
  onUploadNew: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Upload library</DialogTitle>
          <DialogDescription>Pick the photos and documents this step should use. Click again to remove.</DialogDescription>
        </DialogHeader>
        <LibraryPicker selectedUrls={selectedUrls} onToggle={onToggle} listClassName="max-h-[50vh]" showEmpty />
        <div className="flex items-center justify-between gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              onUploadNew();
            }}
          >
            Upload new
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done{selectedUrls.filter(Boolean).length > 0 ? ` · ${selectedUrls.filter(Boolean).length} selected` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
