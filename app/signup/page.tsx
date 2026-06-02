import type { Metadata } from "next";
import { SignupPage } from "@/components/stack/SignupPage";

export const metadata: Metadata = {
  title: "Subscribe to StackBrief — the daily AI brief",
  description:
    "One email each morning with the biggest AI releases, funding, and research, plus what AI X is talking about. Free, unsubscribe anytime.",
  alternates: { canonical: "/signup" },
};

// The bio-link landing page: a focused, single-purpose signup. Server shell +
// client form (SignupPage). Inherits the root layout's dark theme.
export default function Signup() {
  return <SignupPage />;
}
