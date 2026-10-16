import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hasSupabaseServiceRole, supabaseAdmin } from "@/integrations/supabase/client.server";

function isTemporaryDatabaseError(error: { code?: string; message?: string; status?: number }) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    (error.status !== undefined && error.status >= 500) ||
    ["08", "53", "57", "58"].some((prefix) => error.code?.startsWith(prefix)) ||
    ["fetch failed", "failed to fetch", "networkerror", "timeout", "temporarily unavailable"].some(
      (phrase) => message.includes(phrase),
    )
  );
}

function throwRoleLookupError(label: string, error: { code?: string; message?: string; status?: number }): never {
  console.error(`Unable to verify ${label}:`, error.message ?? error.code ?? "Unknown error");
  if (isTemporaryDatabaseError(error)) {
    throw new Error("A temporary connection problem prevented account verification. Please retry.");
  }
  throw new Error(`Your ${label} could not be verified. Please contact an administrator.`);
}

async function requireAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const isAdmin = (data ?? []).some((r: any) => r.role === "admin");
  if (!isAdmin) throw new Error("Forbidden: admin only");
}

// export const getMyRole = createServerFn({ method: "GET" })
//   .middleware([requireSupabaseAuth])
//   .handler(async ({ context }) => {
//     const { supabase, userId } = context;
//     const [{ data: roles }, { data: profile }] = await Promise.all([
//       supabase.from("user_roles").select("role").eq("user_id", userId),
//       supabase.from("profiles").select("full_name, username, email").eq("id", userId).single(),
//     ]);
//     const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
//     console.log('rolessssssssssss: ', userId)
//     return {
//       userId,
//       isAdmin,
//       role: isAdmin ? "admin" : "cashier",
//       fullName: profile?.full_name ?? "",
//       username: profile?.username ?? "",
//     };
//   });


export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [{ data: roles, error: rolesError }, { data: profile, error: profileError }] =
      await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase
          .from("profiles")
          .select("full_name, username")
          .eq("id", userId)
          .maybeSingle(),
      ]);

    if (rolesError) {
      throwRoleLookupError("account role", rolesError);
    }
    if (profileError) {
      throwRoleLookupError("account profile", profileError);
    }
    if (!profile) {
      throw new Error("Your account profile is missing. Please contact an administrator.");
    }

    const isAdmin = (roles ?? []).some((role) => role.role === "admin");
    const isCashier = (roles ?? []).some((role) => role.role === "cashier");
    if (!isAdmin && !isCashier) {
      throw new Error(
        "This account has no valid Admin or Staff/Cashier role. Please contact an administrator.",
      );
    }

    return {
      userId,
      isAdmin,
      role: isAdmin ? "admin" : "cashier",
      fullName: profile.full_name ?? "",
      username: profile.username ?? context.claims.email?.split("@")[0] ?? "",
    };
  });


  export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    
    // 1. Still enforce admin check
    await requireAdmin(supabase, userId);

    // Fetch Auth users and application roles concurrently.
    const [
      { data: authData, error: authError },
      { data: roles, error: rolesError },
    ] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers(),
      supabaseAdmin.from("user_roles").select("user_id, role"),
    ]);

    if (authError) throw new Error(authError.message);
    if (rolesError) throw new Error(rolesError.message);

    // Map user roles into a fast lookup Map.
    const roleMap = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    }
    return (authData.users ?? []).map((user) => ({
      id: user.id,
      email: user.email ?? "",
      full_name: user.user_metadata?.full_name || "",
      username: user.user_metadata?.username || user.email?.split("@")[0] || "",
      created_at: user.created_at,
      roles: roleMap.get(user.id) ?? ["cashier"],
    }));
  });

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    email: z.string().email().max(255),
    password: z.string().min(6).max(100),
    full_name: z.string().min(1).max(120),
    role: z.enum(["admin", "cashier"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    if (!hasSupabaseServiceRole()) {
      throw new Error(
        "Creating users requires SUPABASE_SERVICE_ROLE_KEY in .env. " +
        "Supabase Dashboard → Settings → API → service_role (secret).",
      );
    }
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error) throw new Error(error.message);
    if (created.user) {
      const { error: clearRolesError } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", created.user.id);
      if (clearRolesError) throw new Error(clearRolesError.message);

      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: created.user.id, role: data.role });
      if (roleError) throw new Error(roleError.message);
    }
    return { ok: true };
  });

  export const updateUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().uuid(), role: z.enum(["admin", "cashier"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    
    // 1. Keep the security check using the user's token context
    await requireAdmin(supabase, userId);
    
    // 2. Use supabaseAdmin to bypass RLS restrictions safely on the server side
    const { error: delError } = await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    if (delError) throw new Error(delError.message);
    
    const { error: insError } = await supabaseAdmin.from("user_roles").insert({ user_id: data.user_id, role: data.role });
    if (insError) throw new Error(insError.message);
    
    return { ok: true };
  });

  export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
    .validator((d) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);
    if (data.user_id === userId) {
      throw new Error("You cannot permanently delete your own account.");
    }
    if (!hasSupabaseServiceRole()) {
      throw new Error("Permanent account deletion is unavailable because the server is missing its Supabase service role configuration.");
    }

    const [
      { data: target, error: targetError },
      { data: roles, error: rolesError },
      { data: adminRoles, error: adminRolesError },
    ] =
      await Promise.all([
        supabaseAdmin.auth.admin.getUserById(data.user_id),
        supabaseAdmin.from("user_roles").select("role").eq("user_id", data.user_id),
        supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin"),
      ]);
    if (targetError || !target.user) {
      if (targetError) {
        console.error("Unable to verify target account before deletion:", targetError.message);
        if (isTemporaryDatabaseError(targetError)) {
          throw new Error("A temporary connection problem prevented account verification. Please retry.");
        }
      }
      throw new Error("The account could not be verified and was not deleted.");
    }
    if (rolesError || adminRolesError) {
      const roleError = rolesError ?? adminRolesError;
      console.error("Unable to verify account roles before deletion:", roleError?.message);
      if (roleError && isTemporaryDatabaseError(roleError)) {
        throw new Error("A temporary connection problem prevented account verification. Please retry.");
      }
      throw new Error("Account permissions could not be verified. The account was not deleted.");
    }

    const targetRoles = roles ?? [];
    const isAdmin = targetRoles.some((role) => role.role === "admin");
    if (!isAdmin && !targetRoles.some((role) => role.role === "cashier")) {
      throw new Error("Only Staff/Cashier or Admin accounts can be permanently deleted here.");
    }
    const adminCount = new Set((adminRoles ?? []).map((role) => role.user_id)).size;
    if (isAdmin && adminCount <= 1) {
      throw new Error("The last authorized Admin account cannot be deleted.");
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (deleteError) {
      console.error("Unable to permanently delete Auth account:", deleteError.message);
      if (deleteError.code === "23503") {
        throw new Error(
          "A database relationship prevented deletion. No sales or historical records were changed.",
        );
      }
      if (/foreign key|database error deleting user/i.test(deleteError.message)) {
        throw new Error(
          "A database relationship prevented deletion. No sales or historical records were changed.",
        );
      }
      if (isTemporaryDatabaseError(deleteError)) {
        throw new Error(
          "A temporary connection problem interrupted deletion. Refresh the Users page to verify the account status before retrying.",
        );
      }
      throw new Error(`The account could not be deleted: ${deleteError.message}`);
    }

    return { ok: true, preservedSalesHistory: true };
  });

export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase.rpc("claim_first_admin");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
