import reduct = require('reduct')
import Config from '../services/config'
import {AccountEntry, AccountManagerInstance} from '../types/account-manager'
import Store from "../services/store"
import { create as createLogger } from '../common/log'
import { EventEmitter } from 'events'
import {AccountServiceConstructor, AccountServiceInstance} from "../types/account-service"
import {loadModuleOfType} from "../lib/utils"

const log = createLogger('in-process-account-manager')

export default class inProcess extends EventEmitter implements AccountManagerInstance {

  protected deps: reduct.Injector
  protected config: Config
  protected store: Store
  protected accountServices: Map<string, AccountServiceInstance>
  protected newAccountHandler?: (accountId: string, accountService: AccountServiceInstance) => Promise<void>
  protected removeAccountHandler?: (accountId: string) => void

  constructor (deps: reduct.Injector) {

    super()

    this.deps = deps
    this.config = deps(Config)
    this.accountServices = new Map()
    this.store = this.deps(Store)
  }

  exists (accountId: string) {
    return this.accountServices.has(accountId)
  }

  registerNewAccountHandler (handler: (accountId: string, accountService: AccountServiceInstance) => Promise<void>) {

    if (this.newAccountHandler) {
      log.error('New account handler already exists')
      throw new Error('New account handler already exists')
    }

    log.info('registering new account handler.')

    this.newAccountHandler = handler

  }

  deregisterNewAccountHandler () {

    log.info('deregistering new account handler.')

    this.newAccountHandler = undefined

  }

  registerRemoveAccountHandler (handler: (accountId: string) => void) {

    if (this.removeAccountHandler) {
      log.error('Remove account handler already exists')
      throw new Error('Remove account handler already exists')
    }

    log.info('registering remove account handler.')

    this.removeAccountHandler = handler

  }

  deregisterRemoveAccountHandler () {

    log.info('account manager deregistering removing plugin handler.')

    this.removeAccountHandler = undefined

  }

  private add (accountId: string, accountInfo: any) {

    const AccountService: AccountServiceConstructor = loadModuleOfType('account_service', 'in-process')
    this.accountServices.set(accountId, new AccountService(accountId, accountInfo, this.deps))

    if(this.newAccountHandler) this.newAccountHandler(accountId, this.accountServices.get(accountId) as AccountServiceInstance)

  }

  private remove (accountId: string) {

    const accountService = this.getAccountService(accountId)

    accountService.disconnect()
    accountService.deregisterDataHandler()
    accountService.deregisterMoneyHandler()
    accountService.deregisterConnectHandler()
    accountService.deregisterDisconnectHandler()

    if(this.removeAccountHandler) this.removeAccountHandler(accountId)

    this.accountServices.delete(accountId)
  }

  async startup () {

    const credentials = this.config.accounts
    for (let id of Object.keys(credentials)) {
      this.add(id, credentials[id])
    }

  }

  shutdown () {

    log.info('shutting down')

    this.accountServices.forEach((accountService, accountId) => this.remove(accountId))

  }

  getAccountService (accountId: string) : AccountServiceInstance {
    const accountService = this.accountServices.get(accountId)
    if(!accountService) {
      log.error('could not find account service for account id. accountId=%s', accountId)
      throw new Error('unknown account id. accountId=' + accountId)
    }
    return accountService
  }

  getAccounts() {
    return this.accountServices
  }

}
