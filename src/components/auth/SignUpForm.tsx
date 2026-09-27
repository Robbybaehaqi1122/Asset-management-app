import Label from "@/components/form/Label";
import Checkbox from "@/components/form/input/Checkbox";
import Input from "@/components/form/input/InputField";
import Alert from "@/components/ui/alert/Alert";
import Button from "@/components/ui/button/Button";
import { useAuth } from "@/context/AuthContext";
import {
  ChevronLeftIcon,
  EyeCloseIcon,
  EyeIcon,
  GoogleIcon,
  XIcon,
} from "@/icons";
import { authErrorKey } from "@/lib/authErrors";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

type Status =
  | { kind: "idle" }
  | { kind: "confirm-email" }
  | { kind: "error"; messageKey: string };

export default function SignUpForm() {
  const { t } = useTranslation("common", { keyPrefix: "auth" });
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [showPassword, setShowPassword] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [department, setDepartment] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isChecked) {
      setStatus({ kind: "error", messageKey: "errors.terms" });
      return;
    }

    setStatus({ kind: "idle" });
    setIsSubmitting(true);

    try {
      const { sessionCreated } = await signUp(
        `${firstName} ${lastName}`.trim(),
        department.trim(),
        email,
        password,
      );

      if (sessionCreated) {
        navigate("/", { replace: true });
      } else {
        setStatus({ kind: "confirm-email" });
      }
    } catch (error) {
      setStatus({ kind: "error", messageKey: authErrorKey(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status.kind === "confirm-email") {
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center px-6">
        <div className="w-full max-w-md">
          <Alert
            variant="success"
            title={t("signUp.confirmEmailTitle")}
            message={t("signUp.confirmEmailMessage")}
          />
          <div className="mt-5 text-center">
            <Link
              to="/signin"
              className="text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400"
            >
              {t("signUp.signInLink")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="no-scrollbar flex w-full flex-1 flex-col overflow-y-auto lg:w-1/2">
      <div className="mx-auto mb-5 w-full max-w-md sm:pt-10">
        <Link
          to="/"
          className="inline-flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <ChevronLeftIcon className="size-5 rtl:rotate-180" />
          {t("backToDashboard")}
        </Link>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div>
          <div className="mb-5 sm:mb-8">
            <h1 className="mb-2 text-title-sm font-semibold text-gray-800 sm:text-title-md dark:text-white/90">
              {t("signUp.title")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("signUp.subtitle")}
            </p>
          </div>
          <div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5">
              <button
                type="button"
                disabled
                title={t("oauthNotReady")}
                className="inline-flex cursor-not-allowed items-center justify-center gap-3 rounded-lg bg-gray-100 px-7 py-3 text-sm font-normal text-gray-700 opacity-60 dark:bg-white/5 dark:text-white/90"
              >
                <GoogleIcon className="size-5" />
                {t("signUp.withGoogle")}
              </button>
              <button
                type="button"
                disabled
                title={t("oauthNotReady")}
                className="inline-flex cursor-not-allowed items-center justify-center gap-3 rounded-lg bg-gray-100 px-7 py-3 text-sm font-normal text-gray-700 opacity-60 dark:bg-white/5 dark:text-white/90"
              >
                <XIcon className="size-5" />
                {t("signUp.withX")}
              </button>
            </div>
            <div className="relative py-3 sm:py-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200 dark:border-gray-800"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white p-2 text-gray-400 sm:px-5 sm:py-2 dark:bg-gray-900">
                  {t("or")}
                </span>
              </div>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="space-y-5">
                {status.kind === "error" && (
                  <Alert
                    variant="error"
                    title={t("errors.title")}
                    message={t(status.messageKey)}
                  />
                )}
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div className="sm:col-span-1">
                    <Label htmlFor="signup-first-name">
                      {t("signUp.firstName")}{" "}
                      <span className="text-error-500">*</span>
                    </Label>
                    <Input
                      type="text"
                      id="signup-first-name"
                      name="firstName"
                      autoComplete="given-name"
                      required
                      placeholder={t("signUp.firstNamePlaceholder")}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <Label htmlFor="signup-last-name">
                      {t("signUp.lastName")}{" "}
                      <span className="text-error-500">*</span>
                    </Label>
                    <Input
                      type="text"
                      id="signup-last-name"
                      name="lastName"
                      autoComplete="family-name"
                      required
                      placeholder={t("signUp.lastNamePlaceholder")}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="signup-department">
                    {t("signUp.department")}{" "}
                    <span className="text-error-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    id="signup-department"
                    name="department"
                    autoComplete="organization-title"
                    required
                    placeholder={t("signUp.departmentPlaceholder")}
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="signup-email">
                    {t("signUp.email")}{" "}
                    <span className="text-error-500">*</span>
                  </Label>
                  <Input
                    type="email"
                    id="signup-email"
                    name="email"
                    autoComplete="email"
                    required
                    placeholder={t("signUp.emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="signup-password">
                    {t("signUp.password")}{" "}
                    <span className="text-error-500">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="signup-password"
                      name="password"
                      autoComplete="new-password"
                      required
                      placeholder={t("signUp.passwordPlaceholder")}
                      type={showPassword ? "text" : "password"}
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
                <div className="flex items-center gap-3">
                  <Checkbox
                    className="h-5 w-5"
                    checked={isChecked}
                    onChange={setIsChecked}
                    disabled={isSubmitting}
                  />
                  <p className="inline-block font-normal text-gray-500 dark:text-gray-400">
                    {t("signUp.termsPrefix")} {""}
                    <span className="text-gray-800 dark:text-white/90">
                      {t("signUp.termsLink")}
                    </span>{" "}
                    {t("signUp.andPrefix")} {""}
                    <span className="text-gray-800 dark:text-white">
                      {t("signUp.privacyLink")}
                    </span>
                  </p>
                </div>
                <div>
                  <Button className="w-full" size="sm" disabled={isSubmitting}>
                    {isSubmitting ? t("signUp.submitting") : t("signUp.submit")}
                  </Button>
                </div>
              </div>
            </form>

            <div className="mt-5">
              <p className="text-center text-sm font-normal text-gray-700 sm:text-start dark:text-gray-400">
                {t("signUp.haveAccount")} {""}
                <Link
                  to="/signin"
                  className="text-brand-500 hover:text-brand-600 dark:text-brand-400"
                >
                  {t("signUp.signInLink")}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
