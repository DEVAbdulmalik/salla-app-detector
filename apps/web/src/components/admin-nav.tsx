import Link from "next/link";
import type { Messages } from "@/lib/messages";

const PAGES = [
  { href: "/admin", key: "overview" },
  { href: "/admin/knowledge", key: "knowledge" },
  { href: "/admin/scans", key: "scans" },
] as const;

export function AdminNav({ messages, current }: { messages: Messages; current: string }) {
  return (
    <nav className="flex gap-4 text-sm">
      {PAGES.map((page) => (
        <Link
          key={page.href}
          href={page.href}
          className={
            page.href === current
              ? "text-ink underline underline-offset-4"
              : "text-muted transition-colors hover:text-ink"
          }
        >
          {messages.admin.nav[page.key]}
        </Link>
      ))}
    </nav>
  );
}
