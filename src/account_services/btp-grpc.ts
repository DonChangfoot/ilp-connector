import {AccountInfo} from "../types/accounts"
import {DataHandler, MoneyHandler} from "../types/plugin"
import MiddlewareManager from "../services/middleware-manager"
import {BtpError, BtpMessage, BtpMessageContentType, BtpStream} from "ilp-protocol-btp3"
import {create as createLogger} from "../common/log"
import {AccountServiceInstance} from "../types/account-service"

const log = createLogger('btp-grpc-account-service')

export default class BtpGrpcAccountService implements AccountServiceInstance {

  protected id: string
  protected info: AccountInfo
  protected middlewareManager?: MiddlewareManager
  protected stream: BtpStream
  protected connectHandler?: (args: any[]) => void
  protected disconnectHandler?: (args: any[]) => void
  protected dataHandler?: DataHandler
  protected moneyHandler?: MoneyHandler

  constructor(accountId: string, accountInfo: AccountInfo, stream: BtpStream){

    this.id = accountId
    this.info = accountInfo
    this.stream = stream

    stream.on('request', (message: BtpMessage, replyCallback: (reply: BtpMessage | BtpError | Promise<BtpMessage | BtpError>) => void) => {
      replyCallback(new Promise(async (respond) => {
        if (this.dataHandler) {
          respond({
            protocol: 'ilp',
            contentType: BtpMessageContentType.ApplicationOctetStream,
            payload:  await this.dataHandler(message.payload)
          })
        }
      }))
    })

  }

  setupMiddleware() {

  }

  async connect() {

  }

  async disconnect() {

  }


  isConnected () {
    return true // hard code to true for now
  }

  async sendData (data: Buffer): Promise<Buffer> {
    return new Promise<Buffer>(async (resolve, reject) => {
      let response = await this.stream.request({
        protocol: 'ilp',
        contentType: BtpMessageContentType.ApplicationOctetStream,
        payload: data
      })
      resolve(response.payload)
    })
  }

  async sendMoney (amount: string) {
    return Promise.resolve()
  }

  registerDataHandler (dataHandler: DataHandler) {
    this.dataHandler = dataHandler
  }

  deregisterDataHandler () {
    this.dataHandler = undefined
  }

  registerMoneyHandler (moneyHandler: MoneyHandler) {
    this.moneyHandler = moneyHandler
  }

  deregisterMoneyHandler () {
    this.moneyHandler = undefined
  }

  registerConnectHandler (handler: (args: any[]) => void) {

    if (this.connectHandler) {
      log.error('Connect handler already exists for account: ' + this.id)
      throw new Error('Connect handler already exists for account: ' + this.id)
    }

    this.connectHandler = handler

  }

  deregisterConnectHandler () {

    if(this.connectHandler){
      this.connectHandler = undefined
    }

  }

  registerDisconnectHandler (handler: (args: any[]) => void) {

    if (this.disconnectHandler) {
      log.error('Disconnect handler already exists for account: ' + this.id)
      throw new Error('Disconnect handler already exists for account: ' + this.id)
    }

    this.disconnectHandler = handler

  }

  deregisterDisconnectHandler () {

    if(this.disconnectHandler){
      this.disconnectHandler = undefined
    }

  }

  getInfo() {
    return this.info
  }
}