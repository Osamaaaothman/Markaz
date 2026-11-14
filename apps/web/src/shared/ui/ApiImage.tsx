import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Image } from "primereact/image";
import { apiClient } from "../api/client";
import { useCurrentUser } from "../auth/use-current-user";
import { useTranslation } from "react-i18next";
import { AxiosError } from "axios";

// A picture that lives behind the API (an item picture, the company logo). The browser cannot fetch it with a plain
// <img src>, because that request would carry no sign-in token; so it is fetched as a blob with the user's own token
// and shown from memory. `version` is any value that changes when the picture changes (the attachment id), so a
// replaced picture is fetched again and an unchanged one is not.
export function useApiImageUrl(path: string | null, version: string | null): { url: string | null; isPending: boolean; isError: boolean; retry: () => void } {
  const { data: user } = useCurrentUser();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["api-image", user?.companyId, path, version],
    queryFn: async () => {
      const response = await apiClient.get<Blob>(path ?? "", { responseType: "blob" });
      if (!response.data.type.startsWith("image/")) throw new Error("Invalid image response");
      return response.data;
    },
    enabled: path !== null && Boolean(user?.companyId),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: (count, error) => count < 1 && !(error instanceof AxiosError && [401, 403, 404].includes(error.response?.status ?? 0)),
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
  return { url, isPending: path !== null && isPending, isError, retry: () => { void refetch(); } };
}

export function ApiImage({
  path,
  version,
  alt = "",
  className,
  fallback,
  zoomable = false,
}: {
  readonly path: string | null;
  readonly version: string | null;
  readonly alt?: string;
  readonly className?: string;
  // Shown when there is no picture or it could not be loaded.
  readonly fallback?: React.ReactNode;
  // Shows PrimeReact's zoom button over the picture and opens it full size, with zoom and rotate.
  readonly zoomable?: boolean;
}): React.JSX.Element {
  const { url, isError, retry } = useApiImageUrl(path, version);
  const { t } = useTranslation();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (path && (isError || (url !== null && url === failedUrl))) return <div role="alert"><p>{t("attachments.imageLoadError")}</p><button type="button" className="erp-button-link" onClick={retry}>{t("actions.retry")}</button></div>;
  if (!url) return <>{fallback ?? null}</>;
  if (zoomable) return <Image src={url} alt={alt} preview imageClassName={className} className="mk-zoom" onError={() => setFailedUrl(url)} />;
  return <img src={url} alt={alt} className={className} loading="lazy" onError={() => setFailedUrl(url)} />;
}
