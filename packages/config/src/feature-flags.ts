import type { FeatureFlags } from "@kaioken/domain";
import {
  readEnvVarWithDefault,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import {
  KAIOKEN_FF_PLACEHOLDER_ENV,
  KAIOKEN_FF_TIMELINE_WINDOW_EVENT_BUDGET_ENV,
  DEFAULT_KAIOKEN_FF_PLACEHOLDER,
  DEFAULT_KAIOKEN_FF_TIMELINE_WINDOW_EVENT_BUDGET,
} from "./env-vars.js";

type LoadFeatureFlagsArgs = EnvLoaderArgs;

export function loadFeatureFlags(
  args: LoadFeatureFlagsArgs = {},
): FeatureFlags {
  const loader = resolveEnvLoader(args);
  return {
    placeholder: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_FF_PLACEHOLDER,
      definition: KAIOKEN_FF_PLACEHOLDER_ENV,
      env: loader.env,
    }),
    timelineWindowEventBudget: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_FF_TIMELINE_WINDOW_EVENT_BUDGET,
      definition: KAIOKEN_FF_TIMELINE_WINDOW_EVENT_BUDGET_ENV,
      env: loader.env,
    }),
  };
}
