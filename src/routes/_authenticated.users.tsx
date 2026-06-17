import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listUsers, createUser, updateUserRole, deleteUser } from "@/lib/api/users.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DataTablePagination } from "@/components/data-table-pagination";
import { usePagination } from "@/hooks/use-pagination";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Users — Coffee Zone" }] }),
  component: Users,
});

function Users() {
  const fn = useServerFn(listUsers);
  const createFn = useServerFn(createUser);
  const roleFn = useServerFn(updateUserRole);
  const delFn = useServerFn(deleteUser);
  const qc = useQueryClient();
  const { data = [], isLoading, error, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["users"],
    queryFn: () => fn(),
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });
  const { paginatedItems, ...pagination } = usePagination(data as any[]);

  // useEffect(() => {
  //   console.log("[Users] query state:", {
  //     isLoading,
  //     isFetching,
  //     error: error ? (error as Error).message : null,
  //     count: Array.isArray(data) ? data.length : 0,
  //     dataUpdatedAt: dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : null,
  //     sample: Array.isArray(data) ? data.slice(0, 2) : data,
  //   });
  // }, [data, isLoading, isFetching, error, dataUpdatedAt]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        console.log("[Users] tab visible — refetching users");
        refetch();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetch]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", full_name: "", role: "cashier" as "admin" | "cashier" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await createFn({ data: form }); toast.success("User created"); setOpen(false);
      setForm({ email: "", password: "", full_name: "", role: "cashier" }); qc.invalidateQueries({ queryKey: ["users"] }); }
    catch (e: any) { toast.error(e.message); }
  };
  
  const setRole = async (user_id: string, role: "admin" | "cashier") => {
    try {
      await roleFn({ data: { user_id, role } });
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["users"] });
    }
    catch (e: any) { toast.error(e.message); }
  };

  const remove = async (user_id: string) => {
    try {
      await delFn({ data: { user_id } });
      toast.success("User deleted");
      qc.invalidateQueries({ queryKey: ["users"] });
    }
    catch (e: any) { 
      // toast.error(e.message); 
      console.log('errorrrrrr', e.message)
    }
  };

  if (error) return <Card><CardContent className="p-6 text-destructive">{(error as Error).message}</CardContent></Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Users</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" /> New User</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create User</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5"><Label>Full name</Label><Input required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Password</Label><Input type="password" required minLength={6} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v: any) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="cashier">Cashier</SelectItem><SelectItem value="admin">Administrator</SelectItem></SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full">Create</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-display">All Users</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Joined</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? <TableRow><TableCell colSpan={5} className="text-center">Loading...</TableCell></TableRow> :
                paginatedItems.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No users found</TableCell></TableRow> :
                paginatedItems.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.full_name || u.username}</TableCell>
                    <TableCell className="text-sm">{u.email}</TableCell>
                    <TableCell>
                      <Select value={u.roles.includes("admin") ? "admin" : "cashier"} onValueChange={(v: any) => setRole(u.id, v)}>
                        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="cashier">Cashier</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="text-destructive"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Delete {u.email}?</AlertDialogTitle><AlertDialogDescription>This permanently removes the user account.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => remove(u.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <DataTablePagination {...pagination} onPageChange={pagination.setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
