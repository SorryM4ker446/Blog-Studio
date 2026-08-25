import SettingsPageClient from "@/components/SettingsPageClient";
import { requestServerJSON } from "@/lib/server-api";

export default async function SettingsPage() {
  const result = await requestServerJSON<Record<string, string>>("/settings");
  return (
    <SettingsPageClient
      initialSettings={result.ok ? result.data : {}}
      initialSettingsError={result.ok ? "" : "Failed to load settings."}
    />
  );
}
