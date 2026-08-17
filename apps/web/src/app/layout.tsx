import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CodePool", template: "%s · CodePool" },
  description: "团队共享代码、动态验证码与临时密文的安全协作空间。",
  applicationName: "CodePool",
};

export const viewport: Viewport = { themeColor: "#0b0f19", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
