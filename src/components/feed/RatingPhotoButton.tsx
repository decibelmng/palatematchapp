// Upload / replace the label photo on one of your own ratings.
// Private bucket, own folder — the same bucket bottle scans already use.
import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { useSetRatingPhoto } from "@/hooks/use-feed-extras";
import { friendlyError } from "@/lib/error-message";
import { downscaleImage } from "@/lib/image-downscale";

export function RatingPhotoButton({
  ratingId,
  hasPhoto,
}: {
  ratingId: string;
  hasPhoto: boolean;
}) {
  const session = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const setPhoto = useSetRatingPhoto();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !session) return;
    setBusy(true);
    try {
      const blob = await downscaleImage(file);
      const path = `${session.user.id}/rating-${ratingId}-${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from("scan-images")
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
      await setPhoto.mutateAsync({ rating_id: ratingId, path });
      toast.success("Photo added.");
    } catch (err) {
      toast.error(friendlyError(err, "Upload failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted-foreground disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
        {hasPhoto ? "Replace photo" : "Add a photo"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
      />
    </>
  );
}
