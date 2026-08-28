/**
 * Soft-register Sprawl in the staff console (page + side-nav).
 */
const PAGE = {
  id: "sprawl",
  label: "Sprawl",
  description: "Art, districts, catalogs, market, staff grants",
  route: "sprawl-gigs",
  order: 55,
} as const;

const SIDE = {
  pageId: PAGE.id,
  groups: [
    {
      items: [
        {
          id: "art",
          label: "Art",
          desc: "Splash & gig rooms",
          icon: "▣",
          query: { tab: "art" },
        },
        {
          id: "districts",
          label: "Districts",
          desc: "Rooms & map art",
          icon: "◈",
          query: { tab: "districts" },
        },
        {
          id: "hangouts",
          label: "Haunts",
          desc: "RP dives & booths",
          icon: "◐",
          query: { tab: "hangouts" },
        },
        {
          id: "catalogs",
          label: "Catalogs",
          desc: "Data tables",
          icon: "☰",
          query: { tab: "catalogs" },
        },
        {
          id: "market",
          label: "Market",
          desc: "Street stock",
          icon: "¥",
          query: { tab: "market" },
        },
        {
          id: "staff",
          label: "Staff",
          desc: "Cash & AP grants",
          icon: "★",
          query: { tab: "staff" },
        },
      ],
    },
  ],
} as const;

type WebMod = {
  softRegisterStaffPage?: (p: typeof PAGE) => Promise<boolean>;
  softUnregisterStaffPage?: (id: string) => Promise<boolean>;
  registerStaffPage?: (p: typeof PAGE) => void;
  unregisterStaffPage?: (id: string) => void;
  softRegisterStaffSideNav?: (r: typeof SIDE) => Promise<boolean>;
  softUnregisterStaffSideNav?: (id: string) => Promise<boolean>;
  registerStaffSideNav?: (r: typeof SIDE) => void;
  unregisterStaffSideNav?: (id: string) => void;
};

async function web(): Promise<WebMod | null> {
  try {
    const spec = "@ursamu/web";
    return await import(spec) as WebMod;
  } catch {
    return null;
  }
}

export async function registerSprawlStaffNav(): Promise<void> {
  const mod = await web();
  if (!mod) return;
  if (typeof mod.softRegisterStaffPage === "function") {
    await mod.softRegisterStaffPage({ ...PAGE });
  } else {
    mod.registerStaffPage?.({ ...PAGE });
  }
  if (typeof mod.softRegisterStaffSideNav === "function") {
    await mod.softRegisterStaffSideNav({ ...SIDE });
    return;
  }
  mod.registerStaffSideNav?.({ ...SIDE });
}

export async function unregisterSprawlStaffNav(): Promise<void> {
  const mod = await web();
  if (!mod) return;
  if (typeof mod.softUnregisterStaffSideNav === "function") {
    await mod.softUnregisterStaffSideNav(PAGE.id);
  } else {
    mod.unregisterStaffSideNav?.(PAGE.id);
  }
  if (typeof mod.softUnregisterStaffPage === "function") {
    await mod.softUnregisterStaffPage(PAGE.id);
    return;
  }
  mod.unregisterStaffPage?.(PAGE.id);
}
