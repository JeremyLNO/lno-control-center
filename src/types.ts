// Shared domain types for the Control Center frontend.
// Kept deliberately loose during the gradual TS migration: the core entities carry
// an index signature so accessing a not-yet-listed field is `any` rather than an
// error. Tighten (drop the index signatures, add strictNullChecks) file-by-file later.
import type { Dispatch, SetStateAction } from 'react';

export type Role = 'admin' | 'operator' | 'viewer' | 'shareholder';
export type Permission = string; // e.g. 'view_activity' | 'view_trades' | 'view_reports' | …
export type AuthProvider = 'password' | 'google';
export type DataStatus = 'live' | 'partial' | 'offline';
export type Side = string;
export type BotStatus = 'open' | 'closed';

export interface User {
  id: string;
  email: string;
  role: Role;
  username?: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  phone?: string;
  notify?: boolean;
  permissions?: Permission[];
  authProvider?: AuthProvider;
  active?: boolean;
  lastSeen?: string | null;
  lockedUntil?: string | null;
  [k: string]: any;
}

export interface Fund {
  id: string | number;
  name: string;
  color?: string | null;
  [k: string]: any;
}

/** A bot/position row — the shape read by POS_GETTERS and the dashboards. */
export interface Bot {
  id: string;
  status: BotStatus;
  fundId?: string | number | null;
  symbol?: string;
  exchange?: string;
  fund?: { name?: string } | null;
  side?: Side;
  qty?: number;
  entry?: number;
  mark?: number;
  unrealizedPnl?: number;
  notional?: number;
  leverage?: number;
  [k: string]: any;
}
export type Position = Bot;

/** Live snapshot from the exchange-sync layer. */
export interface LiveData {
  equity?: number | null;
  connected?: number;
  errors?: number;
  [k: string]: any;
}

/** A persisted daily equity snapshot. */
export interface Snapshot {
  day: string;
  equity: number;
  pnlDay: number;
  metrics?: Record<string, any>;
  [k: string]: any;
}

/** A point on the equity time-series the charts read. */
export interface SeriesPoint {
  t: number;
  equity: number;
  pnlDay: number;
  metrics?: Record<string, any>;
}

/** A fund with its grouped bots + aggregates (built in useData). */
export interface FundGroup {
  id: string | number | null;
  name: string;
  color?: string | null;
  bots: Bot[];
  uPnl: number;
  notional: number;
  [k: string]: any;
}

/** The derived data shape the UI reads (built in useData). */
export interface DashboardData {
  bots: Bot[];
  live: LiveData | null;
  series: SeriesPoint[];
  equity: number;
  openBots: Bot[];
  unassigned: Bot[];
  byFund: FundGroup[];
  loading: boolean;
  error: unknown;
}

export interface Route {
  parts: string[];
  params: Record<string, string>;
}

export interface ApiError extends Error {
  status?: number;
  data?: any;
  timeout?: boolean;
}

export interface ApiOptions {
  method?: string;
  body?: any;
  timeoutMs?: number;
}
export type ApiFn = (path: string, opts?: ApiOptions) => Promise<any>;

/** The value carried by the `App` context (built in Root). */
export interface AppContextValue {
  route: Route;
  navigate: (to: string) => void;
  user: User | null;
  setUser: Dispatch<SetStateAction<User | null>>;
  login: (email: string, password: string) => Promise<User>;
  loginGoogle: (credential: string) => Promise<User>;
  logout: () => void;
  api: ApiFn;
  funds: Fund[];
  setFunds: Dispatch<SetStateAction<Fund[]>>;
  reloadFunds: () => Promise<Fund[]>;
  reloadData: () => Promise<void>;
  data: DashboardData | null;
  dataStatus: DataStatus;
}
