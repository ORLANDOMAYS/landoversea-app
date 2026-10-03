type NotificationTarget = {
  type?: string;
  relatedId?: number;
};

/**
 * Canonical HTTPS paths accepted by the app. Keep this list in sync with the
 * Android intent filter and the Apple association template.
 */
export const INTERNAL_LINK_PATHS = [
  '/reset-password',
  '/discover',
  '/matches',
  '/messages',
  '/profile',
  '/coaches',
  '/events',
  '/tribes',
  '/workshops',
  '/notifications',
  '/premium',
  '/settings',
  '/culture',
  '/learning',
  '/safety',
] as const;

const STATIC_ROUTES = new Set<string>([
  ...INTERNAL_LINK_PATHS,
]);

const GROUP_ROUTE_ALIASES = new Map<string, string>([
  ['/(tabs)/discover', '/discover'],
  ['/(tabs)/matches', '/matches'],
  ['/(tabs)/messages', '/messages'],
  ['/(tabs)/coaches', '/coaches'],
  ['/(tabs)/profile', '/profile'],
]);

const DYNAMIC_ROUTES = [
  /^\/messages\/[1-9]\d*$/,
  /^\/coaches\/[1-9]\d*$/,
  /^\/profile\/[1-9]\d*$/,
  /^\/events\/[1-9]\d*$/,
  /^\/tribes\/[1-9]\d*$/,
  /^\/workshops\/[1-9]\d*$/,
];

export function resolveInternalRoute(value?: unknown, target?: NotificationTarget): string {
  if (typeof value === 'string') {
    const route = value.trim().split(/[?#]/, 1)[0];
    const canonicalRoute = GROUP_ROUTE_ALIASES.get(route);
    if (canonicalRoute) return canonicalRoute;
    if (STATIC_ROUTES.has(route) || DYNAMIC_ROUTES.some(pattern => pattern.test(route))) return route;
    return '/not-found';
  }

  const id = target?.relatedId;
  if (target?.type === 'message' && id) return `/messages/${id}`;
  if (target?.type === 'coach' && id) return `/coaches/${id}`;
  if (target?.type === 'event' && id) return `/events/${id}`;
  if (target?.type === 'tribe' && id) return `/tribes/${id}`;
  if (target?.type === 'workshop' && id) return `/workshops/${id}`;
  if (target?.type === 'match' || target?.type === 'superlike') return '/matches';
  return '/notifications';
}