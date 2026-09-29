// Replaces one account's password, on an administrator's request.
//
// The third and last place in the project that touches the Admin API, and for
// the same reason as the other two: `auth.admin.updateUserById` requires the
// `service_role` key, which bypasses RLS and must never reach a browser. An
// Edge Function is the one place that key can live without being shipped.
//
// **Why this exists when the app already has a reset-password page.** That page
// calls `resetPasswordForEmail`, and this project has no working mail provider —
// `[auth.email.smtp]` is commented out in `supabase/config.toml`. So GoTrue
// accepts the request, reports `error: null`, and the mail never arrives. A
// user who has forgotten their password has exactly one working way back in, and
// before this function it was to delete the account and recreate it, which takes
// their loan history with it.
//
// **What it deliberately does not do** is anything to the caller's own account.
// There is no `self_delete` rule here, unlike `delete-user`, and that asymmetry
// is the point:
//
// - Deleting yourself strands this very session on an auth user that no longer
//   exists, so it has to be refused. Replacing a password does not: the session
//   stays valid, so there is nothing to strand.
// - Refusing it would also remove the only recovery path for a project with a
//   single administrator, which is the situation that needs this function most.
//
// There is no `last_admin` rule either, for a sharper reason. Refusing based on
// how many admins the *project* has is the bug `delete-user` documents at
// length: it looks like caution and makes every staff account unrecoverable in a
// fresh project. A password reset does not change the admin count at all, so
// there is nothing to guard. The only thing an administrator gains here is the
// ability to read a password, which is already true of the create flow.

import { createClient } from "npm:@supabase/supabase-js@2";
// The SDK's own CORS header list, kept in step with the headers the client
// sends. See the note on `json` below before changing it.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const NOT_FOUND = "not_found";
const INVALID_ID = "invalid_id";
const WEAK_PASSWORD = "weak_password";

/** GoTrue messages worth distinguishing, mapped to our own codes. */
function mapAuthError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("not found") || text.includes("does not exist")) {
    return NOT_FOUND;
  }
  if (text.includes("password")) return WEAK_PASSWORD;
  return "unknown";
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

/**
 * CORS headers, taken from the SDK rather than written by hand.
 *
 * The browser sends an `OPTIONS` preflight because `supabase.functions.invoke`
 * adds an `Authorization` header, and the Supabase gateway does **not** answer
 * it — it passes `OPTIONS` through to the function, so this is the only place the
 * answer can come from. Answering with an ordinary refusal drops the real
 * `POST` without ever sending it, and the console reports a CORS failure while
 * the endpoint is perfectly reachable by curl.
 *
 * The wildcard origin matches the SDK's default and the gateway's own error
 * responses. It is safe here because the boundary is the admin check below, not
 * the Origin: the caller's JWT is the credential, and a page on another site
 * cannot obtain it, because it lives in storage only this app's origin can read.
 * If sessions ever move to cookies, revisit this — a cookie *is* attached
 * automatically, and then the Origin check starts to matter.
 */
function json(_req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/** The preflight. Answered before anything else, and answered completely. */
function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") {
    return json(req, 405, { error: "method_not_allowed" });
  }

  const token = (req.headers.get("Authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (token === "") return json(req, 401, { error: "unauthenticated" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceKey) {
    return json(req, 500, { error: "not_configured" });
  }

  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: caller, error: callerError } =
    await service.auth.getUser(token);

  if (callerError || !caller.user) {
    return json(req, 401, { error: "unauthenticated" });
  }

  // The enforcement point, and the reason this is not a public password oracle.
  // Read with the service role on purpose: RLS on `profiles` would answer from
  // `profiles_select_own_or_admin`, and the check that guards this endpoint must
  // not be the one RLS can influence.
  const { data: callerProfile } = await service
    .from("profiles")
    .select("role")
    .eq("id", caller.user.id)
    .maybeSingle();

  if (callerProfile?.role !== "admin") {
    return json(req, 403, { error: "forbidden" });
  }

  const body = await req.json().catch(() => null);
  const userId = body?.user_id;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!isUuid(userId)) return json(req, 400, { error: INVALID_ID });

  // Checked here for an immediate, specific message on a field the admin is
  // looking at, and again by GoTrue, which is the authority and is reported as
  // `weak_password` if it objects. The two rules can disagree — this project's
  // hosted auth allows a shorter minimum than 8 — and when they do, the stricter
  // one is the one that protects the account.
  if (password.length < 8) return json(req, 400, { error: WEAK_PASSWORD });

  // Existence is checked up front so a request for an account that is already
  // gone is reported as that, rather than surfacing as GoTrue's own wording.
  const { data: target } = await service
    .from("profiles")
    .select("id, email")
    .eq("id", userId)
    .maybeSingle();

  if (!target) return json(req, 404, { error: NOT_FOUND });

  // The privileged step, and the only one that needs the service role.
  //
  // `email_confirm` is deliberately not touched: this endpoint changes a
  // credential, not an address, and re-confirming an account nobody asked about
  // would quietly change who can sign in.
  const { error: updateError } = await service.auth.admin.updateUserById(
    userId,
    { password },
  );

  if (updateError) {
    return json(req, 400, { error: mapAuthError(updateError.message) });
  }

  // Raise the "must change this" flag, and for exactly the reason `create-user`
  // does: the administrator is about to know this person's password, and this
  // is the only thing that asks them to pick their own on the next sign-in.
  //
  // Migration 00800 puts no trigger on this column, deliberately, because it is
  // a prompt to the account holder rather than a privilege decision. That is what
  // lets the service role write it: the two `UPDATE OF` triggers stay quiet
  // because `role` and `email` are not in the SET list, and `protect_profile_role`
  // returns early because the role did not move.
  //
  // It is also here rather than in the browser for the second reason
  // `create-user` gives: a client-side step is skippable by exactly the dropped
  // request that makes people reach for a retry, and a password that changed
  // while this write was lost is a password the administrator keeps forever with
  // nobody asked to replace it.
  const { error: flagError } = await service
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", userId);

  // Reported rather than thrown, for the same reason: the password *has* changed
  // by this point, so an error status would be a lie about it, and a client
  // retrying would meet a flag that is already true. The honest outcome is
  // success plus a warning that the person will not be asked to change it.
  return json(req, 200, {
    id: userId,
    email: target.email ?? null,
    mustChangeFlagSet: flagError === null,
  });
});
