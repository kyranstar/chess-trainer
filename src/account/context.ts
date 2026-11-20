/** The signed-in account, for screens that greet or show the account (ADR-063). Null in local mode. */
import { createContext, useContext } from 'react';
import type { AccountService } from './types';

export interface AccountInfo {
  uid: string;
  email: string;
  name: string;
  admin: boolean;
  service: AccountService;
}

export const AccountContext = createContext<AccountInfo | null>(null);
export function useAccount(): AccountInfo | null {
  return useContext(AccountContext);
}
