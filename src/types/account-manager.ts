import reduct = require('reduct')
import {AccountServiceInstance} from "./account-service"
import {AccountInfo} from "./accounts"

export interface AccountManagerConstructor {
  new (deps: reduct.Injector): AccountManagerInstance
}

export interface AccountEntry {
  id: string,
  info: AccountInfo
}

export interface AccountManagerInstance {
  registerNewAccountHandler(handler: (accountId: string, accountService: AccountServiceInstance) => Promise<void>): void,
  deregisterNewAccountHandler(): void,
  registerRemoveAccountHandler(handler: (accountId: string) => void): void,
  deregisterRemoveAccountHandler(): void,
  getAccounts(): Map<string, AccountServiceInstance>
  startup(): void,
  shutdown(): void
}
