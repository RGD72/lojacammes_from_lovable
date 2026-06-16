import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { supabase } from "@/integrations/supabase/client";

const TTL_SECONDS = 60 * 60; // 1h
const cache = new Map<string, { url: string; exp: number }>();

/**
 * Accepts either:
 *   - a storage public/sign URL ("/storage/v1/object/(public|sign)/<bucket>/<path>...")
 *   - a raw "<bucket>/<path>" string when bucketHint is omitted and the input contains "/"
 *   - or "<path>" together with an explicit bucketHint
 */
function parseInput(
  input: string,
  bucketHint?: string,
): { bucket: string; path: string } | null {
  const m = input.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/);
  if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  if (bucketHint) return { bucket: bucketHint, path: input.replace(/^\//, "") };
  return null;
}

export async function signStorageUrl(
  input: string | null | undefined,
  bucketHint?: string,
): Promise<string | null> {
  if (!input) return null;
  const now = Math.floor(Date.now() / 1000);
  const cached = cache.get(input);
  if (cached && cached.exp - 60 > now) return cached.url;

  const parsed = parseInput(input, bucketHint);
  if (!parsed) return input;

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, TTL_SECONDS);
  if (error || !data?.signedUrl) {
    // Fall back to original so UI still renders something (will likely 401),
    // but at least we don't crash.
    return input;
  }
  cache.set(input, { url: data.signedUrl, exp: now + TTL_SECONDS });
  return data.signedUrl;
}

export function useSignedUrl(
  input: string | null | undefined,
  bucketHint?: string,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    signStorageUrl(input, bucketHint).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [input, bucketHint]);
  return url;
}

export function useSignedUrls(
  inputs: (string | null | undefined)[] | null | undefined,
  bucketHint?: string,
): string[] {
  const key = (inputs ?? []).join("\u0001");
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      (inputs ?? []).map((i) => signStorageUrl(i, bucketHint)),
    ).then((arr) => {
      if (!cancelled) setUrls(arr.filter((u): u is string => !!u));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bucketHint]);
  return urls;
}

/**
 * Drop-in <img> that signs a private-bucket URL before rendering.
 */
export function SignedImg({
  src,
  bucketHint,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & {
  src: string | null | undefined;
  bucketHint?: string;
}) {
  const signed = useSignedUrl(src ?? null, bucketHint);
  if (!signed) return null;
  return <img src={signed} {...rest} />;
}