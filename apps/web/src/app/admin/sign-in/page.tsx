import { getMessages } from "@/lib/messages";
import { SignInForm } from "@/components/sign-in-form";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const messages = getMessages();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{messages.admin.title}</h1>
      <p className="mt-2 text-sm text-muted">{messages.admin.signInHint}</p>
      <div className="mt-8">
        <SignInForm messages={messages} />
      </div>
    </main>
  );
}
