/** REST /api/v1/sprawl — sheet, catalog, gig room art, boot splash. */
import { dbojs } from "@ursamu/ursamu";
import { readSprawl } from "./db/schemas.ts";
import {
  adminCatalog,
  adminCatalogKinds,
  adminMarketCategories,
  adminMarketRows,
  adminOverview,
  catalogRowPreview,
  filterCatalogRows,
} from "./engine/admin.ts";
import {
  grantApAmount,
  grantCash,
} from "./engine/staff-grant.ts";
import { getChar } from "./engine/sheet-io.ts";
import type { ISprawlChar } from "./db/schemas.ts";
import {
  gigRoomArtCatalog,
  listGigRoomArt,
  setGigRoomArt,
} from "./engine/gig-art.ts";
import {
  districtCatalog,
  searchRooms,
  setDistrictImage,
  setDistrictRoom,
} from "./engine/districts.ts";
import {
  hangoutCatalog,
  setHangoutImage,
  setHangoutRoom,
} from "./engine/hangouts.ts";
import {
  DEFAULT_SPLASH,
  getSplashImage,
  setSplashImage,
} from "./engine/splash.ts";

const SPLASH_FILE = new URL("./static/splash.jpg", import.meta.url);

function flagBlob(obj: { flags?: unknown }): string {
  const f = obj.flags;
  if (f instanceof Set) return [...f].map(String).join(" ");
  if (Array.isArray(f)) return f.map(String).join(" ");
  return String(f ?? "");
}

async function isStaffUser(userId: string): Promise<boolean> {
  const obj = await dbojs.queryOne({ id: userId });
  if (!obj) return false;
  const fl = flagBlob(obj as { flags?: unknown }).toLowerCase();
  return (
    fl.includes("wizard") ||
    fl.includes("admin") ||
    fl.includes("superuser") ||
    fl.includes("staff")
  );
}

async function splashJson(): Promise<Response> {
  try {
    const image = await getSplashImage();
    return Response.json({ image: image || DEFAULT_SPLASH });
  } catch {
    return Response.json({ image: DEFAULT_SPLASH });
  }
}

async function splashJpg(): Promise<Response> {
  try {
    const file = await Deno.readFile(SPLASH_FILE);
    return new Response(file, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return Response.json({ error: "No splash file" }, { status: 404 });
  }
}

export async function routeHandler(
  req: Request,
  userId: string | null,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/v1\/sprawl/, "") ||
    "/";

  if (req.method === "GET" && (path === "/splash" || path === "/splash/")) {
    return splashJson();
  }
  if (req.method === "GET" && path === "/splash.jpg") {
    return splashJpg();
  }

  if (!userId) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  if (req.method === "PUT" && (path === "/splash" || path === "/splash/")) {
    if (!(await isStaffUser(userId))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
      const body = await req.json() as { image?: string };
      const image = await setSplashImage(String(body.image ?? "clear"));
      return Response.json({ ok: true, image });
    } catch (e: unknown) {
      return Response.json(
        {
          error: e instanceof Error ? e.message : "Bad request",
        },
        { status: 400 },
      );
    }
  }

  if (req.method === "GET" && path.startsWith("/sheet/")) {
    const id = path.slice("/sheet/".length).split("/")[0];
    if (!id) {
      return Response.json({ error: "Missing id" }, { status: 400 });
    }
    const obj = await dbojs.queryOne({ id });
    if (!obj) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const sheet = readSprawl(
      obj.state as Record<string, unknown> | undefined,
    );
    return Response.json({ id, sheet });
  }

  if (req.method === "GET" && (path === "/catalog" || path === "/catalog/")) {
    if (!(await isStaffUser(userId))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const catalogs = adminOverview().catalogs;
    return Response.json({
      kinds: adminCatalogKinds(),
      catalogs,
      count: catalogs.length,
    });
  }

  if (req.method === "GET" && path.startsWith("/catalog/")) {
    if (!(await isStaffUser(userId))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const raw = path.slice("/catalog/".length).split("/")[0] ?? "";
    let kind = raw;
    try {
      kind = decodeURIComponent(raw);
    } catch {
      kind = raw;
    }
    const items = adminCatalog(kind);
    if (!items) {
      return Response.json(
        { error: "Unknown catalog", keys: adminCatalogKinds() },
        { status: 400 },
      );
    }
    const q = url.searchParams.get("q") ?? "";
    const rows = filterCatalogRows(items, q);
    return Response.json({
      kind: kind.trim().toLowerCase(),
      total: items.length,
      count: rows.length,
      items: rows.map(catalogRowPreview),
    });
  }

  if (req.method === "GET" && (path === "/market" || path === "/market/")) {
    if (!(await isStaffUser(userId))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const q = url.searchParams.get("q") ?? "";
    const cat = url.searchParams.get("cat") ?? "";
    const items = adminMarketRows(q, cat);
    const total = adminMarketRows("", "").length;
    return Response.json({
      count: items.length,
      total,
      categories: adminMarketCategories(),
      items,
    });
  }

  if (req.method === "GET" && (path === "/admin" || path === "/admin/")) {
    if (!(await isStaffUser(userId))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return Response.json({ ok: true, ...adminOverview() });
  }

  if (req.method === "POST" && path === "/staff/grant") {
    if (!(await isStaffUser(userId))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
      const body = await req.json() as {
        who?: string;
        kind?: string;
        value?: string | number;
      };
      const who = String(body.who ?? "").trim();
      const kind = String(body.kind ?? "").trim().toLowerCase();
      const value = body.value;
      if (!who || (kind !== "cash" && kind !== "ap")) {
        return Response.json(
          { error: "Need who + kind cash|ap" },
          { status: 400 },
        );
      }
      const obj = await dbojs.queryOne({ name: who });
      if (!obj) {
        return Response.json({ error: "Player not found" }, { status: 404 });
      }
      const rec = obj as { id: string; name?: string; state?: Record<string, unknown> };
      const sheet = getChar(rec as never);
      if (!sheet) {
        return Response.json({ error: "No sprawl sheet" }, { status: 404 });
      }
      const n = Number(value);
      const r = kind === "cash" ? grantCash(sheet, n) : grantApAmount(sheet, n);
      if (!r.ok) {
        return Response.json({ error: r.reason }, { status: 400 });
      }
      await dbojs.modify({ id: rec.id }, "$set", {
        "state.sprawl": r.char,
      });
      return Response.json({
        ok: true,
        note: r.note,
        who: rec.name ?? who,
        cash: (r.char as ISprawlChar).bityuan,
        ap: (r.char as ISprawlChar).ap,
      });
    } catch (e: unknown) {
      return Response.json(
        { error: e instanceof Error ? e.message : "Bad request" },
        { status: 400 },
      );
    }
  }

  // Staff: Flow districts — room link + client image
  if (
    req.method === "GET" &&
    (path === "/districts/rooms" || path === "/districts/rooms/")
  ) {
    if (!(await isStaffUser(userId))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const q = url.searchParams.get("q") ?? "";
    const rooms = await searchRooms(q);
    return Response.json({ rooms });
  }

  if (
    (req.method === "GET" || req.method === "PUT") &&
    (path === "/districts" || path === "/districts/")
  ) {
    if (!(await isStaffUser(userId))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (req.method === "GET") {
      const districts = await districtCatalog();
      return Response.json({ districts });
    }
    try {
      const body = await req.json() as {
        slug?: string;
        image?: string;
        room?: string;
        roomId?: string;
      };
      const slug = String(body.slug ?? "").trim();
      if (!slug) {
        return Response.json({ error: "Need slug" }, { status: 400 });
      }
      let row;
      if (body.image != null) {
        row = await setDistrictImage(slug, String(body.image));
      }
      if (body.room != null || body.roomId != null) {
        row = await setDistrictRoom(
          slug,
          String(body.room ?? body.roomId ?? "clear"),
        );
      }
      if (!row) {
        return Response.json(
          { error: "Need image and/or room" },
          { status: 400 },
        );
      }
      return Response.json({ ok: true, district: row });
    } catch (e: unknown) {
      return Response.json(
        {
          error: e instanceof Error ? e.message : "Bad request",
        },
        { status: 400 },
      );
    }
  }

  // Staff: RP hangouts — room link + client image
  if (
    (req.method === "GET" || req.method === "PUT") &&
    (path === "/hangouts" || path === "/hangouts/")
  ) {
    if (!(await isStaffUser(userId))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (req.method === "GET") {
      const hangouts = await hangoutCatalog();
      return Response.json({ hangouts });
    }
    try {
      const body = await req.json() as {
        slug?: string;
        image?: string;
        room?: string;
        roomId?: string;
      };
      const slug = String(body.slug ?? "").trim();
      if (!slug) {
        return Response.json({ error: "Need slug" }, { status: 400 });
      }
      let row;
      if (body.image != null) {
        row = await setHangoutImage(slug, String(body.image));
      }
      if (body.room != null || body.roomId != null) {
        row = await setHangoutRoom(
          slug,
          String(body.room ?? body.roomId ?? "clear"),
        );
      }
      if (!row) {
        return Response.json(
          { error: "Need image and/or room" },
          { status: 400 },
        );
      }
      return Response.json({ ok: true, hangout: row });
    } catch (e: unknown) {
      return Response.json(
        {
          error: e instanceof Error ? e.message : "Bad request",
        },
        { status: 400 },
      );
    }
  }

  // Staff: gig room type images
  if (
    (req.method === "GET" || req.method === "PUT") &&
    (path === "/gig-rooms" || path === "/gig-rooms/")
  ) {
    if (!(await isStaffUser(userId))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (req.method === "GET") {
      const rooms = await gigRoomArtCatalog();
      const art = await listGigRoomArt();
      return Response.json({ rooms, art });
    }
    try {
      const body = await req.json() as {
        slug?: string;
        image?: string;
        bySlug?: Record<string, string>;
      };
      if (body.bySlug && typeof body.bySlug === "object") {
        for (const [slug, image] of Object.entries(body.bySlug)) {
          await setGigRoomArt(slug, String(image ?? "clear"));
        }
      } else if (body.slug != null) {
        await setGigRoomArt(
          String(body.slug),
          String(body.image ?? "clear"),
        );
      } else {
        return Response.json(
          { error: "Need slug+image or bySlug map" },
          { status: 400 },
        );
      }
      const rooms = await gigRoomArtCatalog();
      return Response.json({ ok: true, rooms });
    } catch (e: unknown) {
      return Response.json(
        {
          error: e instanceof Error ? e.message : "Bad request",
        },
        { status: 400 },
      );
    }
  }

  if (req.method === "GET" && path === "/") {
    return Response.json({
      ok: true,
      system: "sprawl-goons",
      version: "1.0.0",
      endpoints: [
        "/sheet/:id",
        "/catalog",
        "/catalog/:kind",
        "/market",
        "/admin",
        "/staff/grant",
        "/districts",
        "/districts/rooms",
        "/hangouts",
        "/gig-rooms",
        "/splash",
        "/splash.jpg",
      ],
    });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
