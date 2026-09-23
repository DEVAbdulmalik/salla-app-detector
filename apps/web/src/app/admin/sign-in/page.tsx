import { getMessages } from "@/lib/messages";
import { SignInForm } from "@/components/sign-in-form";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const messages = getMessages();
  const reason = (await searchParams).error;
  const reasons: Record<string, string> = messages.admin.signInErrors;
  const initialError = typeof reason === "string" ? reasons[reason] : undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{messages.admin.title}</h1>
      <p className="mt-2 text-sm text-muted">{messages.admin.signInHint}</p>
      <div className="mt-8">
        <SignInForm messages={messages} {...(initialError === undefined ? {} : { initialError })} />
      </div>
    </main>
  );
}
