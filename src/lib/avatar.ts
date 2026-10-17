import { supabase } from "@/lib/supabase";

/**
 * Avatar upload: the `avatars` bucket, the `profiles.avatar_path` reference, and the
 * order those two are written in.
 *
 * ## Why the column stores a path and not a URL
 *
 * The bucket is public, so the URL is derived from the path on every read
 * (`avatarUrlFromPath`). Storing a URL instead would be the obvious thing and it is
 * wrong here for one specific reason: the moment the bucket is made private — which is
 * the decision this module is waiting on — every stored URL becomes a dead link, and the
 * repair is a migration over rows nobody can enumerate from the app. A path survives
 * that change untouched.
 *
 * ## SVG is refused, and the reason is not aesthetic
 *
 * `image/svg+xml` is a document that can carry `<script>`. Serving one from a bucket the
 * whole internet can read is how a stored-XSS lands in an app that has no reason to
 * trust its own storage. PNG, JPEG and WebP cannot carry script, so those three are the
 * whole whitelist.
 *
 * ## The extension is derived from the MIME type, never from `file.name`
 *
 * `file.name` is a string the user chose, and `name.split('.').pop()` is how `../` gets
 * into an object key. The map below is the only source of an extension here.
 *
 * ## The order of the two writes
 *
 * Upload, then reference, then delete the old object — and never a different order.
 *
 * **Deleting the old object first would lose the avatar** if the upload then failed.
 * Uploading first means the worst case is an orphaned object that nobody references,
 * which costs storage and nothing else.
 *
 * The failure that matters is the middle step: the file is in the bucket but
 * `avatar_path` was not written, so the avatar did not change while the app says it did.
 * That is reported as its own outcome rather than as a generic failure — the same
 * reasoning `reset-password` uses for `mustChangeFlagSet`, where a partly-applied change
 * must not be described as "nothing happened".
 */
export const AVATAR_BUCKET = "avatars";

/** MIME type to the extension we are willing to write. */
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * 2 MB, chosen rather than inherited.
 *
 * Supabase's own limit is 50 MB, which is a limit for files and not for a 40-pixel
 * face. Checking here means the reader finds out before spending the upload, not after.
 */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * What can go wrong, as something a screen can word.
 *
 * `link_failed` is separate from `upload_failed` because the two leave the app in
 * different states: after `upload_failed` nothing happened, while after `link_failed`
 * the bytes are in the bucket and only the reference is missing. Telling the reader
 * "upload failed" in the second case would be false.
 */
export type AvatarErrorCode =
  | "unsupported_type"
  | "too_large"
  | "upload_failed"
  | "link_failed"
  | "remove_failed";

export class AvatarError extends Error {
  readonly code: AvatarErrorCode;
  /**
   * The object that exists in the bucket but is not referenced by anything.
   *
   * Set on `link_failed` so a retry can clean it up. Nothing renders it — it exists so
   * the fact is not lost along with the message.
   */
  readonly orphanPath?: string;

  constructor(code: AvatarErrorCode, orphanPath?: string) {
    super(`avatar upload failed at: ${code}`);
    this.name = "AvatarError";
    this.code = code;
    this.orphanPath = orphanPath;
  }
}

/**
 * The public URL for a stored path, or `null` when there is none.
 *
 * Each segment is encoded rather than the whole string: the path is built here and is
 * always `<uuid>.<ext>`, so encoding is belt-and-braces rather than something the caller
 * has to remember. A path arriving from the database is still encoded, because a row can
 * be written by anything holding the token.
 */
export function avatarUrlFromPath(
  path: string | null | undefined,
): string | null {
  if (!path) return null;

  const encoded = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/${encoded}`;
}

/**
 * Where a reader's object lives in the bucket.
 *
 * **The first segment must be the reader's own id** — that is what
 * `avatars_objects_*_own_or_admin` checks with `storage.foldername(name))[1]`, and a
 * path that does not lead with the caller's id is refused by the database rather than by
 * anything in this file. Building it here rather than accepting a path from a caller is
 * what makes that check reachable at all.
 */
function buildObjectPath(userId: string, extension: string): string {
  // `randomUUID` rather than the file name, so two uploads of `photo.jpg` do not
  // overwrite each other and the previous version stays readable until the reference
  // moves.
  return `${userId}/${crypto.randomUUID()}.${extension}`;
}

async function uploadObject(path: string, file: File): Promise<void> {
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: "3600",
    });

  if (error) throw new AvatarError("upload_failed");
}

/**
 * Point `profiles.avatar_path` at the new object.
 *
 * `.select()` and a row count, because **RLS answers a refused write with zero rows and
 * no error** — a resolved promise here would mean the avatar silently did not change.
 * Every write in this codebase does this and the reason is the same.
 */
async function linkObject(userId: string, path: string): Promise<void> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ avatar_path: path })
    .eq("id", userId)
    .select("id, avatar_path")
    .maybeSingle();

  if (error) throw new AvatarError("link_failed", path);
  if (!data) throw new AvatarError("link_failed", path);
}

/**
 * Delete one object.
 *
 * Through the Storage API and never `delete from storage.objects`, which
 * `storage.protect_delete()` refuses outright — that is the same finding `02900` records
 * for print templates, and it is why there is no SQL path here at all.
 */
export async function removeAvatarObject(path: string): Promise<void> {
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
  if (error) throw new AvatarError("remove_failed");
}

/**
 * Replace the signed-in reader's avatar.
 *
 * Returns the new path. Throws `AvatarError` with the stage it failed at, and the caller
 * is expected to say something different for `link_failed` than for `upload_failed`.
 *
 * `previousPath` is the row's current `avatar_path`, and it is deleted **only after** the
 * reference has moved — so a failure anywhere earlier leaves the old avatar working and
 * costs at most an unreferenced object.
 */
export async function setAvatar(
  file: File,
  userId: string,
  previousPath: string | null,
): Promise<string> {
  const extension = ALLOWED_TYPES[file.type];
  if (!extension) throw new AvatarError("unsupported_type");
  if (file.size > MAX_BYTES) throw new AvatarError("too_large");

  const path = buildObjectPath(userId, extension);
  await uploadObject(path, file);

  // From here the bytes exist. Anything that fails leaves an orphan rather than a
  // half-applied avatar, and `AvatarError.orphanPath` carries it so a retry can clear it.
  await linkObject(userId, path);

  if (previousPath && previousPath !== path) {
    // Deliberately not awaited into the error path: the reference has already moved, so
    // failing to tidy the old object is a storage leak and not a failed upload. Reporting
    // it as a failure would tell the reader their new avatar did not save.
    await removeAvatarObject(previousPath).catch(() => undefined);
  }

  return path;
}

/** The file accept list, so the picker's hint and the whitelist cannot drift apart. */
export const AVATAR_ACCEPT = Object.keys(ALLOWED_TYPES).join(",");
