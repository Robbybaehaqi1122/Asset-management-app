import { cn } from "@/utils";

interface FileInputProps {
  className?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  /**
   * The `accept` list, forwarded to the element.
   *
   * Added rather than worked around: this input had no way to narrow what a reader can
   * choose, so a caller that needed an image whitelist had to hand-roll its own input
   * and lose the primitive.
   *
   * **This only filters the chooser — it is a hint, not a constraint.** The real check
   * is `file.type` in `lib/avatar.ts`, because the file can still arrive by drag-and-drop
   * or be a renamed something else entirely.
   */
  accept?: string;
  /**
   * The input's own id, so a `<Label htmlFor=…>` can point at it.
   *
   * This was the one form primitive that could not be labelled properly: without an id a
   * label can only wrap the control, which reads worse and leaves the browser without
   * anything to associate for autofill.
   */
  id?: string;
  /**
   * Locks the input while a pick is being acted on.
   *
   * Not cosmetic for an uploader: the handler is async, so without this a second pick
   * mid-upload would start a second upload, and whichever finished last would win the
   * reference regardless of which the reader picked first.
   */
  disabled?: boolean;
}

const FileInput: React.FC<FileInputProps> = ({
  className,
  onChange,
  accept,
  id,
  disabled,
}) => {
  return (
    <input
      id={id}
      type="file"
      accept={accept}
      disabled={disabled}
      className={cn(
        "focus:border-ring-brand-300 h-11 w-full overflow-hidden rounded-lg border border-gray-300 bg-transparent text-sm text-gray-500 shadow-theme-xs transition-colors file:me-5 file:border-collapse file:cursor-pointer file:rounded-s-lg file:border-0 file:border-e file:border-solid file:border-gray-200 file:bg-gray-50 file:py-3 file:ps-3.5 file:pe-3 file:text-sm file:text-gray-700 placeholder:text-gray-400 hover:file:bg-gray-100 focus:outline-hidden focus:file:ring-brand-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:file:border-gray-800 dark:file:bg-white/3 dark:file:text-gray-400 dark:focus:file:ring-brand-300",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
      onChange={onChange}
    />
  );
};

export default FileInput;
