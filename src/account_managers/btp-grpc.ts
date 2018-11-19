import reduct = require('reduct')
import Config from '../services/config'
import { BtpError, BtpStream, BtpServer, BtpMessage, BtpMessageContentType } from 'ilp-protocol-btp3'
import {AccountEntry, AccountManagerInstance} from '../types/account-manager'
import { EventEmitter } from 'events'
import { create as createLogger } from '../common/log'
import {AccountServiceConstructor, AccountServiceInstance} from "../types/account-service"
import {loadModuleOfType} from "../lib/utils"

const log = createLogger('btp-grpc-account-manager')

export default class BtpGrpcAccountManager extends EventEmitter implements AccountManagerInstance {

  protected deps: reduct.Injector
  protected config: Config
  protected accountServices: Map<string, AccountServiceInstance>
  protected newAccountHandler?: (accountId: string, accountService: AccountServiceInstance) => Promise<void>
  protected removeAccountHandler?: (accountId: string) => void

  constructor (deps: reduct.Injector) {

    super()

    this.deps = deps
    this.config = deps(Config)
    this.accountServices = new Map()
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

  add (accountId: string, accountInfo: any, stream: BtpStream) {

    const AccountService: AccountServiceConstructor = loadModuleOfType('account_service', 'btp-grpc')
    this.accountServices.set(accountId, new AccountService(accountId, accountInfo, stream))

    if(this.newAccountHandler) this.newAccountHandler(accountId, this.accountServices.get(accountId) as AccountServiceInstance)

  }

  remove (accountId: string) {

    const accountService = this.getAccountService(accountId)

    accountService.disconnect()

    if(this.removeAccountHandler) this.removeAccountHandler(accountId)

    this.accountServices.delete(accountId)
  }

  async startup () {

    const {
      grpcServerHost = '127.0.0.1',
      grpcServerPort = 5506
    } = this.config

    const server = new BtpServer({}, {
      log: createLogger('btp-server')
    })

    server.on('connection', (stream: BtpStream) => {

      const { accountId, accountInfo } = stream

      this.add(accountId || '', accountInfo, stream)

      stream.on('error', (error) => console.log(error))

      stream.on('cancelled', () => {
        this.remove(accountId || '')
      })

    })

    server.on('listening', () => {
      log.info('grpc server listening. host=%s port=%s', grpcServerHost, grpcServerPort)
    })

    await server.listen({
      host: grpcServerHost,
      port: grpcServerPort
    })

  }

  shutdown () {

    log.info('shutting down')

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
