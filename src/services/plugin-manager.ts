import Accounts from "./accounts";
import reduct = require('reduct')
import Config from "./config";
import MiddlewareManager from "./middleware-manager";
import RouteBroadcaster from "./route-broadcaster";
import * as Ildcp from "ilp-protocol-ildcp";
import {DataHandler, MoneyHandler} from "../types/plugin"
import * as grpc from 'grpc'
var PROTO_PATH = __dirname + '/../../resources/protos/account.proto';
// var grpc = require('grpc');
var protoLoader = require('@grpc/proto-loader');
var packageDefinition = protoLoader.loadSync(
    PROTO_PATH,
    {keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
    });
const proto = grpc.loadPackageDefinition(packageDefinition);
const account = proto.account;


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
  private server?: grpc.Server
  private pluginStreams: Map<string, any>
  protected pluginIsConnected: Map<string, any>
  protected newPluginHandler?: Function
  protected removePluginHandler?: Function
  protected dataHandlers: Map<string, DataHandler>
  protected moneyHandlers: Map<string, MoneyHandler>
  protected connectHandlers: Map<string, Function>
  protected disconnectHandlers: Map<string, Function>

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

  async addAccount(call, callback) {

    const accountConfig = call.request;

    if(!this.newPluginHandler) {

      callback(1, null)

      throw new Error("There is no new plugin handler specified.")
    }

    this.newPluginHandler(accountConfig.id, accountConfig.info);

    callback(null, {didSucceed: 1})

  }

  async handleData(call, callback) {

    const {accountId, buffer} = call.request;

    let handler = this.dataHandlers.get(accountId);

    if(!handler){

      callback({}, null);

      throw new Error("There is no data handler specified for account: " + accountId)

    }

    const data = await handler(buffer);

    callback(null, {buffer: data});

  }

  trackConnection(call, callback) {

    // try {
    //
    //   this.routeBroadcaster.track(call.request.accountId, this.pluginIsConnected.get(call.request.accountId));
    //   callback(null, {});
    //
    // }
    // catch (e) {
    //
    //   callback({}, null);
    //
    // }

  }

  untrackConnection(call, callback) {

    // try {
    //
    //   this.routeBroadcaster.untrack(call.request.accountId);
    //   callback(null, {});
    //
    // }
    // catch (e) {
    //
    //   callback({}, null);
    //
    // }

  }

  isConnected(accountId: string){
    return this.pluginIsConnected.get(accountId);
  }

  sendData(serializedPacket: any, accountId: string): Promise<Buffer>{

    return new Promise((resolve, reject) => {

      let stream = this.pluginStreams.get(accountId);

      if(stream){
        stream.write({accountId: 'dirk', buffer: Ildcp.serializeIldcpRequest({})});
      }
      else reject()

      const fulfill = IlpPacket.serializeIlpFulfill({
        fulfillment,
        data: Buffer.from('thank you')
      });

      resolve(fulfill);

    })

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

  listen() {
//TODO: set port and host through config options
    log.info('grpc server listening. host=%s port=%s', '0.0.0.0', 50051)
    this.server = new grpc.Server();

    // @ts-ignore
    const service = account.Account.service
    this.server.addService(service, {
      addAccount: this.addAccount.bind(this),
      handleData: this.handleData.bind(this),
      trackConnection: this.trackConnection.bind(this),
      untrackConnection: this.untrackConnection.bind(this),
      handleConnectionChange : this.handleConnectionChange.bind(this),
      registerDataStream: this.registerDataStream.bind(this),
      removeAccount: this.removeAccount.bind(this)
    });
    this.server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
    this.server.start();

  }


}


