import reduct = require('reduct')
import Store from '../services/store'
import Config from './config'
import { EventEmitter } from 'events'
import { AccountInfo } from '../types/accounts'
import ILDCP = require('ilp-protocol-ildcp')

import { create as createLogger } from '../common/log'
import AccountManager from "./account-manager"
const log = createLogger('accounts')

export interface AccountEntry {
  info: AccountInfo
}

export default class Accounts extends EventEmitter {
  protected config: Config
  protected store: Store

  protected address: string
  protected accounts: Map<string, AccountEntry>
  protected accountManager: AccountManager

  constructor (deps: reduct.Injector) {
    super()

    this.config = deps(Config)
    this.store = deps(Store)
    this.accountManager = deps(AccountManager)

    this.address = this.config.ilpAddress || 'unknown'
    this.accounts = new Map()
  }

  async loadIlpAddress () {
    const inheritFrom = this.config.ilpAddressInheritFrom ||
      // Get account id of first parent
      [...this.accounts]
        .filter(([key, value]) => value.info.relation === 'parent')
        .map(([key]) => key)[0]

    if (this.config.ilpAddress === 'unknown' && !inheritFrom) {
      throw new Error('When there is no parent, ILP address must be specified in configuration.')
    } else if (this.config.ilpAddress === 'unknown' && inheritFrom) {

      const ildcpInfo = await ILDCP.fetch((data: Buffer) => this.accountManager.sendData(data, inheritFrom))

      this.setOwnAddress(ildcpInfo.clientAddress)

      if (this.address === 'unknown') {
        log.error('could not get ilp address from parent.')
        throw new Error('no ilp address configured.')
      }
    }
  }

  getOwnAddress () {
    return this.address
  }

  setOwnAddress (newAddress) {
    log.trace('setting ilp address. oldAddress=%s newAddress=%s', this.address, newAddress)
    this.address = newAddress
  }

  exists (accountId: string) {
    return this.accounts.has(accountId)
  }

  getAccountIds () {
    return Array.from(this.accounts.keys())
  }

  getAssetCode (accountId: string) {
    const account = this.accounts.get(accountId)

    if (!account) {
      log.error('no currency found. account=%s', accountId)
      return undefined
    }

    return account.info.assetCode
  }

  add (accountId: string, creds: any) {
    log.info('add account. accountId=%s', accountId)

    // Although cloning the options object that comes in from
    // code that includes ilp-connector is good practice,
    // this breaks for instance when the plugin options
    // contain for instance a https server like in `wsOpts` in
    // https://github.com/interledgerjs/ilp-plugin-mini-accounts/blob/a77f1a6b984b6816856a0948dfa57fe95e7ddd8b/README.md#example
    //
    // creds = cloneDeep(creds)

    try {
      this.config.validateAccount(accountId, creds)
    } catch (err) {
      if (err.name === 'InvalidJsonBodyError') {
        log.error('validation error in account config. id=%s', accountId)
        err.debugPrint(log.warn.bind(log))
        throw new Error('error while adding account, see error log for details.')
      }

      throw err
    }

    this.accounts.set(accountId, {
      info: creds
    })

    this.emit('add', accountId)
  }

  remove (accountId: string) {
    log.info('remove account. accountId=' + accountId)

    this.emit('remove', accountId)

    this.accounts.delete(accountId)
  }

  getInfo (accountId: string) {
    const account = this.accounts.get(accountId)

    if (!account) {
      throw new Error('unknown account id. accountId=' + accountId)
    }

    return account.info
  }

  getChildAddress (accountId: string) {
    const info = this.getInfo(accountId)

    if (info.relation !== 'child') {
      throw new Error('Can\'t generate child address for account that is isn\'t a child')
    }

    const ilpAddressSegment = info.ilpAddressSegment || accountId

    return this.address + '.' + ilpAddressSegment
  }

  getStatus () {
    const accounts = {}
    this.accounts.forEach((account, accountId) => {
      accounts[accountId] = {
        // Set info.options to undefined so that credentials aren't exposed.
        info: Object.assign({}, account.info, { options: undefined }),
        connected: this.accountManager.isConnected(accountId),
      }
    })
    return {
      address: this.address,
      accounts
    }
  }
}
