import type { ImgHTMLAttributes } from "react";
import { useScopedImageSrc } from "@/lib/federation/scoped-image-src";

export function ScopedImg({
  src,
  alt,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const resolved = useScopedImageSrc(src);
  if (resolved === null) return null;
  return <img {...rest} src={resolved} alt={alt ?? ""} />;
}
