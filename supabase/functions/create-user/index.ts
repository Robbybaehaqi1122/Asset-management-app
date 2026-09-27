// Creates one account, for an admin, from inside the app.
//
// This is the only place in the project that touches the Admin API, and the
// reason it is a separate function rather than a button is the credential.
// `auth.admin.createUser` requires the `service_role` key, which bypasses RLS
// and must never reach a browser. An Edge Function is the one place that key
// can live without being shipped, and Supabase provides it to every function as
// a default secret — so nothing has to be pasted into this file, and nothing
// has to be added to the repository.
//
// The scope is deliberately one account. The role and the department are set
// by the browser afterwards, over the normal RLS path, because writing those
// columns with the service role would attribute the change to nobody and
// `protect_profile_role` would refuse it anyway: `is_admin()` reads
// `auth.uid()`, which is NULL for a service-role request. The
// `must_change_password` flag is the one exception, and it is set here because
// no trigger guards that column — see the comment at the write itself.

import { createClient } from "npm:@supabase/supabase-js@2";

/** GoTrue messages that are worth distinguishing, mapped to our own codes. */
function mapAuthError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("already been registered") || text.includes("already exists")) {
    return "already_exists";
  }
  if (text.includes("password")) return "weak_password";
  if (text.includes("email")) return "invalid_email";
  return "unknown";
}

function isEmail(value: string): boolean {
  // Deliberately loose. The authoritative check is GoTrue's, which runs next
  // and is reported as `invalid_email` if it objects.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // `supabase.functions.invoke` sends the caller's session as the
  // Authorization header, and the platform has already verified the signature
  // by the time this runs. A missing or unreadable token is still checked here
  // because the role below is what actually matters.
  const token = (req.headers.get("Authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (token === "") return json(401, { error: "unauthenticated" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceKey) {
    return json(500, { error: "not_configured" });
  }

  // The service-role client is used for two things only: reading who is
  // calling, and creating the user. `auth: { persistSession: false }` keeps it
  // from writing anything into a cookie, which it has no business doing.
  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: caller, error: callerError } =
    await service.auth.getUser(token);

  if (callerError || !caller.user) {
    return json(401, { error: "unauthenticated" });
  }

  // The check that matters, and the reason this endpoint is not a public
  // account factory. A browser-side check would be a UI convenience; this is
  // the enforcement point, and it uses the service role precisely so that RLS
  // on `profiles` cannot hide the answer from it.
  const { data: profile } = await service
    .from("profiles")
    .select("role")
    .eq("id", caller.user.id)
    .maybeSingle();

  if (profile?.role !== "admin") return json(403, { error: "forbidden" });

  const body = await req.json().catch(() => null);
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const fullName =
    typeof body?.full_name === "string" ? body.full_name.trim() : "";

  if (!isEmail(email)) return json(400, { error: "invalid_email" });
  if (fullName === "") return json(400, { error: "name_required" });
  if (password.length < 8) return json(400, { error: "weak_password" });

  const { data, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    // There is no working mail provider on this project, so a confirmation
    // email is a link that never arrives. The account is created by an admin
    // who is present for it, so confirming here is what the invite-only flow
    // is actually for.
    email_confirm: true,
    // `handle_new_user` reads this and copies it onto `profiles.full_name`.
    // It never reads `role` from here, deliberately — see migration 00400.
    user_metadata: { full_name: fullName },
  });

  if (createError || !data?.user) {
    return json(400, {
      error: mapAuthError(createError?.message ?? "unknown"),
    });
  }

  // Raise the "must change this" flag, here rather than in the browser, and the
  // reason is worth stating because the rest of the create flow deliberately
  // does the opposite.
  //
  // Role and department are written by the browser because `protect_profile_role`
  // refuses them from a service-role request: `is_admin()` reads `auth.uid()`,
  // which is NULL without a JWT. This column has no such guard — 00800 says so
  // explicitly, and that is the right answer for a prompt rather than a
  // privilege decision — so the service role can write it, and the column-scoped
  // triggers stay quiet: `role` and `email` are not in the SET list, and
  // `protect_profile_role` returns early because the role did not move.
  //
  // The browser is the wrong place for it regardless. This is the one write that
  // must not be skippable, and a client-side step is skippable by exactly the
  // failure that makes people reach for a retry: a dropped request. Here it is
  // one transaction away from the account it belongs to.
  const { error: flagError } = await service
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", data.user.id);

  // Only the id and the address go back. The rest of the user object is not
  // the caller's business and is not needed to finish the job.
  //
  // `mustChangeFlagSet` is reported rather than thrown. The account exists by
  // this point, so an error status would be a lie about it, and a client that
  // retried would only meet `already_exists`. The honest outcome is success plus
  // a warning: the admin knows the first password and the user is not being
  // asked to change it. That is an advisory failure, not a security one, which
  // is the same category migration 00800 puts this column in.
  return json(200, {
    id: data.user.id,
    email: data.user.email,
    mustChangeFlagSet: flagError === null,
  });
});
