import { useRpc, useSettings, useTranslation } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import { providersListRpc, type ProviderCatalogData } from "../shared/providers";
import { unwrapResult } from "../shared/rpc";
import { zelqioSettingsDefinition, type IssueCode, type SettingsIssue } from "../shared/settings";
import { messages } from "./translations";

/** Read-only provider catalog (zelqio.providers.list). Never installs or changes anything. */
export function useCatalog() {
  const list = useRpc(providersListRpc);
  const query = useQuery<ProviderCatalogData>({ queryKey: ["zelqio.providers"], queryFn: async () => unwrapResult(await list({})) });
  return { catalog: query.data ?? null, loading: query.isLoading, failed: query.isError, retry: () => void query.refetch() };
}

export function useZelqioSettings() {
  return useSettings(zelqioSettingsDefinition);
}

/** Resolves a validation issue to a localized sentence, naming the provider with its catalog label when known. */
export function useIssueText(catalog: ProviderCatalogData | null) {
  const { t } = useTranslation(messages);
  return (issue: SettingsIssue): string => {
    const label = catalog?.providers.find((p) => p.id === issue.provider)?.label ?? issue.provider ?? "";
    return t(`issues.${issue.code satisfies IssueCode}`, { provider: label });
  };
}

export function IssueList({
  issues,
  catalog,
  color,
  warningColor,
}: {
  issues: SettingsIssue[];
  catalog: ProviderCatalogData | null;
  color: string;
  warningColor: string;
}) {
  const text = useIssueText(catalog);
  return (
    <>
      {issues.map((issue) => (
        <Text
          key={`${issue.code}:${issue.provider ?? ""}`}
          accessibilityRole="alert"
          style={{ color: issue.severity === "error" ? color : warningColor, marginTop: 4 }}
        >
          {text(issue)}
        </Text>
      ))}
    </>
  );
}
