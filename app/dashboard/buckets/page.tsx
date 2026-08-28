import { StorageAdminDashboard } from "@/components/dashboard/StorageAdminDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return <StorageAdminDashboard mode="buckets" />;
}
