"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { requestEditorNavigation } from "./editor-navigation";

export function useEditorRouter() {
  const router = useRouter();
  return useMemo(() => ({ ...router,
    push: (...args: Parameters<typeof router.push>) => { const proceed = () => router.push(...args); if (requestEditorNavigation(args[0], proceed)) proceed(); },
    replace: (...args: Parameters<typeof router.replace>) => { const proceed = () => router.replace(...args); if (requestEditorNavigation(args[0], proceed)) proceed(); },
    // Back/forward are checked at the history boundary, before React sees traversal.
  }), [router]);
}
