import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getBbDesktopInfo } from "@/lib/kaioken-desktop";

export function DesktopWorkspaceNavigation() {
  const navigate = useNavigate();
  useEffect(
    () =>
      getBbDesktopInfo()?.onWorkspaceNavigate?.((path) => {
        void navigate(path);
      }),
    [navigate],
  );
  return null;
}
