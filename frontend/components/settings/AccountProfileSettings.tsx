"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { BadgeCheck, Camera, Check, Copy, Loader2, Pencil, RotateCcw, X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { useAuth } from "@/lib/auth-context";
import { useProfile } from "@/lib/profile-context";

function metadataName(metadata?: Record<string, unknown>) {
  const fullName = metadata?.full_name;
  const name = metadata?.name;
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  if (typeof name === "string" && name.trim()) return name.trim();
  return "";
}

function readFileAsImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Unable to read image."));
    reader.onload = () => {
      image.onload = () => {
        const maxSize = 512;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Unable to prepare avatar preview."));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.onerror = () => reject(new Error("Choose a valid image file."));
      image.src = String(reader.result || "");
    };

    reader.readAsDataURL(file);
  });
}

export function AccountProfileSettings() {
  const { user } = useAuth();
  const { error: profileError, loading, profile, refreshProfile, updateProfile } = useProfile();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [handleDraft, setHandleDraft] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [savingHandle, setSavingHandle] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const displayName = profile?.display_name || metadataName(user?.user_metadata) || user?.email || "Omnix user";
  const email = profile?.email || user?.email || "";
  const avatarUrl = removeAvatar ? null : avatarPreview || profile?.avatar_url || null;
  const handle = profile?.username || profile?.handle || "";

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  useEffect(() => {
    setHandleDraft(handle);
  }, [handle]);

  async function saveName() {
    const nextName = nameDraft.trim();
    if (!nextName) {
      setError("Display name cannot be empty.");
      return;
    }

    try {
      setSavingName(true);
      setError(null);
      await updateProfile({ display_name: nextName });
      setEditingName(false);
      setMessage("Display name updated.");
      window.setTimeout(() => setMessage(null), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save display name.");
    } finally {
      setSavingName(false);
    }
  }

  async function saveHandle() {
    const nextHandle = handleDraft.trim().replace(/^@/, "").toLowerCase();
    if (!nextHandle) {
      setError("Choose a handle before saving.");
      return;
    }

    try {
      setSavingHandle(true);
      setError(null);
      await updateProfile({ username: nextHandle });
      setMessage("Handle reserved.");
      window.setTimeout(() => setMessage(null), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reserve handle.");
    } finally {
      setSavingHandle(false);
    }
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Avatar image must be under 4 MB.");
      return;
    }

    try {
      setError(null);
      const dataUrl = await readFileAsImage(file);
      setAvatarPreview(dataUrl);
      setRemoveAvatar(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to prepare avatar.");
    } finally {
      event.target.value = "";
    }
  }

  async function saveAvatar() {
    try {
      setSavingAvatar(true);
      setError(null);
      await updateProfile(removeAvatar ? { remove_avatar: true } : { avatar_url: avatarPreview });
      setAvatarPreview(null);
      setRemoveAvatar(false);
      setMessage("Avatar updated.");
      window.setTimeout(() => setMessage(null), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save avatar.");
    } finally {
      setSavingAvatar(false);
    }
  }

  async function copyHandle() {
    if (!handle || !navigator.clipboard) return;
    await navigator.clipboard.writeText(`@${handle}`);
    setMessage("Handle copied.");
    window.setTimeout(() => setMessage(null), 1600);
  }

  const avatarChanged = Boolean(avatarPreview || removeAvatar);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="omnix-cinematic-card p-5">
        <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-start">
          <ProfileAvatar
            name={displayName}
            email={email}
            handle={handle}
            avatarUrl={avatarUrl}
            className="h-20 w-20 border-cyan-300/25 bg-cyan-300/10 text-xl text-cyan-50"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-400">Display name</p>
                {editingName ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      disabled={savingName}
                      className="h-10"
                      aria-label="Display name"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" leftIcon={<Check className="h-4 w-4" />} isLoading={savingName} onClick={saveName}>
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        leftIcon={<X className="h-4 w-4" />}
                        disabled={savingName}
                        onClick={() => {
                          setNameDraft(displayName);
                          setEditingName(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-3">
                    <h3 className="truncate text-lg font-semibold text-white">{displayName}</h3>
                    <Button type="button" size="sm" variant="secondary" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditingName(true)}>
                      Edit
                    </Button>
                  </div>
                )}
              </div>
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-medium text-emerald-100">
                <BadgeCheck className="h-3.5 w-3.5" />
                Authenticated
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--omnix-border)] bg-black/15 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Email</p>
                <p className="mt-2 break-all text-sm text-slate-200">{email || "No email available"}</p>
              </div>
              <div className="rounded-lg border border-[var(--omnix-border)] bg-black/15 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Omnix handle</p>
                  {handle ? (
                    <button type="button" onClick={copyHandle} className="text-slate-500 transition hover:text-cyan-200" aria-label="Copy handle">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                {handle ? (
                  <p className="mt-2 font-mono text-sm text-cyan-100">@{handle}</p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={handleDraft}
                      onChange={(event) => setHandleDraft(event.target.value)}
                      placeholder="alex-morgan"
                      className="h-10"
                      disabled={savingHandle}
                      aria-label="Choose Omnix handle"
                    />
                    <Button type="button" size="sm" isLoading={savingHandle} onClick={saveHandle}>
                      Reserve
                    </Button>
                  </div>
                )}
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Handles are unique and can be used to invite teammates.
                </p>
              </div>
            </div>

            {error || profileError ? (
              <Alert className="mt-5" variant="error" title="Profile update failed">
                {error || profileError}
              </Alert>
            ) : null}
            {message ? (
              <Alert className="mt-5" variant="success" title="Saved">
                {message}
              </Alert>
            ) : null}
          </div>
        </div>
      </section>

      <aside className="omnix-cinematic-card p-5">
        <div className="relative z-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">Profile picture</h3>
            <p className="mt-1 text-sm leading-5 text-slate-400">Used in chat, team rosters, and the top bar.</p>
          </div>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : null}
        </div>

        <div className="mt-5 flex items-center gap-4">
          <ProfileAvatar
            name={displayName}
            email={email}
            handle={handle}
            avatarUrl={avatarUrl}
            className="h-16 w-16 border-cyan-300/25 bg-cyan-300/10 text-lg text-cyan-50"
          />
          <div className="space-y-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            <Button type="button" size="sm" variant="secondary" leftIcon={<Camera className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
              Upload
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              leftIcon={<RotateCcw className="h-4 w-4" />}
              onClick={() => {
                setAvatarPreview(null);
                setRemoveAvatar(true);
              }}
            >
              Reset
            </Button>
          </div>
        </div>

        {avatarChanged ? (
          <div className="mt-5 flex gap-2">
            <Button type="button" size="sm" isLoading={savingAvatar} onClick={saveAvatar}>
              Save avatar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={savingAvatar}
              onClick={() => {
                setAvatarPreview(null);
                setRemoveAvatar(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null}

        <Button type="button" variant="ghost" size="sm" className="mt-5" onClick={() => void refreshProfile()}>
          Refresh profile
        </Button>
        </div>
      </aside>
    </div>
  );
}
