import { createContext } from 'react';
import { useQuery as query } from '@tanstack/react-query';
export const useQuery = (options: any) => query({ ...options, enabled: false, queryFn: () => { throw new Error('Use the local file service'); } });
export const PowerSyncContext = createContext(null);
export class PowerSyncDatabase { constructor() { throw new Error('Row sync is disabled in Godspeed Mission Control'); } }
export const column = { text: 'text', integer: 'integer', real: 'real' };
export class Schema { constructor(..._args: any[]) {} }
export class Table { constructor(..._args: any[]) {} }
export const UpdateType = { PUT:'PUT', PATCH:'PATCH', DELETE:'DELETE' };
