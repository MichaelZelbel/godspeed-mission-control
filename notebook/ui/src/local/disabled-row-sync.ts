import { createContext } from 'react';
import { useQuery as query, type UseQueryResult } from '@tanstack/react-query';

// Stands in for @powersync/web, @powersync/react and @powersync/tanstack-react-query
// (vite.config.ts and tsconfig.app.json both resolve them here). The row-sync code
// that imports them only runs when OFFLINE_CORE is on, and it is always off, so
// these types only let that code compile; nothing below is ever reached at runtime.
interface RowSyncDatabase {
  get<Row>(sql: string, parameters?: unknown[]): Promise<Row>;
  getAll<Row>(sql: string, parameters?: unknown[]): Promise<Row[]>;
  getOptional<Row>(sql: string, parameters?: unknown[]): Promise<Row | null>;
  [method: string]: any;
}
export type AbstractPowerSyncDatabase = RowSyncDatabase;
export type CrudEntry = Record<string, any>;
export interface PowerSyncBackendConnector {
  fetchCredentials(): Promise<unknown>;
  uploadData(database: AbstractPowerSyncDatabase): Promise<void>;
}

export const useQuery = <Row = unknown, Data = Row[]>(
  options: { select?: (rows: Row[]) => Data } & Record<string, unknown>,
): UseQueryResult<Data> =>
  query<Row[], Error, Data>({ queryKey: options.queryKey as unknown[], select: options.select, enabled: false, queryFn: () => { throw new Error('Use the local file service'); } });
export const PowerSyncContext = createContext(null);
export const PowerSyncDatabase = class { constructor(..._args: any[]) { throw new Error('Row sync is disabled in Godspeed Mission Control'); } } as unknown as new (options: unknown) => RowSyncDatabase;
export type PowerSyncDatabase = RowSyncDatabase;
export const column = { text: 'text', integer: 'integer', real: 'real' };
export class Schema { constructor(..._args: any[]) {} }
export class Table { constructor(..._args: any[]) {} }
export const UpdateType = { PUT:'PUT', PATCH:'PATCH', DELETE:'DELETE' };
