import reduct = require('reduct')
import {AccountInfo} from "../types/accounts"
import {DataHandler, MoneyHandler, PluginInstance} from "../types/plugin"
import {create as createLogger} from "../common/log"
import compat from "ilp-compat-plugin"
import Store from "../services/store"
import { EventEmitter } from 'events'
import {AccountServiceInstance} from "../types/account-service"
import MiddlewareManager from "../services/middleware-manager"
import Config from "../services/config"

const log = createLogger('in-process-account-service')

export default class InProcessAccountService extends EventEmitter implements AccountServiceInstance {

  protected id: string
  protected config: Config
  protected info: AccountInfo
  protected middlewareManager?: MiddlewareManager
  protected store: Store
  protected plugin: PluginInstance
  protected connectHandler?: (args: any[]) => void
  protected disconnectHandler?: (args: any[]) => void

  constructor(accountId: string, accountInfo: AccountInfo, deps: reduct.Injector){

    super()

    this.id = accountId
    this.info = accountInfo
    this.config = deps(Config)
    this.store = deps(Store)
    const Plugin = require(accountInfo.plugin)

    try {
      this.config.validateAccount(accountId, accountInfo)
    } catch (err) {
      if (err.name === 'InvalidJsonBodyError') {
        log.error('validation error in account config. id=%s', accountId)
        err.debugPrint(log.warn.bind(log))
        throw new Error('error while adding account, see error log for details.')
      }

      throw err
    }

    const api: any = {}
    // Lazily create plugin utilities
    Object.defineProperty(api, 'store', {
      get: () => {
        return this.store.getPluginStore(this.id)
      }
    })
    Object.defineProperty(api, 'log', {
      get: () => {
        return createLogger(`${accountInfo.plugin}[${accountId}]`)
      }
    })

    const opts = Object.assign({}, accountInfo.options)
    // Provide old deprecated _store and _log properties
    Object.defineProperty(opts, '_store', {
      get: () => {
        log.warn('DEPRECATED: plugin accessed deprecated _store property. accountId=%s', accountId)
        return api.store
      }
    })
    Object.defineProperty(opts, '_log', {
      get: () => {
        log.warn('DEPRECATED: plugin accessed deprecated _log property. accountId=%s', accountId)
        return api.log
      }
    })

    this.plugin = compat(new Plugin(opts, api))

    log.info("started plugin for account " + accountId)
  }

  setupMiddleware() {

  }

  async connect() {
    return this.plugin.connect({})
  }

  async disconnect() {
    return this.plugin.disconnect()
  }

  isConnected () {
    return this.plugin.isConnected()
  }

  async sendData (data: Buffer) {
    return await this.plugin.sendData(data)
  }

  registerDataHandler (dataHandler: DataHandler) {
    this.plugin.registerDataHandler(dataHandler)
  }

  deregisterDataHandler () {
    this.plugin.deregisterDataHandler()
  }

  registerMoneyHandler (moneyHandler: MoneyHandler) {
    this.plugin.registerMoneyHandler(moneyHandler)
  }

  deregisterMoneyHandler () {
    this.plugin.deregisterMoneyHandler()
  }

  registerConnectHandler (handler: (args: any[]) => void) {

    if (this.connectHandler) {
      log.error('Connect handler already exists for account: ' + this.id)
      throw new Error('Connect handler already exists for account: ' + this.id)
    }

    this.connectHandler = handler
    this.plugin.on('connect', handler)

  }

  deregisterConnectHandler () {

    if(this.connectHandler){
      this.plugin.removeListener('connect', this.connectHandler)
      this.connectHandler = undefined
    }

  }

  registerDisconnectHandler (handler: (args: any[]) => void) {

    if (this.disconnectHandler) {
      log.error('Disconnect handler already exists for account: ' + this.id)
      throw new Error('Disconnect handler already exists for account: ' + this.id)
    }

    this.disconnectHandler = handler
    this.plugin.on('disconnect', handler)

  }

  deregisterDisconnectHandler () {

    if(this.disconnectHandler){
      this.plugin.removeListener('disconnect', this.disconnectHandler)
      this.disconnectHandler = undefined
    }

  }

  getInfo() {
    return this.info
  }
}