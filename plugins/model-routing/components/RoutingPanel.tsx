import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-kaioken/plugin-sdk/app";
import { Button } from "@kaioken/shared-ui/button";
import { Input } from "@kaioken/shared-ui/input";
import { Switch } from "@kaioken/shared-ui/switch";
import type { rpcContract } from "../server";

type EndpointId = "openrouter" | "deepseek" | "custom";

interface PickerModel {
  id: string;
  label: string;
  contextLength: number | null;
  enabled: boolean;
}

interface EndpointStatus {
  id: EndpointId;
  label: string;
  configured: boolean;
  hasCatalog: boolean;
  ready: { claudeCode: boolean; codex: boolean };
  summary: string;
  enabled: string[];
}

const PAGE_SIZE = 60;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function matches(model: PickerModel, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    model.id.toLowerCase().includes(needle) ||
    model.label.toLowerCase().includes(needle)
  );
}

function readiness(status: EndpointStatus): string {
  const parts: string[] = [];
  if (status.ready.claudeCode) parts.push("Claude Code");
  if (status.ready.codex) parts.push("Codex");
  return parts.length === 0
    ? "Not usable yet"
    : `Usable with ${parts.join(" and ")}`;
}

export function RoutingPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const [endpoints, setEndpoints] = useState<EndpointStatus[] | null>(null);
  const [selected, setSelected] = useState<EndpointId | null>(null);
  const [models, setModels] = useState<PickerModel[]>([]);
  const [query, setQuery] = useState("");
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await rpc.call("status", {});
      if (mounted.current) setEndpoints(next.endpoints);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    }
  }, [rpc]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const loadModels = useCallback(
    async (endpoint: EndpointId, refresh: boolean) => {
      setSelected(endpoint);
      setLoading(true);
      setError(null);
      setQuery("");
      try {
        const result = await rpc.call("models", { endpoint, refresh });
        if (!mounted.current) return;
        if (result.ok) {
          setModels(result.models);
          if (result.models.length === 0) {
            setError(
              endpoint === "custom"
                ? "Add model ids to the Custom endpoint models setting above."
                : "This endpoint published no models.",
            );
          }
        } else {
          setModels([]);
          setError(result.error);
        }
      } catch (cause) {
        if (mounted.current) setError(errorMessage(cause));
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [rpc],
  );

  async function toggle(model: PickerModel, enabled: boolean) {
    if (selected === null) return;
    setModels((current) =>
      current.map((entry) =>
        entry.id === model.id ? { ...entry, enabled } : entry,
      ),
    );
    try {
      await rpc.call("setEnabled", {
        endpoint: selected,
        model: model.id,
        enabled,
      });
      await refreshStatus();
    } catch (cause) {
      if (mounted.current) {
        setError(errorMessage(cause));
        setModels((current) =>
          current.map((entry) =>
            entry.id === model.id ? { ...entry, enabled: !enabled } : entry,
          ),
        );
      }
    }
  }

  const visible = models
    .filter((model) => (onlyEnabled ? model.enabled : true))
    .filter((model) => matches(model, query));
  const shown = visible.slice(0, PAGE_SIZE);
  const current = endpoints?.find((endpoint) => endpoint.id === selected);

  return (
    <div className="flex flex-col gap-4">
      {endpoints === null ? (
        <p className="text-sm text-muted-foreground">Reading endpoints…</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {endpoints.map((endpoint) => (
            <li
              key={endpoint.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-sm text-foreground">
                  {endpoint.label}
                  <span className="text-muted-foreground">
                    {endpoint.configured
                      ? ` · ${readiness(endpoint)}`
                      : " · No API key yet"}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {endpoint.enabled.length === 0
                    ? "Nothing in the picker"
                    : `${endpoint.enabled.length} in the picker: ${endpoint.enabled.slice(0, 3).join(", ")}${endpoint.enabled.length > 3 ? "…" : ""}`}
                </span>
              </div>
              <Button
                type="button"
                variant={selected === endpoint.id ? "default" : "outline"}
                size="sm"
                disabled={loading || !endpoint.configured}
                onClick={() => void loadModels(endpoint.id, false)}
              >
                {endpoint.hasCatalog ? "Choose models" : "Show models"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error !== null ? (
        <p className="text-xs text-destructive-text">{error}</p>
      ) : null}

      {current !== undefined && models.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Search models"
              className="min-w-48 flex-1"
              placeholder={`Search ${current.label} models`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={onlyEnabled}
                onCheckedChange={(checked) => setOnlyEnabled(checked === true)}
                aria-label="Show only models in the picker"
              />
              In picker only
            </label>
            {current.hasCatalog ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void loadModels(current.id, true)}
              >
                Refresh list
              </Button>
            ) : null}
          </div>
          <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {shown.map((model) => (
              <li
                key={model.id}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-state-hover"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="min-w-0 truncate text-sm text-foreground">
                    {model.label}
                  </span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {model.id}
                    {model.contextLength === null
                      ? ""
                      : ` · ${model.contextLength.toLocaleString()} ctx`}
                  </span>
                </div>
                <Switch
                  checked={model.enabled}
                  disabled={current.id === "custom"}
                  onCheckedChange={(checked) =>
                    void toggle(model, checked === true)
                  }
                  aria-label={`Show ${model.id} in the picker`}
                />
              </li>
            ))}
          </ul>
          {visible.length > shown.length ? (
            <p className="text-xs text-muted-foreground">
              {`Showing ${shown.length} of ${visible.length}. Search to narrow the list.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
