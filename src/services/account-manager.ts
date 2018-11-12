import reduct = require('reduct')
import Config from './config'
import { DataHandler, MoneyHandler } from '../types/plugin'

import { BtpError, BtpStream, BtpServer, BtpMessage, BtpMessageContentType } from 'ilp-protocol-btp3'

const log_1 = require('../../src/common/log')
const log = log_1.create('account-manager')
import { createLogger } from 'ilp-module-loader'

export default class AccountManager {

  protected deps: reduct.Injector
  protected config: Config
  protected accountIsConnected: Map<string, any>
  protected streamMap: Map<string, BtpStream>
  protected newAccountHandler?: Function
  protected removeAccountHandler?: Function
  protected dataHandlers: Map<string, DataHandler>
  protected moneyHandlers: Map<string, MoneyHandler>
  protected connectHandlers: Map<string, Function>
  protected disconnectHandlers: Map<string, Function>

  constructor (deps: reduct.Injector) {

    this.deps = deps
    this.config = deps(Config)
    this.accountIsConnected = new Map()
    this.streamMap = new Map()
    this.dataHandlers = new Map()
    this.moneyHandlers = new Map()
    this.connectHandlers = new Map()
    this.disconnectHandlers = new Map()
  }

  registerNewAccountHandler (handler: Function) {

    if (this.newAccountHandler) throw new Error('New plugin handler already exists')

    log.info('Plugin manager registering new plugin handler.')

    this.newAccountHandler = handler

  }

  deregisterNewAccountHandler () {

    log.info('Plugin manager deregistering new plugin handler.')

    this.newAccountHandler = undefined

  }

  registerRemoveAccountHandler (handler: Function) {

    if (this.removeAccountHandler) throw new Error('Remove plugin handler already exists')

    log.info('Plugin manager registering remove plugin handler.')

    this.removeAccountHandler = handler

  }

  deregisterRemoveAccountHandler () {

    log.info('Plugin manager deregistering removing plugin handler.')

    this.removeAccountHandler = undefined

  }

  registerDataHandler (accountId: string, handler: DataHandler) {

    if (this.dataHandlers.get(accountId)) throw new Error('Data handler already exists for account: ' + accountId)

    this.dataHandlers.set(accountId, handler)

  }

  deregisterDataHandler (accountId: string) {

    this.dataHandlers.delete(accountId)

  }

  registerMoneyHandler (accountId: string, handler: MoneyHandler) {

    if (this.moneyHandlers.get(accountId)) throw new Error('Money handler already exists for account: ' + accountId)

    this.moneyHandlers.set(accountId, handler)

  }

  deregisterMoneyHandler (accountId: string) {

    this.moneyHandlers.delete(accountId)

  }

  registerConnectHandler (accountId: string, handler: Function) {

    if (this.connectHandlers.get(accountId)) throw new Error('Connect handler already exists for account: ' + accountId)

    this.connectHandlers.set(accountId, handler)

  }

  deregisterConnectHandler (accountId: string) {

    this.connectHandlers.delete(accountId)

  }

  registerDisconnectHandler (accountId: string, handler: Function) {

    if (this.disconnectHandlers.get(accountId)) throw new Error('Disconnect handler already exists for account: ' + accountId)

    this.disconnectHandlers.set(accountId, handler)

  }

  deregisterDisonnectHandler (accountId: string) {

    this.disconnectHandlers.delete(accountId)

  }

  isConnected (accountId: string) {
    return true// this.accountIsConnected.get(accountId)
  }

  // Wrapping in some function that converts from BTP to ILP for now
  async sendData (data: Buffer, accountId: string): Promise<Buffer> {
    return new Promise<Buffer>(async (resolve, reject) => {
      const handler = this.streamMap.get(accountId || '')
      if (handler) {
        let response = await handler.request({
          protocol: 'ilp',
          contentType: BtpMessageContentType.ApplicationOctetStream,
          payload: data
        })
        resolve(response.payload)
      }
    })
  }

  async sendMoney (data: Buffer, accountId: string): Promise<Buffer> {

    return Promise.resolve(Buffer.from('to do'))

  }

  async listen () {

    const {
      grpcServerHost = '127.0.0.1',
      grpcServerPort = 5506
    } = this.config

    const server = new BtpServer({}, {
      log: createLogger('btp-server')
    })

    server.on('connection', (stream: BtpStream) => {

      const { accountId, accountInfo } = stream

      if (this.newAccountHandler) {
        this.newAccountHandler(accountId, accountInfo)
      }

      this.streamMap.set(accountId || '', stream)

      stream.on('request', (message: BtpMessage, replyCallback: (reply: BtpMessage | BtpError | Promise<BtpMessage | BtpError>) => void) => {
        replyCallback(new Promise(async (respond) => {
          const handler = this.dataHandlers.get(accountId || '')
          if (handler) {
            respond({
              protocol: 'ilp',
              contentType: BtpMessageContentType.ApplicationOctetStream,
              payload:  await handler(message.payload)
            })
          }
        }))
      })

      stream.on('error', (error) => console.log(error))

      stream.on('cancelled', () => {
        if (this.removeAccountHandler) {
          this.removeAccountHandler(accountId)
        }
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

}
