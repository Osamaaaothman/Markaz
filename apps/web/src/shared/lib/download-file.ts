// The one place a browser download is triggered from a fetched Blob — an
// authenticated API response can't just be a plain <a href> link (the browser
// would send the request with no Authorization header), so this downloads via
// axios instead and hands the resulting Blob to a throwaway anchor element.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
