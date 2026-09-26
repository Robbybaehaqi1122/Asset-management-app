import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import Alert from "@/components/ui/alert/Alert";
import Button from "@/components/ui/button/Button";
import { useAuth } from "@/context/AuthContext";
import { authErrorKey } from "@/lib/authErrors";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

const MIN_PASSWORD_LENGTH = 6;

const RequestForm = () => {
  const { t } = useTranslation("common", { keyPrefix: "auth" });
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorKey(null);
    setIsSubmitting(true);

    try {
      await requestPasswordReset(email);
      setIsSent(true);
    } catch (error) {
      setErrorKey(authErrorKey(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
      <div className="mb-5 sm:mb-8">
        <h1 className="mb-2 text-title-sm font-semibold text-gray-800 sm:text-title-md dark:text-white/90">
          {t("resetPassword.title")}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("resetPassword.subtitle")}
        </p>
      </div>

      {isSent ? (
        <Alert
          variant="success"
          title={t("resetPassword.sentTitle")}
          message={t("resetPassword.sentMessage")}
        />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="space-y-6">
            {errorKey && (
              <Alert
                variant="error"
                title={t("errors.title")}
                message={t(errorKey)}
              />
            )}
            <div>
              <Label htmlFor="reset-email">
                {t("resetPassword.email")}{" "}
                <span className="text-error-500">*</span>
              </Label>
              <Input
                type="email"
                id="reset-email"
                name="email"
                autoComplete="email"
                required
                placeholder={t("resetPassword.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button className="w-full" size="sm" disabled={isSubmitting}>
              {isSubmitting
                ? t("resetPassword.submitting")
                : t("resetPassword.submit")}
            </Button>
          </div>
        </form>
      )}

      <div className="mt-5 text-center">
        <Link
          to="/signin"
          className="text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400"
        >
          {t("resetPassword.backToSignIn")}
        </Link>
      </div>
    </div>
  );
};

const UpdateForm = () => {
  const { t } = useTranslation("common", { keyPrefix: "auth" });
  const { updatePassword } = useAuth();
  const navigate = useNavigate();

  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorKey(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorKey("resetPassword.tooShort");
      return;
    }
    if (password !== confirmPassword) {
      setErrorKey("resetPassword.mismatch");
      return;
    }

    setIsSubmitting(true);
    try {
      await updatePassword(password);
      setIsDone(true);
    } catch (error) {
      setErrorKey(authErrorKey(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isDone) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <Alert
          variant="success"
          title={t("resetPassword.updatedTitle")}
          message={t("resetPassword.updatedMessage")}
        />
        <div className="mt-5 text-center">
          <Button
            className="w-full"
            size="sm"
            onClick={() => navigate("/", { replace: true })}
          >
            {t("resetPassword.goToDashboard")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
      <div className="mb-5 sm:mb-8">
        <h1 className="mb-2 text-title-sm font-semibold text-gray-800 sm:text-title-md dark:text-white/90">
          {t("resetPassword.setTitle")}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("resetPassword.setSubtitle")}
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {errorKey && (
            <Alert
              variant="error"
              title={t("errors.title")}
              message={t(errorKey)}
            />
          )}
          <div>
            <Label htmlFor="new-password">
              {t("resetPassword.newPassword")}{" "}
              <span className="text-error-500">*</span>
            </Label>
            <Input
              type={showPassword ? "text" : "password"}
              id="new-password"
              name="password"
              autoComplete="new-password"
              required
              placeholder={t("resetPassword.newPasswordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="confirm-password">
              {t("resetPassword.confirmPassword")}{" "}
              <span className="text-error-500">*</span>
            </Label>
            <Input
              type={showPassword ? "text" : "password"}
              id="confirm-password"
              name="confirmPassword"
              autoComplete="new-password"
              required
              placeholder={t("resetPassword.confirmPasswordPlaceholder")}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <Button className="w-full" size="sm" disabled={isSubmitting}>
            {isSubmitting
              ? t("resetPassword.updateSubmitting")
              : t("resetPassword.updateSubmit")}
          </Button>
        </div>
      </form>

      <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          className="cursor-pointer underline"
        >
          {showPassword
            ? t("resetPassword.hidePassword")
            : t("resetPassword.showPassword")}
        </button>
      </p>
    </div>
  );
};

/**
 * Satu halaman dua mode. Mode-nya ditentukan oleh ada-tidaknya session:
 *
 * - Tanpa session  -> kirim link reset ke email.
 * - Dengan session -> session itu dibuat oleh link recovery yang baru saja
 *   dibuka, jadi password bisa langsung diganti.
 *
 * Menentukan dari session (bukan dari event `PASSWORD_RECOVERY`) penting
 * karena kalau pengguna me-refresh halaman ini, hash di URL sudah dibersihkan
 * Supabase dan event-nya tidak akan dipancarkan lagi — session-nya sendiri
 * masih ada di storage.
 */
export default function ResetPasswordForm() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex w-full flex-1 items-center justify-center">
        <span
          role="status"
          aria-label="Loading"
          className="size-8 animate-spin rounded-full border-4 border-gray-200 border-t-brand-500 dark:border-gray-800 dark:border-t-brand-400"
        />
      </div>
    );
  }

  if (!session) {
    return <RequestForm />;
  }

  return <UpdateForm />;
}
