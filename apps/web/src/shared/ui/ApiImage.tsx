import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";

// A picture that lives behind the API (an item picture, the company logo). The browser cannot fetch it with a plain
// <img src>, because that request would carry no sign-in token; so it is fetched as a blob with the user's own token
// and shown from memory. `version` is any value that changes when the picture changes (the attachment id), so a
// replaced picture is fetched again and an unchanged one is not.
export function useApiImageUrl(path: string | null, version: string | null): { url: string | null; isPending: boolean } {
  const { data, isPending } = useQuery({
    queryKey: ["api-image", path, version],
    queryFn: async () => (await apiClient.get<Blob>(path ?? "", { responseType: "blob" })).data,
    enabled: path !== null,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) {
      setUrl(null);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [data]);
  return { url, isPending: path !== null && isPending };
}

export function ApiImage({
  path,
  version,
  alt = "",
  className,
  fallback,
}: {
  readonly path: string | null;
  readonly version: string | null;
  readonly alt?: string;
  readonly className?: string;
  // Shown when there is no picture or it could not be loaded.
  readonly fallback?: React.ReactNode;
}): React.JSX.Element {
  const { url } = useApiImageUrl(path, version);
  if (!url) return <>{fallback ?? null}</>;
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}
