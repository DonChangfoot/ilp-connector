import reduct = require('reduct')
import Config from "./config";
import {DataHandler, MoneyHandler} from "../types/plugin"
import IlpGrpc from 'ilp-grpc'

const log_1 = require('../../src/common/log')
const log = log_1.create('account-manager')

export default class AccountManager {

  protected deps: reduct.Injector
  protected config: Config
  protected accountIsConnected: Map<string, any>
  protected newAccountHandler?: Function
  protected removeAccountHandler?: Function
  protected dataHandlers: Map<string, DataHandler>
  protected moneyHandlers: Map<string, MoneyHandler>
  protected connectHandlers: Map<string, Function>
  protected disconnectHandlers: Map<string, Function>
  protected GRPCServer: any

  constructor(deps: reduct.Injector) {

    this.deps = deps
    this.config = deps(Config)
    this.accountIsConnected = new Map()
    this.dataHandlers = new Map()
    this.moneyHandlers = new Map()
    this.connectHandlers = new Map()
    this.disconnectHandlers = new Map()

  }

  registerNewAccountHandler(handler: Function){

    if(this.newAccountHandler) throw new Error("New plugin handler already exists")

    log.info("Plugin manager registering new plugin handler.")

    this.newAccountHandler = handler

  }

  deregisterNewAccountHandler(){

    log.info("Plugin manager deregistering new plugin handler.")

    this.newAccountHandler = undefined

  }

  registerRemoveAccountHandler(handler: Function){

    if(this.removeAccountHandler) throw new Error("Remove plugin handler already exists")

    log.info("Plugin manager registering remove plugin handler.")

    this.removeAccountHandler = handler

  }

  deregisterRemoveAccountHandler(){

    log.info("Plugin manager deregistering removing plugin handler.")

    this.removeAccountHandler = undefined

  }

  registerDataHandler(accountId: string, handler: DataHandler){

    if(this.dataHandlers.get(accountId)) throw new Error("Data handler already exists for account: " + accountId)

    this.dataHandlers.set(accountId, handler)

  }

  deregisterDataHandler(accountId: string){

    this.dataHandlers.delete(accountId)

  }

  registerMoneyHandler(accountId: string, handler: MoneyHandler){

    if(this.moneyHandlers.get(accountId)) throw new Error("Money handler already exists for account: " + accountId)

    this.moneyHandlers.set(accountId, handler)

  }

  deregisterMoneyHandler(accountId: string){

    this.moneyHandlers.delete(accountId)

  }

  registerConnectHandler(accountId: string, handler: Function){

    if(this.connectHandlers.get(accountId)) throw new Error("Connect handler already exists for account: " + accountId)

    this.connectHandlers.set(accountId, handler)

  }

  deregisterConnectHandler(accountId: string){

    this.connectHandlers.delete(accountId)

  }

  registerDisconnectHandler(accountId: string, handler: Function){

    if(this.disconnectHandlers.get(accountId)) throw new Error("Disconnect handler already exists for account: " + accountId)

    this.disconnectHandlers.set(accountId, handler)

  }

  deregisterDisonnectHandler(accountId: string){

    this.disconnectHandlers.delete(accountId)

  }

  isConnected(accountId: string){
    return this.accountIsConnected.get(accountId);
  }

  async sendData(data: Buffer, accountId: string): Promise<Buffer>{

    return await this.GRPCServer.sendData(data, accountId)

  }

  async sendMoney(data: Buffer, accountId: string): Promise<Buffer>{

    return Promise.resolve(Buffer.from('to do'))

  }

  async listen() {

    const {
      grpcServerHost = '127.0.0.1',
      grpcServerPort = 5505
    } = this.config

    log.info('grpc server listening. host=%s port=%s', grpcServerHost, grpcServerPort)

    this.GRPCServer = new IlpGrpc({
      listener: {
        port: grpcServerPort || 5505,
        secret: ''
      },
      dataHandler: (from: string, data: Buffer) => {

        let handler = this.dataHandlers.get(from);

        if(!handler) throw new Error("No handler for account: ")

        return handler(data)

      },
      addAccountHandler: this.newAccountHandler,
      removeAccountHandler: (id: string) => {

        this.accountIsConnected.delete(id)
        this.dataHandlers.delete(id)
        this.moneyHandlers.delete(id)
        this.connectHandlers.delete(id)
        this.disconnectHandlers.delete(id)

        if(this.removeAccountHandler){
          this.removeAccountHandler(id)
        }

      },
      connectionChangeHandler: (accountId: string, isConnected: boolean) => {

        this.accountIsConnected.set(accountId, isConnected);

        if(isConnected){
          let connectHandler = this.connectHandlers.get(accountId)

          if(!connectHandler) throw new Error("There is no connect handler for account " + accountId)

          connectHandler()
        }
        else{

          let disconnectHandler = this.disconnectHandlers.get(accountId)
          if(disconnectHandler) disconnectHandler()

        }

      }
    })

    await this.GRPCServer.connect()

  }

  shutdown(){

    log.info("shutting down")


  }


}


