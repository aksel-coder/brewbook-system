import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hasSupabaseServiceRole, supabaseAdmin } from "@/integrations/supabase/client.server";

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

    // 1. Fetch roles from the custom table and user data from the auth table concurrently
    const [{ data: roles }, { data: authData, error: authError }] = await Promise.all([
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId),
      supabaseAdmin.auth.admin.getUserById(userId)
    ]);

    if (authError) {
      console.error("Error fetching auth user:", authError.message);
    }

    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    
    // 2. Safely extract user and metadata from the auth table response
    const authUser = authData?.user;
    const metadata = authUser?.user_metadata;

    return {
      userId,
      isAdmin,
      role: isAdmin ? "admin" : "cashier",
      fullName: metadata?.full_name ?? "",
      // Fallback to username metadata, then to email prefix, then to empty string
      username: metadata?.username ?? authUser?.email?.split('@')[0] ?? "", 
    };
  });


  export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    
    // 1. Still enforce admin check
    await requireAdmin(supabase, userId);

    // 2. Fetch directly from Auth via supabaseAdmin, and grab your app roles concurrently
    const [{ data: authData, error: authError }, { data: roles, error: rolesError }] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers(),
      supabaseAdmin.from("user_roles").select("user_id, role"),
    ]);

    console.log('authData:', authData)

    if (authError) throw new Error(authError.message);
    if (rolesError) throw new Error(rolesError.message);

    // 3. Map user roles into a fast lookup Map
    const roleMap = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    }

    // 4. Transform the Auth system users so they match your exact component expectations
    return (authData.users ?? []).map(u => ({
      id: u.id,
      email: u.email ?? "",
      full_name: u.user_metadata?.full_name || "",
      username: u.user_metadata?.username || u.email?.split('@')[0] || "",
      created_at: u.created_at,
      roles: roleMap.get(u.id) ?? ["cashier"], // Defaults to cashier if no role exists
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
    if (data.role === "admin" && created.user) {
      await context.supabase.from("user_roles").upsert({ user_id: created.user.id, role: "admin" });
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
  .inputValidator((d) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    
    // 1. Verify that the person making the request is an admin
    await requireAdmin(supabase, userId);
    
    // 2. Clean up your custom table first (bypassing RLS using supabaseAdmin)
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.user_id);
      
    if (roleError) throw new Error(roleError.message);
    
    // 3. Delete the user natively from Supabase Auth using the Admin API
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(
      data.user_id
    );
    
    if (authError) throw new Error(authError.message);
    
    return { ok: true };
  });

export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase.rpc("claim_first_admin");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
