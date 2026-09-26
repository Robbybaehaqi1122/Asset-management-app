/**
 * Memetakan `AuthError.code` dari Supabase ke key i18n.
 *
 * Fungsi ini murni mengembalikan *key*, bukan string — pemanggilannya memakai
 * `t()` dengan `keyPrefix: "auth"`. Kode yang tidak dikenali jatuh ke
 * `errors.unknown` supaya pesan teknis mentah Supabase tidak pernah bocor ke
 * layar pengguna.
 */
const ERROR_KEY_BY_CODE: Record<string, string> = {
  invalid_credentials: "errors.invalidCredentials",
  email_not_confirmed: "errors.emailNotConfirmed",
  user_already_exists: "errors.userAlreadyRegistered",
  email_exists: "errors.userAlreadyRegistered",
  over_request_rate_limit: "errors.rateLimited",
  over_email_send_rate_limit: "errors.rateLimited",
  weak_password: "errors.tooShort",
  same_password: "errors.samePassword",
  otp_expired: "errors.unknown",
};

export function authErrorKey(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";

  return ERROR_KEY_BY_CODE[code] ?? "errors.unknown";
}
