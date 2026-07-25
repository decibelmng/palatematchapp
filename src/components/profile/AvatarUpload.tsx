import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { updateMyProfile } from "@/lib/friends.functions";

export function AvatarUpload({
  currentUrl,
  initial,
}: {
  currentUrl: string | null | undefined;
  initial: string;
}) {
  const session = useSession();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = () => inputRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !session) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${session.user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = pub.publicUrl;
      await updateMyProfile({ data: { avatar_url: url } });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Photo updated.");
    } catch (err) {
      toast.error((err as Error).message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={pick}
      aria-label="Change profile photo"
      className="relative h-14 w-14 rounded-full overflow-hidden group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {currentUrl ? (
        <img src={currentUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-muted flex items-center justify-center font-serif text-xl">
          {initial}
        </div>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 group-hover:opacity-100 transition">
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
      />
    </button>
  );
}
