import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-kaioken/plugin-sdk/app";
import { Button } from "@kaioken/shared-ui/button";
import { Input } from "@kaioken/shared-ui/input";
import type { rpcContract } from "../server";

type EndpointId = "openrouter" | "deepseek" | "custom";

interface CatalogModel {
  id: string;
  label: string;
  contextLength: number | null;
}

interface StatusView {
  route: string;
  model: string;
  summary: string;
  ready: boolean;
  configuredEndpoints: string[];
  codexLimitation: string;
}

const ENDPOINT_LABELS: Readonly<Record<EndpointId, string>> = {
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  custom: "Custom",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function matches(model: CatalogModel, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    model.id.toLowerCase().includes(needle) ||
    model.label.toLowerCase().includes(needle)
  );
}

export function RoutingPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<StatusView | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [query, setQuery] = useState("");
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
      if (mounted.current) setStatus(next);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    }
  }, [rpc]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  async function loadModels(endpoint: EndpointId) {
    setLoading(true);
    setError(null);
    try {
      const result = await rpc.call("models", { endpoint });
      if (!mounted.current) return;
      if (result.ok) {
        setModels(result.models);
        if (result.models.length === 0) {
          setError(`${ENDPOINT_LABELS[endpoint]} published no models.`);
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
  }

  async function choose(model: string) {
    try {
      const next = await rpc.call("selectModel", { model });
      if (!mounted.current) return;
      setStatus((current) =>
        current === null
          ? current
          : { ...current, model: next.model, summary: next.summary },
      );
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    }
  }

  const visible = models.filter((model) => matches(model, query)).slice(0, 40);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-foreground">
          {status?.summary ?? "Reading the current route…"}
        </p>
        <p className="text-xs text-muted-foreground">
          {status === null
            ? ""
            : status.configuredEndpoints.length > 0
              ? `Keys stored for ${status.configuredEndpoints.join(", ")}.`
              : "No API keys stored yet. Add one in the settings above."}
        </p>
        {status !== null ? (
          <p className="text-xs text-muted-foreground">
            {status.codexLimitation}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(ENDPOINT_LABELS) as EndpointId[]).map((endpoint) => (
          <Button
            key={endpoint}
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadModels(endpoint)}
          >
            {`Load ${ENDPOINT_LABELS[endpoint]} models`}
          </Button>
        ))}
      </div>

      {error !== null ? (
        <p className="text-xs text-destructive-text">{error}</p>
      ) : null}

      {models.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Input
            aria-label="Search models"
            placeholder="Search models"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {visible.map((model) => {
              const selected = status?.model === model.id;
              return (
                <li key={model.id}>
                  <button
                    type="button"
                    onClick={() => void choose(model.id)}
                    className="flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {model.id}
                      {selected ? " — in use" : ""}
                    </span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {model.label}
                      {model.contextLength === null
                        ? ""
                        : ` · ${model.contextLength.toLocaleString()} ctx`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
