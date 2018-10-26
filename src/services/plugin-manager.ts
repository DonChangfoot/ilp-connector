import Accounts from "./accounts";
import reduct = require('reduct')
import Config from "./config";
import MiddlewareManager from "./middleware-manager";
import RouteBroadcaster from "./route-broadcaster";
import * as Ildcp from "ilp-protocol-ildcp";
import {DataHandler, MoneyHandler} from "../types/plugin"
import IlpGrpc from 'ilp-grpc'


const log_1 = require('../../src/common/log')
const log = log_1.create('plugin-manager')

const crypto = require('crypto')
function sha256 (preimage) { return crypto.createHash('sha256').update(preimage).digest() }
const fulfillment = crypto.randomBytes(32)
const condition = sha256(fulfillment)
var IlpPacket = require("ilp-packet");

export default class PluginManager {

  protected deps: reduct.Injector
  protected config: Config
  private pluginStreams: Map<string, any>
  protected pluginIsConnected: Map<string, any>
  protected newPluginHandler?: any
  protected removePluginHandler?: Function
  public dataHandlers: Map<string, DataHandler>
  protected moneyHandlers: Map<string, MoneyHandler>
  protected connectHandlers: Map<string, Function>
  protected disconnectHandlers: Map<string, Function>
  protected GRPCServer: any

  constructor(deps: reduct.Injector) {

    this.deps = deps
    this.config = deps(Config)
    this.pluginStreams = new Map()
    this.pluginIsConnected = new Map()
    this.dataHandlers = new Map()
    this.moneyHandlers = new Map()
    this.connectHandlers = new Map()
    this.disconnectHandlers = new Map()

  }

  registerNewPluginHandler(handler: Function){

    if(this.newPluginHandler) throw new Error("New plugin handler already exists")

    log.info("Plugin manager registering new plugin handler.")

    this.newPluginHandler = handler

  }

  deregisterNewPluginHandler(){

    log.info("Plugin manager deregistering new plugin handler.")

    this.newPluginHandler = undefined

  }

  registerRemovePluginHandler(handler: Function){

    if(this.removePluginHandler) throw new Error("Remove plugin handler already exists")

    log.info("Plugin manager registering remove plugin handler.")

    this.removePluginHandler = handler

  }

  deregisterRemovePluginHandler(){

    log.info("Plugin manager deregistering removing plugin handler.")

    this.removePluginHandler = undefined

  }

  registerDataHandler(accountId: string, handler: DataHandler){

    console.log("registering data handler for " + accountId)

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
    return this.pluginIsConnected.get(accountId);
  }

  async sendData(data: Buffer, accountId: string): Promise<Buffer>{

    return await this.GRPCServer.sendData(data, accountId)

  }

  handleConnectionChange(call, callback){

    const {accountId, isConnected} = call.request;

    this.pluginIsConnected.set(accountId, isConnected);

    callback(null, {});

  }

  registerDataStream(call){

    const self = this;

    call.on('data', function(data){

      if(data.type === 'registerStream') {
        console.log("storing plugin stream")
        self.pluginStreams.set(data.accountId, call)
        setTimeout(() => self.sendData(Ildcp.serializeIldcpRequest({}), 'dirk').then(fulfill => console.log('received fulfill', fulfill)).catch(() => console.log("failed to send data")), 1000)
      }
      else console.log("received from plugin", data)

    })

  }

  removeAccount(call, callback){

    const {accountId} = call.request;

    if(!this.removePluginHandler) {

      callback({}, null)

      throw new Error("There is no remove plugin handler specified.")
    }

    this.removePluginHandler(accountId)

    callback(null, {})

  }

  async listen() {
//TODO: set port and host through config options
    log.info('grpc server listening. host=%s port=%s', '0.0.0.0', 5505)

    this.GRPCServer = new IlpGrpc({
      listener: {
        port: 5505,
        secret: ''
      },
      dataHandler: (from: string, data: Buffer) => {

        console.log("dataHandler for grpc", from, 'data', IlpPacket.deserializeIlpPacket(data))

        let handler = this.dataHandlers.get(from);

        if(!handler) throw new Error("No handler for account: ")

        return handler(data)

      },
      addAccountHandler: this.newPluginHandler,
      connectionChangeHandler: (accountId: string, isConnected: boolean) => {

        this.pluginIsConnected.set(accountId, isConnected);

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


}


