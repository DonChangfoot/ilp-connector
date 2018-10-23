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

const newAccountData = {
    id: 'dirk',
    info: {
        relation: 'child',
        assetScale: 6,
        assetCode: 'XRP',
        plugin: 'ilp-plugin-mirror',
        options: {
            info: {
                prefix: 'test.quickstart.dirk'
            },
            account: 'test.quickstart.dirk.connector',
            balance: '0'
        }
    },
};

function runHandleData() {
    const data = Ildcp.serializeIldcpRequest()

    return new Promise(function(resolve, reject){

        client.handleData({accountId: newAccountData.id, buffer: data}, function(err, response) {

            if(err) {console.log("Could not handle data"); reject()}
            else{
                resolve(response.buffer)
            }

        })

    });

}

async function runTest() {

    return runHandleData().then(buffer => console.log("buffer is", buffer)).catch(error => console.log("hello"));

}

async function runAddAccount() {

    return await client.addAccount(newAccountData, function (err, response) {

        if(err) console.log("I did not get added to connector's accounts")
        else{

            console.log(" has been added to connector's accounts", response.didSucceed)

        }

    });
}

async function runTrackAccount() {

    console.log("running track account")
    return await client.trackConnection({accountId: newAccountData.id}, function(err, response){

        if(err) console.log("I did not get added to connector's routing table")
        else{

            console.log("I have been added to connector's routing table")

        }

    })
}

async function runUntrackAccount() {
    await client.untrackConnection({accountId: newAccountData.id}, function(err, response){

        if(err) console.log("I did not get removed from connector's routing table")
        else{

            console.log("I have been removed from connector's routing table")

        }

    })
}

function main() {

    // const deps = reduct();
    //
    // // this.config = deps(Config)
    // // this.store = deps(Store)
    //
    //
    // const Plugin = require(newAccountData.info.plugin)
    //
    // const api = {}
    // // Lazily create plugin utilities
    // Object.defineProperty(api, 'store', {
    //     get: () => {
    //         return this.store.getPluginStore(newAccountData.id)
    //     }
    // })
    // Object.defineProperty(api, 'log', {
    //     get: () => {
    //         return createLogger(`${newAccountData.info.plugin}[${newAccountData.id}]`)
    //     }
    // })
    //
    // const opts = {}
    // // Provide old deprecated _store and _log properties
    // Object.defineProperty(opts, '_store', {
    //     get: () => {
    //         log.warn('DEPRECATED: plugin accessed deprecated _store property. accountId=%s', accountId)
    //         return api.store
    //     }
    // })
    // Object.defineProperty(opts, '_log', {
    //     get: () => {
    //         log.warn('DEPRECATED: plugin accessed deprecated _log property. accountId=%s', accountId)
    //         return api.log
    //     }
    // })
    //
    // const plugin = compat(new Plugin(opts, api))

    async.series([
        runUntrackAccount,
        runTest,
        runTrackAccount,
        runAddAccount,
    ])

}

main();
