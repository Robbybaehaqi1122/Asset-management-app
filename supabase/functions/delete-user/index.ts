// Deletes one account, for an admin, from inside the app.
//
// The twin of `create-user`, and for the same reason it is a separate function
// rather than a button: `auth.admin.deleteUser` requires the `service_role` key,
// which bypasses RLS and must never reach a browser. Supabase hands that key to
// every function as a default secret, so nothing is pasted here and nothing is
// committed.
//
// This is a hard delete, and the cascade is the point an admin has to be told
// about before they press the button:
//
//   auth.users -> profiles (on delete cascade)
//              -> assignments.assigned_by (on delete set null) who lent it is lost
//              -> handover_users.profile_id (on delete set null) the roster link
//                 drops, and the roster entry itself stays
//
// **Deleting an account no longer erases loan history.** Until migration `02000`,
// `assignments.user_id` referenced `profiles` with `on delete cascade`, so
// removing somebody's account silently deleted every handover they were the
// recipient of. That is the loss the confirmation modal used to warn about, and
// it no longer happens: `assignments.user_id` now points at `handover_users`, a
// roster row that outlives any account, and the person who held an asset is named
// there rather than in the login list.
//
// What is still lost is narrower, and the modal says so:
//
//   - `assignments.assigned_by` becomes NULL — the record of which admin issued
//     each of those handovers.
//   - `handover_users.profile_id` becomes NULL — that person stops seeing and
//     returning their own handovers in the app. The roster entry stays, so a new
//     admin can relink it to a new account.
//
// The role and department are not written here for the same reason they are not
// written in `create-user`: `protect_profile_role` refuses a service-role write.
// This function deletes instead of writing, so it never touches `role`.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

/** The caller's own id, so a person cannot delete themselves. */
const SELF = "self_delete";
const LAST_ADMIN = "last_admin";
const NOT_FOUND = "not_found";
const INVALID_ID = "invalid_id";

function json(_req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/**
 * CORS, and why the header list is imported rather than written.
 *
 * The app is on a different origin, and the `Authorization` header makes the
 * request non-simple, so the browser preflights it. The gateway passes `OPTIONS`
 * straight through, so this function is the only thing that can answer, and a
 * refusal drops the real `POST` without sending it. `Access-Control-Allow-Headers`
 * also has to name every header the SDK sends, and that list grows —
 * `X-Client-Info` arrived in 2.117 and broke a list that was correct a moment
 * earlier. `@supabase/supabase-js/cors` is maintained in step with the client.
 *
 * The wildcard origin matches the SDK default and the gateway's own errors. The
 * boundary here is the admin check below, not the Origin: the caller's JWT is the
 * credential, and another site cannot obtain it. If sessions ever move to
 * cookies, revisit that — a cookie is attached automatically.
 */
function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
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

  // Service role on purpose, for the same reason as `create-user`: the check
  // that enforces this endpoint must not be the one RLS can influence.
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

  if (!isUuid(userId)) return json(req, 400, { error: INVALID_ID });

  // Deleting yourself would leave this very session pointing at an auth user
  // that no longer exists, and — if you are the only admin — lock the project
  // with no one able to administer it.
  if (userId === caller.user.id) return json(req, 400, { error: SELF });

  // Existence is checked before the admin count on purpose, so a request for an
  // account that is already gone is reported as that rather than as whichever
  // unrelated guard happens to come first.
  const { data: target } = await service
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();

  if (!target) return json(req, 404, { error: NOT_FOUND });

  // `guard_last_admin` does NOT cover this. That trigger is
  // `before update of role`, and a delete is not an update, so the cascade walks
  // straight past it and would remove the last admin with nothing to stop it.
  //
  // The condition is about the *target*, not the project. Refusing every delete
  // while the project has one admin looks like caution and is not: a staff
  // account is not an admin, and removing one leaves the admin count untouched.
  // Getting that backwards makes every staff account undeletable in a fresh
  // project, which is exactly the shape a new install is in.
  //
  // **This branch cannot fire as written**, and that is worth stating rather
  // than letting it look like the thing protecting the project. The self check
  // above is what actually protects it: the caller has already been proven to be
  // an admin, so if the count is 1 the only admin *is* the caller, and any admin
  // target is the caller themselves. It is kept as a safety net for the day
  // someone relaxes the self rule, and it costs one query only when the target
  // is an admin — but if it ever does fire, treat that as a finding about the
  // self check, not as a routine refusal.
  if (target.role === "admin") {
    const { count } = await service
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");

    if ((count ?? 0) <= 1) return json(req, 400, { error: LAST_ADMIN });
  }

  // How much is about to disappear, reported so the admin is not guessing.
  // Counted before the delete, because afterwards it is unanswerable.
  //
  // This counts what the account **issued**, not what it held. Since `02000` the
  // holder is a `handover_users` row and does not disappear with the account, so
  // `.eq("user_id", userId)` would match nothing and `erasedLoans` would be a
  // confident zero. The name is kept because the response field is part of the
  // contract the confirmation modal reads; the semantic is what changed.
  const { count: loanCount } = await service
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("assigned_by", userId);

  // The auth user is deleted LAST, and that ordering is the whole trick.
  //
  // `profiles.id` has `on delete cascade` from `auth.users`, but that cascade
  // cannot do its job here: it runs as `supabase_auth_admin`, which has no
  // `bypassrls`, against a `profiles` table that has `force row level security`
  // and **no DELETE policy at all**. The cascade therefore deletes zero rows,
  // the `profiles` row survives pointing at an `auth.users` row that no longer
  // exists, and GoTrue reports "Database error deleting user". Straight
  // `auth.admin.deleteUser` on a user with a profile therefore always fails.
  //
  // Fixing it with grants would mean giving `supabase_auth_admin` DELETE on
  // `profiles` and UPDATE on `assets` (for the status trigger), and adding a
  // DELETE policy to a table that deliberately has none. Removing the rows
  // ourselves avoids all of that: the service role bypasses RLS.
  //
  // Order is the constraint, and `02000` shortened the list. It used to be
  // "`assignments` first, because `profiles` cannot go while a row still
  // references it" — `assignments.user_id` and `assignments.assigned_by` both
  // pointed at `profiles`. Now only `assigned_by` does, and it is `on delete set
  // null`, which does **not** block the delete. So `assignments` no longer needs
  // clearing first, and the statement below was deleted rather than repointed:
  //
  //   - keeping it and filtering on `user_id` would match nothing, because that
  //     column now holds a roster id, not an account id.
  //   - keeping it and filtering on `assigned_by` would be actively harmful: it
  //     would delete handover *history* to remove an account, and firing
  //     `assignments_sync_asset_status` on the way would push assets somebody is
  //     still physically holding back into stock.
  //
  // So an admin's handover history survives their account, which is the outcome
  // the whole `handover_users` split was for.
  const { error: profileError } = await service
    .from("profiles")
    .delete()
    .eq("id", userId);

  if (profileError) {
    console.error("delete-user: clearing the profile failed", {
      userId,
      code: profileError.code,
      message: profileError.message,
    });
    return json(req, 400, { error: "unknown" });
  }

  const { error: deleteError } = await service.auth.admin.deleteUser(userId);

  if (deleteError) {
    // The message stays in the log, where it can actually be read. Collapsing
    // every failure to one code is the same anti-pattern as trusting a resolved
    // promise to prove a write happened: it turns a specific, fixable cause
    // into an indistinguishable "unknown" and sends the admin looking in the
    // wrong place.
    console.error("deleteUser failed", {
      userId,
      code: deleteError.code,
      message: deleteError.message,
    });

    // GoTrue's wording is not ours to translate, so this matches on the two
    // shapes that are actually actionable and lets everything else be unknown.
    const text = deleteError.message.toLowerCase();
    if (text.includes("not found") || text.includes("does not exist")) {
      return json(req, 404, { error: NOT_FOUND });
    }
    return json(req, 400, { error: "unknown" });
  }

  return json(req, 200, { id: userId, erasedLoans: loanCount ?? 0 });
});
