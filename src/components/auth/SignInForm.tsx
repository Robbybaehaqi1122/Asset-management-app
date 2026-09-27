import Label from "@/components/form/Label";
import Checkbox from "@/components/form/input/Checkbox";
import Input from "@/components/form/input/InputField";
import Alert from "@/components/ui/alert/Alert";
import Button from "@/components/ui/button/Button";
import { useAuth } from "@/context/AuthContext";
import { EyeCloseIcon, EyeIcon } from "@/icons";
import { authErrorKey } from "@/lib/authErrors";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";

type LocationState = { from?: string };

export default function SignInForm() {
  const { t } = useTranslation("common", { keyPrefix: "auth" });
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [showPassword, setShowPassword] = useState(false);
  const [isChecked, setIsChecked] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const from = (location.state as LocationState | null)?.from ?? "/";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorKey(null);
    setIsSubmitting(true);

    try {
      await signIn(email, password, isChecked);
      navigate(from, { replace: true });
    } catch (error) {
      setErrorKey(authErrorKey(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* The social sign-in buttons, the "or" divider that separated them from
          this form, and the "back to dashboard" link are all gone. The two
          buttons were permanently `disabled` placeholders, and the divider
          existed only to separate them from the form below — with no second way
          to sign in, a divider reading "or" had nothing on the other side of it.
          Keeping them visible was a layout decision that outlived its reason;
          the sign-in form now starts at the heading. */}
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div>
          <div className="mb-5 sm:mb-8">
            <h1 className="mb-2 text-title-sm font-semibold text-gray-800 sm:text-title-md dark:text-white/90">
              {t("signIn.title")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("signIn.subtitle")}
            </p>
          </div>
          <div>
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
                  <Label htmlFor="signin-email">
                    {t("signIn.email")}{" "}
                    <span className="text-error-500">*</span>
                  </Label>
                  <Input
                    type="email"
                    id="signin-email"
                    name="email"
                    autoComplete="email"
                    required
                    placeholder={t("signIn.emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="signin-password">
                    {t("signIn.password")}{" "}
                    <span className="text-error-500">*</span>{" "}
                  </Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      id="signin-password"
                      name="password"
                      autoComplete="current-password"
                      required
                      placeholder={t("signIn.passwordPlaceholder")}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pe-12"
                    />
                    <span
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-e-4 top-1/2 z-30 -translate-y-1/2 cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeIcon className="size-5 fill-gray-500 dark:fill-gray-400" />
                      ) : (
                        <EyeCloseIcon className="size-5 fill-gray-500 dark:fill-gray-400" />
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={isChecked}
                      onChange={setIsChecked}
                      disabled={isSubmitting}
                    />
                    <span className="block text-theme-sm font-normal text-gray-700 dark:text-gray-400">
                      {t("signIn.keepLoggedIn")}
                    </span>
                  </div>
                  <Link
                    to="/reset-password"
                    className="text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400"
                  >
                    {t("signIn.forgotPassword")}
                  </Link>
                </div>
                <div>
                  <Button className="w-full" size="sm" disabled={isSubmitting}>
                    {isSubmitting ? t("signIn.submitting") : t("signIn.submit")}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
