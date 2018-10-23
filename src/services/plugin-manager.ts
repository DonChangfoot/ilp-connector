import Accounts from "./accounts";
import reduct = require('reduct')
import Config from "./config";
import MiddlewareManager from "./middleware-manager";
import RouteBroadcaster from "./route-broadcaster";
import * as Ildcp from "ilp-protocol-ildcp";
var PROTO_PATH = __dirname + '/../../resources/protos/account.proto';
var grpc = require('grpc');
var protoLoader = require('@grpc/proto-loader');
var packageDefinition = protoLoader.loadSync(
    PROTO_PATH,
    {keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
    });
var account_proto = grpc.loadPackageDefinition(packageDefinition).account;

const log_1 = require('../../src/common/log')
const log = log_1.create('accountManager')

export default class PluginManager{

    private deps: reduct.Injector
    private accounts: Accounts
    private config: Config
    private server: grpc.Server
    private routeBroadcaster: RouteBroadcaster
    private middlewareManager: MiddlewareManager

    constructor(deps: reduct.Injector) {

        this.deps = deps
        this.accounts = deps(Accounts)
        this.config = deps(Config)
        this.routeBroadcaster = deps(RouteBroadcaster)
        this.middlewareManager = deps(MiddlewareManager)

    }

    addAccount(call, callback) {

        const accountConfig = call.request;

        this.accounts.add(accountConfig.id, accountConfig.info);

        this.middlewareManager.addPlugin(accountConfig.id)

        console.log("accounts: ", this.accounts.getAccountIds());

        callback(null, {didSucceed: 1})

    }

    async handleData(call, callback) {

        try{

            const {accountId, buffer}  = call.request;

            const data = await this.middlewareManager.handleIncomingData(accountId, buffer);

            callback(null, {buffer: data});

        }
        catch (err) {

            callback({error: err}, null);

        }

    }

    trackConnection(call, callback){

        try{

            this.routeBroadcaster.track(call.request.accountId);
            callback(null, {});

        }
        catch(e){

            callback({}, null);

        }

    }

    untrackConnection(call, callback){

        try{

            this.routeBroadcaster.untrack(call.request.accountId);
            callback(null, {});

        }
        catch(e){

            callback({}, null);

        }

    }

    listen(){
//TODO: set port and host through config options
        log.info('grpc server listening. host=%s port=%s', '0.0.0.0', 50051)
        this.server = new grpc.Server();
        this.server.addService(account_proto.Account.service, {
            addAccount: this.addAccount.bind(this),
            handleData: this.handleData.bind(this),
            trackConnection: this.trackConnection.bind(this),
            untrackConnection: this.untrackConnection.bind(this)
        });
        this.server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
        this.server.start();

    }


}


