/**
 * Staff-configurable opening image for the sprawl client boot screen.
 * Stored in DBO sprawl.splash.
 */
import { DBO } from "@ursamu/ursamu";

export const DEFAULT_SPLASH = "/api/v1/sprawl/splash.jpg";

export type SplashDoc = {
  id: string;
  image: string;
  updatedAt?: number;
};

const COL = "sprawl.splash";
const DOC_ID = "default";

const store = new DBO<SplashDoc>(COL);

export function normalizeSplashUrl(raw: string): string {
  const u = raw.trim();
  if (!u || u.toLowerCase() === "clear" || u.toLowerCase() === "default") {
    return DEFAULT_SPLASH;
  }
  if (!/^https?:\/\//i.test(u) && !u.startsWith("/")) {
    throw new Error("URL must be http(s) or /path");
  }
  return u;
}

async function loadDoc(): Promise<SplashDoc> {
  const row = await store.queryOne({ id: DOC_ID });
  if (row && typeof row === "object") {
    const d = row as SplashDoc;
    const image = String(d.image ?? "").trim();
    return {
      id: DOC_ID,
      image: image || DEFAULT_SPLASH,
      updatedAt: d.updatedAt,
    };
  }
  return { id: DOC_ID, image: DEFAULT_SPLASH };
}

export async function getSplashImage(): Promise<string> {
  const d = await loadDoc();
  return d.image || DEFAULT_SPLASH;
}

export async function setSplashImage(url: string): Promise<string> {
  const image = normalizeSplashUrl(url);
  const payload: SplashDoc = {
    id: DOC_ID,
    image,
    updatedAt: Date.now(),
  };
  const existing = await store.queryOne({ id: DOC_ID });
  if (existing) {
    await store.modify({ id: DOC_ID }, "$set", payload);
  } else {
    await store.create(payload);
  }
  return image;
}
