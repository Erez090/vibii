import { AdminRequest } from "@/components/admin/AdminRequest";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminRequest id={id} />;
}
