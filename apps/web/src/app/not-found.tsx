import Link from "next/link";
import { getMessages } from "@/lib/messages";

export default function NotFound() {
  const messages = getMessages();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">{messages.form.errors.unreachable}</h1>
      <Link href="/" className="mt-6 text-accent underline-offset-4 hover:underline">
        {messages.report.another}
      </Link>
    </main>
  );
}
