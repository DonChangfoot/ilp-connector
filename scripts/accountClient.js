var Ildcp = require("ilp-protocol-ildcp");

var IlpPacket = require("ilp-packet");

var compat = require("ilp-compat-plugin");
var createLogger = require("../src/common/log");
var Config = require("../src/services/config");
var Store = require("../src/services/store");
var async = require('async');
const reduct = require('reduct')
const crypto = require('crypto')
function sha256 (preimage) { return crypto.createHash('sha256').update(preimage).digest() }
const fulfillment = crypto.randomBytes(32)
const condition = sha256(fulfillment)
var PROTO_PATH = __dirname + '/../resources/protos/account.proto';

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
var hello_proto = grpc.loadPackageDefinition(packageDefinition).account;

var client = new hello_proto.Account('localhost:50051',
    grpc.credentials.createInsecure());

var user;
if (process.argv.length >= 3) {
    user = process.argv[2];
} else {
    user = 'world';
}

const newAccountData = {
    id: user,
    info: {
        relation: 'child',
        assetScale: 6,
        assetCode: 'XRP',
        plugin: 'ilp-plugin-mirror',
        options: {
            info: {
                prefix: 'test.quickstart.' + user,
                grpcAddress: '0.0.0.0:50052',
            },
            account: 'test.quickstart.' + user + '.connector',
            balance: '0'
        }
    },
};

let stream = client.registerDataStream()

stream.on('data',function(data){

    console.log("got data from connector", data)

})

const deps = reduct();

// this.config = deps(Config)
// this.store = deps(Store)


const Plugin = require(newAccountData.info.plugin)

const api = {}
// Lazily create plugin utilities
Object.defineProperty(api, 'store', {
    get: () => {
        return this.store.getPluginStore(newAccountData.id)
    }
})
Object.defineProperty(api, 'log', {
    get: () => {
        return createLogger(`${newAccountData.info.plugin}[${newAccountData.id}]`)
    }
})

const opts = {}
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

const plugin = compat(new Plugin(opts, api))

async function runHandleData() {
    const data = Ildcp.serializeIldcpRequest()

    return await new Promise(function(resolve, reject){

        client.handleData({accountId: newAccountData.id, buffer: data}, function(err, response) {

            if(err) {console.log("Could not handle data"); reject()}
            else{
                resolve(response.buffer)
            }

        })

    });

}

function runDataHandleTest(callback) {

    try{
        let test = runHandleData()
        callback(null, "buffer is" + test)
    }
    catch(e){
        callback(null, "failed to handle data")
    }

}

function runAddAccount(callback) {

    client.addAccount(newAccountData, function (err, response) {

        if(err) callback(null, "I did not get added to connector's accounts")
        else{

            callback(null, " has been added to connector's accounts", response.didSucceed)

        }

    });
}

function runTrackAccount(callback) {

    client.trackConnection({accountId: newAccountData.id}, function(err, response){

        if(err) callback(null, "I did not get added to connector's routing table")
        else{

            callback(null, "I have been added to connector's routing table")

        }

    })
}

function runUntrackAccount(callback) {
    client.untrackConnection({accountId: newAccountData.id}, function(err, response){

        if(err) callback(null, "I did not get removed from connector's routing table")
        else{

            callback(null, "I have been removed from connector's routing table")

        }

    })
}

function runChangeConnectionStatus(callback){

    client.handleConnectionChange({accountId: newAccountData.id, isConnected: true}, function(err, response){

        if(err) callback(null, "could not change connection status")
        else callback(null, "Connection status changed")

    })

}

function runRegisterDataStream(callback){

    stream.write({
        accountId: newAccountData.id,
        type: 'registerStream'
    });

    callback(null, "registered stream")

}

function runRemoveAccount(callback){

    client.removeAccount({accountId: newAccountData.id}, function(err, resp){

        if(err) callback(null, 'account could not be removed')
        else callback(null, 'account removed')

    })

}

function main() {

    async.series([
        runAddAccount,
        runChangeConnectionStatus,
        runRegisterDataStream,
        runDataHandleTest,
        runRemoveAccount,
    ], function(err, results){console.log(results)})

}

main();
