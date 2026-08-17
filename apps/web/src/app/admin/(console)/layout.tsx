import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { getAdminSession } from "@/server/auth";

export const metadata: Metadata = {
  title: "运营管理",
  robots: { index: false, follow: false },
};

export default async function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!(await getAdminSession())) redirect("/admin/login");
  return <AdminShell>{children}</AdminShell>;
}
